import {scenario1, scenario2, distractions} from './content.js';

const root = document.getElementById('app');
const STORE_KEY = 'sas_decision_study_session_v1';
const IS_PREVIEW = window.EXPERIMENT_PREVIEW === true || window.location.pathname.endsWith('/preview.html');
let study = null;
let chosen = null;
let busy = false;
const fallbackData = new Map();
const fallbackStorage = {
  getItem(key) { return fallbackData.has(key) ? fallbackData.get(key) : null; },
  setItem(key,value) { fallbackData.set(key,String(value)); },
  removeItem(key) { fallbackData.delete(key); }
};
function usableStorage(kind) {
  try { const storage = window[kind]; storage.getItem('__storage_check__'); return storage; }
  catch { return fallbackStorage; }
}
const localStore = usableStorage('localStorage');
const demoStore = usableStorage('sessionStorage');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const pList = arr => `<div class="body-copy">${arr.map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>`;

function store(value) {
  if (value) localStore.setItem(STORE_KEY, JSON.stringify(value));
  else localStore.removeItem(STORE_KEY);
}
function stored() {
  try {
    const data = JSON.parse(localStore.getItem(STORE_KEY));
    if (data && typeof data.id === 'string') return data;
  } catch {}
  return null;
}
async function api(action, body = null) {
  if (IS_PREVIEW) return demoApi(action, body);
  const res = await fetch(`/api/${action}`, {
    method: body === null ? 'GET' : 'POST',
    headers: body === null ? {} : {'Content-Type':'application/json'},
    body: body === null ? undefined : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin'
  });
  let result = {};
  try { result = await res.json(); } catch {}
  if (!res.ok) throw new Error(result.error || 'The server could not save your response. Please try again.');
  return result;
}
function demoApi(action, body) {
  const demoKey = 'sas_study_preview_state';
  let item = JSON.parse(demoStore.getItem(demoKey) || 'null');
  if (action === 'start') {
    item = {id: 'demo-'+Date.now(), version:Math.random()<.5?'A':'B', step:0, answers:{}, completed:false};
  } else if (action.startsWith('status')) {
    if (!item) throw new Error('Preview session unavailable');
  } else if (action === 'answer') {
    if (!item || item.step !== body.step) throw new Error('This question was already answered.');
    item.answers[body.step] = body.choice;
    item.step += 1;
    item.completed = item.step === 7;
  } else if (action === 'withdraw') {
    demoStore.removeItem(demoKey);
    return Promise.resolve({deleted:true});
  }
  demoStore.setItem(demoKey, JSON.stringify(item));
  return Promise.resolve(action === 'answer' ? {next_step:item.step, completed:item.completed} : item);
}
function previewBanner() {
  return IS_PREVIEW ? `<div class="preview-banner"><strong>Preview mode:</strong> You can try the full questionnaire here, but answers are not sent to the researcher database. Version assignment is random in this preview only.</div>` : '';
}
function showError(message) {
  const container = document.getElementById('error-slot');
  if (container) container.innerHTML = `<div class="error-message" role="alert">${escapeHtml(message)}</div>`;
}
function renderConsent() {
  root.innerHTML = `${previewBanner()}<article class="page-card">
    <p class="eyebrow">SAS Psychology · Student research</p>
    <h1 class="h1">A short study about everyday decisions.</h1>
    <p class="lede">You'll read a series of fictional situations and choose the option you would prefer. There are no right or wrong answers.</p>
    <div class="intro-stat-row">
      <div class="intro-stat"><strong>7 choices</strong><small>One question per screen</small></div>
      <div class="intro-stat"><strong>About 10 minutes</strong><small>Read at your own pace</small></div>
      <div class="intro-stat"><strong>Anonymous</strong><small>No student names or emails</small></div>
    </div>
    <div class="notice">
      <strong>Before you begin</strong>
      Participation is voluntary. You can stop at any point, and you can request removal of your responses using this device while your study session is available. Your choices are used only for a school psychology project and are shown to researchers without your name or email. Some questions discuss school activities, money or environmental challenges. This study may be completed only with school approval and any required student/guardian consent.
    </div>
    <label class="consent-check"><input id="consent" type="checkbox" /> <span>I have read the information above and voluntarily agree to participate.</span></label>
    <div id="error-slot"></div>
    <div class="actions"><span class="mini-note">You may close this page if you do not wish to participate.</span><button class="btn" id="begin" disabled>Begin questionnaire <span aria-hidden="true">→</span></button></div>
  </article>`;
  const checked = document.getElementById('consent');
  const button = document.getElementById('begin');
  checked.addEventListener('change', () => {button.disabled = !checked.checked;});
  button.addEventListener('click', async () => {
    if (busy || !checked.checked) return;
    busy = true; button.disabled = true; button.textContent = 'Starting…';
    try {
      study = await api('start', {consent:true});
      store({id:study.id});
      renderQuestion();
    } catch (e) { showError(e.message); button.textContent = 'Begin questionnaire →'; button.disabled = false; }
    finally { busy = false; }
  });
}
function questionData() {
  const step = study.step;
  if (step === 0 || step === 6) {
    const first = step === 0;
    const scenario = first ? scenario1 : scenario2;
    const frame = first ? (study.version === 'A'?'positive':'negative') : (study.version === 'A'?'negative':'positive');
    return {title:scenario.title, paragraphs:scenario.paragraphs, options:scenario[frame],
      prompt:'Which plan would you choose?', label:first?'Situation 1':'Situation 2'};
  }
  const d = distractions[step-1];
  return {title:d.title, paragraphs:d.paragraphs, options:d.options, prompt:d.prompt, label:`Question ${step+1}`};
}
function renderQuestion() {
  if (study.step >= 7) { renderDebrief(); return; }
  chosen = null;
  const q = questionData();
  root.innerHTML = `${previewBanner()}<article class="page-card">
    <div class="progress-head"><div class="progress-row"><span>Decision questionnaire</span><span>${study.step+1} of 7</span></div>
       <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${(study.step+1)/7*100}%"></div></div></div>
    <p class="eyebrow">${escapeHtml(q.label)}</p>
    <h1 class="question-title">${escapeHtml(q.title)}</h1>
    ${pList(q.paragraphs)}
    <div class="prompt">${escapeHtml(q.prompt)}</div>
    <div class="option-list" role="group" aria-label="Choose one answer">
      ${['A','B'].map(key => `<button type="button" class="option" data-choice="${key}" aria-pressed="false"><span class="option-key">${key}</span><span class="option-text">${escapeHtml(q.options[key])}</span></button>`).join('')}
    </div>
    <div id="error-slot"></div>
    <div class="actions"><button type="button" class="link-button" id="withdraw">Stop participating</button><button type="button" class="btn" id="continue" disabled>${study.step===6?'Submit answers':'Continue'} <span aria-hidden="true">→</span></button></div>
    <p class="mini-note">Select one option to continue. You cannot return to previous questions after continuing.</p>
  </article>`;
  const buttons = [...root.querySelectorAll('[data-choice]')];
  const next = document.getElementById('continue');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    if (busy) return;
    chosen = btn.dataset.choice;
    buttons.forEach(b => {b.classList.toggle('selected',b===btn);b.setAttribute('aria-pressed',b===btn?'true':'false');});
    next.disabled = false;
  }));
  next.addEventListener('click', async () => {
    if (busy || !chosen) return;
    busy=true; next.disabled=true; next.textContent='Saving…';
    try {
      const reply=await api('answer',{id:study.id,step:study.step,choice:chosen});
      study.step=reply.next_step;
      if (reply.completed) {study.completed=true;renderDebrief();}
      else renderQuestion();
      window.scrollTo({top:0,behavior:'instant'});
    } catch(e) {
      showError(e.message); next.disabled=false; next.textContent=study.step===6?'Submit answers →':'Continue →';
    } finally {busy=false;}
  });
  document.getElementById('withdraw').addEventListener('click', confirmWithdrawal);
}
async function confirmWithdrawal() {
  if (busy) return;
  if (!window.confirm('Stop participating and delete the responses saved in this study session?')) return;
  busy=true;
  try {
    await api('withdraw',{id:study.id});
    study=null;store(null);
    root.innerHTML=`<article class="page-card"><div class="success-icon">✓</div><h1 class="h1">Your session was removed.</h1><p class="lede">Thank you. Your recorded responses for this session have been deleted.</p><div class="actions"><button class="btn ghost" id="restart">Return to start</button></div></article>`;
    document.getElementById('restart').addEventListener('click', renderConsent);
  } catch(e) {showError(e.message);} finally{busy=false;}
}
function renderDebrief() {
  root.innerHTML=`${previewBanner()}<article class="page-card">
    <div class="success-icon">✓</div>
    <p class="eyebrow">Questionnaire complete</p>
    <h1 class="h1">Thank you for taking part.</h1>
    <p class="lede">Your responses have ${IS_PREVIEW?'not been submitted because this is preview mode':'been recorded anonymously'}.</p>
    <div class="notice"><strong>About this study</strong>
      This psychology investigation examines the <strong>framing effect</strong>: whether describing similar outcomes in terms of what is gained or what is lost can influence people's choices. The two school-related scenarios were presented using different wording across participant groups. The additional questions were included to make the focus of the study less obvious until debriefing. You were not told the full hypothesis beforehand to avoid influencing your answers.
    </div>
    <p class="body-copy">If you have concerns or questions, please speak with the supervising Psychology teacher or student researchers.</p>
    <div id="error-slot"></div>
    <div class="actions"><button type="button" id="withdraw" class="link-button">Request withdrawal of my session's responses</button><span class="mini-note">You may now close this page.</span></div>
  </article>`;
  document.getElementById('withdraw').addEventListener('click',confirmWithdrawal);
}
async function boot() {
  const saved=stored();
  if (!saved) {renderConsent();return;}
  try {
    const status=await api(`status?id=${encodeURIComponent(saved.id)}`);
    study={id:saved.id,...status};
    if(study.completed||study.step===7) renderDebrief();
    else renderQuestion();
  } catch {store(null);renderConsent();}
}
boot();
