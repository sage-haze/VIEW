const form = document.querySelector("#viewForm");
const questionInput = document.querySelector("#question");
const regionInput = document.querySelector("#marketRegion");
const contextInput = document.querySelector("#clientContext");
const marketToggle = document.querySelector("#useMarketContext");
const submitButton = document.querySelector("#submitButton");
const statusBox = document.querySelector("#status");
const marketBox = document.querySelector("#marketContext");
const answersBox = document.querySelector("#answers");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();
  if (!question) return;

  resetOutput();
  setLoading(true);

  statusBox.textContent = marketToggle.checked
    ? "Checking current context and preparing three banker perspectives…"
    : "Preparing three banker perspectives…";

  try {
    const response = await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        marketRegion: regionInput.value.trim(),
        clientContext: contextInput.value.trim(),
        useMarketContext: marketToggle.checked
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (data.diagnostics) console.error("VIEW API diagnostics", data.diagnostics);
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    renderMarketContext(data.marketContext);
    renderAnswers(data.answers);
    statusBox.textContent = `Ready — generated using ${data.models.answer}.`;
    answersBox.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    statusBox.className = "status error";
    statusBox.textContent = error.message || "Unable to generate responses.";
  } finally {
    setLoading(false);
  }
});

function resetOutput() {
  statusBox.className = "status";
  marketBox.classList.add("hidden");
  marketBox.innerHTML = "";
  answersBox.innerHTML = "";
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Generating…" : "Generate three banker perspectives";
  form.setAttribute("aria-busy", String(loading));
}

function renderMarketContext(context) {
  if (!context?.baseline) return;

  const sources = Array.isArray(context.sources) ? context.sources : [];

  marketBox.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Current context</p>
        <h2>Source-based market brief</h2>
      </div>
      ${context.asOf ? `<span class="as-of">As of ${escapeHtml(formatDate(context.asOf))}</span>` : ""}
    </div>

    ${context.assumption ? `
      <div class="assumption">
        <strong>Assumption</strong>
        <span>${escapeHtml(context.assumption)}</span>
      </div>` : ""}

    <div class="context-grid">
      ${contextPart("Baseline", context.baseline)}
      ${contextPart("Observed facts", context.observed)}
      ${contextPart("What could change", context.watch)}
    </div>

    ${renderSources(sources)}
    <p class="caution">${escapeHtml(context.caution || "")}</p>
  `;

  marketBox.classList.remove("hidden");
}

function renderSources(sources) {
  if (!sources.length) return "";

  return `<details class="source-details">
    <summary>Sources used (${sources.length})</summary>
    <ul class="sources">
      ${sources.map(({ url, title }) => `
        <li>
          <a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(title || "Source")}
          </a>
        </li>`).join("")}
    </ul>
  </details>`;
}

function contextPart(title, text) {
  return text
    ? `<div class="context-part"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`
    : "";
}

function renderAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) {
    throw new Error("The API did not return three valid responses.");
  }

  answersBox.innerHTML = answers.map((answer, index) => `
    <article class="panel answer">
      <div class="answer-heading">
        <span class="answer-number">${index + 1}</span>
        <h2>${escapeHtml(answer.label || `Response ${index + 1}`)}</h2>
      </div>
      <blockquote class="response">${escapeHtml(answer.response)}</blockquote>
      <div class="view-grid">
        ${viewPart("V — Baseline view", answer.view)}
        ${viewPart("I — What may change it", answer.influences)}
        ${viewPart("E — Possible implications", answer.effects)}
        ${viewPart("W — Bridge and client question", answer.whatMatters)}
      </div>
      <details class="coach-details">
        <summary>Coaching notes and shorter version</summary>
        <div class="coach-content">
          ${viewPart("Shorter live version", answer.shorterLiveVersion)}
          ${viewPart("Assumptions made", answer.assumptionsMade)}
          ${viewPart("What should be verified", answer.verificationNeeded)}
        </div>
      </details>
    </article>
  `).join("");
}


function viewPart(title, text) {
  return `<div class="view-part"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text || "")}</p></div>`;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}
