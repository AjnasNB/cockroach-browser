# Getting started

Install once. Admit one origin. Keep every result.

Cockroach Browser gives an AI agent a real Chromium session without turning the browser into ambient authority. Start with a local daemon or embed the TypeScript runtime.

Public manual: https://cockroachbrowser.com/docs/getting-started/

## Install the package and Chromium

The package supports maintained Node.js 22, 24, and 26 releases. Chromium is explicit so package installation stays predictable and browser downloads never happen in a lifecycle script.

```
npm install --save-dev cockroach-browser
npx cockroach-browser setup
npx cockroach-browser doctor
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

This manual targets Cockroach Browser 0.1.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
