import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await json("package.json");
const glama = await json("glama.json");
const dockerfile = await readFile(resolve(root, "Dockerfile.glama"), "utf8");

assert.equal(glama.$schema, "https://glama.ai/mcp/schemas/server.json");
assert.deepEqual(glama.maintainers, ["AjnasNB"]);

for (const contract of [
  "COPY package.json package-lock.json ./",
  "RUN npm ci --omit=dev --ignore-scripts",
  'ENTRYPOINT ["node", "dist/cli.js"]',
  'CMD ["mcp"]'
]) {
  assert.ok(dockerfile.includes(contract), `Dockerfile.glama is missing: ${contract}`);
}

const expectedTools = [
  "browser_audit",
  "browser_capabilities",
  "browser_capture",
  "browser_health",
  "browser_network",
  "browser_propose_action",
  "browser_sessions",
  "browser_snapshot"
];
const image = process.env.COCKROACH_BROWSER_GLAMA_IMAGE?.trim();
if (image && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(image)) {
  throw new Error("COCKROACH_BROWSER_GLAMA_IMAGE is not a valid local image reference");
}
const stderr = [];
const transport = new StdioClientTransport({
  command: image ? "docker" : process.execPath,
  args: image
    ? ["run", "--rm", "--interactive", image]
    : [resolve(root, "dist", "cli.js"), "mcp"],
  cwd: root,
  stderr: "pipe"
});
transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
const client = new Client({ name: "cockroach-browser-glama-check", version: packageJson.version });

try {
  await client.connect(transport, { timeout: 10_000 });
  assert.deepEqual(client.getServerVersion(), {
    name: "cockroach-browser",
    version: packageJson.version
  });

  const result = await client.listTools({}, { timeout: 10_000 });
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), expectedTools);
  for (const tool of result.tools) {
    assert.ok(tool.title, `${tool.name} must expose a title`);
    assert.ok(tool.description, `${tool.name} must expose a description`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} must expose an object input schema`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: image ? "container" : "local-process",
    server: client.getServerVersion(),
    tools: expectedTools
  }, null, 2)}\n`);
} catch (error) {
  const serverStderr = stderr.join("").trim();
  if (serverStderr) process.stderr.write(`${serverStderr}\n`);
  throw error;
} finally {
  await client.close();
}

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}
