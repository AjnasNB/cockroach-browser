#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "playwright-core";
import {
  BrowserClient,
  type NetworkReadOptions,
  type PairedCaptureOptions
} from "./client.js";
import { CAPABILITIES } from "./capabilities.js";
import type { BrowserAction, BrowserActionBatchInput, SessionCreateInput } from "./contracts.js";
import {
  installOperatorService,
  operatorServiceStatus,
  shellCompletion,
  uninstallOperatorService,
  type CompletionShell
} from "./operator-install.js";
import { BrowserRuntime } from "./runtime.js";
import { startBrowserServer } from "./server.js";
import { startMcpServer } from "./mcp.js";
import { discoverBrowserExecutables } from "./browser-discovery.js";
import { TeamSessionStore } from "./team-sessions.js";
import { installBrowserEngines } from "./browser-bootstrap.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command = "help", subcommand, ...rest] = argv;
  if (command === "help" || command === "--help" || command === "-h") return printHelp();
  if (command === "version" || command === "--version" || command === "-v") return print({ version: "0.4.0" });
  if (command === "capabilities") {
    const status = flag(rest, "--status");
    return print(CAPABILITIES.filter((entry) => !status || entry.status === status));
  }
  if (command === "completion") return printText(shellCompletion(requiredShell(subcommand)));
  if (command === "service") return serviceCommand(subcommand, rest);
  if (command === "setup" || command === "bootstrap") return bootstrap(argv.slice(1));
  if (command === "doctor") return doctor(argv.slice(1));
  if (command === "serve") return serve(argv.slice(1));
  if (command === "mcp") return startMcpServer();
  if (command === "profile") return profileCommand(subcommand, rest);
  if (command === "persistent-profile") return persistentProfileCommand(subcommand, rest);
  if (command === "browser" && subcommand === "discover") return print(await discoverBrowserExecutables());

  const client = await clientFrom(rest);
  if (command === "session" && subcommand === "create") {
    const input = await jsonFile<SessionCreateInput>(requiredFlag(rest, "--config"));
    return print(await client.createSession(input));
  }
  if (command === "session" && subcommand === "list") return print(await client.sessions());
  if (command === "session" && subcommand === "get") return print(await client.session(requiredFlag(rest, "--id")));
  if (command === "session" && subcommand === "graph") return print(await client.navigationGraph(requiredFlag(rest, "--id")));
  if (command === "session" && subcommand === "close") {
    await client.closeSession(requiredFlag(rest, "--id"));
    return print({ closed: true });
  }
  if (command === "snapshot") {
    return print(await client.snapshot(requiredFlag(rest, "--session"), flag(rest, "--tab")));
  }
  if (command === "capture") {
    const formatValue = flag(rest, "--format");
    if (formatValue && formatValue !== "png" && formatValue !== "jpeg") {
      throw new Error("--format must be png or jpeg.");
    }
    const format: "png" | "jpeg" | undefined =
      formatValue === "png" || formatValue === "jpeg" ? formatValue : undefined;
    const tabId = flag(rest, "--tab");
    const purpose = flag(rest, "--purpose");
    const quality = numberFlag(rest, "--quality");
    const options: PairedCaptureOptions = {
      ...(tabId ? { tabId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(format ? { format } : {}),
      ...(quality !== undefined ? { quality } : {}),
      fullPage: rest.includes("--full-page"),
      requireStable: rest.includes("--require-stable"),
      includeBounds: rest.includes("--include-bounds")
    };
    return print(await client.capture(requiredFlag(rest, "--session"), options));
  }
  if (command === "network" && subcommand !== "export") {
    return print(await client.network(requiredFlag(rest, "--session"), networkOptions(rest)));
  }
  if (command === "network" && subcommand === "export") {
    const outputFormatValue = flag(rest, "--format");
    if (
      outputFormatValue &&
      outputFormatValue !== "json" &&
      outputFormatValue !== "ndjson" &&
      outputFormatValue !== "har"
    ) {
      throw new Error("--format must be json, ndjson, or har.");
    }
    const outputFormat: "json" | "ndjson" | "har" | undefined =
      outputFormatValue === "json" || outputFormatValue === "ndjson" || outputFormatValue === "har"
        ? outputFormatValue
        : undefined;
    const options: NetworkReadOptions & { outputFormat?: "json" | "ndjson" | "har" } = {
      ...networkOptions(rest),
      ...(outputFormat ? { outputFormat } : {})
    };
    return print(await client.exportNetwork(requiredFlag(rest, "--session"), options));
  }
  if (command === "audit") {
    const kinds = flag(rest, "--kinds")?.split(",") as Array<"accessibility" | "performance" | "assets" | "console" | "security"> | undefined;
    return print(await client.audit(requiredFlag(rest, "--session"), kinds));
  }
  if (command === "activity") {
    const sessionId = flag(rest, "--session");
    const after = flag(rest, "--after");
    const limit = numberFlag(rest, "--limit");
    return print(await client.activity({
      ...(sessionId ? { sessionId } : {}),
      ...(after ? { after } : {}),
      ...(limit !== undefined ? { limit } : {})
    }));
  }
  if (command === "act") {
    const action = await jsonFile<BrowserAction>(requiredFlag(rest, "--input"));
    return print(await client.act(requiredFlag(rest, "--session"), action));
  }
  if (command === "batch") {
    const input = await jsonFile<BrowserActionBatchInput>(requiredFlag(rest, "--input"));
    return print(await client.actBatch(requiredFlag(rest, "--session"), input));
  }
  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

async function serve(args: string[]): Promise<void> {
  const host = flag(args, "--host") ?? "127.0.0.1";
  const port = Number(flag(args, "--port") ?? "43110");
  const root = flag(args, "--root");
  const tokenFile = flag(args, "--token-file");
  const tlsCert = flag(args, "--tls-cert");
  const tlsKey = flag(args, "--tls-key");
  const allowRawActions = args.includes("--allow-raw-actions");
  const allowSessionHostConfiguration = args.includes("--allow-session-host-config");
  const enableJobs = args.includes("--enable-jobs");
  const actorTokensFile = flag(args, "--actor-tokens-file");
  const teamAccessFile = flag(args, "--team-access-file");
  if (Boolean(actorTokensFile) !== Boolean(teamAccessFile)) {
    throw new Error("Use --actor-tokens-file and --team-access-file together so actor authentication and persistent role grants cannot drift apart.");
  }
  const actorTokens = actorTokensFile ? await jsonFile<Record<string, string>>(actorTokensFile) : undefined;
  const teamSessions = teamAccessFile ? new TeamSessionStore(teamAccessFile) : undefined;
  const server = await startBrowserServer({
    host,
    port,
    ...(root ? { root } : {}),
    ...(tokenFile ? { tokenFile } : {}),
    ...(allowRawActions ? { allowRawActions: true } : {}),
    ...(allowSessionHostConfiguration ? { allowSessionHostConfiguration: true } : {}),
    ...(enableJobs ? { enableJobs: true } : {}),
    ...(actorTokens ? { actorTokens } : {}),
    ...(teamSessions ? { teamSessions } : {}),
    ...((tlsCert && tlsKey) ? { tls: { certFile: tlsCert, keyFile: tlsKey }, allowRemote: true } : {})
  });
  print({
    ok: true,
    url: server.url,
    dashboardUrl: server.dashboardUrl,
    tokenFile: tokenFile ?? `${server.runtime.root}\\auth-token`,
    remote: host !== "127.0.0.1" && host !== "::1" && host !== "localhost"
  });
  await new Promise<void>((accept) => {
    const stop = () => void server.close().finally(accept);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function clientFrom(args: string[]): Promise<BrowserClient> {
  const baseUrl = flag(args, "--url") ?? process.env.COCKROACH_BROWSER_URL ?? "http://127.0.0.1:43110";
  const explicitToken = flag(args, "--token") ?? process.env.COCKROACH_BROWSER_TOKEN;
  const tokenFile = flag(args, "--token-file") ?? process.env.COCKROACH_BROWSER_TOKEN_FILE;
  const token = explicitToken ?? (tokenFile ? (await readFile(tokenFile, "utf8")).trim() : undefined);
  if (!token) throw new Error("Provide --token, --token-file, or COCKROACH_BROWSER_TOKEN.");
  return new BrowserClient({ baseUrl, token });
}

async function profileCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const root = flag(args, "--root");
  const runtime = new BrowserRuntime({ ...(root ? { root } : {}) });
  await runtime.initialize();
  if (subcommand === "list") return print(await runtime.profiles.list());
  const name = requiredFlag(args, "--name");
  const passphrase = process.env.COCKROACH_BROWSER_PROFILE_PASSPHRASE;
  if (!passphrase) throw new Error("Set COCKROACH_BROWSER_PROFILE_PASSPHRASE; passphrases are never accepted on the command line.");
  if (subcommand === "import") {
    await runtime.profiles.importFile(name, requiredFlag(args, "--file"), passphrase);
    return print({ imported: name });
  }
  if (subcommand === "export") {
    await runtime.profiles.exportFile(name, requiredFlag(args, "--file"), passphrase);
    return print({ exported: name });
  }
  throw new Error("Use profile list, profile import, or profile export.");
}

async function persistentProfileCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const root = flag(args, "--root");
  const runtime = new BrowserRuntime({ ...(root ? { root } : {}) });
  await runtime.initialize();
  try {
    if (subcommand === "list") return print(await runtime.persistentProfiles.list());
    const name = requiredFlag(args, "--name");
    if (subcommand === "create") return print(await runtime.persistentProfiles.prepare(name));
    if (subcommand === "archive") return print(await runtime.persistentProfiles.archive(name));
    throw new Error("Use persistent-profile list, persistent-profile create, or persistent-profile archive.");
  } finally {
    await runtime.close();
  }
}

async function doctor(args: string[]): Promise<void> {
  const report = await doctorReport(args);
  print(report);
  if (!report.ok) process.exitCode = 1;
}

async function doctorReport(args: string[]): Promise<{
  ok: boolean;
  node: string;
  supportedNode: boolean;
  chromium: string;
  chromiumReady: boolean;
  firefox: string;
  firefoxReady: boolean;
  webkit: string;
  webkitReady: boolean;
  allEnginesReady: boolean;
  engines: Record<"chromium" | "firefox" | "webkit", { path: string; ready: boolean }>;
  runtimeRoot: string;
  runtimeRootReady: boolean;
  service: Awaited<ReturnType<typeof operatorServiceStatus>>;
  next: string;
}> {
  const major = Number(process.versions.node.split(".")[0]);
  const root = flag(args, "--root");
  const runtime = new BrowserRuntime({ ...(root ? { root } : {}) });
  const engines = await browserEngineReadiness();
  let runtimeRootReady = false;
  try {
    await access(runtime.root);
    runtimeRootReady = true;
  } catch {
    runtimeRootReady = false;
  }
  const supportedNode = [22, 24, 26].includes(major);
  const service = await operatorServiceStatus({
    ...(root ? { root } : {})
  });
  return {
    ok: supportedNode && Object.values(engines).every((entry) => entry.ready),
    node: process.version,
    supportedNode,
    chromium: engines.chromium.path,
    chromiumReady: engines.chromium.ready,
    firefox: engines.firefox.path,
    firefoxReady: engines.firefox.ready,
    webkit: engines.webkit.path,
    webkitReady: engines.webkit.ready,
    allEnginesReady: Object.values(engines).every((entry) => entry.ready),
    engines,
    runtimeRoot: runtime.root,
    runtimeRootReady,
    service,
    next: Object.values(engines).every((entry) => entry.ready) ? "ready" : "run: cockroach-browser bootstrap"
  };
}

async function bootstrap(args: string[]): Promise<void> {
  const major = Number(process.versions.node.split(".")[0]);
  const supportedNode = [22, 24, 26].includes(major);
  if (!supportedNode) {
    print({
      ok: false,
      node: process.version,
      supportedNode,
      next: "Install a maintained Node.js 22, 24, or 26 release."
    });
    process.exitCode = 1;
    return;
  }

  let engines = await browserEngineReadiness();
  if (!Object.values(engines).every((entry) => entry.ready) && !args.includes("--check-only")) {
    await installBrowserEngines();
    engines = await browserEngineReadiness();
  }

  const root = flag(args, "--root");
  const runtime = new BrowserRuntime({ ...(root ? { root } : {}) });
  await runtime.initialize();
  const initializedRoot = runtime.root;
  await runtime.close();
  let probe: { ok: boolean; status: number; url: string } = {
    ok: false,
    status: 0,
    url: ""
  };
  if (Object.values(engines).every((entry) => entry.ready)) {
    const server = await startBrowserServer({
      root: initializedRoot,
      host: "127.0.0.1",
      port: 0
    });
    try {
      const url = `${server.url}/v1/health`;
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${server.token}` }
      });
      probe = { ok: response.ok, status: response.status, url };
    } finally {
      await server.close();
    }
  }

  const report = await doctorReport([
    ...(root ? ["--root", root] : [])
  ]);
  const ok = report.ok && report.runtimeRootReady && probe.ok;
  print({
    ...report,
    ok,
    bootstrap: {
      rootInitialized: report.runtimeRootReady,
      chromiumInstalled: engines.chromium.ready,
      firefoxInstalled: engines.firefox.ready,
      webkitInstalled: engines.webkit.ready,
      allEnginesInstalled: Object.values(engines).every((entry) => entry.ready),
      loopbackHealthProbe: probe
    },
    next: ok
      ? "ready; run cockroach-browser serve or install the per-user service explicitly"
      : report.next
  });
  if (!ok) process.exitCode = 1;
}

async function serviceCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const root = flag(args, "--root");
  const port = numberFlag(args, "--port");
  const definitionOnly = args.includes("--definition-only");
  const confirmLocalOwner = args.includes("--confirm-local-owner");
  const options = {
    ...(root ? { root } : {}),
    ...(port !== undefined ? { port } : {}),
    definitionOnly,
    confirmLocalOwner
  };
  if (subcommand === "install") return print(await installOperatorService(options));
  if (subcommand === "uninstall") return print(await uninstallOperatorService(options));
  if (subcommand === "status") return print(await operatorServiceStatus(options));
  throw new Error("Use service install, service uninstall, or service status.");
}

async function browserTypeReadiness(browserType: BrowserType): Promise<{ path: string; ready: boolean }> {
  const path = browserType.executablePath();
  try {
    await access(path);
    return { path, ready: true };
  } catch {
    return { path: "not installed", ready: false };
  }
}

async function browserEngineReadiness(): Promise<Record<"chromium" | "firefox" | "webkit", { path: string; ready: boolean }>> {
  const [chromiumResult, firefoxResult, webkitResult] = await Promise.all([
    browserTypeReadiness(chromium),
    browserTypeReadiness(firefox),
    browserTypeReadiness(webkit)
  ]);
  return { chromium: chromiumResult, firefox: firefoxResult, webkit: webkitResult };
}

async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function numberFlag(args: string[], name: string): number | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

function networkOptions(args: string[]): {
  tabId?: string;
  purpose?: string;
  method?: string;
  status?: number;
  resourceType?: string;
  limit?: number;
} {
  const tabId = flag(args, "--tab");
  const purpose = flag(args, "--purpose");
  const method = flag(args, "--method");
  const status = numberFlag(args, "--status");
  const resourceType = flag(args, "--resource-type");
  const limit = numberFlag(args, "--limit");
  return {
    ...(tabId ? { tabId } : {}),
    ...(purpose ? { purpose } : {}),
    ...(method ? { method } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

function requiredShell(value: string | undefined): CompletionShell {
  if (value === "bash" || value === "zsh" || value === "fish" || value === "powershell") return value;
  throw new Error("Choose a completion shell: bash, zsh, fish, or powershell.");
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printText(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function printHelp(): void {
  process.stdout.write(`Cockroach Browser 0.4.0

Usage:
  cockroach-browser bootstrap [--root PATH] [--check-only]
  cockroach-browser setup [--root PATH]
  cockroach-browser doctor [--root PATH]
  cockroach-browser completion <bash|zsh|fish|powershell>
  cockroach-browser service install --confirm-local-owner [--root PATH] [--port 43110]
  cockroach-browser service status [--root PATH] [--port 43110]
  cockroach-browser service uninstall --confirm-local-owner [--root PATH] [--port 43110]
  cockroach-browser serve [--host 127.0.0.1] [--port 43110]
    [--allow-raw-actions] [--allow-session-host-config] [--enable-jobs]
    [--actor-tokens-file actors.json --team-access-file team-sessions.json]
  cockroach-browser mcp
  cockroach-browser capabilities [--status available]
  cockroach-browser session create --config session.json --token-file TOKEN_FILE
  cockroach-browser session list --token-file TOKEN_FILE
  cockroach-browser session graph --id ID --token-file TOKEN_FILE
  cockroach-browser browser discover
  cockroach-browser activity [--session ID] [--after ISO_TIME] [--limit 200]
  cockroach-browser snapshot --session ID --token-file TOKEN_FILE
  cockroach-browser capture --session ID [--full-page] [--require-stable]
    [--include-bounds] [--format png|jpeg] --token-file TOKEN_FILE
  cockroach-browser network --session ID [--method GET] [--status 200]
    [--resource-type document] [--limit 100] --token-file TOKEN_FILE
  cockroach-browser network export --session ID [--format json|ndjson|har]
    --token-file TOKEN_FILE
  cockroach-browser act --session ID --input action.json --token-file TOKEN_FILE
  cockroach-browser batch --session ID --input actions.json --token-file TOKEN_FILE
  cockroach-browser audit --session ID --kinds accessibility,security --token-file TOKEN_FILE
  cockroach-browser profile list
  cockroach-browser profile import --name NAME --file storage.json
  cockroach-browser profile export --name NAME --file storage.json
  cockroach-browser persistent-profile list [--root PATH]
  cockroach-browser persistent-profile create --name NAME [--root PATH]
  cockroach-browser persistent-profile archive --name NAME [--root PATH]

Bootstrap installs Chromium, Firefox, and WebKit when any selected engine is missing, initializes the local data root,
and probes an authenticated ephemeral loopback daemon. Per-user service changes never
use sudo or administrative service managers and require --confirm-local-owner.

High-risk browser actions must be dispatched through Maqam. MCP exposes observations
and canonical proposals, not raw profile, lifecycle, or unrestricted action authority.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
