# Sessions and profiles

A browser session is borrowed authority, not a reusable credential bucket.

Every bounded-runtime session has an owner, purpose, mode, HTTP(S) origin policy, action policy, effect policy, and finite application budget. Profiles are named, isolated, and imported only by an authorized operator.

Public manual: https://cockroachbrowser.com/docs/sessions/

## Choose the browser connection

Launch bundled Chromium, discover a reviewed system installation, supply a compatible executable, attach to a user-selected CDP endpoint, or explicitly start a separately installed Obscura engine. cockroach-browser browser discover reports Chrome, Edge, Brave, and Chromium candidates across Windows, macOS, Linux, ARM64, and Raspberry Pi hosts. Discovery never imports an ambient browser profile. CDP attachment remains explicit: the host names the endpoint and accepts responsibility for that browser.

- Bundled: package-managed Chromium.
- System: one reviewed installed browser channel.
- Custom: one explicit compatible executable and bounded arguments.
- CDP: attach to an explicitly selected debugging endpoint.
- Lightweight Obscura: start one explicit runtime-owned loopback process, with experimental opt-in and an optional reviewed SHA-256 pin.
- Lightpanda: inspect its manifest and machine preflight, but managed launch currently fails closed pending a complete engine- or OS-level egress boundary.
- Extensions: load reviewed unpacked directories in an isolated headed context.

```
cockroach-browser browser discover
```

## Negotiate the engine before launch

GET /v1/engines and BrowserClient.engines() return machine-readable manifests for Chromium, Firefox, WebKit, Obscura, and Lightpanda. Add ?engine=obscura or pass one engine ID to filter the result. MCP clients can use browser_engines and browser_engine_preflight. Preflight maps exact action kinds to required engine capabilities without launching a browser: supported work is admitted, experimental work requires explicit opt-in, and unsupported work always fails. The runtime.owned_launch entry is supported for the three full engines, experimental for Obscura, and unsupported for Lightpanda.

A successful preflight reports compatibility only. It creates no session, grants no origin or credential authority, and cannot prove how an arbitrary page will behave.

```
console.log(await browser.engines());
console.log(await browser.engines("obscura"));
```

## Use a lightweight lane only for compatible work

The managed Obscura provider is an experimental bounded-runtime lane, not a replacement for the full browser engines. Cockroach Browser never downloads its binary automatically and never accepts caller-supplied launch flags for this lane. With rendering: "none", Cockroach Browser denies visual actions during capability preflight; this policy does not assert that the selected Obscura binary disabled or omitted its renderer. Compatible non-visual sessions can navigate, execute JavaScript under policy, inspect DOM state, activate HTML elements, fill text controls, and perform bounded structured extraction. Screenshots, PDFs, video, visual pointer behavior, extensions, and persistent profiles require a deliberate full-engine session. Lightpanda configuration, manifest inspection, and machine preflight exist on current main, but managed launch fails closed pending a complete engine- or OS-level egress boundary.

The frozen September 3, 2026 RC1 proof used pinned Obscura 0.2.1, one warmup, and 20 measured launches per target. The 30 MiB target passed across 478 retained observations: 28,893,184-byte minimum, 29,347,840-byte median, 29,569,024-byte p95, and 29,622,272-byte maximum complete owned-browser-tree RSS, or 28.25 MiB. The 25 MiB target failed across 480 retained observations: 28,831,744-byte minimum, 29,323,264-byte median, 29,634,560-byte p95, and 29,679,616-byte maximum, or 28.30 MiB. Every required capability check passed across both targets and all 958 observations are retained. The proof binds source tree fb0c4597e39f319dd9b6f3bab02777c395e9d8d84906981bf939a39b470e7279, runtime build 6738efa4000ba482db83c9dc95ba2f21caed31de96f30dcd342e5dc722d86025, and harness 08a5294f2d446765f712b93c9bfaaca010b1d043ded638d1f4f57b5038c97e86. Coordinator RSS was measured separately. This is not a whole-app, arbitrary-page, rendered-page, or full-browser memory guarantee.

```
const session = await browser.createSession({
  purpose: "Extract one reviewed documentation page",
  engine: "chromium",
  mode: "headless",
  browserProvider: {
    kind: "lightweight",
    implementation: "obscura",
    executablePath: "C:/reviewed/obscura.exe",
    expectedSha256: "sha256:<reviewed digest>",
    rendering: "none",
    resourceProfile: "constrained",
    allowExperimentalCapabilities: true
  },
  policy: {
    allowedOrigins: ["https://example.com"],
    allowedActions: ["navigate", "snapshot", "extract.structured"]
  }
});
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

The default budget limits actions, session duration, tabs, download bytes, upload bytes, snapshot characters, retained history, network rules, static intercepted responses, and evidence bytes. Narrow these limits for each workflow. Action and byte ceilings are application-enforced; browser RSS and CPU are periodically sampled telemetry rather than a real-time kernel boundary.

## Close deliberately

A successful close terminates the runtime-owned process before publishing terminal lifecycle telemetry, then releases tabs, browser context, traces, and runtime state. If owned-process termination cannot be verified, the session remains failed and retained with TERMINATION_UNVERIFIED, including any persistent-profile writer lock, so an explicit close can retry. Persist a profile only when the operator requested it. Qarinah records cited outcomes and Maqam records governance receipts, but neither receives raw profile material.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
