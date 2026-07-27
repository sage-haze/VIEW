const setupForm = document.querySelector('#setupForm');
const questionInput = document.querySelector('#question');
const regionInput = document.querySelector('#marketRegion');
const contextInput = document.querySelector('#clientContext');
const marketToggle = document.querySelector('#useMarketContext');
const startButton = document.querySelector('#startButton');
const statusBox = document.querySelector('#status');
const briefBox = document.querySelector('#brief');
const workspace = document.querySelector('#workspace');
const fieldsBox = document.querySelector('#viewFields');
const reviewButton = document.querySelector('#reviewButton');
const reviewBox = document.querySelector('#review');

let session = null;
const components = [
  ['view','V — Give a baseline view','What simple initial view would you give the client?'],
  ['influences','I — Identify what may change it','What is the one most important factor that could change the picture?'],
  ['effects','E — Explain possible relevance','What practical relevance could you mention without assuming too much?'],
  ['whatMatters','W — Welcome what matters','What friendly question could gently explore how this may connect to the client?']
];

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  setBusy(startButton, true, 'Preparing…');
  statusBox.className = 'status';
  statusBox.textContent = marketToggle.checked ? 'Checking current context and preparing guidance…' : 'Preparing guidance…';
  briefBox.classList.add('hidden'); workspace.classList.add('hidden'); reviewBox.classList.add('hidden');
  try {
    const response = await fetch('/api/coach', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'start', question, marketRegion:regionInput.value.trim(), clientContext:contextInput.value.trim(), useMarketContext:marketToggle.checked }) });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    session = data;
    renderBrief(data.marketContext);
    renderFields(data.guidance);
    workspace.classList.remove('hidden');
    statusBox.textContent = 'Ready. Write your own notes, then ask for feedback.';
    workspace.scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) { statusBox.className='status error'; statusBox.textContent=error.message; }
  finally { setBusy(startButton,false,'Start guided practice'); }
});

reviewButton.addEventListener('click', async () => {
  if (!session) return;
  const draft = Object.fromEntries(components.map(([key]) => [key, document.querySelector(`[data-field="${key}"]`).value.trim()]));
  if (Object.values(draft).some(v => !v)) { statusBox.className='status error'; statusBox.textContent='Please attempt all four parts before requesting feedback.'; return; }
  setBusy(reviewButton,true,'Reviewing…'); statusBox.className='status'; statusBox.textContent='Reviewing your reasoning and delivery…';
  try {
    const response = await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review',question:session.question,marketRegion:session.marketRegion,clientContext:session.clientContext,marketContext:session.marketContext,draft})});
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    renderReview(data);
    statusBox.textContent='Review complete.';
    reviewBox.scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error){statusBox.className='status error';statusBox.textContent=error.message;}
  finally{setBusy(reviewButton,false,'Review my VIEW draft');}
});

function renderFields(guidance){
  fieldsBox.innerHTML = components.map(([key,title,prompt]) => {
    const hints = guidance?.[key] || [];
    const hintControl = hints.length ? `<button type="button" class="hint-button" data-hint-key="${key}" data-hint-index="0">Show hint</button>` : '';
    return `<article class="view-card"><h3>${escapeHtml(title)}</h3><p class="prompt">${escapeHtml(prompt)}</p><textarea data-field="${key}" maxlength="800" placeholder="Write a working sentence or notes…"></textarea><div class="hint-row">${hintControl}</div><div class="hint-box hidden" data-hint-box="${key}"></div></article>`;
  }).join('');
  fieldsBox.querySelectorAll('[data-hint-key]').forEach(button => button.addEventListener('click',()=>{
    const key = button.dataset.hintKey;
    const hints = guidance[key] || [];
    const index = Number(button.dataset.hintIndex || 0);
    const box = fieldsBox.querySelector(`[data-hint-box="${key}"]`);
    box.textContent = hints[index] || '';
    box.classList.remove('hidden');
    const next = index + 1;
    if (next < hints.length) {
      button.dataset.hintIndex = String(next);
      button.textContent = 'More help';
    } else {
      button.remove();
    }
  }));
}

function renderBrief(context){
  if(!context?.baseline) return;
  const sources=(context.sources||[]).map((s,i)=>`<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(s.title||`Source ${i+1}`)}">${i+1}</a>`).join('');
  briefBox.innerHTML=`<div class="brief-heading"><div><p class="eyebrow">Current context</p><h2>Source-based market brief</h2></div>${sources?`<div class="source-strip">Sources ${sources}</div>`:''}</div>${context.assumption?`<div class="assumption"><strong>Assumption:</strong> ${escapeHtml(context.assumption)}</div>`:''}<div class="context-grid">${part('Baseline',context.baseline)}${part('Observed facts',context.observed)}${part('What could change',context.watch)}</div>`;
  briefBox.classList.remove('hidden');
}

function renderReview(data){
  const labels={view:'V — Baseline view',influences:'I — What may change it',effects:'E — Possible relevance',whatMatters:'W — Welcome what matters'};
  reviewBox.innerHTML=`<article class="panel"><p class="eyebrow">Feedback</p><h2>Your VIEW review</h2><div class="review-grid">${Object.entries(data.feedback||{}).map(([key,item])=>`<div class="feedback-card"><h3>${escapeHtml(labels[key]||key)}</h3><p><strong>What works:</strong> ${escapeHtml(item.strength)}</p><p><strong>Consider:</strong> ${escapeHtml(item.improvement)}</p></div>`).join('')}</div></article><article class="panel"><p class="eyebrow">Light refinement</p><h2>Your assembled VIEW draft</h2><div class="draft-response">${escapeHtml(data.refinedResponse)}</div><div class="reflection"><strong>Before using it:</strong> ${escapeHtml(data.verificationPrompt)}</div></article>`;
  reviewBox.classList.remove('hidden');
}

function part(title,text){return `<div class="context-part"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text||'')}</p></div>`;}
function setBusy(button,busy,label){button.disabled=busy;button.textContent=label;}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function escapeAttr(v=''){return escapeHtml(v);}
