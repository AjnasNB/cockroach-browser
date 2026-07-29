# Capture and evidence

A browser result should be inspectable after the tab is gone.

Cockroach Browser records bounded artifacts and hash-chained receipts so a team can connect what the page showed, what the agent requested, what policy decided, and what changed.

Public manual: https://cockroachbrowser.com/docs/capture/

## Evidence types

Snapshots, screenshots, PDFs, Playwright traces, HAR files, console records, network metadata, downloads, audits, visual comparisons, and action records share one evidence index. Every record has a content type, byte size, digest, source URL when applicable, and structured metadata.

## Receipts form a chain

Each action receipt links to the previous receipt hash. The chain exposes missing, reordered, or modified records. Verification checks the chain and artifact digests without replaying the browser session.

## Capture only what the workflow needs

HAR, video, trace, console, and network capture can contain sensitive material. Enable them per session, apply evidence byte ceilings, and keep the evidence directory under deployment-owned access control.

## Carry evidence into memory

The Qarinah adapter records cited, metadata-only read outcomes and receipt metadata after filtering cookies, storage values, form values, and secrets. It does not dispatch browser actions or store hidden reasoning. A host may link a mutation outcome to a complete causal receipt chain when one exists, but the recorder does not require or synthesize that chain.


## Release status

This manual targets Cockroach Browser 0.1.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
