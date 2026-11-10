const root = document.getElementById('research');
let sessions = [];

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = (a,b) => b > 0 ? `${Math.round(1000*a/b)/10}%` : '—';
const fmt = value => value ? new Intl.DateTimeFormat('en-SG',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Singapore'}).format(new Date(value)) : '—';
const framing = (version, first) => first ? (version === 'A' ? 'Positive' : 'Negative') : (version === 'A' ? 'Negative' : 'Positive');
const showError = message => {
  const slot = document.getElementById('error-slot');
  if (slot) slot.innerHTML = `<div class="error-message" role="alert">${esc(message)}</div>`;
};

async function callApi(action, body=null) {
  const res=await fetch(`/api/${action}`,{
    method:body===null?'GET':'POST',
    credentials:'same-origin',
    headers:body===null?{}:{'Content-Type':'application/json'},
    body:body===null?undefined:JSON.stringify(body),
    cache:'no-store'
  });
  let result={};
  if ((res.headers.get('content-type')||'').includes('application/json')) result=await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error || 'Request failed'),{status:res.status});
  return result;
}
function showLogin(error='') {
  root.innerHTML=`<section class="login-card">
    <p class="eyebrow">Researcher-only access</p>
    <h1 class="h2">Research dashboard</h1>
    <p class="lede">Enter the researcher password to view anonymous responses and download the dataset.</p>
    <form id="login-form">
      <label for="password" style="font-size:13px;font-weight:700">Researcher password</label>
      <input id="password" class="field" type="password" required autocomplete="current-password" placeholder="Enter password" />
      <div id="error-slot">${error ? `<div class="error-message">${esc(error)}</div>` : ''}</div>
      <button id="sign-in" class="btn" type="submit" style="width:100%;margin-top:18px">Sign in</button>
    </form><p class="mini-note">The dashboard is protected by a server-side password and a signed session cookie.</p>
  </section>`;
  document.getElementById('login-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=document.getElementById('sign-in');
    btn.disabled=true; btn.textContent='Signing in…';
    try {await callApi('login',{password:document.getElementById('password').value}); await loadData();}
    catch(err){showError(err.message); btn.disabled=false; btn.textContent='Sign in';}
  });
}
function cell(value){return `<td>${esc(value ?? '—')}</td>`;}
function renderDashboard(){
  const done=sessions.filter(x=>Boolean(x.completed_at));
  const assignA=sessions.filter(x=>x.version==='A').length;
  const assignB=sessions.filter(x=>x.version==='B').length;
  const completeA=done.filter(x=>x.version==='A').length;
  const completeB=done.filter(x=>x.version==='B').length;
  const posCertain=done.filter(x=>(x.version==='A'?x.answers?.scenario1:x.answers?.scenario2)==='A').length;
  const negRisky=done.filter(x=>(x.version==='A'?x.answers?.scenario2:x.answers?.scenario1)==='B').length;
  const both=done.filter(x=>(x.version==='A'?x.answers?.scenario1:x.answers?.scenario2)==='A' && (x.version==='A'?x.answers?.scenario2:x.answers?.scenario1)==='B').length;
  root.innerHTML=`<div class="research-banner"><div><p class="eyebrow">Researcher workspace</p><h1>Experiment results</h1><p>Live counts and paired responses · SAS Psychology IA</p></div>
    <div style="display:flex;gap:9px;flex-wrap:wrap"><button class="btn ghost" id="refresh">Refresh</button><button class="btn" id="export">Download CSV ↓</button><button class="btn ghost" id="logout">Sign out</button></div></div>
  <div class="metrics">
    <div class="metric"><div class="metric-label">Completed surveys</div><div class="metric-value">${done.length}</div><div class="metric-help">${sessions.length} assigned in total</div></div>
    <div class="metric"><div class="metric-label">Version A</div><div class="metric-value">${completeA}</div><div class="metric-help">${assignA} participants assigned</div></div>
    <div class="metric"><div class="metric-label">Version B</div><div class="metric-value">${completeB}</div><div class="metric-help">${assignB} participants assigned</div></div>
    <div class="metric"><div class="metric-label">Completed both conditions</div><div class="metric-value">${done.length}</div><div class="metric-help">Paired outcomes available</div></div>
  </div>
  <section class="research-panel"><div class="panel-top"><div><h2>Framing outcomes</h2><small>Calculated from completed questionnaires only</small></div></div>
  <div class="metrics" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:10px 0 0">
    <div class="metric"><div class="metric-label">Positive frame → certain (A)</div><div class="metric-value">${pct(posCertain,done.length)}</div><div class="metric-help">${posCertain} of ${done.length} respondents</div></div>
    <div class="metric"><div class="metric-label">Negative frame → risky (B)</div><div class="metric-value">${pct(negRisky,done.length)}</div><div class="metric-help">${negRisky} of ${done.length} respondents</div></div>
    <div class="metric"><div class="metric-label">Both predicted choices</div><div class="metric-value">${pct(both,done.length)}</div><div class="metric-help">${both} students chose certain (+) and risky (−)</div></div>
  </div><p class="data-note">Plan A is the certain outcome and Plan B is the risky outcome in both main scenarios. The five preference questions are not used in these framing percentages.</p></section>
  <section class="research-panel"><div class="panel-top"><div><h2>Anonymous responses</h2><small>${sessions.length} sessions · Most recent records appear last</small></div><small>Dates shown in Singapore time</small></div>
  <div class="table-wrap"><table class="data-table"><thead><tr><th>Anonymous ID</th><th>Version</th><th>Status</th><th>Scenario 1 frame</th><th>S1</th><th>Distraction 1</th><th>D2</th><th>D3</th><th>D4</th><th>D5</th><th>Scenario 2 frame</th><th>S2</th><th>Positive</th><th>Negative</th><th>Completed at</th></tr></thead>
  <tbody>${sessions.length ? sessions.map(s=>{
    const a=s.answers||{};
    const pos=s.version==='A'?a.scenario1:a.scenario2;
    const neg=s.version==='A'?a.scenario2:a.scenario1;
    return `<tr>${cell(s.id.slice(0,8))}${cell(s.version)}<td><span class="pill ${s.completed_at?'good':'warn'}">${s.completed_at?'Completed':'Incomplete'}</span></td>${cell(framing(s.version,true))}${cell(a.scenario1)}${[1,2,3,4,5].map(n=>cell(a[`distraction${n}`])).join('')}${cell(framing(s.version,false))}${cell(a.scenario2)}${cell(s.completed_at?pos:'')}${cell(s.completed_at?neg:'')}${cell(fmt(s.completed_at))}</tr>`;
  }).join(''):`<tr><td colspan="15">No responses have been recorded yet.</td></tr>`}</tbody></table></div>
  <div id="error-slot"></div><p class="data-note">Anonymous IDs are generated by the system; participants are not asked for a name, email address, or student ID. The CSV also contains incomplete sessions to help you check dropout.</p>
  </section>`;
  document.getElementById('refresh').addEventListener('click',loadData);
  document.getElementById('logout').addEventListener('click',async()=>{try{await callApi('logout',{});}catch{}showLogin();});
  document.getElementById('export').addEventListener('click',downloadCsv);
}
async function downloadCsv(){
  const button=document.getElementById('export');button.disabled=true;button.textContent='Preparing CSV…';
  try{
    const result=await fetch('/api/export',{credentials:'same-origin',cache:'no-store'});
    if(!result.ok)throw new Error('Could not download responses. Sign in again if your session expired.');
    const url=URL.createObjectURL(await result.blob());
    const a=document.createElement('a');a.href=url;a.download='sas-framing-study-responses.csv';
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }catch(e){showError(e.message);}finally{button.disabled=false;button.textContent='Download CSV ↓';}
}
async function loadData(){
  try{const data=await callApi('research');sessions=data.sessions||[];renderDashboard();}
  catch(e){if(e.status===401)showLogin();else showLogin(e.message);}
}
loadData();
