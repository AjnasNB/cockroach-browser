# Headless browser compatibility

This is the maintained, practical headless-browser landscape, not a claim that every abandoned wrapper on every package registry is embedded in Cockroach Browser.

## Browser engines and device surfaces

| Surface | Cockroach Browser route | Status |
|---|---|---|
| Chromium / Chrome / Edge | Bounded Playwright runtime, raw Playwright, raw Puppeteer, CDP, system/custom executable discovery | Native |
| Firefox | Bounded and raw Playwright; raw Puppeteer/BiDi where upstream supports it | Native |
| WebKit | Bounded and raw Playwright | Native |
| Safari on macOS | W3C WebDriver endpoint supplied by the operator | Adapter |
| Android Chrome / WebView | W3C WebDriver or Appium endpoint supplied by the operator | Adapter |
| iOS Safari / WebView | W3C WebDriver or Appium endpoint supplied by the operator | Adapter |
| Remote browser farms | Authenticated fleet provider declaring engines, regions, TTL, proxy classes, and live-view capability | Adapter |

Playwright documents Chromium, Firefox, WebKit, Chrome, and Edge channels in its [browser guide](https://playwright.dev/docs/browsers). Puppeteer documents Chrome and Firefox over CDP and WebDriver BiDi in [What is Puppeteer?](https://pptr.dev/guides/what-is-puppeteer). Selenium documents its cross-browser WebDriver implementations in [Supported Browsers](https://www.selenium.dev/documentation/webdriver/browsers/) and the event-driven BiDi surface in [WebDriver BiDi](https://www.selenium.dev/documentation/webdriver/bidi/).

## Main automation projects

| Project or family | Primary role | Cockroach Browser relationship |
|---|---|---|
| Playwright | Cross-engine browser automation and test runner | Complete pinned API export plus bounded runtime |
| Puppeteer Core | Chrome/Firefox automation, CDP/BiDi, profiling | Complete pinned API export |
| Selenium WebDriver / Grid | Cross-language W3C automation and distributed execution | WebDriver and BiDi clients; operator supplies endpoint |
| WebdriverIO | JavaScript WebDriver/BiDi test and automation framework | Compatible through external WebDriver endpoints; not embedded |
| Cypress | Browser-focused application testing | Alternative test runner; not embedded |
| chromedp | Go CDP automation | Alternative CDP client; Cockroach exposes raw CDP and a Go daemon SDK |
| Rod | Go CDP automation with waits, frames, shadow DOM, and hijacking | Alternative CDP client; not embedded ([Rod](https://github.com/go-rod/rod)) |
| Browserless | Hosted/self-hosted remote browser infrastructure | Connect through explicit CDP or fleet provider; service not bundled |
| Splash | Scriptable rendering service | Specialized remote renderer; not embedded |
| HtmlUnit | JVM browser simulation without a full graphical engine | Specialized DOM/browser simulator; not embedded |
| Ferrum | Ruby CDP automation | Alternative CDP client; Cockroach supplies a Ruby daemon SDK |
| Taiko | JavaScript Chromium automation | Alternative Chromium harness; not embedded |
| PhantomJS / Zombie.js | Historical headless/simulated-browser projects | Legacy only; not selected for the maintained runtime |

## Feature coverage

Cockroach Browser exposes two deliberately separate layers:

- The raw layer preserves complete pinned Playwright and Puppeteer APIs, Playwright Test/codegen, CDP, BiDi, and WebDriver/Appium transports.
- The bounded agent layer adds origin/effect policy, exact approvals, finite budgets, semantic references, evidence, receipts, challenges, team access, jobs, MCP, SDKs, and a model-driven agent loop.

The bounded runtime currently covers navigation, tabs/popups, forms, keyboard, mouse, drag/drop, open shadow DOM, same-origin frames, JavaScript under policy, cookies/storage/state, uploads/downloads, dialogs, network inspection and routing, screenshots, PDF on Chromium, traces, HAR, video, audits, visual comparison, profiles, proxies, emulation, and Chromium/Firefox/WebKit execution. Advanced unrestricted objects such as arbitrary handles, raw workers, every protocol command, browser extensions, CPU profiles, heap snapshots, and screencasting stay on the raw operator layer rather than being disguised as safe agent actions.

## Honest boundaries

- A local Windows or Linux installation does not become a real macOS Safari or iOS device. Those require an operator-owned Apple host or device provider.
- Cockroach Browser does not operate a proxy network, CAPTCHA bypass, residential identity pool, or hosted browser fleet.
- Playwright, Puppeteer, Selenium, Cypress, and the language-specific CDP clients are different harnesses over overlapping browser engines. Copying every wrapper would add dependency and security cost without adding engine capability.
- “All headless features” means the pinned upstream raw APIs plus the documented bounded actions and adapters. The machine-readable capability registry is the release contract.
