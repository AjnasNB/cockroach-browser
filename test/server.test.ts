import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserRuntime } from "../src/runtime.js";
import { BrowserClient } from "../src/client.js";
import { startBrowserServer } from "../src/server.js";
import { TeamSessionStore } from "../src/team-sessions.js";
import type { SessionSummary } from "../src/contracts.js";

test("binds to loopback by default and rejects unauthenticated requests", async (t) => {
  const root = await temporaryDirectory(t);
  let closed = false;
  const runtime = fakeRuntime(root, () => {
    closed = true;
  });
  const token = "a".repeat(32);
  const server = await startBrowserServer({ runtime, port: 0, token });
  let serverClosed = false;
  t.after(async () => {
    if (!serverClosed) await server.close();
  });

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(server.dashboardUrl, `${server.url}/dashboard/`);
  const denied = await fetch(`${server.url}/v1/health`);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal(denied.headers.get("x-content-type-options"), "nosniff");

  const allowed = await fetch(`${server.url}/v1/health`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), {
    ok: true,
    name: "cockroach-browser",
    version: "0.4.1",
    sessions: 0,
    evidence: { ok: true, records: 0, bytes: 0, failures: [] }
  });

  await server.close();
  serverClosed = true;
  assert.equal(closed, true);
});

test("serves the packaged dashboard without weakening API authentication", async (t) => {
  const root = await temporaryDirectory(t);
  const token = "d".repeat(32);
  const server = await startBrowserServer({ runtime: fakeRuntime(root), port: 0, token });
  t.after(() => server.close());

  const redirect = await fetch(`${server.url}/dashboard`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/dashboard/");

  const page = await fetch(server.dashboardUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  assert.match(await page.text(), /Cockroach Browser Control Room/);

  for (const path of ["app.js", "styles.css", "assets/logo.png"]) {
    const asset = await fetch(`${server.dashboardUrl}${path}`);
    assert.equal(asset.status, 200, path);
    assert.ok(Number(asset.headers.get("content-length")) > 0, path);
  }

  const head = await fetch(`${server.dashboardUrl}app.js`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const unknown = await fetch(`${server.dashboardUrl}../package.json`);
  assert.equal(unknown.status, 401);

  const missing = await fetch(`${server.dashboardUrl}missing.js`);
  assert.equal(missing.status, 404);

  const stillProtected = await fetch(`${server.url}/v1/health`);
  assert.equal(stillProtected.status, 401);
});

test("exports aggregate resource gauges without session-identifying labels", async (t) => {
  const sessions = [
    resourceSession("private-session-a", "within", true, 100, 2_500, 2),
    resourceSession("private-session-b", "exceeded", true, 300, 1_500, 3),
    resourceSession("private-session-c", "unavailable", false)
  ];
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    sessions: async () => sessions,
    activities: () => []
  } as unknown as BrowserRuntime;
  const token = "m".repeat(32);
  const server = await startBrowserServer({ runtime, port: 0, token });
  t.after(() => server.close());

  const response = await fetch(`${server.url}/v1/metrics`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain; version=0\.0\.4/);
  assert.match(body, /cockroach_browser_resource_rss_bytes 400(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_cpu_time_seconds 4(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_processes 5(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_rss_limit_bytes 2000(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_cpu_time_limit_seconds 20(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_sampled_sessions 2(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_unavailable_sessions 1(?:\r?\n|$)/);
  assert.match(body, /cockroach_browser_resource_limit_exceeded_sessions 1(?:\r?\n|$)/);
  assert.doesNotMatch(body, /private-session|secret purpose/);
  for (const name of body.matchAll(/^# TYPE (cockroach_browser_resource_\S+) (\S+)$/gm)) {
    assert.equal(name[2], "gauge", name[1]);
  }
});

test("exposes a fresh per-session resource sample through the client", async (t) => {
  const expected = resourceSession("session-a", "within", true, 500, 2_000, 4).resources;
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    resourceUsage: async () => expected
  } as unknown as BrowserRuntime;
  const token = "u".repeat(32);
  const server = await startBrowserServer({ runtime, port: 0, token });
  t.after(() => server.close());

  const client = new BrowserClient({ baseUrl: server.url, token });
  assert.deepEqual(await client.resourceUsage("session-a"), expected);
});

test("requires a strong bearer token", async (t) => {
  const root = await temporaryDirectory(t);
  await assert.rejects(
    startBrowserServer({ runtime: fakeRuntime(root), port: 0, token: "short" }),
    (error: unknown) => hasCode(error, "WEAK_SERVER_TOKEN")
  );
});

test("disables raw action dispatch by default and requires an explicit host opt-in", async (t) => {
  const token = "r".repeat(32);
  let dispatched = 0;
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    act: async () => {
      dispatched += 1;
      return { status: "succeeded" };
    }
  } as unknown as BrowserRuntime;

  const guarded = await startBrowserServer({ runtime, port: 0, token });
  t.after(() => guarded.close());
  const denied = await actionRequest(guarded.url, token);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { error: { code: string } }).error.code, "DIRECT_ACTION_DISABLED");
  assert.equal(dispatched, 0);

  const explicit = await startBrowserServer({
    runtime,
    port: 0,
    token,
    allowRawActions: true
  });
  t.after(() => explicit.close());
  const allowed = await actionRequest(explicit.url, token);
  assert.equal(allowed.status, 200);
  assert.equal(dispatched, 1);
});

test("exposes only typed read-only capture and network routes without enabling raw actions", async (t) => {
  const token = "o".repeat(32);
  const actions: Array<{ kind: string; purpose: string; outputFormat?: string }> = [];
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    act: async (_sessionId: string, action: { kind: string; purpose: string; outputFormat?: string }) => {
      actions.push(structuredClone(action));
      return {
        output: { kind: action.kind },
        receipt: { id: `receipt-${actions.length}` }
      };
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({ runtime, port: 0, token });
  t.after(() => server.close());
  const client = new BrowserClient({ baseUrl: server.url, token });

  await client.capture("session-a", { includeBounds: true });
  await client.network("session-a", { method: "GET", limit: 10 });
  await client.exportNetwork("session-a", { outputFormat: "har" });

  assert.deepEqual(
    actions.map((action) => action.kind),
    ["capture.paired", "network.inspect", "network.export"]
  );
  assert.equal(actions[0]?.purpose, "Capture paired visual and semantic evidence");
  assert.equal(actions[2]?.outputFormat, "har");
});

test("exposes the durable local job API only after explicit execution opt-in", async (t) => {
  const token = "j".repeat(32);
  const executed: string[] = [];
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    act: async (_sessionId: string, action: { kind: string }) => {
      executed.push(action.kind);
      return { status: "succeeded" };
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({ runtime, port: 0, token, enableJobs: true, allowRawActions: true });
  t.after(() => server.close());
  const client = new BrowserClient({ baseUrl: server.url, token });

  const queued = await client.enqueueJob({
    sessionId: "session-a",
    purpose: "Run the reviewed local plan",
    actions: [{ kind: "snapshot", purpose: "Record the current page" }]
  });
  assert.equal(queued.state, "queued");

  let completed = await client.job(queued.id);
  for (let attempt = 0; attempt < 20 && completed.state !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed = await client.job(queued.id);
  }
  assert.equal(completed.state, "succeeded");
  assert.deepEqual(executed, ["snapshot"]);
  assert.equal((await client.jobs()).length, 1);
});

test("filters evidence by persistent team-session grants", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  await teamSessions.initialize();
  await teamSessions.claim("session-a", "alice");
  const runtime = {
    ...fakeRuntime(root),
    evidence: {
      verify: async () => ({ ok: true, records: 2, bytes: 0, failures: [] }),
      list: (sessionId?: string) => [
        { id: "evidence-a", sessionId: "session-a", kind: "snapshot" },
        { id: "evidence-b", sessionId: "session-b", kind: "snapshot" }
      ].filter((record) => !sessionId || record.sessionId === sessionId)
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: "z".repeat(32),
    actorTokens: { alice: "a".repeat(32), bob: "b".repeat(32) },
    teamSessions
  });
  t.after(() => server.close());

  const alice = await fetch(`${server.url}/v1/evidence`, { headers: { authorization: `Bearer ${"a".repeat(32)}` } });
  assert.equal(alice.status, 200);
  assert.deepEqual((await alice.json() as { evidence: Array<{ id: string }> }).evidence.map((record) => record.id), ["evidence-a"]);

  const bob = await fetch(`${server.url}/v1/evidence`, { headers: { authorization: `Bearer ${"b".repeat(32)}` } });
  assert.equal(bob.status, 200);
  assert.deepEqual((await bob.json() as { evidence: unknown[] }).evidence, []);
});

test("refuses a non-loopback listener without explicit remote mode and TLS", async () => {
  await assert.rejects(
    startBrowserServer({ host: "0.0.0.0", port: 0 }),
    (error: unknown) => hasCode(error, "REMOTE_BINDING_DENIED")
  );
  await assert.rejects(
    startBrowserServer({ host: "0.0.0.0", port: 0, allowRemote: true }),
    (error: unknown) => hasCode(error, "REMOTE_TLS_REQUIRED")
  );
});

function actionRequest(baseUrl: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/sessions/session-a/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ kind: "snapshot", purpose: "Verify the reviewed page" })
  });
}

function fakeRuntime(root: string, onClose: () => void = () => undefined): BrowserRuntime {
  return {
    root,
    initialize: async () => undefined,
    sessions: async () => [],
    evidence: {
      verify: async () => ({ ok: true, records: 0, bytes: 0, failures: [] }),
      list: () => []
    },
    close: async () => onClose()
  } as unknown as BrowserRuntime;
}

function resourceSession(
  id: string,
  limitState: "within" | "exceeded" | "unavailable",
  available: boolean,
  rssBytes = 0,
  cpuTimeMs = 0,
  processCount = 0
): SessionSummary {
  return {
    id,
    state: "ready",
    mode: "headless",
    engine: "chromium",
    performanceProfile: "balanced",
    purpose: "secret purpose",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    actionsUsed: 0,
    budget: {
      maxActions: 1,
      maxDurationMs: 1,
      maxTabs: 1,
      maxProcessRssBytes: 1_000,
      maxProcessCpuTimeMs: 10_000,
      maxDownloadBytes: 1,
      maxUploadBytes: 1,
      maxSnapshotChars: 1,
      maxEvidenceBytes: 1,
      maxHistoryEntries: 1,
      maxNetworkEntries: 1,
      maxClipboardBytes: 1,
      maxSavedStates: 1,
      maxNetworkRules: 1,
      maxRouteFulfillBytes: 1,
      maxInterceptedBytes: 1
    },
    resources: {
      ownership: available ? "runtime-owned" : "external",
      available,
      limitState,
      maxProcessRssBytes: 1_000,
      maxProcessCpuTimeMs: 10_000,
      ...(available ? { rssBytes, cpuTimeMs, processCount } : { reason: "customer owned" })
    },
    tabs: []
  };
}

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-server-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}
