export const site = {
  name: "Cockroach Browser",
  version: "0.1.1",
  origin: "https://cockroachbrowser.com",
  repository: "https://github.com/AjnasNB/cockroach-browser",
  npm: "https://www.npmjs.com/package/cockroach-browser",
  description:
    "A local-first browser runtime for AI agents with authorized sessions, snapshot-scoped page references, evidence capture, MCP, and Maqam policy hooks."
};

export const navGroups = [
  {
    title: "Start",
    items: [
      ["Getting started", "getting-started"],
      ["Sessions and profiles", "sessions"]
    ]
  },
  {
    title: "Operate",
    items: [
      ["Actions and semantic refs", "actions"],
      ["Capture and evidence", "capture"],
      ["Network boundary", "network"],
      ["Files and downloads", "files"],
      ["Audits and comparisons", "audits"],
      ["Jobs and retries", "jobs"]
    ]
  },
  {
    title: "Connect",
    items: [
      ["MCP", "mcp"],
      ["Maqam", "maqam"],
      ["Qarinah", "qarinah"],
      ["Cockroach Crawler", "crawler"],
      ["ProductLoop OS", "productloop"]
    ]
  },
  {
    title: "Ship",
    items: [
      ["Security", "security"],
      ["Deployment", "deployment"],
      ["Capability matrix", "capabilities"]
    ]
  }
];

const snippets = {
  install: `npm install --save-dev cockroach-browser
npx cockroach-browser setup
npx cockroach-browser doctor`,
  serve: `npx cockroach-browser serve --host 127.0.0.1 --port 43110

# The daemon writes a 32-byte bearer token to its local data directory.
# Pass its path to every CLI call instead of putting a token in shell history.
npx cockroach-browser session list --token-file .cockroach-browser/auth-token`,
  session: `{
  "purpose": "Verify the release checklist",
  "actor": "release-agent",
  "mode": "headless",
  "startUrl": "https://docs.example.com/releases",
  "policy": {
    "allowedOrigins": ["https://docs.example.com"],
    "allowedEffects": ["read"],
    "allowedActions": ["navigate", "snapshot", "extract", "screenshot"],
    "budget": {
      "maxActions": 40,
      "maxTabs": 2,
      "maxDurationMs": 300000
    }
  }
}`,
  sdk: `import { BrowserRuntime } from "cockroach-browser";

const browser = new BrowserRuntime({ root: ".cockroach-browser" });
await browser.initialize();

const session = await browser.createSession({
  purpose: "Inspect the public release page",
  mode: "headless",
  startUrl: "https://docs.example.com/releases",
  policy: {
    allowedOrigins: ["https://docs.example.com"],
    allowedEffects: ["read"],
    allowedActions: ["navigate", "snapshot", "extract", "screenshot"]
  }
});

const snapshot = await browser.snapshot(session.id);
console.log(snapshot.title, snapshot.refs);
await browser.close();`,
  action: `const snapshot = await browser.snapshot(session.id);
const releaseLink = snapshot.refs.find(
  (ref) => ref.role === "link" && ref.name.includes("Release notes")
);

if (!releaseLink) throw new Error("Release link was not present");

const result = await browser.act(session.id, {
  kind: "click",
  ref: releaseLink.ref,
  purpose: "Open the release notes selected from cited page state"
});

console.log(result.receipt.receiptHash);`,
  exactTarget: `await browser.act(session.id, {
  kind: "fill",
  xpath: "//*[@id='account-name']",
  frame: { name: "account-panel" },
  value: "Ajnas",
  purpose: "Fill the reviewed same-origin account form"
});`,
  networkRoute: `await browser.act(session.id, {
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
      body: "{\\"releases\\":[]}"
    }
  },
  purpose: "Install a deterministic response for the reviewed test"
});`,
  mcp: `{
  "mcpServers": {
    "cockroach-browser": {
      "command": "npx",
      "args": ["-y", "cockroach-browser@0.1.1", "mcp"],
      "env": {
        "COCKROACH_BROWSER_URL": "http://127.0.0.1:43110",
        "COCKROACH_BROWSER_TOKEN": "<load from your secret store>"
      }
    }
  }
}`,
  docker: `docker build -t cockroach-browser:0.1.1 .
docker run --rm \\
  --read-only \\
  --tmpfs /tmp \\
  --tmpfs /data \\
  -p 127.0.0.1:43110:43110 \\
  cockroach-browser:0.1.1`,
  profile: `export COCKROACH_BROWSER_PROFILE_PASSPHRASE="read-from-your-secret-store"
npx cockroach-browser profile import \\
  --name reviewed-support-session \\
  --file ./storage-state.json

npx cockroach-browser profile list`,
  cliAction: `npx cockroach-browser snapshot \\
  --session "$SESSION_ID" \\
  --token-file .cockroach-browser/auth-token

npx cockroach-browser act \\
  --session "$SESSION_ID" \\
  --input ./action.json \\
  --token-file .cockroach-browser/auth-token`
};

export const pages = [
  {
    slug: "getting-started",
    title: "Getting started",
    kicker: "Install once. Admit one origin. Keep every result.",
    lede:
      "Cockroach Browser gives an AI agent a real Chromium session without turning the browser into ambient authority. Start with a local daemon or embed the TypeScript runtime.",
    sections: [
      {
        title: "Install the package and Chromium",
        body:
          "<p>The package supports maintained Node.js 22, 24, and 26 releases. Chromium is explicit so package installation stays predictable and browser downloads never happen in a lifecycle script.</p>",
        code: snippets.install,
        label: "terminal"
      },
      {
        title: "Start the authenticated localhost daemon",
        body:
          "<p>The daemon binds to loopback by default, generates a strong bearer token, and rejects requests without it. A non-loopback bind requires an explicit remote setting and TLS.</p>",
        code: snippets.serve,
        label: "terminal"
      },
      {
        title: "Create the smallest useful session",
        body:
          "<p>A session must state its purpose, allowed origins, effects, actions, and resource ceilings. The following session can observe one documentation origin. It cannot write, upload, download, access credentials, or leave that origin.</p>",
        code: snippets.session,
        label: "session.json"
      },
      {
        title: "Embed the runtime",
        body:
          "<p>Use the SDK when the browser process belongs inside your service. Use the authenticated client when a separate daemon owns Chromium. Both surfaces return the same snapshots, evidence, and receipts.</p>",
        code: snippets.sdk,
        label: "quickstart.mjs"
      }
    ]
  },
  {
    slug: "sessions",
    title: "Sessions and profiles",
    kicker: "A browser session is borrowed authority, not a reusable credential bucket.",
    lede:
      "Every session has an owner, purpose, mode, origin boundary, action boundary, effect boundary, and finite budget. Profiles are named, isolated, and imported only by an authorized operator.",
    sections: [
      {
        title: "Choose the browser connection",
        body:
          "<p>Launch bundled Chromium in headless or headed mode, supply a compatible executable, or attach to a user-selected CDP endpoint. CDP attachment is never discovered automatically. The host names the endpoint and accepts responsibility for that browser.</p><ul><li><strong>Headless:</strong> unattended evidence and audits.</li><li><strong>Headed:</strong> review, login, consent, and human handoff.</li><li><strong>CDP:</strong> attach to an explicitly selected Chrome debugging endpoint.</li><li><strong>Custom executable:</strong> use a compatible browser binary selected by the operator.</li></ul>"
      },
      {
        title: "Keep profiles explicit and encrypted",
        body:
          "<p>Profiles isolate cookies and storage. Import and export require an explicit name, file path, and passphrase supplied through an environment variable. Passphrases are not accepted as command arguments and are not written to manifests.</p>",
        code: snippets.profile,
        label: "terminal"
      },
      {
        title: "Budget every session",
        body:
          "<p>The default budget limits actions, session duration, tabs, download bytes, upload bytes, snapshot characters, retained history, network rules, static intercepted responses, and evidence bytes. Narrow these limits for each workflow. A budget is a hard stop, not a billing estimate.</p>"
      },
      {
        title: "Close deliberately",
        body:
          "<p>Closing a session releases tabs, browser context, traces, and runtime state. Persist a profile only when the operator requested it. Qarinah records cited outcomes and Maqam records governance receipts, but neither receives raw profile material.</p>"
      }
    ]
  },
  {
    slug: "actions",
    title: "Actions and semantic refs",
    kicker: "Observe first. Select a cited element. Act on exactly that target.",
    lede:
      "Semantic snapshots turn visible page state into compact references with roles and accessible names. Each reference is bound to the observed page revision, so agents refresh the snapshot after page state changes instead of guessing viewport coordinates.",
    sections: [
      {
        title: "Snapshot before action",
        body:
          "<p>A snapshot includes the current URL, title, bounded readable text, semantic references, challenge state, a digest, and a truncation flag. Open shadow roots and readable same-origin frames are included. Cross-origin frames retain their browser boundary.</p>"
      },
      {
        title: "Use a ref from the current snapshot",
        body:
          "<p>Refs make the action target inspectable. A click receipt records the canonical input digest, output digest, policy digest, URLs before and after, evidence IDs, and the previous receipt hash.</p>",
        code: snippets.action,
        label: "semantic-action.mjs"
      },
      {
        title: "Supported interactions",
        body:
          "<p>Navigation, reload, back, forward, tab control, click, double-click, fill, type, press, select, check, uncheck, hover, focus, bounded scroll, low-level in-viewport mouse input, bounded keyboard input, drag, wait, dialog handling, session-history inspection, upload, download, extract, screenshot, PDF, tracing, and policy-gated JavaScript are available in the runtime.</p><p>Each action is classified by effect and risk before dispatch. High-risk actions belong behind Maqam approval.</p>"
      },
      {
        title: "Target exact XPath and same-origin frames",
        body:
          "<p>Element actions accept exactly one semantic ref, CSS selector, or XPath. CSS and XPath actions may target one exact same-origin frame by index, name, or URL. Cross-origin frames remain unavailable, and a snapshot ref cannot be combined with a separate frame target because the ref already identifies its observed frame.</p>",
        code: snippets.exactTarget,
        label: "same-origin-frame.mjs"
      },
      {
        title: "Handle dialogs explicitly",
        body:
          "<p>Undeclared JavaScript dialogs are dismissed. Accepting one requires <code>allowDialogAccept</code> and an exact approval even if the session otherwise removed default approval actions. Prompt text can come only from a bounded opaque host reference. Receipts report the dialog type, a bounded message, and whether the response was explicit.</p>"
      },
      {
        title: "Inspect only this session's history",
        body:
          "<p><code>history.inspect</code> returns sanitized URLs, titles, tab IDs, timestamps, and action sources observed in this session. <code>maxHistoryEntries</code> bounds retention. The action never discovers an ambient browser profile or the user's general browsing history.</p>"
      },
      {
        title: "JavaScript is an explicit capability",
        body:
          "<p>Expression evaluation is disabled unless the session policy allows JavaScript and the action is approved when required. Do not use evaluation as a shortcut around origin, credential, file, or effect controls.</p>"
      }
    ]
  },
  {
    slug: "capture",
    title: "Capture and evidence",
    kicker: "A browser result should be inspectable after the tab is gone.",
    lede:
      "Cockroach Browser records bounded artifacts and hash-chained receipts so a team can connect what the page showed, what the agent requested, what policy decided, and what changed.",
    sections: [
      {
        title: "Evidence types",
        body:
          "<p>Snapshots, screenshots, PDFs, Playwright traces, HAR files, console records, network metadata, downloads, audits, visual comparisons, and action records share one evidence index. Every record has a content type, byte size, digest, source URL when applicable, and structured metadata.</p>"
      },
      {
        title: "Receipts form a chain",
        body:
          "<p>Each action receipt links to the previous receipt hash. The chain exposes missing, reordered, or modified records. Verification checks the chain and artifact digests without replaying the browser session.</p>"
      },
      {
        title: "Capture only what the workflow needs",
        body:
          "<p>HAR, video, trace, console, and network capture can contain sensitive material. Enable them per session, apply evidence byte ceilings, and keep the evidence directory under deployment-owned access control.</p>"
      },
      {
        title: "Carry evidence into memory",
        body:
          "<p>The Qarinah adapter records cited, metadata-only read outcomes and receipt metadata after filtering cookies, storage values, form values, and secrets. It does not dispatch browser actions or store hidden reasoning. A host may link a mutation outcome to a complete causal receipt chain when one exists, but the recorder does not require or synthesize that chain.</p>"
      }
    ]
  },
  {
    slug: "network",
    title: "Network boundary",
    kicker: "The browser may render a page. It does not inherit your whole network.",
    lede:
      "Every navigation and subresource request is checked against the session's explicit origin policy. Public adapters block loopback and private-network targets by default.",
    sections: [
      {
        title: "Start from an allowlist",
        body:
          "<p>List exact HTTPS origins whenever possible. Redirects and subresources are re-evaluated, so an admitted start URL cannot silently widen the session. Denied origins take precedence.</p>"
      },
      {
        title: "Private networks require an owned deployment decision",
        body:
          "<p>The public browser adapter rejects loopback, link-local, and private-network destinations. A deployment owner may opt in to a specific internal workflow with <code>allowPrivateNetwork</code>. Never expose that session to untrusted callers.</p>"
      },
      {
        title: "Proxies are supplied, not discovered",
        body:
          "<p>A session can use an operator-provided proxy. Usernames and passwords are secret references resolved by the host. The runtime does not scan local browser settings, discover credentials, rotate identities, or present proxy use as access-control bypass.</p>"
      },
      {
        title: "Intercept only exact-origin requests",
        body:
          "<p>Network interception is disabled unless <code>allowNetworkInterception</code> is explicit. A rule matches one already admitted origin, a bounded pathname glob, an explicit method set, and optional resource types. It can abort a request or return a static response. It cannot redirect, inject credentials, discover cookies, or widen the session origin list.</p>",
        code: snippets.networkRoute,
        label: "static-route.mjs"
      },
      {
        title: "Put byte ceilings around fixtures",
        body:
          "<p><code>maxNetworkRules</code> limits active rules, <code>maxRouteFulfillBytes</code> limits one static body, and <code>maxInterceptedBytes</code> limits cumulative fulfilled bytes. Route listings expose body size and digest, not response content. Use this for deterministic tests and deployment-owned fixtures, never to bypass authorization or site controls.</p>"
      },
      {
        title: "Remote workers require TLS",
        body:
          "<p>The daemon binds to localhost by default. Remote binding requires an explicit setting, TLS certificate and key, bearer authentication, and a CORS allowlist. Public unauthenticated server binding is not supported.</p>"
      }
    ]
  },
  {
    slug: "files",
    title: "Files and downloads",
    kicker: "Files cross a trust boundary. Make the direction and byte ceiling visible.",
    lede:
      "Uploads and downloads are separate effects with separate policy switches and size limits. Paths come from the host or an approved action, never from page text alone.",
    sections: [
      {
        title: "Uploads",
        body:
          "<p>Enable uploads only for a workflow that needs them. Supply explicit paths, verify ownership before creating the session, and keep <code>maxUploadBytes</code> below the deployment's acceptable ceiling. Maqam should approve consequential uploads against the exact file set and destination.</p>"
      },
      {
        title: "Downloads",
        body:
          "<p>Downloads land in the evidence directory, receive a digest, and are linked from the action receipt. The session stops a download that exceeds <code>maxDownloadBytes</code>. Treat downloaded files as untrusted input.</p>"
      },
      {
        title: "PDF output",
        body:
          "<p>Page PDF generation is available in Chromium sessions and is recorded as evidence. PDF parsing is not a browser action in this package. Hand document parsing to a bounded document tool or Cockroach Crawler when the workflow needs extracted document text.</p>"
      },
      {
        title: "Storage state is not a normal file",
        body:
          "<p>Profile import and export use encrypted storage managed by the profile vault. Do not route profile archives through agent-visible upload or download actions.</p>"
      }
    ]
  },
  {
    slug: "audits",
    title: "Audits and comparisons",
    kicker: "Turn a rendered page into a reproducible engineering check.",
    lede:
      "Run accessibility, performance, broken asset, console, and page-security observations against the same authorized session used by the agent.",
    sections: [
      {
        title: "Run selected audits",
        body:
          "<p>The CLI and client accept a comma-separated audit set. Results are bounded JSON evidence, not a claim of complete standards compliance.</p>",
        code: `npx cockroach-browser audit \\
  --session "$SESSION_ID" \\
  --kinds accessibility,performance,assets,console,security \\
  --token-file .cockroach-browser/auth-token`,
        label: "terminal"
      },
      {
        title: "Accessibility observations",
        body:
          "<p>Inspect accessible names, obvious missing labels, heading order, and semantic failures visible to the browser. Use the result to find candidate defects, then validate with full accessibility tooling and human review.</p>"
      },
      {
        title: "Performance and page security",
        body:
          "<p>Collect navigation timing, paint entries, transfer sizes, resource summaries, mixed content, and insecure form targets visible to the page runtime. Results describe the captured run and environment.</p>"
      },
      {
        title: "Visual comparison",
        body:
          "<p>Compare a current screenshot with an explicit baseline, store the diff, and emit a mismatch percentage. Pin viewport, color scheme, browser version, data fixtures, and fonts for stable regression checks.</p>"
      }
    ]
  },
  {
    slug: "jobs",
    title: "Jobs and retries",
    kicker: "Persist a bounded plan. Retry observations. Never guess after an uncertain write.",
    lede:
      "The local job queue stores action plans, checkpoints, attempts, status, and failure state in deployment-owned JSON.",
    sections: [
      {
        title: "Queue a finite plan",
        body:
          "<p>Each job belongs to one session and contains a finite action list. The queue persists before and after execution so a restart can inspect the last completed checkpoint.</p>"
      },
      {
        title: "Retry only safe observations",
        body:
          "<p>Automatic retry is limited to read-like operations such as snapshots, waits, and extraction. Navigation and mutations may have produced an external effect even when the client missed the response. Unknown results stop for review.</p>"
      },
      {
        title: "Use idempotency above the browser",
        body:
          "<p>Maqam and application services should carry stable operation IDs through policy, browser execution, downstream writes, and receipts. Cross-ledger writes are not one transaction, so use an explicit outbox and reconcile by ID.</p>"
      },
      {
        title: "Durability scope",
        body:
          "<p>The built-in queue is process-local and file-backed. It is useful for one owned worker. Distributed scheduling, signed webhooks, and team session control remain planned capabilities.</p>"
      }
    ]
  },
  {
    slug: "mcp",
    title: "MCP",
    kicker: "Give an MCP client observations and proposals, not browser ownership.",
    lede:
      "The native stdio server exposes health, capabilities, sessions, snapshots, audits, and canonical action proposals. It does not expose raw profile management or direct mutation authority.",
    sections: [
      {
        title: "Configure the local server",
        body:
          "<p>Start the authenticated daemon first. Load its token into the MCP process through trusted environment or secret handling, and point the MCP server at the daemon URL. Do not commit a live token.</p>",
        code: snippets.mcp,
        label: "mcp.json"
      },
      {
        title: "Observation-first tools",
        body:
          "<p>The MCP surface provides <code>browser_capabilities</code>, <code>browser_health</code>, <code>browser_sessions</code>, <code>browser_snapshot</code>, <code>browser_audit</code>, and <code>browser_propose_action</code>. A proposal returns canonical action material for a governed dispatcher and does not execute it.</p>"
      },
      {
        title: "Keep lifecycle authority outside the model",
        body:
          "<p>Session creation, profile import, login, secret resolution, remote binding, and raw action dispatch stay with the host. This prevents a model from expanding its own origins, credentials, browser state, or resource ceilings.</p>"
      },
      {
        title: "Route consequential work through Maqam",
        body:
          "<p>MCP proposes. Maqam evaluates policy, binds an approval to the exact operation, dispatches through the driver, rejects replay, and records governance evidence.</p>"
      }
    ]
  },
  {
    slug: "maqam",
    title: "Maqam integration",
    kicker: "Cockroach Browser executes. Maqam decides whether execution is allowed.",
    lede:
      "For operations routed through its adapter, Maqam presents a four-step browser driver: observe, preview, apply, and submit, then applies policy, exact approval, replay protection, and governance receipts.",
    sections: [
      {
        title: "Separate the authorities",
        body:
          "<p>The browser runtime owns Chromium, tabs, semantic refs, action execution, and browser evidence. For operations routed through the adapter, Maqam owns registered tools, policy decisions, effect classification, exact one-use approvals, preview tokens, replay rejection, and governance records.</p>"
      },
      {
        title: "Observe and preview",
        body:
          "<p><code>observe</code> returns current page state and a stable revision. <code>preview</code> resolves the requested operation against that revision. If the target changed, the operation must be observed and previewed again.</p>"
      },
      {
        title: "Apply or submit once",
        body:
          "<p><code>apply</code> covers structural browser operations. <code>submit</code> covers form submission. The adapter carries operation IDs and rejects duplicate or stale execution. Unknown write outcomes are not retried automatically.</p>"
      },
      {
        title: "Do not expose the managed session directly",
        body:
          "<p>A session placed behind the Maqam driver must remain host-owned. Do not expose its raw action endpoint or lifecycle methods to the same agent. Maqam governance covers only operations routed through this adapter; trusted-host SDK calls and explicitly enabled raw-action routes remain separate host authority. The browser adapter is an execution boundary, not a second policy system.</p>"
      }
    ]
  },
  {
    slug: "qarinah",
    title: "Qarinah integration",
    kicker: "Turn browser outcomes into cited memory without turning memory into a dispatcher.",
    lede:
      "Qarinah can record sanitized browser outcomes, source URLs, receipt hashes, and evidence IDs so later agents retrieve compact, cited project context.",
    sections: [
      {
        title: "Record metadata, not browser secrets",
        body:
          "<p>The adapter removes cookies, storage values, form values, secret references, and hidden reasoning. For read outcomes, it records bounded metadata such as the selected source, result type, receipt hash, and evidence pointers needed to verify the memory. The host supplies the persistence callback supported by its installed Qarinah release.</p>"
      },
      {
        title: "Keep memory read-only with respect to the browser",
        body:
          "<p>Qarinah never creates a session, changes policy, approves an action, or dispatches a browser operation. A later memory query may inform a proposal, but Maqam and the browser boundary still decide execution.</p>"
      },
      {
        title: "Link a causal receipt chain when it exists",
        body:
          "<p>A read outcome needs citations and receipt metadata, not a synthetic mutation chain. For consequential mutations, a host may connect public evidence, browser observation, Qarinah memory, Maqam decision, approved tool execution, observed result, and permanent receipt when every stage exists. The integration does not invent missing stages or require one cross-system transaction.</p>"
      },
      {
        title: "Cross-tool context",
        body:
          "<p>The same cited memory pack can be consumed by coding agents and CLIs that support the Qarinah integration. Authority remains scoped by workspace and source provenance.</p>"
      }
    ]
  },
  {
    slug: "crawler",
    title: "Cockroach Crawler integration",
    kicker: "Use the crawler for breadth. Use the browser for one rendered path.",
    lede:
      "Cockroach Crawler maps and extracts public web content at bounded scale. Cockroach Browser handles stateful rendering, semantic interactions, screenshots, audits, and user-authorized sessions.",
    sections: [
      {
        title: "Choose the right engine",
        body:
          "<p>Start with the crawler for static HTTP, mapping, structured extraction, documents, feeds, and public-source breadth. Hand a specific URL to the browser when JavaScript rendering, page state, interaction, or browser evidence is required.</p>"
      },
      {
        title: "Handoff explicit URLs and finite budgets",
        body:
          "<p>The adapter passes explicit seed URLs, allowed origins, page ceilings, and other finite crawl budgets. Keep the browser-session purpose in local browser evidence and host orchestration records; it is not crawler authority. The handoff never shares browser profiles, cookies, authenticated state, session secrets, or interactive browser state.</p>"
      },
      {
        title: "Normalize the evidence",
        body:
          "<p>Keep source URL, capture time, content digest, extraction method, and failure state across the handoff. Maqam may govern both tools while retaining separate receipts and effect models.</p>"
      },
      {
        title: "Avoid duplicate work",
        body:
          "<p>Map once with the crawler, rank candidate pages, then render only the pages that need a browser. This preserves browser budgets and makes the reason for each rendered session visible.</p>"
      }
    ]
  },
  {
    slug: "productloop",
    title: "ProductLoop OS",
    kicker: "Describe a bounded browser capability without collapsing every ledger into one runtime.",
    lede:
      "A host-owned ProductLoop adapter can consume Cockroach Browser's structural capability snapshot while Maqam, Qarinah, Cockroach Crawler, ProductLoop, and the browser retain distinct contracts and records.",
    sections: [
      {
        title: "Read the structural capability snapshot",
        body:
          "<p><code>productLoopBrowserCapabilitySnapshot()</code> returns descriptive structural data for a host adapter: observations, proposals, effects, transports, supported Node releases, governance requirements, and lifecycle ownership. It is not a directly registerable ProductLoop connector manifest. Translate it into the exact versioned ProductLoop contract accepted by the installed release. The snapshot grants no origins, profiles, credentials, lifecycle, or action authority.</p>"
      },
      {
        title: "Use Maqam as the gateway",
        body:
          "<p>Product workflows should call a Maqam-governed tool wrapper for consequential browser operations. Maqam governance applies only when the operation is actually routed through that adapter. Read-only structural adapters may expose bounded observations directly when their host policy allows it.</p>"
      },
      {
        title: "Keep ledgers distinct",
        body:
          "<p>Browser evidence proves what Chromium observed and executed. Maqam proves the policy and approval path. Qarinah preserves cited project memory. ProductLoop coordinates packages and workflows. Stable IDs connect these records without pretending they are one database.</p>"
      },
      {
        title: "Current status",
        body:
          "<p>The ProductLoop integration in 0.1.1 is a structural capability snapshot for a host-owned adapter, not direct connector registration. The browser runtime, SDK, CLI, HTTP API, MCP server, evidence chain, and local dashboard are implemented in the package.</p>"
      }
    ]
  },
  {
    slug: "security",
    title: "Security",
    kicker: "Useful browser capability without silent authority expansion.",
    lede:
      "Cockroach Browser is built around explicit sessions, explicit origins, separate effects, finite budgets, authenticated transport, evidence receipts, and challenge handoff.",
    sections: [
      {
        title: "Threat boundary",
        body:
          "<p>Assume page content is untrusted, agent input may be wrong, downloaded files may be hostile, and browser state may contain credentials. Keep session lifecycle, profile management, secret resolution, and remote binding in host-controlled code.</p>"
      },
      {
        title: "Challenges stop automation",
        body:
          "<p>The runtime detects login, consent, CAPTCHA, and access challenges, pauses the session, records evidence, and waits for a human or authorized resolver. It does not bypass CAPTCHAs, defeat access controls, cloak automation, rotate fingerprints to evade defenses, or promise access after a site denies it.</p>"
      },
      {
        title: "Exact approval for consequential actions",
        body:
          "<p>Use the Maqam adapter for writes, execute effects, uploads, downloads, credential use, JavaScript, and other high-risk operations. Approval must bind to the canonical action input and expire after use.</p>"
      },
      {
        title: "Deployment checklist",
        body:
          "<ul><li>Bind to loopback unless remote operation is required.</li><li>Require TLS, bearer auth, and a CORS allowlist for remote workers.</li><li>Use exact HTTPS origin allowlists.</li><li>Keep private-network access disabled for untrusted callers.</li><li>Store profile passphrases and proxy credentials in a secret manager.</li><li>Clamp actions, tabs, time, files, snapshots, and evidence.</li><li>Protect evidence and dashboard access with OS or service identity.</li><li>Review third-party page terms and obtain authorization for the workflow.</li></ul>"
      }
    ]
  },
  {
    slug: "deployment",
    title: "Deployment",
    kicker: "Local by default. Remote only when identity, TLS, and ownership are explicit.",
    lede:
      "Run the TypeScript runtime in-process, use the authenticated localhost daemon, place it in a container, or connect an SDK client to an explicitly configured remote worker.",
    sections: [
      {
        title: "Local daemon",
        body:
          "<p>Use the CLI for a single-user workstation or development environment. The daemon creates its own token file and serves only on loopback unless you explicitly configure a remote deployment.</p>",
        code: snippets.serve,
        label: "terminal"
      },
      {
        title: "Container",
        body:
          "<p>Pin the package and browser version, use a read-only root filesystem, mount only the data and artifact paths the worker needs, and bind the published port to loopback or a private service network.</p>",
        code: snippets.docker,
        label: "terminal"
      },
      {
        title: "Remote worker",
        body:
          "<p>Remote binding requires TLS and bearer authentication. Place the worker behind service identity where possible. Do not expose an unauthenticated daemon to the public internet. Keep browser profiles isolated by deployment and owner.</p>"
      },
      {
        title: "Release verification",
        body:
          "<p>Build on Node 22, 24, and 26; run runtime and browser tests; verify the packed npm consumer; audit runtime dependencies; validate the website; inspect the tarball; and match the npm artifact to the reviewed Git commit before publishing.</p>"
      }
    ]
  }
];

export const homepage = {
  title: "The browser runtime your AI agents can use without inheriting your whole machine.",
  lede:
    "Authorized Chromium sessions, snapshot-scoped page references, bounded actions, browser evidence, MCP, and Maqam policy hooks in one local-first TypeScript package.",
  proof: [
    ["70", "mapped capabilities"],
    ["62", "available runtime surfaces"],
    ["6", "adapter-backed surfaces"],
    ["2", "planned surfaces"]
  ]
};
