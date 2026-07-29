import { createQarinahContextRecorder } from "cockroach-browser/qarinah";

export function attachCockroachBrowserToQarinah({
  appendBrowserOutcome,
  writeEvent
}) {
  const persistOutcome = appendBrowserOutcome ?? writeEvent;

  if (typeof persistOutcome !== "function") {
    throw new TypeError(
      "Provide an appendBrowserOutcome(event) or writeEvent(event) callback"
    );
  }

  return createQarinahContextRecorder({
    async appendBrowserOutcome(event) {
      await persistOutcome(event);
    }
  });
}

// The host owns persistence. Connect this callback to the Qarinah sink or
// event-writer API supported by the installed Qarinah release. The recorder
// accepts outcomes only, exposes no dispatch surface, and recursively removes
// secret-bearing metadata before calling the host.
