'use strict';
// Read-only invariants for the exact approved disposition. This module grants
// no apply authority and has no filesystem, broker or Notion mutation path.
const crypto=require('node:crypto');
const proposalBytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json'),'utf8');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const PROPOSAL_SHA256='80db66552466f19b9d5e98f92bad3accd51c7f860b66856d0b393745d8a0d5e6';
const APPROVAL_SHA256='e49c5672be2872c8c13a36ed9e762668b3cf4353b20b914714620c79e0732a0f';
if(sha(proposalBytes)!==PROPOSAL_SHA256)throw Error('SORI48_PROPOSAL_PIN');
const spec=JSON.parse(proposalBytes),STATUS='CLOSED_SUPERSEDED_UNKNOWN';
const need=(ok,why)=>{if(!ok)throw Error('SORI48_'+why);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function inspectTransition(beforeBytes,afterBytes){
  // The caller must separately authenticate approval, actual scheduled
  // ownership, complete fresh sources, original receipts and original18.
  // A structurally valid transition is not permission to perform it.
  need(typeof beforeBytes==='string'&&sha(beforeBytes)===spec.journalSha256,'JOURNAL_PREIMAGE');
  const before=JSON.parse(beforeBytes),after=JSON.parse(afterBytes);
  const old=before.batches?.[spec.batchId],closed=after.batches?.[spec.batchId];
  need(before.active===spec.batchId&&old?.status===spec.before.status&&
    old.next===spec.before.next&&old.haltedFrom===spec.before.haltedFrom&&
    old.error===spec.before.error&&old.planHash===spec.planHash&&
    sha(JSON.stringify(old.edits))===spec.planHash&&old.edits.length===spec.before.total&&
    old.receipt?.ticket===spec.ticket&&old.receipt.snapshotHash===spec.snapshotHash,'EXACT_INCIDENT');
  need(after.active===null&&closed?.status===STATUS,'DISPOSITION');
  // An additive audit reference is the sole permitted extra batch field.
  const disposition=closed.supersededUnknownDisposition;
  need(!Object.hasOwn(old,'supersededUnknownDisposition')&&disposition&&
    disposition.schema==='SORI48_SUPERSEDED_UNKNOWN_DISPOSITION_V1'&&
    disposition.proposalSha256===PROPOSAL_SHA256&&
    disposition.originalOutcome==='UNKNOWN'&&disposition.exportedPayloadCancelled===false&&
    disposition.lateObservationRequired===true&&
    /^[a-f0-9]{64}$/.test(disposition.approvalSha256??'')&&
    /^[a-f0-9]{64}$/.test(disposition.privateAuditSha256??''),'AUDIT_REFERENCE');
  const restored=JSON.parse(afterBytes);
  restored.active=before.active;restored.batches[spec.batchId].status=old.status;
  delete restored.batches[spec.batchId].supersededUnknownDisposition;
  need(same(restored,before),'PRESERVATION');
  return {valid:true,batchId:spec.batchId,status:STATUS,next:spec.before.next,
    originalOutcome:'UNKNOWN',lateObservationRequired:true,cleanTermination:false,
    productAccepted:false,capacityReleased:false,applyAuthorized:false};
}
function classify(status){
  if(status!==STATUS)return null;
  return {status,originalOutcome:'UNKNOWN',lateObservationRequired:true,
    cleanTermination:false,productAccepted:false,capacityReleased:false,
    replayAllowed:false,ackAllowed:false};
}
function inspectPersisted(current,auditBytes){
  const audit=JSON.parse(auditBytes),batch=current.batches?.[spec.batchId],d=batch?.supersededUnknownDisposition;
  need(batch?.status===STATUS&&current.active!==spec.batchId&&
    audit.schema==='SORI48_SUPERSEDED_UNKNOWN_PRIVATE_AUDIT_V1'&&audit.batchId===spec.batchId&&
    audit.proposalSha256===PROPOSAL_SHA256&&sha(auditBytes)===d?.privateAuditSha256&&
    audit.approvalSha256===APPROVAL_SHA256&&audit.approvalSha256===d.approvalSha256&&
    sha(audit.approvalBytes??'')===d.approvalSha256,
    'PERSISTED_AUDIT');
  const approval=JSON.parse(audit.approvalBytes),input=JSON.parse(audit.inputBytes);
  need(approval.schema==='SORI48_EXACT_CLOSURE_USER_DECISION_V1'&&approval.status==='APPROVED'&&
    approval.batchId===spec.batchId&&approval.proposalSha256===PROPOSAL_SHA256&&
    input.beforeBytes===audit.journalBeforeBytes&&input.approvalBytes===audit.approvalBytes&&
    same(input.owner,audit.owner),'PERSISTED_INPUT');
  const transition=JSON.parse(audit.journalBeforeBytes);
  transition.active=null;transition.batches[spec.batchId]=batch;
  inspectTransition(audit.journalBeforeBytes,JSON.stringify(transition));
  return {valid:true,batchId:spec.batchId,...classify(STATUS),privateAuditSha256:sha(auditBytes),
    originalOutcome:'UNKNOWN',applyAuthorized:false};
}
function inspectLateObservation(input){
  need(input?.batchId===spec.batchId&&input.ticket===spec.ticket&&
    input.dispatchId===spec.dispatchId,'LATE_SCOPE');
  if(input.attributableTerminalResult!==null){
    need(input.attributableTerminalResult&&typeof input.attributableTerminalResult==='object',
      'LATE_RESULT');
    return {classification:'TERMINAL_EVIDENCE',stopException:true,
      next:'REVIEWED_SAME_BATCH_RECONCILIATION',originalOutcome:'UNKNOWN'};
  }
  need(Array.isArray(input.targets)&&input.targets.length===spec.observedUnwrittenTargets.targets.length,
    'LATE_TARGETS');
  let unknown=false,drift=false;
  for(let i=0;i<input.targets.length;i++){
    const observed=input.targets[i],expected=spec.observedUnwrittenTargets.targets[i];
    need(observed?.pageId===expected.pageId,'LATE_TARGET_ORDER');
    if(observed.readOk!==true){unknown=true;continue;}
    need(Number.isSafeInteger(observed.oldLiteralCount)&&Number.isSafeInteger(observed.plannedLiteralCount)&&
      observed.oldLiteralCount>=0&&observed.plannedLiteralCount>=0,'LATE_COUNTS');
    if(observed.plannedLiteralCount>0||observed.staleCurrentAdmissionCandidate===true)drift=true;
  }
  if(input.freshSourcesComplete!==true)unknown=true;
  if(drift)return {classification:'DRIFT',stopAffectedActions:true,
    next:'REVIEWED_SOURCE_PRESERVING_REPAIR',originalOutcome:'UNKNOWN'};
  if(unknown)return {classification:'UNKNOWN',stopAffectedActions:true,
    next:'REPEAT_READ_ONLY_OBSERVATION',originalOutcome:'UNKNOWN'};
  return {classification:'CLEAR_OBSERVATION_ONLY',stopAffectedActions:false,
    lateObservationRequired:true,originalOutcome:'UNKNOWN'};
}
module.exports={inspectTransition,inspectPersisted,classify,inspectLateObservation,STATUS,PROPOSAL_SHA256,APPROVAL_SHA256};
