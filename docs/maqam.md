# Maqam integration

Cockroach Browser executes. Maqam decides whether execution is allowed.

For operations routed through its adapter, Maqam presents a four-step browser driver: observe, preview, apply, and submit, then applies policy, exact approval, replay protection, and governance receipts.

Public manual: https://cockroachbrowser.com/docs/maqam/

## Separate the authorities

The browser runtime owns Chromium, tabs, semantic refs, action execution, and browser evidence. For operations routed through the adapter, Maqam owns registered tools, policy decisions, effect classification, exact one-use approvals, preview tokens, replay rejection, and governance records.

## Observe and preview

observe returns current page state and a stable revision. preview resolves the requested operation against that revision. If the target changed, the operation must be observed and previewed again.

## Apply or submit once

apply covers structural browser operations. submit covers form submission. The adapter carries operation IDs and rejects duplicate or stale execution. Unknown write outcomes are not retried automatically.

## Register every additional effect as an exact tool

Uploads, downloads, clipboard writes, JavaScript, state restore, network interception, PDF generation, and other high-risk actions are runtime capabilities, not implicit Maqam driver methods. A host that exposes one must register a typed Maqam tool with an exact input schema, effect class, policy, approval rule, and receipt mapping.

## Do not expose the managed session directly

A session placed behind the Maqam driver must remain host-owned. Do not expose its raw action endpoint or lifecycle methods to the same agent. Maqam governance covers only operations routed through this adapter; trusted-host SDK calls and explicitly enabled raw-action routes remain separate host authority. The browser adapter is an execution boundary, not a second policy system.


## Release status

This manual targets Cockroach Browser 0.4.0-rc.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
