# Obscura non-visual memory proof: 2026-09-03

This is the canonical lightweight proof record for Cockroach Browser with the reviewed Obscura 0.2.1 binary. It reports the complete owned browser-process-tree RSS for one pinned non-visual fixture and keeps the Node coordinator outside that number.

## Verdicts

| Target | Verdict | Maximum observed browser-tree RSS |
| --- | --- | ---: |
| 30 MiB | **PASS** | 29,622,272 bytes |
| 25 MiB | **FAIL** | 29,679,616 bytes |

The 30 MiB target is 31,457,280 bytes. Every measured owned-browser-tree observation stayed within it, and every required capability check passed. The exact maximum above is authoritative; it is exactly 28.25 MiB.

The 25 MiB target is 26,214,400 bytes. Every required capability check still passed, but the memory condition did not, so the combined verdict is honestly reported as a failure.

These are not whole-app memory guarantees. They do not claim that the Node coordinator, an arbitrary page, a rendered page, a persistent or attached session, or a full browser fits either target. Full browser engines normally use far more memory under realistic rendered workloads.

## Immutable artifacts

| Artifact | SHA-256 |
| --- | --- |
| `docs/benchmarks/artifacts/obscura-0.2.1-constrained-non-visual-30mib-2026-09-03-rc1.json` | `f90b31d6f5d5096300ac2722ed835db0483a76dc4d51ee85e86604a6634c0aa7` |
| `docs/benchmarks/artifacts/obscura-0.2.1-constrained-non-visual-25mib-2026-09-03-rc1.json` | `581eb93577d6b52c71e02d7e0b71914f88acd0920a6e0e06925aae0a4575d2df` |

Each JSON artifact retains all 20 measured launches and every timestamped process-tree observation: 478 in the 30 MiB run and 480 in the 25 MiB run, for 958 total. Each launch retained 23 or 24 boundary and continuously sampled observations, including the 10 required steady-state samples at 25 ms intervals.

## Reviewed identity

- Executable: `obscura.exe`, version `obscura 0.2.1`, 58,097,152 bytes
- Executable SHA-256: `5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221`
- Git base commit: `deb6c25b4c0bc1927a631e3b062464b4f4cc2775`
- Working tree: dirty; the base commit alone is not the tested source identity
- Source-tree SHA-256: `fb0c4597e39f319dd9b6f3bab02777c395e9d8d84906981bf939a39b470e7279`
- Runtime-build SHA-256: `6738efa4000ba482db83c9dc95ba2f21caed31de96f30dcd342e5dc722d86025`
- Benchmark-harness SHA-256: `08a5294f2d446765f712b93c9bfaaca010b1d043ded638d1f4f57b5038c97e86`
- Source scope: runtime, schemas, benchmark/package/build configuration, and tests; generated documentation and benchmark artifacts are excluded
- Identity normalization: relative paths use forward slashes, and text line endings are normalized to LF before hashing

The recorded machine was Windows `win32`/`x64`, release `10.0.26200`, with 16 logical CPUs, an AMD Ryzen 7 4800H, 16,557,887,488 bytes of total memory, and Node `v24.15.0`.

## Method

- Resource profile: `constrained`
- Runs per target: 1 warmup plus 20 measured launches
- Workload: one runtime-owned loopback CDP server and one non-visual data-URL document
- Operations: connect, JavaScript evaluation, DOM query, text input, and HTMLElement click dispatch
- Required checks: connect, JavaScript, DOM, forms, screenshot preflight denial, and teardown; every check passed in every measured launch
- Measurement: aggregate RSS for the complete runtime-owned browser process tree from spawn through startup, CDP connection, workload, settle, and shutdown preparation
- Sampling: 10 explicit steady-state samples at 25 ms intervals, plus boundary and continuous observations; 23 or 24 observations were retained per measured launch, 958 across both target runs
- Timing bounds: 15,000 ms startup, 10,000 ms action, 5,000 ms teardown, and 500 ms settle
- Target rule: every owned-browser-tree RSS observation must be at or below the target and every required check must pass
- Energy: unavailable; no calibrated platform energy counter was present, and CPU time is not reported as watts

The Node coordinator memory is measured and reported separately from the owned browser-process-tree RSS.

`renderingPolicy: "visual-actions-denied"` records Cockroach Browser's screenshot preflight policy only. It does not assert that the selected engine exposes or received a renderer-disable launch switch, and it does not assert any other renderer state.

## Distributions

| Target | Minimum | Median | p95 | Maximum | Required capabilities |
| --- | ---: | ---: | ---: | ---: | --- |
| 30 MiB | 28,893,184 bytes | 29,347,840 bytes | 29,569,024 bytes | 29,622,272 bytes | All pass |
| 25 MiB | 28,831,744 bytes | 29,323,264 bytes | 29,634,560 bytes | 29,679,616 bytes | All pass |

The distribution values summarize each launch's peak owned-browser-tree RSS. The immutable artifacts remain the source of truth for every individual observation, conformance result, timing, coordinator measurement, and teardown record.

## Verification and reproduction

Verify the checked-in artifacts, their narrative bindings, and the current source/build identity with:

```powershell
npm run verify:lightweight-proof
```

To repeat the benchmark, build the same source identity, use the reviewed executable digest above, and run the harness with `--implementation obscura --resource-profile constrained --warmup 1 --iterations 20 --resource-samples 10 --resource-sample-interval-ms 25`. Run each target independently and preserve the non-zero exit from the failing target after its JSON report is written. A new run is new evidence and must not overwrite these immutable artifacts.

The un-suffixed September 3 JSON artifacts and the [September 2 five-run record](./obscura-no-render-2026-09-02.md) remain historical evidence and are superseded by this release-candidate record.
