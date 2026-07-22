const form = document.querySelector("#viewForm");
const questionInput = document.querySelector("#question");
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

  setLoading(true);
  statusBox.className = "status";
  statusBox.textContent = marketToggle.checked
    ? "Reviewing current context and generating responses…"
    : "Generating responses…";
  marketBox.classList.add("hidden");
  marketBox.innerHTML = "";
  answersBox.innerHTML = "";

  try {
    // Relative URL: the browser calls the Pages Function on the same
    // Cloudflare Pages deployment. No external Worker URL or CORS is needed.
    const response = await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        clientContext: contextInput.value.trim(),
        useMarketContext: marketToggle.checked
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    renderMarketContext(data.marketContext);
    renderAnswers(data.answers);
    statusBox.textContent = `Generated using ${data.models.answer}.`;
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
}

function renderMarketContext(context) {
  if (!context?.summary) return;

  const sources = Array.isArray(context.sources) ? context.sources : [];
  marketBox.innerHTML = `
    <h2>Current source-based context</h2>
    <p>${escapeHtml(context.summary)}</p>
    ${sources.length ? `
      <h3>Sources</h3>
      <ul class="sources">
        ${sources.map(source => `
          <li><a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(source.title || source.url)}
          </a></li>`).join("")}
      </ul>` : ""}
    <small>${escapeHtml(context.caution || "")}</small>
  `;
  marketBox.classList.remove("hidden");
}

function renderAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) {
    throw new Error("The API did not return three valid responses.");
  }

  answersBox.innerHTML = answers.map((answer, index) => `
    <article class="panel answer">
      <h2>${index + 1}. ${escapeHtml(answer.label)}</h2>
      <p class="response">${escapeHtml(answer.response)}</p>
      <div class="view-grid">
        ${viewPart("V — View", answer.view)}
        ${viewPart("I — Influences", answer.influences)}
        ${viewPart("E — Effects", answer.effects)}
        ${viewPart("W — What matters", answer.whatMatters)}
      </div>
    </article>
  `).join("");
}

function viewPart(title, text) {
  return `<div class="view-part"><strong>${escapeHtml(title)}</strong>${escapeHtml(text || "")}</div>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[character]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}
