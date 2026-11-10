import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario1,scenario2,distractions} from '../public/content.js';
import api from '../netlify/functions/api.mjs';

function assertEquivalent(scenario,n,probability,certainAttendees){
  const pos=scenario.positive,neg=scenario.negative;
  assert.match(scenario.paragraphs.join(' '),new RegExp(`\\b${n}\\b`));
  assert.match(pos.A,new RegExp(`\\b${certainAttendees}\\b`));
  assert.match(neg.A,new RegExp(`\\b${n-certainAttendees}\\b`));
  assert.match(pos.B,new RegExp(`\\b${n}\\b`));
  assert.match(neg.B,new RegExp(`\\b${n}\\b`));
  assert.equal(n*probability,certainAttendees);
}

test('field trip uses 400, 1/4 probability and mathematically equivalent options',()=>{
  assertEquivalent(scenario1,400,1/4,100);
  assert.match(scenario1.positive.B,/1\/4 chance/);
  assert.match(scenario1.positive.B,/3\/4 chance/);
  assert.match(scenario1.negative.B,/1\/4 chance/);
  assert.match(scenario1.negative.B,/3\/4 chance/);
  assert.doesNotMatch(JSON.stringify(scenario1),/\b500\b/);
});

test('concert keeps 600, 1/3 probability and mathematically equivalent options',()=>{
  assertEquivalent(scenario2,600,1/3,200);
  assert.match(scenario2.positive.B,/1\/3 chance/);
  assert.match(scenario2.negative.B,/2\/3 chance/);
});

test('all five distractions have A and B choices with numerically meaningful information',()=>{
  assert.equal(distractions.length,5);
  for (const d of distractions){
    assert.ok(d.paragraphs.join(' ').length>200);
    assert.ok(d.options.A.length>20 && d.options.B.length>20);
    assert.match(d.options.A,/\d/);
    assert.match(d.options.B,/\d/);
    assert.ok(d.prompt);
  }
});

test('server refuses starting without consent',async()=>{
  const req=new Request('https://example.net/api/start',{method:'POST',body:JSON.stringify({consent:false}),headers:{'Content-Type':'application/json'}});
  const response=await api(req);
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/Consent/);
});

test('server blocks cross-site POST requests',async()=>{
  const req=new Request('https://example.net/api/start',{method:'POST',body:JSON.stringify({consent:true}),headers:{'Content-Type':'application/json',origin:'https://malicious.test'}});
  const response=await api(req);
  assert.equal(response.status,403);
});

test('server rejects non multiple-choice response',async()=>{
  const req=new Request('https://example.net/api/answer',{method:'POST',body:JSON.stringify({id:'nope',step:4,choice:'C'}),headers:{'Content-Type':'application/json'}});
  const response=await api(req);
  assert.equal(response.status,400);
});

test('researcher data requires a signed login, and authorized sessions can fetch data',async()=>{
  const envKeys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEARCHER_PASSWORD','RESEARCHER_SESSION_SECRET'];
  const previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
  const originalFetch=global.fetch;
  try {
    process.env.SUPABASE_URL='https://sample.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY='server-only-test-key';
    process.env.RESEARCHER_PASSWORD='example-super-secret-for-testing';
    process.env.RESEARCHER_SESSION_SECRET='unpredictable-session-secret-example-for-test';
    global.fetch=async (url)=>{
      assert.match(url,/sample\.supabase\.co\/rest\/v1\/study_sessions/);
      return new Response(JSON.stringify([{
        id:'e5cb026f-f932-4147-8edc-c3d1d6acde51',version:'A',step:7,
        answers:{scenario1:'A',distraction1:'B',distraction2:'A',distraction3:'B',distraction4:'A',distraction5:'B',scenario2:'B'},
        started_at:'2026-11-10T14:00:00Z', completed_at:'2026-11-10T14:10:00Z'
      }]),{status:200,headers:{'content-type':'application/json'}});
    };
    const unauthorized=await api(new Request('https://demo.test/api/research'));
    assert.equal(unauthorized.status,401);
    const login=await api(new Request('https://demo.test/api/login',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:process.env.RESEARCHER_PASSWORD})
    }));
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
    const authorized=await api(new Request('https://demo.test/api/research',{headers:{cookie}}));
    assert.equal(authorized.status,200);
    const result=await authorized.json();
    assert.equal(result.sessions.length,1);
    assert.equal(result.sessions[0].version,'A');
  } finally {
    global.fetch=originalFetch;
    for(const k of envKeys){if(previous[k]===undefined) delete process.env[k]; else process.env[k]=previous[k];}
  }
});
