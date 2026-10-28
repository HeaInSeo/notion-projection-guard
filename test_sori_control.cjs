'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const production=require('./sori_startup_control.cjs'),core=require('./broker.cjs'),{createBridge}=require('./normal_bridge.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
const factory=(n,sandbox={})=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,n),'utf8'),sandbox);
const run='12345678-1234-4234-8234-123456789abc';
const edit={pageId:production.admission.referenceIds[2],heading:'## CURRENT CENTRAL OBSERVATION · control fixture',
  oldStr:'sori\\_w02\\_action=',newStr:'sori-w02-action=STAGED; consumed-Sori-PR43-directive='};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sori-control-')),newDir=path.join(root,'normal'),oldDir=path.join(root,'case');
  fs.mkdirSync(newDir,{mode:0o700});fs.mkdirSync(oldDir,{mode:0o700});
  const normal=path.join(newDir,'ADMISSION'),old=path.join(oldDir,'ADMISSION'),normalRaw='synthetic normal admission',oldRaw='preserved synthetic case admission';
  fs.writeFileSync(normal,normalRaw,{mode:0o444});fs.writeFileSync(old,oldRaw,{mode:0o444});
  let source=fs.readFileSync(path.join(__dirname,'sori_startup_control.cjs'),'utf8');
  for(const [a,b] of [[production.admission.file,normal],[production.admission.oldCaseFile,old],
    [production.admission.sha256,sha(normalRaw)],[production.admission.oldCaseSha256,sha(oldRaw)],
    [production.admission.planHash,sha(JSON.stringify([edit]))]])source=source.replaceAll(a,b);
  const m={exports:{}};new Function('require','module','exports',source)(require,m,m.exports);
  const scope=m.exports,broker={state:{caseExceptionControl:{exclusive:false,admission:{packetHash:sha(oldRaw)}}}},
    input={action:'normal_control_init',batchId:scope.admission.batchId,centralTaskId:scope.admission.centralTaskId,
      runId:run,referenceIds:[...scope.admission.referenceIds],edits:[copy(edit)],controlAdmissionId:scope.admission.id};
  const beforeCleanup=[];
  t.after(()=>{for(const close of beforeCleanup)close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,normal,old,scope,source,broker,input,beforeCleanup,validate:scope.createAdmission()};
}
test('fixed normal control admission is read-only and preserves the case packet',t=>{
  const f=fixture(t),before=copy(f.broker.state),old=fs.readFileSync(f.old),normal=fs.readFileSync(f.normal);
  f.validate(f);assert.deepEqual(f.broker.state,before);assert.deepEqual(fs.readFileSync(f.old),old);
  assert.deepEqual(fs.readFileSync(f.normal),normal);assert.equal(fs.existsSync(path.join(f.root,'journal.json')),false);
});
test('production proposal and published document independently retain their reviewed digest',()=>{
  const expected='f698f6fd760f6f836d5a70bde9e95e845627b719098f7d116fa81d226cf7f7b4';
  const doc=fs.readFileSync(path.join(__dirname,'SORI_CONTROL_EXCEPTION_PROPOSAL.md'),'utf8');
  assert.equal(production.proposalSha256,expected);assert.ok(doc.includes('Proposal SHA256: '+expected));
  const block=doc.match(/```json\n([\s\S]*?)\n```/);assert.ok(block);
  assert.equal(sha(JSON.stringify(JSON.parse(block[1]))),expected);
});
for(const [name,change] of [
  ['fake MERGED PR',f=>f.input.pr=47],
  ['repository disguise',f=>f.input.repository='sori'],
  ['other operation',f=>f.input.action='normal_init'],
  ['caller permission',f=>f.input.ownerProof={prerequisites:true}],
  ['other scope',f=>f.input.batchId+='-BYPASS'],
  ['other admission',f=>f.input.controlAdmissionId+='-OTHER'],
  ['other central',f=>f.input.centralTaskId='0'.repeat(32)],
  ['unbound run',f=>f.input.runId='latest-run'],
  ['missing source',f=>f.input.referenceIds.pop()],
  ['substituted source',f=>f.input.referenceIds[0]='0'.repeat(32)],
  ['source order substitution',f=>f.input.referenceIds.reverse()],
  ['extra target',f=>f.input.edits.push(copy(edit))],
  ['other target',f=>f.input.edits[0].pageId='0'.repeat(32)],
  ['changed instruction',f=>f.input.edits[0].newStr+=' RW OPEN'],
  ['changed case authority',f=>f.broker.state.caseExceptionControl.admission.packetHash='0'.repeat(64)],
  ['exclusive case',f=>f.broker.state.caseExceptionControl.exclusive=true],
  ['changed normal packet',f=>{fs.chmodSync(f.normal,0o644);fs.writeFileSync(f.normal,'changed');}],
  ['changed preserved packet',f=>{fs.chmodSync(f.old,0o644);fs.writeFileSync(f.old,'changed');}],
  ['writable packet',f=>fs.chmodSync(f.normal,0o666)],
  ['public packet parent',f=>fs.chmodSync(path.dirname(f.normal),0o755)],
  ['symlink packet',f=>{fs.unlinkSync(f.normal);fs.symlinkSync(f.old,f.normal);}]
])test('normal control refuses '+name+' before canonical admission',t=>{
  const f=fixture(t);change(f);assert.throws(()=>f.validate(f));
  assert.equal(fs.existsSync(path.join(f.root,'journal.json')),false);
});
test('external key update preserves the whole long historical code field',()=>{
  const long='UNIQUE-HISTORY-START '+ 'PR43 consumed historical record; '.repeat(90),body=edit.heading+'\n'+edit.oldStr+'<code>'+long+'</code>\n## HISTORY\nuntouched';
  const p=core.plan({body},edit);
  assert.equal(p.expected,body.replace(edit.oldStr,edit.newStr));assert.ok(p.expected.includes('<code>'+long+'</code>'));
  assert.throws(()=>core.plan({body},{...edit,oldStr:'UNIQUE-HISTORY-START'}),error=>error.code==='INLINE_CODE_BOUNDARY');
});
function bridgeFixture(t){
  const f=fixture(t),policy={productionEnabled:true,productionPages:[edit.pageId],canaryPages:[],
    headingPrefixes:['## CURRENT CENTRAL OBSERVATION']},b=new core.Broker(f.root,policy);
  f.beforeCleanup.push(()=>b.close());
  const bridge=createBridge({broker:b,installation:{root:f.root},verifyExtensions(){},
    probe:()=>({canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:b.executor,journalHash:'f'.repeat(64)}),
    // The production bootstrap wires the actual broker. This unit fixture
    // isolates packet validation from the separately tested case-manifest core.
    validateControlInit:({input})=>f.validate({broker:f.broker,input})});
  return {...f,b,bridge};
}
test('control cannot enter through the existing MERGED admission',t=>{
  const f=bridgeFixture(t);assert.throws(()=>f.bridge.handle({...f.input,action:'normal_init',repository:'sori',pr:47}),/NORMAL_ADOPTED_SCOPE/);
  assert.equal(fs.existsSync(f.b.file),false);
});
test('control stages grant nothing; fresh witnessed ownership still fences begin',t=>{
  const f=bridgeFixture(t),init=f.bridge.handle(f.input),batchId=f.input.batchId;
  const stage=f.bridge.handle({action:'case_stage_input',batchId,operation:{action:'fence_begin',batchId,edits:[edit]}});
  assert.equal(fs.existsSync(f.b.file),false);
  const observedAt=new Date().toISOString(),w={observedAt,referenceToken:init.referenceToken,
    nativeChecks:f.input.referenceIds.map(pageId=>({pageId,observedAt,matched:true,revision:'2026-10-28T00:00:00Z'})),
    central:{id:f.input.centralTaskId,is_enabled:true,run:{id:run,recorded_status:'in_progress'}}};
  const r=f.bridge.handle({action:'case_consume_live',batchId,...stage,liveSource:w});
  assert.equal(r.status,'READY');assert.equal(f.b.state.active,batchId);assert.equal(f.b.state.batches[batchId].next,0);
});
test('normal admission packet changes after init block consumption before begin',t=>{
  const f=bridgeFixture(t);f.bridge.handle(f.input);fs.chmodSync(f.normal,0o644);fs.writeFileSync(f.normal,'changed');
  assert.throws(()=>f.bridge.handle({action:'case_stage_input',batchId:f.input.batchId,
    operation:{action:'fence_begin',batchId:f.input.batchId,edits:[edit]}}),/SORI_CONTROL_ADMISSION_PIN/);
  assert.equal(fs.existsSync(f.b.file),false);
});
test('live driver chooses explicit control admission without a fake PR',async()=>{
  const calls=[];const runner=factory('normal_live_runner.js')({},
    {client:{broker:async q=>{calls.push(q);return q.action==='normal_control_init'?{referenceToken:'real-token'}:
      {status:'COMPLETED'};},close:async()=>{}},centralTaskId:production.admission.centralTaskId,runId:run,
      references:production.admission.referenceIds.map(pageId=>({pageId})),nativeExpectations:[],
      controlAdmissionId:production.admission.id,createWitness:()=>async()=>{throw Error('completed must not read/send');}});
  const result=await runner.run(production.admission.batchId,[edit]);assert.equal(result.alreadyConsumed,true);
  assert.equal(calls[0].action,'normal_control_init');assert.equal(Object.hasOwn(calls[0],'pr'),false);
  assert.equal(Object.hasOwn(calls[0],'repository'),false);
});
const nativePage=(id,body,revision='2026-10-28T00:00:00Z')=>({structuredContent:{id,page_last_edited_at:revision,
  text:'<properties>\n{"title":"protected fixture"}\n</properties>\n<content>\n'+body+'\n</content>'}});
const routerBody=()=>edit.heading+'\n'+edit.oldStr+'<code>'+'preserved historical code; '.repeat(50000)+'</code>\n## HISTORY\nuntouched';
function policy(){return {productionEnabled:true,productionPages:[edit.pageId],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};}
function clock(t){
  const RealDate=global.Date;let now=Math.max(RealDate.now(),RealDate.parse('2026-10-29T00:00:00Z'));
  class ClockDate extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  global.Date=ClockDate;t.after(()=>{global.Date=RealDate;});
  return {Date:ClockDate,advance(ms){now+=ms;}};
}
function legacyFixture(t){
  const f=fixture(t),time=clock(t),batchId=f.input.batchId,oldRun=production.incident.runId;
  const proof=(generation=run)=>({ownerId:'automation:'+f.input.centralTaskId,generation,scope:batchId,
    prerequisites:true,conflicts:[],evidenceHash:'e'.repeat(64),observedAt:new Date().toISOString(),
    validUntil:new Date(Date.now()+15000).toISOString()});
  let b=new core.Broker(f.root,policy());
  const begin=b.handle({action:'fence_begin',batchId,edits:[edit],ownerProof:proof(oldRun)});
  const live={batchId,executor:begin.executor,planHash:begin.planHash},page=nativePage(edit.pageId,routerBody());
  const call=(action,extra={})=>b.handle({...live,action,ownerProof:proof(oldRun),...extra});
  const prepared=call('fence_prepare',{page});live.ticket=prepared.ticket;call('fence_authorize',{page});
  const dispatch=call('fence_dispatch',{page});live.dispatchId=dispatch.dispatchId;
  call('fence_confirm_send');time.advance(16000);call('fence_halt',{reason:'SEND_PERMIT_EXPIRED_OR_FENCED'});
  const raw=fs.readFileSync(b.file,'utf8'),state=JSON.parse(raw),x=state.batches[batchId],a=x.dispatch.attempts[0];
  const runtime=path.join(f.root,'runtime');fs.mkdirSync(runtime,{mode:0o700});
  const driver=fs.readFileSync(path.join(__dirname,'runner.js'));fs.writeFileSync(path.join(runtime,'runner.js'),driver,{mode:0o600});
  const dir=path.join(f.root,'manual-audits/automatic-followthrough-20261028-04386a5');fs.mkdirSync(dir,{recursive:true});
  const hostPlan='{"synthetic":"test-only"}';fs.writeFileSync(path.join(dir,production.incident.hostPlanFile),hostPlan,{mode:0o600});
  const diagnostic={schema:'SORI_R3_V4_PERMIT_EXPIRY_RESULT_V1',nonce:'SORI-391159F9-R3',
    execution:{batchId,planHash:begin.planHash,ticket:prepared.ticket,dispatchId:dispatch.dispatchId,
      requestHash:a.requestHash,next:0,provider:null,error:x.error},canonical:{sha256:sha(raw)}};
  const trace={schema:'SORI_R4_R3_ACTUAL_EVIDENCE_V1',r3:{batchId,planHash:begin.planHash,ticket:prepared.ticket,
    snapshotSha256:x.receipt.snapshotHash,dispatchId:dispatch.dispatchId,requestHash:a.requestHash,
    executor:begin.executor,canonicalJournalSha256:sha(raw),planSha256:sha(hostPlan),originalRunnerSha256:sha(driver),
    sendPermit:{observedAt:a.sendPermit.observedAt,validUntil:a.sendPermit.validUntil}},
    conclusion:{nativeBodyCallCount:'UNKNOWN',directNegativeConclusion:false},
    missingOriginalProof:{thrownStack:true,connectorSideNativeCallLedger:true}};
  const diagnosticRaw=JSON.stringify(diagnostic),traceRaw=JSON.stringify(trace);
  fs.writeFileSync(path.join(dir,production.incident.diagnosticFile),diagnosticRaw,{mode:0o600});
  fs.writeFileSync(path.join(dir,production.incident.traceFile),traceRaw,{mode:0o600});
  const pins={journalHash:sha(raw),ticket:prepared.ticket,snapshotHash:x.receipt.snapshotHash,
    dispatchId:dispatch.dispatchId,executor:begin.executor,runnerHash:sha(driver),hostPlanHash:sha(hostPlan),
    diagnosticHash:sha(diagnosticRaw),traceHash:sha(traceRaw)};
  let source=f.source;for(const [key,value] of Object.entries(pins))source=source.replaceAll(production.incident[key],value);
  const m={exports:{}};new Function('require','module','exports',source)(require,m,m.exports);
  f.scope=m.exports;b.close();b=new core.Broker(f.root,policy());f.beforeCleanup.push(()=>b.close());
  return {...f,b,runtime,dir,time,page,raw,state,proof,initInput:f.input,input:{batchId,planHash:begin.planHash,page,pages:[],apply:false,ownerProof:proof()},
    assess:f.scope.createAssessor({...core,runtime}),continueUser:f.scope.createUserCase({...core,runtime})};
}
test('incomplete legacy evidence remains Class C and cannot apply a no-send recovery',t=>{
  const f=legacyFixture(t),assessment=f.assess(f.b,f.input);
  assert.equal(assessment.eligible,false);assert.equal(assessment.classification,'C');
  assert.equal(assessment.next,0);assert.equal(typeof assessment.nextAction,'string');
  assert.equal(assessment.nativeBodyCallCount,'UNKNOWN');assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
  assert.throws(()=>f.assess(f.b,{...f.input,apply:true}),/SORI_CONTROL_EXECUTION_UNPROVEN/);
  assert.throws(()=>f.continueUser(f.b,f.input),/SORI_CONTROL_USER_APPROVAL_REQUIRED/);
  assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
});
function approve(f,change=()=>{}){
  const p={schema:'SORI_CONTROL_USER_APPROVAL_V1',proposalSha256:f.scope.proposalSha256,decision:'APPROVED',
    approvedAt:new Date().toISOString(),userMessageRef:'SYNTHETIC-TEST-ONLY',userMessageSha256:sha('synthetic user approval')};
  change(p);const file=path.join(f.dir,'sori-startup-control-user-approval.json');
  fs.writeFileSync(file,JSON.stringify(p),{mode:0o600});return file;
}
for(const [name,change] of [
  ['other proposal',p=>p.proposalSha256='0'.repeat(64)],['denied',p=>p.decision='DENIED'],
  ['missing user reference',p=>p.userMessageRef=''],['future',p=>p.approvedAt=new Date(Date.now()+1000).toISOString()],
  ['pre-incident',p=>p.approvedAt='2026-10-27T00:00:00Z'],['extra permissions',p=>p.allowAnyBatch=true]
])test('user exception refuses '+name+' without canonical change',t=>{
  const f=legacyFixture(t);approve(f,change);assert.throws(()=>f.continueUser(f.b,{...f.input,apply:true}));
  assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
});
for(const mode of [0o640,0o604,0o620])test('approval receipt refuses non-private mode '+mode.toString(8),t=>{
  const f=legacyFixture(t),file=approve(f);fs.chmodSync(file,mode);
  assert.throws(()=>f.continueUser(f.b,{...f.input,apply:true}),/SORI_CONTROL_PRIVATE_FILE/);
  assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
});
test('approval receipt refuses a symlink to otherwise valid private approval',t=>{
  const f=legacyFixture(t),file=approve(f),target=path.join(f.dir,'synthetic-other-approval.json');
  fs.renameSync(file,target);fs.symlinkSync(target,file);
  assert.throws(()=>f.continueUser(f.b,{...f.input,apply:true}),/SORI_CONTROL_PRIVATE_FILE/);
  assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
});
test('approval changed after assessment cannot commit a continuation',t=>{
  const f=legacyFixture(t),file=approve(f),original=f.b.ownerProof.bind(f.b);let checks=0;
  f.b.ownerProof=(...args)=>{const result=original(...args);if(++checks===2)fs.writeFileSync(file,'{"decision":"REVOKED"}');return result;};
  assert.throws(()=>f.continueUser(f.b,{...f.input,apply:true}),/SORI_CONTROL_USER_APPROVAL_CHANGED/);
  assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
});
test('explicit synthetic approval preserves UNKNOWN and every original receipt without an ACK or page advance',t=>{
  const f=legacyFixture(t);approve(f);assert.equal(f.continueUser(f.b,f.input).eligible,true);
  assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
  const out=f.continueUser(f.b,{...f.input,apply:true}),old=f.state.batches[f.input.batchId],now=f.b.state.batches[f.input.batchId];
  assert.equal(out.notANoSendProof,true);assert.equal(out.originalNativeCallCount,'UNKNOWN');
  assert.equal(out.acknowledgedWrites,0);assert.equal(out.pageAdvances,0);assert.equal(out.ticketsCreated,0);
  assert.equal(now.next,0);assert.equal(now.status,'PREPARED');assert.deepEqual(now.receipt,old.receipt);
  assert.deepEqual(now.edits,old.edits);assert.equal(now.error,old.error);assert.equal(now.haltedFrom,old.haltedFrom);
  const attempt=copy(now.dispatch.attempts[0]);delete attempt.continuedUnderUserException;
  assert.deepEqual(attempt,old.dispatch.attempts[0]);assert.equal(now.dispatch.attempts[0].revokedBeforeCall,undefined);
  assert.equal(now.dispatch.attempts[0].continuedUnderUserException.notANoSendProof,true);
  assert.throws(()=>f.continueUser(f.b,{...f.input,apply:true}));
});
for(const [name,change] of [
  ['changed page',f=>f.input.page=nativePage(edit.pageId,'changed')],
  ['changed revision',f=>f.input.page=nativePage(edit.pageId,routerBody(),'2026-10-28T00:00:01Z')],
  ['unresolved provider',f=>{f.b.state.batches[f.input.batchId].dispatch.provider={status:'PENDING',taskId:'unknown'};f.b.save();}],
  ['changed trace',f=>fs.appendFileSync(path.join(f.dir,production.incident.traceFile),' ')],
  ['changed driver',f=>fs.appendFileSync(path.join(f.runtime,'runner.js'),' ')],
  ['wrong case',f=>f.input.batchId+='-OTHER']
])test('exact assessment and user exception refuse '+name,t=>{
  const f=legacyFixture(t);approve(f);change(f);const before=fs.readFileSync(f.b.file,'utf8');
  assert.throws(()=>f.continueUser(f.b,{...f.input,apply:true}));assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
});
function liveFixture(t,legacy=false){
  const f=legacy?legacyFixture(t):fixture(t);
  if(!legacy){f.time=clock(t);f.b=new core.Broker(f.root,policy());f.beforeCleanup.push(()=>f.b.close());}
  const setup=f.initInput??f.input;
  f.pages=new Map(setup.referenceIds.map(id=>[id,nativePage(id,id===edit.pageId?routerBody():'protected authority '+id)]));
  if(legacy)f.pages.set(edit.pageId,f.input.page);
  return f;
}
function wire(f,options={}){
  const setup=f.initInput??f.input;
  const unsent=require('./normal_unsent.cjs'),restoreUnsent=unsent.createUnsent(core);
  const bridge=createBridge({broker:f.b,installation:{root:f.root},verifyExtensions(){},
    probe:()=>({canonical:{exclusive:false,manifestHash:'e'.repeat(64)},brokerExecutor:f.b.executor,journalHash:'f'.repeat(64)}),
    validateControlInit:({input})=>f.validate({broker:f.broker,input}),restoreUnsent,
    assessControlPermit:f.assess,continueApprovedControl:f.continueUser});
  const inputs=[];let pending='',nativeCalls=0,delayed=false,closes=0;
  const tools={
    async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process(){
      return {content:[{type:'text',text:'Process started with PID 990001\nNPG/2 {"ready":true}'}]};},
    async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process(q){
      const input=JSON.parse(q.input);inputs.push(input);let frame;
      try{frame={requestId:input.requestId,ok:true,result:bridge.handle(input)};}
      catch(error){frame={requestId:input.requestId,ok:false,error:error.message,code:error.code};}
      pending='NPG/2 '+JSON.stringify(frame)+'\n';
      if(input.action==='close')closes++;
      if(options.expireFirstConfirmation&&input.action==='case_live_send'&&!delayed){f.time.advance(16000);delayed=true;}
      return {content:[{type:'text',text:pending}]};
    },
    async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output(){
      return {content:[{type:'text',text:pending+'\n'}]};},
    async mcp__codex_apps__notion_fetch({id}){return f.pages.get(id);},
    async mcp__codex_apps__automations_peek(){return {automations:[{id:setup.centralTaskId,is_enabled:true,
      run_details:{last_run:{id:run,recorded_status:'in_progress'}}}]};},
    async mcp__codex_apps__notion_notion_update_page(q){
      nativeCalls++;if(options.nativeError)throw Error(options.nativeError);
      const p=core.pageData(f.pages.get(q.page_id),q.page_id),e=q.content_updates[0];
      assert.equal(p.body.split(e.old_str).length-1,1);
      f.pages.set(q.page_id,nativePage(q.page_id,p.body.replace(e.old_str,e.new_str),'2026-10-28T00:00:01Z'));
      return {structuredContent:{page_id:q.page_id}};
    }
  };
  const client=factory('normal_rpc_client.js',{Date:f.time.Date})(tools,{command:'synthetic-control-only'});
  const runner=factory('normal_live_runner.js',{Date:f.time.Date})(tools,{client,centralTaskId:setup.centralTaskId,runId:run,
    references:setup.referenceIds.map(pageId=>({pageId,page:f.pages.get(pageId)})),nativeExpectations:[],
    controlAdmissionId:f.scope.admission.id,recovery:options.recovery,
    createWitness:factory('normal_live_owner.js',{Date:f.time.Date})});
  return {runner,inputs,get nativeCalls(){return nativeCalls;},get closes(){return closes;}};
}
test('real control driver stages a megabyte preimage, renews only its private expired no-call token, and verifies one native write',async t=>{
  const f=liveFixture(t),w=wire(f,{expireFirstConfirmation:true}),before=core.pageData(f.pages.get(edit.pageId),edit.pageId);
  const result=await w.runner.run(f.input.batchId,[edit]),out=f.b.state.batches[f.input.batchId];
  assert.equal(result.status,'COMPLETED');assert.equal(w.nativeCalls,1);assert.equal(w.closes,1);
  assert.equal(out.dispatch.attempts.length,2);assert.ok(out.dispatch.attempts[0].revokedBeforeCall);
  assert.equal(out.next,1);assert.equal(out.verifications.length,1);assert.equal(f.b.state.active,null);
  assert.equal(core.pageData(f.pages.get(edit.pageId),edit.pageId).body,before.body.replace(edit.oldStr,edit.newStr));
  assert.equal(w.inputs.filter(q=>q.action==='normal_control_init').length,1);
});
test('a provider error with the private expiry message cannot manufacture a no-call token or retry',async t=>{
  const f=liveFixture(t),w=wire(f,{nativeError:'NORMAL_PRE_CALL_PERMIT_EXPIRED'});
  await assert.rejects(w.runner.run(f.input.batchId,[edit]),/NORMAL_PRE_CALL_PERMIT_EXPIRED/);
  const out=f.b.state.batches[f.input.batchId];assert.equal(w.nativeCalls,1);assert.equal(out.status,'HALTED');
  assert.equal(out.dispatch.phase,'SEND_INTENT');assert.equal(out.dispatch.attempts.length,1);
  assert.equal(out.dispatch.attempts[0].revokedBeforeCall,undefined);assert.equal(out.next,0);
});
test('synthetic explicitly approved UNKNOWN continuation uses the same ticket and retains the uncertain old attempt through real verification',async t=>{
  const f=liveFixture(t,true);approve(f);const old=f.state.batches[f.input.batchId];
  const w=wire(f,{recovery:{apply:true,kind:'USER_APPROVED_CONTROL_CONTINUATION'}});
  const result=await w.runner.run(f.input.batchId,[edit]),out=f.b.state.batches[f.input.batchId];
  assert.equal(result.status,'COMPLETED');assert.equal(w.nativeCalls,1);assert.equal(w.closes,1);
  assert.equal(out.next,1);assert.equal(out.verifications.length,1);assert.equal(f.b.state.active,null);
  assert.equal(out.userCaseContinuation.originalNativeCallCount,'UNKNOWN');
  assert.equal(out.dispatch.attempts[0].continuedUnderUserException.notANoSendProof,true);
  assert.equal(out.dispatch.attempts[0].revokedBeforeCall,undefined);
  assert.equal(out.dispatch.attempts[1].ticket,old.receipt.ticket);
  assert.notEqual(out.dispatch.attempts[1].dispatchId,old.dispatch.attempts[0].dispatchId);
  assert.equal(w.inputs.filter(q=>q.action==='fence_begin'||q.operation?.action==='fence_begin').length,0);
});
test('driver cannot use the explicit UNKNOWN continuation without the separate approval record',async t=>{
  const f=liveFixture(t,true),w=wire(f,{recovery:{apply:true,kind:'USER_APPROVED_CONTROL_CONTINUATION'}});
  await assert.rejects(w.runner.run(f.input.batchId,[edit]),/SORI_CONTROL_USER_APPROVAL_REQUIRED/);
  assert.equal(w.nativeCalls,0);assert.equal(fs.readFileSync(f.b.file,'utf8'),f.raw);
});
