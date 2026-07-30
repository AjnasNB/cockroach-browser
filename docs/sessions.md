# Sessions and profiles

A browser session is borrowed authority, not a reusable credential bucket.

Every session has an owner, purpose, mode, origin boundary, action boundary, effect boundary, and finite budget. Profiles are named, isolated, and imported only by an authorized operator.

Public manual: https://cockroachbrowser.com/docs/sessions/

## Choose the browser connection

Launch bundled Chromium in headless or headed mode, supply a compatible executable, or attach to a user-selected CDP endpoint. CDP attachment is never discovered automatically. The host names the endpoint and accepts responsibility for that browser.- Headless: unattended evidence and audits.
- Headed: review, login, consent, and human handoff.
- CDP: attach to an explicitly selected Chrome debugging endpoint.
- Custom executable: use a compatible browser binary selected by the operator.

## Keep profiles explicit and encrypted

Profiles isolate cookies and storage. Import and export require an explicit name, file path, and passphrase supplied through an environment variable. Passphrases are not accepted as command arguments and are not written to manifests.

```
export COCKROACH_BROWSER_PROFILE_PASSPHRASE="read-from-your-secret-store"
npx cockroach-browser profile import \
  --name reviewed-support-session \
  --file ./storage-state.json

npx cockroach-browser profile list
```

## Checkpoint only the current authorized session

Named state checkpoints save and restore the current session's admitted storage state beneath the deployment-owned data root. They are encrypted, size-bounded, and never discover ambient browser profiles. A checkpoint name cannot contain a path, and restoring it does not widen the session origin or action policy.

```
await browser.act(session.id, {
  kind: "state.save",
  name: "after-reviewed-login",
  purpose: "Save the exact authorized session state"
});

await browser.act(session.id, {
  kind: "state.load",
  name: "after-reviewed-login",
  purpose: "Restore the reviewed checkpoint"
});
```

## Keep clipboard and tabs under policy

Clipboard reads and writes are separate actions with bounded text output and secret-value references. Exclusive tab locks prevent two workers from silently controlling the same tab; lock, unlock, and status operations remain session-local and receipt-linked.

## Budget every session

The default budget limits actions, session duration, tabs, download bytes, upload bytes, snapshot characters, retained history, network rules, static intercepted responses, and evidence bytes. Narrow these limits for each workflow. A budget is a hard stop, not a billing estimate.

## Close deliberately

Closing a session releases tabs, browser context, traces, and runtime state. Persist a profile only when the operator requested it. Qarinah records cited outcomes and Maqam records governance receipts, but neither receives raw profile material.


## Release status

This manual targets Cockroach Browser 0.2.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
