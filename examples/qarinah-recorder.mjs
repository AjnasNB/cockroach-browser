import { createQarinahContextRecorder } from "cockroach-browser/qarinah";

export function attachCockroachBrowserToQarinah(qarinahWorkspace) {
  return createQarinahContextRecorder({
    async appendBrowserOutcome(event) {
      await qarinahWorkspace.append({
        type: event.type,
        source: "cockroach-browser",
        timestamp: event.timestamp,
        citations: event.evidenceIds,
        metadata: event
      });
    }
  });
}

// The recorder accepts outcomes only. It does not provide a dispatch surface
// and recursively removes secret-bearing metadata before it reaches Qarinah.
