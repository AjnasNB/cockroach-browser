import { spawn } from "node:child_process";
import { createRequire } from "node:module";

export async function runPlaywrightCli(command: "codegen" | "test", args: readonly string[]): Promise<never> {
  const require = createRequire(import.meta.url);
  const cli = require.resolve("@playwright/test/cli");
  const child = spawn(process.execPath, [cli, command, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: false
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright ${command} terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
  process.exit(exitCode);
}

