# Capability matrix

This file is generated from `src/capabilities.ts`.

| ID | Group | Capability | Status | Surface |
| --- | --- | --- | --- | --- |
| `sessions.authorized` | sessions | Authorized browser sessions | **available** | `runtime.createSession` |
| `sessions.headless` | sessions | Headless Chromium | **available** | `mode=headless` |
| `sessions.headed` | sessions | Headed Chromium | **available** | `mode=headed` |
| `sessions.cdp` | sessions | Attach over CDP | **available** | `cdpEndpoint` |
| `sessions.executable` | sessions | Custom Chromium executable | **available** | `executablePath` |
| `sessions.discovery` | sessions | Cross-platform browser discovery | **available** | `browser discover and discoverBrowserExecutables` |
| `sessions.providers` | sessions | Explicit browser providers | **available** | `browserProvider` |
| `sessions.extensions` | sessions | Reviewed unpacked extensions | **available** | `browserProvider.extensions` |
| `sessions.profiles` | sessions | Named isolated profiles | **available** | `profile` |
| `sessions.persistent_profiles` | sessions | Runtime-owned persistent browser profiles | **available** | `browserProvider.persistentProfile and /v1/profiles` |
| `sessions.storage_import` | sessions | Explicit storage-state import | **available** | `profile import` |
| `sessions.storage_export` | sessions | Explicit storage-state export | **available** | `profile export` |
| `sessions.state_checkpoints` | sessions | Encrypted state checkpoints | **available** | `state.*` |
| `sessions.clipboard` | sessions | Policy-gated clipboard | **available** | `clipboard.*` |
| `sessions.proxy` | sessions | User-supplied proxy | **available** | `proxy` |
| `sessions.locale` | sessions | Locale and timezone | **available** | `locale/timezoneId` |
| `sessions.emulation` | sessions | Device and network emulation | **available** | `emulation.set/clear` |
| `tabs.multiple` | interaction | Tabs and popups | **available** | `tab.*` |
| `tabs.lock` | interaction | Exclusive tab locks | **available** | `tab.lock/unlock/status` |
| `page.navigate` | interaction | Navigation | **available** | `navigate/back/forward/reload` |
| `page.refs` | interaction | Snapshot-scoped page references | **available** | `snapshot refs` |
| `page.xpath` | interaction | Explicit XPath targets | **available** | `action.xpath` |
| `page.snapshot` | interaction | Semantic snapshots | **available** | `snapshot` |
| `page.click` | interaction | Click and double-click | **available** | `click/doubleClick` |
| `page.form` | interaction | Form interaction | **available** | `fill/type/press/select/check` |
| `page.hover_focus` | interaction | Hover and focus | **available** | `hover/focus` |
| `page.scroll` | interaction | Bounded scrolling | **available** | `scroll` |
| `page.mouse` | interaction | Low-level mouse actions | **available** | `mouse.*` |
| `page.keyboard` | interaction | Low-level keyboard actions | **available** | `keyboard.*` |
| `page.drag` | interaction | Drag and drop | **available** | `drag` |
| `page.wait` | interaction | Page-state waits | **available** | `wait` |
| `page.shadow` | interaction | Open Shadow DOM access | **available** | `snapshot` |
| `page.iframe` | interaction | Same-origin iframe access | **available** | `snapshot` |
| `page.frame_targeting` | interaction | Same-origin frame targeting | **available** | `action.frame` |
| `page.dialogs` | interaction | Explicit dialog handling | **available** | `action.dialog` |
| `page.history` | interaction | Bounded browser history | **available** | `history.inspect` |
| `page.navigation_graph` | interaction | Navigation graph | **available** | `session graph and /navigation-graph` |
| `page.javascript` | interaction | Policy-gated JavaScript | **available** | `evaluate` |
| `page.query` | interaction | Bounded element inspection | **available** | `query.inspect` |
| `page.batch` | interaction | Ordered action batches | **available** | `/actions/batch` |
| `page.upload` | interaction | File upload | **available** | `upload` |
| `page.download` | interaction | Controlled downloads | **available** | `download` |
| `evidence.screenshot` | evidence | Screenshots | **available** | `screenshot` |
| `evidence.paired` | evidence | Paired visual and semantic capture | **available** | `capture.paired and browser_capture` |
| `evidence.annotations` | evidence | Temporary page annotations | **available** | `annotate.show/clear` |
| `evidence.pdf` | evidence | PDF capture | **available** | `pdf` |
| `evidence.trace` | evidence | Playwright traces | **available** | `trace.*` |
| `evidence.har` | evidence | HAR capture | **available** | `recordHar` |
| `evidence.video` | evidence | Session video | **available** | `recordVideo` |
| `evidence.console` | evidence | Console records | **available** | `session evidence` |
| `evidence.clear` | evidence | Explicit runtime clearing | **available** | `cache.clear/console.clear/network.clear` |
| `evidence.network` | evidence | Network records | **available** | `session evidence` |
| `evidence.network_inspect` | evidence | Network inspection | **available** | `network.inspect and browser_network` |
| `evidence.network_export` | evidence | Network export | **available** | `network.export` |
| `evidence.receipts` | evidence | Hash-chained receipts | **available** | `ActionReceipt` |
| `evidence.extract` | evidence | Text and HTML extraction | **available** | `extract` |
| `audit.accessibility` | audit | Accessibility audit | **available** | `audit accessibility` |
| `audit.performance` | audit | Page performance observations | **available** | `audit performance` |
| `audit.assets` | audit | Broken asset audit | **available** | `audit assets` |
| `audit.console` | audit | Console error audit | **available** | `audit console` |
| `audit.security` | audit | Page security observations | **available** | `audit security` |
| `audit.visual` | audit | Visual comparison | **available** | `compare` |
| `challenge.detect` | security | Challenge detection | **available** | `challenge` |
| `challenge.handoff` | security | Human challenge handoff | **available** | `challenge wait` |
| `security.origins` | security | Origin allowlists | **available** | `allowedOrigins` |
| `security.private_network` | security | Private-network blocking | **available** | `policy` |
| `security.effects` | security | Effect-level policy | **available** | `allowedEffects` |
| `security.budgets` | security | Finite budgets | **available** | `budget` |
| `security.network_routes` | security | Policy-bounded network routes | **available** | `network.route.*` |
| `security.approvals` | security | Exact action approvals | **adapter** | `MaqamApprovalProvider` |
| `security.secrets` | security | Secret references | **adapter** | `SecretResolver` |
| `deploy.cli` | deployment | Command-line interface | **available** | `cockroach-browser` |
| `deploy.completions` | deployment | Shell completions | **available** | `completion bash|zsh|fish|powershell` |
| `deploy.user_service` | deployment | Per-user daemon autostart | **available** | `service install|status|uninstall` |
| `deploy.bootstrap` | deployment | One-command bootstrap | **available** | `bootstrap` |
| `deploy.sdk` | deployment | TypeScript SDK | **available** | `BrowserRuntime/BrowserClient` |
| `deploy.http` | deployment | Authenticated HTTP API | **available** | `serve` |
| `deploy.openapi` | deployment | OpenAPI discovery | **available** | `/v1/openapi.json` |
| `deploy.metrics` | deployment | Prometheus metrics | **available** | `/v1/metrics` |
| `deploy.mcp` | deployment | Observation-first MCP server | **available** | `mcp` |
| `deploy.docker` | deployment | Docker runtime | **available** | `Dockerfile` |
| `deploy.dashboard` | deployment | Local dashboard | **available** | `dashboard` |
| `deploy.remote` | deployment | Authenticated remote workers | **available** | `BrowserClient` |
| `deploy.worker_pool` | deployment | Multi-worker orchestration | **available** | `BrowserWorkerPool` |
| `deploy.activity` | deployment | Configurable activity stream | **available** | `/v1/activity and /v1/activity/stream` |
| `deploy.queue` | deployment | Durable local jobs | **available** | `JobQueue` |
| `deploy.health` | deployment | Doctor and daemon health checks | **available** | `doctor and /v1/health` |
| `integration.maqam` | integration | Maqam governance | **adapter** | `cockroach-browser/maqam` |
| `integration.qarinah` | integration | Qarinah memory | **adapter** | `cockroach-browser/qarinah` |
| `integration.crawler` | integration | Cockroach Crawler handoff | **adapter** | `cockroach-browser/crawler` |
| `integration.productloop` | integration | ProductLoop capability snapshot | **adapter** | `docs/productloop.md` |
| `integration.webhooks` | integration | Signed lifecycle webhooks | **available** | `SignedWebhookDispatcher` |
| `integration.team_sync` | integration | Team session control | **available** | `TeamSessionStore and /access` |

## Status model

- **available**: implemented in Cockroach Browser 0.3.0
- **adapter**: integration contract is present, but another package or host authority is required
- **planned**: documented direction, not part of the current release
