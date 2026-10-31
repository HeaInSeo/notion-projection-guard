'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const real=require('./sori48_unknown_state.cjs');
test('UNKNOWN disposition does not grant clean termination, capacity, acceptance, replay or ACK',()=>{
  assert.deepEqual(real.classify(real.STATUS),{status:real.STATUS,originalOutcome:'UNKNOWN',
    lateObservationRequired:true,cleanTermination:false,productAccepted:false,
    capacityReleased:false,replayAllowed:false,ackAllowed:false});
  for(const status of ['COMPLETED','HALTED','ABORTED_SUPERSEDED','CLOSED_EXCEPTION_UNCONFIRMED'])assert.equal(real.classify(status),null);
});
function fixture(){
  // Synthetic compile-time fixture only. No production export accepts pin or
  // incident overrides. The canonical journal is never loaded by this test.
  const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')));
  const edits=[{pageId:'synthetic',newStr:'old-head'}];spec.planHash=sha(JSON.stringify(edits));spec.before.total=1;
  const old={status:'HALTED',haltedFrom:'WRITE_PENDING',error:spec.before.error,
    next:3,planHash:spec.planHash,edits,receipt:{ticket:spec.ticket,snapshotHash:spec.snapshotHash},
    dispatch:{executor:spec.oldExecutor,attempts:[{dispatchId:spec.dispatchId,sendPermit:{opaque:'retained'}}]},
    verifications:[{index:0},{index:1},{index:2}]};
  const before={active:spec.batchId,batches:{[spec.batchId]:old,other:{status:'COMPLETED'}},
    caseExceptionControl:{exclusive:false,immutable:'retained'}};
  const beforeBytes=JSON.stringify(before);spec.journalSha256=sha(beforeBytes);
  const proposalBytes=JSON.stringify(spec),proposalHash=sha(proposalBytes);
  let source=fs.readFileSync(path.join(__dirname,'sori48_unknown_state.cjs'),'utf8');
  source=source.replace(real.PROPOSAL_SHA256,proposalHash);
  const nativeRequire=createRequire(__filename),requireFixture=id=>id==='node:fs'?{readFileSync:()=>proposalBytes}:nativeRequire(id);
  const m={exports:{}};vm.runInNewContext(source,{require:requireFixture,module:m,__dirname});
  const after=structuredClone(before);after.active=null;const b=after.batches[spec.batchId];b.status=real.STATUS;
  b.supersededUnknownDisposition={schema:'SORI48_SUPERSEDED_UNKNOWN_DISPOSITION_V1',
    proposalSha256:proposalHash,originalOutcome:'UNKNOWN',exportedPayloadCancelled:false,
    lateObservationRequired:true,approvalSha256:'a'.repeat(64),privateAuditSha256:'b'.repeat(64)};
  return {beforeBytes,after,batch:b,helper:m.exports};
}
test('only status, active pointer and additive audit reference may change',()=>{
  const f=fixture(),r=f.helper.inspectTransition(f.beforeBytes,JSON.stringify(f.after));
  assert.equal(r.valid,true);assert.equal(r.applyAuthorized,false);assert.equal(r.next,3);
});
for(const [name,change] of [
  ['next',f=>f.batch.next=8],['receipt',f=>f.batch.receipt.ticket='other'],
  ['plan',f=>f.batch.edits[0].newStr='corrected-head'],
  ['permit',f=>delete f.batch.dispatch.attempts[0].sendPermit],
  ['attempt',f=>f.batch.dispatch.attempts=[]],['verified receipts',f=>f.batch.verifications.pop()],
  ['error',f=>delete f.batch.error],['case control',f=>f.after.caseExceptionControl.exclusive=true],
  ['unrelated batch',f=>f.after.batches.other.status='HALTED'],
  ['new top-level authority',f=>f.after.grant=true],['new batch grant',f=>f.batch.grant=true],
  ['active',f=>f.after.active='another'],['completed',f=>f.batch.status='COMPLETED'],
  ['no-send assertion',f=>f.batch.supersededUnknownDisposition.originalOutcome='NOT_SENT'],
  ['cancellation assertion',f=>f.batch.supersededUnknownDisposition.exportedPayloadCancelled=true],
  ['missing obligation',f=>f.batch.supersededUnknownDisposition.lateObservationRequired=false],
  ['missing approval pin',f=>delete f.batch.supersededUnknownDisposition.approvalSha256]
])test('rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>f.helper.inspectTransition(f.beforeBytes,JSON.stringify(f.after)));});
test('changed canonical bytes refuse even if JSON is equivalent',()=>{
  const f=fixture();assert.throws(()=>f.helper.inspectTransition(f.beforeBytes+'\n',JSON.stringify(f.after)),/JOURNAL_PREIMAGE/);
});
function lateInput(){
  const proposal=JSON.parse(fs.readFileSync(path.join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')));
  return {batchId:proposal.batchId,ticket:proposal.ticket,dispatchId:proposal.dispatchId,
    attributableTerminalResult:null,freshSourcesComplete:true,
    targets:proposal.observedUnwrittenTargets.targets.map(t=>({pageId:t.pageId,readOk:true,
      oldLiteralCount:1,plannedLiteralCount:0}))};
}
test('late-result consumer keeps a clear read observational and UNKNOWN',()=>{
  assert.deepEqual(real.inspectLateObservation(lateInput()),{classification:'CLEAR_OBSERVATION_ONLY',
    stopAffectedActions:false,lateObservationRequired:true,originalOutcome:'UNKNOWN'});
});
test('late-result consumer stops on old payload drift without asserting an ACK',()=>{
  const input=lateInput();input.targets[0].plannedLiteralCount=1;
  assert.deepEqual(real.inspectLateObservation(input),{classification:'DRIFT',stopAffectedActions:true,
    next:'REVIEWED_SOURCE_PRESERVING_REPAIR',originalOutcome:'UNKNOWN'});
});
test('failed target or source read is UNKNOWN and blocks affected actions',()=>{
  const target=lateInput();target.targets[2].readOk=false;
  assert.equal(real.inspectLateObservation(target).classification,'UNKNOWN');
  const source=lateInput();source.freshSourcesComplete=false;
  assert.equal(real.inspectLateObservation(source).classification,'UNKNOWN');
});
test('attributable terminal evidence stops the exception route',()=>{
  const input=lateInput();input.attributableTerminalResult={status:'SUCCEEDED',providerTask:'old-task'};
  assert.deepEqual(real.inspectLateObservation(input),{classification:'TERMINAL_EVIDENCE',stopException:true,
    next:'REVIEWED_SAME_BATCH_RECONCILIATION',originalOutcome:'UNKNOWN'});
});
test('late-result consumer rejects a different batch, ticket, dispatch or target order',()=>{
  for(const mutate of [x=>x.batchId='other',x=>x.ticket='other',x=>x.dispatchId='other',
    x=>x.targets.reverse()]){const input=lateInput();mutate(input);assert.throws(()=>real.inspectLateObservation(input));}
});
