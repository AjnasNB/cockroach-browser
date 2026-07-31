# Operator install

One command to bootstrap. One explicit confirmation to start at login.

Generate shell completions, verify local readiness, and install a per-user loopback daemon on Windows, macOS, or Linux without sudo, administrator prompts, or public binding.

Public manual: https://cockroachbrowser.com/docs/operator-install/

## Bootstrap and probe the local runtime

cockroach-browser bootstrap checks for Node.js 22, 24, or 26, installs the pinned Chromium build only when absent, initializes the owner-scoped data directory, and starts an ephemeral authenticated loopback server long enough to verify /v1/health. Use --check-only to prohibit a browser download.

```
cockroach-browser bootstrap
cockroach-browser bootstrap --check-only
cockroach-browser doctor
```

## Generate completion scripts

The completion command writes a script to standard output and never edits a shell profile. Inspect the output, place it in your shell's normal completion directory, and keep profile ownership with the local operator.

```
# Bash
cockroach-browser completion bash > ~/.local/share/bash-completion/completions/cockroach-browser

# Zsh
cockroach-browser completion zsh > ~/.zfunc/_cockroach-browser

# PowerShell (inspect before adding it to your profile)
cockroach-browser completion powershell
```

## Install a per-user loopback daemon

The installer requires --confirm-local-owner. Windows receives a current-user Startup command that begins at the next login. macOS receives and loads a current-user LaunchAgent, and Linux receives and starts a systemd user unit. Every generated definition binds 127.0.0.1, uses the package's authenticated daemon, writes only beneath the current user's directories, and never invokes sudo or an administrative service manager.

```
# Preview the exact per-user definition path and command
cockroach-browser service status

# Install a loopback-only daemon for the current OS account
cockroach-browser service install --confirm-local-owner

# Remove only the definition created by Cockroach Browser
cockroach-browser service uninstall --confirm-local-owner
```

## Inspect before activation

Add --definition-only to write the exact generated definition without activating it. The installer refuses to overwrite or remove a file that does not carry its generated-owner marker. Uninstall targets only that exact per-user definition; it does not remove browser data, profiles, receipts, or evidence.

```
cockroach-browser service install \
  --confirm-local-owner \
  --definition-only

cockroach-browser service status
```

## Keep service authority narrow

The generated service cannot add remote binding, raw-action routes, session host configuration, profile discovery, or privilege escalation. Those remain separate trusted-host decisions. Use Maqam for consequential browser actions and retain the bearer token in the owner-scoped data directory rather than shell history.


## Release status

This manual targets Cockroach Browser 0.2.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
