import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await json("package.json");
const packageLock = await json("package-lock.json");
const server = await json("server.json");

assert(packageJson.name === "cockroach-browser", "package name must be cockroach-browser");
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version), "package version must be valid semver");
assert(packageJson.license === "AGPL-3.0-or-later", "package license must be AGPL-3.0-or-later");
assert(packageJson.author === "Ajnas NB", "package author must identify Ajnas NB");
assert(packageJson.mcpName === "io.github.ajnasnb/cockroach-browser", "mcpName must match the MCP registry identity");
assert(packageJson.engines?.node === "^22.0.0 || ^24.0.0 || ^26.0.0", "Node support must remain 22, 24, and 26");
assert(packageLock.name === packageJson.name && packageLock.version === packageJson.version, "package-lock identity is stale");
assert(server.name === packageJson.mcpName, "server.json name must match package mcpName");
assert(server.version === packageJson.version, "server.json version must match package version");
assert(
  server.packages?.some((entry) =>
    entry.registryType === "npm" &&
    entry.identifier === packageJson.name &&
    entry.version === packageJson.version
  ),
  "server.json npm package identity is stale"
);
const compatibleRuntimeLicenses = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]);
for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
  if (!path.startsWith("node_modules/") || entry.dev) continue;
  assert(
    compatibleRuntimeLicenses.has(entry.license),
    `${path} has an unreviewed runtime license: ${entry.license ?? "missing"}`
  );
}

const requiredSourceFiles = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CHANGELOG.md",
  "THIRD_PARTY_NOTICES.md",
  "server.json",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli.js",
  "dist/client.js",
  "dist/integrations/maqam.js",
  "dist/integrations/qarinah.js",
  "dist/integrations/crawler.js",
  "dist/integrations/productloop.js",
  "schemas/browser-memory.schema.json"
];
for (const path of requiredSourceFiles) await access(resolve(root, path));

const license = await readFile(resolve(root, "LICENSE"), "utf8");
assert(license.includes("GNU AFFERO GENERAL PUBLIC LICENSE"), "LICENSE must contain the GNU AGPL text");
assert(license.includes("Version 3, 19 November 2007"), "LICENSE must contain AGPL version 3");

const changelog = await readFile(resolve(root, "CHANGELOG.md"), "utf8");
assert(changelog.includes(`## [${packageJson.version}]`), "CHANGELOG does not contain the package release");
const compose = await readFile(resolve(root, "docker-compose.yml"), "utf8");
assert(
  compose.includes(`image: ${packageJson.name}:${packageJson.version}`),
  "docker-compose image version is stale"
);
const siteContent = await readFile(resolve(root, "site", "content.mjs"), "utf8");
assert(
  siteContent.includes(`version: "${packageJson.version}"`),
  "website source version is stale"
);

const cli = await readFile(resolve(root, "dist/cli.js"), "utf8");
assert(cli.startsWith("#!/usr/bin/env node"), "built CLI must preserve its Node shebang");

const packed = spawnNpm(["pack", "--dry-run", "--json", "--ignore-scripts"]);
if (packed.status !== 0) {
  throw new Error(`npm pack dry run failed:\n${packed.stdout ?? ""}\n${packed.stderr ?? ""}\n${packed.error ?? ""}`);
}
const report = JSON.parse(packed.stdout);
const files = new Set(report[0]?.files?.map((entry) => entry.path) ?? []);
for (const path of requiredSourceFiles) {
  assert(files.has(path.replaceAll("\\", "/")), `npm package is missing ${path}`);
}
for (const forbidden of ["src/runtime.ts", ".env", ".git/", "website/", "test/", "dist/test/"]) {
  assert(![...files].some((path) => path === forbidden || path.startsWith(forbidden)), `npm package leaks ${forbidden}`);
}

const packedBytes = Number(report[0]?.size ?? 0);
assert(packedBytes > 0 && packedBytes < 10 * 1024 * 1024, "packed tarball must stay below 10 MiB");

process.stdout.write(
  `${JSON.stringify({ ok: true, name: packageJson.name, version: packageJson.version, files: files.size, packedBytes }, null, 2)}\n`
);

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function spawnNpm(args) {
  const bundled = resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCli = process.env.npm_execpath && existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : bundled;
  if (existsSync(npmCli)) {
    return spawnSync(process.execPath, [npmCli, ...args], {
      cwd: root,
      encoding: "utf8",
      shell: false
    });
  }
  return spawnSync("npm", args, { cwd: root, encoding: "utf8", shell: false });
}
