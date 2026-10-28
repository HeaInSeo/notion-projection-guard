(function createAdditionalMcpTransport(tools) {
  'use strict';
  // An API adapter for the unchanged, pinned runner. It neither retries a
  // command nor implements a second broker, journal or mutation path.
  const start=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process;
  const interact=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process;
  const read=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output;
  if (![start,interact,read].every(x=>typeof x==='function')) throw Error('ADDITIONAL_MCP_REQUIRED');
  function nativeEnvelope(result) {
    let value=result;
    for(let i=0;i<8;i++) {
      if(value?.isError||value?.error)return result;
      if(value?.structuredContent){value=value.structuredContent;continue;}
      if(Array.isArray(value?.content)){
        try{value=JSON.parse(value.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));continue;}catch{}
      }
      return {...result,structuredContent:value};
    }
    throw Error('NATIVE_ENVELOPE_UNKNOWN');
  }
  let brokerPid=null;
  const native={};
  for(const name of ['mcp__codex_apps__notion_fetch','mcp__codex_apps__notion_notion_update_page',
    'mcp__codex_apps__notion_notion_get_async_task'])
    if(typeof tools[name]==='function')native[name]=async args=>nativeEnvelope(await tools[name](args));
  return Object.assign({},tools,native,{
    getNpgBrokerPid:()=>brokerPid,
    mcp__codex_apps__remote_desktop_commander_start_process: async ({command,timeout_ms}) => {
      const result=await start({command,timeout_ms});
      const text=(result?.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
      const pid=Number(text.match(/PID (\d+)/)?.[1]);
      if(result.isError||!pid||brokerPid!==null)throw Error('BROKER_START_UNKNOWN_OR_DUPLICATED');
      brokerPid=pid;return result;
    },
    mcp__codex_apps__remote_desktop_commander_interact_with_process: ({pid,input,timeout_ms,wait_for_prompt}) =>
      interact({pid,input,timeout_ms,wait_for_prompt}),
    mcp__codex_apps__remote_desktop_commander_read_process_output: ({pid,offset,length,timeout_ms}) =>
      read({pid,offset,length,timeout_ms}),
    // Additional MCP replies are synchronous. A deferred result from another
    // transport must fail closed instead of falling back to Desktop Commander.
    mcp__codex_apps__remote_desktop_commander_get_tool_result: async () => { throw Error('UNEXPECTED_DEFERRED_TRANSPORT'); }
  });
})
