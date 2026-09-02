import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { MCP_ACTION_PROPOSAL, STRUCTURED_EXTRACTION_LIMITS_SCHEMA } from "../src/mcp.js";
import { BrowserRuntime } from "../src/runtime.js";
import { extractStructuredFromUntrustedHtml } from "../src/structured-extraction-host.js";
import {
  extractStructuredFromLocator,
  extractStructuredFromPage,
  STRUCTURED_EXTRACTION_LIMIT_SPECS,
  structuredExtractionContentChars,
  type StructuredExtractionResult
} from "../src/structured-extraction.js";

async function browserPage(t: TestContext): Promise<{ browser: Browser; page: Page } | undefined> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`Chromium is not installed for structured extraction: ${String(error)}`);
    return undefined;
  }
  t.after(() => browser.close());
  return { browser, page: await browser.newPage() };
}

test("one canonical limit registry drives every structured extraction bound", () => {
  const shape = STRUCTURED_EXTRACTION_LIMITS_SCHEMA.shape;
  assert.deepEqual(Object.keys(shape).sort(), Object.keys(STRUCTURED_EXTRACTION_LIMIT_SPECS).sort());
  for (const [name, spec] of Object.entries(STRUCTURED_EXTRACTION_LIMIT_SPECS)) {
    assert.equal(shape[name as keyof typeof shape].safeParse(spec.maximum).success, true);
    assert.equal(shape[name as keyof typeof shape].safeParse(spec.maximum + 1).success, false);
  }
});

test("extracts useful structures while removing executable markup and unsafe URLs", async (t) => {
  const fixture = await browserPage(t);
  if (!fixture) return;
  await fixture.page.setContent(`<!doctype html>
    <html lang="en">
      <head>
        <base href="https://example.test/docs/">
        <title>  Extraction   fixture  </title>
        <meta name="description" content="A useful fixture">
        <meta property="og:url" content="javascript:alert(1)">
        <link rel="canonical" href="/guide">
        <script type="application/ld+json">
          {
            "@type": "Article",
            "name": "Safe article",
            "url": "/article",
            "sameAs": ["https://example.test/profile", "javascript:alert(1)"],
            "__proto__": { "polluted": true }
          }
        </script>
        <script type="application/ld+json">{ definitely invalid }</script>
        <style>.secret { display: block }</style>
      </head>
      <body>
        <main id="content" onclick="steal()" style="background:url(javascript:steal())">
          <h1>Structured extraction</h1>
          <p>Hello <strong>browser</strong>.</p>
          <a href="/safe" title="Safe title" onmouseover="steal()">Safe link</a>
          <a href="javascript:alert(document.cookie)">Bad link</a>
          <a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">Data link</a>
          <img src="https://tracking.invalid/pixel" onerror="steal()" alt="Diagram">
          <iframe srcdoc="&lt;script&gt;steal()&lt;/script&gt;"></iframe>
          <script>globalThis.exfiltrated = true</script>
          <table>
            <caption>Quarterly totals</caption>
            <thead><tr><th>Quarter</th><th>Total</th></tr></thead>
            <tbody><tr><td>Q1</td><td>42</td></tr></tbody>
          </table>
          <pre>const safe = true;</pre>
        </main>
      </body>
    </html>`);

  const result = await extractStructuredFromPage(fixture.page);

  assert.match(result.text, /Structured extraction/);
  assert.match(result.text, /Hello browser\./);
  assert.doesNotMatch(result.text, /exfiltrated|display: block|steal\(\)/);
  assert.match(result.html, /<h1>Structured extraction<\/h1>/);
  assert.match(result.html, /href="https:\/\/example\.test\/safe"/);
  assert.match(result.html, /<img alt="Diagram">/);
  assert.doesNotMatch(result.html, /script|iframe|onmouseover|onclick|onerror|style=|javascript:|data:text/i);
  assert.match(result.markdown, /^# Structured extraction/m);
  assert.match(result.markdown, /\[Safe link\]\(https:\/\/example\.test\/safe\)/);
  assert.match(result.markdown, /\| Quarter \| Total \|/);
  assert.match(result.markdown, /```\nconst safe = true;\n```/);
  assert.deepEqual(result.links, [{
    text: "Safe link",
    href: "https://example.test/safe",
    title: "Safe title"
  }]);
  assert.deepEqual(result.metadata, [
    { name: "title", content: "Extraction fixture" },
    { name: "language", content: "en" },
    { name: "description", content: "A useful fixture" },
    { name: "canonical", content: "https://example.test/guide" }
  ]);
  assert.deepEqual(result.jsonLd, [{
    "@type": "Article",
    name: "Safe article",
    url: "https://example.test/article",
    sameAs: ["https://example.test/profile"]
  }]);
  assert.deepEqual(result.tables, [{
    caption: "Quarterly totals",
    headers: ["Quarter", "Total"],
    rows: [["Q1", "42"]]
  }]);
  assert.equal(result.sanitization.invalidJsonLd, 1);
  assert.ok(result.sanitization.removedElements >= 3);
  assert.ok(result.sanitization.removedAttributes >= 4);
  assert.ok(result.sanitization.removedUrls >= 3);
});

test("host-side sanitization is not bypassed by hostile page globals", async (t) => {
  const fixture = await browserPage(t);
  if (!fixture) return;
  await fixture.page.setContent(`<!doctype html><html><body>
    <a href="https://example.test/safe">Safe</a>
    <a href="javascript:alert(99)">Unsafe</a>
    <h1>[Run](javascript:alert(99))</h1>
    <blockquote>[Quote](javascript:alert(99))</blockquote>
    <table><tr><th>[Head](javascript:alert(99))</th></tr></table>
    <script type="application/ld+json">{
      "downloadUrl":"javascript:alert(99)",
      "@context":"javascript:alert(99)",
      "name":"Safe record"
    }</script>
  </body></html>`);
  await fixture.page.evaluate(() => {
    Object.defineProperty(globalThis, "URL", {
      configurable: true,
      value: class HostileUrl {
        protocol = "https:";
        username = "";
        password = "";
        toString(): string { return "javascript:alert(99)"; }
      }
    });
  });

  const result = await extractStructuredFromPage(fixture.page);
  assert.deepEqual(result.links, [{ text: "Safe", href: "https://example.test/safe" }]);
  assert.doesNotMatch(result.html, /(?:href|cite)="javascript:/i);
  assert.doesNotMatch(result.markdown, /(^|[^\\])\[[^\]]+\]\(javascript:/im);
  assert.doesNotMatch(`${JSON.stringify(result.links)}\n${JSON.stringify(result.jsonLd)}`, /"javascript:/i);
  assert.ok(result.markdown.includes("\\[Run\\]\\(javascript:alert\\(99\\)\\)"));
  assert.ok(result.sanitization.removedUrls >= 3);
});

test("locator extraction is scope-bound and applies every caller-provided limit", async (t) => {
  const fixture = await browserPage(t);
  if (!fixture) return;
  await fixture.page.setContent(`<!doctype html><html><head>
    <meta name="outside" content="must not leak">
    <script type="application/ld+json">[{"name":"outside"}]</script>
    </head><body>
      <section id="target">
        <p>${"long content ".repeat(20)}</p>
        <a href="https://example.test/one">One</a>
        <a href="https://example.test/two">Two</a>
        <table>
          <tr><th>A</th><th>B</th><th>C</th></tr>
          <tr><td>1</td><td>2</td><td>3</td></tr>
          <tr><td>4</td><td>5</td><td>6</td></tr>
        </table>
      </section>
      <p>outside text</p>
    </body></html>`);

  const result = await extractStructuredFromLocator(fixture.page.locator("#target"), {
    maxTextChars: 24,
    maxHtmlChars: 40,
    maxMarkdownChars: 30,
    maxLinks: 1,
    maxMetadataItems: 0,
    maxJsonLdItems: 0,
    maxJsonLdChars: 0,
    maxTables: 1,
    maxTableRows: 1,
    maxTableColumns: 2,
    maxItemChars: 12,
    maxDomNodes: 100
  });

  assert.ok(result.text.length <= 24);
  assert.ok(result.html.length <= 40);
  assert.ok(result.markdown.length <= 30);
  assert.equal(result.links.length, 1);
  assert.deepEqual(result.metadata, []);
  assert.deepEqual(result.jsonLd, []);
  assert.equal(result.tables.length, 1);
  assert.deepEqual(result.tables[0]?.headers, ["A", "B"]);
  assert.deepEqual(result.tables[0]?.rows, [["1", "2"]]);
  assert.equal(result.truncated.text, true);
  assert.equal(result.truncated.html, true);
  assert.equal(result.truncated.markdown, true);
  assert.equal(result.truncated.links, true);
  assert.equal(result.truncated.tableRows, true);
  assert.equal(result.truncated.tableColumns, true);
  assert.doesNotMatch(JSON.stringify(result), /outside text|must not leak|outside/);
});

test("zero limits return an empty bounded result without throwing", async (t) => {
  const fixture = await browserPage(t);
  if (!fixture) return;
  await fixture.page.setContent("<main><h1>Nothing may escape</h1><a href='https://example.test'>link</a></main>");
  const result = await extractStructuredFromPage(fixture.page, {
    maxTextChars: 0,
    maxHtmlChars: 0,
    maxMarkdownChars: 0,
    maxLinks: 0,
    maxMetadataItems: 0,
    maxJsonLdItems: 0,
    maxJsonLdChars: 0,
    maxTables: 0,
    maxTableRows: 0,
    maxTableColumns: 0,
    maxItemChars: 0,
    maxDomNodes: 0
  });
  assert.equal(result.text, "");
  assert.equal(result.html, "");
  assert.equal(result.markdown, "");
  assert.deepEqual(result.links, []);
  assert.deepEqual(result.metadata, []);
  assert.deepEqual(result.jsonLd, []);
  assert.deepEqual(result.tables, []);
  assert.equal(result.truncated.domNodes, true);
});

test("deeply nested untrusted markup is bounded without overflowing the stack", () => {
  const depth = 20_000;
  const result = extractStructuredFromUntrustedHtml(
    `${"<div>".repeat(depth)}bounded leaf${"</div>".repeat(depth)}`,
    {
      documentScope: false,
      limits: {
        // Keep the node ceiling above the input size so this specifically
        // exercises the independent finite-depth boundary.
        maxDomNodes: 200_000,
        maxTextChars: 1_000,
        maxHtmlChars: 10_000,
        maxMarkdownChars: 1_000
      }
    }
  );

  assert.equal(result.truncated.domNodes, true);
  assert.ok(result.html.length <= 10_000);
  assert.ok(result.text.length <= 1_000);
  assert.ok(result.markdown.length <= 1_000);
});

test("a tiny node ceiling bounds very wide untrusted markup", () => {
  const source = Array.from({ length: 20_000 }, (_, index) => `<span>${index}</span>`).join("");
  const result = extractStructuredFromUntrustedHtml(source, {
    documentScope: false,
    limits: { maxDomNodes: 3 }
  });

  assert.equal(result.truncated.domNodes, true);
  assert.equal(result.text, "0");
  assert.equal(result.html, "<span>0</span>");
  assert.equal(result.markdown, "0");
});

test("a truncated document never falls back to emitting head content as body content", () => {
  const result = extractStructuredFromUntrustedHtml(
    "<!doctype html><html><head><title>Head-only secret</title></head><body>Body content</body></html>",
    { documentScope: true, limits: { maxDomNodes: 6 } }
  );

  assert.equal(result.truncated.domNodes, true);
  assert.equal(result.text, "");
  assert.equal(result.html, "");
  assert.equal(result.markdown, "");
  assert.deepEqual(result.metadata, [{ name: "title", content: "Head-only secret" }]);
});

test("maxDomNodes zero suppresses metadata and JSON-LD even when their own limits are nonzero", () => {
  const result = extractStructuredFromUntrustedHtml(
    `<!doctype html><html><head>
      <meta name="description" content="must not escape">
      <script type="application/ld+json">{"name":"must not escape"}</script>
      </head><body>must not escape</body></html>`,
    {
      documentScope: true,
      limits: {
        maxDomNodes: 0,
        maxMetadataItems: 10,
        maxJsonLdItems: 10,
        maxJsonLdChars: 10_000
      }
    }
  );

  assert.equal(result.truncated.domNodes, true);
  assert.equal(result.text, "");
  assert.equal(result.html, "");
  assert.equal(result.markdown, "");
  assert.deepEqual(result.metadata, []);
  assert.deepEqual(result.jsonLd, []);
});

test("MCP admits only bounded structured-extraction options", () => {
  assert.equal(STRUCTURED_EXTRACTION_LIMITS_SCHEMA.safeParse({
    maxTotalChars: 12_000,
    maxTables: 4,
    maxDomNodes: 5_000
  }).success, true);
  assert.equal(MCP_ACTION_PROPOSAL.safeParse({
    kind: "extract.structured",
    selector: "main",
    extraction: {
      maxTotalChars: 12_000,
      maxTextChars: 4_000,
      maxHtmlChars: 4_000,
      maxMarkdownChars: 4_000
    }
  }).success, true);
  assert.equal(MCP_ACTION_PROPOSAL.safeParse({
    kind: "extract.structured",
    extraction: { maxTotalChars: 2_000_001 }
  }).success, false);
  assert.equal(MCP_ACTION_PROPOSAL.safeParse({
    kind: "extract.structured",
    extraction: { maxTotalChars: 100, unsafeOverride: true }
  }).success, false);
  for (const invalid of [
    { kind: "extract.structured", frame: { index: 0 } },
    { kind: "extract.structured", selector: "main", xpath: "//main" },
    { kind: "extract.structured", ref: "f0-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", frame: { index: 0 } },
    { kind: "extract.structured", selector: "main", frame: {} }
  ]) {
    assert.equal(MCP_ACTION_PROPOSAL.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test("runtime executes aggregate-budgeted structured extraction and records only sanitized evidence", {
  timeout: 120_000
}, async (t) => {
  try {
    await access(chromium.executablePath());
  } catch {
    t.skip("Chromium is not installed for the structured extraction runtime test.");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "cockroach-structured-extraction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head>
      <title>Runtime extraction</title>
      <meta name="description" content="Bounded runtime proof">
      <script type="application/ld+json">{
        "@type":"SoftwareApplication",
        "url":"/safe",
        "sameAs":["javascript:steal()"],
        "__proto__":{"polluted":true}
      }</script>
      </head><body><main>
        <h1>Bounded result</h1>
        <p>${"useful visible content ".repeat(200)}</p>
        <a href="/documentation">Documentation</a>
        <a href="javascript:steal()">Unsafe destination</a>
        <button onclick="steal()">Review</button>
        <script>globalThis.owned = true</script>
        <table><tr><th>Name</th><th>State</th></tr><tr><td>Extractor</td><td>Safe</td></tr></table>
      </main></body></html>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve())));
  const address = fixture.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const runtime = new BrowserRuntime({ root });
  await runtime.initialize();
  t.after(() => runtime.close());
  const session = await runtime.createSession({
    startUrl: origin,
    purpose: "Verify bounded structured extraction",
    policy: {
      allowedOrigins: [origin],
      allowPrivateNetwork: true,
      allowedActions: ["extract.structured"],
      allowedEffects: ["read"],
      requireApprovalFor: [],
      budget: { maxSnapshotChars: 3_000 }
    }
  });
  const actionResult = await runtime.act(session.id, {
    kind: "extract.structured",
    purpose: "Extract safe model-ready page structures",
    extraction: {
      maxTotalChars: 2_000,
      maxTextChars: 2_000,
      maxHtmlChars: 2_000,
      maxMarkdownChars: 2_000,
      maxLinks: 20,
      maxMetadataItems: 20,
      maxJsonLdItems: 20,
      maxJsonLdChars: 2_000,
      maxTables: 10,
      maxTableRows: 20,
      maxTableColumns: 10
    }
  });
  const output = actionResult.output as StructuredExtractionResult & { evidenceId: string };
  assert.ok(structuredExtractionContentChars(output) <= 2_000);
  assert.match(output.text, /Bounded result/);
  assert.equal(actionResult.receipt.effect, "read");
  assert.equal(actionResult.receipt.risk, "low");
  assert.match(output.links[0]?.href ?? "", new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/documentation$`));
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /javascript:|onclick|globalThis\.owned|__proto__|polluted/i);

  const evidencePath = await runtime.evidence.artifactPath(output.evidenceId);
  const evidence = await readFile(evidencePath, "utf8");
  assert.doesNotMatch(evidence, /javascript:|onclick|globalThis\.owned|__proto__|polluted/i);
  assert.match(evidence, /Bounded result/);

  await assert.rejects(
    runtime.act(session.id, {
      kind: "extract.structured",
      purpose: "Reject invalid extraction bounds",
      extraction: { maxLinks: -1 }
    }),
    (error: unknown) => Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ACTION_SCHEMA_INVALID"
    )
  );
});
