'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {ReviewLedger,budgetKey}=require('./review_timeout_ledger.cjs');
const eligible=x=>({...x,scopeKey:require('./review_timeout_policy.cjs').scopeKey(x.scope),allowed:true,receipt:'synthetic-gates'});
const BASE=Date.UTC(2026,9,25), minute=60000;
function original() {
 const scope={repo:'example/project',pr:8,head:'a'.repeat(40),base:'b'.repeat(40)};
 return {version:1,scope,current:{...scope},owner:'central-role',nextOwner:'operator',next:'reconcile exact request',
  nextTrigger:'result or operator evidence',observedAt:new Date(BASE).toISOString(),results:[],findings:[],attempts:[{
   number:1,scope:{...scope},requestId:'original',parentRequestId:null,owner:'central-role',intentAt:new Date(BASE).toISOString(),
   intentReceipt:'original-intent',delivery:'ACKNOWLEDGED',requestReceipt:'original-url',
   channel:'GITHUB_CODEX',cancelSupported:false,termination:'UNKNOWN'}]};
}
async function fixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'review-ledger-'));fs.chmodSync(directory,0o700);
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const f={directory,now:BASE+61*minute,snapshot:original()};
 f.open=()=>new ReviewLedger(directory,{clock:()=>f.now});f.ledger=f.open();
 await f.ledger.initialize();f.token=await f.ledger.acquire('central-session-1',300000,0);
 await f.ledger.importOriginal(f.token,1,f.snapshot);f.key=budgetKey(f.snapshot.scope);
 f.read=()=>f.open().read();f.revision=async()=>(await f.read()).revision;
 f.dispatch=async(extra={})=>f.open().dispatchReplacement(f.token,await f.revision(),f.key,{
  readCurrent:async()=>f.snapshot.scope,checkEligibility:eligible,send:async()=> 'synthetic-receipt',...extra});
 return f;
}
function worker(f,crash) {
 const input={directory:f.directory,now:f.now,token:f.token,revision:2,key:f.key,scope:f.snapshot.scope,crash};
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(__dirname,'test-fixtures/review_timeout_worker.cjs'),JSON.stringify(input)]);
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.on('error',reject);child.on('close',code=>resolve({code,out,err}));
 });
}
function deliveries(f) {
 const file=path.join(f.directory,'synthetic-deliveries');
 return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean):[];
}
test('two real processes race for same head: one durable reservation and one delivery',async t=>{
 const f=await fixture(t),results=await Promise.all([worker(f),worker(f)]);
 assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
 const s=await f.read();assert.equal(s.chains[0].attempts.length,2);assert.equal(s.chains[0].attempts[1].delivery,'ACKNOWLEDGED');
 assert.equal(deliveries(f).length,1);assert.equal(deliveries(f)[0],s.chains[0].attempts[1].requestId);
 assert.equal((await f.dispatch({send:()=>assert.fail('replay')})).action,'WAIT');
 assert.equal((await f.read()).chains[0].attempts.length,2);
});
for(const [crash,code,sent] of [['intent',81,0],['send',82,1]])test('process death after '+crash+' survives reload without resend',async t=>{
 const f=await fixture(t),r=await worker(f,crash);assert.equal(r.code,code,r.err);
 const s=await f.read(),a=s.chains[0].attempts[1];assert.equal(a.delivery,'UNKNOWN');
 assert.equal(a.termination,'UNKNOWN');assert.equal(deliveries(f).length,sent);
 const decision=await f.dispatch({send:()=>assert.fail('must never resend')});
 assert.equal(decision.reason,'RECONCILE_DELIVERY_NO_RESEND');
 assert.equal((await f.read()).chains[0].attempts[1].requestId,a.requestId);
});
test('unknown send is reconciled only by exact existing request, never by a new send',async t=>{
 const f=await fixture(t);await f.dispatch({send:async()=>{throw Error('response lost');}});
 let s=await f.read();const id=s.chains[0].attempts[1].requestId;
 await assert.rejects(f.ledger.reconcileDelivery(f.token,s.revision,f.key,'other','receipt'));
 await f.ledger.reconcileDelivery(f.token,s.revision,f.key,id,'observed-existing-url');
 f.now+=61*minute;s=await f.read();
 f.token=await f.ledger.acquire('central-session-2',300000,s.revision);
 assert.equal((await f.dispatch({send:()=>assert.fail('third request')})).reason,'REPLACEMENT_TIMEOUT');
 s=await f.read();assert.equal(s.chains[0].attempts.length,2);assert.equal(s.audit.at(-1).decision.nextOwner,'operator');
});
test('lease renewal, expiry, fencing and revision CAS reject stale owner',async t=>{
 const f=await fixture(t);const old=f.token;
 await f.ledger.renew(old,300000,2);
 await assert.rejects(f.ledger.renew(old,300000,2),/REVISION_CONFLICT/);
 await assert.rejects(f.ledger.acquire('other',300000,3),/OWNER_BUSY/);
 f.now+=300000;await assert.rejects(f.ledger.renew(old,300000,3),/STALE_OR_EXPIRED/);
 f.token=await f.ledger.acquire('central-session-2',300000,3);assert.equal(f.token.fence,old.fence+1);
 await assert.rejects(f.ledger.dispatchReplacement(old,4,f.key,{readCurrent:()=>f.snapshot.scope,checkEligibility:eligible,send:()=>assert.fail()}),/STALE_OR_EXPIRED/);
 assert.equal((await f.dispatch()).action,'REQUEST_RECORDED');
});
test('lease expiring after durable intent prevents send and restart replay',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.dispatch({afterIntent:()=>{f.now+=300000;},send:()=>assert.fail()}),/STALE_OR_EXPIRED/);
 let s=await f.read();assert.equal(s.chains[0].attempts[1].delivery,'UNKNOWN');
 f.token=await f.ledger.acquire('next-owner',300000,s.revision);
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RECONCILE_DELIVERY_NO_RESEND');
});
test('lease expiring after actual send cannot acknowledge with stale fence',async t=>{
 const f=await fixture(t);let sent=0;
 await assert.rejects(f.dispatch({send:async()=>{sent++;f.now+=300000;return 'receipt';}}),/STALE_OR_EXPIRED/);
 const s=await f.read();assert.equal(sent,1);assert.equal(s.chains[0].attempts[1].delivery,'UNKNOWN');
 f.token=await f.ledger.acquire('next-owner',300000,s.revision);
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RECONCILE_DELIVERY_NO_RESEND');
});
for(const field of ['head','base'])test(field+' drift before and after intent never sends or resets budget',async t=>{
 const f=await fixture(t),current={...f.snapshot.scope,[field]:'c'.repeat(40)};
 assert.equal((await f.dispatch({readCurrent:()=>current,send:()=>assert.fail()})).reason,'SCOPE_CHANGED');
 let count=0;
 assert.equal((await f.dispatch({readCurrent:()=>++count===1?f.snapshot.scope:current,send:()=>assert.fail()})).reason,'SCOPE_CHANGED_AFTER_INTENT');
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RECONCILE_DELIVERY_NO_RESEND');
 const changed=original();changed.scope.base='d'.repeat(40);changed.current={...changed.scope};changed.attempts[0].scope={...changed.scope};
 await assert.rejects(f.ledger.importOriginal(f.token,await f.revision(),changed),/HEAD_BUDGET_EXISTS/);
});
test('late predecessor finding persists across restart despite replacement clean',async t=>{
 const f=await fixture(t);await f.dispatch();let s=await f.read();
 const result={resultId:'late-original',requestId:'original',scope:f.snapshot.scope,receipt:'late-result-url',
  at:new Date(f.now).toISOString(),verdict:'FINDINGS',findingIds:['defect']};
 const findings=[{id:'defect',resultId:'late-original',receipt:'thread',disposition:'OPEN'}];
 await f.ledger.recordResult(f.token,s.revision,f.key,result,findings);
 s=await f.read();await f.ledger.recordResult(f.token,s.revision,f.key,{
  ...result,resultId:'replacement-clean',requestId:s.chains[0].attempts[1].requestId,verdict:'CLEAN',findingIds:[]},[]);
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RETAINED_FINDING_DISPOSITION_REQUIRED');
 s=await f.read();assert.equal(s.chains[0].results.length,2);assert.equal(s.chains[0].findings.length,1);
 await f.ledger.disposeFinding(f.token,s.revision,f.key,'defect',{disposition:'FIXED',owner:'reviewer',evidence:'verified-fix'},f.snapshot.scope);
 assert.equal((await f.dispatch()).action,'RECONCILE_RESULTS');
});
test('new head retains old findings until disposition is verified for that head',async t=>{
 const f=await fixture(t),r={resultId:'old-finding',requestId:'original',scope:f.snapshot.scope,receipt:'result',
  at:new Date(f.now).toISOString(),verdict:'FINDINGS',findingIds:['defect']};
 await f.ledger.recordResult(f.token,2,f.key,r,[{id:'defect',resultId:r.resultId,receipt:'thread',disposition:'OPEN'}]);
 const fresh=original();fresh.scope.head='c'.repeat(40);fresh.current={...fresh.scope};fresh.attempts[0].scope={...fresh.scope};fresh.attempts[0].requestId='new-original';
 await f.ledger.importOriginal(f.token,await f.revision(),fresh);
 const newKey=budgetKey(fresh.scope),run=async()=>f.open().dispatchReplacement(f.token,await f.revision(),newKey,{readCurrent:()=>fresh.scope,checkEligibility:eligible,send:()=> 'new-receipt'});
 assert.equal((await run()).reason,'RETAINED_FINDING_DISPOSITION_REQUIRED');
 await f.ledger.disposeFinding(f.token,await f.revision(),f.key,'defect',{disposition:'FIXED',owner:'reviewer',evidence:'new-head-proof'},fresh.scope);
 assert.equal((await run()).action,'REQUEST_RECORDED');
 assert.equal((await f.read()).chains[0].findings[0].assessedScope.head,fresh.scope.head);
});
test('missing ledger cannot silently initialize a fresh budget; corruption fails closed',async t=>{
 const f=await fixture(t);fs.writeFileSync(f.ledger.file,'{}');await assert.rejects(f.read(),/invalid ledger/);
 fs.unlinkSync(f.ledger.file);await assert.rejects(f.ledger.initialize(),/EEXIST/);
});
test('clock rollback rejects mutation and existing private file modes are enforced',async t=>{
 const f=await fixture(t);f.now--;await assert.rejects(f.ledger.renew(f.token,300000,2),/CLOCK_ROLLBACK/);
 fs.chmodSync(f.ledger.file,0o644);await assert.rejects(f.read(),/0600/);
});

test('existing WIP/HOLD/canonical eligibility is required before and after intent',async t=>{
 const f=await fixture(t);
 assert.equal((await f.dispatch({checkEligibility:()=>({allowed:false}),send:()=>assert.fail()})).reason,'EXISTING_GATES_NOT_SATISFIED');
 assert.equal((await f.read()).chains[0].attempts.length,1);
 let checks=0;
 assert.equal((await f.dispatch({checkEligibility:x=>++checks===1?eligible(x):{allowed:false},send:()=>assert.fail()})).reason,'EXISTING_GATES_NOT_SATISFIED');
 assert.equal((await f.read()).chains[0].attempts[1].delivery,'UNKNOWN');
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RECONCILE_DELIVERY_NO_RESEND');
});
test('hung transport releases local lock at bounded deadline but keeps UNKNOWN reservation',async t=>{
 const f=await fixture(t),short=new ReviewLedger(f.directory,{clock:()=>f.now,ioTimeoutMs:20});
 const r=await short.dispatchReplacement(f.token,await f.revision(),f.key,{
  readCurrent:()=>f.snapshot.scope,checkEligibility:eligible,send:()=>new Promise(()=>{})});
 assert.equal(r.reason,'UNCERTAIN_SEND');
 assert.equal((await f.read()).chains[0].attempts[1].delivery,'UNKNOWN');
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RECONCILE_DELIVERY_NO_RESEND');
});

test('repository case cannot reset the same-head budget',async t=>{
 const f=await fixture(t),other=original();other.scope.repo='Example/Project';
 other.current={...other.scope};other.attempts[0].scope={...other.scope};other.attempts[0].requestId='different';
 await assert.rejects(f.ledger.importOriginal(f.token,await f.revision(),other),/HEAD_BUDGET_EXISTS/);
});
test('candidate pins detect changed bytes and symlink modules',t=>{
 const {verify,FILES}=require('./verify_review_timeout_candidate.cjs');
 assert.equal(verify().deployed,false);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'review-candidate-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 for(const name of [...FILES,'deployment/review-timeout-candidate.json']){
  const dest=path.join(directory,name);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(path.join(__dirname,name),dest);
 }
 assert.equal(verify(directory).status,'LOCAL_CANDIDATE_MATCH');
 const target=path.join(directory,FILES[0]);fs.appendFileSync(target,'\n// drift');
 assert.throws(()=>verify(directory),/hash mismatch/);
 fs.unlinkSync(target);fs.symlinkSync(path.join(__dirname,FILES[0]),target);
 assert.throws(()=>verify(directory),/nonregular/);
});

test('independent-review P2: 150ms synchronous receipt misses 10ms deadline and stays UNKNOWN',async t=>{
 const f=await fixture(t),short=new ReviewLedger(f.directory,{clock:()=>f.now,ioTimeoutMs:10});
 const r=await short.dispatchReplacement(f.token,await f.revision(),f.key,{
  readCurrent:()=>f.snapshot.scope,checkEligibility:eligible,send:()=>{
   const end=process.hrtime.bigint()+150000000n;while(process.hrtime.bigint()<end){}
   return 'late-synthetic-receipt';
  }});
 assert.equal(r.reason,'UNCERTAIN_SEND');
 assert.equal((await f.read()).chains[0].attempts[1].delivery,'UNKNOWN');
 assert.equal((await f.dispatch({send:()=>assert.fail()})).reason,'RECONCILE_DELIVERY_NO_RESEND');
});
for(const [mode,timeoutMs,ioTimeoutMs]of [['INFINITE_SYNC',600,100],['SLOW_SYNC',2000,10],['NORMAL',2000,1000]])
 test('isolated watchdog '+mode+' confirms exit and another process reloads without resend',async t=>{
 const f=await fixture(t),{runIsolated}=require('./review_timeout_isolated.cjs');
 const started=Date.now();
 const out=await runIsolated({directory:f.directory,token:f.token,revision:await f.revision(),key:f.key,
  transportModule:path.join(__dirname,'test-fixtures/review_timeout_isolated_transport.cjs'),timeoutMs,ioTimeoutMs,
  context:{directory:f.directory,now:f.now,scope:f.snapshot.scope,mode}});
 assert.ok(Date.now()-started<5000,'watchdog did not bound local worker');
 if(mode==='INFINITE_SYNC') {
  assert.equal(out.reason,'LOCAL_ADAPTER_OUTCOME_UNKNOWN');assert.equal(out.localWorkerExitConfirmed,true);
  assert.equal(out.signal,'SIGKILL');assert.equal(out.providerTermination,'UNKNOWN');
 }
 const s=await f.read(),attempt=s.chains[0].attempts[1];assert.ok(attempt,'intent must predate the killed send');
 assert.equal(attempt.delivery,mode==='NORMAL'?'ACKNOWLEDGED':'UNKNOWN');
 const delivered=fs.readFileSync(path.join(f.directory,'isolated-synthetic-deliveries'),'utf8').trim().split('\n');
 assert.deepEqual(delivered,[attempt.requestId]);
 // This is another OS process, not only another object in the test process.
 const input={directory:f.directory,now:f.now,token:f.token,revision:s.revision,key:f.key,scope:f.snapshot.scope};
 const restarted=await new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[path.join(__dirname,'test-fixtures/review_timeout_worker.cjs'),JSON.stringify(input)]);
  let out='';p.stdout.on('data',b=>out+=b);p.on('error',reject);p.on('close',code=>resolve({code,out}));
 });
 assert.equal(restarted.code,0,restarted.out);
 const decision=JSON.parse(restarted.out);
 assert.equal(mode==='NORMAL'?decision.action:decision.reason,mode==='NORMAL'?'WAIT':'RECONCILE_DELIVERY_NO_RESEND');
 assert.equal(deliveries(f).length,0);
 assert.equal((await f.read()).chains[0].attempts[1].requestId,attempt.requestId);
 });
