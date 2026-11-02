'use strict';
// Immutable configuration history only. This inspector does not authenticate a
// current caller/run, install a source candidate, or authorize product writes.
const crypto=require('node:crypto');
const OLD_ACTOR='automation:6a742f6443e8819184310cd28e6162cd';
const NEW_ACTOR='automation:6ae6e6e4c880819192e89cd430271bfa';
const PINS=Object.freeze({
  authorizationBytes:'9912038cf2c91800be7f73b00d6c85ebfc07d1808c84cec8eb9fe465bfb3ed08',
  acceptanceBytes:'3419ad71f050487659bacdc6164d9ed15e5c25e1b2c10e5369d93df0c3d2fab4',
  cutoverBytes:'b293cf9b7bf3bc6e1ec74bbe39fc8df4beb71100deddb238cafe31c256236e97',
  configBytes:'3322aecfd2053446fd3b428d3d9d2b1a2d66cc0aca0fe40ccf147a3c7862be5f'
});
function inspectConfigurationBytes(input){
  // Do not accept caller-supplied expected hashes or a migration=true claim.
  const observed={};
  for(const [key,expected] of Object.entries(PINS)){
    const bytes=input?.[key];
    if(typeof bytes!=='string'||crypto.createHash('sha256').update(bytes).digest('hex')!==expected)
      throw Error('CENTRAL_MIGRATION_ARTIFACT_'+key);
    observed[key]=expected;
  }
  return Object.freeze({schema:'CENTRAL_MIGRATION_PINNED_CONFIGURATION_HISTORY_V1',
    oldActor:OLD_ACTOR,newActor:NEW_ACTOR,pins:Object.freeze(observed),
    grantsNothing:true,sourceCompatibility:false,currentOwnershipVerified:false});
}
// Observations must come from the actual collector. Passing this pure check is
// not proof of their origin, local action quiescence, original TTL, or install.
function inspectScheduledObservation(input,now=Date.now()){
  const history=inspectConfigurationBytes(input?.artifacts);
  const fail=why=>{throw Error('CENTRAL_MIGRATION_OBSERVATION_'+why);};
  const need=(ok,why)=>{if(!ok)fail(why);};
  const cutover=JSON.parse(input.artifacts.cutoverBytes);
  const old=input.oldTask,current=input.newTask,initial=input.initialRun;
  need(old?.id===OLD_ACTOR.slice(11)&&current?.id===NEW_ACTOR.slice(11),'TASK_ID');
  const expected=cutover.tasks;
  need(Array.isArray(expected),'REVIEWED_TASKS');
  for(const task of [old,current]){
    const matches=expected.filter(t=>t.id===task.id);
    need(matches.length===1,'REVIEWED_TASKS');
    for(const key of ['schedule','timing_mode','default_timezone','is_enabled'])
      need(task[key]===matches[0][key],'SETTINGS');
  }
  need(old.is_enabled===false&&current.is_enabled===true,'SINGLETON');
  const prior=old.run_details?.last_run;
  need(prior===null||(prior&&['completed','failed','no_update'].includes(prior.recorded_status)&&
    Number.isFinite(Date.parse(prior.completed_at))),'OLD_RUN');
  const run=current.run_details?.last_run;
  need(run&&initial&&typeof initial.id==='string'&&initial.id.length>0,'RUN');
  for(const key of ['id','scheduled_for','started_at'])need(run[key]===initial[key],'RUN_IDENTITY');
  need(run.recorded_status==='in_progress'&&run.completed_at===null&&
    initial.recorded_status==='in_progress'&&initial.completed_at===null,'RUN_STATE');
  const observed=Date.parse(input.observedAt),scheduled=Date.parse(run.scheduled_for),started=Date.parse(run.started_at);
  need(Number.isFinite(now)&&Number.isFinite(observed)&&observed<=now&&now-observed<30000,'FRESHNESS');
  need(Number.isFinite(scheduled)&&Number.isFinite(started)&&started>=scheduled&&
    started-scheduled<3600000&&started<=observed,'CHRONOLOGY');
  return Object.freeze({schema:'CENTRAL_MIGRATION_OBSERVATION_CHECK_V1',
    history,runId:run.id,observedAt:input.observedAt,grantsNothing:true,
    originalRunTTLVerified:false,sourceCompatibility:false,localActionQuiescenceVerified:false});
}
module.exports={inspectConfigurationBytes,inspectScheduledObservation,PINS,OLD_ACTOR,NEW_ACTOR};
