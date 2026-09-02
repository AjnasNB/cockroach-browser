import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import {
  buildLightweightCdpLaunchPlan,
  assertLightweightCdpActions,
  launchLightweightCdp,
  lightweightCdpImplementation,
  parseLightweightCdpReportedEndpoint,
  preflightLightweightCdpActions
} from "../src/lightweight-cdp.js";
import { EngineCapabilityPreflightError } from "../src/engine-capabilities.js";

test("lightweight CDP metadata keeps independent engines explicit", () => {
  const obscura = lightweightCdpImplementation("obscura");
  assert.equal(obscura.license, "Apache-2.0");
  assert.equal(obscura.cdpCompatibility, "partial");
  assert.equal(obscura.windowsSupport, "native");
  assert.equal(obscura.rendering, "binary-dependent");

  const lightpanda = lightweightCdpImplementation("lightpanda");
  assert.equal(lightpanda.license, "AGPL-3.0-only");
  assert.equal(lightpanda.windowsSupport, "wsl2-only");
  assert.equal(lightpanda.rendering, "none");
  assert.ok(!lightpanda.nativePlatforms.includes("win32"));
});

test("launch plans are loopback-only and contain no authority-widening flags", () => {
  for (const id of ["obscura", "lightpanda"] as const) {
    const plan = buildLightweightCdpLaunchPlan(id, "/reviewed/browser", 31_337);
    assert.equal(plan.host, "127.0.0.1");
    assert.equal(plan.rendering, "none");
    assert.equal(plan.resourceProfile, "standard");
    assert.match(plan.endpoint, /^ws:\/\/127\.0\.0\.1:31337/);
    assert.deepEqual(plan.args, id === "obscura"
      ? ["serve", "--host", "127.0.0.1", "--port", "31337", "--workers", "1", "--max-connections", "1", "--quiet"]
      : ["serve", "--host", "127.0.0.1", "--port", "31337"]);
    assert.ok(!plan.args.some((value) => /stealth|private|file-access|0\.0\.0\.0/i.test(value)));
  }
  assert.equal(buildLightweightCdpLaunchPlan("obscura", "/reviewed/browser", 9_222).endpoint, "ws://127.0.0.1:9222");
  assert.equal(buildLightweightCdpLaunchPlan("lightpanda", "/reviewed/browser", 9_222).endpoint, "ws://127.0.0.1:9222");
  assert.equal(buildLightweightCdpLaunchPlan("obscura", "/reviewed/browser", 9_222, "native").rendering, "native");
  const constrained = buildLightweightCdpLaunchPlan("obscura", "/reviewed/browser", 9_222, "none", "constrained");
  assert.equal(constrained.resourceProfile, "constrained");
  assert.deepEqual(constrained.args.slice(0, 2), ["--v8-flags", "--max-old-space-size=8 --max-semi-space-size=1"]);
  assert.equal(constrained.args[2], "serve");
  const privateNetwork = buildLightweightCdpLaunchPlan("obscura", "/reviewed/browser", 9_222, "none", "standard", true);
  assert.equal(privateNetwork.allowPrivateNetwork, true);
  assert.equal(privateNetwork.args.at(-1), "--allow-private-network");
  assert.equal(buildLightweightCdpLaunchPlan("obscura", "/reviewed/browser", 9_222).allowPrivateNetwork, false);
  assert.throws(
    () => buildLightweightCdpLaunchPlan("lightpanda", "/reviewed/browser", 9_222, "native"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "LIGHTWEIGHT_CDP_RENDERING_UNSUPPORTED")
  );
  assert.throws(
    () => buildLightweightCdpLaunchPlan("lightpanda", "/reviewed/browser", 9_222, "none", "constrained"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "LIGHTWEIGHT_CDP_RESOURCE_PROFILE_UNSUPPORTED")
  );
  assert.throws(
    () => buildLightweightCdpLaunchPlan("lightpanda", "/reviewed/browser", 9_222, "none", "standard", true),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "LIGHTWEIGHT_CDP_PRIVATE_NETWORK_UNSUPPORTED")
  );
});

test("exact binary rendering overrides generic engine capability claims", () => {
  const noRender = preflightLightweightCdpActions({
    implementation: "obscura",
    rendering: "none",
    actions: ["navigate", "capture.paired", "pdf"],
    allowExperimentalCapabilities: true
  });
  assert.equal(noRender.ok, false);
  assert.deepEqual(noRender.unmet.map((entry) => [entry.capability, entry.state]), [
    ["capture.screenshot", "unsupported"],
    ["capture.pdf", "unsupported"]
  ]);
  assert.match(noRender.unmet[0]?.note ?? "", /rendering=none visual-action policy/);

  const native = assertLightweightCdpActions({
    implementation: "obscura",
    rendering: "native",
    actions: ["navigate", "screenshot", "pdf"],
    allowExperimentalCapabilities: true
  });
  assert.equal(native.ok, true);
  assert.equal(native.rendering, "native");
});

test("lightweight action preflight requires explicit experimental acceptance", () => {
  assert.throws(
    () => assertLightweightCdpActions({ implementation: "obscura", actions: ["navigate"] }),
    EngineCapabilityPreflightError
  );
  const result = assertLightweightCdpActions({
    implementation: "obscura",
    actions: ["navigate"],
    allowExperimentalCapabilities: true
  });
  assert.equal(result.implementation, "obscura");
  assert.equal(result.rendering, "none");
});

test("non-visual action preflight rejects visual pointer fidelity but admits the DOM adapter", () => {
  const dom = assertLightweightCdpActions({
    implementation: "obscura",
    rendering: "none",
    actions: ["click", "fill"],
    allowExperimentalCapabilities: true
  });
  assert.equal(dom.ok, true);

  const pointer = preflightLightweightCdpActions({
    implementation: "obscura",
    rendering: "none",
    actions: ["hover"],
    allowExperimentalCapabilities: true
  });
  assert.equal(pointer.ok, false);
  assert.equal(pointer.unmet[0]?.capability, "page.forms");
  assert.match(pointer.unmet[0]?.note ?? "", /no visual pointer fidelity/);
});

test("only a server-reported endpoint for the owned loopback port is adopted", () => {
  assert.equal(
    parseLightweightCdpReportedEndpoint("CDP ready at ws://127.0.0.1:9222", 9_222),
    "ws://127.0.0.1:9222"
  );
  assert.equal(
    parseLightweightCdpReportedEndpoint("CDP ready at ws://127.0.0.1:9222/session/reviewed", 9_222),
    "ws://127.0.0.1:9222/session/reviewed"
  );
  assert.equal(parseLightweightCdpReportedEndpoint("ws://127.0.0.1:9223/session", 9_222), undefined);
  assert.equal(parseLightweightCdpReportedEndpoint("ws://192.168.1.7:9222/session", 9_222), undefined);
});

test("launch refuses a digest mismatch before executing the binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-lightweight-digest-"));
  const executable = join(root, process.platform === "win32" ? "browser.exe" : "browser");
  try {
    await writeFile(executable, "not an executable release");
    if (process.platform !== "win32") await chmod(executable, 0o700);
    await assert.rejects(
      launchLightweightCdp({
        executablePath: executable,
        implementation: "obscura",
        requiredActions: [],
        allowExperimentalCapabilities: true,
        expectedSha256: "0".repeat(64)
      }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "LIGHTWEIGHT_CDP_DIGEST_MISMATCH")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launch reports an occupied loopback port before spawning", async () => {
  const server = createServer();
  await new Promise<void>((settle, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", settle);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(
      launchLightweightCdp({
        executablePath: process.execPath,
        implementation: "obscura",
        requiredActions: [],
        allowExperimentalCapabilities: true,
        port: address.port
      }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "LIGHTWEIGHT_CDP_PORT_UNAVAILABLE")
    );
  } finally {
    await new Promise<void>((settle, reject) => server.close((error) => error ? reject(error) : settle()));
  }
});

test("a child that exits before readiness returns bounded diagnostics", async () => {
  await assert.rejects(
    launchLightweightCdp({
      executablePath: process.execPath,
      implementation: "obscura",
      requiredActions: [],
      allowExperimentalCapabilities: true,
      startupTimeoutMs: 1_000,
      maxLogBytes: 1_024
    }),
    (error: unknown) => {
      if (!error || typeof error !== "object" || !("code" in error) || !("details" in error)) return false;
      const details = error.details as Record<string, unknown>;
      const expectedCode = process.platform === "win32"
        ? "LIGHTWEIGHT_CDP_START_CLEANUP_FAILED"
        : "LIGHTWEIGHT_CDP_START_FAILED";
      return error.code === expectedCode
        && (process.platform !== "win32" || /exited before its CDP listener/.test(String(details.startFailure ?? "")))
        && Buffer.byteLength(String(details.stderrTail ?? "")) <= 1_024;
    }
  );
});

test(
  "an explicit reviewed lightweight binary exposes CDP, JavaScript, and measured process RSS",
  {
    skip: !process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_BINARY,
    timeout: 60_000
  },
  async () => {
    const executablePath = process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_BINARY!;
    const implementation = (process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_IMPLEMENTATION ?? "obscura") as "obscura" | "lightpanda";
    const expectedSha256 = process.env.COCKROACH_LIGHTWEIGHT_CDP_E2E_SHA256;
    const browserProcess = await launchLightweightCdp({
      executablePath,
      implementation,
      rendering: "none",
      requiredActions: ["evaluate"],
      allowExperimentalCapabilities: true,
      ...(expectedSha256 ? { expectedSha256 } : {})
    });
    try {
      const browser = await chromium.connectOverCDP(browserProcess.endpoint);
      try {
        assert.equal(browserProcess.rendering, "none");
        assert.equal(browserProcess.capabilityPreflight.engine, implementation);
        assert.throws(() => browserProcess.assertActions(["screenshot"]), EngineCapabilityPreflightError);
        const context = browser.contexts()[0] ?? await browser.newContext();
        const page = context.pages()[0] ?? await context.newPage();
        assert.equal(await page.evaluate(() => 20 + 22), 42);
        const resources = await browserProcess.resources();
        assert.equal(resources.rootPid, browserProcess.pid);
        assert.ok(resources.processCount >= 1);
        assert.ok(resources.rssBytes > 0);
      } finally {
        await browser.close();
      }
    } finally {
      await browserProcess.close();
    }
    assert.equal(browserProcess.running, false);
  }
);
