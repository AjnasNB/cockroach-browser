<p align="center">
  <img src="https://cockroachbrowser.com/assets/logo.png" width="144" alt="Cockroach Browser globe and cockroach logo">
</p>

<h1 align="center">Cockroach Browser</h1>

<p align="center"><strong>The browser runtime your AI agents can use without inheriting your whole machine.</strong></p>

<p align="center">
  Authorized sessions - Semantic page refs - Paired evidence - Local MCP - Maqam-governed actions
</p>

<p align="center">
  <a href="https://cockroachbrowser.com/docs/">Documentation</a> ·
  <a href="https://cockroachbrowser.com/docs/capabilities/">80-capability registry</a> ·
  <a href="https://cockroachbrowser.com/paper/">Technical white paper</a>
</p>

Cockroach Browser is a local-first TypeScript and Chromium runtime for browser-capable AI agents. It combines real page rendering, semantic interaction, forms, files, screenshots, PDFs, network observations, audits, stateful sessions, and authenticated tooling without silently giving an agent every browser profile, credential, origin, or machine resource.

The package supports headed or headless Chromium, explicit Chrome/CDP attachment, a typed SDK, an authenticated daemon, an observation-first MCP server, Docker, a local dashboard, and explicit integrations with Maqam, Qarinah, Cockroach Crawler, and ProductLoop OS.

It detects login, consent, CAPTCHA, and access challenges and pauses for a human or an explicitly authorized resolver. It does not bypass CAPTCHAs, access controls, paywalls, rate limits, or site authorization.

## Release status

Current release line: **0.2.1**

- License: AGPL-3.0-or-later
- Runtime: maintained Node.js 22, 24, or 26
- Registry: `cockroach-browser`
- Capability registry: 80 entries, with 73 available, 6 adapter-backed, and 1 planned
- MCP identity: `io.github.AjnasNB/cockroach-browser`
- Paper: [Cockroach Browser: A Local-First Browser Runtime for AI Agents](https://cockroachbrowser.com/paper/)
- DOI: [10.5281/zenodo.21701792](https://doi.org/10.5281/zenodo.21701792)

Verify the npm version, provenance, Git commit, and matching GitHub release before production use.

## Install once for your user account

Install the CLI globally when the same operator account should use Cockroach Browser across projects:

```bash
npm install --global cockroach-browser
cockroach-browser bootstrap
cockroach-browser doctor
```

The global installation makes the CLI available across the current computer account. It does not grant access to ambient browser profiles, cookies, origins, or machine resources. Each session still requires explicit authority.

## Install inside one project

```bash
npm install cockroach-browser
npx cockroach-browser bootstrap
```

`bootstrap` verifies Node.js, installs the Chromium build used by Playwright 1.55.0 only when it is missing, initializes the owner-scoped data root, and probes an authenticated ephemeral loopback daemon. Use `--check-only` when the command must not download a browser.

## Operator bootstrap, completions, and per-user autostart

Completion generation writes to standard output and never edits your shell profile:

```bash
cockroach-browser completion bash
cockroach-browser completion zsh
cockroach-browser completion powershell
```

The optional daemon installer is deliberately a per-user operation. It requires an explicit local-owner confirmation, always binds the generated daemon to `127.0.0.1`, and never invokes `sudo`, an administrator prompt, or a system-wide service manager:

```bash
cockroach-browser service status
cockroach-browser service install --confirm-local-owner
cockroach-browser service uninstall --confirm-local-owner
```

Windows installs a current-user Startup command that begins at the next login. macOS installs and loads a current-user LaunchAgent, and Linux installs and starts a systemd user unit. Add `--definition-only` to inspect the exact generated file without activation. The installer refuses to overwrite or remove a file it did not create. Uninstall removes the definition only; browser data, profiles, evidence, and receipts remain intact.

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

npx cockroach-browser capture \
  --session SESSION_ID \
  --token-file .cockroach-browser/auth-token \
  --require-stable \
  --include-bounds

npx cockroach-browser network \
  --session SESSION_ID \
  --token-file .cockroach-browser/auth-token \
  --limit 100

npx cockroach-browser network export \
  --session SESSION_ID \
  --token-file .cockroach-browser/auth-token \
  --format json > ./artifacts/network.json
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
| POST | `/v1/sessions/:id/capture` | Paired screenshot and semantic snapshot |
| POST | `/v1/sessions/:id/network` | Bounded network observation |
| POST | `/v1/sessions/:id/network/export` | Redacted network export evidence |
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

`BrowserClient` supports health, capabilities, session creation and inspection, session close, actions, snapshots, paired capture, bounded network observation and export, audits, and human-handoff resume. The daemon still enforces its own route and session-authority settings.

## Connect through MCP

Start the daemon, load its token into the client process through a secret store, and configure an MCP client:

```json
{
  "mcpServers": {
    "cockroach-browser": {
      "command": "npx",
      "args": ["-y", "cockroach-browser@0.2.1", "mcp"],
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
- `browser_capture`
- `browser_network`
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
| `cockroach-browser bootstrap [--check-only]` | Initialize the data root, install Chromium only when missing, and probe an authenticated loopback daemon |
| `cockroach-browser setup` | Alias for `bootstrap` |
| `cockroach-browser doctor [--root DIR]` | Check Node, Chromium, data-root, and per-user service readiness |
| `cockroach-browser completion <bash\|zsh\|powershell>` | Print a completion script without modifying shell configuration |
| `cockroach-browser service install --confirm-local-owner` | Install an owner-scoped loopback autostart definition; macOS and Linux activate immediately, while Windows starts at next login |
| `cockroach-browser service status` | Show the exact per-user definition path and fixed daemon command |
| `cockroach-browser service uninstall --confirm-local-owner` | Disable and remove only the generated per-user definition |
| `cockroach-browser capabilities [--status available]` | Print the capability registry |
| `cockroach-browser serve [options]` | Start the authenticated daemon |
| `cockroach-browser mcp` | Start the stdio MCP server |
| `cockroach-browser session create --config FILE --token-file FILE` | Create an authorized daemon session |
| `cockroach-browser session list --token-file FILE` | List sessions |
| `cockroach-browser session get --id ID --token-file FILE` | Inspect one session |
| `cockroach-browser session close --id ID --token-file FILE` | Close one session |
| `cockroach-browser snapshot --session ID --token-file FILE [--tab ID]` | Read a semantic snapshot |
| `cockroach-browser audit --session ID --kinds accessibility,security --token-file FILE` | Run selected audits |
| `cockroach-browser capture --session ID --token-file FILE [--require-stable] [--include-bounds]` | Capture one paired screenshot and semantic snapshot |
| `cockroach-browser network --session ID --token-file FILE [--limit N]` | Inspect bounded, redacted network observations |
| `cockroach-browser network export --session ID --token-file FILE [--format json\|ndjson\|har]` | Print a bounded network evidence export |
| `cockroach-browser act --session ID --input FILE --token-file FILE` | Use the trusted-host action route when explicitly enabled |
| `cockroach-browser profile list [--root DIR]` | List isolated local profiles |
| `cockroach-browser profile import --name NAME --file FILE` | Import encrypted storage state |
| `cockroach-browser profile export --name NAME --file FILE` | Export encrypted storage state |

Profile import and export require `COCKROACH_BROWSER_PROFILE_PASSPHRASE`. Passphrases are never accepted as command-line arguments.

Daemon clients can use `--token`, `--token-file`, `COCKROACH_BROWSER_TOKEN`, or `COCKROACH_BROWSER_TOKEN_FILE`. They can override the URL with `--url` or `COCKROACH_BROWSER_URL`.

## 80 source-registered capabilities

The registry is generated from `src/capabilities.ts`, not from a marketing checklist.

| Group | Available | Adapter | Planned | Total |
| --- | ---: | ---: | ---: | ---: |
| Sessions | 12 | 0 | 0 | 12 |
| Interaction | 22 | 0 | 0 | 22 |
| Evidence | 13 | 0 | 0 | 13 |
| Audit | 6 | 0 | 0 | 6 |
| Security | 7 | 2 | 0 | 9 |
| Deployment | 12 | 0 | 0 | 12 |
| Integration | 1 | 4 | 1 | 6 |
| **Total** | **73** | **6** | **1** | **80** |

### Sessions

Authorized browser sessions; headless Chromium; headed Chromium; CDP attachment; a custom Chromium executable; named isolated profiles; explicit encrypted storage-state import and export; named encrypted session checkpoints; policy-gated clipboard reads and writes; a user-supplied proxy; deterministic locale and timezone.

### Interaction

Tabs and popups; exclusive tab locks; navigation, back, forward, and reload; snapshot-scoped semantic page references; explicit bounded XPath; compact snapshots; click and double-click; form fill, type, press, select, check, and uncheck; hover and focus; bounded scroll; low-level in-viewport mouse and bounded keyboard actions; drag and drop; page-state waits; open Shadow DOM access; readable and explicitly targetable same-origin frames; explicit dialog handling; bounded session history; policy-gated JavaScript; controlled upload; controlled download.

### Evidence

PNG and JPEG screenshots; paired visual-plus-semantic capture; temporary numbered page annotations; PDF capture; Playwright traces; HAR capture; session video; bounded console records; bounded redacted network inspection and export; hash-chained receipts; bounded readable text and HTML extraction.

### Audits

Accessibility; page performance observations; broken assets; console errors and warnings; page security observations; screenshot comparison with visual diffs.

### Security

Challenge detection; human challenge handoff; origin allowlists; private-network blocking; effect-level policy; finite resource budgets; exact-origin static network interception.

Adapter-backed security surfaces:

- Exact action approvals through `MaqamApprovalProvider`
- Host-resolved secret references through `SecretResolver`

### Deployment

CLI; generated bash, zsh, and PowerShell completions; owner-confirmed Windows, macOS, and Linux per-user daemon definitions; one-command bootstrap; TypeScript SDK; authenticated HTTP API; native stdio MCP; Docker; local dashboard; authenticated remote workers; crash-resumable local jobs; doctor and health checks.

### Integrations

Adapter-backed:

- Maqam governance for operations routed through its adapter
- Qarinah memory
- Cockroach Crawler handoff
- ProductLoop OS capability snapshot

Available:

- Signed browser lifecycle webhooks with a local durable outbox, HMAC-SHA256
  signatures, bounded retries, dead letters, and hash-linked delivery receipts

Planned:

- Team session control without raw profile sharing

The complete searchable matrix, including capability IDs, implementation status, and exact API surfaces, is in [docs/capabilities.md](./docs/capabilities.md).

## Signed lifecycle webhooks

`SignedWebhookDispatcher` implements `BrowserEventPublisher` and can be attached
to `BrowserRuntime`. Browser lifecycle events are sanitized and written to a
local durable outbox before any network work occurs. `publish()` does not
resolve DNS, read a signing key, or contact an endpoint. An operator-controlled
`drain()` performs those privileged steps later.

```ts
import {
  BrowserRuntime,
  SignedWebhookDispatcher
} from "cockroach-browser";

const webhookUrl = process.env.COCKROACH_BROWSER_WEBHOOK_URL;
if (!webhookUrl) throw new Error("COCKROACH_BROWSER_WEBHOOK_URL is required");

const webhooks = new SignedWebhookDispatcher({
  root: ".cockroach-browser/webhooks",
  secretResolver: {
    async resolve(reference) {
      const prefix = "ref:env/";
      if (!reference.startsWith(prefix)) {
        throw new Error("Unsupported webhook secret reference");
      }
      const value = process.env[reference.slice(prefix.length)];
      if (!value) throw new Error(`Missing secret for ${reference}`);
      return value;
    }
  },
  maxPayloadBytes: 64 * 1024,
  maxQueueItems: 10_000,
  maxStorageBytes: 256 * 1024 * 1024
});

await webhooks.initialize();
await webhooks.upsertEndpoint({
  id: "release-automation",
  url: webhookUrl,
  secretRef: "ref:env/COCKROACH_BROWSER_WEBHOOK_SECRET",
  keyId: "release-2026-07",
  events: [
    "browser.action.completed",
    "browser.challenge.detected",
    "browser.evidence.recorded"
  ],
  maxAttempts: 3,
  timeoutMs: 5_000
});

const runtime = new BrowserRuntime({
  root: ".cockroach-browser/runtime",
  eventPublisher: webhooks
});
await runtime.initialize();

// Run this from an operator-owned worker or scheduler.
const result = await webhooks.drain({
  maxItems: 50,
  deadlineMs: 30_000
});
console.log(result, await webhooks.health());
```

Endpoint configuration stores only an opaque `ref:` value. The host resolver
returns the signing key during `drain()`, and the key is never written to the
outbox or receipt ledger. Endpoints must be credential-free public HTTPS URLs
without a query string or fragment. DNS is checked again and pinned for every
attempt; private, loopback, translated, and mixed public/private results are
rejected, and redirects are never followed.

Each request carries:

- `x-cockroach-browser-event`
- `x-cockroach-browser-delivery`
- `x-cockroach-browser-timestamp`
- `x-cockroach-browser-nonce`
- `x-cockroach-browser-key-id`
- `x-cockroach-browser-signature: v1=<HMAC-SHA256>`

Use `verifyWebhookSignature()` and `WebhookReplayGuard` at the receiver. A
normal retry keeps the same stable delivery ID while using a fresh timestamp
and nonce, so the receiver must also persist processed delivery IDs and return
success for duplicates. This is a local durable at-least-once outbox, not a
distributed exactly-once queue. A manual dead-letter retry intentionally
creates a new delivery ID.

Transient transport failures and HTTP `408`, `425`, `429`, and `5xx` responses
retry within the configured attempt and deadline ceilings. Other non-`2xx`
responses become dead letters. `Retry-After` is honored up to 30 seconds.
`health()` reports queue, receipt, dead-letter, and storage counts;
`retryDeadLetter()` and `purgeDeadLetter()` provide explicit recovery;
`verify()` checks the hash-linked terminal receipt chain. See the
[signed webhook manual](./docs/webhooks.md) for receiver verification, replay
handling, quotas, and recovery procedures.

## Action surface

The typed runtime implements 58 action kinds:

`navigate`, `back`, `forward`, `reload`, `click`, `doubleClick`, `fill`, `type`, `press`, `hover`, `focus`, `check`, `uncheck`, `select`, `scroll`, `drag`, `mouse.move`, `mouse.down`, `mouse.up`, `mouse.click`, `keyboard.down`, `keyboard.up`, `keyboard.insertText`, `upload`, `download`, `evaluate`, `wait`, `history.inspect`, `capture.paired`, `annotate.show`, `annotate.clear`, `clipboard.read`, `clipboard.write`, `network.inspect`, `network.export`, `network.route.add`, `network.route.remove`, `network.routes.list`, `state.save`, `state.load`, `state.list`, `state.delete`, `screenshot`, `pdf`, `snapshot`, `extract`, `cookies.read`, `cookies.write`, `storage.read`, `storage.write`, `tab.open`, `tab.close`, `tab.switch`, `tab.lock`, `tab.unlock`, `tab.lock.status`, `trace.start`, and `trace.stop`.

Availability in the type system does not grant authority. The session policy, effect policy, approval provider, server surface, origin checks, and resource budget decide whether an action can run.

### Exact targets and same-origin frames

An element action accepts exactly one snapshot ref, CSS selector, or XPath expression. A CSS or XPath target may include an exact same-origin frame selector by index, name, or URL. Semantic refs already carry their frame identity and cannot be combined with a separate frame target.

```js
await runtime.act(session.id, {
  kind: "fill",
  xpath: "//*[@id='account-name']",
  frame: { name: "account-panel" },
  value: "Ajnas",
  purpose: "Fill the reviewed same-origin account form"
});
```

Cross-origin frame targeting is rejected. XPath and selector strings are length-bounded and do not grant new origin authority.

### Dialogs and low-level input

Unexpected dialogs are dismissed. Accepting a dialog requires `allowDialogAccept: true`, remains approval-bound even when the session has an empty `requireApprovalFor` list, and may resolve prompt text only from an opaque host secret reference. Low-level mouse coordinates must remain inside the current viewport. Keyboard text, key names, click counts, and movement steps have finite ceilings.

```js
await runtime.act(session.id, {
  kind: "click",
  ref: confirmButton.ref,
  dialog: { action: "accept" },
  purpose: "Accept the exact reviewed confirmation"
});
```

### Bounded history and network routes

`history.inspect` returns a sanitized, session-local list capped by `maxHistoryEntries`. It is not browser-profile discovery and does not expose a user's ambient history.

Network routes are off until `allowNetworkInterception` is enabled. A route may match one already admitted origin, a bounded pathname glob, an explicit method set, and optional resource types. It may only abort the request or return a static response. It cannot redirect requests, inject credentials, discover cookies, or widen the origin policy. Static response bodies are constrained by `maxRouteFulfillBytes`, and cumulative fulfilled bytes are constrained by `maxInterceptedBytes`.

```js
await runtime.act(session.id, {
  kind: "network.route.add",
  route: {
    id: "release-fixture",
    origin: "https://docs.example.com",
    pathPattern: "/api/releases/**",
    methods: ["GET"],
    resourceTypes: ["fetch"],
    response: {
      action: "fulfill",
      contentType: "application/json",
      body: "{\"releases\":[]}"
    }
  },
  purpose: "Install a deterministic response for the reviewed test"
});
```

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

The host supplies the persistence callback supported by its installed Qarinah release. Qarinah receives cited, metadata-only outcomes with canonical input and output digests, the browser receipt hash, and evidence IDs as top-level context links. The recorder recursively removes authorization data, cookies, credentials, passwords, passphrases, secrets, tokens, storage values, form values, and API keys. It does not persist hidden reasoning or profile data. For consequential mutations, a host may link the sanitized outcome to a complete causal receipt chain when every stage exists; the recorder does not invent or require that chain.

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
