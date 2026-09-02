import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserAgent } from "../src/agent.js";
import { BidiSession } from "../src/bidi.js";
import { OpenAICompatibleModelGateway, type ModelGateway } from "../src/model-gateway.js";
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
  "bounded runtime launches Chromium, Firefox, and WebKit with the same exact-origin contract",
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
  const server = createServer(async (_request, response) => {
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
  const response = await gateway.complete({ messages: [{ role: "user", content: "finish" }] });
  assert.equal(response.model, "fixture-model");
  assert.deepEqual(response.toolCalls[0]?.arguments, { result: "done" });
  assert.equal(response.usage?.totalTokens, 15);
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
    { content: "", toolCalls: [{ id: "two", name: "browser_finish", arguments: { result: "Saved" } }] }
  ];
  const gateway: ModelGateway = {
    async complete() {
      const response = responses.shift();
      assert(response);
      return response;
    }
  };
  const agent = new BrowserAgent({ runtime, gateway, maxSteps: 4 });
  const result = await agent.run({ sessionId: "session-1", task: "Save the form" });
  assert.equal(result.status, "completed");
  assert.equal(result.result, "Saved");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0]?.receipt?.receiptHash, "sha256:receipt");
});
