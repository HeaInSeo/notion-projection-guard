(function createCentralCaseOwner(tools, broker, config) {
  'use strict';
  // Used by the existing hosted runner's assertOwnership callback. The marker
  // in Router is deliberately never an authority input for this incident.
  function data(value) {
    for(let i=0;i<8&&value?.structuredContent;i++)value=value.structuredContent;
    return value;
  }
  return async function assertOwnership({batchId}) {
    if(typeof config.assertPrerequisites!=='function')throw Error('PREREQUISITES_CAPABILITY_REQUIRED');
    const gates=await config.assertPrerequisites({batchId});
    if(gates?.allowed!==true||gates.batchId!==batchId||
      !Number.isFinite(Date.parse(gates.observedAt))||Date.parse(gates.observedAt)>Date.now()||
      Date.now()-Date.parse(gates.observedAt)>30000)throw Error('PREREQUISITES_NOT_CURRENT');
    const canonical=await broker({action:'case_authority'});
    if(!canonical?.manifestHash||!canonical.authority)throw Error('CASE_AUTHORITY_MISSING');
    const observed=data(await tools.mcp__codex_apps__automations_peek({jawbone_id:config.centralTaskId}));
    const automation=observed?.automations?.find(a=>a.id===config.centralTaskId);
    const run=automation?.run_details?.last_run,actor=config.actor;
    if(!run||!actor)throw Error('CENTRAL_RUN_UNKNOWN');
    const conflicts=[];
    if(actor.kind==='manual') {
      if(actor.ownerId!==canonical.authority.ownerId||actor.generation!==canonical.authority.generation||
        canonical.exclusive!==true)throw Error('CASE_OWNER_CONFLICT');
      if(run.recorded_status==='in_progress')conflicts.push(run.id);
      else if(!['completed','failed','no_update'].includes(run.recorded_status))throw Error('CENTRAL_RUN_UNKNOWN');
    } else if(actor.kind==='scheduled') {
      if(actor.ownerId!=='automation:'+config.centralTaskId||actor.generation!==run.id||
        run.recorded_status!=='in_progress'||canonical.exclusive===true)throw Error('CENTRAL_RUN_MISMATCH');
    } else throw Error('CASE_OWNER_KIND');
    // Remote replies cannot refresh an earlier prerequisite observation.
    const now=Date.now(),gateAt=Date.parse(gates.observedAt);
    const gateUntil=gates.validUntil===undefined?gateAt+30000:Date.parse(gates.validUntil);
    if(gateAt>now||now-gateAt>=30000||!Number.isFinite(gateUntil)||gateUntil<=now)
      throw Error('PREREQUISITES_NOT_CURRENT');
    const until=Math.min(now+15000,gateAt+30000,gateUntil);
    return {ownerId:actor.ownerId,generation:actor.generation,scope:batchId,prerequisites:true,conflicts,
      evidenceHash:canonical.manifestHash,observedAt:new Date(gateAt).toISOString(),validUntil:new Date(until).toISOString(),
      currentCentralRunId:run.id,currentCentralRunStatus:run.recorded_status,authoritySource:'CANONICAL_CASE_ADMISSION',
      prerequisiteEvidence:gates.evidenceReference??null};
  };
})
