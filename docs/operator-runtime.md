# Operator runtime

Discover, route, observe, and share browser work without sharing the machine.

Cockroach Browser includes the control surfaces needed to operate one local browser or a reviewed pool of authenticated workers while keeping every session owner, action, and artifact explicit.

Public manual: https://cockroachbrowser.com/docs/operator-runtime/

## Inspect browser and daemon state

browser discover reports installed compatible browsers. doctor verifies Node, Chromium, the data root, and local service readiness. Any authenticated identity can read the relative-base /v1/openapi.json route index. Global /v1/health, Prometheus text at /v1/metrics, and /v1/evidence/verify require the daemon administrator token; actor tokens remain limited to actor-scoped records. The OpenAPI document indexes every implemented daemon method/path with a unique operationId and an explicit success response; it is route discovery, not an authorization grant.

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

TeamSessionStore persists one owner plus revocable viewer and operator grants. Viewers can inspect; operators can use explicitly enabled action routes; owners manage access and closure. A mutation replaces the in-memory ownership map only after durable persistence succeeds, so a failed write leaves the prior access state intact. Raw cookies and browser profiles never enter the access record.

Configuring actor-scoped bearer tokens without TeamSessionStore is a startup error. The administrator token and every actor token must be unique or startup fails with AUTH_TOKEN_COLLISION. Actor-token session creation is also disabled until the host provides actorSessionFactory. The callback must construct authoritative session input from individually reviewed request fields rather than spreading caller JSON. The server replaces the actor with the authenticated identity and claims the session in the store before returning it; claim failure closes the new session.

## Bound concurrent session admission

BrowserServerOptions.maxSessions defaults to 32 non-closed sessions for the daemon; maxSessionsPerActor defaults to 8 non-closed sessions assigned to one actor. Pending creates reserve their slots through a concurrency-safe serialized admission step, so parallel requests cannot oversubscribe either ceiling.

Ceiling rejections return HTTP 429 with stable codes: SESSION_GLOBAL_LIMIT_EXCEEDED or SESSION_ACTOR_LIMIT_EXCEEDED. Closed sessions do not count. maxRequestBytes defaults to 1,048,576 bytes and accepts only integers from 1,024 through 16,777,216 bytes.

## Route across authenticated workers

BrowserWorkerPool checks authenticated daemon health, capacity, weight, and explicit tags before creating a session. Non-loopback workers require HTTPS and strong bearer tokens. The pool does not discover public workers or accept unauthenticated endpoints.

## Clear retained runtime state deliberately

cache.clear, console.clear, and network.clear are explicit policy-evaluated actions. They clear only the authorized session's runtime state and produce receipts; they do not erase evidence already committed to the evidence ledger.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
