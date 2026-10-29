'use strict';
// Read-only invariants for the exact approved disposition. This module grants
// no apply authority and has no filesystem, broker or Notion mutation path.
const crypto=require('node:crypto');
const proposalBytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json'),'utf8');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const PROPOSAL_SHA256='80db66552466f19b9d5e98f92bad3accd51c7f860b66856d0b393745d8a0d5e6';
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
module.exports={inspectTransition,classify,STATUS,PROPOSAL_SHA256};
