'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const gate=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'supervision_gate.js'),'utf8'))();
function fixture(){
 const event={repository:'nodekit',source:{kind:'MERGED',pr:140,merged:true,head:'a'.repeat(40),mergeSha:'b'.repeat(40),at:'2026-10-20T06:49:03Z'},
  expectedSuccessors:['P10.cancel','P10.ci_verify'],successors:[]};
 const key=gate.eventKey(event);
 event.projection={status:'COMPLETE',sourceKey:key,certificate:'body6-native2-full-readback'};
 event.successors=[{id:'P10.cancel',sourceKey:key,action:'PROMOTE',owner:'existing Operator',next:'verify original cancel contract',
  handoff:{requestedAt:'2026-10-20T08:47:00Z',requestReceipt:'native-property-readback',ownReceipt:{taskId:'P10.cancel',inputKey:key,eventId:'own-claim',sessionId:'own-session',kind:'CLAIM',at:'2026-10-20T08:58:00Z'}}},
 {id:'P10.ci_verify',sourceKey:key,action:'KEEP_GATED',owner:'existing Operator',next:'consume executable acceptance',
  blocker:{owner:'existing P10 pair',trigger:'new cancel acceptance',source:'S4-04-C',conditionMet:false}}];
 return {version:1,observedAt:'2026-10-20T09:00:00Z',canonical:{active:null,nonterminal:[]},events:[event],previousPending:[]};
}
test('landed-stage accounting closes only with complete projection, dispositions and genuine intake',()=>{
 const r=gate.assess(fixture());assert.equal(r.status,'COMPLETE');assert.equal(r.productAcceptance,'NOT_ASSESSED');
});
test('incident replay: Sori busy never hides the unprojected NodeKit landing',()=>{
 const s=fixture();s.events[0].projection.status='PENDING';s.events[0].deferredBecauseOtherRepository=true;
 const r=gate.assess(s);assert.equal(r.status,'PENDING');assert.deepEqual(Array.from(r.eligibleRepositories),['nodekit']);
 assert(r.issues.some(x=>x.code==='CROSS_REPOSITORY_DEFER'));assert(r.issues.some(x=>x.code==='PROJECT_SOURCE'));
});
test('missing direct successor cannot silently consume a landing',()=>{
 const s=fixture();s.events[0].successors.pop();assert(gate.assess(s).issues.some(x=>x.code==='DECIDE_SUCCESSOR'));
});
test('already-satisfied blocker cannot keep successor waiting',()=>{
 const s=fixture();s.events[0].successors[1].blocker.conditionMet=true;assert(gate.assess(s).issues.some(x=>x.code==='INVALID_WAIT'));
});
test('READY/request record cannot substitute for own task-bound receipt',()=>{
 for(const wrong of [undefined,{taskId:'other',eventId:'x',sessionId:'s',kind:'CLAIM',at:'2026-10-20T08:58:00Z'}]){
  const s=fixture();s.events[0].successors[0].handoff.ownReceipt=wrong;
  assert(gate.assess(s).issues.some(x=>x.code==='AWAIT_OWN_RECEIPT'));
 }
});
test('omitted event survives later observations with its original age',()=>{
 const s=fixture();delete s.events[0].projection;s.previousPending=gate.assess(s).pending;s.events=[];
 const r=gate.assess(s);assert.equal(r.status,'PENDING');assert.equal(r.pending[0].firstSeenAt,'2026-10-20T06:49:03Z');
 assert.equal(r.pending[0].status,'UNOBSERVED_PENDING');
});
test('stale certificate/source identity cannot clear current pending event',()=>{
 const s=fixture();s.events[0].projection.sourceKey='old-source';assert.equal(gate.assess(s).status,'PENDING');
});
test('a new timestamp on an unrelated own receipt cannot consume the current input',()=>{
 const s=fixture();s.events[0].successors[0].handoff.ownReceipt.inputKey='unrelated-input';
 assert(gate.assess(s).issues.some(x=>x.code==='AWAIT_OWN_RECEIPT'));
});
test('actual canonical barrier preserves pending and prohibits independent write selection',()=>{
 const s=fixture();s.canonical={active:'halted',nonterminal:[{id:'halted',status:'HALTED'}]};delete s.events[0].projection;
 const r=gate.assess(s);assert.equal(r.canonicalBarrier,true);assert.equal(r.eligibleRepositories.length,0);assert.equal(r.pending.length,1);
});
const pre=()=>({canonical:{active:null,nonterminal:[]},bodyWrites:0,bodyRunnerEntered:false,resultsKnown:true,batchRegistered:false,
 phase:'NATIVE_PREFLIGHT',reason:'NATIVE_EXPECTATION_CHANGED',attempt:1});
test('known pre-body native race requests fresh observation, never a mutation replay',()=>{
 const r=gate.prewriteDecision(pre());assert.equal(r.action,'REOBSERVE_SAME_REPOSITORY');assert.equal(r.retry,true);
});
for(const [name,mutate]of [
 ['active barrier',s=>{s.canonical.active='pending';}],['known body write',s=>{s.bodyWrites=1;}],
 ['entered body runner',s=>{s.bodyRunnerEntered=true;}],['unknown response',s=>{s.resultsKnown=false;}],
 ['existing batch',s=>{s.batchRegistered=true;}]
])test('no automatic retry after '+name,()=>{
 const s=pre();mutate(s);assert.equal(gate.prewriteDecision(s).action,'PRESERVE_AND_RECONCILE');
});
test('three concurrent source changes remain pending instead of looping',()=>{
 const s=pre();s.attempt=3;assert.equal(gate.prewriteDecision(s).action,'RECORD_PENDING');
});
test('invalid merged/own evidence fails rather than becoming completion',()=>{
 for(const mutate of [s=>{s.events[0].source.merged=false;},s=>{s.events[0].source.mergeSha='short';},
  s=>{s.events[0].expectedSuccessors=[];},s=>{s.observedAt='bad';},s=>{s.events[0].source.at='2026-02-30T01:00:00Z';}]){
  const s=fixture();mutate(s);assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
 }
});
