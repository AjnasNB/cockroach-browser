import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = [
  resolve(root, process.argv[2] ?? "docs/benchmarks/artifacts/obscura-0.2.1-constrained-non-visual-30mib-2026-09-03-rc1.json"),
  resolve(root, process.argv[3] ?? "docs/benchmarks/artifacts/obscura-0.2.1-constrained-non-visual-25mib-2026-09-03-rc1.json")
];
const proofRecordPath = resolve(root, "docs/benchmarks/obscura-non-visual-2026-09-03.md");
const readmePath = resolve(root, "README.md");
const reports = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const artifactDigests = await Promise.all(paths.map(sha256));

assertReport(reports[0], 30, true);
assertReport(reports[1], 25, undefined);
for (const key of [
  "gitCommit",
  "workingTreeDirty",
  "sourceScope",
  "identityNormalization",
  "sourceFileCount",
  "sourceTreeSha256",
  "runtimeBuildFileCount",
  "runtimeBuildSha256",
  "benchmarkScriptSha256"
]) {
  assert(reports[0].sourceIdentity[key] === reports[1].sourceIdentity[key], `proof artifacts disagree on sourceIdentity.${key}`);
}
assert(reports[0].executable.sha256 === reports[1].executable.sha256, "proof artifacts used different binaries");
for (const key of ["name", "bytes", "version"]) {
  assert(reports[0].executable[key] === reports[1].executable[key], `proof artifacts disagree on executable.${key}`);
}
for (const key of ["platform", "architecture", "release", "logicalCpuCount", "cpuModel", "totalMemoryBytes", "node"]) {
  assert(equalJson(reports[0].machine[key], reports[1].machine[key]), `proof artifacts were not measured on the same machine: machine.${key}`);
}
for (const key of [
  "warmup",
  "iterations",
  "settleMs",
  "startupTimeoutMs",
  "actionTimeoutMs",
  "teardownTimeoutMs",
  "resourceSamples",
  "resourceSampleIntervalMs",
  "targetDefinition",
  "memoryDefinition",
  "renderingControl",
  "workload",
  "requiredChecks",
  "optionalChecks"
]) {
  assert(equalJson(reports[0].methodology[key], reports[1].methodology[key]), `proof artifacts disagree on methodology.${key}`);
}

const current = await collectCurrentIdentity(paths);
for (const key of [
  "sourceFileCount",
  "sourceTreeSha256",
  "runtimeBuildFileCount",
  "runtimeBuildSha256",
  "benchmarkScriptSha256"
]) {
  assert(reports[0].sourceIdentity[key] === current[key], `proof artifact is stale: sourceIdentity.${key}`);
}
await assertNarrativeConsistency(reports, paths, artifactDigests, current);

process.stdout.write(`${JSON.stringify({
  ok: true,
  artifacts: paths.map((path, index) => ({
    path: relative(root, path).replaceAll("\\", "/"),
    sha256: artifactDigests[index]
  })),
  sourceTreeSha256: current.sourceTreeSha256,
  runtimeBuildSha256: current.runtimeBuildSha256,
  outcomes: reports.map((report) => ({
    targetMiB: report.methodology.targetMiB,
    passed: report.verdict.passed,
    maxObservedBrowserTreeRssBytes: report.verdict.maxObservedBrowserTreeRssBytes
  }))
}, null, 2)}\n`);

function assertReport(report, targetMiB, requiredVerdict) {
  assert(report?.schemaVersion === "cockroach.lightweight-browser-benchmark.v2", "unexpected benchmark schema");
  assert(report.implementation === "obscura", "proof must use Obscura");
  assert(report.resourceProfile === "constrained", "proof must use the constrained profile");
  assert(report.renderingPolicy === "visual-actions-denied", "proof must identify the visual-action policy without asserting renderer state");
  assert(report.executable?.name === "obscura.exe", "proof must disclose the binary name");
  assert(report.executable?.version === "obscura 0.2.1", "proof must use Obscura 0.2.1");
  assert(report.executable?.sha256 === "5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221", "proof must use the reviewed binary digest");
  assert(Number.isSafeInteger(report.executable?.bytes) && report.executable.bytes > 0, "proof must disclose a positive executable size");
  assert(Number.isFinite(Date.parse(report.generatedAt)), "proof generatedAt must be an ISO timestamp");
  assert(/^[a-f0-9]{40}$/.test(report.sourceIdentity?.gitCommit ?? ""), "proof must identify its Git base commit");
  assert(report.sourceIdentity?.workingTreeDirty === true || report.sourceIdentity?.workingTreeDirty === false, "proof must disclose working-tree state");
  assert(report.sourceIdentity?.identityNormalization === "Relative paths use forward slashes and text line endings are normalized to LF before hashing.", "proof must disclose its portable identity normalization");
  assert(/^[a-f0-9]{64}$/.test(report.sourceIdentity?.sourceTreeSha256 ?? ""), "proof must identify its source tree");
  assert(/^[a-f0-9]{64}$/.test(report.sourceIdentity?.runtimeBuildSha256 ?? ""), "proof must identify its runtime build");
  assert(/^[a-f0-9]{64}$/.test(report.sourceIdentity?.benchmarkScriptSha256 ?? ""), "proof must identify its benchmark harness");
  assert(typeof report.machine?.platform === "string" && report.machine.platform.length > 0, "proof must disclose its operating-system platform");
  assert(typeof report.machine?.architecture === "string" && report.machine.architecture.length > 0, "proof must disclose its CPU architecture");
  assert(typeof report.machine?.release === "string" && report.machine.release.length > 0, "proof must disclose its operating-system release");
  assert(typeof report.machine?.node === "string" && report.machine.node.length > 0, "proof must disclose its Node.js version");
  assert(report.methodology?.warmup === 1, "proof must include one warmup run");
  assert(report.methodology?.iterations === 20, "proof must include twenty measured runs");
  assert(report.methodology?.resourceSamples === 10, "proof must include ten explicit steady-state samples per run");
  assert(report.methodology?.resourceSampleIntervalMs === 25, "proof must sample at 25 ms intervals");
  assert(Number.isSafeInteger(report.methodology?.teardownTimeoutMs) && report.methodology.teardownTimeoutMs >= 250, "proof must disclose a bounded teardown timeout");
  assert(report.methodology?.targetMiB === targetMiB, `proof target must be ${targetMiB} MiB`);
  assert(report.methodology?.renderingControl?.includes("does not assert"), "proof must disclaim unverified engine renderer state");
  assert(!/renderer (?:is|was|has been) disabled/i.test(report.methodology?.renderingControl ?? ""), "proof must not claim that the engine renderer was disabled");
  assert(report.methodology?.energy?.available === false, "proof must not invent energy measurements");
  assert(Array.isArray(report.samples) && report.samples.length === 20, "proof must retain all measured samples");
  const requiredChecks = ["connect", "javascript", "dom", "forms", "screenshot", "teardown"];
  assert(equalJson(report.methodology?.requiredChecks, requiredChecks), "proof requiredChecks must include visual-policy enforcement and teardown");
  assert(equalJson(report.methodology?.optionalChecks, []), "proof must not label a verdict-critical visual-policy check as optional");
  const targetBytes = targetMiB * 1024 ** 2;
  let maximum = 0;
  for (const [index, sample] of report.samples.entries()) {
    const observations = sample?.browserTree?.observations;
    assert(Array.isArray(observations) && observations.length >= 10, `sample ${index + 1} did not retain enough raw resource observations`);
    assert(sample.browserTree.sampleCount === observations.length, `sample ${index + 1} sampleCount does not match retained observations`);
    let samplePeakRss = 0;
    let samplePeakCpu = 0;
    let samplePeakProcesses = 0;
    for (const [observationIndex, observation] of observations.entries()) {
      assert(Number.isFinite(Date.parse(observation?.sampledAt)), `sample ${index + 1} observation ${observationIndex + 1} has no timestamp`);
      assert(Number.isSafeInteger(observation?.rssBytes) && observation.rssBytes > 0, `sample ${index + 1} observation ${observationIndex + 1} has invalid RSS`);
      assert(Number.isFinite(observation?.cpuTimeMs) && observation.cpuTimeMs >= 0, `sample ${index + 1} observation ${observationIndex + 1} has invalid CPU time`);
      assert(Number.isSafeInteger(observation?.processCount) && observation.processCount >= 1, `sample ${index + 1} observation ${observationIndex + 1} has no owned browser process`);
      samplePeakRss = Math.max(samplePeakRss, observation.rssBytes);
      samplePeakCpu = Math.max(samplePeakCpu, observation.cpuTimeMs);
      samplePeakProcesses = Math.max(samplePeakProcesses, observation.processCount);
    }
    assert(sample.browserTree.peakRssBytes === samplePeakRss, `sample ${index + 1} peak RSS is inconsistent with retained observations`);
    assert(sample.browserTree.cpuTimeMs === samplePeakCpu, `sample ${index + 1} CPU time is inconsistent with retained observations`);
    assert(sample.browserTree.processCount === samplePeakProcesses, `sample ${index + 1} process count is inconsistent with retained observations`);
    for (const check of requiredChecks) {
      assert(sample.conformance?.[check]?.passed === true, `sample ${index + 1} failed required check ${check}`);
    }
    assert(sample.conformance.teardown.rootProcessExited === true, `sample ${index + 1} did not verify root-process exit`);
    assert(sample.conformance.teardown.transportDisposed === true, `sample ${index + 1} did not verify bounded CDP transport disposal`);
    assert(sample.conformance?.screenshot?.passed === true && sample.conformance.screenshot.supported === false, `sample ${index + 1} did not enforce the visual-action preflight`);
    for (const timing of ["launchMs", "connectMs", "workloadMs", "shutdownMs"]) {
      assert(Number.isFinite(sample.timings?.[timing]) && sample.timings[timing] >= 0, `sample ${index + 1} has invalid ${timing}`);
    }
    assert(Number.isSafeInteger(sample.coordinator?.peakRssBytes) && sample.coordinator.peakRssBytes > 0, `sample ${index + 1} has invalid coordinator RSS`);
    assert(Number.isFinite(sample.coordinator?.cpuTimeMs) && sample.coordinator.cpuTimeMs >= 0, `sample ${index + 1} has invalid coordinator CPU time`);
    assert(!Object.hasOwn(sample, "failure"), `sample ${index + 1} retained an operation failure despite a passing conformance set`);
    maximum = Math.max(maximum, samplePeakRss);
  }
  const everyRunWithinTarget = report.samples.every((sample) =>
    sample.browserTree.observations.every((observation) => observation.rssBytes <= targetBytes)
  );
  assert(report.verdict?.targetBytes === targetBytes, "verdict targetBytes is inconsistent");
  assert(report.verdict?.maxObservedBrowserTreeRssBytes === maximum, "verdict maximum is inconsistent with retained samples");
  assert(report.verdict?.everyRunWithinTarget === everyRunWithinTarget, "memory verdict is inconsistent with retained samples");
  assert(report.verdict?.requiredConformancePassed === true, "required conformance verdict must pass");
  assert(report.verdict?.passed === everyRunWithinTarget, "combined verdict is inconsistent");
  if (requiredVerdict !== undefined) assert(report.verdict.passed === requiredVerdict, `the ${targetMiB} MiB proof has the wrong verdict`);
  assertDistribution(report.summary?.peakBrowserTreeRssBytes, report.samples.map((sample) => sample.browserTree.peakRssBytes), "peak browser-tree RSS");
  assertDistribution(report.summary?.browserCpuTimeMs, report.samples.map((sample) => sample.browserTree.cpuTimeMs), "browser CPU time");
  assertDistribution(report.summary?.processCount, report.samples.map((sample) => sample.browserTree.processCount), "process count");
  assertDistribution(report.summary?.launchMs, report.samples.map((sample) => sample.timings.launchMs), "launch timing");
  assertDistribution(report.summary?.connectMs, report.samples.map((sample) => sample.timings.connectMs), "connect timing");
  assertDistribution(report.summary?.workloadMs, report.samples.map((sample) => sample.timings.workloadMs), "workload timing");
  assertDistribution(report.summary?.shutdownMs, report.samples.map((sample) => sample.timings.shutdownMs), "shutdown timing");
  assertDistribution(report.summary?.coordinatorPeakRssBytes, report.samples.map((sample) => sample.coordinator.peakRssBytes), "coordinator peak RSS");
}

async function assertNarrativeConsistency(reports, artifactPaths, artifactDigests, current) {
  const [readme, proofRecord] = await Promise.all([
    readFile(readmePath, "utf8"),
    readFile(proofRecordPath, "utf8")
  ]);
  const proofLink = "docs/benchmarks/obscura-non-visual-2026-09-03.md";
  assert(readme.replaceAll("\\", "/").includes(proofLink), "README must link to the current non-visual proof record");
  assert(readme.includes(reports[0].executable.sha256), "README must identify the reviewed Obscura digest");
  assert(readme.split(/\r?\n/).some((line) => /whole[- ]app/i.test(line) && /not|doesn't|does not/i.test(line)), "README must disclaim a whole-app memory guarantee");
  for (const report of reports) assertTargetNarrative(readme, report, reports, "README");

  for (const [index, artifactPath] of artifactPaths.entries()) {
    const artifact = relative(root, artifactPath).replaceAll("\\", "/");
    assert(proofRecord.replaceAll("\\", "/").includes(artifact), `proof record must name ${artifact}`);
    assert(proofRecord.includes(artifactDigests[index]), `proof record must identify the SHA-256 of ${artifact}`);
  }
  for (const hash of [
    reports[0].executable.sha256,
    current.sourceTreeSha256,
    current.runtimeBuildSha256,
    reports[0].sourceIdentity.benchmarkScriptSha256
  ]) {
    assert(proofRecord.includes(hash), `proof record must bind narrative claims to ${hash}`);
  }
  assert(/does not assert[^\n]*renderer|renderer[^\n]*does not assert/i.test(proofRecord), "proof record must disclaim unverified renderer state");
  assert(proofRecord.split(/\r?\n/).some((line) => /coordinator/i.test(line) && /separate/i.test(line)), "proof record must disclose coordinator memory separately");
  for (const report of reports) assertTargetNarrative(proofRecord, report, reports, "proof record");
}

function assertTargetNarrative(text, report, allReports, label) {
  const target = report.methodology.targetMiB;
  const maximum = report.verdict.maxObservedBrowserTreeRssBytes;
  const verdict = report.verdict.passed ? /pass(?:ed|es|ing)?/i : /fail(?:ed|s|ing)?/i;
  const otherTargets = allReports.map((candidate) => candidate.methodology.targetMiB).filter((candidate) => candidate !== target);
  const lines = text.split(/\r?\n/).filter((line) =>
    new RegExp(`${target}\\s*MiB`, "i").test(line)
    && otherTargets.every((other) => !new RegExp(`${other}\\s*MiB`, "i").test(line))
  );
  assert(lines.length > 0, `${label} must name the ${target} MiB result`);
  assert(lines.some((line) => containsNumber(line, maximum)), `${label} must state the exact ${target} MiB maximum of ${maximum} bytes`);
  assert(lines.some((line) => verdict.test(line)), `${label} must state the honest ${target} MiB verdict`);
}

function containsNumber(text, value) {
  return new RegExp(`(?:^|\\D)${value}(?!\\d)`).test(text.replace(/[,_]/g, ""));
}

function assertDistribution(actual, values, label) {
  const expected = distribution(values);
  assert(equalJson(actual, expected), `summary ${label} distribution is inconsistent with retained samples`);
}

function distribution(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return { median: null, p95: null, min: null, max: null };
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

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function collectCurrentIdentity(artifactPaths) {
  const listed = (await gitOutput(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(root, path));
  const artifactRoots = [
    resolve(root, "docs", "benchmarks", "artifacts"),
    resolve(root, "output", "resource-benchmarks")
  ];
  const excluded = new Set(artifactPaths);
  const sourceFiles = [];
  for (const path of listed) {
    if (excluded.has(path) || artifactRoots.some((artifactRoot) => isBelow(artifactRoot, path))) continue;
    if (!isProofInput(path)) continue;
    if ((await stat(path).catch(() => undefined))?.isFile()) sourceFiles.push(path);
  }
  const runtimeFiles = await filesBelow(resolve(root, "dist"));
  return {
    sourceFileCount: sourceFiles.length,
    sourceTreeSha256: await sha256Files(sourceFiles),
    runtimeBuildFileCount: runtimeFiles.length,
    runtimeBuildSha256: await sha256Files(runtimeFiles),
    benchmarkScriptSha256: await sha256CanonicalText(resolve(root, "scripts", "benchmark-lightweight.mjs"))
  };
}

function isProofInput(path) {
  const candidate = relative(root, path).replaceAll("\\", "/");
  return candidate.startsWith("src/")
    || candidate.startsWith("schemas/")
    || candidate.startsWith("scripts/")
    || candidate.startsWith("test/")
    || candidate === "package.json"
    || candidate === "package-lock.json"
    || candidate === "server.json"
    || /^tsconfig(?:\.[^.]+)?\.json$/.test(candidate);
}

function isBelow(parent, path) {
  const candidate = relative(parent, path);
  return candidate !== "" && candidate !== ".." && !candidate.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(candidate);
}

async function gitOutput(arguments_) {
  const result = await execute("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  return String(result.stdout);
}

async function filesBelow(directory) {
  const files = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(directory);
  return files.sort();
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function sha256Files(files) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
