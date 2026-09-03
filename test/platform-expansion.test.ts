import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserAgent } from "../src/agent.js";
import { BidiSession } from "../src/bidi.js";
import { OpenAICompatibleModelGateway, type ModelGateway } from "../src/model-gateway.js";
import { createQarinahAgentContextProvider } from "../src/integrations/qarinah.js";
import { WebDriverClient } from "../src/mobile.js";
import { BrowserFleet, HttpBrowserFleetProvider, type BrowserFleetProvider } from "../src/fleet.js";
import { createRawCdpSession } from "../src/cdp.js";
import puppeteer, { launch as puppeteerLaunch } from "../src/puppeteer.js";
import { expect as playwrightExpect, test as playwrightTest } from "../src/test.js";
import {
  RAW_BROWSER_ENGINES,
  chromium,
  firefox,
  rawBrowserType,
  webkit
} from "../src/raw-automation.js";
import { BrowserRuntime } from "../src/runtime.js";

test("raw automation exposes all Playwright engines and the pinned Puppeteer surface", () => {
  assert.deepEqual(RAW_BROWSER_ENGINES, ["chromium", "firefox", "webkit"]);
  assert.equal(rawBrowserType("chromium"), chromium);
  assert.equal(rawBrowserType("firefox"), firefox);
  assert.equal(rawBrowserType("webkit"), webkit);
  assert.equal(typeof puppeteer.launch, "function");
  assert.equal(puppeteerLaunch, puppeteer.launch);
  assert.equal(typeof playwrightTest, "function");
  assert.equal(typeof playwrightExpect, "function");
  assert.equal(typeof createRawCdpSession, "function");
});

test(
  "bounded runtime launches Chromium, Firefox, and WebKit with the same intercepted HTTP(S) origin policy",
  { skip: process.env.COCKROACH_BROWSER_MULTI_ENGINE_E2E !== "1", timeout: 120_000 },
  async (t) => {
    const fixture = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=en><title>Three engine fixture</title><body>ready</body></html>");
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const engine of RAW_BROWSER_ENGINES) {
      const root = await mkdtemp(join(tmpdir(), `cockroach-browser-${engine}-`));
      const runtime = new BrowserRuntime({ root });
      try {
        const session = await runtime.createSession({
          engine,
          startUrl: origin,
          purpose: `Verify the bounded ${engine} runtime`,
          policy: {
            allowedOrigins: [origin],
            allowPrivateNetwork: true,
            allowedActions: ["snapshot"]
          }
        });
        assert.equal(session.engine, engine);
        assert.equal(session.tabs.length, 1);
        assert.equal(session.resources.available, true);
        assert.equal(session.resources.ownership, "runtime-owned");
        assert.equal((session.resources.processCount ?? 0) > 0, true);
        assert.equal((session.resources.rssBytes ?? 0) > 0, true);
        const snapshot = await runtime.snapshot(session.id);
        assert.equal(snapshot.title, "Three engine fixture");
        assert.match(snapshot.text, /ready/);
      } finally {
        await runtime.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  }
);

test(
  "lean runtime blocks heavy page assets across Chromium, Firefox, and WebKit",
  { skip: process.env.COCKROACH_BROWSER_MULTI_ENGINE_E2E !== "1", timeout: 120_000 },
  async (t) => {
    const heavyRequests = { image: 0, media: 0, font: 0 };
    const fixture = createServer((request, response) => {
      if (request.url === "/large.png") {
        heavyRequests.image += 1;
        response.writeHead(200, { "content-type": "image/png" });
        response.end(Buffer.alloc(64 * 1024));
        return;
      }
      if (request.url === "/large.mp4") {
        heavyRequests.media += 1;
        response.writeHead(200, { "content-type": "video/mp4" });
        response.end(Buffer.alloc(64 * 1024));
        return;
      }
      if (request.url === "/large.woff2") {
        heavyRequests.font += 1;
        response.writeHead(200, { "content-type": "font/woff2" });
        response.end(Buffer.alloc(64 * 1024));
        return;
      }
      if (request.url === "/lean.css") {
        response.writeHead(200, { "content-type": "text/css" });
        response.end("@font-face{font-family:lean;src:url('/large.woff2')}body{font-family:lean,sans-serif}");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=en><head><title>Lean fixture</title><link rel=stylesheet href=/lean.css></head><body>ready<img src=/large.png><video preload=metadata src=/large.mp4></video></body></html>");
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const engine of RAW_BROWSER_ENGINES) {
      const root = await mkdtemp(join(tmpdir(), `cockroach-browser-lean-${engine}-`));
      const runtime = new BrowserRuntime({ root });
      try {
        const session = await runtime.createSession({
          engine,
          performanceProfile: "lean",
          startUrl: origin,
          purpose: `Verify lean ${engine}`,
          policy: {
            allowedOrigins: [origin],
            allowPrivateNetwork: true,
            allowedActions: ["snapshot"]
          }
        });
        assert.equal(session.performanceProfile, "lean");
        const snapshot = await runtime.snapshot(session.id);
        assert.match(snapshot.text, /ready/);
        const audit = await runtime.audit(session.id, ["performance", "assets"]);
        const performance = audit.report.performance as { transferBytes: number };
        assert.equal(performance.transferBytes < 64 * 1024, true);
        assert.match(JSON.stringify(audit.report.assets), /large\.mp4/);
      } finally {
        await runtime.close();
        await rm(root, { recursive: true, force: true });
      }
    }
    assert.equal(heavyRequests.image, 0);
    assert.equal(heavyRequests.font, 0);
    assert.equal(heavyRequests.media <= RAW_BROWSER_ENGINES.length, true);
  }
);

test(
  "bounded runtime launches headed Chromium, Firefox, and WebKit",
  { skip: process.env.COCKROACH_BROWSER_HEADED_E2E !== "1", timeout: 120_000 },
  async (t) => {
    const fixture = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=en><title>Headed fixture</title><body>visible</body></html>");
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const engine of RAW_BROWSER_ENGINES) {
      const root = await mkdtemp(join(tmpdir(), `cockroach-browser-headed-${engine}-`));
      const runtime = new BrowserRuntime({ root });
      try {
        const session = await runtime.createSession({
          engine,
          mode: "headed",
          startUrl: origin,
          purpose: `Verify headed ${engine}`,
          policy: {
            allowedOrigins: [origin],
            allowPrivateNetwork: true,
            allowedActions: ["snapshot"]
          }
        });
        const snapshot = await runtime.snapshot(session.id);
        assert.equal(snapshot.title, "Headed fixture");
        assert.match(snapshot.text, /visible/);
      } finally {
        await runtime.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  }
);

test("raw WebDriver BiDi supports commands, events, subscriptions, and close", async (t) => {
  const original = globalThis.WebSocket;
  class FakeWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    constructor(_url: URL, _protocols?: string | string[]) {
      super();
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(body: string): void {
      const command = JSON.parse(body) as { id: number; method: string };
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ id: command.id, type: "success", result: { method: command.method } })
        }));
      });
    }
    close(): void {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatchEvent(new Event("close"));
    }
  }
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: FakeWebSocket });
  t.after(() => Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: original }));
  const session = await BidiSession.connect("ws://127.0.0.1:9222/session");
  assert.deepEqual(await session.command("session.status"), { method: "session.status" });
  assert.deepEqual(await session.subscribe(["browsingContext.load"]), { method: "session.subscribe" });
  let observed = "";
  session.on("log.entryAdded", (event) => { observed = event.method; });
  session.socket.dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ type: "event", method: "log.entryAdded", params: { text: "fixture" } })
  }));
  assert.equal(observed, "log.entryAdded");
  await session.close();
  assert.equal(session.closed, true);
});

test("WebDriver client supports W3C/Appium sessions and arbitrary vendor commands", async (t) => {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: request.method ?? "", url: request.url ?? "", body: bodyText ? JSON.parse(bodyText) : undefined });
    response.setHeader("content-type", "application/json");
    if (request.url === "/wd/hub/session" && request.method === "POST") {
      response.end(JSON.stringify({ value: { sessionId: "mobile-1", capabilities: { platformName: "iOS" } } }));
      return;
    }
    if (request.url?.endsWith("/source")) {
      response.end(JSON.stringify({ value: "<App/>" }));
      return;
    }
    response.end(JSON.stringify({ value: null }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new WebDriverClient({ endpoint: `http://127.0.0.1:${address.port}/wd/hub` });
  const session = await client.createSession({ alwaysMatch: { platformName: "iOS" } });
  assert.equal(session.sessionId, "mobile-1");
  assert.equal(session.capabilities.platformName, "iOS");
  await session.navigate("https://example.com/");
  assert.equal(await session.source(), "<App/>");
  await session.command("POST", "/appium/device/press_keycode", { keycode: 3 });
  await session.close();
  assert.equal(requests.some((entry) => entry.url.endsWith("/appium/device/press_keycode")), true);
});

test("managed fleet adapter preserves exact engine, proxy, challenge, and live-view contracts", async (t) => {
  const requests: Array<{ method: string; url: string; authorization?: string; body?: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      ...(text ? { body: JSON.parse(text) as unknown } : {})
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/health") {
      response.end(JSON.stringify({ healthy: true, capacity: 10, active: 1 }));
      return;
    }
    if (request.url === "/v1/sessions" && request.method === "POST") {
      response.end(JSON.stringify({
        providerSessionId: "remote-1",
        connection: { protocol: "cdp", endpoint: "wss://fleet.example/session/remote-1" },
        liveViewUrl: "https://fleet.example/live/remote-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        region: "us-east",
        proxy: { kind: "residential", country: "US" }
      }));
      return;
    }
    response.end(JSON.stringify({ closed: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const provider = new HttpBrowserFleetProvider({
    id: "fixture-cloud",
    endpoint: `http://127.0.0.1:${address.port}/`,
    token: "fixture-token",
    capabilities: {
      engines: ["chromium"],
      regions: ["us-east"],
      proxyKinds: ["residential", "static"],
      liveView: true,
      challengeModes: ["report", "provider-authorized"],
      maxSessionTtlMs: 120_000
    }
  });
  const fleet = new BrowserFleet({ providers: [provider], maxSessions: 2 });
  const lease = await fleet.createSession({
    engine: "chromium",
    purpose: "Verify an authorized managed session",
    ttlMs: 60_000,
    region: "us-east",
    proxy: { kind: "residential", country: "US" },
    challengeMode: "provider-authorized"
  });
  assert.equal(lease.providerId, "fixture-cloud");
  assert.equal(lease.liveViewUrl, "https://fleet.example/live/remote-1");
  assert.equal(lease.proxy?.kind, "residential");
  await fleet.closeSession(lease.id);
  assert.equal(requests.every((request) => request.authorization === "Bearer fixture-token"), true);
  assert.equal(requests.some((request) => request.method === "DELETE" && request.url === "/v1/sessions/remote-1"), true);
});

test("fleet capacity includes in-flight provider allocations", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const provider: BrowserFleetProvider = {
    id: "delayed-provider",
    capabilities: {
      engines: ["chromium"],
      regions: ["local"],
      proxyKinds: ["none"],
      liveView: false,
      challengeModes: ["report"],
      maxSessionTtlMs: 120_000
    },
    async health() { return { healthy: true, capacity: 2, active: 0 }; },
    async createSession() {
      await gate;
      return {
        providerSessionId: "delayed-1",
        connection: { protocol: "cdp", endpoint: "wss://fleet.example/session/delayed-1" },
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
    },
    async closeSession() {}
  };
  const fleet = new BrowserFleet({ providers: [provider], maxSessions: 1 });
  const input = { engine: "chromium" as const, purpose: "capacity regression", ttlMs: 60_000 };
  const first = fleet.createSession(input);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(fleet.createSession(input), /session ceiling/);
  release?.();
  const lease = await first;
  assert.equal(fleet.leases().length, 1);
  await fleet.closeSession(lease.id);
});

test("OpenAI-compatible gateway parses bounded tool calls", async (t) => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      model: "fixture-model",
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "browser_finish", arguments: JSON.stringify({ result: "done" }) }
          }]
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const gateway = new OpenAICompatibleModelGateway({
    endpoint: `http://127.0.0.1:${address.port}/v1/`,
    model: "fixture-model",
    apiKey: "fixture-key"
  });
  const response = await gateway.complete({
    messages: [
      { role: "user", content: "click and finish" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "prior-call", name: "browser_action", arguments: { action: { kind: "click", ref: "e1" } } }]
      },
      { role: "tool", content: "{\"ok\":true}", name: "browser_action", toolCallId: "prior-call" }
    ]
  });
  assert.equal(response.model, "fixture-model");
  assert.deepEqual(response.toolCalls[0]?.arguments, { result: "done" });
  assert.equal(response.usage?.totalTokens, 15);
  const sentMessages = requestBody?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(sentMessages[1]?.tool_calls, [{
    id: "prior-call",
    type: "function",
    function: {
      name: "browser_action",
      arguments: JSON.stringify({ action: { kind: "click", ref: "e1" } })
    }
  }]);
  assert.equal(sentMessages[2]?.tool_call_id, "prior-call");
});

test("model gateway enforces response bytes while streaming", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end("x".repeat(8_192));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const gateway = new OpenAICompatibleModelGateway({
    endpoint: `http://127.0.0.1:${address.port}/v1/`,
    model: "fixture-model",
    apiKey: "fixture-key",
    maxResponseBytes: 1_024
  });
  await assert.rejects(
    gateway.complete({ messages: [{ role: "user", content: "oversize" }] }),
    /exceeded maxResponseBytes/
  );
});

test("model gateway rejects oversized prompts before opening the transport", async () => {
  const gateway = new OpenAICompatibleModelGateway({
    endpoint: "http://127.0.0.1:1/v1/",
    model: "fixture-model",
    apiKey: "fixture-key",
    maxRequestBytes: 1_024
  });
  await assert.rejects(
    gateway.complete({ messages: [{ role: "user", content: "x".repeat(2_000) }] }),
    /exceeded maxRequestBytes/
  );
});

test("model gateway aborts an unresolved API-key provider with the caller signal", async () => {
  const controller = new AbortController();
  const gateway = new OpenAICompatibleModelGateway({
    endpoint: "http://127.0.0.1:1/v1/",
    model: "fixture-model",
    apiKeyProvider: () => new Promise<string>(() => undefined)
  });
  const pending = gateway.complete({
    messages: [{ role: "user", content: "never reaches transport" }],
    signal: controller.signal
  });
  controller.abort(new Error("caller stopped"));
  await assert.rejects(pending, /caller stopped/);
});

test("model gateway timeout includes API-key provider resolution", async () => {
  const gateway = new OpenAICompatibleModelGateway({
    endpoint: "http://127.0.0.1:1/v1/",
    model: "fixture-model",
    apiKeyProvider: () => new Promise<string>(() => undefined),
    timeoutMs: 1_000
  });
  const started = performance.now();
  await assert.rejects(
    gateway.complete({ messages: [{ role: "user", content: "never reaches transport" }] }),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError"
  );
  assert(performance.now() - started < 2_500);
});

test("model gateway validates provider keys before opening the transport", async () => {
  assert.throws(
    () => new OpenAICompatibleModelGateway({
      endpoint: "http://127.0.0.1:1/v1/",
      model: "fixture-model",
      apiKey: "static\u001fcontrol"
    }),
    /API key/
  );
  for (const provided of [undefined, 42, " ", "control\u000bcharacter", "x".repeat(16 * 1024 + 1)]) {
    const gateway = new OpenAICompatibleModelGateway({
      endpoint: "http://127.0.0.1:1/v1/",
      model: "fixture-model",
      apiKeyProvider: () => provided as string
    });
    await assert.rejects(
      gateway.complete({ messages: [{ role: "user", content: "must not reach transport" }] }),
      /API key|API-key/
    );
  }
});

test("model gateway does not invoke a key provider for an already-aborted request", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already stopped"));
  let invocations = 0;
  const gateway = new OpenAICompatibleModelGateway({
    endpoint: "http://127.0.0.1:1/v1/",
    model: "fixture-model",
    apiKeyProvider: () => { invocations += 1; return "unused"; }
  });
  await assert.rejects(
    gateway.complete({ messages: [{ role: "user", content: "cancelled" }], signal: controller.signal }),
    /already stopped/
  );
  assert.equal(invocations, 0);
});

test("built-in browser agent observes, acts, and finishes through a model gateway", async () => {
  const snapshot = {
    sessionId: "session-1",
    tabId: "tab-1",
    url: "https://example.com/",
    title: "Fixture",
    capturedAt: "2026-08-10T00:00:00.000Z",
    text: "Save",
    refs: [],
    digest: "sha256:fixture",
    truncated: false
  };
  const runtime = {
    async snapshot() { return snapshot; },
    async act(_sessionId: string, action: { kind: string }) {
      return {
        output: { kind: action.kind, ok: true },
        receipt: {
          id: "receipt-1",
          sessionId: "session-1",
          action: action.kind,
          effect: "write",
          risk: "medium",
          purpose: "fixture",
          inputDigest: "sha256:input",
          outputDigest: "sha256:output",
          policyDigest: "sha256:policy",
          startedAt: "2026-08-10T00:00:00.000Z",
          completedAt: "2026-08-10T00:00:01.000Z",
          durationMs: 1000,
          status: "succeeded",
          evidenceIds: [],
          receiptHash: "sha256:receipt"
        }
      };
    }
  } as unknown as BrowserRuntime;
  const responses = [
    { content: "", toolCalls: [{ id: "one", name: "browser_action", arguments: { action: { kind: "click", ref: "e1" } } }] },
    { content: "", toolCalls: [{ id: "two", name: "browser_finish", arguments: { result: "Saved before observation" } }] },
    { content: "", toolCalls: [{ id: "three", name: "browser_finish", arguments: { result: "Saved" } }] }
  ];
  const requests: Parameters<ModelGateway["complete"]>[0][] = [];
  const gateway: ModelGateway = {
    async complete(request) {
      requests.push(request);
      const response = responses.shift();
      assert(response);
      return response;
    }
  };
  const agent = new BrowserAgent({ runtime, gateway, maxSteps: 4 });
  const result = await agent.run({ sessionId: "session-1", task: "Save the form" });
  assert.equal(result.status, "completed");
  assert.equal(result.result, "Saved");
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0]?.receipt?.receiptHash, "sha256:receipt");
  assert.deepEqual(requests[1]?.messages[2]?.toolCalls, [
    { id: "one", name: "browser_action", arguments: { action: { kind: "click", ref: "e1" } } }
  ]);
  assert.equal(requests[1]?.messages[3]?.toolCallId, "one");
  assert.match(requests[2]?.messages.at(-1)?.content ?? "", /POST_ACTION_SNAPSHOT_REQUIRED/);
  assert.equal(result.steps[1]?.tool, "browser_snapshot");
});

test("browser agent rejects schema-invalid tool data before runtime dispatch", async () => {
  let actions = 0;
  const runtime = {
    async snapshot() {
      return {
        sessionId: "session-invalid",
        tabId: "tab-invalid",
        url: "https://example.com/",
        title: "Invalid action fixture",
        capturedAt: "2026-09-03T00:00:00.000Z",
        text: "ready",
        refs: [],
        digest: "sha256:invalid-action-fixture",
        truncated: false
      };
    },
    async act() { actions += 1; throw new Error("must not dispatch"); }
  } as unknown as BrowserRuntime;
  const gateway: ModelGateway = {
    async complete() {
      return {
        content: "",
        toolCalls: [{
          id: "invalid",
          name: "browser_action",
          arguments: { action: { kind: "evaluate", expression: "x".repeat(100_001), unexpected: true } }
        }]
      };
    }
  };
  const agent = new BrowserAgent({ runtime, gateway, maxSteps: 2 });
  await assert.rejects(
    agent.run({ sessionId: "session-invalid", task: "Inspect the page" }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "ACTION_SCHEMA_INVALID")
  );
  assert.equal(actions, 0);
});

test("browser agent never executes a mixed action-and-finish response", async () => {
  let actions = 0;
  let turn = 0;
  const snapshot = {
    sessionId: "session-mixed",
    tabId: "tab-mixed",
    url: "https://example.com/",
    title: "Mixed tool fixture",
    capturedAt: "2026-09-03T00:00:00.000Z",
    text: "ready",
    refs: [],
    digest: "sha256:mixed-tool-fixture",
    truncated: false
  };
  const runtime = {
    async snapshot() { return snapshot; },
    async act() { actions += 1; throw new Error("must not dispatch"); }
  } as unknown as BrowserRuntime;
  const requests: Parameters<ModelGateway["complete"]>[0][] = [];
  const gateway: ModelGateway = {
    async complete(request) {
      requests.push(request);
      turn += 1;
      return turn === 1
        ? {
            content: "",
            toolCalls: [
              { id: "action", name: "browser_action", arguments: { action: { kind: "click", ref: "e1" } } },
              { id: "finish-early", name: "browser_finish", arguments: { result: "Unobserved" } }
            ]
          }
        : { content: "", toolCalls: [{ id: "finish", name: "browser_finish", arguments: { result: "Nothing executed" } }] };
    }
  };
  const agent = new BrowserAgent({ runtime, gateway, maxSteps: 3 });
  const result = await agent.run({ sessionId: "session-mixed", task: "Inspect only" });
  assert.equal(result.result, "Nothing executed");
  assert.equal(actions, 0);
  assert.equal(
    requests[1]?.messages.filter((message) => message.role === "tool")
      .every((message) => /FINISH_TOOL_MUST_BE_EXCLUSIVE/.test(message.content)),
    true
  );
});

test("browser agent rejects every multi-tool response before executing any call", async () => {
  let actions = 0;
  let snapshots = 0;
  let turn = 0;
  const runtime = createAgentFixtureRuntime({
    snapshot() { snapshots += 1; },
    act() { actions += 1; }
  });
  const requests: Parameters<ModelGateway["complete"]>[0][] = [];
  const gateway: ModelGateway = {
    async complete(request) {
      requests.push(request);
      turn += 1;
      return turn === 1
        ? {
            content: "",
            toolCalls: [
              { id: "observe", name: "browser_snapshot", arguments: {} },
              { id: "act", name: "browser_action", arguments: { action: { kind: "click", ref: "e1" } } }
            ]
          }
        : { content: "", toolCalls: [{ id: "finish", name: "browser_finish", arguments: { result: "No stale action" } }] };
    }
  };

  const result = await new BrowserAgent({ runtime, gateway, maxSteps: 3 }).run({
    sessionId: "session-multiple",
    task: "Inspect without stale actions"
  });

  assert.equal(result.result, "No stale action");
  assert.equal(actions, 0);
  assert.equal(snapshots, 2, "only the initial and final host snapshots should run");
  const rejected = requests[1]?.messages.filter((message) => message.role === "tool");
  assert.deepEqual(rejected?.map((message) => message.toolCallId), ["observe", "act"]);
  assert.equal(rejected?.every((message) => /MULTIPLE_BROWSER_TOOL_CALLS_NOT_ALLOWED/.test(message.content)), true);
});

test("browser agent validates context and model host deadlines", () => {
  const runtime = createAgentFixtureRuntime();
  const gateway: ModelGateway = { async complete() { return { content: "done", toolCalls: [] }; } };
  for (const contextProviderTimeoutMs of [0, 1.5, Number.NaN, 120_001]) {
    assert.throws(
      () => new BrowserAgent({ runtime, gateway, contextProviderTimeoutMs }),
      /contextProviderTimeoutMs must be an integer between 1 and 120000/
    );
  }
  for (const modelGatewayTimeoutMs of [0, 1.5, Number.POSITIVE_INFINITY, 600_001]) {
    assert.throws(
      () => new BrowserAgent({ runtime, gateway, modelGatewayTimeoutMs }),
      /modelGatewayTimeoutMs must be an integer between 1 and 600000/
    );
  }
});

test("browser agent enforces a context-provider deadline even when the provider ignores cancellation", async () => {
  let providerSignal: AbortSignal | undefined;
  let rejectProvider!: (reason: unknown) => void;
  const pendingProvider = new Promise<never>((_resolve, reject) => { rejectProvider = reject; });
  const agent = new BrowserAgent({
    runtime: createAgentFixtureRuntime(),
    gateway: { async complete() { return { content: "unused", toolCalls: [] }; } },
    contextProvider: {
      retrieve(input) {
        providerSignal = input.signal;
        return pendingProvider;
      }
    },
    contextProviderTimeoutMs: 25
  });

  await assert.rejects(
    agent.run({ sessionId: "session-context-timeout", task: "Retrieve context" }),
    (error: unknown) => error instanceof DOMException
      && error.name === "TimeoutError"
      && /context retrieval timed out after 25ms/.test(error.message)
  );
  assert.equal(providerSignal?.aborted, true);
  rejectProvider(new Error("late context-provider rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("browser agent enforces a model deadline even when a custom gateway ignores cancellation", async () => {
  let gatewaySignal: AbortSignal | undefined;
  let rejectGateway!: (reason: unknown) => void;
  const pendingGateway = new Promise<never>((_resolve, reject) => { rejectGateway = reject; });
  const agent = new BrowserAgent({
    runtime: createAgentFixtureRuntime(),
    gateway: {
      complete(request) {
        gatewaySignal = request.signal;
        return pendingGateway;
      }
    },
    modelGatewayTimeoutMs: 25
  });

  await assert.rejects(
    agent.run({ sessionId: "session-gateway-timeout", task: "Ask the model" }),
    (error: unknown) => error instanceof DOMException
      && error.name === "TimeoutError"
      && /model gateway timed out after 25ms/.test(error.message)
  );
  assert.equal(gatewaySignal?.aborted, true);
  rejectGateway(new Error("late model-gateway rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("browser agent host cancellation interrupts ignoring context and model implementations", async (t) => {
  await t.test("context provider", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const agent = new BrowserAgent({
      runtime: createAgentFixtureRuntime(),
      gateway: { async complete() { return { content: "unused", toolCalls: [] }; } },
      contextProvider: {
        retrieve(input) {
          providerSignal = input.signal;
          providerStarted();
          return new Promise<never>(() => {});
        }
      },
      contextProviderTimeoutMs: 60_000
    });
    const running = agent.run({ sessionId: "session-context-abort", task: "Cancel context", signal: controller.signal });
    await started;
    const reason = new Error("cancel context now");
    controller.abort(reason);
    await assert.rejects(running, (error: unknown) => error === reason);
    assert.equal(providerSignal?.aborted, true);
  });

  await t.test("model gateway", async () => {
    const controller = new AbortController();
    let gatewaySignal: AbortSignal | undefined;
    let gatewayStarted!: () => void;
    const started = new Promise<void>((resolve) => { gatewayStarted = resolve; });
    const agent = new BrowserAgent({
      runtime: createAgentFixtureRuntime(),
      gateway: {
        complete(request) {
          gatewaySignal = request.signal;
          gatewayStarted();
          return new Promise<never>(() => {});
        }
      },
      modelGatewayTimeoutMs: 60_000
    });
    const running = agent.run({ sessionId: "session-gateway-abort", task: "Cancel model", signal: controller.signal });
    await started;
    const reason = new Error("cancel model now");
    controller.abort(reason);
    await assert.rejects(running, (error: unknown) => error === reason);
    assert.equal(gatewaySignal?.aborted, true);
  });
});

test("browser agent uses cited Qarinah context and compacts complete tool-call rounds", async () => {
  const snapshot = {
    sessionId: "session-context",
    tabId: "tab-context",
    url: "https://example.com/",
    title: "Context fixture",
    capturedAt: "2026-09-03T00:00:00.000Z",
    text: "initial ".repeat(4_000),
    refs: [],
    digest: "sha256:snapshot-context",
    truncated: false
  };
  let actions = 0;
  const runtime = {
    async snapshot() { return snapshot; },
    async act(_sessionId: string, action: { kind: string }) {
      actions += 1;
      return {
        output: { payload: `action-${actions}-` + "y".repeat(8_000) },
        receipt: {
          id: `receipt-${actions}`,
          sessionId: "session-context",
          action: action.kind,
          effect: "read",
          risk: "low",
          purpose: "bounded fixture",
          inputDigest: `sha256:input-${actions}`,
          outputDigest: `sha256:output-${actions}`,
          policyDigest: "sha256:policy",
          startedAt: "2026-09-03T00:00:00.000Z",
          completedAt: "2026-09-03T00:00:00.001Z",
          durationMs: 1,
          status: "succeeded",
          evidenceIds: [`evidence-${actions}`],
          receiptHash: `sha256:receipt-${actions}`
        }
      };
    }
  } as unknown as BrowserRuntime;
  const contextQueries: unknown[] = [];
  const contextProvider = createQarinahAgentContextProvider({
    async retrieveBrowserContext(input) {
      const { signal, ...query } = input;
      assert.equal(signal?.aborted, false);
      contextQueries.push(structuredClone(query));
      return {
        summary: "Prior evidence says the page was reviewed. ".repeat(200),
        citations: [{ id: "event-prior", receiptHash: "sha256:prior", evidenceIds: ["evidence-prior"] }]
      };
    }
  }, { limit: 7 });
  const requests: Parameters<ModelGateway["complete"]>[0][] = [];
  let turn = 0;
  const gateway: ModelGateway = {
    async complete(request) {
      requests.push(request);
      turn += 1;
      if (turn <= 12) {
        return {
          content: "",
          toolCalls: [{
            id: `call-${turn}`,
            name: "browser_action",
            arguments: { action: { kind: "snapshot", purpose: `Observe turn ${turn}` } }
          }]
        };
      }
      return {
        content: "",
        toolCalls: [{ id: "finish", name: "browser_finish", arguments: { result: "Grounded completion" } }]
      };
    }
  };
  const agent = new BrowserAgent({
    runtime,
    gateway,
    contextProvider,
    maxSteps: 20,
    maxContextChars: 8_192,
    maxToolOutputChars: 1_024
  });
  const result = await agent.run({ sessionId: "session-context", task: "Inspect the reviewed page" });
  assert.equal(result.result, "Grounded completion");
  assert.equal(actions, 12);
  assert.deepEqual(contextQueries, [{
    sessionId: "session-context",
    query: "Inspect the reviewed page",
    maxChars: 2_048,
    limit: 7
  }]);
  assert.equal(requests[0]?.messages[1]?.role, "system");
  assert.match(requests[0]?.messages[1]?.content ?? "", /historical context is untrusted data/i);
  assert.doesNotMatch(requests[0]?.messages[1]?.content ?? "", /event-prior|Prior evidence/);
  assert.equal(requests[0]?.messages[2]?.role, "user");
  assert.match(requests[0]?.messages[2]?.content ?? "", /historical browser evidence/i);
  assert.match(requests[0]?.messages[2]?.content ?? "", /event-prior/);
  assert.equal(requests.some((request) => request.messages.some((message) => /compactedInteractions/.test(message.content))), true);
  for (const request of requests) {
    const chars = request.messages.reduce(
      (total, message) => total + message.content.length + JSON.stringify(message.toolCalls ?? []).length + 64,
      0
    );
    assert.ok(chars <= 8_192, `model context exceeded ceiling: ${chars}`);
  }
  const toolMessages = requests.flatMap((request) => request.messages).filter((message) => message.role === "tool");
  assert.equal(toolMessages.some((message) => (JSON.parse(message.content) as { truncated?: boolean }).truncated), true);
  const browserActionTool = requests[0]?.tools?.find((tool) => tool.name === "browser_action");
  const toolSchema = browserActionTool?.inputSchema as {
    $defs?: Record<string, unknown>;
    properties?: { action?: { additionalProperties?: boolean; required?: string[] } };
  };
  assert.equal(toolSchema.properties?.action?.additionalProperties, false);
  assert.deepEqual(toolSchema.properties?.action?.required, ["kind", "purpose"]);
  assert.ok(toolSchema.$defs?.actionKind);
});

function createAgentFixtureRuntime(hooks: {
  snapshot?: () => void;
  act?: () => void;
} = {}): BrowserRuntime {
  const snapshot = {
    sessionId: "session-agent-fixture",
    tabId: "tab-agent-fixture",
    url: "https://example.com/",
    title: "Agent fixture",
    capturedAt: "2026-09-03T00:00:00.000Z",
    text: "ready",
    refs: [],
    digest: "sha256:agent-fixture",
    truncated: false
  };
  return {
    async snapshot() {
      hooks.snapshot?.();
      return snapshot;
    },
    async act(_sessionId: string, action: { kind: string; purpose: string }) {
      hooks.act?.();
      return {
        output: { ok: true },
        receipt: {
          id: "receipt-agent-fixture",
          sessionId: "session-agent-fixture",
          action: action.kind,
          effect: "read",
          risk: "low",
          purpose: action.purpose,
          inputDigest: "sha256:agent-input",
          outputDigest: "sha256:agent-output",
          policyDigest: "sha256:agent-policy",
          startedAt: "2026-09-03T00:00:00.000Z",
          completedAt: "2026-09-03T00:00:00.001Z",
          durationMs: 1,
          status: "succeeded",
          evidenceIds: [],
          receiptHash: "sha256:agent-receipt"
        }
      };
    }
  } as unknown as BrowserRuntime;
}
