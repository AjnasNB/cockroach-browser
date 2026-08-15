# Operator runtime

Discover, route, observe, and share browser work without sharing the machine.

Cockroach Browser includes the control surfaces needed to operate one local browser or a reviewed pool of authenticated workers while keeping every session owner, action, and artifact explicit.

Public manual: https://cockroachbrowser.com/docs/operator-runtime/

## Inspect browser and daemon state

browser discover reports installed compatible browsers. doctor verifies Node, Chromium, the data root, and local service readiness. The authenticated daemon publishes /v1/health, /v1/openapi.json, and Prometheus text at /v1/metrics.

## Follow the activity stream

/v1/activity returns a bounded filtered ledger. /v1/activity/stream emits the same lifecycle records over server-sent events. Actor-scoped tokens see only sessions for which they have viewer access; the administrator token remains local deployment authority.

```
cockroach-browser activity --session "$SESSION_ID" --limit 200 \
  --token-file .cockroach-browser/auth-token
```

## See how a session moved

The navigation graph turns admitted session history into stable URL nodes and traversed edges. It is session-local, bounded by the history ceiling, and does not inspect a user's ambient browsing history.

```
cockroach-browser session graph --id "$SESSION_ID" \
  --token-file .cockroach-browser/auth-token
```

## Share control without sharing profiles

TeamSessionStore persists one owner plus revocable viewer and operator grants. Viewers can inspect; operators can use explicitly enabled action routes; owners manage access and closure. Grant generations and revocations are durable, while raw cookies and browser profiles never enter the access record.

## Route across authenticated workers

BrowserWorkerPool checks authenticated daemon health, capacity, weight, and explicit tags before creating a session. Non-loopback workers require HTTPS and strong bearer tokens. The pool does not discover public workers or accept unauthenticated endpoints.

## Clear retained runtime state deliberately

cache.clear, console.clear, and network.clear are explicit policy-evaluated actions. They clear only the authorized session's runtime state and produce receipts; they do not erase evidence already committed to the evidence ledger.


## Release status

This manual targets Cockroach Browser 0.4.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
