const menuButton = document.querySelector("[data-menu]");
const menu = document.querySelector("[data-top-nav]");

menuButton?.addEventListener("click", () => {
  const open = menu?.dataset.open !== "true";
  if (menu) menu.dataset.open = String(open);
  menuButton.setAttribute("aria-expanded", String(open));
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const selector = button.getAttribute("data-copy");
    const code = selector ? document.querySelector(selector) : null;
    if (!(code instanceof HTMLElement)) return;
    await navigator.clipboard.writeText(code.innerText);
    const old = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = old;
    }, 1200);
  });
});

const filterButtons = [...document.querySelectorAll("[data-cap-filter]")];
const capabilityCards = [...document.querySelectorAll("[data-capability]")];
const capabilitySearch = document.querySelector("[data-cap-search]");
const capabilityCount = document.querySelector("[data-cap-count]");
let activeFilter = "all";

function filterCapabilities() {
  const query = capabilitySearch instanceof HTMLInputElement
    ? capabilitySearch.value.trim().toLowerCase()
    : "";
  let shown = 0;
  capabilityCards.forEach((card) => {
    const status = card.getAttribute("data-status");
    const haystack = card.textContent?.toLowerCase() ?? "";
    const visible = (activeFilter === "all" || status === activeFilter) && (!query || haystack.includes(query));
    card.hidden = !visible;
    if (visible) shown += 1;
  });
  if (capabilityCount) capabilityCount.textContent = `${shown} capabilities shown`;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.getAttribute("data-cap-filter") ?? "all";
    filterButtons.forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    filterCapabilities();
  });
});

capabilitySearch?.addEventListener("input", filterCapabilities);

const terminalOutput = document.querySelector("[data-terminal-output]");
if (terminalOutput) {
  const lines = [
    '<span class="prompt">$</span> npx cockroach-browser doctor',
    '{ "node": "v24", "chromiumReady": true }',
    '<span class="prompt">$</span> cockroach-browser serve',
    '{ "host": "127.0.0.1", "auth": "token-file" }',
    '<span class="prompt">$</span> cockroach-browser snapshot --session release-review',
    '{ "refs": 42, "challenge": false, "receipt": "sha256:..." }'
  ];
  let index = 0;
  const render = () => {
    terminalOutput.innerHTML = lines.slice(0, index + 1).join("\n");
    index += 1;
    if (index < lines.length) window.setTimeout(render, 220);
  };
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) render();
  else terminalOutput.innerHTML = lines.join("\n");
}
