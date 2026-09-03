# MCP

Give an MCP client observations and proposals, not browser ownership.

The native stdio server exposes health, capability and engine manifests, action preflight, sessions, snapshots, paired capture, bounded network observations, audits, and canonical action proposals. It does not expose raw profile management or direct mutation authority.

Public manual: https://cockroachbrowser.com/docs/mcp/

## Configure the local server

Start the authenticated daemon first. Load its token into the MCP process through trusted environment or secret handling, and point the MCP server at the daemon URL. Do not commit a live token.

```
{
  "mcpServers": {
    "cockroach-browser": {
      "command": "npx",
      "args": ["-y", "cockroach-browser@0.5.0-rc.1", "mcp"],
      "env": {
        "COCKROACH_BROWSER_URL": "http://127.0.0.1:43110",
        "COCKROACH_BROWSER_TOKEN": "<load from your secret store>"
      }
    }
  }
}
```

## Observation-first tools

The MCP surface provides browser_capabilities, browser_engines, browser_engine_preflight, browser_health, browser_sessions, browser_snapshot, browser_audit, browser_capture, browser_network, and browser_propose_action. Capture and network tools return bounded read evidence. A proposal returns canonical action material for a governed dispatcher and does not execute it.

## Preflight an exact engine and action set

browser_engines returns the same per-engine manifest as authenticated GET /v1/engines without launching a browser. browser_engine_preflight accepts an engine, one or more exact action kinds, and optional allowExperimental. It returns required capabilities, their supported, experimental, or unsupported states, acceptance decisions, and the unmet set. Experimental capabilities fail unless explicitly accepted; unsupported capabilities always fail. Neither tool creates a session or widens host policy.

## Keep lifecycle authority outside the model

Session creation, profile import, login, secret resolution, remote binding, and raw action dispatch stay with the host. This prevents a model from expanding its own origins, credentials, browser state, or resource ceilings.

## Route consequential work through Maqam

MCP proposes. Maqam evaluates policy, binds an approval to the exact operation, dispatches through the driver, rejects replay, and records governance evidence.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
