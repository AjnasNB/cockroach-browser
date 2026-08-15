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
docker build -t cockroach-browser:0.4.0 .
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --shm-size 512m \
  --tmpfs /data \
  -p 127.0.0.1:43110:43111 \
  cockroach-browser:0.4.0
```

## Remote worker

Remote binding requires TLS and bearer authentication. Place the worker behind service identity where possible. Do not expose an unauthenticated daemon to the public internet. Keep browser profiles isolated by deployment and owner.

## OpenAPI, metrics, and activity

Authenticated operators can inspect /v1/openapi.json, scrape Prometheus text from /v1/metrics, poll /v1/activity, or subscribe to /v1/activity/stream. The activity surface is bounded and actor-filtered; it is not a raw browser telemetry dump.

## Team and worker operation

Embed TeamSessionStore to persist owner, viewer, and operator roles with revocation. Use BrowserWorkerPool to choose healthy authenticated workers by capacity, weight, and explicit tags. Keep profile directories local to their owning worker.

## Release verification

Build on Node 22, 24, and 26; run runtime and browser tests; verify the packed npm consumer; audit runtime dependencies; validate the website; inspect the tarball; and match the npm artifact to the reviewed Git commit before publishing.


## Release status

This manual targets Cockroach Browser 0.4.0. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
