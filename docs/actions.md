# Actions and semantic refs

Observe first. Select a cited element. Act on exactly that target.

Semantic snapshots turn visible page state into compact references with roles and accessible names. Each reference is bound to the observed page revision, so agents refresh the snapshot after page state changes instead of guessing viewport coordinates.

Public manual: https://cockroachbrowser.com/docs/actions/

## Snapshot before action

A snapshot includes the current URL, title, bounded readable text, semantic references, challenge state, a digest, and a truncation flag. Open shadow roots and readable same-origin frames are included. Cross-origin frames retain their browser boundary.

## Use a ref from the current snapshot

Refs make the action target inspectable. A click receipt records the canonical input digest, output digest, policy digest, URLs before and after, evidence IDs, and the previous receipt hash.

```
const snapshot = await browser.snapshot(session.id);
const releaseLink = snapshot.refs.find(
  (ref) => ref.role === "link" && ref.name.includes("Release notes")
);

if (!releaseLink) throw new Error("Release link was not present");

const result = await browser.act(session.id, {
  kind: "click",
  ref: releaseLink.ref,
  purpose: "Open the release notes selected from cited page state"
});

console.log(result.receipt.receiptHash);
```

## Supported interactions

Navigation, reload, back, forward, tab control, click, double-click, fill, type, press, select, check, uncheck, hover, focus, bounded scroll, drag, wait, upload, download, extract, screenshot, PDF, tracing, and policy-gated JavaScript are available in the runtime.Each action is classified by effect and risk before dispatch. High-risk actions belong behind Maqam approval.

## JavaScript is an explicit capability

Expression evaluation is disabled unless the session policy allows JavaScript and the action is approved when required. Do not use evaluation as a shortcut around origin, credential, file, or effect controls.


## Release status

This manual targets Cockroach Browser 0.1.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
