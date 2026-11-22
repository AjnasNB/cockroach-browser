# Obscura lightweight proof after the dependency audit update

Measured November 21, 2026 on a GitHub-hosted Windows runner. This record accompanies the audited lockfile and the verifier’s new default artifact paths. The September release candidate report and its archived artifacts retain the original measurements.

[Hosted benchmark run](https://github.com/AjnasNB/cockroach-browser/actions/runs/44912305094) · [September release-candidate proof](obscura-non-visual-2026-09-03.md)

## Results

- 30 MiB passed. The maximum owned-browser-tree RSS was 28,459,008 bytes.
- 25 MiB failed. The maximum owned-browser-tree RSS was 28,708,864 bytes.

All required checks passed at both targets. The reports retain one warmup and 20 measured launches per target, with 10 explicit steady-state samples at 25 ms intervals. The Node coordinator memory was measured separately. The visual policy checks screenshot preflight and does not assert engine renderer state.

## Reproducibility

- Executable SHA-256 5b609fb46bc00da79e450fb0fbd34bd442e565b1394f4af95433e0b341078221
- Source-tree SHA-256 129d658d4728383947f2c541c92f43f35e6159f519e86e57ccc124cb1f82bffc
- Runtime-build SHA-256 6738efa4000ba482db83c9dc95ba2f21caed31de96f30dcd342e5dc722d86025
- Benchmark-harness SHA-256 08a5294f2d446765f712b93c9bfaaca010b1d043ded638d1f4f57b5038c97e86
- Git base 00e8196d9afdb6674786b6b966bc927b12559d9d. The runner applied the proposed verifier path changes before measuring and records the working tree as dirty.
- Host win32/x64, release 10.0.26100, 4 logical CPUs, Node v24.15.0.

- [docs/benchmarks/artifacts/obscura-0.2.1-constrained-non-visual-30mib-2026-11-21-audited.json](artifacts/obscura-0.2.1-constrained-non-visual-30mib-2026-11-21-audited.json) · SHA-256 2101c45b0dd7c1328cde410a0fc1b6c9ddbded112183569bbcc2ed49399e4c53
- [docs/benchmarks/artifacts/obscura-0.2.1-constrained-non-visual-25mib-2026-11-21-audited.json](artifacts/obscura-0.2.1-constrained-non-visual-25mib-2026-11-21-audited.json) · SHA-256 4bb049ac0fa872fe47a3ca80104cdb8f1198291ccf7f6c2ea2258354e8e9193d
