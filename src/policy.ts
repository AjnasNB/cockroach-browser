import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type {
  ActionKind,
  BrowserAction,
  BrowserPolicy,
  Effect,
  ResourceBudget,
  RiskLevel
} from "./contracts.js";
import { ACTION_KINDS, DEFAULT_BUDGET } from "./contracts.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { CockroachBrowserError } from "./errors.js";

const WRITE_ACTIONS = new Set<ActionKind>([
  "click",
  "doubleClick",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "select",
  "drag",
  "mouse.move",
  "mouse.down",
  "mouse.up",
  "mouse.click",
  "keyboard.down",
  "keyboard.up",
  "keyboard.insertText",
  "upload",
  "network.route.add",
  "network.route.remove",
  "cookies.write",
  "storage.write",
  "annotate.show",
  "annotate.clear",
  "clipboard.write",
  "state.save",
  "state.load",
  "state.delete",
  "emulation.set",
  "emulation.clear",
  "cache.clear",
  "console.clear",
  "network.clear",
  "tab.lock",
  "tab.unlock"
]);

const HIGH_RISK_ACTIONS = new Set<ActionKind>([
  "click",
  "doubleClick",
  "press",
  "upload",
  "download",
  "evaluate",
  "cookies.read",
  "cookies.write",
  "storage.read",
  "storage.write",
  "mouse.move",
  "mouse.down",
  "mouse.up",
  "mouse.click",
  "keyboard.down",
  "keyboard.up",
  "keyboard.insertText",
  "network.route.add",
  "network.route.remove",
  "clipboard.read",
  "clipboard.write",
  "state.save",
  "state.load",
  "state.delete",
  "tab.lock",
  "tab.unlock",
  "challenge.resolve"
]);

const DEFAULT_APPROVAL_ACTIONS = new Set<ActionKind>([
  ...WRITE_ACTIONS,
  ...HIGH_RISK_ACTIONS
]);

export function effectForAction(action: ActionKind | BrowserAction): Effect {
  const kind = typeof action === "string" ? action : action.kind;
  if (kind === "upload") return "upload";
  if (kind === "download") return "download";
  if (kind === "evaluate" || kind === "challenge.resolve") return "execute";
  if (
    kind.startsWith("cookies.")
    || kind.startsWith("storage.")
    || kind.startsWith("state.")
    || kind.startsWith("clipboard.")
  ) return "credential";
  if (typeof action !== "string" && action.dialog?.action === "accept") return "write";
  return WRITE_ACTIONS.has(kind) ? "write" : "read";
}

export function riskForAction(action: ActionKind | BrowserAction): RiskLevel {
  const kind = typeof action === "string" ? action : action.kind;
  if (
    kind === "evaluate"
    || kind === "challenge.resolve"
    || kind === "cookies.write"
    || kind === "storage.write"
    || kind === "state.load"
    || kind === "state.delete"
    || kind === "clipboard.read"
    || kind === "clipboard.write"
    || kind === "network.route.add"
    || kind === "network.route.remove"
    || kind === "emulation.set"
    || kind === "emulation.clear"
  ) return "critical";
  if (typeof action !== "string" && action.dialog?.action === "accept") return "high";
  if (HIGH_RISK_ACTIONS.has(kind)) return "high";
  if (WRITE_ACTIONS.has(kind) || kind === "navigate") return "medium";
  return "low";
}

export function clampBudget(input?: Partial<ResourceBudget>): ResourceBudget {
  const positive = (value: number | undefined, fallback: number, ceiling: number): number => {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new CockroachBrowserError("INVALID_BUDGET", "Resource budgets must be positive safe integers.");
    }
    return Math.min(value, ceiling);
  };
  return Object.freeze({
    maxActions: positive(input?.maxActions, DEFAULT_BUDGET.maxActions, 10_000),
    maxDurationMs: positive(input?.maxDurationMs, DEFAULT_BUDGET.maxDurationMs, 24 * 60 * 60_000),
    maxTabs: positive(input?.maxTabs, DEFAULT_BUDGET.maxTabs, 64),
    maxProcessRssBytes: positive(
      input?.maxProcessRssBytes,
      DEFAULT_BUDGET.maxProcessRssBytes,
      8 * 1024 ** 3
    ),
    maxProcessCpuTimeMs: positive(
      input?.maxProcessCpuTimeMs,
      DEFAULT_BUDGET.maxProcessCpuTimeMs,
      7 * 24 * 60 * 60_000
    ),
    maxDownloadBytes: positive(input?.maxDownloadBytes, DEFAULT_BUDGET.maxDownloadBytes, 2 * 1024 ** 3),
    maxUploadBytes: positive(input?.maxUploadBytes, DEFAULT_BUDGET.maxUploadBytes, 2 * 1024 ** 3),
    maxSnapshotChars: positive(input?.maxSnapshotChars, DEFAULT_BUDGET.maxSnapshotChars, 2_000_000),
    maxEvidenceBytes: positive(input?.maxEvidenceBytes, DEFAULT_BUDGET.maxEvidenceBytes, 10 * 1024 ** 3),
    maxHistoryEntries: positive(input?.maxHistoryEntries, DEFAULT_BUDGET.maxHistoryEntries, 1_000),
    maxNetworkEntries: positive(input?.maxNetworkEntries, DEFAULT_BUDGET.maxNetworkEntries, 50_000),
    maxClipboardBytes: positive(input?.maxClipboardBytes, DEFAULT_BUDGET.maxClipboardBytes, 1024 * 1024),
    maxSavedStates: positive(input?.maxSavedStates, DEFAULT_BUDGET.maxSavedStates, 1_000),
    maxNetworkRules: positive(input?.maxNetworkRules, DEFAULT_BUDGET.maxNetworkRules, 256),
    maxRouteFulfillBytes: positive(
      input?.maxRouteFulfillBytes,
      DEFAULT_BUDGET.maxRouteFulfillBytes,
      4 * 1024 * 1024
    ),
    maxInterceptedBytes: positive(
      input?.maxInterceptedBytes,
      DEFAULT_BUDGET.maxInterceptedBytes,
      64 * 1024 * 1024
    )
  });
}

function normalizeOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("INVALID_ORIGIN", `Invalid origin: ${input}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new CockroachBrowserError("INVALID_ORIGIN", "Only HTTP and HTTPS origins are supported.");
  }
  if (url.username || url.password) {
    throw new CockroachBrowserError("INVALID_ORIGIN", "Origins cannot contain embedded credentials.");
  }
  return url.origin.toLowerCase();
}

export function normalizePolicy(policy: BrowserPolicy): Readonly<BrowserPolicy & { budget: ResourceBudget }> {
  if (!Array.isArray(policy.allowedOrigins) || policy.allowedOrigins.length === 0) {
    throw new CockroachBrowserError(
      "ORIGIN_ALLOWLIST_REQUIRED",
      "At least one explicit allowed origin is required for every browser session."
    );
  }
  const allowedActions: ActionKind[] = policy.allowedActions ?? [...ACTION_KINDS];
  for (const action of allowedActions) {
    if (!ACTION_KINDS.includes(action)) {
      throw new CockroachBrowserError("UNKNOWN_ACTION", `Unknown action: ${String(action)}`);
    }
  }
  const allowedEffects: Effect[] = policy.allowedEffects ?? [
    "read",
    "write",
    "execute",
    "upload",
    "download",
    "credential"
  ];
  return Object.freeze({
    ...policy,
    allowedOrigins: [...new Set(policy.allowedOrigins.map(normalizeOrigin))],
    deniedOrigins: [...new Set((policy.deniedOrigins ?? []).map(normalizeOrigin))],
    allowedActions: [...new Set(allowedActions)],
    allowedEffects: [...new Set(allowedEffects)],
    ...(policy.allowedProfiles ? { allowedProfiles: [...new Set(policy.allowedProfiles)] } : {}),
    requireApprovalFor: [...new Set(policy.requireApprovalFor ?? [...DEFAULT_APPROVAL_ACTIONS])],
    budget: clampBudget(policy.budget)
  });
}

export function policyDigest(policy: BrowserPolicy): string {
  return sha256(normalizePolicy(policy));
}

export function assertUrlAllowed(policy: BrowserPolicy, input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("INVALID_URL", `Invalid URL: ${input}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new CockroachBrowserError("PROTOCOL_DENIED", `Protocol ${url.protocol} is not allowed.`);
  }
  if (url.username || url.password) {
    throw new CockroachBrowserError("URL_CREDENTIALS_DENIED", "Browser URLs cannot contain embedded credentials.");
  }
  const origin = url.origin.toLowerCase();
  const normalized = normalizePolicy(policy);
  if (normalized.deniedOrigins?.includes(origin) || !normalized.allowedOrigins.includes(origin)) {
    throw new CockroachBrowserError("ORIGIN_DENIED", `Origin ${origin} is outside the session allowlist.`);
  }
  const hostname = url.hostname.toLowerCase();
  const privateDestination =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    hostname === "::1" ||
    (isIP(hostname) !== 0 && isPrivateAddress(hostname));
  if (!normalized.allowPrivateNetwork && privateDestination) {
    throw new CockroachBrowserError(
      "PRIVATE_NETWORK_DENIED",
      "Private and loopback destinations require a separate deployment-owned network adapter."
    );
  }
  return url;
}

/**
 * Re-resolves an admitted URL before browser dispatch and pins the result for
 * the lifetime of a session. This closes the common "public during policy
 * check, private during navigation" DNS-rebinding path.
 */
export async function assertUrlResolvedAllowed(
  policy: BrowserPolicy,
  input: string,
  pins?: Map<string, readonly string[]>,
  resolver: DnsResolver = systemDnsResolver
): Promise<URL> {
  const url = assertUrlAllowed(policy, input);
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname) !== 0) return url;

  let records: Array<{ address: string }>;
  try {
    records = await resolver(hostname);
  } catch (error) {
    throw new CockroachBrowserError(
      "DNS_RESOLUTION_FAILED",
      `The admitted origin could not be resolved: ${hostname}`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  const addresses = [...new Set(records.map((entry) => entry.address.toLowerCase()))].sort();
  if (addresses.length === 0) {
    throw new CockroachBrowserError("DNS_RESOLUTION_FAILED", `The admitted origin has no addresses: ${hostname}`);
  }
  if (!policy.allowPrivateNetwork && addresses.some(isPrivateAddress)) {
    throw new CockroachBrowserError(
      "PRIVATE_NETWORK_DENIED",
      `Origin ${url.origin} resolved to a private, loopback, link-local, or reserved address.`
    );
  }
  const prior = pins?.get(hostname);
  if (prior && canonicalJson(prior) !== canonicalJson(addresses)) {
    throw new CockroachBrowserError(
      "DNS_PIN_CHANGED",
      `Origin ${url.origin} changed addresses during the session. Start a new explicitly reviewed session.`
    );
  }
  if (!prior) pins?.set(hostname, addresses);
  return url;
}

export type DnsResolver = (hostname: string) => Promise<Array<{ address: string }>>;

async function systemDnsResolver(hostname: string): Promise<Array<{ address: string }>> {
  return lookup(hostname, { all: true, verbatim: true });
}

const NON_PUBLIC_IPV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  NON_PUBLIC_IPV4.addSubnet(network, prefix, "ipv4");
}

const NON_PUBLIC_IPV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const) {
  NON_PUBLIC_IPV6.addSubnet(network, prefix, "ipv6");
}

export function isPrivateAddress(hostname: string): boolean {
  const family = isIP(hostname);
  if (family === 4) return NON_PUBLIC_IPV4.check(hostname, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(hostname);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return NON_PUBLIC_IPV6.check(hostname, "ipv6");
  }
  return false;
}

export interface PolicyDecision {
  allowed: boolean;
  effect: Effect;
  risk: RiskLevel;
  requiresApproval: boolean;
  reason: string;
  digest: string;
}

export function evaluateAction(policy: BrowserPolicy, action: BrowserAction): PolicyDecision {
  const normalized = normalizePolicy(policy);
  const effect = effectForAction(action);
  const risk = riskForAction(action);
  let allowed = normalized.allowedActions?.includes(action.kind) ?? false;
  let reason = allowed ? "Action and effect are permitted by the session policy." : "Action is not permitted.";
  if (!normalized.allowedEffects?.includes(effect)) {
    allowed = false;
    reason = `Effect ${effect} is not permitted.`;
  }
  if (action.kind === "evaluate" && !normalized.allowJavaScript) {
    allowed = false;
    reason = "Arbitrary JavaScript is disabled for this session.";
  }
  if (action.kind === "cookies.read" && !normalized.allowCookieRead) {
    allowed = false;
    reason = "Cookie reads are disabled for this session.";
  }
  if (action.kind === "cookies.write" && !normalized.allowCookieWrite) {
    allowed = false;
    reason = "Cookie writes are disabled for this session.";
  }
  if (action.kind === "download" && !normalized.allowDownloads) {
    allowed = false;
    reason = "Downloads are disabled for this session.";
  }
  if (action.kind === "upload" && !normalized.allowUploads) {
    allowed = false;
    reason = "Uploads are disabled for this session.";
  }
  if ((action.kind === "clipboard.read" || action.kind === "clipboard.write") && !normalized.allowClipboard) {
    allowed = false;
    reason = "Clipboard access is disabled for this session.";
  }
  if (action.kind.startsWith("state.") && !normalized.allowStateExport) {
    allowed = false;
    reason = "Encrypted browser-state management is disabled for this session.";
  }
  if (action.kind.startsWith("annotate.") && !normalized.allowAnnotations) {
    allowed = false;
    reason = "Page annotations are disabled for this session.";
  }
  if (action.kind.startsWith("emulation.") && !normalized.allowEmulation) {
    allowed = false;
    reason = "Browser emulation is disabled for this session.";
  }
  if (action.dialog?.action === "accept" && !normalized.allowDialogAccept) {
    allowed = false;
    reason = "Dialog acceptance is disabled for this session; undeclared dialogs are dismissed.";
  }
  if (
    (action.kind === "network.route.add" || action.kind === "network.route.remove")
    && !normalized.allowNetworkInterception
  ) {
    allowed = false;
    reason = "Network interception is disabled for this session.";
  }
  if (action.url) assertUrlAllowed(normalized, action.url);
  const requiresApproval = allowed && (
    (normalized.requireApprovalFor?.includes(action.kind) ?? false)
    || action.dialog?.action === "accept"
  );
  const digest = sha256({
    allowed,
    effect,
    risk,
    requiresApproval,
    reason,
    action: JSON.parse(canonicalJson(action)),
    policy: normalized
  });
  return { allowed, effect, risk, requiresApproval, reason, digest };
}
