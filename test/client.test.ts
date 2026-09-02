import assert from "node:assert/strict";
import test from "node:test";
import { BrowserClient } from "../src/client.js";

test("normalizes arbitrarily long trailing-slash input in linear time", () => {
  const origin = "https://browser.example.test";
  const client = new BrowserClient({
    baseUrl: `${origin}${"/".repeat(100_000)}`,
    token: "test-token"
  });

  assert.equal(client.baseUrl, origin);
});
