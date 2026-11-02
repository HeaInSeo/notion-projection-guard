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

const RUNTIME_PINS=Object.freeze({
  reviewInputBytes:'22eff9ec859ef7ef6a0677a96be3a3c7d8b682499c0aa77a716a7daa43d1be4c',
  runtimeManifestBytes:'cffbe2b493aa8775e30911b02723b18d81b8ed13ee6ae67f6127426f0eb661ab',
  wrapperBytes:'1652c0f9bd037ffc23b688e746efdfc2b6dde306c50ec8cd8b2f86d35fb9e37c',
  contractBytes:'f58e571d2bb06563cee99ea5eee2e335370bca759b0423f8b80680a098d36bb6'
});
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const needExecution=(ok,why)=>{if(!ok)throw Error('CENTRAL_MIGRATION_EXECUTION_'+why);};
function unpack(raw){
  for(let i=0;i<12;i++){
    needExecution(raw&&!raw.isError&&!raw.error,'RAW_ERROR');
    if(raw.structuredContent){raw=raw.structuredContent;continue;}
    if(Array.isArray(raw.content)){
      raw=JSON.parse(raw.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));continue;
    }
    return raw;
  }throw Error('CENTRAL_MIGRATION_EXECUTION_RAW_ENVELOPE');
}
function inspectInstallation(installation,manifestBytes){
  const need=needExecution,manifest=JSON.parse(manifestBytes??'null');
  need(installation&&/^[a-f0-9]{40}$/.test(installation.sourceHead??'')&&
    manifest?.schema==='NPG_IMMUTABLE_EXTENSION_MANIFEST_V1'&&
    manifest.repository==='HeaInSeo/notion-projection-guard'&&
    manifest.sourceHead===installation.sourceHead&&
    manifest.extensionDirectory===installation.extensionDirectory&&
    /^[a-f0-9]{40}$/.test(manifest.mergedCommit??'')&&
    /^[a-f0-9]{40}$/.test(manifest.reviewedTree??'')&&
    manifest.mergedTree===manifest.reviewedTree,'INSTALLATION_IDENTITY');
  const expected={...installation.files,...installation.phaseProviders,...installation.migrationProviders};
  need(Object.keys(expected).length===25&&manifest.files&&
    Object.keys(manifest.files).length===Object.keys(expected).length&&
    Object.entries(expected).every(([n,h])=>/^[a-f0-9]{64}$/.test(h)&&manifest.files[n]===h),
    'INSTALLATION_FILES');
  const v=manifest.installVerification;
  need(v?.sourceByteEqual===true&&v.fileCount===25&&v.directoryMode==='0555'&&
    v.allFilesMode==='0444'&&v.symlinks===0,'INSTALLATION_VERIFIED');
  // This is the trusted installer's receipt, never an RPC migration/ready flag.
  // Its raw normal-gate evidence is separately re-read by the file collector.
  const g=manifest.sourceGates,scope=g?.scope,ind=g?.independent,managed=g?.managed;
  need(g?.schema==='NPG_PR25_NORMAL_SOURCE_GATES_V1'&&
    scope?.repo==='HeaInSeo/notion-projection-guard'&&scope.pr===25&&
    scope.head===manifest.sourceHead&&/^[a-f0-9]{40}$/.test(scope.base??'')&&
    scope.tree===manifest.reviewedTree&&ind?.verdict==='PASS'&&
    ind.head===scope.head&&ind.base===scope.base&&ind.tree===scope.tree&&
    typeof ind.eventId==='string'&&ind.eventId.length>0&&
    typeof ind.sessionId==='string'&&ind.sessionId.length>0&&
    Number.isSafeInteger(ind.releaseVersion)&&ind.releaseVersion>0&&
    ind.bodyNativeParity===true&&managed?.status==='CLEAN'&&
    managed.head===scope.head&&managed.base===scope.base&&
    typeof managed.requestId==='string'&&managed.requestId.length>0&&
    g.sourceCI?.head===scope.head&&g.sourceCI?.conclusion==='success'&&
    g.landing?.expectedHead===scope.head&&g.landing?.mergedCommit===manifest.mergedCommit&&
    g.mainCI?.head===manifest.mergedCommit&&g.mainCI?.conclusion==='success'&&
    Array.isArray(g.evidence)&&g.evidence.length>=4&&
    ['independent','managed','sourceCI','landing','mainCI'].every(kind=>
      g.evidence.some(e=>e.kind===kind&&typeof e.file==='string'&&/^[a-f0-9]{64}$/.test(e.sha256??''))),
    'NORMAL_SOURCE_GATES');
  return Object.freeze({sourceHead:manifest.sourceHead,mergedCommit:manifest.mergedCommit,
    reviewedTree:manifest.reviewedTree,manifestSha256:digest(manifestBytes)});
}
// Pure validation is still evidence checking, not authentication of its caller.
// Only the fixed-file collector in the reviewed installed server uses this
// result as a prospective execution-owner gate.
function inspectExecutionEvidence(input,now=Date.now()){
  const need=needExecution,owner=input?.owner;
  need(owner?.actor===NEW_ACTOR&&typeof owner.runId==='string'&&owner.runId.length>0&&
    /^[a-f0-9]{64}$/.test(owner.scheduledProofSha256??''),'OWNER');
  const history=inspectConfigurationBytes(input.artifacts),config=JSON.parse(input.artifacts.configBytes);
  for(const [key,pin] of Object.entries(RUNTIME_PINS))
    need(typeof input[key]==='string'&&digest(input[key])===pin,'RUNTIME_'+key);
  const reviewed=JSON.parse(input.reviewInputBytes);
  need(reviewed.oldTaskId===OLD_ACTOR.slice(11)&&reviewed.newTaskId===NEW_ACTOR.slice(11)&&
    config.owner===NEW_ACTOR&&config.automationId===NEW_ACTOR.slice(11)&&
    config.schedule===reviewed.schedule,'CONFIG_BINDING');
  const proof=JSON.parse(input.proofBytes),capture=JSON.parse(input.captureBytes),
    tickStart=JSON.parse(input.tickStartBytes),tickResult=JSON.parse(input.tickResultBytes);
  need(digest(input.proofBytes)===owner.scheduledProofSha256&&proof.source==='AUTOMATIONS_PEEK'&&
    proof.automationId===config.automationId&&proof.isEnabled===true&&
    proof.schedule===config.schedule&&proof.run?.id===owner.runId&&
    proof.run.recorded_status==='in_progress'&&proof.run.completed_at===null,'INITIAL_PROOF');
  const raw=unpack(JSON.parse(input.rawBytes)),tasks=raw.automations;
  const initial=Array.isArray(tasks)?tasks.filter(t=>t.id===config.automationId):[];
  need(initial.length===1&&initial[0].is_self_owned_automation!==false&&
    initial[0].is_enabled===true&&initial[0].schedule===proof.schedule&&
    initial[0].timing_mode==='exact_schedule'&&
    initial[0].default_timezone==='Asia/Seoul'&&
    typeof initial[0].prompt==='string'&&
    digest(initial[0].prompt)===reviewed.centralPrompt?.sha256,'INITIAL_RAW');
  const capturedRun=initial[0].run_details?.last_run;
  for(const k of ['id','scheduled_for','started_at','recorded_status','completed_at'])
    need(capturedRun&&capturedRun[k]===proof.run[k],'CAPTURE_RUN_IDENTITY');
  const t0=Date.parse(capture.peekStartedAt),t1=Date.parse(capture.peekCompletedAt),
    start=Date.parse(tickStart.tickStartedAt),started=Date.parse(proof.run.started_at),
    scheduled=Date.parse(proof.run.scheduled_for);
  need(Number.isFinite(now)&&[t0,t1,start,started,scheduled].every(Number.isFinite)&&
    scheduled<=started&&started-scheduled<3600000&&started<=t0&&t0<=t1&&
    t1<=start&&start<=now&&start-t0<=120000&&
    capture.source==='ACTUAL_PEEK_CALL_BOUNDARIES'&&capture.proofRetrievedAt===capture.peekStartedAt&&
    proof.retrievedAt===capture.peekStartedAt&&capture.rawSha256===digest(input.rawBytes)&&
    proof.rawEvidenceSha256===capture.rawSha256&&
    tickStart.peekStartedAt===capture.peekStartedAt&&tickStart.peekCompletedAt===capture.peekCompletedAt&&
    tickStart.proofAgeMs===start-t0&&tickStart.runId===owner.runId,'ORIGINAL_CAPTURE_TTL');
  const slot=config.schedule.match(/DTSTART(?:;[^:]*)?:(\d{8})T(\d{2})(\d{2})(\d{2})Z?/);
  const slotTime=new Date(scheduled);
  need(slot&&config.schedule.includes('RRULE:FREQ=HOURLY')&&
    slotTime.getUTCMinutes()===Number(slot[3])&&slotTime.getUTCSeconds()===Number(slot[4])&&
    slotTime.getUTCMilliseconds()===0,'SCHEDULE_SLOT');
  need(tickResult.status===0&&tickResult.error===null&&tickResult.signal===null&&
    tickResult.runId===owner.runId,'TICK_RESULT');
  const result=JSON.parse(tickResult.stdout),receipt=result.receipt,decision=JSON.parse(input.decisionBytes);
  need(receipt&&JSON.stringify(receipt)===JSON.stringify(decision)&&
    result.evidence?.sha256===digest(input.decisionBytes)&&
    receipt.origin==='SCHEDULED'&&receipt.actor===NEW_ACTOR&&receipt.runId===owner.runId&&
    receipt.scheduledProof?.sha256===owner.scheduledProofSha256&&
    receipt.scheduledProof?.runId===owner.runId&&
    receipt.scheduledProof?.scheduledFor===proof.run.scheduled_for&&
    receipt.scheduledProof?.startedAt===proof.run.started_at&&
    receipt.scopeCoverage==='CONFIGURED_SCOPES_COMPLETE'&&Array.isArray(receipt.errors)&&
    receipt.errors.length===0,'TICK_RECEIPT');
  const tickAt=Date.parse(receipt.startedAt),done=Date.parse(receipt.completedAt),end=Date.parse(tickResult.endedAt);
  need([tickAt,done,end].every(Number.isFinite)&&start<=tickAt&&tickAt-t0<=120000&&
    tickAt<=done&&done<=end&&end<=now,'TICK_TTL');
  const observation=inspectScheduledObservation({...input.observation,artifacts:input.artifacts,
    initialRun:proof.run},now);
  need(end<=Date.parse(observation.observedAt)&&observation.runId===owner.runId&&
    typeof input.observation.newTask.prompt==='string'&&
    digest(input.observation.newTask.prompt)===reviewed.centralPrompt.sha256,'LIVE_PROMPT');
  const installed=inspectInstallation(input.installation,input.installationManifestBytes);
  return Object.freeze({schema:'CENTRAL_MIGRATION_EXECUTION_EVIDENCE_CHECK_V1',
    actor:NEW_ACTOR,originalIncidentOwner:OLD_ACTOR,runId:owner.runId,
    scheduledProofSha256:owner.scheduledProofSha256,capturedAt:capture.peekStartedAt,
    tickDecisionSha256:digest(input.decisionBytes),observedAt:observation.observedAt,
    ...installed,grantsNothing:true});
}
module.exports={inspectConfigurationBytes,inspectScheduledObservation,inspectExecutionEvidence,
  inspectInstallation,PINS,RUNTIME_PINS,OLD_ACTOR,NEW_ACTOR};
