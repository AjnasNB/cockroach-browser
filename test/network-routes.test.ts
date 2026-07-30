import assert from "node:assert/strict";
import test from "node:test";
import { compileNetworkRoute, networkRouteMatches } from "../src/network-routes.js";

test("compiles exact-origin static routes without retaining response bodies in summaries", () => {
  const route = compileNetworkRoute(
    {
      id: "fixture-api",
      origin: "https://example.com",
      pathPattern: "/api/**",
      methods: ["GET"],
      resourceTypes: ["fetch", "xhr"],
      response: {
        action: "fulfill",
        status: 200,
        contentType: "application/json",
        body: "{\"ok\":true}"
      }
    },
    "fixture-api",
    1_024
  );

  assert.equal(route.summary.origin, "https://example.com");
  assert.equal(route.summary.response.bodyBytes, 11);
  assert.match(route.summary.response.bodyDigest ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal("body" in route.summary.response, false);
  assert.equal(
    networkRouteMatches(route, {
      url: "https://example.com/api/v1/items?secret=redacted",
      method: "GET",
      resourceType: "fetch"
    }),
    true
  );
  assert.equal(
    networkRouteMatches(route, {
      url: "https://other.example/api/v1/items",
      method: "GET",
      resourceType: "fetch"
    }),
    false
  );
  assert.equal(
    networkRouteMatches(route, {
      url: "https://example.com/api/v1/items",
      method: "POST",
      resourceType: "fetch"
    }),
    false
  );
});

test("rejects route definitions that widen origin authority or exceed body ceilings", () => {
  assert.throws(
    () =>
      compileNetworkRoute(
        {
          origin: "https://*.example.com",
          pathPattern: "/**",
          response: { action: "abort" }
        },
        "wildcard",
        1_024
      ),
    (error: unknown) => hasCode(error, "NETWORK_ROUTE_ORIGIN_INVALID")
  );
  assert.throws(
    () =>
      compileNetworkRoute(
        {
          origin: "https://example.com/path",
          pathPattern: "/**",
          response: { action: "abort" }
        },
        "path-origin",
        1_024
      ),
    (error: unknown) => hasCode(error, "NETWORK_ROUTE_ORIGIN_INVALID")
  );
  assert.throws(
    () =>
      compileNetworkRoute(
        {
          origin: "https://example.com",
          pathPattern: "/**",
          response: { action: "fulfill", body: "too large" }
        },
        "oversized",
        4
      ),
    (error: unknown) => hasCode(error, "NETWORK_ROUTE_BODY_EXCEEDED")
  );
});

function hasCode(error: unknown, expected: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
}
