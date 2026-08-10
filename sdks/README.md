# Cockroach Browser HTTP SDKs

These dependency-light clients call the authenticated Cockroach Browser daemon. Each SDK exposes convenience methods for health, capabilities, sessions, actions, batches, and snapshots plus a generic request method for the complete HTTP route surface.

| Language | Package source | Runtime |
|---|---|---|
| Python | `python/cockroach_browser` | Python 3.10+ standard library |
| Java | `java/src/main/java/io/cockroach/browser` | Java 11+ |
| .NET / C# | `dotnet/CockroachBrowser` | .NET 8+ |
| Ruby | `ruby/lib/cockroach_browser.rb` | Ruby 3.1+ standard library |
| Go | `go/cockroachbrowser` | Go 1.22+ standard library |

All clients default to `http://127.0.0.1:43110`, require an explicit bearer token, preserve server error bodies, and accept a caller-owned timeout.

