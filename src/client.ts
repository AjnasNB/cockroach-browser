import type {
  ActionReceipt,
  BrowserAction,
  BrowserNetworkRecord,
  PageSnapshot,
  SessionCreateInput,
  SessionSummary
} from "./contracts.js";
import type { Capability } from "./capabilities.js";
import { CockroachBrowserError } from "./errors.js";

export interface BrowserClientOptions {
  baseUrl?: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

export interface BrowserActionResult<T> {
  output: T;
  receipt: ActionReceipt;
}

export interface PairedCaptureOptions {
  tabId?: string;
  purpose?: string;
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
  requireStable?: boolean;
  includeBounds?: boolean;
}

export interface NetworkReadOptions {
  tabId?: string;
  purpose?: string;
  method?: string;
  status?: number;
  resourceType?: string;
  limit?: number;
}

export class BrowserClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetcher: typeof globalThis.fetch;

  constructor(options: BrowserClientOptions) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:43110").replace(/\/+$/, "");
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  health(): Promise<Record<string, unknown>> {
    return this.request("GET", "/v1/health");
  }

  async capabilities(): Promise<Capability[]> {
    return (await this.request<{ capabilities: Capability[] }>("GET", "/v1/capabilities")).capabilities;
  }

  createSession(input: SessionCreateInput): Promise<SessionSummary> {
    return this.request("POST", "/v1/sessions", input);
  }

  async sessions(): Promise<SessionSummary[]> {
    return (await this.request<{ sessions: SessionSummary[] }>("GET", "/v1/sessions")).sessions;
  }

  session(id: string): Promise<SessionSummary> {
    return this.request("GET", `/v1/sessions/${encodeURIComponent(id)}`);
  }

  async closeSession(id: string): Promise<void> {
    await this.request("DELETE", `/v1/sessions/${encodeURIComponent(id)}`);
  }

  act(id: string, action: BrowserAction): Promise<Record<string, unknown>> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(id)}/actions`, action);
  }

  snapshot(id: string, tabId?: string): Promise<PageSnapshot> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(id)}/snapshot`, { tabId });
  }

  capture(
    id: string,
    options: PairedCaptureOptions = {}
  ): Promise<BrowserActionResult<{
    screenshotEvidenceId: string;
    pairEvidenceId: string;
    snapshotDigest: string;
    refs: number;
    bounds: number;
  }>> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(id)}/capture`, options);
  }

  network(
    id: string,
    options: NetworkReadOptions = {}
  ): Promise<BrowserActionResult<{
    records: BrowserNetworkRecord[];
    returned: number;
    retained: number;
    ceiling: number;
  }>> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(id)}/network`, options);
  }

  exportNetwork(
    id: string,
    options: NetworkReadOptions & { outputFormat?: "json" | "ndjson" | "har" } = {}
  ): Promise<BrowserActionResult<{
    evidenceId: string;
    format: "json" | "ndjson" | "har";
    records: number;
    bytes: number;
  }>> {
    return this.request(
      "POST",
      `/v1/sessions/${encodeURIComponent(id)}/network/export`,
      options
    );
  }

  audit(
    id: string,
    kinds?: Array<"accessibility" | "performance" | "assets" | "console" | "security">
  ): Promise<Record<string, unknown>> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(id)}/audit`, { kinds });
  }

  resumeAfterHuman(id: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(id)}/challenge/resume`, {});
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let value: unknown;
    try {
      value = text ? JSON.parse(text) : undefined;
    } catch {
      throw new CockroachBrowserError("INVALID_SERVER_RESPONSE", `Browser server returned non-JSON status ${response.status}.`);
    }
    if (!response.ok) {
      const error = value as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
      throw new CockroachBrowserError(
        error.error?.code ?? "SERVER_ERROR",
        error.error?.message ?? `Browser server returned status ${response.status}.`,
        error.error?.details
      );
    }
    return value as T;
  }
}
