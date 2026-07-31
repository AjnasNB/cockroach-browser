# Capture and evidence

A browser result should be inspectable after the tab is gone.

Cockroach Browser records bounded artifacts and hash-chained receipts so a team can connect what the page showed, what the agent requested, what policy decided, and what changed.

Public manual: https://cockroachbrowser.com/docs/capture/

## Evidence types

Snapshots, screenshots, paired visual-plus-semantic captures, PDFs, Playwright traces, HAR files, console records, network metadata, downloads, audits, visual comparisons, annotations, and action records share one evidence index. Every record has a content type, byte size, digest, source URL when applicable, and structured metadata.

## Capture the pixels and the cited page state together

capture.paired records a screenshot and semantic snapshot under one receipt. requireStable rejects a capture when the page revision changes during collection. Optional element bounds connect numbered semantic refs to visible regions without turning coordinates into long-lived selectors.

```
npx cockroach-browser capture \
  --session "$SESSION_ID" \
  --require-stable \
  --include-bounds \
  --token-file .cockroach-browser/auth-token
```

## Add temporary review annotations

annotate.show overlays bounded numbered markers for reviewed refs, CSS selectors, or XPath targets. annotate.clear removes only Cockroach Browser's temporary overlay. Annotation actions are explicit, receipt-linked, and do not alter application data.

## Receipts form a chain

Each action receipt links to the previous receipt hash. The chain exposes missing, reordered, or modified records. Verification checks the chain and artifact digests without replaying the browser session.

## Capture only what the workflow needs

HAR, video, trace, console, and network capture can contain sensitive material. Enable them per session, apply evidence byte ceilings, and keep the evidence directory under deployment-owned access control.

## Carry evidence into memory

The Qarinah adapter records canonical input and output digests, evidence IDs, the browser receipt hash, and bounded descriptive metadata after filtering cookies, storage values, form values, and secrets. It does not dispatch browser actions or store hidden reasoning. A host may link a mutation outcome to a complete causal receipt chain when one exists, but the recorder does not require or synthesize that chain.


## Release status

This manual targets Cockroach Browser 0.3.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
