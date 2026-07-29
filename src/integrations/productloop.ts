import { CAPABILITIES } from "../capabilities.js";

/**
 * A structural description that ProductLoop hosts can inspect or translate
 * through a separately reviewed adapter. It is not a connector registration,
 * permission grant, or ProductLoop authority token.
 */
export interface ProductLoopBrowserCapabilitySnapshot {
  schemaVersion: "cockroach.productloop-capability-snapshot.v1";
  id: "cockroach-browser";
  displayName: "Cockroach Browser";
  description: string;
  kind: "browser-capability-snapshot";
  scope: "structural-only";
  transports: readonly ["sdk", "http", "mcp"];
  authority: {
    readonly lifecycle: "host";
    readonly governance: "maqam-when-routed";
    readonly rawRuntime: "host-policy";
  };
  capabilities: readonly string[];
}

export function productLoopBrowserCapabilitySnapshot(): ProductLoopBrowserCapabilitySnapshot {
  const authority = Object.freeze({
    lifecycle: "host",
    governance: "maqam-when-routed",
    rawRuntime: "host-policy"
  } as const);
  const capabilities = Object.freeze(CAPABILITIES.map((entry) => entry.id));

  return Object.freeze({
    schemaVersion: "cockroach.productloop-capability-snapshot.v1",
    id: "cockroach-browser",
    displayName: "Cockroach Browser",
    description: "Authorized browser sessions, structural observations, evidence, and optional Maqam-governed actions.",
    kind: "browser-capability-snapshot",
    scope: "structural-only",
    transports: ["sdk", "http", "mcp"] as const,
    authority,
    capabilities
  });
}
