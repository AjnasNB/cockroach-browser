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
import type { BrowserAction, BrowserActionBatchInput, SessionCreateInput, SessionSummary } from "./contracts.js";
import type { TeamSessionRole } from "./team-sessions.js";
import { TeamSessionStore } from "./team-sessions.js";
import { JobQueue, type BrowserJob } from "./job-queue.js";

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
  /** Optional actor tokens for team-scoped access. The daemon token remains the local administrator. */
  actorTokens?: Record<string, string>;
  /** Optional persistent session ownership, sharing, and revocation store. */
  teamSessions?: TeamSessionStore;
  /** Enables the bounded, crash-resumable local job API. Disabled unless explicitly configured. */
  enableJobs?: boolean;
  /** Optional caller-owned queue implementation for local or embedded deployments. */
  jobQueue?: JobQueue;
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
  ["/dashboard/assets/logo.png", { file: "assets/logo.png", contentType: "image/png" }]
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
  const actorTokens = normalizeActorTokens(options.actorTokens ?? {});
  await options.teamSessions?.initialize();
  const jobQueue = options.jobQueue ?? (options.enableJobs ? new JobQueue({
    path: join(runtime.root, "jobs", "queue.json"),
    execute: (sessionId, action) => runtime.act(sessionId, action)
  }) : undefined);
  await jobQueue?.initialize();

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
    const identity = authenticate(request, token, actorTokens);
    if (!identity) return sendError(response, 401, "UNAUTHORIZED", "A valid bearer token is required.");

    try {
      const segments = url.pathname.split("/").filter(Boolean);
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return sendJson(response, 200, {
          ok: true,
          name: "cockroach-browser",
          version: "0.4.1",
          sessions: (await runtime.sessions()).length,
          evidence: await runtime.evidence.verify()
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/capabilities") {
        return sendJson(response, 200, { capabilities: CAPABILITIES });
      }
      if (request.method === "GET" && url.pathname === "/v1/openapi.json") {
        return sendJson(response, 200, openApiDocument());
      }
      if (request.method === "GET" && url.pathname === "/v1/metrics") {
        const sessions = await runtime.sessions();
        const activity = runtime.activities({ limit: 10_000 });
        const completed = activity.filter((entry) => entry.type === "browser.action.completed");
        return sendText(response, 200, [
          "# HELP cockroach_browser_sessions Current in-process browser sessions.",
          "# TYPE cockroach_browser_sessions gauge",
          `cockroach_browser_sessions ${sessions.length}`,
          "# HELP cockroach_browser_actions_total Completed browser actions retained by the activity ledger.",
          "# TYPE cockroach_browser_actions_total counter",
          `cockroach_browser_actions_total ${completed.length}`,
          "# HELP cockroach_browser_action_failures_total Failed or denied browser actions retained by the activity ledger.",
          "# TYPE cockroach_browser_action_failures_total counter",
          `cockroach_browser_action_failures_total ${completed.filter((entry) => entry.metadata?.status !== "succeeded").length}`,
          ...resourceMetricLines(sessions),
          ""
        ].join("\n"), "text/plain; version=0.0.4; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/v1/errors") {
        const errors = runtime.activities({ limit: Math.min(Number(url.searchParams.get("limit") ?? 100), 1_000) })
          .filter((entry) => entry.type === "browser.action.completed" && entry.metadata?.status !== "succeeded");
        return sendJson(response, 200, { errors });
      }
      if (segments[0] === "v1" && segments[1] === "jobs") {
        if (!jobQueue) throw new CockroachBrowserError("JOBS_DISABLED", "The local job API is disabled. Start the daemon with explicit job support for a trusted workflow.");
        if (request.method === "GET" && segments.length === 2) {
          const jobs = jobQueue.list();
          if (identity.admin || !options.teamSessions) return sendJson(response, 200, { jobs });
          const visible: BrowserJob[] = [];
          for (const job of jobs) if (await canAccess(options.teamSessions, job.sessionId, identity.actor!, "viewer")) visible.push(job);
          return sendJson(response, 200, { jobs: visible });
        }
        if (request.method === "POST" && segments.length === 2) {
          if (!options.allowRawActions) {
            throw new CockroachBrowserError("DIRECT_ACTION_DISABLED", "Local jobs execute browser actions and therefore require explicit raw-action authority or a Maqam-governed dispatcher.");
          }
          const input = await readJson<{ sessionId: string; purpose: string; actions: BrowserAction[]; maxAttempts?: number }>(request, maxRequestBytes);
          await requireSessionAccess(options.teamSessions, identity, input.sessionId, "operator");
          const job = await jobQueue.enqueue(input);
          void drainJobs(jobQueue);
          return sendJson(response, 202, job);
        }
        if (segments[2]) {
          const job = jobQueue.get(decodeURIComponent(segments[2]));
          await requireSessionAccess(options.teamSessions, identity, job.sessionId, request.method === "POST" ? "operator" : "viewer");
          if (request.method === "GET" && segments.length === 3) return sendJson(response, 200, job);
          if (request.method === "POST" && segments[3] === "cancel") return sendJson(response, 200, await jobQueue.cancel(job.id));
        }
      }
      if (segments[0] === "v1" && segments[1] === "profiles") {
        if (!identity.admin) throw new CockroachBrowserError("PROFILE_ADMIN_REQUIRED", "Persistent browser profiles require daemon administrator authority.");
        if (request.method === "GET" && segments.length === 2) {
          return sendJson(response, 200, { profiles: await runtime.persistentProfiles.list() });
        }
        if (request.method === "POST" && segments[2] && segments.length === 3) {
          return sendJson(response, 201, await runtime.persistentProfiles.prepare(decodeURIComponent(segments[2])));
        }
        if (request.method === "DELETE" && segments[2] && segments.length === 3) {
          return sendJson(response, 200, await runtime.persistentProfiles.archive(decodeURIComponent(segments[2])));
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        const sessions = await runtime.sessions();
        if (identity.admin || !options.teamSessions) return sendJson(response, 200, { sessions });
        const visible = [];
        for (const session of sessions) {
          if (await canAccess(options.teamSessions, session.id, identity.actor!, "viewer")) visible.push(session);
        }
        return sendJson(response, 200, { sessions: visible });
      }
      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const input = await readJson<SessionCreateInput>(request, maxRequestBytes);
        assertSessionAuthority(input, Boolean(options.allowSessionHostConfiguration));
        if (!identity.admin) input.actor = identity.actor!;
        const created = await runtime.createSession(input);
        if (options.teamSessions) await options.teamSessions.claim(created.id, identity.actor ?? input.actor ?? "local-owner");
        return sendJson(response, 201, created);
      }
      if (request.method === "GET" && url.pathname === "/v1/activity") {
        const sessionId = url.searchParams.get("sessionId") ?? undefined;
        if (sessionId) await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
        let activity = runtime.activities({
          ...(sessionId ? { sessionId } : {}),
          ...(url.searchParams.get("after") ? { after: url.searchParams.get("after")! } : {}),
          ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {})
        });
        if (!identity.admin && options.teamSessions && !sessionId) {
          const filtered = [];
          for (const entry of activity) if (await canAccess(options.teamSessions, entry.sessionId, identity.actor!, "viewer")) filtered.push(entry);
          activity = filtered;
        }
        return sendJson(response, 200, { activity });
      }
      if (request.method === "GET" && url.pathname === "/v1/activity/stream") {
        const sessionId = url.searchParams.get("sessionId") ?? undefined;
        if (sessionId) await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        });
        response.write(": cockroach-browser activity\n\n");
        const unsubscribe = runtime.activity.subscribe((event) => {
          if (sessionId && event.sessionId !== sessionId) return;
          if (!identity.admin && options.teamSessions) {
            void canAccess(options.teamSessions, event.sessionId, identity.actor!, "viewer").then((allowed) => {
              if (allowed && !response.destroyed) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            });
            return;
          }
          if (!response.destroyed) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });
        request.once("close", unsubscribe);
        return;
      }
      if (segments[0] === "v1" && segments[1] === "sessions" && segments[2]) {
        const sessionId = decodeURIComponent(segments[2]);
        if (request.method === "GET" && segments.length === 3) {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
          return sendJson(response, 200, await runtime.session(sessionId));
        }
        if (request.method === "GET" && segments[3] === "resources" && segments.length === 4) {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
          return sendJson(response, 200, await runtime.resourceUsage(sessionId));
        }
        if (request.method === "DELETE" && segments.length === 3) {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "owner");
          await runtime.closeSession(sessionId);
          return sendJson(response, 200, { closed: sessionId });
        }
        if (request.method === "GET" && segments[3] === "navigation-graph") {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
          return sendJson(response, 200, runtime.navigationGraph(sessionId));
        }
        if (segments[3] === "access" && options.teamSessions) {
          const entry = await options.teamSessions.get(sessionId);
          if (!entry) throw new CockroachBrowserError("SESSION_ACCESS_NOT_FOUND", `No access record exists for ${sessionId}.`);
          const requester = identity.admin ? entry.owner : identity.actor!;
          if (request.method === "GET" && segments.length === 4) {
            await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
            return sendJson(response, 200, entry);
          }
          if (request.method === "POST" && segments[4] === "grant") {
            const input = await readJson<{ actor: string; role: "viewer" | "operator" }>(request, maxRequestBytes);
            return sendJson(response, 200, await options.teamSessions.grant(sessionId, requester, input.actor, input.role));
          }
          if (request.method === "POST" && segments[4] === "revoke") {
            const input = await readJson<{ actor: string }>(request, maxRequestBytes);
            return sendJson(response, 200, await options.teamSessions.revoke(sessionId, requester, input.actor));
          }
        }
        if (request.method === "POST" && segments[3] === "actions" && segments[4] === "batch") {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "operator");
          if (!options.allowRawActions) {
            throw new CockroachBrowserError("DIRECT_ACTION_DISABLED", "Direct daemon batches are disabled. Dispatch mutations through the Maqam browser driver or explicitly enable raw actions for a trusted local workflow.");
          }
          const input = await readJson<BrowserActionBatchInput>(request, maxRequestBytes);
          return sendJson(response, 200, await runtime.actBatch(sessionId, input));
        }
        if (request.method === "POST" && segments[3] === "actions" && segments.length === 4) {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "operator");
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
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
          const input = await readJson<{ tabId?: string }>(request, maxRequestBytes, {});
          return sendJson(response, 200, await runtime.snapshot(sessionId, input.tabId));
        }
        if (request.method === "POST" && segments[3] === "capture") {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
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
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
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
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
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
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
          const input = await readJson<{ kinds?: Array<"accessibility" | "performance" | "assets" | "console" | "security"> }>(
            request,
            maxRequestBytes,
            {}
          );
          return sendJson(response, 200, await runtime.audit(sessionId, input.kinds));
        }
        if (request.method === "POST" && segments[3] === "compare") {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
          const input = await readJson<{ baselinePath: string; threshold?: number; fullPage?: boolean }>(
            request,
            maxRequestBytes
          );
          return sendJson(response, 200, await runtime.compare(sessionId, input.baselinePath, input));
        }
        if (request.method === "POST" && segments[3] === "challenge" && segments[4] === "resume") {
          await requireSessionAccess(options.teamSessions, identity, sessionId, "operator");
          return sendJson(response, 200, await runtime.resumeAfterHuman(sessionId));
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/evidence") {
        const sessionId = url.searchParams.get("sessionId") ?? undefined;
        if (sessionId) await requireSessionAccess(options.teamSessions, identity, sessionId, "viewer");
        let evidence = runtime.evidence.list(sessionId);
        if (!identity.admin && options.teamSessions && !sessionId) {
          const visible = [];
          for (const record of evidence) if (await canAccess(options.teamSessions, record.sessionId, identity.actor!, "viewer")) visible.push(record);
          evidence = visible;
        }
        return sendJson(response, 200, { evidence });
      }
      if (request.method === "GET" && url.pathname === "/v1/evidence/verify") {
        return sendJson(response, 200, await runtime.evidence.verify());
      }
      if (request.method === "GET" && segments[0] === "v1" && segments[1] === "artifacts" && segments[2]) {
        const record = runtime.evidence.list().find((entry) => entry.id === segments[2]);
        if (!record) throw new CockroachBrowserError("EVIDENCE_NOT_FOUND", "Evidence record was not found.");
        await requireSessionAccess(options.teamSessions, identity, record.sessionId, "viewer");
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

interface RequestIdentity { admin: boolean; actor?: string }

function authenticate(request: IncomingMessage, adminToken: string, actors: Map<string, string>): RequestIdentity | undefined {
  if (authorized(request, adminToken)) return { admin: true };
  for (const [actor, token] of actors) if (authorized(request, token)) return { admin: false, actor };
  return undefined;
}

function normalizeActorTokens(input: Record<string, string>): Map<string, string> {
  const output = new Map<string, string>();
  for (const [actor, token] of Object.entries(input)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(actor) || Buffer.byteLength(token) < 32) {
      throw new CockroachBrowserError("ACTOR_TOKEN_INVALID", "Actor tokens require a bounded actor ID and at least 32 bytes.");
    }
    output.set(actor, token);
  }
  return output;
}

async function requireSessionAccess(
  store: TeamSessionStore | undefined,
  identity: RequestIdentity,
  sessionId: string,
  role: TeamSessionRole
): Promise<void> {
  if (!store || identity.admin) return;
  await store.assert(sessionId, identity.actor!, role);
}

async function canAccess(store: TeamSessionStore, sessionId: string, actor: string, role: TeamSessionRole): Promise<boolean> {
  try {
    await store.assert(sessionId, actor, role);
    return true;
  } catch {
    return false;
  }
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

function sendText(response: ServerResponse, status: number, value: string, contentType: string): void {
  const body = Buffer.from(value);
  response.writeHead(status, { "content-type": contentType, "content-length": body.byteLength });
  response.end(body);
}

function resourceMetricLines(sessions: readonly SessionSummary[]): string[] {
  const available = sessions.filter((session) => session.resources?.available);
  const sum = (read: (session: SessionSummary) => number): number =>
    available.reduce((total, session) => total + read(session), 0);
  const metrics: Array<[name: string, help: string, value: number]> = [
    ["cockroach_browser_resource_rss_bytes", "Current aggregate RSS for sampled runtime-owned browser process trees.", sum((session) => session.resources.rssBytes ?? 0)],
    ["cockroach_browser_resource_cpu_time_seconds", "Cumulative CPU time for sampled runtime-owned browser process trees.", sum((session) => session.resources.cpuTimeMs ?? 0) / 1_000],
    ["cockroach_browser_resource_processes", "Processes in sampled runtime-owned browser process trees.", sum((session) => session.resources.processCount ?? 0)],
    ["cockroach_browser_resource_rss_limit_bytes", "Aggregate configured RSS limit for sampled browser sessions.", sum((session) => session.resources.maxProcessRssBytes)],
    ["cockroach_browser_resource_cpu_time_limit_seconds", "Aggregate configured CPU-time limit for sampled browser sessions.", sum((session) => session.resources.maxProcessCpuTimeMs) / 1_000],
    ["cockroach_browser_resource_sampled_sessions", "Browser sessions with an available process-tree sample.", available.length],
    ["cockroach_browser_resource_unavailable_sessions", "Browser sessions whose complete process-tree usage is unavailable.", sessions.length - available.length],
    ["cockroach_browser_resource_limit_exceeded_sessions", "Browser sessions whose sampled process tree exceeded a configured limit.", sessions.filter((session) => session.resources?.limitState === "exceeded").length]
  ];
  return metrics.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name} ${value}`
  ]);
}

async function drainJobs(queue: JobQueue): Promise<void> {
  // A single queue runner preserves action order. JobQueue refuses overlapping
  // runners, so repeated submissions can safely nudge this loop.
  while (await queue.runNext()) {
    // Continue until the local queue contains no runnable work.
  }
}

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Cockroach Browser local daemon", version: "0.4.1" },
    servers: [{ url: "http://127.0.0.1:43110" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/health": { get: { summary: "Runtime health" } },
      "/v1/capabilities": { get: { summary: "Machine-readable capabilities" } },
      "/v1/sessions": { get: { summary: "List admitted sessions" }, post: { summary: "Create an admitted session" } },
      "/v1/sessions/{id}/resources": { get: { summary: "Read a fresh owned-browser process resource sample" } },
      "/v1/sessions/{id}/actions": { post: { summary: "Run one exact policy-evaluated action" } },
      "/v1/sessions/{id}/actions/batch": { post: { summary: "Run a bounded ordered action batch" } },
      "/v1/activity": { get: { summary: "Read the bounded activity ledger" } },
      "/v1/activity/stream": { get: { summary: "Stream activity over SSE" } },
      "/v1/metrics": { get: { summary: "Prometheus metrics" } },
      "/v1/profiles": { get: { summary: "List runtime-owned persistent browser profiles" } },
      "/v1/jobs": { get: { summary: "List visible bounded jobs" }, post: { summary: "Queue one bounded browser job" } },
      "/v1/jobs/{id}": { get: { summary: "Inspect one bounded browser job" } },
      "/v1/jobs/{id}/cancel": { post: { summary: "Cancel one queued or running job" } }
    }
  };
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
    input.browserProvider ? "browserProvider" : undefined,
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
