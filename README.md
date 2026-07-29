<p align="center">
  <img src="./site/assets/logo.svg" width="112" alt="Cockroach Browser logo">
</p>

<h1 align="center">Cockroach Browser</h1>

<p align="center"><strong>The browser runtime your AI agents can use without inheriting your whole machine.</strong></p>

<p align="center">
  Authorized sessions · Snapshot-scoped page references · Evidence and receipts · Local MCP · Maqam policy hooks
</p>

Cockroach Browser is a local-first TypeScript runtime for controlled browser work. It gives a trusted host explicit control over origins, actions, effects, profiles, secrets, and resource budgets while agents receive compact observations and semantic element references bound to the observed page revision.

The package supports headed or headless Chromium, typed SDK use, an authenticated loopback daemon, an observation-first MCP server, Docker, a local dashboard, and explicit integrations with Maqam, Qarinah, Cockroach Crawler, and ProductLoop OS.

It detects login, consent, CAPTCHA, and access challenges and pauses for a human or an explicitly authorized resolver. It does not bypass CAPTCHAs, access controls, paywalls, rate limits, or site authorization.

## Release status

Current release line: **0.1.0**

- License: AGPL-3.0-or-later
- Runtime: maintained Node.js 22, 24, or 26
- Registry: `cockroach-browser`
- Capability registry: 63 entries, with 55 available, 6 adapter-backed, and 2 planned
- MCP identity: `io.github.ajnasnb/cockroach-browser`

Verify the npm version, provenance, Git commit, and matching GitHub release before production use.

## Install

```bash
npm install cockroach-browser
npx cockroach-browser setup
npx cockroach-browser doctor
```

`setup` installs the Chromium build used by Playwright 1.55.0 and then runs the environment doctor.

## Start with the embedded SDK

```js
import { BrowserRuntime } from "cockroach-browser";

const runtime = new BrowserRuntime({ root: ".cockroach-browser" });
await runtime.initialize();

try {
  const session = await runtime.createSession({
    purpose: "Inspect a public page",
    startUrl: "https://example.com/",
    policy: {
      allowedOrigins: ["https://example.com"],
      allowedActions: ["snapshot", "extract", "screenshot"],
      allowedEffects: ["read"],
      requireApprovalFor: [],
      budget: {
        maxActions: 10,
        maxDurationMs: 120000,
        maxTabs: 1,
        maxEvidenceBytes: 8388608
      }
    }
  });

  const snapshot = await runtime.snapshot(session.id);
  console.log({
    sessionId: session.id,
    title: snapshot.title,
    url: snapshot.url,
    references: snapshot.refs.length,
    revision: snapshot.digest
  });
} finally {
  await runtime.close();
}
```

The host owns session creation and authority. Every session requires at least one explicit allowed origin.

## Run the authenticated local daemon

```bash
npx cockroach-browser serve \
  --host 127.0.0.1 \
  --port 43110 \
  --root .cockroach-browser \
  --token-file .cockroach-browser/auth-token
```

The daemon listens on loopback by default and creates a strong bearer token when the token file does not exist. Keep that file out of source control and shell history.

Create `session.json`:

```json
{
  "purpose": "Read the public example page",
  "startUrl": "https://example.com/",
  "mode": "headless",
  "policy": {
    "allowedOrigins": ["https://example.com"],
    "allowedActions": ["snapshot", "extract", "screenshot"],
    "allowedEffects": ["read"],
    "requireApprovalFor": [],
    "budget": {
      "maxActions": 10,
      "maxDurationMs": 120000,
      "maxTabs": 1,
      "maxEvidenceBytes": 8388608
    }
  }
}
```

Then use the authenticated CLI:

```bash
npx cockroach-browser session create \
  --config session.json \
  --token-file .cockroach-browser/auth-token

npx cockroach-browser session list \
  --token-file .cockroach-browser/auth-token

npx cockroach-browser snapshot \
  --session SESSION_ID \
  --token-file .cockroach-browser/auth-token

npx cockroach-browser audit \
  --session SESSION_ID \
  --kinds accessibility,security \
  --token-file .cockroach-browser/auth-token
```

The HTTP action route is disabled by default. Production mutations should enter through the Maqam-bound driver. A trusted local host can explicitly enable the raw route with `--allow-raw-actions`. Host-controlled executable, CDP, proxy, header, and profile-secret fields remain disabled unless that host also passes `--allow-session-host-config`.

The authenticated daemon exposes:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/health` | Runtime and evidence integrity health |
| GET | `/v1/capabilities` | Source-derived capability catalog |
| GET, POST | `/v1/sessions` | List or create authorized sessions |
| GET, DELETE | `/v1/sessions/:id` | Inspect or close one session |
| POST | `/v1/sessions/:id/actions` | Optional trusted-host action dispatch |
| POST | `/v1/sessions/:id/snapshot` | Semantic snapshot |
| POST | `/v1/sessions/:id/audit` | Read-only audits |
| POST | `/v1/sessions/:id/compare` | Visual comparison |
| POST | `/v1/sessions/:id/challenge/resume` | Resume after human handling |
| GET | `/v1/evidence` | Evidence records |
| GET | `/v1/evidence/verify` | Hash-chain verification |
| GET | `/v1/artifacts/:id` | Authenticated artifact download |

## Use the typed daemon client

```js
import { readFile } from "node:fs/promises";
import { BrowserClient } from "cockroach-browser/client";

const token = (await readFile(".cockroach-browser/auth-token", "utf8")).trim();
const browser = new BrowserClient({
  baseUrl: "http://127.0.0.1:43110",
  token
});

console.log(await browser.health());
console.log(await browser.capabilities());
```

`BrowserClient` supports health, capabilities, session creation and inspection, session close, actions, snapshots, audits, and human-handoff resume. The daemon still enforces its own route and session-authority settings.

## Connect through MCP

Start the daemon, load its token into the client process through a secret store, and configure an MCP client:

```json
{
  "mcpServers": {
    "cockroach-browser": {
      "command": "npx",
      "args": ["-y", "cockroach-browser@0.1.0", "mcp"],
      "env": {
        "COCKROACH_BROWSER_URL": "http://127.0.0.1:43110",
        "COCKROACH_BROWSER_TOKEN": "<load from your secret store>"
      }
    }
  }
}
```

Do not commit a live daemon token to an MCP configuration. The MCP process reads `COCKROACH_BROWSER_TOKEN` and optionally `COCKROACH_BROWSER_URL`.

The MCP surface is observation-first:

- `browser_capabilities`
- `browser_health`
- `browser_sessions`
- `browser_snapshot`
- `browser_audit`
- `browser_propose_action`

`browser_propose_action` returns a canonical proposal and input digest. It does not execute the action. Dispatch consequential work through Maqam.

## Run with Docker

```bash
docker compose up --build
```

The included profile:

- exposes the daemon only on host loopback at `127.0.0.1:43110`
- runs as the non-root `node` user
- uses a read-only root filesystem
- drops all Linux capabilities
- enables `no-new-privileges`
- stores browser data in a dedicated volume
- checks daemon health with the generated bearer token

Read the generated token into a local file:

```bash
docker compose exec -T browser cat /data/auth-token > .cockroach-browser-docker-token
```

Then point CLI or SDK clients at `http://127.0.0.1:43110` and use that token file.

## CLI reference

| Command | What it does |
| --- | --- |
| `cockroach-browser setup` | Install Chromium and run the doctor |
| `cockroach-browser doctor` | Check Node, Chromium, and basic readiness |
| `cockroach-browser capabilities [--status available]` | Print the capability registry |
| `cockroach-browser serve [options]` | Start the authenticated daemon |
| `cockroach-browser mcp` | Start the stdio MCP server |
| `cockroach-browser session create --config FILE --token-file FILE` | Create an authorized daemon session |
| `cockroach-browser session list --token-file FILE` | List sessions |
| `cockroach-browser session get --id ID --token-file FILE` | Inspect one session |
| `cockroach-browser session close --id ID --token-file FILE` | Close one session |
| `cockroach-browser snapshot --session ID --token-file FILE [--tab ID]` | Read a semantic snapshot |
| `cockroach-browser audit --session ID --kinds accessibility,security --token-file FILE` | Run selected audits |
| `cockroach-browser act --session ID --input FILE --token-file FILE` | Use the trusted-host action route when explicitly enabled |
| `cockroach-browser profile list [--root DIR]` | List isolated local profiles |
| `cockroach-browser profile import --name NAME --file FILE` | Import encrypted storage state |
| `cockroach-browser profile export --name NAME --file FILE` | Export encrypted storage state |

Profile import and export require `COCKROACH_BROWSER_PROFILE_PASSPHRASE`. Passphrases are never accepted as command-line arguments.

Daemon clients can use `--token`, `--token-file`, `COCKROACH_BROWSER_TOKEN`, or `COCKROACH_BROWSER_TOKEN_FILE`. They can override the URL with `--url` or `COCKROACH_BROWSER_URL`.

## 63 source-registered capabilities

The registry is generated from `src/capabilities.ts`, not from a marketing checklist.

| Group | Available | Adapter | Planned | Total |
| --- | ---: | ---: | ---: | ---: |
| Sessions | 10 | 0 | 0 | 10 |
| Interaction | 15 | 0 | 0 | 15 |
| Evidence | 9 | 0 | 0 | 9 |
| Audit | 6 | 0 | 0 | 6 |
| Security | 6 | 2 | 0 | 8 |
| Deployment | 9 | 0 | 0 | 9 |
| Integration | 0 | 4 | 2 | 6 |
| **Total** | **55** | **6** | **2** | **63** |

### Sessions

Authorized browser sessions; headless Chromium; headed Chromium; CDP attachment; a custom Chromium executable; named isolated profiles; explicit encrypted storage-state import and export; a user-supplied proxy; deterministic locale and timezone.

### Interaction

Tabs and popups; navigation, back, forward, and reload; snapshot-scoped semantic page references; compact snapshots; click and double-click; form fill, type, press, select, check, and uncheck; hover and focus; bounded scroll; drag and drop; page-state waits; open Shadow DOM access; readable same-origin iframe access; policy-gated JavaScript; controlled upload; controlled download.

### Evidence

PNG and JPEG screenshots; PDF capture; Playwright traces; HAR capture; session video; bounded console records; bounded network records; hash-chained receipts; bounded readable text and HTML extraction.

### Audits

Accessibility; page performance observations; broken assets; console errors and warnings; page security observations; screenshot comparison with visual diffs.

### Security

Challenge detection; human challenge handoff; origin allowlists; private-network blocking; effect-level policy; finite resource budgets.

Adapter-backed security surfaces:

- Exact action approvals through `MaqamApprovalProvider`
- Host-resolved secret references through `SecretResolver`

### Deployment

CLI; TypeScript SDK; authenticated HTTP API; native stdio MCP; Docker; local dashboard; authenticated remote workers; crash-resumable local jobs; doctor and health checks.

### Integrations

Adapter-backed:

- Maqam governance for operations routed through its adapter
- Qarinah memory
- Cockroach Crawler handoff
- ProductLoop OS capability snapshot

Planned:

- Signed event webhooks
- Team session control without raw profile sharing

The complete searchable matrix, including capability IDs, implementation status, and exact API surfaces, is in [docs/capabilities.md](./docs/capabilities.md).

## Action surface

The typed runtime implements 34 action kinds:

`navigate`, `back`, `forward`, `reload`, `click`, `doubleClick`, `fill`, `type`, `press`, `hover`, `focus`, `check`, `uncheck`, `select`, `scroll`, `drag`, `upload`, `download`, `evaluate`, `wait`, `screenshot`, `pdf`, `snapshot`, `extract`, `cookies.read`, `cookies.write`, `storage.read`, `storage.write`, `tab.open`, `tab.close`, `tab.switch`, `trace.start`, and `trace.stop`.

Availability in the type system does not grant authority. The session policy, effect policy, approval provider, server surface, origin checks, and resource budget decide whether an action can run.

## Product stack integrations

### Maqam

```js
import { createMaqamBrowserDriver } from "cockroach-browser/maqam";

const driver = createMaqamBrowserDriver({
  runtime,
  async resolveValueRef(reference) {
    return secretStore.resolve(reference);
  },
  async verifyExecution(request) {
    return maqamAuthority.verifyExecution(request);
  },
  async verifyPlanToken(request) {
    return maqamAuthority.verifyPlanToken(request);
  }
});
```

The two verifier callbacks are mandatory. They must consult a trusted Maqam
ledger or verify a Maqam signature; checking only field shape is not enough.
The driver fails closed when either verifier is absent, rejects, or throws.

The driver exposes four operations: `observe`, `preview`, `apply`, and `submit`. It binds work to an exact page revision, origin, input digest, run, approval, operation ID, and authoritatively verified plan token. Browser lifecycle, login, profiles, proxy configuration, secrets, and raw JavaScript stay in the trusted host.

### Qarinah

```js
import { createQarinahContextRecorder } from "cockroach-browser/qarinah";

const recorder = createQarinahContextRecorder({
  async appendBrowserOutcome(event) {
    await hostProvidedQarinahSink.appendBrowserOutcome(event);
  }
});
```

The host supplies the persistence callback supported by its installed Qarinah release. Qarinah receives cited, metadata-only read outcomes. The recorder recursively removes authorization data, cookies, credentials, passwords, passphrases, secrets, tokens, storage values, form values, and API keys. It does not persist hidden reasoning or profile data. For consequential mutations, a host may link the sanitized outcome to a complete causal receipt chain when every stage exists; the recorder does not invent or require that chain.

### Cockroach Crawler

```js
import { createCrawlerHandoff } from "cockroach-browser/crawler";

const handoff = createCrawlerHandoff(crawler);
```

Use Cockroach Crawler for broad, bounded collection and Cockroach Browser for interactive page evidence. Only explicit seed URLs, allowed origins, and finite crawl budgets cross the boundary. Keep the browser-session purpose in the browser evidence and host orchestration record; do not pass it as crawler authority. Profiles, cookies, authenticated state, session secrets, and interactive browser state never cross the handoff.

### ProductLoop OS

```js
import { productLoopBrowserCapabilitySnapshot } from "cockroach-browser/productloop";

const browserCapabilitySnapshot = productLoopBrowserCapabilitySnapshot();
```

The returned value is a structural capability snapshot for a host-owned ProductLoop adapter. It describes observations, proposals, effects, transports, governance requirements, and lifecycle ownership; it is not a directly registerable ProductLoop connector manifest. Translate it into the exact versioned ProductLoop contract accepted by the installed release. The snapshot grants no origin, profile, credential, lifecycle, or action authority.

Maqam governance applies only to browser operations routed through `createMaqamBrowserDriver` and a Maqam gateway. Cockroach Browser also has trusted-host SDK and explicitly enabled raw-action surfaces; those remain under host policy and must not be described as Maqam-governed unless the host actually routes them through the adapter.

## Challenge handling

When Cockroach Browser detects a login, consent screen, CAPTCHA, or access challenge:

1. The session moves into a challenge state.
2. Evidence records explain what was detected.
3. Automated execution pauses.
4. A user handles the challenge in a headed session, or an explicitly authorized external workflow resolves it.
5. The trusted host calls `resumeAfterHuman` or the challenge-resume endpoint.
6. Policy, origin, and budget checks continue to apply.

Challenge handling is a pause and handoff protocol, never a bypass mechanism.

## Security defaults

- Loopback-only daemon binding
- Strong bearer-token authentication
- Direct HTTP action dispatch disabled
- Host-controlled session configuration disabled
- Explicit origin allowlists for every session
- Private and loopback destination denial unless the deployment owner opts in
- DNS resolution checks and session pinning
- Separate read, write, execute, upload, download, and credential effects
- Explicit action approvals for high-risk operations
- Finite action, duration, tab, upload, download, snapshot, and evidence ceilings
- Content-addressed evidence and hash-linked receipts
- Observation-first MCP
- Separate data roots and profiles for separate trust domains

Headless mode is not a sandbox. Treat browser rendering, JavaScript, remote CDP, proxies, uploads, downloads, and imported profiles as privileged capabilities.

Read the complete [security policy](./SECURITY.md) before exposing the runtime to another process.

## Documentation

- [Documentation home](https://cockroachbrowser.com/docs/)
- [Getting started](./docs/getting-started.md)
- [Sessions and profiles](./docs/sessions.md)
- [Actions and semantic references](./docs/actions.md)
- [Capture and evidence](./docs/capture.md)
- [Network authority](./docs/network.md)
- [Files, uploads, and downloads](./docs/files.md)
- [Audits and visual comparison](./docs/audits.md)
- [Durable local jobs](./docs/jobs.md)
- [MCP](./docs/mcp.md)
- [Maqam integration](./docs/maqam.md)
- [Qarinah integration](./docs/qarinah.md)
- [Cockroach Crawler handoff](./docs/crawler.md)
- [ProductLoop OS](./docs/productloop.md)
- [Deployment](./docs/deployment.md)
- [Capability matrix](./docs/capabilities.md)
- [Security](./docs/security.md)
- [Local dashboard](http://127.0.0.1:43110/dashboard/) - served by `cockroach-browser serve`

## Development and release verification

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run check:package
npm run check:site
npm audit --omit=dev
npm pack --dry-run --ignore-scripts
```

Or run the complete gate:

```bash
npm run check
```

The package scripts compile TypeScript, execute the built Node test suite, validate package contents and public documentation, audit runtime dependencies, and inspect the exact npm tarball surface.

## License

Cockroach Browser is available under the [GNU Affero General Public License v3.0 or later](./LICENSE).

Copyright Ajnas NB.
