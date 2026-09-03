# Browser resource governance

Cockroach Browser periodically measures PID-observable runtime-owned browser-server and lightweight process trees, exposes results through the session API, CLI, dashboard, and Prometheus, and makes the session terminal when a sampled ceiling is exceeded or telemetry disappears. Attached CDP and persistent headed contexts explicitly report process enforcement as unavailable.

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

`balanced` preserves ordinary images, media, and fonts. `lean` additionally blocks those three expensive asset classes while retaining HTML, CSS, JavaScript, forms, frames, semantic snapshots, screenshots of the resulting page, and policy-evaluated interaction. Bounded contexts block service workers in both profiles so that surface cannot bypass intercepted HTTP(S) origin routing; raw Playwright and Puppeteer stay on the unrestricted operator lane. This routing is not a complete protocol sandbox and does not contain WebRTC/STUN/TURN/UDP, WebTransport/QUIC, attached CDP, or lightweight-engine WebSockets. Use balanced for visual fidelity and lean for DOM-oriented automation. WebKit can send video range-request headers to an origin before Playwright aborts the response, so the benchmark separates origin-offered bytes from browser-received resource bytes.

## Inspect usage

```powershell
cockroach-browser session resources --id SESSION_ID --token-file .cockroach-browser/auth-token
```

The authenticated `GET /v1/sessions/{id}/resources` route returns current and peak aggregate RSS, cumulative CPU time, process count, configured ceilings, sample time, ownership, and limit state for an authorized session. Administrator-only `/v1/metrics` exports label-free aggregate gauges so session IDs, actors, purposes, and failure reasons do not become Prometheus labels.

An attached CDP browser is customer-owned. Its full process tree cannot be attributed or terminated safely, so Cockroach Browser reports resource data as unavailable instead of reporting a false zero. Persistent headed sessions are also marked unavailable until Playwright exposes a portable owned-process handle for that launch mode.

## Reproduce the benchmark

```powershell
npm run benchmark:resources -- --engines chromium,firefox,webkit --profiles balanced,lean --warmup 1 --iterations 5 --output output/resource-benchmarks/local.json
```

The ignored JSON artifact records browser-tree RSS/CPU/process count, Node coordinator memory/CPU, launch and action latency, resource-sampler overhead, browser-received resource bytes, origin-offered bytes and request counts, evidence storage, machine information, and medians/p95. Energy remains explicitly unavailable unless a calibrated platform energy counter is added; CPU time is not watts.

Compare base and candidate commits on the same idle machine. Treat a change as a regression only when both the relative and absolute threshold are crossed: 20% and 32 MiB for median peak RSS, 25% and 250 ms for wall time, or 25% and 500 ms for CPU time. Use at least 20 measured iterations for a release decision.

An independent lightweight CDP binary has a separate, stricter harness:

```powershell
npm run benchmark:lightweight -- --implementation obscura --executable C:/reviewed/obscura.exe --sha256 EXPECTED_SHA256 --resource-profile constrained --warmup 1 --iterations 20 --resource-samples 10 --resource-sample-interval-ms 25 --target-mib 30 --output output/resource-benchmarks/obscura.json
```

The `--sha256` pin is optional for local experimentation and recommended for reviewed or repeatable evidence; when supplied, the harness verifies it before execution. The harness starts a new owned loopback process for each run, exercises CDP connection, JavaScript, DOM, input, and click behavior, verifies that the visual-action policy rejects screenshot capture before dispatch, confirms owned-process exit and bounded CDP transport disposal during teardown, and retains complete browser-tree RSS/CPU/process observations from spawn through shutdown. Each measured launch contains ten explicit steady-state samples at 25 ms intervals plus boundary and continuous observations. Node coordinator memory is disclosed separately. Exit code `2` means the declared target or required conformance set was not met. A result is never relabelled as passing by excluding a child process, raising the target after measurement, or counting a killed browser as success.

The [September 3, 2026 canonical proof record](./benchmarks/obscura-non-visual-2026-09-03.md) contains the pinned executable digest, source/build/harness identities, complete methodology, verdicts, distributions, coordinator disclosure, and hashes of the tracked raw JSON artifacts. It records one warmup plus 20 measured launches per target. The [September 2 record](./benchmarks/obscura-no-render-2026-09-02.md) is retained only as superseded historical evidence.

## What a low-memory target means

The automated resource E2E test deliberately configures 20 MiB and verifies that session creation returns `PROCESS_RSS_BUDGET_EXCEEDED`; it never claims the browser ran inside that amount.

The September 3 release-candidate proof used the pinned Obscura 0.2.1 binary, one non-visual data-URL fixture, the constrained profile, one warmup, and 20 measured launches per target. The 30 MiB target passed with a maximum complete owned-browser-tree RSS of 29,622,272 bytes; median was 29,347,840 bytes, p95 was 29,569,024 bytes, and minimum was 28,893,184 bytes. The 25 MiB target failed with a maximum of 29,679,616 bytes; median was 29,323,264 bytes, p95 was 29,634,560 bytes, and minimum was 28,831,744 bytes. Required CDP connection, JavaScript, DOM, forms, screenshot preflight denial, and teardown checks passed in every measured launch.

Coordinator RSS is disclosed separately and is not hidden inside the browser-tree number. The whole application is therefore not demonstrated at or below 30 MiB. The `rendering: "none"` selection is a Cockroach Browser visual-action preflight policy and does not assert that the selected engine exposes or received a renderer-disable switch. A 30 MiB result may be reported only with the named binary, digest, host, workload, policy, process-tree definition, run count, sampling method, and conformance result. It cannot be generalized to arbitrary or rendered pages, Chromium, Firefox, WebKit, Lightpanda, the Node coordinator, or the full Cockroach Browser process set; full engines use far more memory.

Published upstream numbers for Obscura and Lightpanda use different versions, hosts, workloads, concurrency, and memory definitions. Treat them as upstream evidence, not as interchangeable Cockroach Browser measurements.

Reasonable starting ceilings for the pinned local fixture are 512 MiB for lean Chromium/WebKit, 768 MiB for lean Firefox, and 1 GiB for balanced sessions. Replace these starting points with a ceiling derived from the deployment's measured p95: round up `max(p95 × 1.25, p95 + 64 MiB)` to the next 64 MiB.

## Enforcement semantics

- RSS is the conservative sum of resident memory across the owned process tree. Shared pages may be counted more than once.
- CPU is cumulative process CPU time, not utilization percentage or energy.
- `resourceSampleIntervalMs` accepts integers from 250 through 60,000 ms. Windows defaults to ten seconds because starting PowerShell/CIM for every sample is costly; POSIX defaults to five seconds. Near-simultaneous sessions share one cached host process inventory, and fresh per-session samples are reused at action boundaries.
- Polling can miss short spikes and CPU from a renderer that exits between samples. A detected breach, duration expiry, or telemetry loss becomes a sticky terminal session error and starts process-first teardown independently of the next action.
- If owned-process termination cannot be verified, the runtime returns `TERMINATION_UNVERIFIED` and retains the failed session and any persistent-profile writer lock for an explicit close retry.
- This is fail-closed runtime telemetry, not a real-time kernel boundary. Use Linux cgroup/container limits or Windows Job Objects when a hard memory/CPU boundary is required.

The included Compose service applies a hard container memory/CPU/PID envelope. Tune `COCKROACH_BROWSER_CONTAINER_MEMORY_LIMIT`, `COCKROACH_BROWSER_CONTAINER_CPU_LIMIT`, and `COCKROACH_BROWSER_CONTAINER_PID_LIMIT` from measured workloads; do not use a 20 MiB container limit for a real browser.
