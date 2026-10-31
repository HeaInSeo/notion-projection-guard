'use strict';
const crypto=require('node:crypto');
const state=require('./sori48_unknown_state.cjs');
const proposal=require('./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const APPROVAL_SHA256='e49c5672be2872c8c13a36ed9e762668b3cf4353b20b914714620c79e0732a0f';
const OWNER='automation:6a742f6443e8819184310cd28e6162cd';
const CORRECTED_HEAD='b26246e4ab3870bf6f7516b08906791570b57163';
const need=(ok,why)=>{if(!ok)throw Error('SORI48_CLOSURE_'+why);};
function approval(bytes){
  need(typeof bytes==='string'&&sha(bytes)===APPROVAL_SHA256,'APPROVAL_PIN');
  const a=JSON.parse(bytes);
  need(a.schema==='SORI48_EXACT_CLOSURE_USER_DECISION_V1'&&a.status==='APPROVED'&&
    a.proposalSha256===state.PROPOSAL_SHA256&&a.batchId===proposal.batchId&&
    a.journalSha256===proposal.journalSha256&&a.preservesOriginalUncertainty===true&&
    a.acceptsLateOriginalPayloadApplicationRisk===true&&a.normalSourceGatesRequired===true&&
    a.noSendReplayAckOrWorkerProofRewrite===true&&a.otherCasesAuthorized===false&&
    a.applied===false,'APPROVAL_SCOPE');
  return a;
}
function preflight(input){
  need(input?.owner?.actor===OWNER&&typeof input.owner.runId==='string'&&input.owner.runId&&
    /^[a-f0-9]{64}$/.test(input.owner.scheduledProofSha256??''),'OWNER');
  approval(input.approvalBytes);
  need(typeof input.beforeBytes==='string'&&sha(input.beforeBytes)===proposal.journalSha256,
    'JOURNAL_PREIMAGE');
  const executor=input.priorExecutorEvidence;
  need(executor?.schema==='SORI48_PRIOR_EXECUTOR_EVIDENCE_V1'&&
    executor.status==='ABSENT_VERIFIED'&&executor.batchId===proposal.batchId&&
    executor.ticket===proposal.ticket&&executor.dispatchId===proposal.dispatchId&&
    executor.oldExecutor===proposal.oldExecutor&&executor.oldBrokerPid===2680832&&
    executor.absenceScope==='LOCAL_OLD_PROCESS_AND_CURRENT_CANONICAL_LOCK_ONLY'&&
    executor.oldProcessPresent===false&&Number.isInteger(executor.currentLock?.pid)&&
    typeof executor.currentLock.executor==='string'&&
    executor.currentLock.executor!==proposal.oldExecutor&&
    executor.attributableTerminalResult===null,
    'OLD_EXECUTOR');
  need(input.originalEvidencePreserved===true&&input.verifiedReceiptCount===3&&
    input.original18Verified===true,'PRESERVATION_EVIDENCE');
  const sources=input.freshSources;
  need(sources&&['original','child','pair','github'].every(k=>sources[k]?.readOk===true)&&
    sources.github.head===CORRECTED_HEAD,'FRESH_SOURCES');
  const late=state.inspectLateObservation(input.lateObservation);
  need(late.classification==='CLEAR_OBSERVATION_ONLY','LATE_OBSERVATION');
  return {late,sources};
}
function candidate(beforeBytes,auditSha){
  const after=JSON.parse(beforeBytes),batch=after.batches[proposal.batchId];
  after.active=null;batch.status=state.STATUS;
  batch.supersededUnknownDisposition={
    schema:'SORI48_SUPERSEDED_UNKNOWN_DISPOSITION_V1',
    proposalSha256:state.PROPOSAL_SHA256,
    originalOutcome:'UNKNOWN',
    exportedPayloadCancelled:false,
    lateObservationRequired:true,
    approvalSha256:APPROVAL_SHA256,
    privateAuditSha256:auditSha
  };
  const bytes=JSON.stringify(after);
  state.inspectTransition(beforeBytes,bytes);
  return bytes;
}
function createProvider(deps){
  need(deps&&typeof deps.withLock==='function'&&typeof deps.persistAudit==='function'&&
    typeof deps.atomicWrite==='function','DEPENDENCIES');
  return async function close(input){
    return deps.withLock(async()=>{
      if(typeof deps.inspectCommitted==='function'){
        need(input?.owner?.actor===OWNER&&typeof input.owner.runId==='string'&&input.owner.runId&&
          /^[a-f0-9]{64}$/.test(input.owner.scheduledProofSha256??''),'OWNER');
        approval(input.approvalBytes);
        const committed=deps.inspectCommitted();
        if(committed)return {eligible:false,applied:false,alreadyApplied:true,...committed};
      }
      const checked=preflight(input);
      if(input.apply!==true)return {eligible:true,applied:false,status:state.STATUS,
        originalOutcome:'UNKNOWN',lateObservationRequired:true};
      const audit={schema:'SORI48_SUPERSEDED_UNKNOWN_PRIVATE_AUDIT_V1',
        batchId:proposal.batchId,proposalSha256:state.PROPOSAL_SHA256,
        approvalSha256:APPROVAL_SHA256,journalBeforeSha256:proposal.journalSha256,
        // Preserve exact bytes before any canonical write. A summary/hash alone
        // cannot reconstruct the approved incident and its full captured input.
        journalBeforeBytes:input.beforeBytes,approvalBytes:input.approvalBytes,
        inputBytes:JSON.stringify(input),
        owner:input.owner,freshSources:checked.sources,lateObservation:checked.late,
        preserves:{next:proposal.before.next,originalOutcome:'UNKNOWN',receiptCount:3,
          exportedPayloadCancelled:false,lateObservationRequired:true}};
      const auditReceipt=await deps.persistAudit(audit);
      need(auditReceipt?.sha256===sha(JSON.stringify(audit)),'AUDIT_PERSIST');
      const afterBytes=candidate(input.beforeBytes,auditReceipt.sha256);
      const readback=await deps.atomicWrite(proposal.journalSha256,afterBytes);
      need(typeof readback==='string'&&readback===afterBytes,'ATOMIC_READBACK');
      state.inspectTransition(input.beforeBytes,readback);
      return {eligible:true,applied:true,status:state.STATUS,
        journalBeforeSha256:proposal.journalSha256,journalAfterSha256:sha(readback),
        privateAuditSha256:auditReceipt.sha256,originalOutcome:'UNKNOWN',
        lateObservationRequired:true};
    });
  };
}
module.exports={createProvider,preflight,candidate,APPROVAL_SHA256,OWNER,CORRECTED_HEAD};
