# Getting started

Install once. Admit one origin. Keep every result.

Cockroach Browser gives an AI agent real Chromium, Firefox, or WebKit execution without turning the browser into ambient authority. Start with a local daemon, embed the bounded runtime, or use the raw upstream APIs.

Public manual: https://cockroachbrowser.com/docs/getting-started/

## Install the package and three browser engines

The package supports maintained Node.js 22, 24, and 26 releases. bootstrap installs Playwright 1.62.1 Chromium, Firefox, and WebKit builds only when an engine is missing, initializes the local data root, and probes an authenticated ephemeral loopback daemon. Browser downloads never happen in an npm lifecycle script.

```
# Install once for the current computer account
npm install --global cockroach-browser
cockroach-browser bootstrap
cockroach-browser doctor

# Or keep it inside one project
npm install --save-dev cockroach-browser
npx cockroach-browser bootstrap
```

## Start the authenticated localhost daemon

The daemon binds to loopback by default, generates a strong bearer token, and rejects requests without it. A non-loopback bind requires an explicit remote setting and TLS.

```
npx cockroach-browser serve --host 127.0.0.1 --port 43110

# The daemon writes a 32-byte bearer token to its local data directory.
# Pass its path to every CLI call instead of putting a token in shell history.
npx cockroach-browser session list --token-file .cockroach-browser/auth-token
```

## Create the smallest useful session

A session must state its purpose, allowed origins, effects, actions, and resource ceilings. The following session can observe one documentation origin. It cannot write, upload, download, access credentials, or leave that origin.

```
{
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
}
```

## Embed the runtime

Use the SDK when the browser process belongs inside your service. Use the authenticated client when a separate daemon owns Chromium. Both surfaces return the same snapshots, evidence, and receipts.

```
import { BrowserRuntime } from "cockroach-browser";

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
await browser.close();
```


## Release status

This manual targets Cockroach Browser 0.4.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
