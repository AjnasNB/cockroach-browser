# Security

Useful browser capability without silent authority expansion.

Cockroach Browser is built around explicit sessions, explicit origins, separate effects, finite budgets, authenticated transport, evidence receipts, and challenge handoff.

Public manual: https://cockroachbrowser.com/docs/security/

## Threat boundary

Assume page content is untrusted, agent input may be wrong, downloaded files may be hostile, and browser state may contain credentials. Keep session lifecycle, profile management, secret resolution, and remote binding in host-controlled code.

## Challenges move to an authorized operator path

The runtime detects login, consent, CAPTCHA, and access challenges, pauses the automated action path, records evidence, and waits for a human or an explicitly configured resolver operating with the target owner's authorization. The challenge.resolve action is classified as a critical execute effect and requires exact approval by default. Its page-less callback receives only bounded challenge metadata, never cookies, storage, credentials, a Playwright page, or raw browser control. The runtime independently checks the page after the handoff and keeps the session paused when the challenge remains.

## Governed high-authority controls

Cockroach Browser does not silently expose CAPTCHA or access-control bypass, covert stealth or cloaking, ambient browser cookies or profiles, or public unauthenticated server binding.Use operator-authorized challenge handoff, deterministic compatibility emulation, explicit runtime-owned profiles or encrypted state import, reviewed browser providers, and authenticated loopback or TLS transport. Maqam-ready exact approval keeps consequential operations bound to their reviewed input.

## Exact approval for consequential actions

Use the Maqam adapter for writes, execute effects, uploads, downloads, credential use, JavaScript, and other high-risk operations. Approval must bind to the canonical action input and expire after use.

## Deployment checklist

- Bind to loopback unless remote operation is required.
- Require TLS, bearer auth, and a CORS allowlist for remote workers.
- Use exact HTTPS origin allowlists.
- Keep private-network access disabled for untrusted callers.
- Store profile passphrases and proxy credentials in a secret manager.
- Clamp actions, tabs, time, files, snapshots, and evidence.
- Protect evidence and dashboard access with OS or service identity.
- Review third-party page terms and obtain authorization for the workflow.


## Release status

This manual targets Cockroach Browser 0.3.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
