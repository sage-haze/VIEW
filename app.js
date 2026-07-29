const form = document.querySelector("#viewForm");
const questionInput = document.querySelector("#question");
const regionInput = document.querySelector("#marketRegion");
const contextInput = document.querySelector("#clientContext");
const sourceInputs = [...document.querySelectorAll('input[name="referenceSource"]')];
const submitButton = document.querySelector("#submitButton");
const statusBox = document.querySelector("#status");
const marketBox = document.querySelector("#marketContext");
const answersBox = document.querySelector("#answers");

let lastRequest = null;
let lastResult = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();
  if (!question) return;

  resetOutput();
  setLoading(true);

  const sourceMode = selectedSourceMode();
  statusBox.textContent = sourceMode === "internal"
    ? "Checking internal guidance and preparing a suggested response…"
    : sourceMode === "market"
      ? "Checking current market sources and preparing a suggested response…"
      : "Checking internal guidance and current market sources…";

  try {
    lastRequest = {
      question,
      marketRegion: regionInput.value.trim(),
      clientContext: contextInput.value.trim(),
      sourceMode
    };

    const response = await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastRequest)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (data.diagnostics) console.error("VIEW API diagnostics", data.diagnostics);
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    lastResult = data;
    renderMarketContext(data.marketContext, data.approvedFxSource);
    if (data.sourceUnavailable?.message) {
      renderSourceUnavailable(data.sourceUnavailable.message);
    } else {
      renderAnswer(data.answer);
    }
    if (data.approvedFxStatus?.error) {
      console.error("Approved FX report diagnostics", data.approvedFxStatus);
      statusBox.className = "status error";
      statusBox.textContent = `Response generated, but the approved FX report was not used: ${data.approvedFxStatus.error}`;
    } else {
      statusBox.textContent = "";
    }
    answersBox.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    statusBox.className = "status error";
    statusBox.textContent = error.message || "Unable to generate responses.";
  } finally {
    setLoading(false);
  }
});

function selectedSourceMode() {
  return sourceInputs.find((input) => input.checked)?.value || "combined";
}

function renderSourceUnavailable(message) {
  answersBox.innerHTML = `
    <article class="panel source-unavailable" role="status">
      <h2>Internal guidance not available</h2>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function resetOutput() {
  statusBox.className = "status";
  marketBox.classList.add("hidden");
  marketBox.innerHTML = "";
  answersBox.innerHTML = "";
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Generating…" : "Generate suggested response";
  form.setAttribute("aria-busy", String(loading));
}

function renderMarketContext(context, approvedFxSource) {
  if (!context?.baseline && !approvedFxSource) return;

  const sources = Array.isArray(context?.sources) ? context.sources : [];
  const approvedSourceNote = approvedFxSource
    ? renderInternalGuidance(approvedFxSource)
    : "";

  marketBox.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Current context</p>
        <h2>Market Brief</h2>
      </div>
      ${context?.asOf ? `<span class="as-of">As of ${escapeHtml(formatDate(context.asOf))}</span>` : ""}
    </div>

    ${approvedSourceNote}

    ${context?.assumption ? `
      <div class="assumption">
        <strong>Assumption</strong>
        <span>${escapeHtml(context.assumption)}</span>
      </div>` : ""}

    <div class="context-grid">
      ${contextPart("Baseline", context?.baseline)}
      ${contextPart("Observed facts", context?.observed)}
      ${contextPart("What could change", context?.watch)}
    </div>

    ${renderSources(sources)}
    ${context?.caution ? `<p class="caution">${escapeHtml(context.caution)}</p>` : ""}
  `;

  marketBox.classList.remove("hidden");
}

function renderInternalGuidance(source) {
  const period = source.periodStart && source.periodEnd
    ? `${formatDate(source.periodStart)} – ${formatDate(source.periodEnd)}`
    : source.publicationDate
      ? formatDate(source.publicationDate)
      : "Date not stated";

  const items = Array.isArray(source.guidanceItems) && source.guidanceItems.length
    ? source.guidanceItems
    : (Array.isArray(source.pairs) ? source.pairs : []).map((pair) => ({
        pair,
        summary: source.backgroundSummary || ""
      }));

  const guidanceRows = items
    .filter((item) => item?.summary)
    .map((item) => {
      const movement = item.movementGuidance || {};
      const sourceLabel = movement.sourceLabel || [movement.symbol, movement.strength].filter(Boolean).join(" ");
      const directionClass = ["up", "down", "flat", "mixed"].includes(movement.direction)
        ? movement.direction
        : "unclear";
      const paragraphs = String(item.summary)
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");

      return `
        <div class="guidance-item">
          <div class="guidance-pair">
            <strong>${escapeHtml(item.pair || "Guidance")}</strong>
            ${sourceLabel ? `<span class="movement-badge movement-${directionClass}">${escapeHtml(sourceLabel)}</span>` : ""}
          </div>
          <div class="guidance-copy">
            ${movement.plainMeaning ? `<p class="movement-meaning">${escapeHtml(movement.plainMeaning)}</p>` : ""}
            ${paragraphs}
          </div>
        </div>`;
    }).join("");

  return `
    <section class="internal-guidance" aria-label="Internal guidance">
      <div class="guidance-heading">
        <div>
          <strong>Internal Guidance</strong>
          <span>Guidance from ${escapeHtml(period)}</span>
        </div>
        ${source.sourceKey ? `<a class="guidance-download" href="/api/fx-report/download" target="_blank" rel="noopener">Download PDF</a>` : ""}
      </div>
      ${guidanceRows || `<p class="guidance-fallback">${escapeHtml(source.backgroundSummary || "Relevant internal guidance was used.")}</p>`}
    </section>`;
}

function renderSources(sources) {
  if (!sources.length) return "";

  const links = sources.map(({ url, title }, index) => {
    const label = title || `Source ${index + 1}`;
    return `<a
      class="source-chip"
      href="${escapeAttribute(url)}"
      target="_blank"
      rel="noopener noreferrer"
      title="${escapeAttribute(label)}"
      aria-label="Source ${index + 1}: ${escapeAttribute(label)}"
    >${index + 1}</a>`;
  }).join("");

  return `<div class="source-strip" aria-label="Sources used">
    <span class="source-strip-label">Sources</span>
    <span class="source-chips">${links}</span>
  </div>`;
}

function contextPart(title, text) {
  return text
    ? `<div class="context-part"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`
    : "";
}

function renderAnswer(answer) {
  if (!answer?.response) {
    throw new Error("The API did not return a valid response.");
  }

  answersBox.innerHTML = `
    <article class="panel answer">
      <div class="answer-heading">
        <h2>${escapeHtml(answer.label || "One possible VIEW response")}</h2>
      </div>
      <blockquote class="response">${escapeHtml(answer.response)}</blockquote>
      <div class="translation-actions">
        <button class="translate-button" type="button" data-translate-to-thai>Translate to Thai</button>
      </div>
      <div class="thai-translation hidden" data-thai-translation lang="th" aria-live="polite"></div>
      <div class="view-grid">
        ${viewPart("V — Give a baseline view", answer.view)}
        ${viewPart("I — Identify what may change the view", answer.influences)}
        ${viewPart("E — Explain possible implications", answer.effects)}
        ${viewPart("W — Welcome what matters to the client", answer.whatMatters)}
      </div>
      <details class="coach-details">
        <summary>Coaching notes and shorter version</summary>
        <div class="coach-content">
          ${viewPart("Shorter live version", answer.shorterLiveVersion)}
          ${viewPart("Assumptions made", answer.assumptionsMade)}
          ${viewPart("What should be verified", answer.verificationNeeded)}
        </div>
      </details>
      <div class="alternative-actions">
        <p>VIEW is a guide, not a script. The same market context can be expressed in different natural ways.</p>
        <button class="secondary-button" type="button" data-generate-alternative>Generate another VIEW response</button>
      </div>
    </article>
  `;

  const translateButton = answersBox.querySelector("[data-translate-to-thai]");
  const translationBox = answersBox.querySelector("[data-thai-translation]");
  translateButton?.addEventListener("click", () => translateToThai({
    button: translateButton,
    output: translationBox,
    text: answer.response
  }));

  const alternativeButton = answersBox.querySelector("[data-generate-alternative]");
  alternativeButton?.addEventListener("click", () => generateAlternative(alternativeButton, answer.response));
}

async function generateAlternative(button, previousResponse) {
  if (!lastRequest || !lastResult) return;

  const originalLabel = "Generate another VIEW response";
  button.disabled = true;
  button.textContent = "Generating another response…";

  try {
    const response = await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...lastRequest,
        reusedMarketContext: lastResult.marketContext,
        alternativeRequest: true,
        previousResponse
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.answer) {
      throw new Error(data.error || "Unable to generate another response.");
    }

    lastResult = { ...lastResult, answer: data.answer };
    renderAnswer(data.answer);
    answersBox.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    statusBox.className = "status error";
    statusBox.textContent = error.message || "Unable to generate another response.";
  }
}

async function translateToThai({ button, output, text }) {
  const originalLabel = "Translate to Thai";
  button.disabled = true;
  button.textContent = "Translating…";

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.translatedText) {
      throw new Error(data.error || "Unable to translate the response.");
    }

    output.textContent = data.translatedText;
    output.classList.remove("hidden", "translation-error");
    button.textContent = "Translated to Thai";
  } catch (error) {
    output.textContent = error.message || "Unable to translate the response.";
    output.classList.remove("hidden");
    output.classList.add("translation-error");
    button.disabled = false;
    button.textContent = originalLabel;
  }
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
