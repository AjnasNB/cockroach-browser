import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { arch, cpus, freemem, platform, release, totalmem } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { ContinuousResourceSampler } from "../dist/continuous-resource-sampler.js";
import { launchLightweightCdp } from "../dist/lightweight-cdp.js";
import { sampleProcessTree } from "../dist/resource-usage.js";

const execute = promisify(execFile);
const MIB = 1024 ** 2;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const executable = resolve(args.executable);
const executableInfo = await stat(executable);
if (!executableInfo.isFile()) throw new Error(`Not a regular file: ${executable}`);
const digest = await sha256(executable);
if (args.sha256 && digest !== args.sha256.toLowerCase().replace(/^sha256:/, "")) {
  throw new Error(`SHA-256 mismatch: expected ${args.sha256}, got ${digest}`);
}
const executableVersion = await binaryVersion(executable);
const sourceIdentity = await collectSourceIdentity(args.output);

const samples = [];
for (let index = 0; index < args.warmup + args.iterations; index += 1) {
  const measured = index >= args.warmup;
  process.stderr.write(`${measured ? "measure" : "warmup"} ${index + 1}/${args.warmup + args.iterations}\n`);
  const sample = await benchmarkRun();
  if (measured) samples.push(sample);
}

const targetBytes = args.targetMiB * MIB;
const requiredChecks = ["connect", "javascript", "dom", "forms", "screenshot", "teardown"];
const requiredConformancePassed = samples.every((sample) =>
  requiredChecks.every((check) => sample.conformance[check]?.passed === true)
);
const everyRunWithinTarget = samples.every((sample) => sample.browserTree.peakRssBytes <= targetBytes);
const finalDigest = await sha256(executable);
if (finalDigest !== digest) throw new Error("The lightweight executable changed while the benchmark was running.");
const finalSourceIdentity = await collectSourceIdentity(args.output);
for (const key of ["gitCommit", "sourceFileCount", "sourceTreeSha256", "runtimeBuildFileCount", "runtimeBuildSha256", "benchmarkScriptSha256"]) {
  if (sourceIdentity[key] !== finalSourceIdentity[key]) {
    throw new Error(`Benchmark input changed while the run was in progress: sourceIdentity.${key}.`);
  }
}
const report = {
  schemaVersion: "cockroach.lightweight-browser-benchmark.v2",
  generatedAt: new Date().toISOString(),
  implementation: args.implementation,
  resourceProfile: args.resourceProfile,
  renderingPolicy: "visual-actions-denied",
  executable: {
    name: basename(executable),
    bytes: executableInfo.size,
    sha256: digest,
    version: executableVersion
  },
  sourceIdentity,
  machine: {
    platform: platform(),
    architecture: arch(),
    release: release(),
    logicalCpuCount: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unavailable",
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtReport: freemem(),
    node: process.version
  },
  methodology: {
    warmup: args.warmup,
    iterations: args.iterations,
    settleMs: args.settleMs,
    startupTimeoutMs: args.startupTimeoutMs,
    actionTimeoutMs: args.actionTimeoutMs,
    teardownTimeoutMs: args.teardownTimeoutMs,
    resourceSamples: args.resourceSamples,
    resourceSampleIntervalMs: args.resourceSampleIntervalMs,
    targetMiB: args.targetMiB,
    targetDefinition: "Every measured owned-browser process-tree RSS sample is at or below the target and every required CDP/JavaScript/DOM/form/screenshot-preflight/teardown check passes.",
    memoryDefinition: "Aggregate RSS for the complete owned browser process tree; the Node coordinator is disclosed separately and is not hidden in browser RSS.",
    renderingControl: "Cockroach Browser declares a no-visual-action policy and rejects capture at preflight. This does not assert that the selected engine binary exposes or received a renderer-disable launch switch.",
    workload: "One runtime-owned loopback CDP server, one non-visual data-URL document, JavaScript evaluation, DOM query, input, and click.",
    requiredChecks,
    optionalChecks: [],
    energy: { available: false, reason: "No calibrated platform energy counter is available; CPU time is not watts." }
  },
  verdict: {
    passed: everyRunWithinTarget && requiredConformancePassed,
    everyRunWithinTarget,
    requiredConformancePassed,
    targetBytes,
    maxObservedBrowserTreeRssBytes: Math.max(...samples.map((sample) => sample.browserTree.peakRssBytes))
  },
  summary: {
    peakBrowserTreeRssBytes: distribution(samples.map((sample) => sample.browserTree.peakRssBytes)),
    browserCpuTimeMs: distribution(samples.map((sample) => sample.browserTree.cpuTimeMs)),
    processCount: distribution(samples.map((sample) => sample.browserTree.processCount)),
    launchMs: distribution(samples.map((sample) => sample.timings.launchMs)),
    connectMs: distribution(samples.map((sample) => sample.timings.connectMs)),
    workloadMs: distribution(samples.map((sample) => sample.timings.workloadMs)),
    shutdownMs: distribution(samples.map((sample) => sample.timings.shutdownMs)),
    coordinatorPeakRssBytes: distribution(samples.map((sample) => sample.coordinator.peakRssBytes))
  },
  samples
};

const output = resolve(args.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, output, verdict: report.verdict, summary: report.summary }, null, 2)}\n`);
if (!report.verdict.passed) process.exitCode = 2;

async function benchmarkRun() {
  const timings = {};
  const coordinatorRss = [process.memoryUsage().rss];
  const coordinatorCpuBefore = process.cpuUsage();
  let managed;
  let browser;
  let peak;
  let failure;
  let operationError;
  let samplingError;
  let teardownError;
  let resourceSampler;
  const conformance = {};
  try {
    managed = await timed(timings, "launchMs", () => launchLightweightCdp({
      executablePath: executable,
      implementation: args.implementation,
      expectedSha256: digest,
      startupTimeoutMs: args.startupTimeoutMs,
      rendering: "none",
      resourceProfile: args.resourceProfile,
      requiredActions: ["navigate", "evaluate", "query.inspect", "fill", "click"],
      allowExperimentalCapabilities: true,
      onSpawn: (pid) => {
        resourceSampler = new ContinuousResourceSampler({
          intervalMs: args.resourceSampleIntervalMs,
          sample: () => sampleProcessTree(pid),
          onSample: () => coordinatorRss.push(process.memoryUsage().rss)
        });
        resourceSampler.start();
      }
    }));
    browser = await timed(timings, "connectMs", () => chromium.connectOverCDP(managed.endpoint, { timeout: args.actionTimeoutMs }));
    conformance.connect = passed();
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();
    await timed(timings, "workloadMs", async () => {
      await page.goto(fixtureDataUrl(), { waitUntil: "domcontentloaded", timeout: args.actionTimeoutMs });
      const answer = await page.evaluate(() => 20 + 22);
      conformance.javascript = answer === 42 ? passed() : failed(`Expected 42, received ${String(answer)}.`);
      const heading = await page.locator("h1").textContent({ timeout: args.actionTimeoutMs });
      conformance.dom = heading === "Lightweight conformance" ? passed() : failed(`Unexpected heading: ${String(heading)}.`);
      // The route declares no visual actionability contract. Exercise its
      // explicit DOM-form semantics without pretending a coordinate-based
      // pointer action occurred or that an engine renderer was disabled.
      await page.locator("#name").evaluate((element, value) => {
        const input = element;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, "Cockroach");
      await page.locator("#save").evaluate((element) => element.click());
      const saved = await page.locator("#save").getAttribute("data-saved", { timeout: args.actionTimeoutMs });
      conformance.forms = saved === "true"
        ? passed({ actionability: "dom-non-visual" })
        : failed("The click handler did not run.");
      const screenshotPreflight = managed.preflightActions(["screenshot"]);
      conformance.screenshot = screenshotPreflight.ok
        ? failed("The declared no-visual-action policy unexpectedly admitted screenshot capture.")
        : passed({ supported: false, state: "unsupported", enforcement: "preflight" });
    });
  } catch (error) {
    failure = errorMessage(error);
    operationError = error;
    for (const name of ["connect", "javascript", "dom", "forms"]) {
      if (!conformance[name]) conformance[name] = failed(failure);
    }
  } finally {
    if (resourceSampler) {
      try {
        if (managed?.running) {
          await delay(args.settleMs);
          for (let index = 0; index < args.resourceSamples; index += 1) {
            await resourceSampler.sampleNow();
            if (index + 1 < args.resourceSamples) await delay(args.resourceSampleIntervalMs);
          }
        }
        const observed = await resourceSampler.stop();
        peak = {
          peakRssBytes: observed.peakRssBytes,
          cpuTimeMs: observed.cpuTimeMs,
          processCount: observed.processCount,
          sampleCount: observed.sampleCount,
          observations: observed.samples.map((sample) => ({
            sampledAt: sample.sampledAt,
            rssBytes: sample.rssBytes,
            cpuTimeMs: sample.cpuTimeMs,
            processCount: sample.processCount
          }))
        };
      } catch (error) {
        samplingError = error;
      }
    }
    const shutdownStarted = performance.now();
    try {
      await managed?.close(args.teardownTimeoutMs);
    } catch (error) {
      teardownError = error;
    }
    // The runtime-owned process tree is the authoritative lifecycle. Closing
    // it first can make the CDP transport reject; that expected disconnect is
    // not a teardown failure once the owned root is verified dead.
    const transportDisposed = browser
      ? await settlesWithin(browser.close(), args.teardownTimeoutMs)
      : true;
    if (!transportDisposed && !teardownError) {
      teardownError = new Error(`The CDP transport did not settle within ${args.teardownTimeoutMs} milliseconds after process teardown.`);
    }
    timings.shutdownMs = performance.now() - shutdownStarted;
    conformance.teardown = teardownError || managed?.running
      ? failed(teardownError ? errorMessage(teardownError) : "The owned browser root process remained live after close.")
      : passed({ rootProcessExited: true, transportDisposed: true });
    coordinatorRss.push(process.memoryUsage().rss);
  }
  if (operationError && !managed) throw operationError;
  if (samplingError) throw samplingError;
  if (!peak) throw new Error("No complete owned-process-tree resource sample was captured.");
  const coordinatorCpu = process.cpuUsage(coordinatorCpuBefore);
  return {
    timings,
    browserTree: peak,
    coordinator: {
      peakRssBytes: Math.max(...coordinatorRss),
      cpuTimeMs: (coordinatorCpu.user + coordinatorCpu.system) / 1_000
    },
    conformance,
    ...(failure ? { failure } : {})
  };
}

function fixtureDataUrl() {
  const html = "<!doctype html><html><head><title>Lightweight conformance</title></head><body><h1>Lightweight conformance</h1><label>Name<input id=name></label><button id=save onclick=\"this.dataset.saved='true'\">Save</button></body></html>";
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function passed(details = {}) { return { passed: true, ...details }; }
function failed(reason) { return { passed: false, reason: String(reason).slice(0, 1_024) }; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }

async function timed(target, name, operation) {
  const started = performance.now();
  try { return await operation(); }
  finally { target[name] = performance.now() - started; }
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

function percentile(values, point) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * point) - 1));
  return values[index];
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function collectSourceIdentity(outputPath) {
  const commit = await gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
  const status = await gitOutput(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const listed = (await gitOutput(repositoryRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(repositoryRoot, path));
  const excludedOutput = resolve(outputPath);
  const generatedArtifactRoots = [
    resolve(repositoryRoot, "docs", "benchmarks", "artifacts"),
    resolve(repositoryRoot, "output", "resource-benchmarks")
  ];
  const sourceFiles = [];
  for (const path of listed) {
    if (path === excludedOutput) continue;
    if (generatedArtifactRoots.some((root) => isBelow(root, path))) continue;
    if (!isProofInput(repositoryRoot, path)) continue;
    if ((await stat(path).catch(() => undefined))?.isFile()) sourceFiles.push(path);
  }
  const runtimeFiles = await filesBelow(resolve(repositoryRoot, "dist"));
  return {
    gitCommit: commit.trim(),
    workingTreeDirty: Boolean(status.trim()),
    sourceScope: "Runtime, schemas, benchmark/package/build configuration, and tests; generated documentation and benchmark artifacts are excluded.",
    identityNormalization: "Relative paths use forward slashes and text line endings are normalized to LF before hashing.",
    sourceFileCount: sourceFiles.length,
    sourceTreeSha256: await sha256Files(repositoryRoot, sourceFiles),
    runtimeBuildFileCount: runtimeFiles.length,
    runtimeBuildSha256: await sha256Files(repositoryRoot, runtimeFiles),
    benchmarkScriptSha256: await sha256CanonicalText(new URL(import.meta.url))
  };
}

function isProofInput(repositoryRoot, path) {
  const candidate = relative(repositoryRoot, path).replaceAll("\\", "/");
  if (candidate.startsWith("src/") || candidate.startsWith("schemas/") || candidate.startsWith("scripts/") || candidate.startsWith("test/")) {
    return true;
  }
  return candidate === "package.json"
    || candidate === "package-lock.json"
    || candidate === "server.json"
    || /^tsconfig(?:\.[^.]+)?\.json$/.test(candidate);
}

function isBelow(root, path) {
  const candidate = relative(root, path);
  return candidate !== "" && candidate !== ".." && !candidate.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(candidate);
}

async function gitOutput(root, arguments_) {
  const result = await execute("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  return String(result.stdout);
}

async function filesBelow(root) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

async function sha256Files(root, files) {
  const hash = createHash("sha256");
  for (const path of [...files].sort()) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update((await readFile(path, "utf8")).replace(/\r\n?/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function sha256CanonicalText(path) {
  return createHash("sha256")
    .update((await readFile(path, "utf8")).replace(/\r\n?/g, "\n"))
    .digest("hex");
}

async function binaryVersion(path) {
  for (const versionArgs of [["--version"], ["version"]]) {
    try {
      const result = await execute(path, versionArgs, { timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 });
      const text = `${result.stdout}\n${result.stderr}`.trim();
      if (text) return text.slice(0, 2_048);
    } catch {
      // Try the next conventional version command.
    }
  }
  return "unavailable";
}

function parseArguments(values) {
  const executable = value(values, "--executable");
  if (!executable) throw new Error("--executable is required.");
  const implementation = value(values, "--implementation") ?? "obscura";
  if (implementation !== "obscura" && implementation !== "lightpanda") {
    throw new Error("--implementation must be obscura or lightpanda.");
  }
  const sha = value(values, "--sha256");
  if (sha && !/^(?:sha256:)?[a-f0-9]{64}$/i.test(sha)) throw new Error("--sha256 must contain 64 hexadecimal characters.");
  const resourceProfile = value(values, "--resource-profile") ?? "standard";
  if (resourceProfile !== "standard" && resourceProfile !== "constrained") {
    throw new Error("--resource-profile must be standard or constrained.");
  }
  if (implementation !== "obscura" && resourceProfile === "constrained") {
    throw new Error("--resource-profile constrained is available only for Obscura.");
  }
  return {
    executable,
    implementation,
    resourceProfile,
    ...(sha ? { sha256: sha } : {}),
    iterations: integer(values, "--iterations", 5, 1, 100),
    warmup: integer(values, "--warmup", 1, 0, 20),
    settleMs: integer(values, "--settle-ms", 500, 0, 60_000),
    targetMiB: integer(values, "--target-mib", 30, 1, 32_768),
    startupTimeoutMs: integer(values, "--startup-timeout-ms", 15_000, 250, 120_000),
    actionTimeoutMs: integer(values, "--action-timeout-ms", 10_000, 250, 120_000),
    teardownTimeoutMs: integer(values, "--teardown-timeout-ms", 5_000, 250, 120_000),
    resourceSamples: integer(values, "--resource-samples", 3, 1, 20),
    resourceSampleIntervalMs: integer(values, "--resource-sample-interval-ms", 100, 25, 10_000),
    output: value(values, "--output") ?? `output/resource-benchmarks/lightweight-${implementation}-${resourceProfile}-${new Date().toISOString().replaceAll(":", "-")}.json`
  };
}

function value(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function integer(values, name, fallback, minimum, maximum) {
  const raw = value(values, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function delay(ms) { return new Promise((settle) => setTimeout(settle, ms)); }

function settlesWithin(promise, timeoutMs) {
  return new Promise((settle) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    Promise.resolve(promise).then(() => finish(true), () => finish(true));
  });
}
