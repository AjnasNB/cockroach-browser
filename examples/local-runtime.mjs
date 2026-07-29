import { BrowserRuntime } from "cockroach-browser";

const runtime = new BrowserRuntime({ root: ".cockroach-browser" });
await runtime.initialize();

try {
  const session = await runtime.createSession({
    purpose: "Inspect a public page",
    startUrl: "https://example.com/",
    policy: {
      allowedOrigins: ["https://example.com"],
      allowedActions: ["snapshot", "extract", "screenshot"],
      allowedEffects: ["read"],
      requireApprovalFor: [],
      budget: {
        maxActions: 10,
        maxDurationMs: 120000,
        maxTabs: 1,
        maxEvidenceBytes: 8388608
      }
    }
  });
  const snapshot = await runtime.snapshot(session.id);
  console.log({
    sessionId: session.id,
    title: snapshot.title,
    url: snapshot.url,
    references: snapshot.refs.length,
    revision: snapshot.digest
  });
} finally {
  await runtime.close();
}
