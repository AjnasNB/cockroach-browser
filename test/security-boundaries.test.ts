import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const boundaryPhrases = [
  "CAPTCHA or access-control bypass",
  "covert stealth",
  "ambient browser cookies or profiles",
  "public unauthenticated server binding"
];

test("public surfaces preserve the four deliberate browser security boundaries", async () => {
  const root = process.cwd();
  const surfaces = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "SECURITY.md"), "utf8"),
    readFile(join(root, "site", "content.mjs"), "utf8")
  ]);

  for (const phrase of boundaryPhrases) {
    for (const surface of surfaces) {
      assert.match(surface, new RegExp(phrase, "i"), `${phrase} must remain explicit on every public security surface`);
    }
  }
});
