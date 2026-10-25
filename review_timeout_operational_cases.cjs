'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {OperationalLedger,writeNew,digest,persistObservationInbox,retainedFindingHolds} =
  require('./review_timeout_operational_ledger.cjs');
const {budgetKey} = require('./review_timeout_ledger.cjs');
const {assess,scopeKey,WARNING_MS,TIMEOUT_MS} = require('./review_timeout_policy.cjs');
const {migrate,decisionFor} = require('./review_timeout_history.cjs');
const {validateGrant,makeTransport,REQUIRED_GATES,pages,providerStateHolds,canonicalBarrier} =
  require('./review_timeout_github.cjs');
const {tick,scheduledProof,barrierFor,reconcile} = require('./review_timeout_operational.cjs');
const {outboundRecord,requestBody,providerFindings} = require('./review_timeout_evidence.cjs');
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
  assert.equal(d.retainedFindingIds.length,1);
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
  fs.writeFileSync(p,JSON.stringify({active:'batch',batches:{batch:{status:'HALTED',planHash:'a'.repeat(64)}}}));
  const cfg={canonicalJournal:p,barrierScopes:{batch:['Example/Project']},
    barrierPlanHashes:{batch:'a'.repeat(64)}};
  assert.equal(barrierFor(cfg,scope).status,'HALTED');
  assert.equal(barrierFor(cfg,{...scope,repo:'Example/Independent'}),null);
});
test('actual provider POST has exactly one intent and no retry after uncertain send',async t=>{
  const {root,l,token}=await ledger(t);let posts=0;
  const journal=path.join(root,'journal.json'),grantFile=path.join(root,'grant.json');
  fs.writeFileSync(journal,JSON.stringify({active:null}));
  fs.writeFileSync(grantFile,JSON.stringify(grant()),{mode:0o600});
  const config={version:1,owner:'central',channel:'GITHUB_CODEX',directory:root,
    allowedRepos:[scope.repo],canonicalJournal:journal,requesterLogin:'owner'};
  persistObservationInbox(root,snapshot([]));
  const tx=makeTransport(config,{owner:'central',token,grantFile,runId:'actual-run'},async(method,route)=>{
    if(method==='POST'){posts++;throw Error('uncertain socket outcome');}
    return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
  });
  const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
    transport({count:0},{send:tx.send}));
  assert.equal(r.reason,'UNCERTAIN_SEND');
  assert.equal(posts,1);
});
for(const change of ['expired-grant','new-barrier']) test(
  'actual POST rechecks '+change+' after awaited provider scope read',async t=>{
    const {root,l,token}=await ledger(t);let posts=0;
    const journal=path.join(root,'journal.json'),grantFile=path.join(root,'grant.json');
    fs.writeFileSync(journal,JSON.stringify({active:null}));
    fs.writeFileSync(grantFile,JSON.stringify(grant()),{mode:0o600});
    const config={version:1,owner:'central',channel:'GITHUB_CODEX',directory:root,
      allowedRepos:[scope.repo],canonicalJournal:journal,requesterLogin:'owner'};
    persistObservationInbox(root,snapshot([]));
    const tx=makeTransport(config,{owner:'central',token,grantFile,runId:'actual-run'},
      async method=>{
        if(method==='POST')posts++;
        if(change==='new-barrier')
          fs.writeFileSync(journal,JSON.stringify({active:'new',batches:{new:{status:'HALTED'}}}));
        else {const g=grant();g.expiresAt=new Date(Date.now()-1).toISOString();
          fs.writeFileSync(grantFile,JSON.stringify(g),{mode:0o600});}
        return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
      });
    const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
      transport({count:0},{send:tx.send}));
    assert.equal(r.reason,'UNCERTAIN_SEND');assert.equal(posts,0);
    assert.equal((await l.read()).chains[0].attempts[0].delivery,'UNKNOWN');
  });
test('a stale barrier scope mapping cannot exempt an unrelated repo',t=>{
  const root=temp(t),p=path.join(root,'journal.json');
  fs.writeFileSync(p,JSON.stringify({active:'batch',batches:{batch:{status:'HALTED',planHash:'new'}}}));
  const cfg={canonicalJournal:p,barrierScopes:{batch:['Example/Project']},barrierPlanHashes:{batch:'old'}};
  assert.equal(barrierFor(cfg,{...scope,repo:'Example/Independent'}).reason,'EXISTING_CANONICAL_BARRIER');
});
test('terminated PR history cannot be offered as a new timeout replacement',()=>{
  const now=Date.now(),snap=snapshot([comment(1,now-TIMEOUT_MS-1000)],
    {metadata:{state:'closed',merged:true}});
  const c=migrate(snap,'e','central').chains[0];
  const d=decisionFor(c,{historyQuarantine:[]},snap,now);
  assert.equal(d.action,'HISTORICAL');assert.equal(d.dispatchAuthorized,false);
});
test('provider send refuses a stale fence before the POST',async t=>{
  const {root,token}=await ledger(t);let posts=0;
  const tx=makeTransport({version:1,owner:'central',requesterLogin:'owner',channel:'GITHUB_CODEX',directory:root,
    allowedRepos:[scope.repo]},{owner:'central',token:{...token,id:'stale'}},async method=>{
      if(method==='POST')posts++;
      return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
    });
  await assert.rejects(tx.send({requestId:'01234567-89ab-4def-8123-0123456789ab',scope,parentRequestId:null,reservedBy:token}),
    /owner expired/);
  assert.equal(posts,0);
});
test('head change before provider send makes zero POSTs',async t=>{
  const {root,token}=await ledger(t);let posts=0;
  const tx=makeTransport({version:1,owner:'central',requesterLogin:'owner',channel:'GITHUB_CODEX',directory:root,
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
test('an observed finding remains enforced after it disappears or becomes resolved',async t=>{
  const {root,l,token}=await ledger(t),start=Date.now()-TIMEOUT_MS-1000;
  const first=snapshot([comment(1,start)],{threads:[{id:'valid-finding',isResolved:false,
    comments:{nodes:[{databaseId:7,body:'[P2] real retained defect',
      author:{login:'chatgpt-codex-connector[bot]'},commit:{oid:scope.head}}]}}]});
  const e1=writeNew(root,'first.json',first);
  let state=await l.importObserved(token,(await l.read()).revision,e1,{owner:'central',requesterLogin:'owner'});
  assert.equal(state.providerFindings.length,1);
  const gone=snapshot([comment(1,start)]);
  const e2=writeNew(root,'gone.json',gone);
  state=await l.importObserved(token,state.revision,e2,{owner:'central',requesterLogin:'owner'});
  assert.equal(decisionFor(state.chains[0],state,gone).reason,'PROVIDER_FINDING_DISPOSITION_REQUIRED');
  const resolved=structuredClone(first);resolved.observedAt=new Date().toISOString();
  resolved.threads[0].isResolved=true;
  const e3=writeNew(root,'resolved.json',resolved);
  state=await l.importObserved(token,state.revision,e3,{owner:'central',requesterLogin:'owner'});
  assert.equal(state.providerFindings[0].disposition,'OPEN');
  assert.equal(decisionFor(state.chains[0],state,resolved).action,'BLOCKED');
});
test('only explicit responsible-owner/current-scope evidence disposes a retained finding',async t=>{
  const {root,l,token}=await ledger(t);
  const snap=snapshot([comment(1,Date.now()-TIMEOUT_MS-1000)],
    {threads:[{id:'valid-finding',isResolved:true,comments:{nodes:[]}}]});
  let state=await l.importObserved(token,(await l.read()).revision,
    writeNew(root,'history.json',snap),{owner:'central',requesterLogin:'owner'});
  const f=state.providerFindings[0],content='synthetic exact source/code evidence';
  const packet={version:1,findingId:f.id,definitionSha256:f.definitionSha256,
    owner:'central',responsibleOwner:'existing-writer',sourceEvaluator:'EXISTING_CENTRAL_POLICY_OWNER',
    disposition:'FIXED',assessedScope:scope,assessedAt:new Date().toISOString(),
    explanation:'Synthetic reproduction fixed and independently checked.',
    sources:[{url:'https://github.com/Example/Project/commit/'+scope.head,
      content,sha256:digest(content)}]};
  const bad=writeNew(root,'bad-disposition.json',{...packet,owner:'wrong-owner'});
  await assert.rejects(l.disposeProviderFinding(token,state.revision,f.id,bad),/explicit owner/);
  const proof=writeNew(root,'good-disposition.json',packet);
  state=await l.disposeProviderFinding(token,state.revision,f.id,proof);
  assert.deepEqual(retainedFindingHolds(state,scope),[]);
  assert.equal(retainedFindingHolds(state,{...scope,head:'c'.repeat(40)}).length,1);
  fs.writeFileSync(proof.file,'corrupt evidence\n',{mode:0o600});
  assert.equal(retainedFindingHolds(state,scope).length,1);
});
test('a callback finding inbox blocks actual POST even if the later provider page omits it',async t=>{
  const {root,l,token}=await ledger(t);
  const snap=snapshot([],{threads:[{id:'late-hidden-finding',isResolved:false}]});
  persistObservationInbox(root,snap);
  persistObservationInbox(root,snapshot([]));
  const config={version:1,owner:'central',requesterLogin:'owner',channel:'GITHUB_CODEX',
    directory:root,allowedRepos:[scope.repo]};
  assert.equal(providerStateHolds(config,await l.read(),scope).reason,'PROVIDER_FINDING_DISPOSITION_REQUIRED');
  let state=await l.importObserved(token,(await l.read()).revision,
    writeNew(root,'gone-provider.json',snapshot([])),{owner:'central',requesterLogin:'owner'});
  assert.equal(state.providerFindings.length,1);
  assert.equal(state.providerFindings[0].disposition,'OPEN');
});
test('observed then deleted extra requests cannot disappear from effective retry accounting',async t=>{
  const {root,l,token,state}=await imported(t,2*TIMEOUT_MS+2000);
  const first=state.chains[0].attempts[0];
  const extra=snapshot([comment(1,Date.parse(first.intentAt)),
    comment(2,Date.parse(first.intentAt)+TIMEOUT_MS+1000)]);
  persistObservationInbox(root,extra);
  const now=snapshot([comment(1,Date.parse(first.intentAt))]);
  persistObservationInbox(root,now);
  const cfg={version:1,owner:'central',requesterLogin:'owner',channel:'GITHUB_CODEX',
    directory:root,allowedRepos:[scope.repo]};
  assert.equal(providerStateHolds(cfg,await l.read(),scope).reason,'PROVIDER_REQUEST_NOT_IN_DURABLE_LEDGER');
  const next=await l.importObserved(token,(await l.read()).revision,
    writeNew(root,'later.json',now),{owner:'central',requesterLogin:'owner'});
  assert(next.historyQuarantine.some(q=>q.reason==='UNRECONCILED_EXISTING_CHAIN_EXTENSION'));
});
test('an explicit exact head wins over Previous head without creating another budget',()=>{
  const now=Date.now(),c='c'.repeat(40),d='d'.repeat(40);
  const first=comment(1,now-2*TIMEOUT_MS-2000,{body:'@codex review\nPrevious head: '+d+
    '\nExact head: '+c+'\nBase: '+scope.base});
  const second=comment(2,now-1000,{head:c});
  const result=migrate(snapshot([first,second]),'e','central');
  assert.equal(result.chains.length,1);assert.equal(result.chains[0].scope.head,c);
  assert.equal(result.chains[0].attempts.length,2);
});
test('conflicting explicit head labels are quarantined rather than guessed',()=>{
  const c=comment(1,Date.now()-1000,{body:'@codex review\nExact head: '+scope.head+
    '\nExact head: '+'c'.repeat(40)+'\nBase: '+scope.base});
  const r=migrate(snapshot([c]),'e','central');
  assert.equal(r.chains.length,0);assert.equal(r.quarantine.length,1);
});
test('uppercase SHA input is canonicalized and cannot abort a whole census',()=>{
  const r=migrate(snapshot([comment(1,Date.now()-1000,{head:scope.head.toUpperCase(),
    base:scope.base.toUpperCase()})]),'e','central');
  assert.equal(r.chains.length,1);assert.equal(r.chains[0].scope.head,scope.head);
});
test('a managed UUID copied from another PR is never silently excluded',()=>{
  const a={number:1,scope:{...scope,pr:99},requestId:'01234567-89ab-4def-8123-0123456789ab',
    parentRequestId:null,reservedBy:{owner:'central',fence:1},delivery:'UNKNOWN',
    intentAt:new Date(Date.now()-1000).toISOString()};
  const c=comment(7,Date.now(),{body:requestBody(a)});
  const result=migrate(snapshot([c]),'e','central',[{scope:a.scope,attempts:[a]}],
    {requesterLogin:'owner',outbound:{[a.requestId]:outboundRecord(a,'owner')}});
  assert.equal(result.quarantine.length,1);
  assert.equal(result.quarantine[0].reason,'MANAGED_REQUEST_SCOPE_BODY_OR_REQUESTER_MISMATCH');
});
test('managed marker binding checks exact immutable body, requester and acknowledged comment ID',()=>{
  const a={number:1,scope,requestId:'01234567-89ab-4def-8123-0123456789ab',
    parentRequestId:null,reservedBy:{owner:'central',fence:1},delivery:'UNKNOWN',
    intentAt:new Date(Date.now()-1000).toISOString()};
  const record=outboundRecord(a,'owner'),source=comment(7,Date.now(),{body:record.body});
  const run=(c,attempt=a)=>migrate(snapshot([c]),'e','central',[{scope,attempts:[attempt]}],
    {requesterLogin:'owner',outbound:{[a.requestId]:record}});
  assert.equal(run(source).quarantine.length,0);
  assert.equal(run({...source,user:{login:'unrelated-contributor'}}).quarantine.length,1);
  assert.equal(run({...source,body:source.body+'\nquoted progress'}).quarantine.length,1);
  const acknowledged={...a,delivery:'ACKNOWLEDGED',
    requestReceipt:JSON.stringify({requestId:a.requestId,scope,commentId:8})};
  assert.equal(run(source,acknowledged).quarantine.length,1);
});
for(const forged of ['quoted-progress','wrong-requester','changed-body']) test(
  'actual reconciliation refuses '+forged+' without acknowledging UNKNOWN',async t=>{
    const {root,l,token}=await ledger(t);
    await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,transport({count:0},{
      send:async a=>{writeNew(root,'outbound-'+a.requestId+'.json',outboundRecord(a,'owner'));
        throw Error('synthetic uncertain transport');}}));
    const state=await l.read(),a=state.chains[0].attempts[0],body=requestBody(a);
    const c=comment(7,Date.now(),{body:forged==='quoted-progress'?'This is NOT a review request\n'+body:
      forged==='changed-body'?body+'\nprogress':body});
    if(forged==='wrong-requester')c.user.login='unrelated-contributor';
    const context=writeNew(root,'context.json',{owner:'central',origin:'SCHEDULED',
      runId:'synthetic-test',token,scope});
    const cfg={owner:'central',requesterLogin:'owner',directory:root,evidenceDirectory:root};
    const result=await reconcile(cfg,{contextFile:context.file,requestId:a.requestId},
      {observer:async()=>({action:'OBSERVED',snapshot:snapshot([c])})});
    assert.equal(result.result.action,'BLOCKED');
    assert.equal((await l.read()).chains[0].attempts[0].delivery,'UNKNOWN');
  });
test('exact request-body/requester reconciliation acknowledges one delivery with no resend',async t=>{
  const {root,l,token}=await ledger(t);let sends=0;
  await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,transport({count:0},{
    send:async a=>{sends++;writeNew(root,'outbound-'+a.requestId+'.json',outboundRecord(a,'owner'));
      throw Error('synthetic uncertain send');}}));
  const a=(await l.read()).chains[0].attempts[0];
  const context=writeNew(root,'context.json',{owner:'central',origin:'SCHEDULED',
    runId:'synthetic-test',token,scope});
  const cfg={owner:'central',requesterLogin:'owner',directory:root,evidenceDirectory:root};
  const result=await reconcile(cfg,{contextFile:context.file,requestId:a.requestId},
    {observer:async()=>({action:'OBSERVED',snapshot:snapshot([
      comment(7,Date.now(),{body:requestBody(a)})])})});
  assert.equal(result.result.action,'DELIVERY_RECONCILED');
  assert.equal((await l.read()).chains[0].attempts[0].delivery,'ACKNOWLEDGED');
  assert.equal((await l.read()).chains[0].attempts.length,1);assert.equal(sends,1);
});
test('absent plan hashes cannot compare equal and exempt an unrelated barrier',t=>{
  const root=temp(t),journal=path.join(root,'journal.json');
  fs.writeFileSync(journal,JSON.stringify({active:'unknown',batches:{}}));
  const cfg={canonicalJournal:journal,barrierScopes:{unknown:['Example/Other']}};
  assert.equal(barrierFor(cfg,scope).reason,'EXISTING_CANONICAL_BARRIER');
  assert.equal(canonicalBarrier(cfg,scope).reason,'EXISTING_CANONICAL_BARRIER');
});
test('one failed scope import leaves independent scope decisions and a PARTIAL receipt',async t=>{
  const root=temp(t),dir=path.join(root,'ledger'),evidenceDirectory=path.join(root,'evidence');
  fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(evidenceDirectory,{mode:0o700});
  await new OperationalLedger(dir).initialize();
  const journal=path.join(root,'journal.json');fs.writeFileSync(journal,JSON.stringify({active:null}));
  const other={...scope,repo:'Example/Independent'};
  const result=await tick({owner:'central',requesterLogin:'owner',directory:dir,evidenceDirectory,
    allowedRepos:[scope.repo,other.repo],seedTargets:[scope,other],discoverOpen:false,
    canonicalJournal:journal,legacyConstraints:[]},
  {origin:'MANUAL_VERIFICATION',actor:'manual-owner',runId:'synthetic-test'},
  {observer:async input=>({action:'OBSERVED',snapshot:input.repo===scope.repo?
    snapshot([comment(1,Date.now()-TIMEOUT_MS-1000)],{observedAt:'malformed-time'}):
    snapshot([comment(2,Date.now()-TIMEOUT_MS-1000)],{repo:other.repo,current:other})})});
  assert.equal(result.receipt.scopeCoverage,'PARTIAL');
  assert(result.receipt.errors.some(e=>e.repo===scope.repo));
  assert(result.receipt.decisions.some(d=>d.repo===other.repo&&d.action==='REPLACEMENT_CANDIDATE'));
});
test('real provider adapter acknowledges a matching one-POST receipt and preserves full outbound bytes',async t=>{
  const {root,l,token}=await ledger(t);let posts=0,posted;
  const journal=path.join(root,'journal.json'),grantFile=path.join(root,'grant.json');
  fs.writeFileSync(journal,JSON.stringify({active:null}));
  fs.writeFileSync(grantFile,JSON.stringify(grant()),{mode:0o600});
  persistObservationInbox(root,snapshot([]));
  const cfg={version:1,owner:'central',requesterLogin:'owner',channel:'GITHUB_CODEX',
    directory:root,allowedRepos:[scope.repo],canonicalJournal:journal};
  const tx=makeTransport(cfg,{owner:'central',token,kind:'original',runId:'actual-run',grantFile},
    async(method,route,data)=>{
      if(method==='POST'){posts++;posted=data.body;return {id:77,body:posted,user:{login:'owner'},
        html_url:'https://github.com/Example/Project/pull/7#issuecomment-77'};}
      return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
    });
  const r=await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
    transport({count:0},{send:tx.send}));
  assert.equal(r.action,'REQUEST_RECORDED');assert.equal(posts,1);
  const a=(await l.read()).chains[0].attempts[0],receipt=JSON.parse(a.requestReceipt);
  assert.equal(receipt.requester,'owner');assert.equal(receipt.bodySha256,digest(posted));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'outbound-'+a.requestId+'.json'),'utf8')).body,posted);
});
test('a second call cannot reuse an uncertain outbound body to issue another POST',async t=>{
  const {root,l,token}=await ledger(t);let posts=0;
  const journal=path.join(root,'journal.json'),grantFile=path.join(root,'grant.json');
  fs.writeFileSync(journal,JSON.stringify({active:null}));
  fs.writeFileSync(grantFile,JSON.stringify(grant()),{mode:0o600});
  persistObservationInbox(root,snapshot([]));
  const tx=makeTransport({version:1,owner:'central',requesterLogin:'owner',channel:'GITHUB_CODEX',
    directory:root,allowedRepos:[scope.repo],canonicalJournal:journal},
  {owner:'central',token,runId:'actual-run',grantFile},async method=>{
    if(method==='POST'){posts++;throw Error('uncertain');}
    return {state:'open',draft:false,head:{sha:scope.head},base:{sha:scope.base}};
  });
  await l.dispatchOriginal(token,(await l.read()).revision,scope,handoff,
    transport({count:0},{send:tx.send}));
  const a=(await l.read()).chains[0].attempts[0];
  await assert.rejects(tx.send(a),/EEXIST/);assert.equal(posts,1);
});
test('identical provider facts deduplicate, while edited request versions remain budget-blocking',async t=>{
  const {root,l,token}=await ledger(t),time=Date.now()-TIMEOUT_MS-1000;
  const first=snapshot([comment(1,time)]);
  persistObservationInbox(root,first);
  const same={...structuredClone(first),observedAt:new Date(Date.now()+1).toISOString()};
  assert.equal(persistObservationInbox(root,same).length,1);
  const changed=snapshot([comment(1,time,{head:'c'.repeat(40)})]);
  assert.equal(persistObservationInbox(root,changed).length,2);
  const state=await l.importObserved(token,(await l.read()).revision,
    writeNew(root,'edited-history.json',changed),{owner:'central',requesterLogin:'owner'});
  assert(state.historyQuarantine.some(q=>q.reason==='REQUEST_BODY_EDIT_HISTORY_REQUIRES_RECONCILIATION'));
  assert.equal(state.chains.length,0);
});
test('a new original cannot hide an already in-flight provider execution as a fresh budget',async t=>{
  const {root,l}=await ledger(t),now=Date.now();
  const snap=snapshot([]);
  snap.comments.push({id:5,user:{login:'chatgpt-codex-connector[bot]'},
    updated_at:new Date(now).toISOString(),body:'<!-- codex-review-state:v1 '+
      JSON.stringify({code_review:{commit_sha:scope.head,status:'running'}})+
      ' --> <relative-time datetime="'+new Date(now-1000).toISOString()+'">running</relative-time>'});
  persistObservationInbox(root,snap);
  const hold=providerStateHolds({owner:'central',requesterLogin:'owner',directory:root},
    await l.read(),scope,'original');
  assert.equal(hold.reason,'INFLIGHT_PROVIDER_LINEAGE_REQUIRES_RECONCILIATION');
});
