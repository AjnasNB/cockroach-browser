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
  "mouse.move",
  "mouse.down",
  "mouse.up",
  "mouse.click",
  "keyboard.down",
  "keyboard.up",
  "keyboard.insertText",
  "upload",
  "download",
  "evaluate",
  "query.inspect",
  "emulation.set",
  "emulation.clear",
  "cache.clear",
  "console.clear",
  "network.clear",
  "wait",
  "history.inspect",
  "capture.paired",
  "annotate.show",
  "annotate.clear",
  "clipboard.read",
  "clipboard.write",
  "network.inspect",
  "network.export",
  "network.route.add",
  "network.route.remove",
  "network.routes.list",
  "state.save",
  "state.load",
  "state.list",
  "state.delete",
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
  "tab.lock",
  "tab.unlock",
  "tab.lock.status",
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
  maxHistoryEntries: number;
  maxNetworkEntries: number;
  maxClipboardBytes: number;
  maxSavedStates: number;
  maxNetworkRules: number;
  maxRouteFulfillBytes: number;
  maxInterceptedBytes: number;
}

export const DEFAULT_BUDGET: Readonly<ResourceBudget> = Object.freeze({
  maxActions: 250,
  maxDurationMs: 30 * 60_000,
  maxTabs: 8,
  maxDownloadBytes: 64 * 1024 * 1024,
  maxUploadBytes: 64 * 1024 * 1024,
  maxSnapshotChars: 120_000,
  maxEvidenceBytes: 256 * 1024 * 1024,
  maxHistoryEntries: 100,
  maxNetworkEntries: 2_000,
  maxClipboardBytes: 64 * 1024,
  maxSavedStates: 64,
  maxNetworkRules: 32,
  maxRouteFulfillBytes: 256 * 1024,
  maxInterceptedBytes: 8 * 1024 * 1024
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
  allowClipboard?: boolean;
  allowStateExport?: boolean;
  allowAnnotations?: boolean;
  /** Allow bounded device, media, permission, and network emulation actions. */
  allowEmulation?: boolean;
  /** Allow an exact action to accept a JavaScript dialog. Dismiss remains the safe default. */
  allowDialogAccept?: boolean;
  /** Allow host-reviewed request blocking or static response fulfillment rules. */
  allowNetworkInterception?: boolean;
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
  /** Explicit, host-reviewed browser provider. Never discovered from ambient profiles. */
  browserProvider?: BrowserProviderInput;
  userAgent?: string;
  extraHTTPHeaders?: Record<string, string>;
  proxy?: ProxyConfig;
  policy: BrowserPolicy;
  recordHar?: boolean;
  recordVideo?: boolean;
  purpose: string;
  actor?: string;
}

export type BrowserProviderKind = "bundled" | "system" | "custom" | "cdp";

export interface BrowserProviderInput {
  kind: BrowserProviderKind;
  /** Required for custom providers; must resolve to a regular executable file. */
  executablePath?: string;
  /** Required for CDP providers. Remote endpoints still require policy.allowRemote. */
  cdpEndpoint?: string;
  /** Chromium channel hint used by system discovery, for example chrome or msedge. */
  channel?: "chrome" | "chrome-beta" | "chrome-dev" | "chrome-canary" | "msedge" | "msedge-beta" | "msedge-dev" | "msedge-canary";
  /** Reviewed unpacked extension directories. Remote downloads and CRX installation are not performed. */
  extensions?: string[];
  /** Host-reviewed Chromium arguments. Dangerous remote-debug or public-bind flags are rejected. */
  arguments?: string[];
  /** Runtime-owned persistent user-data directory. Ambient host profiles are never discovered. */
  persistentProfile?: string;
}

export interface BrowserEmulationInput {
  viewport?: { width: number; height: number };
  colorScheme?: "light" | "dark" | "no-preference";
  reducedMotion?: "reduce" | "no-preference";
  forcedColors?: "active" | "none";
  media?: "screen" | "print" | null;
  offline?: boolean;
  geolocation?: { latitude: number; longitude: number; accuracy?: number } | null;
  permissions?: Array<"geolocation" | "notifications">;
  extraHTTPHeaders?: Record<string, string>;
}

export interface BrowserQueryInput {
  properties?: Array<"text" | "html" | "attributes" | "box" | "value" | "checked" | "visible" | "enabled" | "count">;
  attributeNames?: string[];
  all?: boolean;
}

export interface BrowserAction {
  kind: ActionKind;
  tabId?: string;
  ref?: string;
  selector?: string;
  xpath?: string;
  frame?: FrameTarget;
  dialog?: DialogResponse;
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
  emulation?: BrowserEmulationInput;
  query?: BrowserQueryInput;
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
  button?: "left" | "right" | "middle";
  clickCount?: number;
  steps?: number;
  targetRef?: string;
  route?: NetworkRouteInput;
  routeId?: string;
  lockOwner?: string;
  lockTokenRef?: string;
  lockTtlMs?: number;
  stateName?: string;
  passphraseRef?: string;
  outputFormat?: "json" | "ndjson" | "har";
  requireStable?: boolean;
  includeBounds?: boolean;
  method?: string;
  status?: number;
  resourceType?: string;
  limit?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  purpose: string;
  approvalId?: string;
}

export interface BrowserActionBatchInput {
  actions: BrowserAction[];
  stopOnError?: boolean;
}

export interface BrowserActionBatchResult {
  results: Array<{ index: number; output?: unknown; receipt?: ActionReceipt; error?: { code: string; message: string } }>;
  completed: number;
  failed: number;
}

export interface FrameTarget {
  /** Zero-based index within the current page's same-origin frame list. */
  index?: number;
  /** Exact frame name. */
  name?: string;
  /** Exact same-origin frame URL. */
  url?: string;
}

export interface DialogResponse {
  action: "accept" | "dismiss";
  /** Optional opaque host-vault reference for a prompt response. */
  promptTextRef?: string;
}

export type NetworkResourceType =
  | "document"
  | "stylesheet"
  | "image"
  | "media"
  | "font"
  | "script"
  | "texttrack"
  | "xhr"
  | "fetch"
  | "eventsource"
  | "websocket"
  | "manifest"
  | "other";

export interface NetworkRouteInput {
  id?: string;
  /** Exact admitted origin. Wildcard origins are never accepted. */
  origin: string;
  /** Glob matched against pathname only. `*` stays within a path segment and `**` spans segments. */
  pathPattern: string;
  methods?: string[];
  resourceTypes?: NetworkResourceType[];
  response:
    | { action: "abort" }
    | {
        action: "fulfill";
        status?: number;
        contentType?: string;
        body?: string;
      };
}

export interface NetworkRouteSummary {
  id: string;
  origin: string;
  pathPattern: string;
  methods: string[];
  resourceTypes: NetworkResourceType[];
  response: {
    action: "abort" | "fulfill";
    status?: number;
    contentType?: string;
    bodyBytes: number;
    bodyDigest?: string;
  };
}

export interface BrowserHistoryEntry {
  tabId: string;
  url: string;
  title: string;
  observedAt: string;
  source: ActionKind | "session.start";
}

export interface NavigationGraphNode {
  id: string;
  tabId: string;
  url: string;
  title: string;
  firstObservedAt: string;
  lastObservedAt: string;
  visits: number;
}

export interface NavigationGraphEdge {
  id: string;
  tabId: string;
  from: string;
  to: string;
  source: BrowserHistoryEntry["source"];
  observedAt: string;
  traversals: number;
}

export interface NavigationGraph {
  sessionId: string;
  generatedAt: string;
  nodes: NavigationGraphNode[];
  edges: NavigationGraphEdge[];
  truncated: boolean;
}

export interface BrowserNetworkRecord {
  id: string;
  tabId: string;
  timestamp: string;
  type: "requestfailed" | "response";
  method?: string;
  url: string;
  status?: number;
  resourceType?: string;
  error?: string;
}

export interface TabLockSummary {
  tabId: string;
  owner: string;
  acquiredAt: string;
  expiresAt: string;
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

export const BROWSER_EVENT_TYPES = [
  "browser.session.created",
  "browser.session.closed",
  "browser.action.started",
  "browser.action.completed",
  "browser.progress",
  "browser.challenge.detected",
  "browser.challenge.resolved",
  "browser.evidence.recorded"
] as const;

export type BrowserEventType = (typeof BROWSER_EVENT_TYPES)[number];

export interface BrowserLifecycleEvent {
  id: string;
  type: BrowserEventType;
  occurredAt: string;
  sessionId: string;
  actor?: string;
  purpose: string;
  receiptHash?: string;
  evidenceIds?: string[];
  metadata?: Record<string, unknown>;
}

export type ActivityDetail = "off" | "summary" | "detailed";

export interface BrowserActivityQuery {
  sessionId?: string;
  after?: string;
  limit?: number;
}

export interface BrowserEventPublisher {
  publish(event: BrowserLifecycleEvent): Promise<void>;
}

export interface CrawlerHandoff {
  crawl(input: {
    seeds: string[];
    allowedOrigins: string[];
    maxPages: number;
    purpose: string;
  }): Promise<unknown>;
}
