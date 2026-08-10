export const site = {
  name: "Cockroach Browser",
  version: "0.3.0",
  origin: "https://cockroachbrowser.com",
  repository: "https://github.com/AjnasNB/cockroach-browser",
  npm: "https://www.npmjs.com/package/cockroach-browser",
  description:
    "Open-source local-first browser automation for AI agents with real Chromium, semantic page snapshots, profiles, files, MCP, network tools, and verifiable evidence."
};

export const comparison = {
  checkedOn: "2026-08-10",
  title: "Cockroach Browser alternatives",
  description:
    "Compare Cockroach Browser with browser libraries, MCP servers, AI browser frameworks, and hosted browser infrastructure by product layer, shipped scope, and current gaps.",
  methodology:
    "This comparison uses official project documentation reviewed on 10 August 2026. It describes product scope, deployment, and current Cockroach Browser gaps. It does not publish a speed, task-success, security, or scale ranking because there is no matched benchmark across these product categories."
};

export const ecosystem = {
  checkedOn: "2026-08-09",
  title: "Open-source toolkit for governed AI agents",
  description:
    "A source-linked map of Qarinah, Maqam, Cockroach Browser, Cockroach Crawler, and adjacent open-source agent, browser, web, extraction, and document tools.",
  methodology:
    "This page maps documented product centers and composition boundaries from official project sources. It does not publish a shared performance benchmark, security ranking, production-capacity result, or universal winner.",
  projects: [
    {
      id: "qarinah",
      name: "Qarinah",
      category: "memory",
      categoryLabel: "Project memory",
      nativeFocus:
        "Local-first, evidence-linked project memory and compact cited handoffs for coding agents.",
      chooseWhen:
        "The agent needs durable local project history with explicit provenance and disclosure controls.",
      relationship:
        "Qarinah can provide cited project context before a browser task. It does not control browser execution or approve a side effect.",
      sourceLabel: "Qarinah source",
      source: "https://github.com/AjnasNB/qarinah"
    },
    {
      id: "maqam",
      name: "Maqam",
      category: "governance",
      categoryLabel: "Action governance",
      nativeFocus:
        "A compact TypeScript boundary for policy, exact-input approval, one-use dispatch, execution, and receipts.",
      chooseWhen:
        "A selected registered action must remain bound to the input that was reviewed and consumed once.",
      relationship:
        "Cockroach Browser ships a Maqam adapter for consequential browser actions. Maqam remains a separate authority and is not part of the browser engine.",
      sourceLabel: "Maqam source",
      source: "https://github.com/AjnasNB/maqam"
    },
    {
      id: "cockroach-browser",
      name: "Cockroach Browser",
      category: "browser-runtime",
      categoryLabel: "Browser authority and evidence",
      nativeFocus:
        "A local-first TypeScript runtime for authorized browser sessions, semantic refs, finite budgets, evidence, and receipts.",
      chooseWhen:
        "A host agent needs explicit session authority and browser evidence above a maintained automation primitive.",
      relationship:
        "Cockroach Browser uses playwright-core. It is not a browser engine and does not replace Playwright.",
      sourceLabel: "Cockroach Browser source",
      source: "https://github.com/AjnasNB/cockroach-browser"
    },
    {
      id: "cockroach-crawler",
      name: "Cockroach Crawler",
      category: "web-acquisition",
      categoryLabel: "Bounded web acquisition",
      nativeFocus:
        "Local web crawling, mapping, rendering, extraction, and normalized evidence with explicit network and resource limits.",
      chooseWhen:
        "The workflow needs bounded public-web evidence rather than a stateful browser interaction session.",
      relationship:
        "Cockroach Browser handles stateful interaction. Cockroach Crawler handles breadth. Its opt-in quality option is Trafilatura-backed and delegates main-content extraction to exact trafilatura@0.2.0.",
      sourceLabel: "Cockroach Crawler source",
      source: "https://github.com/AjnasNB/cockroach-crawler"
    },
    {
      id: "playwright",
      name: "Playwright",
      category: "browser-primitive",
      categoryLabel: "Browser automation primitive",
      nativeFocus:
        "Cross-browser automation across Chromium, Firefox, and WebKit with direct APIs and testing tools.",
      chooseWhen:
        "The application should own direct browser calls and the surrounding policy, service, and evidence design.",
      relationship:
        "Cockroach Browser depends on playwright-core and adds an agent-oriented authority, transport, and evidence contract above it.",
      sourceLabel: "Playwright documentation",
      source: "https://playwright.dev/"
    },
    {
      id: "puppeteer",
      name: "Puppeteer",
      category: "browser-primitive",
      categoryLabel: "Browser automation primitive",
      nativeFocus:
        "A JavaScript API for controlling Chrome and Firefox through browser protocols.",
      chooseWhen:
        "The job needs direct JavaScript browser automation without adopting an agent session runtime.",
      relationship:
        "Cockroach Browser is not presented as a Puppeteer speed, compatibility, or browser-coverage winner.",
      sourceLabel: "Puppeteer documentation",
      source: "https://pptr.dev/"
    },
    {
      id: "browser-use",
      name: "Browser Use",
      category: "browser-agent",
      categoryLabel: "AI browser framework",
      nativeFocus:
        "An open-source Python framework for model-directed agents that interact with websites.",
      chooseWhen:
        "The product needs an autonomous browser agent, model integration, and high-level task execution.",
      relationship:
        "Cockroach Browser keeps model selection and planning outside its runtime and can serve as a bounded execution layer for a separately designed host.",
      sourceLabel: "Browser Use source",
      source: "https://github.com/browser-use/browser-use"
    },
    {
      id: "stagehand",
      name: "Stagehand",
      category: "browser-agent",
      categoryLabel: "AI browser framework",
      nativeFocus:
        "Open-source AI browser automation that combines code with model-powered observation, action, and extraction.",
      chooseWhen:
        "The workflow needs natural-language browser methods and a framework for AI-assisted interaction.",
      relationship:
        "Stagehand centers AI-assisted browser automation. Cockroach Browser centers admitted session authority, finite budgets, and evidence.",
      sourceLabel: "Stagehand documentation",
      source: "https://www.stagehand.dev/"
    },
    {
      id: "firecrawl",
      name: "Firecrawl",
      category: "web-acquisition",
      categoryLabel: "Managed web acquisition",
      nativeFocus:
        "A web API and open-source project for search, scrape, crawl, map, and browser interaction.",
      chooseWhen:
        "Managed web acquisition, hosted operations, and an API-centered product are primary requirements.",
      relationship:
        "Firecrawl and Cockroach Browser address different centers: managed web data versus authorized stateful browser execution.",
      sourceLabel: "Firecrawl documentation",
      source: "https://docs.firecrawl.dev/introduction"
    },
    {
      id: "trafilatura",
      name: "Trafilatura",
      category: "extraction",
      categoryLabel: "Main-content extraction",
      nativeFocus:
        "Web text, metadata, comments, discovery, and structured output with configurable extraction.",
      chooseWhen:
        "Main-content extraction from HTML is the central problem rather than browser interaction or agent authority.",
      relationship:
        "Cockroach Crawler's opt-in quality path delegates main-content extraction to exact trafilatura@0.2.0. Cockroach Browser does not replace an extraction specialist.",
      sourceLabel: "Trafilatura documentation",
      source: "https://trafilatura.readthedocs.io/en/latest/"
    },
    {
      id: "docling",
      name: "Docling",
      category: "document",
      categoryLabel: "Document conversion",
      nativeFocus:
        "Conversion of PDFs, office documents, images, HTML, and Markdown into a structured document representation.",
      chooseWhen:
        "Layout, tables, images, OCR, or complex document structure is the main ingestion problem.",
      relationship:
        "Docling is a document specialist. Cockroach Browser can acquire a file through an authorized session, but it does not claim Docling's conversion scope.",
      sourceLabel: "Docling documentation",
      source: "https://docling-project.github.io/docling/"
    },
    {
      id: "langgraph",
      name: "LangGraph",
      category: "orchestration",
      categoryLabel: "Agent orchestration",
      nativeFocus:
        "A low-level runtime for long-running, stateful agents with durable execution, streaming, and human involvement.",
      chooseWhen:
        "Durable workflow state, graph composition, pause and resume, and recovery are central.",
      relationship:
        "LangGraph can orchestrate a browser tool. Cockroach Browser does not replace its workflow state or agent runtime.",
      sourceLabel: "LangGraph documentation",
      source: "https://docs.langchain.com/oss/javascript/langgraph/overview"
    },
    {
      id: "openai-agents-sdk",
      name: "OpenAI Agents SDK",
      category: "orchestration",
      categoryLabel: "Agent runtime",
      nativeFocus:
        "A TypeScript SDK for agent loops, tools, handoffs, guardrails, sessions, tracing, and human involvement.",
      chooseWhen:
        "The primary job is building and running text, sandbox, or voice agents with a compact set of primitives.",
      relationship:
        "The SDK can call Cockroach Browser as a tool. Cockroach Browser does not replace its model loop, handoffs, sessions, or tracing.",
      sourceLabel: "OpenAI Agents SDK documentation",
      source: "https://openai.github.io/openai-agents-js/"
    }
  ],
  questions: [
    [
      "Do these projects form one automatic control plane?",
      "No. They are independent projects with different contracts. A deployment must explicitly connect selected layers and still own identity, secrets, isolation, storage, and operations."
    ],
    [
      "Does Cockroach Browser replace Playwright?",
      "No. Cockroach Browser uses playwright-core and adds an operator-owned authority, evidence, and integration boundary above Playwright."
    ],
    [
      "Is Cockroach Crawler's quality extractor independent of Trafilatura?",
      "No. The opt-in quality path delegates main-content extraction to exact trafilatura@0.2.0 and adds crawling, rendering, policy, structured extraction, and evidence around that backend."
    ],
    [
      "Where do LangGraph and the OpenAI Agents SDK fit?",
      "They are agent runtime and orchestration choices. They can call governed browser or crawler tools, but neither is replaced by the memory, approval, or evidence layers."
    ],
    [
      "When should a team use Firecrawl or Docling?",
      "Consider Firecrawl when managed web acquisition is central. Consider Docling when document conversion, layout, tables, images, or complex PDF structure is the main problem. Test the exact workload before choosing."
    ],
    [
      "Is this a best-tools ranking?",
      "No. It is a category and architecture map built from official product sources. It contains no matched cross-project benchmark."
    ]
  ]
};

export const alternatives = [
  {
    id: "playwright",
    name: "Playwright",
    category: "primitive",
    categoryLabel: "Automation primitive",
    nativeFocus:
      "Cross-browser testing and automation across Chromium, Firefox, and WebKit with direct APIs.",
    chooseWhen:
      "You want a general-purpose automation library and will design the agent policy, service boundary, and evidence model around it.",
    relationship:
      "Cockroach Browser uses playwright-core underneath its runtime. The comparison is therefore package layer versus underlying primitive, not a claim that Cockroach Browser replaces or outperforms Playwright.",
    sourceLabel: "Playwright browser documentation",
    source: "https://playwright.dev/docs/browsers"
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    category: "primitive",
    categoryLabel: "Automation primitive",
    nativeFocus:
      "A JavaScript API for controlling Chrome or Firefox over the DevTools Protocol or WebDriver BiDi.",
    chooseWhen:
      "You want direct JavaScript browser control, screenshots, PDFs, tracing, extension testing, or SPA rendering without adopting an agent runtime.",
    relationship:
      "Cockroach Browser adds an authorized session and receipt layer around a browser runtime. It is not presented as a Puppeteer compatibility, speed, or coverage winner.",
    sourceLabel: "Puppeteer supported browsers",
    source: "https://pptr.dev/supported-browsers"
  },
  {
    id: "selenium",
    name: "Selenium",
    category: "primitive",
    categoryLabel: "Automation primitive",
    nativeFocus:
      "WebDriver-based browser automation with local or remote execution and broad language and browser support.",
    chooseWhen:
      "You need the WebDriver ecosystem, multiple implementation languages, established test tooling, or a Selenium Grid deployment.",
    relationship:
      "Cockroach Browser is a TypeScript and Node.js runtime centered on agent sessions, local authority, and evidence. That is a narrower product shape than Selenium's general WebDriver ecosystem.",
    sourceLabel: "Selenium WebDriver documentation",
    source: "https://www.selenium.dev/documentation/webdriver/"
  },
  {
    id: "playwright-mcp",
    name: "Playwright MCP",
    category: "mcp",
    categoryLabel: "MCP control server",
    nativeFocus:
      "MCP browser tools backed by Playwright and structured accessibility snapshots for agent interaction.",
    chooseWhen:
      "Your agent needs a maintained MCP surface for browser control and you will provide the surrounding trust and authorization boundary.",
    relationship:
      "The official project states that Playwright MCP is not a security boundary. Cockroach Browser's distinct focus is an explicit session policy, finite budgets, authenticated local transport, evidence records, and optional Maqam approval hooks.",
    sourceLabel: "Playwright MCP repository",
    source: "https://github.com/microsoft/playwright-mcp"
  },
  {
    id: "chrome-devtools-mcp",
    name: "Chrome DevTools MCP",
    category: "mcp",
    categoryLabel: "MCP control server",
    nativeFocus:
      "Chrome automation, debugging, network inspection, console analysis, and performance tracing for coding agents.",
    chooseWhen:
      "The job is browser debugging or performance analysis and direct access to Chrome DevTools is the primary requirement.",
    relationship:
      "Cockroach Browser emphasizes bounded operational sessions and proof of actions. Chrome DevTools MCP emphasizes Chrome inspection and diagnostics; its official documentation warns that connected MCP clients can inspect and modify browser data.",
    sourceLabel: "Chrome DevTools MCP repository",
    source: "https://github.com/ChromeDevTools/chrome-devtools-mcp"
  },
  {
    id: "pinchtab",
    name: "PinchTab",
    category: "mcp",
    categoryLabel: "Local browser control plane",
    nativeFocus:
      "Local Chrome control through HTTP, MCP, semantic references, persistent profiles, tab locks, audits, visual comparison, and operator-managed instances.",
    chooseWhen:
      "You want a local Go-based Chrome control plane with HTTP and MCP surfaces, profiles, references, audits, and multi-instance operation.",
    relationship:
      "PinchTab overlaps local-first Chrome, semantic references, profiles, locks, MCP, and audits. Cockroach Browser documents a different composition around typed effects and budgets, content-addressed evidence, hash-linked action receipts, and optional external adapters.",
    sourceLabel: "PinchTab repository",
    source: "https://github.com/pinchtab/pinchtab"
  },
  {
    id: "browser-use",
    name: "Browser Use",
    category: "agent",
    categoryLabel: "Agent framework",
    nativeFocus:
      "A Python browser-agent framework and hosted platform for model-directed web tasks, custom tools, and recovery loops.",
    chooseWhen:
      "You want an autonomous browser agent, model integration, and high-level task execution rather than only a browser execution service.",
    relationship:
      "Cockroach Browser does not provide an LLM planner, managed browser cloud, or autonomous task-success claim. It supplies an execution and evidence runtime that a host agent can call.",
    sourceLabel: "Browser Use cloud quickstart",
    source: "https://docs.browser-use.com/cloud/quickstart"
  },
  {
    id: "stagehand",
    name: "Stagehand",
    category: "agent",
    categoryLabel: "Agent framework",
    nativeFocus:
      "Browser automation with natural-language and code primitives for act, extract, observe, and autonomous agent workflows.",
    chooseWhen:
      "You want AI-assisted page actions and extraction with a choice of local browsers or Browserbase infrastructure.",
    relationship:
      "Cockroach Browser keeps model choice and planning outside the runtime. Its native concern is what one admitted session may do and which evidence and receipts remain afterward.",
    sourceLabel: "Stagehand documentation",
    source: "https://docs.stagehand.dev/v3/first-steps/introduction"
  },
  {
    id: "agent-browser",
    name: "Vercel Labs agent-browser",
    category: "agent",
    categoryLabel: "Agent browser CLI and daemon",
    nativeFocus:
      "A broad browser automation CLI and daemon with Chrome, Lightpanda, and iOS routes, semantic references, profiles, files, network tools, recordings, accessibility, MCP, dashboard, chat, plugins, and action controls.",
    chooseWhen:
      "You want a broad cross-runtime agent-browser tool with direct CDP-oriented automation, multiple engine routes, plugins, skills, and interactive operator surfaces.",
    relationship:
      "This project overlaps local execution, semantic references, profiles, files, MCP, network tools, diagnostics, and confirmations. Cockroach Browser should be selected for its exact shipped contract and evidence chain, not because those general browser concepts are unique.",
    sourceLabel: "Vercel Labs agent-browser repository",
    source: "https://github.com/vercel-labs/agent-browser"
  },
  {
    id: "browserbase",
    name: "Browserbase",
    category: "infrastructure",
    categoryLabel: "Hosted infrastructure",
    nativeFocus:
      "Managed cloud browser sessions with connection URLs, observability, recordings, contexts, and automation-framework integrations.",
    chooseWhen:
      "You need managed browser capacity, remote session infrastructure, live inspection, or scale without operating the browser fleet yourself.",
    relationship:
      "Cockroach Browser defaults to a local or operator-managed runtime. Browserbase provides hosted infrastructure. These deployment choices can address different parts of one architecture.",
    sourceLabel: "Browserbase core features",
    source: "https://docs.browserbase.com/platform/browser/core-features/overview"
  },
  {
    id: "browserless",
    name: "Browserless",
    category: "infrastructure",
    categoryLabel: "Hosted or self-hosted infrastructure",
    nativeFocus:
      "Managed headless browsers plus WebSocket, REST, and GraphQL interfaces for Puppeteer, Playwright, Selenium, scraping, screenshots, and PDFs.",
    chooseWhen:
      "You need a remote browser endpoint, browser APIs, or a self-hostable browser service with infrastructure features.",
    relationship:
      "Cockroach Browser packages local agent-session policy and evidence semantics. Browserless packages browser infrastructure and APIs. The comparison does not score either deployment as universally safer or more reliable.",
    sourceLabel: "Browserless documentation",
    source: "https://docs.browserless.io/overview/intro"
  },
  {
    id: "steel",
    name: "Steel",
    category: "infrastructure",
    categoryLabel: "Hosted browser infrastructure",
    nativeFocus:
      "Cloud browser sessions with persistent profiles, proxy configuration, session options, and managed challenge-handling features.",
    chooseWhen:
      "You need a hosted browser API with managed session infrastructure, profile reuse, proxy services, or provider-operated challenge handling.",
    relationship:
      "Cockroach Browser can run through operator-managed workers and accepts an explicit session proxy, but it does not provide Steel's hosted fleet, managed proxy network, or managed challenge service.",
    sourceLabel: "Steel Sessions API overview",
    source: "https://docs.steel.dev/overview/sessions-api/overview"
  }
];

export const comparisonQuestions = [
  [
    "Is Cockroach Browser better than Playwright or Puppeteer?",
    "That is not a useful universal comparison. Playwright and Puppeteer are browser automation primitives. Cockroach Browser uses playwright-core and adds an agent-oriented session, policy, transport, and evidence layer. Choose the layer your architecture needs."
  ],
  [
    "Does Cockroach Browser replace Playwright MCP or Chrome DevTools MCP?",
    "No. Those projects expose browser control or debugging through MCP. Cockroach Browser also ships MCP, but its product focus is bounded session authority, finite budgets, evidence, receipt chains, and optional governance adapters."
  ],
  [
    "Is Cockroach Browser an autonomous browser agent?",
    "No. It does not choose an LLM, plan a task, or claim autonomous task-success results. Browser Use and Stagehand cover that agent-framework layer. Cockroach Browser is an execution and evidence runtime for a host agent."
  ],
  [
    "Does Cockroach Browser replace Browserbase or Browserless?",
    "No. Browserbase and Browserless provide hosted or self-hosted browser infrastructure. Cockroach Browser defaults to local-first execution and explicit session authority. A deployment can need one, the other, or separately reviewed layers of both."
  ],
  [
    "What is Cockroach Browser's distinct product boundary?",
    "Its implemented boundary combines explicit origins, allowed actions and effects, finite budgets, authenticated local transport, semantic snapshots, evidence artifacts, and hash-linked receipts. The public comparison does not turn those features into an independent security certification."
  ]
];

export const comparisonLayers = [
  {
    id: "libraries",
    label: "Browser libraries",
    examples: "Playwright, Puppeteer, Selenium",
    nativeFocus: "Direct browser APIs, browser objects, events, protocols, test tooling, and broad ecosystem compatibility.",
    chooseWhen: "Your application should own browser calls directly and your team will build the surrounding agent, service, policy, and evidence layers.",
    browserFit: "Cockroach Browser uses playwright-core, narrows control to session actions and semantic references, and adds packaged local transport plus evidence records.",
    sources: [
      ["Playwright browsers", "https://playwright.dev/docs/browsers"],
      ["Puppeteer supported browsers", "https://pptr.dev/supported-browsers"],
      ["Selenium WebDriver", "https://www.selenium.dev/documentation/webdriver/"]
    ]
  },
  {
    id: "agent-tools",
    label: "Agent control servers",
    examples: "Playwright MCP, Chrome DevTools MCP, PinchTab",
    nativeFocus: "Browser control, inspection, debugging, or performance tools exposed to coding agents through MCP.",
    chooseWhen: "An MCP client needs maintained browser tools and the deployment already owns the surrounding trust and authorization model.",
    browserFit: "Cockroach Browser ships an observation-first MCP surface alongside its SDK, CLI, and authenticated HTTP API.",
    sources: [
      ["Playwright MCP", "https://github.com/microsoft/playwright-mcp"],
      ["Chrome DevTools MCP", "https://github.com/ChromeDevTools/chrome-devtools-mcp"],
      ["PinchTab", "https://github.com/pinchtab/pinchtab"]
    ]
  },
  {
    id: "agent-frameworks",
    label: "AI browser frameworks",
    examples: "Browser Use, Stagehand, Vercel Labs agent-browser",
    nativeFocus: "Model selection, natural-language browser operations, planning, extraction, recovery loops, and autonomous task execution.",
    chooseWhen: "The product needs an LLM-driven browser agent rather than only a browser runtime that an existing agent can call.",
    browserFit: "Cockroach Browser deliberately does not bundle an LLM planner. A host agent calls its MCP, SDK, or HTTP surfaces and remains responsible for planning.",
    sources: [
      ["Browser Use cloud quickstart", "https://docs.browser-use.com/cloud/quickstart"],
      ["Stagehand introduction", "https://docs.stagehand.dev/v3/first-steps/introduction"],
      ["Vercel Labs agent-browser", "https://github.com/vercel-labs/agent-browser"]
    ]
  },
  {
    id: "infrastructure",
    label: "Hosted browser infrastructure",
    examples: "Browserbase, Browserless, Steel",
    nativeFocus: "Managed browser capacity, remote connection endpoints, sessions, profiles, proxies, recordings, live inspection, and provider-operated infrastructure.",
    chooseWhen: "Elastic capacity, hosted operations, managed proxies, geographic placement, or browser fleet management is the main requirement.",
    browserFit: "Cockroach Browser defaults to local or operator-managed workers. It has a worker pool, but it is not a hosted elastic browser cloud or managed proxy service.",
    sources: [
      ["Browserbase core features", "https://docs.browserbase.com/platform/browser/core-features/overview"],
      ["Browserless browser as a service", "https://docs.browserless.io/baas/start"],
      ["Steel Sessions API", "https://docs.steel.dev/overview/sessions-api/overview"]
    ]
  }
];

export const capabilityGaps = [
  {
    area: "Browser engines",
    shipped: "Bundled or discovered Chromium, Chrome, Edge, and Brave executables, plus explicit Chrome CDP attachment.",
    gap: "No Firefox or WebKit session selection in Cockroach Browser 0.3.0.",
    sourceLabel: "Playwright browser coverage",
    source: "https://playwright.dev/docs/browsers"
  },
  {
    area: "Protocol access",
    shipped: "Attach to one operator-selected Chrome DevTools endpoint through the CDP provider.",
    gap: "No public raw CDP session surface and no WebDriver BiDi API.",
    sourceLabel: "Puppeteer CDP session API",
    source: "https://pptr.dev/api/puppeteer.cdpsession"
  },
  {
    area: "Handles, targets, and events",
    shipped: "Snapshot-scoped semantic references, exact CSS or XPath targets, tabs, frames, and a bounded activity stream.",
    gap: "No drop-in Page, Frame, ElementHandle, JSHandle, BrowserContext, Target, or complete browser event API.",
    sourceLabel: "Puppeteer ElementHandle API",
    source: "https://pptr.dev/api/puppeteer.elementhandle"
  },
  {
    area: "Network and WebSockets",
    shipped: "Bounded redacted request and response observations, JSON or HAR-compatible export, session-start HAR recording, and exact-origin abort or static fulfillment routes.",
    gap: "No complete request-mutation lifecycle, raw protocol network domains, or WebSocket frame lifecycle API.",
    sourceLabel: "Playwright network documentation",
    source: "https://playwright.dev/docs/network"
  },
  {
    area: "Tracing, video, and screencast",
    shipped: "Trace start and stop actions, session video, screenshots, PDFs, and evidence indexing.",
    gap: "No full library-compatible tracing object model, raw screencast stream, or hosted recording viewer.",
    sourceLabel: "Playwright tracing API",
    source: "https://playwright.dev/docs/api/class-tracing"
  },
  {
    area: "Accessibility and diagnostics",
    shipped: "Semantic snapshots plus bounded accessibility, performance, asset, console, security, and visual audits.",
    gap: "No complete browser accessibility tree API, JavaScript coverage API, heap snapshot API, or full DevTools diagnostics surface.",
    sourceLabel: "Chrome DevTools MCP",
    source: "https://github.com/ChromeDevTools/chrome-devtools-mcp"
  },
  {
    area: "Extensions",
    shipped: "Up to 16 reviewed unpacked extension directories in an isolated headed Chromium profile.",
    gap: "No extension marketplace install, signed-extension distribution, or cross-browser extension test matrix.",
    sourceLabel: "Puppeteer Chrome extensions guide",
    source: "https://pptr.dev/guides/chrome-extensions"
  },
  {
    area: "Hosted scale",
    shipped: "Local daemon, Docker image, authenticated remote workers, capacity-aware worker pool, and team session roles.",
    gap: "No vendor-operated elastic browser fleet, managed regional capacity, live session viewer, usage billing, or hosted control plane.",
    sourceLabel: "Browserbase core features",
    source: "https://docs.browserbase.com/platform/browser/core-features/overview"
  },
  {
    area: "Proxy and identity services",
    shipped: "One explicit operator-supplied proxy per session with credentials resolved through a host secret reference.",
    gap: "No managed residential proxy network, automatic rotation, geographic routing catalog, or hosted identity service.",
    sourceLabel: "Steel proxy documentation",
    source: "https://docs.steel.dev/overview/stealth/proxies"
  },
  {
    area: "Stealth and access challenges",
    shipped: "Challenge detection, pause, evidence, human handoff, and an optional host-authorized resolver callback.",
    gap: "No covert fingerprint evasion, CAPTCHA bypass engine, or provider-operated challenge-solving service.",
    sourceLabel: "Steel CAPTCHA documentation",
    source: "https://docs.steel.dev/overview/captchas-api/overview"
  },
  {
    area: "Built-in LLM autonomy",
    shipped: "MCP, TypeScript SDK, CLI, and authenticated HTTP surfaces that an external AI agent can call.",
    gap: "No bundled model, prompt planner, autonomous recovery loop, or natural-language task-success benchmark.",
    sourceLabel: "Browser Use cloud quickstart",
    source: "https://docs.browser-use.com/cloud/quickstart"
  }
];

export const browserUseCases = [
  {
    id: "agent-web-workflows",
    title: "AI-agent web workflows",
    problem: "An agent must inspect a live application, identify a semantic target, interact with it, and return a reviewable result.",
    browserWork: "Create a session, capture a semantic snapshot, act through MCP or the SDK, and retain the receipt and evidence artifacts.",
    surfaces: "MCP, BrowserRuntime, BrowserClient, snapshot, click, fill, select, capture.paired"
  },
  {
    id: "authenticated-portals",
    title: "Authenticated portal work",
    problem: "A user-authorized workflow needs cookies, storage, permissions, tabs, downloads, or a visible login handoff.",
    browserWork: "Use an isolated or runtime-owned persistent profile, headed mode when required, explicit state checkpoints, and controlled files.",
    surfaces: "persistentProfile, profile import/export, state.*, tab.*, upload, download"
  },
  {
    id: "forms-and-operations",
    title: "Forms and operational tasks",
    problem: "A workflow needs real clicks, typing, selection, dialogs, file upload, downloads, or multi-step navigation.",
    browserWork: "Target semantic refs, CSS, or XPath; run individual actions or an ordered batch; capture an outcome after each state change.",
    surfaces: "fill, type, press, select, check, dialog, upload, download, /actions/batch"
  },
  {
    id: "qa-and-release-review",
    title: "QA and release review",
    problem: "A team needs reproducible screenshots, PDFs, visual diffs, console and asset checks, or performance observations.",
    browserWork: "Run the same page through capture, audits, network inspection, trace, HAR, video, and visual comparison surfaces.",
    surfaces: "screenshot, pdf, trace.*, audit.*, compare, recordHar, recordVideo"
  },
  {
    id: "local-agent-tool",
    title: "Local browser tool for coding agents",
    problem: "A coding agent needs browser capability without uploading the user's browser profile to a hosted browser service.",
    browserWork: "Run the authenticated loopback daemon, connect through MCP or the typed client, and keep profiles and evidence on the operator's machine.",
    surfaces: "serve, mcp, BrowserClient, dashboard, doctor, service install"
  },
  {
    id: "multi-worker-service",
    title: "Operator-managed browser workers",
    problem: "A service needs to route sessions across several authenticated browser daemons while retaining local ownership of each worker.",
    browserWork: "Use BrowserWorkerPool capacity and tags, worker health checks, activity streams, metrics, and team session roles.",
    surfaces: "BrowserWorkerPool, /v1/health, /v1/activity, /v1/metrics, TeamSessionStore"
  }
];

export const browserCrawlerDecisions = [
  {
    workload: "Interact with a stateful web application",
    browser: "Native fit: tabs, cookies, profiles, semantic refs, forms, dialogs, files, downloads, and browser state.",
    crawler: "Not the primary fit for a user-like multi-step application session.",
    choice: "Cockroach Browser"
  },
  {
    workload: "Render and inspect one dynamic page",
    browser: "Native fit when page state, JavaScript, interaction, screenshots, PDFs, trace, or network evidence matters.",
    crawler: "Useful when the rendered page belongs inside a larger acquisition job.",
    choice: "Usually Cockroach Browser"
  },
  {
    workload: "Discover and map many public pages",
    browser: "Can visit explicit pages, but browser sessions are expensive and do not provide site traversal as their primary abstraction.",
    crawler: "Native fit for multiple seeds, traversal strategies, sitemaps, robots rules, filters, concurrency, and site maps.",
    choice: "Cockroach Crawler"
  },
  {
    workload: "Extract normalized content across a site",
    browser: "Provides bounded text and HTML extraction from the current rendered page.",
    crawler: "Native fit for repeated page acquisition, structured extraction, Markdown, metadata, provenance, and searchable maps.",
    choice: "Cockroach Crawler"
  },
  {
    workload: "Audit a release or reproduce a visual defect",
    browser: "Native fit for screenshots, PDF, traces, video, console, network, accessibility, performance, and visual comparisons.",
    crawler: "Can collect pages, but does not replace a stateful browser review session.",
    choice: "Cockroach Browser"
  },
  {
    workload: "Find candidates broadly, then interact deeply",
    browser: "Open only the selected pages that require state, interaction, or browser evidence.",
    crawler: "Discover, filter, and rank the broader public-web candidate set first.",
    choice: "Use both through an explicit handoff"
  }
];

export const navGroups = [
  {
    title: "Start",
    items: [
      ["Getting started", "getting-started"],
      ["Operator install", "operator-install"],
      ["Sessions and profiles", "sessions"]
    ]
  },
  {
    title: "Operate",
    items: [
      ["Actions and semantic refs", "actions"],
      ["Operator runtime", "operator-runtime"],
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
      ["Signed webhooks", "webhooks"],
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

export const snippets = {
  install: `# Install once for the current computer account
npm install --global cockroach-browser
cockroach-browser bootstrap
cockroach-browser doctor

# Or keep it inside one project
npm install --save-dev cockroach-browser
npx cockroach-browser bootstrap`,
  completions: `# Bash
cockroach-browser completion bash > ~/.local/share/bash-completion/completions/cockroach-browser

# Zsh
cockroach-browser completion zsh > ~/.zfunc/_cockroach-browser

# PowerShell (inspect before adding it to your profile)
cockroach-browser completion powershell`,
  service: `# Preview the exact per-user definition path and command
cockroach-browser service status

# Install a loopback-only daemon for the current OS account
cockroach-browser service install --confirm-local-owner

# Remove only the definition created by Cockroach Browser
cockroach-browser service uninstall --confirm-local-owner`,
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
      "args": ["-y", "cockroach-browser@0.3.0", "mcp"],
      "env": {
        "COCKROACH_BROWSER_URL": "http://127.0.0.1:43110",
        "COCKROACH_BROWSER_TOKEN": "<load from your secret store>"
      }
    }
  }
}`,
  webhookSetup: `import {
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
      if (!value) throw new Error(\`Missing secret for \${reference}\`);
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

const browser = new BrowserRuntime({
  root: ".cockroach-browser/runtime",
  eventPublisher: webhooks
});
await browser.initialize();`,
  webhookDrain: `// Publishing is local-only. Draining owns DNS, key resolution, and HTTPS.
const result = await webhooks.drain({
  maxItems: 50,
  deadlineMs: 30_000
});

const health = await webhooks.health();
const integrity = await webhooks.verify();
if (!integrity.ok) {
  throw new Error(integrity.failures.join("\\n"));
}

console.log({ result, health, receiptHead: integrity.receiptHead });`,
  webhookVerify: `import {
  WebhookReplayGuard,
  verifyWebhookSignature
} from "cockroach-browser";

const replayGuard = new WebhookReplayGuard(10_000);

function required(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) throw new Error(\`Missing \${name}\`);
  return value;
}

export function verifyIncomingWebhook(
  body: string,
  headers: Headers,
  secret: string
): { accepted: boolean; deliveryId: string } {
  const deliveryId = required(headers, "x-cockroach-browser-delivery");
  const accepted = verifyWebhookSignature({
    secret,
    body,
    deliveryId,
    timestamp: required(headers, "x-cockroach-browser-timestamp"),
    nonce: required(headers, "x-cockroach-browser-nonce"),
    keyId: required(headers, "x-cockroach-browser-key-id"),
    signature: required(headers, "x-cockroach-browser-signature"),
    replayGuard
  });
  return { accepted, deliveryId };
}`,
  docker: `docker build -t cockroach-browser:0.3.0 .
docker run --rm \\
  --read-only \\
  --tmpfs /tmp \\
  --tmpfs /data \\
  -p 127.0.0.1:43110:43110 \\
  cockroach-browser:0.3.0`,
  profile: `export COCKROACH_BROWSER_PROFILE_PASSPHRASE="read-from-your-secret-store"
npx cockroach-browser profile import \\
  --name reviewed-support-session \\
  --file ./storage-state.json

npx cockroach-browser profile list`,
  capture: `npx cockroach-browser capture \\
  --session "$SESSION_ID" \\
  --require-stable \\
  --include-bounds \\
  --token-file .cockroach-browser/auth-token`,
  networkInspect: `npx cockroach-browser network \\
  --session "$SESSION_ID" \\
  --method GET \\
  --limit 100 \\
  --token-file .cockroach-browser/auth-token

npx cockroach-browser network export \\
  --session "$SESSION_ID" \\
  --format json \\
  --token-file .cockroach-browser/auth-token > ./artifacts/network.json`,
  stateCheckpoint: `await browser.act(session.id, {
  kind: "state.save",
  name: "after-reviewed-login",
  purpose: "Save the exact authorized session state"
});

await browser.act(session.id, {
  kind: "state.load",
  name: "after-reviewed-login",
  purpose: "Restore the reviewed checkpoint"
});`,
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
          "<p>The package supports maintained Node.js 22, 24, and 26 releases. <code>bootstrap</code> installs Chromium only when it is missing, initializes the local data root, and probes an authenticated ephemeral loopback daemon. Browser downloads never happen in an npm lifecycle script.</p>",
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
    slug: "operator-install",
    title: "Operator install",
    kicker: "One command to bootstrap. One explicit confirmation to start at login.",
    lede:
      "Generate shell completions, verify local readiness, and install a per-user loopback daemon on Windows, macOS, or Linux without sudo, administrator prompts, or public binding.",
    sections: [
      {
        title: "Bootstrap and probe the local runtime",
        body:
          "<p><code>cockroach-browser bootstrap</code> checks for Node.js 22, 24, or 26, installs the pinned Chromium build only when absent, initializes the owner-scoped data directory, and starts an ephemeral authenticated loopback server long enough to verify <code>/v1/health</code>. Use <code>--check-only</code> to prohibit a browser download.</p>",
        code: `cockroach-browser bootstrap
cockroach-browser bootstrap --check-only
cockroach-browser doctor`,
        label: "terminal"
      },
      {
        title: "Generate completion scripts",
        body:
          "<p>The completion command writes a script to standard output and never edits a shell profile. Inspect the output, place it in your shell's normal completion directory, and keep profile ownership with the local operator.</p>",
        code: snippets.completions,
        label: "terminal"
      },
      {
        title: "Install a per-user loopback daemon",
        body:
          "<p>The installer requires <code>--confirm-local-owner</code>. Windows receives a current-user Startup command that begins at the next login. macOS receives and loads a current-user LaunchAgent, and Linux receives and starts a systemd user unit. Every generated definition binds <code>127.0.0.1</code>, uses the package's authenticated daemon, writes only beneath the current user's directories, and never invokes <code>sudo</code> or an administrative service manager.</p>",
        code: snippets.service,
        label: "terminal"
      },
      {
        title: "Inspect before activation",
        body:
          "<p>Add <code>--definition-only</code> to write the exact generated definition without activating it. The installer refuses to overwrite or remove a file that does not carry its generated-owner marker. Uninstall targets only that exact per-user definition; it does not remove browser data, profiles, receipts, or evidence.</p>",
        code: `cockroach-browser service install \\
  --confirm-local-owner \\
  --definition-only

cockroach-browser service status`,
        label: "terminal"
      },
      {
        title: "Keep service authority narrow",
        body:
          "<p>The generated service cannot add remote binding, raw-action routes, session host configuration, profile discovery, or privilege escalation. Those remain separate trusted-host decisions. Use Maqam for consequential browser actions and retain the bearer token in the owner-scoped data directory rather than shell history.</p>"
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
          "<p>Launch bundled Chromium, discover a reviewed system installation, supply a compatible executable, or attach to a user-selected CDP endpoint. <code>cockroach-browser browser discover</code> reports Chrome, Edge, Brave, and Chromium candidates across Windows, macOS, Linux, ARM64, and Raspberry Pi hosts. Discovery never imports an ambient browser profile. CDP attachment remains explicit: the host names the endpoint and accepts responsibility for that browser.</p><ul><li><strong>Bundled:</strong> package-managed Chromium.</li><li><strong>System:</strong> one reviewed installed browser channel.</li><li><strong>Custom:</strong> one explicit compatible executable and bounded arguments.</li><li><strong>CDP:</strong> attach to an explicitly selected debugging endpoint.</li><li><strong>Extensions:</strong> load reviewed unpacked directories in an isolated headed context.</li></ul>",
        code: `cockroach-browser browser discover`,
        label: "terminal"
      },
      {
        title: "Create an explicit persistent profile",
        body:
          "<p>Persistent profiles preserve cookies, permissions, extension state, and browser storage across headed sessions in a runtime-owned user-data directory. They are never found by scanning a user's normal Chrome or Brave profile. A profile has one active writer, cannot be combined with remote CDP attachment or imported storage state, and can be archived through an exact recoverable operation.</p>",
        code: `cockroach-browser persistent-profile create --name support-review
cockroach-browser persistent-profile list
cockroach-browser persistent-profile archive --name support-review`,
        label: "terminal"
      },
      {
        title: "Keep profiles explicit and encrypted",
        body:
          "<p>Profiles isolate cookies and storage. Import and export require an explicit name, file path, and passphrase supplied through an environment variable. Passphrases are not accepted as command arguments and are not written to manifests.</p>",
        code: snippets.profile,
        label: "terminal"
      },
      {
        title: "Checkpoint only the current authorized session",
        body:
          "<p>Named state checkpoints save and restore the current session's admitted storage state beneath the deployment-owned data root. They are encrypted, size-bounded, and never discover ambient browser profiles. A checkpoint name cannot contain a path, and restoring it does not widen the session origin or action policy.</p>",
        code: snippets.stateCheckpoint,
        label: "checkpoint.mjs"
      },
      {
        title: "Keep clipboard and tabs under policy",
        body:
          "<p>Clipboard reads and writes are separate actions with bounded text output and secret-value references. Exclusive tab locks prevent two workers from silently controlling the same tab; lock, unlock, and status operations remain session-local and receipt-linked.</p>"
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
      },
      {
        title: "Inspect a target without inventing a selector",
        body:
          "<p><code>query.inspect</code> returns bounded text, cleaned HTML, attributes, geometry, form state, visibility, enabled state, and match counts for one semantic ref, CSS selector, or XPath. It is read-only, policy-evaluated, and receipt-linked.</p>"
      },
      {
        title: "Run an ordered bounded batch",
        body:
          "<p>A batch contains 1 to 100 exact actions. Every attempted step receives its own policy decision and receipt. Choose stop-on-error for dependent workflows or continue semantics for independent observations; a batch never creates a route around action policy.</p>",
        code: `cockroach-browser batch \\
  --session "$SESSION_ID" \\
  --input ./review-actions.json \\
  --token-file .cockroach-browser/auth-token`,
        label: "terminal"
      },
      {
        title: "Emulate only what the session permits",
        body:
          "<p><code>emulation.set</code> can apply bounded viewport, media, offline, geolocation, permissions, and non-secret headers after <code>allowEmulation</code> and exact approval. <code>emulation.clear</code> returns to the session baseline. These actions do not provide fingerprint evasion or access-control bypass.</p>"
      }
    ]
  },
  {
    slug: "operator-runtime",
    title: "Operator runtime",
    kicker: "Discover, route, observe, and share browser work without sharing the machine.",
    lede:
      "Cockroach Browser includes the control surfaces needed to operate one local browser or a reviewed pool of authenticated workers while keeping every session owner, action, and artifact explicit.",
    sections: [
      {
        title: "Inspect browser and daemon state",
        body:
          "<p><code>browser discover</code> reports installed compatible browsers. <code>doctor</code> verifies Node, Chromium, the data root, and local service readiness. The authenticated daemon publishes <code>/v1/health</code>, <code>/v1/openapi.json</code>, and Prometheus text at <code>/v1/metrics</code>.</p>"
      },
      {
        title: "Follow the activity stream",
        body:
          "<p><code>/v1/activity</code> returns a bounded filtered ledger. <code>/v1/activity/stream</code> emits the same lifecycle records over server-sent events. Actor-scoped tokens see only sessions for which they have viewer access; the administrator token remains local deployment authority.</p>",
        code: `cockroach-browser activity --session "$SESSION_ID" --limit 200 \\
  --token-file .cockroach-browser/auth-token`,
        label: "terminal"
      },
      {
        title: "See how a session moved",
        body:
          "<p>The navigation graph turns admitted session history into stable URL nodes and traversed edges. It is session-local, bounded by the history ceiling, and does not inspect a user's ambient browsing history.</p>",
        code: `cockroach-browser session graph --id "$SESSION_ID" \\
  --token-file .cockroach-browser/auth-token`,
        label: "terminal"
      },
      {
        title: "Share control without sharing profiles",
        body:
          "<p><code>TeamSessionStore</code> persists one owner plus revocable viewer and operator grants. Viewers can inspect; operators can use explicitly enabled action routes; owners manage access and closure. Grant generations and revocations are durable, while raw cookies and browser profiles never enter the access record.</p>"
      },
      {
        title: "Route across authenticated workers",
        body:
          "<p><code>BrowserWorkerPool</code> checks authenticated daemon health, capacity, weight, and explicit tags before creating a session. Non-loopback workers require HTTPS and strong bearer tokens. The pool does not discover public workers or accept unauthenticated endpoints.</p>"
      },
      {
        title: "Clear retained runtime state deliberately",
        body:
          "<p><code>cache.clear</code>, <code>console.clear</code>, and <code>network.clear</code> are explicit policy-evaluated actions. They clear only the authorized session's runtime state and produce receipts; they do not erase evidence already committed to the evidence ledger.</p>"
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
          "<p>Snapshots, screenshots, paired visual-plus-semantic captures, PDFs, Playwright traces, HAR files, console records, network metadata, downloads, audits, visual comparisons, annotations, and action records share one evidence index. Every record has a content type, byte size, digest, source URL when applicable, and structured metadata.</p>"
      },
      {
        title: "Capture the pixels and the cited page state together",
        body:
          "<p><code>capture.paired</code> records a screenshot and semantic snapshot under one receipt. <code>requireStable</code> rejects a capture when the page revision changes during collection. Optional element bounds connect numbered semantic refs to visible regions without turning coordinates into long-lived selectors.</p>",
        code: snippets.capture,
        label: "terminal"
      },
      {
        title: "Add temporary review annotations",
        body:
          "<p><code>annotate.show</code> overlays bounded numbered markers for reviewed refs, CSS selectors, or XPath targets. <code>annotate.clear</code> removes only Cockroach Browser's temporary overlay. Annotation actions are explicit, receipt-linked, and do not alter application data.</p>"
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
          "<p>The Qarinah adapter records canonical input and output digests, evidence IDs, the browser receipt hash, and bounded descriptive metadata after filtering cookies, storage values, form values, and secrets. It does not dispatch browser actions or store hidden reasoning. A host may link a mutation outcome to a complete causal receipt chain when one exists, but the recorder does not require or synthesize that chain.</p>"
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
        title: "Inspect and export redacted observations",
        body:
          "<p><code>network.inspect</code> filters the current session's bounded request observations by method, status, resource type, tab, and limit. <code>network.export</code> emits JSON, NDJSON, or a bounded HAR-shaped document. Authorization headers, cookies, credentials, query secrets, and response bodies are not included.</p>",
        code: snippets.networkInspect,
        label: "terminal"
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
          "<p>The built-in job queue is process-local and file-backed. It is useful for one owned worker. Team session ownership and revocable viewer/operator grants are available through <code>TeamSessionStore</code>, and <code>BrowserWorkerPool</code> can route new sessions across reviewed authenticated daemons. Neither turns the local queue into a distributed transaction coordinator. Signed lifecycle delivery remains a separate durable webhook outbox.</p>"
      }
    ]
  },
  {
    slug: "mcp",
    title: "MCP",
    kicker: "Give an MCP client observations and proposals, not browser ownership.",
    lede:
      "The native stdio server exposes health, capabilities, sessions, snapshots, paired capture, bounded network observations, audits, and canonical action proposals. It does not expose raw profile management or direct mutation authority.",
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
          "<p>The MCP surface provides <code>browser_capabilities</code>, <code>browser_health</code>, <code>browser_sessions</code>, <code>browser_snapshot</code>, <code>browser_audit</code>, <code>browser_capture</code>, <code>browser_network</code>, and <code>browser_propose_action</code>. Capture and network tools return bounded read evidence. A proposal returns canonical action material for a governed dispatcher and does not execute it.</p>"
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
    slug: "webhooks",
    title: "Signed lifecycle webhooks",
    kicker: "Queue locally. Resolve secrets at delivery. Give every terminal outcome a receipt.",
    lede:
      "Deliver sanitized browser lifecycle events to explicit HTTPS endpoints through a local durable outbox with stable delivery IDs, HMAC-SHA256 signatures, bounded retries, dead letters, and a verifiable receipt chain.",
    sections: [
      {
        title: "Configure one endpoint and an opaque key reference",
        body:
          "<p><code>SignedWebhookDispatcher</code> implements <code>BrowserEventPublisher</code>. Attach it to <code>BrowserRuntime</code> to queue session, action, challenge, and evidence events. Endpoint configuration stores only an opaque <code>ref:</code> value. The host-owned resolver returns the actual key during delivery, and the key is never persisted in configuration, queue entries, dead letters, or receipts.</p> <p>Endpoint URLs must use HTTPS and cannot contain credentials, a query string, or a fragment. Configuration resolves the hostname once to reject an invalid destination early; every delivery resolves and validates it again.</p>",
        code: snippets.webhookSetup,
        label: "webhooks.ts"
      },
      {
        title: "Keep publish and drain as separate authorities",
        body:
          "<p><code>publish()</code> validates and sanitizes the event, applies endpoint event filters, enforces the payload and storage ceilings, and atomically appends local queue records. It does not resolve DNS, call the secret resolver, or use the network. <code>drain()</code> is the operator-controlled boundary that revalidates DNS, resolves the referenced key, signs the canonical body, and sends a finite serial batch.</p> <p>Run the drain from a deployment-owned scheduler or worker. An endpoint failure never changes the result of the browser action that produced the lifecycle event.</p>",
        code: snippets.webhookDrain,
        label: "drain.ts"
      },
      {
        title: "Know exactly which events leave the process",
        body:
          "<p>Endpoint filters can select <code>browser.session.created</code>, <code>browser.session.closed</code>, <code>browser.action.completed</code>, <code>browser.challenge.detected</code>, <code>browser.challenge.resolved</code>, and <code>browser.evidence.recorded</code>. Event metadata is allowlisted by type. Control characters, credential-bearing URLs, bearer values, tokens, passwords, API keys, cookies, and secret-shaped text are removed or redacted before canonicalization. Payload size is checked after sanitation.</p>"
      },
      {
        title: "Verify the signature before parsing or dispatching",
        body:
          "<p>Each request includes the event type, stable delivery ID, timestamp, 128-bit nonce, key ID, and <code>v1=&lt;hex&gt;</code> signature. The signature is HMAC-SHA256 over the domain string <code>cockroach-browser.webhook.v1</code>, timestamp, nonce, delivery ID, key ID, and exact body, separated by newlines. <code>verifyWebhookSignature()</code> checks syntax, timestamp tolerance, key binding, and the signature with a timing-safe comparison.</p> <p>The built-in <code>WebhookReplayGuard</code> is a bounded in-process nonce guard and fails closed when full. A multi-process or restart-safe receiver should place the same delivery ID and nonce checks in its durable store.</p>",
        code: snippets.webhookVerify,
        label: "receiver.ts"
      },
      {
        title: "Deduplicate stable delivery IDs",
        body:
          "<p>The normal retry path keeps one deterministic delivery ID for an event and endpoint while creating a fresh timestamp and nonce on each request. Verify the request, begin a receiver transaction, return success immediately when that delivery ID was already committed, otherwise apply the event and commit the ID with the result. This makes at-least-once attempts safe at the receiver.</p> <p>A manual <code>retryDeadLetter()</code> intentionally creates a new delivery ID. Keep the original event ID in application-level reconciliation when an operator needs to connect both attempts.</p>"
      },
      {
        title: "Retry transient failures and inspect terminal outcomes",
        body:
          "<p>HTTP <code>408</code>, <code>425</code>, <code>429</code>, and <code>5xx</code> responses, plus bounded timeout, DNS, secret-timeout, and transport failures, retry with exponential jitter while attempts and the drain deadline remain. <code>Retry-After</code> is honored up to 30 seconds. Other non-<code>2xx</code> responses become dead letters. Terminal delivered and dead-letter receipts include the attempt log, response status or normalized error, body digest, prior receipt hash, and current receipt hash.</p> <p>Use <code>retryDeadLetter(id)</code> only after fixing the endpoint or key reference. Use <code>purgeDeadLetter(id)</code> for an explicit retention decision, not as an automatic cleanup path.</p>"
      },
      {
        title: "Recover interrupted local writes and verify integrity",
        body:
          "<p>Initialization recovers interrupted fan-out, dead-letter retry, and terminal receipt transactions from deployment-owned files. An interrupted network attempt is recorded as failed and is retried only when its configured budget remains. Conflicting recovery state fails closed for operator review.</p> <p><code>verify()</code> recomputes every terminal delivery digest and the single linked receipt chain, detecting altered records, duplicate hashes, forks, cycles, unlinked receipts, and a mismatched persisted head. Initialization refuses to continue when this integrity check fails.</p>"
      },
      {
        title: "Keep every queue finite",
        body:
          "<p>Defaults are a 64 KiB payload, 10,000 queued deliveries, 256 MiB of webhook storage, three attempts, a five-second endpoint timeout, 25 items per drain, a 60-second drain deadline, and a 4 KiB response ceiling. Configurable limits remain bounded: payloads from 1 KiB to 1 MiB, queues from 1 to 100,000 entries, storage from 1 MiB to 10 GiB, attempts from one to five, endpoint timeouts from 250 ms to 30 seconds, drain batches from one to 1,000, and drain deadlines from one second to ten minutes.</p> <p><code>health()</code> reports queued records, terminal receipts, dead letters, used bytes, and configured queue and storage ceilings. Diagnostics can observe queued, delivered, dead-letter, capacity, and recovered states but cannot alter delivery.</p>"
      },
      {
        title: "Preserve the network and challenge boundary",
        body:
          "<p>Every attempt admits only public HTTPS destinations, pins the connection to a validated public address, preserves TLS hostname verification, rejects private, loopback, translated, and mixed public/private DNS results, and never follows redirects. Response bodies are discarded after a 4 KiB ceiling. The dispatcher does not attach browser cookies, profile state, ambient credentials, or URL tokens.</p> <p>A webhook is an outbound integration, not a browser challenge solver. Redirects and access-control responses are rejected or dead-lettered according to the retry rules. The dispatcher does not bypass login, consent, CAPTCHA, rate limits, or endpoint authorization.</p>"
      },
      {
        title: "Understand the durability promise",
        body:
          "<p>This is a local durable at-least-once outbox for one deployment-owned filesystem. It persists selected events before delivery, recovers interrupted local transactions, retries within finite policy, and records terminal outcomes. It is not a distributed queue, a cross-host consensus system, or an exactly-once transport. Receiver-side deduplication by stable delivery ID is required.</p>"
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
        title: "Register every additional effect as an exact tool",
        body:
          "<p>Uploads, downloads, clipboard writes, JavaScript, state restore, network interception, PDF generation, and other high-risk actions are runtime capabilities, not implicit Maqam driver methods. A host that exposes one must register a typed Maqam tool with an exact input schema, effect class, policy, approval rule, and receipt mapping.</p>"
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
          "<p>The adapter removes cookies, storage values, form values, secret references, and hidden reasoning. It records the canonical input digest, output digest, browser receipt hash, evidence IDs, source URL, and bounded descriptive metadata as cited context links. The host supplies the persistence callback supported by its installed Qarinah release.</p>"
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
          "<p>Start with the crawler for static HTTP, searched site maps, structured extraction, documents, feeds, public-source breadth, and bounded crawl jobs. Hand a specific URL to the browser when JavaScript rendering, page state, interaction, or browser evidence is required.</p>"
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
          "<p>The ProductLoop integration in 0.3.0 is a structural capability snapshot for a host-owned adapter, not direct connector registration. The browser runtime, SDK, CLI, HTTP API, MCP server, evidence chain, and local dashboard are implemented in the package.</p>"
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
        title: "Challenges move to an authorized operator path",
        body:
          "<p>The runtime detects login, consent, CAPTCHA, and access challenges, pauses the automated action path, records evidence, and waits for a human or an explicitly configured resolver operating with the target owner's authorization.</p> <p>The <code>challenge.resolve</code> action is classified as a critical execute effect and requires exact approval by default. Its page-less callback receives only bounded challenge metadata, never cookies, storage, credentials, a Playwright page, or raw browser control. The runtime independently checks the page after the handoff and keeps the session paused when the challenge remains.</p>"
      },
      {
        title: "Governed high-authority controls",
        body:
          "<p>Cockroach Browser does not silently expose CAPTCHA or access-control bypass, covert stealth or cloaking, ambient browser cookies or profiles, or public unauthenticated server binding.</p><p>Use operator-authorized challenge handoff, deterministic compatibility emulation, explicit runtime-owned profiles or encrypted state import, reviewed browser providers, and authenticated loopback or TLS transport. Maqam-ready exact approval keeps consequential operations bound to their reviewed input.</p>"
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
        title: "OpenAPI, metrics, and activity",
        body:
          "<p>Authenticated operators can inspect <code>/v1/openapi.json</code>, scrape Prometheus text from <code>/v1/metrics</code>, poll <code>/v1/activity</code>, or subscribe to <code>/v1/activity/stream</code>. The activity surface is bounded and actor-filtered; it is not a raw browser telemetry dump.</p>"
      },
      {
        title: "Team and worker operation",
        body:
          "<p>Embed <code>TeamSessionStore</code> to persist owner, viewer, and operator roles with revocation. Use <code>BrowserWorkerPool</code> to choose healthy authenticated workers by capacity, weight, and explicit tags. Keep profile directories local to their owning worker.</p>"
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
  title: "Browser automation for AI agents, from first snapshot to final evidence.",
  lede:
    "Run real Chromium locally with semantic page snapshots, forms, files, tabs, persistent profiles, screenshots, PDFs, traces, network tools, MCP, a TypeScript SDK, and an authenticated API.",
  proof: []
};
