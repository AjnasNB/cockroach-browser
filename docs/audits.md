# Audits and comparisons

Turn a rendered page into a reproducible engineering check.

Run accessibility, performance, broken asset, console, and page-security observations against the same authorized session used by the agent.

Public manual: https://cockroachbrowser.com/docs/audits/

## Run selected audits

The CLI and client accept a comma-separated audit set. Results are bounded JSON evidence, not a claim of complete standards compliance.

```
npx cockroach-browser audit \
  --session "$SESSION_ID" \
  --kinds accessibility,performance,assets,console,security \
  --token-file .cockroach-browser/auth-token
```

## Accessibility observations

Inspect accessible names, obvious missing labels, heading order, and semantic failures visible to the browser. Use the result to find candidate defects, then validate with full accessibility tooling and human review.

## Performance and page security

Collect navigation timing, paint entries, transfer sizes, resource summaries, mixed content, and insecure form targets visible to the page runtime. Results describe the captured run and environment.

## Visual comparison

Compare a current screenshot with an explicit baseline, store the diff, and emit a mismatch percentage. Pin viewport, color scheme, browser version, data fixtures, and fonts for stable regression checks.


## Release status

This manual targets Cockroach Browser 0.4.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
