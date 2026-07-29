import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
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
  ChallengeReport,
  ContextRecorder,
  EvidenceRecord,
  PageSnapshot,
  ResourceBudget,
  SessionCreateInput,
  SessionSummary,
  TabSummary
} from "./contracts.js";
import { canonicalJson, newId, nowIso, sha256 } from "./canonical.js";
import { detectChallenge } from "./challenge.js";
import { CockroachBrowserError, errorMessage } from "./errors.js";
import { EvidenceStore } from "./evidence.js";
import { GOVERNANCE_DISPATCH, type GovernanceDispatch } from "./internal-authority.js";
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
import { captureSnapshot, locatorFor } from "./snapshot.js";

export interface SecretResolver {
  resolve(reference: string): Promise<string>;
}

export interface BrowserRuntimeOptions {
  root?: string;
  approvalProvider?: ApprovalProvider;
  contextRecorder?: ContextRecorder;
  secretResolver?: SecretResolver;
  dnsResolver?: DnsResolver;
  uploadRoots?: string[];
  now?: () => Date;
}

interface NetworkRecord {
  timestamp: string;
  type: "requestfailed" | "response";
  method?: string;
  url: string;
  status?: number;
  resourceType?: string;
  error?: string;
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
  browser: Browser;
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
  network: NetworkRecord[];
  challenge?: ChallengeReport;
  traceActive: boolean;
  evidenceBytes: number;
  actionTail: Promise<void>;
  dnsPins: Map<string, readonly string[]>;
  consumedApprovals: Set<string>;
  routeHandler?: (route: Route) => Promise<void>;
  pageHandler?: (page: Page) => void;
}

const CHALLENGE_SAFE_ACTIONS = new Set(["snapshot", "screenshot", "pdf", "extract", "wait", "tab.switch", "tab.close"]);

export class BrowserRuntime {
  readonly root: string;
  readonly profiles: ProfileVault;
  readonly evidence: EvidenceStore;
  readonly approvalProvider?: ApprovalProvider;
  readonly contextRecorder?: ContextRecorder;
  readonly secretResolver?: SecretResolver;
  readonly dnsResolver?: DnsResolver;
  readonly uploadRoots: readonly string[];
  #sessions = new Map<string, ManagedSession>();
  #initialized = false;

  constructor(options: BrowserRuntimeOptions = {}) {
    this.root = resolve(options.root ?? join(homedir(), ".cockroach-browser"));
    this.profiles = new ProfileVault(join(this.root, "profiles"));
    this.evidence = new EvidenceStore({ root: join(this.root, "evidence"), maxBytes: 10 * 1024 ** 3 });
    if (options.approvalProvider) this.approvalProvider = options.approvalProvider;
    if (options.contextRecorder) this.contextRecorder = options.contextRecorder;
    if (options.secretResolver) this.secretResolver = options.secretResolver;
    if (options.dnsResolver) this.dnsResolver = options.dnsResolver;
    this.uploadRoots = Object.freeze(
      (options.uploadRoots ?? [join(this.root, "uploads")]).map((entry) => resolve(entry))
    );
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.root, { recursive: true });
    for (const uploadRoot of this.uploadRoots) await mkdir(uploadRoot, { recursive: true });
    await this.profiles.initialize();
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
    const createdAt = nowIso();
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let attached = false;
    let managedSession: ManagedSession | undefined;
    try {
      if (input.cdpEndpoint) {
        await assertCdpEndpoint(input.cdpEndpoint, Boolean(policy.allowRemote), this.dnsResolver);
        if (input.recordHar || input.recordVideo) {
          throw new CockroachBrowserError(
            "ATTACHED_CAPTURE_DENIED",
            "HAR and video recording require a runtime-owned browser context, not an attached CDP context."
          );
        }
        browser = await chromium.connectOverCDP(input.cdpEndpoint);
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
        const launchOptions: NonNullable<Parameters<typeof chromium.launch>[0]> = {
          headless: (input.mode ?? "headless") === "headless",
          ...(input.executablePath ? { executablePath: resolve(input.executablePath) } : {}),
          ...(proxy ? { proxy } : {})
        };
        browser = await chromium.launch(launchOptions);
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
        context = await browser.newContext(contextOptions);
        // Headers may contain bearer credentials. The browser context has its
        // own copy; do not retain them in the long-lived session record.
        delete input.extraHTTPHeaders;
      }

      const session: ManagedSession = {
        input,
        id,
        browser,
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
        traceActive: false,
        evidenceBytes: 0,
        actionTail: Promise.resolve(),
        dnsPins,
        consumedApprovals: new Set()
      };
      managedSession = session;
      this.#sessions.set(id, session);
      await this.#installNetworkBoundary(session);
      const page = attached && context.pages()[0] ? context.pages()[0]! : await context.newPage();
      this.#registerPage(session, page);
      if (startUrl) await page.goto(startUrl.toString(), { waitUntil: "domcontentloaded" });
      session.state = "ready";
      session.updatedAt = nowIso();
      await this.#recordContext(session, "browser.session.created", {
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
    if (!session.attached) await session.browser.close();
    session.state = "closed";
    session.updatedAt = nowIso();
    await this.#recordContext(session, "browser.session.closed", {});
    this.#sessions.delete(id);
  }

  async act(sessionId: string, action: BrowserAction): Promise<{ output: unknown; receipt: ActionReceipt }> {
    return this.#queueAction(sessionId, action);
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
    const effect = effectForAction(action.kind);
    const risk = riskForAction(action.kind);
    const policyHash = policyDigest(session.input.policy);
    let page: Page | undefined;
    let urlBefore: string | undefined;
    const receiptId = newId("receipt");
    let approval: ApprovalDecision | undefined;
    let output: unknown;
    let status: ActionReceipt["status"] = "succeeded";
    let failure: { code: string; message: string } | undefined;
    const evidenceIds: string[] = [];

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
        : await this.#execute(session, page, action, evidenceIds);
      if (page.url() !== "about:blank") {
        await assertUrlResolvedAllowed(session.input.policy, page.url(), session.dnsPins, this.dnsResolver);
      }
      if (["navigate", "reload", "click", "doubleClick", "press", "wait"].includes(action.kind)) {
        session.challenge = await detectChallenge(page);
        if (session.challenge.detected) {
          session.state = "challenge";
          status = "challenge";
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
    await this.#recordContext(session, "browser.action.completed", {
      action: action.kind,
      status,
      inputDigest,
      outputDigest,
      receiptHash: receipt.receiptHash,
      evidenceIds
    });
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
    const onDialog = (dialog: Dialog): void => {
      observed.add(dialog.type() === "beforeunload" ? "modal-dialog" : "modal-dialog");
      void dialog.dismiss().catch(() => undefined);
    };
    const onFileChooser = (_chooser: FileChooser): void => {
      observed.add("file-picker");
    };
    session.context.on("page", onPage);
    page.on("download", onDownload);
    page.on("dialog", onDialog);
    page.on("filechooser", onFileChooser);
    await session.context.clearPermissions();
    try {
      const output = await this.#execute(session, page, action, evidenceIds);
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
      page.off("dialog", onDialog);
      page.off("filechooser", onFileChooser);
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
    const report = await detectChallenge(this.#page(session));
    session.challenge = report;
    session.state = report.detected ? "challenge" : "ready";
    session.updatedAt = nowIso();
    return report;
  }

  async close(): Promise<void> {
    for (const id of [...this.#sessions.keys()]) {
      await this.closeSession(id).catch(() => undefined);
    }
  }

  async #execute(session: ManagedSession, page: Page, action: BrowserAction, evidenceIds: string[]): Promise<unknown> {
    const timeout = Math.min(action.timeoutMs ?? 30_000, 120_000);
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
        await (await locatorFor(page, action.ref, action.selector)).click({ timeout });
        return { clicked: action.ref ?? action.selector };
      case "doubleClick":
        await (await locatorFor(page, action.ref, action.selector)).dblclick({ timeout });
        return { doubleClicked: action.ref ?? action.selector };
      case "fill":
        await (await locatorFor(page, action.ref, action.selector)).fill(action.value ?? "", { timeout });
        return { filled: action.ref ?? action.selector, length: (action.value ?? "").length };
      case "type":
        await (await locatorFor(page, action.ref, action.selector)).pressSequentially(action.value ?? "", { timeout });
        return { typed: action.ref ?? action.selector, length: (action.value ?? "").length };
      case "press":
        if (!action.key) throw new CockroachBrowserError("KEY_REQUIRED", "Press requires a key.");
        await (await locatorFor(page, action.ref, action.selector)).press(action.key, { timeout });
        return { pressed: action.key };
      case "hover":
        await (await locatorFor(page, action.ref, action.selector)).hover({ timeout });
        return { hovered: action.ref ?? action.selector };
      case "focus":
        await (await locatorFor(page, action.ref, action.selector)).focus();
        return { focused: action.ref ?? action.selector };
      case "check":
        await (await locatorFor(page, action.ref, action.selector)).check({ timeout });
        return { checked: action.ref ?? action.selector };
      case "uncheck":
        await (await locatorFor(page, action.ref, action.selector)).uncheck({ timeout });
        return { unchecked: action.ref ?? action.selector };
      case "select": {
        const values = action.values ?? (action.value ? [action.value] : []);
        return { selected: await (await locatorFor(page, action.ref, action.selector)).selectOption(values, { timeout }) };
      }
      case "scroll":
        await page.mouse.wheel(action.deltaX ?? 0, action.deltaY ?? 700);
        return { deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 700 };
      case "drag": {
        const source = await locatorFor(page, action.ref, action.selector);
        const target = await locatorFor(page, action.targetRef);
        await source.dragTo(target, { timeout });
        return { source: action.ref ?? action.selector, target: action.targetRef };
      }
      case "upload": {
        const paths = action.paths ?? (action.path ? [action.path] : []);
        if (paths.length === 0) throw new CockroachBrowserError("UPLOAD_PATH_REQUIRED", "Upload requires one or more paths.");
        const admitted = await this.#resolveUploadPaths(paths);
        const total = admitted.reduce((sum, entry) => sum + entry.size, 0);
        if (total > session.budget.maxUploadBytes) {
          throw new CockroachBrowserError("UPLOAD_BUDGET_EXCEEDED", "Upload files exceed the session byte limit.");
        }
        await (await locatorFor(page, action.ref, action.selector)).setInputFiles(admitted.map((entry) => entry.path));
        return { files: admitted.map((entry) => basename(entry.path)), bytes: total };
      }
      case "download": {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout }),
          (await locatorFor(page, action.ref, action.selector)).click({ timeout })
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
      case "wait":
        if (action.selector) {
          await page.locator(action.selector).first().waitFor({ state: "visible", timeout });
          return { selector: action.selector, state: "visible" };
        }
        if (action.text) {
          await page.getByText(action.text, { exact: false }).first().waitFor({ state: "visible", timeout });
          return { text: action.text, state: "visible" };
        }
        await page.waitForTimeout(Math.min(timeout, 10_000));
        return { waitedMs: Math.min(timeout, 10_000) };
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
        const locator = action.ref || action.selector ? await locatorFor(page, action.ref, action.selector) : page.locator("body");
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
        await target.close();
        session.tabs.delete(targetId);
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
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
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
    page.on("requestfailed", (request) => this.#captureRequestFailure(session, request));
    page.on("response", (response) => this.#captureResponse(session, response));
    page.on("close", () => {
      session.tabs.delete(id);
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

  #captureRequestFailure(session: ManagedSession, request: Request): void {
    const failure = request.failure()?.errorText;
    session.network.push({
      timestamp: nowIso(),
      type: "requestfailed",
      method: request.method(),
      url: sanitizeUrl(request.url()),
      resourceType: request.resourceType(),
      ...(failure ? { error: failure } : {})
    });
    if (session.network.length > 2_000) session.network.shift();
  }

  #captureResponse(session: ManagedSession, response: Response): void {
    session.network.push({
      timestamp: nowIso(),
      type: "response",
      method: response.request().method(),
      url: sanitizeUrl(response.url()),
      status: response.status(),
      resourceType: response.request().resourceType()
    });
    if (session.network.length > 2_000) session.network.shift();
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

  async #resolveSecret(reference: string): Promise<string> {
    if (!this.secretResolver) {
      throw new CockroachBrowserError("SECRET_RESOLVER_REQUIRED", `Secret reference ${reference} requires a host resolver.`);
    }
    return this.secretResolver.resolve(reference);
  }

  async #recordContext(session: ManagedSession, type: string, metadata: Record<string, unknown>): Promise<void> {
    if (!this.contextRecorder) return;
    await this.contextRecorder.record({
      type,
      sessionId: session.id,
      ...(session.input.actor ? { actor: session.input.actor } : {}),
      purpose: session.input.purpose,
      timestamp: nowIso(),
      metadata
    });
  }
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
