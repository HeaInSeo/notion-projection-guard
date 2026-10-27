(function createProjectionRunner(tools, config) {
  'use strict';
  // Evaluated as a function expression in Code Mode; no Node imports are used.
  const deviceId = config.deviceId;
  const command = config.command;
  const metadataActions=new Set(['case_authority','validate_owner_proof','fence_confirm_send',
    'close','fence_ack','fence_observe','fence_halt','case_consume_input']);
  let pid, sequence = 0, closed = false;
  function textOf(result) { return (result?.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n'); }
  async function settled(value) {
    for (let n = 0; n < 12; n++) {
      const callId = value.call_id ?? value.structuredContent?.call_id ?? textOf(value).match(/call_id[": =]+([a-zA-Z0-9_-]+)/)?.[1];
      if (!callId) return value;
      value = await tools.mcp__codex_apps__remote_desktop_commander_get_tool_result({ call_id: callId });
      if (value.isError) throw new Error('REMOTE_CALL_FAILED: '+textOf(value).slice(0,300));
      if (!/pending|executing|running/i.test(value.structuredContent?.status ?? '') && textOf(value).includes('NPG/1 ')) return value;
    }
    throw new Error('REMOTE_RESULT_UNKNOWN');
  }
  function response(result, requestId) {
    if (result.isError) throw new Error('REMOTE_ERROR: '+textOf(result).slice(0,300));
    const values = textOf(result).split('\n').map(line=>line.trim()).filter(line => line.startsWith('NPG/1 ')).map(line => JSON.parse(line.slice(6)));
    return values.find(value => value.requestId === requestId);
  }
  async function start() {
    if (closed) throw new Error('BROKER_CLOSED: create a new runner for a new batch');
    if (pid) return;
    const result = await settled(await tools.mcp__codex_apps__remote_desktop_commander_start_process({ deviceId, command, timeout_ms: 3000 }));
    pid = Number(textOf(result).match(/PID (\d+)/)?.[1]);
    if (!pid) throw new Error('BROKER_NOT_READY: '+textOf(result).slice(0,500));
    let ready=textOf(result).includes('"ready":true');
    for(let n=0;!ready && n<12;n++) {
      const output=await settled(await tools.mcp__codex_apps__remote_desktop_commander_read_process_output({deviceId,pid,timeout_ms:3000,length:30}));
      if(textOf(output).includes('"code":'))throw new Error('BROKER_NOT_READY: '+textOf(output).slice(0,500));
      ready=textOf(output).includes('"ready":true');
    }
    if(!ready)throw new Error('BROKER_NOT_READY');
  }
  async function broker(request) {
    await start();
    const requestId = 'projection-'+pid+'-'+(++sequence);
    const input=JSON.stringify({ ...request, requestId })+'\n';
    // Prompt matching is safe only for bounded metadata. Large page input keeps
    // the JSON-line path and exact-ID retained-output read, without resending.
    const metadata=metadataActions.has(request.action)&&!Object.hasOwn(request,'page')&&
      !Object.hasOwn(request,'edits')&&input.length<=16384;
    const result = await settled(await tools.mcp__codex_apps__remote_desktop_commander_interact_with_process({
      // This is a JSON-line protocol, not a shell prompt. DC prompt detection
      // can compile the echoed multi-megabyte page as a regular expression.
      deviceId, pid, input, timeout_ms: metadata?500:3000, wait_for_prompt: metadata }));
    let value = response(result, requestId);
    for (let n=0; !value && n<12; n++) {
      // DC's incremental cursor can already have consumed output during input.
      // Read the retained tail and match the exact request ID; never resend it.
      value = response(await settled(await tools.mcp__codex_apps__remote_desktop_commander_read_process_output({ deviceId, pid, offset:-30, timeout_ms: 0, length: 30 })), requestId);
    }
    if (!value) throw new Error('BROKER_RESPONSE_UNKNOWN');
    if (!value.ok) { const error = new Error(value.code+': '+value.error); error.code=value.code; throw error; }
    return value.result;
  }
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
  async function update(request, onProvider, permit, live) {
    // This is the final synchronous check after the last await and immediately
    // before invoking the native tool. A delayed confirmation reply grants no
    // authority after its actual source lease/freshness window has expired.
    const now=Date.now(),until=Date.parse(permit?.validUntil),observed=Date.parse(permit?.observedAt);
    if(!permit||permit.dispatchId!==live.dispatchId||permit.executor!==live.executor||
        permit.pageId!==request.page_id||!Number.isFinite(until)||!Number.isFinite(observed)||
        until<=now||now-observed>30000||observed>now)
      throw new Error('SEND_PERMIT_EXPIRED_OR_FENCED');
    let result = await tools.mcp__codex_apps__notion_notion_update_page(request);
    if (result.isError || connectorData(result)?.error) throw new Error('NOTION_UPDATE_FAILED');
    const task = asyncTask(result);
    if (task) {
      if (!task.task_id) throw new Error('ASYNC_RESULT_UNKNOWN');
      if(onProvider)await onProvider({status:'PENDING',taskId:task.task_id,pageId:request.page_id});
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
    return {raw:result,provider:{status:'SUCCEEDED',pageId:request.page_id,taskId:task?.task_id??null}};
  }
  async function close() {
    if (pid && !closed) {
      // Graceful broker close releases only the process lock. Durable pending/HALTED
      // state survives; no journal reset or retry is performed by this adapter.
      await broker({ action:'close' });
      closed = true;
    }
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
  async function ownership(phase,batchId) {
    if(typeof config.assertOwnership!=='function')throw new Error('OWNERSHIP_CAPABILITY_REQUIRED');
    // This must read the actual scoped owner, competing central runs and all
    // required gates. Owner transfers participate in the canonical lock.
    return await config.assertOwnership({phase,batchId});
  }
  async function legacyOwnership(phase,batchId,binding) {
    // A successful callback is not itself a successful gate. Validate its
    // returned schema/freshness/conflicts and bind the same owner generation.
    return await broker({action:'validate_owner_proof',batchId,
      ownerProof:await ownership(phase,batchId),binding});
  }
  async function ownedPage(request,phase) {
    if(config.casePageStaging===true) {
      if(config.caseAckBridge!==true)throw new Error('EXPLICIT_CASE_ACK_BRIDGE_REQUIRED');
      // Transfer the immutable full input before observing the short-lived
      // authority. The stage is process-local data, never a write permit.
      const staged=await broker({action:'case_stage_input',batchId:request.batchId,operation:request});
      return await broker({action:'case_consume_input',batchId:request.batchId,
        stageId:staged.stageId,inputHash:staged.inputHash,
        ownerProof:await ownership(phase,request.batchId)});
    }
    return await broker({...request,ownerProof:await ownership(phase,request.batchId)});
  }
  async function fencedPages(live,edits,next,firstReceipt=null) {
    const receipts=[],batchId=live.batchId;
    for(let index=next;index<edits.length;index++) {
        const edit=edits[index];live.ticket=null;live.dispatchId=null;
        let prepared=firstReceipt&&index===next?firstReceipt:null;
        if(!prepared) {
          const preparePage=await fetchPage(edit.pageId,'prepare');
          prepared=await ownedPage({...live,action:'fence_prepare',page:preparePage},'prepare');
        }
        live.ticket=prepared.ticket;
        const authorizePage=await fetchPage(edit.pageId,'authorize');
        await ownedPage({...live,action:'fence_authorize',ticket:live.ticket,page:authorizePage},'authorize');
        // Authorization exports no request. The final source check and fresh
        // page still run before the durable SEND_INTENT/export boundary.
        const dispatchPage=await fetchPage(edit.pageId,'dispatch');
        const dispatch=await ownedPage({...live,action:'fence_dispatch',ticket:live.ticket,page:dispatchPage},'dispatch');
        live.dispatchId=dispatch.dispatchId;
        const confirmed=await broker({...live,action:'fence_confirm_send',ownerProof:await ownership('send',batchId)});
        const sent=await update(dispatch.request,provider=>broker({...live,action:'fence_observe',provider}),confirmed.permit,live);
        await broker({...live,action:'fence_ack',provider:sent.provider});
        let verified;
        try {
          verified=await broker({...live,action:'fence_verify',page:await fetchPage(edit.pageId,'verify')});
        } catch(error) {
          if(['INCOMPLETE_READ','FETCH_ERROR'].includes(error.code)||error.message.startsWith('FETCH_ERROR'))
            throw Object.assign(new Error('REVISION_READ_ERROR'),{readDetail:error.readDetail??error.message});
          throw error;
        }
        receipts.push({pageId:edit.pageId,...verified,snapshot:prepared.snapshot});
      }
    return receipts;
  }
  async function run(batchId, edits) {
    edits=JSON.parse(JSON.stringify(edits));
    const receipts=[];
    let live=null;
    try {
      const checked=await broker({action:'validate_batch',batchId,edits});
      if(checked.status==='COMPLETED')return {status:'COMPLETED',alreadyConsumed:true,receipts};
      if(checked.status!=='READY')throw new Error('UNRESOLVED_BATCH: '+checked.status);
      await ownership('preflight',batchId);
      for(let i=checked.next;i<edits.length;i++)await broker({action:'preflight',batchId,
        edit:edits[i],page:await fetchPage(edits[i].pageId,'preflight')});
      const begin=await broker({action:'fence_begin',batchId,edits,ownerProof:await ownership('begin',batchId)});
      live={batchId,executor:begin.executor,planHash:begin.planHash};
      receipts.push(...await fencedPages(live,edits,begin.next));
      return {status:'COMPLETED',receipts,readDiagnostics};
    } catch(error) {
      if(live) {
        try {error.recovery=await broker({...live,action:'fence_halt',reason:error.message,readDetail:error.readDetail});}
        catch { /* Lost replies never permit replay or replacing the original error. */ }
      }
      throw error;
    } finally {await close();}
  }
  async function resume(batchId, expectedPlanHash) {
    let live=null,enteredRecovery=false;
    try {
      const state=await broker({action:'status',batchId:batchId??null}),batch=state.batches?.[batchId];
      if(state.active!==batchId||!batch||batch.planHash!==expectedPlanHash||batch.status!=='HALTED'||!batch.receipt)
        throw new Error('RECONCILE_IDENTITY');
      if(batch.dispatch||config.allowLegacyRecovery!==true)throw new Error('EXPLICIT_LEGACY_RECOVERY_REQUIRED');
      const owner=await legacyOwnership('legacy-recovery',batchId);
      enteredRecovery=true;
      const page=await fetchPage(batch.edits[batch.next].pageId,'reconcile-prepared');
      const adopted=await broker({action:'fence_reconcile_prepared',batchId,planHash:expectedPlanHash,
        expectedError:batch.error,ticket:batch.receipt.ticket,page,binding:owner,
        ownerProof:await ownership('legacy-reconcile',batchId)});
      live={batchId,executor:adopted.executor,planHash:adopted.planHash,ticket:batch.receipt.ticket};
      const receipts=await fencedPages(live,batch.edits,batch.next,batch.receipt);
      return {status:'COMPLETED',resumed:true,receipts,readDiagnostics};
    } catch(error) {
      if(enteredRecovery) {
        try {await broker({...live,batchId,action:live?'fence_halt':'halt',reason:error.message,readDetail:error.readDetail});}
        catch { /* Original state and error remain closed. */ }
      }
      throw error;
    } finally {await close();}
  }
  async function reconcileAcknowledged(batchId, expectedPlanHash, apply=false) {
    try {
      if(config.caseAckBridge!==true||typeof apply!=='boolean')throw new Error('EXPLICIT_CASE_ACK_BRIDGE_REQUIRED');
      const state=await broker({action:'case_recovery_status',batchId}),batch=state.batches?.[batchId];
      if(state.active!==batchId||batch?.planHash!==expectedPlanHash||batch.status!=='HALTED'||!batch.receipt)
        throw new Error('RECONCILE_IDENTITY');
      const priorPages=[];
      for(let index=0;index<batch.next;index++)priorPages.push(await fetchPage(batch.edits[index].pageId,'ack-prior'));
      const page=await fetchPage(batch.edits[batch.next].pageId,'ack-full-readback');
      // No update, ACK or ordinary resume is called here, even on a lost reply.
      return await ownedPage({action:'case_reconcile_acknowledged',batchId,planHash:expectedPlanHash,apply,
        journalHash:state.journalHash,expectedError:batch.error,ticket:batch.receipt.ticket,
        snapshotHash:batch.receipt.snapshotHash,dispatchId:batch.dispatch?.attempts?.at(-1)?.dispatchId,
        priorPages,page},'ack-reconciliation');
    } finally {await close();}
  }
  async function continueVerifiedCase(batchId, expectedPlanHash, restoration) {
    let live=null;
    try {
      if(config.caseAckBridge!==true)throw new Error('EXPLICIT_CASE_ACK_BRIDGE_REQUIRED');
      const state=await broker({action:'case_recovery_status',batchId}),batch=state.batches?.[batchId];
      if(state.active!==batchId||batch?.planHash!==expectedPlanHash||batch.status!=='READY'||batch.receipt!==null)
        throw new Error('RECONCILE_IDENTITY');
      const priorPages=[],remainingPages=[];
      for(let index=0;index<batch.edits.length;index++){
        const page=await fetchPage(batch.edits[index].pageId,'verified-continuation');
        (index<batch.next?priorPages:remainingPages).push(page);
      }
      const adopted=await ownedPage({action:'case_continue_verified',batchId,planHash:expectedPlanHash,
        journalHash:state.journalHash,restoration,priorPages,remainingPages},'verified-continuation');
      live={batchId,planHash:adopted.planHash,executor:adopted.executor};
      const receipts=await fencedPages(live,batch.edits,adopted.next);
      return {status:'COMPLETED',resumed:true,receipts,readDiagnostics};
    } catch(error) {
      if(live)try{await broker({...live,action:'fence_halt',reason:error.message,readDetail:error.readDetail});}catch{}
      throw error;
    } finally {await close();}
  }
  async function resumeCaseUnprepared(batchId,expectedPlanHash,apply=false) {
    let live=null;
    try {
      if(config.caseAckBridge!==true||config.casePageStaging!==true||typeof apply!=='boolean')
        throw new Error('EXPLICIT_CASE_UNPREPARED_RECOVERY_REQUIRED');
      const state=await broker({action:'case_recovery_status',batchId}),batch=state.batches?.[batchId];
      if(state.active!==batchId||batch?.planHash!==expectedPlanHash)throw new Error('RECONCILE_IDENTITY');
      const pages=[];
      for(const edit of batch.edits)pages.push(await fetchPage(edit.pageId,'case-unprepared'));
      const adopted=await ownedPage({action:'case_restore_unprepared',batchId,planHash:expectedPlanHash,
        journalHash:state.journalHash,expectedError:batch.error,pages,apply},'case-unprepared');
      if(!apply)return adopted;
      live={batchId,executor:adopted.executor,planHash:adopted.planHash};
      const receipts=await fencedPages(live,batch.edits,adopted.next);
      return {status:'COMPLETED',resumed:true,receipts,readDiagnostics};
    } catch(error) {
      if(live)try{await broker({...live,action:'fence_halt',reason:error.message,readDetail:error.readDetail});}catch{}
      throw error;
    } finally {await close();}
  }
  async function resumeUnprepared(batchId, expectedPlanHash) {
    try {
      const state=await broker({action:'status',batchId:batchId??null}),batch=state.batches?.[batchId];
      if(state.active!==batchId||!batch||batch.planHash!==expectedPlanHash||batch.status!=='HALTED'||
          batch.haltedFrom!=='READY'||batch.receipt!==null)throw new Error('RECONCILE_IDENTITY');
      if(batch.dispatch||config.allowLegacyRecovery!==true)throw new Error('EXPLICIT_LEGACY_RECOVERY_REQUIRED');
      const owner=await legacyOwnership('legacy-recovery',batchId);
      const input={action:'reconcile_unprepared_read',batchId,planHash:expectedPlanHash,
        expectedError:batch.error,page:await fetchPage(batch.edits[batch.next].pageId,'reconcile-ready')};
      await broker({...input,apply:false});
      await legacyOwnership('legacy-reconcile',batchId,owner);
      const recovered=await broker({...input,apply:true});
      // The broker restored only READY. Every remaining page still passes the
      // ordinary same-batch preflight/authorization/write/full verification.
      return {...await run(batchId,batch.edits),resumed:true,recoveryAudit:recovered.audit};
    } finally {await close();}
  }
  async function reconcileAutolink(batchId, expectedPlanHash, snapshotHash, actualHash, actualSnapshotHash) {
    try {
      const state = await broker({ action:'status', batchId:batchId??null });
      const batch = state.batches?.[batchId];
      if (state.active !== batchId || !batch || batch.planHash !== expectedPlanHash ||
          batch.status !== 'HALTED' || batch.error !== 'READBACK_MISMATCH' ||
          batch.edits.length !== 1 || batch.next !== 0 || !batch.receipt)
        throw new Error('RECONCILE_IDENTITY');
      if(batch.dispatch||config.allowLegacyRecovery!==true)throw new Error('EXPLICIT_LEGACY_RECOVERY_REQUIRED');
      const owner=await legacyOwnership('legacy-recovery',batchId);
      const page=await fetchPage(batch.edits[0].pageId,'reconcile-autolink');
      await legacyOwnership('legacy-reconcile',batchId,owner);
      return await broker({ action:'reconcile_autolink', batchId, planHash:expectedPlanHash,
        expectedError:'READBACK_MISMATCH', ticket:batch.receipt.ticket, snapshotHash, actualHash, actualSnapshotHash,
        page });
    } finally { await close(); }
  }
  return { run, resume, resumeUnprepared, resumeCaseUnprepared, reconcileAutolink, reconcileAcknowledged, continueVerifiedCase, broker, close };
})
