# Network boundary

The browser may render a page. It does not inherit your whole network.

Every navigation and subresource request is checked against the session's explicit origin policy. Public adapters block loopback and private-network targets by default.

Public manual: https://cockroachbrowser.com/docs/network/

## Start from an allowlist

List exact HTTPS origins whenever possible. Redirects and subresources are re-evaluated, so an admitted start URL cannot silently widen the session. Denied origins take precedence.

## Private networks require an owned deployment decision

The public browser adapter rejects loopback, link-local, and private-network destinations. A deployment owner may opt in to a specific internal workflow with allowPrivateNetwork. Never expose that session to untrusted callers.

## Proxies are supplied, not discovered

A session can use an operator-provided proxy. Usernames and passwords are secret references resolved by the host. The runtime does not scan local browser settings, discover credentials, rotate identities, or present proxy use as access-control bypass.

## Remote workers require TLS

The daemon binds to localhost by default. Remote binding requires an explicit setting, TLS certificate and key, bearer authentication, and a CORS allowlist. Public unauthenticated server binding is not supported.


## Release status

This manual targets Cockroach Browser 0.1.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
