import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserProvider } from "../src/browser-discovery.js";
import type { BrowserProviderInput } from "../src/contracts.js";
import { CockroachBrowserError } from "../src/errors.js";

function uncheckedProvider(value: unknown): BrowserProviderInput {
  return value as BrowserProviderInput;
}

function rejectsWithCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof CockroachBrowserError);
    assert.equal(error.code, code);
    return true;
  };
}

test("raw browser providers reject null, arrays, and unknown discriminators", async () => {
  for (const value of [null, [], ["bundled"]]) {
    await assert.rejects(
      resolveBrowserProvider(uncheckedProvider(value)),
      rejectsWithCode("BROWSER_PROVIDER_INVALID")
    );
  }

  for (const value of [{}, { kind: null }, { kind: "unknown" }]) {
    await assert.rejects(
      resolveBrowserProvider(uncheckedProvider(value)),
      rejectsWithCode("BROWSER_PROVIDER_KIND_INVALID")
    );
  }
});

test("each provider variant rejects foreign and unknown properties before value processing", async () => {
  const invalidProviders = [
    { kind: "bundled", cdpEndpoint: undefined },
    { kind: "system", executablePath: undefined },
    { kind: "custom", channel: undefined },
    { kind: "cdp", cdpEndpoint: false, arguments: "not-an-array" },
    { kind: "lightweight", implementation: "obscura", executablePath: "ignored", allowExperimentalCapabilities: true, persistentProfile: undefined },
    { kind: "bundled", unrecognizedSetting: true }
  ];

  for (const provider of invalidProviders) {
    await assert.rejects(
      resolveBrowserProvider(uncheckedProvider(provider)),
      rejectsWithCode("BROWSER_PROVIDER_PROPERTY_DENIED")
    );
  }
});

test("known provider fields receive bounded runtime type validation", async () => {
  const invalidProviders = [
    { kind: "bundled", arguments: "--headless" },
    { kind: "bundled", extensions: ["reviewed", 7] },
    { kind: "system", channel: "nightly" },
    { kind: "custom", executablePath: 7 },
    { kind: "cdp", cdpEndpoint: 7 },
    { kind: "lightweight", implementation: 7, executablePath: "ignored", allowExperimentalCapabilities: true }
  ];

  for (const provider of invalidProviders) {
    await assert.rejects(
      resolveBrowserProvider(uncheckedProvider(provider)),
      rejectsWithCode("BROWSER_PROVIDER_FIELD_INVALID")
    );
  }
});

test("omitting browserProvider preserves the legacy top-level CDP path", async () => {
  assert.deepEqual(
    await resolveBrowserProvider(undefined, { cdpEndpoint: "http://127.0.0.1:9222" }),
    {
      cdpEndpoint: "http://127.0.0.1:9222",
      arguments: [],
      extensions: []
    }
  );
});
