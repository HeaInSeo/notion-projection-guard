'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),
 path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const core=require('./broker.cjs'),{createBridge}=require('./normal_bridge.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const factory=(name,extra={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,name),'utf8'),{setTimeout,...extra});
const compiled=(name,extra={})=>{const m={exports:{}};
 new Function('require','module','exports',...Object.keys(extra),fs.readFileSync(path.join(__dirname,name),'utf8'))
  (require,m,m.exports,...Object.values(extra));return m.exports;};
const central='1'.repeat(32),run='actual-test-run',batchId='NODEKIT149-LANDED-20261028',
 router='3bf86e6dd1d18110938bc358e17c779e',wip='3b286e6dd1d18194866dd8d7a28c7ab4';
const ids='abcdef'.split('').map(x=>x.repeat(32));
const edits=ids.map(pageId=>({pageId,heading:'## CURRENT CENTRAL OBSERVATION · test',oldStr:'state=OLD',newStr:'state=NEW'}));
const page=(id,value='OLD',revision='2026-10-28T00:00:00Z')=>({structuredContent:{id,page_last_edited_at:revision,
 text:'<properties>\n{"title":"source"}\n</properties>\n<content>\n'+edits[0].heading+'\nstate='+value+'\n## HISTORY\npreserve\n</content>'}});
const proof=()=>({ownerId:'automation:'+central,generation:run,scope:batchId,prerequisites:true,conflicts:[],
 evidenceHash:'e'.repeat(64),observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+15000).toISOString()});
function liveFixture(t,fault){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'npg-precall-')),
  b=new core.Broker(root,{productionEnabled:true,productionPages:ids,canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']});
 t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 let virtual=null,delay=true,pending='',stagedAction,writes=0,closed=0,tails=0;
 class ClockDate extends Date{static now(){return virtual??Date.now();}}
 const restore=compiled('normal_unsent.cjs',{Date:ClockDate}).createUnsent(core);
 const bridge=createBridge({broker:b,installation:{root},restoreUnsent:restore,verifyExtensions(){},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:b.executor,journalHash:'f'.repeat(64)};}});
 const pages=new Map([[ids[0],page(ids[0])]]);
 const tools={
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(){
   return {content:[{type:'text',text:'Process started with PID 123\nNPG/2 {"ready":true}\n'}]};},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process(q){
   const input=JSON.parse(q.input);
   const metadata=['case_consume_live','case_live_send','fence_ack','fence_observe','fence_halt','close'].includes(input.action);
   assert.equal(q.wait_for_prompt,metadata&&!Object.hasOwn(input,'page')&&!Object.hasOwn(input,'edits')&&q.input.length<=16384);
   assert.equal(q.timeout_ms,q.wait_for_prompt?3000:500);
   if(input.action==='case_stage_input')stagedAction=input.operation.action;
   let result;
   try{result={requestId:input.requestId,ok:true,result:bridge.handle(input)};}
   catch(e){result={requestId:input.requestId,ok:false,code:e.code??'ERROR',error:e.message};}
   if(input.action==='case_live_send'&&delay&&fault!=='native-result-lost'){
    virtual=Date.now()+16000;if(fault!=='always-expired')delay=false;
   }
   if(input.action==='case_consume_live'&&stagedAction==='normal_pre_call_expired')virtual=null;
   if(input.action==='close')closed++;
   pending='NPG/2 '+JSON.stringify(result)+'\n';
   // The transport consumed output during input; only the retained frame is
   // available. The final retained line is blank, as in real Additional MCP.
   // Never return the preceding 3 MB echo through a 30-line tail.
   return {content:[{type:'text',text:'Process running; no incremental output'}]};
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(q){
   assert.equal(q.offset,-2);assert.equal(q.length,2);tails++;
   return {content:[{type:'text',text:pending+'\n'}]};},
  async mcp__codex_apps__notion_fetch({id}){return pages.get(id)||page(id);},
  async mcp__codex_apps__notion_notion_update_page(q){
   writes++;if(fault==='native-result-lost')throw Error('NORMAL_PRE_CALL_PERMIT_EXPIRED');
   const before=pages.get(q.page_id),d=JSON.parse(JSON.stringify(before));
   for(const edit of q.content_updates)d.structuredContent.text=d.structuredContent.text.replace(edit.old_str,()=>edit.new_str);
   d.structuredContent.page_last_edited_at='2026-10-28T00:00:01Z';pages.set(q.page_id,d);
   return {structuredContent:{page_id:q.page_id}};
  }
 };
 const client=factory('normal_rpc_client.js',{Date:ClockDate})(tools,{command:'synthetic-only'});
 const refs=[ids[0],ids[1],router,wip];
 const runner=factory('normal_live_runner.js')(tools,{client,centralTaskId:central,runId:run,references:refs.map(pageId=>({pageId})),
  nativeExpectations:[],binding:{repository:'nodekit',source:{pr:149}},
  createWitness:(_,c)=>async()=>{
   const observedAt=new Date().toISOString();return {observedAt,referenceToken:c.referenceToken,
    nativeChecks:refs.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-28T00:00:00Z'})),
    central:{id:central,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};
  }});
 return {b,root,client,runner,get writes(){return writes;},get closed(){return closed;},get tails(){return tails;}};
}
test('actual runner and bridge renew only an expired pre-call permit, keep the ticket and make one native call',async t=>{
 const f=liveFixture(t,'delayed-permit'),r=await f.runner.run(batchId,[edits[0]]),b=f.b.state.batches[batchId];
 assert.equal(r.status,'COMPLETED');assert.equal(f.writes,1);assert.equal(f.closed,1);assert.ok(f.tails>0);
 assert.equal(b.dispatch.attempts.length,2);assert.equal(b.dispatch.attempts[0].ticket,b.dispatch.attempts[1].ticket);
 assert.ok(b.dispatch.attempts[0].revokedBeforeCall);assert.equal(b.dispatch.attempts[0].provider,undefined);
 assert.equal(b.reconciliations[0].notionWrites,0);assert.equal(b.reconciliations[0].pageAdvances,0);
});
test('a native failure using the pre-call error text has no private token and cannot be resent',async t=>{
 const f=liveFixture(t,'native-result-lost');await assert.rejects(f.runner.run(batchId,[edits[0]]));
 const b=f.b.state.batches[batchId];assert.equal(f.writes,1);assert.equal(b.status,'HALTED');
 assert.equal(b.dispatch.attempts.length,1);assert.equal(b.reconciliations,undefined);
});
test('persistent latency exhausts a bounded permit-renewal budget with zero native calls',async t=>{
 const f=liveFixture(t,'always-expired');await assert.rejects(f.runner.run(batchId,[edits[0]]),/NORMAL_PRE_CALL_PERMIT_EXPIRED/);
 const b=f.b.state.batches[batchId];assert.equal(f.writes,0);assert.equal(b.status,'HALTED');
 assert.equal(b.dispatch.attempts.length,3);assert.equal(b.reconciliations.length,2);
});
test('forged or reused client errors cannot obtain a no-call continuation',async t=>{
 const f=liveFixture(t,'native-result-lost');let calls=0;
 await assert.rejects(f.client.recoverPreCall(Error('NORMAL_PRE_CALL_PERMIT_EXPIRED'),()=>{calls++;},page(ids[0])));
 assert.equal(calls,0);
 await assert.rejects(f.client.broker({action:'normal_pre_call_expired'}),/PRIVATE_ACTION/);
});

function exactFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'npg-exact-expiry-')),runtime=path.join(root,'runtime');
 fs.mkdirSync(runtime);const policy={productionEnabled:true,productionPages:ids,canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
 let b=new core.Broker(root,policy);const start=b.handle({action:'fence_begin',batchId,edits,ownerProof:proof()});
 const live={batchId,executor:start.executor,planHash:start.planHash};
 const call=(action,args={})=>b.handle({...live,action,ownerProof:proof(),...args});
 const prior=[];
 for(let i=0;i<4;i++){
  const p=call('fence_prepare',{page:page(ids[i])});live.ticket=p.ticket;
  call('fence_authorize',{page:page(ids[i])});const d=call('fence_dispatch',{page:page(ids[i])});live.dispatchId=d.dispatchId;
  call('fence_confirm_send');
  if(i<3){call('fence_ack',{provider:{status:'SUCCEEDED',pageId:ids[i],taskId:null}});
   const after=page(ids[i],'NEW','2026-10-28T00:00:01Z');call('fence_verify',{page:after});prior.push(after);}
 }
 call('fence_halt',{reason:'SEND_PERMIT_EXPIRED_OR_FENCED'});
 // Synthetic legacy first attempt, retained before the three real verified
 // pages and final exported permit. Production pins cannot be caller-selected.
 const x=b.state.batches[batchId],a=x.dispatch.attempts.at(-1);
 x.dispatch.attempts.unshift({index:0,ticket:'historical',dispatchId:'old-no-permit',phase:'SEND_INTENT',revokedUnpermitted:{reason:'historical'}});
 b.save();const raw=fs.readFileSync(b.file,'utf8'),pins=require('./reconcile_permit_expiry.cjs').incident;
 const actual={...pins,journalHash:sha(raw),planHash:x.planHash,ticket:x.receipt.ticket,snapshotHash:x.receipt.snapshotHash,
  dispatchId:a.dispatchId,executor:b.executor,driverHash:sha('legacy-driver')};
 const driverDir=path.join(runtime,'extensions',actual.driverSource);fs.mkdirSync(driverDir,{recursive:true});
 fs.writeFileSync(path.join(driverDir,'normal_live_runner.js'),'legacy-driver',{mode:0o600});
 const audit=path.join(root,'manual-audits/automatic-followthrough-20261028-04386a5');fs.mkdirSync(audit,{recursive:true});
 const diagnostic={recovery:{batchId,exactPlanHash:x.planHash,next:3,verifiedBodyTargets:3,
  failure:{providerMutationInvoked:false,code:'SEND_PERMIT_EXPIRED_OR_FENCED'},canonicalJournal:{sha256:actual.journalHash}}};
 const trace={canonical:{sha256:actual.journalHash,dispatchId:a.dispatchId,receipt:{ticket:a.ticket},provider:null,permit:a.sendPermit},
  noNativeCalledEvidence:{conclusion:'INDEX3_NOTION_NATIVE_CALL_NOT_INVOKED'},priorVerified:x.verifications};
 const dr=JSON.stringify(diagnostic),tr=JSON.stringify(trace);actual.diagnosticHash=sha(dr);actual.traceHash=sha(tr);
 fs.writeFileSync(path.join(audit,'v2-partial-failure-20261028.json'),dr,{mode:0o600});
 fs.writeFileSync(path.join(audit,'permit-expiry-failed-call-trace-20261028.json'),tr,{mode:0o600});
 let source=fs.readFileSync(path.join(__dirname,'reconcile_permit_expiry.cjs'),'utf8');
 for(const k of Object.keys(actual))if(typeof actual[k]==='string'&&actual[k]!==pins[k])source=source.replaceAll(pins[k],actual[k]);
 const m={exports:{}};new Function('require','module','exports',source)(require,m,m.exports);
 b.close();b=new core.Broker(root,policy);t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 class ExpiredDate extends Date{static now(){return Date.now()+16000;}}
 const restoreUnsent=compiled('normal_unsent.cjs',{Date:ExpiredDate}).createUnsent(core);
 const reconcile=m.exports.createReconciler({...core,runtime,restoreUnsent});
 return {b,root,runtime,raw,reconcile,input:{batchId,apply:false,page:page(ids[3]),pages:prior,ownerProof:proof()}};
}
test('exact legacy expiry recovery verifies prior three pages, preserves all attempts and returns only PREPARED',t=>{
 const f=exactFixture(t),before=fs.readFileSync(f.b.file,'utf8');
 assert.equal(f.reconcile(f.b,f.input).eligible,true);assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
 const r=f.reconcile(f.b,{...f.input,apply:true}),old=JSON.parse(before).batches[batchId],now=f.b.state.batches[batchId];
 assert.equal(r.status,'PREPARED');assert.equal(r.next,3);assert.equal(r.notionWrites,0);assert.equal(r.pageAdvances,0);
 assert.deepEqual(now.receipt,old.receipt);assert.deepEqual(now.verifications,old.verifications);
 assert.equal(now.dispatch.attempts.length,old.dispatch.attempts.length);assert.ok(now.dispatch.attempts.at(-1).revokedBeforeCall);
 assert.equal(now.error,old.error);assert.throws(()=>f.reconcile(f.b,{...f.input,apply:true}));
});
test('the explicit legacy revocation does not consume either live permit renewal',t=>{
 const f=exactFixture(t),r=f.reconcile(f.b,{...f.input,apply:true});
 class ExpiredDate extends Date{static now(){return Date.now()+16000;}}
 const restore=compiled('normal_unsent.cjs',{Date:ExpiredDate}).createUnsent(core);
 const live={batchId,executor:r.executor,planHash:r.planHash,ticket:r.ticket};
 for(let index=0;index<3;index++){
  const ownerProof=proof(),call=(action,extra={})=>f.b.handle({...live,action,ownerProof,...extra});
  call('fence_authorize',{page:page(ids[3])});const d=call('fence_dispatch',{page:page(ids[3])});live.dispatchId=d.dispatchId;
  const permit=call('fence_confirm_send').permit;
  const input={...live,page:page(ids[3]),permit,ownerProof};
  if(index<2)assert.equal(restore(f.b,input).status,'PREPARED');
  else assert.throws(()=>restore(f.b,input),/NORMAL_PRE_CALL_EXPIRY_BUDGET/);
 }
 assert.equal(f.b.state.batches[batchId].dispatch.attempts.filter(a=>a.revokedBeforeCall).length,3);
});
test('actual HALTED runner enters exact recovery through the bridge and finishes only the remaining three pages',async t=>{
 const f=exactFixture(t),pages=new Map(ids.map((id,i)=>[id,i<3?f.input.pages[i]:page(id)]));
 const prior=JSON.parse(f.raw).batches[batchId].verifications;
 const bridge=createBridge({broker:f.b,installation:{root:f.root},reconcilePermitExpiry:f.reconcile,
  restoreUnsent:compiled('normal_unsent.cjs').createUnsent(core),verifyExtensions(){},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:f.b.executor,journalHash:sha(fs.readFileSync(f.b.file))};}});
 let writes=0;
 const tools={
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(){
   return {content:[{type:'text',text:'Process started with PID 456\nNPG/2 {"ready":true}\n'}]};},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process({input}){
   const q=JSON.parse(input);let r;
   try{r={requestId:q.requestId,ok:true,result:bridge.handle(q)};}
   catch(e){r={requestId:q.requestId,ok:false,code:e.code??'ERROR',error:e.message};}
   return {content:[{type:'text',text:'NPG/2 '+JSON.stringify(r)+'\n'}]};},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(){throw Error('unexpected retained read');},
  async mcp__codex_apps__notion_fetch({id}){return pages.get(id);},
  async mcp__codex_apps__notion_notion_update_page(q){
   writes++;assert.ok(ids.indexOf(q.page_id)>=3,'verified earlier pages must not be written again');
   pages.set(q.page_id,page(q.page_id,'NEW','2026-10-28T00:00:01Z'));
   return {structuredContent:{page_id:q.page_id}};
  }
 };
 const client=factory('normal_rpc_client.js')(tools,{command:'synthetic-only'}),refs=[ids[0],ids[1],router,wip];
 const runner=factory('normal_live_runner.js')(tools,{client,centralTaskId:central,runId:run,
  references:refs.map(pageId=>({pageId})),nativeExpectations:[],binding:{repository:'nodekit',source:{pr:149}},
  recovery:{apply:true,kind:'PRE_CALL_EXPIRED'},createWitness:(_,c)=>async()=>{
   const observedAt=new Date().toISOString();return {observedAt,referenceToken:c.referenceToken,
    nativeChecks:refs.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-28T00:00:00Z'})),
    central:{id:central,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};
  }});
 const r=await runner.run(batchId,edits),now=f.b.state.batches[batchId];
 assert.equal(r.status,'COMPLETED');assert.equal(writes,3);assert.equal(now.next,6);assert.equal(f.b.state.active,null);
 assert.deepEqual(now.verifications.slice(0,3),prior);assert.equal(now.verifications.length,6);
});
for(const [name,change] of [
 ['prior protected body',f=>f.input.pages[1]=page(ids[1],'CHANGED')],
 ['pending body',f=>f.input.page=page(ids[3],'NEW','2026-10-28T00:00:02Z')],
 ['pending revision',f=>f.input.page=page(ids[3],'OLD','2026-10-28T00:00:02Z')],
 ['missing prior page',f=>f.input.pages.pop()],
 ['other batch',f=>f.input.batchId='NODEKIT150-LANDED-20261028'],
 ['changed driver',f=>fs.appendFileSync(path.join(f.runtime,'extensions',require('./reconcile_permit_expiry.cjs').incident.driverSource,'normal_live_runner.js'),'x')],
 ['changed canonical',f=>fs.appendFileSync(f.b.file,' ')],
 ['changed durable receipt',f=>fs.appendFileSync(f.b.snapshot(batchId,1)+'.verified.json',' ')],
 ['absent ownership',f=>f.input.ownerProof=null]
])test('exact legacy expiry recovery refuses '+name+' without journal writes',t=>{
 const f=exactFixture(t);change(f);const before=fs.readFileSync(f.b.file,'utf8');
 assert.throws(()=>f.reconcile(f.b,{...f.input,apply:true}));assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});

function preparedFixture(t,{prefix=0,revoked=false,halted=false,sameExecutor=false,unprepared=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'npg-prepared-resume-')),
  policy={productionEnabled:true,productionPages:ids,canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
 let b=new core.Broker(root,policy);const pages=new Map(ids.map(id=>[id,page(id)])),start=b.handle({action:'fence_begin',batchId,edits,ownerProof:proof()});
 const live={batchId,executor:start.executor,planHash:start.planHash},call=(action,extra={})=>b.handle({...live,action,ownerProof:proof(),...extra});
 for(let i=0;i<prefix;i++){
  live.ticket=call('fence_prepare',{page:pages.get(ids[i])}).ticket;
  call('fence_authorize',{page:pages.get(ids[i])});live.dispatchId=call('fence_dispatch',{page:pages.get(ids[i])}).dispatchId;
  call('fence_confirm_send');call('fence_ack',{provider:{status:'SUCCEEDED',pageId:ids[i],taskId:null}});
  pages.set(ids[i],page(ids[i],'NEW','2026-10-28T00:00:01Z'));call('fence_verify',{page:pages.get(ids[i])});
 }
 if(!unprepared)live.ticket=call('fence_prepare',{page:pages.get(ids[prefix])}).ticket;
 class ExpiredDate extends Date{static now(){return Date.now()+16000;}}
 const unsent=compiled('normal_unsent.cjs',{Date:ExpiredDate});
 if(revoked){call('fence_authorize',{page:pages.get(ids[prefix])});
  live.dispatchId=call('fence_dispatch',{page:pages.get(ids[prefix])}).dispatchId;
  const permit=call('fence_confirm_send').permit;
  unsent.createUnsent(core)(b,{...live,permit,page:pages.get(ids[prefix]),ownerProof:proof()});
 }
 if(halted)call('fence_halt',{reason:'NORMAL_RPC_TRANSPORT_UNKNOWN'});
 const original=fs.readFileSync(b.file,'utf8'),oldExecutor=b.executor;
 if(!sameExecutor){b.close();b=new core.Broker(root,policy);}
 t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 return {b,root,pages,original,oldExecutor,resume:unprepared?unsent.createUnpreparedResumer(core):unsent.createPreparedResumer(core),
  input:{batchId,planHash:start.planHash,apply:false,page:pages.get(ids[prefix]),
   pages:ids.slice(0,prefix).map(id=>pages.get(id)),ownerProof:proof()}};
}
for(const options of [{},{revoked:true},{prefix:2},{prefix:2,revoked:true},{halted:true,revoked:true}])
test('closed PREPARED executor continuation preserves its exact ticket, receipts and history '+JSON.stringify(options),t=>{
 const f=preparedFixture(t,options),before=fs.readFileSync(f.b.file,'utf8'),old=JSON.parse(before).batches[batchId];
 assert.equal(f.resume(f.b,f.input).eligible,true);assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
 const r=f.resume(f.b,{...f.input,apply:true}),now=f.b.state.batches[batchId];
 assert.equal(r.status,'PREPARED');assert.equal(r.next,options.prefix??0);assert.notEqual(r.executor,f.oldExecutor);
 for(const key of ['receipt','verifications','error','haltedFrom','edits','next'])assert.deepEqual(now[key],old[key]);
 assert.deepEqual(now.dispatch.attempts,old.dispatch.attempts);assert.deepEqual(now.dispatch.provider,old.dispatch.provider);
 assert.equal(r.notionWrites,0);assert.equal(r.pageAdvances,0);assert.equal(r.ticketsCreated,0);
 assert.equal(now.reconciliations.at(-1).kind,'PREPARED_NO_SEND_CONTINUATION');
 assert.throws(()=>f.resume(f.b,{...f.input,apply:true}),/PREPARED_RESUME_BOUNDARY/);
});
for(const [name,change] of [
 ['same live executor',()=>{}],
 ['different plan',f=>f.input.planHash='0'.repeat(64)],
 ['different owner',f=>f.input.ownerProof.ownerId='other'],
 ['different scope',f=>f.input.ownerProof.scope='other'],
 ['expired source',f=>f.input.ownerProof.validUntil='2020-01-01T00:00:00Z'],
 ['pending full body',f=>f.input.page=page(ids[2],'CHANGED')],
 ['pending properties',f=>f.input.page=JSON.parse(JSON.stringify(f.input.page).replace('source','changed'))],
 ['pending revision',f=>f.input.page=page(ids[2],'OLD','2026-10-28T00:00:02Z')],
 ['prior protected body',f=>f.input.pages[0]=page(ids[0],'CHANGED')],
 ['prior properties',f=>f.input.pages[0]=JSON.parse(JSON.stringify(f.input.pages[0]).replace('source','changed'))],
 ['prior stale revision',f=>f.input.pages[0]=page(ids[0],'NEW','2026-10-27T00:00:00Z')],
 ['missing prior page',f=>f.input.pages.pop()],
 ['unrevoked send',f=>{delete f.b.state.batches[batchId].dispatch.attempts.at(-1).revokedBeforeCall;f.b.save();}],
 ['current pending provider',f=>{f.b.state.batches[batchId].dispatch.provider={status:'PENDING',taskId:'unknown'};f.b.save();}],
 ['changed revocation audit',f=>{const file=f.b.state.batches[batchId].dispatch.attempts.at(-1).revokedBeforeCall.record;
  const r=JSON.parse(fs.readFileSync(file));r.audit.notionWrites=1;fs.writeFileSync(file,JSON.stringify(r));}],
 ['missing revocation audit',f=>fs.unlinkSync(f.b.state.batches[batchId].dispatch.attempts.at(-1).revokedBeforeCall.record)],
 ['changed snapshot bytes',f=>fs.appendFileSync(f.b.state.batches[batchId].receipt.snapshot,' ')],
 ['public snapshot',f=>fs.chmodSync(f.b.state.batches[batchId].receipt.snapshot,0o644)],
 ['changed prior receipt',f=>fs.appendFileSync(f.b.snapshot(batchId,0)+'.verified.json',' ')],
 ['authorized boundary',f=>{const x=f.b.state.batches[batchId];x.dispatch.phase='AUTHORIZED';x.status='WRITE_PENDING';f.b.save();}],
 ['halt after send boundary',f=>{const x=f.b.state.batches[batchId];x.status='HALTED';x.haltedFrom='WRITE_PENDING';f.b.save();}],
 ['lost protocol lock',f=>f.b.close()]
])test('PREPARED continuation refuses '+name+' without canonical changes',t=>{
 const f=preparedFixture(t,{prefix:2,revoked:true,sameExecutor:name==='same live executor'});change(f);
 const before=fs.readFileSync(f.b.file,'utf8');assert.throws(()=>f.resume(f.b,{...f.input,apply:true}));
 assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});

function preparedRunner(f,options={}){
 const bridge=createBridge({broker:f.b,installation:{root:f.root},resumePrepared:f.resume,
  resumeUnprepared:options.unprepared?f.resume:undefined,
  restoreUnsent:compiled('normal_unsent.cjs').createUnsent(core),verifyExtensions(){},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:f.b.executor,journalHash:sha(fs.readFileSync(f.b.file))};}});
 let writes=0,begins=0,pending='',savedStage=null,expired=false,witnessReads=0,proofRejects=0;const refs=[ids[0],ids[1],router,wip];
 const tools={
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(){
   return {content:[{type:'text',text:'Process started with PID 789\nNPG/2 {"ready":true}\n'}]};},
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process(q){
   const input=JSON.parse(q.input);if(input.operation?.action==='fence_begin')begins++;
   if(input.action===options.expireAction&&(!expired||options.alwaysExpired)){
    input.liveSource.observedAt='2020-01-01T00:00:00Z';expired=true;proofRejects++;
   }
   let result;try{result=bridge.handle(input);if(input.action==='case_stage_input')savedStage={...result};
    if(options.failStage&&input.operation?.action==='fence_authorize')throw Error('injected lost stage reply');}
   catch(e){if(e.message==='injected lost stage reply')throw e;
    return {content:[{type:'text',text:'NPG/2 '+JSON.stringify({requestId:input.requestId,ok:false,code:e.code,
      error:e.message,retryBeforeAction:e.retryBeforeAction})+'\n'}]};}
   pending='NPG/2 '+JSON.stringify({requestId:input.requestId,ok:true,result})+'\n';
   if(q.wait_for_prompt){assert.equal(q.timeout_ms,3000);return {content:[{type:'text',text:pending}]};}
   return {content:[{type:'text',text:'Process running; no incremental output'}]};
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(q){
   assert.equal(q.offset,-2);assert.equal(q.length,2);return {content:[{type:'text',text:pending+'\n'}]};},
  async mcp__codex_apps__notion_fetch({id}){return f.pages.get(id);},
  async mcp__codex_apps__notion_notion_update_page(q){
   writes++;if(options.nativeError)throw Error('NORMAL_SOURCE_EXPIRED_NO_ACTION: NORMAL_LIVE_EXPIRED');
   assert.ok(ids.indexOf(q.page_id)>=f.input.pages.length);
   f.pages.set(q.page_id,page(q.page_id,'NEW','2026-10-28T00:00:01Z'));return {structuredContent:{page_id:q.page_id}};
  }
 };
 const client=factory('normal_rpc_client.js')(tools,{command:'synthetic-only'}),runner=factory('normal_live_runner.js')(tools,
  {client,centralTaskId:central,runId:run,references:refs.map(pageId=>({pageId})),nativeExpectations:[],
   binding:{repository:'nodekit',source:{pr:149}},recovery:options.recovery,createWitness:(_,c)=>async()=>{
    witnessReads++;if(options.witnessExpired&&(witnessReads===1||options.alwaysWitnessExpired))throw Error('NORMAL_LIVE_EXPIRED');
    const observedAt=new Date().toISOString();return {observedAt,referenceToken:c.referenceToken,
     nativeChecks:refs.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-28T00:00:00Z'})),
     central:{id:central,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};}});
 return {runner,bridge,client,get writes(){return writes;},get begins(){return begins;},get savedStage(){return savedStage;},
  get witnessReads(){return witnessReads;},get proofRejects(){return proofRejects;}};
}
for(const options of [{},{prefix:2,revoked:true},{prefix:2,halted:true,revoked:true}])
test('real runner resumes closed PREPARED transaction without beginning it again '+JSON.stringify(options),async t=>{
 const f=preparedFixture(t,options),r=preparedRunner(f,options.halted?{recovery:{apply:true,kind:'PREPARED_NO_SEND'}}:{});
 const before=JSON.parse(f.original).batches[batchId],out=await r.runner.run(batchId,edits),now=f.b.state.batches[batchId];
 assert.equal(out.status,'COMPLETED');assert.equal(r.writes,6-(options.prefix??0));assert.equal(r.begins,0);
 assert.equal(now.next,6);assert.equal(now.verifications.length,6);assert.equal(f.b.state.active,null);
 assert.deepEqual(now.verifications.slice(0,options.prefix??0),before.verifications??[]);
 assert.equal(now.dispatch.attempts.find(a=>a.index===(options.prefix??0)&&!a.revokedBeforeCall).ticket,before.receipt.ticket);
});
test('HALTED PREPARED continuation requires explicit applied kind',async t=>{
 const f=preparedFixture(t,{halted:true,revoked:true}),r=preparedRunner(f,{recovery:{kind:'PREPARED_NO_SEND'}});
 await assert.rejects(r.runner.run(batchId,edits),/EXPLICIT_UNPERMITTED_RECOVERY_REQUIRED/);assert.equal(r.writes,0);
});
test('a lost staged authorize reply can halt without consuming the stage or making a native call',async t=>{
 const f=preparedFixture(t,{revoked:true}),r=preparedRunner(f,{failStage:true});
 await assert.rejects(r.runner.run(batchId,edits),/injected lost stage reply/);
 const x=f.b.state.batches[batchId];assert.equal(x.status,'HALTED');assert.equal(x.haltedFrom,'PREPARED');
 assert.equal(x.dispatch.phase,'PREPARED');assert.equal(r.writes,0);
 const discarded=JSON.parse(x.readDetail).unconsumedStageDiscarded;
 assert.equal(discarded.action,'fence_authorize');assert.equal(discarded.stageId,r.savedStage.stageId);
 assert.equal(discarded.inputHash,r.savedStage.inputHash);assert.equal(x.receipt.ticket,JSON.parse(f.original).batches[batchId].receipt.ticket);
});

for(const options of [{unprepared:true},{unprepared:true,prefix:1},{unprepared:true,prefix:2,halted:true}])
test('real runner continues an audited UNSENT closed executor without replaying earlier native writes '+JSON.stringify(options),async t=>{
 const f=preparedFixture(t,options),before=JSON.parse(f.original).batches[batchId];
 assert.equal(f.resume(f.b,f.input).eligible,true);assert.equal(fs.readFileSync(f.b.file,'utf8'),f.original);
 const r=preparedRunner(f,{unprepared:true,...(options.halted?{recovery:{apply:true,kind:'UNPREPARED_NO_SEND'}}:{})});
 const out=await r.runner.run(batchId,edits),now=f.b.state.batches[batchId];
 assert.equal(out.status,'COMPLETED');assert.equal(r.writes,6-(options.prefix??0));assert.equal(r.begins,0);
 assert.deepEqual(now.verifications.slice(0,options.prefix??0),before.verifications??[]);
 const audit=now.reconciliations.at(-1);assert.equal(audit.kind,'UNPREPARED_NO_SEND_CONTINUATION');
 assert.equal(audit.ticketsCreated,0);assert.equal(audit.pageAdvances,0);assert.equal(audit.notionWrites,0);
 assert.equal(now.error,before.error);assert.equal(now.haltedFrom,before.haltedFrom);
});
for(const [name,change] of [
 ['a current send attempt',f=>{const x=f.b.state.batches[batchId];x.dispatch.attempts.push({index:x.next,phase:'SEND_INTENT'});f.b.save();}],
 ['a receipt',f=>{f.b.state.batches[batchId].receipt={ticket:'unknown'};f.b.save();}],
 ['a pending provider',f=>{f.b.state.batches[batchId].dispatch.provider.status='PENDING';f.b.save();}],
 ['a changed prior page',f=>f.input.pages[0]=page(ids[0],'CHANGED')],
 ['an inconsistent plan',f=>f.input.planHash='0'.repeat(64)],
 ['a future pending snapshot',f=>fs.writeFileSync(f.b.snapshot(batchId,4),'{}',{mode:0o600})],
 ['an unexpected earlier sidecar',f=>fs.writeFileSync(f.b.snapshot(batchId,0)+'.actual.json','{}',{mode:0o600})],
 ['a current unsent snapshot',f=>fs.writeFileSync(f.b.snapshot(batchId,2),'{}',{mode:0o600})]
])test('UNSENT continuation refuses '+name+' without canonical mutation',t=>{
 const f=preparedFixture(t,{unprepared:true,prefix:2,halted:true});change(f);
 const before=fs.readFileSync(f.b.file,'utf8');assert.throws(()=>f.resume(f.b,{...f.input,apply:true}));
 assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});
test('a prepared continuation refuses unexpected future evidence',t=>{
 const f=preparedFixture(t,{prefix:2,revoked:true});fs.writeFileSync(f.b.snapshot(batchId,4),'{}',{mode:0o600});
 assert.throws(()=>f.resume(f.b,{...f.input,apply:true}),/NO_SEND_UNEXPECTED_EVIDENCE/);
 assert.equal(fs.readFileSync(f.b.file,'utf8'),f.original);
});
for(const action of ['case_consume_live','case_live_send'])test('attributed stale proof before '+action+' re-reads actual sources once without native replay',async t=>{
 const f=preparedFixture(t,{prefix:2}),r=preparedRunner(f,{expireAction:action});
 assert.equal((await r.runner.run(batchId,edits)).status,'COMPLETED');assert.equal(r.proofRejects,1);
 assert.equal(r.writes,4);assert.equal(f.b.state.batches[batchId].dispatch.attempts.length,6);
 assert.ok(r.witnessReads>0);assert.equal(r.client.consumeSourceExpiry(Error('NORMAL_SOURCE_EXPIRED_NO_ACTION')),false);
});
test('persistent pre-action proof expiry is bounded and writes no native page',async t=>{
 const f=preparedFixture(t,{prefix:2}),r=preparedRunner(f,{expireAction:'case_consume_live',alwaysExpired:true});
 await assert.rejects(r.runner.run(batchId,edits),/NORMAL_LIVE_EXPIRED/);assert.equal(r.proofRejects,3);assert.equal(r.writes,0);
 assert.equal(fs.readFileSync(f.b.file,'utf8'),f.original);
});
test('a slow source read gets new reads rather than a renewed timestamp',async t=>{
 const f=preparedFixture(t,{prefix:2}),r=preparedRunner(f,{witnessExpired:true});
 assert.equal((await r.runner.run(batchId,edits)).status,'COMPLETED');assert.equal(r.writes,4);assert.ok(r.witnessReads>2);
});
test('a native exception using source-expiry text never retries the native invocation',async t=>{
 const f=preparedFixture(t,{prefix:2}),r=preparedRunner(f,{nativeError:true});
 await assert.rejects(r.runner.run(batchId,edits),/NORMAL_SOURCE_EXPIRED_NO_ACTION/);assert.equal(r.writes,1);
 assert.equal(f.b.state.batches[batchId].status,'HALTED');
});
