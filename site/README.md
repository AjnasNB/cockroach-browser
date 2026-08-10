# Cockroach Browser website

This directory is the static asset bundle and canonical redirect Worker for
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
- Cloudflare static-asset `_headers` and path `_redirects`;
- `worker.mjs`, which redirects HTTP and `www` requests to the HTTPS apex while preserving path and query;
- matching Markdown manuals under `docs/`.

The source files in `site/assets/` are copied in place and need no
bundler. The Worker asset directory is `site`.

## Preview

Serve this directory with any static server. For example:

```sh
npx serve site
```

## Cloudflare Worker

The repository `wrangler.jsonc` is the deployment source of truth. It declares:

- Worker name: `cockroach-browser`
- module entry point: `site/worker.mjs`
- static asset binding: `ASSETS`
- existing zone routes: `cockroachbrowser.com/*` and `www.cockroachbrowser.com/*` in the `cockroachbrowser.com` zone
- `workers.dev` disabled so production has one canonical public host
- Worker-first routing so the module canonicalizes the scheme and host before the asset response

Before deployment, run the complete package check and Wrangler dry run:

```sh
npm run check
npx wrangler@latest whoami
npx wrangler@latest deploy --dry-run
```

Production deployment must come from a reviewed merge commit. These route declarations preserve the existing Worker service topology; they do not create or migrate custom-domain records. Verify that HTTP
and `www` each return one `308` to the same HTTPS apex path and query, then verify
the canonical route returns `200`.

Do not put daemon tokens, browser profiles, or Cloudflare credentials in
this directory. The public dashboard is a product preview. The local
control room in `dashboard/` is the authenticated inspector intended to
connect to the loopback daemon.
