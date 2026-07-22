const form = document.querySelector("#view-form");
const questionInput = document.querySelector("#question");
const clientContextInput = document.querySelector("#clientContext");
const useMarketContextInput = document.querySelector("#useMarketContext");
const submitButton = document.querySelector("#submitButton");
const statusBox = document.querySelector("#status");
const consensusBox = document.querySelector("#consensus");
const resultsBox = document.querySelector("#results");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();
  const clientContext = clientContextInput.value.trim();
  const useMarketContext = useMarketContextInput.checked;

  if (!question) return;

  setLoading(true);
  statusBox.className = "status";
  statusBox.textContent = useMarketContext
    ? "Reviewing current market context and preparing three VIEW responses…"
    : "Preparing three VIEW responses…";
  consensusBox.classList.add("hidden");
  consensusBox.innerHTML = "";
  resultsBox.innerHTML = "";

  try {
    // Use a relative path when the front end is hosted by the same Cloudflare Pages project.
    // If GitHub Pages remains separate, replace this with your Cloudflare Worker URL.
    const response = await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, clientContext, useMarketContext })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}.`);
    }

    renderConsensus(payload.consensus);
    renderAnswers(payload.answers);
    statusBox.textContent = `Generated with ${payload.modelUsed}.`;
  } catch (error) {
    console.error(error);
    statusBox.className = "status error";
    statusBox.textContent = error.message || "Something went wrong.";
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Generating…" : "Generate VIEW examples";
}

function renderConsensus(consensus) {
  if (!consensus?.summary) return;

  const sources = Array.isArray(consensus.sources) ? consensus.sources : [];
  consensusBox.innerHTML = `
    <h2>Current baseline context</h2>
    <p>${escapeHtml(consensus.summary)}</p>
    ${
      sources.length
        ? `<h3>Sources reviewed</h3>
           <ul class="source-list">
             ${sources.map(source => `
               <li>
                 <a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">
                   ${escapeHtml(source.title || source.url)}
                 </a>
               </li>`).join("")}
           </ul>`
        : ""
    }
    <p><small>${escapeHtml(consensus.caution || "")}</small></p>
  `;
  consensusBox.classList.remove("hidden");
}

function renderAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 3) {
    throw new Error("The service did not return three valid answers.");
  }

  resultsBox.innerHTML = answers.map((answer, index) => `
    <article class="answer-card">
      <h2>${index + 1}. ${escapeHtml(answer.label)}</h2>
      <p class="response-text">${escapeHtml(answer.response)}</p>
      <div class="view-grid">
        ${viewItem("V — View", answer.view)}
        ${viewItem("I — Influences", answer.influences)}
        ${viewItem("E — Effects", answer.effects)}
        ${viewItem("W — What matters", answer.whatMatters)}
      </div>
    </article>
  `).join("");
}

function viewItem(title, content) {
  return `
    <div class="view-item">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(content || "")}</span>
    </div>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
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
