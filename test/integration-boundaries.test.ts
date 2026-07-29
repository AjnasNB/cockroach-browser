import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../src/canonical.js";
import type { ActionReceipt, PageSnapshot } from "../src/contracts.js";
import { GOVERNANCE_DISPATCH } from "../src/internal-authority.js";
import type { BrowserRuntime } from "../src/runtime.js";
import {
  createMaqamBrowserDriver,
  type MaqamBrowserDriverOptions,
  type MaqamBrowserExecution,
  type MaqamExecutionVerificationRequest,
  type MaqamBrowserPlan,
  type MaqamPlanTokenVerificationRequest,
  type MaqamBrowserTarget
} from "../src/integrations/maqam.js";
import {
  createQarinahContextRecorder,
  receiptToQarinahMetadata
} from "../src/integrations/qarinah.js";

const SNAPSHOT: PageSnapshot = {
  sessionId: "session-a",
  tabId: "page-a",
  url: "https://example.com/form",
  title: "Example",
  capturedAt: "2026-07-29T00:00:00.000Z",
  text: "Name Submit",
  refs: [
    { ref: "name", role: "textbox", name: "Name", tag: "input" },
    { ref: "submit", role: "button", name: "Submit", tag: "button" }
  ],
  digest: `sha256:${"a".repeat(64)}`,
  truncated: false
};

const TARGET: MaqamBrowserTarget = {
  sessionId: SNAPSHOT.sessionId,
  pageId: SNAPSHOT.tabId,
  origin: "https://example.com",
  revision: SNAPSHOT.digest
};

const PROHIBITED_EFFECTS = [
  "external-protocol",
  "download",
  "filesystem-read",
  "filesystem-write",
  "file-picker",
  "clipboard-read",
  "clipboard-write",
  "permission-prompt",
  "print-dialog",
  "modal-dialog"
] as const;

test("requires host-owned Maqam authority verifiers at construction", () => {
  assert.throws(
    () => createMaqamBrowserDriver({
      runtime: fakeRuntime([]),
      resolveValueRef: async () => ""
    } as unknown as MaqamBrowserDriverOptions),
    (error: unknown) => hasCode(error, "MAQAM_VERIFIER_REQUIRED")
  );
});

test("exposes only Maqam observe, preview, apply, and submit surfaces", async () => {
  const actions: unknown[] = [];
  const driver = createMaqamBrowserDriver(trustedDriverOptions({
    runtime: fakeRuntime(actions),
    resolveValueRef: async (reference) => reference === "ref:name" ? "Ajnas" : ""
  }));

  assert.deepEqual(Object.keys(driver).sort(), ["apply", "observe", "preview", "submit"]);
  assert.equal("createSession" in driver, false);
  assert.equal("evaluate" in driver, false);
  assert.equal("profile" in driver, false);

  const observation = await driver.observe(
    { target: TARGET, maxElements: 20 },
    executionFor("browser.observe")
  );
  assert.equal(observation.elements.length, 2);
  assert.equal(observation.elements[0]?.elementId, "name");
});

test("binds read methods to an exact tool, canonical origins, and complete effect boundary", async () => {
  const driver = createMaqamBrowserDriver(trustedDriverOptions({
    runtime: fakeRuntime([]),
    resolveValueRef: async () => ""
  }));

  await assert.rejects(
    driver.observe(
      { target: TARGET, maxElements: 20 },
      executionFor("browser.observe", { inputHash: "not-a-hash" })
    ),
    (error: unknown) => hasCode(error, "MAQAM_EXECUTION_INVALID")
  );

  await assert.rejects(
    driver.observe(
      { target: TARGET, maxElements: 20 },
      executionFor("browser.preview")
    ),
    (error: unknown) => hasCode(error, "MAQAM_TOOL_MISMATCH")
  );

  await assert.rejects(
    driver.observe(
      { target: TARGET, maxElements: 20 },
      executionFor("browser.observe", { prohibitedEffects: PROHIBITED_EFFECTS.slice(1) })
    ),
    (error: unknown) => hasCode(error, "MAQAM_EFFECT_BOUNDARY_MISMATCH")
  );

  await assert.rejects(
    driver.preview(
      {
        target: { ...TARGET, origin: "https://example.com/path" },
        phase: "apply",
        operations: [{ kind: "setChecked", elementId: "name", checked: true }]
      },
      executionFor("browser.preview")
    ),
    (error: unknown) => hasCode(error, "MAQAM_ORIGIN_INVALID")
  );

  await assert.rejects(
    driver.preview(
      {
        target: TARGET,
        phase: "submit",
        operations: [{
          kind: "navigate",
          url: "https://other.example/action",
          expectedOrigin: "https://other.example",
          opensNewPage: false
        }]
      },
      executionFor("browser.preview")
    ),
    (error: unknown) => hasCode(error, "MAQAM_ORIGIN_DENIED")
  );
});

test("requires opaque value references before Maqam resolves a form value", async () => {
  let resolved = false;
  const driver = createMaqamBrowserDriver(trustedDriverOptions({
    runtime: fakeRuntime([]),
    resolveValueRef: async () => {
      resolved = true;
      return "secret";
    }
  }));
  await assert.rejects(
    driver.preview(
      {
        target: TARGET,
        phase: "apply",
        operations: [{ kind: "setValueRef", elementId: "name", valueRef: "plaintext" }]
      },
      executionFor("browser.preview")
    ),
    (error: unknown) => hasCode(error, "MAQAM_INPUT_INVALID")
  );
  assert.equal(resolved, false);
});

test("fails closed when execution verification returns false or throws", async () => {
  const rejected = createMaqamBrowserDriver({
    runtime: fakeRuntime([]),
    resolveValueRef: async () => "",
    verifyExecution: async () => false,
    verifyPlanToken: async () => true
  });
  await assert.rejects(
    rejected.observe(
      { target: TARGET, maxElements: 20 },
      executionFor("browser.observe")
    ),
    (error: unknown) => hasCode(error, "MAQAM_EXECUTION_VERIFICATION_FAILED")
  );

  const unavailable = createMaqamBrowserDriver({
    runtime: fakeRuntime([]),
    resolveValueRef: async () => "",
    verifyExecution: async () => {
      throw new Error("authority service unavailable");
    },
    verifyPlanToken: async () => true
  });
  await assert.rejects(
    unavailable.preview(
      {
        target: TARGET,
        phase: "apply",
        operations: [{ kind: "setChecked", elementId: "name", checked: true }]
      },
      executionFor("browser.preview")
    ),
    (error: unknown) => hasCode(error, "MAQAM_EXECUTION_VERIFICATION_FAILED")
  );
});

test("passes exact normalized envelopes to verifiers and rejects forged plan tokens", async () => {
  const executionRequests: MaqamExecutionVerificationRequest[] = [];
  const planRequests: MaqamPlanTokenVerificationRequest[] = [];
  const dispatches: unknown[] = [];
  const trustedPlanToken = `v1.${"t".repeat(16)}.${"s".repeat(32)}`;
  const driver = createMaqamBrowserDriver({
    runtime: fakeRuntime(dispatches),
    resolveValueRef: async () => "",
    async verifyExecution(request) {
      executionRequests.push(structuredClone(request));
      return true;
    },
    async verifyPlanToken(request) {
      planRequests.push(structuredClone(request));
      return request.plan.planToken === trustedPlanToken;
    }
  });
  const preview = await driver.preview(
    {
      target: TARGET,
      phase: "apply",
      operations: [{ kind: "setChecked", elementId: "name", checked: true }]
    },
    executionFor("browser.preview", { inputHash: "B".repeat(64) })
  );
  const sealed = {
    ...sealPlan(preview),
    planToken: trustedPlanToken
  };
  const applyExecution = executionFor("browser.apply", {
    inputHash: "C".repeat(64),
    approvalIds: ["approval-a"],
    approvalActions: ["effect:browser:apply"]
  });

  await assert.rejects(
    driver.apply(
      {
        plan: {
          ...sealed,
          planToken: `v1.${"f".repeat(16)}.${"g".repeat(32)}`
        },
        operationId: "operation-forged-token"
      },
      applyExecution
    ),
    (error: unknown) => hasCode(error, "MAQAM_PLAN_TOKEN_VERIFICATION_FAILED")
  );
  assert.equal(dispatches.length, 0);

  await driver.apply(
    { plan: sealed, operationId: "operation-trusted-token" },
    applyExecution
  );
  assert.equal(dispatches.length, 1);
  assert.deepEqual(executionRequests.map((request) => ({
    expectedToolName: request.expectedToolName,
    expectedApprovalAction: request.expectedApprovalAction,
    inputHash: request.execution.inputHash
  })), [
    {
      expectedToolName: "browser.preview",
      expectedApprovalAction: null,
      inputHash: "b".repeat(64)
    },
    {
      expectedToolName: "browser.apply",
      expectedApprovalAction: "effect:browser:apply",
      inputHash: "c".repeat(64)
    },
    {
      expectedToolName: "browser.apply",
      expectedApprovalAction: "effect:browser:apply",
      inputHash: "c".repeat(64)
    }
  ]);
  assert.equal(planRequests.length, 2);
  assert.equal(planRequests[0]?.plan.planToken.startsWith("v1.ffffffffffffffff."), true);
  assert.equal(planRequests[1]?.plan.planToken, trustedPlanToken);
  assert.equal(planRequests[1]?.plan.planHash, sealed.planHash);
  assert.deepEqual(planRequests[1]?.execution.approvalActions, ["effect:browser:apply"]);
  assert.deepEqual(planRequests[1]?.execution.authorizedOrigins, ["https://example.com"]);
  assert.deepEqual(planRequests[1]?.execution.prohibitedEffects, PROHIBITED_EFFECTS);
});

test("fails closed when the plan-token verifier throws", async () => {
  const driver = createMaqamBrowserDriver({
    runtime: fakeRuntime([]),
    resolveValueRef: async () => "",
    verifyExecution: async () => true,
    verifyPlanToken: async () => {
      throw new Error("signature backend unavailable");
    }
  });
  const preview = await driver.preview(
    {
      target: TARGET,
      phase: "apply",
      operations: [{ kind: "setChecked", elementId: "name", checked: true }]
    },
    executionFor("browser.preview")
  );
  await assert.rejects(
    driver.apply(
      { plan: sealPlan(preview), operationId: "operation-verifier-throw" },
      executionFor("browser.apply", {
        approvalIds: ["approval-a"],
        approvalActions: ["effect:browser:apply"]
      })
    ),
    (error: unknown) => hasCode(error, "MAQAM_PLAN_TOKEN_VERIFICATION_FAILED")
  );
});

test("requires a sealed plan and an exact phase approval before private dispatch", async () => {
  const dispatches: unknown[] = [];
  const driver = createMaqamBrowserDriver(trustedDriverOptions({
    runtime: fakeRuntime(dispatches),
    resolveValueRef: async () => "Ajnas"
  }));
  const preview = await driver.preview(
    {
      target: TARGET,
      phase: "apply",
      operations: [{ kind: "setValueRef", elementId: "name", valueRef: "ref:name" }]
    },
    executionFor("browser.preview")
  );

  await assert.rejects(
    driver.apply(
      { plan: preview, operationId: "operation-unsealed" },
      executionFor("browser.apply", {
        approvalIds: ["approval-a"],
        approvalActions: ["effect:browser:apply"]
      })
    ),
    (error: unknown) => hasCode(error, "MAQAM_INPUT_INVALID")
  );

  const plan = sealPlan(preview);
  await assert.rejects(
    driver.apply(
      { plan, operationId: "operation-no-approval" },
      executionFor("browser.apply")
    ),
    (error: unknown) => hasCode(error, "MAQAM_APPROVAL_REQUIRED")
  );
  await assert.rejects(
    driver.apply(
      { plan, operationId: "operation-wrong-tool" },
      executionFor("browser.submit", {
        approvalIds: ["approval-a"],
        approvalActions: ["effect:browser:apply"]
      })
    ),
    (error: unknown) => hasCode(error, "MAQAM_TOOL_MISMATCH")
  );
  await assert.rejects(
    driver.apply(
      { plan, operationId: "operation-conflict" },
      executionFor("browser.apply", {
        approvalIds: ["approval-a", "approval-b"],
        approvalActions: ["effect:browser:apply", "effect:browser:submit"]
      })
    ),
    (error: unknown) => hasCode(error, "MAQAM_APPROVAL_SCOPE_MISMATCH")
  );

  const result = await driver.apply(
    { plan, operationId: "operation-valid" },
    executionFor("browser.apply", {
      approvalIds: ["approval-a"],
      approvalActions: ["effect:browser:apply"]
    })
  );
  assert.equal(result.operationId, "operation-valid");
  assert.equal(dispatches.length, 1);
  const serialized = JSON.stringify(dispatches[0]);
  assert.match(serialized, /Maqam-approved value application/);
  assert.match(serialized, /"authority":"maqam"/);
  assert.match(serialized, /"approvalId":"approval-a"/);
  assert.match(serialized, /"capabilityId":"sha256:/);
});

test("verifies the canonical plan hash and fails closed on idempotency reuse", async () => {
  const dispatches: unknown[] = [];
  const driver = createMaqamBrowserDriver(trustedDriverOptions({
    runtime: fakeRuntime(dispatches),
    resolveValueRef: async () => ""
  }));
  const preview = await driver.preview(
    {
      target: TARGET,
      phase: "apply",
      operations: [{ kind: "setChecked", elementId: "name", checked: true }]
    },
    executionFor("browser.preview")
  );
  const plan = sealPlan(preview);
  const execution = executionFor("browser.apply", {
    approvalIds: ["approval-a"],
    approvalActions: ["effect:browser:apply"]
  });

  await assert.rejects(
    driver.apply(
      {
        plan: { ...plan, planHash: "0".repeat(64) },
        operationId: "operation-bad-hash"
      },
      execution
    ),
    (error: unknown) => hasCode(error, "MAQAM_PLAN_HASH_MISMATCH")
  );

  const first = await driver.apply({ plan, operationId: "operation-once" }, execution);
  const replay = await driver.apply({ plan, operationId: "operation-once" }, execution);
  assert.deepEqual(replay, first);
  assert.equal(dispatches.length, 1);

  const changedExecution = executionFor("browser.apply", {
    inputHash: "c".repeat(64),
    approvalIds: ["approval-a"],
    approvalActions: ["effect:browser:apply"]
  });
  await assert.rejects(
    driver.apply({ plan, operationId: "operation-once" }, changedExecution),
    (error: unknown) => hasCode(error, "MAQAM_IDEMPOTENCY_MISMATCH")
  );
  assert.equal(dispatches.length, 1);
});

test("Qarinah receives cited outcome metadata without nested secrets or form values", async () => {
  const captured: unknown[] = [];
  const recorder = createQarinahContextRecorder({
    async appendBrowserOutcome(event) {
      captured.push(event);
    }
  });
  await recorder.record({
    type: "browser.action",
    sessionId: "session-a",
    purpose: "Update an approved setting",
    timestamp: "2026-07-29T00:00:00.000Z",
    evidenceIds: ["ev-a"],
    metadata: {
      unreviewedRoute: "/settings",
      token: "top-level-secret",
      mode: {
        authorization: "Bearer nested-secret",
        headers: { "api-key": "nested-api-key", accept: "application/json" },
        fields: [{ name: "displayName", formValue: "must-not-leak" }]
      },
    }
  });

  const serialized = JSON.stringify(captured);
  assert.doesNotMatch(serialized, /top-level-secret|nested-secret|nested-api-key|must-not-leak/);
  assert.doesNotMatch(serialized, /unreviewedRoute|\/settings/);
  assert.match(serialized, /application\/json/);
  assert.match(serialized, /"evidenceIds":\["ev-a"\]/);
});

test("receipt projection is descriptive and never grants dispatch authority", () => {
  const receipt: ActionReceipt = {
    id: "receipt-a",
    sessionId: "session-a",
    action: "click",
    effect: "write",
    risk: "high",
    purpose: "Submit approved change",
    inputDigest: "input",
    outputDigest: "output",
    policyDigest: "policy",
    approvalId: "approval-a",
    startedAt: "2026-07-29T00:00:00.000Z",
    completedAt: "2026-07-29T00:00:00.001Z",
    durationMs: 1,
    status: "succeeded",
    evidenceIds: ["ev-a"],
    receiptHash: "receipt-hash"
  };
  const metadata = receiptToQarinahMetadata(receipt);
  assert.equal(metadata.status, "succeeded");
  assert.equal(metadata.receiptHash, "receipt-hash");
  assert.equal("approvalId" in metadata, false);
  assert.equal("dispatch" in metadata, false);
});

function fakeRuntime(actions: unknown[]): BrowserRuntime {
  return {
    snapshot: async () => structuredClone(SNAPSHOT),
    [GOVERNANCE_DISPATCH]: async (
      sessionId: string,
      action: unknown,
      governance: unknown
    ) => {
      actions.push(structuredClone({ sessionId, action, governance }));
      return { ok: true };
    }
  } as unknown as BrowserRuntime;
}

function trustedDriverOptions(
  options: Pick<MaqamBrowserDriverOptions, "runtime" | "resolveValueRef">
): MaqamBrowserDriverOptions {
  return {
    ...options,
    verifyExecution: async () => true,
    verifyPlanToken: async () => true
  };
}

function executionFor(
  toolName: string,
  overrides: Partial<MaqamBrowserExecution> = {}
): MaqamBrowserExecution {
  return {
    schemaVersion: "maqam.browser-driver-execution.v1",
    runId: "run-a",
    toolName,
    inputHash: "b".repeat(64),
    approvalIds: [],
    approvalActions: [],
    authorizedOrigins: ["https://example.com"],
    prohibitedEffects: PROHIBITED_EFFECTS,
    signal: null,
    ...overrides
  };
}

function sealPlan(
  plan: Omit<MaqamBrowserPlan, "planHash" | "planToken">
): MaqamBrowserPlan {
  const planHash = sha256({
    schemaVersion: plan.schemaVersion,
    target: plan.target,
    phase: plan.phase,
    operations: plan.operations
  }).slice("sha256:".length);
  return {
    ...plan,
    planHash,
    planToken: `v1.${"a".repeat(16)}.${"b".repeat(32)}`
  };
}

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}
