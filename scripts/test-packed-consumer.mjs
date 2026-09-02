import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "cockroach-browser-consumer-"));

try {
  runNpm(["pack", "--ignore-scripts", "--pack-destination", temporary], root);
  const tarball = (await import("node:fs/promises")).readdir(temporary)
    .then((entries) => entries.find((entry) => entry.endsWith(".tgz")));
  const archive = await tarball;
  if (!archive) throw new Error("npm pack did not produce a tarball");

  await writeFile(
    join(temporary, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", `./${archive}`], temporary);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-dev", "@types/node@24"], temporary);
  await writeFile(
    join(temporary, "consumer.mjs"),
    `import { CAPABILITIES, BrowserClient } from "cockroach-browser";
import { createMaqamBrowserDriver } from "cockroach-browser/maqam";
import { createQarinahContextRecorder } from "cockroach-browser/qarinah";
import { createCrawlerHandoff } from "cockroach-browser/crawler";
import { productLoopBrowserCapabilitySnapshot } from "cockroach-browser/productloop";
import { shellCompletion } from "cockroach-browser/operator-install";
import { RAW_BROWSER_ENGINES, chromium, firefox, webkit } from "cockroach-browser/automation";
import puppeteer from "cockroach-browser/puppeteer";
import { test as playwrightTest, expect as playwrightExpect } from "cockroach-browser/test";
import { BidiSession } from "cockroach-browser/bidi";
import { WebDriverClient } from "cockroach-browser/mobile";
import { BrowserAgent } from "cockroach-browser/agent";
import { OpenAICompatibleModelGateway } from "cockroach-browser/model-gateway";
import { BrowserFleet, LocalBrowserFleetProvider } from "cockroach-browser/fleet";
import { createRawCdpSession } from "cockroach-browser/cdp";
import actionSchema from "cockroach-browser/schemas/action.schema.json" with { type: "json" };
import memorySchema from "cockroach-browser/schemas/browser-memory.schema.json" with { type: "json" };
import sessionSchema from "cockroach-browser/schemas/session.schema.json" with { type: "json" };
import server from "cockroach-browser/server.json" with { type: "json" };
if (CAPABILITIES.length < 73) throw new Error("operator capabilities missing");
if (typeof BrowserClient !== "function") throw new Error("client missing");
if (typeof createMaqamBrowserDriver !== "function") throw new Error("Maqam adapter missing");
if (typeof createQarinahContextRecorder !== "function") throw new Error("Qarinah adapter missing");
if (typeof createCrawlerHandoff !== "function") throw new Error("crawler adapter missing");
if (typeof productLoopBrowserCapabilitySnapshot !== "function") throw new Error("ProductLoop snapshot missing");
if (!shellCompletion("bash").includes("bootstrap")) throw new Error("operator installer export missing");
if (RAW_BROWSER_ENGINES.join(",") !== "chromium,firefox,webkit") throw new Error("raw engine exports missing");
if (![chromium, firefox, webkit].every((engine) => typeof engine.launch === "function")) throw new Error("Playwright engines missing");
if (typeof puppeteer.launch !== "function") throw new Error("Puppeteer surface missing");
if (typeof playwrightTest !== "function" || typeof playwrightExpect !== "function") throw new Error("Playwright Test surface missing");
for (const exported of [BidiSession, WebDriverClient, BrowserAgent, OpenAICompatibleModelGateway, BrowserFleet, LocalBrowserFleetProvider, createRawCdpSession]) {
  if (typeof exported !== "function") throw new Error("expanded platform export missing");
}
if (actionSchema.$id !== "https://cockroachbrowser.com/schemas/action.schema.json" || !actionSchema.$defs?.actionKind) throw new Error("action schema mismatch");
if (memorySchema.properties?.schemaVersion?.const !== "cockroach.browser-memory.v2") throw new Error("memory schema mismatch");
if (sessionSchema.$id !== "https://cockroachbrowser.com/schemas/session.schema.json" || !sessionSchema.properties?.browserProvider) throw new Error("session schema mismatch");
if (server.name !== "io.github.AjnasNB/cockroach-browser") throw new Error("MCP identity mismatch");
process.stdout.write(JSON.stringify({ ok: true, capabilities: CAPABILITIES.length }) + "\\n");
`
  );
  const result = run(process.execPath, ["consumer.mjs"], temporary);
  process.stdout.write(result.stdout);
  await writeFile(
    join(temporary, "consumer.mts"),
    `import type { Browser, BrowserContext, Page, Locator, JSHandle, ElementHandle, Worker, WebSocketRoute, CDPSession } from "cockroach-browser/automation";
import type { Browser as PuppeteerBrowser, Page as PuppeteerPage, Target, WebWorker } from "cockroach-browser/puppeteer";
import { expect, test } from "cockroach-browser/test";
declare const browser: Browser;
declare const context: BrowserContext;
declare const page: Page;
declare const locator: Locator;
declare const jsHandle: JSHandle;
declare const element: ElementHandle;
declare const worker: Worker;
declare const socket: WebSocketRoute;
declare const cdp: CDPSession;
declare const pBrowser: PuppeteerBrowser;
declare const pPage: PuppeteerPage;
declare const target: Target;
declare const webWorker: WebWorker;
void [browser, context, page, locator, jsHandle, element, worker, socket, cdp, pBrowser, pPage, target, webWorker];
test("consumer", async () => { await expect(locator).toBeVisible(); });
`
  );
  const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "--noEmit", "--strict", "--target", "ESNext", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node", "consumer.mts"], temporary);
} finally {
  const relation = temporary.startsWith(resolve(tmpdir())) && temporary.includes("cockroach-browser-consumer-");
  if (!relation) throw new Error(`Refusing to remove unexpected path: ${temporary}`);
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error ?? ""}`
    );
  }
  return result;
}

function runNpm(args, cwd) {
  const bundled = resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCli = process.env.npm_execpath && existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : bundled;
  if (existsSync(npmCli)) return run(process.execPath, [npmCli, ...args], cwd);
  return run("npm", args, cwd);
}
