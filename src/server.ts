import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { BrowserRuntime, type BrowserRuntimeOptions } from "./runtime.js";
import { CAPABILITIES } from "./capabilities.js";
import { CockroachBrowserError } from "./errors.js";
import type { BrowserAction, SessionCreateInput } from "./contracts.js";

export interface BrowserServerOptions extends BrowserRuntimeOptions {
  runtime?: BrowserRuntime;
  host?: string;
  port?: number;
  token?: string;
  tokenFile?: string;
  allowedCorsOrigins?: string[];
  allowRemote?: boolean;
  tls?: { certFile: string; keyFile: string };
  maxRequestBytes?: number;
  /**
   * Exposes the generic action route. Disabled by default because production
   * mutations should enter through the Maqam-bound driver.
   */
  allowRawActions?: boolean;
  /**
   * Allows callers to choose host executable, CDP, proxy, profile secret, or
   * raw header configuration. Keep disabled for shared or remote daemons.
   */
  allowSessionHostConfiguration?: boolean;
}

export interface RunningBrowserServer {
  url: string;
  dashboardUrl: string;
  token: string;
  runtime: BrowserRuntime;
  close(): Promise<void>;
}

const DASHBOARD_FILES = new Map<string, { file: string; contentType: string }>([
  ["/dashboard/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/dashboard/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/dashboard/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/dashboard/assets/logo.svg", { file: "assets/logo.svg", contentType: "image/svg+xml; charset=utf-8" }]
]);

const DASHBOARD_ROOTS = [
  fileURLToPath(new URL("../dashboard/", import.meta.url)),
  fileURLToPath(new URL("../../dashboard/", import.meta.url))
];

export async function startBrowserServer(options: BrowserServerOptions = {}): Promise<RunningBrowserServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 43110;
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!loopback && !options.allowRemote) {
    throw new CockroachBrowserError(
      "REMOTE_BINDING_DENIED",
      "Non-loopback binding requires allowRemote=true and TLS."
    );
  }
  if (!loopback && !options.tls) {
    throw new CockroachBrowserError("REMOTE_TLS_REQUIRED", "Remote browser servers require a TLS certificate and key.");
  }

  const runtime = options.runtime ?? new BrowserRuntime(options);
  await runtime.initialize();
  const token = options.token ?? await loadOrCreateToken(options.tokenFile ?? join(runtime.root, "auth-token"));
  if (Buffer.byteLength(token) < 32) {
    throw new CockroachBrowserError("WEAK_SERVER_TOKEN", "The browser daemon token must contain at least 32 bytes.");
  }
  const allowedCorsOrigins = new Set(options.allowedCorsOrigins ?? []);
  const maxRequestBytes = Math.min(Math.max(options.maxRequestBytes ?? 1_048_576, 1_024), 16_777_216);

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://cockroach-browser.local");
    const requestOrigin = request.headers.origin;
    if (requestOrigin && allowedCorsOrigins.has(requestOrigin)) {
      response.setHeader("access-control-allow-origin", requestOrigin);
      response.setHeader("vary", "origin");
      response.setHeader("access-control-allow-headers", "authorization, content-type");
      response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    }
    if (request.method === "OPTIONS") {
      if (requestOrigin && !allowedCorsOrigins.has(requestOrigin)) return sendError(response, 403, "CORS_ORIGIN_DENIED", "Origin is not allowed.");
      response.writeHead(204);
      response.end();
      return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/dashboard") {
      response.writeHead(308, { location: "/dashboard/" });
      response.end();
      return;
    }
    if (url.pathname.startsWith("/dashboard/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendError(response, 405, "METHOD_NOT_ALLOWED", "Dashboard assets are read-only.");
      }
      const asset = DASHBOARD_FILES.get(url.pathname);
      if (!asset) return sendError(response, 404, "NOT_FOUND", "Dashboard asset not found.");
      return sendDashboardAsset(response, asset, request.method === "HEAD");
    }
    if (!authorized(request, token)) return sendError(response, 401, "UNAUTHORIZED", "A valid bearer token is required.");

    try {
      const segments = url.pathname.split("/").filter(Boolean);
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return sendJson(response, 200, {
          ok: true,
          name: "cockroach-browser",
          version: "0.2.1",
          sessions: (await runtime.sessions()).length,
          evidence: await runtime.evidence.verify()
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/capabilities") {
        return sendJson(response, 200, { capabilities: CAPABILITIES });
      }
      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        return sendJson(response, 200, { sessions: await runtime.sessions() });
      }
      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const input = await readJson<SessionCreateInput>(request, maxRequestBytes);
        assertSessionAuthority(input, Boolean(options.allowSessionHostConfiguration));
        return sendJson(response, 201, await runtime.createSession(input));
      }
      if (segments[0] === "v1" && segments[1] === "sessions" && segments[2]) {
        const sessionId = decodeURIComponent(segments[2]);
        if (request.method === "GET" && segments.length === 3) {
          return sendJson(response, 200, await runtime.session(sessionId));
        }
        if (request.method === "DELETE" && segments.length === 3) {
          await runtime.closeSession(sessionId);
          return sendJson(response, 200, { closed: sessionId });
        }
        if (request.method === "POST" && segments[3] === "actions") {
          if (!options.allowRawActions) {
            throw new CockroachBrowserError(
              "DIRECT_ACTION_DISABLED",
              "Direct daemon actions are disabled. Dispatch mutations through the Maqam browser driver or explicitly enable raw actions for a trusted local workflow."
            );
          }
          const action = await readJson<BrowserAction>(request, maxRequestBytes);
          return sendJson(response, 200, await runtime.act(sessionId, action));
        }
        if (request.method === "POST" && segments[3] === "snapshot") {
          const input = await readJson<{ tabId?: string }>(request, maxRequestBytes, {});
          return sendJson(response, 200, await runtime.snapshot(sessionId, input.tabId));
        }
        if (request.method === "POST" && segments[3] === "capture") {
          const input = await readJson<{
            tabId?: string;
            purpose?: string;
            fullPage?: boolean;
            format?: "png" | "jpeg";
            quality?: number;
            requireStable?: boolean;
            includeBounds?: boolean;
          }>(request, maxRequestBytes, {});
          return sendJson(response, 200, await runtime.act(sessionId, {
            kind: "capture.paired",
            purpose: input.purpose?.trim() || "Capture paired visual and semantic evidence",
            ...(input.tabId ? { tabId: input.tabId } : {}),
            ...(input.fullPage === undefined ? {} : { fullPage: input.fullPage }),
            ...(input.format ? { format: input.format } : {}),
            ...(input.quality === undefined ? {} : { quality: input.quality }),
            ...(input.requireStable === undefined ? {} : { requireStable: input.requireStable }),
            ...(input.includeBounds === undefined ? {} : { includeBounds: input.includeBounds })
          }));
        }
        if (request.method === "POST" && segments[3] === "network" && segments.length === 4) {
          const input = await readJson<{
            tabId?: string;
            purpose?: string;
            method?: string;
            status?: number;
            resourceType?: string;
            limit?: number;
          }>(request, maxRequestBytes, {});
          return sendJson(response, 200, await runtime.act(sessionId, {
            kind: "network.inspect",
            purpose: input.purpose?.trim() || "Inspect the bounded browser network ledger",
            ...(input.tabId ? { tabId: input.tabId } : {}),
            ...(input.method ? { method: input.method } : {}),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.resourceType ? { resourceType: input.resourceType } : {}),
            ...(input.limit === undefined ? {} : { limit: input.limit })
          }));
        }
        if (request.method === "POST" && segments[3] === "network" && segments[4] === "export") {
          const input = await readJson<{
            tabId?: string;
            purpose?: string;
            method?: string;
            status?: number;
            resourceType?: string;
            limit?: number;
            outputFormat?: "json" | "ndjson" | "har";
          }>(request, maxRequestBytes, {});
          return sendJson(response, 200, await runtime.act(sessionId, {
            kind: "network.export",
            purpose: input.purpose?.trim() || "Export the bounded browser network ledger",
            outputFormat: input.outputFormat ?? "json",
            ...(input.tabId ? { tabId: input.tabId } : {}),
            ...(input.method ? { method: input.method } : {}),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.resourceType ? { resourceType: input.resourceType } : {}),
            ...(input.limit === undefined ? {} : { limit: input.limit })
          }));
        }
        if (request.method === "POST" && segments[3] === "audit") {
          const input = await readJson<{ kinds?: Array<"accessibility" | "performance" | "assets" | "console" | "security"> }>(
            request,
            maxRequestBytes,
            {}
          );
          return sendJson(response, 200, await runtime.audit(sessionId, input.kinds));
        }
        if (request.method === "POST" && segments[3] === "compare") {
          const input = await readJson<{ baselinePath: string; threshold?: number; fullPage?: boolean }>(
            request,
            maxRequestBytes
          );
          return sendJson(response, 200, await runtime.compare(sessionId, input.baselinePath, input));
        }
        if (request.method === "POST" && segments[3] === "challenge" && segments[4] === "resume") {
          return sendJson(response, 200, await runtime.resumeAfterHuman(sessionId));
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/evidence") {
        return sendJson(response, 200, { evidence: runtime.evidence.list(url.searchParams.get("sessionId") ?? undefined) });
      }
      if (request.method === "GET" && url.pathname === "/v1/evidence/verify") {
        return sendJson(response, 200, await runtime.evidence.verify());
      }
      if (request.method === "GET" && segments[0] === "v1" && segments[1] === "artifacts" && segments[2]) {
        const record = runtime.evidence.list().find((entry) => entry.id === segments[2]);
        if (!record) throw new CockroachBrowserError("EVIDENCE_NOT_FOUND", "Evidence record was not found.");
        const data = await readFile(await runtime.evidence.artifactPath(record.id));
        response.writeHead(200, {
          "content-type": record.contentType,
          "content-length": data.byteLength,
          "content-disposition": `attachment; filename="${record.id}"`
        });
        response.end(data);
        return;
      }
      return sendError(response, 404, "NOT_FOUND", "Route not found.");
    } catch (error) {
      const known = error instanceof CockroachBrowserError;
      return sendError(
        response,
        known ? statusFor(error.code) : 500,
        known ? error.code : "INTERNAL_ERROR",
        error instanceof Error ? error.message : String(error),
        known ? error.details : undefined
      );
    }
  };

  const server = options.tls
    ? createHttpsServer(
        {
          cert: await readFile(resolve(options.tls.certFile)),
          key: await readFile(resolve(options.tls.keyFile))
        },
        (request, response) => void handler(request, response)
      )
    : createHttpServer((request, response) => void handler(request, response));

  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      accept();
    });
  });
  const address = server.address() as AddressInfo;
  const visibleHost = address.address === "::" ? "[::1]" : address.address;
  const protocol = options.tls ? "https" : "http";
  const url = `${protocol}://${visibleHost}:${address.port}`;
  return {
    url,
    dashboardUrl: `${url}/dashboard/`,
    token,
    runtime,
    async close() {
      await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
      await runtime.close();
    }
  };
}

async function loadOrCreateToken(path: string): Promise<string> {
  const target = resolve(path);
  try {
    const existing = (await readFile(target, "utf8")).trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("base64url");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${token}\n`, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") await chmod(target, 0o600);
  return token;
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted);
}

async function readJson<T>(
  request: IncomingMessage,
  maxBytes: number,
  fallback?: T
): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new CockroachBrowserError("REQUEST_TOO_LARGE", "Request body exceeds the configured limit.");
    chunks.push(buffer);
  }
  if (bytes === 0 && fallback !== undefined) return fallback;
  if (bytes === 0) throw new CockroachBrowserError("BODY_REQUIRED", "A JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new CockroachBrowserError("INVALID_JSON", "Request body is not valid JSON.");
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
}

async function sendDashboardAsset(
  response: ServerResponse,
  asset: { file: string; contentType: string },
  headOnly: boolean
): Promise<void> {
  let data: Buffer | undefined;
  for (const root of DASHBOARD_ROOTS) {
    try {
      data = await readFile(join(root, asset.file));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!data) return sendError(response, 404, "DASHBOARD_NOT_INSTALLED", "Dashboard files are not installed.");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  response.writeHead(200, {
    "content-type": asset.contentType,
    "content-length": data.byteLength
  });
  response.end(headOnly ? undefined : data);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.byteLength });
  response.end(body);
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  sendJson(response, status, { error: { code, message, ...(details ? { details } : {}) } });
}

function statusFor(code: string): number {
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("UNAUTHORIZED") || code.includes("APPROVAL") || code === "DIRECT_ACTION_DISABLED") return 403;
  if (code.includes("DENIED") || code.includes("REQUIRED") || code.includes("INVALID") || code.includes("EXCEEDED")) return 400;
  return 409;
}

function assertSessionAuthority(input: SessionCreateInput, allowHostConfiguration: boolean): void {
  if (allowHostConfiguration) return;
  const hostControlled = [
    input.executablePath ? "executablePath" : undefined,
    input.cdpEndpoint ? "cdpEndpoint" : undefined,
    input.proxy ? "proxy" : undefined,
    input.extraHTTPHeaders ? "extraHTTPHeaders" : undefined,
    input.profilePassphrase ? "profilePassphrase" : undefined
  ].filter((value): value is string => Boolean(value));
  if (hostControlled.length > 0) {
    throw new CockroachBrowserError(
      "SESSION_HOST_CONFIGURATION_DENIED",
      `Session callers cannot set host-controlled fields: ${hostControlled.join(", ")}. Configure them in the trusted host process instead.`
    );
  }
}
