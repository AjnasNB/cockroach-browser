import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import {
  alternatives,
  browserCrawlerDecisions,
  browserUseCases,
  capabilityGaps,
  comparison,
  comparisonLayers,
  ecosystem,
  pages
} from "./content.mjs";

const siteRoot = resolve(import.meta.dirname);
const sourceRoot = resolve(siteRoot, "..");
const failures = [];

const htmlFiles = (await walk(siteRoot)).filter((file) => extname(file) === ".html");
const publicTextFiles = (await Promise.all([
  walk(siteRoot),
  walk(resolve(sourceRoot, "docs")),
  walk(resolve(sourceRoot, "dashboard"))
])).flat().filter((file) => /\.(?:html|css|js|mjs|md|txt|xml|svg)$/i.test(file));

for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  if (!/<meta name="description" content="[^"]+">/.test(source)) {
    failures.push(`${display(file)} is missing a meta description`);
  }
  if (!/<link rel="canonical" href="https:\/\/cockroachbrowser\.com\/[^"]*">/.test(source)) {
    failures.push(`${display(file)} is missing a canonical URL`);
  }
  if (!/<script type="application\/ld\+json">[^<]+<\/script>/.test(source)) {
    failures.push(`${display(file)} is missing JSON-LD`);
  }
  if (!/<link rel="alternate" hreflang="en" href="https:\/\/cockroachbrowser\.com\/[^"]*">/.test(source)) {
    failures.push(`${display(file)} is missing English hreflang`);
  }
  for (const match of source.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      failures.push(`${display(file)} contains invalid JSON-LD: ${error.message}`);
    }
  }
  if (source.includes(`\"@type\":\"SoftwareApplication\"`)) {
    failures.push(`${display(file)} exposes SoftwareApplication rich-result markup without a genuine visible review`);
  }
  for (const match of source.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (isExternalOrFragment(target)) continue;
    const diskTarget = resolveInternalTarget(file, target);
    if (!(await exists(diskTarget))) {
      failures.push(`${display(file)} references missing ${target}`);
    }
  }
}

const capabilitySource = await readFile(resolve(sourceRoot, "src/capabilities.ts"), "utf8");
const capabilityPattern = /^\s*\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"(available|adapter|planned)",\s*"([^"]+)"\],?$/gm;
const registry = [...capabilitySource.matchAll(capabilityPattern)];
const capabilityPage = await readFile(resolve(siteRoot, "docs/capabilities/index.html"), "utf8");
const whatIsPage = await readFile(resolve(siteRoot, "what-is-cockroach-browser/index.html"), "utf8");
const featuresPage = await readFile(resolve(siteRoot, "features/index.html"), "utf8");
const contractsSource = await readFile(resolve(sourceRoot, "src/contracts.ts"), "utf8");
const actionBlock = contractsSource.match(/export const ACTION_KINDS = \[([\s\S]*?)\] as const;/);
if (!actionBlock) failures.push("src/contracts.ts is missing a parseable ACTION_KINDS block");
const actionKinds = actionBlock
  ? [...actionBlock[1].matchAll(/^\s*"([^"]+)",?$/gm)].map((match) => match[1])
  : [];
if (!actionKinds.length || new Set(actionKinds).size !== actionKinds.length) {
  failures.push("ACTION_KINDS must be a non-empty unique list");
}
const renderedActionKinds = [...featuresPage.matchAll(/\bdata-action-kind\b/g)].length;
if (renderedActionKinds !== actionKinds.length) {
  failures.push(`features page renders ${renderedActionKinds} action kinds but source contains ${actionKinds.length}`);
}
if (!featuresPage.includes(`data-action-count="${actionKinds.length}"`)) {
  failures.push("features page action count is not derived from source");
}
const gettingStartedDefinition = pages.find((page) => page.slug === "getting-started");
const gettingStartedHtml = await readFile(resolve(siteRoot, "docs/getting-started/index.html"), "utf8");
const gettingStartedMarkdown = await readFile(resolve(sourceRoot, "docs/getting-started.md"), "utf8");
const gettingStartedSchemas = [...gettingStartedHtml.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)]
  .flatMap((match) => JSON.parse(match[1])["@graph"] ?? []);
const gettingStartedHowTo = gettingStartedSchemas.find((entry) => entry["@type"] === "HowTo");
const expectedHowToSteps = gettingStartedDefinition.sections.map((section, index) => ({
  "@type": "HowToStep",
  position: index + 1,
  name: section.title,
  text: markdownSectionText(gettingStartedMarkdown, section.title)
}));
if (!gettingStartedHowTo || JSON.stringify(gettingStartedHowTo.step) !== JSON.stringify(expectedHowToSteps)) {
  failures.push("getting-started HowTo steps must be derived from visible manual sections");
}
for (const section of gettingStartedDefinition.sections) {
  if (!gettingStartedHtml.includes(`<h2>${section.title}</h2>`) || !gettingStartedHtml.includes(section.body)) {
    failures.push(`getting-started HowTo source section is not visible: ${section.title}`);
  }
}
for (const kind of actionKinds) {
  if (!featuresPage.includes(`>${kind}</code>`)) failures.push(`features page is missing source action ${kind}`);
}
const readme = await readFile(resolve(sourceRoot, "README.md"), "utf8");
if (!readme.includes(`## ${registry.length} source-registered capabilities`)) {
  failures.push("README capability heading is not derived from the registry count");
}
if (!readme.includes(`The typed runtime implements ${actionKinds.length} action kinds:`)) {
  failures.push("README action heading is not derived from ACTION_KINDS");
}
const readmeStatusCounts = Object.fromEntries(["available", "adapter", "planned"].map((status) => [
  status,
  registry.filter((entry) => entry[5] === status).length
]));
if (!readme.includes(`| **Total** | **${readmeStatusCounts.available}** | **${readmeStatusCounts.adapter}** | **${readmeStatusCounts.planned}** | **${registry.length}** |`)) {
  failures.push("README capability total row does not match the source registry");
}
const readmeActionLine = readme.split(/\r?\n/).find((line) => line.startsWith("`navigate`, `back`, `forward`"));
const readmeActionKinds = readmeActionLine ? [...readmeActionLine.matchAll(/`([^`]+)`/g)].map((match) => match[1]) : [];
if (JSON.stringify(readmeActionKinds) !== JSON.stringify(actionKinds)) {
  failures.push("README public action inventory does not exactly match ACTION_KINDS order and count");
}
const renderedCapabilities = [...capabilityPage.matchAll(/\bdata-capability\b/g)].length;
if (renderedCapabilities !== registry.length) {
  failures.push(`capability page renders ${renderedCapabilities} records but registry contains ${registry.length}`);
}
for (const status of ["available", "adapter", "planned"]) {
  const expected = registry.filter((entry) => entry[5] === status).length;
  const rendered = [...capabilityPage.matchAll(new RegExp(`data-status="${status}"`, "g"))].length;
  if (rendered !== expected) {
    failures.push(`${status} capability count is ${rendered}, expected ${expected}`);
  }
}
for (const schemaType of ["CollectionPage", "ItemList", "BreadcrumbList"]) {
  if (!capabilityPage.includes(`\"@type\":\"${schemaType}\"`)) {
    failures.push(`capability page is missing ${schemaType} structured data`);
  }
}
if (!capabilityPage.includes(`\"numberOfItems\":${registry.length}`)) {
  failures.push("capability page structured-data count does not match the registry");
}
for (const requiredDefinition of [
  "A local-first browser execution and evidence runtime for AI agents.",
  "Explicit browser authority",
  "Semantic page references",
  "Real browser interaction",
  "Evidence and receipts",
  "Daemon, SDK, and MCP",
  "What it does not claim."
]) {
  if (!whatIsPage.includes(requiredDefinition)) failures.push(`what-is page is missing ${requiredDefinition}`);
}
for (const schemaType of ["AboutPage", "SoftwareSourceCode", "BreadcrumbList"]) {
  if (!whatIsPage.includes(`\"@type\":\"${schemaType}\"`)) failures.push(`what-is page is missing ${schemaType} structured data`);
}

const primaryRoutes = [
  ["home", "index.html"],
  ["what-is", "what-is-cockroach-browser/index.html"],
  ["features", "features/index.html"],
  ["install", "install/index.html"],
  ["ai-agents", "ai-agents/index.html"],
  ["use-cases", "use-cases/index.html"]
];
const homepageSource = await readFile(resolve(siteRoot, "index.html"), "utf8");
if (homepageSource.includes(`\"@type\":\"FAQPage\"`) || homepageSource.includes('id="answers"')) {
  failures.push("homepage must not contain FAQ UI or FAQPage structured data");
}
for (const required of ["AI browser automation | Cockroach Browser", "Price: $0.", `<span>${actionKinds.length} typed actions</span>`]) {
  if (!homepageSource.includes(required)) failures.push(`homepage is missing ${required}`);
}
for (const [label, route] of primaryRoutes) {
  const source = await readFile(resolve(siteRoot, route), "utf8");
  if (!source.includes("Cockroach Browser")) failures.push(`${label} page does not identify Cockroach Browser`);
  for (const contamination of [
    "trafilatura@",
    "511 observed pages",
    "Core structural",
    "Breadth-first traversal",
    "Depth-first traversal",
    "Crawl and discover"
  ]) {
    if (source.includes(contamination)) failures.push(`${label} page contains Crawler-only copy: ${contamination}`);
  }
}
for (const route of ["features", "install", "ai-agents", "use-cases", "browser-vs-crawler"]) {
  if (!(await exists(resolve(siteRoot, route, "index.html")))) failures.push(`missing top-level product route /${route}/`);
}
for (const group of ["sessions", "interaction", "evidence", "audit", "deployment", "security", "integration"]) {
  if (!featuresPage.includes(`id="${group}"`)) failures.push(`features page is missing visible ${group} group`);
  if (!featuresPage.includes(`\"url\":\"${siteUrl()}/features/#${group}\"`)) {
    failures.push(`features page schema is missing ${group} group`);
  }
}
for (const required of ["Does Cockroach Browser include an LLM?", "MCP", "TypeScript SDK", "does not bundle a model"]) {
  const aiPage = await readFile(resolve(siteRoot, "ai-agents/index.html"), "utf8");
  if (!aiPage.includes(required)) failures.push(`AI-agent page is missing ${required}`);
}
const useCasesPage = await readFile(resolve(siteRoot, "use-cases/index.html"), "utf8");
for (const entry of browserUseCases) {
  if (!useCasesPage.includes(`id="${entry.id}"`) || !useCasesPage.includes(entry.surfaces)) {
    failures.push(`use-cases page is missing ${entry.title}`);
  }
}
const browserCrawlerPage = await readFile(resolve(siteRoot, "browser-vs-crawler/index.html"), "utf8");
for (const entry of browserCrawlerDecisions) {
  if (!browserCrawlerPage.includes(entry.workload) || !browserCrawlerPage.includes(entry.choice)) {
    failures.push(`Browser-vs-Crawler page is missing ${entry.workload}`);
  }
}

const sitemap = await readFile(resolve(siteRoot, "sitemap.xml"), "utf8");
const redirects = await readFile(resolve(siteRoot, "_redirects"), "utf8");
const expectedDirectoryRedirects = htmlFiles
  .map((file) => relative(siteRoot, file).replaceAll("\\", "/"))
  .filter((path) => path.endsWith("/index.html"))
  .map((path) => `/${path.slice(0, -"/index.html".length)}`)
  .map((path) => `${path} ${path}/ 301`)
  .sort();
const renderedDirectoryRedirects = redirects.trim().split(/\r?\n/).filter(Boolean).sort();
if (JSON.stringify(renderedDirectoryRedirects) !== JSON.stringify(expectedDirectoryRedirects)) {
  failures.push("permanent directory redirects must exactly cover every generated directory page");
}
for (const match of sitemap.matchAll(/<loc>https:\/\/cockroachbrowser\.com([^<]*)<\/loc>/g)) {
  const target = match[1] || "/";
  const diskTarget = resolveAbsolutePath(target);
  if (!(await exists(diskTarget))) failures.push(`sitemap references missing ${target}`);
}
for (const route of ["/features/", "/install/", "/ai-agents/", "/use-cases/", "/browser-vs-crawler/"]) {
  if (!sitemap.includes(`<loc>${siteUrl()}${route}</loc>`)) failures.push(`sitemap is missing ${route}`);
}

const alternativesPage = await readFile(resolve(siteRoot, "alternatives", "index.html"), "utf8");
const renderedAlternatives = [...alternativesPage.matchAll(/\bdata-alternative\b/g)].length;
if (renderedAlternatives !== alternatives.length) {
  failures.push(`alternatives page renders ${renderedAlternatives} records but source data contains ${alternatives.length}`);
}
for (const entry of alternatives) {
  if (!alternativesPage.includes(`id="${entry.id}"`)) {
    failures.push(`alternatives page is missing ${entry.name} row`);
  }
  if (!alternativesPage.includes(`href="${entry.source}"`)) {
    failures.push(`alternatives page is missing the official ${entry.name} source`);
  }
}
if (!alternativesPage.includes("No shared benchmark. No universal winner.")) {
  failures.push("alternatives page is missing the no-shared-benchmark boundary");
}
if (!alternativesPage.includes(`checked ${comparison.checkedOn}`)) {
  failures.push("alternatives page is missing its evidence review date");
}
for (const schemaType of ["ItemList", "FAQPage", "BreadcrumbList"]) {
  if (!alternativesPage.includes(`\"@type\":\"${schemaType}\"`)) {
    failures.push(`alternatives page is missing ${schemaType} structured data`);
  }
}
if (!alternativesPage.includes("data-alt-search")) {
  failures.push("alternatives page is missing its local comparison search");
}
const renderedLayers = [...alternativesPage.matchAll(/\bdata-comparison-layer\b/g)].length;
if (renderedLayers !== comparisonLayers.length) {
  failures.push(`alternatives page renders ${renderedLayers} comparison layers but source data contains ${comparisonLayers.length}`);
}
for (const entry of comparisonLayers) {
  if (!alternativesPage.includes(`id="layer-${entry.id}"`)) failures.push(`alternatives page is missing ${entry.label}`);
  for (const [label, source] of entry.sources) {
    if (!alternativesPage.includes(`href="${source}"`) || !alternativesPage.includes(label)) {
      failures.push(`alternatives page is missing official layer source ${label}`);
    }
  }
}
const renderedGaps = [...alternativesPage.matchAll(/\bdata-capability-gap\b/g)].length;
if (renderedGaps !== capabilityGaps.length) {
  failures.push(`alternatives page renders ${renderedGaps} gap rows but source data contains ${capabilityGaps.length}`);
}
for (const entry of capabilityGaps) {
  if (!alternativesPage.includes(entry.gap) || !alternativesPage.includes(`href="${entry.source}"`)) {
    failures.push(`alternatives page is missing sourced current gap ${entry.area}`);
  }
}

const ecosystemPage = await readFile(resolve(siteRoot, "ecosystem", "index.html"), "utf8");
const renderedEcosystemProjects = [...ecosystemPage.matchAll(/\bdata-ecosystem-project\b/g)].length;
if (renderedEcosystemProjects !== ecosystem.projects.length) {
  failures.push(
    `ecosystem page renders ${renderedEcosystemProjects} project records but source data contains ${ecosystem.projects.length}`
  );
}
for (const entry of ecosystem.projects) {
  if (!ecosystemPage.includes(`id="${entry.id}"`)) {
    failures.push(`ecosystem page is missing the canonical ${entry.name} anchor`);
  }
  if (!ecosystemPage.includes(`href="${entry.source}"`)) {
    failures.push(`ecosystem page is missing the official ${entry.name} source`);
  }
}
if (!ecosystemPage.includes('<link rel="canonical" href="https://cockroachbrowser.com/ecosystem/">')) {
  failures.push("ecosystem page is missing its canonical URL");
}
if (!ecosystemPage.includes('<meta name="robots" content="noindex,follow">')) {
  failures.push("legacy ecosystem page must remain noindex until it is Browser-centered");
}
if (!ecosystemPage.includes("No shared benchmark. No universal winner.")) {
  failures.push("ecosystem page is missing the no-shared-benchmark boundary");
}
if (!ecosystemPage.includes("By Ajnas N B")) {
  failures.push("ecosystem page is missing its visible author byline");
}
if (!ecosystemPage.includes("Cockroach Browser uses playwright-core")) {
  failures.push("ecosystem page is missing the Playwright dependency disclosure");
}
if (!ecosystemPage.includes("exact trafilatura@0.2.0")) {
  failures.push("ecosystem page is missing the exact Trafilatura backend disclosure");
}
if (!ecosystemPage.includes(`Reviewed ${ecosystem.checkedOn}`)) {
  failures.push("ecosystem page is missing its evidence review date");
}
for (const schemaType of ["Article", "ItemList", "FAQPage", "BreadcrumbList"]) {
  if (!ecosystemPage.includes(`\"@type\":\"${schemaType}\"`)) {
    failures.push(`ecosystem page is missing ${schemaType} structured data`);
  }
}
for (const [question] of ecosystem.questions) {
  if (!ecosystemPage.includes(`<h3>${question}</h3>`)) {
    failures.push(`ecosystem page is missing visible FAQ question: ${question}`);
  }
}
if (sitemap.includes(`<loc>${ecosystemUrl()}</loc>`)) {
  failures.push("noindex ecosystem page must not appear in the sitemap");
}

let searchIndex;
try {
  searchIndex = JSON.parse(await readFile(resolve(siteRoot, "search.json"), "utf8"));
} catch (error) {
  failures.push(`search.json is invalid: ${error.message}`);
}
if (searchIndex) {
  if (!Array.isArray(searchIndex.documents)) failures.push("search.json is missing its documents array");
  else {
    const comparisonDocument = searchIndex.documents.find((entry) => entry.url === `${comparisonUrl()}`);
    if (!comparisonDocument) failures.push("search.json is missing the alternatives page");
    for (const entry of alternatives) {
      const url = `${comparisonUrl()}#${entry.id}`;
      if (!searchIndex.documents.some((document) => document.url === url)) {
        failures.push(`search.json is missing ${entry.name}`);
      }
    }
    if (searchIndex.documents.some((entry) => entry.url === ecosystemUrl())) {
      failures.push("noindex ecosystem page must not appear in search.json");
    }
    if (!searchIndex.documents.some((entry) => entry.url === `${siteUrl()}/what-is-cockroach-browser/`)) {
      failures.push("search.json is missing the product-definition page");
    }
    for (const route of ["features/", "install/", "ai-agents/", "use-cases/", "browser-vs-crawler/"]) {
      if (!searchIndex.documents.some((entry) => entry.url === `${siteUrl()}/${route}`)) {
        failures.push(`search.json is missing ${route}`);
      }
    }
    if (searchIndex.documents.some((entry) => entry.kind === "ecosystem-project")) {
      failures.push("search.json should keep the Browser index focused instead of expanding every ecosystem project");
    }
  }
}

const llms = await readFile(resolve(siteRoot, "llms.txt"), "utf8");
if (!llms.includes(`${siteUrl()}/alternatives/`)) {
  failures.push("llms.txt is missing the alternatives page");
}
for (const route of ["what-is-cockroach-browser/", "features/", "install/", "ai-agents/", "use-cases/", "browser-vs-crawler/", "docs/capabilities/", "docs/getting-started/", "docs/"]) {
  if (!llms.includes(`${siteUrl()}/${route}`)) failures.push(`llms.txt is missing ${route}`);
}
for (const required of ["does not bundle an LLM", `${actionKinds.length} typed browser actions`, "Chromium-family sessions only", "separate optional integrations"]) {
  if (!llms.includes(required)) failures.push(`llms.txt is missing Browser fact: ${required}`);
}
for (const contamination of ["trafilatura@", "511 observed pages", "Core structural"]) {
  if (llms.includes(contamination)) failures.push(`llms.txt contains non-Browser search contamination: ${contamination}`);
}

const llmsFull = await readFile(resolve(siteRoot, "llms-full.txt"), "utf8");
for (const required of ["## What Cockroach Browser is", "## AI-agent integration", `## ${actionKinds.length} typed browser actions`, "## Browser automation use cases", "## Current Cockroach Browser gaps", `## Complete ${registry.length}-capability matrix`]) {
  if (!llmsFull.includes(required)) failures.push(`llms-full.txt is missing ${required}`);
}
for (const kind of actionKinds) {
  if (!llmsFull.includes(`- ${kind}\n`)) failures.push(`llms-full.txt is missing action ${kind}`);
}
for (const contamination of ["trafilatura@", "511 observed pages", "Core structural"]) {
  if (llmsFull.includes(contamination)) failures.push(`llms-full.txt contains non-Browser search contamination: ${contamination}`);
}

for (const required of [
  "robots.txt",
  "sitemap.xml",
  "search.json",
  "llms.txt",
  "llms-full.txt",
  "_headers",
  "_redirects",
  "assets/logo.png"
]) {
  if (!(await exists(resolve(siteRoot, required)))) failures.push(`missing required public artifact ${required}`);
}

const robots = await readFile(resolve(siteRoot, "robots.txt"), "utf8");
for (const agent of ["OAI-SearchBot", "Claude-SearchBot", "Claude-User", "PerplexityBot"]) {
  if (!robots.includes(`User-agent: ${agent}\nAllow: /`)) failures.push(`robots.txt does not allow ${agent}`);
}
for (const agent of ["GPTBot", "ClaudeBot", "Google-Extended"]) {
  if (!robots.includes(`User-agent: ${agent}\nDisallow: /`)) failures.push(`robots.txt does not disallow training crawler ${agent}`);
}

const worker = (await import("./worker.mjs")).default;
const assetRequests = [];
const workerEnv = {
  ASSETS: {
    async fetch(request) {
      assetRequests.push(request.url);
      return new Response("asset", { status: 200 });
    }
  }
};
for (const [input, expected] of [
  ["http://cockroachbrowser.com/?source=http", "https://cockroachbrowser.com/?source=http"],
  ["http://www.cockroachbrowser.com/?source=http-www", "https://cockroachbrowser.com/?source=http-www"],
  ["https://www.cockroachbrowser.com/?source=www", "https://cockroachbrowser.com/?source=www"],
  ["http://cockroachbrowser.com/docs?q=browser", "https://cockroachbrowser.com/docs/?q=browser"],
  ["https://www.cockroachbrowser.com/ai-agents?source=www", "https://cockroachbrowser.com/ai-agents/?source=www"],
  ["http://www.cockroachbrowser.com/features?view=all", "https://cockroachbrowser.com/features/?view=all"],
  ["https://cockroachbrowser.com/index.html?source=legacy", "https://cockroachbrowser.com/?source=legacy"],
  ["https://www.cockroachbrowser.com/index.html?source=legacy-www", "https://cockroachbrowser.com/?source=legacy-www"],
  ["https://cockroachbrowser.com/features/index.html?view=all", "https://cockroachbrowser.com/features/?view=all"],
  ["http://cockroachbrowser.com/features/index.html?view=http", "https://cockroachbrowser.com/features/?view=http"],
  ["http://www.cockroachbrowser.com/features/index.html?view=all", "https://cockroachbrowser.com/features/?view=all"],
  ["http://cockroachbrowser.com/assets/styles.css?v=http", "https://cockroachbrowser.com/assets/styles.css?v=http"],
  ["https://www.cockroachbrowser.com/assets/styles.css?v=www", "https://cockroachbrowser.com/assets/styles.css?v=www"],
  ["http://www.cockroachbrowser.com/assets/styles.css?v=http-www", "https://cockroachbrowser.com/assets/styles.css?v=http-www"]
]) {
  const response = await worker.fetch(new Request(input), workerEnv);
  if (response.status !== 308 || response.headers.get("location") !== expected) {
    failures.push(`worker canonical redirect failed for ${input}`);
  }
}
for (const input of [
  "https://cockroachbrowser.com/?q=root",
  "https://cockroachbrowser.com/use-cases/?q=state",
  "https://cockroachbrowser.com/assets/styles.css?v=canonical"
]) {
  const canonicalResponse = await worker.fetch(new Request(input), workerEnv);
  if (canonicalResponse.status !== 200 || assetRequests.at(-1) !== input) {
    failures.push(`worker did not pass canonical asset request ${input}`);
  }
}

const wranglerConfig = JSON.parse(await readFile(resolve(sourceRoot, "wrangler.jsonc"), "utf8"));
const assetsIgnore = await readFile(resolve(siteRoot, ".assetsignore"), "utf8");
if (!assetsIgnore.split(/\r?\n/).includes("worker.mjs")) {
  failures.push("Worker entrypoint must be excluded from the public static-asset manifest");
}
if (wranglerConfig.main !== "./site/worker.mjs") failures.push("wrangler main does not point to the canonical redirect worker");
if (wranglerConfig.compatibility_date !== "2026-08-08") {
  failures.push("wrangler compatibility_date must remain within Wrangler 4.120.0 workerd support");
}
if (wranglerConfig.workers_dev !== false) failures.push("wrangler workers_dev must remain disabled for one canonical production host");
if (wranglerConfig.assets?.binding !== "ASSETS" || wranglerConfig.assets?.run_worker_first !== true) {
  failures.push("wrangler assets are not configured to run the canonical worker first");
}
for (const pattern of ["cockroachbrowser.com/*", "www.cockroachbrowser.com/*"]) {
  if (!wranglerConfig.routes?.some((route) => route.pattern === pattern && route.zone_name === "cockroachbrowser.com")) {
    failures.push(`wrangler config is missing production zone route ${pattern}`);
  }
}

for (const file of publicTextFiles) {
  const source = await readFile(file, "utf8");
  if (source.includes("\u2014") || source.includes("\u2013")) {
    failures.push(`${display(file)} contains an en or em dash`);
  }
  if (extname(file) === ".css" && /\b(?:linear|radial|conic)-gradient\s*\(/i.test(source)) {
    failures.push(`${display(file)} contains a CSS gradient`);
  }
}

if (failures.length) {
  process.stderr.write(`Website validation failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  const counts = Object.fromEntries(["available", "adapter", "planned"].map((status) => [
    status,
    registry.filter((entry) => entry[5] === status).length
  ]));
  process.stdout.write(
    `Validated ${htmlFiles.length} HTML pages, ${registry.length} capabilities ` +
    `(${counts.available} available, ${counts.adapter} adapter, ${counts.planned} planned), internal links, SEO files, and public copy.\n`
  );
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = resolve(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
}

function isExternalOrFragment(target) {
  return (
    target.startsWith("#") ||
    target.startsWith("data:") ||
    target.startsWith("mailto:") ||
    target.startsWith("tel:") ||
    /^https?:\/\//i.test(target)
  );
}

function resolveInternalTarget(fromFile, rawTarget) {
  const target = rawTarget.split(/[?#]/, 1)[0];
  if (target.startsWith("/")) return resolveAbsolutePath(target);
  const base = resolve(dirname(fromFile), target);
  return target.endsWith("/") ? resolve(base, "index.html") : base;
}

function resolveAbsolutePath(target) {
  const clean = target.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  if (!clean) return resolve(siteRoot, "index.html");
  if (target.endsWith("/")) return resolve(siteRoot, clean, "index.html");
  return resolve(siteRoot, clean);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function markdownSectionText(markdown, title) {
  const marker = `## ${title}\n\n`;
  const start = markdown.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const codeStart = markdown.indexOf("\n```", bodyStart);
  const nextSection = markdown.indexOf("\n## ", bodyStart);
  const boundaries = [codeStart, nextSection].filter((position) => position >= 0);
  const end = boundaries.length ? Math.min(...boundaries) : markdown.length;
  return markdown.slice(bodyStart, end).replace(/\s+/g, " ").trim();
}

function display(file) {
  return relative(sourceRoot, file).replaceAll("\\", "/");
}

function siteUrl() {
  return "https://cockroachbrowser.com";
}

function comparisonUrl() {
  return `${siteUrl()}/alternatives/`;
}

function ecosystemUrl() {
  return `${siteUrl()}/ecosystem/`;
}
