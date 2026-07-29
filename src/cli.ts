#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { BrowserClient } from "./client.js";
import { CAPABILITIES } from "./capabilities.js";
import type { BrowserAction, SessionCreateInput } from "./contracts.js";
import { BrowserRuntime } from "./runtime.js";
import { startBrowserServer } from "./server.js";
import { startMcpServer } from "./mcp.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command = "help", subcommand, ...rest] = argv;
  if (command === "help" || command === "--help" || command === "-h") return printHelp();
  if (command === "version" || command === "--version" || command === "-v") return print({ version: "0.1.1" });
  if (command === "capabilities") {
    const status = flag(rest, "--status");
    return print(CAPABILITIES.filter((entry) => !status || entry.status === status));
  }
  if (command === "setup") {
    await installChromium();
    return doctor();
  }
  if (command === "doctor") return doctor();
  if (command === "serve") return serve(argv.slice(1));
  if (command === "mcp") return startMcpServer();
  if (command === "profile") return profileCommand(subcommand, rest);

  const client = await clientFrom(rest);
  if (command === "session" && subcommand === "create") {
    const input = await jsonFile<SessionCreateInput>(requiredFlag(rest, "--config"));
    return print(await client.createSession(input));
  }
  if (command === "session" && subcommand === "list") return print(await client.sessions());
  if (command === "session" && subcommand === "get") return print(await client.session(requiredFlag(rest, "--id")));
  if (command === "session" && subcommand === "close") {
    await client.closeSession(requiredFlag(rest, "--id"));
    return print({ closed: true });
  }
  if (command === "snapshot") {
    return print(await client.snapshot(requiredFlag(rest, "--session"), flag(rest, "--tab")));
  }
  if (command === "audit") {
    const kinds = flag(rest, "--kinds")?.split(",") as Array<"accessibility" | "performance" | "assets" | "console" | "security"> | undefined;
    return print(await client.audit(requiredFlag(rest, "--session"), kinds));
  }
  if (command === "act") {
    const action = await jsonFile<BrowserAction>(requiredFlag(rest, "--input"));
    return print(await client.act(requiredFlag(rest, "--session"), action));
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
  const server = await startBrowserServer({
    host,
    port,
    ...(root ? { root } : {}),
    ...(tokenFile ? { tokenFile } : {}),
    ...(allowRawActions ? { allowRawActions: true } : {}),
    ...(allowSessionHostConfiguration ? { allowSessionHostConfiguration: true } : {}),
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

async function doctor(): Promise<void> {
  const major = Number(process.versions.node.split(".")[0]);
  let browser = chromium.executablePath();
  let browserReady = false;
  try {
    await access(browser);
    browserReady = true;
  } catch {
    browser = "not installed";
  }
  const supportedNode = [22, 24, 26].includes(major);
  print({
    ok: supportedNode && browserReady,
    node: process.version,
    supportedNode,
    chromium: browser,
    chromiumReady: browserReady,
    next: browserReady ? "ready" : "run: cockroach-browser setup"
  });
  if (!supportedNode || !browserReady) process.exitCode = 1;
}

async function installChromium(): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(command, ["--yes", "playwright@1.55.0", "install", "chromium"], {
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? accept() : reject(new Error(`Chromium setup exited with ${code}.`)));
  });
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

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`Cockroach Browser 0.1.1

Usage:
  cockroach-browser setup
  cockroach-browser doctor
  cockroach-browser serve [--host 127.0.0.1] [--port 43110]
    [--allow-raw-actions] [--allow-session-host-config]
  cockroach-browser mcp
  cockroach-browser capabilities [--status available]
  cockroach-browser session create --config session.json --token-file TOKEN_FILE
  cockroach-browser session list --token-file TOKEN_FILE
  cockroach-browser snapshot --session ID --token-file TOKEN_FILE
  cockroach-browser act --session ID --input action.json --token-file TOKEN_FILE
  cockroach-browser audit --session ID --kinds accessibility,security --token-file TOKEN_FILE
  cockroach-browser profile list
  cockroach-browser profile import --name NAME --file storage.json
  cockroach-browser profile export --name NAME --file storage.json

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
