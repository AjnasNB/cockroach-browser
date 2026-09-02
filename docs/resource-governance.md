# Browser resource governance

Cockroach Browser measures the process tree it launches, exposes the result through the session API, CLI, dashboard, and Prometheus, and fails closed when a periodically observed ceiling is exceeded.

## Configure a session

```json
{
  "purpose": "Inspect a documentation site with a lean one-tab browser",
  "engine": "chromium",
  "performanceProfile": "lean",
  "policy": {
    "allowedOrigins": ["https://example.com"],
    "budget": {
      "maxTabs": 1,
      "maxProcessRssBytes": 536870912,
      "maxProcessCpuTimeMs": 900000
    }
  }
}
```

`balanced` preserves ordinary images, media, fonts, and service workers. `lean` blocks those four expensive surfaces while retaining HTML, CSS, JavaScript, forms, frames, semantic snapshots, screenshots of the resulting page, and policy-evaluated interaction. Use balanced for visual fidelity and lean for DOM-oriented automation. WebKit can send video range-request headers to an origin before Playwright aborts the response, so the benchmark separates origin-offered bytes from browser-received resource bytes.

## Inspect usage

```powershell
cockroach-browser session resources --id SESSION_ID --token-file .cockroach-browser/auth-token
```

The authenticated `GET /v1/sessions/{id}/resources` route returns current and peak aggregate RSS, cumulative CPU time, process count, configured ceilings, sample time, ownership, and limit state. `/v1/metrics` exports label-free aggregate gauges so session IDs, actors, purposes, and failure reasons do not become Prometheus labels.

An attached CDP browser is customer-owned. Its full process tree cannot be attributed or terminated safely, so Cockroach Browser reports resource data as unavailable instead of reporting a false zero. Persistent headed sessions are also marked unavailable until Playwright exposes a portable owned-process handle for that launch mode.

## Reproduce the benchmark

```powershell
npm run benchmark:resources -- --engines chromium,firefox,webkit --profiles balanced,lean --warmup 1 --iterations 5 --output output/resource-benchmarks/local.json
```

The ignored JSON artifact records browser-tree RSS/CPU/process count, Node coordinator memory/CPU, launch and action latency, resource-sampler overhead, browser-received resource bytes, origin-offered bytes and request counts, evidence storage, machine information, and medians/p95. Energy remains explicitly unavailable unless a calibrated platform energy counter is added; CPU time is not watts.

Compare base and candidate commits on the same idle machine. Treat a change as a regression only when both the relative and absolute threshold are crossed: 20% and 32 MiB for median peak RSS, 25% and 250 ms for wall time, or 25% and 500 ms for CPU time. Use at least 20 measured iterations for a release decision.

## Why 20 MiB is not a viable browser target

On the current Windows development host, a fresh Node process alone is about 32 MiB RSS. A real one-page headless browser process tree is substantially larger. The automated resource E2E test deliberately configures 20 MiB and verifies that session creation returns `PROCESS_RSS_BUDGET_EXCEEDED`; it never claims the browser ran inside that amount.

Reasonable starting ceilings for the pinned local fixture are 512 MiB for lean Chromium/WebKit, 768 MiB for lean Firefox, and 1 GiB for balanced sessions. Replace these starting points with a ceiling derived from the deployment's measured p95: round up `max(p95 × 1.25, p95 + 64 MiB)` to the next 64 MiB.

## Enforcement semantics

- RSS is the conservative sum of resident memory across the owned process tree. Shared pages may be counted more than once.
- CPU is cumulative process CPU time, not utilization percentage or energy.
- Windows defaults to a 10-second sample interval because starting PowerShell/CIM for every sample is costly; POSIX defaults to five seconds. Near-simultaneous sessions share one cached host process inventory, and fresh per-session samples are reused at action boundaries.
- Polling can miss short spikes and CPU from a renderer that exits between samples. A detected breach marks the session failed and closes its owned browser server.
- This is fail-closed runtime telemetry, not a real-time kernel boundary. Use Linux cgroup/container limits or Windows Job Objects when a hard memory/CPU boundary is required.

The included Compose service applies a hard container memory/CPU/PID envelope. Tune `COCKROACH_BROWSER_CONTAINER_MEMORY_LIMIT`, `COCKROACH_BROWSER_CONTAINER_CPU_LIMIT`, and `COCKROACH_BROWSER_CONTAINER_PID_LIMIT` from measured workloads; do not use a 20 MiB container limit for a real browser.
