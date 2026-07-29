# ProductLoop OS

Describe a bounded browser capability without collapsing every ledger into one runtime.

A host-owned ProductLoop adapter can consume Cockroach Browser's structural capability snapshot while Maqam, Qarinah, Cockroach Crawler, ProductLoop, and the browser retain distinct contracts and records.

Public manual: https://cockroachbrowser.com/docs/productloop/

## Read the structural capability snapshot

productLoopBrowserCapabilitySnapshot() returns descriptive structural data for a host adapter: observations, proposals, effects, transports, supported Node releases, governance requirements, and lifecycle ownership. It is not a directly registerable ProductLoop connector manifest. Translate it into the exact versioned ProductLoop contract accepted by the installed release. The snapshot grants no origins, profiles, credentials, lifecycle, or action authority.

## Use Maqam as the gateway

Product workflows should call a Maqam-governed tool wrapper for consequential browser operations. Maqam governance applies only when the operation is actually routed through that adapter. Read-only structural adapters may expose bounded observations directly when their host policy allows it.

## Keep ledgers distinct

Browser evidence proves what Chromium observed and executed. Maqam proves the policy and approval path. Qarinah preserves cited project memory. ProductLoop coordinates packages and workflows. Stable IDs connect these records without pretending they are one database.

## Current status

The ProductLoop integration in 0.1.1 is a structural capability snapshot for a host-owned adapter, not direct connector registration. The browser runtime, SDK, CLI, HTTP API, MCP server, evidence chain, and local dashboard are implemented in the package.


## Release status

This manual targets Cockroach Browser 0.1.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
