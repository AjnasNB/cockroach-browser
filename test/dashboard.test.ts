import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("dashboard renders measured session resources and limits", async () => {
  const context = await dashboardContext();
  const html = renderSessions(context, [{
    id: "session-a",
    purpose: "Measure the browser",
    state: "ready",
    mode: "headless",
    engine: "firefox",
    resources: {
      available: true,
      limitState: "exceeded",
      rssBytes: 512 * 1024 * 1024,
      maxProcessRssBytes: 1024 * 1024 * 1024,
      cpuTimeMs: 1_500,
      maxProcessCpuTimeMs: 3_600_000,
      processCount: 7,
      sampledAt: "2026-09-02T12:00:00.000Z"
    }
  }]);

  assert.match(html, /512\.0 MiB \/ 1\.00 GiB/);
  assert.match(html, /1\.5 s \/ 1\.00 h/);
  assert.match(html, />7</);
  assert.match(html, /data-state="exceeded"/);
  assert.match(html, /ready \/ headless \/ firefox/);
});

test("dashboard distinguishes unavailable telemetry from zero usage and escapes its reason", async () => {
  const context = await dashboardContext();
  const html = renderSessions(context, [{
    id: "session-b",
    state: "ready",
    mode: "headless",
    engine: "chromium",
    resources: {
      available: false,
      limitState: "unavailable",
      reason: "customer <script>alert(1)</script> owned"
    }
  }, {
    id: "old-daemon",
    state: "ready",
    mode: "headless",
    engine: "webkit"
  }]);

  assert.equal((html.match(/Resource sample unavailable/g) ?? []).length, 2);
  assert.match(html, /—/);
  assert.doesNotMatch(html, /0 B/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

async function dashboardContext(): Promise<vm.Context> {
  const source = await readFile("dashboard/app.js", "utf8");
  const context = vm.createContext({
    window: { location: { origin: "http://127.0.0.1:43110" } },
    document: {
      querySelector: () => null,
      querySelectorAll: () => []
    },
    HTMLInputElement: class HTMLInputElement {},
    fetch: globalThis.fetch
  });
  vm.runInContext(source, context, { filename: "dashboard/app.js" });
  return context;
}

function renderSessions(context: vm.Context, sessions: unknown[]): string {
  context.__sessions = sessions;
  return vm.runInContext("listSessions(__sessions, 'empty')", context) as string;
}
