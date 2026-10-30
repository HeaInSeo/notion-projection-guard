'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const core=require('./broker.cjs');
const vm=require('node:vm');
const {createExecutor,BATCH,BODY_BATCH,ROWS}=require('./sori48_pair_metadata.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sori48-metadata-'));
  const policy={productionEnabled:true,productionPages:ROWS.map(r=>r[0]),canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
  let b=new core.Broker(root,policy);b.state.keepOriginalUnknown={next:3,receipts:[1,2,3],outcome:'UNKNOWN'};b.save();
  t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
  let closed=true,bodyDone=true;
  const pages=ROWS.map((spec,i)=>{
    const event={event_id:spec[1],version:spec[2],role:spec[3],kind:'RELEASE',lease_state:'RELEASED',
      repo_pr:'HeaInSeo/sori#48',head_or_digest:spec[4],session_id:'session-'+i,task_id:'task-'+i};
    const props={'이벤트 ID':event.event_id,'체크포인트 버전':event.version,'세션 ID':event.session_id,
      '작업 ID':event.task_id,'저장소 식별자':spec[4],'큐 구획':'현재','작업 상태':'검증대기','Title':'preserve'};
    const text='<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n## '+spec[3]+
      ' QUEUE EVENT (current)\n\n```json\nQUEUE_EVENT_V1 '+JSON.stringify(event)+'\n```\n\n## HISTORY\nuntouched\n</content>';
    return {structuredContent:{id:spec[0],page_last_edited_at:'2026-10-30T00:00:00Z',text}};
  });
  function executor(){return createExecutor({broker:b,inspectClosedUnknown:()=>({valid:closed,
    batchId:'SORI48-PAIR-ADMIT-20261029',status:'CLOSED_SUPERSEDED_UNKNOWN',originalOutcome:'UNKNOWN',
    lateObservationRequired:true,cleanTermination:false,capacityReleased:false,productAccepted:false}),
    inspectBodyProjection:()=>({valid:bodyDone,batchId:BODY_BATCH,status:'COMPLETED',verifiedTargets:8})});}
  const proof=(generation='run-1')=>({ownerId:'automation:'+'a'.repeat(32),scope:BATCH,generation,
    prerequisites:true,conflicts:[],evidenceHash:'e'.repeat(64),observedAt:new Date().toISOString(),
    validUntil:new Date(Date.now()+15000).toISOString()});
  const apply=request=>{const p=pages[ROWS.findIndex(r=>r[0]===request.page_id)].structuredContent;
    p.text=p.text.replace(/<properties>\n([\s\S]*?)\n<\/properties>/,(_,s)=>
      '<properties>\n'+JSON.stringify({...JSON.parse(s),...request.properties})+'\n</properties>');};
  return {get b(){return b;},pages,proof,apply,executor,
    restart(){b.close();b=new core.Broker(root,policy);return executor();},
    set closed(v){closed=v;},set bodyDone(v){bodyDone=v;}};
}
function dispatch(f,e){return e.dispatch({ownerProof:f.proof(),pages:f.pages});}
function confirm(f,e,d){return e.confirm({...d,ownerProof:f.proof(),pages:f.pages});}
test('three native rows use the existing canonical journal and preserve bodies and own proof',t=>{
  const f=fixture(t),before=clone(f.pages),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});
  assert.equal(f.b.state.active,BATCH);
  assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'OTHER',edits:[],ownerProof:f.proof()}));
  for(let i=0;i<3;i++){
    const d=dispatch(f,e),c=confirm(f,e,d);assert.equal(c.permit.pageId,ROWS[i][0]);
    assert.equal(d.request.command,'update_properties');assert.equal(d.request.allow_async,false);
    f.apply(d.request);e.acknowledge({...d,ownerProof:f.proof(),provider:{status:'SUCCEEDED',pageId:ROWS[i][0]}});
    e.verify({ownerProof:f.proof(),pages:f.pages});
    assert.equal(e.status().next,i+1);
  }
  assert.equal(e.status().status,'COMPLETED');assert.equal(f.b.state.active,null);
  assert.deepEqual(f.b.state.keepOriginalUnknown,{next:3,receipts:[1,2,3],outcome:'UNKNOWN'});
  for(let i=0;i<3;i++)assert.equal(f.pages[i].structuredContent.text.split('<content>')[1],before[i].structuredContent.text.split('<content>')[1]);
  assert.equal(f.b.state.batches[BATCH].attempts[0].provider.status,'SUCCEEDED');
  assert.equal(e.status().capacityReleased,false);assert.equal(e.status().productAccepted,false);
});
for(const gate of ['closed','bodyDone'])test('no transaction starts before '+gate,t=>{
  const f=fixture(t);f[gate]=false;const before=fs.readFileSync(f.b.file,'utf8');
  assert.throws(()=>f.executor().begin({ownerProof:f.proof(),pages:f.pages}));
  assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});
test('restart before any permit preserves the old intent and can resume without an ACK',t=>{
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});const old=dispatch(f,e);
  const next=f.restart();next.resumeUnconfirmed({ownerProof:f.proof('run-2'),pages:f.pages});
  assert.equal(next.status().next,0);assert.equal(next.status().receipts.length,0);
  const fresh=next.dispatch({ownerProof:f.proof('run-2'),pages:f.pages});
  assert.notEqual(fresh.dispatchId,old.dispatchId);
  assert.equal(f.b.state.batches[BATCH].attempts[0].phase,'RETIRED_WITHOUT_PERMIT');
});
test('lost response after confirmation cannot replay even if page now matches',t=>{
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});const d=dispatch(f,e);confirm(f,e,d);
  f.apply(d.request);const next=f.restart();
  assert.throws(()=>next.resumeUnconfirmed({ownerProof:f.proof('run-2'),pages:f.pages}),/NO_PERMIT_REQUIRED/);
  assert.throws(()=>next.dispatch({ownerProof:f.proof('run-2'),pages:f.pages}),/READY/);
  assert.throws(()=>next.acknowledge({...d,ownerProof:f.proof('run-2'),provider:{status:'SUCCEEDED',pageId:ROWS[0][0]}}),/PROVIDER/);
  assert.throws(()=>next.verify({ownerProof:f.proof('run-2'),pages:f.pages}),/ACK_REQUIRED/);
  assert.equal(next.status().next,0);assert.equal(f.b.state.active,BATCH);
});
test('a persisted actual ACK can finish readback after restart without another call',t=>{
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});const d=dispatch(f,e);confirm(f,e,d);f.apply(d.request);
  e.acknowledge({...d,ownerProof:f.proof(),provider:{status:'SUCCEEDED',pageId:ROWS[0][0]}});
  const next=f.restart();next.verify({ownerProof:f.proof('run-2'),pages:f.pages});assert.equal(next.status().next,1);
});
for(const afterRename of [false,true])test('confirmation save failure retains the actual '+(afterRename?'committed':'uncommitted')+' disk state',t=>{
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});const d=dispatch(f,e),save=f.b.save.bind(f.b);
  f.b.save=()=>{if(afterRename)save();throw Error('INJECTED_SAVE_REPLY_LOSS');};
  assert.throws(()=>confirm(f,e,d),/INJECTED/);
  assert.equal(e.status().status,afterRename?'WRITE_PENDING':'SEND_INTENT');
  if(afterRename)assert.throws(()=>e.resumeUnconfirmed({ownerProof:f.proof(),pages:f.pages}),/NO_PERMIT_REQUIRED/);
});
test('stale owner and changed protected fields cannot dispatch',t=>{
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});const before=fs.readFileSync(f.b.file,'utf8');
  const stale=f.proof();stale.observedAt=new Date(Date.now()-31000).toISOString();
  assert.throws(()=>e.dispatch({ownerProof:stale,pages:f.pages}));
  f.pages[0].structuredContent.text=f.pages[0].structuredContent.text.replace('"Title":"preserve"','"Title":"changed"');
  assert.throws(()=>dispatch(f,e),/SOURCE_DRIFT/);assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});
async function clientFixture(t){
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});
  const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'normal_rpc_client.js'),'utf8'));
  let calls=0;
  const text=value=>({content:[{type:'text',text:value}]});
  const client=factory({
    mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process:async()=>text('Process started with PID 12345\nNPG/2 {"ready":true}'),
    mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process:async({input})=>{
      const q=JSON.parse(input);let result;
      if(q.action==='native_dispatch')result=dispatch(f,e);
      else if(q.action==='case_live_send')result={...confirm(f,e,q.operation),noCallToken:'test-client-private-token'};
      else if(q.action==='native_ack')result=e.acknowledge({...q,ownerProof:f.proof()});
      else if(q.action==='native_verify')result=e.verify({ownerProof:f.proof(),pages:f.pages});
      else if(q.action==='close')result={closed:true};
      else throw Error('unexpected fixture action');
      return text('NPG/2 '+JSON.stringify({requestId:q.requestId,ok:true,result}));
    },mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output:async()=>{throw Error('unexpected read');}
  },{command:'fixture transport only'});
  return {f,e,client,get calls(){return calls;},invoke(request){calls++;f.apply(request);return {status:'SUCCEEDED',pageId:request.page_id};}};
}
test('existing private RPC client sends each exact native request once',async t=>{
  const {f,e,client}=await clientFixture(t);
  let calls=0;
  for(let i=0;i<3;i++){
    const d=await client.broker({action:'native_dispatch'}),live={batchId:BATCH,executor:d.executor,
      planHash:d.planHash,ticket:d.ticket,dispatchId:d.dispatchId};
    const confirmation=await client.broker({action:'case_live_send',operation:live});
    const provider=await client.sendOnce(d.request,confirmation.permit,live,()=>{
      calls++;f.apply(d.request);return {status:'SUCCEEDED',pageId:d.request.page_id};
    });
    assert.throws(()=>client.sendOnce(d.request,confirmation.permit,live,()=>{calls++;}),/NORMAL_SEND_IDENTITY/);
    await client.broker({action:'native_ack',...live,provider});await client.broker({action:'native_verify'});
  }
  assert.equal(calls,3);assert.equal(e.status().status,'COMPLETED');await client.close();
});
test('existing private client rejects changed native properties before invocation',async t=>{
  const f=await clientFixture(t),d=await f.client.broker({action:'native_dispatch'}),live={batchId:BATCH,
    executor:d.executor,planHash:d.planHash,ticket:d.ticket,dispatchId:d.dispatchId};
  const c=await f.client.broker({action:'case_live_send',operation:live});
  const changed=clone(d.request);changed.properties['이벤트 ID']='forged';
  assert.throws(()=>f.client.sendOnce(changed,c.permit,live,()=>f.invoke(changed)),/NORMAL_SEND_IDENTITY/);
  assert.equal(f.calls,0);assert.equal(f.e.status().next,0);await f.client.close();
});
test('readback drift preserves the durable ACK and blocks all later rows',t=>{
  const f=fixture(t),e=f.executor();e.begin({ownerProof:f.proof(),pages:f.pages});
  const d=dispatch(f,e);confirm(f,e,d);f.apply(d.request);
  e.acknowledge({...d,ownerProof:f.proof(),provider:{status:'SUCCEEDED',pageId:ROWS[0][0]}});
  f.pages[0].structuredContent.text=f.pages[0].structuredContent.text.replace('## HISTORY\nuntouched','## HISTORY\nchanged');
  assert.throws(()=>e.verify({ownerProof:f.proof(),pages:f.pages}),/SOURCE_DRIFT/);
  assert.equal(e.status().status,'ACKED');assert.equal(e.status().next,0);
  assert.throws(()=>dispatch(f,e),/READY/);
});
for(const change of [
  p=>{p.metadata={unknown_block_count:1};},
  p=>{p.metadata={unknown_block_ids:['omitted']};},
  p=>{p.text=p.text.replace('"version":93','"version":94');}
])test('incomplete source or changed own event cannot start a transaction',t=>{
  const f=fixture(t),before=fs.readFileSync(f.b.file,'utf8');change(f.pages[0].structuredContent);
  assert.throws(()=>f.executor().begin({ownerProof:f.proof(),pages:f.pages}));
  assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});
