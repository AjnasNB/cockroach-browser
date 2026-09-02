import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserRuntime } from "../src/runtime.js";

test(
  "the bounded runtime completes an owned lightweight DOM workflow",
  {
    skip: !process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_BINARY,
    timeout: 60_000
  },
  async (t) => {
    let deniedRequests = 0;
    const deniedFixture = createServer((_request, response) => {
      deniedRequests += 1;
      response.end("This origin must remain unreachable.");
    });
    await new Promise<void>((resolve) => deniedFixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => deniedFixture.close((error) => error ? reject(error) : resolve())));
    const deniedAddress = deniedFixture.address();
    assert(deniedAddress && typeof deniedAddress === "object");
    const deniedOrigin = `http://127.0.0.1:${deniedAddress.port}`;
    const fixture = createServer((_request, response) => {
      const body = `<!doctype html>
        <html lang="en">
          <head>
            <title>Owned lightweight runtime</title>
            <meta name="description" content="Bounded runtime proof">
          </head>
          <body>
            <main>
              <h1>Owned lightweight runtime</h1>
              <label>Name <input id="name" value="before"></label>
              <button id="save" onclick="document.querySelector('output').textContent=document.querySelector('#name').value">Save</button>
              <output>idle</output>
              <script>fetch(${JSON.stringify(`${deniedOrigin}/must-be-blocked`)}).catch(() => undefined)</script>
            </main>
          </body>
        </html>`;
      response.writeHead(200, {
        "connection": "close",
        "content-length": Buffer.byteLength(body),
        "content-type": "text/html; charset=utf-8"
      });
      response.end(body);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
    const address = fixture.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const root = await mkdtemp(join(tmpdir(), "cockroach-lightweight-runtime-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const runtime = new BrowserRuntime({ root });
    await runtime.initialize();
    t.after(() => runtime.close());

    const expectedSha256 = process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_SHA256;
    const implementation = (process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_IMPLEMENTATION ?? "obscura") as "obscura" | "lightpanda";
    const session = await runtime.createSession({
      startUrl: origin,
      purpose: "Exercise the owned lightweight runtime boundary",
      browserProvider: {
        kind: "lightweight",
        implementation,
        executablePath: process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_BINARY!,
        rendering: "none",
        allowExperimentalCapabilities: true,
        ...(expectedSha256 ? { expectedSha256 } : {})
      },
      policy: {
        allowedOrigins: [origin],
        allowPrivateNetwork: true,
        allowedActions: ["snapshot", "wait", "fill", "click", "extract.structured"],
        allowedEffects: ["read", "write"],
        requireApprovalFor: []
      }
    });
    assert.deepEqual(session.provider, {
      kind: "lightweight",
      ownership: "runtime-owned",
      implementation,
      rendering: "none",
      resourceProfile: "standard",
      maturity: "experimental"
    });
    assert.equal(session.resources.available, true);
    assert.equal(session.resources.ownership, "runtime-owned");
    assert.ok((session.resources.rssBytes ?? 0) > 0);

    await runtime.act(session.id, {
      kind: "wait",
      timeoutMs: 3_000,
      purpose: "Allow the independent engine to complete its asynchronous local navigation"
    });
    const initial = await runtime.snapshot(session.id);
    // Obscura 0.2.1 retains a synthetic Playwright Page.title() while Fetch
    // interception is active; the semantic DOM is the conformance boundary.
    assert.match(initial.text, /Owned lightweight runtime/);
    assert.equal(deniedRequests, 0, "the engine-wide private-network opt-in must not bypass the exact-origin route boundary");
    const input = initial.refs.find((entry) => entry.role === "textbox");
    const button = initial.refs.find((entry) => entry.role === "button");
    assert(input);
    assert(button);
    await runtime.act(session.id, {
      kind: "fill",
      ref: input.ref,
      value: "after",
      purpose: "Exercise explicit non-visual form fill semantics"
    });
    await runtime.act(session.id, {
      kind: "click",
      ref: button.ref,
      purpose: "Exercise explicit non-visual DOM activation semantics"
    });
    assert.match((await runtime.snapshot(session.id)).text, /after/);

    const extraction = await runtime.act(session.id, {
      kind: "extract.structured",
      purpose: "Extract bounded structured evidence from the fixture",
      extraction: { maxTotalChars: 8_192, maxLinks: 8, maxTables: 4 }
    });
    const structured = extraction.output as {
      text: string;
      metadata: Array<{ name: string; content: string }>;
    };
    assert.match(structured.text, /after/);
    assert.deepEqual(
      structured.metadata.find((entry) => entry.name === "title"),
      { name: "title", content: "Owned lightweight runtime" }
    );
    await runtime.closeSession(session.id);
    await assert.rejects(runtime.session(session.id), /not found/i);
  }
);
