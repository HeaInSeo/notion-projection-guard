(function readCapturedAutomationRun(snapshot,taskId){
  'use strict';
  const need=(ok,why)=>{if(!ok)throw Error('CAPTURED_AUTOMATION_'+why);};
  need(typeof taskId==='string'&&/^[a-f0-9]{32}$/.test(taskId),'TASK_ID');
  let value=snapshot;
  const seen=new Set();
  for(let depth=0;depth<32;depth++){
    need(value&&typeof value==='object'&&!value.isError&&!value.error&&value.status!=='ERROR','READ_ERROR');
    need(!seen.has(value),'ENVELOPE_CYCLE');seen.add(value);
    if(value.structuredContent){value=value.structuredContent;continue;}
    if(Array.isArray(value.automations)){
      const matches=value.automations.filter(task=>task?.id===taskId);
      need(matches.length===1,'TASK_IDENTITY');
      const task=matches[0],run=task.run_details?.last_run;
      need(run&&typeof run.id==='string'&&run.id.trim()&&
        ['in_progress','completed','failed','no_update'].includes(run.recorded_status)&&
        typeof run.started_at==='string'&&Number.isFinite(Date.parse(run.started_at)), 'RUN_OBJECT');
      // Observation only: completed, other-owned or disabled remains visible.
      // The consumer cannot turn successful parsing into execution authority.
      return {taskId,task,run,rawSnapshot:snapshot,
        eligibleCurrentOwner:task.is_enabled===true&&run.recorded_status==='in_progress'&&
          task.is_self_owned_automation!==false,
        ownershipGranted:false};
    }
    need(Array.isArray(value.content),'ENVELOPE');
    const texts=value.content.filter(item=>item?.type==='text').map(item=>item.text);
    need(texts.length===1&&typeof texts[0]==='string','ENVELOPE_TEXT');
    value=JSON.parse(texts[0]);
  }
  throw Error('CAPTURED_AUTOMATION_ENVELOPE_DEPTH');
})
