(function createNormalProjectionPrerequisites(tools,config) {
  'use strict';
  // A reviewed, ordinary scheduled projection provider. The old exclusive
  // recovery provider remains unchanged and cannot be used as this capability.
  const need=(ok,code)=>{if(!ok)throw Error(code);};
  const copy=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
    Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  const text=r=>(r?.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
  function unwrap(r) {
    for(let i=0;i<8;i++) {
      need(!r?.isError&&!r?.error,'NORMAL_SOURCE_ERROR');
      if(r?.structuredContent){r=r.structuredContent;continue;}
      if(Array.isArray(r?.content)){try{r=JSON.parse(text(r));continue;}catch{}}
      return r;
    }
    throw Error('NORMAL_SOURCE_ENVELOPE');
  }
  function page(raw,id) {
    const p=unwrap(raw),t=p?.text;
    need(p?.id?.replaceAll('-','').toLowerCase()===id&&p.truncated!==true&&
      !(p.unknown_block_count??0)&&!(p.unknown_block_ids?.length??0)&&typeof p.page_last_edited_at==='string'&&
      typeof t==='string'&&!/<unknown\b|content (?:has been |is )?truncated/i.test(t),'NORMAL_INCOMPLETE_PAGE');
    const props=[...t.matchAll(/<properties>\n([\s\S]*?)\n<\/properties>/g)];
    const body=[...t.matchAll(/<content>\n([\s\S]*?)\n<\/content>/g)];
    need(props.length===1&&body.length===1,'NORMAL_INCOMPLETE_PAGE');
    return {properties:JSON.parse(props[0][1]),body:body[0][1]};
  }
  const c=copy(config),centralProps=new Set(['작업 상태','다음 담당자','큐 구획','차단 대상','재개 지시',
    '큐 정리 근거','설계에이전트 답변','저장소 식별자','date:큐 정리 시각:start','date:큐 정리 시각:is_datetime']);
  need(/^[a-f0-9]{32}$/.test(c.centralTaskId??'')&&/^[a-f0-9]{40}$/.test(c.extensionSourceHead??'')&&typeof config.getBrokerPid==='function'&&
    Array.isArray(c.references)&&c.references.length>=4&&Array.isArray(c.nativePageIds)&&c.nativePageIds.length===2&&
    c.nativePageIds[0]!==c.nativePageIds[1]&&Array.isArray(c.edits)&&
    Array.isArray(c.nativeExpectations)&&c.nativeExpectations.length===2&&
    new Set(c.nativeExpectations.map(n=>n.pageId)).size===2&&c.nativeExpectations.every(n=>
      c.nativePageIds.includes(n.pageId)&&n.properties&&Object.keys(n.properties).every(k=>centralProps.has(k))),
    'NORMAL_CONFIG');
  const ids=c.references.map(r=>r.pageId);
  need(new Set(ids).size===ids.length&&ids.every(id=>/^[a-f0-9]{32}$/.test(id))&&
    c.nativePageIds.every(id=>ids.includes(id))&&ids.includes('3bf86e6dd1d18110938bc358e17c779e')&&
    ids.includes('3b286e6dd1d18194866dd8d7a28c7ab4'),'NORMAL_AUTHORITY_SCOPE');
  // The probe prefix is a pinned installation command supplied by the adopting
  // owner. Only a validated literal batch ID is appended; never interpolate a
  // page, task, PR description, owner or arbitrary caller command into a shell.
  need(typeof c.probeCommand==='string'&&c.probeCommand.length>0&&
    c.probeCommand.endsWith(' --output json'),'NORMAL_PROBE_COMMAND');
  return async function assertPrerequisites({batchId,canonical}) {
    need(/^[A-Za-z0-9-]{1,100}$/.test(batchId??'')&&batchId===c.batchId,'NORMAL_BATCH');
    need(canonical?.exclusive===false&&typeof canonical.manifestHash==='string','NORMAL_EXCLUSIVE_OWNER');
    const brokerPid=config.getBrokerPid();
    need(Number.isSafeInteger(brokerPid)&&brokerPid>0,'NORMAL_BROKER_UNKNOWN');
    const began=Date.now();
    const probeJob=tools.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process({
      command:c.probeCommand+' --broker-pid '+brokerPid+' --batch '+batchId,timeout_ms:1000});
    const pagesJob=Promise.all(c.references.map(async ref=>{
      const live=page(await tools.mcp__codex_apps__notion_fetch({id:ref.pageId}),ref.pageId),fixed=page(ref.page,ref.pageId);
      const edit=c.edits.find(e=>e.pageId===ref.pageId);
      const original=fixed.body,changed=edit?original.replace(edit.oldStr,()=>edit.newStr):original;
      need(live.body===original||live.body===changed,'NORMAL_AUTHORITY_BODY_CHANGED');
      const expected=c.nativeExpectations.find(n=>n.pageId===ref.pageId);
      const properties={...fixed.properties,...(expected?.properties??{})};
      need(stable(live.properties)===stable(properties),'NORMAL_AUTHORITY_PROPERTIES_CHANGED');
      return {pageId:ref.pageId,body:'MATCHED',protectedProperties:'MATCHED'};
    }));
    // Await both branches even after failure. A failed source read never leaves
    // an unobserved server probe or rejected promise running in the background.
    const [probeResult,pageResult]=await Promise.allSettled([probeJob,pagesJob]);
    if(probeResult.status==='rejected')throw probeResult.reason;
    if(pageResult.status==='rejected')throw pageResult.reason;
    const raw=text(probeResult.value);
    const lines=raw.split('\n').filter(l=>l.startsWith('NPG-NORMAL/1 '));
    need(!probeResult.value.isError&&lines.length===1,'NORMAL_PROBE_UNKNOWN');
    const proof=JSON.parse(lines[0].slice(13));
    need(!proof.error&&proof.schema==='NORMAL_PROJECTION_PROBE_V1'&&proof.batchId===batchId&&
      proof.root===c.root&&proof.brokerPid===brokerPid&&proof.controlsVerified>=7&&
      proof.extensionsVerified===5&&proof.sourceHead===c.extensionSourceHead&&
      proof.notionWrites===0&&proof.canonicalWrites===0&&proof.workerStarts===0&&
      stable(proof.canonical)===stable(canonical),'NORMAL_PROBE_MISMATCH');
    // A successful read does not grant scheduled ownership. Observe the actual
    // enabled run here; central_case_owner independently checks it again.
    const actual=unwrap(await tools.mcp__codex_apps__automations_peek({jawbone_id:c.centralTaskId}));
    const task=actual?.automations?.find(a=>a.id===c.centralTaskId),run=task?.run_details?.last_run;
    need(task?.is_enabled===true&&run?.recorded_status==='in_progress'&&run.id===c.runId,'NORMAL_CENTRAL_NOT_OWNER');
    const probeAt=Date.parse(proof.observedAt);
    need(Number.isFinite(probeAt)&&probeAt<=Date.now(),'NORMAL_PROBE_CLOCK');
    const at=Math.min(began,probeAt),until=Math.min(at+30000,Date.parse(proof.validUntil));
    need(Number.isFinite(at)&&Number.isFinite(until)&&at<=Date.now()&&until>Date.now(),'NORMAL_PREREQUISITES_STALE');
    return {allowed:true,batchId,observedAt:new Date(at).toISOString(),validUntil:new Date(until).toISOString(),
      evidenceReference:'NORMAL-PROJECTION:'+proof.journalHash+':'+proof.brokerExecutor,
      nativeChecks:pageResult.value,scope:'PROJECTION_ONLY; worker intake requires fresh independent gates'};
  };
})
