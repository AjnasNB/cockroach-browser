import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserRuntime } from "../src/runtime.js";

test(
  "bounded contexts block service-worker egress outside the exact-origin router",
  { skip: process.env.COCKROACH_BROWSER_E2E !== "1", timeout: 120_000 },
  async (t) => {
    let deniedRequests = 0;
    const denied = createServer((_request, response) => {
      deniedRequests += 1;
      response.end("unreachable");
    });
    await new Promise<void>((resolve) => denied.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => denied.close((error) => error ? reject(error) : resolve())));
    const deniedAddress = denied.address();
    assert(deniedAddress && typeof deniedAddress === "object");
    const deniedUrl = `http://127.0.0.1:${deniedAddress.port}/outside-policy`;

    const fixture = createServer((request, response) => {
      if (request.url === "/worker.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        response.end(`self.addEventListener('install', () => { fetch(${JSON.stringify(deniedUrl)}).catch(() => undefined); });`);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="en"><title>Worker boundary</title><body>
        <output>pending</output>
        <script>
          navigator.serviceWorker.register('/worker.js').then(
            () => document.querySelector('output').textContent = 'registered',
            () => document.querySelector('output').textContent = 'blocked'
          );
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const root = await mkdtemp(join(tmpdir(), "cockroach-worker-boundary-"));
    const runtime = new BrowserRuntime({ root });
    t.after(async () => {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    });
    const session = await runtime.createSession({
      startUrl: origin,
      performanceProfile: "balanced",
      purpose: "Prove background workers cannot bypass exact-origin routing",
      policy: {
        allowedOrigins: [origin],
        allowPrivateNetwork: true,
        allowedActions: ["wait", "snapshot"],
        requireApprovalFor: []
      }
    });
    await runtime.act(session.id, {
      kind: "wait",
      timeoutMs: 2_000,
      purpose: "Allow the service-worker registration promise to settle"
    });
    const snapshot = await runtime.snapshot(session.id);
    // Chromium may resolve register() with an inert registration while
    // Playwright blocks the worker itself; the security outcome is that its
    // install handler never reaches the otherwise reachable denied origin.
    assert.match(snapshot.text, /registered|blocked/);
    assert.equal(deniedRequests, 0);
  }
);

test(
  "bounded contexts deny WebSocket handshakes outside the exact origin allowlist",
  { skip: process.env.COCKROACH_BROWSER_E2E !== "1", timeout: 120_000 },
  async (t) => {
    let deniedUpgrades = 0;
    const denied = createServer();
    denied.on("upgrade", (_request, socket) => {
      deniedUpgrades += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => denied.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => denied.close((error) => error ? reject(error) : resolve())));
    const deniedAddress = denied.address();
    assert(deniedAddress && typeof deniedAddress === "object");
    const deniedUrl = `ws://127.0.0.1:${deniedAddress.port}/outside-policy`;

    const fixture = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="en"><title>WebSocket boundary</title><body>
        <output>pending</output>
        <script>
          const socket = new WebSocket(${JSON.stringify(deniedUrl)});
          socket.onopen = () => document.querySelector('output').textContent = 'opened';
          socket.onerror = () => document.querySelector('output').textContent = 'denied';
          socket.onclose = () => document.querySelector('output').textContent = 'denied';
          setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) document.querySelector('output').textContent = 'denied';
          }, 500);
        </script>
      </body></html>`);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const root = await mkdtemp(join(tmpdir(), "cockroach-websocket-boundary-"));
    const runtime = new BrowserRuntime({ root });
    t.after(async () => {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    });
    const session = await runtime.createSession({
      startUrl: origin,
      purpose: "Prove WebSocket handshakes use the exact HTTP-origin policy",
      policy: {
        allowedOrigins: [origin],
        allowPrivateNetwork: true,
        allowedActions: ["wait", "snapshot"],
        requireApprovalFor: []
      }
    });
    await runtime.act(session.id, {
      kind: "wait",
      timeoutMs: 2_000,
      purpose: "Allow the denied WebSocket handshake to settle"
    });
    assert.match((await runtime.snapshot(session.id)).text, /denied/);
    assert.equal(deniedUpgrades, 0);
  }
);
