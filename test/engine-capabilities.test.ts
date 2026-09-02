import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_CAPABILITY_IDS,
  ENGINE_CAPABILITY_MANIFEST,
  ACTION_ENGINE_CAPABILITIES,
  BROWSER_ENGINE_IDS,
  EngineCapabilityPreflightError,
  assertEngineCapabilities,
  assertEngineActions,
  engineCapabilitiesForAction,
  engineCapabilities,
  preflightEngineActions,
  preflightEngineCapabilities,
  type BrowserEngineId
} from "../src/engine-capabilities.js";
import { ACTION_KINDS } from "../src/contracts.js";

test("engine manifest is exhaustive and uses only explicit states", () => {
  const engines: BrowserEngineId[] = [...BROWSER_ENGINE_IDS];
  assert.deepEqual(Object.keys(ENGINE_CAPABILITY_MANIFEST), engines);
  for (const engine of engines) {
    const manifest = engineCapabilities(engine);
    assert.equal(manifest.id, engine);
    assert.deepEqual(Object.keys(manifest.capabilities), ENGINE_CAPABILITY_IDS);
    for (const capability of Object.values(manifest.capabilities)) {
      assert.match(capability.state, /^(supported|experimental|unsupported)$/);
      assert.ok(capability.note.length > 0);
    }
  }
});

test("bundled engines pass core portable requirements", () => {
  for (const engine of ["chromium", "firefox", "webkit"] as const) {
    const result = preflightEngineCapabilities({
      engine,
      required: ["transport.playwright", "page.navigation", "page.javascript", "page.dom", "capture.screenshot"]
    });
    assert.equal(result.ok, true, engine);
    assert.equal(result.unmet.length, 0);
  }
});

test("preflight exposes real bundled engine differences", () => {
  assert.equal(preflightEngineCapabilities({ engine: "chromium", required: ["transport.cdp", "capture.pdf"] }).ok, true);

  const firefox = preflightEngineCapabilities({ engine: "firefox", required: ["transport.cdp", "capture.pdf"] });
  assert.equal(firefox.ok, false);
  assert.deepEqual(firefox.unmet.map((entry) => [entry.capability, entry.state]), [
    ["transport.cdp", "unsupported"],
    ["capture.pdf", "unsupported"]
  ]);

  const webkit = preflightEngineCapabilities({ engine: "webkit", required: ["transport.puppeteer", "extensions.unpacked"] });
  assert.equal(webkit.ok, false);
  assert.equal(webkit.unmet.every((entry) => entry.state === "unsupported"), true);
});

test("experimental engines fail closed until callers explicitly opt in", () => {
  const required = ["transport.cdp", "page.navigation"] as const;
  const defaultResult = preflightEngineCapabilities({ engine: "obscura", required });
  assert.equal(defaultResult.ok, false);
  assert.equal(defaultResult.unmet.every((entry) => entry.state === "experimental"), true);

  const accepted = preflightEngineCapabilities({ engine: "obscura", required, allowExperimental: true });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.unmet.length, 0);
});

test("experimental opt-in never accepts an unsupported capability", () => {
  const result = preflightEngineCapabilities({
    engine: "lightpanda",
    required: ["page.navigation", { capability: "page.cors", purpose: "Load a cross-origin API" }],
    allowExperimental: true
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unmet.map((entry) => entry.capability), ["page.cors"]);
  assert.equal(result.unmet[0]?.purpose, "Load a cross-origin API");
});

test("requirements are deduplicated and assertion errors retain the preflight result", () => {
  const result = preflightEngineCapabilities({
    engine: "firefox",
    required: ["capture.pdf", "capture.pdf"]
  });
  assert.equal(result.checks.length, 1);

  assert.throws(
    () => assertEngineCapabilities({ engine: "firefox", required: [{ capability: "capture.pdf", purpose: "Create a PDF" }] }),
    (error) => {
      assert.ok(error instanceof EngineCapabilityPreflightError);
      assert.equal(error.code, "ENGINE_CAPABILITY_PREFLIGHT_FAILED");
      assert.equal(error.result.unmet[0]?.capability, "capture.pdf");
      assert.match(error.message, /capture\.pdf=unsupported \(Create a PDF\)/);
      return true;
    }
  );
});

test("preflight validates JavaScript callers at the boundary", () => {
  assert.throws(() => engineCapabilities("unknown" as BrowserEngineId), /Unknown browser engine/);
  assert.throws(
    () => preflightEngineCapabilities({
      engine: "chromium",
      required: ["unknown.capability" as typeof ENGINE_CAPABILITY_IDS[number]]
    }),
    /Unknown engine capability/
  );
  assert.throws(
    () => preflightEngineCapabilities({
      engine: "chromium",
      required: [{ capability: "page.navigation", purpose: " " }]
    }),
    /purposes must contain 1 to 512 characters/
  );
});

test("every bounded action has an explicit engine capability classification", () => {
  assert.deepEqual(Object.keys(ACTION_ENGINE_CAPABILITIES), ACTION_KINDS);
  for (const action of ACTION_KINDS) {
    assert.deepEqual(engineCapabilitiesForAction(action), ACTION_ENGINE_CAPABILITIES[action]);
  }
  assert.throws(() => engineCapabilitiesForAction("unknown" as typeof ACTION_KINDS[number]), /Unknown browser action/);
});

test("action preflight uses the exact lightweight provider and fails closed on experimental support", () => {
  const defaultResult = preflightEngineActions({ engine: "obscura", actions: ["navigate", "screenshot"] });
  assert.equal(defaultResult.ok, false);
  assert.equal(defaultResult.checks[0]?.capability, "runtime.owned_launch");
  assert.equal(defaultResult.checks[1]?.capability, "transport.cdp");
  assert.equal(defaultResult.unmet.every((entry) => entry.state === "experimental"), true);

  const optedIn = assertEngineActions({
    engine: "obscura",
    actions: ["navigate", "screenshot"],
    allowExperimental: true
  });
  assert.equal(optedIn.engine, "obscura");
  assert.equal(optedIn.ok, true);
});

test("unsupported lightweight actions are rejected even after experimental opt-in", () => {
  const result = preflightEngineActions({
    engine: "lightpanda",
    actions: ["navigate", "trace.start"],
    allowExperimental: true
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unmet.map((entry) => [entry.capability, entry.state]), [
    ["runtime.owned_launch", "unsupported"],
    ["evidence.trace", "unsupported"]
  ]);
  assert.throws(
    () => assertEngineActions({ engine: "lightpanda", actions: ["trace.stop"], allowExperimental: true }),
    EngineCapabilityPreflightError
  );
});

test("ordinary bundled engine action preflight remains supported", () => {
  for (const engine of ["chromium", "firefox", "webkit"] as const) {
    const result = assertEngineActions({ engine, actions: ["navigate", "fill", "snapshot", "screenshot"] });
    assert.equal(result.ok, true);
  }
});
