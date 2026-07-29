# Qarinah integration

Turn browser outcomes into cited memory without turning memory into a dispatcher.

Qarinah can record sanitized browser outcomes, source URLs, receipt hashes, and evidence IDs so later agents retrieve compact, cited project context.

Public manual: https://cockroachbrowser.com/docs/qarinah/

## Record metadata, not browser secrets

The adapter removes cookies, storage values, form values, secret references, and hidden reasoning. It records the purpose, selected source, outcome, receipt hash, and evidence pointers needed to verify the memory.

## Keep memory read-only with respect to the browser

Qarinah never creates a session, changes policy, approves an action, or dispatches a browser operation. A later memory query may inform a proposal, but Maqam and the browser boundary still decide execution.

## Use a causal receipt chain

Connect public evidence, browser observation, Qarinah memory, Maqam decision, approved tool execution, observed result, and permanent receipt with stable IDs. This creates a reviewable path without claiming a single cross-system transaction.

## Cross-tool context

The same cited memory pack can be consumed by coding agents and CLIs that support the Qarinah integration. Authority remains scoped by workspace and source provenance.


## Release status

This manual targets Cockroach Browser 0.1.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
