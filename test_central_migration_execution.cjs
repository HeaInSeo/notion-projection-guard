'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const production=require('./central_migration_artifacts.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),json=JSON.stringify;
const AUDIT='/home/heain/.local/state/notion-projection-guard/manual-audits/sori48-closure-20261029';
const runtime='/home/heain/.local/share/notion-projection-guard';
const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
 'normal_projection_probe.cjs','ordinary_followthrough.js','normal_bridge.cjs','normal_live_owner.js',
 'normal_live_runner.js','normal_followthrough_v2.js','normal_live_command.js','reconcile_unpermitted_dispatch.cjs',
 'normal_rpc_client.js','normal_unsent.cjs','reconcile_permit_expiry.cjs','sori_startup_control.cjs'];
const phases=['SORI48_UNKNOWN_CLOSURE_PROPOSAL.json','sori48_unknown_state.cjs','sori48_unknown_closure.cjs',
 'sori48_unknown_runtime.cjs','sori48_unknown_evidence.cjs','sori48_unknown_sources.js','sori48_pair_provider.cjs','sori48_pair_metadata.cjs'];
const migrations=['central_migration_artifacts.cjs','central_migration_files.cjs'];
function fixture(age=1000){
 const now=Math.floor(Date.now()/1000)*1000,iso=n=>new Date(n).toISOString();
 const scheduled=Math.floor(now/3600000)*3600000-3600000+351000,started=scheduled+1000;
 const t0=now-age-16000,t1=t0+500,tickAt=t0+age;
 const schedule='BEGIN:VEVENT\nDTSTART;TZID=Asia/Seoul:20261101T210551\nRRULE:FREQ=HOURLY\nEND:VEVENT';
 const run={id:'synthetic-current-run',scheduled_for:iso(scheduled),started_at:iso(started),
  recorded_status:'in_progress',completed_at:null};
 const oldTask={id:production.OLD_ACTOR.slice(11),is_enabled:false,schedule:'old-reviewed',
  timing_mode:'condition_watch',default_timezone:'Asia/Seoul',run_details:{last_run:null}};
 const newTask={id:production.NEW_ACTOR.slice(11),is_enabled:true,schedule,timing_mode:'exact_schedule',
  default_timezone:'Asia/Seoul',prompt:'synthetic reviewed central prompt',run_details:{last_run:{...run}}};
 const config={owner:production.NEW_ACTOR,automationId:newTask.id,schedule};
 const artifacts={authorizationBytes:json({synthetic:'approval'}),acceptanceBytes:json({synthetic:'acceptance'}),
  cutoverBytes:json({tasks:[oldTask,newTask]}),configBytes:json(config)};
 const reviewInput={oldTaskId:oldTask.id,newTaskId:newTask.id,schedule,
  centralPrompt:{sha256:sha(newTask.prompt)}};
 const runtimeInputs={reviewInputBytes:json(reviewInput),runtimeManifestBytes:'synthetic runtime manifest',
  wrapperBytes:'synthetic wrapper',contractBytes:'synthetic contract'};
 const directory=AUDIT+'/tick-capture-00000000-0000-4000-8000-000000000001',proofFile=directory+'/PROOF.json';
 const rawBytes=json({structuredContent:{automations:[newTask]}});
 const proof={source:'AUTOMATIONS_PEEK',automationId:newTask.id,isEnabled:true,schedule,retrievedAt:iso(t0),run:{...run},
  rawEvidenceFile:directory+'/RAW.json',rawEvidenceSha256:sha(rawBytes),captureEvidenceFile:directory+'/CAPTURE.json'};
 const capture={source:'ACTUAL_PEEK_CALL_BOUNDARIES',directory,peekStartedAt:iso(t0),peekCompletedAt:iso(t1),
  proofRetrievedAt:iso(t0),rawPath:proof.rawEvidenceFile,rawSha256:sha(rawBytes)};
 const proofBytes=json(proof),proofHash=sha(proofBytes);
 const tickStart={tickStartedAt:iso(tickAt),peekStartedAt:iso(t0),peekCompletedAt:iso(t1),
  proofAgeMs:age,runId:run.id};
 const receipt={origin:'SCHEDULED',actor:production.NEW_ACTOR,runId:run.id,startedAt:iso(tickAt),
  completedAt:iso(tickAt+1000),scheduledProof:{file:proofFile,sha256:proofHash,runId:run.id,
   scheduledFor:run.scheduled_for,startedAt:run.started_at},scopeCoverage:'CONFIGURED_SCOPES_COMPLETE',errors:[]};
 const decisionBytes=json(receipt),result={receipt,evidence:{
  file:'/home/heain/.local/state/review-timeout-evidence/decision-00000000-0000-4000-8000-000000000002.json',
  sha256:sha(decisionBytes)}};
 const tickResult={status:0,error:null,signal:null,runId:run.id,stdout:json(result),endedAt:iso(tickAt+2000)};
 const head='a'.repeat(40),base='b'.repeat(40),tree='c'.repeat(40),merged='d'.repeat(40);
 const installation={root:'/home/heain/.local/state/notion-projection-guard',runtime,sourceHead:head,
  extensionDirectory:runtime+'/extensions/'+head,
  files:Object.fromEntries(names.map(n=>[n,sha(fs.readFileSync(path.join(__dirname,n)))])),
  phaseProviders:Object.fromEntries(phases.map(n=>[n,sha(fs.readFileSync(path.join(__dirname,n)))])),
  migrationProviders:Object.fromEntries(migrations.map(n=>[n,sha(fs.readFileSync(path.join(__dirname,n)))]))};
 const sourceGates={schema:'NPG_PR25_NORMAL_SOURCE_GATES_V1',
  scope:{repo:'HeaInSeo/notion-projection-guard',pr:25,head,base,tree},
  independent:{verdict:'PASS',head,base,tree,eventId:'synthetic-review-release',sessionId:'synthetic-reviewer',
   releaseVersion:1,bodyNativeParity:true},
  managed:{status:'CLEAN',head,base,requestId:'synthetic-managed-request'},
  sourceCI:{head,conclusion:'success'},landing:{expectedHead:head,mergedCommit:merged},
  mainCI:{head:merged,conclusion:'success'},
  evidence:['independent','managed','sourceCI','landing','mainCI'].map(kind=>({
   kind,file:AUDIT+'/synthetic-'+kind+'.json',sha256:sha(json({synthetic:kind}))}))};
 const manifest={schema:'NPG_IMMUTABLE_EXTENSION_MANIFEST_V1',repository:'HeaInSeo/notion-projection-guard',
  sourceHead:head,extensionDirectory:installation.extensionDirectory,mergedCommit:merged,
  reviewedTree:tree,mergedTree:tree,installVerification:{sourceByteEqual:true,fileCount:25,
   directoryMode:'0555',allFilesMode:'0444',symlinks:0},
  files:{...installation.files,...installation.phaseProviders,...installation.migrationProviders},sourceGates};
 const input={artifacts,...runtimeInputs,owner:{actor:production.NEW_ACTOR,runId:run.id,
  scheduledProofSha256:proofHash,schedulerEvidenceFile:proofFile},
  observation:{oldTask,newTask,observedAt:iso(now-1000)},proofBytes,captureBytes:json(capture),
  rawBytes,tickStartBytes:json(tickStart),tickResultBytes:json(tickResult),decisionBytes,
  installation,installationManifestBytes:json(manifest)};
 const expectedPins={...artifacts,...runtimeInputs};
 function compile(){
  let source=fs.readFileSync(path.join(__dirname,'central_migration_artifacts.cjs'),'utf8');
  for(const [k,p] of Object.entries(production.PINS))source=source.replace(p,sha(expectedPins[k]));
  for(const [k,p] of Object.entries(production.RUNTIME_PINS))source=source.replace(p,sha(expectedPins[k]));
  const m={exports:{}};vm.runInNewContext(source,{require,module:m});return m.exports;
 }
 return {input,now,compile,check(){return compile().inspectExecutionEvidence(this.input,this.now);}};
}
function mutateBytes(f,key,change){const value=JSON.parse(f.input[key]);change(value);f.input[key]=json(value);}
test('captured execution validates the original tick without renewing its clock',()=>{
 const f=fixture(),r=f.check();
 assert.equal(r.runId,f.input.owner.runId);assert.equal(r.originalIncidentOwner,production.OLD_ACTOR);
 assert.equal(r.actor,production.NEW_ACTOR);assert.equal(r.grantsNothing,true);assert.ok(Object.isFrozen(r));
 assert.equal(r.capturedAt,JSON.parse(f.input.captureBytes).peekStartedAt);
});
test('original tick at exactly 120 seconds is accepted; a later live witness does not restamp it',()=>{
 const f=fixture(120000);assert.equal(f.check().runId,f.input.owner.runId);
});
for(const [name,mutate] of [
 ['wrong actor',f=>f.input.owner.actor='manual:other'],
 ['borrowed run',f=>f.input.owner.runId='borrowed'],
 ['wrong proof digest',f=>f.input.owner.scheduledProofSha256='0'.repeat(64)],
 ['self-declared ready',f=>{f.input={owner:f.input.owner,migration:true,ready:true};}],
 ['changed config bytes',f=>f.input.artifacts.configBytes+='\n'],
 ['changed accepted review input',f=>f.input.reviewInputBytes+='\n'],
 ['changed runtime manifest',f=>f.input.runtimeManifestBytes+='changed'],
 ['changed runtime wrapper',f=>f.input.wrapperBytes+='changed'],
 ['changed runtime contract',f=>f.input.contractBytes+='changed'],
 ['raw substitution',f=>f.input.rawBytes+='\n'],
 ['missing raw',f=>delete f.input.rawBytes],
 ['capture is file-write clock',f=>mutateBytes(f,'captureBytes',v=>v.source='FILE_WRITE_TIME')],
 ['restamped retrieved time',f=>mutateBytes(f,'proofBytes',v=>v.retrievedAt=new Date(f.now).toISOString())],
 ['tick expired',f=>{const bad=fixture(120001);f.input=bad.input;f.now=bad.now;}],
 ['tick age self-claim',f=>mutateBytes(f,'tickStartBytes',v=>v.proofAgeMs=0)],
 ['future capture completion',f=>mutateBytes(f,'captureBytes',v=>v.peekCompletedAt=new Date(f.now+1).toISOString())],
 ['tick failure',f=>mutateBytes(f,'tickResultBytes',v=>v.status=1)],
 ['tick borrowed run',f=>mutateBytes(f,'tickResultBytes',v=>v.runId='other')],
 ['decision mutation',f=>f.input.decisionBytes+='\n'],
 ['early current run',f=>f.input.observation.newTask.run_details.last_run.started_at=
   new Date(Date.parse(f.input.observation.newTask.run_details.last_run.scheduled_for)-1).toISOString()],
 ['completed current run',f=>f.input.observation.newTask.run_details.last_run.recorded_status='completed'],
 ['old simultaneously enabled',f=>f.input.observation.oldTask.is_enabled=true],
 ['old incomplete action',f=>f.input.observation.oldTask.run_details.last_run={recorded_status:'in_progress',completed_at:null}],
 ['old result unknown',f=>delete f.input.observation.oldTask.run_details.last_run],
 ['paused candidate',f=>f.input.observation.newTask.is_enabled=false],
 ['changed live prompt',f=>f.input.observation.newTask.prompt+='changed'],
 ['stale live observation',f=>f.input.observation.observedAt=new Date(f.now-30000).toISOString()],
 ['future live observation',f=>f.input.observation.observedAt=new Date(f.now+1).toISOString()],
 ['changed schedule',f=>f.input.observation.newTask.schedule+='changed'],
 ['different source head',f=>f.input.installation.sourceHead='e'.repeat(40)],
 ['different merged tree',f=>mutateBytes(f,'installationManifestBytes',v=>v.mergedTree='e'.repeat(40))],
 ['missing file pin',f=>mutateBytes(f,'installationManifestBytes',v=>delete v.files['central_migration_files.cjs'])],
 ['candidate source not installed',f=>mutateBytes(f,'installationManifestBytes',v=>v.installVerification.sourceByteEqual=false)],
 ['old PR gate copied',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.scope.pr=24)],
 ['wrong independent head',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.independent.head='f'.repeat(40))],
 ['independent rejection',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.independent.verdict='NOT ACCEPTED')],
 ['missing review own event',f=>mutateBytes(f,'installationManifestBytes',v=>delete v.sourceGates.independent.eventId)],
 ['missing normal managed result',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.managed.status='UNKNOWN')],
 ['source CI failure',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.sourceCI.conclusion='failure')],
 ['main CI wrong head',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.mainCI.head='f'.repeat(40))],
 ['landing different head',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.landing.expectedHead='f'.repeat(40))],
 ['missing raw gate evidence',f=>mutateBytes(f,'installationManifestBytes',v=>v.sourceGates.evidence=[])]
])test('execution rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>f.check());});
function collectorFixture(t,hook){
 const f=fixture(),root=fs.mkdtempSync(path.join(os.homedir(),'npg25-execution-'));
 const audit=root+'/state/manual-audits/sori48-closure-20261029',rt=root+'/runtime',
  review=root+'/review-timeout',bin=root+'/bin',decisionDir=root+'/review-timeout-evidence';
 const map=p=>p.replace(AUDIT,audit).replace('/home/heain/.local/state/notion-projection-guard',root+'/state')
  .replace(runtime,rt).replace('/home/heain/.local/share/review-timeout',review)
  .replace('/home/heain/.local/bin',bin).replace('/home/heain/.local/state/review-timeout-evidence',decisionDir);
 // All identifiers are synthetic. Mapping does not touch any production path.
 for(const key of ['proofBytes','captureBytes','tickStartBytes','tickResultBytes','decisionBytes','installationManifestBytes'])
  f.input[key]=json(JSON.parse(f.input[key]),(k,v)=>typeof v==='string'?map(v):v);
 f.input.installation=jsonParseMap(f.input.installation,map);f.input.owner.schedulerEvidenceFile=map(f.input.owner.schedulerEvidenceFile);
 // Recompute hashes for fixture-only path mapping in proof, receipt and stdout.
 f.input.owner.scheduledProofSha256=sha(f.input.proofBytes);
 const result=JSON.parse(JSON.parse(f.input.tickResultBytes).stdout);
 result.receipt.scheduledProof.file=f.input.owner.schedulerEvidenceFile;
 result.receipt.scheduledProof.sha256=f.input.owner.scheduledProofSha256;
 result.evidence.file=map(result.evidence.file);f.input.decisionBytes=json(result.receipt);
 result.evidence.sha256=sha(f.input.decisionBytes);
 mutateBytes(f,'tickResultBytes',v=>v.stdout=json(result));
 const dir=path.dirname(f.input.owner.schedulerEvidenceFile);
 const values=new Map([
  [dir+'/PROOF.json',f.input.proofBytes],[dir+'/CAPTURE.json',f.input.captureBytes],
  [dir+'/RAW.json',f.input.rawBytes],[dir+'/TICK_START.json',f.input.tickStartBytes],
  [dir+'/TICK_RESULT.json',f.input.tickResultBytes],[result.evidence.file,f.input.decisionBytes],
  [audit+'/PR25_IMMUTABLE_INSTALLATION_MANIFEST.json',f.input.installationManifestBytes],
  [audit+'/CENTRAL_SCHEDULER_MIGRATION_AUTHORIZATION-20261101.json',f.input.artifacts.authorizationBytes],
  [audit+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision3/CONFIG_REVIEW_ACCEPTANCE.json',f.input.artifacts.acceptanceBytes],
  [audit+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision3/CUTOVER_VERIFIED.json',f.input.artifacts.cutoverBytes],
  [review+'/config.json',f.input.artifacts.configBytes],
  [audit+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision4/MIGRATION_REVIEW_INPUT_V4.json',f.input.reviewInputBytes],
  [review+'/runtime-approved.sha256',f.input.runtimeManifestBytes],
  [review+'/CONTRACT.md',f.input.contractBytes],[bin+'/review-timeout-supervision',f.input.wrapperBytes]
 ]);
 for(const e of JSON.parse(f.input.installationManifestBytes).sourceGates.evidence)
  values.set(e.file,json({synthetic:e.kind}));
 for(const n of [...names,...phases,...migrations])
  values.set(f.input.installation.extensionDirectory+'/'+n,fs.readFileSync(path.join(__dirname,n),'utf8'));
 for(const [p,b] of values){fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{mode:0o600});}
 const install=audit+'/PR25_IMMUTABLE_INSTALLATION_MANIFEST.json';fs.chmodSync(install,0o444);
 for(const n of [...names,...phases,...migrations])fs.chmodSync(f.input.installation.extensionDirectory+'/'+n,0o444);
 fs.chmodSync(f.input.installation.extensionDirectory,0o555);
 t.after(()=>{fs.chmodSync(f.input.installation.extensionDirectory,0o700);fs.rmSync(root,{recursive:true,force:true});});
 const am=f.compile();let source=fs.readFileSync(path.join(__dirname,'central_migration_files.cjs'),'utf8');
 for(const [before,after] of [[AUDIT,audit],['/home/heain/.local/state/notion-projection-guard',root+'/state'],
  [runtime,rt],['/home/heain/.local/share/review-timeout',review],['/home/heain/.local/bin',bin],
  ['/home/heain/.local/state/review-timeout-evidence',decisionDir]])source=source.replaceAll(before,after);
 const m={exports:{}};vm.runInNewContext(source,{require:id=>id==='./central_migration_artifacts.cjs'?am:
  id==='node:fs'&&hook?hook(fs,{values,dir,install}):require(id),module:m,process});
 return {...f,root,dir,install,values,collect:()=>m.exports.validateInstalledExecution(
  f.input.installation,f.input.owner,f.input.observation)};
}
function jsonParseMap(value,map){return JSON.parse(json(value),(k,v)=>typeof v==='string'?map(v):v);}
test('fixed-file collector validates installed source, original capture and actual same-run evidence',t=>{
 const f=collectorFixture(t),r=f.collect();assert.equal(r.actor,production.NEW_ACTOR);
 assert.equal(r.originalIncidentOwner,production.OLD_ACTOR);assert.equal(r.grantsNothing,true);
});
for(const [name,change] of [
 ['missing proof',f=>fs.unlinkSync(f.dir+'/PROOF.json')],
 ['capture alias',f=>{fs.renameSync(f.dir+'/CAPTURE.json',f.dir+'/actual');fs.symlinkSync(f.dir+'/actual',f.dir+'/CAPTURE.json');}],
 ['group-writable capture directory',f=>fs.chmodSync(f.dir,0o770)],
 ['writable installation certificate',f=>fs.chmodSync(f.install,0o600)],
 ['writable installed code',f=>fs.chmodSync(f.input.installation.extensionDirectory+'/normal_bridge.cjs',0o644)],
 ['changed installed source',f=>{const p=f.input.installation.extensionDirectory+'/normal_bridge.cjs';fs.chmodSync(p,0o644);fs.appendFileSync(p,'changed');fs.chmodSync(p,0o444);}],
 ['changed normal gate raw evidence',f=>fs.appendFileSync(path.dirname(f.install)+'/synthetic-independent.json','changed')],
 ['arbitrary proof path',f=>f.input.owner.schedulerEvidenceFile=f.root+'/arbitrary.json'],
 ['different run',f=>f.input.owner.runId='other']
])test('fixed-file collector rejects '+name,t=>{const f=collectorFixture(t);change(f);assert.throws(()=>f.collect());});
test('fixed-file collector rechecks original bytes after validation instead of refreshing timestamps',t=>{
 let changed=false;
 const f=collectorFixture(t,(native,{dir})=>({...native,readFileSync(fd,...args){
  const value=native.readFileSync(fd,...args);
  if(!changed&&typeof fd==='number'){
   const link=native.readlinkSync('/proc/self/fd/'+fd);
   if(link.endsWith('/review-timeout/config.json')){
    changed=true;native.appendFileSync(dir+'/CAPTURE.json','\n');
   }
  }return value;
 }}));
 assert.throws(()=>f.collect(),/CHANGED/);
});
