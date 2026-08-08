import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { alternatives, comparison } from "./content.mjs";

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

const sitemap = await readFile(resolve(siteRoot, "sitemap.xml"), "utf8");
for (const match of sitemap.matchAll(/<loc>https:\/\/cockroachbrowser\.com([^<]*)<\/loc>/g)) {
  const target = match[1] || "/";
  const diskTarget = resolveAbsolutePath(target);
  if (!(await exists(diskTarget))) failures.push(`sitemap references missing ${target}`);
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
  }
}

const llms = await readFile(resolve(siteRoot, "llms.txt"), "utf8");
if (!llms.includes(`${siteUrl()}/alternatives/`)) {
  failures.push("llms.txt is missing the alternatives page");
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

const hiddenUpstreamName = `${"pinch"}${"tab"}`;
for (const file of publicTextFiles) {
  const source = await readFile(file, "utf8");
  if (source.includes("\u2014") || source.includes("\u2013")) {
    failures.push(`${display(file)} contains an en or em dash`);
  }
  if (source.toLowerCase().includes(hiddenUpstreamName)) {
    failures.push(`${display(file)} exposes an upstream project name`);
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

function display(file) {
  return relative(sourceRoot, file).replaceAll("\\", "/");
}

function siteUrl() {
  return "https://cockroachbrowser.com";
}

function comparisonUrl() {
  return `${siteUrl()}/alternatives/`;
}
