'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const actual=require('./central_migration_artifacts.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
  // Synthetic pin substitution isolates byte validation; fixtures grant no
  // production authority and never claim real cutover/source installation.
  const input=Object.fromEntries(Object.keys(actual.PINS).map(k=>[k,JSON.stringify({synthetic:k})]));
  let source=fs.readFileSync(path.join(__dirname,'central_migration_artifacts.cjs'),'utf8');
  for(const [k,h] of Object.entries(actual.PINS))source=source.replace(h,sha(input[k]));
  const module={exports:{}};vm.runInNewContext(source,{require,module});
  return {input,inspect:module.exports.inspectConfigurationBytes,observe:module.exports.inspectScheduledObservation};
}
test('pinned configuration history grants no current run or source authority',()=>{
  const {input,inspect}=fixture(),r=inspect(input);
  assert.equal(r.oldActor,actual.OLD_ACTOR);assert.equal(r.newActor,actual.NEW_ACTOR);
  assert.equal(r.grantsNothing,true);assert.equal(r.currentOwnershipVerified,false);
  assert.equal(r.sourceCompatibility,false);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.pins));
});
for(const key of Object.keys(actual.PINS)){
 test('changed exact bytes rejected even with caller expected hash: '+key,()=>{
  const {input,inspect}=fixture();input[key]+='\n';input.expectedHashes={[key]:sha(input[key])};input.migration=true;
  assert.throws(()=>inspect(input),new RegExp('CENTRAL_MIGRATION_ARTIFACT_'+key));
 });
 test('missing artifact rejected: '+key,()=>{
  const {input,inspect}=fixture();delete input[key];assert.throws(()=>inspect(input),/CENTRAL_MIGRATION_ARTIFACT_/);
 });
}
test('self-declared migration cannot substitute for pinned historical bytes',()=>{
 assert.throws(()=>actual.inspectConfigurationBytes({migration:true,accepted:true}),/CENTRAL_MIGRATION_ARTIFACT_/);
 assert.throws(()=>actual.inspectConfigurationBytes(null),/CENTRAL_MIGRATION_ARTIFACT_/);
});

function observationFixture(){
 const f=fixture(),now=Date.parse('2026-11-02T00:10:00Z');
 const initial={id:'actual-synthetic-run',scheduled_for:'2026-11-02T00:05:51Z',
  started_at:'2026-11-02T00:06:00Z',recorded_status:'in_progress',completed_at:null};
 const oldTask={id:actual.OLD_ACTOR.slice(11),is_enabled:false,schedule:'old-reviewed',
  timing_mode:'condition_watch',default_timezone:'Asia/Seoul',run_details:{last_run:null}};
 const newTask={id:actual.NEW_ACTOR.slice(11),is_enabled:true,schedule:'new-reviewed',
  timing_mode:'exact_schedule',default_timezone:'Asia/Seoul',run_details:{last_run:{...initial}}};
 const artifacts={...f.input,cutoverBytes:JSON.stringify({tasks:[oldTask,newTask]})};
 let source=fs.readFileSync(path.join(__dirname,'central_migration_artifacts.cjs'),'utf8');
 for(const [k,h] of Object.entries(actual.PINS))source=source.replace(h,sha(artifacts[k]));
 const module={exports:{}};vm.runInNewContext(source,{require,module});
 return {now,check:module.exports.inspectScheduledObservation,
  input:{artifacts,oldTask,newTask,initialRun:initial,observedAt:new Date(now-1000).toISOString()}};
}
test('matching singleton observation preserves explicit remaining authority gates',()=>{
 const f=observationFixture(),r=f.check(f.input,f.now);
 assert.equal(r.runId,f.input.initialRun.id);assert.equal(r.grantsNothing,true);
 assert.equal(r.originalRunTTLVerified,false);assert.equal(r.localActionQuiescenceVerified,false);
 assert.equal(r.sourceCompatibility,false);assert.ok(Object.isFrozen(r));
});
for(const [name,mutate] of [
 ['different task',f=>f.input.newTask.id='other'],
 ['old concurrently enabled',f=>f.input.oldTask.is_enabled=true],
 ['paused candidate',f=>f.input.newTask.is_enabled=false],
 ['different mode',f=>f.input.newTask.timing_mode='condition_watch'],
 ['different schedule',f=>f.input.newTask.schedule+='x'],
 ['different timezone',f=>f.input.newTask.default_timezone='UTC'],
 ['old in-flight',f=>f.input.oldTask.run_details.last_run={recorded_status:'in_progress',completed_at:null}],
 ['old completion unknown',f=>delete f.input.oldTask.run_details.last_run],
 ['different run',f=>f.input.newTask.run_details.last_run.id='borrowed'],
 ['restamped start',f=>f.input.newTask.run_details.last_run.started_at='2026-11-02T00:06:01Z'],
 ['completed current',f=>f.input.newTask.run_details.last_run.recorded_status='completed'],
 ['completed timestamp',f=>f.input.newTask.run_details.last_run.completed_at='2026-11-02T00:09:00Z'],
 ['stale observation',f=>f.input.observedAt=new Date(f.now-30000).toISOString()],
 ['future observation',f=>f.input.observedAt=new Date(f.now+1).toISOString()],
 ['early original start',f=>{for(const r of [f.input.initialRun,f.input.newTask.run_details.last_run])r.started_at='2026-11-02T00:05:50Z';}],
 ['hour delayed start',f=>{for(const r of [f.input.initialRun,f.input.newTask.run_details.last_run])r.scheduled_for='2026-11-01T23:06:00Z';}],
 ['nonfinite consumer clock',f=>f.now=NaN]
])test('singleton observation refuses '+name,()=>{
 const f=observationFixture();mutate(f);assert.throws(()=>f.check(f.input,f.now),/CENTRAL_MIGRATION_OBSERVATION_/);
});
