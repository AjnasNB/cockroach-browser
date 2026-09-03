import { ACTION_KINDS, type ActionKind, type BrowserEngine } from "./contracts.js";
import { CockroachBrowserError } from "./errors.js";

/**
 * Engine-specific behavior that callers may require before allocating a
 * browser. This is intentionally smaller than the raw Playwright/Puppeteer
 * API inventory: it describes portable outcomes, not every upstream method.
 */
export const ENGINE_CAPABILITY_IDS = [
  "runtime.owned_launch",
  "transport.playwright",
  "transport.puppeteer",
  "transport.cdp",
  "transport.webdriver_bidi",
  "page.navigation",
  "page.javascript",
  "page.dom",
  "page.forms",
  "page.frames",
  "page.shadow_dom",
  "page.cors",
  "page.emulation",
  "network.interception",
  "state.cookies",
  "files.upload",
  "files.download",
  "capture.screenshot",
  "capture.pdf",
  "capture.video",
  "evidence.trace",
  "profiles.persistent",
  "extensions.unpacked"
] as const;

export type EngineCapabilityId = (typeof ENGINE_CAPABILITY_IDS)[number];
export type EngineCapabilityState = "supported" | "experimental" | "unsupported";
export type LightweightBrowserEngine = "obscura" | "lightpanda";
export type BrowserEngineId = BrowserEngine | LightweightBrowserEngine;
export const BROWSER_ENGINE_IDS = ["chromium", "firefox", "webkit", "obscura", "lightpanda"] as const satisfies readonly BrowserEngineId[];

export interface EngineCapabilityAssessment {
  state: EngineCapabilityState;
  /** Concise, testable reason for the state. */
  note: string;
}

export interface EngineCapabilityManifest {
  id: BrowserEngineId;
  label: string;
  distribution: "bundled" | "external";
  integration: "playwright" | "cdp";
  /** Maturity of this repository's integration, not the vendor's release. */
  maturity: "supported" | "experimental";
  source: string;
  fallbackEngine: BrowserEngine;
  capabilities: Readonly<Record<EngineCapabilityId, EngineCapabilityAssessment>>;
}

export interface EngineCapabilityRequirement {
  capability: EngineCapabilityId;
  /** Why the caller needs this outcome; included in diagnostics. */
  purpose?: string;
}

export interface EngineCapabilityCheck extends EngineCapabilityRequirement {
  state: EngineCapabilityState;
  accepted: boolean;
  note: string;
}

export interface EngineCapabilityPreflightInput {
  engine: BrowserEngineId;
  required: readonly (EngineCapabilityId | EngineCapabilityRequirement)[];
  /** Experimental capabilities fail closed unless the caller opts in. */
  allowExperimental?: boolean;
}

export interface EngineActionPreflightInput {
  engine: BrowserEngineId;
  actions: readonly ActionKind[];
  allowExperimental?: boolean;
}

export interface EngineCapabilityPreflightResult {
  engine: BrowserEngineId;
  ok: boolean;
  allowExperimental: boolean;
  checks: readonly EngineCapabilityCheck[];
  unmet: readonly EngineCapabilityCheck[];
}

const supported = (note: string): EngineCapabilityAssessment => Object.freeze({ state: "supported", note });
const experimental = (note: string): EngineCapabilityAssessment => Object.freeze({ state: "experimental", note });
const unsupported = (note: string): EngineCapabilityAssessment => Object.freeze({ state: "unsupported", note });
const requires = (...capabilities: EngineCapabilityId[]): readonly EngineCapabilityId[] => Object.freeze(capabilities);

/**
 * The minimum engine outcomes needed by each bounded action. Empty entries are
 * intentionally runtime-owned bookkeeping or governance operations. Keeping a
 * complete record makes newly added actions fail compilation until classified.
 */
export const ACTION_ENGINE_CAPABILITIES: Readonly<Record<ActionKind, readonly EngineCapabilityId[]>> = Object.freeze({
  navigate: requires("page.navigation"),
  back: requires("page.navigation"),
  forward: requires("page.navigation"),
  reload: requires("page.navigation"),
  click: requires("page.forms"),
  doubleClick: requires("page.forms"),
  fill: requires("page.forms"),
  type: requires("page.forms"),
  press: requires("page.forms"),
  hover: requires("page.forms"),
  focus: requires("page.forms"),
  check: requires("page.forms"),
  uncheck: requires("page.forms"),
  select: requires("page.forms"),
  scroll: requires("page.forms"),
  drag: requires("page.forms"),
  "mouse.move": requires("page.forms"),
  "mouse.down": requires("page.forms"),
  "mouse.up": requires("page.forms"),
  "mouse.click": requires("page.forms"),
  "keyboard.down": requires("page.forms"),
  "keyboard.up": requires("page.forms"),
  "keyboard.insertText": requires("page.forms"),
  upload: requires("files.upload"),
  download: requires("files.download"),
  evaluate: requires("page.javascript"),
  "query.inspect": requires("page.dom"),
  "emulation.set": requires("page.emulation"),
  "emulation.clear": requires("page.emulation"),
  "cache.clear": requires("transport.cdp"),
  "console.clear": requires(),
  "network.clear": requires(),
  wait: requires("page.dom"),
  "challenge.resolve": requires(),
  "history.inspect": requires(),
  "capture.paired": requires("capture.screenshot", "page.dom"),
  "annotate.show": requires("page.dom", "page.javascript"),
  "annotate.clear": requires("page.dom", "page.javascript"),
  "clipboard.read": requires("page.javascript"),
  "clipboard.write": requires("page.javascript"),
  "network.inspect": requires(),
  "network.export": requires(),
  "network.route.add": requires("network.interception"),
  "network.route.remove": requires("network.interception"),
  "network.routes.list": requires("network.interception"),
  "state.save": requires("state.cookies", "page.dom"),
  "state.load": requires("state.cookies", "page.dom"),
  "state.list": requires(),
  "state.delete": requires(),
  screenshot: requires("capture.screenshot"),
  pdf: requires("capture.pdf"),
  snapshot: requires("page.dom"),
  extract: requires("page.dom"),
  "extract.structured": requires("page.dom", "page.javascript"),
  "cookies.read": requires("state.cookies"),
  "cookies.write": requires("state.cookies"),
  "storage.read": requires("page.dom", "page.javascript"),
  "storage.write": requires("page.dom", "page.javascript"),
  "tab.open": requires("page.navigation"),
  "tab.close": requires("page.navigation"),
  "tab.switch": requires("page.navigation"),
  "tab.lock": requires(),
  "tab.unlock": requires(),
  "tab.lock.status": requires(),
  "trace.start": requires("evidence.trace"),
  "trace.stop": requires("evidence.trace")
});

function defineManifest(
  manifest: Omit<EngineCapabilityManifest, "capabilities"> & {
    capabilities: Record<EngineCapabilityId, EngineCapabilityAssessment>;
  }
): EngineCapabilityManifest {
  return Object.freeze({
    ...manifest,
    capabilities: Object.freeze({ ...manifest.capabilities })
  });
}

const chromium = defineManifest({
  id: "chromium",
  label: "Chromium",
  distribution: "bundled",
  integration: "playwright",
  maturity: "supported",
  source: "https://playwright.dev/docs/browsers",
  fallbackEngine: "chromium",
  capabilities: {
    "runtime.owned_launch": supported("The bounded runtime launches and owns the Playwright Chromium process tree."),
    "transport.playwright": supported("Exercised through the bundled Playwright Chromium browser type."),
    "transport.puppeteer": supported("Puppeteer Core supports Chromium through its native CDP transport."),
    "transport.cdp": supported("Chromium exposes the Chrome DevTools Protocol."),
    "transport.webdriver_bidi": experimental("The raw BiDi client can use an operator-owned endpoint; the bounded runtime does not launch one."),
    "page.navigation": supported("Navigation is exercised by bounded multi-engine tests."),
    "page.javascript": supported("Chromium executes page JavaScript and policy-gated evaluation."),
    "page.dom": supported("DOM queries, locators, and semantic snapshots are available."),
    "page.forms": supported("Form, keyboard, pointer, and drag interactions are available."),
    "page.frames": supported("Playwright frame APIs are available; the bounded runtime admits same-origin frames."),
    "page.shadow_dom": supported("Open shadow roots are traversed by the semantic snapshot path."),
    "page.cors": supported("Chromium provides standard fetch and CORS behavior."),
    "page.emulation": supported("The bounded Playwright runtime supports its reviewed viewport, media, offline, geolocation, permission, and header subset."),
    "network.interception": supported("Playwright and Puppeteer request routing are available."),
    "state.cookies": supported("Cookies and storage state are supported."),
    "files.upload": supported("File inputs accept reviewed local paths."),
    "files.download": supported("Downloads are captured under bounded evidence limits."),
    "capture.screenshot": supported("PNG and JPEG capture are available."),
    "capture.pdf": supported("Chromium PDF generation is supported by the bounded runtime."),
    "capture.video": supported("Playwright video recording is available."),
    "evidence.trace": supported("Playwright tracing is available."),
    "profiles.persistent": supported("Runtime-owned persistent contexts are available."),
    "extensions.unpacked": supported("Reviewed unpacked extensions are supported in headed Chromium profiles.")
  }
});

const firefox = defineManifest({
  id: "firefox",
  label: "Firefox",
  distribution: "bundled",
  integration: "playwright",
  maturity: "supported",
  source: "https://playwright.dev/docs/browsers",
  fallbackEngine: "chromium",
  capabilities: {
    "runtime.owned_launch": supported("The bounded runtime launches and owns the Playwright Firefox process tree."),
    "transport.playwright": supported("Exercised through the bundled Playwright Firefox browser type."),
    "transport.puppeteer": experimental("Puppeteer exposes Firefox support, but Cockroach Browser does not treat it as a bounded transport."),
    "transport.cdp": unsupported("Firefox is not a CDP engine in this integration."),
    "transport.webdriver_bidi": experimental("Use the raw BiDi client with an operator-owned Firefox endpoint."),
    "page.navigation": supported("Navigation is exercised by bounded multi-engine tests."),
    "page.javascript": supported("Firefox executes page JavaScript and policy-gated evaluation."),
    "page.dom": supported("DOM queries, locators, and semantic snapshots are available."),
    "page.forms": supported("Form, keyboard, pointer, and drag interactions are available."),
    "page.frames": supported("Playwright frame APIs are available; the bounded runtime admits same-origin frames."),
    "page.shadow_dom": supported("Open shadow roots are traversed by the semantic snapshot path."),
    "page.cors": supported("Firefox provides standard fetch and CORS behavior."),
    "page.emulation": supported("The bounded Playwright runtime supports its reviewed viewport, media, offline, geolocation, permission, and header subset."),
    "network.interception": supported("Playwright request routing is available."),
    "state.cookies": supported("Cookies and storage state are supported."),
    "files.upload": supported("File inputs accept reviewed local paths."),
    "files.download": supported("Downloads are captured under bounded evidence limits."),
    "capture.screenshot": supported("PNG and JPEG capture are available."),
    "capture.pdf": unsupported("The bounded runtime exposes PDF only for Chromium."),
    "capture.video": supported("Playwright video recording is available."),
    "evidence.trace": supported("Playwright tracing is available."),
    "profiles.persistent": supported("Runtime-owned persistent contexts are available."),
    "extensions.unpacked": unsupported("The reviewed extension launcher is Chromium-specific.")
  }
});

const webkit = defineManifest({
  id: "webkit",
  label: "WebKit",
  distribution: "bundled",
  integration: "playwright",
  maturity: "supported",
  source: "https://playwright.dev/docs/browsers",
  fallbackEngine: "chromium",
  capabilities: {
    "runtime.owned_launch": supported("The bounded runtime launches and owns the Playwright WebKit process tree."),
    "transport.playwright": supported("Exercised through the bundled Playwright WebKit browser type."),
    "transport.puppeteer": unsupported("Puppeteer does not provide a WebKit transport."),
    "transport.cdp": unsupported("WebKit is not a CDP engine in this integration."),
    "transport.webdriver_bidi": unsupported("Cockroach Browser does not launch a WebKit BiDi endpoint."),
    "page.navigation": supported("Navigation is exercised by bounded multi-engine tests."),
    "page.javascript": supported("WebKit executes page JavaScript and policy-gated evaluation."),
    "page.dom": supported("DOM queries, locators, and semantic snapshots are available."),
    "page.forms": supported("Form, keyboard, pointer, and drag interactions are available."),
    "page.frames": supported("Playwright frame APIs are available; the bounded runtime admits same-origin frames."),
    "page.shadow_dom": supported("Open shadow roots are traversed by the semantic snapshot path."),
    "page.cors": supported("WebKit provides standard fetch and CORS behavior."),
    "page.emulation": supported("The bounded Playwright runtime supports its reviewed viewport, media, offline, geolocation, permission, and header subset."),
    "network.interception": supported("Playwright request routing is available."),
    "state.cookies": supported("Cookies and storage state are supported."),
    "files.upload": supported("File inputs accept reviewed local paths."),
    "files.download": supported("Downloads are captured under bounded evidence limits."),
    "capture.screenshot": supported("PNG and JPEG capture are available."),
    "capture.pdf": unsupported("The bounded runtime exposes PDF only for Chromium."),
    "capture.video": supported("Playwright video recording is available."),
    "evidence.trace": supported("Playwright tracing is available."),
    "profiles.persistent": supported("Runtime-owned persistent contexts are available."),
    "extensions.unpacked": unsupported("The reviewed extension launcher is Chromium-specific.")
  }
});

const obscura = defineManifest({
  id: "obscura",
  label: "Obscura",
  distribution: "external",
  integration: "cdp",
  maturity: "experimental",
  source: "https://github.com/h4ckf0r0day/obscura",
  fallbackEngine: "chromium",
  capabilities: {
    "runtime.owned_launch": experimental("The owned adapter is enabled only for an explicitly installed, opt-in, conformance-tested Obscura binary."),
    "transport.playwright": experimental("Obscura documents Playwright connectOverCDP compatibility; repository conformance is not yet complete."),
    "transport.puppeteer": experimental("Obscura documents Puppeteer CDP compatibility; repository conformance is not yet complete."),
    "transport.cdp": experimental("Obscura implements a documented subset of CDP."),
    "transport.webdriver_bidi": unsupported("Obscura documents CDP, not WebDriver BiDi."),
    "page.navigation": experimental("Obscura documents navigation and lifecycle waits; conformance is required per release."),
    "page.javascript": experimental("Obscura executes JavaScript through V8, with acknowledged Web API differences."),
    "page.dom": experimental("Obscura provides DOM and extraction APIs, but is an evolving independent engine."),
    "page.forms": experimental("The owned non-visual adapter provides HTMLElement activation and input/textarea value assignment without claiming visual pointer fidelity; other interactions require a rendering build and conformance."),
    "page.frames": experimental("Frame behavior must pass the Cockroach conformance suite before support is claimed."),
    "page.shadow_dom": experimental("Shadow DOM behavior must pass the Cockroach conformance suite before support is claimed."),
    "page.cors": experimental("Network and Web API behavior may differ from Chromium and requires conformance."),
    "page.emulation": experimental("Only the CDP methods implemented by the selected Obscura build can be used; conformance is required."),
    "network.interception": experimental("Obscura documents live CDP Fetch interception."),
    "state.cookies": experimental("Obscura documents cookie and storage CDP methods."),
    "files.upload": experimental("File-input behavior must pass remote and local upload conformance."),
    "files.download": experimental("Download behavior must pass evidence and byte-limit conformance."),
    "capture.screenshot": experimental("Rendering builds document viewport and full-page screenshots."),
    "capture.pdf": experimental("Rendering builds document raster PDF export."),
    "capture.video": unsupported("Obscura's documented CDP screencasting is not the Playwright video artifact contract used by the bounded runtime."),
    "evidence.trace": unsupported("No Cockroach-compatible Playwright trace contract is currently claimed."),
    "profiles.persistent": unsupported("The owned lightweight provider rejects persistent profiles; cookie APIs do not establish profile-directory parity."),
    "extensions.unpacked": unsupported("No reviewed unpacked-extension integration is currently claimed.")
  }
});

const lightpanda = defineManifest({
  id: "lightpanda",
  label: "Lightpanda",
  distribution: "external",
  integration: "cdp",
  maturity: "experimental",
  source: "https://github.com/lightpanda-io/browser",
  fallbackEngine: "chromium",
  capabilities: {
    "runtime.owned_launch": unsupported("Cockroach Browser keeps Lightpanda allocation disabled until the exact release passes its network-boundary conformance suite."),
    "transport.playwright": experimental("Lightpanda exposes CDP for automation clients; Playwright compatibility must be conformance-tested."),
    "transport.puppeteer": experimental("Lightpanda documents Puppeteer connection through its CDP server."),
    "transport.cdp": experimental("Lightpanda exposes a beta CDP/WebSocket server."),
    "transport.webdriver_bidi": unsupported("Lightpanda documents CDP, not WebDriver BiDi."),
    "page.navigation": experimental("Lightpanda documents navigation and configurable waits, while remaining beta."),
    "page.javascript": experimental("Lightpanda executes JavaScript through V8 but does not cover every Web API."),
    "page.dom": experimental("DOM parsing and APIs ship, with incomplete web-platform coverage."),
    "page.forms": experimental("HTMLElement activation and input/textarea value assignment require exact-binary conformance; visual pointer and keyboard fidelity are not claimed."),
    "page.frames": experimental("Frame behavior must pass the Cockroach conformance suite before support is claimed."),
    "page.shadow_dom": experimental("Shadow DOM behavior must pass the Cockroach conformance suite before support is claimed."),
    "page.cors": unsupported("Lightpanda's public status list currently marks CORS incomplete."),
    "page.emulation": experimental("Only the CDP methods implemented by the selected Lightpanda build can be used; conformance is required."),
    "network.interception": experimental("Lightpanda documents network interception."),
    "state.cookies": experimental("Lightpanda documents cookies and isolated sessions."),
    "files.upload": experimental("File-input behavior must pass remote and local upload conformance."),
    "files.download": experimental("Download behavior must pass evidence and byte-limit conformance."),
    "capture.screenshot": unsupported("The owned Lightpanda lane declares no graphical rendering; text-only dumps are not screenshot parity."),
    "capture.pdf": unsupported("The owned Lightpanda lane declares no native page rendering; text-only dumps are not Chromium PDF parity."),
    "capture.video": unsupported("No Cockroach-compatible video artifact contract is currently claimed."),
    "evidence.trace": unsupported("No Cockroach-compatible Playwright trace contract is currently claimed."),
    "profiles.persistent": unsupported("No repository-verified durable browser profile contract is currently claimed."),
    "extensions.unpacked": unsupported("No reviewed unpacked-extension integration is currently claimed.")
  }
});

export const ENGINE_CAPABILITY_MANIFEST: Readonly<Record<BrowserEngineId, EngineCapabilityManifest>> = Object.freeze({
  chromium,
  firefox,
  webkit,
  obscura,
  lightpanda
});

export function engineCapabilities(engine: BrowserEngineId): EngineCapabilityManifest {
  const manifest = ENGINE_CAPABILITY_MANIFEST[engine];
  if (!manifest) throw new RangeError(`Unknown browser engine: ${String(engine)}`);
  return manifest;
}

export function preflightEngineCapabilities(input: EngineCapabilityPreflightInput): EngineCapabilityPreflightResult {
  const manifest = engineCapabilities(input.engine);
  const allowExperimental = input.allowExperimental ?? false;
  const requirements = normalizeRequirements(input.required);
  const checks = requirements.map((requirement): EngineCapabilityCheck => {
    const assessment = manifest.capabilities[requirement.capability];
    const accepted = assessment.state === "supported" || (allowExperimental && assessment.state === "experimental");
    return Object.freeze({ ...requirement, ...assessment, accepted });
  });
  const unmet = checks.filter((check) => !check.accepted);
  return Object.freeze({
    engine: manifest.id,
    ok: unmet.length === 0,
    allowExperimental,
    checks: Object.freeze(checks),
    unmet: Object.freeze(unmet)
  });
}

export function assertEngineCapabilities(input: EngineCapabilityPreflightInput): EngineCapabilityPreflightResult {
  const result = preflightEngineCapabilities(input);
  if (!result.ok) throw new EngineCapabilityPreflightError(result);
  return result;
}

export function engineCapabilitiesForAction(action: ActionKind): readonly EngineCapabilityId[] {
  if (!ACTION_KINDS.includes(action)) throw new RangeError(`Unknown browser action: ${String(action)}`);
  return ACTION_ENGINE_CAPABILITIES[action];
}

export function preflightEngineActions(input: EngineActionPreflightInput): EngineCapabilityPreflightResult {
  const required: EngineCapabilityRequirement[] = [
    { capability: "runtime.owned_launch", purpose: `Allocate the ${input.engine} engine` },
    {
      capability: input.engine === "obscura" || input.engine === "lightpanda"
        ? "transport.cdp"
        : "transport.playwright",
      purpose: `Connect the ${input.engine} engine`
    }
  ];
  for (const action of input.actions) {
    for (const capability of engineCapabilitiesForAction(action)) {
      required.push({ capability, purpose: `Required by ${action}` });
    }
  }
  return preflightEngineCapabilities({
    engine: input.engine,
    required,
    ...(input.allowExperimental !== undefined ? { allowExperimental: input.allowExperimental } : {})
  });
}

export function assertEngineActions(input: EngineActionPreflightInput): EngineCapabilityPreflightResult {
  const result = preflightEngineActions(input);
  if (!result.ok) throw new EngineCapabilityPreflightError(result);
  return result;
}

export class EngineCapabilityPreflightError extends CockroachBrowserError {
  readonly result: EngineCapabilityPreflightResult;

  constructor(result: EngineCapabilityPreflightResult) {
    const details = result.unmet
      .map((check) => `${check.capability}=${check.state}${check.purpose ? ` (${check.purpose})` : ""}`)
      .join(", ");
    super(
      "ENGINE_CAPABILITY_PREFLIGHT_FAILED",
      `Engine ${result.engine} does not satisfy required capabilities: ${details}.`,
      {
        engine: result.engine,
        unmet: result.unmet.map((check) => ({
          capability: check.capability,
          state: check.state,
          ...(check.purpose ? { purpose: check.purpose } : {})
        }))
      }
    );
    this.name = "EngineCapabilityPreflightError";
    this.result = result;
  }
}

function normalizeRequirements(
  input: readonly (EngineCapabilityId | EngineCapabilityRequirement)[]
): EngineCapabilityRequirement[] {
  const seen = new Set<EngineCapabilityId>();
  const normalized: EngineCapabilityRequirement[] = [];
  for (const entry of input) {
    const requirement = typeof entry === "string" ? { capability: entry } : entry;
    if (!ENGINE_CAPABILITY_IDS.includes(requirement.capability)) {
      throw new RangeError(`Unknown engine capability: ${String(requirement.capability)}`);
    }
    if (seen.has(requirement.capability)) continue;
    if (requirement.purpose !== undefined && (!requirement.purpose.trim() || requirement.purpose.length > 512)) {
      throw new RangeError("Engine capability requirement purposes must contain 1 to 512 characters.");
    }
    seen.add(requirement.capability);
    normalized.push(Object.freeze({
      capability: requirement.capability,
      ...(requirement.purpose !== undefined ? { purpose: requirement.purpose.trim() } : {})
    }));
  }
  return normalized;
}
