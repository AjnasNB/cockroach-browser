import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrowserClient } from "../src/client.js";
import { BROWSER_ENGINE_IDS } from "../src/engine-capabilities.js";
import { BrowserRuntime } from "../src/runtime.js";
import { startBrowserServer } from "../src/server.js";

test("the authenticated daemon and typed client expose exact engine negotiation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cockroach-engine-negotiation-"));
  const token = "engine-negotiation-token-000000000";
  const server = await startBrowserServer({
    runtime: new BrowserRuntime({ root }),
    port: 0,
    token
  });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const client = new BrowserClient({ baseUrl: server.url, token });
  const engines = await client.engines();
  assert.deepEqual(engines.map((engine) => engine.id), BROWSER_ENGINE_IDS);
  assert.equal(engines.find((engine) => engine.id === "lightpanda")?.capabilities["runtime.owned_launch"].state, "unsupported");

  const obscura = await client.engines("obscura");
  assert.equal(obscura.length, 1);
  assert.equal(obscura[0]?.id, "obscura");
  assert.equal(obscura[0]?.capabilities["runtime.owned_launch"].state, "experimental");

  const invalid = await fetch(`${server.url}/v1/engines?engine=unknown`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { error: { code: string } }).error.code, "ENGINE_INVALID");

  const openApiResponse = await fetch(`${server.url}/v1/openapi.json`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json() as {
    servers: Array<{ url: string }>;
    paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
  };
  assert.deepEqual(openApi.servers.map((server) => server.url), ["/"]);
  assert.deepEqual(Object.keys(openApi.paths).sort(), [
    "/v1/activity",
    "/v1/activity/stream",
    "/v1/artifacts/{id}",
    "/v1/capabilities",
    "/v1/engines",
    "/v1/errors",
    "/v1/evidence",
    "/v1/evidence/verify",
    "/v1/health",
    "/v1/jobs",
    "/v1/jobs/{id}",
    "/v1/jobs/{id}/cancel",
    "/v1/metrics",
    "/v1/openapi.json",
    "/v1/profiles",
    "/v1/profiles/{name}",
    "/v1/sessions",
    "/v1/sessions/{id}",
    "/v1/sessions/{id}/access",
    "/v1/sessions/{id}/access/grant",
    "/v1/sessions/{id}/access/revoke",
    "/v1/sessions/{id}/actions",
    "/v1/sessions/{id}/actions/batch",
    "/v1/sessions/{id}/audit",
    "/v1/sessions/{id}/capture",
    "/v1/sessions/{id}/challenge/resume",
    "/v1/sessions/{id}/compare",
    "/v1/sessions/{id}/navigation-graph",
    "/v1/sessions/{id}/network",
    "/v1/sessions/{id}/network/export",
    "/v1/sessions/{id}/resources",
    "/v1/sessions/{id}/snapshot"
  ]);
  const operations = Object.values(openApi.paths).flatMap((path) =>
    Object.entries(path)
      .filter(([method]) => ["get", "post", "delete"].includes(method))
      .map(([, operation]) => operation)
  );
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, operations.length);
  assert.equal(operations.every((operation) => Object.keys(operation.responses ?? {}).length > 0), true);
});
