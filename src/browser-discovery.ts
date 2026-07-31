import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { BrowserProviderInput } from "./contracts.js";
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
): Promise<{ executablePath?: string; cdpEndpoint?: string; arguments: string[]; extensions: string[]; persistentProfile?: string }> {
  if (!provider) {
    return {
      ...(legacy.executablePath ? { executablePath: await assertExecutable(legacy.executablePath) } : {}),
      ...(legacy.cdpEndpoint ? { cdpEndpoint: legacy.cdpEndpoint } : {}),
      arguments: [],
      extensions: []
    };
  }
  if (legacy.executablePath || legacy.cdpEndpoint) {
    throw new CockroachBrowserError("BROWSER_PROVIDER_CONFLICT", "Use browserProvider or legacy executablePath/cdpEndpoint fields, not both.");
  }
  const argumentsList = validateBrowserArguments(provider.arguments ?? []);
  const extensions = await validateExtensionDirectories(provider.extensions ?? []);
  const persistentProfile = provider.persistentProfile ? profileName(provider.persistentProfile) : undefined;
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
