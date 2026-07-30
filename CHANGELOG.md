# Changelog

All notable changes to Cockroach Browser are documented here.

The format follows Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/AjnasNB/cockroach-browser/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/AjnasNB/cockroach-browser/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AjnasNB/cockroach-browser/releases/tag/v0.1.0
