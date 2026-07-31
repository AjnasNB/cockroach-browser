import type { SessionCreateInput, SessionSummary } from "./contracts.js";
import { BrowserClient } from "./client.js";
import { CockroachBrowserError } from "./errors.js";

export interface BrowserWorkerConfig {
  id: string;
  baseUrl: string;
  token: string;
  weight?: number;
  maxSessions?: number;
  tags?: string[];
}

export interface BrowserWorkerStatus {
  id: string;
  baseUrl: string;
  healthy: boolean;
  sessions: number;
  maxSessions: number;
  weight: number;
  tags: string[];
  error?: string;
}

export interface RoutedBrowserSession {
  workerId: string;
  client: BrowserClient;
  session: SessionSummary;
}

export class BrowserWorkerPool {
  #workers: Array<{ config: Required<Omit<BrowserWorkerConfig, "token">> & { token: string }; client: BrowserClient }>;

  constructor(workers: BrowserWorkerConfig[]) {
    if (!workers.length) throw new CockroachBrowserError("WORKER_POOL_EMPTY", "At least one authenticated browser worker is required.");
    const ids = new Set<string>();
    this.#workers = workers.map((worker) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(worker.id) || ids.has(worker.id)) {
        throw new CockroachBrowserError("WORKER_ID_INVALID", `Worker ID ${worker.id} is invalid or duplicated.`);
      }
      ids.add(worker.id);
      if (Buffer.byteLength(worker.token) < 32) throw new CockroachBrowserError("WEAK_WORKER_TOKEN", `Worker ${worker.id} requires a strong token.`);
      const baseUrl = new URL(worker.baseUrl);
      if (!isLoopback(baseUrl.hostname) && baseUrl.protocol !== "https:") {
        throw new CockroachBrowserError("WORKER_TLS_REQUIRED", `Remote worker ${worker.id} must use HTTPS.`);
      }
      const config = {
        id: worker.id,
        baseUrl: baseUrl.toString().replace(/\/$/, ""),
        token: worker.token,
        weight: Math.min(Math.max(worker.weight ?? 1, 1), 100),
        maxSessions: Math.min(Math.max(worker.maxSessions ?? 8, 1), 1_000),
        tags: [...new Set(worker.tags ?? [])]
      };
      return { config, client: new BrowserClient({ baseUrl: config.baseUrl, token: config.token }) };
    });
  }

  async status(): Promise<BrowserWorkerStatus[]> {
    return Promise.all(this.#workers.map(async ({ config, client }) => {
      try {
        await client.health();
        const sessions = (await client.sessions()).length;
        return {
          id: config.id,
          baseUrl: config.baseUrl,
          healthy: true,
          sessions,
          maxSessions: config.maxSessions,
          weight: config.weight,
          tags: [...config.tags]
        };
      } catch (error) {
        return {
          id: config.id,
          baseUrl: config.baseUrl,
          healthy: false,
          sessions: 0,
          maxSessions: config.maxSessions,
          weight: config.weight,
          tags: [...config.tags],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
  }

  async createSession(input: SessionCreateInput, options: { tags?: string[] } = {}): Promise<RoutedBrowserSession> {
    const status = await this.status();
    const required = new Set(options.tags ?? []);
    const candidates = status
      .filter((entry) => entry.healthy && entry.sessions < entry.maxSessions && [...required].every((tag) => entry.tags.includes(tag)))
      .sort((a, b) => (a.sessions / a.weight) - (b.sessions / b.weight) || a.id.localeCompare(b.id));
    const selected = candidates[0];
    if (!selected) throw new CockroachBrowserError("NO_WORKER_CAPACITY", "No healthy browser worker satisfies the requested tags and capacity.");
    const worker = this.#workers.find((entry) => entry.config.id === selected.id)!;
    return { workerId: selected.id, client: worker.client, session: await worker.client.createSession(input) };
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
