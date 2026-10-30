'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProvider,createExecutor,BATCH,REVIEW_ROW,REPO,PRIOR_EVENT,PRIOR_TASK}=require('./npg_source_review_provider.cjs');
const HEAD='a'.repeat(40),BASE='b'.repeat(40);
const event={event_id:PRIOR_EVENT,task_id:PRIOR_TASK,phase:'PR23-r3-D1-delta-review',role:'guardrail',
  session_id:'old',version:22,kind:'RELEASE',event_at_utc:'2026-10-29T11:13:45Z',
  repo_pr:REPO+'#23',head_or_digest:'441624c4',lease_state:'RELEASED'};
const props={'이벤트 ID':PRIOR_EVENT,'체크포인트 버전':22,'작업 ID':PRIOR_TASK,'작업 상태':'종료',
  '다음 담당자':'없음','큐 구획':'완료 이력','세션 ID':'old','Authority Gate':'READY'};
const row=(properties=props)=>({structuredContent:{id:REVIEW_ROW,page_last_edited_at:'2026-10-30T20:00:00Z',
  text:'<properties>\n'+JSON.stringify(properties)+'\n</properties>\n<content>\n## GUARDRAIL QUEUE EVENT (current)\nQUEUE_EVENT_V1 '+
    JSON.stringify(event)+'\n\n## HISTORY\npreserved\n</content>'}});
const observation=()=>({schema:'NPG_SOURCE_REVIEW_OBSERVATION_V1',repository:REPO,pr:24,head:HEAD,base:BASE,
  observedAt:new Date().toISOString(),applyAuthorized:false,sourceOwnerState:'RELEASED',
  canonical:{active:null,journalSha256:'0699a8ae84284cf96632fa47cd4fa4f10d51f32c5136b9229a2ae22bbf729c4f'},
  reviewRow:row(),github:{structuredContent:{number:24,state:'open',merged:false,head_sha:HEAD,base_sha:BASE}},
  checks:{structuredContent:{total_count:4,check_runs:[1,2,3,4].map(id=>({id,head_sha:HEAD,status:'completed',conclusion:'success'}))}}});
test('plans a distinct exact-head request without changing worker proof',()=>{
  const p=createProvider().plan(observation());
  assert.equal(p.batchId,BATCH);assert.equal(p.reviewRow,REVIEW_ROW);assert.equal(p.applyAuthorized,false);
  assert.equal(p.grantsWorkerProof,false);assert.equal(p.request.command,'update_properties');
  assert.equal(p.patch['작업 상태'],'실행재개');assert.equal(p.patch['다음 담당자'],'가드레일 에이전트');
  assert.match(p.patch['재개 지시'],new RegExp(HEAD));assert.match(p.patch['재개 지시'],/PR23 RELEASE22 remains completed history/);
});
for(const [name,change] of [
  ['head drift',o=>o.github.structuredContent.head_sha='c'.repeat(40)],
  ['failed ci',o=>o.checks.structuredContent.check_runs[0].conclusion='failure'],
  ['active canonical',o=>o.canonical.active='other'],
  ['owner held',o=>o.sourceOwnerState='HELD'],
  ['history reopened',o=>{const p={...props,'작업 상태':'실행재개'};o.reviewRow=row(p);}],
  ['caller apply',o=>o.applyAuthorized=true]
])test('refuses '+name,()=>{const o=observation();change(o);assert.throws(()=>createProvider().plan(o));});
function broker(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-source-review-')),file=path.join(dir,'journal.json');
  const b={file,executor:'test',state:{active:null,batches:{}},assertLock(){},ownerProof(p){
    assert.equal(p.scope,BATCH);},save(){fs.writeFileSync(file,JSON.stringify(this.state));}};
  fs.writeFileSync(file,JSON.stringify(b.state));return b;
}
const proof=()=>({scope:BATCH,ownerId:'automation:central',generation:'run',observedAt:new Date().toISOString(),
  validUntil:new Date(Date.now()+30000).toISOString()});
test('executor requires durable ACK and exact protected readback before completion',()=>{
  const plan=createProvider().plan(observation()),b=broker(),x=createExecutor({broker:b,providerPlan:plan});
  assert.equal(x.begin({ownerProof:proof(),row:observation().reviewRow}).status,'READY');
  const d=x.dispatch({ownerProof:proof(),row:observation().reviewRow});assert.equal(x.status().status,'SEND_INTENT');
  const c=x.confirm({...d,ownerProof:proof(),row:observation().reviewRow});assert.equal(c.status,'WRITE_PENDING');
  assert.throws(()=>x.verify({ownerProof:proof(),row:observation().reviewRow}),/ACK_REQUIRED/);
  x.acknowledge({ownerProof:proof(),provider:{status:'SUCCEEDED',pageId:REVIEW_ROW}});
  const applied={...props,...plan.patch},done=x.verify({ownerProof:proof(),row:row(applied)});
  assert.equal(done.status,'COMPLETED');assert.equal(done.requestedOnly,true);
  assert.equal(done.workerProofChanged,false);assert.equal(b.state.active,null);
});
test('lost provider result stays WRITE_PENDING and cannot redispatch',()=>{
  const plan=createProvider().plan(observation()),b=broker(),x=createExecutor({broker:b,providerPlan:plan});
  x.begin({ownerProof:proof(),row:observation().reviewRow});
  const d=x.dispatch({ownerProof:proof(),row:observation().reviewRow});
  x.confirm({...d,ownerProof:proof(),row:observation().reviewRow});
  assert.equal(x.status().status,'WRITE_PENDING');
  assert.throws(()=>x.dispatch({ownerProof:proof(),row:observation().reviewRow}),/READY/);
});
