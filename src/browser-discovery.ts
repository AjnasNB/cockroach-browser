import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { BrowserProviderInput, BrowserProviderKind, LightweightBrowserImplementation } from "./contracts.js";
import { CockroachBrowserError } from "./errors.js";
import { profileName } from "./persistent-profiles.js";

export interface BrowserCandidate {
  id: string;
  name: string;
  path: string;
  source: "path" | "system" | "explicit";
  platform: NodeJS.Platform;
  arch: string;
}

export interface BrowserDiscoveryOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  explicitPaths?: string[];
}

export interface ResolvedBrowserProvider {
  executablePath?: string;
  cdpEndpoint?: string;
  arguments: string[];
  extensions: string[];
  persistentProfile?: string;
  lightweight?: {
    implementation: LightweightBrowserImplementation;
    executablePath: string;
    expectedSha256?: string;
    startupTimeoutMs?: number;
    rendering: "none" | "native";
    resourceProfile: "standard" | "constrained";
    allowExperimentalCapabilities: true;
  };
}

const BROWSER_PROVIDER_KEYS: Readonly<Record<BrowserProviderKind, ReadonlySet<string>>> = {
  bundled: new Set(["kind", "arguments", "extensions", "persistentProfile"]),
  system: new Set(["kind", "channel", "arguments", "extensions", "persistentProfile"]),
  custom: new Set(["kind", "executablePath", "arguments", "extensions", "persistentProfile"]),
  cdp: new Set(["kind", "cdpEndpoint"]),
  lightweight: new Set([
    "kind",
    "implementation",
    "executablePath",
    "expectedSha256",
    "startupTimeoutMs",
    "rendering",
    "resourceProfile",
    "allowExperimentalCapabilities"
  ])
};

const BROWSER_PROVIDER_KINDS = new Set<BrowserProviderKind>(["bundled", "system", "custom", "cdp", "lightweight"]);
const BROWSER_PROVIDER_CHANNELS = new Set([
  "chrome",
  "chrome-beta",
  "chrome-dev",
  "chrome-canary",
  "msedge",
  "msedge-beta",
  "msedge-dev",
  "msedge-canary"
]);

export async function discoverBrowserExecutables(options: BrowserDiscoveryOptions = {}): Promise<BrowserCandidate[]> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const home = resolve(options.home ?? homedir());
  const env = options.env ?? process.env;
  const candidates = new Map<string, Omit<BrowserCandidate, "path"> & { path: string }>();
  const add = (id: string, name: string, path: string, source: BrowserCandidate["source"]): void => {
    const absolute = resolve(path);
    candidates.set(absolute.toLowerCase(), { id, name, path: absolute, source, platform, arch });
  };

  for (const path of options.explicitPaths ?? []) add("explicit", "Explicit browser", path, "explicit");
  for (const entry of systemCandidates(platform, home, env)) add(entry.id, entry.name, entry.path, "system");
  for (const folder of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const executable of executableNames(platform)) add(executable, executable, join(folder, executable), "path");
  }

  const found: BrowserCandidate[] = [];
  for (const candidate of candidates.values()) {
    if (await isExecutableFile(candidate.path, platform)) {
      found.push({ ...candidate, path: await realpath(candidate.path) });
    }
  }
  return found.sort((a, b) => `${a.source}:${a.name}:${a.path}`.localeCompare(`${b.source}:${b.name}:${b.path}`));
}

export async function resolveBrowserProvider(
  provider: BrowserProviderInput | undefined,
  legacy: { executablePath?: string; cdpEndpoint?: string } = {}
): Promise<ResolvedBrowserProvider> {
  if (provider === undefined) {
    return {
      ...(legacy.executablePath ? { executablePath: await assertExecutable(legacy.executablePath) } : {}),
      ...(legacy.cdpEndpoint ? { cdpEndpoint: legacy.cdpEndpoint } : {}),
      arguments: [],
      extensions: []
    };
  }
  provider = validateRawBrowserProvider(provider);
  if (legacy.executablePath || legacy.cdpEndpoint) {
    throw new CockroachBrowserError("BROWSER_PROVIDER_CONFLICT", "Use browserProvider or legacy executablePath/cdpEndpoint fields, not both.");
  }
  const argumentsList = validateBrowserArguments(provider.arguments ?? []);
  const extensions = await validateExtensionDirectories(provider.extensions ?? []);
  const persistentProfile = provider.persistentProfile ? profileName(provider.persistentProfile) : undefined;
  if (provider.kind === "lightweight") {
    // Keep runtime validation for untyped JSON callers even though the public
    // TypeScript union rules out unsupported implementation combinations.
    const rendering = provider.rendering as "none" | "native" | undefined;
    const resourceProfile = provider.resourceProfile as "standard" | "constrained" | undefined;
    if (!provider.executablePath) {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_EXECUTABLE_REQUIRED", "Lightweight providers require an explicit executablePath.");
    }
    if (provider.implementation !== "obscura" && provider.implementation !== "lightpanda") {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_IMPLEMENTATION_REQUIRED", "Lightweight providers require implementation obscura or lightpanda.");
    }
    if (provider.allowExperimentalCapabilities !== true) {
      throw new CockroachBrowserError(
        "LIGHTWEIGHT_CDP_EXPERIMENTAL_OPT_IN_REQUIRED",
        "Lightweight providers require allowExperimentalCapabilities=true until the exact binary passes the supported conformance boundary."
      );
    }
    if (rendering !== undefined && rendering !== "none" && rendering !== "native") {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_RENDERING_INVALID", "rendering must be none or native.");
    }
    if (provider.implementation === "lightpanda" && rendering === "native") {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_RENDERING_UNSUPPORTED", "The owned Lightpanda lane has no native-rendering variant.");
    }
    if (resourceProfile !== undefined && resourceProfile !== "standard" && resourceProfile !== "constrained") {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_RESOURCE_PROFILE_INVALID", "resourceProfile must be standard or constrained.");
    }
    if (provider.implementation === "lightpanda" && resourceProfile === "constrained") {
      throw new CockroachBrowserError(
        "LIGHTWEIGHT_CDP_RESOURCE_PROFILE_UNSUPPORTED",
        "The constrained resource profile is reviewed only for Obscura."
      );
    }
    if (provider.cdpEndpoint || provider.channel || argumentsList.length || extensions.length || persistentProfile) {
      throw new CockroachBrowserError(
        "LIGHTWEIGHT_CDP_CONFIG_DENIED",
        "Owned lightweight providers do not accept external endpoints, browser channels, arbitrary arguments, extensions, or persistent profiles."
      );
    }
    if (provider.expectedSha256 !== undefined && !/^(?:sha256:)?[a-f0-9]{64}$/i.test(provider.expectedSha256)) {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_DIGEST_INVALID", "expectedSha256 must be 64 hexadecimal characters, optionally prefixed by sha256:.");
    }
    if (
      provider.startupTimeoutMs !== undefined
      && (!Number.isSafeInteger(provider.startupTimeoutMs) || provider.startupTimeoutMs < 250 || provider.startupTimeoutMs > 120_000)
    ) {
      throw new CockroachBrowserError("LIGHTWEIGHT_CDP_TIMEOUT_INVALID", "startupTimeoutMs must be between 250 and 120000 milliseconds.");
    }
    return {
      arguments: [],
      extensions: [],
      lightweight: {
        implementation: provider.implementation,
        executablePath: await assertExecutable(provider.executablePath),
        ...(provider.expectedSha256 ? { expectedSha256: provider.expectedSha256 } : {}),
        ...(provider.startupTimeoutMs ? { startupTimeoutMs: provider.startupTimeoutMs } : {}),
        rendering: rendering ?? "none",
        resourceProfile: resourceProfile ?? "standard",
        allowExperimentalCapabilities: true
      }
    };
  }
  if (provider.kind === "cdp") {
    if (!provider.cdpEndpoint) throw new CockroachBrowserError("CDP_ENDPOINT_REQUIRED", "CDP providers require cdpEndpoint.");
    if (extensions.length || argumentsList.length || persistentProfile) {
      throw new CockroachBrowserError("CDP_PROVIDER_CONFIG_DENIED", "Attached CDP providers cannot install extensions, select runtime profiles, or change launch arguments.");
    }
    return { cdpEndpoint: provider.cdpEndpoint, arguments: [], extensions: [] };
  }
  if (provider.kind === "custom") {
    if (!provider.executablePath) throw new CockroachBrowserError("BROWSER_EXECUTABLE_REQUIRED", "Custom providers require executablePath.");
    return { executablePath: await assertExecutable(provider.executablePath), arguments: argumentsList, extensions, ...(persistentProfile ? { persistentProfile } : {}) };
  }
  if (provider.kind === "system") {
    const discovered = await discoverBrowserExecutables();
    const channel = provider.channel?.toLowerCase();
    const selected = discovered.find((entry) => !channel || entry.id.includes(channel) || entry.name.toLowerCase().includes(channel));
    if (!selected) throw new CockroachBrowserError("SYSTEM_BROWSER_NOT_FOUND", `No compatible system browser${channel ? ` for ${channel}` : ""} was found.`);
    return { executablePath: selected.path, arguments: argumentsList, extensions, ...(persistentProfile ? { persistentProfile } : {}) };
  }
  if (provider.executablePath || provider.cdpEndpoint || provider.channel) {
    throw new CockroachBrowserError("BUNDLED_PROVIDER_CONFIG_DENIED", "Bundled providers do not accept executablePath, cdpEndpoint, or channel.");
  }
  return { arguments: argumentsList, extensions, ...(persistentProfile ? { persistentProfile } : {}) };
}

function validateRawBrowserProvider(value: unknown): BrowserProviderInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CockroachBrowserError("BROWSER_PROVIDER_INVALID", "browserProvider must be a non-null object.");
  }

  const provider = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(provider, "kind") || typeof provider.kind !== "string" || !BROWSER_PROVIDER_KINDS.has(provider.kind as BrowserProviderKind)) {
    throw new CockroachBrowserError(
      "BROWSER_PROVIDER_KIND_INVALID",
      "browserProvider.kind must be bundled, system, custom, cdp, or lightweight."
    );
  }

  const kind = provider.kind as BrowserProviderKind;
  const allowedKeys = BROWSER_PROVIDER_KEYS[kind];
  const deniedKeys = Reflect.ownKeys(provider)
    .filter((key): key is string => typeof key === "string" && !allowedKeys.has(key))
    .sort();
  const symbolKeyPresent = Reflect.ownKeys(provider).some((key) => typeof key === "symbol");
  if (deniedKeys.length > 0 || symbolKeyPresent) {
    const fields = [...deniedKeys, ...(symbolKeyPresent ? ["<symbol>"] : [])];
    throw new CockroachBrowserError(
      "BROWSER_PROVIDER_PROPERTY_DENIED",
      `Browser provider kind ${kind} does not accept properties: ${fields.join(", ")}.`,
      { kind, properties: fields }
    );
  }

  assertOptionalStringArray(provider, "arguments");
  assertOptionalStringArray(provider, "extensions");
  assertOptionalString(provider, "persistentProfile");
  assertOptionalString(provider, "executablePath");
  assertOptionalString(provider, "cdpEndpoint");
  assertOptionalString(provider, "expectedSha256");
  assertOptionalNumber(provider, "startupTimeoutMs");
  assertOptionalBoolean(provider, "allowExperimentalCapabilities");
  assertOptionalString(provider, "implementation");
  assertOptionalString(provider, "rendering");
  assertOptionalString(provider, "resourceProfile");
  if (provider.channel !== undefined && (typeof provider.channel !== "string" || !BROWSER_PROVIDER_CHANNELS.has(provider.channel))) {
    throw invalidBrowserProviderField("channel", "one of the supported Chrome or Edge channels");
  }

  return provider as unknown as BrowserProviderInput;
}

function assertOptionalString(provider: Record<string, unknown>, field: string): void {
  if (provider[field] !== undefined && typeof provider[field] !== "string") {
    throw invalidBrowserProviderField(field, "a string");
  }
}

function assertOptionalNumber(provider: Record<string, unknown>, field: string): void {
  if (provider[field] !== undefined && typeof provider[field] !== "number") {
    throw invalidBrowserProviderField(field, "a number");
  }
}

function assertOptionalBoolean(provider: Record<string, unknown>, field: string): void {
  if (provider[field] !== undefined && typeof provider[field] !== "boolean") {
    throw invalidBrowserProviderField(field, "a boolean");
  }
}

function assertOptionalStringArray(provider: Record<string, unknown>, field: string): void {
  const value = provider[field];
  if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) {
    throw invalidBrowserProviderField(field, "an array of strings");
  }
}

function invalidBrowserProviderField(field: string, expectation: string): CockroachBrowserError {
  return new CockroachBrowserError(
    "BROWSER_PROVIDER_FIELD_INVALID",
    `browserProvider.${field} must be ${expectation}.`,
    { field }
  );
}

async function validateExtensionDirectories(paths: string[]): Promise<string[]> {
  if (paths.length > 16) throw new CockroachBrowserError("EXTENSION_LIMIT_EXCEEDED", "At most 16 reviewed extension directories may be loaded.");
  const resolved: string[] = [];
  for (const path of paths) {
    const absolute = resolve(path);
    const info = await lstat(absolute).catch(() => undefined);
    if (!info?.isDirectory() || info.isSymbolicLink()) {
      throw new CockroachBrowserError("EXTENSION_PATH_DENIED", "Extensions must be explicit, local, unpacked directories.");
    }
    await access(join(absolute, "manifest.json"), constants.R_OK).catch(() => {
      throw new CockroachBrowserError("EXTENSION_MANIFEST_REQUIRED", `Extension ${absolute} has no readable manifest.json.`);
    });
    resolved.push(await realpath(absolute));
  }
  return [...new Set(resolved)];
}

function validateBrowserArguments(args: string[]): string[] {
  if (args.length > 64) throw new CockroachBrowserError("BROWSER_ARGUMENT_LIMIT_EXCEEDED", "At most 64 reviewed browser arguments may be supplied.");
  const denied = /^(?:--remote-debugging-address|--remote-debugging-port|--user-data-dir|--load-extension|--disable-extensions-except|--no-sandbox|--disable-web-security)(?:=|$)/i;
  return args.map((arg) => {
    const value = arg.trim();
    if (!value || value.length > 1_024 || denied.test(value)) {
      throw new CockroachBrowserError("BROWSER_ARGUMENT_DENIED", `Browser argument ${value || "<empty>"} is not accepted.`);
    }
    return value;
  });
}

async function assertExecutable(path: string): Promise<string> {
  const absolute = resolve(path);
  if (!await isExecutableFile(absolute, process.platform)) {
    throw new CockroachBrowserError("BROWSER_EXECUTABLE_INVALID", `Browser executable ${absolute} is not a readable regular file.`);
  }
  return realpath(absolute);
}

async function isExecutableFile(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    await access(path, platform === "win32" ? constants.R_OK : constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableNames(platform: NodeJS.Platform): string[] {
  return platform === "win32"
    ? ["chrome.exe", "msedge.exe", "chromium.exe", "brave.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];
}

function systemCandidates(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): Array<{ id: string; name: string; path: string }> {
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((value): value is string => Boolean(value));
    return roots.flatMap((root) => [
      { id: "chrome", name: "Google Chrome", path: join(root, "Google", "Chrome", "Application", "chrome.exe") },
      { id: "msedge", name: "Microsoft Edge", path: join(root, "Microsoft", "Edge", "Application", "msedge.exe") },
      { id: "brave", name: "Brave", path: join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") }
    ]);
  }
  if (platform === "darwin") {
    return [
      { id: "chrome", name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { id: "msedge", name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      { id: "brave", name: "Brave", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
      { id: "chrome-user", name: "Google Chrome", path: join(home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome") }
    ];
  }
  return [
    { id: "chrome", name: "Google Chrome", path: "/usr/bin/google-chrome" },
    { id: "chromium", name: "Chromium", path: "/usr/bin/chromium" },
    { id: "chromium-browser", name: "Chromium", path: "/usr/bin/chromium-browser" },
    { id: "msedge", name: "Microsoft Edge", path: "/usr/bin/microsoft-edge" },
    { id: "brave", name: "Brave", path: "/usr/bin/brave-browser" },
    { id: "chromium-snap", name: "Chromium Snap", path: "/snap/bin/chromium" }
  ];
}
