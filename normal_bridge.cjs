'use strict';
// Ordinary scheduled projection only. The legacy core and all original control
// files remain unchanged. A stage is data, and is never a grant or send permit.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
const need=(v,c)=>{if(!v)throw Error(c);};
function createBridge({broker,probe,installation,reconcileUnpermitted,reconcilePermitExpiry,restoreUnsent,resumePrepared,resumeUnprepared,verifyExtensions,validateControlInit,assessControlPermit,continueApprovedControl,sori48ClosureCheck}){
  let init=null,staged=null,closed=false,noCall=null;
  const check=()=>{
    need(!closed,'NORMAL_BRIDGE_CLOSED');broker.assertLock();verifyExtensions();
    const p=probe({root:installation.root,runtime:installation.runtime,
      caseModuleHash:installation.caseModuleHash,brokerPid:process.pid,batchId:init.batchId});
    need(p.canonical.exclusive===false&&p.brokerExecutor===broker.executor,'NORMAL_BRIDGE_OWNER');
    if(init.controlInput)validateControlInit({broker,input:init.controlInput});
    return p;
  };
  function proof(w){
    const p=check(),at=Date.parse(w?.observedAt),now=Date.now(),c=w?.central;
    need(w?.referenceToken===init.referenceToken&&Number.isFinite(at)&&at<=now&&now-at<30000,
      'NORMAL_LIVE_EXPIRED');
    need(Array.isArray(w.nativeChecks)&&w.nativeChecks.length===init.referenceIds.length&&
      w.nativeChecks.every((v,i)=>v.pageId===init.referenceIds[i]&&v.matched===true&&
        v.observedAt===w.observedAt&&typeof v.revision==='string'),'NORMAL_LIVE_NATIVE');
    need(c?.id===init.centralTaskId&&c.is_enabled===true&&c.run?.id===init.runId&&
      c.run.recorded_status==='in_progress','NORMAL_LIVE_CENTRAL_OWNER');
    return {ownerId:'automation:'+init.centralTaskId,generation:init.runId,scope:init.batchId,
      prerequisites:true,conflicts:[],evidenceHash:p.canonical.manifestHash,
      observedAt:w.observedAt,validUntil:new Date(Math.min(now+15000,at+30000)).toISOString(),
      currentCentralRunId:c.run.id,currentCentralRunStatus:c.run.recorded_status,
      authoritySource:'CANONICAL_CASE_ADMISSION',
      prerequisiteEvidence:'NORMAL-LIVE:'+init.referenceToken+':'+p.journalHash};
  }
  function bound(op){
    need(op?.batchId===init.batchId&&!Object.hasOwn(op,'ownerProof'),'NORMAL_OPERATION_SCOPE');
    if(op.action==='normal_sori48_unknown_check')need(init.closure===true&&op.batchId===init.batchId&&op.apply===false&&
      Object.keys(op).sort().join(',')==='action,apply,batchId','NORMAL_SORI48_CHECK_SCOPE');
    else if(op.action==='fence_begin')need(JSON.stringify(op.edits)===JSON.stringify(init.edits),'NORMAL_PLAN_CHANGED');
    else if(['normal_reconcile_prepared','normal_reconcile_unprepared','normal_assess_control_permit','normal_user_case_control_continue'].includes(op.action))need(op.planHash===init.planHash&&
      broker.state.batches[init.batchId]?.planHash===init.planHash,'NORMAL_PLAN_CHANGED');
    else if(!['normal_reconcile_unpermitted','normal_reconcile_permit_expiry'].includes(op.action)){
      const b=broker.state.batches[init.batchId];
      need(b?.planHash===init.planHash&&op.planHash===b.planHash&&op.executor===broker.executor,'NORMAL_OPERATION_IDENTITY');
    }
  }
  function freshProof(w,context){
    try{return proof(w);}catch(error){
      if(error.message==='NORMAL_LIVE_EXPIRED'){
        error.code='NORMAL_SOURCE_EXPIRED_NO_ACTION';error.retryBeforeAction=copy(context);
      }throw error;
    }
  }
  return {handle(input){
    need(!closed,'NORMAL_BRIDGE_CLOSED');
    if(input.action==='close'){closed=true;staged=null;return broker.handle({action:'close'});}
    if(input.action==='normal_init'||input.action==='normal_control_init'||input.action==='normal_sori48_closure_init'){
      need(!init&&!staged&&/^[a-f0-9]{32}$/.test(input.centralTaskId??'')&&typeof input.runId==='string'&&
        /^[A-Za-z0-9-]{1,100}$/.test(input.batchId??'')&&Array.isArray(input.edits)&&
        (input.action==='normal_sori48_closure_init'?input.edits.length===0:input.edits.length>0)&&
        Array.isArray(input.referenceIds)&&input.referenceIds.length>=4&&
        new Set(input.referenceIds).size===input.referenceIds.length&&
        input.referenceIds.every(id=>/^[a-f0-9]{32}$/.test(id))&&
        input.referenceIds.includes('3bf86e6dd1d18110938bc358e17c779e')&&
        input.referenceIds.includes('3b286e6dd1d18194866dd8d7a28c7ab4'),'NORMAL_INIT');
      const control=input.action==='normal_control_init',closure=input.action==='normal_sori48_closure_init';
      if(closure){
        need(input.batchId==='SORI48-PAIR-ADMIT-20261029'&&typeof sori48ClosureCheck==='function',
          'NORMAL_SORI48_CLOSURE_UNAVAILABLE');
      }else if(control){
        need(typeof validateControlInit==='function','NORMAL_CONTROL_UNAVAILABLE');
        validateControlInit({broker,input});
      }else need(!Object.hasOwn(input,'controlAdmissionId')&&['sori','nodekit'].includes(input.repository)&&
        Number.isSafeInteger(input.pr)&&input.pr>0&&
        new RegExp('^'+input.repository.toUpperCase()+input.pr+'-LANDED-[0-9]{8}$').test(input.batchId),
        'NORMAL_ADOPTED_SCOPE');
      init={batchId:input.batchId,centralTaskId:input.centralTaskId,runId:input.runId,
        referenceIds:copy(input.referenceIds),edits:copy(input.edits),planHash:hash(JSON.stringify(input.edits)),
        referenceToken:crypto.randomUUID(),...(control?{controlInput:copy(input)}:{}),...(closure?{closure:true}:{})};
      try{check();return {referenceToken:init.referenceToken,planHash:init.planHash,executor:broker.executor,
        continuation:broker.state.batches[init.batchId]?.dispatch?.phase??null};}
      catch(e){init=null;throw e;}
    }
    need(init,'NORMAL_INIT_REQUIRED');
    if(input.action==='case_stage_input'){
      need(!staged&&input.batchId===init.batchId&&
        ['fence_begin','fence_prepare','fence_authorize','fence_dispatch','normal_reconcile_unpermitted',
          'normal_reconcile_permit_expiry','normal_pre_call_expired','normal_reconcile_prepared','normal_reconcile_unprepared',
          'normal_assess_control_permit','normal_user_case_control_continue','normal_sori48_unknown_check'].includes(input.operation?.action)&&
        (!['normal_assess_control_permit','normal_user_case_control_continue'].includes(input.operation.action)||!!init.controlInput),
        'NORMAL_STAGE_SCOPE');bound(input.operation);check();
      const operation=copy(input.operation),stageId=crypto.randomUUID(),inputHash=hash(JSON.stringify(operation));
      staged={operation,stageId,inputHash};return {stageId,inputHash};
    }
    if(input.action==='case_consume_live'){
      need(input.batchId===init.batchId&&staged&&input.stageId===staged.stageId&&input.inputHash===staged.inputHash,
        'NORMAL_STAGE_IDENTITY');
      const op=staged.operation;staged=null;bound(op);
      const ownerProof=freshProof(input.liveSource,{action:input.action,stageId:input.stageId,inputHash:input.inputHash});
      if(op.action==='normal_sori48_unknown_check'){
        need(init.closure&&typeof sori48ClosureCheck==='function','NORMAL_SORI48_CLOSURE_UNAVAILABLE');
        need(/^[a-f0-9]{64}$/.test(input.liveSource?.central?.schedulerEvidenceSha256??''),
          'NORMAL_SORI48_SCHEDULED_PROOF');
        return sori48ClosureCheck({...op,apply:false,owner:{actor:ownerProof.ownerId,
          runId:ownerProof.generation,scheduledProofSha256:input.liveSource.central.schedulerEvidenceSha256}});
      }
      if(op.action==='normal_reconcile_unpermitted'){
        need(typeof reconcileUnpermitted==='function','NORMAL_RECOVERY_UNAVAILABLE');
        return reconcileUnpermitted(broker,{...op,ownerProof});
      }
      if(op.action==='normal_reconcile_permit_expiry'){
        need(typeof reconcilePermitExpiry==='function','NORMAL_RECOVERY_UNAVAILABLE');
        return reconcilePermitExpiry(broker,{...op,ownerProof});
      }
      if(op.action==='normal_assess_control_permit'){
        need(init.controlInput&&typeof assessControlPermit==='function','NORMAL_CONTROL_ASSESSMENT_UNAVAILABLE');
        return assessControlPermit(broker,{...op,ownerProof});
      }
      if(op.action==='normal_user_case_control_continue'){
        need(init.controlInput&&typeof continueApprovedControl==='function','NORMAL_CONTROL_USER_CASE_UNAVAILABLE');
        return continueApprovedControl(broker,{...op,ownerProof});
      }
      if(op.action==='normal_reconcile_prepared'){
        need(typeof resumePrepared==='function','NORMAL_PREPARED_RESUME_UNAVAILABLE');
        return resumePrepared(broker,{...op,ownerProof});
      }
      if(op.action==='normal_reconcile_unprepared'){
        need(typeof resumeUnprepared==='function','NORMAL_UNPREPARED_RESUME_UNAVAILABLE');
        return resumeUnprepared(broker,{...op,ownerProof});
      }
      if(op.action==='normal_pre_call_expired'){
        need(noCall&&typeof restoreUnsent==='function'&&op.noCallToken===noCall.token&&
          JSON.stringify(op.permit)===JSON.stringify(noCall.permit)&&
          op.dispatchId===noCall.permit.dispatchId,'NORMAL_NO_CALL_TOKEN');
        noCall=null;
        return restoreUnsent(broker,{...op,ownerProof});
      }
      return broker.handle({...op,ownerProof});
    }
    if(input.action==='case_live_send'){
      need(!staged&&input.batchId===init.batchId&&input.operation?.action==='fence_confirm_send','NORMAL_SEND_SCOPE');
      bound(input.operation);
      const result=broker.handle({...input.operation,ownerProof:freshProof(input.liveSource,
        {action:input.action,operation:input.operation})});
      noCall={token:crypto.randomUUID(),permit:copy(result.permit)};
      return {...result,noCallToken:noCall.token};
    }
    if(input.action==='fence_halt'&&input.batchId===init.batchId&&staged){
      bound(input);check();const discarded={stageId:staged.stageId,inputHash:staged.inputHash,action:staged.operation.action};
      staged=null;
      return {...broker.handle({...input,readDetail:JSON.stringify({unconsumedStageDiscarded:discarded})}),
        unconsumedStageDiscarded:discarded};
    }
    need(!staged&&input.batchId===init.batchId&&
      ['status','validate_batch','preflight','fence_observe','fence_ack','fence_verify','fence_halt'].includes(input.action),
      'NORMAL_ACTION');
    if(input.action==='validate_batch')need(JSON.stringify(input.edits)===JSON.stringify(init.edits),'NORMAL_PLAN_CHANGED');
    if(input.action==='preflight')need(init.edits.some(e=>JSON.stringify(e)===JSON.stringify(input.edit)),'NORMAL_PLAN_CHANGED');
    check();return broker.handle(input);
  }};
}
module.exports={createBridge};
