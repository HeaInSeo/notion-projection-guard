'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('./broker.cjs'),{createBridge}=require('./normal_bridge.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const factory=(n,sandbox={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,n),'utf8'),sandbox);
const A='a'.repeat(32),router='3bf86e6dd1d18110938bc358e17c779e',policyId='3b286e6dd1d18194866dd8d7a28c7ab4';
const batchId='NODEKIT149-LANDED-20261028',central='1'.repeat(32),run='test-actual-run';
const edit={pageId:A,heading:'## CURRENT CENTRAL OBSERVATION · test',oldStr:'state=BEFORE',newStr:'state=AFTER'};
const policy={productionEnabled:true,productionPages:[A],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
const page=(value='BEFORE',revision='2026-10-28T00:00:00Z')=>({structuredContent:{id:A,page_last_edited_at:revision,
 text:'<properties>\n{"title":"source"}\n</properties>\n<content>\n'+edit.heading+'\nstate='+value+'\n## HISTORY\npreserve\n</content>'}});
const proof=()=>({ownerId:'automation:'+central,generation:run,scope:batchId,prerequisites:true,conflicts:[],
 evidenceHash:'e'.repeat(64),observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+15000).toISOString()});
function bridgeFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'normal-live-')),b=new core.Broker(root,policy);
 t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 let controls=true;const bridge=createBridge({broker:b,installation:{root},verifyExtensions(){if(!controls)throw Error('changed-extension');},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:b.executor,journalHash:'f'.repeat(64)};}});
 const referenceIds=[A,'b'.repeat(32),router,policyId];
 const init=bridge.handle({action:'normal_init',batchId,edits:[edit],centralTaskId:central,runId:run,referenceIds,repository:'nodekit',pr:149});
 const witness=()=>{const observedAt=new Date().toISOString();return {observedAt,referenceToken:init.referenceToken,
  nativeChecks:referenceIds.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-28T00:00:00Z'})),
  central:{id:central,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};};
 const stage=operation=>bridge.handle({action:'case_stage_input',batchId,operation});
 const consume=(s,w=witness())=>bridge.handle({action:'case_consume_live',batchId,...s,liveSource:w});
 return {root,b,bridge,init,witness,stage,consume,set controls(v){controls=v;}};
}
for(const [name,change] of [
 ['stale',w=>w.observedAt=new Date(Date.now()-31000).toISOString()],
 ['future',w=>w.observedAt=new Date(Date.now()+10000).toISOString()],
 ['other-run',w=>w.central.run.id='other'],
 ['disabled',w=>w.central.is_enabled=false],
 ['completed',w=>w.central.run.recorded_status='completed'],
 ['other-reference',w=>w.referenceToken='other'],
 ['missing-source',w=>w.nativeChecks.pop()],
 ['unmatched-source',w=>w.nativeChecks[0].matched=false]
])test('local grant refuses '+name+' without canonical mutation',t=>{
 const f=bridgeFixture(t),s=f.stage({action:'fence_begin',batchId,edits:[edit]}),w=f.witness();change(w);
 assert.throws(()=>f.consume(s,w));assert.equal(fs.existsSync(f.b.file),false);
 assert.throws(()=>f.consume(s),/NORMAL_STAGE_IDENTITY/);
});
test('large staged input grants nothing and changed extension blocks consumption',t=>{
 const f=bridgeFixture(t),s=f.stage({action:'fence_begin',batchId,edits:[edit]});
 assert.equal(fs.existsSync(f.b.file),false);f.controls=false;assert.throws(()=>f.consume(s),/changed-extension/);
 assert.equal(fs.existsSync(f.b.file),false);
});
test('staging cannot replace an outstanding operation or smuggle a caller proof',t=>{
 const f=bridgeFixture(t);
 assert.throws(()=>f.stage({action:'fence_begin',batchId,edits:[edit],ownerProof:proof()}));
 const s=f.stage({action:'fence_begin',batchId,edits:[edit]});
 assert.throws(()=>f.stage({action:'fence_begin',batchId,edits:[edit]}));f.consume(s);
 assert.equal(f.b.state.batches[batchId].status,'READY');
});
test('local confirmation cannot be replayed or used as another action',t=>{
 const f=bridgeFixture(t),start=f.consume(f.stage({action:'fence_begin',batchId,edits:[edit]}));
 const live={batchId,executor:start.executor,planHash:start.planHash};
 const p=f.consume(f.stage({...live,action:'fence_prepare',page:page()}));live.ticket=p.ticket;
 f.consume(f.stage({...live,action:'fence_authorize',page:page()}));
 const d=f.consume(f.stage({...live,action:'fence_dispatch',page:page()}));live.dispatchId=d.dispatchId;
 const q={action:'case_live_send',batchId,operation:{...live,action:'fence_confirm_send'},liveSource:f.witness()};
 const permit=f.bridge.handle(q).permit;assert.ok(Date.parse(permit.validUntil)-Date.now()<=15000);
 assert.throws(()=>f.bridge.handle(q));
 assert.throws(()=>f.bridge.handle({...q,operation:{...live,action:'fence_ack'}}));
});

function recoveryFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'normal-unpermitted-')),runtime=path.join(root,'runtime');fs.mkdirSync(runtime);
 let b=new core.Broker(root,policy);const begun=b.handle({action:'fence_begin',batchId,edits:[edit],ownerProof:proof()});
 const live={batchId,executor:begun.executor,planHash:begun.planHash};
 const call=(action,args={})=>b.handle({...live,action,ownerProof:proof(),...args});
 const p=call('fence_prepare',{page:page()});live.ticket=p.ticket;call('fence_authorize',{page:page()});
 const dispatch=call('fence_dispatch',{page:page()});live.dispatchId=dispatch.dispatchId;
 const error='OWNERSHIP_FENCE: Fresh same-generation scoped ownership and all prerequisites required';
 call('fence_halt',{reason:error});const original=fs.readFileSync(b.file,'utf8'),state=JSON.parse(original);
 const pins={...require('./reconcile_unpermitted_dispatch.cjs').incident};
 const actual={...pins,journalHash:sha(original),planHash:begun.planHash,ticket:p.ticket,snapshotHash:state.batches[batchId].receipt.snapshotHash,
  dispatchId:dispatch.dispatchId,executor:begun.executor};
 const driver=fs.readFileSync(path.join(__dirname,'runner.js'));actual.runnerHash=sha(driver);fs.writeFileSync(path.join(runtime,'runner.js'),driver,{mode:0o600});
 const auditDir=path.join(root,'manual-audits/automatic-followthrough-20261028-04386a5');fs.mkdirSync(auditDir,{recursive:true});
 const diagnostic={nodekitBodyProjection:{batchId,planHash:actual.planHash,status:'HALTED',next:0,phase:'SEND_INTENT',
  ticket:p.ticket,dispatchId:dispatch.dispatchId,error,provider:null,sendPermit:null,notionBodyWritesObserved:0,journalSha256:actual.journalHash},
  diagnosis:{providerCallReached:false,kind:'PREREQUISITE_FRESHNESS_EXPIRED_BEFORE_SEND_PERMIT'}};
 const diagnosticPath=path.join(auditDir,'run-3e9c232d-halted-result.json'),diagnosticRaw=JSON.stringify(diagnostic);
 fs.writeFileSync(diagnosticPath,diagnosticRaw,{mode:0o600});actual.diagnosticHash=sha(diagnosticRaw);
 // Compile an explicitly synthetic pinned incident. Production exports no
 // caller-selectable identity/pin override and remains bound to its one case.
 let source=fs.readFileSync(path.join(__dirname,'reconcile_unpermitted_dispatch.cjs'),'utf8');
 for(const k of Object.keys(actual))if(actual[k]!==pins[k])source=source.replaceAll(pins[k],actual[k]);
 const m={exports:{}};new Function('require','module','exports',source)(require,m,m.exports);
 b.close();b=new core.Broker(root,policy);
 t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 const reconcile=m.exports.createReconciler({...core,runtime});
 return {b,root,runtime,original,state,diagnosticPath,input:{batchId,apply:false,page:page(),ownerProof:proof()},reconcile};
}
test('exact denied confirmation check is read-only; apply preserves old intent and restores the same ticket without a native call',t=>{
 const f=recoveryFixture(t),before=fs.readFileSync(f.b.file,'utf8');
 assert.equal(f.reconcile(f.b,f.input).eligible,true);assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
 const r=f.reconcile(f.b,{...f.input,apply:true}),old=f.state.batches[batchId],now=f.b.state.batches[batchId];
 assert.equal(r.notionWrites,0);assert.equal(r.pageAdvances,0);assert.equal(r.ticketsCreated,0);
 assert.equal(now.status,'PREPARED');assert.equal(now.next,0);assert.deepEqual(now.receipt,old.receipt);
 assert.equal(now.error,old.error);assert.equal(now.haltedFrom,old.haltedFrom);
 assert.equal(now.dispatch.attempts[0].dispatchId,old.dispatch.attempts[0].dispatchId);
 assert.ok(now.dispatch.attempts[0].revokedUnpermitted);assert.equal(now.dispatch.attempts[0].sendPermit,undefined);
 assert.throws(()=>f.reconcile(f.b,{...f.input,apply:true}));
 const ctx={batchId,executor:r.executor,planHash:r.planHash,ticket:r.ticket,ownerProof:proof()};
 f.b.handle({...ctx,action:'fence_authorize',page:page()});
 const d=f.b.handle({...ctx,action:'fence_dispatch',page:page()});
 assert.equal(f.b.state.batches[batchId].dispatch.attempts.length,2);
 assert.notEqual(d.dispatchId,old.dispatch.attempts[0].dispatchId);
 assert.throws(()=>f.b.handle({...ctx,executor:old.dispatch.executor,action:'fence_confirm_send',dispatchId:d.dispatchId}));
});
for(const [name,change] of [
 ['lost successful permit',f=>f.b.state.batches[batchId].dispatch.attempts[0].sendPermit=proof()],
 ['pending provider',f=>f.b.state.batches[batchId].dispatch.provider={status:'PENDING',taskId:'uncertain'}],
 ['different body',f=>f.input.page=page('CHANGED')],
 ['different revision',f=>f.input.page=page('BEFORE','2026-10-28T00:00:01Z')],
 ['different incident',f=>f.input.batchId='NODEKIT150-LANDED-20261028'],
 ['changed driver',f=>fs.appendFileSync(path.join(f.runtime,'runner.js'),'\n// changed')],
 ['changed diagnostic',f=>fs.appendFileSync(f.diagnosticPath,' ')],
 ['changed canonical',f=>fs.appendFileSync(f.b.file,' ')],
 ['missing owner',f=>f.input.ownerProof=null]
])test('denied-send recovery refuses '+name+' with zero journal writes',t=>{
 const f=recoveryFixture(t);change(f);const before=fs.readFileSync(f.b.file,'utf8');
 assert.throws(()=>f.reconcile(f.b,{...f.input,apply:true}));assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});

for(const fault of ['delayed-permit','native-result-lost'])test('live runner retains barrier without a duplicate native call after '+fault,async()=>{
 let clock=Date.now(),writes=0,closed=0,staged,halted=0,verified=0;
 class ClockDate extends Date{static now(){return clock;}}
 const live={executor:'same-executor',planHash:'f'.repeat(64)};
 const rpc=async q=>{
  if(q.action==='normal_init')return {...live,referenceToken:'bound-token'};
  if(q.action==='validate_batch')return {status:'READY',next:0};
  if(q.action==='preflight')return {};
  if(q.action==='case_stage_input'){staged=q.operation;return {stageId:'one-stage',inputHash:'bound-hash'};}
  if(q.action==='case_consume_live'){
   if(staged.action==='fence_begin')return {...live,next:0};
   if(staged.action==='fence_prepare')return {ticket:'one-ticket',snapshot:'saved-snapshot'};
   if(staged.action==='fence_dispatch')return {dispatchId:'one-dispatch',request:{page_id:A}};
   return {};
  }
  if(q.action==='case_live_send'){
   const permit={...live,dispatchId:'one-dispatch',pageId:A,observedAt:new Date(clock).toISOString(),validUntil:new Date(clock+15000).toISOString()};
   if(fault==='delayed-permit')clock+=16000;return {permit,noCallToken:'one-use-token'};
  }
  if(q.action==='fence_halt'){halted++;return {status:'HALTED'};}
  if(q.action==='close'){closed++;return {status:'CLOSED'};}
  if(q.action==='fence_verify'){verified++;return {};}
  throw Error('unexpected '+q.action);
 };
 const tools={async mcp__codex_apps__notion_fetch(){return page();},
  async mcp__codex_apps__notion_notion_update_page(){writes++;throw Error('lost native response');}};
 // Exercise the actual RPC client and its private no-call token, including
 // the delayed confirmation path; do not fall back to a broker-only stub.
 let retained;
 const client=factory('normal_rpc_client.js',{Date:ClockDate})({
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(){
   return {content:[{type:'text',text:'PID 700\nNPG/2 {"ready":true}\n'}]};
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process({input}){
   const q=JSON.parse(input);retained={content:[{type:'text',text:'NPG/2 '+JSON.stringify({requestId:q.requestId,ok:true,result:await rpc(q)})+'\n'}]};return retained;
  },
  async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(){return retained;}
 },{command:'synthetic-control-command'});
 const runner=factory('normal_live_runner.js',{Date:ClockDate,setTimeout})(tools,{
  client,centralTaskId:central,runId:run,references:[{pageId:A}],
  nativeExpectations:[],binding:{repository:'nodekit',source:{pr:149}},createWitness:()=>async()=>({actual:true})});
 await assert.rejects(runner.run(batchId,[edit]),fault==='delayed-permit'?/NORMAL_PRE_CALL_PERMIT_EXPIRED/:/lost native response/);
 assert.equal(writes,fault==='delayed-permit'?0:1);assert.equal(halted,1);assert.equal(verified,0);assert.equal(closed,1);
});

function liveBootstrapFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'normal-bootstrap-')),runtime=path.join(root,'runtime'),head='a'.repeat(40);
 const dir=path.join(runtime,'extensions',head);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
  'normal_projection_probe.cjs','ordinary_followthrough.js','normal_bridge.cjs','normal_live_owner.js',
  'normal_live_runner.js','normal_followthrough_v2.js','normal_live_command.js','reconcile_unpermitted_dispatch.cjs',
  'normal_rpc_client.js','normal_unsent.cjs','reconcile_permit_expiry.cjs','sori_startup_control.cjs'];
 const files={};for(const n of names){const bytes=fs.readFileSync(path.join(__dirname,n));
  fs.writeFileSync(path.join(dir,n),bytes,{mode:0o600});files[n]=sha(bytes);}
 const ce='module.exports={validateControl:()=>({}),controls:()=>{}};';
 fs.writeFileSync(path.join(runtime,'case_exception.cjs'),ce,{mode:0o600});
 // Synthetic core isolates bootstrap verification before ordinary operations;
 // production-core begin/send/verify behavior is exercised in the other tests.
 fs.writeFileSync(path.join(runtime,'broker.cjs'),'module.exports={Broker:class{handle(){return {closed:true};}close(){}}};',{mode:0o600});
 fs.writeFileSync(path.join(runtime,'policy.json'),'{}',{mode:0o600});
 fs.writeFileSync(path.join(root,'journal.json'),'{"preserved":true}',{mode:0o600});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,runtime,dir,installation:{root,runtime,sourceHead:head,extensionDirectory:dir,caseModuleHash:sha(ce),files}};
}
test('ordinary bootstrap verifies every extension before starting and closes without journal changes',t=>{
 const f=liveBootstrapFixture(t),cmd=factory('normal_live_command.js')(f.installation),before=fs.readFileSync(path.join(f.root,'journal.json'),'utf8');
 const r=require('node:child_process').spawnSync('/bin/sh',['-c',cmd],{input:'{"action":"close","requestId":"close-once"}\n',encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"ready":true/);assert.match(r.stdout,/"requestId":"close-once","ok":true/);
 assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),before);
});
test('ordinary RPC awaits an asynchronous bridge result before serialization',t=>{
 const f=liveBootstrapFixture(t);
 fs.writeFileSync(path.join(f.runtime,'broker.cjs'),
  'module.exports={Broker:class{handle(){return Promise.resolve({closed:true,async:true});}close(){}}};',{mode:0o600});
 const r=require('node:child_process').spawnSync('/bin/sh',['-c',factory('normal_live_command.js')(f.installation)],
  {input:'{"action":"close","requestId":"close-async"}\n',encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"requestId":"close-async","ok":true,"result":\{"closed":true,"async":true\}/);
});
test('ordinary bootstrap separately pins the exact Sori48 phase-provider source set',t=>{
 const f=liveBootstrapFixture(t),phaseNames=['SORI48_UNKNOWN_CLOSURE_PROPOSAL.json',
  'sori48_unknown_state.cjs','sori48_unknown_closure.cjs','sori48_unknown_runtime.cjs'];
 f.installation.phaseProviders={};
 for(const n of phaseNames){const bytes=fs.readFileSync(path.join(__dirname,n));
  fs.writeFileSync(path.join(f.dir,n),bytes,{mode:0o600});f.installation.phaseProviders[n]=sha(bytes);}
 let r=require('node:child_process').spawnSync('/bin/sh',['-c',factory('normal_live_command.js')(f.installation)],
  {input:'{"action":"close","requestId":"close-phase"}\n',encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"ready":true/);
 fs.appendFileSync(path.join(f.dir,'sori48_unknown_state.cjs'),'\nchanged');
 r=require('node:child_process').spawnSync('/bin/sh',['-c',factory('normal_live_command.js')(f.installation)],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(r.stdout.includes('"ready":true'),false);
});
test('ordinary command rejects partial phase-provider manifests',()=>{
 const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
  'normal_projection_probe.cjs','ordinary_followthrough.js','normal_bridge.cjs','normal_live_owner.js',
  'normal_live_runner.js','normal_followthrough_v2.js','normal_live_command.js','reconcile_unpermitted_dispatch.cjs',
  'normal_rpc_client.js','normal_unsent.cjs','reconcile_permit_expiry.cjs','sori_startup_control.cjs'];
 const f={root:'/r',runtime:'/r/t',sourceHead:'a'.repeat(40),extensionDirectory:'/r/t/extensions/'+('a'.repeat(40)),
  caseModuleHash:'b'.repeat(64),files:Object.fromEntries(names.map(n=>[n,'c'.repeat(64)])),
  phaseProviders:{'sori48_unknown_state.cjs':'d'.repeat(64)}};
 assert.throws(()=>factory('normal_live_command.js')(f),/NORMAL_INSTALLATION_MANIFEST/);
});
for(const fault of ['changed','symlink','writable'])test('ordinary bootstrap rejects '+fault+' extension before starting a broker',t=>{
 const f=liveBootstrapFixture(t),file=path.join(f.dir,'normal_bridge.cjs');
 if(fault==='changed')fs.appendFileSync(file,'\nchanged');
 if(fault==='symlink'){fs.unlinkSync(file);fs.symlinkSync(path.join(f.dir,'normal_live_runner.js'),file);}
 if(fault==='writable')fs.chmodSync(file,0o666);
 const r=require('node:child_process').spawnSync('/bin/sh',['-c',factory('normal_live_command.js')(f.installation)],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(r.stdout.includes('"ready":true'),false);assert.equal(fs.existsSync(path.join(f.root,'broker.lock')),false);
});

test('Sori48 closure bridge is check-only and binds scheduled owner proof',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'normal-sori48-check-')),b=new core.Broker(root,policy);
 t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 let received;const referenceIds=[A,'b'.repeat(32),router,policyId];
 const bridge=createBridge({broker:b,installation:{root},verifyExtensions(){},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:b.executor,journalHash:'f'.repeat(64)};},
  sori48ClosureCheck(input){received=input;return {eligible:true,applied:false};}});
 const init=bridge.handle({action:'normal_sori48_closure_init',batchId:'SORI48-PAIR-ADMIT-20261029',
  edits:[],centralTaskId:central,runId:run,referenceIds});
 const operation={action:'normal_sori48_unknown_check',batchId:'SORI48-PAIR-ADMIT-20261029',apply:false};
 const stage=bridge.handle({action:'case_stage_input',batchId:operation.batchId,operation});
 const observedAt=new Date().toISOString(),liveSource={observedAt,referenceToken:init.referenceToken,
  nativeChecks:referenceIds.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-29T00:00:00Z'})),
  central:{id:central,is_enabled:true,schedulerEvidenceSha256:'d'.repeat(64),
    run:{id:run,recorded_status:'in_progress'}}};
 const result=bridge.handle({action:'case_consume_live',batchId:operation.batchId,...stage,liveSource});
 assert.deepEqual(result,{eligible:true,applied:false});assert.equal(received.apply,false);
 assert.deepEqual(received.owner,{actor:'automation:'+central,runId:run,scheduledProofSha256:'d'.repeat(64)});
 assert.equal(fs.existsSync(b.file),false);
});
test('Sori48 closure bridge rejects apply and missing scheduled proof before provider call',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'normal-sori48-refuse-')),b=new core.Broker(root,policy);
 t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 let calls=0;const referenceIds=[A,'b'.repeat(32),router,policyId];
 const bridge=createBridge({broker:b,installation:{root},verifyExtensions(){},
  probe(){return {canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:b.executor,journalHash:'f'.repeat(64)};},
  sori48ClosureCheck(){calls++;}});
 const init=bridge.handle({action:'normal_sori48_closure_init',batchId:'SORI48-PAIR-ADMIT-20261029',
  edits:[],centralTaskId:central,runId:run,referenceIds});
 assert.throws(()=>bridge.handle({action:'case_stage_input',batchId:'SORI48-PAIR-ADMIT-20261029',
  operation:{action:'normal_sori48_unknown_check',batchId:'SORI48-PAIR-ADMIT-20261029',apply:true}}));
 assert.throws(()=>bridge.handle({action:'case_stage_input',batchId:'SORI48-PAIR-ADMIT-20261029',
  operation:{action:'normal_sori48_unknown_check',batchId:'SORI48-PAIR-ADMIT-20261029',apply:false,
    priorExecutorAbsent:true,freshSources:{github:{head:'caller-selected'}}}}),/NORMAL_SORI48_CHECK_SCOPE/);
 const operation={action:'normal_sori48_unknown_check',batchId:'SORI48-PAIR-ADMIT-20261029',apply:false};
 const stage=bridge.handle({action:'case_stage_input',batchId:operation.batchId,operation});
 const observedAt=new Date().toISOString(),liveSource={observedAt,referenceToken:init.referenceToken,
  nativeChecks:referenceIds.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-29T00:00:00Z'})),
  central:{id:central,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};
 assert.throws(()=>bridge.handle({action:'case_consume_live',batchId:operation.batchId,...stage,liveSource}),
  /NORMAL_SORI48_SCHEDULED_PROOF/);assert.equal(calls,0);assert.equal(fs.existsSync(b.file),false);
});
