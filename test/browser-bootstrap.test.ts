import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { browserEngineInstallCommand } from "../src/browser-bootstrap.js";

test("browser installation invokes the Playwright JavaScript CLI through Node", () => {
  const playwrightEntry = join(process.cwd(), "node_modules", "playwright-core", "index.js");
  const command = browserEngineInstallCommand({
    execPath: process.execPath,
    playwrightEntry
  });
  assert.deepEqual(command, {
    command: process.execPath,
    args: [
      join(dirname(playwrightEntry), "cli.js"),
      "install",
      "chromium",
      "firefox",
      "webkit"
    ]
  });
  assert.equal(command.command.endsWith(".cmd"), false);
});
