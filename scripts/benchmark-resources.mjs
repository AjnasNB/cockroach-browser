import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { cpus, freemem, hostname, platform, release, totalmem } from "node:os";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { BrowserRuntime } from "../dist/runtime.js";

const execute = promisify(execFile);
const args = parseArguments(process.argv.slice(2));
const fixture = await startFixture();
const samples = [];

try {
  for (const engine of args.engines) {
    for (const profile of args.profiles) {
      for (let index = 0; index < args.warmup + args.iterations; index += 1) {
        const measured = index >= args.warmup;
        process.stderr.write(`${measured ? "measure" : "warmup"} ${engine}/${profile} ${index + 1}/${args.warmup + args.iterations}\n`);
        const sample = await benchmarkRun({
          engine,
          profile,
          origin: fixture.origin,
          fixture,
          settleMs: args.settleMs
        });
        if (measured) samples.push(sample);
      }
    }
  }
} finally {
  await fixture.close();
}

const report = {
  schemaVersion: "cockroach.browser-resource-benchmark.v1",
  generatedAt: new Date().toISOString(),
  machine: await machineReport(),
  methodology: {
    warmup: args.warmup,
    iterations: args.iterations,
    engines: args.engines,
    profiles: args.profiles,
    settleMs: args.settleMs,
    memoryDefinition: "Aggregate process-tree RSS; shared pages may be counted in more than one process.",
    enforcement: "Periodic and action-boundary fail-closed telemetry, not an operating-system hard memory boundary.",
    energy: { available: false, reason: "No calibrated platform energy counter is available; CPU time is not reported as watts." }
  },
  summary: summarize(samples),
  samples
};

const output = resolve(args.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, output, summary: report.summary }, null, 2)}\n`);

async function benchmarkRun({ engine, profile, origin, fixture, settleMs }) {
  const root = await mkdtemp(join(tmpdir(), `cockroach-resource-${engine}-${profile}-`));
  const runId = `${engine}-${profile}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fixture.begin(runId);
  const coordinatorBefore = process.memoryUsage();
  const coordinatorCpuBefore = process.cpuUsage();
  const runtime = new BrowserRuntime({ root });
  const phases = {};
  let session;
  let lastResources;
  try {
    session = await timed(phases, "launchMs", () => runtime.createSession({
      engine,
      performanceProfile: profile,
      startUrl: `${origin}/?run=${encodeURIComponent(runId)}`,
      purpose: `Measure ${engine} ${profile} resource use`,
      policy: {
        allowedOrigins: [origin],
        allowPrivateNetwork: true,
        allowedActions: ["snapshot", "fill", "click", "capture.paired", "trace.start", "trace.stop"],
        allowedEffects: ["read", "write"],
        requireApprovalFor: [],
        budget: {
          maxTabs: 2,
          maxProcessRssBytes: 2 * 1024 ** 3,
          maxProcessCpuTimeMs: 60 * 60_000
        }
      }
    }));
    await delay(settleMs);
    const resourceSamples = [session.resources];
    await phase("snapshotMs", () => runtime.act(session.id, { kind: "snapshot", purpose: "Benchmark semantic capture" }));
    await phase("formMs", async () => {
      await runtime.act(session.id, { kind: "fill", selector: "#name", value: "Cockroach", purpose: "Benchmark form input" });
      await runtime.act(session.id, { kind: "click", selector: "#save", purpose: "Benchmark form action" });
    });
    const auditResult = await phase("auditMs", () => runtime.audit(session.id));
    await phase("captureMs", () => runtime.act(session.id, {
      kind: "capture.paired",
      fullPage: false,
      purpose: "Benchmark paired visual and semantic evidence"
    }));
    await phase("traceMs", async () => {
      await runtime.act(session.id, { kind: "trace.start", purpose: "Benchmark tracing" });
      await runtime.act(session.id, { kind: "trace.stop", purpose: "Benchmark tracing" });
    });

    async function phase(name, operation) {
      const value = await timed(phases, name, operation);
      const sampled = await timed(phases, `${name}SamplerMs`, () => runtime.resourceUsage(session.id));
      resourceSamples.push(sampled);
      return value;
    }

    lastResources = resourceSamples.at(-1);
    const storageBeforeCloseBytes = await directoryBytes(root);
    await timed(phases, "shutdownMs", () => runtime.closeSession(session.id));
    const storageAfterCloseBytes = await directoryBytes(root);
    const coordinatorCpu = process.cpuUsage(coordinatorCpuBefore);
    const coordinatorAfter = process.memoryUsage();
    return {
      engine,
      profile,
      phases,
      resources: {
        currentRssBytes: lastResources.rssBytes,
        peakRssBytes: Math.max(...resourceSamples.map((entry) => entry.peakRssBytes ?? 0)),
        cpuTimeMs: lastResources.cpuTimeMs,
        processCount: lastResources.processCount,
        limitState: lastResources.limitState,
        sampleOverheadMs: Object.entries(phases)
          .filter(([name]) => name.endsWith("SamplerMs"))
          .map(([, value]) => value)
      },
      coordinator: {
        rssBeforeBytes: coordinatorBefore.rss,
        rssAfterBytes: coordinatorAfter.rss,
        heapUsedAfterBytes: coordinatorAfter.heapUsed,
        externalAfterBytes: coordinatorAfter.external,
        cpuTimeMs: (coordinatorCpu.user + coordinatorCpu.system) / 1_000
      },
      storage: { beforeCloseBytes: storageBeforeCloseBytes, afterCloseBytes: storageAfterCloseBytes },
      network: {
        ...fixture.finish(runId),
        browserResourceTransferBytes: Number(auditResult.report.performance?.transferBytes ?? 0)
      }
    };
  } finally {
    await runtime.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

async function startFixture() {
  const runs = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const runId = url.searchParams.get("run") ?? "unknown";
    const record = runs.get(runId) ?? { requests: {}, originResponseBytesOffered: 0 };
    runs.set(runId, record);
    const send = (type, contentType, body) => {
      const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
      record.requests[type] = (record.requests[type] ?? 0) + 1;
      record.originResponseBytesOffered += data.byteLength;
      response.writeHead(200, { "content-type": contentType, "content-length": data.byteLength });
      response.end(data);
    };
    if (url.pathname === "/fixture.css") return send("stylesheet", "text/css", "@font-face{font-family:x;src:url('/font.woff2?run=" + runId + "')}body{font-family:x,sans-serif}article{padding:2px}");
    if (url.pathname === "/font.woff2") return send("font", "font/woff2", Buffer.alloc(96 * 1024, 1));
    if (url.pathname === "/image.bin") return send("image", "image/png", Buffer.alloc(256 * 1024, 2));
    if (url.pathname === "/media.bin") return send("media", "video/mp4", Buffer.alloc(256 * 1024, 3));
    if (url.pathname === "/api") return send("fetch", "application/json", JSON.stringify({ ok: true, runId }));
    if (url.pathname === "/frame") return send("document", "text/html", "<!doctype html><body><label>Frame<input aria-label=Frame></label></body>");
    const nodes = Array.from({ length: 250 }, (_, index) => `<article data-index=${index}>Node ${index}</article>`).join("");
    return send("document", "text/html", `<!doctype html><html lang=en><head><title>Resource fixture</title><link rel=stylesheet href="/fixture.css?run=${runId}"></head><body><label>Name<input id=name></label><button id=save onclick="this.dataset.saved='true'">Save</button><img src="/image.bin?run=${runId}"><video preload=metadata src="/media.bin?run=${runId}"></video><iframe src="/frame?run=${runId}"></iframe><section id=shadow></section>${nodes}<script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button>Shadow</button>';fetch('/api?run=${runId}')</script></body></html>`);
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind to TCP.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    begin(runId) { runs.set(runId, { requests: {}, originResponseBytesOffered: 0 }); },
    finish(runId) { return structuredClone(runs.get(runId) ?? { requests: {}, originResponseBytesOffered: 0 }); },
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

function summarize(samples) {
  const groups = {};
  for (const sample of samples) {
    const key = `${sample.engine}/${sample.profile}`;
    (groups[key] ??= []).push(sample);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, {
    iterations: values.length,
    peakRssBytes: distribution(values.map((entry) => entry.resources.peakRssBytes)),
    browserCpuTimeMs: distribution(values.map((entry) => entry.resources.cpuTimeMs)),
    launchMs: distribution(values.map((entry) => entry.phases.launchMs)),
    snapshotMs: distribution(values.map((entry) => entry.phases.snapshotMs)),
    browserResourceTransferBytes: distribution(values.map((entry) => entry.network.browserResourceTransferBytes)),
    originResponseBytesOffered: distribution(values.map((entry) => entry.network.originResponseBytesOffered)),
    storageAfterCloseBytes: distribution(values.map((entry) => entry.storage.afterCloseBytes)),
    samplerOverheadMs: distribution(values.flatMap((entry) => entry.resources.sampleOverheadMs))
  }]));
}

function distribution(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { median: null, p95: null, min: null, max: null };
  return {
    median: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    min: finite[0],
    max: finite.at(-1)
  };
}

function percentile(values, quantile) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)];
}

async function timed(target, name, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    target[name] = Number((performance.now() - started).toFixed(3));
  }
}

async function directoryBytes(root) {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

async function machineReport() {
  const cpu = cpus()[0];
  const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  return {
    hostname: hostname(),
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpu?.model ?? "unknown",
    logicalCores: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtReport: freemem(),
    node: process.version,
    npm: await npmVersion(),
    gitCommit: await commandVersion("git", ["rev-parse", "HEAD"]),
    packageVersion: packageMetadata.version,
    playwrightVersion: await packageVersion("playwright-core")
  };
}

async function packageVersion(name) {
  const value = JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8"));
  return value.version;
}

async function npmVersion() {
  if (process.env.npm_execpath) {
    return commandVersion(process.execPath, [process.env.npm_execpath, "--version"]);
  }
  if (process.platform === "win32") {
    return commandVersion(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm --version"]);
  }
  return commandVersion("npm", ["--version"]);
}

async function commandVersion(file, commandArgs) {
  try {
    return (await execute(file, commandArgs, { windowsHide: true })).stdout.trim();
  } catch {
    return "unavailable";
  }
}

function parseArguments(argv) {
  const value = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const list = (name, fallback, allowed) => {
    const result = String(value(name, fallback)).split(",").filter(Boolean);
    if (result.some((entry) => !allowed.includes(entry))) throw new Error(`${name} contains an unsupported value.`);
    return result;
  };
  const integer = (name, fallback, minimum, maximum) => {
    const result = Number(value(name, fallback));
    if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
    return result;
  };
  return {
    engines: list("--engines", "chromium,firefox,webkit", ["chromium", "firefox", "webkit"]),
    profiles: list("--profiles", "balanced,lean", ["balanced", "lean"]),
    warmup: integer("--warmup", 1, 0, 10),
    iterations: integer("--iterations", 3, 1, 100),
    settleMs: integer("--settle-ms", 500, 0, 10_000),
    output: value("--output", join("output", "resource-benchmarks", `resource-${new Date().toISOString().replaceAll(":", "-")}.json`))
  };
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
