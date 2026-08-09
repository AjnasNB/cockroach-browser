import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  alternatives,
  comparison,
  comparisonQuestions,
  ecosystem,
  homepage,
  navGroups,
  pages,
  site
} from "./content.mjs";

const root = resolve(import.meta.dirname);
const sourceRoot = resolve(root, "..");

const capabilities = parseCapabilities(await readFile(resolve(sourceRoot, "src/capabilities.ts"), "utf8"));
const capabilityCounts = capabilities.reduce(
  (counts, capability) => {
    counts[capability.status] += 1;
    return counts;
  },
  { available: 0, adapter: 0, planned: 0 }
);
let codeBlockIndex = 0;

const homepageQuestions = [
  [
    "What is Cockroach Browser?",
    "Cockroach Browser is a local-first TypeScript runtime that gives AI agents an authorized Chromium session, semantic page references, real interactions, and verifiable browser evidence."
  ],
  [
    "Does Cockroach Browser use my normal browser profile?",
    "No. It uses an explicit isolated profile, an operator-selected runtime-owned persistent profile, imported storage state, or an exact CDP endpoint. It never scans ambient browser profiles."
  ],
  [
    "Can it bypass CAPTCHAs or access controls?",
    "No. Login, consent, CAPTCHA, and access challenges pause automation for a human or a separately authorized resolver. The runtime does not include a bypass engine."
  ],
  [
    "How is Cockroach Browser different from Cockroach Crawler?",
    "Cockroach Crawler maps and extracts bounded public sources at breadth. Cockroach Browser handles stateful rendering, interaction, user-authorized sessions, and browser evidence."
  ],
  [
    "How are consequential actions governed?",
    "Every session has explicit origins, actions, effects, and budgets. A host can additionally route consequential actions through Maqam for policy, exact one-use approval, replay rejection, and governance receipts."
  ]
];

await writePage("index.html", homePage());
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
await writePage("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
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
Alternatives and product-layer comparison: ${site.origin}/alternatives/
Open-source governed-agent ecosystem: ${site.origin}/ecosystem/

## Documentation
${navGroups.flatMap((group) => group.items).map(([title, slug]) => `- [${title}](${site.origin}/docs/${slug}/)`).join("\n")}

## Alternatives and product layers
${comparison.methodology}

${alternatives.map((entry) => `- [${entry.name}](${site.origin}/alternatives/#${entry.id}): ${entry.nativeFocus}`).join("\n")}

## Open-source governed-agent ecosystem
${ecosystem.methodology}

${ecosystem.projects.map((entry) => `- [${entry.name}](${site.origin}/ecosystem/#${entry.id}): ${entry.nativeFocus} ${entry.relationship}`).join("\n")}

## Security boundary
Cockroach Browser detects login, consent, CAPTCHA, and access challenges, pauses automation, and waits for a human or authorized resolver. It does not bypass CAPTCHAs or access controls.

## Capability states
- Available: implemented in the 0.3.0 runtime or shipped deployment surface.
- Adapter: integration contract shipped, external authority or package required.
- Planned: documented direction, not part of the current release.
`
);
await writePage(
  "llms-full.txt",
  `# ${site.name} documentation\n\n## Governed-agent ecosystem\n\n${ecosystem.methodology}\n\n${ecosystem.projects.map((entry) => `### ${entry.name}\n${entry.nativeFocus}\n\nChoose it when: ${entry.chooseWhen}\n\nRelationship to Cockroach Browser: ${entry.relationship}\n\nOfficial source: ${entry.source}`).join("\n\n")}\n\n## Alternatives and comparison method\n\n${comparison.methodology}\n\n${alternatives.map((entry) => `### ${entry.name}\n${entry.nativeFocus}\n\nChoose it when: ${entry.chooseWhen}\n\nRelationship to Cockroach Browser: ${entry.relationship}\n\nOfficial source: ${entry.source}`).join("\n\n")}\n\n${pages.map((page) => [
    `## ${page.title}`,
    page.lede,
    ...page.sections.map((section) => `### ${section.title}\n${stripHtml(section.body)}`)
  ].flat().join("\n\n")).join("\n\n")}\n\n## Capability matrix\n\n${capabilities.map((entry) => `- ${entry.title} [${entry.status}]: ${entry.summary} Surface: ${entry.surface}.`).join("\n")}\n`
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
  `/docs /docs/ 301
/dashboard /dashboard/ 301
/paper /paper/ 301
/alternatives /alternatives/ 301
/ecosystem /ecosystem/ 301
`
);

process.stdout.write(`Built ${pages.length + 8} HTML pages and ${capabilities.length} capability records.\n`);

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
  const pageTitle = title === site.name ? title : `${title} | ${site.name}`;
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
  <link rel="icon" href="/assets/logo.png" type="image/png">
  <link rel="stylesheet" href="/assets/styles.css">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${escapeAttr(pageTitle)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${site.origin}/assets/logo.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1250">
  <meta property="og:image:height" content="1250">
  <meta property="og:image:alt" content="Cockroach Browser globe and cockroach mark">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${site.origin}/assets/logo.png">
  <meta name="twitter:image:alt" content="Cockroach Browser globe and cockroach mark">
  <script type="application/ld+json">${schema}</script>
</head>`;
}

function structuredData({ canonical, description, pageTitle, type, schemas }) {
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${site.origin}/#website`,
      name: site.name,
      url: site.origin,
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
    ...schemas
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c");
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
      <a href="/" ${active === "home" ? 'aria-current="page"' : ""}>Product</a>
      <a href="/docs/" ${active === "docs" ? 'aria-current="page"' : ""}>Docs</a>
      <a href="/docs/capabilities/">Capabilities</a>
      <a href="/alternatives/" ${active === "alternatives" ? 'aria-current="page"' : ""}>Alternatives</a>
      <a href="/ecosystem/" ${active === "ecosystem" ? 'aria-current="page"' : ""}>Ecosystem</a>
      <a href="/dashboard/" ${active === "dashboard" ? 'aria-current="page"' : ""}>Dashboard</a>
      <a href="/paper/" ${active === "paper" ? 'aria-current="page"' : ""}>Paper</a>
      <a href="${site.repository}">GitHub</a>
      <a href="${site.npm}">npm</a>
    </nav>
    <button class="mobile-menu" type="button" data-menu aria-expanded="false" aria-label="Open navigation">Menu</button>
  </div>
</header>`;
}

function footer() {
  return `<footer class="footer">
  <div class="shell footer-inner">
    <div>
      <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="34" height="34"><span>${site.name}</span></a>
      <p>Local-first browser execution for AI agents. Authorized sessions, snapshot-scoped refs, evidence, and explicit governance hooks.</p>
    </div>
    <div class="footer-links">
      <a href="/docs/security/">Security</a>
      <a href="/alternatives/">Alternatives</a>
      <a href="/ecosystem/">Ecosystem</a>
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
    title: site.name,
    description: site.description,
    canonical: `${site.origin}/`,
    schemas: [
      {
        "@type": "SoftwareApplication",
        "@id": `${site.origin}/#software`,
        name: site.name,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Windows, macOS, Linux",
        softwareVersion: site.version,
        description: site.description,
        url: site.origin,
        downloadUrl: site.npm,
        codeRepository: site.repository,
        license: "https://spdx.org/licenses/AGPL-3.0-or-later.html",
        isAccessibleForFree: true,
        featureList: [
          "Authorized Chromium sessions",
          "Snapshot-scoped semantic page references",
          "Browser actions with finite policy budgets",
          "Screenshots, PDFs, traces, and paired evidence",
          "Authenticated local daemon and MCP server",
          "Maqam governance integration"
        ]
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${site.origin}/#source`,
        name: `${site.name} source code`,
        codeRepository: site.repository,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Node.js 22, 24, or 26",
        license: "https://spdx.org/licenses/AGPL-3.0-or-later.html",
        isPartOf: { "@id": `${site.origin}/#software` }
      },
      {
        "@type": "FAQPage",
        "@id": `${site.origin}/#faq`,
        mainEntity: homepageQuestions.map(([name, text]) => ({
          "@type": "Question",
          name,
          acceptedAnswer: { "@type": "Answer", text }
        }))
      }
    ]
  })}
<body>
${header("home")}
<main id="main">
  <section class="shell hero">
    <div class="hero-copy-column">
      <img class="hero-mark" src="/assets/logo.png" alt="Cockroach Browser cockroach and globe mark" width="180" height="180">
      <p class="eyebrow">Lightweight browser runtime for AI agents</p>
      <h1>${homepage.title}</h1>
      <p class="hero-copy">${homepage.lede}</p>
      <div class="hero-actions">
        <a class="button button--primary" href="/docs/operator-install/">Install once. Use everywhere.</a>
        <a class="button" href="/docs/capabilities/">Inspect every capability</a>
      </div>
      <div class="hero-boundary" aria-label="Default authority boundary">
        <span>Explicit origins</span><span>Finite budgets</span><span>Challenge stop</span><span>Hash-linked evidence</span>
      </div>
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
  <section class="section" id="answers">
    <div class="shell">
      <div class="section-head">
        <h2>Direct answers for operators and agents.</h2>
        <p>These are the product boundaries that matter before a browser-capable agent receives a session.</p>
      </div>
      <div class="answer-grid">${homepageQuestions.map(([question, answer]) => `<article><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join("")}</div>
    </div>
  </section>
  <section class="shell proof-strip" aria-label="Product surface">${proof}</section>
  <section class="section">
    <div class="shell">
      <div class="section-head">
        <h2>Observe. Propose. Approve. Execute. Prove.</h2>
        <p>A browser is powerful because it carries state and can change real systems. Cockroach Browser makes that power explicit at every step without reducing the agent to screenshots and coordinates.</p>
      </div>
      <div class="workflow">
        <article><b>01</b><h3>Observe</h3><p>Capture a bounded semantic snapshot with snapshot-scoped refs, source URL, digest, and challenge state.</p></article>
        <article><b>02</b><h3>Propose</h3><p>Name the exact action, target ref, purpose, effect, and expected revision.</p></article>
        <article><b>03</b><h3>Approve</h3><p>When configured, route consequential actions through Maqam for policy and exact one-use approval.</p></article>
        <article><b>04</b><h3>Execute</h3><p>Run the admitted action inside one authorized Chromium session and finite budget.</p></article>
        <article><b>05</b><h3>Prove</h3><p>Keep artifacts and a hash-chained receipt linking input, decision, outcome, and evidence.</p></article>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="shell">
      <div class="section-head">
        <h2>One product stack. Four distinct authorities.</h2>
        <p>The packages interoperate through explicit adapters. They do not silently merge credentials, policies, browser profiles, or ledgers.</p>
      </div>
      <div class="stack-grid">
        <article><span class="tag">Execute</span><h3>Cockroach Browser</h3><p>Owns Chromium, sessions, semantic refs, interactions, browser evidence, audits, and local worker transport.</p></article>
        <article><span class="tag">Discover</span><h3>Cockroach Crawler</h3><p>Maps and extracts bounded public sources at breadth, then hands selected rendered paths to the browser.</p></article>
        <article><span class="tag">Remember</span><h3>Qarinah</h3><p>Stores compact cited read outcomes and source links without gaining browser dispatch or profile authority.</p></article>
        <article><span class="tag">Govern</span><h3>Maqam</h3><p>For operations routed through its adapter, owns policy, exact approval, replay protection, dispatch, and governance receipts.</p></article>
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
        <a class="button" href="/docs/maqam/">Connect Maqam</a>
      </div>
    </div>
  </section>
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
      }
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
    canonical: `${site.origin}/docs/capabilities/`
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
    <div class="callout" id="status-model"><strong>Read the status</strong><p>Available means shipped in 0.3.0. Adapter means this package ships the integration contract but another package or host authority is required. Planned means the direction is documented and is not part of the current release.</p></div>
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
            "@type": "SoftwareApplication",
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
      <p class="hero-copy">Cockroach Browser does not replace every automation library, MCP server, agent framework, or hosted browser. It packages a local-first execution layer around explicit session authority, semantic snapshots, evidence, and receipt chains.</p>
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
        <p>A product can be excellent at its own layer and still be the wrong answer for a different layer. These routes keep the comparison concrete.</p>
      </div>
      <div class="decision-map">
        <article><span>01 / direct code</span><h3>Pick an automation primitive.</h3><p>Use Playwright, Puppeteer, or Selenium when your application should own browser calls and you are prepared to design the surrounding service and trust model.</p></article>
        <article><span>02 / agent tools</span><h3>Pick an MCP control server.</h3><p>Use Playwright MCP for structured browser tools or Chrome DevTools MCP when debugging and performance inspection are central.</p></article>
        <article><span>03 / autonomous work</span><h3>Pick an agent framework.</h3><p>Use Browser Use or Stagehand when model-directed planning, natural-language actions, and high-level task execution are the product requirement.</p></article>
        <article><span>04 / remote capacity</span><h3>Pick browser infrastructure.</h3><p>Use Browserbase or Browserless when browser fleet operations, remote sessions, proxy features, or managed capacity are the main constraint.</p></article>
        <article><span>05 / bounded execution</span><h3>Pick Cockroach Browser.</h3><p>Use Cockroach Browser when the host agent needs one explicit session policy, authenticated local transport, bounded actions, evidence artifacts, and receipt-linked outcomes.</p></article>
      </div>
    </div>
  </section>

  <section class="section" id="comparison">
    <div class="shell comparison-shell">
      <div class="section-head">
        <h2>Nine alternatives, grouped by layer.</h2>
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

  <section class="section" id="cockroach-boundary">
    <div class="shell">
      <div class="section-head">
        <h2>Where Cockroach Browser fits.</h2>
        <p>It is an authority and evidence runtime around browser execution. It is not a language-neutral test ecosystem, an autonomous planner, a hosted fleet, or an independent security certification.</p>
      </div>
      <div class="authority-ledger">
        <article><span>Session authority</span><h3>Origins, actions, effects, and budgets.</h3><p>The host admits a purpose and finite policy before execution instead of handing a general browser object to an unbounded task.</p></article>
        <article><span>Observed targets</span><h3>Snapshot-scoped semantic refs.</h3><p>Actions can use references tied to observed page state, with refresh required after a page revision changes.</p></article>
        <article><span>Outcome proof</span><h3>Artifacts and hash-linked receipts.</h3><p>Snapshots, screenshots, traces, action inputs, outcomes, and digests can remain connected after the session ends.</p></article>
        <article><span>Governance hook</span><h3>Optional Maqam approval.</h3><p>A host can route consequential operations through an external policy and one-use approval authority without making Maqam part of the browser engine.</p></article>
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
            "@type": "SoftwareApplication",
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
    canonical: `${site.origin}/dashboard/`
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
      <article class="dashboard-panel"><h2>Active sessions</h2><span class="metric">2</span><p class="hero-copy">One read-only audit and one Maqam-managed release workflow.</p></article>
      <article class="dashboard-panel"><h2>Evidence records</h2><span class="metric">38</span><p class="hero-copy">Snapshots, screenshots, audits, traces, and action records.</p></article>
      <article class="dashboard-panel"><h2>Receipt chain</h2><span class="metric">OK</span><p class="hero-copy">Every recorded receipt and artifact digest verifies.</p></article>
      <article class="dashboard-panel dashboard-panel--wide"><h2>Recent sessions</h2><ul class="data-list"><li><span>release-review / docs.example.com</span><code>read only</code></li><li><span>support-form / app.example.com</span><code>Maqam managed</code></li><li><span>visual-regression / preview.example.com</span><code>audit</code></li></ul></article>
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
  <img src="/assets/logo.png" alt="Cockroach Browser globe mark" width="360" height="360">
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

function stripHtml(value) {
  return String(value)
    .replace(/<li>/g, "- ")
    .replace(/<\/li>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .trim();
}

function sitemap() {
  const paths = ["/", "/docs/", ...navGroups.flatMap((group) => group.items.map(([, slug]) => `/docs/${slug}/`)), "/alternatives/", "/ecosystem/", "/dashboard/", "/paper/"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${site.origin}${path}</loc><lastmod>${path === "/ecosystem/" ? ecosystem.checkedOn : "2026-08-08"}</lastmod><changefreq>weekly</changefreq><priority>${path === "/" ? "1.0" : "0.8"}</priority></url>`).join("\n")}
</urlset>
`;
}

function searchIndex() {
  return {
    version: 1,
    checkedOn: ecosystem.checkedOn,
    documents: [
      {
        title: site.name,
        url: `${site.origin}/`,
        kind: "product",
        summary: site.description,
        keywords: ["browser automation", "AI agents", "local-first", "evidence", "MCP", "Maqam"]
      },
      {
        title: comparison.title,
        url: `${site.origin}/alternatives/`,
        kind: "comparison",
        summary: comparison.description,
        keywords: alternatives.map((entry) => entry.name)
      },
      {
        title: ecosystem.title,
        url: `${site.origin}/ecosystem/`,
        kind: "ecosystem",
        summary: ecosystem.description,
        keywords: ecosystem.projects.map((entry) => entry.name)
      },
      ...ecosystem.projects.map((entry) => ({
        title: `${entry.name} in the governed-agent ecosystem`,
        url: `${site.origin}/ecosystem/#${entry.id}`,
        kind: "ecosystem-project",
        summary: `${entry.nativeFocus} ${entry.relationship}`,
        keywords: [entry.name, entry.categoryLabel, "governed AI agents"]
      })),
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

Cockroach Browser is a local-first browser runtime for AI agents with authorized Chromium sessions, snapshot-scoped semantic references, evidence capture, MCP, and Maqam policy hooks.

The public documentation lives at ${site.origin}/docs/.

## Manuals

${navGroups.flatMap((group) => group.items).map(([title, slug]) => `- [${title}](./${slug}.md)`).join("\n")}
- [Alternatives and product-layer comparison](${site.origin}/alternatives/)
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
