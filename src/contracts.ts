export const ACTION_KINDS = [
  "navigate",
  "back",
  "forward",
  "reload",
  "click",
  "doubleClick",
  "fill",
  "type",
  "press",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "scroll",
  "drag",
  "upload",
  "download",
  "evaluate",
  "wait",
  "screenshot",
  "pdf",
  "snapshot",
  "extract",
  "cookies.read",
  "cookies.write",
  "storage.read",
  "storage.write",
  "tab.open",
  "tab.close",
  "tab.switch",
  "trace.start",
  "trace.stop"
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Effect = "read" | "write" | "execute" | "upload" | "download" | "credential";
export type BrowserMode = "headless" | "headed";
export type SessionState = "starting" | "ready" | "challenge" | "closed" | "failed";

export interface ResourceBudget {
  maxActions: number;
  maxDurationMs: number;
  maxTabs: number;
  maxDownloadBytes: number;
  maxUploadBytes: number;
  maxSnapshotChars: number;
  maxEvidenceBytes: number;
}

export const DEFAULT_BUDGET: Readonly<ResourceBudget> = Object.freeze({
  maxActions: 250,
  maxDurationMs: 30 * 60_000,
  maxTabs: 8,
  maxDownloadBytes: 64 * 1024 * 1024,
  maxUploadBytes: 64 * 1024 * 1024,
  maxSnapshotChars: 120_000,
  maxEvidenceBytes: 256 * 1024 * 1024
});

export interface BrowserPolicy {
  allowedOrigins: string[];
  deniedOrigins?: string[];
  allowedActions?: ActionKind[];
  allowedEffects?: Effect[];
  allowedProfiles?: string[];
  allowJavaScript?: boolean;
  allowCookieRead?: boolean;
  allowCookieWrite?: boolean;
  allowDownloads?: boolean;
  allowUploads?: boolean;
  /**
   * Opt-in for deployment-owned loopback and private-network targets.
   * Keep disabled for tools exposed to untrusted callers.
   */
  allowPrivateNetwork?: boolean;
  allowRemote?: boolean;
  requireApprovalFor?: ActionKind[];
  budget?: Partial<ResourceBudget>;
}

export interface ProxyConfig {
  server: string;
  usernameRef?: string;
  passwordRef?: string;
  bypass?: string;
}

export interface SessionCreateInput {
  id?: string;
  profile?: string;
  profilePassphrase?: string;
  mode?: BrowserMode;
  startUrl?: string;
  locale?: string;
  timezoneId?: string;
  colorScheme?: "light" | "dark" | "no-preference";
  viewport?: { width: number; height: number };
  executablePath?: string;
  cdpEndpoint?: string;
  userAgent?: string;
  extraHTTPHeaders?: Record<string, string>;
  proxy?: ProxyConfig;
  policy: BrowserPolicy;
  recordHar?: boolean;
  recordVideo?: boolean;
  purpose: string;
  actor?: string;
}

export interface BrowserAction {
  kind: ActionKind;
  tabId?: string;
  ref?: string;
  selector?: string;
  url?: string;
  value?: string;
  /** Opaque host-vault reference used by typed credential-bearing actions. */
  valueRef?: string;
  /** Opaque host-vault reference to a bounded JSON object or array. */
  dataRef?: string;
  values?: string[];
  key?: string;
  text?: string;
  expression?: string;
  path?: string;
  paths?: string[];
  timeoutMs?: number;
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
  targetRef?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  purpose: string;
  approvalId?: string;
}

export interface PageRef {
  ref: string;
  role: string;
  name: string;
  tag: string;
  text?: string;
  disabled?: boolean;
  checked?: boolean | "mixed";
  expanded?: boolean;
  level?: number;
  href?: string;
  valuePresent?: boolean;
}

export interface PageSnapshot {
  sessionId: string;
  tabId: string;
  url: string;
  title: string;
  capturedAt: string;
  text: string;
  refs: PageRef[];
  challenge?: ChallengeReport;
  digest: string;
  truncated: boolean;
}

export interface ChallengeReport {
  detected: boolean;
  kind?: "captcha" | "access-challenge" | "login" | "consent" | "unknown";
  provider?: string;
  title?: string;
  evidence: string[];
  requiresHuman: boolean;
}

export interface ActionReceipt {
  id: string;
  sessionId: string;
  tabId?: string;
  action: ActionKind;
  effect: Effect;
  risk: RiskLevel;
  purpose: string;
  inputDigest: string;
  outputDigest: string;
  policyDigest: string;
  approvalId?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "succeeded" | "denied" | "failed" | "challenge";
  urlBefore?: string;
  urlAfter?: string;
  evidenceIds: string[];
  error?: { code: string; message: string };
  previousReceiptHash?: string;
  receiptHash: string;
}

export interface EvidenceRecord {
  id: string;
  sessionId: string;
  kind:
    | "snapshot"
    | "screenshot"
    | "pdf"
    | "video"
    | "trace"
    | "har"
    | "console"
    | "network"
    | "download"
    | "audit"
    | "comparison"
    | "action";
  createdAt: string;
  contentType: string;
  path?: string;
  size: number;
  digest: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface TabSummary {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface SessionSummary {
  id: string;
  state: SessionState;
  profile?: string;
  mode: BrowserMode;
  purpose: string;
  actor?: string;
  createdAt: string;
  updatedAt: string;
  actionsUsed: number;
  budget: ResourceBudget;
  tabs: TabSummary[];
  challenge?: ChallengeReport;
}

export interface ApprovalRequest {
  sessionId: string;
  action: BrowserAction;
  effect: Effect;
  risk: RiskLevel;
  inputDigest: string;
  policyDigest: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  approvalId?: string;
  reason?: string;
  expiresAt?: string;
  inputDigest?: string;
  policyDigest?: string;
}

export interface ApprovalProvider {
  authorize(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface ContextRecorder {
  record(event: {
    type: string;
    sessionId: string;
    actor?: string;
    purpose: string;
    timestamp: string;
    inputDigest?: string;
    outputDigest?: string;
    evidenceIds?: string[];
    receiptHash?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface CrawlerHandoff {
  crawl(input: {
    seeds: string[];
    allowedOrigins: string[];
    maxPages: number;
    purpose: string;
  }): Promise<unknown>;
}
