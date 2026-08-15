import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outFlag = process.argv.indexOf("--out");
const out = resolve(outFlag >= 0 ? requiredArgument(process.argv[outFlag + 1], "--out") : resolve(root, ".release-assets"));
if (out === root) throw new Error("Release assets cannot replace the repository root.");
if (![".release-assets", "cockroach-browser-release-assets"].includes(basename(out))) {
  throw new Error("Release asset output must end in .release-assets or cockroach-browser-release-assets.");
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const capabilitySource = await readFile(resolve(root, "src/capabilities.ts"), "utf8");
const contractSource = await readFile(resolve(root, "src/contracts.ts"), "utf8");
const apiSurface = JSON.parse(await readFile(resolve(root, "docs/compatibility/browser-api-surface.json"), "utf8"));
const playwrightPackage = apiSurface.packages.find((entry) => entry.package === "playwright-core");
const puppeteerPackage = apiSurface.packages.find((entry) => entry.package === "puppeteer-core");
if (!playwrightPackage || !puppeteerPackage) throw new Error("The API inventory must contain Playwright Core and Puppeteer Core.");
const capabilityPattern = /^\s*\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"(available|adapter|planned)",\s*"([^"]+)"\],?$/gm;
const capabilities = [...capabilitySource.matchAll(capabilityPattern)].map((match) => ({
  id: match[1],
  group: match[2],
  title: match[3],
  summary: match[4],
  status: match[5],
  surface: match[6]
}));
const actionBlock = contractSource.match(/export const ACTION_KINDS = \[([\s\S]*?)\] as const;/);
if (!actionBlock) throw new Error("Could not parse ACTION_KINDS.");
const actions = [...actionBlock[1].matchAll(/^\s*"([^"]+)",?$/gm)].map((match) => match[1]);
if (capabilities.length === 0 || actions.length === 0) throw new Error("Release inventory cannot be empty.");

const counts = Object.fromEntries(["available", "adapter", "planned"].map((status) => [
  status,
  capabilities.filter((entry) => entry.status === status).length
]));
const groups = Object.fromEntries([...new Set(capabilities.map((entry) => entry.group))].sort().map((group) => [
  group,
  {
    total: capabilities.filter((entry) => entry.group === group).length,
    available: capabilities.filter((entry) => entry.group === group && entry.status === "available").length,
    adapter: capabilities.filter((entry) => entry.group === group && entry.status === "adapter").length,
    planned: capabilities.filter((entry) => entry.group === group && entry.status === "planned").length
  }
]));
const prefix = `cockroach-browser-${packageJson.version}`;
const isPrerelease = packageJson.version.includes("-");
const capabilityAsset = `${prefix}-capabilities.json`;
const apiAsset = `${prefix}-browser-api-surface.json`;
const sdkAsset = `${prefix}-sdk-inventory.json`;
const notesAsset = `${prefix}-release-notes.md`;

const capabilityInventory = {
  schemaVersion: 1,
  package: packageJson.name,
  version: packageJson.version,
  counts: { total: capabilities.length, ...counts },
  actionCount: actions.length,
  actions,
  groups,
  capabilities
};
const sdkInventory = {
  schemaVersion: 1,
  package: packageJson.name,
  version: packageJson.version,
  native: { language: "TypeScript", surfaces: ["embedded runtime", "authenticated daemon client", "complete pinned Playwright and Puppeteer exports"] },
  daemonClients: [
    { language: "Python", minimum: "3.10", path: "sdks/python" },
    { language: "Java", minimum: "11", path: "sdks/java" },
    { language: ".NET/C#", minimum: "8", path: "sdks/dotnet" },
    { language: "Ruby", minimum: "3.1", path: "sdks/ruby" },
    { language: "Go", minimum: "1.22", path: "sdks/go" }
  ],
  boundary: "Non-TypeScript SDKs are authenticated daemon clients, not reimplementations of every upstream browser object."
};
const releaseNotes = `# Cockroach Browser ${packageJson.version}

${isPrerelease
    ? "This release candidate expands Cockroach Browser into a multi-engine browser automation platform while preserving the existing bounded runtime, evidence chain, MCP, daemon, dashboard, and integrations."
    : "This stable patch preserves the multi-engine browser automation platform while ensuring generated language-SDK build and cache outputs cannot enter the immutable npm artifact."}

## Included

- Chromium, Firefox, and WebKit in headless and headed bounded-runtime tests
- complete pinned Playwright Core ${playwrightPackage.version} and Puppeteer Core ${puppeteerPackage.version} exports
- Playwright Test and cross-language code generation
- raw CDP, WebDriver BiDi, and W3C WebDriver/Appium transports
- handles, targets, workers, events, locators, assertions, request/response rewriting, WebSocket routing, HAR replay, coverage, heap snapshots, tracing, screencasting, profiling, and full upstream emulation contracts
- optional OpenAI-compatible model gateway and finite-step browser agent
- local three-engine fleet and authenticated managed-fleet adapter
- explicit datacenter, residential, static-IP, and custom proxy request contracts; provider-authorized challenge mode; validated HTTPS live-view leases
- TypeScript plus Python, Java, .NET/C#, Ruby, and Go access paths
- ${capabilities.length} source-derived capabilities: ${counts.available} available, ${counts.adapter} adapter-backed, ${counts.planned} planned

## External-service boundary

Cockroach Browser does not operate a hosted browser cloud, residential proxy network, static-IP inventory, CAPTCHA-solving service, macOS Safari host, mobile device lab, or hosted live viewer. Those capabilities require an explicit operator-selected provider. The project does not include covert stealth or access-control bypass.

## Evidence boundary

The generated declaration inventory counts API contracts, not independent product features. Cross-engine and Puppeteer execution are proven separately by installed-engine integration tests. This ${isPrerelease ? "release candidate" : "stable release"} does not claim universal task success, comparative superiority, or complete native mobile infrastructure.
`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(resolve(out, capabilityAsset), `${JSON.stringify(capabilityInventory, null, 2)}\n`, "utf8");
await writeFile(resolve(out, apiAsset), `${JSON.stringify(apiSurface, null, 2)}\n`, "utf8");
await writeFile(resolve(out, sdkAsset), `${JSON.stringify(sdkInventory, null, 2)}\n`, "utf8");
await writeFile(resolve(out, notesAsset), releaseNotes, "utf8");

const assets = [capabilityAsset, apiAsset, sdkAsset, notesAsset];
const sums = [];
for (const asset of assets) {
  const bytes = await readFile(resolve(out, asset));
  sums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${basename(asset)}`);
}
await writeFile(resolve(out, "SHA256SUMS"), `${sums.join("\n")}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ out, version: packageJson.version, assets: [...assets, "SHA256SUMS"] }, null, 2)}\n`);

function requiredArgument(value, label) {
  if (!value || value.startsWith("--")) throw new Error(`${label} requires a path.`);
  return value;
}
