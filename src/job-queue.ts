import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BrowserAction } from "./contracts.js";
import { newId, nowIso } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";

export type BrowserJobState = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";

export interface BrowserJob {
  id: string;
  sessionId: string;
  purpose: string;
  actions: BrowserAction[];
  cursor: number;
  attempts: number;
  maxAttempts: number;
  state: BrowserJobState;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface JobQueueOptions {
  path: string;
  execute(sessionId: string, action: BrowserAction): Promise<unknown>;
}

/** A single-process, crash-resumable queue. It never retries unknown browser writes automatically. */
export class JobQueue {
  readonly path: string;
  readonly execute: JobQueueOptions["execute"];
  #jobs = new Map<string, BrowserJob>();
  #running = false;

  constructor(options: JobQueueOptions) {
    this.path = resolve(options.path);
    this.execute = options.execute;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const jobs = JSON.parse(await readFile(this.path, "utf8")) as BrowserJob[];
      for (const job of jobs) {
        this.#jobs.set(job.id, {
          ...job,
          state: job.state === "running" ? "paused" : job.state
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  list(): BrowserJob[] {
    return [...this.#jobs.values()].map((job) => structuredClone(job));
  }

  get(id: string): BrowserJob {
    const job = this.#jobs.get(id);
    if (!job) throw new CockroachBrowserError("JOB_NOT_FOUND", `Job ${id} was not found.`);
    return structuredClone(job);
  }

  async enqueue(input: {
    sessionId: string;
    purpose: string;
    actions: BrowserAction[];
    maxAttempts?: number;
  }): Promise<BrowserJob> {
    if (input.actions.length === 0 || input.actions.length > 1_000) {
      throw new CockroachBrowserError("INVALID_JOB_ACTIONS", "Jobs contain between 1 and 1,000 actions.");
    }
    const timestamp = nowIso();
    const job: BrowserJob = {
      id: newId("job"),
      sessionId: input.sessionId,
      purpose: input.purpose,
      actions: structuredClone(input.actions),
      cursor: 0,
      attempts: 0,
      maxAttempts: Math.min(Math.max(input.maxAttempts ?? 1, 1), 5),
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.#jobs.set(job.id, job);
    await this.#persist();
    return structuredClone(job);
  }

  async cancel(id: string): Promise<BrowserJob> {
    const job = this.#require(id);
    if (job.state === "succeeded" || job.state === "failed") return structuredClone(job);
    job.state = "cancelled";
    job.updatedAt = nowIso();
    await this.#persist();
    return structuredClone(job);
  }

  async runNext(): Promise<BrowserJob | undefined> {
    if (this.#running) return undefined;
    const job = [...this.#jobs.values()].find((candidate) => candidate.state === "queued" || candidate.state === "paused");
    if (!job) return undefined;
    this.#running = true;
    job.state = "running";
    job.updatedAt = nowIso();
    await this.#persist();
    try {
      while (job.cursor < job.actions.length) {
        if (this.#require(job.id).state === "cancelled") break;
        const action = job.actions[job.cursor];
        if (!action) break;
        try {
          await this.execute(job.sessionId, action);
          job.cursor += 1;
          job.attempts = 0;
          delete job.lastError;
          job.updatedAt = nowIso();
          await this.#persist();
        } catch (error) {
          job.attempts += 1;
          job.lastError = error instanceof Error ? error.message : String(error);
          const retryable = action.kind === "snapshot"
            || action.kind === "wait"
            || action.kind === "extract"
            || action.kind === "extract.structured";
          if (!retryable || job.attempts >= job.maxAttempts) {
            job.state = "failed";
            job.updatedAt = nowIso();
            await this.#persist();
            break;
          }
        }
      }
      if (job.state === "running") job.state = "succeeded";
      job.updatedAt = nowIso();
      await this.#persist();
      return structuredClone(job);
    } finally {
      this.#running = false;
    }
  }

  #require(id: string): BrowserJob {
    const job = this.#jobs.get(id);
    if (!job) throw new CockroachBrowserError("JOB_NOT_FOUND", `Job ${id} was not found.`);
    return job;
  }

  async #persist(): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.list(), null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
