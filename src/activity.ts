import { EventEmitter } from "node:events";
import type { ActivityDetail, BrowserActivityQuery, BrowserLifecycleEvent } from "./contracts.js";

export interface ActivityLedgerOptions {
  detail?: ActivityDetail;
  maxEntries?: number;
}

export class ActivityLedger {
  readonly detail: ActivityDetail;
  readonly maxEntries: number;
  #entries: BrowserLifecycleEvent[] = [];
  #events = new EventEmitter();

  constructor(options: ActivityLedgerOptions = {}) {
    this.detail = options.detail ?? "summary";
    this.maxEntries = Math.min(Math.max(options.maxEntries ?? 2_000, 100), 50_000);
  }

  append(event: BrowserLifecycleEvent): void {
    if (this.detail === "off") return;
    const safe = this.detail === "summary" ? summarize(event) : structuredClone(event);
    this.#entries.push(safe);
    while (this.#entries.length > this.maxEntries) this.#entries.shift();
    this.#events.emit("event", structuredClone(safe));
  }

  list(query: BrowserActivityQuery = {}): BrowserLifecycleEvent[] {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2_000);
    const after = query.after ? Date.parse(query.after) : Number.NEGATIVE_INFINITY;
    return this.#entries
      .filter((entry) => (!query.sessionId || entry.sessionId === query.sessionId) && Date.parse(entry.occurredAt) > after)
      .slice(-limit)
      .map((entry) => structuredClone(entry));
  }

  subscribe(listener: (event: BrowserLifecycleEvent) => void): () => void {
    this.#events.on("event", listener);
    return () => this.#events.off("event", listener);
  }
}

function summarize(event: BrowserLifecycleEvent): BrowserLifecycleEvent {
  const metadata = event.metadata ?? {};
  const allowed = ["action", "effect", "risk", "status", "errorCode", "kind", "evidenceId", "size", "actionsUsed", "evidenceBytes"];
  const summary = Object.fromEntries(allowed.filter((key) => key in metadata).map((key) => [key, metadata[key]]));
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    sessionId: event.sessionId,
    ...(event.actor ? { actor: event.actor } : {}),
    purpose: event.purpose,
    ...(event.receiptHash ? { receiptHash: event.receiptHash } : {}),
    ...(event.evidenceIds?.length ? { evidenceIds: [...event.evidenceIds] } : {}),
    ...(Object.keys(summary).length ? { metadata: summary } : {})
  };
}
