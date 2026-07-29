# Contributing

Cockroach Browser welcomes focused bug reports, tests, documentation, and implementation changes that preserve its authority boundaries.

## Before opening an issue

Search existing issues and run:

```sh
npm ci --ignore-scripts
npm run check
```

Use a public or locally owned test target. Never attach cookies, storage state, browser profiles, API keys, private URLs, customer data, or captured production evidence.

Security reports belong in GitHub private vulnerability reporting, not a public issue.

## Development setup

Use a maintained Node.js 22, 24, or 26 release.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

The regular suite does not download or launch a browser. To run the explicit Chromium test:

```sh
npx playwright-core install chromium
npm run build
COCKROACH_BROWSER_E2E=1 node --test dist/test/browser-smoke.test.js
```

On PowerShell:

```powershell
$env:COCKROACH_BROWSER_E2E = "1"
node --test dist/test/browser-smoke.test.js
```

## Change requirements

- Keep origin, action, effect, resource, and evidence ceilings explicit.
- Keep lifecycle, login, profiles, proxy credentials, and secret resolution host-owned.
- Do not add CAPTCHA bypass, access-control bypass, silent cookie discovery, fingerprint rotation, or a public unauthenticated listener.
- Do not make MCP a raw mutation or profile-control surface.
- Keep Maqam as the sole policy and exact-approval authority for consequential actions.
- Keep Qarinah metadata-only and recursively redact secret-bearing fields.
- Never retry a browser write whose outcome is unknown.
- Add tests for every new boundary and failure path.
- Update schemas, examples, documentation, and the changelog when a public contract changes.
- Preserve compatibility with Node.js 22, 24, and 26.

## Pull requests

Keep each pull request narrow. Explain:

1. the user problem
2. the authority being added or changed
3. how the authority remains bounded
4. the tests and evidence used for verification
5. any migration or release impact

All required CI checks must pass. Maintainers may request an exact-commit review for changes that touch policy, approvals, profiles, network binding, MCP, Maqam, Qarinah, evidence, releases, or authentication.

By contributing, you agree that your contribution is licensed under AGPL-3.0-or-later and that you have the right to submit it.
