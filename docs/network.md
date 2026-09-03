# Network controls

Route browser HTTP(S) deliberately, and add deployment isolation for hostile content.

Bounded contexts check intercepted HTTP(S) navigation and subresource requests against the session origin policy. Public adapters block loopback and private-network targets by default, but application routing is not a complete protocol sandbox.

Public manual: https://cockroachbrowser.com/docs/network/

## Start from an allowlist

List exact HTTPS origins whenever possible. Redirects and intercepted HTTP(S) subresources are re-evaluated, so an admitted start URL cannot silently widen those routed requests. Denied origins take precedence. Runtime-owned full-engine bounded contexts also validate WebSocket handshakes and block service workers in balanced and lean profiles. Balanced preserves ordinary images, media, and fonts, while lean additionally blocks those three asset classes.

These controls do not contain WebRTC/STUN/TURN/UDP, WebTransport/QUIC, attached CDP, lightweight-engine WebSockets, or the unrestricted raw Playwright and Puppeteer operator lane. Use an OS, container, firewall, or equivalent egress boundary when hostile content requires complete protocol isolation.

## Private networks require an owned deployment decision

The public browser adapter rejects loopback, link-local, and private-network destinations. A deployment owner may opt in to a specific internal workflow with allowPrivateNetwork. Never expose that session to untrusted callers.

## Proxies are supplied, not discovered

A session can use an operator-provided proxy. Usernames and passwords are secret references resolved by the host. The runtime does not scan local browser settings, discover credentials, rotate identities, or present proxy use as access-control bypass.

## Intercept only exact-origin requests

Network interception is disabled unless allowNetworkInterception is explicit. A rule matches one already admitted origin, a bounded pathname glob, an explicit method set, and optional resource types. It can abort a request or return a static response. It cannot redirect, inject credentials, discover cookies, or widen the session origin list.

```
await browser.act(session.id, {
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
      body: "{\"releases\":[]}"
    }
  },
  purpose: "Install a deterministic response for the reviewed test"
});
```

## Put byte ceilings around fixtures

maxNetworkRules limits active rules, maxRouteFulfillBytes limits one static body, and maxInterceptedBytes limits cumulative fulfilled bytes. Route listings expose body size and digest, not response content. Use this for deterministic tests and deployment-owned fixtures, never to bypass authorization or site controls.

## Inspect and export redacted observations

network.inspect filters the current session's bounded request observations by method, status, resource type, tab, and limit. network.export emits JSON, NDJSON, or a bounded HAR-shaped document. Authorization headers, cookies, credentials, query secrets, and response bodies are not included.

```
npx cockroach-browser network \
  --session "$SESSION_ID" \
  --method GET \
  --limit 100 \
  --token-file .cockroach-browser/auth-token

npx cockroach-browser network export \
  --session "$SESSION_ID" \
  --format json \
  --token-file .cockroach-browser/auth-token > ./artifacts/network.json
```

## Remote workers require TLS

The daemon binds to localhost by default. Remote binding requires an explicit setting, TLS certificate and key, bearer authentication, and a CORS allowlist. Public unauthenticated server binding is not supported.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
