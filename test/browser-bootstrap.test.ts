import assert from "node:assert/strict";
import test from "node:test";
import { browserEngineInstallCommand } from "../src/browser-bootstrap.js";

test("browser installation invokes the Playwright JavaScript CLI through Node", () => {
  const command = browserEngineInstallCommand({
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    playwrightEntry: "D:\\app\\node_modules\\playwright-core\\index.js"
  });
  assert.deepEqual(command, {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [
      "D:\\app\\node_modules\\playwright-core\\cli.js",
      "install",
      "chromium",
      "firefox",
      "webkit"
    ]
  });
  assert.equal(command.command.endsWith(".cmd"), false);
});
