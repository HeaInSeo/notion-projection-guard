'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProvider,HEAD,OLD_HEAD,BASE,TARGETS}=require('./sori48_pair_provider.cjs');
const ev=(event_id,version,role,head)=>({readOk:true,event:{event_id,version,role,kind:'RELEASE',
  lease_state:'RELEASED',repo_pr:'HeaInSeo/sori#48',head_or_digest:'head '+head}});
function observation(){
  return {schema:'SORI48_FRESH_SOURCE_OBSERVATION_V1',batchId:'SORI48-PAIR-ADMIT-20261029',
    ticket:'cae1d7ac-ce48-417d-ad58-5180f0315d7d',dispatchId:'cdbeae84-e053-4cbc-bdfe-d9dea48e3dc5',
    classification:'CLEAR_OBSERVATION_ONLY',freshSourcesComplete:true,stopAffectedActions:false,
    applyAuthorized:false,attributableTerminalResult:null,originalOutcome:'UNKNOWN',
    freshSources:{
      original:ev('EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z',93,'operator',HEAD),
      child:ev('EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z',4,'operator-child',HEAD),
      pair:{...ev('EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',54,'guardrail',OLD_HEAD),
        raw:{structuredContent:{text:'x\nVerdict: NOT ACCEPTED · P0=0'}}},
      github:{readOk:true,head:HEAD,base:BASE,checks:{readOk:true,raw:{structuredContent:{
        total_count:4,check_runs:Array.from({length:4},()=>({head_sha:HEAD,status:'completed',conclusion:'success'}))}}}}
    },targets:TARGETS.map(pageId=>({pageId,readOk:true,oldLiteralCount:1,plannedLiteralCount:0,
      staleCurrentAdmissionCandidate:false}))};
}
test('exact corrected-head admission is check-only and preserves UNKNOWN',()=>{
  const r=createProvider().assess(observation());
  assert.equal(r.eligible,true);assert.equal(r.applyAuthorized,false);assert.equal(r.head,HEAD);
  assert.deepEqual(r.preservation,{originalOutcome:'UNKNOWN',next:3,receiptCount:3,latePayloadPossible:true});
  assert.equal(r.grantsWorkerProof,false);assert.equal(r.grantsProductionApply,false);
});
for(const [name,change] of [
  ['head',o=>o.freshSources.github.head='0'.repeat(40)],
  ['ci',o=>o.freshSources.github.checks.raw.structuredContent.check_runs[0].conclusion='failure'],
  ['prior verdict',o=>o.freshSources.pair.raw.structuredContent.text='Verdict: PASS'],
  ['target drift',o=>o.targets[0].plannedLiteralCount=1],
  ['terminal result',o=>o.attributableTerminalResult={status:'SUCCEEDED'}],
  ['caller apply',o=>o.applyAuthorized=true]
])test('provider refuses '+name,()=>{const o=observation();change(o);assert.throws(()=>createProvider().assess(o));});
