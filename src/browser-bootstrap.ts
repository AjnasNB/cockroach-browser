import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const BROWSER_ENGINES = Object.freeze(["chromium", "firefox", "webkit"]);

export function browserEngineInstallCommand({
  execPath = process.execPath,
  playwrightEntry = require.resolve("playwright-core")
}: {
  execPath?: string;
  playwrightEntry?: string;
} = {}): { command: string; args: string[] } {
  return {
    command: execPath,
    args: [join(dirname(playwrightEntry), "cli.js"), "install", ...BROWSER_ENGINES]
  };
}

export async function installBrowserEngines(): Promise<void> {
  const { command, args } = browserEngineInstallCommand();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`Browser engine setup exited with ${code ?? `signal ${signal}`}.`)));
  });
}
