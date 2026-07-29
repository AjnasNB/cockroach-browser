import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITIES } from "../src/capabilities.js";
import { createCrawlerHandoff } from "../src/integrations/crawler.js";
import * as productLoopIntegration from "../src/integrations/productloop.js";

test("crawler handoff forwards only crawler-owned fields and returns the raw result", async () => {
  let forwarded: unknown;
  const crawlerResult = Object.freeze({
    pages: [{ url: "https://docs.example.com/start" }],
    failures: []
  });
  const handoff = createCrawlerHandoff({
    async crawlDetailed(input) {
      forwarded = structuredClone(input);
      return crawlerResult;
    }
  });

  const result = await handoff.crawl({
    seeds: ["https://docs.example.com/start"],
    allowedOrigins: ["https://docs.example.com"],
    maxPages: 12,
    purpose: "Collect cited documentation for a local browser receipt"
  });

  assert.deepEqual(forwarded, {
    seeds: ["https://docs.example.com/start"],
    allowedOrigins: ["https://docs.example.com"],
    maxPages: 12
  });
  assert.deepEqual(
    Object.keys(forwarded as Record<string, unknown>).sort(),
    ["allowedOrigins", "maxPages", "seeds"]
  );
  assert.equal("purpose" in (forwarded as Record<string, unknown>), false);
  assert.strictEqual(result, crawlerResult);
});

test("ProductLoop projection is a structural capability snapshot, not registration authority", () => {
  assert.equal("productLoopBrowserManifest" in productLoopIntegration, false);
  assert.equal(
    typeof productLoopIntegration.productLoopBrowserCapabilitySnapshot,
    "function"
  );

  const snapshot = productLoopIntegration.productLoopBrowserCapabilitySnapshot();

  assert.equal(
    snapshot.schemaVersion,
    "cockroach.productloop-capability-snapshot.v1"
  );
  assert.equal(snapshot.kind, "browser-capability-snapshot");
  assert.equal(snapshot.scope, "structural-only");
  assert.deepEqual(snapshot.transports, ["sdk", "http", "mcp"]);
  assert.deepEqual(snapshot.authority, {
    lifecycle: "host",
    governance: "maqam-when-routed",
    rawRuntime: "host-policy"
  });
  assert.deepEqual(
    snapshot.capabilities,
    CAPABILITIES.map((capability) => capability.id)
  );
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.authority), true);
  assert.equal(Object.isFrozen(snapshot.capabilities), true);

  const projection = snapshot as unknown as Record<string, unknown>;
  for (const authorityClaim of [
    "permissions",
    "registration",
    "registered",
    "register",
    "connectorManifest",
    "dispatch"
  ]) {
    assert.equal(
      authorityClaim in projection,
      false,
      `structural snapshot must not expose ${authorityClaim}`
    );
  }
});
