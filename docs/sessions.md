# Sessions and profiles

A browser session is borrowed authority, not a reusable credential bucket.

Every session has an owner, purpose, mode, origin boundary, action boundary, effect boundary, and finite budget. Profiles are named, isolated, and imported only by an authorized operator.

Public manual: https://cockroachbrowser.com/docs/sessions/

## Choose the browser connection

Launch bundled Chromium, discover a reviewed system installation, supply a compatible executable, or attach to a user-selected CDP endpoint. cockroach-browser browser discover reports Chrome, Edge, Brave, and Chromium candidates across Windows, macOS, Linux, ARM64, and Raspberry Pi hosts. Discovery never imports an ambient browser profile. CDP attachment remains explicit: the host names the endpoint and accepts responsibility for that browser.- Bundled: package-managed Chromium.
- System: one reviewed installed browser channel.
- Custom: one explicit compatible executable and bounded arguments.
- CDP: attach to an explicitly selected debugging endpoint.
- Extensions: load reviewed unpacked directories in an isolated headed context.

```
cockroach-browser browser discover
```

## Create an explicit persistent profile

Persistent profiles preserve cookies, permissions, extension state, and browser storage across headed sessions in a runtime-owned user-data directory. They are never found by scanning a user's normal Chrome or Brave profile. A profile has one active writer, cannot be combined with remote CDP attachment or imported storage state, and can be archived through an exact recoverable operation.

```
cockroach-browser persistent-profile create --name support-review
cockroach-browser persistent-profile list
cockroach-browser persistent-profile archive --name support-review
```

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

This manual targets Cockroach Browser 0.3.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
