import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  ConsoleMessage,
  Dialog,
  Download,
  FileChooser,
  Page,
  Request,
  Response,
  Route
} from "playwright-core";
import type {
  ActionReceipt,
  ApprovalDecision,
  ApprovalProvider,
  BrowserAction,
  BrowserActionBatchInput,
  BrowserActionBatchResult,
  BrowserEventPublisher,
  BrowserHistoryEntry,
  BrowserActivityQuery,
  BrowserLifecycleEvent,
  BrowserNetworkRecord,
  ChallengeReport,
  ContextRecorder,
  EvidenceRecord,
  NetworkRouteSummary,
  NavigationGraph,
  PageSnapshot,
  ResourceBudget,
  SessionCreateInput,
  SessionSummary,
  TabLockSummary,
  TabSummary
} from "./contracts.js";
import { ActivityLedger, type ActivityLedgerOptions } from "./activity.js";
import { resolveBrowserProvider } from "./browser-discovery.js";
import { canonicalJson, newId, nowIso, sha256 } from "./canonical.js";
import { detectChallenge } from "./challenge.js";
import { CockroachBrowserError, errorMessage } from "./errors.js";
import { EvidenceStore } from "./evidence.js";
import { GOVERNANCE_DISPATCH, type GovernanceDispatch } from "./internal-authority.js";
import {
  compileNetworkRoute,
  networkRouteMatches,
  type CompiledNetworkRoute
} from "./network-routes.js";
import {
  assertUrlResolvedAllowed,
  effectForAction,
  evaluateAction,
  normalizePolicy,
  policyDigest,
  riskForAction,
  isPrivateAddress,
  type DnsResolver
} from "./policy.js";
import { ProfileVault } from "./profile-vault.js";
import { PersistentBrowserProfileStore } from "./persistent-profiles.js";
import { captureSnapshot, locatorFor } from "./snapshot.js";

export interface SecretResolver {
  resolve(reference: string): Promise<string>;
}

export interface BrowserRuntimeOptions {
  root?: string;
  approvalProvider?: ApprovalProvider;
  contextRecorder?: ContextRecorder;
  eventPublisher?: BrowserEventPublisher;
  secretResolver?: SecretResolver;
  dnsResolver?: DnsResolver;
  uploadRoots?: string[];
  now?: () => Date;
  activity?: ActivityLedgerOptions;
}

interface InternalTabLock extends TabLockSummary {
  tokenDigest: string;
}

interface ConsoleRecord {
  timestamp: string;
  type: string;
  text: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
}

interface ManagedSession {
  input: SessionCreateInput;
  id: string;
  browser?: Browser;
  context: BrowserContext;
  attached: boolean;
  state: SessionSummary["state"];
  createdAt: string;
  updatedAt: string;
  actionsUsed: number;
  budget: ResourceBudget;
  tabs: Map<string, Page>;
  pageIds: WeakMap<Page, string>;
  activeTabId: string;
  console: ConsoleRecord[];
  network: BrowserNetworkRecord[];
  history: BrowserHistoryEntry[];
  networkRules: Map<string, CompiledNetworkRoute>;
  interceptedBytes: number;
  challenge?: ChallengeReport;
  traceActive: boolean;
  evidenceBytes: number;
  actionTail: Promise<void>;
  dnsPins: Map<string, readonly string[]>;
  consumedApprovals: Set<string>;
  tabLocks: Map<string, InternalTabLock>;
  routeHandler?: (route: Route) => Promise<void>;
  pageHandler?: (page: Page) => void;
  persistentProfile?: string;
}

const CHALLENGE_SAFE_ACTIONS = new Set([
  "snapshot",
  "screenshot",
  "capture.paired",
  "pdf",
  "extract",
  "wait",
  "tab.switch",
  "tab.close",
  "tab.lock.status",
  "history.inspect",
  "network.inspect",
  "network.export",
  "state.list",
  "network.routes.list"
]);

export class BrowserRuntime {
  readonly root: string;
  readonly profiles: ProfileVault;
  readonly persistentProfiles: PersistentBrowserProfileStore;
  readonly evidence: EvidenceStore;
  readonly approvalProvider?: ApprovalProvider;
  readonly contextRecorder?: ContextRecorder;
  readonly eventPublisher?: BrowserEventPublisher;
  readonly secretResolver?: SecretResolver;
  readonly dnsResolver?: DnsResolver;
  readonly uploadRoots: readonly string[];
  readonly activity: ActivityLedger;
  #sessions = new Map<string, ManagedSession>();
  #activePersistentProfiles = new Map<string, string>();
  #initialized = false;

  constructor(options: BrowserRuntimeOptions = {}) {
    this.root = resolve(options.root ?? join(homedir(), ".cockroach-browser"));
    this.profiles = new ProfileVault(join(this.root, "profiles"));
    this.persistentProfiles = new PersistentBrowserProfileStore(join(this.root, "browser-profiles"));
    this.evidence = new EvidenceStore({ root: join(this.root, "evidence"), maxBytes: 10 * 1024 ** 3 });
    if (options.approvalProvider) this.approvalProvider = options.approvalProvider;
    if (options.contextRecorder) this.contextRecorder = options.contextRecorder;
    if (options.eventPublisher) this.eventPublisher = options.eventPublisher;
    if (options.secretResolver) this.secretResolver = options.secretResolver;
    if (options.dnsResolver) this.dnsResolver = options.dnsResolver;
    this.uploadRoots = Object.freeze(
      (options.uploadRoots ?? [join(this.root, "uploads")]).map((entry) => resolve(entry))
    );
    this.activity = new ActivityLedger(options.activity);
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.root, { recursive: true });
    for (const uploadRoot of this.uploadRoots) await mkdir(uploadRoot, { recursive: true });
    await this.profiles.initialize();
    await this.persistentProfiles.initialize();
    await this.evidence.initialize();
    this.#initialized = true;
  }

  async createSession(rawInput: SessionCreateInput): Promise<SessionSummary> {
    await this.initialize();
    const input = structuredClone(rawInput);
    const policy = normalizePolicy(input.policy);
    input.policy = policy;
    if (!input.purpose?.trim() || input.purpose.trim().length > 500) {
      throw new CockroachBrowserError("PURPOSE_REQUIRED", "Every browser session requires an explicit purpose.");
    }
    input.purpose = input.purpose.trim();
    if (input.profile && policy.allowedProfiles && !policy.allowedProfiles.includes(input.profile)) {
      throw new CockroachBrowserError("PROFILE_DENIED", `Profile ${input.profile} is not allowed by policy.`);
    }
    const id = input.id ?? newId("session");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id === "." || id === "..") {
      throw new CockroachBrowserError(
        "SESSION_ID_INVALID",
        "Session IDs may contain only letters, numbers, dots, underscores, and hyphens and cannot traverse paths."
      );
    }
    if (this.#sessions.has(id)) {
      throw new CockroachBrowserError("SESSION_EXISTS", `Session ${id} already exists.`);
    }
    const dnsPins = new Map<string, readonly string[]>();
    const startUrl = input.startUrl
      ? await assertUrlResolvedAllowed(policy, input.startUrl, dnsPins, this.dnsResolver)
      : undefined;
    const profilePassphrase = input.profilePassphrase;
    delete input.profilePassphrase;
    const provider = await resolveBrowserProvider(input.browserProvider, {
      ...(input.executablePath ? { executablePath: input.executablePath } : {}),
      ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {})
    });
    if (provider.persistentProfile && policy.allowedProfiles && !policy.allowedProfiles.includes(provider.persistentProfile)) {
      throw new CockroachBrowserError("PROFILE_DENIED", `Persistent profile ${provider.persistentProfile} is not allowed by policy.`);
    }
    if (provider.persistentProfile && this.#activePersistentProfiles.has(provider.persistentProfile)) {
      throw new CockroachBrowserError(
        "PERSISTENT_PROFILE_IN_USE",
        `Persistent profile ${provider.persistentProfile} is already owned by session ${this.#activePersistentProfiles.get(provider.persistentProfile)}.`
      );
    }
    if (provider.persistentProfile) this.#activePersistentProfiles.set(provider.persistentProfile, id);
    const createdAt = nowIso();
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let attached = false;
    let managedSession: ManagedSession | undefined;
    try {
      if (provider.cdpEndpoint) {
        await assertCdpEndpoint(provider.cdpEndpoint, Boolean(policy.allowRemote), this.dnsResolver);
        if (input.recordHar || input.recordVideo) {
          throw new CockroachBrowserError(
            "ATTACHED_CAPTURE_DENIED",
            "HAR and video recording require a runtime-owned browser context, not an attached CDP context."
          );
        }
        browser = await chromium.connectOverCDP(provider.cdpEndpoint);
        // From this point the runtime is a guest of a host-owned browser. A
        // failed admission check must never close the host context.
        attached = true;
        context = browser.contexts()[0];
        if (!context) throw new CockroachBrowserError("CDP_CONTEXT_MISSING", "The CDP browser has no default context.");
        for (const existingPage of context.pages()) {
          const current = existingPage.url();
          if (current !== "about:blank") {
            await assertUrlResolvedAllowed(policy, current, dnsPins, this.dnsResolver);
          }
        }
      } else {
        if (input.proxy) {
          await assertProxyEndpoint(input.proxy.server, Boolean(policy.allowRemote), this.dnsResolver);
        }
        const proxy = input.proxy
          ? {
              server: input.proxy.server,
              ...(input.proxy.bypass ? { bypass: input.proxy.bypass } : {}),
              ...(input.proxy.usernameRef
                ? { username: await this.#resolveSecret(input.proxy.usernameRef) }
                : {}),
              ...(input.proxy.passwordRef
                ? { password: await this.#resolveSecret(input.proxy.passwordRef) }
                : {})
            }
          : undefined;
        const extensionArgs = provider.extensions.length
          ? [`--disable-extensions-except=${provider.extensions.join(",")}`, `--load-extension=${provider.extensions.join(",")}`]
          : [];
        const launchOptions: NonNullable<Parameters<typeof chromium.launch>[0]> = {
          headless: (input.mode ?? "headless") === "headless",
          ...(provider.executablePath ? { executablePath: provider.executablePath } : {}),
          ...(proxy ? { proxy } : {}),
          ...(provider.arguments.length || extensionArgs.length ? { args: [...provider.arguments, ...extensionArgs] } : {})
        };
        let storageState: Record<string, unknown> | undefined;
        if (input.profile) {
          if (!profilePassphrase) {
            throw new CockroachBrowserError(
              "PROFILE_PASSPHRASE_REQUIRED",
              "An explicit passphrase is required to open a named profile."
            );
          }
          try {
            storageState = await this.profiles.load(input.profile, profilePassphrase);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        const sessionArtifactRoot = join(this.root, "session-artifacts", id);
        await mkdir(sessionArtifactRoot, { recursive: true });
        const contextOptions: BrowserContextOptions = {
          acceptDownloads: Boolean(policy.allowDownloads),
          locale: input.locale ?? "en-US",
          ...(input.timezoneId ? { timezoneId: input.timezoneId } : {}),
          ...(input.colorScheme ? { colorScheme: input.colorScheme } : {}),
          ...(input.viewport ? { viewport: input.viewport } : {}),
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          ...(input.extraHTTPHeaders ? { extraHTTPHeaders: input.extraHTTPHeaders } : {}),
          ...(storageState
            ? { storageState: storageState as NonNullable<BrowserContextOptions["storageState"]> }
            : {}),
          ...(input.recordHar ? { recordHar: { path: join(sessionArtifactRoot, "network.har"), mode: "minimal" } } : {}),
          ...(input.recordVideo ? { recordVideo: { dir: join(sessionArtifactRoot, "video") } } : {})
        };
        if (provider.persistentProfile || provider.extensions.length) {
          if ((input.mode ?? "headless") !== "headed") {
            throw new CockroachBrowserError("PERSISTENT_HEADED_REQUIRED", "Persistent profiles and reviewed browser extensions require a headed session.");
          }
          if (input.profile) {
            throw new CockroachBrowserError("PROFILE_MODE_CONFLICT", "Persistent browser sessions cannot also import an encrypted storage-state profile.");
          }
          const persistentRoot = provider.persistentProfile
            ? (await this.persistentProfiles.prepare(provider.persistentProfile)).path
            : join(sessionArtifactRoot, "extension-profile");
          context = await chromium.launchPersistentContext(persistentRoot, {
            ...launchOptions,
            ...contextOptions
          });
          browser = context.browser() ?? undefined;
        } else {
          browser = await chromium.launch(launchOptions);
          context = await browser.newContext(contextOptions);
        }
        // Headers may contain bearer credentials. The browser context has its
        // own copy; do not retain them in the long-lived session record.
        delete input.extraHTTPHeaders;
      }

      const session: ManagedSession = {
        input,
        id,
        ...(browser ? { browser } : {}),
        context,
        attached,
        state: "starting",
        createdAt,
        updatedAt: createdAt,
        actionsUsed: 0,
        budget: policy.budget,
        tabs: new Map(),
        pageIds: new WeakMap(),
        activeTabId: "",
        console: [],
        network: [],
        history: [],
        networkRules: new Map(),
        interceptedBytes: 0,
        traceActive: false,
        evidenceBytes: 0,
        actionTail: Promise.resolve(),
        dnsPins,
        consumedApprovals: new Set(),
        tabLocks: new Map(),
        ...(provider.persistentProfile ? { persistentProfile: provider.persistentProfile } : {})
      };
      managedSession = session;
      this.#sessions.set(id, session);
      await this.#installNetworkBoundary(session);
      const page = attached && context.pages()[0] ? context.pages()[0]! : await context.newPage();
      this.#registerPage(session, page);
      if (startUrl) await page.goto(startUrl.toString(), { waitUntil: "domcontentloaded" });
      await this.#recordHistory(session, page, "session.start");
      session.state = "ready";
      session.updatedAt = nowIso();
      await this.#recordContext(session, "browser.session.created", {
        policyDigest: policyDigest(policy),
        mode: input.mode ?? "headless",
        profile: input.profile ?? null
      });
      await this.#publishEvent(session, "browser.session.created", {
        policyDigest: policyDigest(policy),
        mode: input.mode ?? "headless",
        profile: input.profile ?? null
      });
      return await this.session(id);
    } catch (error) {
      if (context && attached && managedSession?.routeHandler) {
        await context.unroute("**/*", managedSession.routeHandler).catch(() => undefined);
      }
      if (context && attached && managedSession?.pageHandler) {
        context.off("page", managedSession.pageHandler);
      }
      if (context && !attached) await context.close().catch(() => undefined);
      if (browser && !attached) await browser.close().catch(() => undefined);
      this.#sessions.delete(id);
      if (provider.persistentProfile) this.#activePersistentProfiles.delete(provider.persistentProfile);
      throw error;
    }
  }

  async session(id: string): Promise<SessionSummary> {
    const session = this.#requireSession(id);
    const tabs = await Promise.all(
      [...session.tabs.entries()].map(async ([tabId, page]) => ({
        id: tabId,
        url: page.url(),
        title: await page.title().catch(() => ""),
        active: tabId === session.activeTabId
      }))
    );
    return {
      id: session.id,
      state: session.state,
      ...(session.input.profile ? { profile: session.input.profile } : {}),
      mode: session.input.mode ?? "headless",
      purpose: session.input.purpose,
      ...(session.input.actor ? { actor: session.input.actor } : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      actionsUsed: session.actionsUsed,
      budget: { ...session.budget },
      tabs,
      ...(session.challenge ? { challenge: structuredClone(session.challenge) } : {})
    };
  }

  async sessions(): Promise<SessionSummary[]> {
    return Promise.all([...this.#sessions.keys()].map((id) => this.session(id)));
  }

  activities(query: BrowserActivityQuery = {}): BrowserLifecycleEvent[] {
    return this.activity.list(query);
  }

  navigationGraph(id: string): NavigationGraph {
    const session = this.#requireSession(id);
    const nodeMap = new Map<string, NavigationGraph["nodes"][number]>();
    const edgeMap = new Map<string, NavigationGraph["edges"][number]>();
    const previousByTab = new Map<string, string>();
    for (const entry of session.history) {
      const nodeId = sha256({ tabId: entry.tabId, url: entry.url }).slice(0, 24);
      const existing = nodeMap.get(nodeId);
      if (existing) {
        existing.lastObservedAt = entry.observedAt;
        existing.visits += 1;
        if (entry.title) existing.title = entry.title;
      } else {
        nodeMap.set(nodeId, {
          id: nodeId,
          tabId: entry.tabId,
          url: entry.url,
          title: entry.title,
          firstObservedAt: entry.observedAt,
          lastObservedAt: entry.observedAt,
          visits: 1
        });
      }
      const from = previousByTab.get(entry.tabId);
      if (from && from !== nodeId) {
        const edgeId = sha256({ tabId: entry.tabId, from, to: nodeId, source: entry.source }).slice(0, 24);
        const edge = edgeMap.get(edgeId);
        if (edge) {
          edge.traversals += 1;
          edge.observedAt = entry.observedAt;
        } else {
          edgeMap.set(edgeId, {
            id: edgeId,
            tabId: entry.tabId,
            from,
            to: nodeId,
            source: entry.source,
            observedAt: entry.observedAt,
            traversals: 1
          });
        }
      }
      previousByTab.set(entry.tabId, nodeId);
    }
    return {
      sessionId: id,
      generatedAt: nowIso(),
      nodes: [...nodeMap.values()],
      edges: [...edgeMap.values()],
      truncated: session.history.length >= session.budget.maxHistoryEntries
    };
  }

  async closeSession(id: string, options: { saveProfile?: boolean; passphrase?: string } = {}): Promise<void> {
    const session = this.#requireSession(id);
    if (options.saveProfile && session.input.profile) {
      const passphrase = options.passphrase;
      if (!passphrase) {
        throw new CockroachBrowserError(
          "PROFILE_PASSPHRASE_REQUIRED",
          "Provide the profile passphrase again when saving; it is never retained in session memory."
        );
      }
      await this.profiles.saveContext(session.input.profile, session.context, passphrase);
    }
    if (session.traceActive) {
      await session.context.tracing.stop().catch(() => undefined);
    }
    if (session.attached) {
      if (session.routeHandler) await session.context.unroute("**/*", session.routeHandler).catch(() => undefined);
      if (session.pageHandler) session.context.off("page", session.pageHandler);
    } else if (session.input.recordHar) {
      await session.context.close();
      const harPath = join(this.root, "session-artifacts", id, "network.har");
      try {
        await this.#assertEvidenceFileBudget(session, harPath);
        const har = await readFile(harPath);
        await this.#addBufferEvidence(session, {
          kind: "har",
          contentType: "application/json",
          data: har,
          extension: ".har",
          metadata: { final: true }
        });
      } catch {
        // A context may not produce a HAR if no navigation occurred.
      }
    } else {
      await session.context.close();
    }
    if (session.input.recordVideo && !session.attached) {
      const videoRoot = join(this.root, "session-artifacts", id, "video");
      const videos = await readdir(videoRoot, { withFileTypes: true }).catch(() => []);
      for (const video of videos) {
        if (!video.isFile()) continue;
        const path = join(videoRoot, video.name);
        await this.#assertEvidenceFileBudget(session, path);
        await this.#addBufferEvidence(session, {
          kind: "video",
          contentType: video.name.endsWith(".webm") ? "video/webm" : "application/octet-stream",
          data: await readFile(path),
          extension: extname(video.name) || ".webm",
          metadata: { final: true }
        });
      }
    }
    if (!session.attached && session.browser) await session.browser.close();
    if (session.persistentProfile) this.#activePersistentProfiles.delete(session.persistentProfile);
    session.state = "closed";
    session.updatedAt = nowIso();
    await this.#recordContext(session, "browser.session.closed", {});
    await this.#publishEvent(session, "browser.session.closed", {
      actionsUsed: session.actionsUsed,
      evidenceBytes: session.evidenceBytes
    });
    this.#sessions.delete(id);
  }

  async act(sessionId: string, action: BrowserAction): Promise<{ output: unknown; receipt: ActionReceipt }> {
    return this.#queueAction(sessionId, action);
  }

  async actBatch(sessionId: string, input: BrowserActionBatchInput): Promise<BrowserActionBatchResult> {
    if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 100) {
      throw new CockroachBrowserError("ACTION_BATCH_INVALID", "Action batches require between 1 and 100 exact actions.");
    }
    const results: BrowserActionBatchResult["results"] = [];
    let failed = 0;
    for (let index = 0; index < input.actions.length; index += 1) {
      try {
        const result = await this.act(sessionId, input.actions[index]!);
        results.push({ index, output: result.output, receipt: result.receipt });
      } catch (error) {
        failed += 1;
        results.push({
          index,
          error: {
            code: error instanceof CockroachBrowserError ? error.code : "ACTION_FAILED",
            message: errorMessage(error)
          }
        });
        if (input.stopOnError !== false) break;
      }
    }
    return { results, completed: results.length - failed, failed };
  }

  async [GOVERNANCE_DISPATCH](
    sessionId: string,
    action: BrowserAction,
    governance: GovernanceDispatch
  ): Promise<{ output: unknown; receipt: ActionReceipt }> {
    return this.#queueAction(sessionId, action, governance);
  }

  async #queueAction(
    sessionId: string,
    action: BrowserAction,
    governance?: GovernanceDispatch
  ): Promise<{ output: unknown; receipt: ActionReceipt }> {
    const session = this.#requireSession(sessionId);
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const previous = session.actionTail;
    session.actionTail = previous.catch(() => undefined).then(() => gate);
    await previous.catch(() => undefined);
    try {
      return await this.#actSerialized(sessionId, action, governance);
    } finally {
      release();
    }
  }

  async #actSerialized(
    sessionId: string,
    action: BrowserAction,
    governance?: GovernanceDispatch
  ): Promise<{ output: unknown; receipt: ActionReceipt }> {
    const session = this.#requireSession(sessionId);
    const startedAt = nowIso();
    const startedMs = Date.now();
    const inputDigest = sha256(action);
    const effect = effectForAction(action);
    const risk = riskForAction(action);
    const policyHash = policyDigest(session.input.policy);
    let page: Page | undefined;
    let urlBefore: string | undefined;
    const receiptId = newId("receipt");
    let approval: ApprovalDecision | undefined;
    let output: unknown;
    let status: ActionReceipt["status"] = "succeeded";
    let failure: { code: string; message: string } | undefined;
    let challengeTransition: "detected" | undefined;
    const evidenceIds: string[] = [];

    await this.#publishEvent(session, "browser.action.started", {
      action: action.kind,
      effect,
      risk
    });

    try {
      this.#assertSessionBudget(session);
      session.actionsUsed += 1;
      session.updatedAt = nowIso();
      if (!action.purpose?.trim() || action.purpose.trim().length > 500) {
        throw new CockroachBrowserError("ACTION_PURPOSE_REQUIRED", "Every browser action requires a concise purpose.");
      }
      if (session.state === "challenge" && !CHALLENGE_SAFE_ACTIONS.has(action.kind)) {
        throw new CockroachBrowserError(
          "CHALLENGE_REQUIRES_HUMAN",
          "The page is waiting for a human or authorized challenge resolver. Automated bypass is not provided."
        );
      }
      const decision = evaluateAction(session.input.policy, action);
      page = this.#page(session, action.tabId);
      if (!["tab.lock", "tab.unlock", "tab.lock.status"].includes(action.kind)) {
        await this.#assertTabLock(session, session.activeTabId, action.lockTokenRef);
      }
      urlBefore = page.url();
      if (urlBefore !== "about:blank") {
        await assertUrlResolvedAllowed(session.input.policy, urlBefore, session.dnsPins, this.dnsResolver);
      }
      if (!decision.allowed) {
        throw new CockroachBrowserError("POLICY_DENIED", decision.reason);
      }
      if (decision.requiresApproval) {
        if (governance) {
          this.#consumeGovernance(session, governance, inputDigest, page.url(), action.url);
          approval = {
            allowed: true,
            approvalId: governance.approvalId,
            inputDigest,
            policyDigest: policyHash
          };
        } else {
          if (!this.approvalProvider) {
            throw new CockroachBrowserError(
              "APPROVAL_PROVIDER_REQUIRED",
              `Action ${action.kind} requires an exact approval provider, such as the Maqam adapter.`
            );
          }
          approval = await this.approvalProvider.authorize({
            sessionId,
            action: structuredClone(action),
            effect: decision.effect,
            risk: decision.risk,
            inputDigest,
            policyDigest: policyHash
          });
          if (!approval.allowed) {
            throw new CockroachBrowserError("APPROVAL_DENIED", approval.reason ?? "The exact browser action was not approved.");
          }
          this.#consumeApproval(session, approval, inputDigest, policyHash);
        }
      } else if (governance) {
        this.#consumeGovernance(session, governance, inputDigest, page.url(), action.url);
      }
      output = governance
        ? await this.#executeGoverned(session, page, action, evidenceIds, governance)
        : await this.#executeWithDialogs(session, page, action, evidenceIds);
      page = session.tabs.get(session.activeTabId) ?? page;
      if (page.url() !== "about:blank") {
        await assertUrlResolvedAllowed(session.input.policy, page.url(), session.dnsPins, this.dnsResolver);
      }
      if (action.kind !== "history.inspect") {
        await this.#recordHistory(session, page, action.kind);
      }
      if (["navigate", "reload", "click", "doubleClick", "press", "wait"].includes(action.kind)) {
        const wasChallenge = Boolean(session.challenge?.detected);
        session.challenge = await detectChallenge(page);
        if (session.challenge.detected) {
          session.state = "challenge";
          status = "challenge";
          if (!wasChallenge) challengeTransition = "detected";
        } else {
          session.state = "ready";
        }
      }
    } catch (error) {
      const code = error instanceof CockroachBrowserError ? error.code : "ACTION_FAILED";
      status = /(DENIED|REQUIRED|EXPIRED|REPLAY|MISMATCH|EXCEEDED)/.test(code) ? "denied" : "failed";
      failure = {
        code,
        message: errorMessage(error)
      };
      output = { error: failure };
    }

    const completedAt = nowIso();
    const outputDigest = sha256(output);
    const receipt = await this.evidence.appendReceipt({
      id: receiptId,
      sessionId,
      ...(action.tabId ? { tabId: action.tabId } : { tabId: session.activeTabId }),
      action: action.kind,
      effect,
      risk,
      purpose: action.purpose?.trim() || "unspecified",
      inputDigest,
      outputDigest,
      policyDigest: policyHash,
      ...(approval?.approvalId ? { approvalId: approval.approvalId } : {}),
      startedAt,
      completedAt,
      durationMs: Date.now() - startedMs,
      status,
      ...(urlBefore ? { urlBefore: sanitizeUrl(urlBefore) } : {}),
      ...(page ? { urlAfter: sanitizeUrl(page.url()) } : {}),
      evidenceIds,
      ...(failure ? { error: failure } : {})
    });
    await this.#recordContext(
      session,
      "browser.action.completed",
      {
        action: action.kind,
        status,
        effect,
        risk,
        policyDigest: policyHash,
        completedAt
      },
      {
        inputDigest,
        outputDigest,
        receiptHash: receipt.receiptHash,
        evidenceIds
      }
    );
    await this.#publishEvent(
      session,
      "browser.action.completed",
      {
        action: action.kind,
        effect,
        risk,
        status,
        inputDigest,
        outputDigest,
        policyDigest: policyHash,
        ...(failure ? { errorCode: failure.code } : {})
      },
      {
        receiptHash: receipt.receiptHash,
        evidenceIds
      }
    );
    if (challengeTransition === "detected") {
      await this.#publishEvent(
        session,
        "browser.challenge.detected",
        {
          kind: session.challenge?.kind ?? "unknown",
          evidence: session.challenge?.evidence ?? []
        },
        { receiptHash: receipt.receiptHash }
      );
    }
    if (failure) throw new CockroachBrowserError(failure.code, failure.message, { receipt });
    return { output, receipt };
  }

  #consumeApproval(
    session: ManagedSession,
    approval: ApprovalDecision,
    inputDigest: string,
    policyHash: string
  ): void {
    if (!approval.approvalId?.trim()) {
      throw new CockroachBrowserError("APPROVAL_ID_REQUIRED", "An approval must carry a non-empty one-use identifier.");
    }
    if (approval.inputDigest !== inputDigest || approval.policyDigest !== policyHash) {
      throw new CockroachBrowserError(
        "APPROVAL_SCOPE_MISMATCH",
        "The approval is not bound to this exact action and policy digest."
      );
    }
    if (!approval.expiresAt) {
      throw new CockroachBrowserError("APPROVAL_EXPIRY_REQUIRED", "An exact approval requires an expiry timestamp.");
    }
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new CockroachBrowserError("APPROVAL_EXPIRED", "The exact approval has expired.");
    }
    const key = `approval:${approval.approvalId}`;
    if (session.consumedApprovals.has(key)) {
      throw new CockroachBrowserError("APPROVAL_REPLAY", "The exact approval has already been consumed.");
    }
    session.consumedApprovals.add(key);
  }

  #consumeGovernance(
    session: ManagedSession,
    governance: GovernanceDispatch,
    inputDigest: string,
    currentUrl: string,
    requestedUrl?: string
  ): void {
    if (
      governance.authority !== "maqam"
      || !governance.approvalId.trim()
      || !governance.capabilityId.trim()
      || !/^[a-f0-9]{64}$/i.test(governance.executionDigest)
      || governance.actionDigest !== inputDigest
    ) {
      throw new CockroachBrowserError(
        "MAQAM_CAPABILITY_MISMATCH",
        "The internal Maqam capability is incomplete or not bound to this exact browser action."
      );
    }
    const authorizedOrigins = new Set(
      governance.authorizedOrigins.map((entry) => {
        const url = new URL(entry);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
          throw new CockroachBrowserError("MAQAM_ORIGIN_DENIED", "Maqam origins must be credential-free HTTP(S) origins.");
        }
        return url.origin;
      })
    );
    for (const candidate of [currentUrl, requestedUrl]) {
      if (!candidate || candidate === "about:blank") continue;
      if (!authorizedOrigins.has(new URL(candidate).origin)) {
        throw new CockroachBrowserError("MAQAM_ORIGIN_DENIED", "The Maqam capability does not authorize this origin.");
      }
    }
    const key = `maqam:${governance.capabilityId}`;
    if (session.consumedApprovals.has(key)) {
      throw new CockroachBrowserError("MAQAM_CAPABILITY_REPLAY", "The internal Maqam capability was already consumed.");
    }
    session.consumedApprovals.add(key);
  }

  async #executeGoverned(
    session: ManagedSession,
    page: Page,
    action: BrowserAction,
    evidenceIds: string[],
    governance: GovernanceDispatch
  ): Promise<unknown> {
    const prohibited = new Set(governance.prohibitedEffects);
    const observed = new Set<string>();
    const openedPages: Page[] = [];
    const onPage = (opened: Page): void => {
      observed.add("new-page");
      openedPages.push(opened);
      void opened.close().catch(() => undefined);
    };
    const onDownload = (download: Download): void => {
      observed.add("download");
      void download.cancel().catch(() => undefined);
    };
    const onFileChooser = (_chooser: FileChooser): void => {
      observed.add("file-picker");
    };
    session.context.on("page", onPage);
    page.on("download", onDownload);
    page.on("filechooser", onFileChooser);
    await session.context.clearPermissions();
    try {
      const output = await this.#executeWithDialogs(
        session,
        page,
        action,
        evidenceIds,
        () => observed.add("modal-dialog")
      );
      await Promise.all(openedPages.map((opened) => opened.close().catch(() => undefined)));
      const triggered = [...observed].filter((effect) => effect === "new-page" || prohibited.has(effect));
      if (triggered.length > 0) {
        throw new CockroachBrowserError(
          "PROHIBITED_BROWSER_EFFECT",
          `The browser attempted prohibited effects: ${triggered.join(", ")}.`,
          { effects: triggered }
        );
      }
      return output;
    } finally {
      session.context.off("page", onPage);
      page.off("download", onDownload);
      page.off("filechooser", onFileChooser);
    }
  }

  async #executeWithDialogs(
    session: ManagedSession,
    page: Page,
    action: BrowserAction,
    evidenceIds: string[],
    onDialogObserved?: () => void
  ): Promise<unknown> {
    const outcomes: Array<{
      type: string;
      message: string;
      response: "accepted" | "dismissed";
      explicit: boolean;
    }> = [];
    const pending: Promise<void>[] = [];
    let observedCount = 0;
    const onDialog = (dialog: Dialog): void => {
      onDialogObserved?.();
      observedCount += 1;
      if (observedCount > 8) {
        void dialog.dismiss().catch(() => undefined);
        return;
      }
      pending.push((async () => {
        const type = dialog.type();
        const message = dialog.message().slice(0, 500);
        const response = action.dialog;
        if (response?.action === "accept") {
          let promptText: string | undefined;
          if (response.promptTextRef) {
            promptText = await this.#resolveSecret(response.promptTextRef);
            if (Buffer.byteLength(promptText) > 4_096) {
              throw new CockroachBrowserError(
                "DIALOG_PROMPT_EXCEEDED",
                "A dialog prompt response may be at most 4096 bytes."
              );
            }
          }
          await dialog.accept(promptText);
          outcomes.push({
            type,
            message,
            response: "accepted",
            explicit: true
          });
          return;
        }
        await dialog.dismiss();
        outcomes.push({
          type,
          message,
          response: "dismissed",
          explicit: response?.action === "dismiss"
        });
      })());
    };
    page.on("dialog", onDialog);
    try {
      const output = await this.#execute(session, page, action, evidenceIds);
      await Promise.all(pending);
      if (outcomes.length === 0) return output;
      if (isPlainObject(output)) return { ...output, dialogs: outcomes };
      return { value: output, dialogs: outcomes };
    } finally {
      page.off("dialog", onDialog);
      await Promise.allSettled(pending);
    }
  }

  async snapshot(sessionId: string, tabId?: string): Promise<PageSnapshot> {
    const session = this.#requireSession(sessionId);
    const page = this.#page(session, tabId);
    await this.#assertPageAdmitted(session, page);
    const snapshot = await captureSnapshot({
      page,
      sessionId,
      tabId: tabId ?? session.activeTabId,
      maxChars: session.budget.maxSnapshotChars
    });
    await this.#addJsonEvidence(session, {
      kind: "snapshot",
      value: redactSnapshot(snapshot),
      sourceUrl: page.url()
    });
    return snapshot;
  }

  async audit(
    sessionId: string,
    kinds: Array<"accessibility" | "performance" | "assets" | "console" | "security"> = [
      "accessibility",
      "performance",
      "assets",
      "console",
      "security"
    ]
  ): Promise<{ report: Record<string, unknown>; evidence: EvidenceRecord }> {
    const session = this.#requireSession(sessionId);
    const page = this.#page(session);
    await this.#assertPageAdmitted(session, page);
    const report: Record<string, unknown> = {
      sessionId,
      url: page.url(),
      capturedAt: nowIso()
    };
    if (kinds.includes("accessibility")) {
      report.accessibility = await page.evaluate(() => {
        const imagesWithoutAlt = [...document.images].filter((image) => !image.alt).length;
        const controlsWithoutName = [...document.querySelectorAll("button,input,select,textarea,a[href]")].filter((element) => {
          const html = element as HTMLElement;
          return !(element.getAttribute("aria-label") || element.getAttribute("title") || html.innerText || element.textContent);
        }).length;
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => ({
          level: Number(heading.tagName.slice(1)),
          text: heading.textContent?.trim().slice(0, 160) ?? ""
        }));
        return { imagesWithoutAlt, controlsWithoutName, headings };
      });
    }
    if (kinds.includes("performance")) {
      report.performance = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const paints = performance.getEntriesByType("paint").map((entry) => ({ name: entry.name, startTime: entry.startTime }));
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        return {
          navigation: navigation
            ? {
                dnsMs: navigation.domainLookupEnd - navigation.domainLookupStart,
                connectMs: navigation.connectEnd - navigation.connectStart,
                ttfbMs: navigation.responseStart - navigation.requestStart,
                domContentLoadedMs: navigation.domContentLoadedEventEnd,
                loadMs: navigation.loadEventEnd
              }
            : null,
          paints,
          resources: resources.length,
          transferBytes: resources.reduce((total, entry) => total + entry.transferSize, 0)
        };
      });
    }
    if (kinds.includes("assets")) {
      report.assets = session.network.filter((entry) => entry.type === "requestfailed" || (entry.status ?? 0) >= 400);
    }
    if (kinds.includes("console")) {
      report.console = session.console.filter((entry) => ["error", "warning", "warn"].includes(entry.type));
    }
    if (kinds.includes("security")) {
      report.security = await page.evaluate(() => ({
        secureContext: globalThis.isSecureContext,
        mixedContent: location.protocol === "https:" && [...document.querySelectorAll("[src],[href]")].some((element) => {
          const value = element.getAttribute("src") || element.getAttribute("href") || "";
          return value.startsWith("http:");
        }),
        insecureForms: [...document.forms].filter((form) => form.action.startsWith("http:")).length,
        openerPresent: Boolean(globalThis.opener)
      }));
    }
    const evidence = await this.#addJsonEvidence(session, {
      kind: "audit",
      value: report,
      sourceUrl: page.url(),
      metadata: { kinds }
    });
    return { report, evidence };
  }

  async compare(
    sessionId: string,
    baselinePath: string,
    options: { threshold?: number; fullPage?: boolean } = {}
  ): Promise<{ mismatchPixels: number; mismatchRatio: number; evidence: EvidenceRecord }> {
    const session = this.#requireSession(sessionId);
    const page = this.#page(session);
    await this.#assertPageAdmitted(session, page);
    const actualBuffer = await page.screenshot({ fullPage: options.fullPage ?? true, type: "png" });
    const baselineRoot = resolve(this.root, "baselines");
    await mkdir(baselineRoot, { recursive: true });
    const resolvedBaseline = resolve(baselineRoot, baselinePath);
    const rootReal = await realpath(baselineRoot);
    const baselineReal = await realpath(resolvedBaseline).catch(() => resolvedBaseline);
    const baselineRelation = relative(rootReal, baselineReal);
    if (!baselineRelation || baselineRelation.startsWith("..") || isAbsolute(baselineRelation)) {
      throw new CockroachBrowserError(
        "BASELINE_PATH_DENIED",
        "Visual baselines must be named files inside the runtime baseline directory."
      );
    }
    const baselineInfo = await lstat(baselineReal);
    if (!baselineInfo.isFile()) {
      throw new CockroachBrowserError("BASELINE_PATH_DENIED", "Visual baselines must be regular files.");
    }
    const baseline = PNG.sync.read(await readFile(baselineReal));
    const actual = PNG.sync.read(actualBuffer);
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      throw new CockroachBrowserError("VISUAL_DIMENSION_MISMATCH", "Baseline and current screenshots have different dimensions.");
    }
    const diff = new PNG({ width: actual.width, height: actual.height });
    const mismatchPixels = pixelmatch(
      baseline.data,
      actual.data,
      diff.data,
      actual.width,
      actual.height,
      { threshold: options.threshold ?? 0.1 }
    );
    const mismatchRatio = mismatchPixels / (actual.width * actual.height);
    const evidence = await this.#addBufferEvidence(session, {
      kind: "comparison",
      contentType: "image/png",
      data: PNG.sync.write(diff),
      extension: ".png",
      sourceUrl: page.url(),
      metadata: { baselinePath: basename(baselinePath), mismatchPixels, mismatchRatio }
    });
    return { mismatchPixels, mismatchRatio, evidence };
  }

  async resumeAfterHuman(sessionId: string): Promise<ChallengeReport> {
    const session = this.#requireSession(sessionId);
    const wasChallenge = Boolean(session.challenge?.detected);
    const report = await detectChallenge(this.#page(session));
    session.challenge = report;
    session.state = report.detected ? "challenge" : "ready";
    session.updatedAt = nowIso();
    if (wasChallenge && !report.detected) {
      await this.#publishEvent(session, "browser.challenge.resolved", {
        resolution: "human-handoff"
      });
    }
    return report;
  }

  async close(): Promise<void> {
    for (const id of [...this.#sessions.keys()]) {
      await this.closeSession(id).catch(() => undefined);
    }
  }

  async #execute(session: ManagedSession, page: Page, action: BrowserAction, evidenceIds: string[]): Promise<unknown> {
    const timeout = Math.min(action.timeoutMs ?? 30_000, 120_000);
    const target = () => locatorFor(page, action.ref, action.selector, action.xpath, action.frame);
    switch (action.kind) {
      case "navigate": {
        if (!action.url) throw new CockroachBrowserError("URL_REQUIRED", "Navigation requires a URL.");
        const url = (
          await assertUrlResolvedAllowed(session.input.policy, action.url, session.dnsPins, this.dnsResolver)
        ).toString();
        const response = await page.goto(url, { waitUntil: action.waitUntil ?? "domcontentloaded", timeout });
        return { url: page.url(), status: response?.status() ?? null, title: await page.title() };
      }
      case "back":
        await page.goBack({ waitUntil: action.waitUntil ?? "domcontentloaded", timeout });
        return { url: page.url(), title: await page.title() };
      case "forward":
        await page.goForward({ waitUntil: action.waitUntil ?? "domcontentloaded", timeout });
        return { url: page.url(), title: await page.title() };
      case "reload":
        await page.reload({ waitUntil: action.waitUntil ?? "domcontentloaded", timeout });
        return { url: page.url(), title: await page.title() };
      case "click":
        await (await target()).click({ timeout });
        return { clicked: targetDescription(action) };
      case "doubleClick":
        await (await target()).dblclick({ timeout });
        return { doubleClicked: targetDescription(action) };
      case "fill":
        await (await target()).fill(action.value ?? "", { timeout });
        return { filled: targetDescription(action), length: (action.value ?? "").length };
      case "type":
        await (await target()).pressSequentially(action.value ?? "", { timeout });
        return { typed: targetDescription(action), length: (action.value ?? "").length };
      case "press":
        if (!action.key) throw new CockroachBrowserError("KEY_REQUIRED", "Press requires a key.");
        await (await target()).press(action.key, { timeout });
        return { pressed: action.key };
      case "hover":
        await (await target()).hover({ timeout });
        return { hovered: targetDescription(action) };
      case "focus":
        await (await target()).focus();
        return { focused: targetDescription(action) };
      case "check":
        await (await target()).check({ timeout });
        return { checked: targetDescription(action) };
      case "uncheck":
        await (await target()).uncheck({ timeout });
        return { unchecked: targetDescription(action) };
      case "select": {
        const values = action.values ?? (action.value ? [action.value] : []);
        return { selected: await (await target()).selectOption(values, { timeout }) };
      }
      case "scroll":
        await page.mouse.wheel(action.deltaX ?? 0, action.deltaY ?? 700);
        return { deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 700 };
      case "drag": {
        const source = await target();
        const targetLocator = await locatorFor(page, action.targetRef);
        await source.dragTo(targetLocator, { timeout });
        return { source: targetDescription(action), target: action.targetRef };
      }
      case "mouse.move": {
        const point = await boundedPoint(page, action);
        const steps = boundedInteger(action.steps ?? 1, 1, 100, "MOUSE_STEPS_INVALID");
        await page.mouse.move(point.x, point.y, { steps });
        return { ...point, steps };
      }
      case "mouse.down": {
        const button = action.button ?? "left";
        const clickCount = boundedInteger(action.clickCount ?? 1, 1, 3, "MOUSE_CLICK_COUNT_INVALID");
        await page.mouse.down({ button, clickCount });
        return { button, clickCount };
      }
      case "mouse.up": {
        const button = action.button ?? "left";
        const clickCount = boundedInteger(action.clickCount ?? 1, 1, 3, "MOUSE_CLICK_COUNT_INVALID");
        await page.mouse.up({ button, clickCount });
        return { button, clickCount };
      }
      case "mouse.click": {
        const point = await boundedPoint(page, action);
        const button = action.button ?? "left";
        const clickCount = boundedInteger(action.clickCount ?? 1, 1, 3, "MOUSE_CLICK_COUNT_INVALID");
        await page.mouse.click(point.x, point.y, { button, clickCount, delay: 0 });
        return { ...point, button, clickCount };
      }
      case "keyboard.down":
        if (!action.key || action.key.length > 100) {
          throw new CockroachBrowserError("KEY_REQUIRED", "Keyboard down requires a key of at most 100 characters.");
        }
        await page.keyboard.down(action.key);
        return { key: action.key, state: "down" };
      case "keyboard.up":
        if (!action.key || action.key.length > 100) {
          throw new CockroachBrowserError("KEY_REQUIRED", "Keyboard up requires a key of at most 100 characters.");
        }
        await page.keyboard.up(action.key);
        return { key: action.key, state: "up" };
      case "keyboard.insertText": {
        const value = action.value ?? "";
        if (Buffer.byteLength(value) > 16_384) {
          throw new CockroachBrowserError("KEYBOARD_TEXT_EXCEEDED", "Inserted keyboard text may be at most 16384 bytes.");
        }
        await page.keyboard.insertText(value);
        return { insertedBytes: Buffer.byteLength(value) };
      }
      case "upload": {
        const paths = action.paths ?? (action.path ? [action.path] : []);
        if (paths.length === 0) throw new CockroachBrowserError("UPLOAD_PATH_REQUIRED", "Upload requires one or more paths.");
        const admitted = await this.#resolveUploadPaths(paths);
        const total = admitted.reduce((sum, entry) => sum + entry.size, 0);
        if (total > session.budget.maxUploadBytes) {
          throw new CockroachBrowserError("UPLOAD_BUDGET_EXCEEDED", "Upload files exceed the session byte limit.");
        }
        await (await target()).setInputFiles(admitted.map((entry) => entry.path));
        return { files: admitted.map((entry) => basename(entry.path)), bytes: total };
      }
      case "download": {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout }),
          (await target()).click({ timeout })
        ]);
        const record = await this.#captureDownload(session, download);
        evidenceIds.push(record.id);
        return { evidenceId: record.id, suggestedFilename: download.suggestedFilename(), bytes: record.size };
      }
      case "evaluate": {
        if (!action.expression) throw new CockroachBrowserError("EXPRESSION_REQUIRED", "Evaluate requires JavaScript source.");
        const value = await page.evaluate((expression) => globalThis.eval(expression), action.expression);
        return structuredClone(value);
      }
      case "query.inspect": {
        const query = action.query ?? {};
        const properties: string[] = query.properties?.length
          ? [...new Set(query.properties)]
          : ["text", "attributes", "box", "value", "checked", "visible", "enabled", "count"];
        const locator = action.ref || action.selector || action.xpath ? await target() : page.locator("body");
        const total = await locator.count();
        const returned = query.all ? Math.min(total, 100) : Math.min(total, 1);
        const names = [...new Set(query.attributeNames ?? [])];
        if (names.length > 64 || names.some((name) => !/^[A-Za-z_:][A-Za-z0-9:._-]{0,127}$/.test(name))) {
          throw new CockroachBrowserError("QUERY_ATTRIBUTE_INVALID", "Attribute queries accept at most 64 bounded attribute names.");
        }
        const items: Array<Record<string, unknown>> = [];
        for (let index = 0; index < returned; index += 1) {
          const item = locator.nth(index);
          const result: Record<string, unknown> = {};
          if (properties.includes("text")) result.text = (await item.innerText({ timeout }).catch(() => "")).slice(0, session.budget.maxSnapshotChars);
          if (properties.includes("html")) result.html = (await item.innerHTML({ timeout }).catch(() => "")).slice(0, session.budget.maxSnapshotChars);
          if (properties.includes("attributes")) {
            result.attributes = await item.evaluate((element, requested) => {
              const entries = requested.length
                ? requested.map((name) => [name, element.getAttribute(name)] as const)
                : [...element.attributes].slice(0, 64).map((attribute) => [attribute.name, attribute.value] as const);
              return Object.fromEntries(entries.filter(([, value]) => value !== null));
            }, names);
          }
          if (properties.includes("box")) result.box = await item.boundingBox();
          if (properties.includes("value")) result.value = await item.inputValue({ timeout }).catch(() => null);
          if (properties.includes("checked")) result.checked = await item.isChecked({ timeout }).catch(() => null);
          if (properties.includes("visible")) result.visible = await item.isVisible();
          if (properties.includes("enabled")) result.enabled = await item.isEnabled({ timeout }).catch(() => null);
          items.push(result);
        }
        return { count: total, returned, items };
      }
      case "emulation.set": {
        const emulation = action.emulation;
        if (!emulation || Object.keys(emulation).length === 0) {
          throw new CockroachBrowserError("EMULATION_REQUIRED", "Emulation requires at least one explicit setting.");
        }
        if (emulation.viewport) {
          const width = boundedInteger(emulation.viewport.width, 320, 7680, "VIEWPORT_INVALID");
          const height = boundedInteger(emulation.viewport.height, 200, 4320, "VIEWPORT_INVALID");
          await page.setViewportSize({ width, height });
        }
        if (emulation.media !== undefined || emulation.colorScheme || emulation.reducedMotion || emulation.forcedColors) {
          await page.emulateMedia({
            ...(emulation.media !== undefined ? { media: emulation.media } : {}),
            ...(emulation.colorScheme ? { colorScheme: emulation.colorScheme } : {}),
            ...(emulation.reducedMotion ? { reducedMotion: emulation.reducedMotion } : {}),
            ...(emulation.forcedColors ? { forcedColors: emulation.forcedColors } : {})
          });
        }
        if (emulation.offline !== undefined) await session.context.setOffline(emulation.offline);
        if (emulation.extraHTTPHeaders) {
          const headers = boundedHeaders(emulation.extraHTTPHeaders);
          await session.context.setExtraHTTPHeaders(headers);
        }
        if (emulation.geolocation === null) {
          await session.context.setGeolocation(null);
        } else if (emulation.geolocation) {
          const { latitude, longitude, accuracy = 0 } = emulation.geolocation;
          if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000) {
            throw new CockroachBrowserError("GEOLOCATION_INVALID", "Geolocation must use valid latitude, longitude, and bounded accuracy values.");
          }
          await session.context.setGeolocation({ latitude, longitude, accuracy });
        }
        if (emulation.permissions) {
          const permissions = [...new Set(emulation.permissions)];
          if (permissions.length > 2) throw new CockroachBrowserError("PERMISSION_LIMIT_EXCEEDED", "Only reviewed geolocation and notification permissions are accepted.");
          await session.context.grantPermissions(permissions, { origin: new URL(page.url()).origin });
        }
        return { applied: Object.keys(emulation).sort() };
      }
      case "emulation.clear":
        await page.emulateMedia({ media: null, colorScheme: "no-preference", reducedMotion: "no-preference", forcedColors: "none" });
        await session.context.setOffline(false);
        await session.context.setGeolocation(null);
        await session.context.clearPermissions();
        await session.context.setExtraHTTPHeaders({});
        if (session.input.viewport) await page.setViewportSize(session.input.viewport);
        return { cleared: true };
      case "cache.clear": {
        const cdp = await session.context.newCDPSession(page);
        await cdp.send("Network.clearBrowserCache");
        await cdp.detach();
        return { cleared: "browser-cache" };
      }
      case "console.clear": {
        const removed = session.console.length;
        session.console.length = 0;
        return { cleared: removed };
      }
      case "network.clear": {
        const removed = session.network.length;
        session.network.length = 0;
        return { cleared: removed };
      }
      case "wait":
        if (action.ref || action.selector || action.xpath) {
          await (await target()).waitFor({ state: "visible", timeout });
          return { target: targetDescription(action), state: "visible" };
        }
        if (action.text) {
          await page.getByText(action.text, { exact: false }).first().waitFor({ state: "visible", timeout });
          return { text: action.text, state: "visible" };
        }
        await page.waitForTimeout(Math.min(timeout, 10_000));
        return { waitedMs: Math.min(timeout, 10_000) };
      case "history.inspect": {
        const limit = boundedInteger(
          action.limit ?? Math.min(25, session.budget.maxHistoryEntries),
          1,
          session.budget.maxHistoryEntries,
          "HISTORY_LIMIT_INVALID"
        );
        const entries = session.history
          .filter((entry) => !action.tabId || entry.tabId === action.tabId)
          .slice(-limit)
          .map((entry) => ({ ...entry }));
        return {
          entries,
          returned: entries.length,
          retained: session.history.length,
          ceiling: session.budget.maxHistoryEntries
        };
      }
      case "network.route.add": {
        if (!action.route) {
          throw new CockroachBrowserError("NETWORK_ROUTE_REQUIRED", "Adding a network route requires a route definition.");
        }
        if (session.networkRules.size >= session.budget.maxNetworkRules) {
          throw new CockroachBrowserError("NETWORK_ROUTE_LIMIT_EXCEEDED", "The session network-rule limit has been reached.");
        }
        const id = action.route.id ?? newId("route");
        if (session.networkRules.has(id)) {
          throw new CockroachBrowserError("NETWORK_ROUTE_EXISTS", `Network route ${id} already exists.`);
        }
        const compiled = compileNetworkRoute(action.route, id, session.budget.maxRouteFulfillBytes);
        await assertUrlResolvedAllowed(
          session.input.policy,
          `${compiled.summary.origin}/`,
          session.dnsPins,
          this.dnsResolver
        );
        session.networkRules.set(id, compiled);
        return { route: structuredClone(compiled.summary), count: session.networkRules.size };
      }
      case "network.route.remove": {
        if (!action.routeId) {
          throw new CockroachBrowserError("NETWORK_ROUTE_ID_REQUIRED", "Removing a network route requires routeId.");
        }
        const removed = session.networkRules.delete(action.routeId);
        if (!removed) {
          throw new CockroachBrowserError("NETWORK_ROUTE_NOT_FOUND", `Network route ${action.routeId} was not found.`);
        }
        return { removed: action.routeId, count: session.networkRules.size };
      }
      case "network.routes.list": {
        const routes: NetworkRouteSummary[] = [...session.networkRules.values()].map((entry) =>
          structuredClone(entry.summary)
        );
        return {
          routes,
          count: routes.length,
          ceiling: session.budget.maxNetworkRules,
          interceptedBytes: session.interceptedBytes,
          interceptedByteCeiling: session.budget.maxInterceptedBytes
        };
      }
      case "network.inspect": {
        const records = this.#networkRecords(session, action);
        return {
          records,
          returned: records.length,
          retained: session.network.length,
          ceiling: session.budget.maxNetworkEntries
        };
      }
      case "network.export": {
        const records = this.#networkRecords(session, action);
        const format = action.outputFormat ?? "json";
        const artifact = serializeNetworkExport(records, format);
        const evidence = await this.#addBufferEvidence(session, {
          kind: "har",
          contentType: artifact.contentType,
          data: Buffer.from(artifact.body, "utf8"),
          extension: artifact.extension,
          sourceUrl: page.url(),
          metadata: {
            format,
            records: records.length,
            filtered: Boolean(action.tabId || action.method || action.status || action.resourceType)
          }
        });
        evidenceIds.push(evidence.id);
        return { evidenceId: evidence.id, format, records: records.length, bytes: evidence.size };
      }
      case "capture.paired":
        return this.#capturePaired(session, page, action, evidenceIds);
      case "annotate.show":
        return this.#showAnnotations(session, page, action);
      case "annotate.clear": {
        const removed = await page.evaluate(() => {
          const root = document.getElementById("cockroach-browser-annotations");
          if (!root) return false;
          root.remove();
          return true;
        });
        return { cleared: removed };
      }
      case "screenshot": {
        await this.#assertCaptureGeometry(page, session, action.fullPage ?? true);
        const buffer = await page.screenshot({
          fullPage: action.fullPage ?? true,
          type: action.format ?? "png",
          ...(action.format === "jpeg" && action.quality ? { quality: action.quality } : {})
        });
        const evidence = await this.#addBufferEvidence(session, {
          kind: "screenshot",
          contentType: action.format === "jpeg" ? "image/jpeg" : "image/png",
          data: buffer,
          extension: action.format === "jpeg" ? ".jpg" : ".png",
          sourceUrl: page.url()
        });
        evidenceIds.push(evidence.id);
        return { evidenceId: evidence.id, bytes: evidence.size };
      }
      case "pdf": {
        await this.#assertCaptureGeometry(page, session, true);
        const buffer = await page.pdf({ printBackground: true, format: "A4" });
        const evidence = await this.#addBufferEvidence(session, {
          kind: "pdf",
          contentType: "application/pdf",
          data: buffer,
          extension: ".pdf",
          sourceUrl: page.url()
        });
        evidenceIds.push(evidence.id);
        return { evidenceId: evidence.id, bytes: evidence.size };
      }
      case "snapshot": {
        const snapshot = await this.snapshot(session.id, action.tabId);
        const evidence = this.evidence.list(session.id).at(-1);
        if (evidence) evidenceIds.push(evidence.id);
        return snapshot;
      }
      case "extract": {
        const locator = action.ref || action.selector || action.xpath ? await target() : page.locator("body");
        const result = {
          text: (await locator.innerText({ timeout })).slice(0, session.budget.maxSnapshotChars),
          html: (await locator.innerHTML({ timeout })).slice(0, session.budget.maxSnapshotChars)
        };
        const evidence = await this.#addJsonEvidence(session, {
          kind: "snapshot",
          value: result,
          sourceUrl: page.url(),
          metadata: { extraction: true }
        });
        evidenceIds.push(evidence.id);
        return { ...result, evidenceId: evidence.id };
      }
      case "cookies.read":
        return (await session.context.cookies(session.input.policy.allowedOrigins)).map((cookie) => ({
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite
        }));
      case "cookies.write": {
        const payload = await this.#resolveSecretJson(action.dataRef, "Cookie writes");
        if (!Array.isArray(payload) || payload.length === 0 || payload.length > 100) {
          throw new CockroachBrowserError("COOKIE_WRITE_INVALID", "Cookie writes require a non-empty array of at most 100 cookies.");
        }
        const cookies = [];
        for (const value of payload) {
          if (!isPlainObject(value) || typeof value.name !== "string" || typeof value.value !== "string" || typeof value.url !== "string") {
            throw new CockroachBrowserError(
              "COOKIE_WRITE_INVALID",
              "Each cookie requires string name, value, and an explicit admitted url."
            );
          }
          const url = await assertUrlResolvedAllowed(
            session.input.policy,
            value.url,
            session.dnsPins,
            this.dnsResolver
          );
          cookies.push({
            name: value.name.slice(0, 256),
            value: value.value,
            url: url.toString(),
            ...(typeof value.expires === "number" ? { expires: value.expires } : {}),
            ...(typeof value.httpOnly === "boolean" ? { httpOnly: value.httpOnly } : {}),
            ...(typeof value.secure === "boolean" ? { secure: value.secure } : {}),
            ...(typeof value.sameSite === "string" && ["Strict", "Lax", "None"].includes(value.sameSite)
              ? { sameSite: value.sameSite as "Strict" | "Lax" | "None" }
              : {})
          });
        }
        await session.context.addCookies(cookies);
        return { cookiesWritten: cookies.length };
      }
      case "storage.read":
        return page.evaluate(() => ({
          localStorage: Object.fromEntries(Object.entries(localStorage)),
          sessionStorage: Object.fromEntries(Object.entries(sessionStorage))
        }));
      case "storage.write": {
        const payload = await this.#resolveSecretJson(action.dataRef, "Storage writes");
        if (!isPlainObject(payload)) {
          throw new CockroachBrowserError("STORAGE_WRITE_INVALID", "Storage writes require a bounded JSON object.");
        }
        const local = stringRecord(payload.localStorage, "localStorage");
        const sessionValues = stringRecord(payload.sessionStorage, "sessionStorage");
        await page.evaluate(({ local, sessionValues }) => {
          for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
          for (const [key, value] of Object.entries(sessionValues)) sessionStorage.setItem(key, value);
        }, { local, sessionValues });
        return {
          localStorageKeysWritten: Object.keys(local).length,
          sessionStorageKeysWritten: Object.keys(sessionValues).length
        };
      }
      case "clipboard.read": {
        await session.context.grantPermissions(["clipboard-read"], {
          origin: new URL(page.url()).origin
        });
        try {
          const value = await page.evaluate(() => navigator.clipboard.readText());
          const bytes = Buffer.byteLength(value);
          if (bytes > session.budget.maxClipboardBytes) {
            throw new CockroachBrowserError(
              "CLIPBOARD_BUDGET_EXCEEDED",
              "Clipboard content exceeds the session byte limit."
            );
          }
          return { value, bytes };
        } finally {
          await session.context.clearPermissions();
        }
      }
      case "clipboard.write": {
        const value = await this.#resolveSecret(action.valueRef);
        const bytes = Buffer.byteLength(value);
        if (bytes > session.budget.maxClipboardBytes) {
          throw new CockroachBrowserError(
            "CLIPBOARD_BUDGET_EXCEEDED",
            "Clipboard content exceeds the session byte limit."
          );
        }
        await session.context.grantPermissions(["clipboard-write"], {
          origin: new URL(page.url()).origin
        });
        try {
          await page.evaluate((text) => navigator.clipboard.writeText(text), value);
          return { bytes };
        } finally {
          await session.context.clearPermissions();
        }
      }
      case "state.save": {
        const name = stateName(action.stateName);
        const passphrase = await this.#resolveSecret(action.passphraseRef);
        const existing = await this.profiles.list();
        if (!existing.includes(name) && existing.length >= session.budget.maxSavedStates) {
          throw new CockroachBrowserError(
            "SAVED_STATE_LIMIT_EXCEEDED",
            "The runtime saved-state limit has been reached."
          );
        }
        await this.profiles.saveContext(name, session.context, passphrase);
        return { saved: name, profiles: existing.includes(name) ? existing.length : existing.length + 1 };
      }
      case "state.load": {
        const name = stateName(action.stateName);
        const passphrase = await this.#resolveSecret(action.passphraseRef);
        const state = await this.profiles.load(name, passphrase);
        const applied = await this.#applySavedState(session, page, state);
        return { loaded: name, ...applied };
      }
      case "state.list": {
        const profiles = await this.profiles.list();
        return {
          profiles: profiles.slice(0, session.budget.maxSavedStates),
          count: profiles.length,
          ceiling: session.budget.maxSavedStates
        };
      }
      case "state.delete": {
        const name = stateName(action.stateName);
        await this.profiles.delete(name);
        return { deleted: name };
      }
      case "tab.open": {
        if (session.tabs.size >= session.budget.maxTabs) {
          throw new CockroachBrowserError("TAB_BUDGET_EXCEEDED", "The session tab limit has been reached.");
        }
        const newPage = await session.context.newPage();
        const tabId = this.#registerPage(session, newPage);
        if (action.url) {
          const url = await assertUrlResolvedAllowed(
            session.input.policy,
            action.url,
            session.dnsPins,
            this.dnsResolver
          );
          await newPage.goto(url.toString(), { waitUntil: "domcontentloaded" });
        }
        return { tabId, url: newPage.url() };
      }
      case "tab.close": {
        const targetId = action.tabId ?? session.activeTabId;
        const target = this.#page(session, targetId);
        await this.#assertTabLock(session, targetId, action.lockTokenRef);
        await target.close();
        session.tabs.delete(targetId);
        session.tabLocks.delete(targetId);
        const replacement = session.tabs.keys().next().value as string | undefined;
        if (!replacement) throw new CockroachBrowserError("LAST_TAB_CLOSED", "The final tab was closed; close the session.");
        session.activeTabId = replacement;
        return { closed: targetId, active: replacement };
      }
      case "tab.switch": {
        if (!action.tabId) throw new CockroachBrowserError("TAB_ID_REQUIRED", "Tab switch requires tabId.");
        const target = this.#page(session, action.tabId);
        await target.bringToFront();
        session.activeTabId = action.tabId;
        return { active: action.tabId, url: target.url() };
      }
      case "tab.lock": {
        const tabId = action.tabId ?? session.activeTabId;
        const active = this.#activeTabLock(session, tabId);
        if (active) {
          throw new CockroachBrowserError(
            "TAB_ALREADY_LOCKED",
            `Tab ${tabId} is already locked by ${active.owner} until ${active.expiresAt}.`
          );
        }
        const owner = action.lockOwner?.trim();
        if (!owner || owner.length > 200) {
          throw new CockroachBrowserError(
            "TAB_LOCK_OWNER_REQUIRED",
            "Tab locking requires an owner of at most 200 characters."
          );
        }
        const token = await this.#resolveSecret(action.lockTokenRef);
        const ttlMs = boundedInteger(
          action.lockTtlMs ?? 5 * 60_000,
          1_000,
          24 * 60 * 60_000,
          "TAB_LOCK_TTL_INVALID"
        );
        const acquiredAt = nowIso();
        const lock: InternalTabLock = {
          tabId,
          owner,
          acquiredAt,
          expiresAt: new Date(Date.now() + ttlMs).toISOString(),
          tokenDigest: sha256(token)
        };
        session.tabLocks.set(tabId, lock);
        return { lock: publicTabLock(lock) };
      }
      case "tab.unlock": {
        const tabId = action.tabId ?? session.activeTabId;
        const lock = this.#activeTabLock(session, tabId);
        if (!lock) {
          throw new CockroachBrowserError("TAB_NOT_LOCKED", `Tab ${tabId} is not locked.`);
        }
        await this.#assertTabLock(session, tabId, action.lockTokenRef);
        session.tabLocks.delete(tabId);
        return { unlocked: tabId, owner: lock.owner };
      }
      case "tab.lock.status": {
        const tabId = action.tabId ?? session.activeTabId;
        const lock = this.#activeTabLock(session, tabId);
        return { tabId, lock: lock ? publicTabLock(lock) : null };
      }
      case "trace.start":
        if (session.traceActive) throw new CockroachBrowserError("TRACE_ALREADY_ACTIVE", "Tracing is already active.");
        await session.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        session.traceActive = true;
        return { active: true };
      case "trace.stop": {
        if (!session.traceActive) throw new CockroachBrowserError("TRACE_NOT_ACTIVE", "Tracing is not active.");
        const path = join(this.root, "session-artifacts", session.id, `trace-${Date.now()}.zip`);
        await mkdir(resolve(path, ".."), { recursive: true });
        await session.context.tracing.stop({ path });
        session.traceActive = false;
        await this.#assertEvidenceFileBudget(session, path);
        const evidence = await this.#addBufferEvidence(session, {
          kind: "trace",
          contentType: "application/zip",
          data: await readFile(path),
          extension: ".zip",
          sourceUrl: page.url()
        });
        evidenceIds.push(evidence.id);
        return { active: false, evidenceId: evidence.id };
      }
    }
  }

  #networkRecords(session: ManagedSession, action: BrowserAction): BrowserNetworkRecord[] {
    const method = action.method?.trim().toUpperCase();
    const resourceType = action.resourceType?.trim().toLowerCase();
    const limit = boundedInteger(
      action.limit ?? Math.min(250, session.budget.maxNetworkEntries),
      1,
      session.budget.maxNetworkEntries,
      "NETWORK_LIMIT_INVALID"
    );
    return session.network
      .filter((record) => !action.tabId || record.tabId === action.tabId)
      .filter((record) => !method || record.method?.toUpperCase() === method)
      .filter((record) => action.status === undefined || record.status === action.status)
      .filter((record) => !resourceType || record.resourceType?.toLowerCase() === resourceType)
      .slice(-limit)
      .map((record) => ({ ...record }));
  }

  async #capturePaired(
    session: ManagedSession,
    page: Page,
    action: BrowserAction,
    evidenceIds: string[]
  ): Promise<unknown> {
    await this.#assertCaptureGeometry(page, session, action.fullPage ?? true);
    const before = await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __cockroachMutationCount?: number;
        __cockroachMutationObserver?: MutationObserver;
      };
      if (!scope.__cockroachMutationObserver) {
        scope.__cockroachMutationCount = 0;
        scope.__cockroachMutationObserver = new MutationObserver((changes) => {
          scope.__cockroachMutationCount = (scope.__cockroachMutationCount ?? 0) + changes.length;
        });
        scope.__cockroachMutationObserver.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      }
      return {
        mutationCount: scope.__cockroachMutationCount ?? 0,
        url: location.href,
        title: document.title
      };
    });
    const format = action.format ?? "png";
    const image = await page.screenshot({
      fullPage: action.fullPage ?? true,
      type: format,
      ...(format === "jpeg" && action.quality ? { quality: action.quality } : {})
    });
    const snapshot = await captureSnapshot({
      page,
      sessionId: session.id,
      tabId: action.tabId ?? session.activeTabId,
      maxChars: session.budget.maxSnapshotChars
    });
    const bounds: Record<string, { x: number; y: number; width: number; height: number }> = {};
    if (action.includeBounds) {
      for (const item of snapshot.refs.slice(0, 250)) {
        const box = await (await locatorFor(page, item.ref)).boundingBox().catch(() => null);
        if (box) bounds[item.ref] = box;
      }
    }
    const after = await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __cockroachMutationCount?: number };
      return {
        mutationCount: scope.__cockroachMutationCount ?? 0,
        url: location.href,
        title: document.title
      };
    });
    const drift = {
      mutationDelta: Math.max(0, after.mutationCount - before.mutationCount),
      urlChanged: before.url !== after.url,
      titleChanged: before.title !== after.title
    };
    if (action.requireStable && (drift.mutationDelta > 0 || drift.urlChanged)) {
      throw new CockroachBrowserError(
        "CAPTURE_DRIFT",
        "The page changed while the paired screenshot and semantic snapshot were captured.",
        drift
      );
    }
    const screenshot = await this.#addBufferEvidence(session, {
      kind: "screenshot",
      contentType: format === "jpeg" ? "image/jpeg" : "image/png",
      data: image,
      extension: format === "jpeg" ? ".jpg" : ".png",
      sourceUrl: page.url(),
      metadata: { paired: true }
    });
    evidenceIds.push(screenshot.id);
    const pair = await this.#addJsonEvidence(session, {
      kind: "action",
      value: {
        screenshotEvidenceId: screenshot.id,
        snapshot: redactSnapshot(snapshot),
        ...(action.includeBounds ? { bounds } : {}),
        drift
      },
      sourceUrl: page.url(),
      metadata: { pairedCapture: true, includeBounds: Boolean(action.includeBounds) }
    });
    evidenceIds.push(pair.id);
    return {
      screenshotEvidenceId: screenshot.id,
      pairEvidenceId: pair.id,
      snapshotDigest: snapshot.digest,
      refs: snapshot.refs.length,
      bounds: Object.keys(bounds).length,
      drift
    };
  }

  async #showAnnotations(
    session: ManagedSession,
    page: Page,
    action: BrowserAction
  ): Promise<{ annotations: number }> {
    const snapshot = await captureSnapshot({
      page,
      sessionId: session.id,
      tabId: action.tabId ?? session.activeTabId,
      maxChars: session.budget.maxSnapshotChars
    });
    const boxes: Array<{
      ref: string;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    for (const item of snapshot.refs.slice(0, 250)) {
      const box = await (await locatorFor(page, item.ref)).boundingBox().catch(() => null);
      if (!box) continue;
      boxes.push({
        ref: item.ref,
        label: `${item.role}: ${item.name}`.slice(0, 120),
        ...box
      });
    }
    await page.evaluate((items) => {
      document.getElementById("cockroach-browser-annotations")?.remove();
      const root = document.createElement("div");
      root.id = "cockroach-browser-annotations";
      root.setAttribute("aria-hidden", "true");
      Object.assign(root.style, {
        position: "absolute",
        inset: "0",
        zIndex: "2147483647",
        pointerEvents: "none"
      });
      for (const item of items) {
        const outline = document.createElement("div");
        Object.assign(outline.style, {
          position: "absolute",
          left: `${item.x + window.scrollX}px`,
          top: `${item.y + window.scrollY}px`,
          width: `${item.width}px`,
          height: `${item.height}px`,
          border: "2px solid #20e39a",
          boxSizing: "border-box",
          background: "rgba(32, 227, 154, 0.06)"
        });
        const label = document.createElement("span");
        label.textContent = `${item.ref} ${item.label}`;
        Object.assign(label.style, {
          position: "absolute",
          left: "0",
          top: "0",
          transform: "translateY(-100%)",
          maxWidth: "360px",
          padding: "3px 5px",
          background: "#07110d",
          color: "#eafbf3",
          border: "1px solid #20e39a",
          font: "11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        });
        outline.append(label);
        root.append(outline);
      }
      document.documentElement.append(root);
    }, boxes);
    return { annotations: boxes.length };
  }

  async #applySavedState(
    session: ManagedSession,
    page: Page,
    state: Record<string, unknown>
  ): Promise<{ cookiesApplied: number; localStorageKeysApplied: number; originsAvailable: number }> {
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const allowedHosts = new Set(session.input.policy.allowedOrigins.map((origin) => new URL(origin).hostname));
    const admittedCookies = cookies.filter((entry): entry is Record<string, unknown> => {
      if (!isPlainObject(entry) || typeof entry.domain !== "string") return false;
      const domain = entry.domain.replace(/^\./, "").toLowerCase();
      return [...allowedHosts].some((host) => host === domain || host.endsWith(`.${domain}`));
    });
    if (admittedCookies.length > 0) {
      await session.context.addCookies(
        admittedCookies as unknown as Parameters<BrowserContext["addCookies"]>[0]
      );
    }
    const origins = Array.isArray(state.origins)
      ? state.origins.filter((entry): entry is Record<string, unknown> =>
          isPlainObject(entry) && typeof entry.origin === "string" && Array.isArray(entry.localStorage)
        )
      : [];
    const currentOrigin = new URL(page.url()).origin;
    const current = origins.find((entry) => entry.origin === currentOrigin);
    const values = current
      ? (current.localStorage as unknown[]).filter(
          (entry): entry is { name: string; value: string } =>
            isPlainObject(entry) && typeof entry.name === "string" && typeof entry.value === "string"
        )
      : [];
    if (values.length > 0) {
      await page.evaluate((entries) => {
        for (const entry of entries) localStorage.setItem(entry.name, entry.value);
      }, values);
    }
    return {
      cookiesApplied: admittedCookies.length,
      localStorageKeysApplied: values.length,
      originsAvailable: origins.length
    };
  }

  #activeTabLock(session: ManagedSession, tabId: string): InternalTabLock | undefined {
    const lock = session.tabLocks.get(tabId);
    if (!lock) return undefined;
    if (Date.parse(lock.expiresAt) <= Date.now()) {
      session.tabLocks.delete(tabId);
      return undefined;
    }
    return lock;
  }

  async #assertTabLock(
    session: ManagedSession,
    tabId: string,
    tokenReference?: string
  ): Promise<void> {
    const lock = this.#activeTabLock(session, tabId);
    if (!lock) return;
    if (!tokenReference?.startsWith("ref:")) {
      throw new CockroachBrowserError(
        "TAB_LOCK_DENIED",
        `Tab ${tabId} is exclusively locked by ${lock.owner} until ${lock.expiresAt}.`
      );
    }
    const token = await this.#resolveSecret(tokenReference);
    const actual = Buffer.from(sha256(token), "hex");
    const expected = Buffer.from(lock.tokenDigest, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new CockroachBrowserError(
        "TAB_LOCK_DENIED",
        `Tab ${tabId} is exclusively locked by ${lock.owner} until ${lock.expiresAt}.`
      );
    }
  }

  async #captureDownload(session: ManagedSession, download: Download): Promise<EvidenceRecord> {
    const temporary = await download.path();
    if (!temporary) throw new CockroachBrowserError("DOWNLOAD_UNAVAILABLE", "The download did not produce a local file.");
    const info = await stat(temporary);
    if (!info.isFile() || info.size > session.budget.maxDownloadBytes) {
      throw new CockroachBrowserError("DOWNLOAD_BUDGET_EXCEEDED", "The download exceeds the session byte limit.");
    }
    await this.#assertEvidenceFileBudget(session, temporary, session.budget.maxDownloadBytes);
    return this.#addBufferEvidence(session, {
      kind: "download",
      contentType: "application/octet-stream",
      data: await readFile(temporary),
      extension: extname(download.suggestedFilename()),
      metadata: { suggestedFilename: download.suggestedFilename() }
    });
  }

  async #addBufferEvidence(
    session: ManagedSession,
    input: Omit<Parameters<EvidenceStore["addBuffer"]>[0], "sessionId">
  ): Promise<EvidenceRecord> {
    const bytes = Buffer.byteLength(input.data);
    if (session.evidenceBytes + bytes > session.budget.maxEvidenceBytes) {
      throw new CockroachBrowserError("EVIDENCE_BUDGET_EXCEEDED", "The session evidence byte limit would be exceeded.");
    }
    const record = await this.evidence.addBuffer({
      ...input,
      ...(input.sourceUrl ? { sourceUrl: sanitizeUrl(input.sourceUrl) } : {}),
      sessionId: session.id
    });
    session.evidenceBytes += record.size;
    await this.#publishEvidenceEvent(session, record);
    return record;
  }

  async #assertEvidenceFileBudget(session: ManagedSession, path: string, specificMax = Number.POSITIVE_INFINITY): Promise<void> {
    const info = await stat(path);
    const remaining = session.budget.maxEvidenceBytes - session.evidenceBytes;
    if (!info.isFile() || info.size > specificMax || info.size > remaining) {
      throw new CockroachBrowserError(
        "EVIDENCE_BUDGET_EXCEEDED",
        "The artifact exceeds the remaining session evidence ceiling."
      );
    }
  }

  async #assertCaptureGeometry(page: Page, session: ManagedSession, fullPage: boolean): Promise<void> {
    const dimensions = await page.evaluate((captureFullPage) => {
      const viewportWidth = Math.max(window.innerWidth, 1);
      const viewportHeight = Math.max(window.innerHeight, 1);
      return {
        width: captureFullPage ? Math.max(document.documentElement.scrollWidth, viewportWidth) : viewportWidth,
        height: captureFullPage ? Math.max(document.documentElement.scrollHeight, viewportHeight) : viewportHeight
      };
    }, fullPage);
    const pixels = dimensions.width * dimensions.height;
    const hardPixelCeiling = 25_000_000;
    const remainingEvidence = session.budget.maxEvidenceBytes - session.evidenceBytes;
    if (
      !Number.isSafeInteger(pixels) ||
      dimensions.width > 32_768 ||
      dimensions.height > 100_000 ||
      pixels > hardPixelCeiling ||
      pixels * 4 > Math.max(remainingEvidence * 8, 16_000_000)
    ) {
      throw new CockroachBrowserError(
        "CAPTURE_BUDGET_EXCEEDED",
        "The requested capture geometry exceeds the configured pixel or evidence ceiling.",
        { width: dimensions.width, height: dimensions.height, pixels }
      );
    }
  }

  async #addJsonEvidence(
    session: ManagedSession,
    input: Omit<Parameters<EvidenceStore["addJson"]>[0], "sessionId">
  ): Promise<EvidenceRecord> {
    const bytes = Buffer.byteLength(JSON.stringify(input.value));
    if (session.evidenceBytes + bytes > session.budget.maxEvidenceBytes) {
      throw new CockroachBrowserError("EVIDENCE_BUDGET_EXCEEDED", "The session evidence byte limit would be exceeded.");
    }
    const record = await this.evidence.addJson({
      ...input,
      ...(input.sourceUrl ? { sourceUrl: sanitizeUrl(input.sourceUrl) } : {}),
      sessionId: session.id
    });
    session.evidenceBytes += record.size;
    await this.#publishEvidenceEvent(session, record);
    return record;
  }

  async #installNetworkBoundary(session: ManagedSession): Promise<void> {
    const routeHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
        await route.continue();
        return;
      }
      try {
        await assertUrlResolvedAllowed(session.input.policy, url, session.dnsPins, this.dnsResolver);
        const rule = [...session.networkRules.values()].find((candidate) =>
          networkRouteMatches(candidate, {
            url,
            method: request.method(),
            resourceType: request.resourceType()
          })
        );
        if (rule) {
          if (rule.summary.response.action === "abort") {
            await route.abort("blockedbyclient");
            return;
          }
          if (session.interceptedBytes + rule.body.byteLength > session.budget.maxInterceptedBytes) {
            await route.abort("blockedbyclient");
            return;
          }
          session.interceptedBytes += rule.body.byteLength;
          await route.fulfill({
            status: rule.summary.response.status ?? 200,
            contentType: rule.summary.response.contentType ?? "text/plain; charset=utf-8",
            body: rule.body
          });
          return;
        }
        await route.continue();
      } catch {
        await route.abort("blockedbyclient").catch(() => undefined);
      }
    };
    session.routeHandler = routeHandler;
    await session.context.route("**/*", routeHandler);
    for (const page of session.context.pages()) this.#registerPage(session, page);
    const pageHandler = (page: Page): void => {
      if (session.tabs.size >= session.budget.maxTabs) {
        void page.close().catch(() => undefined);
        return;
      }
      this.#registerPage(session, page);
    };
    session.pageHandler = pageHandler;
    session.context.on("page", pageHandler);
  }

  #registerPage(session: ManagedSession, page: Page): string {
    const existing = session.pageIds.get(page);
    if (existing) return existing;
    const id = newId("tab");
    session.pageIds.set(page, id);
    session.tabs.set(id, page);
    session.activeTabId = id;
    page.on("console", (message) => this.#captureConsole(session, message));
    page.on("requestfailed", (request) => this.#captureRequestFailure(session, id, request));
    page.on("response", (response) => this.#captureResponse(session, id, response));
    page.on("close", () => {
      session.tabs.delete(id);
      session.tabLocks.delete(id);
      if (session.activeTabId === id) {
        session.activeTabId = session.tabs.keys().next().value as string ?? "";
      }
    });
    return id;
  }

  #captureConsole(session: ManagedSession, message: ConsoleMessage): void {
    session.console.push({
      timestamp: nowIso(),
      type: message.type(),
      text: message.text().slice(0, 4_000),
      location: message.location()
    });
    if (session.console.length > 1_000) session.console.shift();
  }

  #captureRequestFailure(session: ManagedSession, tabId: string, request: Request): void {
    const failure = request.failure()?.errorText;
    session.network.push({
      id: newId("network"),
      tabId,
      timestamp: nowIso(),
      type: "requestfailed",
      method: request.method(),
      url: sanitizeUrl(request.url()),
      resourceType: request.resourceType(),
      ...(failure ? { error: failure } : {})
    });
    if (session.network.length > session.budget.maxNetworkEntries) session.network.shift();
  }

  #captureResponse(session: ManagedSession, tabId: string, response: Response): void {
    session.network.push({
      id: newId("network"),
      tabId,
      timestamp: nowIso(),
      type: "response",
      method: response.request().method(),
      url: sanitizeUrl(response.url()),
      status: response.status(),
      resourceType: response.request().resourceType()
    });
    if (session.network.length > session.budget.maxNetworkEntries) session.network.shift();
  }

  async #recordHistory(
    session: ManagedSession,
    page: Page,
    source: BrowserHistoryEntry["source"]
  ): Promise<void> {
    const url = page.url();
    if (!url || url === "about:blank" || /^(?:data|blob):/i.test(url)) return;
    await assertUrlResolvedAllowed(session.input.policy, url, session.dnsPins, this.dnsResolver);
    const tabId = session.pageIds.get(page) ?? this.#registerPage(session, page);
    const entry: BrowserHistoryEntry = {
      tabId,
      url: sanitizeUrl(url),
      title: (await page.title().catch(() => "")).slice(0, 500),
      observedAt: nowIso(),
      source
    };
    const previous = session.history.at(-1);
    if (previous?.tabId === entry.tabId && previous.url === entry.url && previous.title === entry.title) {
      return;
    }
    session.history.push(entry);
    while (session.history.length > session.budget.maxHistoryEntries) session.history.shift();
  }

  #requireSession(id: string): ManagedSession {
    const session = this.#sessions.get(id);
    if (!session) throw new CockroachBrowserError("SESSION_NOT_FOUND", `Session ${id} was not found.`);
    return session;
  }

  #page(session: ManagedSession, tabId?: string): Page {
    const id = tabId ?? session.activeTabId;
    const page = session.tabs.get(id);
    if (!page) throw new CockroachBrowserError("TAB_NOT_FOUND", `Tab ${id} was not found.`);
    session.activeTabId = id;
    return page;
  }

  #assertSessionBudget(session: ManagedSession): void {
    if (session.actionsUsed >= session.budget.maxActions) {
      throw new CockroachBrowserError("ACTION_BUDGET_EXCEEDED", "The session action limit has been reached.");
    }
    if (Date.now() - Date.parse(session.createdAt) > session.budget.maxDurationMs) {
      throw new CockroachBrowserError("DURATION_BUDGET_EXCEEDED", "The session duration limit has been reached.");
    }
  }

  async #assertPageAdmitted(session: ManagedSession, page: Page): Promise<void> {
    const url = page.url();
    if (url === "about:blank") return;
    await assertUrlResolvedAllowed(session.input.policy, url, session.dnsPins, this.dnsResolver);
  }

  async #resolveUploadPaths(paths: string[]): Promise<Array<{ path: string; size: number }>> {
    if (paths.length > 32) {
      throw new CockroachBrowserError("UPLOAD_FILE_LIMIT_EXCEEDED", "A single action may upload at most 32 files.");
    }
    const roots = await Promise.all(this.uploadRoots.map((entry) => realpath(entry)));
    const admitted: Array<{ path: string; size: number }> = [];
    for (const candidate of paths) {
      const absolute = resolve(candidate);
      const directInfo = await lstat(absolute);
      if (directInfo.isSymbolicLink() || !directInfo.isFile()) {
        throw new CockroachBrowserError("UPLOAD_PATH_DENIED", "Uploads must be regular files, not links or devices.");
      }
      const canonical = await realpath(absolute);
      const inside = roots.some((root) => {
        const relation = relative(root, canonical);
        return Boolean(relation) && !relation.startsWith("..") && !isAbsolute(relation);
      });
      if (!inside) {
        throw new CockroachBrowserError(
          "UPLOAD_PATH_DENIED",
          "Upload paths must be contained in a host-configured upload root."
        );
      }
      const info = await stat(canonical);
      admitted.push({ path: canonical, size: info.size });
    }
    return admitted;
  }

  async #resolveSecretJson(reference: string | undefined, label: string): Promise<unknown> {
    if (!reference?.startsWith("ref:")) {
      throw new CockroachBrowserError("VALUE_REF_REQUIRED", `${label} require an opaque ref: value.`);
    }
    const serialized = await this.#resolveSecret(reference);
    if (Buffer.byteLength(serialized) > 256 * 1024) {
      throw new CockroachBrowserError("SECRET_PAYLOAD_TOO_LARGE", `${label} payload exceeds 256 KiB.`);
    }
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      throw new CockroachBrowserError("SECRET_PAYLOAD_INVALID", `${label} reference did not resolve to valid JSON.`);
    }
  }

  async #resolveSecret(reference: string | undefined): Promise<string> {
    if (!reference?.startsWith("ref:")) {
      throw new CockroachBrowserError(
        "VALUE_REF_REQUIRED",
        "Credential-bearing browser actions require an opaque ref: value."
      );
    }
    if (!this.secretResolver) {
      throw new CockroachBrowserError("SECRET_RESOLVER_REQUIRED", `Secret reference ${reference} requires a host resolver.`);
    }
    return this.secretResolver.resolve(reference);
  }

  async #recordContext(
    session: ManagedSession,
    type: string,
    metadata: Record<string, unknown>,
    links: {
      inputDigest?: string;
      outputDigest?: string;
      receiptHash?: string;
      evidenceIds?: string[];
    } = {}
  ): Promise<void> {
    if (!this.contextRecorder) return;
    await this.contextRecorder.record({
      type,
      sessionId: session.id,
      ...(session.input.actor ? { actor: session.input.actor } : {}),
      purpose: session.input.purpose,
      timestamp: nowIso(),
      ...(links.inputDigest ? { inputDigest: links.inputDigest } : {}),
      ...(links.outputDigest ? { outputDigest: links.outputDigest } : {}),
      ...(links.receiptHash ? { receiptHash: links.receiptHash } : {}),
      ...(links.evidenceIds?.length ? { evidenceIds: [...links.evidenceIds] } : {}),
      metadata
    });
  }

  async #publishEvidenceEvent(session: ManagedSession, record: EvidenceRecord): Promise<void> {
    await this.#publishEvent(
      session,
      "browser.evidence.recorded",
      {
        evidenceId: record.id,
        kind: record.kind,
        contentType: record.contentType,
        size: record.size,
        digest: record.digest
      },
      { evidenceIds: [record.id] }
    );
  }

  async #publishEvent(
    session: ManagedSession,
    type: Parameters<BrowserEventPublisher["publish"]>[0]["type"],
    metadata: Record<string, unknown>,
    links: {
      receiptHash?: string;
      evidenceIds?: string[];
    } = {}
  ): Promise<void> {
    const event: BrowserLifecycleEvent = {
      id: newId("event"),
      type,
      occurredAt: nowIso(),
      sessionId: session.id,
      ...(session.input.actor ? { actor: session.input.actor } : {}),
      purpose: session.input.purpose,
      ...(links.receiptHash ? { receiptHash: links.receiptHash } : {}),
      ...(links.evidenceIds?.length ? { evidenceIds: [...links.evidenceIds] } : {}),
      metadata
    };
    this.activity.append(event);
    if (!this.eventPublisher) return;
    try {
      await this.eventPublisher.publish(structuredClone(event));
    } catch {
      // Lifecycle delivery is operational telemetry. A failed endpoint must
      // never change the result of a browser action or evidence capture.
    }
  }
}

function stateName(input: string | undefined): string {
  const name = input?.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name === "." || name === "..") {
    throw new CockroachBrowserError(
      "STATE_NAME_INVALID",
      "Saved-state names may contain only letters, numbers, dots, underscores, and hyphens."
    );
  }
  return name;
}

function publicTabLock(lock: InternalTabLock): TabLockSummary {
  return {
    tabId: lock.tabId,
    owner: lock.owner,
    acquiredAt: lock.acquiredAt,
    expiresAt: lock.expiresAt
  };
}

function serializeNetworkExport(
  records: BrowserNetworkRecord[],
  format: "json" | "ndjson" | "har"
): { body: string; contentType: string; extension: string } {
  if (format === "ndjson") {
    return {
      body: records.map((record) => JSON.stringify(record)).join("\n"),
      contentType: "application/x-ndjson",
      extension: ".ndjson"
    };
  }
  if (format === "har") {
    return {
      body: JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "Cockroach Browser", version: "0.1" },
          entries: records.map((record) => ({
            startedDateTime: record.timestamp,
            time: 0,
            request: {
              method: record.method ?? "GET",
              url: record.url,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: -1
            },
            response: {
              status: record.status ?? 0,
              statusText: record.error ?? "",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              content: {
                size: 0,
                mimeType: record.resourceType ?? "application/octet-stream"
              },
              redirectURL: "",
              headersSize: -1,
              bodySize: -1
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
            _cockroach: {
              id: record.id,
              tabId: record.tabId,
              type: record.type
            }
          }))
        }
      }),
      contentType: "application/json",
      extension: ".har"
    };
  }
  return {
    body: JSON.stringify({ records, count: records.length }),
    contentType: "application/json",
    extension: ".json"
  };
}

function sanitizeUrl(input: string): string {
  if (input.startsWith("data:")) return "data:[redacted]";
  if (input.startsWith("blob:")) return "blob:[redacted]";
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch {
    return input.slice(0, 512);
  }
}

function redactSnapshot(snapshot: PageSnapshot): PageSnapshot {
  return {
    ...structuredClone(snapshot),
    url: sanitizeUrl(snapshot.url),
    refs: snapshot.refs.map((entry) => ({
      ...entry,
      ...(entry.href ? { href: sanitizeUrl(entry.href) } : {})
    }))
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isPlainObject(value) || Object.keys(value).length > 256) {
    throw new CockroachBrowserError("STORAGE_WRITE_INVALID", `${label} must be an object with at most 256 entries.`);
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 256 || typeof entry !== "string" || entry.length > 65_536) {
      throw new CockroachBrowserError(
        "STORAGE_WRITE_INVALID",
        `${label} keys and values exceed the permitted string bounds.`
      );
    }
    result[key] = entry;
  }
  return result;
}

function boundedHeaders(value: Record<string, string>): Record<string, string> {
  const entries = Object.entries(value);
  if (entries.length > 64) {
    throw new CockroachBrowserError("HEADER_LIMIT_EXCEEDED", "At most 64 explicit HTTP headers may be emulated.");
  }
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/.test(name) || typeof rawValue !== "string" || Buffer.byteLength(rawValue) > 8_192) {
      throw new CockroachBrowserError("HEADER_INVALID", "Emulated headers must use valid bounded HTTP names and string values.");
    }
    if (["authorization", "cookie", "proxy-authorization", "host", "content-length"].includes(name)) {
      throw new CockroachBrowserError("HEADER_SECRET_DENIED", `Header ${name} must enter through a host secret or session configuration.`);
    }
    result[name] = rawValue;
  }
  return result;
}

function targetDescription(action: BrowserAction): string {
  if (action.ref) return action.ref;
  if (action.selector) return action.selector.slice(0, 256);
  if (action.xpath) return "explicit XPath target";
  return "unspecified target";
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  code: string
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CockroachBrowserError(code, `Expected an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

async function boundedPoint(
  page: Page,
  action: Pick<BrowserAction, "x" | "y">
): Promise<{ x: number; y: number }> {
  if (
    typeof action.x !== "number"
    || typeof action.y !== "number"
    || !Number.isFinite(action.x)
    || !Number.isFinite(action.y)
    || action.x < 0
    || action.y < 0
  ) {
    throw new CockroachBrowserError(
      "MOUSE_COORDINATES_INVALID",
      "Mouse actions require finite, non-negative x and y coordinates."
    );
  }
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({
    width: Math.max(globalThis.innerWidth, 1),
    height: Math.max(globalThis.innerHeight, 1)
  }));
  if (action.x > viewport.width || action.y > viewport.height) {
    throw new CockroachBrowserError(
      "MOUSE_COORDINATES_OUTSIDE_VIEWPORT",
      "Mouse coordinates must remain inside the current viewport.",
      { x: action.x, y: action.y, viewport }
    );
  }
  return { x: action.x, y: action.y };
}

async function assertCdpEndpoint(
  input: string,
  allowRemote: boolean,
  resolver?: DnsResolver
): Promise<void> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("CDP_ENDPOINT_INVALID", "The CDP endpoint is not a valid URL.");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
    throw new CockroachBrowserError(
      "CDP_ENDPOINT_INVALID",
      "CDP endpoints must use credential-free HTTP(S) or WS(S); use host-managed authentication."
    );
  }
  const local = await isLocalEndpoint(url.hostname, resolver);
  if (!local && !allowRemote) {
    throw new CockroachBrowserError("REMOTE_CDP_DENIED", "Remote CDP requires policy.allowRemote=true.");
  }
  if (!local && !["https:", "wss:"].includes(url.protocol)) {
    throw new CockroachBrowserError("REMOTE_TLS_REQUIRED", "Remote CDP endpoints require TLS.");
  }
}

async function assertProxyEndpoint(
  input: string,
  allowRemote: boolean,
  resolver?: DnsResolver
): Promise<void> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CockroachBrowserError("PROXY_ENDPOINT_INVALID", "The proxy server is not a valid URL.");
  }
  if (!["http:", "https:", "socks5:"].includes(url.protocol) || url.username || url.password) {
    throw new CockroachBrowserError(
      "PROXY_ENDPOINT_INVALID",
      "Proxy endpoints must be credential-free HTTP(S) or SOCKS5 URLs; use secret references for credentials."
    );
  }
  const local = await isLocalEndpoint(url.hostname, resolver);
  if (!local && !allowRemote) {
    throw new CockroachBrowserError("REMOTE_PROXY_DENIED", "Remote proxy use requires policy.allowRemote=true.");
  }
}

async function isLocalEndpoint(hostname: string, resolver?: DnsResolver): Promise<boolean> {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost") || isPrivateAddress(normalized)) return true;
  if (!resolver) return false;
  try {
    const records = await resolver(normalized);
    return records.length > 0 && records.every((entry) => isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}
