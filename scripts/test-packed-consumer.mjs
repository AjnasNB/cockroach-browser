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
  await writeFile(
    join(temporary, "consumer.mjs"),
    `import { CAPABILITIES, BrowserClient } from "cockroach-browser";
import { createMaqamBrowserDriver } from "cockroach-browser/maqam";
import { createQarinahContextRecorder } from "cockroach-browser/qarinah";
import { createCrawlerHandoff } from "cockroach-browser/crawler";
import { productLoopBrowserCapabilitySnapshot } from "cockroach-browser/productloop";
import memorySchema from "cockroach-browser/schemas/browser-memory.schema.json" with { type: "json" };
import server from "cockroach-browser/server.json" with { type: "json" };
if (CAPABILITIES.length < 1) throw new Error("capabilities missing");
if (typeof BrowserClient !== "function") throw new Error("client missing");
if (typeof createMaqamBrowserDriver !== "function") throw new Error("Maqam adapter missing");
if (typeof createQarinahContextRecorder !== "function") throw new Error("Qarinah adapter missing");
if (typeof createCrawlerHandoff !== "function") throw new Error("crawler adapter missing");
if (typeof productLoopBrowserCapabilitySnapshot !== "function") throw new Error("ProductLoop snapshot missing");
if (memorySchema.properties?.schemaVersion?.const !== "cockroach.browser-memory.v1") throw new Error("memory schema mismatch");
if (server.name !== "io.github.AjnasNB/cockroach-browser") throw new Error("MCP identity mismatch");
process.stdout.write(JSON.stringify({ ok: true, capabilities: CAPABILITIES.length }) + "\\n");
`
  );
  const result = run(process.execPath, ["consumer.mjs"], temporary);
  process.stdout.write(result.stdout);
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
