import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homepage, navGroups, pages, site } from "./content.mjs";

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

await writePage("index.html", homePage());
await writePage("docs/index.html", docsIndex());
for (const page of pages) {
  await writePage(`docs/${page.slug}/index.html`, manualPage(page));
  await writeRootDoc(`${page.slug}.md`, markdownManual(page));
}
await writePage("docs/capabilities/index.html", capabilityPage());
await writeRootDoc("capabilities.md", capabilityMarkdown());
await writeRootDoc("README.md", docsReadme());
await writePage("dashboard/index.html", publicDashboard());
await writePage("paper/index.html", publicationPage());
await mkdir(resolve(root, "paper"), { recursive: true });
await copyFile(
  resolve(sourceRoot, "docs", "Cockroach-Browser-Technical-White-Paper-v1.0.pdf"),
  resolve(root, "paper", "Cockroach-Browser-Technical-White-Paper-v1.0.pdf")
);
await writePage("404.html", notFound());
await writePage("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
await writePage("sitemap.xml", sitemap());
await writePage(
  "llms.txt",
  `# ${site.name}

> ${site.description}

Canonical website: ${site.origin}
Repository: ${site.repository}
npm: ${site.npm}
Technical paper: ${site.origin}/paper/

## Documentation
${navGroups.flatMap((group) => group.items).map(([title, slug]) => `- [${title}](${site.origin}/docs/${slug}/)`).join("\n")}

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
  `# ${site.name} documentation\n\n${pages.map((page) => [
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
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' http://127.0.0.1:43110 https://127.0.0.1:43110; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
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
`
);

process.stdout.write(`Built ${pages.length + 5} HTML pages and ${capabilities.length} capability records.\n`);

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

function baseHead({ title, description, canonical, type = "website" }) {
  const pageTitle = title === site.name ? title : `${title} | ${site.name}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <meta name="theme-color" content="#050a0d">
  <link rel="canonical" href="${canonical}">
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
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${site.origin}/assets/logo.png">
</head>`;
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
      <a href="/paper/">Technical paper</a>
      <a href="${site.repository}">Source</a>
      <a href="${site.npm}">npm</a>
    </div>
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
    canonical: `${site.origin}/`
  })}
<body>
${header("home")}
<main id="main">
  <section class="shell hero">
    <div class="hero-copy-column">
      <p class="eyebrow">Lightweight browser runtime for AI agents</p>
      <h1>${homepage.title}</h1>
      <p class="hero-copy">${homepage.lede}</p>
      <div class="hero-actions">
        <a class="button button--primary" href="/docs/operator-install/">Install once. Use everywhere.</a>
        <a class="button" href="/docs/capabilities/">Inspect every capability</a>
      </div>
    </div>
    <div class="hero-runtime">
      <img class="hero-mark" src="/assets/logo.png" alt="Cockroach Browser cockroach and globe mark" width="320" height="320">
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
    canonical: `${site.origin}/docs/${page.slug}/`
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
    description: "Implementation-backed technical white paper for Cockroach Browser 0.2.1.",
    canonical: `${site.origin}/paper/`,
    type: "article"
  })}
<body>
${header("paper")}
<main id="main" class="docs-layout">
  ${docsSidebar("")}
  <article class="docs-main">
    <header class="page-hero">
      <p class="eyebrow">Cockroach Browser / technical paper / version 1.0</p>
      <h1>A local-first browser runtime for AI agents.</h1>
      <p class="kicker">Powerful browser automation for AI agents - without inheriting your whole machine.</p>
      <p class="lede">Ajnas NB · July 2026 · Cockroach Browser 0.3.0</p>
      <div class="hero-actions">
        <a class="button button--primary" href="/paper/Cockroach-Browser-Technical-White-Paper-v1.0.pdf">Download the PDF</a>
        <a class="button" href="https://doi.org/10.5281/zenodo.21701792">Cite on Zenodo</a>
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
      <p>Version 0.2.1 ships an embedded TypeScript SDK, authenticated loopback daemon, typed client, command-line interface, observation-first MCP server, Docker deployment, local dashboard, per-user service definitions, and adapters for Maqam, Qarinah, Cockroach Crawler, and ProductLoop OS.</p>
      <p>The source-derived capability registry contains 80 entries: 73 implemented runtime surfaces, 6 host-backed adapters, and 1 explicitly planned capability.</p>
    </section>
    <section class="manual-section" id="status">
      <span class="section-number">Status</span>
      <h2>Implementation-backed and open for technical review.</h2>
      <p>This is an implementation-backed technical white paper for Cockroach Browser 0.2.1. The paper has not undergone independent peer review.</p>
      <p>Permanent publication record: <a href="https://doi.org/10.5281/zenodo.21701792">doi:10.5281/zenodo.21701792</a>.</p>
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
    canonical: `${site.origin}/404.html`
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
  const paths = ["/", "/docs/", ...navGroups.flatMap((group) => group.items.map(([, slug]) => `/docs/${slug}/`)), "/dashboard/", "/paper/"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${site.origin}${path}</loc><changefreq>weekly</changefreq><priority>${path === "/" ? "1.0" : "0.8"}</priority></url>`).join("\n")}
</urlset>
`;
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
