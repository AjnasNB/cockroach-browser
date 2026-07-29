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
    const fixture = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html lang="en"><title>Browser fixture</title>
        <label>Name <input aria-label="Name"></label>
        <button onclick="document.querySelector('output').textContent='saved'">Save</button>
        <output>idle</output></html>`);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const runtime = new BrowserRuntime({ root });
    await runtime.initialize();
    t.after(() => runtime.close());
    const session = await runtime.createSession({
      startUrl: origin,
      purpose: "Release browser smoke test",
      policy: {
        allowedOrigins: [origin],
        allowPrivateNetwork: true,
        allowedActions: ["fill", "click", "snapshot"],
        allowedEffects: ["read", "write"],
        requireApprovalFor: []
      }
    });
    const first = await runtime.snapshot(session.id);
    const name = first.refs.find((entry) => entry.role === "textbox");
    const save = first.refs.find((entry) => entry.role === "button");
    assert(name);
    assert(save);

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
    assert.equal((await runtime.evidence.verify()).ok, true);
  }
);
