'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const realState=require('./sori48_unknown_state.cjs');
const realClosure=require('./sori48_unknown_closure.cjs');
function fixture(){
  const proposal=JSON.parse(fs.readFileSync(path.join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')));
  const edits=[{pageId:'synthetic',newStr:'old-head'}];proposal.planHash=sha(JSON.stringify(edits));proposal.before.total=1;
  const old={status:'HALTED',haltedFrom:'WRITE_PENDING',error:proposal.before.error,next:3,
    planHash:proposal.planHash,edits,receipt:{ticket:proposal.ticket,snapshotHash:proposal.snapshotHash},
    dispatch:{executor:proposal.oldExecutor,attempts:[{dispatchId:proposal.dispatchId,sendPermit:{opaque:'retained'}}]},
    verifications:[{index:0},{index:1},{index:2}]};
  const before={active:proposal.batchId,batches:{[proposal.batchId]:old},caseExceptionControl:{immutable:'retained'}};
  const beforeBytes=JSON.stringify(before);proposal.journalSha256=sha(beforeBytes);
  const proposalBytes=JSON.stringify(proposal),proposalHash=sha(proposalBytes),nativeRequire=createRequire(__filename);
  let stateSource=fs.readFileSync(path.join(__dirname,'sori48_unknown_state.cjs'),'utf8');
  stateSource=stateSource.replace(realState.PROPOSAL_SHA256,proposalHash);
  const sm={exports:{}},stateRequire=id=>id==='node:fs'?{readFileSync:()=>proposalBytes}:nativeRequire(id);
  const approval={schema:'SORI48_EXACT_CLOSURE_USER_DECISION_V1',status:'APPROVED',
    proposalSha256:proposalHash,batchId:proposal.batchId,journalSha256:proposal.journalSha256,
    preservesOriginalUncertainty:true,acceptsLateOriginalPayloadApplicationRisk:true,
    normalSourceGatesRequired:true,noSendReplayAckOrWorkerProofRewrite:true,
    otherCasesAuthorized:false,applied:false};
  const approvalBytes=JSON.stringify(approval),approvalHash=sha(approvalBytes);
  stateSource=stateSource.replace(realState.APPROVAL_SHA256,approvalHash);
  vm.runInNewContext(stateSource,{require:stateRequire,module:sm,__dirname});
  let closureSource=fs.readFileSync(path.join(__dirname,'sori48_unknown_closure.cjs'),'utf8');
  closureSource=closureSource.replace(realClosure.APPROVAL_SHA256,approvalHash)
    .replace(realClosure.CORRECTED_HEAD,'c'.repeat(40));
  const cm={exports:{}},closureRequire=id=>{
    if(id==='./sori48_unknown_state.cjs')return sm.exports;
    if(id==='./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')return proposal;
    return nativeRequire(id);
  };
  vm.runInNewContext(closureSource,{require:closureRequire,module:cm});
  const input={apply:false,approvalBytes,beforeBytes,
    owner:{actor:cm.exports.OWNER,runId:'scheduled-run',scheduledProofSha256:'a'.repeat(64)},
    priorExecutorEvidence:{schema:'SORI48_PRIOR_EXECUTOR_EVIDENCE_V1',status:'ABSENT_VERIFIED',
      batchId:proposal.batchId,ticket:proposal.ticket,dispatchId:proposal.dispatchId,
      oldExecutor:proposal.oldExecutor,oldBrokerPid:2680832,
      absenceScope:'LOCAL_OLD_PROCESS_AND_CURRENT_CANONICAL_LOCK_ONLY',oldProcessPresent:false,
      currentLock:{pid:1234,executor:'current-executor'},attributableTerminalResult:null},
    originalEvidencePreserved:true,verifiedReceiptCount:3,original18Verified:true,
    freshSources:{original:{readOk:true},child:{readOk:true},pair:{readOk:true},
      github:{readOk:true,head:'c'.repeat(40)}},
    lateObservation:{batchId:proposal.batchId,ticket:proposal.ticket,dispatchId:proposal.dispatchId,
      attributableTerminalResult:null,freshSourcesComplete:true,
      targets:proposal.observedUnwrittenTargets.targets.map(t=>({pageId:t.pageId,readOk:true,
        oldLiteralCount:1,plannedLiteralCount:0}))}};
  return {closure:cm.exports,state:sm.exports,proposal,input};
}
function deps(proposal){
  const calls={audit:0,write:0};
  return {calls,withLock:fn=>fn(),persistAudit:async audit=>{calls.audit++;return {sha256:sha(JSON.stringify(audit))};},
    atomicWrite:async(expected,bytes)=>{calls.write++;assert.equal(expected,proposal.journalSha256);return bytes;}};
}
test('check-only authenticates exact scope and performs no audit or write',async()=>{
  const f=fixture(),d=deps(f.proposal),r=await f.closure.createProvider(d)(f.input);
  assert.equal(r.eligible,true);assert.equal(r.applied,false);assert.deepEqual(d.calls,{audit:0,write:0});
});
test('apply persists audit before one atomic compare/write and preserves UNKNOWN',async()=>{
  const f=fixture(),d=deps(f.proposal);f.input.apply=true;
  const r=await f.closure.createProvider(d)(f.input);
  assert.equal(r.applied,true);assert.equal(r.originalOutcome,'UNKNOWN');assert.deepEqual(d.calls,{audit:1,write:1});
});
for(const [name,mutate] of [
  ['approval',i=>i.approvalBytes+='\n'],['owner',i=>i.owner.actor='manual:other'],
  ['preimage',i=>i.beforeBytes+='\n'],['executor',i=>i.priorExecutorEvidence.status='NOT_ASSESSED'],
  ['executor identity',i=>i.priorExecutorEvidence.dispatchId='other'],
  ['executor terminal',i=>i.priorExecutorEvidence.attributableTerminalResult={status:'done'}],
  ['receipts',i=>i.verifiedReceiptCount=2],['original18',i=>i.original18Verified=false],
  ['source',i=>i.freshSources.child.readOk=false],['head',i=>i.freshSources.github.head='other'],
  ['terminal',i=>i.lateObservation.attributableTerminalResult={status:'done'}],
  ['drift',i=>i.lateObservation.targets[0].plannedLiteralCount=1]
])test('rejects '+name+' before mutation',async()=>{
  const f=fixture(),d=deps(f.proposal);f.input.apply=true;mutate(f.input);
  await assert.rejects(()=>f.closure.createProvider(d)(f.input));assert.deepEqual(d.calls,{audit:0,write:0});
});
test('audit failure prevents journal write',async()=>{
  const f=fixture(),d=deps(f.proposal);d.persistAudit=async()=>({sha256:'bad'});f.input.apply=true;
  await assert.rejects(()=>f.closure.createProvider(d)(f.input),/AUDIT_PERSIST/);assert.equal(d.calls.write,0);
});
test('the private audit retains exact original journal, approval and complete captured input',async()=>{
  const f=fixture(),d=deps(f.proposal);f.input.apply=true;f.input.retainedExtra={raw:'full native input'};
  const expected=JSON.stringify(f.input);let audit;
  d.persistAudit=async value=>{audit=value;return {sha256:sha(JSON.stringify(value))};};
  await f.closure.createProvider(d)(f.input);
  assert.equal(audit.journalBeforeBytes,f.input.beforeBytes);assert.equal(audit.approvalBytes,f.input.approvalBytes);
  assert.equal(audit.inputBytes,expected);assert.equal(JSON.parse(audit.inputBytes).retainedExtra.raw,'full native input');
});
test('a durable audit hash for different contents refuses canonical mutation',async()=>{
  const f=fixture(),d=deps(f.proposal);f.input.apply=true;
  d.persistAudit=async()=>({sha256:'b'.repeat(64)});
  await assert.rejects(()=>f.closure.createProvider(d)(f.input),/AUDIT_PERSIST/);assert.equal(d.calls.write,0);
});
test('readback mismatch fails closed after one attempted atomic write',async()=>{
  const f=fixture(),d=deps(f.proposal);d.atomicWrite=async()=>'{"bad":true}';f.input.apply=true;
  await assert.rejects(()=>f.closure.createProvider(d)(f.input),/ATOMIC_READBACK/);
});
function durableFixture(t){
  const f=fixture(),os=require('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'sori48-commit-'));
  fs.chmodSync(root,0o700);fs.mkdirSync(path.join(root,'manual-audits'),{mode:0o700});
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'journal.json'),executor='actual-test-executor';
  fs.writeFileSync(file,f.input.beforeBytes,{mode:0o600});
  fs.writeFileSync(path.join(root,'broker.lock'),JSON.stringify({pid:process.pid,executor}),{mode:0o600});
  const nativeRequire=createRequire(__filename),m={exports:{}};
  const req=id=>id==='./sori48_unknown_state.cjs'?f.state:nativeRequire(id);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'sori48_unknown_runtime.cjs'),'utf8'),
    {require:req,module:m,process,Buffer});
  let broker;
  const restart=()=>{
    broker={root,file,executor,state:JSON.parse(fs.readFileSync(file,'utf8')),assertLock(){
      const lock=JSON.parse(fs.readFileSync(path.join(root,'broker.lock'),'utf8'));
      assert.equal(lock.pid,process.pid);assert.equal(lock.executor,executor);
    }};
    return m.exports.createRuntime({root,getBroker:()=>broker});
  };
  return {...f,root,file,restart};
}
test('a fresh process recognizes an audited commit without a second write or capacity claim',async t=>{
  const f=durableFixture(t);f.input.apply=true;const first=await f.closure.createProvider(f.restart())(f.input);
  const bytes=fs.readFileSync(f.file,'utf8');assert.equal(first.applied,true);
  f.input.owner.runId='next-genuine-test-run';const again=await f.closure.createProvider(f.restart())(f.input);
  assert.equal(again.alreadyApplied,true);assert.equal(again.applied,false);assert.equal(again.capacityReleased,false);
  assert.equal(again.originalOutcome,'UNKNOWN');assert.equal(again.lateObservationRequired,true);
  assert.equal(fs.readFileSync(f.file,'utf8'),bytes);
});
test('lost response after rename is reconciled from full audit and never replayed',async t=>{
  const f=durableFixture(t);f.input.apply=true;const rename=fs.renameSync;let writes=0;
  fs.renameSync=(from,to)=>{const out=rename(from,to);if(to===f.file){writes++;throw Error('synthetic reply lost after rename');}return out;};
  try{await assert.rejects(()=>f.closure.createProvider(f.restart())(f.input),/reply lost/);}
  finally{fs.renameSync=rename;}
  const before=fs.readFileSync(f.file,'utf8'),result=await f.closure.createProvider(f.restart())(f.input);
  assert.equal(result.alreadyApplied,true);assert.equal(writes,1);assert.equal(fs.readFileSync(f.file,'utf8'),before);
});
test('failure before rename preserves canonical bytes and reuses the durable audit on restart',async t=>{
  const f=durableFixture(t);f.input.apply=true;const rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===f.file)throw Error('synthetic pre-rename failure');return rename(from,to);};
  try{await assert.rejects(()=>f.closure.createProvider(f.restart())(f.input),/pre-rename failure/);}
  finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(f.file,'utf8'),f.input.beforeBytes);
  const dir=path.join(f.root,'manual-audits/sori48-closure-20261029'),files=fs.readdirSync(dir);
  assert.equal((await f.closure.createProvider(f.restart())(f.input)).applied,true);
  assert.deepEqual(fs.readdirSync(dir),files);
});
test('changed closed-case receipt or audit cannot be accepted by a status consumer',async t=>{
  const f=durableFixture(t);f.input.apply=true;await f.closure.createProvider(f.restart())(f.input);
  const saved=JSON.parse(fs.readFileSync(f.file,'utf8'));saved.batches[f.proposal.batchId].receipt.ticket='changed';
  fs.writeFileSync(f.file,JSON.stringify(saved));assert.throws(()=>f.restart().inspectCommitted());
});
