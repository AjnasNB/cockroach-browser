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

function decide(policy: BrowserPolicy, action: Omit<BrowserAction, "purpose">) {
  return evaluateAction(policy, { ...action, purpose: "test" } as BrowserAction);
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}
