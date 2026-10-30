(function createNormalLiveOwner(tools,config) {
  'use strict';
  const need=(ok,code)=>{if(!ok)throw Error(code);};
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
    Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  const copy=x=>JSON.parse(JSON.stringify(x));
  function unwrap(r){for(let i=0;i<10;i++){
    need(!r?.isError&&!r?.error,'NORMAL_LIVE_SOURCE_ERROR');
    if(r?.structuredContent){r=r.structuredContent;continue;}
    if(Array.isArray(r?.content)){r=JSON.parse(r.content.filter(v=>v.type==='text').map(v=>v.text).join('\n'));continue;}
    return r;
  }throw Error('NORMAL_LIVE_ENVELOPE');}
  function page(raw,id){const p=unwrap(raw),t=p?.text;
    need(p?.id?.replaceAll('-','')===id&&p.truncated!==true&&!(p.unknown_block_count??0)&&
      !(p.unknown_block_ids?.length??0)&&typeof p.page_last_edited_at==='string'&&typeof t==='string'&&
      !/<unknown\b|content (?:has been |is )?truncated/i.test(t),'NORMAL_LIVE_INCOMPLETE');
    const a=[...t.matchAll(/<properties>\n([\s\S]*?)\n<\/properties>/g)],b=[...t.matchAll(/<content>\n([\s\S]*?)\n<\/content>/g)];
    need(a.length===1&&b.length===1,'NORMAL_LIVE_INCOMPLETE');
    return {body:b[0][1],props:JSON.parse(a[0][1]),revision:p.page_last_edited_at};
  }
  const createSori48SourceCollector=config.createSori48SourceCollector;
  const c=copy(config),refs=c.references;
  need(/^[a-f0-9]{32}$/.test(c.centralTaskId??'')&&typeof c.runId==='string'&&
    typeof c.referenceToken==='string'&&Array.isArray(refs)&&refs.length>=4&&
    new Set(refs.map(r=>r.pageId)).size===refs.length&&
    (c.sori48Closure!==true||typeof createSori48SourceCollector==='function'),'NORMAL_LIVE_CONFIG');
  const frozen=refs.map(r=>({pageId:r.pageId,...page(r.page,r.pageId)}));
  const sori48Collector=c.sori48Closure===true?createSori48SourceCollector(tools):null;
  if(sori48Collector)need(typeof sori48Collector.collect==='function','NORMAL_SORI48_SOURCE_COLLECTOR');
  return async function witness({batchId}){
    need(batchId===c.batchId,'NORMAL_LIVE_SCOPE');
    // Anchor every source to the start of its real read. Neither a slow reply
    // nor the local consumer is allowed to renew this observation timestamp.
    const observedAt=new Date().toISOString();
    const jobs=await Promise.allSettled([...refs.map(r=>tools.mcp__codex_apps__notion_fetch({id:r.pageId})),
      tools.mcp__codex_apps__automations_peek({jawbone_id:c.centralTaskId})]);
    for(const j of jobs)if(j.status==='rejected')throw j.reason;
    const checks=frozen.map((f,i)=>{
      const live=page(jobs[i].value,f.pageId),edit=c.edits.find(e=>e.pageId===f.pageId);
      const changed=edit?f.body.replace(edit.oldStr,()=>edit.newStr):f.body;
      need(live.body===f.body||live.body===changed,'NORMAL_LIVE_BODY_CHANGED');
      const expected=c.nativeExpectations.find(n=>n.pageId===f.pageId);
      need(stable(live.props)===stable({...f.props,...(expected?.properties??{})}),'NORMAL_LIVE_PROPERTIES_CHANGED');
      return {pageId:f.pageId,observedAt,matched:true,revision:live.revision};
    });
    const actual=unwrap(jobs[refs.length].value),task=actual?.automations?.find(t=>t.id===c.centralTaskId),run=task?.run_details?.last_run;
    need(task?.is_enabled===true&&run?.id===c.runId&&run.recorded_status==='in_progress','NORMAL_LIVE_CENTRAL_OWNER');
    const sori48Observation=sori48Collector?await sori48Collector.collect():null;
    if(sori48Observation)need(sori48Observation.schema==='SORI48_FRESH_SOURCE_OBSERVATION_V1'&&
      sori48Observation.batchId===batchId&&sori48Observation.classification==='CLEAR_OBSERVATION_ONLY'&&
      sori48Observation.freshSourcesComplete===true&&sori48Observation.applyAuthorized===false&&
      sori48Observation.attributableTerminalResult===null,'NORMAL_SORI48_SOURCE_OBSERVATION');
    need(Date.now()-Date.parse(observedAt)<30000,'NORMAL_LIVE_EXPIRED');
    return {observedAt,referenceToken:c.referenceToken,nativeChecks:checks,
      central:{id:task.id,is_enabled:task.is_enabled,run:copy(run)},
      ...(sori48Observation?{sori48Observation:copy(sori48Observation)}:{})};
  };
})
