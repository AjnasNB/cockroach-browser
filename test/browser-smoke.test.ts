import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserLifecycleEvent } from "../src/contracts.js";
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

    const lifecycleEvents: BrowserLifecycleEvent[] = [];
    const secrets = new Map([
      ["ref:profile-passphrase", "a-strong-profile-passphrase"],
      ["ref:tab-lock", "one-exclusive-tab-token"],
      ["ref:wrong-tab-lock", "a-different-exclusive-tab-token"],
      ["ref:clipboard", "clipboard fixture value"],
      ["ref:storage-original", JSON.stringify({ localStorage: { fixture: "original" } })]
    ]);
    const runtime = new BrowserRuntime({
      root,
      secretResolver: {
        async resolve(reference) {
          const value = secrets.get(reference);
          if (!value) throw new Error(`Unknown test secret ${reference}`);
          return value;
        }
      },
      eventPublisher: {
        async publish(event) {
          lifecycleEvents.push(structuredClone(event));
        }
      },
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
      ...(process.env.COCKROACH_BROWSER_EXECUTABLE
        ? { executablePath: process.env.COCKROACH_BROWSER_EXECUTABLE }
        : {}),
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
          "capture.paired",
          "annotate.show",
          "annotate.clear",
          "clipboard.read",
          "clipboard.write",
          "network.inspect",
          "network.export",
          "network.route.add",
          "network.routes.list",
          "network.clear",
          "console.clear",
          "cache.clear",
          "query.inspect",
          "emulation.set",
          "emulation.clear",
          "state.save",
          "state.load",
          "state.list",
          "state.delete",
          "storage.read",
          "storage.write",
          "tab.lock",
          "tab.unlock",
          "tab.lock.status"
        ],
        allowedEffects: ["read", "write", "credential"],
        allowDialogAccept: true,
        allowNetworkInterception: true,
        allowClipboard: true,
        allowStateExport: true,
        allowAnnotations: true,
        allowEmulation: true,
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

    const inspected = await runtime.act(session.id, {
      kind: "query.inspect",
      ref: name.ref,
      query: { properties: ["attributes", "box", "value", "visible", "enabled", "count"] },
      purpose: "Inspect a bounded element property set"
    });
    assert.equal((inspected.output as { count: number }).count, 1);
    assert.equal((inspected.output as { items: Array<{ visible: boolean }> }).items[0]?.visible, true);

    await runtime.act(session.id, {
      kind: "emulation.set",
      emulation: { viewport: { width: 1024, height: 768 }, colorScheme: "dark" },
      purpose: "Apply explicit page emulation"
    });
    await runtime.act(session.id, {
      kind: "emulation.clear",
      purpose: "Restore the explicit page emulation"
    });

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

    const paired = await runtime.act(session.id, {
      kind: "capture.paired",
      includeBounds: true,
      purpose: "Capture synchronized visual and semantic fixture evidence"
    });
    assert.equal((paired.output as { refs: number }).refs >= 4, true);
    assert.equal((paired.output as { bounds: number }).bounds >= 1, true);
    assert.equal(paired.receipt.evidenceIds.length, 2);

    const annotated = await runtime.act(session.id, {
      kind: "annotate.show",
      purpose: "Overlay snapshot references on the local fixture"
    });
    assert.equal((annotated.output as { annotations: number }).annotations >= 1, true);
    await runtime.act(session.id, {
      kind: "annotate.clear",
      purpose: "Clear the fixture annotations"
    });

    const network = await runtime.act(session.id, {
      kind: "network.inspect",
      method: "GET",
      purpose: "Inspect the bounded fixture network ledger"
    });
    assert.equal((network.output as { returned: number }).returned >= 1, true);
    const networkExport = await runtime.act(session.id, {
      kind: "network.export",
      outputFormat: "har",
      purpose: "Export a redacted fixture HAR"
    });
    assert.equal((networkExport.output as { records: number }).records >= 1, true);
    assert.equal(networkExport.receipt.evidenceIds.length, 1);

    await runtime.act(session.id, {
      kind: "storage.write",
      dataRef: "ref:storage-original",
      purpose: "Write fixture storage before the encrypted checkpoint"
    });
    await runtime.act(session.id, {
      kind: "state.save",
      stateName: "fixture-state",
      passphraseRef: "ref:profile-passphrase",
      purpose: "Save the encrypted fixture state"
    });
    secrets.set(
      "ref:storage-changed",
      JSON.stringify({ localStorage: { fixture: "changed" } })
    );
    await runtime.act(session.id, {
      kind: "storage.write",
      dataRef: "ref:storage-changed",
      purpose: "Change storage after the encrypted checkpoint"
    });
    await runtime.act(session.id, {
      kind: "state.load",
      stateName: "fixture-state",
      passphraseRef: "ref:profile-passphrase",
      purpose: "Restore the encrypted fixture state"
    });
    const restored = await runtime.act(session.id, {
      kind: "storage.read",
      purpose: "Verify restored local fixture state"
    });
    assert.equal(
      (restored.output as { localStorage: Record<string, string> }).localStorage.fixture,
      "original"
    );
    const states = await runtime.act(session.id, {
      kind: "state.list",
      purpose: "List encrypted fixture states"
    });
    assert.deepEqual((states.output as { profiles: string[] }).profiles, ["fixture-state"]);

    await runtime.act(session.id, {
      kind: "clipboard.write",
      valueRef: "ref:clipboard",
      purpose: "Write the exact fixture value to the browser clipboard"
    });
    const clipboard = await runtime.act(session.id, {
      kind: "clipboard.read",
      purpose: "Read the bounded browser clipboard value"
    });
    assert.equal((clipboard.output as { value: string }).value, "clipboard fixture value");

    await runtime.act(session.id, {
      kind: "tab.lock",
      lockOwner: "fixture-worker",
      lockTokenRef: "ref:tab-lock",
      lockTtlMs: 30_000,
      purpose: "Acquire exclusive fixture tab ownership"
    });
    await assert.rejects(
      runtime.act(session.id, {
        kind: "snapshot",
        purpose: "Verify that an unowned action cannot enter the locked tab"
      }),
      (error: unknown) => Boolean(
        error && typeof error === "object" && "code" in error && error.code === "TAB_LOCK_DENIED"
      )
    );
    await assert.rejects(
      runtime.act(session.id, {
        kind: "snapshot",
        lockTokenRef: "ref:wrong-tab-lock",
        purpose: "Verify that a different lock secret cannot enter the locked tab"
      }),
      (error: unknown) => Boolean(
        error && typeof error === "object" && "code" in error && error.code === "TAB_LOCK_DENIED"
      )
    );
    const lock = await runtime.act(session.id, {
      kind: "tab.lock.status",
      purpose: "Inspect the exclusive fixture tab lock"
    });
    const lockSummary = (lock.output as { lock: { owner: string } }).lock;
    assert.equal(lockSummary.owner, "fixture-worker");
    assert.deepEqual(
      Object.keys(lockSummary).sort(),
      ["acquiredAt", "expiresAt", "owner", "tabId"]
    );
    await runtime.act(session.id, {
      kind: "tab.unlock",
      lockTokenRef: "ref:tab-lock",
      purpose: "Release exclusive fixture tab ownership"
    });
    await runtime.act(session.id, {
      kind: "state.delete",
      stateName: "fixture-state",
      purpose: "Delete the encrypted fixture state"
    });
    const batch = await runtime.actBatch(session.id, {
      stopOnError: true,
      actions: [
        { kind: "cache.clear", purpose: "Clear the fixture browser cache" },
        { kind: "console.clear", purpose: "Clear the fixture console ledger" },
        { kind: "network.clear", purpose: "Clear the fixture network ledger" }
      ]
    });
    assert.equal(batch.completed, 3);
    assert.equal(batch.failed, 0);
    assert.equal((await runtime.evidence.verify()).ok, true);
    assert.equal(
      lifecycleEvents.some((event) => event.type === "browser.session.created"),
      true
    );
    assert.equal(
      lifecycleEvents.some((event) => (
        event.type === "browser.action.completed"
        && event.receiptHash
      )),
      true
    );
    assert.equal(
      lifecycleEvents.some((event) => (
        event.type === "browser.evidence.recorded"
        && event.evidenceIds?.length
      )),
      true
    );
  }
);
