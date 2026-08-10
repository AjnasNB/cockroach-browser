export type WebDriverMethod = "GET" | "POST" | "DELETE";

export interface WebDriverClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface WebDriverSessionResult {
  sessionId: string;
  capabilities: Record<string, unknown>;
}

/**
 * Raw W3C WebDriver/Appium client for operator-owned Android and iOS devices.
 * Arbitrary vendor commands remain available through command().
 */
export class WebDriverClient {
  readonly endpoint: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;

  constructor(options: WebDriverClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" && !isLoopback(endpoint.hostname)) {
      throw new TypeError("Remote WebDriver endpoints must use HTTPS.");
    }
    this.endpoint = endpoint;
    this.headers = Object.freeze({ ...(options.headers ?? {}) });
    this.requestTimeoutMs = integer(options.requestTimeoutMs ?? 60_000, 100, 600_000, "requestTimeoutMs");
    this.maxResponseBytes = integer(options.maxResponseBytes ?? 16 * 1024 * 1024, 1_024, 128 * 1024 * 1024, "maxResponseBytes");
  }

  async createSession(capabilities: Record<string, unknown>): Promise<WebDriverSession> {
    const value = await this.command<Record<string, unknown>>("POST", "/session", { capabilities });
    const sessionId = readString(value.sessionId ?? value["sessionId"], "sessionId");
    const returnedCapabilities = isRecord(value.capabilities) ? value.capabilities : {};
    return new WebDriverSession(this, { sessionId, capabilities: returnedCapabilities });
  }

  async command<T = unknown>(method: WebDriverMethod, path: string, body?: unknown): Promise<T> {
    if (!path.startsWith("/") || path.includes("..")) throw new TypeError("WebDriver command paths must be absolute and traversal-free.");
    const url = new URL(path.replace(/^\//, ""), ensureTrailingSlash(this.endpoint));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...this.headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const bytes = await readBoundedResponse(response, this.maxResponseBytes);
      const text = new TextDecoder().decode(bytes);
      const decoded = text ? JSON.parse(text) as unknown : undefined;
      const envelope = isRecord(decoded) && "value" in decoded ? decoded.value : decoded;
      if (!response.ok || (isRecord(envelope) && typeof envelope.error === "string")) {
        const message = isRecord(envelope) && typeof envelope.message === "string"
          ? envelope.message
          : `WebDriver returned HTTP ${response.status}.`;
        throw new Error(message);
      }
      return envelope as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class WebDriverSession {
  readonly client: WebDriverClient;
  readonly sessionId: string;
  readonly capabilities: Readonly<Record<string, unknown>>;

  constructor(client: WebDriverClient, result: WebDriverSessionResult) {
    this.client = client;
    this.sessionId = result.sessionId;
    this.capabilities = Object.freeze({ ...result.capabilities });
  }

  command<T = unknown>(method: WebDriverMethod, path: string, body?: unknown): Promise<T> {
    return this.client.command(method, `/session/${encodeURIComponent(this.sessionId)}${path}`, body);
  }

  navigate(url: string): Promise<unknown> {
    return this.command("POST", "/url", { url: new URL(url).toString() });
  }

  source(): Promise<string> {
    return this.command("GET", "/source");
  }

  screenshot(): Promise<string> {
    return this.command("GET", "/screenshot");
  }

  performActions(actions: unknown[]): Promise<unknown> {
    if (!Array.isArray(actions) || actions.length > 256) throw new RangeError("At most 256 WebDriver action sources are permitted.");
    return this.command("POST", "/actions", { actions });
  }

  releaseActions(): Promise<unknown> {
    return this.command("DELETE", "/actions");
  }

  async close(): Promise<void> {
    await this.command("DELETE", "");
  }
}

function ensureTrailingSlash(value: URL): URL {
  const copy = new URL(value);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`WebDriver response did not include ${label}.`);
  return value;
}

function integer(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

async function readBoundedResponse(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel("The WebDriver response exceeded maxResponseBytes.");
        throw new RangeError("The WebDriver response exceeded maxResponseBytes.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value.endsWith(".localhost") || value === "127.0.0.1" || value === "::1";
}
