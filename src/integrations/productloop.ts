import { CAPABILITIES } from "../capabilities.js";

export interface ProductLoopBrowserManifest {
  schemaVersion: "productloop.connector.v1";
  id: "cockroach-browser";
  displayName: "Cockroach Browser";
  description: string;
  transports: readonly ["sdk", "http", "mcp"];
  permissions: {
    default: "deny";
    governance: "maqam-required-for-writes";
    lifecycle: "host-only";
  };
  capabilities: readonly string[];
}

export function productLoopBrowserManifest(): ProductLoopBrowserManifest {
  return Object.freeze({
    schemaVersion: "productloop.connector.v1",
    id: "cockroach-browser",
    displayName: "Cockroach Browser",
    description: "Authorized browser sessions, structural observations, evidence, and Maqam-governed actions.",
    transports: ["sdk", "http", "mcp"] as const,
    permissions: {
      default: "deny",
      governance: "maqam-required-for-writes",
      lifecycle: "host-only"
    } as const,
    capabilities: CAPABILITIES.map((entry) => entry.id)
  });
}
