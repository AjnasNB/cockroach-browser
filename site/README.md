# Cockroach Browser website

This directory is the complete static Cloudflare Pages artifact for
`cockroachbrowser.com`.

## Build

From the repository root:

```sh
node site/build.mjs
node site/validate.mjs
node site/smoke.mjs
```

The build reads the public capability registry from
`src/capabilities.ts`. It then generates:

- the product website;
- the documentation index and individual manuals;
- the source-derived capability matrix;
- the evidence-bounded alternatives and product-layer comparison;
- the public dashboard preview;
- `robots.txt`, `sitemap.xml`, `search.json`, `llms.txt`, and `llms-full.txt`;
- Cloudflare Pages `_headers` and `_redirects`;
- matching Markdown manuals under `docs/`.

The source files in `site/assets/` are copied in place and need no
bundler. The Pages output directory is `site`.

## Preview

Serve this directory with any static server. For example:

```sh
npx serve site
```

## Cloudflare Pages

After review, configure a Pages project with:

- build command: `node site/build.mjs && node site/validate.mjs`
- build output directory: `site`
- production branch: `main`
- custom domain: `cockroachbrowser.com`

Do not put daemon tokens, browser profiles, or Cloudflare credentials in
this directory. The public dashboard is a product preview. The local
control room in `dashboard/` is the authenticated inspector intended to
connect to the loopback daemon.
