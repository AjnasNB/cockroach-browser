# Changelog

All notable changes to Cockroach Browser are documented here.

The format follows Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

## [0.5.0-rc.1] - 2026-09-03

### Added

- explicit runtime-owned Obscura and Lightpanda CDP providers with loopback-only
  startup, optional executable digest pinning, capability preflight, and owned
  process-tree cleanup
- bounded structured extraction for sanitized text, HTML, Markdown, links,
  metadata, JSON-LD, and tables
- continuous browser process-tree sampling and a fail-closed lightweight
  conformance benchmark that reports browser and coordinator memory separately

### Changed

- browser capabilities now describe a routed union across full Playwright and
  Puppeteer engines, protocol and device adapters, and experimental lightweight
  engines instead of implying one engine implements every browser feature
- public action and session schemas now track the runtime action and provider
  contracts, including lightweight-provider opt-in and configuration limits

### Verification

- lightweight benchmark results include exact binary identity, machine data,
  warm-up and measured runs, required DOM/JavaScript/form checks, continuous
  peak RSS and CPU observations, and a non-zero exit when any target fails

## [0.4.1] - 2026-08-15

### Fixed

- npm packaging now removes Python bytecode, Java `target`, and .NET `bin`/`obj`
  outputs created by the cross-language SDK verification lane before computing
  or publishing the immutable package artifact
- package validation rejects generated SDK build and cache paths so release
  checks cannot silently attest a dirty post-build package

### Verification

- the tag workflow rebuilds and checks the package after all language SDK
  builds, before computing npm SHA-1/SHA-512 identity and publishing provenance

## [0.4.0] - 2026-08-14

### Added

- stable Chromium, Firefox, and WebKit execution across the bounded runtime,
  complete pinned Playwright and Puppeteer compatibility surfaces, raw browser
  protocols, agent/model integration, mobile WebDriver, managed-fleet adapters,
  language SDKs, and deterministic release inventories first validated in the
  `0.4.0-rc.1` release candidate

### Fixed

- Windows three-engine bootstrap now invokes the installed Playwright
  JavaScript CLI through the current Node executable instead of spawning a
  shell-specific command shim

### Verification

- all three installed engines, the Puppeteer compatibility lane, Node 22/24/26,
  hardened-container smoke, language SDK builds, generated documentation, and
  the immutable npm/GitHub release identity are release gates

## [0.4.0-rc.1] - 2026-08-10

### Added

- a page-less authorized challenge-resolution callback with bounded deadlines,
  exact approval, independent post-handoff verification, MCP proposals, and
  hash-linked action receipts
- Chromium, Firefox, and WebKit execution in the bounded runtime and local
  process fleet, with deterministic installed-engine integration tests
- complete pinned Playwright Core 1.62.1 and Puppeteer Core 25.5.0 re-exports,
  Playwright Test, code generation, raw CDP, and raw WebDriver BiDi surfaces
- operator-level handles, targets, workers, events, locators, assertions,
  network mutation, response rewriting, WebSocket routing, HAR replay,
  coverage, heap snapshots, tracing, screencasting, profiling, and emulation
  through the upstream compatibility subpaths
- a raw W3C WebDriver/Appium client for operator-supplied Safari, iOS, Android,
  and vendor-specific mobile endpoints
- an optional OpenAI-compatible model gateway and finite-step browser agent
  that still dispatches through the bounded runtime policy and receipt path
- a working local three-engine fleet, authenticated managed-fleet adapter,
  explicit residential/static/custom proxy classes, provider-authorized
  challenge mode, and validated live-view leases
- dependency-light authenticated daemon clients for Python, Java, .NET/C#,
  Ruby, and Go alongside the native TypeScript SDK
- a generated machine-readable Playwright/Puppeteer declaration inventory and
  public API-surface page, checked for package-version and declaration drift

### Changed

- bootstrap and doctor now provision and verify Chromium, Firefox, and WebKit
  instead of checking only Chromium
- the source-derived registry now contains 124 entries: 114 directly
  available surfaces and 10 explicit external-adapter surfaces

## [0.3.0] - 2026-07-31

### Added

- cross-platform discovery for reviewed Chrome, Edge, Brave, and Chromium
  installations on Windows, macOS, Linux, ARM64, and Raspberry Pi hosts
- explicit bundled, system, custom-executable, and CDP browser providers with
  authority-expanding launch arguments rejected before dispatch
- reviewed unpacked extension loading in isolated headed contexts
- runtime-owned persistent browser profiles with single-writer locking,
  explicit preparation, and recoverable archival
- bounded element inspection for text, cleaned HTML, attributes, geometry,
  form state, visibility, enabled state, and counts
- policy-evaluated device and network emulation with exact approval and a
  deterministic clear operation
- ordered action batches of up to 100 steps with a separate policy decision and
  receipt for every attempted action
- explicit cache, console, and network clearing without deleting committed
  evidence
- session navigation graphs and a bounded lifecycle activity ledger with
  polling and server-sent-event surfaces
- authenticated OpenAPI discovery, Prometheus-compatible metrics, and a
  bounded error view
- an opt-in authenticated job API backed by the crash-resumable local queue,
  with per-session role checks and safe automatic retries limited to reads
- capacity- and tag-aware routing across authenticated browser workers
- persistent team session ownership with revocable viewer and operator roles,
  without sharing raw profile material
- CLI commands for browser discovery, navigation graphs, activity, ordered
  batches, persistent profile lifecycle, and file-backed team authorization
- dashboard views for runtime-owned profiles and the bounded activity stream
- complete operator-runtime documentation and a 94-entry source-derived
  capability registry

### Security

- persistent profiles are never discovered from ambient user browser data and
  cannot be combined with CDP attachment or imported storage state
- non-loopback workers require HTTPS and strong bearer tokens
- emulation, custom providers, extensions, JavaScript, and action batches do
  not widen origin, credential, effect, or resource authority
- access challenges continue to stop for human or authorized resolver handoff;
  the runtime does not add CAPTCHA or access-control bypass
- team actor tokens cannot read another session's evidence or artifacts

## [0.2.1] - 2026-07-30

### Changed

- aligned the npm package, website, documentation, social metadata, and hosted
  globe-and-cockroach identity on the launch promise: "The browser runtime your
  AI agents can use without inheriting your whole machine."
- tightened the homepage hero so the product promise and first runnable command
  remain readable without overwhelming the initial viewport
- published the implementation-backed technical paper and its downloadable PDF
  alongside the complete 80-capability documentation

## [0.2.0] - 2026-07-30

### Added

- paired screenshot and semantic-snapshot capture with optional stability
  rejection and semantic-reference bounds
- bounded, redacted network inspection and JSON, NDJSON, or HAR-compatible
  evidence export through the SDK, HTTP API, CLI, and MCP
- encrypted named session-state checkpoints, policy-gated clipboard access,
  exclusive tab leases, and temporary semantic-reference annotations
- one-command bootstrap that initializes the local data root, installs Chromium
  only when missing, and probes an authenticated ephemeral loopback daemon
- generated bash, zsh, and PowerShell completion scripts that never edit shell
  configuration
- owner-confirmed Windows Startup, macOS LaunchAgent, and Linux systemd user
  daemon definitions with definition-only inspection and exact-file uninstall
- local durable browser-lifecycle webhook outbox with event filtering,
  stable delivery IDs, bounded drain batches, retries, dead letters, health
  diagnostics, startup recovery, and hash-linked terminal delivery receipts
- HMAC-SHA256 webhook signing with key identifiers, timestamps, nonces,
  receiver verification, a bounded replay guard, and explicit key rotation
- canonical Browser-to-Qarinah outcome links carrying exact input and output
  digests, evidence IDs, and the browser receipt hash

### Security

- generated daemon definitions are fixed to loopback, refuse files they do not
  own, and never invoke sudo or an administrative service manager
- webhook publishing performs no DNS, secret resolution, or network I/O;
  draining resolves opaque host-owned key references and admits only
  credential-free public HTTPS endpoints
- webhook delivery revalidates and pins public DNS on every attempt, rejects
  private, loopback, translated, and mixed-address results, never follows
  redirects, and enforces finite payload, queue, storage, attempt, response,
  timeout, and drain ceilings

### Planned

- community validation across supported operating systems
- additional provider adapters behind the same authority model

## [0.1.1] - 2026-07-29

### Fixed

- corrected the case-sensitive MCP Registry identity to the GitHub-authorized
  `io.github.AjnasNB/cockroach-browser` namespace
- aligned the npm package, MCP manifest, CLI, daemon, Docker examples,
  documentation, and website on the same immutable release version

## [0.1.0] - 2026-07-29

### Added

- local-first Playwright and Chromium browser runtime
- explicit origin, action, effect, profile, private-network, and resource policies
- snapshot-scoped semantic page references and compact page snapshots
- authorized navigation, interaction, tabs, waits, uploads, downloads, screenshots, PDFs, tracing, HAR, video, console, network, storage, and cookie surfaces
- encrypted profile import and export with host-supplied passphrases
- challenge detection with a mandatory human handoff
- content-addressed evidence and hash-linked action receipts
- authenticated loopback HTTP daemon and typed JavaScript client, with direct action dispatch disabled unless the host opts in
- observation-first MCP server with canonical action proposals
- Maqam four-phase browser driver
- Mandatory host verification of Maqam execution envelopes and sealed plan
  tokens before governed browser dispatch
- recursively redacted Qarinah outcome recorder
- explicit Cockroach Crawler and ProductLoop OS integration contracts
- crash-resumable local job queue that does not retry unknown writes
- deterministic capability catalog, JSON schemas, examples, Docker profile, and release checks
- Node.js 22, 24, and 26 verification matrix

[Unreleased]: https://github.com/AjnasNB/cockroach-browser/compare/v0.5.0-rc.1...HEAD
[0.5.0-rc.1]: https://github.com/AjnasNB/cockroach-browser/compare/v0.4.1...v0.5.0-rc.1
[0.4.1]: https://github.com/AjnasNB/cockroach-browser/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/AjnasNB/cockroach-browser/compare/v0.4.0-rc.1...v0.4.0
[0.4.0-rc.1]: https://github.com/AjnasNB/cockroach-browser/compare/v0.3.0...v0.4.0-rc.1
[0.3.0]: https://github.com/AjnasNB/cockroach-browser/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/AjnasNB/cockroach-browser/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AjnasNB/cockroach-browser/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/AjnasNB/cockroach-browser/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AjnasNB/cockroach-browser/releases/tag/v0.1.0
