import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";

const siteRoot = resolve(import.meta.dirname);
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const consoleErrors = [];
const screenshots = [];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let target = resolve(siteRoot, `.${decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(siteRoot)) throw new Error("Path outside site");
    if ((await stat(target)).isDirectory()) target = resolve(target, "index.html");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": contentType(target) });
    response.end(body);
  } catch {
    const fallback = await readFile(resolve(siteRoot, "404.html"));
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end(fallback);
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Static server did not expose a port");
const origin = `http://127.0.0.1:${address.port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watchConsole(desktop);
  for (const [path, name] of [
    ["/", "home"],
    ["/alternatives/", "alternatives"],
    ["/ecosystem/", "ecosystem"],
    ["/docs/capabilities/", "capabilities"],
    ["/docs/getting-started/", "getting-started"]
  ]) {
    await inspect(desktop, path);
    const screenshot = resolve(tmpdir(), `cockroach-browser-${name}.png`);
    await desktop.screenshot({ path: screenshot, fullPage: true });
    screenshots.push(screenshot);
  }
  await desktop.goto(`${origin}/alternatives/`, { waitUntil: "networkidle" });
  await desktop.locator("[data-alt-search]").fill("recovery loops");
  const visibleAlternatives = await desktop.locator("[data-alternative]:visible").count();
  const countLabel = await desktop.locator("[data-alt-count]").textContent();
  if (visibleAlternatives !== 1 || countLabel?.trim() !== "1 alternative shown") {
    throw new Error(`Alternative search returned ${visibleAlternatives} rows with label ${countLabel}`);
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watchConsole(mobile);
  await inspect(mobile, "/docs/getting-started/", { expectNoHorizontalOverflow: true });
  const mobileScreenshot = resolve(tmpdir(), "cockroach-browser-mobile.png");
  await mobile.screenshot({ path: mobileScreenshot, fullPage: true });
  screenshots.push(mobileScreenshot);
  await inspect(mobile, "/alternatives/", { expectNoHorizontalOverflow: true });
  const mobileAlternativesScreenshot = resolve(tmpdir(), "cockroach-browser-alternatives-mobile.png");
  await mobile.screenshot({ path: mobileAlternativesScreenshot, fullPage: true });
  screenshots.push(mobileAlternativesScreenshot);
  await inspect(mobile, "/ecosystem/", { expectNoHorizontalOverflow: true });
  const mobileEcosystemScreenshot = resolve(tmpdir(), "cockroach-browser-ecosystem-mobile.png");
  await mobile.screenshot({ path: mobileEcosystemScreenshot, fullPage: true });
  screenshots.push(mobileEcosystemScreenshot);
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

if (consoleErrors.length) {
  throw new Error(`Browser console errors:\n${consoleErrors.map((message) => `- ${message}`).join("\n")}`);
}

process.stdout.write(`Browser smoke test passed for 8 viewports and the alternatives search.\n${screenshots.map((file) => `- ${file}`).join("\n")}\n`);

async function inspect(page, path, { expectNoHorizontalOverflow = false } = {}) {
  const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`${path} returned ${response?.status()}`);
  const state = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector("h1")?.textContent?.trim(),
    imageFailures: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowSources: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((name) => `.${name}`).join("")}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      })
      .filter(({ left, right }) => left < -1 || right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
  }));
  if (!state.title || !state.h1) throw new Error(`${path} is missing a title or h1`);
  if (state.imageFailures) throw new Error(`${path} contains ${state.imageFailures} failed images`);
  if (expectNoHorizontalOverflow && state.overflow > 1) {
    throw new Error(`${path} overflows the mobile viewport by ${state.overflow}px: ${JSON.stringify(state.overflowSources)}`);
  }
}

function watchConsole(page) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
}

function contentType(path) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8"
  })[extname(path)] ?? "application/octet-stream";
}
