import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserRuntime } from "../src/runtime.js";

test(
  "captures and acts on a deployment-owned page through Chromium",
  { skip: process.env.COCKROACH_BROWSER_E2E !== "1", timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-e2e-"));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const fixture = createServer((request, response) => {
      if (request.url === "/frame") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><body><label>Frame <input id=\"frame-input\"></label></body></html>");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html lang="en"><title>Browser fixture</title>
        <label>Name <input aria-label="Name"></label>
        <button onclick="document.querySelector('output').textContent='saved'">Save</button>
        <button onclick="document.querySelector('output').textContent=confirm('Proceed?')?'confirmed':'dismissed'">Confirm</button>
        <button onclick="fetch('/api/mock').then(r=>r.text()).then(text=>document.querySelector('output').textContent=text)">Fetch</button>
        <iframe name="fixture-frame" src="/frame"></iframe>
        <output>idle</output></html>`);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const runtime = new BrowserRuntime({
      root,
      approvalProvider: {
        async authorize(request) {
          return {
            allowed: true,
            approvalId: `approval-${Date.now()}`,
            inputDigest: request.inputDigest,
            policyDigest: request.policyDigest,
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          };
        }
      }
    });
    await runtime.initialize();
    t.after(() => runtime.close());
    const session = await runtime.createSession({
      startUrl: origin,
      purpose: "Release browser smoke test",
      policy: {
        allowedOrigins: [origin],
        allowPrivateNetwork: true,
        allowedActions: [
          "fill",
          "focus",
          "click",
          "snapshot",
          "mouse.move",
          "keyboard.insertText",
          "history.inspect",
          "network.route.add",
          "network.routes.list"
        ],
        allowedEffects: ["read", "write"],
        allowDialogAccept: true,
        allowNetworkInterception: true,
        requireApprovalFor: []
      }
    });
    const first = await runtime.snapshot(session.id);
    const name = first.refs.find((entry) => entry.role === "textbox");
    const save = first.refs.find((entry) => entry.role === "button");
    const confirm = first.refs.find((entry) => entry.role === "button" && entry.name === "Confirm");
    const fetch = first.refs.find((entry) => entry.role === "button" && entry.name === "Fetch");
    assert(name);
    assert(save);
    assert(confirm);
    assert(fetch);

    await runtime.act(session.id, {
      kind: "fill",
      ref: name.ref,
      value: "Ajnas",
      purpose: "Fill the local fixture"
    });
    await runtime.act(session.id, {
      kind: "click",
      ref: save.ref,
      purpose: "Activate the local fixture"
    });
    const after = await runtime.snapshot(session.id);
    assert.match(after.text, /saved/);

    await runtime.act(session.id, {
      kind: "fill",
      xpath: "//*[@id='frame-input']",
      frame: { name: "fixture-frame" },
      value: "same-origin",
      purpose: "Exercise exact same-origin frame targeting"
    });
    await runtime.act(session.id, {
      kind: "focus",
      ref: name.ref,
      purpose: "Focus the fixture input"
    });
    await runtime.act(session.id, {
      kind: "keyboard.insertText",
      value: " via keyboard",
      purpose: "Exercise bounded low-level keyboard input"
    });
    await runtime.act(session.id, {
      kind: "mouse.move",
      x: 5,
      y: 5,
      purpose: "Exercise bounded in-viewport mouse movement"
    });
    const dialogResult = await runtime.act(session.id, {
      kind: "click",
      ref: confirm.ref,
      dialog: { action: "accept" },
      purpose: "Accept the exact reviewed confirmation dialog"
    });
    assert.deepEqual(
      (dialogResult.output as { dialogs: Array<{ response: string }> }).dialogs.map((entry) => entry.response),
      ["accepted"]
    );

    await runtime.act(session.id, {
      kind: "network.route.add",
      route: {
        id: "fixture-api",
        origin,
        pathPattern: "/api/mock",
        methods: ["GET"],
        resourceTypes: ["fetch"],
        response: { action: "fulfill", contentType: "text/plain", body: "intercepted" }
      },
      purpose: "Install a static exact-origin fixture response"
    });
    await runtime.act(session.id, {
      kind: "click",
      ref: fetch.ref,
      purpose: "Request the bounded fixture response"
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match((await runtime.snapshot(session.id)).text, /intercepted/);
    const routes = await runtime.act(session.id, {
      kind: "network.routes.list",
      purpose: "Inspect active bounded network routes"
    });
    assert.equal((routes.output as { count: number }).count, 1);
    const history = await runtime.act(session.id, {
      kind: "history.inspect",
      purpose: "Inspect the bounded session history"
    });
    assert.equal((history.output as { returned: number }).returned >= 1, true);
    assert.equal((await runtime.evidence.verify()).ok, true);
  }
);
