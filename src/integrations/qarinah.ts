import type { ActionReceipt, ContextRecorder } from "../contracts.js";
import { sha256 } from "../canonical.js";
import type {
  BrowserAgentContextPack,
  BrowserAgentContextProvider
} from "../agent.js";

export interface QarinahBrowserSink {
  appendBrowserOutcome(event: {
    schemaVersion: "cockroach.browser-memory.v2";
    type: string;
    sessionId: string;
    actor?: string;
    purposeDigest: string;
    timestamp: string;
    inputDigest?: string;
    outputDigest?: string;
    evidenceIds: string[];
    receiptHash?: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface QarinahBrowserMemorySource {
  retrieveBrowserContext(input: {
    sessionId: string;
    query: string;
    maxChars: number;
    limit: number;
    signal?: AbortSignal;
  }): Promise<BrowserAgentContextPack | undefined>;
}

/**
 * Adapts a Qarinah browser-memory query to the agent's bounded cited-context
 * boundary. The agent labels the returned pack as historical evidence rather
 * than executable instructions.
 */
export function createQarinahAgentContextProvider(
  source: QarinahBrowserMemorySource,
  options: { limit?: number } = {}
): BrowserAgentContextProvider {
  const limit = options.limit ?? 24;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
    throw new RangeError("Qarinah browser context limits must be between 1 and 128.");
  }
  return {
    retrieve(input) {
      return source.retrieveBrowserContext({
        sessionId: input.sessionId,
        query: input.task,
        maxChars: input.maxChars,
        limit,
        ...(input.signal ? { signal: input.signal } : {})
      });
    }
  };
}

/**
 * Converts browser outcomes to a metadata-only Qarinah capture surface.
 * It never records raw purposes, cookies, storage values, form values, hidden reasoning, or profile data.
 */
export function createQarinahContextRecorder(sink: QarinahBrowserSink): ContextRecorder {
  return {
    async record(event) {
      await sink.appendBrowserOutcome({
        schemaVersion: "cockroach.browser-memory.v2",
        type: event.type,
        sessionId: event.sessionId,
        ...(event.actor ? { actor: event.actor } : {}),
        purposeDigest: sha256(event.purpose),
        timestamp: event.timestamp,
        ...(event.inputDigest ? { inputDigest: event.inputDigest } : {}),
        ...(event.outputDigest ? { outputDigest: event.outputDigest } : {}),
        evidenceIds: [...(event.evidenceIds ?? [])],
        ...(event.receiptHash ? { receiptHash: event.receiptHash } : {}),
        metadata: redactMetadata(event.metadata ?? {})
      });
    }
  };
}

export function receiptToQarinahMetadata(receipt: ActionReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.id,
    action: receipt.action,
    effect: receipt.effect,
    risk: receipt.risk,
    status: receipt.status,
    inputDigest: receipt.inputDigest,
    outputDigest: receipt.outputDigest,
    policyDigest: receipt.policyDigest,
    receiptHash: receipt.receiptHash,
    evidenceIds: [...receipt.evidenceIds],
    completedAt: receipt.completedAt
  };
}

function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!QARINAH_METADATA_KEYS.has(key) || isSensitiveKey(key)) continue;
    safe[key] = redactValue(value, 0, new WeakSet<object>());
  }
  return safe;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= 8) return "[depth-limit]";
  if (typeof value === "string") return value.slice(0, 4_096);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 256).map((entry) => redactValue(entry, depth + 1, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[cycle]";
    seen.add(value);
    const safe: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 128)) {
      if (isSensitiveKey(key)) continue;
      safe[key] = redactValue(nested, depth + 1, seen);
    }
    seen.delete(value);
    return safe;
  }
  return String(value).slice(0, 1_024);
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|credential|password|passphrase|secret|token|storage|formvalue|api[-_]?key/i.test(key);
}

const QARINAH_METADATA_KEYS = new Set([
  "action",
  "status",
  "inputDigest",
  "outputDigest",
  "receiptHash",
  "receiptId",
  "evidenceIds",
  "policyDigest",
  "mode",
  "effect",
  "risk",
  "completedAt"
]);
