'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'captured_automation_run.js'),'utf8'));
const id='6a742f6443e8819184310cd28e6162cd';
const task=()=>({id,is_enabled:true,is_self_owned_automation:true,
  run_details:{last_run:{id:'actual-captured-run',recorded_status:'in_progress',started_at:'2026-10-30T02:39:16.707897Z',
    scheduled_for:'2026-10-30T03:05:51Z',completed_at:null}}});
function nested(t,n=6){let raw={automations:[t]};for(let i=0;i<n;i++)raw=i%2?
  {content:[{type:'text',text:JSON.stringify(raw)}]}:{content:[{type:'text',text:'Action completed.'}],structuredContent:raw};return raw;}
for(const depth of [0,1,2,6,12,24])test('reads the exact captured run through '+depth+' wrappers',()=>{
  const t=task(),raw=nested(t,depth),before=JSON.stringify(raw),r=read(raw,id);
  assert.equal(r.run.id,t.run_details.last_run.id);assert.equal(r.eligibleCurrentOwner,true);
  assert.equal(r.ownershipGranted,false);assert.equal(JSON.stringify(raw),before);
  assert.equal(r.rawSnapshot,raw);
});
for(const status of ['completed','failed','no_update'])test('parses '+status+' without inventing a running owner',()=>{
  const t=task();t.run_details.last_run.recorded_status=status;const r=read(nested(t),id);
  assert.equal(r.run.recorded_status,status);assert.equal(r.eligibleCurrentOwner,false);
});
for(const [name,change] of [
  ['disabled',t=>t.is_enabled=false],['another caller',t=>t.is_self_owned_automation=false]
])test(name+' cannot become current authority',()=>{
  const t=task();change(t);assert.equal(read(nested(t),id).eligibleCurrentOwner,false);
});
for(const [name,raw] of [
  ['missing task',{automations:[]}],['duplicate task',{automations:[task(),task()]}],
  ['missing run',{automations:[{...task(),run_details:{last_run:null}}]}],
  ['tool error',{isError:true,structuredContent:{automations:[task()]}}],
  ['service error',{status:'ERROR',automations:[task()]}],
  ['invalid text',{content:[{type:'text',text:'Action completed.'}]}]
])test('refuses '+name,()=>assert.throws(()=>read(raw,id)));
test('cycles and excessive envelopes fail without a second tool invocation',()=>{
  const raw={};raw.structuredContent=raw;assert.throws(()=>read(raw,id),/CYCLE/);
  assert.throws(()=>read(nested(task(),33),id),/DEPTH/);
});
