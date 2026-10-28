'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const factory=name=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,name),'utf8'));
const landed=factory('landed_task_projection.js'),provider=factory('normal_projection_prerequisites.js');
const transport=factory('additional_mcp_transport.js'),{probe}=require('./normal_projection_probe.cjs');
const sha='a'.repeat(40),merge='b'.repeat(40),writer='c'.repeat(32),reviewer='d'.repeat(32);
const router='3bf86e6dd1d18110938bc358e17c779e',policy='3b286e6dd1d18194866dd8d7a28c7ab4';
const shared=[
 ['3b286e6dd1d1817aa093fca807659f07','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue'],
 ['3b286e6dd1d181f2a75cfbd3885071c4','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue'],
 [router,'## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING'],
 ['3ed86e6dd1d18118b0b8d98bb91892fb','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub'],
 ['3b286e6dd1d1811d9308d9a2b56c9de4','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard']];
const raw=(id,p)=>({content:[{type:'text',text:JSON.stringify({id,page_last_edited_at:'2026-10-28T00:00:00Z',
 text:'<properties>\n'+JSON.stringify(p.props)+'\n</properties>\n<content>\n'+p.body+'\n</content>'})}]});
function projectionFixture(repository='nodekit',n=1) {
 const repo=repository==='sori'?'HeaInSeo/sori':'HeaInSeo/NodeKit';
 const pair=repository==='sori'?['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7']:[writer,reviewer];
 const extra=repository==='sori'?[
  [pair[0],'## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3'],
  [pair[1],'## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED'],
  ['3f586e6dd1d181ddb9f3e7217f64bfcd','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index']]:
  [['3f086e6dd1d1818e9aecdc093a08cda9','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · nodekit_index']];
 const observationId='NORMAL-TEST-'+n,marker='observation-id: '+observationId;
 const properties={'작업 상태':'실행재개','다음 담당자':'오퍼레이터','큐 구획':'현재','차단 대상':'none',
  '재개 지시':'existing successor only','큐 정리 근거':marker+'; current source'};
 const binding={repository,source:{kind:'MERGED',pr:n,head:sha,mergeSha:merge}},pages=new Map();
 ['writer','reviewer'].forEach((r,i)=>{
  const e={event_id:r+'-release-'+n,task_id:r+'-task',phase:'phase-'+n+':'+(i?'R':'W'),role:i?'guardrail':'operator',
   session_id:r+'-session',version:n,kind:'RELEASE',event_at_utc:'2026-10-27T00:00:00Z',repo_pr:repo+'#'+n,
   head_or_digest:sha+' base '+'e'.repeat(40),lease_state:'RELEASED'};
  binding[r]={pageId:pair[i],taskId:e.task_id,phase:e.phase,eventId:e.event_id,sessionId:e.session_id,version:n};
  const event=i?'QUEUE_EVENT_V1 '+JSON.stringify(e):JSON.stringify({QUEUE_EVENT_V1:e});
  pages.set(pair[i],{props:{...properties,'작업 ID':e.task_id,'이벤트 ID':e.event_id,'세션 ID':e.session_id,
   '체크포인트 버전':n,'Authority Gate':'READY','대상 행':['https://app.notion.com/p/'+pair[1-i]]},
   body:'## OWN CURRENT\n```json\n'+event+'\n```\n'+(i?'Verdict: PASS. P0=0, P1=0, P2=0\n':'')});
 });
 const edits=extra.concat(shared).map(([pageId,heading])=>({pageId,heading,oldStr:'state=OLD-'+pageId,
  newStr:marker+'; state=NEW-'+pageId}));
 for(const e of edits){if(!pages.has(e.pageId))pages.set(e.pageId,{props:{},body:''});
  pages.get(e.pageId).body+='\n'+e.heading+'\n'+e.oldStr+'\n## PRESERVED HISTORY\nkeep';}
 const bundle={observationId,observationMarkerStyle:'plain-v1',repositories:[repository],binding,
  native:pair.map(pageId=>({pageId,properties:structuredClone(properties)})),edits};
 let writes=0,reads=0,sourceReads=0,fault;
 const tools={async mcp__codex_apps__notion_fetch({id}){reads++;return raw(id,pages.get(id));},
  async mcp__codex_apps__github_get_pr_info(){sourceReads++;return {structuredContent:{merged:fault!=='not-merged',
   head_sha:fault==='changed-head'?'f'.repeat(40):sha,merge_commit_sha:merge,
   base:fault==='non-default-base'?'feature-branch':repository==='sori'?'master':'main'}};},
  async mcp__codex_apps__github_fetch(){return {structuredContent:{content:JSON.stringify({default_branch:repository==='sori'?'master':'main'})}};}};
  const config={createRunner(){return {async run(id,edits){writes++;for(const e of edits){const p=pages.get(e.pageId);p.body=p.body.replace(e.oldStr,()=>e.newStr);}
  if(fault==='new-own-claim')pages.get(pair[0]).props['이벤트 ID']='new-claim';
  if(fault==='lost-ack')throw Error('UNCERTAIN_WRITE');return {status:'COMPLETED'};}};}};
 return {bundle,pages,tools,client:landed(tools,config),set fault(v){fault=v;},get writes(){return writes;},get reads(){return reads;},get sourceReads(){return sourceReads;}};
}
for(const r of ['nodekit','sori'])for(const n of [1,2])test('ordinary '+r+' uses its actual current task/pair and successive merged source '+n,async()=>{
 const f=projectionFixture(r,n),out=await f.client.run(f.bundle);
 assert.equal(out.status,'COMPLETE');assert.equal(out.bodyTargets,r==='sori'?8:6);assert.equal(out.nativeTargets,2);
 assert.equal(out.binding.writer.pageId,f.bundle.binding.writer.pageId);assert.equal(f.sourceReads,2);assert.equal(f.writes,1);
});
for(const [name,change] of [
 ['historical native ID',f=>f.bundle.native[0].pageId='3f386e6dd1d18110bf66c5204284ed46'],
 ['missing shared queue',f=>f.bundle.edits.splice(2,1)],
 ['worker property write',f=>f.bundle.native[0].properties['이벤트 ID']='fake'],
 ['same worker session',f=>f.bundle.binding.reviewer.sessionId=f.bundle.binding.writer.sessionId],
 ['dedicated BORI',f=>f.bundle.repositories=['bori']],
 ['cross repository transaction',f=>f.bundle.repositories.push('sori')]
])test('invalid manifest cannot read or write: '+name,async()=>{
 const f=projectionFixture();change(f);await assert.rejects(f.client.run(f.bundle));assert.equal(f.writes,0);assert.equal(f.reads,0);
});
for(const [name,change] of [
 ['wrong phase',f=>f.bundle.binding.writer.phase='stale-phase'],
 ['unlinked pair',f=>f.pages.get(reviewer).props['대상 행']=[]],
 ['own event mismatch',f=>f.pages.get(writer).props['이벤트 ID']='new-event'],
 ['authority wait',f=>f.pages.get(writer).props['Authority Gate']='WAIT'],
 ['closed original',f=>f.pages.get(writer).props['작업 상태']='종료'],
 ['non-PASS pair',f=>f.pages.get(reviewer).body=f.pages.get(reviewer).body.replace('Verdict: PASS','Verdict: FAIL')],
 ['newer own event',f=>f.pages.get(writer).body+='\n```json\n'+JSON.stringify({QUEUE_EVENT_V1:{task_id:'writer-task',version:2}})+'\n```'],
 ['unmerged source',f=>f.fault='not-merged'],
 ['different head',f=>f.fault='changed-head']
])test('live source blocks body mutation: '+name,async()=>{
 const f=projectionFixture();change(f);await assert.rejects(f.client.run(f.bundle));assert.equal(f.writes,0);
});
test('non-default-branch merge cannot certify a landing projection',async()=>{
 const f=projectionFixture();f.fault='non-default-base';
 await assert.rejects(f.client.run(f.bundle),/default branch/);assert.equal(f.writes,0);
});
test('literal dollar replacement tokens remain literal throughout full readback',async()=>{
 const f=projectionFixture();f.bundle.edits[0].newStr+="; dollar=$& $$ $1 $'";
 assert.equal((await f.client.run(f.bundle)).status,'COMPLETE');
});
for(const text of ['> Verdict: PASS. P0=0, P1=0, P2=0','```text\nVerdict: PASS. P0=0, P1=0, P2=0\n```',
 '<code>Verdict: PASS. P0=0, P1=0, P2=0</code>'])test('quoted prior PASS cannot replace a bound verdict: '+text,async()=>{
 const f=projectionFixture(),p=f.pages.get(reviewer);p.body=p.body.replace('Verdict: PASS. P0=0, P1=0, P2=0',text);
 await assert.rejects(f.client.run(f.bundle),/Bound source/);assert.equal(f.writes,0);
});
function advance(f,role) {
 const binding=f.bundle.binding[role],p=f.pages.get(binding.pageId),old=structuredClone(binding);
 const current={event_id:role+'-successor-release',task_id:binding.taskId,phase:'successor-phase',role:role==='writer'?'operator':'guardrail',
  session_id:role+'-successor-session',version:binding.version+2,kind:'RELEASE',event_at_utc:'2026-10-27T01:00:00Z',
  repo_pr:'HeaInSeo/NodeKit#2',head_or_digest:'f'.repeat(40),lease_state:'RELEASED'};
 binding.eventId=current.event_id;binding.phase=current.phase;binding.sessionId=current.session_id;binding.version=current.version;
 binding.sourceRelease=old;delete binding.sourceRelease.pageId;
 Object.assign(p.props,{'이벤트 ID':current.event_id,'세션 ID':current.session_id,'체크포인트 버전':current.version});
 p.body='## SUCCESSOR CURRENT\n```json\n'+JSON.stringify({QUEUE_EVENT_V1:current})+'\n```\n'+
  (role==='reviewer'?'Verdict: NOT ACCEPTED. P2=1\n':'')+'\n## HISTORY SOURCE\n'+p.body.replace(/^## OWN CURRENT\n/,'');
}
test('a newer successor release is preserved while the prior merge source is projected',async()=>{
 const f=projectionFixture();advance(f,'writer');const own=structuredClone(f.pages.get(writer).props);
 assert.equal((await f.client.run(f.bundle)).status,'COMPLETE');assert.deepEqual(f.pages.get(writer).props,own);
});
test('source PASS is bound to its historical event, not a successor verdict',async()=>{
 const f=projectionFixture();advance(f,'writer');advance(f,'reviewer');
 assert.equal((await f.client.run(f.bundle)).status,'COMPLETE');
 assert.match(f.pages.get(reviewer).body,/Verdict: NOT ACCEPTED/);
});
test('an invented historical release cannot authorize source catchup',async()=>{
 const f=projectionFixture();advance(f,'writer');f.bundle.binding.writer.sourceRelease.eventId='not-in-source';
 await assert.rejects(f.client.run(f.bundle),/frozen source RELEASE/);assert.equal(f.writes,0);
});
for(const fault of ['new-own-claim','lost-ack'])test('no certificate or replay after '+fault,async()=>{
 const f=projectionFixture();f.fault=fault;await assert.rejects(f.client.run(f.bundle));assert.equal(f.writes,1);
});
test('a final current-task landing can project terminal metadata without reopening its row',async()=>{
 const f=projectionFixture();
 for(const n of f.bundle.native){Object.assign(n.properties,{'작업 상태':'종료','다음 담당자':'없음','큐 구획':'완료 이력'});
  Object.assign(f.pages.get(n.pageId).props,n.properties);}
 assert.equal((await f.client.run(f.bundle)).status,'COMPLETE');
 assert.equal(f.pages.get(writer).props['작업 상태'],'종료');
});
function providerFixture() {
 const canonical={manifestHash:'e'.repeat(64),exclusive:false,authority:{ownerId:'old-manual',generation:'old'}};
 const pages=new Map([writer,reviewer,router,policy].map(id=>[id,{props:{'이벤트 ID':'real-release'},body:'complete authority'}]));
 const config={batchId:'NORMAL-TEST-1',centralTaskId:'1'.repeat(32),runId:'actual-run',root:'/synthetic-state',extensionSourceHead:sha,
  nativePageIds:[writer,reviewer],nativeExpectations:[writer,reviewer].map(pageId=>({pageId,properties:{}})),
  references:[...pages].map(([pageId,p])=>({pageId,page:raw(pageId,p)})),edits:[],
  probeCommand:'node /reviewed/probe.cjs --output json',getBrokerPid:()=>123};
 let fault,calls=0;
 const tools={async mcp__codex_apps__notion_fetch({id}){const p=raw(id,pages.get(id));
  if(fault==='truncated'){const d=JSON.parse(p.content[0].text);d.truncated=true;p.content[0].text=JSON.stringify(d);}return p;},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(){calls++;
   const observedAt=new Date(Date.now()+(fault==='future'?31000:fault==='stale'?-31000:0)).toISOString();
   return {content:[{type:'text',text:'NPG-NORMAL/1 '+JSON.stringify({schema:'NORMAL_PROJECTION_PROBE_V1',
    batchId:config.batchId,root:config.root,brokerPid:fault==='other-lock'?456:123,brokerExecutor:'same-executor',
    observedAt,validUntil:new Date(Date.parse(observedAt)+30000).toISOString(),canonical,
    controlsVerified:18,extensionsVerified:5,sourceHead:sha,notionWrites:0,canonicalWrites:0,workerStarts:0,journalHash:'f'.repeat(64)})}]};},
  async mcp__codex_apps__automations_peek(){return {structuredContent:{automations:[{id:config.centralTaskId,
   is_enabled:fault!=='disabled',run_details:{last_run:{id:fault==='other-run'?'other':config.runId,
    recorded_status:fault==='completed'?'completed':'in_progress'}}}]}};}};
 return {canonical,pages,config,tools,get calls(){return calls;},set fault(v){fault=v;}};
}
test('ordinary provider accepts exclusive=false with real enabled in-progress scheduled owner',async()=>{
 const f=providerFixture(),p=await provider(f.tools,f.config)({batchId:f.config.batchId,canonical:f.canonical});
 assert.equal(p.allowed,true);assert.match(p.scope,/PROJECTION_ONLY/);assert.equal(f.calls,1);
});
for(const fault of ['stale','future','other-lock','other-run','completed','disabled','truncated'])test('ordinary provider rejects '+fault,async()=>{
 const f=providerFixture();f.fault=fault;await assert.rejects(provider(f.tools,f.config)({batchId:f.config.batchId,canonical:f.canonical}));
});
for(const id of [writer,reviewer,router,policy])test('ordinary provider preserves complete protected source '+id,async()=>{
 const f=providerFixture(),p=provider(f.tools,f.config);f.pages.get(id).props['이벤트 ID']='new-own-proof';
 await assert.rejects(p({batchId:f.config.batchId,canonical:f.canonical}),/PROPERTIES_CHANGED/);
});
test('ordinary provider rejects old exclusive recovery ownership before probing',async()=>{
 const f=providerFixture();f.canonical.exclusive=true;
 await assert.rejects(provider(f.tools,f.config)({batchId:f.config.batchId,canonical:f.canonical}),/EXCLUSIVE_OWNER/);assert.equal(f.calls,0);
});
test('ordinary provider allows only its exact planned central literal and native metadata',async()=>{
 const f=providerFixture();f.config.edits=[{pageId:writer,oldStr:'complete authority',newStr:'planned central projection'}];
 f.config.nativeExpectations[0].properties['작업 상태']='실행재개';
 const p=provider(f.tools,f.config);f.pages.get(writer).body='planned central projection';f.pages.get(writer).props['작업 상태']='실행재개';
 assert.equal((await p({batchId:f.config.batchId,canonical:f.canonical})).allowed,true);
 f.pages.get(writer).body+=' worker was edited';await assert.rejects(p({batchId:f.config.batchId,canonical:f.canonical}),/BODY_CHANGED/);
});
test('native source comparison treats replacement dollar tokens literally',async()=>{
 const f=providerFixture();f.config.edits=[{pageId:writer,oldStr:'complete authority',newStr:"literal $& $1 $$ $'"}];
 const p=provider(f.tools,f.config);f.pages.get(writer).body=f.config.edits[0].newStr;
 assert.equal((await p({batchId:f.config.batchId,canonical:f.canonical})).allowed,true);
});
test('concurrent central HOLD cannot be hidden by a metadata allowlist',async()=>{
 const f=providerFixture(),p=provider(f.tools,f.config);f.pages.get(writer).props['차단 대상']='new real HOLD';
 await assert.rejects(p({batchId:f.config.batchId,canonical:f.canonical}),/PROPERTIES_CHANGED/);
});
test('transport uses only Additional MCP and returns its actual broker PID',async()=>{
 const calls=[],t=transport({
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(x){calls.push(x);return {content:[{type:'text',text:'Process started with PID 123'}]};},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process(x){calls.push(x);return {};},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(x){calls.push(x);return {};}
 });
 await t.mcp__codex_apps__remote_desktop_commander_start_process({deviceId:'unused',command:'reviewed broker',timeout_ms:1000});
 await t.mcp__codex_apps__remote_desktop_commander_interact_with_process({deviceId:'unused',pid:123,input:'one request\n'});
 assert.equal(t.getNpgBrokerPid(),123);assert.equal(calls.length,2);assert.equal(Object.hasOwn(calls[0],'deviceId'),false);
 await assert.rejects(t.mcp__codex_apps__remote_desktop_commander_get_tool_result({call_id:'wrong'}));
 assert.equal(calls.length,2);
});
function probeFixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-normal-')),root=path.join(dir,'state'),runtime=path.join(dir,'runtime');
 fs.mkdirSync(root);fs.mkdirSync(runtime);
 // Explicitly synthetic controls isolate the read-only probe. Real exception
 // validation/pin retirement is covered by test_case_exception/ack_bridge.
 const source="module.exports={validateControl:()=>({controls:{files:Array(18).fill({})}}),controls:()=>{}};\n";
 fs.writeFileSync(path.join(runtime,'case_exception.cjs'),source,{mode:0o600});
 const state={active:null,caseExceptionControl:{exclusive:false},batches:{old:{status:'CLOSED_EXCEPTION_UNCONFIRMED'},partial:{status:'RECONCILED_PARTIAL'}}};
 const save=()=>fs.writeFileSync(path.join(root,'journal.json'),JSON.stringify(state),{mode:0o600});save();
 fs.writeFileSync(path.join(root,'broker.lock'),JSON.stringify({pid:process.pid,executor:'real-test-process'}),{mode:0o600});
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {root,runtime,state,save,input:{root,runtime,brokerPid:process.pid,batchId:'NORMAL-TEST-1',
  caseModuleHash:crypto.createHash('sha256').update(source).digest('hex')}};
}
test('probe preserves historical uncertainty and all canonical bytes',t=>{
 const f=probeFixture(t),before=fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),r=probe(f.input);
 assert.equal(r.notionWrites,0);assert.equal(r.canonicalWrites,0);assert.equal(r.workerStarts,0);assert.equal(r.controlsVerified,18);
 assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),before);
});
for(const status of ['HALTED','WRITE_PENDING','PREPARED','UNKNOWN'])test('probe rejects another unresolved '+status,t=>{
 const f=probeFixture(t);f.state.batches.other={status};f.save();assert.throws(()=>probe(f.input),/UNRESOLVED_BATCH/);
});
test('probe rejects changed installed control code before loading it',t=>{
 const f=probeFixture(t);fs.appendFileSync(path.join(f.runtime,'case_exception.cjs'),'throw Error("must not execute");');
 assert.throws(()=>probe(f.input),/CASE_PIN/);
});
for(const repository of ['nodekit','sori'])test('composite ordinary entry uses real fenced broker and full native readback: '+repository,async t=>{
 const {Broker}=require('./broker.cjs'),f=projectionFixture(repository),authority=providerFixture().canonical;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'npg-ordinary-flow-'));
 let broker=null,updates=0,brokerStarts=0,probeCalls=0;
 const scope={productionEnabled:true,productionPages:f.bundle.edits.map(e=>e.pageId),canaryPages:[],
  centralSections:f.bundle.edits.filter(e=>e.heading.startsWith('## CURRENT ·')).map(e=>({pageId:e.pageId,heading:e.heading})),
  headingPrefixes:['## CURRENT CENTRAL OBSERVATION','## CURRENT INCIDENT MAINTENANCE']};
 f.pages.set(policy,{props:{},body:'Applied WIP authority'});
 t.after(()=>{if(broker&&!broker.closed)broker.close();fs.rmSync(root,{recursive:true,force:true});});
 const tools={...f.tools,
  async mcp__codex_apps__automations_peek(){return {structuredContent:{automations:[{id:'1'.repeat(32),is_enabled:true,
   run_details:{last_run:{id:'actual-run',recorded_status:'in_progress'}}}]}};},
  async mcp__codex_apps__notion_notion_update_page(request){
   updates++;assert.equal(request.command,'update_content');assert.equal(request.allow_deleting_content,false);
   const p=f.pages.get(request.page_id),edit=request.content_updates[0];
   assert.equal(p.body.split(edit.old_str).length-1,1);p.body=p.body.replace(edit.old_str,edit.new_str);
   return {content:[{type:'text',text:JSON.stringify({page_id:request.page_id})}]};
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process({command}){
   if(command==='SYNTHETIC_REVIEWED_BROKER'){
    brokerStarts++;broker=new Broker(root,scope);
    return {content:[{type:'text',text:'Process started with PID '+process.pid+'\nNPG/1 {"ready":true}'}]};
   }
   assert.match(command,/^node \/reviewed\/probe.cjs --output json --broker-pid \d+ --batch NORMAL-TEST-1$/);
   probeCalls++;return {content:[{type:'text',text:'NPG-NORMAL/1 '+JSON.stringify({schema:'NORMAL_PROJECTION_PROBE_V1',
    batchId:f.bundle.observationId,root,brokerPid:process.pid,brokerExecutor:broker.executor,controlsVerified:18,extensionsVerified:5,sourceHead:sha,
    observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+30000).toISOString(),canonical:authority,
    journalHash:'f'.repeat(64),notionWrites:0,canonicalWrites:0,workerStarts:0})}]};
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process({input}){
   const request=JSON.parse(input);let out;
   try{out={requestId:request.requestId,ok:true,result:request.action==='case_authority'?authority:broker.handle(request)};}
   catch(error){out={requestId:request.requestId,ok:false,code:error.code,error:error.message};}
   if(request.action==='close')broker.close();
   return {content:[{type:'text',text:'NPG/1 '+JSON.stringify(out)}]};
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(){throw Error('No replay or unbound polling expected');}
 };
 const references=[...new Set([f.bundle.binding.writer.pageId,f.bundle.binding.reviewer.pageId,router,policy])]
  .map(pageId=>({pageId,page:raw(pageId,f.pages.get(pageId))}));
 const client=factory('ordinary_followthrough.js')(tools,{
  createTransport:transport,createRunner:factory('runner.js'),createCaseOwner:factory('central_case_owner.js'),
  createPrerequisites:provider,createLandedProjection:landed,centralTaskId:'1'.repeat(32),runId:'actual-run',root,
  createProbeCommand:()=> 'node /reviewed/probe.cjs --output json',installation:{sourceHead:sha},runnerConfig:{command:'SYNTHETIC_REVIEWED_BROKER'}
 });
 const out=await client.run(f.bundle,references);
 assert.equal(out.status,'COMPLETE');assert.equal(updates,repository==='sori'?8:6);assert.equal(brokerStarts,1);
 assert.ok(probeCalls>updates*3);assert.equal(broker.state.active,null);
 assert.equal(broker.state.batches[f.bundle.observationId].status,'COMPLETED');
});
function bootstrapFixture(t){
 const f=probeFixture(t),head='a'.repeat(40),dir=path.join(f.runtime,'extensions',head);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
  'normal_projection_probe.cjs','ordinary_followthrough.js'],files={};
 for(const n of names){const content=n==='normal_projection_probe.cjs'?fs.readFileSync(path.join(__dirname,n),'utf8'):'// synthetic immutable module\n';
  fs.writeFileSync(path.join(dir,n),content,{mode:0o600});files[n]=crypto.createHash('sha256').update(content).digest('hex');}
 return {...f,dir,installation:{root:f.root,runtime:f.runtime,sourceHead:head,extensionDirectory:dir,
  caseModuleHash:f.input.caseModuleHash,files}};
}
test('literal bootstrap verifies all five extension files before invoking the real read-only probe',t=>{
 const f=bootstrapFixture(t),cp=require('node:child_process'),command=factory('ordinary_probe_command.js')(f.installation);
 const r=cp.spawnSync('/bin/sh',['-c',command+' --broker-pid '+process.pid+' --batch NORMAL-TEST-1'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout.trim().slice(13));
 assert.equal(p.extensionsVerified,5);assert.equal(p.sourceHead,f.installation.sourceHead);assert.equal(p.canonicalWrites,0);
});
for(const mutation of ['changed','symlink','writable'])test('literal bootstrap refuses extension '+mutation+' before probe execution',t=>{
 const f=bootstrapFixture(t),cp=require('node:child_process'),file=path.join(f.dir,'ordinary_followthrough.js');
 if(mutation==='changed')fs.appendFileSync(file,'changed');
 if(mutation==='symlink'){fs.unlinkSync(file);fs.symlinkSync(path.join(f.dir,'landed_task_projection.js'),file);}
 if(mutation==='writable')fs.chmodSync(file,0o666);
 const cmd=factory('ordinary_probe_command.js')(f.installation)+' --broker-pid '+process.pid+' --batch NORMAL-TEST-1';
 const r=cp.spawnSync('/bin/sh',['-c',cmd],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(r.stdout.includes('NPG-NORMAL/1'),false);assert.match(r.stderr,/ORDINARY_(FILE_PIN|EXTENSION_FILE)/);
});
