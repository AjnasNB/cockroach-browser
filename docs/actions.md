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

Navigation, reload, back, forward, tab control, click, double-click, fill, type, press, select, check, uncheck, hover, focus, bounded scroll, low-level in-viewport mouse input, bounded keyboard input, drag, wait, dialog handling, session-history inspection, upload, download, extract, screenshot, PDF, tracing, and policy-gated JavaScript are available in the runtime.

Each action is classified by effect and risk before dispatch. High-risk actions belong behind Maqam approval.

## Target exact XPath and same-origin frames

Element actions accept exactly one semantic ref, CSS selector, or XPath. CSS and XPath actions may target one exact same-origin frame by index, name, or URL. Cross-origin frames remain unavailable, and a snapshot ref cannot be combined with a separate frame target because the ref already identifies its observed frame.

```
await browser.act(session.id, {
  kind: "fill",
  xpath: "//*[@id='account-name']",
  frame: { name: "account-panel" },
  value: "Ajnas",
  purpose: "Fill the reviewed same-origin account form"
});
```

## Handle dialogs explicitly

Undeclared JavaScript dialogs are dismissed. Accepting one requires allowDialogAccept and an exact approval even if the session otherwise removed default approval actions. Prompt text can come only from a bounded opaque host reference. Receipts report the dialog type, a bounded message, and whether the response was explicit.

## Inspect only this session's history

history.inspect returns sanitized URLs, titles, tab IDs, timestamps, and action sources observed in this session. maxHistoryEntries bounds retention. The action never discovers an ambient browser profile or the user's general browsing history.

## JavaScript is an explicit capability

Expression evaluation is disabled unless the session policy allows JavaScript and the action is approved when required. Do not use evaluation as a shortcut around origin, credential, file, or effect controls.

## Inspect a target without inventing a selector

query.inspect returns bounded text, raw element inner HTML, attributes, geometry, form state, visibility, enabled state, and match counts for one semantic ref, CSS selector, or XPath. It is read-only, policy-evaluated, and receipt-linked. Use extract.structured when sanitized HTML is required.

## Run an ordered bounded batch

A batch contains 1 to 100 exact actions. Every attempted step receives its own policy decision and receipt. Choose stop-on-error for dependent workflows or continue semantics for independent observations; a batch never creates a route around action policy.

```
cockroach-browser batch \
  --session "$SESSION_ID" \
  --input ./review-actions.json \
  --token-file .cockroach-browser/auth-token
```

## Emulate only what the session permits

emulation.set can apply bounded viewport, media, offline, geolocation, permissions, and non-secret headers after allowEmulation and exact approval. emulation.clear returns to the session baseline. These actions do not provide fingerprint evasion or access-control bypass.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
