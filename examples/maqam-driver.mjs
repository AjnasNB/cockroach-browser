import { createMaqamBrowserDriver } from "cockroach-browser/maqam";

export function attachCockroachBrowserToMaqam(runtime, secretStore, maqamAuthority) {
  return createMaqamBrowserDriver({
    runtime,
    async resolveValueRef(reference) {
      if (!reference.startsWith("ref:")) throw new Error("Opaque value reference required");
      return secretStore.resolve(reference);
    },
    async verifyExecution(request) {
      return maqamAuthority.verifyExecution(request);
    },
    async verifyPlanToken(request) {
      return maqamAuthority.verifyPlanToken(request);
    }
  });
}

// Register the returned observe, preview, apply, and submit driver with Maqam.
// The authority callbacks must verify a trusted ledger record or signature;
// never return true based only on the request's field shapes.
// Keep runtime session creation, profiles, login, proxies, and secret resolution
// in the trusted host. Do not expose them as agent or MCP tools.
