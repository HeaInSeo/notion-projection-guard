'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProvider,HEAD,OLD_HEAD,BASE,TARGETS,OBSERVATION_ID,CORRECTED_TEXT}=require('./sori48_pair_provider.cjs');
const ev=(event_id,version,role,head)=>({readOk:true,event:{event_id,version,role,kind:'RELEASE',
  lease_state:'RELEASED',repo_pr:'HeaInSeo/sori#48',head_or_digest:'head '+head}});
const page=(id,body)=>({structuredContent:{id,page_last_edited_at:'2026-10-30T00:00:00Z',
  text:'<properties>\n{}\n</properties>\n<content>\n'+body+'\n</content>'}});
function observation(){
  const prior='observation-id: SORI48-PAIR-ADMIT-20261029; prior admission for '+OLD_HEAD;
  const original=ev('EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z',93,'operator',HEAD);
  original.raw=page('3f586e6dd1d181ebb43dd7de62aa2ca4',prior);
  const pair=ev('EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',54,'guardrail',OLD_HEAD);
  pair.raw=page('3f586e6dd1d181cd9f5bdcdab6290de7','Verdict: NOT ACCEPTED · P0=0\n\n'+prior);
  return {schema:'SORI48_FRESH_SOURCE_OBSERVATION_V1',batchId:'SORI48-PAIR-ADMIT-20261029',
    ticket:'cae1d7ac-ce48-417d-ad58-5180f0315d7d',dispatchId:'cdbeae84-e053-4cbc-bdfe-d9dea48e3dc5',
    classification:'CLEAR_OBSERVATION_ONLY',freshSourcesComplete:true,stopAffectedActions:false,
    applyAuthorized:false,attributableTerminalResult:null,originalOutcome:'UNKNOWN',
    freshSources:{original,
      child:ev('EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z',4,'operator-child',HEAD),pair,
      index:{readOk:true,pageId:'3f586e6dd1d181ddb9f3e7217f64bfcd',raw:page('3f586e6dd1d181ddb9f3e7217f64bfcd',prior)},
      github:{readOk:true,head:HEAD,base:BASE,checks:{readOk:true,raw:{structuredContent:{
        total_count:4,check_runs:Array.from({length:4},()=>({head_sha:HEAD,status:'completed',conclusion:'success'}))}}}}
    },targets:TARGETS.map(pageId=>({pageId,readOk:true,oldLiteralCount:1,plannedLiteralCount:0,
      staleCurrentAdmissionCandidate:false,raw:page(pageId,'Sori retains its separate gates.')}))};
}
test('exact corrected-head admission is check-only and preserves UNKNOWN',()=>{
  const r=createProvider().assess(observation());
  assert.equal(r.eligible,true);assert.equal(r.applyAuthorized,false);assert.equal(r.head,HEAD);
  assert.deepEqual(r.preservation,{originalOutcome:'UNKNOWN',next:3,receiptCount:3,latePayloadPossible:true});
  assert.equal(r.grantsWorkerProof,false);assert.equal(r.grantsProductionApply,false);
});
test('provider builds one check-only corrected projection over the preserved three ACK and five unwritten targets',()=>{
  const r=createProvider().plan(observation());
  assert.equal(r.observationId,OBSERVATION_ID);assert.equal(r.applyAuthorized,false);
  assert.equal(r.requiresCanonicalClosure,true);assert.equal(r.metadataReconciliationRequired,true);
  assert.equal(r.edits.length,8);assert.equal(new Set(r.edits.map(e=>e.pageId)).size,8);
  assert.ok(r.edits.every(e=>e.newStr===CORRECTED_TEXT&&e.oldStr!==e.newStr));
  assert.deepEqual(r.preservation,{originalOutcome:'UNKNOWN',next:3,receiptCount:3,latePayloadPossible:true});
});
test('provider refuses a plan without the fresh index source',()=>{
  const o=observation();delete o.freshSources.index;assert.throws(()=>createProvider().plan(o),/INDEX_SOURCE/);
});
test('provider refuses a corrected projection already present on any target',()=>{
  const o=observation(),t=o.targets[0];t.raw=page(t.pageId,CORRECTED_TEXT);
  assert.throws(()=>createProvider().plan(o),/CORRECTED_ALREADY_PRESENT/);
});
for(const [name,change] of [
  ['head',o=>o.freshSources.github.head='0'.repeat(40)],
  ['ci',o=>o.freshSources.github.checks.raw.structuredContent.check_runs[0].conclusion='failure'],
  ['prior verdict',o=>o.freshSources.pair.raw.structuredContent.text='Verdict: PASS'],
  ['target drift',o=>o.targets[0].plannedLiteralCount=1],
  ['terminal result',o=>o.attributableTerminalResult={status:'SUCCEEDED'}],
  ['caller apply',o=>o.applyAuthorized=true]
])test('provider refuses '+name,()=>{const o=observation();change(o);assert.throws(()=>createProvider().assess(o));});
