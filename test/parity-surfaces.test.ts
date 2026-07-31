import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActivityLedger } from "../src/activity.js";
import { discoverBrowserExecutables, resolveBrowserProvider } from "../src/browser-discovery.js";
import { TeamSessionStore } from "../src/team-sessions.js";
import { PersistentBrowserProfileStore } from "../src/persistent-profiles.js";

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
  await assert.rejects(
    resolveBrowserProvider({ kind: "custom", executablePath: executable, arguments: ["--no-sandbox"] }),
    /not accepted/
  );
  await assert.rejects(
    resolveBrowserProvider({ kind: "custom", executablePath: executable, extensions: [join(root, "missing")] }),
    /explicit, local, unpacked directories/
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
