(function createNormalLiveRunner(tools,config){
  'use strict';
  const client=config.client;
  // The reviewed client owns the one-use no-call proof. Refuse a legacy or
  // incomplete adapter before init can create any durable send intent.
  if(!client||!['broker','close','sendOnce','recoverPreCall','consumeSourceExpiry'].every(k=>typeof client[k]==='function'))
    throw Error('NORMAL_RPC_CLIENT_REQUIRED');
  const rpc=client.broker.bind(client),sendOnce=client.sendOnce.bind(client),
    recoverPreCall=client.recoverPreCall.bind(client),consumeSourceExpiry=client.consumeSourceExpiry.bind(client),
    close=client.close.bind(client),copy=x=>JSON.parse(JSON.stringify(x));
  const text=r=>(r?.content??[]).filter(v=>v.type==='text').map(v=>v.text).join('\n');
  function unwrap(r){for(let i=0;i<10;i++){
    if(r?.isError||r?.error)throw Error('NORMAL_NATIVE_ERROR');
    if(r?.structuredContent){r=r.structuredContent;continue;}
    if(Array.isArray(r?.content)){r=JSON.parse(text(r));continue;}return r;
  }throw Error('NORMAL_NATIVE_ENVELOPE');}
  async function read(id){let last;for(let n=0;n<3;n++)try{
    const r=await tools.mcp__codex_apps__notion_fetch({id});unwrap(r);return r;
  }catch(e){last=e;}throw last;}
  let witness,initialized=false;
  async function init(batchId,edits){
    if(initialized)throw Error('NORMAL_RUNNER_SINGLE_USE');initialized=true;
    const control=config.controlAdmissionId!==undefined,closure=config.sori48Closure===true,
      sori48Pair=config.sori48Pair===true;
    const r=await rpc({action:control?'normal_control_init':closure?'normal_sori48_closure_init':
      sori48Pair?'normal_sori48_pair_init':'normal_init',
      batchId,edits,centralTaskId:config.centralTaskId,runId:config.runId,
      referenceIds:config.references.map(r=>r.pageId),
      ...(control?{controlAdmissionId:config.controlAdmissionId}:closure?{}:
        {repository:config.binding.repository,pr:config.binding.source.pr})});
    witness=config.createWitness(tools,{...config.witnessConfig,batchId,centralTaskId:config.centralTaskId,
      runId:config.runId,referenceToken:r.referenceToken,references:config.references,edits,
      nativeExpectations:config.nativeExpectations});return r;
  }
  async function owned(operation){
    for(let attempt=0;;attempt++){
      const stage=await rpc({action:'case_stage_input',batchId:operation.batchId,operation});
      // Only an attributed proof rejection BEFORE invoking the operation can
      // obtain a new stage and fresh reads. Transport uncertainty never retries.
      try{return await rpc({action:'case_consume_live',batchId:operation.batchId,...stage,
        liveSource:await freshWitness(operation.batchId)});}
      catch(error){if(attempt>=2||!consumeSourceExpiry(error))throw error;}
    }
  }
  async function freshWitness(batchId){
    for(let attempt=0;;attempt++)try{return await witness({batchId});}
    catch(error){if(attempt>=2||error.message!=='NORMAL_LIVE_EXPIRED')throw error;}
  }
  async function confirm(live){
    for(let attempt=0;;attempt++)try{return await rpc({action:'case_live_send',batchId:live.batchId,
      operation:{...live,action:'fence_confirm_send'},liveSource:await freshWitness(live.batchId)});}
    catch(error){if(attempt>=2||!consumeSourceExpiry(error))throw error;}
  }
  async function send(request,permit,live){
    // Only the captured reviewed client's synchronous send boundary may invoke
    // Notion. There is no legacy fallback or await before that boundary.
    const invoke=()=>tools.mcp__codex_apps__notion_notion_update_page(request);
    let raw=await sendOnce(request,permit,live,invoke),data=unwrap(raw);
    const task=data?.async_task??data?.result?.async_task;
    if(task){
      if(typeof task.task_id!=='string'||!task.task_id)throw Error('ASYNC_RESULT_UNKNOWN');
      await rpc({...live,action:'fence_observe',provider:{status:'PENDING',taskId:task.task_id,pageId:request.page_id}});
      let complete=false;
      for(let n=0;n<20;n++){
        await new Promise(resolve=>setTimeout(resolve,1000));
        data=unwrap(await tools.mcp__codex_apps__notion_notion_get_async_task({task_id:task.task_id}));
        if(data.status==='succeeded'){complete=true;break;}
        if(!['queued','running','retrying'].includes(data.status))throw Error('ASYNC_FAILED_OR_UNKNOWN');
      }
      if(!complete)throw Error('ASYNC_PENDING_RECONCILE_REQUIRED');
    }else if(typeof data?.page_id!=='string'||data.page_id.replaceAll('-','')!==request.page_id)
      throw Error('NOTION_RESULT_UNKNOWN');
    return {status:'SUCCEEDED',pageId:request.page_id,taskId:task?.task_id??null};
  }
  async function closeSori48(batchId,apply){
    let failure=null;
    try{
      await init(batchId,[]);
      const operation={action:apply?'normal_sori48_unknown_apply':'normal_sori48_unknown_check',batchId,apply};
      const stage=await rpc({action:'case_stage_input',batchId,operation});
      return await rpc({action:'case_consume_live',batchId,...stage,liveSource:await freshWitness(batchId)});
    }catch(error){failure=error;throw error;}
    finally{try{await close();}catch(error){
      if(!failure)throw error;failure.closeError={message:error.message,code:error.code??null};
    }}
  }
  return {async checkSori48Closure(batchId){return closeSori48(batchId,false);},
  async applySori48Closure(batchId){return closeSori48(batchId,true);},
  async run(batchId,edits){
    edits=copy(edits);let live=null,failure=null;const receipts=[];
    try{
      const initial=await init(batchId,edits);
      const checked=await rpc({action:'validate_batch',batchId,edits});
      if(checked.status==='COMPLETED')return {status:'COMPLETED',alreadyConsumed:true,receipts};
      let prepared=null,next=checked.next;
      const preparedResume=checked.status==='PREPARED'||checked.status==='HALTED'&&config.recovery?.kind==='PREPARED_NO_SEND';
      const unpreparedResume=checked.status==='READY'&&initial.continuation==='UNSENT'||
        checked.status==='HALTED'&&config.recovery?.kind==='UNPREPARED_NO_SEND';
      if(checked.status==='HALTED'||preparedResume||unpreparedResume){
        if(checked.status==='HALTED'&&config.recovery?.apply!==true)throw Error('EXPLICIT_UNPERMITTED_RECOVERY_REQUIRED');
        const page=await read(edits[next].pageId);
        const permitRecovery=config.recovery?.kind==='PRE_CALL_EXPIRED'&&!preparedResume;
        const userCase=config.recovery?.kind==='USER_APPROVED_CONTROL_CONTINUATION';
        const operation={...copy(config.recovery??{}),action:unpreparedResume?'normal_reconcile_unprepared':preparedResume?'normal_reconcile_prepared':
          userCase?'normal_user_case_control_continue':permitRecovery?'normal_reconcile_permit_expiry':'normal_reconcile_unpermitted',batchId,page,
          ...(preparedResume||unpreparedResume||userCase?{planHash:initial.planHash}:{})};
        delete operation.apply;
        delete operation.kind;
        if(permitRecovery||preparedResume||unpreparedResume||userCase)operation.pages=await Promise.all(edits.slice(0,next).map(e=>read(e.pageId)));
        const assessment=await owned({...operation,apply:false});
        if(assessment.eligible!==true)throw Error('NORMAL_RECOVERY_INELIGIBLE');
        prepared=await owned({...operation,page:await read(edits[next].pageId),
          ...(permitRecovery||preparedResume||unpreparedResume||userCase?{pages:await Promise.all(edits.slice(0,next).map(e=>read(e.pageId)))}:{}),apply:true});
        live={batchId,executor:prepared.executor,planHash:prepared.planHash};
        if(unpreparedResume)prepared=null;
      }else{
        if(checked.status!=='READY')throw Error('UNRESOLVED_BATCH: '+checked.status);
        await freshWitness(batchId);
        for(let i=next;i<edits.length;i++)await rpc({action:'preflight',batchId,edit:edits[i],page:await read(edits[i].pageId)});
        const begin=await owned({action:'fence_begin',batchId,edits});
        live={batchId,executor:begin.executor,planHash:begin.planHash};next=begin.next;
        if(initial.planHash!==begin.planHash)throw Error('NORMAL_PLAN_CHANGED');
      }
      for(let i=next;i<edits.length;i++){
        const edit=edits[i];live.ticket=null;live.dispatchId=null;
        const p=prepared&&i===next?prepared:await owned({...live,action:'fence_prepare',page:await read(edit.pageId)});
        live.ticket=p.ticket;
        for(let renewal=0;;renewal++){
        await owned({...live,action:'fence_authorize',page:await read(edit.pageId)});
        const dispatch=await owned({...live,action:'fence_dispatch',page:await read(edit.pageId)});
        live.dispatchId=dispatch.dispatchId;
        const confirmed=await confirm(live);
        let provider;
        try{provider=await send(dispatch.request,confirmed.permit,live);}
        catch(error){
          if(error.message!=='NORMAL_PRE_CALL_PERMIT_EXPIRED'||renewal>=2)throw error;
          await recoverPreCall(error,owned,await read(edit.pageId));
          continue;
        }
        await rpc({...live,action:'fence_ack',provider});
        const verified=await rpc({...live,action:'fence_verify',page:await read(edit.pageId)});
        receipts.push({pageId:edit.pageId,...verified,snapshot:p.snapshot});
        break;
        }
      }
      return {status:'COMPLETED',receipts};
    }catch(error){
      failure=error;
      if(live)try{error.recovery=await rpc({...live,action:'fence_halt',reason:error.message});}catch{}
      throw error;
    }finally{try{await close();}catch(error){
      if(!failure)throw error;failure.closeError={message:error.message,code:error.code??null};
    }}
  }};
})
