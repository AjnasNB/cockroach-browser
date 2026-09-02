import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActivityLedger } from "../src/activity.js";
import { discoverBrowserExecutables, resolveBrowserProvider } from "../src/browser-discovery.js";
import { ACTION_KINDS, type BrowserProviderInput } from "../src/contracts.js";
import { TeamSessionStore } from "../src/team-sessions.js";
import { PersistentBrowserProfileStore } from "../src/persistent-profiles.js";

const DENIED_BROWSER_ARGUMENT_FIXTURES = [
  "--remote-debugging-address=0.0.0.0",
  "--remote-debugging-port=9222",
  "--user-data-dir=ambient-profile",
  "--load-extension=unreviewed-extension",
  "--disable-extensions-except=unreviewed-extension",
  " --NO-SANDBOX ",
  "--disable-web-security"
] as const;

test("browser discovery supports explicit platform binaries including ARM hosts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, process.platform === "win32" ? "chromium.exe" : "chromium");
  await writeFile(executable, "browser", "utf8");
  if (process.platform !== "win32") await chmod(executable, 0o700);
  const found = await discoverBrowserExecutables({
    platform: process.platform,
    arch: "arm64",
    explicitPaths: [executable],
    env: { PATH: "" }
  });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.arch, "arm64");
  assert.equal(found[0]?.source, "explicit");
});

test("public schemas cover the complete action union and lightweight provider surface", async () => {
  const actionSchema = JSON.parse(await readFile("schemas/action.schema.json", "utf8")) as {
    properties: Record<string, unknown>;
    $defs: { actionKind: { enum: string[] }; structuredExtractionLimits: unknown };
  };
  assert.deepEqual(actionSchema.$defs.actionKind.enum, [...ACTION_KINDS]);
  assert.ok(actionSchema.properties.extraction);
  assert.ok(actionSchema.$defs.structuredExtractionLimits);

  const sessionSchema = JSON.parse(await readFile("schemas/session.schema.json", "utf8")) as {
    properties: Record<string, unknown>;
    $defs: {
      browserProvider: {
        oneOf: Array<{
          additionalProperties: boolean;
          required: string[];
          properties: Record<string, { const?: unknown }>;
        }>;
      };
      browserArguments: { maxItems: number; items: { maxLength: number; pattern: string } };
      browserExtensions: { maxItems: number };
      persistentProfileName: { maxLength: number; pattern: string };
    };
  };
  assert.ok(sessionSchema.properties.browserProvider);
  const providers = sessionSchema.$defs.browserProvider.oneOf;
  assert.equal(providers.length, 6);
  assert.ok(providers.every((provider) => provider.additionalProperties === false));
  assert.deepEqual(
    providers.map((provider) => provider.properties.kind?.const),
    ["bundled", "system", "custom", "cdp", "lightweight", "lightweight"]
  );
  assert.deepEqual(
    providers.map((provider) => provider.required),
    [
      ["kind"],
      ["kind"],
      ["kind", "executablePath"],
      ["kind", "cdpEndpoint"],
      ["kind", "implementation", "executablePath", "allowExperimentalCapabilities"],
      ["kind", "implementation", "executablePath", "allowExperimentalCapabilities"]
    ]
  );
  const lightweight = providers.filter((provider) => provider.properties.kind?.const === "lightweight");
  assert.deepEqual(
    lightweight.map((provider) => provider.properties.implementation?.const),
    ["obscura", "lightpanda"]
  );
  for (const provider of lightweight) {
    assert.ok(provider.required.includes("implementation"));
    assert.ok(provider.required.includes("executablePath"));
    assert.ok(provider.required.includes("allowExperimentalCapabilities"));
    assert.equal(provider.properties.allowExperimentalCapabilities?.const, true);
    for (const denied of ["cdpEndpoint", "channel", "extensions", "arguments", "persistentProfile"]) {
      assert.equal(provider.properties[denied], undefined, `${denied} must not be accepted by a lightweight schema variant`);
    }
  }
  assert.equal(sessionSchema.$defs.browserArguments.maxItems, 64);
  assert.equal(sessionSchema.$defs.browserArguments.items.maxLength, 1_024);
  const argumentPattern = new RegExp(sessionSchema.$defs.browserArguments.items.pattern, "u");
  assert.equal(argumentPattern.test("--disable-background-networking"), true);
  assert.equal(argumentPattern.test(" \t "), false);
  for (const denied of DENIED_BROWSER_ARGUMENT_FIXTURES) {
    assert.equal(argumentPattern.test(denied), false, `${denied} must be rejected by the public schema`);
  }
  assert.equal(sessionSchema.$defs.browserExtensions.maxItems, 16);
  assert.equal(sessionSchema.$defs.persistentProfileName.maxLength, 64);
  assert.equal(sessionSchema.$defs.persistentProfileName.pattern, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
});

test("browser provider TypeScript input is a discriminated union", () => {
  const obscura: BrowserProviderInput = {
    kind: "lightweight",
    implementation: "obscura",
    executablePath: "reviewed-browser",
    resourceProfile: "constrained",
    allowExperimentalCapabilities: true
  };
  const cdp: BrowserProviderInput = { kind: "cdp", cdpEndpoint: "http://127.0.0.1:9222" };

  // @ts-expect-error Lightweight providers require an implementation discriminator.
  const missingImplementation: BrowserProviderInput = { kind: "lightweight", executablePath: "reviewed-browser", allowExperimentalCapabilities: true };
  // @ts-expect-error Experimental lightweight capability coverage requires literal true opt-in.
  const falseOptIn: BrowserProviderInput = { kind: "lightweight", implementation: "obscura", executablePath: "reviewed-browser", allowExperimentalCapabilities: false };
  // @ts-expect-error Lightpanda has no constrained resource-profile variant.
  const unsupportedLightpandaProfile: BrowserProviderInput = { kind: "lightweight", implementation: "lightpanda", executablePath: "reviewed-browser", resourceProfile: "constrained", allowExperimentalCapabilities: true };
  // @ts-expect-error Attached CDP providers cannot also inject browser arguments.
  const mixedCdpAuthority: BrowserProviderInput = { kind: "cdp", cdpEndpoint: "http://127.0.0.1:9222", arguments: ["--no-sandbox"] };

  assert.deepEqual([obscura.kind, cdp.kind], ["lightweight", "cdp"]);
  void [missingImplementation, falseOptIn, unsupportedLightpandaProfile, mixedCdpAuthority];
});

function uncheckedBrowserProvider(value: unknown): BrowserProviderInput {
  return value as BrowserProviderInput;
}

test("custom providers load only reviewed unpacked extensions and reject authority-expanding flags", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, process.platform === "win32" ? "browser.exe" : "browser");
  const extension = join(root, "extension");
  await writeFile(executable, "browser", "utf8");
  if (process.platform !== "win32") await chmod(executable, 0o700);
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "fixture", version: "1" }));
  const provider = await resolveBrowserProvider({
    kind: "custom",
    executablePath: executable,
    extensions: [extension],
    arguments: ["--disable-background-networking"]
  });
  assert.equal(provider.extensions.length, 1);
  assert.deepEqual(provider.arguments, ["--disable-background-networking"]);
  const persistent = await resolveBrowserProvider({
    kind: "custom",
    executablePath: executable,
    persistentProfile: "reviewed-profile"
  });
  assert.equal(persistent.persistentProfile, "reviewed-profile");
  for (const denied of DENIED_BROWSER_ARGUMENT_FIXTURES) {
    await assert.rejects(
      resolveBrowserProvider({ kind: "custom", executablePath: executable, arguments: [denied] }),
      /not accepted/
    );
  }
  await assert.rejects(
    resolveBrowserProvider({ kind: "custom", executablePath: executable, extensions: [join(root, "missing")] }),
    /explicit, local, unpacked directories/
  );
});

test("lightweight providers require an explicit pinned-capable binary and reject launch authority", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-lightweight-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, process.platform === "win32" ? "obscura.exe" : "obscura");
  await writeFile(executable, "reviewed fixture", "utf8");
  if (process.platform !== "win32") await chmod(executable, 0o700);

  const resolved = await resolveBrowserProvider({
    kind: "lightweight",
    implementation: "obscura",
    executablePath: executable,
    expectedSha256: "a".repeat(64),
    startupTimeoutMs: 5_000,
    rendering: "none",
    resourceProfile: "constrained",
    allowExperimentalCapabilities: true
  });
  assert.deepEqual(resolved.lightweight, {
    implementation: "obscura",
    executablePath: executable,
    expectedSha256: "a".repeat(64),
    startupTimeoutMs: 5_000,
    rendering: "none",
    resourceProfile: "constrained",
    allowExperimentalCapabilities: true
  });
  assert.deepEqual(resolved.arguments, []);
  assert.deepEqual(resolved.extensions, []);

  await assert.rejects(
    resolveBrowserProvider(uncheckedBrowserProvider({
      kind: "lightweight",
      implementation: "obscura",
      executablePath: executable,
      allowExperimentalCapabilities: true,
      arguments: ["--allow-private-network"]
    })),
    /does not accept properties: arguments/
  );
  await assert.rejects(
    resolveBrowserProvider(uncheckedBrowserProvider({ kind: "lightweight", executablePath: executable })),
    /require implementation obscura or lightpanda/
  );
  await assert.rejects(
    resolveBrowserProvider(uncheckedBrowserProvider({ kind: "lightweight", implementation: "obscura", executablePath: executable })),
    /allowExperimentalCapabilities=true/
  );
  await assert.rejects(
    resolveBrowserProvider(uncheckedBrowserProvider({
      kind: "lightweight",
      implementation: "lightpanda",
      executablePath: executable,
      resourceProfile: "constrained",
      allowExperimentalCapabilities: true
    })),
    /reviewed only for Obscura/
  );
});

test("persistent browser profiles are explicit, single-rooted, and recoverably archived", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-persistent-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PersistentBrowserProfileStore(join(root, "profiles"));
  const created = await store.prepare("release-review");
  assert.equal(created.name, "release-review");
  assert.equal((await store.list()).length, 1);
  await assert.rejects(store.prepare("../ambient-profile"), /Persistent profile names/);
  const archived = await store.archive("release-review");
  assert.match(archived.archivedPath, /profiles-archive/);
  assert.equal((await store.list()).length, 0);
});

test("activity ledger exposes bounded summary and detailed streams", () => {
  const ledger = new ActivityLedger({ detail: "summary", maxEntries: 100 });
  ledger.append({
    id: "event-1",
    type: "browser.action.completed",
    occurredAt: "2026-07-31T00:00:00.000Z",
    sessionId: "session-a",
    purpose: "test",
    metadata: { action: "navigate", status: "succeeded", inputDigest: "secret-detail" }
  });
  const result = ledger.list({ sessionId: "session-a" });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.metadata?.action, "navigate");
  assert.equal("inputDigest" in (result[0]?.metadata ?? {}), false);
});

test("team session store persists ownership, roles, and revocation generations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-team-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "team.json");
  const store = new TeamSessionStore(path);
  await store.claim("session-a", "owner@example.com");
  await store.grant("session-a", "owner@example.com", "operator@example.com", "operator");
  await store.assert("session-a", "operator@example.com", "operator");
  const revoked = await store.revoke("session-a", "owner@example.com", "operator@example.com");
  assert.equal(revoked.generation, 3);
  await assert.rejects(store.assert("session-a", "operator@example.com", "viewer"), /does not have viewer access/);
  const reopened = new TeamSessionStore(path);
  await reopened.initialize();
  await reopened.assert("session-a", "owner@example.com", "owner");
});

test("team session persistence failures never mutate the in-memory access map", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-team-atomic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "team.json");
  const tempPath = `${path}.tmp`;
  const store = new TeamSessionStore(path);
  await store.initialize();

  await mkdir(tempPath);
  await assert.rejects(store.claim("session-a", "owner@example.com"));
  assert.equal(await store.get("session-a"), undefined);
  await rm(tempPath, { recursive: true });

  await store.claim("session-a", "owner@example.com");
  const claimedDisk = await readFile(path, "utf8");
  await mkdir(tempPath);
  await assert.rejects(store.grant("session-a", "owner@example.com", "operator@example.com", "operator"));
  assert.equal((await store.get("session-a"))?.generation, 1);
  assert.equal(await readFile(path, "utf8"), claimedDisk);
  await rm(tempPath, { recursive: true });

  await store.grant("session-a", "owner@example.com", "operator@example.com", "operator");
  const grantedDisk = await readFile(path, "utf8");
  await mkdir(tempPath);
  await assert.rejects(store.revoke("session-a", "owner@example.com", "operator@example.com"));
  await store.assert("session-a", "operator@example.com", "operator");
  assert.equal((await store.get("session-a"))?.generation, 2);
  assert.equal(await readFile(path, "utf8"), grantedDisk);
  await assert.rejects(store.remove("session-a"));
  assert.equal((await store.get("session-a"))?.generation, 2);
  assert.equal(await readFile(path, "utf8"), grantedDisk);
});
