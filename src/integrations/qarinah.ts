import type { ActionReceipt, ContextRecorder } from "../contracts.js";

export interface QarinahBrowserSink {
  appendBrowserOutcome(event: {
    schemaVersion: "cockroach.browser-memory.v1";
    type: string;
    sessionId: string;
    actor?: string;
    purpose: string;
    timestamp: string;
    inputDigest?: string;
    outputDigest?: string;
    evidenceIds: string[];
    receiptHash?: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Converts browser outcomes to a metadata-only Qarinah capture surface.
 * It never records cookies, storage values, form values, hidden reasoning, or profile data.
 */
export function createQarinahContextRecorder(sink: QarinahBrowserSink): ContextRecorder {
  return {
    async record(event) {
      await sink.appendBrowserOutcome({
        schemaVersion: "cockroach.browser-memory.v1",
        type: event.type,
        sessionId: event.sessionId,
        ...(event.actor ? { actor: event.actor } : {}),
        purpose: event.purpose,
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
  "profile",
  "effect",
  "risk",
  "completedAt"
]);
