import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserRuntime } from "../src/runtime.js";
import { BrowserClient } from "../src/client.js";
import { startBrowserServer } from "../src/server.js";
import { TeamSessionStore } from "../src/team-sessions.js";
import type { SessionCreateInput, SessionSummary } from "../src/contracts.js";

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
    version: "0.5.0-rc.1",
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

test("rejects authentication-token collisions before accepting requests", async (t) => {
  const root = await temporaryDirectory(t);
  const shared = "s".repeat(32);
  await assert.rejects(
    startBrowserServer({
      runtime: fakeRuntime(root),
      port: 0,
      token: shared,
      actorTokens: { alice: shared },
      teamSessions: new TeamSessionStore(join(root, "admin-collision.json"))
    }),
    (error: unknown) => hasCode(error, "AUTH_TOKEN_COLLISION")
  );
  await assert.rejects(
    startBrowserServer({
      runtime: fakeRuntime(root),
      port: 0,
      token: "z".repeat(32),
      actorTokens: { alice: shared, bob: shared },
      teamSessions: new TeamSessionStore(join(root, "actor-collision.json"))
    }),
    (error: unknown) => hasCode(error, "AUTH_TOKEN_COLLISION")
  );
});

test("validates daemon session admission ceilings before initializing the runtime", async (t) => {
  let initialized = 0;
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    initialize: async () => { initialized += 1; }
  } as unknown as BrowserRuntime;
  await assert.rejects(
    startBrowserServer({ runtime, port: 0, token: "z".repeat(32), maxSessions: 0 }),
    (error: unknown) => hasCode(error, "MAX_SESSIONS_INVALID")
  );
  await assert.rejects(
    startBrowserServer({ runtime, port: 0, token: "z".repeat(32), maxSessionsPerActor: 1.5 }),
    (error: unknown) => hasCode(error, "MAX_SESSIONS_PER_ACTOR_INVALID")
  );
  await assert.rejects(
    startBrowserServer({ runtime, port: 0, token: "z".repeat(32), maxRequestBytes: Number.NaN }),
    (error: unknown) => hasCode(error, "MAX_REQUEST_BYTES_INVALID")
  );
  await assert.rejects(
    startBrowserServer({ runtime, port: 0, token: "z".repeat(32), maxRequestBytes: 1_024.5 }),
    (error: unknown) => hasCode(error, "MAX_REQUEST_BYTES_INVALID")
  );
  assert.equal(initialized, 0);
});

test("holds the global session slot while a browser creation is in flight", async (t) => {
  let launches = 0;
  let signalLaunch!: () => void;
  let finishLaunch!: () => void;
  const launchStarted = new Promise<void>((resolve) => { signalLaunch = resolve; });
  const launchGate = new Promise<void>((resolve) => { finishLaunch = resolve; });
  const runtime = {
    ...fakeRuntime(await temporaryDirectory(t)),
    sessions: async () => [],
    createSession: async (input: SessionCreateInput) => {
      launches += 1;
      signalLaunch();
      await launchGate;
      return resourceSession(input.id!, "within", true);
    }
  } as unknown as BrowserRuntime;
  const token = "z".repeat(32);
  const server = await startBrowserServer({ runtime, port: 0, token, maxSessions: 1 });
  t.after(() => server.close());

  const firstPending = sessionRequest(server.url, token);
  await launchStarted;
  const denied = await sessionRequest(server.url, token);
  assert.equal(denied.status, 429);
  const deniedError = (await denied.json() as { error: { code: string; message: string } }).error;
  assert.equal(deniedError.code, "SESSION_GLOBAL_LIMIT_EXCEEDED");
  assert.equal(deniedError.message, "The browser daemon has reached its configured 1-session ceiling.");
  assert.equal(launches, 1);

  finishLaunch();
  const first = await firstPending;
  assert.equal(first.status, 201);
  assert.equal(launches, 1);
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

test("keeps global health, metrics, and evidence verification administrator-only", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  await teamSessions.initialize();
  await teamSessions.claim("session-alice", "alice");
  await teamSessions.claim("session-bob", "bob");
  let sessionReads = 0;
  let activityReads = 0;
  let evidenceVerifications = 0;
  const verification = {
    ok: false,
    records: 2,
    bytes: 321,
    receiptHead: "private-receipt-head",
    failures: ["evidence-bob: digest mismatch"]
  };
  const runtime = {
    ...fakeRuntime(root),
    sessions: async () => {
      sessionReads += 1;
      return [
        { ...resourceSession("session-alice", "within", true), actor: "alice" },
        { ...resourceSession("session-bob", "within", true), actor: "bob" }
      ];
    },
    activities: () => {
      activityReads += 1;
      return [];
    },
    evidence: {
      list: () => [],
      verify: async () => {
        evidenceVerifications += 1;
        return verification;
      }
    }
  } as unknown as BrowserRuntime;
  const adminToken = "z".repeat(32);
  const actorToken = "a".repeat(32);
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: adminToken,
    actorTokens: { alice: actorToken },
    teamSessions
  });
  t.after(() => server.close());

  for (const [path, code] of [
    ["/v1/health", "SERVER_DIAGNOSTICS_ADMIN_REQUIRED"],
    ["/v1/metrics", "SERVER_DIAGNOSTICS_ADMIN_REQUIRED"],
    ["/v1/evidence/verify", "EVIDENCE_VERIFY_ADMIN_REQUIRED"]
  ] as const) {
    const response = await fetch(`${server.url}${path}`, {
      headers: { authorization: `Bearer ${actorToken}` }
    });
    const body = await response.text();
    assert.equal(response.status, 403, path);
    assert.equal((JSON.parse(body) as { error: { code: string } }).error.code, code, path);
    assert.doesNotMatch(body, /session-bob|private-receipt-head|evidence-bob/, path);
  }
  assert.equal(sessionReads, 0);
  assert.equal(activityReads, 0);
  assert.equal(evidenceVerifications, 0);

  const headers = { authorization: `Bearer ${adminToken}` };
  const health = await fetch(`${server.url}/v1/health`, { headers });
  assert.equal(health.status, 200);
  const healthBody = await health.json() as { sessions: number; evidence: typeof verification };
  assert.equal(healthBody.sessions, 2);
  assert.deepEqual(healthBody.evidence, verification);

  const metrics = await fetch(`${server.url}/v1/metrics`, { headers });
  assert.equal(metrics.status, 200);
  assert.match(await metrics.text(), /cockroach_browser_sessions 2(?:\r?\n|$)/);

  const verified = await fetch(`${server.url}/v1/evidence/verify`, { headers });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), verification);
  assert.equal(sessionReads, 2);
  assert.equal(activityReads, 1);
  assert.equal(evidenceVerifications, 2);
});

test("filters action errors by persistent team-session grants while administrators retain full visibility", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  await teamSessions.initialize();
  await teamSessions.claim("session-a", "alice");
  await teamSessions.claim("session-b", "bob");
  const occurredAt = "2026-09-02T00:00:00.000Z";
  const runtime = {
    ...fakeRuntime(root),
    activities: () => [
      {
        id: "error-a",
        type: "browser.action.completed",
        occurredAt,
        sessionId: "session-a",
        actor: "alice",
        purpose: "Alice failure",
        metadata: { status: "failed" }
      },
      {
        id: "error-b",
        type: "browser.action.completed",
        occurredAt,
        sessionId: "session-b",
        actor: "bob",
        purpose: "Bob failure",
        metadata: { status: "denied" }
      },
      {
        id: "error-unclaimed",
        type: "browser.action.completed",
        occurredAt,
        sessionId: "session-unclaimed",
        purpose: "Administrator-only failure",
        metadata: { status: "failed" }
      },
      {
        id: "success-a",
        type: "browser.action.completed",
        occurredAt,
        sessionId: "session-a",
        actor: "alice",
        purpose: "Successful action",
        metadata: { status: "succeeded" }
      }
    ]
  } as unknown as BrowserRuntime;
  const adminToken = "z".repeat(32);
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: adminToken,
    actorTokens: { alice: "a".repeat(32), bob: "b".repeat(32) },
    teamSessions
  });
  t.after(() => server.close());

  const errorIds = async (token: string): Promise<string[]> => {
    const response = await fetch(`${server.url}/v1/errors`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    return (await response.json() as { errors: Array<{ id: string }> }).errors.map((entry) => entry.id);
  };

  assert.deepEqual(await errorIds("a".repeat(32)), ["error-a"]);
  assert.deepEqual(await errorIds("b".repeat(32)), ["error-b"]);
  assert.deepEqual(await errorIds(adminToken), ["error-a", "error-b", "error-unclaimed"]);
});

test("actor tokens cannot mint browser authority without a host-owned session factory", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  let created = 0;
  const runtime = {
    ...fakeRuntime(root),
    createSession: async () => {
      created += 1;
      throw new Error("must not run");
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: "z".repeat(32),
    actorTokens: { alice: "a".repeat(32) },
    teamSessions
  });
  t.after(() => server.close());

  const response = await fetch(`${server.url}/v1/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"a".repeat(32)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      purpose: "Reach an actor-selected private service",
      startUrl: "http://127.0.0.1:9000/",
      policy: { allowedOrigins: ["http://127.0.0.1:9000"], allowPrivateNetwork: true }
    })
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "SESSION_CREATE_UNAUTHORIZED");
  assert.equal(created, 0);
});

test("actor session factories replace requests with host-authored authority", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  let admitted: SessionCreateInput | undefined;
  const runtime = {
    ...fakeRuntime(root),
    createSession: async (input: SessionCreateInput) => {
      admitted = structuredClone(input);
      return resourceSession("session-actor", "within", true);
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: "z".repeat(32),
    actorTokens: { alice: "a".repeat(32) },
    teamSessions,
    actorSessionFactory: ({ actor }) => ({
      actor,
      purpose: "Host-approved documentation session",
      startUrl: "https://example.com/",
      policy: {
        allowedOrigins: ["https://example.com"],
        allowedActions: ["snapshot", "extract.structured"],
        allowedEffects: ["read"]
      }
    })
  });
  t.after(() => server.close());

  const response = await fetch(`${server.url}/v1/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"a".repeat(32)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: "forged",
      purpose: "Untrusted request",
      startUrl: "http://127.0.0.1:9000/",
      policy: { allowedOrigins: ["http://127.0.0.1:9000"], allowPrivateNetwork: true }
    })
  });
  assert.equal(response.status, 201);
  assert.equal(admitted?.actor, "alice");
  assert.equal(admitted?.startUrl, "https://example.com/");
  assert.deepEqual(admitted?.policy.allowedActions, ["snapshot", "extract.structured"]);
  assert.equal(admitted?.policy.allowPrivateNetwork, undefined);
  assert.equal((await teamSessions.get("session-actor"))?.owner, "alice");
});

test("enforces actor session ceilings independently and ignores closed sessions", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  const current = [
    { ...resourceSession("session-alice-active", "within", true), actor: "alice" },
    { ...resourceSession("session-alice-closed", "within", true), actor: "alice", state: "closed" as const }
  ];
  const created: SessionCreateInput[] = [];
  const runtime = {
    ...fakeRuntime(root),
    sessions: async () => current,
    createSession: async (input: SessionCreateInput) => {
      created.push(structuredClone(input));
      return { ...resourceSession(input.id!, "within", true), actor: input.actor };
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: "z".repeat(32),
    actorTokens: { alice: "a".repeat(32), bob: "b".repeat(32) },
    teamSessions,
    maxSessions: 2,
    maxSessionsPerActor: 1,
    actorSessionFactory: ({ actor }) => ({
      id: `session-${actor}-new`,
      actor,
      purpose: "Host-approved bounded session",
      policy: { allowedOrigins: ["https://example.com"], allowedActions: ["snapshot"], allowedEffects: ["read"] }
    })
  });
  t.after(() => server.close());

  const alice = await sessionRequest(server.url, "a".repeat(32));
  assert.equal(alice.status, 429);
  const aliceError = (await alice.json() as { error: { code: string; message: string } }).error;
  assert.equal(aliceError.code, "SESSION_ACTOR_LIMIT_EXCEEDED");
  assert.equal(aliceError.message, "Actor alice has reached the configured 1-session ceiling.");

  const bob = await sessionRequest(server.url, "b".repeat(32));
  assert.equal(bob.status, 201);
  assert.deepEqual(created.map((input) => input.actor), ["bob"]);
  assert.equal((await teamSessions.get("session-bob-new"))?.owner, "bob");
});

test("rolls back a newly created session when an explicit reused ID cannot be claimed", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  await teamSessions.initialize();
  await teamSessions.claim("session-reused", "bob");
  const liveSessions = new Set<string>();
  const closedSessions: string[] = [];
  const runtime = {
    ...fakeRuntime(root),
    createSession: async (input: SessionCreateInput) => {
      const id = input.id ?? "unexpected-generated-id";
      liveSessions.add(id);
      return resourceSession(id, "within", true);
    },
    closeSession: async (id: string) => {
      closedSessions.push(id);
      liveSessions.delete(id);
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: "z".repeat(32),
    actorTokens: { alice: "a".repeat(32), bob: "b".repeat(32) },
    teamSessions,
    actorSessionFactory: ({ actor }) => ({
      id: "session-reused",
      actor,
      purpose: "Host-approved session with an explicit identifier",
      startUrl: "https://example.com/",
      policy: { allowedOrigins: ["https://example.com"], allowedActions: ["snapshot"], allowedEffects: ["read"] }
    })
  });
  t.after(() => server.close());

  const response = await fetch(`${server.url}/v1/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"a".repeat(32)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ purpose: "Request one host-approved session", policy: { allowedOrigins: ["https://example.com"] } })
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "SESSION_ACCESS_EXISTS");
  assert.deepEqual(closedSessions, ["session-reused"]);
  assert.equal(liveSessions.has("session-reused"), false);
  assert.equal((await teamSessions.get("session-reused"))?.owner, "bob");
});

test("deleting a session releases its access record only after the browser closes successfully", async (t) => {
  const root = await temporaryDirectory(t);
  const teamSessions = new TeamSessionStore(join(root, "team-sessions.json"));
  await teamSessions.initialize();
  await teamSessions.claim("session-close-ok", "alice");
  await teamSessions.claim("session-close-fails", "alice");
  const closedSessions: string[] = [];
  const runtime = {
    ...fakeRuntime(root),
    closeSession: async (id: string) => {
      if (id === "session-close-fails") throw new Error("browser close failed");
      closedSessions.push(id);
    }
  } as unknown as BrowserRuntime;
  const server = await startBrowserServer({
    runtime,
    port: 0,
    token: "z".repeat(32),
    actorTokens: { alice: "a".repeat(32) },
    teamSessions
  });
  t.after(() => server.close());
  const headers = { authorization: `Bearer ${"a".repeat(32)}` };

  const closed = await fetch(`${server.url}/v1/sessions/session-close-ok`, { method: "DELETE", headers });
  assert.equal(closed.status, 200);
  assert.deepEqual(closedSessions, ["session-close-ok"]);
  assert.equal(await teamSessions.get("session-close-ok"), undefined);

  const failed = await fetch(`${server.url}/v1/sessions/session-close-fails`, { method: "DELETE", headers });
  assert.equal(failed.status, 500);
  assert.equal((await failed.json() as { error: { code: string } }).error.code, "INTERNAL_ERROR");
  assert.equal((await teamSessions.get("session-close-fails"))?.owner, "alice");
});

test("actor tokens require a persistent team-session access store", async (t) => {
  await assert.rejects(
    startBrowserServer({
      runtime: fakeRuntime(await temporaryDirectory(t)),
      port: 0,
      token: "z".repeat(32),
      actorTokens: { alice: "a".repeat(32) }
    }),
    (error: unknown) => hasCode(error, "ACTOR_SESSION_STORE_REQUIRED")
  );
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

function sessionRequest(baseUrl: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      purpose: "Create one bounded test session",
      policy: { allowedOrigins: ["https://example.com"] }
    })
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
    provider: { kind: "bundled", ownership: "runtime-owned", maturity: "supported" },
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
