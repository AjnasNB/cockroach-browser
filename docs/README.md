# Cockroach Browser documentation

Cockroach Browser is a local-first browser runtime for AI agents with Chromium, Firefox, and WebKit execution; complete pinned Playwright and Puppeteer exports; snapshot-scoped semantic references; evidence capture; an optional model gateway; six SDKs; and MCP.

The public documentation lives at https://cockroachbrowser.com/docs/.

## Manuals

- [Getting started](./getting-started.md)
- [Full automation platform](./automation-platform.md)
- [Operator install](./operator-install.md)
- [Sessions and profiles](./sessions.md)
- [Actions and semantic refs](./actions.md)
- [Operator runtime](./operator-runtime.md)
- [Capture and evidence](./capture.md)
- [Network boundary](./network.md)
- [Files and downloads](./files.md)
- [Audits and comparisons](./audits.md)
- [Jobs and retries](./jobs.md)
- [MCP](./mcp.md)
- [Signed webhooks](./webhooks.md)
- [Maqam](./maqam.md)
- [Qarinah](./qarinah.md)
- [Cockroach Crawler](./crawler.md)
- [ProductLoop OS](./productloop.md)
- [Security](./security.md)
- [Deployment](./deployment.md)
- [Capability matrix](./capabilities.md)
- [Alternatives and product-layer comparison](https://cockroachbrowser.com/alternatives/)
- [Complete Playwright and Puppeteer API inventory](https://cockroachbrowser.com/api-surface/)
- [Technical white paper](./whitepaper.md)

## Product boundaries

- Cockroach Browser owns browser execution, tabs, semantic snapshots, browser evidence, audits, and authenticated worker transport.
- Cockroach Crawler owns bounded public-web breadth, mapping, and extraction.
- Qarinah stores compact cited read outcomes but cannot dispatch browser actions.
- For browser operations routed through its adapter, Maqam owns policy, exact approval, replay protection, dispatch, and governance receipts.
- ProductLoop OS composes package contracts without silently combining their ledgers or authority.

## Challenge handling

The runtime detects login, consent, CAPTCHA, and access challenges, records the state, pauses automation, and waits for a human or authorized resolver. It does not bypass CAPTCHAs, defeat access controls, or promise access after a site denies it.

## Local dashboard

Run `cockroach-browser serve`, open `http://127.0.0.1:43110/dashboard/`, and enter the bearer token stored in the configured token file. The dashboard is served by the daemon, reads the same-origin authenticated API, and keeps the entered token in page memory only.
