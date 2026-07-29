import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (await exists(resolve(root, "site", "build.mjs"))) {
  const build = spawnSync(process.execPath, ["site/build.mjs"], { cwd: root, encoding: "utf8", shell: false });
  if (build.status !== 0) throw new Error(`Site build failed:\n${build.stdout}\n${build.stderr}`);
}
const siteRoot = await findSiteRoot();
const files = await walk(siteRoot);
const htmlFiles = files.filter((path) => extname(path) === ".html");
const failures = [];

for (const required of ["index.html", "404.html", "robots.txt", "sitemap.xml", "llms.txt"]) {
  if (!files.includes(resolve(siteRoot, required))) failures.push(`missing ${required}`);
}

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const label = relative(siteRoot, file).replaceAll("\\", "/");
  if (!/<html\b[^>]*\blang=["'][a-z]/i.test(html)) failures.push(`${label}: missing html lang`);
  if (!/<title>[^<]{8,}<\/title>/i.test(html)) failures.push(`${label}: missing descriptive title`);
  if (!/<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']{40,}/i.test(html) &&
      !/<meta\b[^>]*content=["'][^"']{40,}["'][^>]*name=["']description["']/i.test(html)) {
    failures.push(`${label}: missing descriptive meta description`);
  }
  if (!/<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/cockroachbrowser\.com/i.test(html) &&
      !/<link\b[^>]*href=["']https:\/\/cockroachbrowser\.com[^>]*rel=["']canonical["']/i.test(html)) {
    failures.push(`${label}: missing cockroachbrowser.com canonical`);
  }
  if (/replace[-_ ]me|lorem ipsum|todo:/i.test(html)) {
    failures.push(`${label}: contains placeholder copy`);
  }
  for (const reference of references(html)) {
    const target = internalTarget(siteRoot, file, reference);
    if (target && !(await exists(target))) failures.push(`${label}: broken internal reference ${reference}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Site verification failed:\n- ${failures.join("\n- ")}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, root: relative(root, siteRoot), pages: htmlFiles.length }, null, 2)}\n`);

async function findSiteRoot() {
  for (const candidate of ["website/dist", "website", "site/dist", "site"]) {
    const path = resolve(root, candidate);
    if (await exists(resolve(path, "index.html"))) return path;
  }
  throw new Error("Static site not found. Expected website/index.html, website/dist/index.html, site/index.html, or site/dist/index.html.");
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(resolve(path));
  }
  return output;
}

function references(html) {
  return [
    ...html.matchAll(/\b(?:href|src)=["']([^"'#?]+)(?:[?#][^"']*)?["']/gi)
  ].map((match) => match[1]);
}

function internalTarget(siteRoot, sourceFile, href) {
  if (!href || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(href)) return undefined;
  const path = href.startsWith("/")
    ? resolve(siteRoot, `.${href}`)
    : resolve(dirname(sourceFile), href);
  if (extname(path)) return path;
  return resolve(path, "index.html");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
