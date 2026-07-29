/**
 * Internal dispatch authority used only by the in-package Maqam driver.
 *
 * This symbol is deliberately absent from the package export map. Raw SDK,
 * daemon, CLI, and MCP callers cannot manufacture this path accidentally.
 */
export const GOVERNANCE_DISPATCH = Symbol("cockroach-browser.governance-dispatch");

export interface GovernanceDispatch {
  authority: "maqam";
  approvalId: string;
  capabilityId: string;
  actionDigest: string;
  executionDigest: string;
  authorizedOrigins: readonly string[];
  prohibitedEffects: readonly string[];
}
