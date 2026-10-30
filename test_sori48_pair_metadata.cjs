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

function nativeBridgeFixture(t){
 const f=fixture(t),e=f.executor(),{createBridge}=require('./normal_bridge.cjs');
 const refs=['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7',
  '3f586e6dd1d181ddb9f3e7217f64bfcd','3b286e6dd1d1817aa093fca807659f07',
  '3b286e6dd1d181f2a75cfbd3885071c4','3bf86e6dd1d18110938bc358e17c779e',
  '3ed86e6dd1d18118b0b8d98bb91892fb','3b286e6dd1d1811d9308d9a2b56c9de4',
  '40786e6dd1d181ec8addcd1269f9b0bb','3b286e6dd1d18194866dd8d7a28c7ab4'];
 const central='a'.repeat(32),run='actual-test-run';
 const bridge=createBridge({broker:f.b,sori48Metadata:e,installation:{root:f.b.root},verifyExtensions(){},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:f.b.executor,journalHash:'f'.repeat(64)};}});
 const init=bridge.handle({action:'normal_sori48_metadata_init',batchId:BATCH,edits:[],referenceIds:refs,
  centralTaskId:central,runId:run});
 const witness=()=>{const observedAt=new Date().toISOString();return {observedAt,referenceToken:init.referenceToken,
  nativeChecks:refs.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-30T00:00:00Z'})),
  central:{id:central,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};};
 const owned=operation=>{const stage=bridge.handle({action:'case_stage_input',batchId:BATCH,operation});
  return bridge.handle({action:'case_consume_live',batchId:BATCH,...stage,liveSource:witness()});};
 return {f,e,bridge,witness,owned};
}
test('supported native bridge drives the real Broker through all three rows',t=>{
 const {f,e,bridge,witness,owned}=nativeBridgeFixture(t);
 owned({action:'normal_sori48_metadata_begin',batchId:BATCH,pages:f.pages});
 for(let i=0;i<3;i++){
  const d=owned({action:'normal_sori48_metadata_dispatch',batchId:BATCH,pages:f.pages});
  const live={batchId:BATCH,executor:d.executor,planHash:d.planHash,ticket:d.ticket,dispatchId:d.dispatchId};
  const c=bridge.handle({action:'case_live_send',batchId:BATCH,
   operation:{...live,action:'normal_sori48_metadata_confirm',pages:f.pages},liveSource:witness()});
  assert.equal(c.permit.pageId,ROWS[i][0]);
  f.apply(d.request);
  owned({...live,action:'normal_sori48_metadata_ack',provider:{status:'SUCCEEDED',pageId:d.request.page_id}});
  owned({batchId:BATCH,action:'normal_sori48_metadata_verify',pages:f.pages});
 }
 assert.equal(e.status().next,3);assert.equal(e.status().status,'COMPLETED');
 assert.deepEqual(f.b.state.keepOriginalUnknown,{next:3,receipts:[1,2,3],outcome:'UNKNOWN'});
});
test('native RPC does not permit a direct ACK or ordinary mutation',t=>{
 const {f,bridge,owned}=nativeBridgeFixture(t),before=fs.readFileSync(f.b.file,'utf8');
 assert.throws(()=>bridge.handle({action:'normal_sori48_metadata_ack',batchId:BATCH}));
 assert.throws(()=>owned({action:'fence_begin',batchId:BATCH,edits:[]}));
 assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});
test('native bridge cannot replay an uncertain persisted permit',t=>{
 const {f,e,bridge,witness,owned}=nativeBridgeFixture(t);
 owned({action:'normal_sori48_metadata_begin',batchId:BATCH,pages:f.pages});
 const d=owned({action:'normal_sori48_metadata_dispatch',batchId:BATCH,pages:f.pages});
 bridge.handle({action:'case_live_send',batchId:BATCH,
  operation:{...d,action:'normal_sori48_metadata_confirm',pages:f.pages},liveSource:witness()});
 f.apply(d.request);
 assert.throws(()=>owned({action:'normal_sori48_metadata_resume',batchId:BATCH,pages:f.pages}),/NO_PERMIT_REQUIRED/);
 assert.equal(e.status().status,'WRITE_PENDING');assert.equal(e.status().next,0);
});
test('body gate rejects a completed label without all durable exact-plan receipts',t=>{
 const f=fixture(t),{inspectBodyProjection}=require('./sori48_pair_metadata.cjs');
 assert.equal(inspectBodyProjection(f.b,()=>true),null);
 f.b.state.batches[BODY_BATCH]={status:'COMPLETED',next:8,receipt:null,edits:[],verifications:[]};
 assert.throws(()=>inspectBodyProjection(f.b,()=>true),/BODY_RECEIPTS/);
});

test('native body prerequisite consumes eight real protected-content receipts and rejects tampering',t=>{
 const f=fixture(t),provider=require('./sori48_pair_provider.cjs'),
  {inspectBodyProjection}=require('./sori48_pair_metadata.cjs');
 const prior=require('./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json').observedUnwrittenTargets.targets[0].plannedLiteral;
 const ids=['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7',
  '3f586e6dd1d181ddb9f3e7217f64bfcd',...provider.TARGETS];
 const headings=['## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3',
  '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue',
  '## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard'];
 const edits=ids.map((pageId,i)=>({pageId,heading:headings[i],oldStr:i<3?prior:'Sori retains its separate gates.',newStr:provider.CORRECTED_TEXT}));
 const validator=provider.createProvider().validatePlan;assert.equal(validator(edits),true);
 const changed=clone(edits);changed[0].newStr='unapproved';assert.throws(()=>validator(changed),/EXACT_PLAN/);
 f.b.policy.productionPages=ids;f.b.policy.headingPrefixes=['## CURRENT'];
 f.b.policy.centralSections=ids.slice(0,2).map((pageId,i)=>({pageId,heading:headings[i]}));
 const proof=()=>({...f.proof(),scope:BODY_BATCH});
 const begin=f.b.handle({action:'fence_begin',batchId:BODY_BATCH,edits,ownerProof:proof()});
 const live={batchId:BODY_BATCH,executor:begin.executor,planHash:begin.planHash};
 for(let i=0;i<8;i++){
  const e=edits[i],raw={structuredContent:{id:e.pageId,page_last_edited_at:'2026-10-30T00:00:00Z',
   text:'<properties>\n{"title":"preserve"}\n</properties>\n<content>\n'+e.heading+'\n'+e.oldStr+'\n## HISTORY\nprotected\n</content>'}};
  const call=(action,extra={})=>f.b.handle({...live,action,ownerProof:proof(),...extra});
  live.ticket=call('fence_prepare',{page:raw}).ticket;call('fence_authorize',{page:raw});
  live.dispatchId=call('fence_dispatch',{page:raw}).dispatchId;call('fence_confirm_send');
  raw.structuredContent.text=raw.structuredContent.text.replace(e.oldStr,e.newStr);
  call('fence_ack',{provider:{status:'SUCCEEDED',pageId:e.pageId}});call('fence_verify',{page:raw});
 }
 assert.equal(inspectBodyProjection(f.b,validator).verifiedTargets,8);
 const file=f.b.snapshot(BODY_BATCH,7)+'.verified.json';
 const forged=JSON.parse(fs.readFileSync(file,'utf8'));forged.page.body+='changed';fs.writeFileSync(file,JSON.stringify(forged));
 assert.throws(()=>inspectBodyProjection(f.b,validator));
});

const chainBodyIds=["3f586e6dd1d181ebb43dd7de62aa2ca4","3f586e6dd1d181cd9f5bdcdab6290de7","3f586e6dd1d181ddb9f3e7217f64bfcd",...require("./sori48_pair_provider.cjs").TARGETS];
function exactChainEdits(){
 const provider=require('./sori48_pair_provider.cjs');
 const prior=require('./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json').observedUnwrittenTargets.targets[0].plannedLiteral;
 const headings=['## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3',
  '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue',
  '## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard'];
 return chainBodyIds.map((pageId,i)=>({pageId,heading:headings[i],oldStr:i<3?prior:'Sori retains its separate gates.',newStr:provider.CORRECTED_TEXT}));
}
for(const loseNativeResult of [false,true])test('real body to native pipeline '+(loseNativeResult?'retains an uncertain native send without replay':'uses projected preimages and preserves own proof'),async t=>{
 const f=fixture(t),edits=exactChainEdits(),{createBridge}=require('./normal_bridge.cjs'),
  native=require('./sori48_pair_metadata.cjs'),provider=require('./sori48_pair_provider.cjs').createProvider();
 const factory=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,name),'utf8'),{setTimeout});
 const pages=Object.fromEntries(f.pages.map(p=>[p.structuredContent.id,clone(p)]));
 for(const edit of edits){
  if(!pages[edit.pageId])pages[edit.pageId]={structuredContent:{id:edit.pageId,page_last_edited_at:'2026-10-30T00:00:00Z',
   text:'<properties>\n{"title":"preserve"}\n</properties>\n<content>\n## SOURCE\npreserve\n</content>'}};
  const p=pages[edit.pageId].structuredContent;p.text=p.text.replace('\n</content>','\n'+edit.heading+'\n'+edit.oldStr+'\n## AFTER\nprotected\n</content>');
 }
 const wip='3b286e6dd1d18194866dd8d7a28c7ab4';pages[wip]={structuredContent:{id:wip,page_last_edited_at:'2026-10-30T00:00:00Z',
  text:'<properties>\n{"title":"policy"}\n</properties>\n<content>\npolicy\n</content>'}};
 const refs=[...chainBodyIds,ROWS[1][0],wip].map(pageId=>({pageId,page:clone(pages[pageId])}));
 f.b.policy.productionPages=[...chainBodyIds,ROWS[1][0]];
 f.b.policy.headingPrefixes=['## CURRENT CENTRAL OBSERVATION','## CURRENT INCIDENT MAINTENANCE'];
 f.b.policy.centralSections=edits.slice(0,2).map(e=>({pageId:e.pageId,heading:e.heading}));
 const central='a'.repeat(32),run='actual-test-run',writes=[];
 const tools={mcp__codex_apps__notion_fetch:async({id})=>clone(pages[id]),
  mcp__codex_apps__automations_peek:async()=>({structuredContent:{automations:[{id:central,is_enabled:true,
   run_details:{last_run:{id:run,recorded_status:'in_progress'}}}]}}),
  mcp__codex_apps__notion_notion_update_page:async request=>{
   writes.push(clone(request));const p=pages[request.page_id].structuredContent;
   if(request.command==='update_content')for(const u of request.content_updates)
    p.text=p.text.replace(u.old_str,()=>u.new_str);
   else p.text=p.text.replace(/<properties>\n([\s\S]*?)\n<\/properties>/,(_,raw)=>
    '<properties>\n'+JSON.stringify({...JSON.parse(raw),...request.properties})+'\n</properties>');
   if(loseNativeResult&&request.command==='update_properties')throw Error('LOST_NATIVE_REPLY');
   return {structuredContent:{page_id:request.page_id}};
  }};
 let clients=0;
 const createClient=()=>{
  if(clients++)f.restart();const b=f.b;
  const executor=native.createExecutor({broker:b,inspectClosedUnknown:()=>({valid:true,
   batchId:'SORI48-PAIR-ADMIT-20261029',status:'CLOSED_SUPERSEDED_UNKNOWN',originalOutcome:'UNKNOWN',
   lateObservationRequired:true,cleanTermination:false,capacityReleased:false,productAccepted:false}),
   inspectBodyProjection:()=>native.inspectBodyProjection(b,provider.validatePlan)});
  const bridge=createBridge({broker:b,sori48Metadata:executor,validateSori48PairPlan:provider.validatePlan,
   installation:{root:b.root},verifyExtensions(){},probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},
    brokerExecutor:b.executor,journalHash:'f'.repeat(64)};}});
  const text=s=>({content:[{type:'text',text:s}]});
  return factory('normal_rpc_client.js')({
   mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process:async()=>text('Process started with PID 12345\nNPG/2 {"ready":true}'),
   mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process:async({input})=>{
    const q=JSON.parse(input);try{return text('NPG/2 '+JSON.stringify({requestId:q.requestId,ok:true,result:await bridge.handle(q)}));}
    catch(e){return text('NPG/2 '+JSON.stringify({requestId:q.requestId,ok:false,error:e.message,code:e.code??'ERROR'}));}
   },mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output:async()=>{throw Error('unexpected transport read');}
  },{command:'isolated real chain test'});
 };
 const entry=factory('normal_followthrough_v2.js')(tools,{createTransport:()=>tools,createClient,
  createLiveRunner:factory('normal_live_runner.js'),createWitness:factory('normal_live_owner.js'),
  createLandedProjection(){},createCommand:()=> 'isolated test command',centralTaskId:central,runId:run,installation:{},
  createSori48SourceCollector:()=>({collect:async()=>({schema:'SORI48_FRESH_SOURCE_OBSERVATION_V1',
   batchId:'SORI48-PAIR-ADMIT-20261029',classification:'CLEAR_OBSERVATION_ONLY',
   freshSourcesComplete:true,applyAuthorized:false,attributableTerminalResult:null})})});
 const admission={schema:'SORI48_CORRECTED_HEAD_PAIR_PROJECTION_V1',observationId:BODY_BATCH,applyAuthorized:false,
  requiresCanonicalClosure:true,metadataReconciliationRequired:true,edits};
 if(loseNativeResult){
  await assert.rejects(()=>entry.runSori48PairReconciliation(admission,refs),/LOST_NATIVE_REPLY/);
  assert.equal(f.b.state.batches[BATCH].status,'WRITE_PENDING');assert.equal(f.b.state.batches[BATCH].next,0);
  await assert.rejects(()=>entry.runSori48PairReconciliation(admission,refs),/WRITE_PENDING_UNKNOWN/);
  assert.equal(writes.length,9);
 }else{
  const result=await entry.runSori48PairReconciliation(admission,refs);
  assert.equal(result.status,'PAIR_RECONCILED');assert.equal(result.native.receipt.next,3);
  assert.equal(writes.filter(r=>r.command==='update_content').length,8);
  assert.equal(writes.filter(r=>r.command==='update_properties').length,3);
 }
 assert.deepEqual(f.b.state.keepOriginalUnknown,{next:3,receipts:[1,2,3],outcome:'UNKNOWN'});
});
