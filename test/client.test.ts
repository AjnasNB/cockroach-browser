import assert from "node:assert/strict";
import test from "node:test";
import { BrowserClient } from "../src/client.js";

test("normalizes arbitrarily long trailing slash runs in one pass", () => {
  const client = new BrowserClient({
    baseUrl: `https://browser.example${"/".repeat(100_000)}`,
    token: "fixture-token"
  });

  assert.equal(client.baseUrl, "https://browser.example");
});

test("preserves non-trailing slashes in the configured base URL", () => {
  const client = new BrowserClient({
    baseUrl: "https://browser.example/tenant/api///",
    token: "fixture-token"
  });

  assert.equal(client.baseUrl, "https://browser.example/tenant/api");
});
