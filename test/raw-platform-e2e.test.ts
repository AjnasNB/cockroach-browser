import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import puppeteer from "../src/puppeteer.js";
import { RAW_BROWSER_ENGINES, chromium, rawBrowserType } from "../src/raw-automation.js";
import { expect } from "../src/test.js";

test(
  "raw Playwright platform executes handles, events, assertions, network mutation, WebSocket routing, HAR replay, tracing, and emulation on all engines",
  { skip: process.env.COCKROACH_BROWSER_FULL_PLATFORM_E2E !== "1", timeout: 180_000 },
  async (t) => {
    let harHits = 0;
    const server = createServer(async (request, response) => {
      if (request.url === "/worker.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end("self.postMessage('worker-ready')");
        return;
      }
      if (request.url === "/har") harHits += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      response.writeHead(200, { "content-type": request.url === "/mutate" ? "application/json" : "text/html; charset=utf-8" });
      if (request.url === "/mutate") {
        response.end(JSON.stringify({ method: request.method, header: request.headers["x-cockroach"], body: Buffer.concat(chunks).toString("utf8") }));
        return;
      }
      response.end("<!doctype html><html><style>#value{color:rgb(1,2,3)}</style><title>Raw platform</title><body><div id=value>ready</div></body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const root = await mkdtemp(join(tmpdir(), "cockroach-browser-raw-platform-"));
    t.after(() => rm(root, { recursive: true, force: true }));

    for (const engine of RAW_BROWSER_ENGINES) {
      const browser = await rawBrowserType(engine).launch({ headless: true });
      try {
        const harPath = join(root, `${engine}.har`);
        const tracePath = join(root, `${engine}.trace.zip`);
        const context = await browser.newContext({
          geolocation: { latitude: 12.9716, longitude: 77.5946 },
          permissions: ["geolocation"],
          recordHar: { path: harPath, content: "embed" }
        });
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        await context.route("**/mutate", async (route) => route.continue({
          method: "POST",
          headers: { ...route.request().headers(), "x-cockroach": engine },
          postData: `changed-${engine}`
        }));
        await context.route("**/rewrite", async (route) => route.fulfill({
          status: 203,
          contentType: "text/plain",
          body: `rewritten-${engine}`
        }));
        await context.routeWebSocket("**/ws", (socket) => {
          socket.onMessage((message) => socket.send(`echo:${String(message)}`));
        });
        const page = await context.newPage();
        await page.clock.install({ time: new Date("2026-08-10T12:00:00.000Z") });
        const consoleMessages: string[] = [];
        page.on("console", (message) => consoleMessages.push(message.text()));
        await page.goto(origin);
        await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
        consoleMessages.length = 0;
        await page.evaluate(() => console.log("event-ready"));
        assert.deepEqual(consoleMessages, ["event-ready"]);

        const handle = await page.evaluateHandle(() => document.querySelector("#value"));
        const element = handle.asElement();
        assert(element);
        assert.equal(await element.textContent(), "ready");
        await expect(page.locator("#value")).toHaveText("ready");
        await handle.dispose();

        const workerPromise = page.waitForEvent("worker");
        await page.evaluate(() => { new Worker("/worker.js"); });
        const worker = await workerPromise;
        assert.match(worker.url(), /worker\.js$/);

        const mutation = await page.evaluate(async () => {
          const response = await fetch("/mutate");
          return response.json();
        }) as { method: string; header: string; body: string };
        assert.deepEqual(mutation, { method: "POST", header: engine, body: `changed-${engine}` });
        const rewrite = await page.evaluate(async () => {
          const response = await fetch("/rewrite");
          return { status: response.status, text: await response.text() };
        });
        assert.deepEqual(rewrite, { status: 203, text: `rewritten-${engine}` });
        const websocket = await page.evaluate(() => new Promise<string>((resolve, reject) => {
          const socket = new WebSocket(`ws://${location.host}/ws`);
          socket.onopen = () => socket.send("ping");
          socket.onmessage = (event) => { resolve(String(event.data)); socket.close(); };
          socket.onerror = () => reject(new Error("mock websocket failed"));
        }));
        assert.equal(websocket, "echo:ping");

        await page.goto(`${origin}/har`);
        const geolocation = await page.evaluate(() => new Promise<GeolocationCoordinates>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition((position) => resolve(position.coords), reject);
        }));
        assert.equal(Math.round(geolocation.latitude * 10_000), 129_716);
        const emulatedTime = Date.parse(await page.evaluate(() => new Date().toISOString()));
        assert(emulatedTime >= Date.parse("2026-08-10T12:00:00.000Z"));
        assert(emulatedTime < Date.parse("2026-08-10T12:01:00.000Z"));
        await context.tracing.stop({ path: tracePath });
        await context.close();
        assert((await stat(tracePath)).size > 0);
        assert((await stat(harPath)).size > 0);
        assert.match(await readFile(harPath, "utf8"), /\/har/);

        const beforeReplay = harHits;
        const replayContext = await browser.newContext();
        await replayContext.routeFromHAR(harPath, { notFound: "abort" });
        const replayPage = await replayContext.newPage();
        await replayPage.goto(`${origin}/har`);
        assert.equal(await replayPage.title(), "Raw platform");
        assert.equal(harHits, beforeReplay);
        await replayContext.close();
      } finally {
        await browser.close();
      }
    }
  }
);

test(
  "raw Puppeteer platform executes handles, workers, targets, coverage, CPU emulation, heap snapshots, metrics, and screencasting",
  { skip: process.env.COCKROACH_BROWSER_FULL_PLATFORM_E2E !== "1", timeout: 180_000 },
  async (t) => {
    const server = createServer((request, response) => {
      if (request.url === "/style.css") {
        response.writeHead(200, { "content-type": "text/css" });
        response.end("#value{color:red}");
        return;
      }
      if (request.url === "/script.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end("globalThis.covered=1");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><link rel=stylesheet href=/style.css><div id=value>ready</div><script src=/script.js></script>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const launchArgs = process.env.COCKROACH_BROWSER_PUPPETEER_NO_SANDBOX === "1"
      ? ["--no-sandbox", "--disable-setuid-sandbox"]
      : [];
    const browser = await puppeteer.launch({
      executablePath: process.env.COCKROACH_BROWSER_CHROMIUM_EXECUTABLE ?? chromium.executablePath(),
      headless: true,
      args: launchArgs
    });
    try {
      const page = await browser.newPage();
      await Promise.all([page.coverage.startJSCoverage({ reportAnonymousScripts: true }), page.coverage.startCSSCoverage()]);
      await page.goto(origin);
      const handle = await page.evaluateHandle(() => document.querySelector("#value"));
      const element = handle.asElement();
      assert(element);
      assert.equal(await element.evaluate((node) => node.textContent), "ready");
      await handle.dispose();

      const workerPromise = new Promise<unknown>((resolve) => page.once("workercreated", resolve));
      await page.evaluate(() => { new Worker(URL.createObjectURL(new Blob(["self.postMessage('ok')"], { type: "text/javascript" }))); });
      assert(await workerPromise);
      const target = await browser.waitForTarget((candidate) => candidate.type() === "page" && candidate.url() === `${origin}/`);
      assert.equal(target.type(), "page");

      await page.emulateCPUThrottling(2);
      await page.emulateCPUThrottling(null);
      const [jsCoverage, cssCoverage] = await Promise.all([page.coverage.stopJSCoverage(), page.coverage.stopCSSCoverage()]);
      assert(jsCoverage.length > 0);
      assert(cssCoverage.length > 0);

      const cdp = await page.createCDPSession();
      await cdp.send("Performance.enable");
      const metrics = await cdp.send("Performance.getMetrics");
      assert(Array.isArray(metrics.metrics) && metrics.metrics.length > 0);
      let heapChunks = 0;
      cdp.on("HeapProfiler.addHeapSnapshotChunk", () => { heapChunks += 1; });
      await cdp.send("HeapProfiler.enable");
      await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      assert(heapChunks > 0);
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 30, everyNthFrame: 1 });
      await page.evaluate(() => { document.body.setAttribute("data-frame", "one"); });
      await cdp.send("Page.stopScreencast");
      await cdp.detach();
    } finally {
      await browser.close();
    }
  }
);
