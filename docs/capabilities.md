# Capability matrix

This file is generated from `src/capabilities.ts`.

| ID | Group | Capability | Status | Surface |
| --- | --- | --- | --- | --- |
| `sessions.authorized` | sessions | Authorized browser sessions | **available** | `runtime.createSession` |
| `sessions.headless` | sessions | Headless Chromium | **available** | `mode=headless` |
| `sessions.headed` | sessions | Headed Chromium | **available** | `mode=headed` |
| `sessions.cdp` | sessions | Attach over CDP | **available** | `cdpEndpoint` |
| `sessions.executable` | sessions | Custom Chromium executable | **available** | `executablePath` |
| `sessions.profiles` | sessions | Named isolated profiles | **available** | `profile` |
| `sessions.storage_import` | sessions | Explicit storage-state import | **available** | `profile import` |
| `sessions.storage_export` | sessions | Explicit storage-state export | **available** | `profile export` |
| `sessions.proxy` | sessions | User-supplied proxy | **available** | `proxy` |
| `sessions.locale` | sessions | Locale and timezone | **available** | `locale/timezoneId` |
| `tabs.multiple` | interaction | Tabs and popups | **available** | `tab.*` |
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
| `page.javascript` | interaction | Policy-gated JavaScript | **available** | `evaluate` |
| `page.upload` | interaction | File upload | **available** | `upload` |
| `page.download` | interaction | Controlled downloads | **available** | `download` |
| `evidence.screenshot` | evidence | Screenshots | **available** | `screenshot` |
| `evidence.pdf` | evidence | PDF capture | **available** | `pdf` |
| `evidence.trace` | evidence | Playwright traces | **available** | `trace.*` |
| `evidence.har` | evidence | HAR capture | **available** | `recordHar` |
| `evidence.video` | evidence | Session video | **available** | `recordVideo` |
| `evidence.console` | evidence | Console records | **available** | `session evidence` |
| `evidence.network` | evidence | Network records | **available** | `session evidence` |
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
| `deploy.completions` | deployment | Shell completions | **available** | `completion bash|zsh|powershell` |
| `deploy.user_service` | deployment | Per-user daemon autostart | **available** | `service install|status|uninstall` |
| `deploy.bootstrap` | deployment | One-command bootstrap | **available** | `bootstrap` |
| `deploy.sdk` | deployment | TypeScript SDK | **available** | `BrowserRuntime/BrowserClient` |
| `deploy.http` | deployment | Authenticated HTTP API | **available** | `serve` |
| `deploy.mcp` | deployment | Observation-first MCP server | **available** | `mcp` |
| `deploy.docker` | deployment | Docker runtime | **available** | `Dockerfile` |
| `deploy.dashboard` | deployment | Local dashboard | **available** | `dashboard` |
| `deploy.remote` | deployment | Authenticated remote workers | **available** | `BrowserClient` |
| `deploy.queue` | deployment | Durable local jobs | **available** | `JobQueue` |
| `deploy.health` | deployment | Doctor and daemon health checks | **available** | `doctor and /v1/health` |
| `integration.maqam` | integration | Maqam governance | **adapter** | `cockroach-browser/maqam` |
| `integration.qarinah` | integration | Qarinah memory | **adapter** | `cockroach-browser/qarinah` |
| `integration.crawler` | integration | Cockroach Crawler handoff | **adapter** | `cockroach-browser/crawler` |
| `integration.productloop` | integration | ProductLoop capability snapshot | **adapter** | `docs/productloop.md` |
| `integration.webhooks` | integration | Signed event webhooks | **planned** | `roadmap` |
| `integration.team_sync` | integration | Team session control | **planned** | `roadmap` |

## Status model

- **available**: implemented in Cockroach Browser 0.1.1
- **adapter**: integration contract is present, but another package or host authority is required
- **planned**: documented direction, not part of the current release
