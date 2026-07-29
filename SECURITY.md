# Security policy

Cockroach Browser controls a real browser. Treat it as a privileged local service and keep its authority narrower than the application that uses it.

## Supported versions

Security fixes are provided for the current stable release. Pre-release versions receive fixes at the maintainer's discretion.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Earlier | No |

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue for a suspected vulnerability and do not include credentials, browser profiles, cookies, storage state, private URLs, or captured evidence in a public report.

Include:

- the affected version and operating system
- a minimal reproduction using a non-sensitive target
- the expected boundary and observed behavior
- whether a profile, proxy, remote listener, MCP client, Maqam adapter, or Qarinah recorder was involved
- any evidence that a secret, origin, approval, or resource ceiling crossed its boundary

You should receive an acknowledgement within three business days. Coordinated disclosure is preferred.

## Security model

The default daemon:

- listens on loopback only
- requires a cryptographically strong bearer token
- stores the generated token with restrictive permissions
- rejects non-loopback binding unless remote mode and TLS are both explicit
- rejects direct HTTP action dispatch unless a deployment owner explicitly enables the raw-action surface
- denies origins that are not listed on the session
- denies private and loopback destinations unless a deployment owner explicitly opts in
- limits actions, duration, tabs, uploads, downloads, snapshots, and evidence
- records hash-linked action receipts and content-addressed evidence
- pauses when it detects access challenges that require a human

MCP is observation-first. It can inspect health, capabilities, sessions, snapshots, audits, and canonical action proposals. It does not expose raw profile lifecycle, unrestricted JavaScript, direct mutation, or silent credential discovery. The HTTP daemon follows the same safe default: its direct action route is disabled unless the trusted host opts in.

Maqam is the policy, approval, and replay authority for consequential actions.
The adapter requires host-owned verification of every normalized execution
envelope and every sealed mutation plan token before package-private dispatch.
Shape-valid IDs, hashes, and tokens are not treated as proof of authority.
Qarinah receives redacted, cited browser outcomes and cannot dispatch browser
work. Cockroach Crawler handles breadth-first collection and does not inherit
interactive profiles.

## Not security boundaries

Headless mode is not a sandbox. Browser rendering, JavaScript execution, downloads, uploads, extensions, remote CDP, proxies, and imported profiles increase authority. Only enable them for a target you are authorized to operate.

Cockroach Browser does not bypass CAPTCHAs, access controls, rate limits, paywalls, or site authorization. Challenge detection stops and requires a human or an explicitly authorized external workflow.

The daemon is not a public multi-tenant service. Deploy separate instances and data roots for separate trust domains.

## Deployment checklist

- Keep the listener on loopback. Use an authenticated local proxy if another process must connect.
- If remote access is unavoidable, use TLS, an explicit CORS allowlist, network isolation, short-lived credentials, and a dedicated instance.
- Never place a bearer token in a URL, shell history, repository, image layer, or browser page.
- Mount the data directory on encrypted storage and set an evidence retention period.
- Use a dedicated browser profile for each trust domain.
- Keep browser profiles, proxy credentials, and upload paths outside agent-provided input.
- Route consequential actions through Maqam.
- Verify evidence integrity after every governed run.
- Run the container as the included non-root user with all Linux capabilities dropped.

## Release integrity

Official npm releases are published from a protected GitHub environment with npm trusted publishing and provenance. Verify the package version, repository commit, npm provenance statement, and GitHub release tag before using a release in production.
