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
test('distinct RELEASE task/event components never erase an older pending event',()=>{
 const s=fixture();const first={repository:'sori',source:{kind:'RELEASE',taskId:'a/b',eventId:'c',head:'c'.repeat(40),at:'2026-10-20T06:00:00Z'}};
 const second=structuredClone(first);second.source.taskId='a';second.source.eventId='b/c';
 const firstKey=gate.eventKey(first),secondKey=gate.eventKey(second);
 s.previousPending=[{key:firstKey,repository:'sori',firstSeenAt:first.source.at}];
 const e=s.events[0];e.repository=second.repository;e.source=second.source;e.projection.sourceKey=secondKey;
 for(const x of e.successors){x.sourceKey=secondKey;if(x.handoff)x.handoff.ownReceipt.inputKey=secondKey;}
 const r=gate.assess(s);assert.equal(r.status,'PENDING');assert.equal(r.pending[0].key,firstKey);
});
test('request and CLAIM before the triggering event cannot consume it',()=>{
 const s=fixture(),h=s.events[0].successors[0].handoff;
 h.requestedAt='2026-10-20T05:00:00Z';h.ownReceipt.at='2026-10-20T05:01:00Z';
 assert.notEqual(gate.assess(s).status,'COMPLETE');
});
function completion(s){
 const e=s.events[0],x=e.successors[0];x.action='DONE';delete x.handoff;
 x.completionReceipt={taskId:x.id,inputKey:gate.eventKey(e),eventId:'accepted-release',sessionId:'own-session',kind:'RELEASE',
  at:'2026-10-20T08:58:00Z',verdict:'PASS',acceptanceReceipt:'current pair/CI/landing evidence'};
 return x.completionReceipt;
}
test('DONE rejects a free-form receipt borrowed from another task',()=>{
 const s=fixture();const x=s.events[0].successors[0];x.action='DONE';x.completionReceipt='unrelated-old-receipt';
 assert.notEqual(gate.assess(s).status,'COMPLETE');
});
test('DONE rejects another source, task or pre-source completion timestamp',()=>{
 for(const field of ['inputKey','taskId','at']){
  const s=fixture(),c=completion(s);c[field]=field==='at'?'2026-10-20T05:00:00Z':'unrelated';
  assert.notEqual(gate.assess(s).status,'COMPLETE');
 }
});
test('DONE accepts a current structured task/input-bound accepted release',()=>{
 const s=fixture();completion(s);assert.equal(gate.assess(s).status,'COMPLETE');
});
test('repository typos and unsupported projection scopes fail before accounting',()=>{
 for(const repository of ['nodekti','nodevault','NodeKit','constructor','__proto__']){
  const s=fixture();s.events[0].repository=repository;
  assert.throws(()=>gate.eventKey(s.events[0]),/SUPERVISION_INPUT/);
 }
});
test('unsupported repository in a carried pending ledger fails closed',()=>{
 const s=fixture();s.previousPending=[{key:'old',repository:'nodekti',firstSeenAt:'2026-10-20T06:00:00Z'}];
 assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
});
test('an active or nonterminal canonical barrier is never overall COMPLETE, including empty events',()=>{
 for(const empty of [false,true])for(const active of [false,true]){
  const s=fixture();if(empty)s.events=[];
  s.canonical=active?{active:'live-batch',nonterminal:[]}:{active:null,nonterminal:[{id:'halted',status:'HALTED'}]};
  const r=gate.assess(s);assert.equal(r.status,'PENDING');assert.equal(r.canonicalBarrier,true);
  assert.equal(r.eligibleRepositories.length,0);
 }
});
test('a carried key cannot declare a different known repository and then disappear',()=>{
 const s=fixture();s.previousPending=[{key:gate.eventKey(s.events[0]),repository:'sori',firstSeenAt:'2026-10-20T06:00:00Z'}];
 assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
});
test('unknown and noncanonical carried key encodings are rejected',()=>{
 for(const key of ['garbage','[ "RELEASE", "sori", "t", "e", "'+ 'a'.repeat(40)+'" ]',
  JSON.stringify(['RELEASE','nodekit','t','e','a'.repeat(40)])]){
  const s=fixture();s.previousPending=[{key,repository:'sori',firstSeenAt:'2026-10-20T06:00:00Z'}];
  assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
 }
});
test('valid canonical RELEASE keys survive omitted observations and retain age',()=>{
 const s=fixture(),e=s.events[0];e.repository='sori';e.source={kind:'RELEASE',taskId:'task/a',eventId:'evt/b',head:'c'.repeat(40),at:e.source.at};
 const key=gate.eventKey(e);e.projection.sourceKey=key;
 for(const x of e.successors){x.sourceKey=key;if(x.handoff)x.handoff.ownReceipt=null;}
 const first=gate.assess(s);s.previousPending=first.pending;s.events=[];
 const next=gate.assess(s);assert.equal(next.status,'PENDING');assert.equal(next.pending[0].key,key);
 assert.equal(next.pending[0].firstSeenAt,e.source.at);
});
test('reobserving the same key cannot backdate its source and consume older handoff proof',()=>{
 const s=fixture(),e=s.events[0];delete e.successors[0].handoff.ownReceipt;
 s.previousPending=gate.assess(s).pending;e.source.at='2026-10-20T05:00:00Z';
 const h=e.successors[0].handoff;h.requestedAt='2026-10-20T05:01:00Z';
 h.ownReceipt={taskId:e.successors[0].id,inputKey:gate.eventKey(e),eventId:'earlier-claim',sessionId:'s',kind:'CLAIM',at:'2026-10-20T05:02:00Z'};
 assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
});
test('carried source-time binding also rejects a backdated DONE completion',()=>{
 const s=fixture(),e=s.events[0];delete e.successors[0].handoff.ownReceipt;
 s.previousPending=gate.assess(s).pending;e.source.at='2026-10-20T05:00:00Z';completion(s).at='2026-10-20T05:02:00Z';
 assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
});
test('equivalent UTC precision preserves the carried source and permits actual intake',()=>{
 const s=fixture(),e=s.events[0],own=e.successors[0].handoff.ownReceipt;
 delete e.successors[0].handoff.ownReceipt;s.previousPending=gate.assess(s).pending;
 e.source.at='2026-10-20T06:49:03.000Z';e.successors[0].handoff.ownReceipt=own;
 assert.equal(gate.assess(s).status,'COMPLETE');
});
test('legacy source-time fallback is conservative and explicit malformed sourceAt rejects',()=>{
 const s=fixture(),key=gate.eventKey(s.events[0]);
 s.previousPending=[{key,repository:'nodekit',firstSeenAt:'2026-10-20T07:00:00Z'}];
 assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
 s.previousPending[0].firstSeenAt=s.events[0].source.at;s.previousPending[0].sourceAt=null;
 assert.throws(()=>gate.assess(s),/SUPERVISION_INPUT/);
});
