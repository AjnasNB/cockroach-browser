# Maqam integration

Cockroach Browser executes. Maqam decides whether execution is allowed.

The Maqam adapter presents a four-step browser driver: observe, preview, apply, and submit. Maqam remains the authority for policy, exact approval, replay protection, and governance receipts.

Public manual: https://cockroachbrowser.com/docs/maqam/

## Separate the authorities

The browser runtime owns Chromium, tabs, semantic refs, action execution, and browser evidence. Maqam owns registered tools, policy decisions, effect classification, exact one-use approvals, preview tokens, replay rejection, and governance records.

## Observe and preview

observe returns current page state and a stable revision. preview resolves the requested operation against that revision. If the target changed, the operation must be observed and previewed again.

## Apply or submit once

apply covers structural browser operations. submit covers form submission. The adapter carries operation IDs and rejects duplicate or stale execution. Unknown write outcomes are not retried automatically.

## Do not expose the managed session directly

A session placed behind the Maqam driver must remain host-owned. Do not expose its raw action endpoint or lifecycle methods to the same agent. The browser adapter is an execution boundary, not a second policy system.


## Release status

This manual targets Cockroach Browser 0.1.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
