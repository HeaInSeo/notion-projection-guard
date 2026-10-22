// Code Mode wrapper only; never install into the server runtime.
// Private connectorData/fetchPage/asyncTask/update/verifyAfterWrite bodies copied verbatim
// from pinned runner.js d77969f2d84776226c62f36c5fbfcf4af98de57f
// Git blob 0fd2266614e117e0a208e3c3be93caca2d89fb1e. broker/close are the original runner public APIs.
// This file has no helper/reset/status implementation and does not change installed core or policy.
(function createExactBoriPendingContinuation(tools,config){
'use strict';
const identity={"batchId":"BORI-AUTH15-DRIFT-REPAIR-20261022","planHash":"a5bab1162d1a8127a11e0bd8f447fe7b3852ede2e41189653674b9f91986c8ac","ticket":"29ab3ddd-dfa0-4b38-888e-b715d24a85f5","pageId":"3b286e6dd1d1811d9308d9a2b56c9de4","next":5};
const runner=config.createRunner(tools,config.runnerConfig);
const broker=request=>runner.broker(request);
function textOf(result){return (result?.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
  function connectorData(result) {
    let data=result;
    for(let n=0;n<5 && data.structuredContent;n++) data=data.structuredContent;
    if(data!==result) return data;
    for(const item of result.content??[]) {
      if(item.type==='text') {try {return JSON.parse(item.text);}catch { /* Not a structured reply. */ }}
    }
    return null;
  }
  const readDiagnostics=[];
  async function fetchPage(pageId, phase) {
    const failures=[];
    // Only this read-only connector call is retried. Authorization, mutations,
    // async ACKs and protected-content comparisons never enter this loop.
    for(let attempt=1;attempt<=3;attempt++) {
      try {
        const result=await tools.mcp__codex_apps__notion_fetch({id:pageId});
        let value=result;
        for(let depth=0;depth<6;depth++) {
          if(value?.isError||value?.error)throw new Error(JSON.stringify(value.error??
            {message:textOf(value).slice(0,240)||'Connector returned an error'}).slice(0,300));
          if(!value?.structuredContent)break;
          value=value.structuredContent;
        }
        const data=connectorData(result);
        if(data?.error)throw new Error(JSON.stringify(data.error).slice(0,300));
        if(failures.length)readDiagnostics.push({pageId,phase,attempts:attempt,failures});
        return result;
      } catch(error) {
        failures.push({attempt,cause:String(error?.message??error).slice(0,300)});
        if(attempt===3)throw Object.assign(new Error('FETCH_ERROR: native read failed at '+phase),
          {readDetail:JSON.stringify({pageId,phase,attempts:attempt,failures}).slice(0,1000)});
        await new Promise(resolve=>setTimeout(resolve,attempt*100));
      }
    }
  }
  function asyncTask(result) {
    const data = connectorData(result);
    return data?.async_task ?? data?.result?.async_task;
  }
  async function update(request) {
    let result = await tools.mcp__codex_apps__notion_notion_update_page(request);
    if (result.isError || connectorData(result)?.error) throw new Error('NOTION_UPDATE_FAILED');
    const task = asyncTask(result);
    if (task) {
      if (!task.task_id) throw new Error('ASYNC_RESULT_UNKNOWN');
      let completed=false;
      for (let n=0; n<20; n++) {
        await new Promise(resolve => setTimeout(resolve,1000));
        result = await tools.mcp__codex_apps__notion_notion_get_async_task({ task_id:task.task_id });
        if (result.isError) throw new Error('ASYNC_FAILED');
        const data=connectorData(result);
        if(!data)throw new Error('ASYNC_RESULT_UNKNOWN');
        if (data.status === 'failed') throw new Error('ASYNC_FAILED');
        if (data.status === 'succeeded') { completed=true; break; }
        if (!['queued','running','retrying'].includes(data.status)) throw new Error('ASYNC_RESULT_UNKNOWN');
      }
      if (!completed) throw new Error('ASYNC_PENDING_RECONCILE_REQUIRED');
    } else if (/"?async_task"?\s*[:=]/.test(textOf(result))) throw new Error('ASYNC_RESULT_UNKNOWN');
    if(!task) {
      const data=connectorData(result);
      if(typeof data?.page_id!=='string' || data.page_id.replaceAll('-','').toLowerCase()!==request.page_id)
        throw new Error('NOTION_RESULT_UNKNOWN');
    }
    return result;
  }

  async function verifyAfterWrite(batchId,ticket,pageId) {
    let page;
    const readFailure=error=>Object.assign(new Error('REVISION_READ_ERROR'),{readDetail:String(error?.readDetail??error?.message??error).slice(0,1000)});
    try{page=await fetchPage(pageId,'verify');}
    catch(error){throw readFailure(error);}
    try{return await broker({action:'verify',batchId,ticket,page});}
    catch(error){
      // Only failed/incomplete reads after the one authorized update are
      // classified. A mismatch, lost write ACK or broker fault keeps its cause.
      if(['INCOMPLETE_READ','FETCH_ERROR'].includes(error.code))throw readFailure(error);
      throw error;
    }
  }

async function run(){
  let enteredAttempt=false,updateInvocations=0;
  try{
    enteredAttempt=true;
    const authorized=await broker({action:'authorize',batchId:identity.batchId,ticket:identity.ticket,
      page:await fetchPage(identity.pageId,'authorize')});
    if(authorized.status!=='WRITE_PENDING'||authorized.ticket!==identity.ticket||
       !authorized.request||authorized.request.page_id!==identity.pageId)
      throw new Error('EXACT_PENDING_AUTHORIZATION_MISMATCH');
    updateInvocations++;
    const acknowledgement=await update(authorized.request);
    const verified=await verifyAfterWrite(identity.batchId,identity.ticket,identity.pageId);
    if(verified.status!=='COMPLETED'||verified.next!==identity.next||verified.protectedContent!=='UNCHANGED')
      throw new Error('EXACT_PENDING_VERIFICATION_MISMATCH');
    return {status:'COMPLETED',batchId:identity.batchId,planHash:identity.planHash,resumed:true,
      targets:1,updateInvocations,verified,acknowledgement,readDiagnostics};
  }catch(error){
    if(enteredAttempt){
      try{await broker({action:'halt',batchId:identity.batchId,reason:error.message,readDetail:error.readDetail});}
      catch{/* Do not reset, reclassify, resend, or proceed if halt is unavailable. */}
    }
    throw error;
  }finally{await runner.close();}
}
return {run};
})
