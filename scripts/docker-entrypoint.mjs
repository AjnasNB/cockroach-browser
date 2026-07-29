import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";

const daemon = spawn(
  process.execPath,
  [
    "dist/cli.js",
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    "43110",
    "--root",
    "/data",
    "--token-file",
    "/data/auth-token"
  ],
  { stdio: "inherit", shell: false }
);

const proxy = createServer((incoming) => {
  const local = createConnection({ host: "127.0.0.1", port: 43110 });
  incoming.on("error", () => local.destroy());
  local.on("error", () => incoming.destroy());
  incoming.pipe(local);
  local.pipe(incoming);
});

await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(43111, "0.0.0.0", () => {
    proxy.off("error", reject);
    resolve();
  });
});

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  proxy.close();
  daemon.kill(signal);
  setTimeout(() => daemon.kill("SIGKILL"), 5000).unref();
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const [code, signal] = await new Promise((resolve) => {
  daemon.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
});
proxy.close();
if (signal) process.kill(process.pid, signal);
process.exitCode = code ?? 1;
