import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProfileVault } from "../src/profile-vault.js";

test("encrypts, lists, restores, and deletes an explicit browser-state checkpoint", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-browser-profile-vault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new ProfileVault(root);
  const passphrase = "a-strong-profile-passphrase";
  const state = {
    cookies: [{ name: "session", value: "secret", domain: "example.com", path: "/" }],
    origins: [
      {
        origin: "https://example.com",
        localStorage: [{ name: "workspace", value: "one" }]
      }
    ]
  };

  await vault.save("workspace-one", state, passphrase);
  assert.deepEqual(await vault.list(), ["workspace-one"]);
  assert.deepEqual(await vault.load("workspace-one", passphrase), state);
  await assert.rejects(
    vault.load("workspace-one", "another-strong-passphrase"),
    (error: unknown) => Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "PROFILE_DECRYPT_FAILED"
    )
  );
  await vault.delete("workspace-one");
  assert.deepEqual(await vault.list(), []);
});
