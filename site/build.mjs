import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  alternatives,
  browserCrawlerDecisions,
  browserUseCases,
  capabilityGaps,
  comparison,
  comparisonLayers,
  comparisonQuestions,
  ecosystem,
  homepage,
  navGroups,
  pages,
  site,
  snippets
} from "./content.mjs";
import { stripHtml } from "./html-text.mjs";

const root = resolve(import.meta.dirname);
const sourceRoot = resolve(root, "..");

const capabilities = parseCapabilities(await readFile(resolve(sourceRoot, "src/capabilities.ts"), "utf8"));
const actionKinds = parseActionKinds(await readFile(resolve(sourceRoot, "src/contracts.ts"), "utf8"));
const apiSurface = JSON.parse(await readFile(resolve(sourceRoot, "docs/compatibility/browser-api-surface.json"), "utf8"));
const capabilityCounts = capabilities.reduce(
  (counts, capability) => {
    counts[capability.status] += 1;
    return counts;
  },
  { available: 0, adapter: 0, planned: 0 }
);
let codeBlockIndex = 0;
const directoryRedirectPaths = [
  "/what-is-cockroach-browser",
  "/features",
  "/install",
  "/ai-agents",
  "/use-cases",
  "/browser-vs-crawler",
  "/api-surface",
  "/docs",
  ...pages.map((page) => `/docs/${page.slug}`),
  "/docs/capabilities",
  "/alternatives",
  "/ecosystem",
  "/dashboard",
  "/paper"
];

await writePage("index.html", homePage());
await writePage("what-is-cockroach-browser/index.html", whatIsPage());
await writePage("features/index.html", featuresPage());
await writePage("install/index.html", installPage());
await writePage("ai-agents/index.html", aiAgentsPage());
await writePage("use-cases/index.html", useCasesPage());
await writePage("browser-vs-crawler/index.html", browserVsCrawlerPage());
await writePage("api-surface/index.html", apiSurfacePage());
await writePage("api/browser-api-surface.json", `${JSON.stringify(apiSurface, null, 2)}\n`);
await writePage("docs/index.html", docsIndex());
for (const page of pages) {
  await writePage(`docs/${page.slug}/index.html`, manualPage(page));
  await writeRootDoc(`${page.slug}.md`, markdownManual(page));
}
await writePage("docs/capabilities/index.html", capabilityPage());
await writeRootDoc("capabilities.md", capabilityMarkdown());
await writeRootDoc("README.md", docsReadme());
await writePage("alternatives/index.html", alternativesPage());
await writePage("ecosystem/index.html", ecosystemPage());
await writePage("dashboard/index.html", publicDashboard());
await writePage("paper/index.html", publicationPage());
await mkdir(resolve(root, "paper"), { recursive: true });
await copyFile(
  resolve(sourceRoot, "docs", "Cockroach-Browser-Technical-White-Paper-v1.1.pdf"),
  resolve(root, "paper", "Cockroach-Browser-Technical-White-Paper-v1.1.pdf")
);
await writePage("404.html", notFound());
await writePage("robots.txt", `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: Claude-SearchBot\nAllow: /\n\nUser-agent: Claude-User\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
await writePage("sitemap.xml", sitemap());
await writePage("search.json", `${JSON.stringify(searchIndex(), null, 2)}\n`);
await writePage(
  "llms.txt",
  `# ${site.name}

> ${site.description}

Canonical website: ${site.origin}
Repository: ${site.repository}
npm: ${site.npm}
Technical paper: ${site.origin}/paper/

## Product identity
Cockroach Browser is the AjnasNB browser automation project for AI agents at cockroachbrowser.com. It controls stateful Chromium, Firefox, and WebKit sessions and exposes unrestricted upstream automation APIs separately from its bounded agent runtime. Cockroach Crawler is a separate public-web discovery and extraction product with a separate website, package, and runtime.

Cockroach Browser includes an optional OpenAI-compatible gateway and finite-step planner. A host may also call the browser directly through MCP, TypeScript, Python, Java, .NET, Ruby, Go, an authenticated HTTP API, or the CLI.

## Product routes
- [What is Cockroach Browser?](${site.origin}/what-is-cockroach-browser/)
- [Features overview](${site.origin}/features/)
- [Complete ${capabilities.length}-capability registry](${site.origin}/docs/capabilities/)
- [Install Cockroach Browser](${site.origin}/install/)
- [Cockroach Browser for AI agents and LLM applications](${site.origin}/ai-agents/)
- [Browser automation use cases](${site.origin}/use-cases/)
- [Cockroach Browser versus Cockroach Crawler](${site.origin}/browser-vs-crawler/)
- [Complete Playwright and Puppeteer API inventory](${site.origin}/api-surface/)
- [Alternatives and current gaps](${site.origin}/alternatives/)
- [Complete documentation](${site.origin}/docs/)

## Shipped surface in ${site.version}
- ${capabilityCounts.available} directly available runtime and deployment surfaces
- ${capabilityCounts.adapter} optional adapter-backed surfaces
- ${actionKinds.length} typed browser actions derived from src/contracts.ts
- ${actionKinds.length} bounded browser actions in the policy-evaluated runtime
- OpenAI-compatible model gateway and finite-step browser agent
- Chromium, Firefox, or WebKit execution in the bounded runtime
- Real Chromium, Firefox, and WebKit in headed or headless mode
- Complete pinned Playwright and Puppeteer Core exports, Playwright Test, code generation, raw CDP, and raw WebDriver BiDi
- Semantic snapshots and snapshot-scoped references
- Tabs, forms, keyboard, pointer, drag, files, dialogs, profiles, state, and downloads
- Screenshots, PDFs, trace, HAR, video, console, network, audits, visual comparison, and hash-linked receipts
- MCP, six language SDKs, authenticated HTTP API, CLI, Docker, dashboard, metrics, activity, team roles, local three-engine fleet, and managed-fleet adapters

## Current product limits
- No bundled macOS Safari host, iOS simulator, Android emulator, physical device lab, or hosted mobile capacity
- No Cockroach-operated elastic browser fleet, residential proxy network, static-IP inventory, billing platform, or hosted live-view service
- No covert stealth or bundled CAPTCHA bypass engine; provider challenge services remain explicit operator-selected adapters
- No cross-product task-success benchmark or universal autonomous recovery claim
- Non-TypeScript SDKs are authenticated daemon clients, not reimplementations of every upstream browser object

## External-service boundary
The local three-engine fleet is included. Managed capacity, residential or static-IP networks, provider challenge handling, live viewers, macOS Safari hosts, and mobile device labs require an explicit operator-selected provider. Cockroach Browser does not claim to operate those external services.

## Installation and documentation
- [Installation options](${site.origin}/install/)
- [Getting started manual](${site.origin}/docs/getting-started/)
${navGroups.flatMap((group) => group.items).filter(([, slug]) => !["maqam", "qarinah", "crawler", "productloop"].includes(slug)).map(([title, slug]) => `- [${title}](${site.origin}/docs/${slug}/)`).join("\n")}

## Optional integrations
Cockroach Browser runs without Maqam, Qarinah, or Cockroach Crawler. Those are separate optional integrations with separate responsibilities. Maqam can provide external approval for selected actions; it is not the browser engine or the primary product identity.

## Access-challenge boundary
Cockroach Browser detects login, consent, CAPTCHA, and access challenges, pauses automation, and waits for a human or authorized resolver. It does not bypass CAPTCHAs or access controls.
`
);
await writePage(
  "llms-full.txt",
  `# ${site.name} documentation

## What Cockroach Browser is

${site.description}

Cockroach Browser is the AjnasNB browser automation project at cockroachbrowser.com. The bounded runtime launches Chromium, Firefox, or WebKit. Separate unrestricted modules re-export the complete pinned Playwright and Puppeteer Core APIs, Playwright Test, raw CDP, raw WebDriver BiDi, and mobile WebDriver/Appium transport. Cockroach Crawler is a separate public-web acquisition product.

## AI-agent integration

Cockroach Browser includes an optional OpenAI-compatible model gateway and a finite-step browser agent over semantic snapshots, exact actions, evidence, and receipts. A host may instead use its own agent through MCP, TypeScript, Python, Java, .NET, Ruby, Go, or the authenticated HTTP API.

## ${actionKinds.length} bounded browser actions

${actionKinds.map((kind) => `- ${kind}`).join("\n")}

## Raw operator automation

- Playwright Chromium, Firefox, and WebKit browser, context, page, frame, locator, handle, worker, download, request, response, route, WebSocket, trace, HAR, clock, emulation, and protocol contracts
- Puppeteer browser, context, page, frame, locator, element handle, JavaScript handle, target, worker, CDP, coverage, heap, tracing, metrics, emulation, and screencast contracts
- Playwright Test fixtures, projects, assertions, retries, reporters, snapshots, parallelism, and code generation for JavaScript, TypeScript, Python, Java, and C#
- Generated declaration inventory: ${site.origin}/api-surface/
- Machine-readable declaration inventory: ${site.origin}/api/browser-api-surface.json

## Browser automation use cases

${browserUseCases.map((entry) => `### ${entry.title}\n${entry.problem}\n\nCockroach Browser route: ${entry.browserWork}\n\nRelevant surfaces: ${entry.surfaces}.`).join("\n\n")}

## Cockroach Browser versus Cockroach Crawler

${browserCrawlerDecisions.map((entry) => `### ${entry.workload}\nCockroach Browser: ${entry.browser}\n\nCockroach Crawler: ${entry.crawler}\n\nRecommended choice: ${entry.choice}.`).join("\n\n")}

## Alternatives by product layer

${comparison.methodology}

${comparisonLayers.map((entry) => `### ${entry.label}\nExamples: ${entry.examples}.\n\n${entry.nativeFocus}\n\nChoose this layer when: ${entry.chooseWhen}\n\nCockroach Browser relationship: ${entry.browserFit}\n\nOfficial sources: ${entry.sources.map(([label, url]) => `${label}: ${url}`).join("; ")}.`).join("\n\n")}

## Current Cockroach Browser gaps

${capabilityGaps.map((entry) => `### ${entry.area}\nShipped: ${entry.shipped}\n\nCurrent gap: ${entry.gap}\n\nOfficial comparison source: ${entry.source}`).join("\n\n")}

## Browser manuals

${pages.filter((page) => !["maqam", "qarinah", "crawler", "productloop"].includes(page.slug)).map((page) => [`## ${page.title}`, page.lede, ...page.sections.map((section) => `### ${section.title}\n${stripHtml(section.body)}`)].join("\n\n")).join("\n\n")}

## Complete ${capabilities.length}-capability matrix

${capabilities.map((entry) => `- ${entry.title} [${entry.status}]: ${entry.summary} Surface: ${entry.surface}.`).join("\n")}

## External-service boundary

The local three-engine fleet is included. Managed capacity, residential or static-IP networks, provider challenge handling, live viewers, macOS Safari hosts, mobile devices, and device labs are operator-selected external services connected through explicit adapters. Cockroach Browser does not claim to operate those networks or bypass access controls.
`
);
await writePage(
  "_headers",
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data: https://fazier.com; style-src 'self'; script-src 'self'; connect-src 'self' http://127.0.0.1:43110 https://127.0.0.1:43110; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`
);
await writePage(
  "_redirects",
  `${directoryRedirectPaths.map((path) => `${path} ${path}/ 301`).join("\n")}\n`
);

process.stdout.write(`Built ${pages.length + 15} HTML pages and ${capabilities.length} capability records.\n`);

function parseCapabilities(source) {
  const pattern = /^\s*\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"(available|adapter|planned)",\s*"([^"]+)"\],?$/gm;
  return [...source.matchAll(pattern)].map((match) => ({
    id: match[1],
    group: match[2],
    title: match[3],
    summary: match[4],
    status: match[5],
    surface: match[6]
  }));
}

function parseActionKinds(source) {
  const block = source.match(/export const ACTION_KINDS = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error("Could not parse ACTION_KINDS from src/contracts.ts");
  const kinds = [...block[1].matchAll(/^\s*"([^"]+)",?$/gm)].map((match) => match[1]);
  if (!kinds.length || new Set(kinds).size !== kinds.length) {
    throw new Error("ACTION_KINDS must contain a non-empty unique string list");
  }
  return kinds;
}

async function writePage(path, content) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function writeRootDoc(path, content) {
  const target = resolve(sourceRoot, "docs", path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function baseHead({ title, description, canonical, type = "website", robots = "index,follow", schemas = [] }) {
  const pageTitle = title.includes(site.name) ? title : `${title} | ${site.name}`;
  const schema = structuredData({ canonical, description, pageTitle, type, schemas });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <meta name="author" content="Ajnas N B">
  <meta name="robots" content="${robots}">
  <meta name="theme-color" content="#050a0d">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${canonical}">
  <link rel="alternate" hreflang="x-default" href="${canonical}">
  <link rel="alternate" type="application/json" href="/search.json" title="${site.name} search index">
  <link rel="alternate" type="text/plain" href="/llms.txt" title="${site.name} LLM overview">
  <link rel="alternate" type="text/plain" href="/llms-full.txt" title="${site.name} complete LLM documentation">
  <link rel="icon" href="/assets/logo.png" type="image/png">
  <link rel="stylesheet" href="/assets/styles.css">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${site.name}">
  <meta property="og:title" content="${escapeAttr(pageTitle)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${site.origin}/assets/logo.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1254">
  <meta property="og:image:height" content="1254">
  <meta property="og:image:alt" content="Cockroach Browser AI browser automation logo">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${site.origin}/assets/logo.png">
  <meta name="twitter:image:alt" content="Cockroach Browser AI browser automation logo">
  <script type="application/ld+json">${schema}</script>
</head>`;
}

function structuredData({ canonical, description, pageTitle, type, schemas }) {
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${site.origin}/#website`,
      name: site.name,
      alternateName: "Cockroach Browser by AjnasNB",
      url: `${site.origin}/`,
      description: site.description,
      inLanguage: "en"
    },
    {
      "@type": type === "article" ? "TechArticle" : "WebPage",
      "@id": `${canonical}#webpage`,
      name: pageTitle,
      headline: pageTitle,
      description,
      url: canonical,
      inLanguage: "en",
      isPartOf: { "@id": `${site.origin}/#website` }
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${site.origin}/#software`,
      name: site.name,
      alternateName: "Cockroach Browser by AjnasNB",
      description: site.description,
      url: `${site.origin}/`,
      codeRepository: site.repository,
      programmingLanguage: "TypeScript",
      runtimePlatform: "Node.js 22, 24, or 26",
      version: site.version,
      license: "https://spdx.org/licenses/AGPL-3.0-or-later.html"
    },
    ...schemas
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c");
}

function breadcrumbSchema(name, canonical) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: site.name, item: `${site.origin}/` },
      { "@type": "ListItem", position: 2, name, item: canonical }
    ]
  };
}

function header(active = "") {
  return `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/">
      <img src="/assets/logo.png" alt="" width="34" height="34">
      <span>${site.name}</span>
      <span class="version">${site.version}</span>
    </a>
    <nav class="top-nav" data-top-nav aria-label="Primary navigation">
      <a href="/what-is-cockroach-browser/" ${active === "what" ? 'aria-current="page"' : ""}>What it is</a>
      <a href="/ai-agents/" ${active === "ai" ? 'aria-current="page"' : ""}>AI agents</a>
      <a href="/use-cases/" ${active === "uses" ? 'aria-current="page"' : ""}>Use cases</a>
      <a href="/features/" ${active === "features" ? 'aria-current="page"' : ""}>Features</a>
      <a href="/api-surface/" ${active === "api" ? 'aria-current="page"' : ""}>API surface</a>
      <a href="/install/" ${active === "install" ? 'aria-current="page"' : ""}>Install</a>
      <a href="/docs/" ${active === "docs" ? 'aria-current="page"' : ""}>Docs</a>
      <a href="/alternatives/" ${active === "alternatives" ? 'aria-current="page"' : ""}>Alternatives</a>
      <a href="${site.repository}">GitHub</a>
    </nav>
    <button class="mobile-menu" type="button" data-menu aria-expanded="false" aria-label="Open navigation">Menu</button>
  </div>
</header>`;
}

function footer() {
  return `<footer class="footer">
  <div class="shell footer-inner">
    <div>
      <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="34" height="34" loading="lazy" decoding="async"><span>${site.name}</span></a>
      <p>Open-source local-first browser automation for AI agents. Chromium, Firefox, WebKit, complete pinned Playwright and Puppeteer exports, semantic page references, MCP, and evidence.</p>
    </div>
    <div class="footer-links">
      <a href="/what-is-cockroach-browser/">What it is</a>
      <a href="/ai-agents/">AI agents</a>
      <a href="/use-cases/">Use cases</a>
      <a href="/features/">Features</a>
      <a href="/api-surface/">API surface</a>
      <a href="/install/">Install</a>
      <a href="/docs/">Documentation</a>
      <a href="/docs/security/">Security</a>
      <a href="/alternatives/">Alternatives</a>
      <a href="/browser-vs-crawler/">Browser vs Crawler</a>
      <a href="/paper/">Technical paper</a>
      <a href="${site.repository}">Source</a>
      <a href="${site.npm}">npm</a>
    </div>
  </div>
  <div class="shell launch-recognition" aria-label="Launch directories">
    <span>Find ${site.name} on</span>
    <a class="fazier-badge" href="https://fazier.com/launches/cockroachbrowser.com" target="_blank" rel="noopener noreferrer"><img src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=launched&amp;theme=light" width="120" alt="Fazier badge"></a>
  </div>
</footer>
<script src="/assets/main.js" defer></script>
</body>
</html>`;
}

function homePage() {
  const proof = [
    [capabilities.length, "mapped capabilities"],
    [capabilityCounts.available, "available runtime surfaces"],
    [capabilityCounts.adapter, "adapter-backed surfaces"],
    [capabilityCounts.planned, "planned surfaces"]
  ].map(([value, label]) => `<div class="proof"><strong>${value}</strong><span>${label}</span></div>`).join("");
  return `${baseHead({
    title: "AI browser automation",
    description: site.description,
    canonical: `${site.origin}/`,
    schemas: []
  })}
<body>
${header("home")}
<main id="main">
  <section class="shell hero">
    <div class="hero-copy-column">
      <img class="hero-mark" src="/assets/logo.png" alt="Cockroach Browser AI browser automation logo" width="180" height="180">
      <p class="eyebrow">Lightweight browser runtime for AI agents</p>
      <h1>${homepage.title}</h1>
      <p class="hero-copy">${homepage.lede}</p>
      <div class="hero-actions">
        <a class="button button--primary" href="/install/">Install Cockroach Browser</a>
        <a class="button" href="/features/">Explore every Browser feature</a>
      </div>
      <div class="hero-boundary" aria-label="Default authority boundary">
        <span>Real Chromium</span><span>${actionKinds.length} typed actions</span><span>MCP + SDK + API</span><span>${capabilities.length} mapped capabilities</span>
      </div>
      <p class="release-note">Free and open-source npm package under AGPL-3.0-or-later. Price: $0.</p>
    </div>
  </section>
  <section class="shell hero-runtime-section" aria-label="Local runtime preview">
    <div class="hero-runtime">
      <div class="terminal" aria-label="Cockroach Browser terminal example">
        <pre data-terminal-output><span class="prompt">$</span> npm i -g cockroach-browser
<span class="prompt">$</span> cockroach-browser bootstrap
<span class="prompt">$</span> cockroach-browser doctor</pre>
        <div class="terminal-status"><span>Loopback</span><span>Token auth</span><span>Evidence on</span></div>
      </div>
    </div>
  </section>
  <section class="shell proof-strip" aria-label="Product surface">${proof}</section>
  <section class="section">
    <div class="shell">
      <div class="section-head">
        <h2>Connect. Observe. Interact. Capture. Continue.</h2>
        <p>Cockroach Browser gives a host AI agent a direct, structured route from semantic page state to a real Chromium, Firefox, or WebKit action and a reviewable result.</p>
      </div>
      <div class="workflow">
        <article><b>01</b><h3>Connect</h3><p>Use MCP, BrowserRuntime, BrowserClient, the authenticated HTTP API, or the CLI.</p></article>
        <article><b>02</b><h3>Observe</h3><p>Capture visible text, page state, roles, accessible names, frames, and snapshot-scoped references.</p></article>
        <article><b>03</b><h3>Interact</h3><p>Navigate, use forms, tabs, keyboard, pointer, drag, files, dialogs, downloads, and exact element targets.</p></article>
        <article><b>04</b><h3>Capture</h3><p>Keep screenshots, PDFs, paired captures, traces, HAR, video, console, network, audits, and visual diffs.</p></article>
        <article><b>05</b><h3>Continue</h3><p>Return structured outcomes and receipt hashes to the host agent, then refresh page state before the next step.</p></article>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="shell">
      <div class="section-head">
        <h2>One Browser runtime. Four practical jobs.</h2>
        <p>The homepage stays focused on Cockroach Browser: stateful automation, AI-agent control, evidence, and operator deployment.</p>
      </div>
      <div class="stack-grid">
        <article><span class="tag">Automate</span><h3>Stateful web applications</h3><p>Use profiles, tabs, semantic refs, forms, input, files, downloads, dialogs, and JavaScript rendering.</p><a href="/use-cases/">Explore use cases</a></article>
        <article><span class="tag">Connect</span><h3>AI and coding agents</h3><p>Expose Browser observation and action tools through MCP, TypeScript, HTTP, or CLI without bundling a model.</p><a href="/ai-agents/">AI-agent integration</a></article>
        <article><span class="tag">Inspect</span><h3>QA and diagnostics</h3><p>Capture screenshots, PDFs, traces, HAR, video, console, network, accessibility, performance, assets, and visual diffs.</p><a href="/features/">Feature inventory</a></article>
        <article><span class="tag">Operate</span><h3>Local or owned workers</h3><p>Run a loopback daemon, Docker worker, dashboard, metrics, activity stream, team roles, jobs, or a capacity-aware worker pool.</p><a href="/install/">Installation options</a></article>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="shell">
      <div class="section-head">
        <h2>Challenges are a handoff, not a bypass target.</h2>
        <p>The runtime detects login, consent, CAPTCHA, and access challenges, records the state, pauses automation, and waits for a human or authorized resolver. It does not defeat site controls or claim access after a site denies it.</p>
      </div>
      <div class="hero-actions">
        <a class="button button--primary" href="/docs/security/">Read the security model</a>
        <a class="button" href="/use-cases/">Choose a Browser use case</a>
      </div>
    </div>
  </section>
</main>
${footer()}`;
}

function whatIsPage() {
  const canonical = `${site.origin}/what-is-cockroach-browser/`;
  const description = "Cockroach Browser is a local-first TypeScript platform for Chromium, Firefox, WebKit, complete pinned Playwright and Puppeteer APIs, semantic page references, model-directed interaction, and verifiable browser evidence.";
  return `${baseHead({
    title: "What is Cockroach Browser?",
    description,
    canonical,
    type: "article",
    schemas: [
      {
        "@type": "AboutPage",
        "@id": `${canonical}#about`,
        name: "What is Cockroach Browser?",
        description,
        url: canonical,
        inLanguage: "en",
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Cockroach Browser", item: `${site.origin}/` },
          { "@type": "ListItem", position: 2, name: "What is Cockroach Browser?", item: canonical }
        ]
      }
    ]
  })}
<body>
${header("what")}
<main id="main">
  <section class="shell page-hero">
    <p class="eyebrow">Product definition</p>
    <h1>What is Cockroach Browser?</h1>
    <p class="kicker">A local-first browser execution and evidence runtime for AI agents.</p>
    <p class="lede">Cockroach Browser gives a host agent an explicitly authorized Chromium session. It combines semantic page references, real interactions, finite policy budgets, evidence artifacts, and hash-linked receipts in one TypeScript package.</p>
    <div class="hero-actions">
      <a class="button button--primary" href="/docs/getting-started/">Install and get started</a>
      <a class="button" href="/docs/capabilities/">Inspect every capability</a>
    </div>
  </section>
  <section class="section">
    <div class="shell">
      <div class="section-head"><h2>The product boundary.</h2><p>The runtime controls one admitted browser session; the operator and host retain the surrounding authority.</p></div>
      <div class="stack-grid">
        <article><span class="tag">Session</span><h3>Explicit browser authority</h3><p>Origins, actions, effects, profiles, credentials, time, requests, and byte ceilings are declared before use.</p></article>
        <article><span class="tag">Observe</span><h3>Semantic page references</h3><p>Bounded snapshots expose stable, snapshot-scoped refs so a host can target page elements without relying only on coordinates.</p></article>
        <article><span class="tag">Act</span><h3>Real browser interaction</h3><p>Navigate, click, type, select, scroll, upload admitted files, handle state, and capture results inside the session policy.</p></article>
        <article><span class="tag">Prove</span><h3>Evidence and receipts</h3><p>Link actions to URLs, input and output digests, screenshots, PDFs, traces, network observations, and a hash-chained receipt history.</p></article>
        <article><span class="tag">Connect</span><h3>Daemon, SDK, and MCP</h3><p>Embed the TypeScript runtime, call an authenticated local daemon, or expose bounded observation and proposal tools through MCP.</p></article>
        <article><span class="tag">Govern</span><h3>Optional external authority</h3><p>Route selected consequential actions through a separately configured approval boundary while preserving the browser session and evidence record.</p></article>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="shell">
      <div class="section-head"><h2>What it does not claim.</h2><p>Cockroach Browser is not an autonomous planner, a browser engine, an ambient profile scanner, or an access-control bypass system. Login, consent, CAPTCHA, and denied-access states stop for human or separately authorized handling.</p></div>
      <div class="hero-actions"><a class="button button--primary" href="/docs/">Read the documentation</a><a class="button" href="/docs/security/">Review the security boundary</a></div>
    </div>
  </section>
</main>
${footer()}`;
}

function featuresPage() {
  const canonical = `${site.origin}/features/`;
  const groupLabels = {
    sessions: ["Sessions and profiles", "Start Chromium, choose a reviewed executable or CDP endpoint, isolate state, and control browser identity explicitly."],
    interaction: ["Page interaction", "Navigate, inspect semantic page state, target elements, use forms and input, manage tabs, and work with files."],
    evidence: ["Capture and evidence", "Keep visual, semantic, network, console, trace, HAR, video, and receipt-linked records."],
    audit: ["Audits and diagnostics", "Inspect accessibility, performance, assets, console output, page security observations, and visual changes."],
    deployment: ["Run and operate", "Use the SDK, CLI, MCP, authenticated HTTP API, Docker, dashboard, jobs, workers, metrics, and activity streams."],
    security: ["Session controls", "Declare origins, actions, effects, time, tabs, files, evidence, and challenge behavior before the browser runs."],
    integration: ["Integration surfaces", "Connect the browser to host-owned webhooks, team state, secret resolution, and optional external adapters."]
  };
  const groups = Object.entries(groupLabels).map(([group, [title, summary]]) => {
    const entries = capabilities.filter((entry) => entry.group === group && ![
      "integration.maqam",
      "integration.qarinah",
      "integration.crawler",
      "integration.productloop"
    ].includes(entry.id));
    if (!entries.length) return "";
    return `<section class="manual-section" id="${group}">
      <span class="section-number">${entries.length} browser surfaces</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(summary)}</p>
      <div class="feature-list">${entries.map((entry) => `<article>
        <div><span class="status status--${entry.status}">${entry.status}</span><code>${escapeHtml(entry.surface)}</code></div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.summary)}</p>
      </article>`).join("")}</div>
    </section>`;
  }).join("");
  return `${baseHead({
    title: "Cockroach Browser features",
    description: `Explore ${capabilities.length} mapped Cockroach Browser capabilities across sessions, page interaction, profiles, files, evidence, audits, MCP, APIs, workers, and deployment.`,
    canonical,
    type: "article",
    schemas: [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#features`,
        name: "Cockroach Browser features",
        description: `${capabilities.length} source-derived capabilities with release status and activation surfaces.`,
        url: canonical,
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#feature-groups`,
        name: "Cockroach Browser feature groups",
        numberOfItems: Object.keys(groupLabels).length,
        itemListElement: Object.entries(groupLabels).map(([group, [title]], index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: title,
          url: `${canonical}#${group}`
        }))
      },
      breadcrumbSchema("Features", canonical)
    ]
  })}
<body>
${header("features")}
<main id="main">
  <section class="shell page-hero">
    <p class="eyebrow">Cockroach Browser ${site.version} / source-derived inventory</p>
    <h1>Every Browser capability, organized by the job it completes.</h1>
    <p class="kicker">${capabilityCounts.available} available surfaces. ${capabilityCounts.adapter} optional adapter-backed surfaces. ${capabilityCounts.planned} planned.</p>
    <p class="lede">This overview explains the direct Browser surface in human terms. The exact registry preserves all ${capabilities.length} capability IDs, status values, summaries, and activation surfaces.</p>
    <div class="hero-actions"><a class="button button--primary" href="/docs/capabilities/">Open all ${capabilities.length} registry entries</a><a class="button" href="/install/">Install Cockroach Browser</a></div>
  </section>
  <section class="shell proof-strip" aria-label="Feature inventory"><div class="proof"><strong>${capabilities.length}</strong><span>mapped capabilities</span></div><div class="proof"><strong>${capabilityCounts.available}</strong><span>directly available</span></div><div class="proof"><strong>${capabilityCounts.adapter}</strong><span>optional adapters</span></div><div class="proof"><strong>${actionKinds.length}</strong><span>typed browser actions</span></div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>${actionKinds.length} typed Browser actions, derived from source.</h2><p>This list is generated from <code>src/contracts.ts</code>, including <code>challenge.resolve</code>. It is not a manually maintained marketing count.</p></div><div class="action-kind-list" data-action-inventory data-action-count="${actionKinds.length}">${actionKinds.map((kind) => `<code data-action-kind>${escapeHtml(kind)}</code>`).join("")}</div></div></section>
  <div class="shell feature-manual">${groups}</div>
  <section class="section"><div class="shell"><div class="section-head"><h2>Optional integrations stay optional.</h2><p>Cockroach Browser runs on its own. External approval, memory, acquisition, or product-composition adapters do not become part of the browser engine and are marked adapter in the complete registry.</p></div><div class="hero-actions"><a class="button button--primary" href="/docs/capabilities/">Inspect adapter status</a><a class="button" href="/docs/">Read the manuals</a></div></div></section>
</main>
${footer()}`;
}

function installPage() {
  const canonical = `${site.origin}/install/`;
  const steps = [
    ["Install the npm package", "Install globally for an operator workstation or as a project dependency for an embedded service."],
    ["Bootstrap Chromium", "Run the explicit bootstrap command. Browser downloads never run from an npm lifecycle script."],
    ["Verify the local runtime", "Run doctor to check Node.js, Chromium, data paths, authentication, and evidence readiness."],
    ["Choose a control surface", "Use the CLI, MCP, TypeScript SDK, authenticated HTTP API, Docker image, or per-user loopback service."]
  ];
  return `${baseHead({
    title: "Install Cockroach Browser",
    description: "Install Cockroach Browser on Windows, macOS, or Linux, bootstrap Chromium, Firefox, and WebKit explicitly, and connect through MCP, six SDKs, HTTP, CLI, Docker, or a local service.",
    canonical,
    type: "article",
    schemas: [
      {
        "@type": "HowTo",
        "@id": `${canonical}#howto`,
        name: "Install Cockroach Browser",
        description: "Install the package, bootstrap Chromium, Firefox, and WebKit, verify the runtime, and choose an AI-agent or operator control surface.",
        step: steps.map(([name, text], index) => ({ "@type": "HowToStep", position: index + 1, name, text }))
      },
      breadcrumbSchema("Install", canonical)
    ]
  })}
<body>
${header("install")}
<main id="main">
  <section class="shell page-hero">
    <p class="eyebrow">Windows / macOS / Linux / Node.js 22, 24, or 26</p>
    <h1>Install Cockroach Browser in the shape your agent needs.</h1>
    <p class="kicker">CLI, MCP, TypeScript SDK, authenticated API, Docker, or a per-user local service.</p>
    <p class="lede">The npm package does not download a browser during installation. You explicitly run bootstrap when Chromium is missing, then verify the runtime with doctor.</p>
  </section>
  <section class="section"><div class="shell"><div class="section-head"><h2>Direct operator install.</h2><p>Use the global CLI when one workstation should own Chromium, profiles, evidence, and an authenticated loopback daemon.</p></div>${codeBlock(snippets.install, "terminal")}</div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>Four control surfaces after install.</h2><p>All routes operate the same Browser runtime. Choose by application architecture, not by feature tier.</p></div><div class="stack-grid"><article><span class="tag">MCP</span><h3>Connect an AI client.</h3><p>Run the observation-first stdio server and point it at an authenticated local daemon.</p><a href="/ai-agents/">AI-agent setup</a></article><article><span class="tag">TypeScript</span><h3>Embed BrowserRuntime.</h3><p>Own the runtime directly inside a Node.js service and receive typed snapshots, actions, evidence, and receipts.</p><a href="/docs/getting-started/">SDK quickstart</a></article><article><span class="tag">HTTP</span><h3>Call the local daemon.</h3><p>Use bearer-authenticated localhost routes or BrowserClient from another process.</p><a href="/docs/deployment/">Deployment guide</a></article><article><span class="tag">Container</span><h3>Run an explicit worker.</h3><p>Use the provided Dockerfile and mount only the data and artifact paths the worker needs.</p><a href="/docs/deployment/">Container guide</a></article></div></div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>MCP configuration.</h2><p>The Browser MCP server does not choose a model. It exposes browser observation and proposal tools to the agent client you already use.</p></div>${codeBlock(snippets.mcp, "mcp.json")}</div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>Installation details that matter.</h2><p>Bootstrap is explicit, browser profiles stay separate from ambient user profiles, the default daemon binds to loopback, and non-loopback operation requires an explicit remote configuration with TLS.</p></div><div class="answer-grid">${steps.map(([title, text]) => `<article><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`).join("")}</div><div class="hero-actions"><a class="button button--primary" href="/docs/getting-started/">Continue to getting started</a><a class="button" href="/docs/operator-install/">Operator service install</a></div></div></section>
</main>
${footer()}`;
}

function aiAgentsPage() {
  const canonical = `${site.origin}/ai-agents/`;
  const questions = [
    ["Does Cockroach Browser include an LLM?", "It includes an optional OpenAI-compatible model gateway and finite-step browser agent. The operator supplies the model endpoint, credentials, task authority, and any external fleet services."],
    ["Which AI agents can use it?", "Any host that can call MCP, TypeScript, Python, Java, .NET, Ruby, Go, or the authenticated HTTP API can integrate it. The built-in gateway does not require one model provider."],
    ["What does the LLM receive?", "The host can return bounded semantic snapshots, page references, action results, challenge state, evidence metadata, and receipt hashes instead of exposing an unrestricted browser object."],
    ["Can the agent use forms and files?", "Yes. The shipped action surface includes form controls, keyboard and pointer input, drag, upload, controlled download, dialogs, tabs, profiles, state checkpoints, and extraction."],
    ["Is Maqam required?", "No. Maqam is a separate optional approval integration. Cockroach Browser, its MCP server, SDK, API, CLI, and evidence system run without it."],
    ["Does it solve CAPTCHAs?", "No. It detects access challenges, pauses, records the state, and waits for a human or an explicitly configured host-authorized resolver."]
  ];
  return `${baseHead({
    title: "Cockroach Browser for AI agents and LLM applications",
    description: "Connect an AI agent or LLM application to Chromium, Firefox, or WebKit through the built-in planner, MCP, six SDKs, authenticated HTTP API, semantic snapshots, actions, and evidence.",
    canonical,
    type: "article",
    schemas: [
      {
        "@type": "TechArticle",
        "@id": `${canonical}#article`,
        headline: "Cockroach Browser for AI agents and LLM applications",
        description: "How an external AI agent uses Cockroach Browser through MCP, TypeScript, or HTTP without bundling a model inside the browser runtime.",
        author: { "@type": "Person", name: "Ajnas N B" },
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        mainEntity: questions.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } }))
      },
      breadcrumbSchema("AI agents", canonical)
    ]
  })}
<body>
${header("ai")}
<main id="main">
  <section class="shell page-hero">
    <p class="eyebrow">AI agent browser automation / MCP / TypeScript / HTTP</p>
    <h1>Give an AI agent a real browser without hiding how it works.</h1>
    <p class="kicker">Your LLM plans. Cockroach Browser observes, interacts, captures, and returns evidence.</p>
    <p class="lede">Cockroach Browser is the execution layer between an AI agent and Chromium. It exposes bounded semantic page state and exact browser operations through MCP, a TypeScript SDK, and an authenticated API. It does not bundle a model, prompt framework, or autonomous planner.</p>
    <div class="hero-actions"><a class="button button--primary" href="/install/">Install for an AI agent</a><a class="button" href="/features/">Explore Browser features</a></div>
  </section>
  <section class="section"><div class="shell"><div class="section-head"><h2>The agent loop is simple and inspectable.</h2><p>The host retains planning and decides what to return to the model. Cockroach Browser handles the exact browser step and its evidence.</p></div><div class="workflow"><article><b>01</b><h3>Create</h3><p>Start a Chromium session with a purpose, starting URL, profile choice, and finite browser limits.</p></article><article><b>02</b><h3>Observe</h3><p>Request a semantic snapshot with visible text, roles, names, page revision, and snapshot-scoped references.</p></article><article><b>03</b><h3>Select</h3><p>The host agent chooses an observed reference or an exact CSS or XPath target and states the browser action.</p></article><article><b>04</b><h3>Interact</h3><p>Navigate, click, type, select, scroll, drag, use files, inspect state, or run an ordered batch.</p></article><article><b>05</b><h3>Return</h3><p>Return the outcome, new page state, evidence metadata, and receipt hash to the host agent.</p></article></div></div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>Three integration paths.</h2><p>Use MCP for an agent client, TypeScript for an embedded service, or the authenticated API when a separate process owns Chromium.</p></div><div class="stack-grid"><article><span class="tag">MCP</span><h3>Observation-first tools.</h3><p>Expose health, capabilities, sessions, snapshots, paired capture, network observations, audits, and canonical action proposals over stdio.</p><a href="/docs/mcp/">MCP manual</a></article><article><span class="tag">SDK</span><h3>Typed runtime calls.</h3><p>Embed BrowserRuntime and work with typed sessions, snapshots, actions, jobs, evidence, and receipts.</p><a href="/docs/getting-started/">SDK quickstart</a></article><article><span class="tag">API</span><h3>Authenticated daemon.</h3><p>Call loopback or an explicitly configured TLS worker through BrowserClient or the documented HTTP routes.</p><a href="/docs/deployment/">API deployment</a></article><article><span class="tag">Operator</span><h3>CLI and dashboard.</h3><p>Inspect readiness, sessions, snapshots, evidence, network records, audits, and worker activity.</p><a href="/docs/operator-install/">Operator install</a></article></div></div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>TypeScript example.</h2><p>The model is not in this code. A host agent can call the same function after it has chosen a task and reviewed the available tool contract.</p></div>${codeBlock(snippets.sdk, "browser-agent.mjs")}</div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>What the Browser returns to an LLM host.</h2><p>Semantic and evidence outputs are designed to be useful without handing the model an unrestricted Page object.</p></div><div class="stack-grid"><article><span class="tag">Semantic</span><h3>Page snapshots.</h3><p>URL, title, bounded readable text, roles, accessible names, snapshot-scoped refs, frame context, digest, and challenge state.</p></article><article><span class="tag">Action</span><h3>Structured outcomes.</h3><p>URLs before and after, output values, errors, page revision, policy result, and the receipt that links the step together.</p></article><article><span class="tag">Visual</span><h3>Reviewable artifacts.</h3><p>Screenshots, PDFs, paired visual and semantic capture, annotations, traces, HAR, video, and visual comparisons.</p></article><article><span class="tag">Diagnostic</span><h3>Browser observations.</h3><p>Redacted network records, console output, accessibility checks, performance observations, broken assets, and security signals.</p></article></div></div></section>
  <section class="section" id="faq"><div class="shell"><div class="section-head"><h2>AI and LLM questions.</h2><p>Direct answers for agent builders, search engines, and machine readers.</p></div><div class="answer-grid">${questions.map(([question, answer]) => `<article><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join("")}</div></div></section>
</main>
${footer()}`;
}

function useCasesPage() {
  const canonical = `${site.origin}/use-cases/`;
  const cards = browserUseCases.map((entry, index) => `<article id="${entry.id}" class="use-case-card"><span>${String(index + 1).padStart(2, "0")} / Browser workflow</span><h2>${escapeHtml(entry.title)}</h2><p><strong>Need:</strong> ${escapeHtml(entry.problem)}</p><p><strong>How Cockroach Browser handles it:</strong> ${escapeHtml(entry.browserWork)}</p><code>${escapeHtml(entry.surfaces)}</code></article>`).join("");
  return `${baseHead({
    title: "Cockroach Browser use cases",
    description: "Use Cockroach Browser for AI-agent web workflows, authenticated portals, forms and files, QA and release review, local coding-agent browser tools, and operator-managed workers.",
    canonical,
    type: "article",
    schemas: [
      {
        "@type": "ItemList",
        "@id": `${canonical}#use-cases`,
        name: "Cockroach Browser use cases",
        numberOfItems: browserUseCases.length,
        itemListElement: browserUseCases.map((entry, index) => ({ "@type": "ListItem", position: index + 1, name: entry.title, description: entry.browserWork, url: `${canonical}#${entry.id}` }))
      },
      breadcrumbSchema("Use cases", canonical)
    ]
  })}
<body>
${header("uses")}
<main id="main">
  <section class="shell page-hero"><p class="eyebrow">Browser automation use cases</p><h1>Use Cockroach Browser when the work needs real browser state.</h1><p class="kicker">Pages that render, change, remember, download, upload, open tabs, or require reviewable browser evidence.</p><p class="lede">Cockroach Browser is designed for stateful browser execution. These use cases map real operational needs to the exact shipped surfaces that handle them.</p><div class="hero-actions"><a class="button button--primary" href="/install/">Install the Browser</a><a class="button" href="/browser-vs-crawler/">Browser or Crawler?</a></div></section>
  <section class="section"><div class="shell"><div class="use-case-grid">${cards}</div></div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>Use a browser when state is part of the answer.</h2><p>Cookies, storage, profiles, tabs, dynamic rendering, form state, files, dialogs, downloads, page revisions, network observations, and visual artifacts all belong to a browser session. That is the center of Cockroach Browser.</p></div><div class="hero-actions"><a class="button button--primary" href="/features/">See all Browser features</a><a class="button" href="/ai-agents/">Connect an AI agent</a></div></div></section>
</main>
${footer()}`;
}

function browserVsCrawlerPage() {
  const canonical = `${site.origin}/browser-vs-crawler/`;
  const rows = browserCrawlerDecisions.map((entry) => `<tr><th scope="row">${escapeHtml(entry.workload)}</th><td>${escapeHtml(entry.browser)}</td><td>${escapeHtml(entry.crawler)}</td><td><strong>${escapeHtml(entry.choice)}</strong></td></tr>`).join("");
  const questions = [
    ["Which is better, Cockroach Browser or Cockroach Crawler?", "Neither is universally better. Cockroach Browser is the better fit for stateful interaction and browser evidence. Cockroach Crawler is the better fit for broad public-web discovery, mapping, and repeated extraction."],
    ["Can Cockroach Browser crawl a whole site?", "It can visit explicit pages, but site traversal is not its primary abstraction. Use Cockroach Crawler for multiple seeds, traversal strategies, robots rules, concurrency, and site maps."],
    ["Can Cockroach Crawler complete a multi-step web form?", "That is a Browser job. Cockroach Browser owns profiles, tabs, semantic page state, form interactions, dialogs, uploads, downloads, screenshots, and receipts."],
    ["Can they work together?", "Yes. A host can use Cockroach Crawler to discover and filter candidate pages, then hand selected URLs to Cockroach Browser when stateful rendering, interaction, or browser evidence is required."]
  ];
  return `${baseHead({
    title: "Cockroach Browser vs Cockroach Crawler",
    description: "Choose Cockroach Browser for stateful Chromium interaction and browser evidence; choose Cockroach Crawler for broad public-web discovery, mapping, and extraction; combine them through an explicit handoff.",
    canonical,
    type: "article",
    schemas: [
      { "@type": "FAQPage", "@id": `${canonical}#faq`, mainEntity: questions.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) },
      breadcrumbSchema("Browser vs Crawler", canonical)
    ]
  })}
<body>
${header("")}
<main id="main">
  <section class="shell page-hero"><p class="eyebrow">Two products / two workloads</p><h1>Cockroach Browser or Cockroach Crawler?</h1><p class="kicker">Use the Browser for stateful interaction. Use the Crawler for public-web breadth.</p><p class="lede">Cockroach Browser controls real Chromium, Firefox, and WebKit sessions with raw APIs, agents, tabs, profiles, forms, files, screenshots, network tools, audits, and receipts. Cockroach Crawler discovers, traverses, filters, maps, and extracts many public web pages. The workload decides which is better.</p></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>The short decision.</h2><p>Ask whether the job is a stateful user-like path through one application or a breadth-oriented acquisition job across many public pages.</p></div><div class="stack-grid"><article><span class="tag">Choose Browser</span><h3>State, interaction, and proof.</h3><p>Dynamic applications, authenticated portals, forms, files, tabs, screenshots, PDFs, traces, video, network inspection, audits, and visual comparison.</p><a href="/features/">Browser features</a></article><article><span class="tag">Choose Crawler</span><h3>Discovery, traversal, and extraction.</h3><p>Multiple seeds, breadth-first or depth-first traversal, sitemaps, robots enforcement, include and exclude filters, concurrency, Markdown, structured fields, and site maps.</p><a href="https://cockroachcrawler.com/">Crawler website</a></article><article><span class="tag">Use both</span><h3>Discover broadly, inspect deeply.</h3><p>Find and filter candidate pages with the Crawler, then open only selected dynamic or stateful paths in the Browser.</p><a href="/docs/crawler/">Handoff manual</a></article><article><span class="tag">Do not merge them</span><h3>Keep records explicit.</h3><p>A handoff should name the selected URL, purpose, source record, Browser session, and evidence result instead of hiding both jobs behind one claim.</p><a href="${site.repository}/blob/main/src/integrations/crawler.ts">Browser adapter source</a></article></div></div></section>
  <section class="section"><div class="shell"><div class="section-head"><h2>Workload-by-workload comparison.</h2><p>This table compares product centers, not a shared speed or quality benchmark.</p></div><div class="comparison-table-wrap"><table class="comparison-table"><caption>Cockroach Browser and Cockroach Crawler compared by workload.</caption><thead><tr><th scope="col">Workload</th><th scope="col">Cockroach Browser</th><th scope="col">Cockroach Crawler</th><th scope="col">Recommended fit</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>
  <section class="section" id="faq"><div class="shell"><div class="section-head"><h2>Direct choice answers.</h2><p>The best product is the one whose native abstraction matches the job.</p></div><div class="answer-grid">${questions.map(([question, answer]) => `<article><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join("")}</div></div></section>
</main>
${footer()}`;
}

function docsIndex() {
  const groups = navGroups.map((group) => `<section class="manual-section">
    <span class="section-number">${escapeHtml(group.title)}</span>
    <h2>${escapeHtml(group.items[0][0])} and beyond</h2>
    <div class="stack-grid">${group.items.map(([title, slug]) => `<article><span class="tag">Manual</span><h3><a href="/docs/${slug}/">${escapeHtml(title)}</a></h3><p>${escapeHtml(summaryFor(slug))}</p></article>`).join("")}</div>
  </section>`).join("");
  return `${baseHead({
    title: "Documentation",
    description: "Install, operate, secure, integrate, and deploy Cockroach Browser.",
    canonical: `${site.origin}/docs/`
  })}
<body>
${header("docs")}
<main id="main" class="docs-layout">
  ${docsSidebar("")}
  <article class="docs-main">
    <header class="page-hero">
      <p class="eyebrow">Cockroach Browser ${site.version} documentation</p>
      <h1>From one admitted origin to a cited browser result.</h1>
      <p class="kicker">Start with a workflow. Keep the authority boundary visible.</p>
      <p class="lede">Every manual names the shipped function, option, command, integration contract, and security consequence behind the feature.</p>
    </header>
    ${groups}
  </article>
  <aside class="page-toc" aria-label="On this page"><h2>Release</h2><a href="/docs/capabilities/">${capabilities.length} mapped capabilities</a><a href="/docs/security/">Security boundary</a><a href="/docs/deployment/">Deployment</a></aside>
</main>
${footer()}`;
}

function manualPage(page) {
  const toc = page.sections.map((section) => [section.title, idFor(section.title)]);
  const sections = page.sections.map((section, index) => `<section class="manual-section" id="${idFor(section.title)}">
    <span class="section-number">${String(index + 1).padStart(2, "0")}</span>
    <h2>${escapeHtml(section.title)}</h2>
${section.body}${section.code ? `\n${codeBlock(section.code, section.label ?? "example")}` : ""}
  </section>`).join("");
  return `${baseHead({
    title: page.title,
    description: page.lede,
    canonical: `${site.origin}/docs/${page.slug}/`,
    type: "article",
    schemas: [
      {
        "@type": "TechArticle",
        "@id": `${site.origin}/docs/${page.slug}/#article`,
        headline: page.title,
        description: page.lede,
        url: `${site.origin}/docs/${page.slug}/`,
        inLanguage: "en",
        author: { "@type": "Person", name: "Ajnas N B" },
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Product", item: `${site.origin}/` },
          { "@type": "ListItem", position: 2, name: "Documentation", item: `${site.origin}/docs/` },
          { "@type": "ListItem", position: 3, name: page.title, item: `${site.origin}/docs/${page.slug}/` }
        ]
      },
      ...(page.slug === "getting-started" ? [{
        "@type": "HowTo",
        "@id": `${site.origin}/docs/getting-started/#howto`,
        name: "Install and start Cockroach Browser",
        description: page.lede,
        step: page.sections.map((section, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: section.title,
          text: stripHtml(section.body)
        }))
      }] : [])
    ]
  })}
<body>
${header("docs")}
<main id="main" class="docs-layout">
  ${docsSidebar(page.slug)}
  <article class="docs-main">
    <header class="page-hero">
      <p class="eyebrow">Cockroach Browser manual / ${escapeHtml(page.title)}</p>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="kicker">${escapeHtml(page.kicker)}</p>
      <p class="lede">${escapeHtml(page.lede)}</p>
    </header>
    ${sections}
  </article>
  ${pageToc(toc)}
</main>
${footer()}`;
}

function capabilityPage() {
  const counts = Object.fromEntries(["available", "adapter", "planned"].map((status) => [status, capabilities.filter((entry) => entry.status === status).length]));
  const cards = capabilities.map((entry, index) => `<article class="cap-card" data-capability data-status="${entry.status}">
    <div class="cap-meta"><span>${String(index + 1).padStart(2, "0")} / ${escapeHtml(entry.group)}</span><span class="status status--${entry.status}">${entry.status}</span></div>
    <h2>${escapeHtml(entry.title)}</h2>
    <p>${escapeHtml(entry.summary)}</p>
    <code>${escapeHtml(entry.surface)}</code>
  </article>`).join("");
  return `${baseHead({
    title: "Capability matrix",
    description: `${capabilities.length} mapped Cockroach Browser capabilities, each marked available, adapter, or planned.`,
    canonical: `${site.origin}/docs/capabilities/`,
    schemas: [
      {
        "@type": "CollectionPage",
        "@id": `${site.origin}/docs/capabilities/#features`,
        name: "Cockroach Browser features and capability matrix",
        description: `${capabilities.length} source-derived capabilities with available, adapter, and planned status.`,
        url: `${site.origin}/docs/capabilities/`,
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "ItemList",
        "@id": `${site.origin}/docs/capabilities/#capability-list`,
        name: "Cockroach Browser capabilities",
        itemListOrder: "https://schema.org/ItemListUnordered",
        numberOfItems: capabilities.length,
        itemListElement: capabilities.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "DefinedTerm",
            termCode: entry.id,
            name: entry.title,
            description: entry.summary
          }
        }))
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Cockroach Browser", item: `${site.origin}/` },
          { "@type": "ListItem", position: 2, name: "Documentation", item: `${site.origin}/docs/` },
          { "@type": "ListItem", position: 3, name: "Features", item: `${site.origin}/docs/capabilities/` }
        ]
      }
    ]
  })}
<body>
${header("docs")}
<main id="main" class="docs-layout">
  ${docsSidebar("capabilities")}
  <article class="docs-main">
    <header class="page-hero">
      <p class="eyebrow">Machine-derived from src/capabilities.ts</p>
      <h1>Capability matrix</h1>
      <p class="kicker">${capabilities.length} named surfaces. No hidden universal-access claim.</p>
      <p class="lede"><strong>${counts.available}</strong> runtime surfaces are available, <strong>${counts.adapter}</strong> require an external integration authority, and <strong>${counts.planned}</strong> remain planned.</p>
    </header>
    <div class="callout" id="status-model"><strong>Read the status</strong><p>Available means shipped in ${escapeHtml(site.version)}. Adapter means this package ships the integration contract but another package or host authority is required. Planned means the direction is documented and is not part of the current release.</p></div>
    <div class="cap-toolbar" id="capability-filters" aria-label="Capability filters">
      <button type="button" data-cap-filter="all" aria-pressed="true">All</button>
      <button type="button" data-cap-filter="available" aria-pressed="false">Available ${counts.available}</button>
      <button type="button" data-cap-filter="adapter" aria-pressed="false">Adapter ${counts.adapter}</button>
      <button type="button" data-cap-filter="planned" aria-pressed="false">Planned ${counts.planned}</button>
      <input class="cap-search" data-cap-search type="search" aria-label="Search capabilities" placeholder="Search screenshots, MCP, profiles, Maqam...">
    </div>
    <p class="cap-count" data-cap-count>${capabilities.length} capabilities shown</p>
    <div class="cap-grid">${cards}</div>
  </article>
  ${pageToc([["Status model", "status-model"], ["Capability filters", "capability-filters"]])}
</main>
${footer()}`;
}

function apiSurfacePage() {
  const packageSections = apiSurface.packages.map((pkg) => {
    const packageId = idFor(pkg.package);
    const summaryCards = [
      [pkg.summary.owners, "class and interface owners"],
      [pkg.summary.groupedOwnerMembers, "grouped owner members"],
      [pkg.summary.ownerMemberSignatures, "owner-member signatures"],
      [pkg.summary.topLevelDeclarations, "top-level declarations"]
    ].map(([value, label]) => `<div class="proof"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join("");
    const topLevel = pkg.topLevel.map((entry) => `<li><code>${escapeHtml(entry.name)}</code><span>${escapeHtml(entry.kind)}${entry.signatures > 1 ? ` · ${entry.signatures} signatures` : ""}</span></li>`).join("");
    const owners = pkg.owners.map((owner) => {
      const members = owner.members.map((member) => `<li><code>${escapeHtml(member.name)}</code><span>${escapeHtml(member.kind)}${member.signatures > 1 ? ` · ${member.signatures} signatures` : ""}</span></li>`).join("");
      return `<details class="api-owner" id="${packageId}-${idFor(owner.name)}">
        <summary><span><code>${escapeHtml(owner.name)}</code> <small>${escapeHtml(owner.kind)}</small></span><strong>${owner.members.length} members</strong></summary>
        <ul class="api-member-list">${members}</ul>
      </details>`;
    }).join("");
    return `<section class="section api-package" id="${packageId}">
      <div class="section-head">
        <p class="eyebrow">${escapeHtml(pkg.package)} ${escapeHtml(pkg.version)}</p>
        <h2>${escapeHtml(pkg.package)} public declarations</h2>
        <p>Re-exported from <code>${escapeHtml(pkg.reexport)}</code>. Generated from <code>${escapeHtml(pkg.declaration)}</code>.</p>
      </div>
      <div class="proof-row">${summaryCards}</div>
      <details class="api-owner api-top-level">
        <summary><span>Top-level exports</span><strong>${pkg.topLevel.length} declarations</strong></summary>
        <ul class="api-member-list">${topLevel}</ul>
      </details>
      <div class="api-owner-list">${owners}</div>
    </section>`;
  }).join("");
  const totalOwners = apiSurface.packages.reduce((sum, pkg) => sum + pkg.summary.owners, 0);
  const totalMembers = apiSurface.packages.reduce((sum, pkg) => sum + pkg.summary.groupedOwnerMembers, 0);
  const totalSignatures = apiSurface.packages.reduce((sum, pkg) => sum + pkg.summary.ownerMemberSignatures, 0);
  const canonical = `${site.origin}/api-surface/`;
  return `${baseHead({
    title: "Complete Playwright and Puppeteer API surface",
    description: `Machine-generated inventory of ${totalOwners} Playwright and Puppeteer class/interface owners, ${totalMembers} grouped members, and ${totalSignatures} signatures re-exported by Cockroach Browser.`,
    canonical,
    schemas: [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#inventory`,
        name: "Cockroach Browser Playwright and Puppeteer API inventory",
        description: apiSurface.scope,
        url: canonical,
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#packages`,
        name: "Re-exported browser automation packages",
        numberOfItems: apiSurface.packages.length,
        itemListElement: apiSurface.packages.map((pkg, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "SoftwareSourceCode",
            name: `${pkg.package} ${pkg.version}`,
            programmingLanguage: "TypeScript",
            codeSampleType: pkg.reexport
          }
        }))
      },
      breadcrumbSchema("API surface", canonical)
    ]
  })}
<body>
${header("api")}
<main id="main">
  <section class="page-hero shell">
    <p class="eyebrow">Generated from installed TypeScript declarations</p>
    <h1>Complete pinned Playwright and Puppeteer API inventory</h1>
    <p class="kicker">${totalOwners} class/interface owners · ${totalMembers} grouped members · ${totalSignatures} owner-member signatures</p>
    <p class="lede">Cockroach Browser re-exports Playwright Core ${escapeHtml(apiSurface.packages[0].version)} and Puppeteer Core ${escapeHtml(apiSurface.packages[1].version)} instead of rewriting a partial imitation. The JSON and this page are rebuilt from the exact installed declarations and checked for drift.</p>
    <div class="hero-actions"><a class="button button--primary" href="/api/browser-api-surface.json">Download machine-readable JSON</a><a class="button" href="/docs/capabilities/">Product capability matrix</a></div>
  </section>
  <section class="section"><div class="shell"><div class="callout"><strong>Counts are contracts, not marketing features</strong><p>${escapeHtml(apiSurface.warning)} Runtime execution is separately proven by installed Chromium, Firefox, WebKit, and Puppeteer integration tests. Operator-level upstream APIs remain separate from the bounded policy runtime.</p></div></div></section>
  <div class="shell api-surface">${packageSections}</div>
</main>
${footer()}`;
}

function alternativesPage() {
  const categoryLabels = [
    ["primitive", "Automation primitives"],
    ["mcp", "MCP control servers"],
    ["agent", "Agent frameworks"],
    ["infrastructure", "Browser infrastructure"]
  ];
  const rows = alternatives.map((entry) => `<tr id="${entry.id}" data-alternative data-category="${entry.category}">
    <th scope="row"><a href="#${entry.id}">${escapeHtml(entry.name)}</a><span class="comparison-kind">${escapeHtml(entry.categoryLabel)}</span></th>
    <td>${escapeHtml(entry.nativeFocus)}</td>
    <td>${escapeHtml(entry.chooseWhen)}</td>
    <td><p>${escapeHtml(entry.relationship)}</p><a class="source-link" href="${escapeAttr(entry.source)}">${escapeHtml(entry.sourceLabel)}</a></td>
  </tr>`).join("");
  const layerRows = comparisonLayers.map((entry) => `<tr id="layer-${entry.id}" data-comparison-layer>
    <th scope="row">${escapeHtml(entry.label)}<span class="comparison-kind">${escapeHtml(entry.examples)}</span></th>
    <td>${escapeHtml(entry.nativeFocus)}</td>
    <td>${escapeHtml(entry.chooseWhen)}</td>
    <td><p>${escapeHtml(entry.browserFit)}</p><div class="source-list">${entry.sources.map(([label, source]) => `<a class="source-link" href="${escapeAttr(source)}">${escapeHtml(label)}</a>`).join("")}</div></td>
  </tr>`).join("");
  const gapRows = capabilityGaps.map((entry) => `<tr data-capability-gap>
    <th scope="row">${escapeHtml(entry.area)}</th>
    <td>${escapeHtml(entry.shipped)}</td>
    <td>${escapeHtml(entry.gap)}</td>
    <td><a class="source-link" href="${escapeAttr(entry.source)}">${escapeHtml(entry.sourceLabel)}</a></td>
  </tr>`).join("");
  const filters = categoryLabels.map(([category, label]) => {
    const count = alternatives.filter((entry) => entry.category === category).length;
    return `<button type="button" data-alt-filter="${category}" aria-pressed="false">${escapeHtml(label)} ${count}</button>`;
  }).join("");
  const canonical = `${site.origin}/alternatives/`;
  return `${baseHead({
    title: "Cockroach Browser alternatives by product layer",
    description: comparison.description,
    canonical,
    type: "article",
    schemas: [
      {
        "@type": "TechArticle",
        "@id": `${canonical}#webpage`,
        author: { "@type": "Person", name: "Ajnas N B" },
        dateModified: comparison.checkedOn,
        about: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#alternatives`,
        name: "Browser automation tools and infrastructure compared by product layer",
        numberOfItems: alternatives.length,
        itemListOrder: "https://schema.org/ItemListUnordered",
        itemListElement: alternatives.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Thing",
            name: entry.name,
            applicationCategory: entry.categoryLabel,
            description: entry.nativeFocus,
            url: entry.source
          }
        }))
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        mainEntity: comparisonQuestions.map(([name, answer]) => ({
          "@type": "Question",
          name,
          acceptedAnswer: { "@type": "Answer", text: answer }
        }))
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Product", item: `${site.origin}/` },
          { "@type": "ListItem", position: 2, name: "Alternatives", item: canonical }
        ]
      }
    ]
  })}
<body>
${header("alternatives")}
<main id="main" class="comparison-page">
  <section class="shell comparison-hero">
    <div>
      <p class="eyebrow">Browser automation alternatives / checked ${comparison.checkedOn}</p>
      <h1>Choose the browser layer you actually need.</h1>
      <p class="hero-copy">Cockroach Browser does not replace every automation library, MCP server, AI browser framework, or hosted browser cloud. It packages local-first Chromium execution, semantic snapshots, browser actions, operator-owned workers, evidence, and receipt chains.</p>
      <div class="hero-actions">
        <a class="button button--primary" href="#comparison">Compare the layers</a>
        <a class="button" href="/docs/capabilities/">Inspect shipped capabilities</a>
      </div>
    </div>
    <aside class="comparison-boundary" aria-label="How to read this comparison">
      <span class="section-number">Read this first</span>
      <h2>No shared benchmark. No universal winner.</h2>
      <p>${escapeHtml(comparison.methodology)}</p>
      <dl>
        <div><dt>Primitive</dt><dd>Direct browser APIs</dd></div>
        <div><dt>Control server</dt><dd>Agent-facing browser tools</dd></div>
        <div><dt>Agent framework</dt><dd>Planning and model-directed actions</dd></div>
        <div><dt>Infrastructure</dt><dd>Hosted or self-hosted browser capacity</dd></div>
      </dl>
    </aside>
  </section>

  <section class="section" id="decision-map">
    <div class="shell">
      <div class="section-head">
        <h2>Start with the architectural decision.</h2>
        <p>A product can be excellent at its own layer and still be the wrong answer for a different layer. Start by deciding whether you need direct APIs, agent tools, an LLM-driven framework, hosted infrastructure, or the Cockroach Browser runtime.</p>
      </div>
      <div class="decision-map">
        <article><span>01 / direct code</span><h3>Pick an automation primitive.</h3><p>Use Playwright, Puppeteer, or Selenium when your application should own browser calls and you are prepared to design the surrounding service and trust model.</p></article>
        <article><span>02 / agent tools</span><h3>Pick an MCP control server.</h3><p>Use Playwright MCP for structured browser tools or Chrome DevTools MCP when debugging and performance inspection are central.</p></article>
        <article><span>03 / autonomous work</span><h3>Pick an agent framework.</h3><p>Use Browser Use or Stagehand when model-directed planning, natural-language actions, and high-level task execution are the product requirement.</p></article>
        <article><span>04 / remote capacity</span><h3>Pick browser infrastructure.</h3><p>Use Browserbase or Browserless when browser fleet operations, remote sessions, proxy features, or managed capacity are the main constraint.</p></article>
        <article><span>05 / local Browser runtime</span><h3>Pick Cockroach Browser.</h3><p>Use Cockroach Browser when a host agent needs semantic snapshots, ${actionKinds.length} typed actions, profiles and files, local or owned workers, evidence artifacts, and receipt-linked outcomes.</p></article>
      </div>
    </div>
  </section>

  <section class="section" id="layers">
    <div class="shell comparison-shell">
      <div class="section-head"><h2>Four layers, compared before individual products.</h2><p>Official links sit beside every layer assertion so the current upstream scope can be checked directly.</p></div>
      <div class="comparison-table-wrap"><table class="comparison-table"><caption>Browser product layers compared by native focus, selection condition, and relationship to Cockroach Browser.</caption><thead><tr><th scope="col">Layer and examples</th><th scope="col">Native focus</th><th scope="col">Choose it when</th><th scope="col">Cockroach Browser relationship and official sources</th></tr></thead><tbody>${layerRows}</tbody></table></div>
    </div>
  </section>

  <section class="section" id="comparison">
    <div class="shell comparison-shell">
      <div class="section-head">
        <h2>${alternatives.length} alternatives, grouped by layer.</h2>
        <p>Search by product, capability, deployment, or boundary. Every source link points to documentation controlled by the compared project.</p>
      </div>
      <div class="comparison-toolbar" aria-label="Alternative filters">
        <button type="button" data-alt-filter="all" aria-pressed="true">All ${alternatives.length}</button>
        ${filters}
        <input data-alt-search type="search" aria-label="Search browser alternatives" placeholder="Search Playwright, MCP, local, evidence...">
      </div>
      <p class="comparison-count" data-alt-count aria-live="polite">${alternatives.length} alternatives shown</p>
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <caption>Browser automation alternatives compared by native focus, selection criteria, and relationship to Cockroach Browser.</caption>
          <thead><tr><th scope="col">Product and layer</th><th scope="col">Native focus</th><th scope="col">Choose it when</th><th scope="col">Relationship and source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="comparison-empty" data-alt-empty hidden>No alternatives match this filter. Clear the search or select all layers.</div>
    </div>
  </section>

  <section class="section" id="current-gaps">
    <div class="shell comparison-shell">
      <div class="section-head"><h2>What Cockroach Browser ${escapeHtml(site.version)} still lacks.</h2><p>Existing multi-engine, upstream API, trace, HAR, network, protocol, SDK, model, fleet-adapter, extension, accessibility, and worker surfaces remain credited. Each gap names external infrastructure or native platform capacity that is not bundled with this release.</p></div>
      <div class="comparison-table-wrap"><table class="comparison-table"><caption>Current Cockroach Browser features and gaps compared with official competitor documentation.</caption><thead><tr><th scope="col">Area</th><th scope="col">What ships now</th><th scope="col">Current gap</th><th scope="col">Official comparison source</th></tr></thead><tbody>${gapRows}</tbody></table></div>
      <div class="callout"><strong>Truthful release boundary</strong><p>Cockroach Browser ${escapeHtml(site.version)} includes Chromium, Firefox, WebKit, complete pinned Playwright and Puppeteer exports, an optional model gateway, five additional daemon SDKs, and local plus remote fleet contracts. It does not claim native macOS Safari/iOS/Android capacity, an operated browser cloud, an owned proxy network, covert stealth, bundled CAPTCHA bypass, or hosted global scale.</p></div>
    </div>
  </section>

  <section class="section" id="cockroach-boundary">
    <div class="shell">
      <div class="section-head">
        <h2>Where Cockroach Browser fits.</h2>
        <p>It is a local-first Chromium execution and evidence runtime for AI-agent hosts. It is not a language-neutral test ecosystem, an autonomous planner, a hosted browser fleet, or an independent security certification.</p>
      </div>
      <div class="authority-ledger">
        <article><span>Session authority</span><h3>Origins, actions, effects, and budgets.</h3><p>The host admits a purpose and finite policy before execution instead of handing a general browser object to an unbounded task.</p></article>
        <article><span>Observed targets</span><h3>Snapshot-scoped semantic refs.</h3><p>Actions can use references tied to observed page state, with refresh required after a page revision changes.</p></article>
        <article><span>Outcome proof</span><h3>Artifacts and hash-linked receipts.</h3><p>Snapshots, screenshots, traces, action inputs, outcomes, and digests can remain connected after the session ends.</p></article>
        <article><span>Optional integration</span><h3>External approval when selected.</h3><p>A host may route chosen consequential operations through a separate approval service. Cockroach Browser does not require that service and does not make it part of the browser engine.</p></article>
      </div>
      <div class="callout"><strong>Important limit</strong><p>This page compares documented product surfaces. It does not establish comparative security, reliability, task success, performance, legal compliance, or independent certification. Evaluate those properties in your own threat model and workload.</p></div>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="shell">
      <div class="section-head">
        <h2>Direct comparison answers.</h2>
        <p>Short answers for architecture reviews, search engines, and agents that need the product boundary without marketing shorthand.</p>
      </div>
      <div class="answer-grid">${comparisonQuestions.map(([question, answer]) => `<article><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join("")}</div>
    </div>
  </section>
</main>
${footer()}`;
}

function ecosystemPage() {
  const canonical = `${site.origin}/ecosystem/`;
  const byId = new Map(ecosystem.projects.map((entry) => [entry.id, entry]));
  const localIds = ["qarinah", "maqam", "cockroach-browser", "cockroach-crawler"];
  const lanes = [
    ["memory-governance", "Memory and action governance", ["qarinah", "maqam"]],
    ["orchestration", "Agent runtime and orchestration", ["openai-agents-sdk", "langgraph"]],
    ["browser", "Browser primitives and agent frameworks", ["playwright", "puppeteer", "cockroach-browser", "browser-use", "stagehand"]],
    ["acquisition", "Web acquisition, extraction, and documents", ["cockroach-crawler", "firecrawl", "trafilatura", "docling"]]
  ];
  const localProjects = localIds.map((id, index) => {
    const entry = byId.get(id);
    return `<article id="${entry.id}" class="ecosystem-core-entry">
      <span>${String(index + 1).padStart(2, "0")} / ${escapeHtml(entry.categoryLabel)}</span>
      <h3>${escapeHtml(entry.name)}</h3>
      <p>${escapeHtml(entry.nativeFocus)}</p>
      <p class="ecosystem-relationship">${escapeHtml(entry.relationship)}</p>
      <a class="source-link" href="${escapeAttr(entry.source)}">${escapeHtml(entry.sourceLabel)}</a>
    </article>`;
  }).join("");
  const laneMarkup = lanes.map(([id, title, projectIds], laneIndex) => `<section class="ecosystem-lane" aria-labelledby="lane-${id}">
    <header><span>${String(laneIndex + 1).padStart(2, "0")}</span><h3 id="lane-${id}">${escapeHtml(title)}</h3></header>
    <div>${projectIds.map((projectId) => {
      const entry = byId.get(projectId);
      return `<article id="${localIds.includes(entry.id) ? `map-${entry.id}` : entry.id}" data-ecosystem-project>
        <div><span>${escapeHtml(entry.categoryLabel)}</span><h4>${escapeHtml(entry.name)}</h4></div>
        <p>${escapeHtml(entry.nativeFocus)}</p>
        <p><strong>Choose it when:</strong> ${escapeHtml(entry.chooseWhen)}</p>
        <p><strong>Relationship:</strong> ${escapeHtml(entry.relationship)}</p>
        <a class="source-link" href="${escapeAttr(entry.source)}">${escapeHtml(entry.sourceLabel)}</a>
      </article>`;
    }).join("")}</div>
  </section>`).join("");
  return `${baseHead({
    title: ecosystem.title,
    description: ecosystem.description,
    canonical,
    type: "article",
    robots: "noindex,follow",
    schemas: [
      {
        "@type": "Article",
        "@id": `${canonical}#article`,
        headline: ecosystem.title,
        description: ecosystem.description,
        datePublished: ecosystem.checkedOn,
        dateModified: ecosystem.checkedOn,
        inLanguage: "en",
        author: { "@type": "Person", name: "Ajnas N B" },
        publisher: { "@type": "Organization", name: site.name, url: site.origin },
        mainEntityOfPage: canonical
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#projects`,
        name: "Open-source projects for governed AI agent systems",
        numberOfItems: ecosystem.projects.length,
        itemListOrder: "https://schema.org/ItemListUnordered",
        itemListElement: ecosystem.projects.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Thing",
            name: entry.name,
            applicationCategory: entry.categoryLabel,
            description: entry.nativeFocus,
            url: entry.source
          }
        }))
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        mainEntity: ecosystem.questions.map(([name, answer]) => ({
          "@type": "Question",
          name,
          acceptedAnswer: { "@type": "Answer", text: answer }
        }))
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Product", item: `${site.origin}/` },
          { "@type": "ListItem", position: 2, name: "Ecosystem", item: canonical }
        ]
      }
    ]
  })}
<body>
${header("ecosystem")}
<main id="main" class="ecosystem-page">
  <section class="shell ecosystem-hero">
    <div>
      <nav class="article-breadcrumbs" aria-label="Breadcrumb"><a href="/">Cockroach Browser</a><span aria-hidden="true">/</span><span>Ecosystem</span></nav>
      <p class="eyebrow">Open-source toolkit for governed AI agents</p>
      <h1>The agent is a system. Keep every layer named.</h1>
      <p class="hero-copy">A useful agent may need orchestration, project memory, approval, browser execution, web acquisition, main-content extraction, and document conversion. These projects solve different jobs. The safe composition starts by naming each boundary.</p>
      <div class="article-byline"><span>By Ajnas N B</span><span>Reviewed ${ecosystem.checkedOn}</span><span>${ecosystem.projects.length} official project sources</span></div>
      <div class="hero-actions"><a class="button button--primary" href="#local-toolkit">Map the local toolkit</a><a class="button" href="#project-map">Inspect every layer</a></div>
    </div>
    <aside class="ecosystem-boundary" aria-label="How to read the ecosystem map">
      <span>Read this first</span>
      <h2>No shared benchmark. No universal winner.</h2>
      <p>${escapeHtml(ecosystem.methodology)}</p>
      <dl>
        <div><dt>Memory</dt><dd>Project context and provenance</dd></div>
        <div><dt>Action</dt><dd>Policy, approval, and receipts</dd></div>
        <div><dt>Browser</dt><dd>Stateful interaction and evidence</dd></div>
        <div><dt>Web</dt><dd>Acquisition, extraction, and documents</dd></div>
      </dl>
    </aside>
  </section>

  <section class="section" id="short-answer">
    <div class="shell ecosystem-short-answer">
      <div><p class="eyebrow">Short answer</p><h2>No package owns the whole agent.</h2></div>
      <div><p>Qarinah compiles cited project memory. Maqam governs selected registered actions. Cockroach Browser runs permitted browser work above Playwright. Cockroach Crawler acquires bounded web evidence. LangGraph or the OpenAI Agents SDK can orchestrate these layers, but installation alone does not connect or secure them.</p><p>The deployment still owns identity, credentials, process isolation, durable storage, model choice, network placement, and any route that bypasses a registered authority.</p></div>
    </div>
  </section>

  <section class="section" id="local-toolkit">
    <div class="shell">
      <div class="section-head"><h2>Four local responsibilities. Four reviewable boundaries.</h2><p>Use the packages separately or connect selected interfaces in a host-owned deployment.</p></div>
      <div class="ecosystem-core">${localProjects}</div>
    </div>
  </section>

  <section class="section" id="project-map">
    <div class="shell">
      <div class="section-head"><h2>Thirteen projects, grouped by product center.</h2><p>Every entry names its primary job, a practical selection condition, its relationship to Cockroach Browser, and a link controlled by the project.</p></div>
      <div class="ecosystem-lanes">${laneMarkup}</div>
    </div>
  </section>

  <section class="section" id="composition">
    <div class="shell ecosystem-composition">
      <div><p class="eyebrow">One explicit route</p><h2>The host connects the pipeline and preserves every handoff.</h2><p>This is an architecture example, not an automatic bundled pipeline.</p></div>
      <ol>
        <li><span>01</span><div><strong>Plan</strong><p>LangGraph, the OpenAI Agents SDK, or another runtime chooses a task and tool call.</p></div></li>
        <li><span>02</span><div><strong>Contextualize</strong><p>Qarinah can supply compact cited project context when the task needs local history.</p></div></li>
        <li><span>03</span><div><strong>Authorize</strong><p>Maqam can gate a selected registered effect with policy and exact-input approval.</p></div></li>
        <li><span>04</span><div><strong>Execute</strong><p>Cockroach Browser handles permitted interaction, or Cockroach Crawler reads permitted web resources.</p></div></li>
        <li><span>05</span><div><strong>Transform</strong><p>The host may use Trafilatura-backed extraction, Docling, Firecrawl, or another explicit specialist route.</p></div></li>
        <li><span>06</span><div><strong>Return proof</strong><p>Browser evidence, source records, execution receipts, and cited context return to the agent runtime.</p></div></li>
      </ol>
    </div>
  </section>

  <section class="section" id="method">
    <div class="shell ecosystem-method">
      <div><p class="eyebrow">Method and limits</p><h2>Official sources, one review date, no hidden benchmark.</h2></div>
      <div><p>Descriptions were reviewed against the linked official sites, documentation, or source repositories on 9 August 2026. External projects change independently. Verify the current license, release, hosted-service terms, security model, and exact integration before adoption.</p><p>This page maps product centers and composition boundaries. It does not establish comparative security, reliability, task success, legal compliance, production capacity, or a universal choice.</p></div>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="shell">
      <div class="section-head"><h2>Direct answers before you compose the stack.</h2><p>The FAQ stays visible to operators, search engines, and agent readers.</p></div>
      <div class="answer-grid ecosystem-faq">${ecosystem.questions.map(([question, answer]) => `<article><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join("")}</div>
    </div>
  </section>
</main>
${footer()}`;
}

function publicDashboard() {
  return `${baseHead({
    title: "Local dashboard",
    description: "Inspect authorized browser sessions, evidence, challenges, and receipt-chain health.",
    canonical: `${site.origin}/dashboard/`,
    robots: "noindex,follow"
  })}
<body>
${header("dashboard")}
<main id="main" class="dashboard-shell">
  <nav class="dashboard-nav" aria-label="Dashboard sections">
    <button type="button" aria-pressed="true">Overview</button>
    <button type="button" aria-pressed="false">Sessions</button>
    <button type="button" aria-pressed="false">Evidence</button>
    <button type="button" aria-pressed="false">Challenges</button>
    <button type="button" aria-pressed="false">Receipts</button>
  </nav>
  <section class="dashboard-main">
    <div class="dashboard-head">
      <div><p class="eyebrow">Local inspector</p><h1>Browser control room</h1></div>
      <span class="connection">Demo data. Connect the packaged dashboard to localhost.</span>
    </div>
    <div class="dashboard-grid">
      <article class="dashboard-panel"><h2>Active sessions</h2><span class="metric">2</span><p class="hero-copy">One read-only audit and one operator-approved release workflow.</p></article>
      <article class="dashboard-panel"><h2>Evidence records</h2><span class="metric">38</span><p class="hero-copy">Snapshots, screenshots, audits, traces, and action records.</p></article>
      <article class="dashboard-panel"><h2>Receipt chain</h2><span class="metric">OK</span><p class="hero-copy">Every recorded receipt and artifact digest verifies.</p></article>
      <article class="dashboard-panel dashboard-panel--wide"><h2>Recent sessions</h2><ul class="data-list"><li><span>release-review / docs.example.com</span><code>read only</code></li><li><span>support-form / app.example.com</span><code>approved write</code></li><li><span>visual-regression / preview.example.com</span><code>audit</code></li></ul></article>
      <article class="dashboard-panel"><h2>Challenges</h2><div class="dashboard-empty">No active challenge.<br>Login, consent, CAPTCHA, and access challenges pause here.</div></article>
    </div>
  </section>
</main>
<script src="/assets/main.js" defer></script>
</body>
</html>`;
}

function publicationPage() {
  return `${baseHead({
    title: "Technical paper",
    description: "Implementation-backed technical white paper for Cockroach Browser 0.3.0.",
    canonical: `${site.origin}/paper/`,
    type: "article",
    schemas: [{
      "@type": "ScholarlyArticle",
      "@id": `${site.origin}/paper/#article`,
      headline: "Cockroach Browser: A Local-First Browser Runtime for AI Agents",
      author: { "@type": "Person", name: "Ajnas N B" },
      datePublished: "2026-08-08",
      version: "1.1",
      license: "https://creativecommons.org/licenses/by/4.0/",
      url: `${site.origin}/paper/`,
      identifier: "https://doi.org/10.5281/zenodo.21850760",
      sameAs: "https://doi.org/10.5281/zenodo.21850760",
      about: { "@id": `${site.origin}/#software` }
    }]
  })}
<body>
${header("paper")}
<main id="main" class="docs-layout">
  ${docsSidebar("")}
  <article class="docs-main">
    <header class="page-hero">
      <p class="eyebrow">Cockroach Browser / technical paper / version 1.1</p>
      <h1>A local-first browser runtime for AI agents.</h1>
      <p class="kicker">Powerful browser automation for AI agents - without inheriting your whole machine.</p>
      <p class="lede">Ajnas N B &middot; August 2026 &middot; Cockroach Browser 0.3.0</p>
      <div class="hero-actions">
        <a class="button button--primary" href="/paper/Cockroach-Browser-Technical-White-Paper-v1.1.pdf">Download the PDF</a>
        <a class="button" href="https://doi.org/10.5281/zenodo.21850760">Cite published v1.1</a>
        <a class="button" href="${site.repository}/blob/main/docs/whitepaper.md">Read the source</a>
      </div>
    </header>
    <section class="manual-section" id="abstract">
      <span class="section-number">Abstract</span>
      <h2>Useful browser capability without ambient machine authority.</h2>
      <p>AI agents can inspect dynamic applications, fill forms, download files, capture evidence, and complete operational workflows. Conventional automation often inherits more authority than the task requires: ambient browser profiles, persistent cookies, arbitrary origins, unrestricted JavaScript, local files, broad network reach, or an unauthenticated remote control port.</p>
      <p>Cockroach Browser separates browser capability from ambient machine authority. A host creates an explicit session with a purpose, admitted origins, allowed actions, allowed effects, and finite budgets. The runtime then provides semantic page references, browser interactions, screenshots, PDFs, traces, network observations, audits, and hash-linked receipts inside that session.</p>
    </section>
    <section class="manual-section" id="release-surface">
      <span class="section-number">Implementation</span>
      <h2>One package, several explicit control surfaces.</h2>
      <p>Version 0.3.0 ships an embedded TypeScript SDK, authenticated loopback daemon, typed client, command-line interface, observation-first MCP server, Docker deployment, local dashboard, explicit browser providers, runtime-owned persistent profiles, authenticated jobs and workers, team-scoped roles, and adapters for Maqam, Qarinah, Cockroach Crawler, and ProductLoop OS.</p>
      <p>The annotated <code>v0.3.0</code> source-derived capability registry contains 94 entries: 88 directly available surfaces and 6 host-backed adapters. This is an implementation inventory, not a performance or security score.</p>
    </section>
    <section class="manual-section" id="status">
      <span class="section-number">Status</span>
      <h2>Implementation-backed and open for technical review.</h2>
      <p>This is an implementation-backed technical white paper for Cockroach Browser 0.3.0. The paper has not undergone independent peer review or independent security certification.</p>
      <p>Published v1.1: <a href="https://doi.org/10.5281/zenodo.21850760">doi:10.5281/zenodo.21850760</a>. Persistent paper series: <a href="https://doi.org/10.5281/zenodo.21701791">doi:10.5281/zenodo.21701791</a>. Version 1.0 remains preserved at <a href="https://doi.org/10.5281/zenodo.21701792">doi:10.5281/zenodo.21701792</a>.</p>
      <p>The software is licensed under AGPL-3.0-or-later. The paper is licensed under Creative Commons Attribution 4.0 International.</p>
    </section>
  </article>
  ${pageToc([["Abstract", "abstract"], ["Release surface", "release-surface"], ["Publication status", "status"]])}
</main>
${footer()}`;
}

function notFound() {
  return `${baseHead({
    title: "Page not found",
    description: "The requested Cockroach Browser documentation page does not exist.",
    canonical: `${site.origin}/404.html`,
    robots: "noindex,follow"
  })}
<body>
${header("")}
<main id="main" class="shell hero">
  <div><p class="eyebrow">404 / outside the admitted route</p><h1>This page is not in the session.</h1><p class="hero-copy">Return to the product or open the documentation map.</p><div class="hero-actions"><a class="button button--primary" href="/">Product</a><a class="button" href="/docs/">Documentation</a></div></div>
  <img src="/assets/logo.png" alt="Cockroach Browser AI browser automation logo" width="360" height="360">
</main>
${footer()}`;
}

function docsSidebar(active) {
  return `<nav class="docs-sidebar" aria-label="Documentation">
  ${navGroups.map((group) => `<div class="nav-group"><h2>${escapeHtml(group.title)}</h2>${group.items.map(([title, slug]) => `<a href="/docs/${slug}/" ${active === slug ? 'aria-current="page"' : ""}>${escapeHtml(title)}</a>`).join("")}</div>`).join("")}
  <div class="nav-group"><h2>Compare</h2><a href="/alternatives/">Alternatives by product layer</a></div>
</nav>`;
}

function pageToc(entries) {
  return `<aside class="page-toc" aria-label="On this page"><h2>On this page</h2>${entries.map(([title, id]) => `<a href="#${id}">${escapeHtml(title)}</a>`).join("")}</aside>`;
}

function codeBlock(code, label) {
  const id = `code-${++codeBlockIndex}`;
  return `<div class="code-block">
  <div class="code-head"><span>${escapeHtml(label)}</span><button class="copy-code" type="button" data-copy="#${id}">Copy</button></div>
  <pre><code id="${id}">${escapeHtml(code)}</code></pre>
</div>`;
}

function summaryFor(slug) {
  if (slug === "capabilities") return `${capabilities.length} named surfaces with release status and activation surface.`;
  return pages.find((page) => page.slug === slug)?.lede ?? "Open the complete Cockroach Browser manual.";
}

function idFor(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function sitemap() {
  const paths = [
    "/",
    "/what-is-cockroach-browser/",
    "/features/",
    "/install/",
    "/ai-agents/",
    "/use-cases/",
    "/browser-vs-crawler/",
    "/api-surface/",
    "/docs/",
    ...navGroups.flatMap((group) => group.items.map(([, slug]) => `/docs/${slug}/`)),
    "/alternatives/",
    "/paper/"
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${site.origin}${path}</loc><lastmod>${path === "/ecosystem/" ? ecosystem.checkedOn : comparison.checkedOn}</lastmod><changefreq>weekly</changefreq><priority>${path === "/" ? "1.0" : "0.8"}</priority></url>`).join("\n")}
</urlset>
`;
}

function searchIndex() {
  return {
    version: 1,
    checkedOn: comparison.checkedOn,
    documents: [
      {
        title: site.name,
        url: `${site.origin}/`,
        kind: "product",
        summary: site.description,
        keywords: ["browser automation", "AI agents", "LLM browser", "Chromium", "Firefox", "WebKit", "Playwright", "Puppeteer", "semantic snapshots", "profiles", "files", "evidence", "MCP", "TypeScript"]
      },
      {
        title: "What is Cockroach Browser?",
        url: `${site.origin}/what-is-cockroach-browser/`,
        kind: "product-definition",
        summary: "A local-first TypeScript runtime for Chromium, Firefox, and WebKit, complete pinned Playwright and Puppeteer exports, semantic page references, real interactions, and verifiable browser evidence.",
        keywords: ["Cockroach Browser", "browser runtime", "Playwright", "Puppeteer", "Chromium", "Firefox", "WebKit", "semantic page references", "browser evidence"]
      },
      {
        title: "Cockroach Browser features",
        url: `${site.origin}/features/`,
        kind: "features",
        summary: `${capabilities.length} mapped capabilities covering Chromium, Firefox, WebKit, complete pinned Playwright and Puppeteer exports, page interaction, files, evidence, audits, AI agents, SDKs, and deployment.`,
        keywords: ["browser automation features", "AI agent browser", `${actionKinds.length} browser actions`, ...capabilities.map((entry) => entry.title)]
      },
      {
        title: "Install Cockroach Browser",
        url: `${site.origin}/install/`,
        kind: "installation",
        summary: "Install on Windows, macOS, or Linux, install Chromium, Firefox, and WebKit explicitly, and connect through MCP, six SDKs, HTTP, CLI, Docker, or a local service.",
        keywords: ["npm install cockroach-browser", "MCP browser install", "Chromium AI agent", "Firefox automation", "WebKit automation", "TypeScript browser automation"]
      },
      {
        title: "Cockroach Browser for AI agents and LLM applications",
        url: `${site.origin}/ai-agents/`,
        kind: "ai-agent-integration",
        summary: "Connect an AI agent or LLM host to Chromium, Firefox, or WebKit through the built-in planner, MCP, six SDKs, or an authenticated HTTP API.",
        keywords: ["AI browser agent", "LLM browser automation", "browser MCP", "semantic page snapshot", "agent browser tool"]
      },
      {
        title: "Cockroach Browser use cases",
        url: `${site.origin}/use-cases/`,
        kind: "use-cases",
        summary: "Stateful browser workflows for AI agents, authenticated portals, forms and files, QA, local coding agents, and operator-managed workers.",
        keywords: browserUseCases.map((entry) => entry.title)
      },
      {
        title: "Cockroach Browser vs Cockroach Crawler",
        url: `${site.origin}/browser-vs-crawler/`,
        kind: "product-comparison",
        summary: "Choose Cockroach Browser for stateful interaction and browser evidence; choose Cockroach Crawler for broad public-web discovery, mapping, and extraction.",
        keywords: ["Cockroach Browser", "Cockroach Crawler", "browser vs crawler", ...browserCrawlerDecisions.map((entry) => entry.workload)]
      },
      {
        title: "Complete Playwright and Puppeteer API surface",
        url: `${site.origin}/api-surface/`,
        kind: "api-inventory",
        summary: `Machine-generated inventory of ${apiSurface.packages.reduce((sum, pkg) => sum + pkg.summary.owners, 0)} class/interface owners and ${apiSurface.packages.reduce((sum, pkg) => sum + pkg.summary.groupedOwnerMembers, 0)} grouped members from the exact pinned declarations.`,
        keywords: apiSurface.packages.flatMap((pkg) => [pkg.package, ...pkg.owners.map((owner) => owner.name), ...pkg.topLevel.map((entry) => entry.name)])
      },
      {
        title: comparison.title,
        url: `${site.origin}/alternatives/`,
        kind: "comparison",
        summary: comparison.description,
        keywords: alternatives.map((entry) => entry.name)
      },
      ...alternatives.map((entry) => ({
        title: `${site.name} and ${entry.name}`,
        url: `${site.origin}/alternatives/#${entry.id}`,
        kind: "alternative",
        summary: `${entry.nativeFocus} ${entry.relationship}`,
        keywords: [entry.name, entry.categoryLabel, "browser automation alternative"]
      })),
      ...pages.map((page) => ({
        title: page.title,
        url: `${site.origin}/docs/${page.slug}/`,
        kind: "documentation",
        summary: page.lede,
        keywords: page.sections.map((section) => section.title)
      })),
      {
        title: "Capability matrix",
        url: `${site.origin}/docs/capabilities/`,
        kind: "documentation",
        summary: `${capabilities.length} source-derived capabilities with available, adapter, and planned status.`,
        keywords: capabilities.map((entry) => entry.title)
      },
      {
        title: "Technical paper",
        url: `${site.origin}/paper/`,
        kind: "research",
        summary: "Implementation-backed Cockroach Browser 0.3.0 technical white paper.",
        keywords: ["white paper", "browser authority", "evidence", "governance"]
      }
    ]
  };
}

function markdownManual(page) {
  return `# ${page.title}

${page.kicker}

${page.lede}

Public manual: ${site.origin}/docs/${page.slug}/

${page.sections.map((section) => `## ${section.title}

${stripHtml(section.body)}
${section.code ? `\n\`\`\`\n${section.code}\n\`\`\`\n` : ""}`).join("\n")}

## Release status

This manual targets Cockroach Browser ${site.version}. Check [the capability matrix](${site.origin}/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
`;
}

function capabilityMarkdown() {
  return `# Capability matrix

This file is generated from \`src/capabilities.ts\`.

| ID | Group | Capability | Status | Surface |
| --- | --- | --- | --- | --- |
${capabilities.map((entry) => `| \`${entry.id}\` | ${entry.group} | ${entry.title} | **${entry.status}** | \`${entry.surface}\` |`).join("\n")}

## Status model

- **available**: implemented in Cockroach Browser ${site.version}
- **adapter**: integration contract is present, but another package or host authority is required
- **planned**: documented direction, not part of the current release
`;
}

function docsReadme() {
  return `# Cockroach Browser documentation

Cockroach Browser is a local-first browser runtime for AI agents with Chromium, Firefox, and WebKit execution; complete pinned Playwright and Puppeteer exports; snapshot-scoped semantic references; evidence capture; an optional model gateway; six SDKs; and MCP.

The public documentation lives at ${site.origin}/docs/.

## Manuals

${navGroups.flatMap((group) => group.items).map(([title, slug]) => `- [${title}](./${slug}.md)`).join("\n")}
- [Alternatives and product-layer comparison](${site.origin}/alternatives/)
- [Complete Playwright and Puppeteer API inventory](${site.origin}/api-surface/)
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

Run \`cockroach-browser serve\`, open \`http://127.0.0.1:43110/dashboard/\`, and enter the bearer token stored in the configured token file. The dashboard is served by the daemon, reads the same-origin authenticated API, and keeps the entered token in page memory only.
`;
}
