# Historical Obscura non-visual memory proof: 2026-09-02

This five-run record is superseded by the [canonical September 3, 2026 proof](./obscura-non-visual-2026-09-03.md). It remains unchanged where values describe its historical artifacts. It is evidence for one pinned binary and fixture, not a product-wide memory guarantee.

## Subject and method

- Obscura version: `obscura 0.2.1`
- Executable SHA-256: `5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221`
- Executable size: 58,097,152 bytes
- Host reported by the artifact: `win32` release `10.0.26200`, 16 logical CPUs, Node `v24.15.0`
- Cockroach Browser checkout base: `deb6c25b4c0bc1927a631e3b062464b4f4cc2775`; the proof ran from a modified source worktree, so the base commit alone is not a complete source identifier
- Profile: `constrained`
- Cockroach Browser visual-action policy: `rendering: "none"`; the artifacts did not verify an engine renderer switch
- Runs per target: one warmup plus five measured runs
- Browser measurement: aggregate RSS for the complete runtime-owned browser process tree, sampled from spawn through startup, CDP connection, workload, settle, and shutdown preparation
- Coordinator measurement: reported separately and excluded from browser-tree RSS
- Fixture: one data-URL document exercising CDP connection, JavaScript evaluation, DOM query, text-input mutation, and HTMLElement click dispatch
- Required conformance: connect, JavaScript, DOM, and forms
- Screenshot result: unsupported and rejected by Cockroach Browser capability preflight, as required by the visual-action policy

## Verdicts

| Target | Result | Maximum browser-tree RSS | Required checks | Coordinator p95 peak RSS |
| --- | --- | ---: | --- | ---: |
| 30 MiB (31,457,280 bytes) | **Pass** | 29,298,688 bytes (27.941 MiB) | All passed | 112,218,112 bytes (107.020 MiB) |
| 25 MiB (26,214,400 bytes) | **Fail** | 29,523,968 bytes (28.156 MiB) | All passed | 110,841,856 bytes (105.707 MiB) |

Passing 30 MiB means every measured browser-tree sample stayed at or below 30 MiB and every required conformance check passed. The 25 MiB run failed solely because the browser tree exceeded that target. Neither result says that the Node coordinator, the whole Cockroach Browser application, a rendered Obscura session, or arbitrary sites fit within 30 MiB.

Obscura upstream has added rendering and screenshot functionality. In this historical fixture, `rendering: "none"` denotes Cockroach Browser's visual-action preflight policy; it does not assert that the selected binary exposed or received a renderer-disable launch switch. The workload did not exercise rendered-page capture.

## Reproduction commands

These commands match the recorded benchmark parameters. Use the reviewed binary whose digest is shown above; the example path is the exact path captured in the artifacts.

```powershell
npm run build

node scripts/benchmark-lightweight.mjs --implementation obscura --executable 'D:\skill box\.tmp\obscura-v0.2.1-eval\verified-bin\obscura.exe' --sha256 5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221 --resource-profile constrained --warmup 1 --iterations 5 --target-mib 30 --output output/resource-benchmarks/final-proof-obscura-constrained-30mib-20260902.json

node scripts/benchmark-lightweight.mjs --implementation obscura --executable 'D:\skill box\.tmp\obscura-v0.2.1-eval\verified-bin\obscura.exe' --sha256 5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221 --resource-profile constrained --warmup 1 --iterations 5 --target-mib 25 --output output/resource-benchmarks/final-proof-obscura-constrained-25mib-20260902.json
```

The second command is expected to write its JSON report and exit with code `2` because the declared target is not met.

## Raw artifact identity

`output/` is intentionally ignored by Git. A reviewer with the proof worktree can verify the raw files without treating them as release assets:

| Local artifact | SHA-256 |
| --- | --- |
| `output/resource-benchmarks/final-proof-obscura-constrained-30mib-20260902.json` | `f1dc59f761a3be80434ae61dacd49f284581a04d3eb7e080c06adf371cb74efa` |
| `output/resource-benchmarks/final-proof-obscura-constrained-25mib-20260902.json` | `6de15ba47e38c8f438a1ab8ae137fe9f44ace8a287baabfcefce97d15f06520c` |

For a release decision, repeat on the target deployment hardware with at least 20 measured iterations and compare an unchanged baseline and candidate under the same idle-host conditions.
