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
  vm.runInNewContext(stateSource,{require:stateRequire,module:sm,__dirname});
  const approval={schema:'SORI48_EXACT_CLOSURE_USER_DECISION_V1',status:'APPROVED',
    proposalSha256:proposalHash,batchId:proposal.batchId,journalSha256:proposal.journalSha256,
    preservesOriginalUncertainty:true,acceptsLateOriginalPayloadApplicationRisk:true,
    normalSourceGatesRequired:true,noSendReplayAckOrWorkerProofRewrite:true,
    otherCasesAuthorized:false,applied:false};
  const approvalBytes=JSON.stringify(approval),approvalHash=sha(approvalBytes);
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
      oldExecutor:proposal.oldExecutor,attributableTerminalResult:null},
    originalEvidencePreserved:true,verifiedReceiptCount:3,original18Verified:true,
    freshSources:{original:{readOk:true},child:{readOk:true},pair:{readOk:true},
      github:{readOk:true,head:'c'.repeat(40)}},
    lateObservation:{batchId:proposal.batchId,ticket:proposal.ticket,dispatchId:proposal.dispatchId,
      attributableTerminalResult:null,freshSourcesComplete:true,
      targets:proposal.observedUnwrittenTargets.targets.map(t=>({pageId:t.pageId,readOk:true,
        oldLiteralCount:1,plannedLiteralCount:0}))}};
  return {closure:cm.exports,proposal,input};
}
function deps(proposal){
  const calls={audit:0,write:0};
  return {calls,withLock:fn=>fn(),persistAudit:async()=>{calls.audit++;return {sha256:'b'.repeat(64)};},
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
test('readback mismatch fails closed after one attempted atomic write',async()=>{
  const f=fixture(),d=deps(f.proposal);d.atomicWrite=async()=>'{"bad":true}';f.input.apply=true;
  await assert.rejects(()=>f.closure.createProvider(d)(f.input),/ATOMIC_READBACK/);
});
