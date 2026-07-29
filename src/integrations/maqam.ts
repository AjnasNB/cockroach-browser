import { sha256 } from "../canonical.js";
import type { BrowserAction } from "../contracts.js";
import { CockroachBrowserError } from "../errors.js";
import {
  GOVERNANCE_DISPATCH,
  type GovernanceDispatch
} from "../internal-authority.js";
import type { BrowserRuntime } from "../runtime.js";

const EXECUTION_SCHEMA_VERSION = "maqam.browser-driver-execution.v1";
const PLAN_SCHEMA_VERSION = "maqam.browser-plan.v1";
const DEFAULT_TOOL_PREFIX = "browser";
const DEFAULT_IDEMPOTENCY_CAPACITY = 4_096;
const MAX_IDEMPOTENCY_CAPACITY = 16_384;
const MAX_ID_LENGTH = 256;
const MAX_PREFIX_LENGTH = 64;
const MAX_URL_LENGTH = 8_192;
const MAX_OPERATIONS = 100;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SAFE_PREFIX = /^[a-z][a-z0-9.-]*$/;
const SAFE_VALUE_REF = /^ref:[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SAFE_PLAN_TOKEN = /^v1\.[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{32,128}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

const PROHIBITED_BROWSER_EFFECTS = Object.freeze([
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
] as const);

const NO_EFFECTS = Object.freeze({
  externalProtocol: false,
  download: false,
  filesystemRead: false,
  filesystemWrite: false,
  filePicker: false,
  clipboardRead: false,
  clipboardWrite: false,
  permissionPrompt: false,
  printDialog: false,
  modalDialog: false
} as const);

export interface MaqamBrowserTarget {
  sessionId: string;
  pageId: string;
  origin: string;
  revision: string;
}

export interface MaqamBrowserExecution {
  schemaVersion: "maqam.browser-driver-execution.v1";
  runId: string;
  toolName: string;
  inputHash: string;
  approvalIds: readonly string[];
  approvalActions: readonly string[];
  authorizedOrigins: readonly string[];
  prohibitedEffects: readonly string[];
  signal: AbortSignal | null;
}

export type MaqamApplyOperation =
  | { kind: "setValueRef"; elementId: string; valueRef: string }
  | { kind: "selectOption"; elementId: string; optionId: string }
  | { kind: "setChecked"; elementId: string; checked: boolean };

export type MaqamSubmitOperation =
  | { kind: "activate" | "submitForm"; elementId: string; expectedOrigin: string; opensNewPage: boolean }
  | { kind: "navigate"; url: string; expectedOrigin: string; opensNewPage: boolean };

export interface MaqamBrowserPlan {
  schemaVersion: "maqam.browser-plan.v1";
  target: MaqamBrowserTarget;
  phase: "apply" | "submit";
  operations: readonly (MaqamApplyOperation | MaqamSubmitOperation)[];
  /**
   * Added and signed by Maqam after preview. Mutation dispatch rejects either
   * field when absent; they remain optional here because preview returns only
   * the unsigned plan core for Maqam to seal.
   */
  planHash?: string;
  planToken?: string;
}

type SealedMaqamBrowserPlan = MaqamBrowserPlan & {
  planHash: string;
  planToken: string;
};

export interface MaqamExecutionVerificationEnvelope {
  schemaVersion: "maqam.browser-driver-execution.v1";
  runId: string;
  toolName: string;
  inputHash: string;
  approvalIds: readonly string[];
  approvalActions: readonly string[];
  authorizedOrigins: readonly string[];
  prohibitedEffects: readonly string[];
}

export interface MaqamExecutionVerificationRequest {
  expectedToolName: string;
  expectedApprovalAction: string | null;
  execution: MaqamExecutionVerificationEnvelope;
}

export interface MaqamPlanTokenVerificationRequest {
  phase: "apply" | "submit";
  plan: MaqamBrowserPlan & { planHash: string; planToken: string };
  execution: MaqamExecutionVerificationEnvelope;
}

export interface MaqamBrowserDriverOptions {
  runtime: BrowserRuntime;
  resolveValueRef(reference: string): Promise<string>;
  /**
   * Verifies that the normalized execution envelope was issued by the trusted
   * Maqam authority. This must perform an authoritative lookup or signature
   * verification; returning true based only on field shape is unsafe.
   */
  verifyExecution(request: MaqamExecutionVerificationRequest): Promise<boolean>;
  /**
   * Verifies the signed token over the exact normalized plan and execution.
   * This callback is invoked before every mutation dispatch, including
   * idempotent retries.
   */
  verifyPlanToken(request: MaqamPlanTokenVerificationRequest): Promise<boolean>;
  maxElements?: number;
  toolPrefix?: string;
  /**
   * Maximum distinct runId:operationId records retained by this driver.
   * Capacity exhaustion fails closed instead of forgetting replay history.
   */
  maxIdempotencyEntries?: number;
}

type MutationResult = {
  operationId: string;
  target: MaqamBrowserTarget;
  effects: typeof NO_EFFECTS;
};

type ValidatedExecution = {
  runId: string;
  toolName: string;
  inputHash: string;
  approvalId?: string;
  approvalIds: readonly string[];
  approvalActions: readonly string[];
  authorizedOrigins: readonly string[];
  prohibitedEffects: readonly string[];
  signal: AbortSignal | null;
};

type IdempotencyEntry = {
  fingerprint: string;
  result: Promise<MutationResult>;
};

/**
 * Produces the four-method, host-owned driver expected by Maqam.
 * Lifecycle, login, profiles, secrets, and raw JavaScript remain outside this
 * adapter. Mutations enter BrowserRuntime only through its package-private
 * governance capability, so Maqam's consumed approval is not requested twice.
 */
export function createMaqamBrowserDriver(options: MaqamBrowserDriverOptions) {
  if (!options || typeof options !== "object") {
    throw new CockroachBrowserError("MAQAM_DRIVER_OPTIONS_INVALID", "Maqam browser driver options are required.");
  }
  if (typeof options.resolveValueRef !== "function") {
    throw new CockroachBrowserError(
      "MAQAM_VALUE_RESOLVER_REQUIRED",
      "Maqam browser integration requires a host-owned value reference resolver."
    );
  }
  if (typeof options.verifyExecution !== "function"
    || typeof options.verifyPlanToken !== "function") {
    throw new CockroachBrowserError(
      "MAQAM_VERIFIER_REQUIRED",
      "Maqam browser integration requires host-owned execution and plan-token verifiers."
    );
  }

  const toolPrefix = boundedString(
    options.toolPrefix ?? DEFAULT_TOOL_PREFIX,
    "toolPrefix",
    MAX_PREFIX_LENGTH,
    SAFE_PREFIX
  );
  const maxElements = boundedInteger(options.maxElements ?? 200, "maxElements", 1, 2_000);
  const maxIdempotencyEntries = boundedInteger(
    options.maxIdempotencyEntries ?? DEFAULT_IDEMPOTENCY_CAPACITY,
    "maxIdempotencyEntries",
    1,
    MAX_IDEMPOTENCY_CAPACITY
  );
  const idempotency = new Map<string, IdempotencyEntry>();

  const observe = async (
    request: { target: MaqamBrowserTarget; maxElements: number },
    execution: MaqamBrowserExecution
  ) => {
    const authority = assertExecution(execution, `${toolPrefix}.observe`);
    await verifyExecutionAuthority(
      options,
      authority,
      `${toolPrefix}.observe`,
      null
    );
    const target = normalizeTarget(request.target, "observe.target");
    assertAuthorizedOrigins(authority, [target.origin]);
    const requestedMaxElements = boundedInteger(
      request.maxElements,
      "observe.maxElements",
      1,
      maxElements
    );
    assertNotAborted(authority.signal);

    const snapshot = await options.runtime.snapshot(target.sessionId, target.pageId);
    assertTarget(target, snapshot.url, snapshot.digest);
    assertAuthorizedOrigins(authority, [new URL(snapshot.url).origin]);
    return {
      target: targetFrom(snapshot.sessionId, snapshot.tabId, snapshot.url, snapshot.digest),
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.refs.slice(0, requestedMaxElements).map((entry) => ({
        elementId: entry.ref,
        role: entry.role,
        name: entry.name,
        states: {
          ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
          ...(typeof entry.checked === "boolean" ? { checked: entry.checked } : {}),
          ...(entry.expanded === undefined ? {} : { expanded: entry.expanded }),
          ...(entry.valuePresent === undefined ? {} : { valuePresent: entry.valuePresent })
        }
      }))
    };
  };

  const preview = async (
    request: {
      target: MaqamBrowserTarget;
      phase: "apply" | "submit";
      operations: readonly (MaqamApplyOperation | MaqamSubmitOperation)[];
    },
    execution: MaqamBrowserExecution
  ) => {
    const authority = assertExecution(execution, `${toolPrefix}.preview`);
    await verifyExecutionAuthority(
      options,
      authority,
      `${toolPrefix}.preview`,
      null
    );
    const target = normalizeTarget(request.target, "preview.target");
    const phase = normalizePhase(request.phase, "preview.phase");
    const operations = normalizeOperations(request.operations, phase);
    assertPlanOrigins(authority, target, phase, operations);
    assertNotAborted(authority.signal);

    const snapshot = await options.runtime.snapshot(target.sessionId, target.pageId);
    assertTarget(target, snapshot.url, snapshot.digest);
    return {
      schemaVersion: "maqam.browser-plan.v1" as const,
      target: structuredClone(target),
      phase,
      operations: structuredClone(operations)
    };
  };

  const mutate = async (
    phase: "apply" | "submit",
    request: { plan: MaqamBrowserPlan; operationId: string },
    execution: MaqamBrowserExecution
  ): Promise<MutationResult> => {
    const expectedApproval = `effect:browser:${phase}`;
    const authority = assertExecution(
      execution,
      `${toolPrefix}.${phase}`,
      expectedApproval
    );
    const operationId = boundedIdentifier(request.operationId, `${phase}.operationId`);
    const plan = normalizePlan(request.plan, phase);
    assertPlanOrigins(authority, plan.target, phase, plan.operations);
    await verifyExecutionAuthority(
      options,
      authority,
      `${toolPrefix}.${phase}`,
      expectedApproval
    );
    await verifySealedPlanToken(options, phase, plan, authority);

    const idempotencyKey = `${authority.runId}:${operationId}`;
    const fingerprint = sha256({
      schemaVersion: "cockroach-browser.maqam-idempotency.v1",
      phase,
      operationId,
      plan,
      execution: {
        runId: authority.runId,
        toolName: authority.toolName,
        inputHash: authority.inputHash,
        approvalIds: authority.approvalIds,
        approvalActions: authority.approvalActions,
        authorizedOrigins: authority.authorizedOrigins,
        prohibitedEffects: authority.prohibitedEffects
      }
    });
    const prior = idempotency.get(idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new CockroachBrowserError(
          "MAQAM_IDEMPOTENCY_MISMATCH",
          "The same Maqam run and operation ID was reused with different approved input."
        );
      }
      return structuredClone(await prior.result);
    }
    if (idempotency.size >= maxIdempotencyEntries) {
      throw new CockroachBrowserError(
        "MAQAM_IDEMPOTENCY_CAPACITY_EXCEEDED",
        "The bounded Maqam idempotency ledger is full. Start a fresh host driver before accepting new operations."
      );
    }

    const pending = executeMutation(
      options,
      phase,
      operationId,
      plan,
      authority
    );
    // Retain both successful and failed operations. A failure may follow a
    // partial browser effect, so silently forgetting it would make retries unsafe.
    idempotency.set(idempotencyKey, { fingerprint, result: pending });
    return structuredClone(await pending);
  };

  return Object.freeze({
    observe,
    preview,
    apply: (request: { plan: MaqamBrowserPlan; operationId: string }, execution: MaqamBrowserExecution) =>
      mutate("apply", request, execution),
    submit: (request: { plan: MaqamBrowserPlan; operationId: string }, execution: MaqamBrowserExecution) =>
      mutate("submit", request, execution)
  });
}

async function executeMutation(
  options: MaqamBrowserDriverOptions,
  phase: "apply" | "submit",
  operationId: string,
  plan: SealedMaqamBrowserPlan,
  execution: ValidatedExecution
): Promise<MutationResult> {
  assertNotAborted(execution.signal);
  const before = await options.runtime.snapshot(plan.target.sessionId, plan.target.pageId);
  assertTarget(plan.target, before.url, before.digest);
  assertAuthorizedOrigins(execution, [new URL(before.url).origin]);

  for (const [operationIndex, operation] of plan.operations.entries()) {
    assertNotAborted(execution.signal);
    const action = phase === "apply"
      ? await actionForApply(options, plan.target, operation as MaqamApplyOperation)
      : actionForSubmit(plan.target, operation as MaqamSubmitOperation);
    await dispatchGovernedAction(
      options.runtime,
      plan.target,
      action,
      execution,
      phase,
      operationId,
      plan.planHash,
      operationIndex
    );
    const current = await options.runtime.snapshot(plan.target.sessionId, plan.target.pageId);
    assertAuthorizedOrigins(execution, [new URL(current.url).origin]);
  }

  const after = await options.runtime.snapshot(plan.target.sessionId, plan.target.pageId);
  assertAuthorizedOrigins(execution, [new URL(after.url).origin]);
  return {
    operationId,
    target: targetFrom(after.sessionId, after.tabId, after.url, after.digest),
    effects: NO_EFFECTS
  };
}

async function actionForApply(
  options: MaqamBrowserDriverOptions,
  target: MaqamBrowserTarget,
  operation: MaqamApplyOperation
): Promise<BrowserAction> {
  if (operation.kind === "setValueRef") {
    const value = await options.resolveValueRef(operation.valueRef);
    if (typeof value !== "string") {
      throw new CockroachBrowserError(
        "VALUE_REF_RESOLUTION_INVALID",
        "The host value resolver must return a string."
      );
    }
    return {
      kind: "fill",
      tabId: target.pageId,
      ref: operation.elementId,
      value,
      purpose: "Maqam-approved value application"
    };
  }
  if (operation.kind === "selectOption") {
    return {
      kind: "select",
      tabId: target.pageId,
      ref: operation.elementId,
      value: operation.optionId,
      purpose: "Maqam-approved option selection"
    };
  }
  return {
    kind: operation.checked ? "check" : "uncheck",
    tabId: target.pageId,
    ref: operation.elementId,
    purpose: "Maqam-approved checkbox update"
  };
}

function actionForSubmit(
  target: MaqamBrowserTarget,
  operation: MaqamSubmitOperation
): BrowserAction {
  if (operation.opensNewPage) {
    throw new CockroachBrowserError(
      "NEW_PAGE_SUBMIT_DENIED",
      "New-page submissions require a dedicated host workflow."
    );
  }
  if (operation.kind === "navigate") {
    return {
      kind: "navigate",
      tabId: target.pageId,
      url: operation.url,
      purpose: "Maqam-approved browser navigation"
    };
  }
  return {
    kind: "click",
    tabId: target.pageId,
    ref: operation.elementId,
    purpose: operation.kind === "submitForm"
      ? "Maqam-approved form submission"
      : "Maqam-approved activation"
  };
}

async function dispatchGovernedAction(
  runtime: BrowserRuntime,
  target: MaqamBrowserTarget,
  action: BrowserAction,
  execution: ValidatedExecution,
  phase: "apply" | "submit",
  operationId: string,
  planHash: string,
  operationIndex: number
): Promise<void> {
  if (!execution.approvalId) {
    throw new CockroachBrowserError(
      "MAQAM_APPROVAL_REQUIRED",
      `Maqam ${phase} execution did not carry its exact consumed approval.`
    );
  }
  const actionDigest = sha256(action);
  const governance: GovernanceDispatch = {
    authority: "maqam",
    approvalId: execution.approvalId,
    capabilityId: sha256({
      schemaVersion: "cockroach-browser.maqam-capability.v1",
      runId: execution.runId,
      operationId,
      phase,
      operationIndex,
      planHash,
      actionDigest
    }),
    actionDigest,
    executionDigest: execution.inputHash,
    authorizedOrigins: execution.authorizedOrigins,
    prohibitedEffects: execution.prohibitedEffects
  };
  await runtime[GOVERNANCE_DISPATCH](target.sessionId, action, governance);
}

function assertExecution(
  execution: MaqamBrowserExecution,
  expectedToolName: string,
  expectedApprovalAction?: string
): ValidatedExecution {
  if (!execution || typeof execution !== "object"
    || execution.schemaVersion !== EXECUTION_SCHEMA_VERSION) {
    throw new CockroachBrowserError(
      "MAQAM_EXECUTION_REQUIRED",
      "A valid Maqam driver execution is required."
    );
  }
  const runId = boundedIdentifier(execution.runId, "execution.runId");
  if (execution.toolName !== expectedToolName) {
    throw new CockroachBrowserError(
      "MAQAM_TOOL_MISMATCH",
      `Expected exact Maqam tool '${expectedToolName}'.`
    );
  }
  if (typeof execution.inputHash !== "string" || !SHA256_HEX.test(execution.inputHash)) {
    throw new CockroachBrowserError(
      "MAQAM_EXECUTION_INVALID",
      "Maqam execution must carry its raw 64-character input digest."
    );
  }
  if (!Array.isArray(execution.approvalIds) || !Array.isArray(execution.approvalActions)) {
    throw new CockroachBrowserError(
      "MAQAM_APPROVAL_INVALID",
      "Maqam approval IDs and actions must be arrays."
    );
  }
  const approvalIds = execution.approvalIds.map((entry, index) =>
    boundedIdentifier(entry, `execution.approvalIds[${index}]`));
  const approvalActions = execution.approvalActions.map((entry, index) =>
    boundedString(entry, `execution.approvalActions[${index}]`, MAX_ID_LENGTH, SAFE_ID));
  if (approvalIds.length !== approvalActions.length) {
    throw new CockroachBrowserError(
      "MAQAM_APPROVAL_INVALID",
      "Maqam approval IDs and approval actions must have matching positions."
    );
  }
  if (new Set(approvalIds).size !== approvalIds.length) {
    throw new CockroachBrowserError(
      "MAQAM_APPROVAL_INVALID",
      "Maqam approval IDs must be unique."
    );
  }

  let approvalId: string | undefined;
  if (expectedApprovalAction) {
    const matchingIndexes = approvalActions
      .map((action, index) => action === expectedApprovalAction ? index : -1)
      .filter((index) => index >= 0);
    if (matchingIndexes.length !== 1) {
      throw new CockroachBrowserError(
        "MAQAM_APPROVAL_REQUIRED",
        `Maqam execution requires exactly one consumed '${expectedApprovalAction}' approval.`
      );
    }
    approvalId = approvalIds[matchingIndexes[0] as number];
    const conflictingBrowserApproval = approvalActions.some((action) =>
      action.startsWith("effect:browser:") && action !== expectedApprovalAction);
    if (conflictingBrowserApproval) {
      throw new CockroachBrowserError(
        "MAQAM_APPROVAL_SCOPE_MISMATCH",
        "Maqam execution contains a browser approval for a different mutation phase."
      );
    }
  } else if (approvalActions.some((action) => action.startsWith("effect:browser:"))) {
    throw new CockroachBrowserError(
      "MAQAM_APPROVAL_SCOPE_MISMATCH",
      "Read-only Maqam browser methods cannot consume a browser mutation approval."
    );
  }

  const authorizedOrigins = normalizeOrigins(execution.authorizedOrigins);
  assertExactProhibitedEffects(execution.prohibitedEffects);
  if (execution.signal !== null
    && (typeof AbortSignal === "undefined" || !(execution.signal instanceof AbortSignal))) {
    throw new CockroachBrowserError(
      "MAQAM_EXECUTION_INVALID",
      "Maqam execution signal must be an AbortSignal or null."
    );
  }

  return {
    runId,
    toolName: expectedToolName,
    inputHash: execution.inputHash.toLowerCase(),
    ...(approvalId ? { approvalId } : {}),
    approvalIds: Object.freeze(approvalIds),
    approvalActions: Object.freeze(approvalActions),
    authorizedOrigins,
    prohibitedEffects: PROHIBITED_BROWSER_EFFECTS,
    signal: execution.signal
  };
}

async function verifyExecutionAuthority(
  options: MaqamBrowserDriverOptions,
  execution: ValidatedExecution,
  expectedToolName: string,
  expectedApprovalAction: string | null
): Promise<void> {
  const request: MaqamExecutionVerificationRequest = {
    expectedToolName,
    expectedApprovalAction,
    execution: verificationEnvelope(execution)
  };
  let verified = false;
  try {
    verified = await options.verifyExecution(structuredClone(request));
  } catch {
    throw new CockroachBrowserError(
      "MAQAM_EXECUTION_VERIFICATION_FAILED",
      "The host could not verify the Maqam execution authority."
    );
  }
  if (verified !== true) {
    throw new CockroachBrowserError(
      "MAQAM_EXECUTION_VERIFICATION_FAILED",
      "The host rejected the Maqam execution authority."
    );
  }
}

async function verifySealedPlanToken(
  options: MaqamBrowserDriverOptions,
  phase: "apply" | "submit",
  plan: SealedMaqamBrowserPlan,
  execution: ValidatedExecution
): Promise<void> {
  const request: MaqamPlanTokenVerificationRequest = {
    phase,
    plan: structuredClone(plan),
    execution: verificationEnvelope(execution)
  };
  let verified = false;
  try {
    verified = await options.verifyPlanToken(structuredClone(request));
  } catch {
    throw new CockroachBrowserError(
      "MAQAM_PLAN_TOKEN_VERIFICATION_FAILED",
      "The host could not verify the Maqam plan token."
    );
  }
  if (verified !== true) {
    throw new CockroachBrowserError(
      "MAQAM_PLAN_TOKEN_VERIFICATION_FAILED",
      "The host rejected the Maqam plan token."
    );
  }
}

function verificationEnvelope(
  execution: ValidatedExecution
): MaqamExecutionVerificationEnvelope {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    runId: execution.runId,
    toolName: execution.toolName,
    inputHash: execution.inputHash,
    approvalIds: [...execution.approvalIds],
    approvalActions: [...execution.approvalActions],
    authorizedOrigins: [...execution.authorizedOrigins],
    prohibitedEffects: [...execution.prohibitedEffects]
  };
}

function normalizePlan(
  value: MaqamBrowserPlan,
  expectedPhase: "apply" | "submit"
): SealedMaqamBrowserPlan {
  const record = ownDataRecord(
    value,
    "plan",
    ["schemaVersion", "target", "phase", "operations", "planHash", "planToken"]
  );
  if (record.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new CockroachBrowserError("MAQAM_PLAN_INVALID", "Maqam browser plan schema is invalid.");
  }
  const phase = normalizePhase(record.phase, "plan.phase");
  if (phase !== expectedPhase) {
    throw new CockroachBrowserError("MAQAM_PHASE_MISMATCH", `Expected ${expectedPhase} plan.`);
  }
  const target = normalizeTarget(record.target, "plan.target");
  const operations = normalizeOperations(record.operations, phase);
  const planHash = boundedString(record.planHash, "plan.planHash", 64, SHA256_HEX).toLowerCase();
  const planToken = boundedString(record.planToken, "plan.planToken", 256, SAFE_PLAN_TOKEN);
  const core = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    target,
    phase,
    operations
  } as const;
  const computedHash = sha256(core).slice("sha256:".length);
  if (computedHash !== planHash) {
    throw new CockroachBrowserError(
      "MAQAM_PLAN_HASH_MISMATCH",
      "Maqam plan hash does not match its canonical target, phase, and operations."
    );
  }
  return {
    ...core,
    planHash,
    planToken
  };
}

function normalizeOperations(
  value: unknown,
  phase: "apply" | "submit"
): readonly (MaqamApplyOperation | MaqamSubmitOperation)[] {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > MAX_OPERATIONS
    || (phase === "submit" && value.length !== 1)) {
    throw new CockroachBrowserError(
      "MAQAM_OPERATION_SHAPE_INVALID",
      phase === "submit"
        ? "Maqam submit plans require exactly one operation."
        : `Maqam apply plans require between 1 and ${MAX_OPERATIONS} operations.`
    );
  }
  return Object.freeze(value.map((operation, index) =>
    phase === "apply"
      ? normalizeApplyOperation(operation, index)
      : normalizeSubmitOperation(operation, index)));
}

function normalizeApplyOperation(value: unknown, index: number): MaqamApplyOperation {
  const base = ownDataRecord(value, `apply.operations[${index}]`, [
    "kind", "elementId", "valueRef", "optionId", "checked"
  ]);
  const elementId = boundedIdentifier(base.elementId, `apply.operations[${index}].elementId`);
  if (base.kind === "setValueRef") {
    assertExactKeys(base, `apply.operations[${index}]`, ["kind", "elementId", "valueRef"]);
    return {
      kind: "setValueRef",
      elementId,
      valueRef: boundedString(
        base.valueRef,
        `apply.operations[${index}].valueRef`,
        MAX_ID_LENGTH,
        SAFE_VALUE_REF
      )
    };
  }
  if (base.kind === "selectOption") {
    assertExactKeys(base, `apply.operations[${index}]`, ["kind", "elementId", "optionId"]);
    return {
      kind: "selectOption",
      elementId,
      optionId: boundedIdentifier(base.optionId, `apply.operations[${index}].optionId`)
    };
  }
  if (base.kind === "setChecked") {
    assertExactKeys(base, `apply.operations[${index}]`, ["kind", "elementId", "checked"]);
    if (typeof base.checked !== "boolean") {
      throw new CockroachBrowserError(
        "MAQAM_OPERATION_SHAPE_INVALID",
        `apply.operations[${index}].checked must be a boolean.`
      );
    }
    return { kind: "setChecked", elementId, checked: base.checked };
  }
  throw new CockroachBrowserError(
    "MAQAM_OPERATION_SHAPE_INVALID",
    `apply.operations[${index}] has an unsupported operation kind.`
  );
}

function normalizeSubmitOperation(value: unknown, index: number): MaqamSubmitOperation {
  const base = ownDataRecord(value, `submit.operations[${index}]`, [
    "kind", "elementId", "expectedOrigin", "opensNewPage", "url"
  ]);
  if (typeof base.opensNewPage !== "boolean") {
    throw new CockroachBrowserError(
      "MAQAM_OPERATION_SHAPE_INVALID",
      `submit.operations[${index}].opensNewPage must be a boolean.`
    );
  }
  const expectedOrigin = exactOrigin(
    base.expectedOrigin,
    `submit.operations[${index}].expectedOrigin`
  );
  if (base.kind === "navigate") {
    assertExactKeys(base, `submit.operations[${index}]`, [
      "kind", "url", "expectedOrigin", "opensNewPage"
    ]);
    const url = browserUrl(base.url, `submit.operations[${index}].url`);
    if (new URL(url).origin !== expectedOrigin) {
      throw new CockroachBrowserError(
        "MAQAM_ORIGIN_MISMATCH",
        "Maqam navigation URL and expected origin must match."
      );
    }
    return {
      kind: "navigate",
      url,
      expectedOrigin,
      opensNewPage: base.opensNewPage
    };
  }
  if (base.kind === "activate" || base.kind === "submitForm") {
    assertExactKeys(base, `submit.operations[${index}]`, [
      "kind", "elementId", "expectedOrigin", "opensNewPage"
    ]);
    return {
      kind: base.kind,
      elementId: boundedIdentifier(base.elementId, `submit.operations[${index}].elementId`),
      expectedOrigin,
      opensNewPage: base.opensNewPage
    };
  }
  throw new CockroachBrowserError(
    "MAQAM_OPERATION_SHAPE_INVALID",
    `submit.operations[${index}] has an unsupported operation kind.`
  );
}

function normalizeTarget(value: unknown, label: string): MaqamBrowserTarget {
  const target = ownDataRecord(value, label, ["sessionId", "pageId", "origin", "revision"]);
  assertExactKeys(target, label, ["sessionId", "pageId", "origin", "revision"]);
  return {
    sessionId: boundedIdentifier(target.sessionId, `${label}.sessionId`),
    pageId: boundedIdentifier(target.pageId, `${label}.pageId`),
    origin: exactOrigin(target.origin, `${label}.origin`),
    revision: boundedIdentifier(target.revision, `${label}.revision`)
  };
}

function targetFrom(sessionId: string, pageId: string, url: string, revision: string): MaqamBrowserTarget {
  return { sessionId, pageId, origin: new URL(url).origin, revision };
}

function assertTarget(target: MaqamBrowserTarget, url: string, revision: string): void {
  if (target.origin !== new URL(url).origin || target.revision !== revision) {
    throw new CockroachBrowserError(
      "STALE_BROWSER_TARGET",
      "The browser target changed after observation. Observe and preview again."
    );
  }
}

function assertPlanOrigins(
  execution: Pick<ValidatedExecution, "authorizedOrigins">,
  target: MaqamBrowserTarget,
  phase: "apply" | "submit",
  operations: readonly (MaqamApplyOperation | MaqamSubmitOperation)[]
): void {
  const origins = [target.origin];
  if (phase === "submit") {
    for (const operation of operations as readonly MaqamSubmitOperation[]) {
      origins.push(operation.expectedOrigin);
      if (operation.kind === "navigate") origins.push(new URL(operation.url).origin);
    }
  }
  assertAuthorizedOrigins(execution, origins);
}

function assertAuthorizedOrigins(
  execution: Pick<ValidatedExecution, "authorizedOrigins">,
  requiredOrigins: readonly string[]
): void {
  const authorized = new Set(execution.authorizedOrigins);
  for (const origin of requiredOrigins) {
    if (!authorized.has(exactOrigin(origin, "required origin"))) {
      throw new CockroachBrowserError(
        "MAQAM_ORIGIN_DENIED",
        "Maqam did not authorize every origin required by this browser operation."
      );
    }
  }
}

function normalizeOrigins(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new CockroachBrowserError(
      "MAQAM_ORIGIN_DENIED",
      "Maqam execution must authorize between 1 and 32 explicit origins."
    );
  }
  const origins = value.map((entry, index) => exactOrigin(entry, `execution.authorizedOrigins[${index}]`));
  if (new Set(origins).size !== origins.length) {
    throw new CockroachBrowserError(
      "MAQAM_ORIGIN_DENIED",
      "Maqam authorized origins must be canonical and unique."
    );
  }
  return Object.freeze(origins);
}

function assertExactProhibitedEffects(value: readonly string[]): void {
  if (!Array.isArray(value)
    || value.length !== PROHIBITED_BROWSER_EFFECTS.length
    || value.some((entry, index) => entry !== PROHIBITED_BROWSER_EFFECTS[index])) {
    throw new CockroachBrowserError(
      "MAQAM_EFFECT_BOUNDARY_MISMATCH",
      "Maqam execution must preserve the complete browser prohibited-effects boundary."
    );
  }
}

function exactOrigin(value: unknown, label: string): string {
  const input = boundedString(value, label, MAX_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("MAQAM_ORIGIN_INVALID", `${label} must be a valid origin.`);
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || input !== url.origin) {
    throw new CockroachBrowserError(
      "MAQAM_ORIGIN_INVALID",
      `${label} must be an exact credential-free HTTP(S) origin.`
    );
  }
  return url.origin;
}

function browserUrl(value: unknown, label: string): string {
  const input = boundedString(value, label, MAX_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("MAQAM_URL_INVALID", `${label} must be a valid URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new CockroachBrowserError(
      "MAQAM_URL_INVALID",
      `${label} must be a credential-free HTTP(S) URL.`
    );
  }
  return url.href;
}

function normalizePhase(value: unknown, label: string): "apply" | "submit" {
  if (value !== "apply" && value !== "submit") {
    throw new CockroachBrowserError("MAQAM_PHASE_MISMATCH", `${label} must be 'apply' or 'submit'.`);
  }
  return value;
}

function boundedIdentifier(value: unknown, label: string): string {
  return boundedString(value, label, MAX_ID_LENGTH, SAFE_ID);
}

function boundedString(
  value: unknown,
  label: string,
  maximumLength: number,
  pattern?: RegExp
): string {
  if (typeof value !== "string"
    || value.trim() === ""
    || value.length > maximumLength
    || value.includes("\u0000")
    || (pattern && !pattern.test(value))) {
    throw new CockroachBrowserError(
      "MAQAM_INPUT_INVALID",
      `${label} is missing, malformed, or exceeds its bound.`
    );
  }
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new CockroachBrowserError(
      "MAQAM_INPUT_INVALID",
      `${label} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return value as number;
}

function ownDataRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CockroachBrowserError("MAQAM_INPUT_INVALID", `${label} must be an object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.includes(key) || !("value" in descriptor)) {
      throw new CockroachBrowserError(
        "MAQAM_INPUT_INVALID",
        `${label} contains an unknown or accessor-backed field.`
      );
    }
    record[key] = descriptor.value;
  }
  return record;
}

function assertExactKeys(
  value: Record<string, unknown>,
  label: string,
  expectedKeys: readonly string[]
): void {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new CockroachBrowserError(
      "MAQAM_INPUT_INVALID",
      `${label} must contain exactly: ${expected.join(", ")}.`
    );
  }
}

function assertNotAborted(signal: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new CockroachBrowserError("ABORTED", "Maqam cancelled the browser operation.");
  }
}
