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

const engineNames = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
  obscura: "Obscura",
  lightpanda: "Lightpanda"
};

const fullEngineIds = new Set(["chromium", "firefox", "webkit"]);

document.querySelectorAll("[data-engine-picker]").forEach((picker) => {
  const choices = [...picker.querySelectorAll("[data-engine-choice]")];
  const count = picker.querySelector("[data-engine-selection-count]");
  const summary = picker.querySelector("[data-engine-selection-summary]");
  const selectFull = picker.querySelector("[data-engine-select-full]");
  const clear = picker.querySelector("[data-engine-clear]");

  function updateEngineSelection() {
    const selected = choices.filter((choice) => choice.checked).map((choice) => choice.value);
    choices.forEach((choice) => {
      choice.closest("[data-engine-choice-card]")?.classList.toggle("is-selected", choice.checked);
    });

    if (count) {
      count.textContent = selected.length === 0
        ? "No engines selected"
        : `${selected.length} ${selected.length === 1 ? "engine" : "engines"} selected`;
    }
    if (!summary) return;

    if (selected.length === 0) {
      summary.textContent = "Select one or more engine lanes to compare their declared capability boundaries.";
      return;
    }

    const selectedNames = selected.map((engine) => engineNames[engine]).join(", ");
    if (selected.includes("lightpanda")) {
      summary.textContent = `${selectedNames}: Lightpanda is available for manifest and machine preflight only. Runtime allocation stays disabled until its network-boundary conformance gate passes.`;
      return;
    }
    if (selected.includes("obscura")) {
      summary.textContent = `${selectedNames}: Obscura is an explicit experimental lane. Its 28.25 MiB result is limited to the published constrained fixture, and every selected engine is preflighted separately.`;
      return;
    }
    summary.textContent = `${selectedNames}: full rendering engines remain distinct execution lanes. Cockroach preflights every selected engine with no substitution.`;
  }

  choices.forEach((choice) => choice.addEventListener("change", updateEngineSelection));
  selectFull?.addEventListener("click", () => {
    choices.forEach((choice) => {
      choice.checked = fullEngineIds.has(choice.value);
    });
    updateEngineSelection();
  });
  clear?.addEventListener("click", () => {
    choices.forEach((choice) => {
      choice.checked = false;
    });
    updateEngineSelection();
  });
  updateEngineSelection();
});

const alternativeRows = [...document.querySelectorAll("[data-alternative]")];
const alternativeFilters = [...document.querySelectorAll("[data-alt-filter]")];
const alternativeSearch = document.querySelector("[data-alt-search]");
const alternativeCount = document.querySelector("[data-alt-count]");
const alternativeEmpty = document.querySelector("[data-alt-empty]");
let activeAlternativeFilter = "all";

function filterAlternatives() {
  const query = alternativeSearch instanceof HTMLInputElement
    ? alternativeSearch.value.trim().toLowerCase()
    : "";
  let shown = 0;
  alternativeRows.forEach((row) => {
    const category = row.getAttribute("data-category");
    const haystack = row.textContent?.toLowerCase() ?? "";
    const visible =
      (activeAlternativeFilter === "all" || category === activeAlternativeFilter) &&
      (!query || haystack.includes(query));
    row.hidden = !visible;
    if (visible) shown += 1;
  });
  if (alternativeCount) {
    alternativeCount.textContent = `${shown} ${shown === 1 ? "alternative" : "alternatives"} shown`;
  }
  if (alternativeEmpty) alternativeEmpty.hidden = shown !== 0;
}

alternativeFilters.forEach((button) => {
  button.addEventListener("click", () => {
    activeAlternativeFilter = button.getAttribute("data-alt-filter") ?? "all";
    alternativeFilters.forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    filterAlternatives();
  });
});

alternativeSearch?.addEventListener("input", filterAlternatives);

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
