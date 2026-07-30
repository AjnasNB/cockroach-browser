import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { BrowserClient } from "./client.js";
import { CAPABILITIES } from "./capabilities.js";
import { canonicalJson, sha256 } from "./canonical.js";
import type { BrowserAction } from "./contracts.js";

export interface BrowserMcpOptions {
  client?: BrowserClient;
  baseUrl?: string;
  token?: string;
}

/**
 * Observation-first MCP surface. Mutations are returned as canonical proposals
 * and must be dispatched through Maqam, never directly by this server.
 */
export async function startMcpServer(options: BrowserMcpOptions = {}): Promise<void> {
  const token = options.token ?? process.env.COCKROACH_BROWSER_TOKEN;
  const baseUrl = options.baseUrl ?? process.env.COCKROACH_BROWSER_URL;
  const client = options.client ?? (token
    ? new BrowserClient({ ...(baseUrl ? { baseUrl } : {}), token })
    : undefined);
  const server = new McpServer({ name: "cockroach-browser", version: "0.2.1" });

  server.registerTool(
    "browser_capabilities",
    {
      title: "List Cockroach Browser capabilities",
      description: "Returns the browser capability catalog and implementation status.",
      inputSchema: {
        status: z.enum(["available", "adapter", "planned"]).optional()
      }
    },
    async ({ status }) => result({
      capabilities: CAPABILITIES.filter((entry) => !status || entry.status === status)
    })
  );

  server.registerTool(
    "browser_health",
    {
      title: "Inspect browser daemon health",
      description: "Reads daemon, evidence, and session health. Requires an explicitly configured daemon token.",
      inputSchema: {}
    },
    async () => result(await requireClient(client).health())
  );

  server.registerTool(
    "browser_sessions",
    {
      title: "List authorized browser sessions",
      description: "Lists host-created sessions. MCP cannot create profiles, login, or expand origin authority.",
      inputSchema: {}
    },
    async () => result({ sessions: await requireClient(client).sessions() })
  );

  server.registerTool(
    "browser_snapshot",
    {
      title: "Read a semantic page snapshot",
      description: "Returns visible text and snapshot-scoped element references for an authorized session.",
      inputSchema: {
        sessionId: z.string().min(1),
        tabId: z.string().min(1).optional()
      }
    },
    async ({ sessionId, tabId }) => result(await requireClient(client).snapshot(sessionId, tabId))
  );

  server.registerTool(
    "browser_capture",
    {
      title: "Capture paired browser evidence",
      description: "Captures one screenshot and one semantic snapshot from the same authorized page state.",
      inputSchema: {
        sessionId: z.string().min(1),
        tabId: z.string().min(1).optional(),
        fullPage: z.boolean().optional(),
        requireStable: z.boolean().optional(),
        includeBounds: z.boolean().optional()
      }
    },
    async ({ sessionId, tabId, fullPage, requireStable, includeBounds }) => result(
      await requireClient(client).capture(sessionId, {
        ...(tabId ? { tabId } : {}),
        ...(fullPage === undefined ? {} : { fullPage }),
        ...(requireStable === undefined ? {} : { requireStable }),
        ...(includeBounds === undefined ? {} : { includeBounds })
      })
    )
  );

  server.registerTool(
    "browser_network",
    {
      title: "Inspect the browser network ledger",
      description: "Returns redacted request failures and responses retained for an authorized session.",
      inputSchema: {
        sessionId: z.string().min(1),
        tabId: z.string().min(1).optional(),
        method: z.string().min(1).max(32).optional(),
        status: z.number().int().min(0).max(999).optional(),
        resourceType: z.string().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(2_000).optional()
      }
    },
    async ({ sessionId, tabId, method, status, resourceType, limit }) => result(
      await requireClient(client).network(sessionId, {
        ...(tabId ? { tabId } : {}),
        ...(method ? { method } : {}),
        ...(status === undefined ? {} : { status }),
        ...(resourceType ? { resourceType } : {}),
        ...(limit === undefined ? {} : { limit })
      })
    )
  );

  server.registerTool(
    "browser_audit",
    {
      title: "Audit an authorized page",
      description: "Runs read-only accessibility, performance, asset, console, or security observations.",
      inputSchema: {
        sessionId: z.string().min(1),
        kinds: z.array(z.enum(["accessibility", "performance", "assets", "console", "security"])).optional()
      }
    },
    async ({ sessionId, kinds }) => result(await requireClient(client).audit(sessionId, kinds))
  );

  server.registerTool(
    "browser_propose_action",
    {
      title: "Prepare a Maqam browser proposal",
      description: "Canonicalizes an intended browser action for policy and exact approval. It does not execute the action.",
      inputSchema: {
        sessionId: z.string().min(1).max(128),
        action: MCP_ACTION_PROPOSAL,
        purpose: z.string().min(1).max(500)
      }
    },
    async ({ sessionId, action, purpose }) => {
      const proposal = {
        schemaVersion: "cockroach.browser-proposal.v1",
        sessionId,
        action: { ...action, purpose } as BrowserAction,
        purpose
      };
      return result({ proposal, inputDigest: sha256(canonicalJson(proposal)), dispatch: "maqam-required" });
    }
  );

  await server.connect(new StdioServerTransport());
}

const refField = z.string().min(1).max(128);
const tabField = z.string().min(1).max(128).optional();
const valueRefField = z.string().regex(/^ref:[A-Za-z0-9._:/-]{1,240}$/);
const purposeFree = {
  tabId: tabField
};
const MCP_ACTION_PROPOSAL = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), ...purposeFree, url: z.string().url().max(4_096) }).strict(),
  z.object({ kind: z.literal("tab.open"), url: z.string().url().max(4_096) }).strict(),
  z.object({ kind: z.literal("tab.close"), tabId: refField }).strict(),
  z.object({ kind: z.literal("tab.switch"), tabId: refField }).strict(),
  z.object({ kind: z.literal("back"), ...purposeFree }).strict(),
  z.object({ kind: z.literal("forward"), ...purposeFree }).strict(),
  z.object({ kind: z.literal("reload"), ...purposeFree }).strict(),
  z.object({ kind: z.literal("click"), ...purposeFree, ref: refField }).strict(),
  z.object({ kind: z.literal("doubleClick"), ...purposeFree, ref: refField }).strict(),
  z.object({ kind: z.literal("fill"), ...purposeFree, ref: refField, valueRef: valueRefField }).strict(),
  z.object({ kind: z.literal("type"), ...purposeFree, ref: refField, valueRef: valueRefField }).strict(),
  z.object({ kind: z.literal("press"), ...purposeFree, ref: refField.optional(), key: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("hover"), ...purposeFree, ref: refField }).strict(),
  z.object({ kind: z.literal("focus"), ...purposeFree, ref: refField }).strict(),
  z.object({ kind: z.literal("check"), ...purposeFree, ref: refField }).strict(),
  z.object({ kind: z.literal("uncheck"), ...purposeFree, ref: refField }).strict(),
  z.object({
    kind: z.literal("select"),
    ...purposeFree,
    ref: refField,
    values: z.array(z.string().min(1).max(200)).min(1).max(32)
  }).strict(),
  z.object({
    kind: z.literal("scroll"),
    ...purposeFree,
    ref: refField.optional(),
    deltaX: z.number().finite().min(-100_000).max(100_000).optional(),
    deltaY: z.number().finite().min(-100_000).max(100_000).optional()
  }).strict(),
  z.object({ kind: z.literal("drag"), ...purposeFree, ref: refField, targetRef: refField }).strict(),
  z.object({ kind: z.literal("wait"), ...purposeFree, timeoutMs: z.number().int().min(1).max(60_000) }).strict(),
  z.object({
    kind: z.literal("capture.paired"),
    ...purposeFree,
    fullPage: z.boolean().optional(),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    requireStable: z.boolean().optional(),
    includeBounds: z.boolean().optional()
  }).strict(),
  z.object({ kind: z.literal("annotate.show"), ...purposeFree }).strict(),
  z.object({ kind: z.literal("annotate.clear"), ...purposeFree }).strict(),
  z.object({ kind: z.literal("clipboard.read"), ...purposeFree }).strict(),
  z.object({
    kind: z.literal("clipboard.write"),
    ...purposeFree,
    valueRef: valueRefField
  }).strict(),
  z.object({
    kind: z.literal("network.inspect"),
    ...purposeFree,
    method: z.string().min(1).max(32).optional(),
    status: z.number().int().min(0).max(999).optional(),
    resourceType: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50_000).optional()
  }).strict(),
  z.object({
    kind: z.literal("network.export"),
    ...purposeFree,
    outputFormat: z.enum(["json", "ndjson", "har"]).optional(),
    method: z.string().min(1).max(32).optional(),
    status: z.number().int().min(0).max(999).optional(),
    resourceType: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50_000).optional()
  }).strict(),
  z.object({
    kind: z.literal("state.save"),
    ...purposeFree,
    stateName: refField,
    passphraseRef: valueRefField
  }).strict(),
  z.object({
    kind: z.literal("state.load"),
    ...purposeFree,
    stateName: refField,
    passphraseRef: valueRefField
  }).strict(),
  z.object({ kind: z.literal("state.list"), ...purposeFree }).strict(),
  z.object({
    kind: z.literal("state.delete"),
    ...purposeFree,
    stateName: refField
  }).strict(),
  z.object({
    kind: z.literal("tab.lock"),
    tabId: refField.optional(),
    lockOwner: z.string().min(1).max(200),
    lockTokenRef: valueRefField,
    lockTtlMs: z.number().int().min(1_000).max(86_400_000).optional()
  }).strict(),
  z.object({
    kind: z.literal("tab.unlock"),
    tabId: refField.optional(),
    lockTokenRef: valueRefField
  }).strict(),
  z.object({ kind: z.literal("tab.lock.status"), tabId: refField.optional() }).strict(),
  z.object({ kind: z.literal("screenshot"), ...purposeFree, fullPage: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("pdf"), ...purposeFree }).strict(),
  z.object({
    kind: z.literal("extract"),
    ...purposeFree,
    ref: refField.optional(),
    selector: z.string().min(1).max(512).optional(),
    xpath: z.string().min(1).max(1_024).optional()
  }).strict(),
  z.object({
    kind: z.literal("evaluate"),
    ...purposeFree,
    expression: z.string().min(1).max(65_536)
  }).strict()
]);

function requireClient(client: BrowserClient | undefined): BrowserClient {
  if (!client) {
    throw new Error("Set COCKROACH_BROWSER_TOKEN and optionally COCKROACH_BROWSER_URL before starting MCP.");
  }
  return client;
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
  };
}
