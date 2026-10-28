(function createNormalRpcClient(tools,config){
  'use strict';
  const start=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process;
  const interact=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process;
  const read=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output;
  if(![start,interact,read].every(f=>typeof f==='function'))throw Error('NORMAL_ADDITIONAL_MCP_REQUIRED');
  const text=r=>(r?.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  const clone=x=>JSON.parse(JSON.stringify(x));
  const metadata=new Set(['case_consume_live','case_live_send','fence_ack','fence_observe','fence_halt','close']);
  let pid=null,sequence=0,closed=false,busy=false,grant=null,dispatch=null;
  const unsent=new WeakMap();
  function parse(r,id){
    if(r?.isError||r?.error||r?.call_id||r?.structuredContent?.call_id)throw Error('NORMAL_RPC_TRANSPORT_UNKNOWN');
    const lines=text(r).split('\n').map(l=>l.trim()).filter(l=>l.startsWith('NPG/2 '));
    for(const line of lines){
      if(line.length>32768)throw Error('NORMAL_RPC_REPLY_TOO_LARGE');
      const v=JSON.parse(line.slice(6));if(id===null?v.ready===true:v.requestId===id)return v;
    }
    return null;
  }
  async function boot(){
    if(closed)throw Error('NORMAL_CLIENT_CLOSED');
    if(pid!==null)return;
    const r=await start({command:config.command,timeout_ms:500});
    parse(r,null);pid=Number(text(r).match(/PID (\d+)/)?.[1]);
    if(!Number.isSafeInteger(pid)||pid<=0)throw Error('NORMAL_RPC_START_UNKNOWN');
    let ready=parse(r,null);
    for(let i=0;!ready&&i<12;i++)ready=parse(await read({pid,offset:-2,length:2,timeout_ms:0}),null);
    if(!ready)throw Error('NORMAL_RPC_NOT_READY');
  }
  async function rpc(q,internal=false){
    if(busy)throw Error('NORMAL_RPC_CONCURRENT');
    if(!internal&&q.action==='normal_pre_call_expired')throw Error('NORMAL_RPC_PRIVATE_ACTION');
    busy=true;
    try{
      await boot();const requestId='normal-'+pid+'-'+(++sequence);
      const input=JSON.stringify({...q,requestId})+'\n';
      // Prompt matching is restricted to bounded metadata. Full page inputs
      // never enter it. Retained output includes the frame and trailing blank
      // line, without the preceding multi-megabyte input echo.
      const bounded=metadata.has(q.action)&&!Object.hasOwn(q,'page')&&!Object.hasOwn(q,'edits')&&input.length<=16384;
      let v=parse(await interact({pid,input,timeout_ms:bounded?3000:500,wait_for_prompt:bounded}),requestId);
      for(let i=0;!v&&i<12;i++)v=parse(await read({pid,offset:-2,length:2,timeout_ms:0}),requestId);
      if(!v)throw Error('NORMAL_RPC_RESPONSE_UNKNOWN');
      if(v.ok!==true){const e=Error(v.code+': '+v.error);e.code=v.code;throw e;}
      const result=v.result;
      if(result?.request&&result?.dispatchId)dispatch=clone(result);
      if(q.action==='case_live_send'){
        if(grant||typeof result?.noCallToken!=='string'||!result.permit||
          dispatch?.dispatchId!==result.permit.dispatchId)throw Error('NORMAL_SEND_TOKEN_UNKNOWN');
        grant={token:result.noCallToken,permit:clone(result.permit),live:clone(q.operation),request:clone(dispatch.request)};
        delete result.noCallToken;
      }
      return result;
    }finally{busy=false;}
  }
  function sendOnce(request,permit,live,invoke){
    const g=grant;grant=null;
    if(!g||JSON.stringify(g.request)!==JSON.stringify(request)||JSON.stringify(g.permit)!==JSON.stringify(permit)||
      !['batchId','executor','planHash','ticket','dispatchId'].every(k=>g.live[k]===live[k])||
      permit.dispatchId!==live.dispatchId||permit.executor!==live.executor||permit.pageId!==request.page_id)
      throw Error('NORMAL_SEND_IDENTITY');
    const now=Date.now(),at=Date.parse(permit.observedAt),until=Date.parse(permit.validUntil);
    if(!Number.isFinite(at)||!Number.isFinite(until)||at>now)throw Error('SEND_PERMIT_EXPIRED_OR_FENCED');
    if(until<=now||now-at>=30000){
      const e=Error('NORMAL_PRE_CALL_PERMIT_EXPIRED');
      unsent.set(e,g);throw e;
    }
    // Consume the private no-call token before invoking the only native call.
    // No await, transport or caller callback precedes invocation here.
    return invoke();
  }
  async function recoverPreCall(error,owned,page){
    const g=unsent.get(error);if(!g)throw error;unsent.delete(error);
    return owned({...g.live,action:'normal_pre_call_expired',noCallToken:g.token,
      permit:g.permit,page});
  }
  return {broker:q=>rpc(q),sendOnce,recoverPreCall,
    async close(){if(!closed&&pid!==null){await rpc({action:'close'});closed=true;grant=null;}}};
})
