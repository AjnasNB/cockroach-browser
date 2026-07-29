const state = {
  url: window.location.origin,
  token: "",
  health: null,
  sessions: [],
  evidence: [],
  view: "overview"
};

const urlInput = document.querySelector("[data-url]");
const tokenInput = document.querySelector("[data-token]");
const connectButton = document.querySelector("[data-connect]");
const status = document.querySelector("[data-status]");
const title = document.querySelector("[data-title]");
const panels = document.querySelector("[data-panels]");

if (urlInput instanceof HTMLInputElement) urlInput.value = state.url;

connectButton?.addEventListener("click", connect);
tokenInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.getAttribute("data-view") ?? "overview";
    document.querySelectorAll("[data-view]").forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    render();
  });
});

async function connect() {
  if (!(urlInput instanceof HTMLInputElement) || !(tokenInput instanceof HTMLInputElement)) return;
  state.url = urlInput.value.replace(/\/+$/, "");
  state.token = tokenInput.value;
  setStatus("Connecting", "idle");
  connectButton.disabled = true;
  try {
    const [health, sessions, evidence, verify] = await Promise.all([
      request("/v1/health"),
      request("/v1/sessions"),
      request("/v1/evidence"),
      request("/v1/evidence/verify")
    ]);
    state.health = health;
    state.sessions = sessions.sessions ?? [];
    state.evidence = evidence.evidence ?? [];
    state.verify = verify;
    setStatus(`Connected to ${state.url}`, "ok");
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    renderError(error);
  } finally {
    connectButton.disabled = false;
  }
}

async function request(path) {
  const response = await fetch(`${state.url}${path}`, {
    headers: { authorization: `Bearer ${state.token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? `Request failed with ${response.status}`);
  return payload;
}

function render() {
  const challenged = state.sessions.filter((session) => session.state === "challenge" || session.challenge?.detected);
  const labels = {
    overview: "Browser control room",
    sessions: "Authorized sessions",
    evidence: "Evidence ledger",
    challenges: "Challenge handoff",
    receipts: "Receipt integrity"
  };
  if (title) title.textContent = labels[state.view] ?? labels.overview;
  if (!panels) return;

  if (state.view === "sessions") {
    panels.innerHTML = widePanel(
      "Sessions",
      listSessions(state.sessions, "No active sessions. Connect an authorized worker to inspect its session state.")
    );
    return;
  }
  if (state.view === "evidence") {
    panels.innerHTML = widePanel(
      "Evidence records",
      listEvidence(state.evidence, "No evidence records are available from this worker.")
    );
    return;
  }
  if (state.view === "challenges") {
    panels.innerHTML = widePanel(
      "Paused challenges",
      listSessions(
        challenged,
        "No active challenge. Login, consent, CAPTCHA, and access challenges pause here for human or authorized handoff."
      )
    );
    return;
  }
  if (state.view === "receipts") {
    const integrity = state.verify?.ok
      ? "The evidence receipt chain passed local integrity verification."
      : state.health
        ? "The worker responded, but the receipt chain needs inspection."
        : "Connect to verify the local receipt chain.";
    panels.innerHTML = `
      ${metricPanel("Receipt chain", state.verify?.ok ? "OK" : state.health ? "CHECK" : "WAIT", integrity)}
      ${metricPanel("Evidence records", state.evidence.length, "Records included in the current local verification surface.")}
      ${widePanel("Integrity result", `<pre class="receipt">${escapeHtml(JSON.stringify(state.verify ?? { status: "not connected" }, null, 2))}</pre>`)}
    `;
    return;
  }

  panels.innerHTML = `
    ${metricPanel("Active sessions", state.sessions.length, "Authorized Chromium contexts currently owned by this worker.")}
    ${metricPanel("Evidence records", state.evidence.length, "Snapshots, artifacts, audits, comparisons, and action records.")}
    ${metricPanel("Receipt chain", state.verify?.ok ? "OK" : state.health ? "CHECK" : "WAIT", "Integrity is verified against the local evidence ledger.")}
    ${widePanel("Sessions", listSessions(state.sessions, "No active sessions."))}
    ${widePanel("Challenges", listSessions(challenged, "No active challenge. Login, consent, CAPTCHA, and access challenges pause here."))}
  `;
}

function renderError(error) {
  if (!panels) return;
  panels.innerHTML = widePanel(
    "Connection failed",
    `<div class="error-box">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`
  );
}

function setStatus(message, value) {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metricPanel(label, value, detail) {
  return `<article class="panel metric-panel"><h2>${escapeHtml(label)}</h2><strong>${escapeHtml(value)}</strong><p>${escapeHtml(detail)}</p></article>`;
}

function widePanel(label, body) {
  return `<article class="panel panel-wide"><h2>${escapeHtml(label)}</h2>${body}</article>`;
}

function listSessions(sessions, emptyMessage) {
  if (!sessions.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return `<ul class="session-list">${sessions.map((session) => `
    <li>
      <span>${escapeHtml(session.purpose ?? "Untitled session")}<br><small>${escapeHtml(session.id ?? "unknown")}</small></span>
      <code>${escapeHtml(session.challenge?.kind ?? `${session.state ?? "unknown"} / ${session.mode ?? "unknown"}`)}</code>
    </li>
  `).join("")}</ul>`;
}

function listEvidence(records, emptyMessage) {
  if (!records.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return `<ul class="session-list">${records.map((record) => `
    <li>
      <span>${escapeHtml(record.kind ?? record.type ?? "evidence")}<br><small>${escapeHtml(record.id ?? record.evidenceId ?? "unknown")}</small></span>
      <code>${escapeHtml(record.digest ?? record.receiptHash ?? record.createdAt ?? "recorded")}</code>
    </li>
  `).join("")}</ul>`;
}
