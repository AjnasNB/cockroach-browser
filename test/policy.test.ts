import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserAction, BrowserPolicy } from "../src/contracts.js";
import {
  assertUrlAllowed,
  assertUrlResolvedAllowed,
  clampBudget,
  effectForAction,
  evaluateAction,
  normalizePolicy,
  riskForAction
} from "../src/policy.js";

const PUBLIC_POLICY: BrowserPolicy = {
  allowedOrigins: ["https://example.com"],
  allowedActions: ["navigate", "snapshot", "click", "evaluate", "upload", "download"],
  allowedEffects: ["read", "write", "execute", "upload", "download"],
  requireApprovalFor: ["click", "evaluate"],
  budget: { maxActions: 10 }
};

test("normalizes origins and applies finite resource ceilings", () => {
  const normalized = normalizePolicy({
    ...PUBLIC_POLICY,
    allowedOrigins: ["https://EXAMPLE.com/path", "https://example.com/another"],
    budget: { maxActions: 50_000, maxTabs: 1 }
  });

  assert.deepEqual(normalized.allowedOrigins, ["https://example.com"]);
  assert.equal(normalized.budget.maxActions, 10_000);
  assert.equal(normalized.budget.maxTabs, 1);
  assert.equal(normalized.budget.maxNetworkEntries, 2_000);
  assert.equal(normalized.budget.maxClipboardBytes, 64 * 1024);
  assert.equal(normalized.budget.maxSavedStates, 64);
  assert.throws(
    () => clampBudget({ maxTabs: 0.5 }),
    (error: unknown) => hasCode(error, "INVALID_BUDGET")
  );
  assert.throws(
    () => clampBudget({ maxDurationMs: 0 }),
    (error: unknown) => hasCode(error, "INVALID_BUDGET")
  );
});

test("requires an explicit HTTP or HTTPS origin allowlist", () => {
  assert.throws(
    () => normalizePolicy({ allowedOrigins: [] }),
    (error: unknown) => hasCode(error, "ORIGIN_ALLOWLIST_REQUIRED")
  );
  assert.throws(
    () => normalizePolicy({ allowedOrigins: ["file:///tmp/example"] }),
    (error: unknown) => hasCode(error, "INVALID_ORIGIN")
  );
});

test("blocks undeclared origins and private-network destinations by default", () => {
  assert.equal(assertUrlAllowed(PUBLIC_POLICY, "https://example.com/report").origin, "https://example.com");
  assert.throws(
    () => assertUrlAllowed(PUBLIC_POLICY, "https://other.example/report"),
    (error: unknown) => hasCode(error, "ORIGIN_DENIED")
  );
  assert.throws(
    () =>
      assertUrlAllowed(
        { allowedOrigins: ["http://127.0.0.1:8080"] },
        "http://127.0.0.1:8080/health"
      ),
    (error: unknown) => hasCode(error, "PRIVATE_NETWORK_DENIED")
  );
  assert.equal(
    assertUrlAllowed(
      { allowedOrigins: ["http://127.0.0.1:8080"], allowPrivateNetwork: true },
      "http://127.0.0.1:8080/health"
    ).pathname,
    "/health"
  );
});

test("rejects private DNS answers and address changes before browser dispatch", async () => {
  const pins = new Map<string, readonly string[]>();
  await assert.rejects(
    assertUrlResolvedAllowed(
      PUBLIC_POLICY,
      "https://example.com/report",
      pins,
      async () => [{ address: "127.0.0.1" }]
    ),
    (error: unknown) => hasCode(error, "PRIVATE_NETWORK_DENIED")
  );

  await assertUrlResolvedAllowed(
    PUBLIC_POLICY,
    "https://example.com/report",
    pins,
    async () => [{ address: "8.8.8.8" }]
  );
  assert.deepEqual(pins.get("example.com"), ["8.8.8.8"]);

  await assert.rejects(
    assertUrlResolvedAllowed(
      PUBLIC_POLICY,
      "https://example.com/another",
      pins,
      async () => [{ address: "1.1.1.1" }]
    ),
    (error: unknown) => hasCode(error, "DNS_PIN_CHANGED")
  );
});

test("classifies effects and risk before dispatch", () => {
  assert.equal(effectForAction("snapshot"), "read");
  assert.equal(effectForAction("fill"), "write");
  assert.equal(effectForAction("evaluate"), "execute");
  assert.equal(effectForAction("upload"), "upload");
  assert.equal(effectForAction("cookies.read"), "credential");
  assert.equal(riskForAction("snapshot"), "low");
  assert.equal(riskForAction("navigate"), "medium");
  assert.equal(riskForAction("click"), "high");
  assert.equal(riskForAction("evaluate"), "critical");
  assert.equal(
    effectForAction({ kind: "click", ref: "r1", purpose: "Confirm", dialog: { action: "accept" } }),
    "write"
  );
  assert.equal(
    riskForAction({ kind: "click", ref: "r1", purpose: "Confirm", dialog: { action: "accept" } }),
    "high"
  );
});

test("denies optional high-authority surfaces until each is enabled", () => {
  const scriptDecision = decide(PUBLIC_POLICY, { kind: "evaluate", expression: "1 + 1" });
  assert.equal(scriptDecision.allowed, false);
  assert.match(scriptDecision.reason, /JavaScript is disabled/);

  const upload = decide(PUBLIC_POLICY, { kind: "upload", path: "file.txt" });
  assert.equal(upload.allowed, false);
  assert.match(upload.reason, /Uploads are disabled/);

  const download = decide(PUBLIC_POLICY, { kind: "download", ref: "r1" });
  assert.equal(download.allowed, false);
  assert.match(download.reason, /Downloads are disabled/);

  const dialog = decide(
    { ...PUBLIC_POLICY, allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "fill"] },
    { kind: "fill", selector: "#name", value: "Ajnas", dialog: { action: "accept" } }
  );
  assert.equal(dialog.allowed, false);
  assert.match(dialog.reason, /Dialog acceptance is disabled/);

  const networkRoute = decide(
    {
      ...PUBLIC_POLICY,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "network.route.add"]
    },
    {
      kind: "network.route.add",
      route: {
        origin: "https://example.com",
        pathPattern: "/api/**",
        response: { action: "abort" }
      }
    }
  );
  assert.equal(networkRoute.allowed, false);
  assert.match(networkRoute.reason, /Network interception is disabled/);

  const clipboard = decide(
    {
      ...PUBLIC_POLICY,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "clipboard.read"],
      allowedEffects: [...(PUBLIC_POLICY.allowedEffects ?? []), "credential"]
    },
    { kind: "clipboard.read" }
  );
  assert.equal(clipboard.allowed, false);
  assert.match(clipboard.reason, /Clipboard access is disabled/);

  const state = decide(
    {
      ...PUBLIC_POLICY,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "state.save"],
      allowedEffects: [...(PUBLIC_POLICY.allowedEffects ?? []), "credential"]
    },
    { kind: "state.save", stateName: "release", passphraseRef: "ref:passphrase" }
  );
  assert.equal(state.allowed, false);
  assert.match(state.reason, /browser-state management is disabled/);

  const annotations = decide(
    {
      ...PUBLIC_POLICY,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "annotate.show"]
    },
    { kind: "annotate.show" }
  );
  assert.equal(annotations.allowed, false);
  assert.match(annotations.reason, /annotations are disabled/i);

  const emulation = decide(
    {
      ...PUBLIC_POLICY,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "emulation.set"]
    },
    { kind: "emulation.set", emulation: { offline: true } }
  );
  assert.equal(emulation.allowed, false);
  assert.match(emulation.reason, /emulation is disabled/i);
});

test("marks configured mutations for exact approval", () => {
  const decision = evaluateAction(
    { ...PUBLIC_POLICY, allowJavaScript: true },
    { kind: "click", ref: "r1", purpose: "Submit the reviewed form" }
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.effect, "write");
  assert.equal(decision.risk, "high");
  assert.equal(decision.requiresApproval, true);
  assert.match(decision.digest, /^sha256:[a-f0-9]{64}$/);
});

test("dialog acceptance and route mutations remain approval-bound after explicit opt-in", () => {
  const dialog = decide(
    {
      ...PUBLIC_POLICY,
      allowDialogAccept: true,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "fill"],
      requireApprovalFor: []
    },
    { kind: "fill", selector: "#name", value: "Ajnas", dialog: { action: "accept" } }
  );
  assert.equal(dialog.allowed, true);
  assert.equal(dialog.requiresApproval, true);

  const networkRoute = decide(
    {
      ...PUBLIC_POLICY,
      allowNetworkInterception: true,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "network.route.add"],
      requireApprovalFor: ["network.route.add"]
    },
    {
      kind: "network.route.add",
      route: {
        origin: "https://example.com",
        pathPattern: "/api/**",
        response: { action: "abort" }
      }
    }
  );
  assert.equal(networkRoute.allowed, true);
  assert.equal(networkRoute.effect, "write");
  assert.equal(networkRoute.risk, "critical");
  assert.equal(networkRoute.requiresApproval, true);
});

test("emulation remains approval-bound after explicit opt-in", () => {
  const decision = decide(
    {
      ...PUBLIC_POLICY,
      allowEmulation: true,
      allowedActions: [...(PUBLIC_POLICY.allowedActions ?? []), "emulation.set"],
      requireApprovalFor: ["emulation.set"]
    },
    { kind: "emulation.set", emulation: { viewport: { width: 1280, height: 720 }, offline: false } }
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.effect, "write");
  assert.equal(decision.risk, "critical");
  assert.equal(decision.requiresApproval, true);
});

function decide(policy: BrowserPolicy, action: Omit<BrowserAction, "purpose">) {
  return evaluateAction(policy, { ...action, purpose: "test" } as BrowserAction);
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}
