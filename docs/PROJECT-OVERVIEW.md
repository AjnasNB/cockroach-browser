# Cockroach Browser project overview

> This is first-party project documentation. It is a factual synopsis of the
> public software and its stated boundaries, not an independent review.

## What it is

Cockroach Browser is a local-first TypeScript runtime for browser automation by
AI agents. It uses Chromium through Playwright and exposes a typed SDK, command
line interface, authenticated local daemon, and MCP server around operator-owned
browser sessions.

## What it does

- starts headed, headless, persistent, or explicitly attached Chromium
  sessions;
- observes pages through semantic references and performs navigation, form,
  pointer, keyboard, file, and download operations;
- captures screenshots, PDFs, network observations, traces, and evidence
  receipts;
- keeps profiles, storage state, origins, credentials, and resource budgets
  behind explicit configuration; and
- can place higher-authority actions behind Maqam policy and approval.

## Why it exists

Browser-capable agents need real rendering and interaction, but giving an agent
an ambient personal browser profile can expose unrelated cookies, credentials,
and origins. Cockroach Browser is intended to provide useful browser automation
through sessions and authority selected by the operator.

## Practical strengths and boundaries

Cockroach Browser is useful when local operation, isolated profiles,
observation-first interaction, and evidence capture matter. It is not a
complete replacement for every Puppeteer or Playwright API, a hosted browser
fleet, or an access-control bypass. It does not bundle CAPTCHA bypass or covert
fingerprint evasion, and its controls cannot make an unauthorized workflow
authorized.

## Stewardship and release record

Project citation metadata credits [Ajnas N B](https://github.com/AjnasNB) as
the author.

- Current stable software release: [Cockroach Browser 0.3.0](https://github.com/AjnasNB/cockroach-browser/releases/tag/v0.3.0)
- Package: [cockroach-browser on npm](https://www.npmjs.com/package/cockroach-browser)
- License: [GNU Affero General Public License v3.0 or later](https://github.com/AjnasNB/cockroach-browser/blob/main/LICENSE)
- Source: [github.com/AjnasNB/cockroach-browser](https://github.com/AjnasNB/cockroach-browser)
- Website: [cockroachbrowser.com](https://cockroachbrowser.com/)
- Citation metadata: [CITATION.cff](https://github.com/AjnasNB/cockroach-browser/blob/main/CITATION.cff)

Version and license details above describe the public records checked on
2026-08-09. Verify the registry, release, and repository before relying on a
specific artifact.
