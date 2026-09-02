# Deployment

Local by default. Remote only when identity, TLS, and ownership are explicit.

Run the TypeScript runtime in-process, use the authenticated localhost daemon, place it in a container, or connect an SDK client to an explicitly configured remote worker.

Public manual: https://cockroachbrowser.com/docs/deployment/

## Local daemon

Use the CLI for a single-user workstation or development environment. The daemon creates its own token file and serves only on loopback unless you explicitly configure a remote deployment.

```
npx cockroach-browser serve --host 127.0.0.1 --port 43110

# The daemon writes a 32-byte bearer token to its local data directory.
# Pass its path to every CLI call instead of putting a token in shell history.
npx cockroach-browser session list --token-file .cockroach-browser/auth-token
```

## Container

Pin the package and browser version, use a read-only root filesystem, mount only the data and artifact paths the worker needs, and bind the published port to loopback or a private service network.

```
docker build -t cockroach-browser:0.5.0-rc.1 .
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --shm-size 512m \
  --tmpfs /data \
  -p 127.0.0.1:43110:43111 \
  cockroach-browser:0.5.0-rc.1
```

## Remote worker

Remote binding requires TLS and bearer authentication. Place the worker behind service identity where possible. Do not expose an unauthenticated daemon to the public internet. Keep browser profiles isolated by deployment and owner.

## OpenAPI, metrics, and activity

Any authenticated identity can inspect the relative-base /v1/openapi.json route index. Global /v1/health, Prometheus text from /v1/metrics, and /v1/evidence/verify require the daemon administrator token. Actor tokens can poll /v1/activity or subscribe to /v1/activity/stream only for sessions they may view. OpenAPI indexes every implemented daemon method/path with unique operation IDs and response declarations, but grants no authority by itself. The activity surface is bounded and actor-filtered; it is not a raw browser telemetry dump.

## Team and worker operation

Actor-scoped bearer tokens require TeamSessionStore; daemon startup fails closed without it. The administrator token and every actor token must be unique or startup fails with AUTH_TOKEN_COLLISION. Actor-token session creation additionally requires a host-owned actorSessionFactory that derives authoritative session input from individually reviewed request fields and never spreads caller JSON. The server supplies the authenticated actor and claims the session before exposure, closing it if the ownership claim fails. Access mutations replace the in-memory map only after durable persistence succeeds.

Set daemon admission with BrowserServerOptions.maxSessions (default 32) and maxSessionsPerActor (default 8). The concurrency-safe reservation path counts all non-closed sessions plus pending creates; limit responses are HTTP 429 with SESSION_GLOBAL_LIMIT_EXCEEDED or SESSION_ACTOR_LIMIT_EXCEEDED. maxRequestBytes defaults to 1,048,576 bytes and accepts integers from 1,024 through 16,777,216 bytes.

Use BrowserWorkerPool to choose healthy authenticated workers by capacity, weight, and explicit tags. Keep profile directories local to their owning worker.

## Release verification

Build on Node 22, 24, and 26; run runtime and browser tests; verify the packed npm consumer; audit runtime dependencies; validate the website; inspect the tarball; and match the npm artifact to the reviewed Git commit before publishing.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
