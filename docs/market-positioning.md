# Cockroach Browser market positioning

**Research date:** 2026-09-03

**Purpose:** operational guidance for product, documentation, launch, and sales copy. Pricing and competitor capabilities are time-sensitive and must be rechecked before publication.

## Category and target users

**Category:** a governed, local-first, multi-engine browser runtime for AI agents.

Cockroach Browser is not a new rendering engine and should not be presented as one. It routes work to Chromium, Firefox, WebKit, or an explicitly experimental lightweight provider, then adds capability negotiation, authority controls, resource enforcement, evidence, and host-owned lifecycle management.

**Primary ICP:** engineers building AI-agent platforms or operational automation that must remain self-hosted, respect data-residency constraints, limit model authority, or produce inspectable evidence.

**Secondary users:**

- data extraction and crawling teams whose DOM-oriented jobs are constrained by memory or concurrency;
- QA and developer-tool teams that need full browser fidelity plus a governed agent-facing surface;
- regulated operations teams that require explicit approvals, bounded effects, and evidence retention.

**Not the initial wedge:** consumer desktop browsing, a turnkey global proxy/CAPTCHA service, or teams whose only requirement is the cheapest hosted Chrome hour.

## Jobs to be done

1. Let an agent inspect and operate a website without inheriting ambient profiles, credentials, origins, or machine authority.
2. Select a lightweight DOM lane or a full-fidelity browser lane before launch, with unsupported actions rejected rather than silently downgraded.
3. Reuse Playwright, Puppeteer, CDP, BiDi, WebDriver, MCP, and existing browser knowledge.
4. Enforce finite RSS, CPU, duration, evidence, and action budgets across owned sessions.
5. Produce evidence and receipts that an operator can inspect after an agent acts.
6. Run locally or inside customer-controlled infrastructure with authenticated team access.
7. Supply bounded, cited project context without turning retrieved history into browser authority.

## Market table stakes

Official product pages consistently promote the following. Cockroach Browser must make these easy to find, but they are not exclusivity claims:

- Playwright, Puppeteer, or CDP compatibility;
- reliable session lifecycle and concurrency controls;
- persistent profiles and authenticated state;
- screenshots, PDFs, Markdown, and structured extraction;
- traces, recordings, live inspection, or other debugging evidence;
- MCP and model-provider integration;
- proxies, stealth, CAPTCHA handling, or clear provider integrations;
- cloud deployment, self-hosting, or both;
- one-command setup, working templates, and transparent limits.

## Competitor matrix

| Product | Primary promoted value | Delivery | Positioning implication for Cockroach Browser |
| --- | --- | --- | --- |
| [Playwright](https://playwright.dev/) | Chromium, Firefox, and WebKit through one API; auto-waiting, assertions, tracing, code generation, CLI, and MCP | Open-source local/CI framework across TypeScript, Python, Java, and .NET | Three-engine support, testing, and MCP are parity. Lead with the governed layer above Playwright. |
| [Puppeteer](https://pptr.dev/guides/what-is-puppeteer) | Chrome and Firefox automation over CDP or WebDriver BiDi; screenshots, PDFs, tracing, extensions, and SPA automation | Node library maintained by the Chrome Browser Automation team | Raw Puppeteer, CDP, and BiDi compatibility are necessary parity. |
| [Browserbase](https://www.browserbase.com/pricing) and [Stagehand](https://www.stagehand.dev/) | Cloud browser fleets, search/fetch, identity, proxies, CAPTCHA, model gateway, recordings, and self-healing AI primitives | Cloud-first infrastructure; Stagehand can also drive a local browser | Strongest all-in-one commercial competitor. Cockroach Browser is differentiated by customer-owned execution and explicit authority/evidence boundaries, not managed global scale. |
| [Browserless](https://www.browserless.io/) | Drop-in Playwright/Puppeteer, BrowserQL, MCP, profiles, stealth, CAPTCHA, proxies, replays, and live debugging | Shared cloud, private fleet, and self-hosted options | Direct competitor for browser infrastructure. Cockroach Browser needs equally fast onboarding and visible observability. |
| [Steel](https://docs.steel.dev/) | Open-source browser API with sessions, profiles, proxies, CAPTCHA, stealth, credentials, replays, and multi-language SDKs | Managed cloud or self-hosted Docker | Open source, self-hosting, and an agent browser API are parity; enforcement and proof must carry the message. |
| [Lightpanda](https://lightpanda.io/docs/) | Machine-native lightweight engine with CDP, HTTP, MCP, a native agent, and deterministic PandaScript replay | Local binary, package managers, Docker, and cloud | AI-native, MCP, and low-memory claims are not exclusive. Its [published benchmark](https://lightpanda.io/docs/core-concepts/benchmarks) includes crawling, repeated automation, and agent-task evaluation. |
| [Obscura](https://github.com/h4ckf0r0day/obscura) | Rust/V8 lightweight browser with CDP, Playwright/Puppeteer compatibility, stealth, rendering, and MCP | Apache-2.0 binaries, Docker, self-hosting, and a managed offer | Obscura is Cockroach Browser's upstream lightweight engine. Claim the pinned integration, policy, and independent measurement, not invention of the engine. See the [v0.2.1 release](https://github.com/h4ckf0r0day/obscura/releases/tag/v0.2.1). |
| [Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/) | Globally distributed headless Chrome, quick actions, crawling, AI extraction, CDP, Playwright, Puppeteer, Stagehand, MCP, live view, and human handoff | Cloudflare Workers and global edge | Sets the bar for low-friction hosted deployment and scale. It does not replace Cockroach Browser's local multi-engine governance position. |
| [Browser Use](https://github.com/browser-use/browser-use) | Autonomous browser tasks, vision, profiles, custom tools, CLI, skills, MCP, and hosted agents | MIT Python framework plus hosted cloud | A built-in agent loop is parity. Interoperate with this ecosystem rather than claiming agent-loop novelty. |

## Claim taxonomy

“Unique within the reviewed set” means that the official surfaces above did not document the same product contract on the research date. It is not a universal, legal, or patent-style claim.

| Cockroach Browser capability | Classification | Approved interpretation |
| --- | --- | --- |
| Per-action capability manifests across full and lightweight engines, with `supported`, `experimental`, and `unsupported` states and no silent fallback | **Unique within the reviewed set** | A caller can inspect whether the chosen engine supports an action before launch. |
| Origin/effect policy, exact approvals, budgets, receipts, and cited Qarinah context with memory explicitly separated from action authority | **Unique within the reviewed set** | Retrieved context can inform the agent but cannot silently expand its browser authority. |
| Build-linked lightweight proof with raw samples, hashes, a verifier, and a separately reported failing target | **Uncommon** | The scoped 30 MiB result can be recomputed from retained measurements. |
| Continuous owned-process-tree RSS/CPU/duration enforcement, sticky violations, and explicit unverified-termination state | **Uncommon** | Limits are enforced during the session and teardown uncertainty remains visible. |
| One routed contract spanning full Chromium/Firefox/WebKit and an experimental lightweight lane | **Uncommon combination** | Compatible DOM work can use the lightweight lane while visual work uses full browsers. |
| Content-addressed evidence and action receipts linked to sessions | **Uncommon** | Outcomes retain inspectable evidence and causal records. |
| Playwright, Puppeteer, CDP, BiDi, MCP, structured extraction, model gateway, Docker, profiles, authentication, multi-tenancy, and quotas | **Parity** | Present these as compatibility and production readiness, not exclusivity. |
| Mobile WebDriver/Appium adapters | **Uncommon but secondary** | Useful breadth, but not the first market wedge. |

## Approved and forbidden claims

### Approved exact claims

- **Category:** “A governed, local-first, multi-engine browser runtime for AI agents.”
- **Hero:** “Full browsers when fidelity matters. A measured 28.25 MiB non-visual lane when it does not.”
- **Measurement:** “The pinned Obscura 0.2.1 constrained non-visual fixture reached a maximum complete owned-browser-process-tree RSS of 29,622,272 bytes (28.25 MiB) across 20 measured launches and passed the 30 MiB target.”
- **Negative result:** “The separately measured 25 MiB target failed with a 29,679,616-byte maximum.”
- **Scope:** “The Node coordinator was measured separately. The result is not a whole-app, arbitrary-page, rendered-page, or full-browser memory guarantee.”
- **Routing:** “Use the lightweight lane for compatible DOM and JavaScript work, and Chromium, Firefox, or WebKit for full fidelity.”
- **Preflight:** “Unsupported actions are rejected before launch; experimental capabilities require explicit opt-in.”
- **Governance:** “Bounded sessions enforce origin, effect, approval, resource, evidence, and lifecycle controls.”
- **Proof:** “The benchmark retains raw observations, artifact hashes, and a verifier.”

The canonical measurement and its limitations are in the [proof record](./benchmarks/obscura-non-visual-2026-09-03.md).

### Forbidden claims

- “28 MB or less,” because the measured result is 28.25 MiB and MiB is not interchangeable with decimal MB.
- “The only,” “the first,” or “no other browser” for low memory, AI control, MCP, self-hosting, or multi-engine automation.
- “Every browser feature in 28 MB” or any implication that the lightweight engine has full-browser feature parity.
- “Faster,” “cheaper,” or “lighter than Chrome/Lightpanda” without an identical, same-host, pinned comparison.
- “Secure sandbox,” “complete isolation,” or “all egress is contained.” OS/container controls remain necessary for hostile content and uncovered protocols.
- “Works on every site,” “unblockable,” or “bypasses CAPTCHAs.”
- “Renderer disabled.” `rendering: "none"` is Cockroach Browser's visual-action policy, not proof that the upstream binary omitted its renderer.
- Claims that Cockroach Browser operates global regions, residential proxies, CAPTCHA solving, stealth infrastructure, or a hosted fleet when it only exposes adapter contracts.
- Customer-count, adoption, reliability, compliance, or savings claims without corresponding current evidence.

## Homepage feature order

1. Category and two-lane hero, with the exact scoped 28.25 MiB badge.
2. A runnable sixty-second quickstart and a **Verify the benchmark** call to action.
3. Lightweight DOM lane versus full Chromium/Firefox/WebKit lane.
4. Capability negotiation and fail-closed preflight.
5. Origins, effects, approvals, finite budgets, and verified teardown.
6. Playwright, Puppeteer, CDP, BiDi, MCP, and SDK compatibility.
7. Evidence, receipts, and cited Qarinah provenance.
8. Local daemon, Docker, authenticated teams, and worker deployment.
9. Concrete use cases: governed operations, agent infrastructure, DOM extraction, and cross-browser QA.
10. Reproducible proof, current limitations, and release status.

Recommended lead copy:

> **One governed browser runtime for AI agents.**
>
> Route compatible DOM work through a measured 28.25 MiB Obscura lane, fall back to Chromium, Firefox, or WebKit for full fidelity, and enforce origins, effects, approvals, resources, and evidence before the model acts.

## Distribution channels

### Product distribution

- npm package and CLI;
- signed GitHub releases with checksums, provenance, and an SBOM;
- GHCR and Docker Hub images;
- Homebrew plus Scoop or winget after signed binary releases are repeatable;
- MCP registry listing and one-command skills for Codex, Claude Code, Cursor, and comparable clients;
- runnable TypeScript, Python, and Go quickstarts;
- templates for structured extraction, user-approved form submission, evidence-backed operations, and lightweight-to-full fallback.

### Audience distribution

- GitHub releases, Discussions, issues, and a public compatibility board;
- a benchmark page with raw artifacts and exact reproduction commands;
- a concise technical paper plus shorter architecture and benchmark articles;
- Show HN and Product Hunt after installation and proof work end to end on a clean host;
- browser-automation, web-scraping, local-AI, developer-tool, and agent-framework communities;
- integration examples for Browser Use, LangChain, CrewAI, Mastra, n8n, and major MCP clients;
- direct design-partner outreach to agent-infrastructure and regulated-automation teams.

## Ninety-day launch plan

### Days 0-30: release truth and activation

- Reconcile version, capability count, benchmark results, limitations, and release commands across the README, paper, site, and package metadata.
- Make a clean-machine install, first session, benchmark verification, and uninstall repeatable.
- Resolve the native Windows full-browser launch issue or make the platform limitation prominent.
- Produce signed packages and container artifacts only after the complete release gate passes.
- Publish four runnable examples covering the primary jobs to be done.
- Measure time-to-first-success and record every failed onboarding step.

### Days 31-60: comparative evidence and integrations

- Run same-host, pinned comparisons with identical tasks and non-misleading RSS/PSS labels.
- Add a real-page compatibility corpus, concurrency runs, a long soak, fault injection, and an agent-task evaluation.
- Ship verified MCP/skill setup paths for leading coding agents.
- Publish integration examples for at least three agent frameworks.
- Recruit 5-10 design partners; report them as targets or participants only with explicit permission, never as customers by implication.

### Days 61-90: public launch and iteration

- Publish the comprehensive paper, raw results, reproduction instructions, and known limitations together.
- Cut a release candidate, repeat clean-host and cross-platform verification, then publish the stable release if gates pass.
- Launch through developer channels with the scoped proof and runnable demo as the central story.
- Maintain a public compatibility/evidence changelog and respond rapidly to reproducible failures.
- Keep a hosted service as a waitlist or roadmap item until an actual operated service, support boundary, and measured cost model exist.

Operational success measures should include clean-install success rate, median time to first verified session, benchmark reproduction rate, weekly active projects, four-week retained projects, task success by engine, orphan-process rate, resource-limit enforcement rate, and issue time to resolution.

## Pricing anchors - time-sensitive

These are market context observed on 2026-09-03, not evergreen facts. Recheck each linked page immediately before external use.

- [Browserbase](https://www.browserbase.com/pricing): Free; Developer at $20/month with 25 concurrent browsers and 100 included browser hours; Startup at $99/month with 100 concurrent browsers and 500 hours; custom Scale.
- [Browserless](https://www.browserless.io/pricing): Free with 1,000 units and two concurrent browsers; the annual-billing display showed $25/month for 20,000 units and 10 concurrency, $140 for 180,000 and 40, and $350 for 500,000 and 100. Its [unit documentation](https://docs.browserless.io/overview/unit-consumption) defines browser time as one unit per 30 seconds, plus separate proxy and CAPTCHA consumption.
- [Steel](https://steel.dev/): Launch at $0 plus usage with $30 in one-time credits; Scale at $250/month plus usage with $100 in monthly credits; enterprise custom.
- [Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/pricing/): Workers Free included 10 minutes per day and three concurrent browsers; Workers Paid included 10 browser hours per month, then $0.09 per additional hour, with separate concurrency pricing beyond the included monthly average.

Do not set or advertise hosted Cockroach Browser pricing until measured cost of service, support obligations, tenancy isolation, and capacity limits exist. The near-term commercial value is governance, private deployment, evidence, and support rather than undifferentiated browser hours. Because the repository is AGPL-3.0-or-later, decide explicitly whether the intended adoption model remains pure copyleft or adds a separately reviewed commercial license; do not leave enterprise users to guess.

## Evidence roadmap

The current lightweight proof is useful but deliberately narrow. The external evidence package should grow in this order:

1. **Release identity:** exact source, build, harness, binary, artifact, machine, and dependency identities; signed artifacts and SBOM.
2. **Correctness:** per-engine action-contract tests, parser/property tests, protocol conformance, and deterministic fixtures.
3. **Comparable performance:** same-host browser-tree RSS/PSS, CPU, latency, throughput, and coordinator overhead against exact pinned baselines.
4. **Compatibility:** at least 100 documented public pages plus deterministic SPA, frame, form, download, and authentication fixtures.
5. **Reliability:** a 24-hour soak, thousands of bounded launches, crash/hang classification, memory-growth slope, and zero unexplained owned-process orphans.
6. **Concurrency:** 1, 10, 25, 50, and 100-session results with admission behavior and resource saturation disclosed.
7. **Agent quality:** task success, cost, latency, step count, and failure taxonomy on a public benchmark and a deterministic in-repository suite.
8. **Security negatives:** SSRF, redirects, DNS rebinding, WebSockets, service workers, private networks, prompt injection, secret redaction, token scope, path traversal, persistence failure, and teardown failure.
9. **Platforms:** Windows, Linux, macOS, Docker, and supported CPU architectures, with failures published alongside passes.

The competitive evidence standard is visible in the [Obscura benchmark repository](https://github.com/h4ckf0r0day/obscura-benchmark), which includes WPT, an obstacle course, a real-world corpus, reliability, and concurrency tracks; the [Lightpanda benchmark](https://lightpanda.io/docs/core-concepts/benchmarks), which includes crawling, repeated automation, and agent tasks; and [Stagehand Evals](https://www.stagehand.dev/evals), which reports accuracy, cost, and speed. Until comparable Cockroach Browser tracks exist, describe the current result as a rigorous scoped resource proof, not overall performance leadership.
