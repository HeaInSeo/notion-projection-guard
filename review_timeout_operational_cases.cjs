'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {OperationalLedger,writeNew,digest} = require('./review_timeout_operational_ledger.cjs');
const {budgetKey} = require('./review_timeout_ledger.cjs');
const {assess,scopeKey,WARNING_MS,TIMEOUT_MS} = require('./review_timeout_policy.cjs');
const {migrate,decisionFor} = require('./review_timeout_history.cjs');
const {validateGrant,makeTransport,REQUIRED_GATES,pages} = require('./review_timeout_github.cjs');
const {tick,scheduledProof,barrierFor} = require('./review_timeout_operational.cjs');
const {runTask} = require('./review_timeout_operational_worker.cjs');
const {runIsolated} = require('./review_timeout_isolated.cjs');
const scope = {repo:'Example/Project',pr:7,head:'a'.repeat(40),base:'b'.repeat(40)};
const handoff = {nextOwner:'central',next:'Inspect real results.',nextTrigger:'New provider evidence.'};
const fixture = path.join(__dirname,'test-fixtures/review_timeout_operational_transport.cjs');
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'review-operational-'));
  fs.chmodSync(root,0o700);
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function comment(id,at,{head=scope.head,base=scope.base,body=null}={}) {
  return {id,created_at:new Date(at).toISOString(),updated_at:new Date(at).toISOString(),
    user:{login:'owner'},html_url:'https://github.com/Example/Project/issues/7#issuecomment-' + id,
    body:body ?? '@codex review\nExact head: ' + head + '\nBase: ' + base};
}
function snapshot(comments,extra={}) {
  return {version:1,repo:scope.repo,pr:scope.pr,complete:true,
    observedAt:new Date().toISOString(),current:{...scope},comments,reviews:[],
    inlineComments:[],threads:[],metadata:{state:'open',draft:false,
      head:{sha:scope.head},base:{sha:scope.base}},...extra};
}
async function ledger(t) {
  const root = temp(t), l = new OperationalLedger(root);
  await l.initialize();
  const token = await l.acquire('central',300000,(await l.read()).revision);
  return {root,l,token};
}
async function imported(t,age=TIMEOUT_MS+1000,two=false) {
  const x = await ledger(t), now = Date.now();
  const comments = [comment(1,now-age-(two?TIMEOUT_MS+1000:0))];
  if (two) comments.push(comment(2,now-age));
  const snap = snapshot(comments), evidence = writeNew(x.root,'history.json',snap);
  const migration = migrate(snap,evidence.sha256,'central');
  const state = await x.l.importObserved(x.token,(await x.l.read()).revision,evidence,migration);
  return {...x,snap,state};
}
function transport(counter,other={}) {
  return {readCurrent:async () => ({...scope}),
    checkEligibility:async ({scope,owner,fence}) => ({allowed:true,
      scopeKey:scopeKey(scope),owner,fence,receipt:'verified-gates'}),
    send:async () => { counter.count++; return 'synthetic-provider-receipt'; },...other};
}
test('production policy boundaries: 30 minutes warns; exactly 60 does not time out',() => {
  const now = Date.now(), snap = snapshot([comment(1,now-TIMEOUT_MS)]);
  const c = migrate(snap,'evidence','central').chains[0];
  assert.equal(assess({...c,observedAt:new Date(now).toISOString()}).action,'WARN');
  assert.equal(assess({...c,observedAt:new Date(now+1).toISOString()}).action,'REPLACEMENT_CANDIDATE');
  c.attempts[0].intentAt = new Date(now-WARNING_MS+1).toISOString();
  assert.equal(assess({...c,observedAt:new Date(now).toISOString()}).action,'WAIT');
  c.attempts[0].intentAt = new Date(now-WARNING_MS).toISOString();
  assert.equal(assess({...c,observedAt:new Date(now).toISOString()}).action,'WARN');
});
test('a real two-request migration preserves the spent replacement after reload',async t => {
  const {l,token,state,root} = await imported(t,TIMEOUT_MS+1000,true);
  assert.equal(state.chains[0].attempts.length,2);
  const reloaded = await new OperationalLedger(root).read();
  assert.equal(reloaded.chains[0].attempts[1].parentRequestId,'github-comment:1');
  const count = {count:0};
  const d = await l.dispatchReplacement(token,reloaded.revision,budgetKey(scope),transport(count));
  assert.equal(d.reason,'REPLACEMENT_TIMEOUT'); assert.equal(count.count,0);
});
test('case/base changes cannot replenish the same head budget',async t => {
  const {l,token,state} = await imported(t);
  const count = {count:0};
  await assert.rejects(l.dispatchOriginal(token,state.revision,
    {...scope,repo:scope.repo.toLowerCase(),base:'c'.repeat(40)},handoff,transport(count)),
  /HEAD_BUDGET_EXISTS/);
  assert.equal(count.count,0);
});
test('three historical sends and missing scopes are quarantined, never re-imported as one',() => {
  const now=Date.now();
  const result=migrate(snapshot([comment(1,now-20000000),comment(2,now-10000000),
    comment(3,now-1000),comment(4,now-500,{body:'@codex review'})]),'e','central');
  assert.equal(result.chains.length,0);
  assert.equal(result.quarantine.length,2);
});
test('new legacy history cannot overwrite an existing chain or reset UNKNOWN',async t => {
  const {l,root,token,state} = await imported(t);
  const c=state.chains[0];
  const snap=snapshot([comment(1,Date.parse(c.attempts[0].intentAt)),
    comment(2,Date.now()-1000)]);
  const evidence=writeNew(root,'later-history.json',snap);
  const next=await l.importObserved(token,state.revision,evidence,
    migrate(snap,evidence.sha256,'central',state.chains));
  assert.equal(next.chains[0].attempts.length,1);
  assert(next.historyQuarantine.some(q => q.reason==='UNRECONCILED_EXISTING_CHAIN_EXTENSION'));
});
test('initial request intent is durable before the first provider call',async t => {
  const {l,root,token}=await ledger(t), count={count:0};
  const tx=transport(count,{send:async attempt => {
    const disk=JSON.parse(fs.readFileSync(path.join(root,'review-attempts.json'),'utf8'));
    assert.equal(disk.chains[0].attempts[0].delivery,'UNKNOWN');
    assert.equal(disk.chains[0].attempts[0].requestId,attempt.requestId);
    count.count++;return 'provider-receipt';
  }});
  const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,tx);
  assert.equal(r.action,'REQUEST_RECORDED');assert.equal(count.count,1);
  assert.equal((await l.read()).chains[0].attempts[0].delivery,'ACKNOWLEDGED');
});
test('uncertain initial delivery is not sent again after reload',async t => {
  const {l,root,token}=await ledger(t),count={count:0};
  const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
    transport(count,{send:async()=>{count.count++;throw Error('connection dropped after send');}}));
  assert.equal(r.reason,'UNCERTAIN_SEND');
  const state=await new OperationalLedger(root).read();
  assert.equal(state.chains[0].attempts[0].delivery,'UNKNOWN');
  await assert.rejects(l.dispatchOriginal(token,state.revision,scope,handoff,transport(count)),
    /HEAD_BUDGET_EXISTS/);
  assert.equal(count.count,1);
});
test('stale token and revision cannot issue an initial request',async t => {
  const {l,token}=await ledger(t),state=await l.read(),count={count:0};
  await assert.rejects(l.dispatchOriginal({...token,fence:token.fence+1},
    state.revision,scope,handoff,transport(count)),/STALE_OR_EXPIRED_OWNER/);
  await assert.rejects(l.dispatchOriginal(token,state.revision-1,scope,handoff,transport(count)),
    /REVISION_CONFLICT/);
  assert.equal(count.count,0);
});
test('revalidation change after intent spends the initial budget without a send',async t => {
  const {l,token}=await ledger(t),count={count:0};let calls=0;
  const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
    transport(count,{readCurrent:async()=>++calls===1?scope:{...scope,base:'c'.repeat(40)}}));
  assert.equal(r.reason,'REVALIDATION_AFTER_INTENT_FAILED');
  assert.equal(count.count,0);assert.equal((await l.read()).chains[0].attempts[0].delivery,'UNKNOWN');
});
for(const behavior of ['sync-infinite','exit-after-send']) test(
  'actual isolated original worker '+behavior+' leaves one UNKNOWN and never cancels provider',async t=>{
    const {l,root,token}=await ledger(t),state=await l.read();
    const deliveryFile=path.join(root,'deliveries');
    const r=await runTask({operation:'original',transportModule:fixture,directory:root,
      token,revision:state.revision,scope,handoff,timeoutMs:700,ioTimeoutMs:500,
      context:{scope,ledgerFile:path.join(root,'review-attempts.json'),deliveryFile,behavior}});
    assert.equal(r.action,'BLOCKED');
    assert.equal(r.providerTermination,'UNKNOWN');
    assert.equal(r.localWorkerExitConfirmed,true);
    const s=await new OperationalLedger(root).read();
    assert.equal(s.chains[0].attempts[0].delivery,'UNKNOWN');
    assert.equal(fs.readFileSync(deliveryFile,'utf8').trim().split('\n').length,1);
    await assert.rejects(l.dispatchOriginal(token,s.revision,scope,handoff,transport({count:0})),
      /HEAD_BUDGET_EXISTS/);
  });
test('replacement operational transport runs under the original PR9 isolated entry',async t=>{
  const {l,root,token,state}=await imported(t);
  const r=await runIsolated({directory:root,token,revision:state.revision,key:budgetKey(scope),
    transportModule:fixture,timeoutMs:2500,ioTimeoutMs:1000,context:{scope,
      ledgerFile:path.join(root,'review-attempts.json'),deliveryFile:path.join(root,'deliveries')}});
  assert.equal(r.action,'REQUEST_RECORDED');
  assert.equal((await l.read()).chains[0].attempts.length,2);
});
test('late predecessor finding blocks even a newer shared clean summary',()=>{
  const now=Date.now(),snap=snapshot([comment(1,now-20000000),comment(2,now-10000000)],
    {threads:[{id:'late-finding',isResolved:false}]});
  snap.comments.push({id:3,user:{login:'chatgpt-codex-connector[bot]'},
    updated_at:new Date(now).toISOString(),body:'<!-- codex-review-state:v1 '+
      JSON.stringify({code_review:{commit_sha:scope.head,status:'completed'}})+
      ' --> <relative-time datetime="'+new Date(now).toISOString()+'">now</relative-time>'});
  const c=migrate(snap,'e','central').chains[0];
  const d=decisionFor(c,{historyQuarantine:[]},snap,now);
  assert.equal(d.reason,'PROVIDER_FINDING_DISPOSITION_REQUIRED');
  assert.deepEqual(d.retainedFindingIds,['late-finding']);
});
test('shared summary never becomes a request-specific clean result',()=>{
  const now=Date.now(),snap=snapshot([comment(1,now-20000000)]);
  snap.comments.push({id:3,user:{login:'chatgpt-codex-connector[bot]'},
    updated_at:new Date(now).toISOString(),body:'<!-- codex-review-state:v1 '+
      JSON.stringify({code_review:{commit_sha:scope.head,status:'completed'}})+
      ' --> <relative-time datetime="'+new Date(now).toISOString()+'">now</relative-time>'});
  const c=migrate(snap,'e','central').chains[0];
  const d=decisionFor(c,{historyQuarantine:[]},snap,now);
  assert.equal(d.action,'RECONCILE_RESULTS');assert.equal(d.gate,'NOT_ASSESSED');
  assert.equal(c.results.length,0);
});
function grant(now=Date.now()) {
  const content='fresh canonical source';
  return {version:1,owner:'central',fence:1,scope,runId:'actual-run',
    observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),
    sourceEvaluator:'EXISTING_CENTRAL_POLICY_OWNER',
    sources:[{id:'canonical',url:'https://app.notion.com/p/source',content,
      sha256:digest(content),retrievedAt:new Date(now).toISOString()}],
    gates:Object.fromEntries(REQUIRED_GATES.map(k=>[k,{state:'PASS',
      sourceIds:['canonical'],explanation:'Existing owner checked '+k}]))};
}
test('fresh full-gate central attestation binds exact owner, fence, scope and run',()=>{
  assert(validateGrant(grant(),{scope,owner:'central',fence:1,runId:'actual-run'}));
  for(const mutate of [
    x=>x.fence++,x=>x.scope={...scope,base:'c'.repeat(40)},
    x=>x.gates.wip.state='HOLD',x=>delete x.gates.usage,
    x=>x.sources[0].content+='changed',x=>x.observedAt=new Date(Date.now()-61000).toISOString()
  ]){const g=grant();mutate(g);assert.throws(()=>validateGrant(g,
    {scope,owner:'central',fence:1,runId:'actual-run'}));}
});
test('canonical barriers keep their positively scoped independent repo free',t=>{
  const root=temp(t),p=path.join(root,'journal.json');
  fs.writeFileSync(p,JSON.stringify({active:'batch',batches:{batch:{status:'HALTED'}}}));
  const cfg={canonicalJournal:p,barrierScopes:{batch:['Example/Project']}};
  assert.equal(barrierFor(cfg,scope).status,'HALTED');
  assert.equal(barrierFor(cfg,{...scope,repo:'Example/Independent'}),null);
});
test('actual provider POST has exactly one intent and no retry after uncertain send',async t=>{
  const {root,l,token}=await ledger(t);let posts=0;
  const config={version:1,owner:'central',channel:'GITHUB_CODEX',directory:root,
    allowedRepos:[scope.repo]};
  const tx=makeTransport(config,{owner:'central',token},async(method,route)=>{
    if(method==='POST'){posts++;throw Error('uncertain socket outcome');}
    return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
  });
  const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
    transport({count:0},{send:tx.send}));
  assert.equal(r.reason,'UNCERTAIN_SEND');
  assert.equal(posts,1);
});
test('provider send refuses a stale fence before the POST',async t=>{
  const {root,token}=await ledger(t);let posts=0;
  const tx=makeTransport({version:1,owner:'central',channel:'GITHUB_CODEX',directory:root,
    allowedRepos:[scope.repo]},{owner:'central',token:{...token,id:'stale'}},async method=>{
      if(method==='POST')posts++;
      return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
    });
  await assert.rejects(tx.send({requestId:'id',scope,parentRequestId:null,reservedBy:token}),
    /owner expired/);
  assert.equal(posts,0);
});
test('head change before provider send makes zero POSTs',async t=>{
  const {root,token}=await ledger(t);let posts=0;
  const tx=makeTransport({version:1,owner:'central',channel:'GITHUB_CODEX',directory:root,
    allowedRepos:[scope.repo]},{owner:'central',token},async method=>{
      if(method==='POST')posts++;
      return {state:'open',draft:false,head:{sha:'c'.repeat(40)},base:{sha:scope.base}};
    });
  await assert.rejects(tx.send({requestId:'id',scope,parentRequestId:null,reservedBy:token}),
    /scope changed before/);assert.equal(posts,0);
});
test('two isolated original workers sharing the same revision cannot send twice',async t=>{
  const {l,root,token}=await ledger(t),state=await l.read();
  const deliveryFile=path.join(root,'deliveries');
  const input={operation:'original',transportModule:fixture,directory:root,token,
    revision:state.revision,scope,handoff,timeoutMs:2500,ioTimeoutMs:1000,
    context:{scope,ledgerFile:path.join(root,'review-attempts.json'),deliveryFile}};
  const results=await Promise.all([runTask(input),runTask(input)]);
  assert.equal(results.filter(r=>r.action==='REQUEST_RECORDED').length,1);
  assert.equal(fs.readFileSync(deliveryFile,'utf8').trim().split('\n').length,1);
});
test('pagination exhausts exactly full pages rather than assuming LIMIT is complete',async()=>{
  const routes=[];
  const values=await pages(async(_,route)=>{routes.push(route);
    return route.endsWith('page=1')?Array(100).fill(1):[2];},'/resource');
  assert.equal(values.length,101);assert.equal(routes.length,2);
});
test('scheduled label without an actual current automation-run proof is rejected',t=>{
  const root=temp(t),proofFile=path.join(root,'proof.json');
  fs.writeFileSync(proofFile,JSON.stringify({source:'AUTOMATIONS_PEEK',
    automationId:'a',isEnabled:true,schedule:'schedule',run:{id:'run',
      recorded_status:'completed',started_at:new Date().toISOString()},
    retrievedAt:new Date().toISOString()}),{mode:0o600});
  assert.throws(()=>scheduledProof({automationId:'a',schedule:'schedule'},
    {origin:'SCHEDULED',runId:'run',schedulerEvidenceFile:proofFile}),/actual currently running/);
});
test('real operational tick imports, assesses and writes a receipt without sending',async t=>{
  const root=temp(t),dir=path.join(root,'ledger'),evidenceDirectory=path.join(root,'evidence');
  fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(evidenceDirectory,{mode:0o700});
  await new OperationalLedger(dir).initialize();
  const journal=path.join(root,'journal.json');
  fs.writeFileSync(journal,JSON.stringify({active:'batch',batches:{batch:{status:'HALTED'}}}));
  const result=await tick({owner:'central',directory:dir,evidenceDirectory,
    allowedRepos:[scope.repo],seedTargets:[{repo:scope.repo,pr:scope.pr}],discoverOpen:false,
    canonicalJournal:journal,legacyConstraints:[]},
  {origin:'MANUAL_VERIFICATION',actor:'manual-owner',runId:'manual'},
  {observer:async()=>({action:'OBSERVED',
    snapshot:snapshot([comment(1,Date.now()-TIMEOUT_MS-1000)])})});
  assert.equal(result.receipt.decisions[0].reason,'EXISTING_CANONICAL_BARRIER');
  assert.equal(result.receipt.decisions[0].timedOut,true);
  assert.equal(result.receipt.newRequests,0);
  const disk=JSON.parse(fs.readFileSync(result.evidence.file,'utf8'));
  assert.equal(disk.origin,'MANUAL_VERIFICATION');
  assert.equal(disk.wipContract,'SEPARATE_UNCHANGED');
  assert.equal((await new OperationalLedger(dir).read()).lease,null);
});
