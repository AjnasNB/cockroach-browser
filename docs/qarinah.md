# Qarinah integration

Turn browser outcomes into cited memory without turning memory into a dispatcher.

Qarinah can record sanitized browser outcomes, source URLs, receipt hashes, and evidence IDs so later agents retrieve compact, cited project context.

Public manual: https://cockroachbrowser.com/docs/qarinah/

## Record metadata, not browser secrets

The adapter removes cookies, storage values, form values, secret references, and hidden reasoning. It records the canonical input digest, output digest, browser receipt hash, evidence IDs, source URL, and bounded descriptive metadata as cited context links. The host supplies the persistence callback supported by its installed Qarinah release.

## Keep memory read-only with respect to the browser

Qarinah never creates a session, changes policy, approves an action, or dispatches a browser operation. A later memory query may inform a proposal, but Maqam and the browser boundary still decide execution.

## Link a causal receipt chain when it exists

A read outcome needs citations and receipt metadata, not a synthetic mutation chain. For consequential mutations, a host may connect public evidence, browser observation, Qarinah memory, Maqam decision, approved tool execution, observed result, and permanent receipt when every stage exists. The integration does not invent missing stages or require one cross-system transaction.

## Cross-tool context

The same cited memory pack can be consumed by coding agents and CLIs that support the Qarinah integration. Authority remains scoped by workspace and source provenance.


## Release status

This manual targets Cockroach Browser 0.4.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
