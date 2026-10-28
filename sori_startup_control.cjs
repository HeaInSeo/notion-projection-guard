'use strict';
// A separate, fixed normal scope record. It is never a MERGED-PR admission,
// a case-permission change, or a general control-field/recovery capability.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const admission=Object.freeze({
  id:'SORI-NORMAL-STARTUP-20261028-391159f9',
  batchId:'SORI-W02-STARTUP-SCOPE-20261028-391159F9',
  centralTaskId:'6a742f6443e8819184310cd28e6162cd',
  planHash:'43dd5bf7b6a9f0ad20fa86b666eec34501013075fb0cebd5d8a2ba1a3ad64032',
  file:'/home/heain/work/packets/sori-w02-startup-20261028-391159f9/ADMISSION',
  sha256:'627da2175b5ed08c67f5b912fbce9f3fa7e345b95b7c755a934317ee7267e984',
  oldCaseFile:'/home/heain/work/packets/sori-w02-admin-tail-20261026/ADMISSION',
  oldCaseSha256:'4a1a1b4ec544bc9b739c8bf3dae5ef157847157e1c2a78e48dba3fffbff5f803',
  referenceIds:Object.freeze(['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7',
    '3bf86e6dd1d18110938bc358e17c779e','3b286e6dd1d18194866dd8d7a28c7ab4',
    '3f586e6dd1d1819d823df1102a7fbcf6','40786e6dd1d181ec8addcd1269f9b0bb'])
});
const incident=Object.freeze({
  journalHash:'e3ad17d4db1b0bcdabbc763653c7213616288c9d93157d8846ab1af37d233002',
  ticket:'f6f95974-f68c-4c95-be26-2c657f5274b1',
  snapshotHash:'a38cd1eaa1f223196308b9f9e01385adbc10a8d16119c4a5546ebffef7ac71c7',
  dispatchId:'1e1d8001-9bc9-41b4-a0f4-c592a96f2b87',
  executor:'c2783f1e-7cd6-429b-9e28-400a4d5d71e9',
  runId:'3ab87ee9-b100-832f-a054-43096cf1aadf',
  brokerPid:2618374,
  runnerHash:'e37d7675e5d2645764421bb1877ddf4c9aeba8ae5d0b2bab1c568059c6c4148f',
  hostPlanFile:'sori-normal-control-host-plan-v4-391159f9.json',
  hostPlanHash:'6aa2a9e0960aaf29d74a2ee4b735f7b394aa1143be05914e0c58c46467087fb5',
  diagnosticFile:'sori-r3-v4-permit-expiry-20261028.json',
  diagnosticHash:'eb97f716281a615241c4335837f8816e55d6611920669f849ada4aff19270949',
  traceFile:'sori-r4-r3-actual-code-error-call-record-20261028.json',
  traceHash:'f4c29438da797485a4e99dc2e6a076bfe35ed4e2d9258c269a3c724960db14ff'
});
const exceptionProposal=Object.freeze({schema:'SORI_CONTROL_EXCEPTION_PROPOSAL_V1',
  admissionId:admission.id,batchId:admission.batchId,journalHash:incident.journalHash,planHash:admission.planHash,
  ticket:incident.ticket,snapshotHash:incident.snapshotHash,dispatchId:incident.dispatchId,oldRunId:incident.runId,
  originalNativeCallCount:'UNKNOWN',
  permits:'ONE_EXPLICIT_SAME_TICKET_CONTINUATION_WITH_UNKNOWN_ORIGINAL_SEND',
  preserves:'original plan, ticket, snapshot, attempts, error, all verified progress and case controls',
  notANoSendProof:true,notAnAcknowledgement:true,noNewBatch:true});
const proposalSha256=hash(JSON.stringify(exceptionProposal));
function read(file,privateOnly=true){
  const s=fs.lstatSync(file);
  need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.geteuid()&&
    !(s.mode&(privateOnly?0o077:0o022)),'SORI_CONTROL_PRIVATE_FILE');
  return fs.readFileSync(file,'utf8');
}
function packet(file,expected){
  const parent=fs.lstatSync(path.dirname(file));
  need(parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===process.geteuid()&&
    !(parent.mode&0o077)&&fs.realpathSync(file)===file&&hash(read(file,false))===expected,
    'SORI_CONTROL_ADMISSION_PIN');
}
function createAdmission(){
  return function validate({broker,input}){
    const keys=['action','requestId','batchId','centralTaskId','runId','referenceIds','edits','controlAdmissionId'];
    need(Object.keys(input).every(k=>keys.includes(k))&&input.action==='normal_control_init'&&
      input.controlAdmissionId===admission.id&&input.batchId===admission.batchId&&
      input.centralTaskId===admission.centralTaskId&&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.runId??'')&&
      JSON.stringify(input.referenceIds)===JSON.stringify(admission.referenceIds)&&
      Array.isArray(input.edits)&&input.edits.length===1&&
      input.edits[0].pageId===admission.referenceIds[2]&&
      hash(JSON.stringify(input.edits))===admission.planHash,'SORI_CONTROL_SCOPE');
    const c=broker.state.caseExceptionControl;
    need(c?.exclusive===false&&c.admission?.packetHash===admission.oldCaseSha256,
      'SORI_CONTROL_CASE_UNCHANGED');
    packet(admission.file,admission.sha256);packet(admission.oldCaseFile,admission.oldCaseSha256);
  };
}
function createAssessor({runtime,pageData,plan}){
  return function assess(b,input){
    b.assertLock();b.ownerProof(input.ownerProof);
    const raw=read(b.file),state=JSON.parse(raw),x=state.batches[admission.batchId],d=x?.dispatch,a=d?.attempts?.at(-1);
    need(typeof input.apply==='boolean'&&input.batchId===admission.batchId&&input.planHash===admission.planHash&&
      state.active===admission.batchId&&hash(raw)===incident.journalHash&&
      JSON.stringify(state)===JSON.stringify(b.state)&&x?.status==='HALTED'&&
      x.haltedFrom==='WRITE_PENDING'&&x.error==='SEND_PERMIT_EXPIRED_OR_FENCED'&&x.next===0&&
      x.edits.length===1&&x.planHash===admission.planHash&&x.receipt?.ticket===incident.ticket&&
      x.receipt.snapshotHash===incident.snapshotHash&&d.executor===incident.executor&&d.executor!==b.executor&&
      d.owner?.generation===incident.runId&&d.phase==='SEND_INTENT'&&d.provider===null&&
      d.attempts.length===1&&a.dispatchId===incident.dispatchId&&a.ticket===incident.ticket&&a.index===0&&
      a.phase==='SEND_INTENT'&&a.sendPermit&&!a.provider&&!a.revokedBeforeCall&&
      d.failure?.phase==='SEND_INTENT'&&d.failure.provider===null&&
      input.ownerProof.generation!==incident.runId&&Array.isArray(input.pages)&&input.pages.length===0&&
      (x.verifications??[]).length===0,'SORI_CONTROL_EXACT_INCIDENT');
    let priorLive=false;
    try{process.kill(incident.brokerPid,0);priorLive=true;}catch(error){need(error.code==='ESRCH','SORI_CONTROL_PRIOR_PROCESS_UNKNOWN');}
    need(!priorLive,'SORI_CONTROL_PRIOR_PROCESS_LIVE');
    const dir=path.join(b.root,'manual-audits/automatic-followthrough-20261028-04386a5');
    const diagnosticRaw=read(path.join(dir,incident.diagnosticFile)),traceRaw=read(path.join(dir,incident.traceFile));
    const diagnostic=JSON.parse(diagnosticRaw),trace=JSON.parse(traceRaw);
    need(hash(diagnosticRaw)===incident.diagnosticHash&&hash(traceRaw)===incident.traceHash&&
      hash(read(path.join(runtime,'runner.js'),false))===incident.runnerHash&&
      hash(read(path.join(dir,incident.hostPlanFile)))===incident.hostPlanHash,
      'SORI_CONTROL_EXECUTION_PINS');
    const q=diagnostic.execution,r=trace.r3;
    need(diagnostic.schema==='SORI_R3_V4_PERMIT_EXPIRY_RESULT_V1'&&diagnostic.nonce==='SORI-391159F9-R3'&&
      q?.batchId===admission.batchId&&q.planHash===admission.planHash&&q.ticket===incident.ticket&&
      q.dispatchId===incident.dispatchId&&q.requestHash===a.requestHash&&q.next===0&&q.provider===null&&
      q.error===x.error&&diagnostic.canonical?.sha256===incident.journalHash&&
      trace.schema==='SORI_R4_R3_ACTUAL_EVIDENCE_V1'&&r?.batchId===admission.batchId&&
      r.planHash===admission.planHash&&r.ticket===incident.ticket&&r.snapshotSha256===incident.snapshotHash&&
      r.dispatchId===incident.dispatchId&&r.requestHash===a.requestHash&&r.executor===incident.executor&&
      r.canonicalJournalSha256===incident.journalHash&&r.planSha256===incident.hostPlanHash&&
      r.originalRunnerSha256===incident.runnerHash&&
      r.sendPermit?.observedAt===a.sendPermit.observedAt&&r.sendPermit.validUntil===a.sendPermit.validUntil&&
      trace.conclusion?.nativeBodyCallCount==='UNKNOWN'&&trace.conclusion.directNegativeConclusion===false&&
      trace.missingOriginalProof?.thrownStack===true&&trace.missingOriginalProof.connectorSideNativeCallLedger===true,
      'SORI_CONTROL_EXECUTION_EVIDENCE');
    const snapshotRaw=read(x.receipt.snapshot),s=JSON.parse(snapshotRaw),fresh=pageData(input.page,x.edits[0].pageId);
    need(hash(snapshotRaw)===incident.snapshotHash&&x.receipt.snapshot===b.snapshot(admission.batchId,0)&&
      s.batchId===admission.batchId&&s.index===0&&s.ticket===incident.ticket&&
      JSON.stringify(s.edit)===JSON.stringify(x.edits[0])&&fresh.body===s.page.body&&
      fresh.properties===s.page.properties&&fresh.revision===s.page.revision&&
      plan(fresh,s.edit).expected===s.expected&&!fs.existsSync(x.receipt.snapshot+'.verified.json')&&
      !fs.existsSync(x.receipt.snapshot+'.actual.json'),'SORI_CONTROL_PREIMAGE');
    // The real successor investigation found missing original stack and native
    // call coverage. Provider-null and unchanged-page observations cannot turn
    // that UNKNOWN into a private no-call token or an eligible continuation.
    need(input.apply===false,'SORI_CONTROL_EXECUTION_UNPROVEN');
    return {eligible:false,checkOnly:true,classification:'C',batchId:admission.batchId,status:x.status,next:x.next,
      reason:'ORIGINAL_PRECALL_EXECUTION_PROOF_MISSING',nativeBodyCallCount:'UNKNOWN',
      missing:copyMissing(trace.missingOriginalProof),notionWrites:0,canonicalWrites:0,
      acknowledgedWrites:0,pageAdvances:0,ticketsCreated:0,
      nextAction:'Preserve the original SEND_INTENT. Obtain independently attributable original proof or a separately authorized reviewed exception; never infer no-send or retry from this assessment.'};
  };
}
function copyMissing(value){return JSON.parse(JSON.stringify(value));}
function createUserCase({runtime,pageData,plan,atomic}){
  const assess=createAssessor({runtime,pageData,plan});
  return function continueApproved(b,input){
    // First prove the same immutable UNKNOWN incident and its full preimage.
    // This is an explicit user exception, never a no-send reconciliation.
    const assessment=assess(b,{...input,apply:false});
    need(assessment.classification==='C'&&typeof input.apply==='boolean','SORI_CONTROL_USER_CASE');
    const dir=path.join(b.root,'manual-audits/automatic-followthrough-20261028-04386a5');
    const approvalFile=path.join(dir,'sori-startup-control-user-approval.json');
    need(fs.existsSync(approvalFile),'SORI_CONTROL_USER_APPROVAL_REQUIRED');
    // These are receipt-format and scope checks. The actual message must first
    // be authenticated by the separate operator procedure in the proposal doc.
    const approvalRaw=read(approvalFile),approval=JSON.parse(approvalRaw),at=Date.parse(approval.approvedAt);
    need(Object.keys(approval).sort().join(',')===
      ['schema','proposalSha256','decision','approvedAt','userMessageRef','userMessageSha256'].sort().join(',')&&
      approval.schema==='SORI_CONTROL_USER_APPROVAL_V1'&&approval.proposalSha256===proposalSha256&&
      approval.decision==='APPROVED'&&Number.isFinite(at)&&at>=Date.parse('2026-10-28T21:47:49.309Z')&&at<=Date.now()&&
      typeof approval.userMessageRef==='string'&&approval.userMessageRef.trim().length>0&&
      /^[a-f0-9]{64}$/.test(approval.userMessageSha256??''),'SORI_CONTROL_USER_APPROVAL_INVALID');
    const raw=read(b.file),state=JSON.parse(raw),x=state.batches[admission.batchId];
    need(hash(raw)===incident.journalHash&&JSON.stringify(state)===JSON.stringify(b.state)&&
      !x.userCaseContinuation,'SORI_CONTROL_USER_CASE_REPLAY');
    const audit={kind:'USER_APPROVED_UNKNOWN_SEND_CONTINUATION',batchId:admission.batchId,
      planHash:admission.planHash,ticket:incident.ticket,dispatchId:incident.dispatchId,
      proposalSha256,approvalSha256:hash(approvalRaw),userMessageRef:approval.userMessageRef,
      originalNativeCallCount:'UNKNOWN',notANoSendProof:true,oldExecutor:incident.executor,newExecutor:b.executor,
      journalBeforeHash:hash(raw),owner:input.ownerProof,at:new Date().toISOString(),
      notionWrites:0,acknowledgedWrites:0,pageAdvances:0,ticketsCreated:0};
    if(!input.apply)return {eligible:true,checkOnly:true,classification:'USER_APPROVED_EXCEPTION',
      originalNativeCallCount:'UNKNOWN',notANoSendProof:true,audit};
    const auditPath=path.join(b.root,'user-case-'+hash(admission.batchId)+'-'+crypto.randomUUID()+'.json');
    const fd=fs.openSync(auditPath,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({audit,journalBefore:state,freshPage:input.page,
      approval,exceptionProposal,assessment}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const next=JSON.parse(raw),out=next.batches[admission.batchId];
    out.userCaseContinuation={...audit,auditPath};
    out.dispatch.attempts[0].continuedUnderUserException={at:audit.at,record:auditPath,
      originalNativeCallCount:'UNKNOWN',notANoSendProof:true};
    out.dispatch.executor=b.executor;out.dispatch.owner=JSON.parse(JSON.stringify(input.ownerProof));
    out.dispatch.phase='PREPARED';out.status='PREPARED';
    // No old ACK, no-send token, revocation or verified page is invented.
    try{
      b.assertLock();b.ownerProof(input.ownerProof);
      need(read(b.file)===raw,'SORI_CONTROL_USER_CASE_CHANGED');
      need(read(approvalFile)===approvalRaw,'SORI_CONTROL_USER_APPROVAL_CHANGED');
    }catch(error){
      // The canonical atomic write has not been invoked. Retain the full audit
      // under an explicit aborted name; never mask the original guard refusal.
      try{const aborted=auditPath+'.aborted';fs.renameSync(auditPath,aborted);error.abortedAuditPath=aborted;}
      catch(abortError){error.auditAbortError={message:abortError.message,code:abortError.code??null};}
      throw error;
    }
    // Keep this outside the refusal catch: an atomic error may occur after a
    // real commit, so its potentially referenced audit must never be aborted.
    atomic(b.file,next);b.state=next;
    return {status:'PREPARED',next:out.next,executor:b.executor,planHash:out.planHash,...out.receipt,
      auditPath,originalNativeCallCount:'UNKNOWN',notANoSendProof:true,
      notionWrites:0,acknowledgedWrites:0,pageAdvances:0,ticketsCreated:0};
  };
}
module.exports={admission,incident,exceptionProposal,proposalSha256,createAdmission,createAssessor,createUserCase};
