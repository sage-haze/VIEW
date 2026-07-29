const tokenInput = document.querySelector("#adminToken");
const saveTokenButton = document.querySelector("#saveToken");
const checkStatusButton = document.querySelector("#checkStatus");
const reportStatus = document.querySelector("#reportStatus");
const statusActions = document.querySelector("#statusActions");
const processButton = document.querySelector("#processReport");
const forceButton = document.querySelector("#forceProcess");
const uploadForm = document.querySelector("#uploadForm");
const fileInput = document.querySelector("#pdfFile");
const selectedFile = document.querySelector("#selectedFile");
const uploadButton = document.querySelector("#uploadButton");
const uploadStatus = document.querySelector("#uploadStatus");

const TOKEN_KEY = "viewFxRefreshToken";
tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";

saveTokenButton.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  if (!token) return setCard("error", "Enter a token before saving it.");
  localStorage.setItem(TOKEN_KEY, token);
  setCard("success", "Token saved in this browser. You can now check the report status.");
});

checkStatusButton.addEventListener("click", checkStatus);
processButton.addEventListener("click", () => processReport(false));
forceButton.addEventListener("click", () => processReport(true));

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  selectedFile.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "PDF only, up to 20 MB";
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = getToken();
  const file = fileInput.files?.[0];
  if (!token) return;
  if (!file) return setUploadStatus("error", "Choose a PDF first.");

  setBusy(uploadButton, true, "Uploading and processing…");
  setUploadStatus("", "Uploading the PDF. Processing may take a minute.");
  try {
    const body = new FormData();
    body.append("file", file);
    body.append("processNow", "true");
    const data = await request("/api/admin/upload-fx-report", { method: "POST", body }, token);
    setUploadStatus("success", `Ready. ${data.uploadedPdf} was uploaded and ${data.processedJson || "the JSON cache"} was created.`);
    fileInput.value = "";
    selectedFile.textContent = "PDF only, up to 20 MB";
    await checkStatus();
  } catch (error) {
    setUploadStatus("error", error.message);
  } finally {
    setBusy(uploadButton, false, "Upload and process report");
  }
});

async function checkStatus() {
  const token = getToken();
  if (!token) return;
  setBusy(checkStatusButton, true, "Checking…");
  setCard("", "Checking the R2 bucket…");
  try {
    const data = await request("/api/admin/refresh-fx-report", { method: "GET" }, token);
    renderStatus(data);
  } catch (error) {
    setCard("error", error.message);
    statusActions.classList.add("hidden");
  } finally {
    setBusy(checkStatusButton, false, "Check status");
  }
}

async function processReport(force) {
  const token = getToken();
  if (!token) return;
  const button = force ? forceButton : processButton;
  setBusy(button, true, force ? "Rebuilding…" : "Processing…");
  setCard("", "Processing the current PDF. This may take a minute.");
  try {
    const suffix = force ? "?force=1" : "";
    const data = await request(`/api/admin/refresh-fx-report${suffix}`, { method: "POST" }, token);
    renderStatus(data);
  } catch (error) {
    setCard("error", error.message);
  } finally {
    setBusy(button, false, force ? "Force rebuild JSON" : "Process current PDF");
  }
}

function renderStatus(data) {
  statusActions.classList.remove("hidden");
  const source = escapeHtml(data.sourcePdf || "No PDF found in source/");
  const processed = escapeHtml(data.processedJson || "No processed JSON found");
  const report = data.report;
  const current = data.status === "already-current" && data.cachedReportAvailable !== false;
  const noSource = data.status === "no-source-pdf";

  if (noSource) {
    setCard("warning", `<strong>No source PDF found.</strong><span>Upload a report below to create the source and processed files.</span>`);
    statusActions.classList.add("hidden");
    return;
  }

  const heading = current || ["created", "refreshed"].includes(data.status)
    ? "Ready — the processed report is current."
    : "Processing is required.";
  const className = current || ["created", "refreshed"].includes(data.status) ? "success" : "warning";
  const reportLine = report?.title
    ? `<span>${escapeHtml(report.title)}${periodText(report)}</span>`
    : "";
  setCard(className, `<strong>${heading}</strong>${reportLine}<span>Source: ${source}</span><span>Processed: ${processed}</span>`);
}

function getToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    setCard("error", "Enter the FX refresh token first.");
    tokenInput.focus();
    return "";
  }
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

async function request(url, options, token) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function setCard(kind, html) {
  reportStatus.className = `admin-status-card${kind ? ` ${kind}` : ""}`;
  reportStatus.innerHTML = html;
}

function setUploadStatus(kind, message) {
  uploadStatus.className = `status${kind ? ` ${kind}` : ""}`;
  uploadStatus.textContent = message;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function periodText(report) {
  if (report.periodStart && report.periodEnd) return ` · ${formatDate(report.periodStart)}–${formatDate(report.periodEnd)}`;
  if (report.publicationDate) return ` · ${formatDate(report.publicationDate)}`;
  return "";
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

if (tokenInput.value) checkStatus();
