const form = document.querySelector("#viewForm");
const questionInput = document.querySelector("#question");
const regionInput = document.querySelector("#marketRegion");
const contextInput = document.querySelector("#clientContext");
const marketToggle = document.querySelector("#useMarketContext");
const submitButton = document.querySelector("#submitButton");
const statusBox = document.querySelector("#status");
const marketBox = document.querySelector("#marketContext");
const answersBox = document.querySelector("#answers");

const ANSWER_LABELS = [
  "Concise and direct",
  "Balanced and consultative",
  "Cautious under uncertainty"
];

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();
  if (!question) return;

  setLoading(true);
  statusBox.className = "status";
  statusBox.textContent = marketToggle.checked
    ? "Checking current context and preparing three client-ready responses…"
    : "Preparing three client-ready responses…";
  marketBox.classList.add("hidden");
  marketBox.innerHTML = "";
  answersBox.innerHTML = "";

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
      if (data.diagnostics) {
        console.error("VIEW API diagnostics", data.diagnostics);
      }
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

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Generating…" : "Generate three responses";
  form.setAttribute("aria-busy", String(loading));
}

function renderMarketContext(context) {
  if (!context?.baseline) return;

  const sources = Array.isArray(context.sources) ? context.sources : [];
  const sourceSection = sources.length
    ? `<details class="source-details">
        <summary>Sources used (${sources.length})</summary>
        <ul class="sources">
          ${sources.map((source) => `
            <li>
              <a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(source.title || "Source")}
              </a>
            </li>`).join("")}
        </ul>
      </details>`
    : "";

  marketBox.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Current context</p>
        <h2>Source-based market brief</h2>
      </div>
      ${context.asOf ? `<span class="as-of">As of ${escapeHtml(formatDate(context.asOf))}</span>` : ""}
    </div>

    ${context.assumption ? `
      <div class="assumption"><strong>Assumption</strong><span>${escapeHtml(context.assumption)}</span></div>
    ` : ""}

    <div class="context-grid">
      ${contextPart("Baseline", context.baseline)}
      ${contextPart("Observed facts", context.observed)}
      ${contextPart("What could change", context.watch)}
    </div>

    ${sourceSection}
    <p class="caution">${escapeHtml(context.caution || "")}</p>
  `;
  marketBox.classList.remove("hidden");
}

function contextPart(title, text) {
  if (!text) return "";
  return `<div class="context-part"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

function renderAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) {
    throw new Error("The API did not return three valid responses.");
  }

  answersBox.innerHTML = answers.map((answer, index) => `
    <article class="panel answer">
      <div class="answer-heading">
        <span class="answer-number">${index + 1}</span>
        <h2>${escapeHtml(ANSWER_LABELS[index])}</h2>
      </div>
      <blockquote class="response">${escapeHtml(answer.response)}</blockquote>
      <div class="view-grid">
        ${viewPart("V — View", answer.view)}
        ${viewPart("I — Influences", answer.influences)}
        ${viewPart("E — Effects", answer.effects)}
        ${viewPart("W — Client question", answer.whatMatters)}
      </div>
      <button class="copy-button" type="button" data-copy="${escapeAttribute(answer.response)}">Copy response</button>
    </article>
  `).join("");

  for (const button of answersBox.querySelectorAll(".copy-button")) {
    button.addEventListener("click", () => copyResponse(button));
  }
}

async function copyResponse(button) {
  const text = button.dataset.copy || "";
  const original = button.textContent;

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }

  window.setTimeout(() => {
    button.textContent = original;
  }, 1500);
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[character]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}
