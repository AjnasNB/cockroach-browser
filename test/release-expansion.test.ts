import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());

test("release assets are deterministic, complete, and checksum-bound", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cockroach-browser-release-test-"));
  const output = join(temporaryRoot, "cockroach-browser-release-assets");
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const staged = spawnSync(process.execPath, ["scripts/stage-release-assets.mjs", "--out", output], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  assert.equal(staged.status, 0, `${staged.stdout}\n${staged.stderr}`);
  const files = (await readdir(output)).sort();
  assert.deepEqual(files, [
    "SHA256SUMS",
    "cockroach-browser-0.4.0-rc.1-browser-api-surface.json",
    "cockroach-browser-0.4.0-rc.1-capabilities.json",
    "cockroach-browser-0.4.0-rc.1-release-notes.md",
    "cockroach-browser-0.4.0-rc.1-sdk-inventory.json"
  ]);
  const sums = (await readFile(join(output, "SHA256SUMS"), "utf8")).trim().split("\n");
  assert.equal(sums.length, 4);
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})  ([^/\\]+)$/);
    assert(match, `Malformed checksum line: ${line}`);
    const fileName = match[2];
    assert(fileName);
    const bytes = await readFile(join(output, fileName));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), match[1]);
  }
  const inventory = JSON.parse(await readFile(join(output, "cockroach-browser-0.4.0-rc.1-capabilities.json"), "utf8"));
  assert.deepEqual(inventory.counts, { total: 124, available: 114, adapter: 10, planned: 0 });
  assert.equal(inventory.actionCount, 65);
});

test("release workflow keeps prereleases on next and verifies every platform lane", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/release.yml"), "utf8");
  for (const required of [
    "npm_tag=next",
    "dist-tags.latest",
    "--prerelease",
    "chromium firefox webkit",
    "COCKROACH_BROWSER_HEADED_E2E",
    "COCKROACH_BROWSER_PUPPETEER_NO_SANDBOX",
    "python -m compileall",
    "mvn --batch-mode",
    "dotnet build",
    "ruby -c",
    "go test ./...",
    "stage-release-assets.mjs",
    "gh release upload"
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("language SDK package versions match the release candidate", async () => {
  const expected = "0.4.0-rc.1";
  const python = await readFile(resolve(root, "sdks/python/pyproject.toml"), "utf8");
  const java = await readFile(resolve(root, "sdks/java/pom.xml"), "utf8");
  const dotnet = await readFile(resolve(root, "sdks/dotnet/CockroachBrowser/CockroachBrowser.csproj"), "utf8");
  const ruby = await readFile(resolve(root, "sdks/ruby/cockroach-browser.gemspec"), "utf8");
  assert.match(python, /version = "0\.4\.0rc1"/);
  assert.match(java, new RegExp(`<version>${expected.replaceAll(".", "\\.")}</version>`));
  assert.match(dotnet, new RegExp(`<Version>${expected.replaceAll(".", "\\.")}</Version>`));
  assert.match(ruby, /spec\.version = "0\.4\.0\.rc\.1"/);
});
