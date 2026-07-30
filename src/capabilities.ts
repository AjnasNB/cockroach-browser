export type CapabilityStatus = "available" | "adapter" | "planned";

export interface Capability {
  id: string;
  group: "sessions" | "interaction" | "evidence" | "audit" | "deployment" | "integration" | "security";
  title: string;
  summary: string;
  status: CapabilityStatus;
  surface: string;
}

export const CAPABILITIES: readonly Capability[] = Object.freeze([
  ["sessions.authorized", "sessions", "Authorized browser sessions", "Create sessions only from explicit user or host configuration.", "available", "runtime.createSession"],
  ["sessions.headless", "sessions", "Headless Chromium", "Run unattended Chromium with the same policy boundary.", "available", "mode=headless"],
  ["sessions.headed", "sessions", "Headed Chromium", "Show the real browser for review, login, and human handoff.", "available", "mode=headed"],
  ["sessions.cdp", "sessions", "Attach over CDP", "Connect to a user-selected Chrome debugging endpoint.", "available", "cdpEndpoint"],
  ["sessions.executable", "sessions", "Custom Chromium executable", "Launch an explicitly supplied compatible browser binary.", "available", "executablePath"],
  ["sessions.profiles", "sessions", "Named isolated profiles", "Keep cookies and storage separated by an explicit profile name.", "available", "profile"],
  ["sessions.storage_import", "sessions", "Explicit storage-state import", "Import a user-selected encrypted storage-state file.", "available", "profile import"],
  ["sessions.storage_export", "sessions", "Explicit storage-state export", "Export a selected session for an authorized workflow.", "available", "profile export"],
  ["sessions.proxy", "sessions", "User-supplied proxy", "Route one session through an explicitly configured proxy.", "available", "proxy"],
  ["sessions.locale", "sessions", "Locale and timezone", "Create deterministic locale and timezone contexts.", "available", "locale/timezoneId"],
  ["tabs.multiple", "interaction", "Tabs and popups", "Open, list, switch, and close bounded tabs.", "available", "tab.*"],
  ["page.navigate", "interaction", "Navigation", "Navigate, reload, go back, and go forward within allowed origins.", "available", "navigate/back/forward/reload"],
  ["page.refs", "interaction", "Snapshot-scoped page references", "Act on compact semantic references bound to the current observed page revision.", "available", "snapshot refs"],
  ["page.xpath", "interaction", "Explicit XPath targets", "Resolve a bounded XPath only when the exact action supplies it.", "available", "action.xpath"],
  ["page.snapshot", "interaction", "Semantic snapshots", "Return visible text and interactive elements with roles and names.", "available", "snapshot"],
  ["page.click", "interaction", "Click and double-click", "Activate referenced or selected elements after policy evaluation.", "available", "click/doubleClick"],
  ["page.form", "interaction", "Form interaction", "Fill, type, press, select, check, and uncheck.", "available", "fill/type/press/select/check"],
  ["page.hover_focus", "interaction", "Hover and focus", "Move focus without relying on viewport coordinates.", "available", "hover/focus"],
  ["page.scroll", "interaction", "Bounded scrolling", "Scroll by explicit deltas under action ceilings.", "available", "scroll"],
  ["page.mouse", "interaction", "Low-level mouse actions", "Move, press, release, or click only at explicit in-viewport coordinates.", "available", "mouse.*"],
  ["page.keyboard", "interaction", "Low-level keyboard actions", "Press, release, or insert bounded text through explicit actions.", "available", "keyboard.*"],
  ["page.drag", "interaction", "Drag and drop", "Drag between two authorized semantic references.", "available", "drag"],
  ["page.wait", "interaction", "Page-state waits", "Wait for selectors, text, or bounded timeouts.", "available", "wait"],
  ["page.shadow", "interaction", "Open Shadow DOM access", "Resolve selectors and references through open shadow roots.", "available", "snapshot"],
  ["page.iframe", "interaction", "Same-origin iframe access", "Include readable same-origin frames in snapshots.", "available", "snapshot"],
  ["page.frame_targeting", "interaction", "Same-origin frame targeting", "Target an exact index, name, or URL without entering cross-origin frames.", "available", "action.frame"],
  ["page.dialogs", "interaction", "Explicit dialog handling", "Dismiss dialogs by default and require policy plus approval before accepting one.", "available", "action.dialog"],
  ["page.history", "interaction", "Bounded browser history", "Inspect a sanitized, session-local record of observed page states under a finite retention ceiling.", "available", "history.inspect"],
  ["page.javascript", "interaction", "Policy-gated JavaScript", "Evaluate JavaScript only when the session policy and approval allow it.", "available", "evaluate"],
  ["page.upload", "interaction", "File upload", "Upload explicit paths under byte and policy limits.", "available", "upload"],
  ["page.download", "interaction", "Controlled downloads", "Capture downloads into the evidence directory under byte limits.", "available", "download"],
  ["evidence.screenshot", "evidence", "Screenshots", "Capture PNG or JPEG evidence with source metadata.", "available", "screenshot"],
  ["evidence.pdf", "evidence", "PDF capture", "Generate page PDFs in Chromium sessions.", "available", "pdf"],
  ["evidence.trace", "evidence", "Playwright traces", "Start and stop trace archives for authorized sessions.", "available", "trace.*"],
  ["evidence.har", "evidence", "HAR capture", "Record network archives when enabled at session creation.", "available", "recordHar"],
  ["evidence.video", "evidence", "Session video", "Record browser video when enabled at session creation.", "available", "recordVideo"],
  ["evidence.console", "evidence", "Console records", "Capture bounded console messages with timestamps.", "available", "session evidence"],
  ["evidence.network", "evidence", "Network records", "Capture bounded request and response metadata.", "available", "session evidence"],
  ["evidence.receipts", "evidence", "Hash-chained receipts", "Link action inputs, outputs, policy decisions, and evidence.", "available", "ActionReceipt"],
  ["evidence.extract", "evidence", "Text and HTML extraction", "Return bounded readable text or HTML fragments.", "available", "extract"],
  ["audit.accessibility", "audit", "Accessibility audit", "Inspect semantic names, labels, heading order, and obvious failures.", "available", "audit accessibility"],
  ["audit.performance", "audit", "Page performance observations", "Collect navigation timing, paint entries, transfer sizes, and resource summaries.", "available", "audit performance"],
  ["audit.assets", "audit", "Broken asset audit", "Report failed scripts, styles, images, and requests.", "available", "audit assets"],
  ["audit.console", "audit", "Console error audit", "Summarize browser errors and warnings.", "available", "audit console"],
  ["audit.security", "audit", "Page security observations", "Report mixed content and insecure form targets visible to the page runtime.", "available", "audit security"],
  ["audit.visual", "audit", "Visual comparison", "Compare screenshots and emit a diff plus mismatch percentage.", "available", "compare"],
  ["challenge.detect", "security", "Challenge detection", "Detect login, consent, CAPTCHA, and access challenges.", "available", "challenge"],
  ["challenge.handoff", "security", "Human challenge handoff", "Pause for a user or authorized resolver instead of bypassing controls.", "available", "challenge wait"],
  ["security.origins", "security", "Origin allowlists", "Fail closed when navigation leaves explicitly allowed origins.", "available", "allowedOrigins"],
  ["security.private_network", "security", "Private-network blocking", "Reject private and loopback destinations in the public browser adapter.", "available", "policy"],
  ["security.effects", "security", "Effect-level policy", "Separate read, write, execute, upload, download, and credential authority.", "available", "allowedEffects"],
  ["security.budgets", "security", "Finite budgets", "Clamp actions, tabs, time, upload, download, snapshot, and evidence size.", "available", "budget"],
  ["security.network_routes", "security", "Policy-bounded network routes", "Abort or statically fulfill exact-origin requests under per-rule and session byte ceilings.", "available", "network.route.*"],
  ["security.approvals", "security", "Exact action approvals", "Bind high-risk approval to the canonical action input.", "adapter", "MaqamApprovalProvider"],
  ["security.secrets", "security", "Secret references", "Resolve proxy and integration secrets through the host, never manifests.", "adapter", "SecretResolver"],
  ["deploy.cli", "deployment", "Command-line interface", "Manage authorized sessions and observations; direct actions require an explicit trusted-host opt-in.", "available", "cockroach-browser"],
  ["deploy.completions", "deployment", "Shell completions", "Generate auditable bash, zsh, or PowerShell completion scripts without modifying shell profiles.", "available", "completion bash|zsh|powershell"],
  ["deploy.user_service", "deployment", "Per-user daemon autostart", "Install an owner-confirmed loopback daemon definition for Windows Startup, macOS LaunchAgents, or Linux systemd user services without privilege escalation.", "available", "service install|status|uninstall"],
  ["deploy.bootstrap", "deployment", "One-command bootstrap", "Verify Node, install Chromium only when missing, initialize the local data root, and probe an authenticated ephemeral loopback daemon.", "available", "bootstrap"],
  ["deploy.sdk", "deployment", "TypeScript SDK", "Embed the runtime or call an authenticated daemon.", "available", "BrowserRuntime/BrowserClient"],
  ["deploy.http", "deployment", "Authenticated HTTP API", "Expose the runtime through a bearer-token localhost server.", "available", "serve"],
  ["deploy.mcp", "deployment", "Observation-first MCP server", "Expose health, capabilities, sessions, snapshots, audits, and canonical Maqam action proposals over stdio.", "available", "mcp"],
  ["deploy.docker", "deployment", "Docker runtime", "Run Chromium and the authenticated daemon in a container.", "available", "Dockerfile"],
  ["deploy.dashboard", "deployment", "Local dashboard", "Inspect sessions, evidence, challenges, and receipts.", "available", "dashboard"],
  ["deploy.remote", "deployment", "Authenticated remote workers", "Connect SDK clients to explicitly configured remote daemons.", "available", "BrowserClient"],
  ["deploy.queue", "deployment", "Durable local jobs", "Queue bounded action plans with checkpoints and retries.", "available", "JobQueue"],
  ["deploy.health", "deployment", "Doctor and daemon health checks", "Verify the supported Node release, Chromium installation, daemon authentication, evidence integrity, and active session count.", "available", "doctor and /v1/health"],
  ["integration.maqam", "integration", "Maqam governance", "Route high-risk browser actions through exact approval and receipts.", "adapter", "cockroach-browser/maqam"],
  ["integration.qarinah", "integration", "Qarinah memory", "Record cited browser outcomes without persisting hidden reasoning or secrets.", "adapter", "cockroach-browser/qarinah"],
  ["integration.crawler", "integration", "Cockroach Crawler handoff", "Hand breadth-first collection to the crawler while retaining browser evidence.", "adapter", "cockroach-browser/crawler"],
  ["integration.productloop", "integration", "ProductLoop capability snapshot", "Describe browser capabilities for a separately reviewed ProductLoop adapter without granting authority.", "adapter", "docs/productloop.md"],
  ["integration.webhooks", "integration", "Signed lifecycle webhooks", "Queue sanitized browser lifecycle events for bounded HMAC-signed HTTPS delivery.", "available", "SignedWebhookDispatcher"],
  ["integration.team_sync", "integration", "Team session control", "Share policy and receipts without sharing raw browser profiles.", "planned", "roadmap"]
].map(([id, group, title, summary, status, surface]) => ({ id, group, title, summary, status, surface })) as Capability[]);

export function capabilities(status?: CapabilityStatus): Capability[] {
  return CAPABILITIES.filter((entry) => !status || entry.status === status).map((entry) => ({ ...entry }));
}
