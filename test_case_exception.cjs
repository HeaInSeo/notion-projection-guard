'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const vm=require('node:vm');
const {Broker,hash}=require('./broker.cjs');
const {gate,permit}=require('./case_gate.cjs');
const PAGE='a'.repeat(32),OTHER='b'.repeat(32),BATCH='synthetic-owner-veto';
const heading='## CURRENT CENTRAL OBSERVATION · synthetic';
const policy={productionEnabled:true,productionPages:[PAGE],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
const page=(value='BEFORE',revision='2026-10-26T00:00:00Z')=>({structuredContent:{id:PAGE,page_last_edited_at:revision,
  text:'<properties>\n{"title":"Synthetic"}\n</properties>\n<content>\n'+heading+'\nstate='+value+'\n## WORKER PROOF\nkeep\n</content>'}});
function write(file,x,mode=0o600){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof x==='string'?x:JSON.stringify(x),{mode});}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-case-')),root=path.join(dir,'state'),runtime=path.join(dir,'runtime'),backup=path.join(dir,'backup');
  const retiredOwnerId='manual:synthetic-retired',authority={ownerId:'manual:synthetic-current',generation:'synthetic-generation'};
  let b=new Broker(root,policy);const edit={pageId:PAGE,heading,oldStr:'state=BEFORE',newStr:'state=manual:synthetic-retired ACTIVE'};
  b.handle({action:'begin',batchId:BATCH,edits:[edit]});const receipt=b.handle({action:'prepare',batchId:BATCH,page:page()});
  b.handle({action:'authorize',batchId:BATCH,ticket:receipt.ticket,page:page()});b.handle({action:'halt',batchId:BATCH,reason:'Synthetic owner veto'});
  b.state.batches.unrelated={status:'COMPLETED',proof:'keep'};b.save();
  const old=b.state.batches[BATCH],pins={};
  for(const [name,data] of Object.entries({'broker.cjs':'synthetic original broker','runner.js':'synthetic original runner',
    'policy.json':JSON.stringify(policy),'approved.sha256':'synthetic original pins'})){
    write(path.join(backup,name),data);pins[name]=hash(data);
  }
  const evidence={incident:BATCH,facts:{notionMutationInvoked:false},adapterSource:'synthetic recorded wrapper; actual execution binding not proven'};
  write(path.join(root,'evidence.json'),evidence);write(path.join(root,'installation.json'),{sourceCommit:'b'.repeat(40)});
  const spec={schema:'EXACT_UNWRITTEN_CASE_V1',recoveryKind:'POST_AUTHORIZE_PRE_INVOKE_VETO',root,runtime,batchId:BATCH,
    planHash:old.planHash,snapshotHash:old.receipt.snapshotHash,ticket:receipt.ticket,journalHash:hash(fs.readFileSync(b.file,'utf8')),
    evidence:'evidence.json',evidenceHash:hash(JSON.stringify(evidence)),adapterHash:hash(evidence.adapterSource),error:old.error,
    installation:'installation.json',installationHash:hash(fs.readFileSync(path.join(root,'installation.json'),'utf8')),
    sourceCommit:'b'.repeat(40),pins,caller:{conversationId:'synthetic-conversation',responseMessageId:'synthetic-response'},authorizationRequestId:'synthetic-auth'};
  const original=path.join(dir,'original.json');write(original,spec);
  const packet=path.join(dir,'ADMISSION'),status=path.join(dir,'STATUS.json');write(packet,'synthetic original packet references '+retiredOwnerId,0o444);write(status,{execute:false},0o444);
  const c={schema:'SCOPED_CASE_GATE_V1',root,batchId:BATCH,taskId:'synthetic-task',originalPageId:PAGE,workerRole:'operator',repoRoots:[path.join(dir,'repo')]};
  const configPath=path.join(dir,'gate.json');write(configPath,c);const configHash=hash(JSON.stringify(c));
  const files=[];for(const n of ['broker.cjs','runner.js','case_exception.cjs','case_gate.cjs','central_case_owner.js']){
    const p=path.join(runtime,n);write(p,fs.readFileSync(path.join(__dirname,n),'utf8'));files.push({path:p,sha256:hash(fs.readFileSync(p,'utf8'))});
  }
  write(path.join(runtime,'policy.json'),policy);
  files.push({path:path.join(runtime,'policy.json'),sha256:hash(JSON.stringify(policy))});
  const approved=['broker.cjs','runner.js','policy.json'].map(n=>hash(fs.readFileSync(path.join(runtime,n),'utf8'))+'  '+n+'\n').join('');
  write(path.join(runtime,'approved.sha256'),approved);files.push({path:path.join(runtime,'approved.sha256'),sha256:hash(approved)});
  const roles=[];
  for(const role of ['operator','guardrail']){
    const settings=path.join(dir,role+'-settings.json'),wrapper=path.join(dir,role+'.sh');
    const hookCommand='node '+path.join(runtime,'case_gate.cjs')+' hook --config '+configPath+' --config-sha256 '+configHash+' --role '+role;
    write(settings,{hooks:{PreToolUse:[{matcher:'.*',hooks:[{type:'command',command:hookCommand,onFailure:'block',timeout:10}]}]}});
    write(wrapper,'#!/usr/bin/env bash\nnode '+path.join(runtime,'case_gate.cjs')+' launch\nclaude -p task --settings '+settings+'\n');
    for(const p of [settings,wrapper])files.push({path:p,sha256:hash(fs.readFileSync(p,'utf8'))});
    roles.push({role,settings,wrapper,hookCommand});
  }
  const admissionEdit={pageId:PAGE,heading,oldStr:'state=BEFORE',newStr:'state=ADMITTED'};
  const m={schema:'EXACT_SCOPED_EXCEPTION_V1',sourceHead:'c'.repeat(40),originalManifestPath:original,originalManifestHash:hash(JSON.stringify(spec)),
    retiredOwnerId,authority,gateConfigPath:configPath,gateConfigHash:configHash,admissionBatchIds:['synthetic-admission'],
    admissionPlanHashes:{'synthetic-admission':hash(JSON.stringify([admissionEdit]))},
    worker:{taskId:c.taskId,originalPageId:PAGE,role:'operator',sourceVersion:80,packetPath:packet,packetHash:hash(fs.readFileSync(packet,'utf8')),statusPath:status,statusHash:hash(fs.readFileSync(status,'utf8'))},
    risk:{classification:'C',originalApplication:'UNCONFIRMED',externalRequestRevoked:false,acceptedImpact:'SCOPED_ROUTER_OWNER_LITERAL_ONLY',
      pageId:PAGE,oldLiteralHash:hash(edit.oldStr),newLiteralHash:hash(edit.newStr)},
    controls:{files,roles,originalPins:pins,originalBackup:backup}};
  const manifestPath=path.join(dir,'manifest.json');write(manifestPath,m);const manifestHash=hash(JSON.stringify(m));
  const approvalPath=path.join(dir,'approval.json');write(approvalPath,{schema:'SCOPED_EXCEPTION_APPROVAL_V1',status:'APPROVED',manifestHash,
    sourceHead:m.sourceHead,acceptsUnconfirmedApplication:true,acceptsUncancelledExternalPayload:true,
    acceptedImpact:m.risk.acceptedImpact,userMessageReference:'synthetic-only-approval'});
  const proof=()=>({...authority,scope:BATCH,prerequisites:true,conflicts:[],evidenceHash:'d'.repeat(64),
    observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString()});
  const input={action:'reconcile_scoped_exception',batchId:BATCH,apply:false,page:page(),manifestPath,approvedManifestHash:manifestHash,
    ownerProof:proof(),approvalPath,approvedApprovalHash:hash(fs.readFileSync(approvalPath,'utf8'))};
  b.close();b=new Broker(root,policy,{readOnly:true,existingOnly:true});
  t.after(()=>{if(!b.closed)b.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,root,runtime,backup,spec,c,m,input,configPath,configHash,proof,receipt,packet,status,authority,admissionEdit,
    get b(){return b;},restart(apply=true){b.close();b=new Broker(root,policy,{readOnly:!apply,existingOnly:true});return b;},
    audit:path.join(root,hash(BATCH)+'.exception-closure.json')};
}
const tree=root=>Object.fromEntries(fs.readdirSync(root).sort().filter(n=>n!=='broker.lock'&&fs.lstatSync(path.join(root,n)).isFile()).map(n=>[n,hash(fs.readFileSync(path.join(root,n),'utf8'))]));
function close(f){f.restart();return f.b.handle({...f.input,apply:true,ownerProof:f.proof()});}
function installSyntheticAdmission(f,batchId='synthetic-admission'){
  // Actual broker transitions with explicitly synthetic provider/page results;
  // this is never evidence that a production admission or CLAIM occurred.
  const ownerProof={...f.proof(),scope:batchId};
  const begin=f.b.handle({action:'fence_begin',batchId,edits:[f.admissionEdit],ownerProof});
  const ctx={batchId,planHash:begin.planHash,executor:begin.executor,ownerProof};
  const prepared=f.b.handle({...ctx,action:'fence_prepare',page:page()});ctx.ticket=prepared.ticket;
  f.b.handle({...ctx,action:'fence_authorize',page:page()});
  const dispatched=f.b.handle({...ctx,action:'fence_dispatch',page:page()});ctx.dispatchId=dispatched.dispatchId;
  f.b.handle({...ctx,action:'fence_confirm_send'});
  f.b.handle({...ctx,action:'fence_ack',provider:{status:'SUCCEEDED',pageId:PAGE}});
  f.b.handle({...ctx,action:'fence_verify',page:page('ADMITTED')});
  return f.b.handle({action:'record_case_admission',ownerProof:f.proof(),batchIds:[batchId]});
}
function claimPage(f) {
  const e={event_id:'synthetic-claim',task_id:f.c.taskId,role:'operator',version:81,kind:'CLAIM',session_id:'new-synthetic-worker',
    lease_state:'HELD until '+new Date(Date.now()+60000).toISOString(),event_at_utc:new Date().toISOString()};
  return {structuredContent:{id:PAGE,page_last_edited_at:new Date().toISOString(),text:'<properties>\n'+JSON.stringify({
    '이벤트 ID':e.event_id,'체크포인트 버전':81,'세션 ID':e.session_id})+'\n</properties>\n<content>\n```json\n'+JSON.stringify({QUEUE_EVENT_V1:e})+'\n```\n</content>'}};
}
test('exception check-only preserves C, original evidence and all canonical bytes',t=>{
  const f=fixture(t),before=tree(f.root),out=f.b.handle(f.input);
  assert.equal(out.classification,'C');assert.equal(out.disposition,'CLOSED_EXCEPTION_UNCONFIRMED');assert.equal(out.eligiblePendingApproval,true);
  assert.deepEqual(tree(f.root),before);assert.equal(fs.existsSync(f.audit),false);
});
test('exception commit preserves original fields, revokes only local ticket and persists authority retirement atomically',t=>{
  const f=fixture(t),original=JSON.parse(fs.readFileSync(f.b.file));const out=close(f),b=f.b.state.batches[BATCH];
  assert.equal(out.originalApplication,'UNCONFIRMED');assert.equal(out.classification,'C');assert.equal(out.externalPayloadRevoked,false);
  for(const k of ['planHash','edits','next','receipt','error','haltedFrom'])assert.deepEqual(b[k],original.batches[BATCH][k]);
  assert.deepEqual(f.b.state.batches.unrelated,original.batches.unrelated);assert.equal(f.b.state.active,null);
  assert.equal(f.b.state.caseExceptionControl.retiredOwnerId,f.m.retiredOwnerId);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.audit)).journalBefore,original);
  assert.equal(b.ticketDisposition.status,'REVOKED_LOCAL_ONLY');
  const before=tree(f.root);assert.equal(f.b.handle({...f.input,apply:true}).alreadyConsumed,true);assert.deepEqual(tree(f.root),before);
  f.restart();assert.equal(f.b.handle({...f.input,apply:true}).alreadyConsumed,true);
});
for(const [name,mutate,code] of [
  ['missing explicit risk acceptance',f=>delete f.input.approvalPath,'CASE_APPROVAL_REQUIRED'],
  ['wrong approval digest',f=>f.input.approvedApprovalHash='0'.repeat(64),'CASE_PIN'],
  ['tampered original evidence',f=>fs.appendFileSync(path.join(f.root,'evidence.json'),' '),'CASE_PIN'],
  ['wrong case manifest',f=>f.input.batchId='another','CASE_CORRELATION'],
  ['changed revision',f=>f.input.page=page('BEFORE','2026-10-26T00:00:01Z'),'CASE_TARGET_CHANGED'],
  ['partial target application',f=>f.input.page=page('PARTIAL'),'CASE_TARGET_CHANGED'],
  ['applied target',f=>f.input.page=page('manual:synthetic-retired ACTIVE'),'CASE_TARGET_CHANGED'],
  ['extra application evidence',f=>write(f.receipt.snapshot+'.actual.json',{}),'CASE_OBSERVED_APPLICATION'],
  ['concurrent central owner',f=>f.input.ownerProof.conflicts=['actual-central-run'],'OWNERSHIP_FENCE'],
  ['different owner generation',f=>f.input.ownerProof.generation='other','CASE_OWNER_CONFLICT'],
  ['missing hook',f=>fs.unlinkSync(f.m.controls.roles[0].settings),undefined],
  ['changed original packet',f=>{fs.chmodSync(f.packet,0o600);fs.appendFileSync(f.packet,' changed');},'CASE_PIN']
])test('exception refuses '+name+' without changing canonical data',t=>{
  const f=fixture(t);mutate(f);f.restart();const before=tree(f.root);
  assert.throws(()=>f.b.handle({...f.input,apply:true}),e=>!code||e.code===code);assert.deepEqual(tree(f.root),before);
});
test('retired Router owner cannot obtain a new fenced operation or local ticket reuse',t=>{
  const f=fixture(t);close(f);const before=tree(f.root),edit={pageId:PAGE,heading,oldStr:'state=BEFORE',newStr:'state=NEXT'};
  assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'new',edits:[edit],ownerProof:{...f.proof(),ownerId:f.m.retiredOwnerId}}),e=>e.code==='RETIRED_CASE_AUTHORITY');
  assert.throws(()=>f.b.handle({action:'begin',batchId:'new',edits:[edit]}),e=>e.code==='OWNER_FENCED_RUNNER_REQUIRED');
  assert.throws(()=>f.b.handle({action:'authorize',batchId:BATCH,ticket:f.spec.ticket,page:page()}));
  assert.deepEqual(tree(f.root),before);
});
test('damaged retirement cannot release authority or be recreated by an old approval',t=>{
  const f=fixture(t);close(f);delete f.b.state.caseExceptionControl;f.b.save();const before=tree(f.root);
  assert.throws(()=>f.b.handle({...f.input,apply:true}),e=>e.code==='CASE_CONTROL_INVALID');
  assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'new',edits:[],ownerProof:f.proof()}),e=>e.code==='CASE_CONTROL_INVALID');assert.deepEqual(tree(f.root),before);
});
test('journal failure leaves barrier intact and restart resumes exact audit without duplicate writes',t=>{
  const f=fixture(t);f.restart();const before=fs.readFileSync(f.b.file,'utf8'),rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===f.b.file)throw Error('synthetic journal failure');return rename(from,to);};
  try{assert.throws(()=>f.b.handle({...f.input,apply:true}));}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(f.b.file,'utf8'),before);assert.equal(fs.existsSync(f.audit),true);
  f.restart();assert.equal(f.b.handle({...f.input,apply:true}).status,'CLOSED_EXCEPTION_UNCONFIRMED');
});
for(const tool of ['mcp__notion__notion-update-page','mcp__claude_ai_Notion__notion-update-page','mcp__notion__update_page'])
for(const id of [PAGE,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','https://app.notion.com/p/'+PAGE])
test('actual hook entry rejects protected write without permit: '+tool+' '+id,t=>{
  const f=fixture(t);close(f);assert.throws(()=>gate(f.c,f.configHash,{tool_name:tool,tool_input:{page_id:id,command:'update_properties',properties:{'작업 상태':'CLAIM'}},cwd:f.dir},'operator'),e=>e.code==='CASE_PERMIT_MISSING');
});
test('unknown native target fails closed while unrelated tasks and native reads continue',t=>{
  const f=fixture(t);close(f);
  assert.throws(()=>gate(f.c,f.configHash,{tool_name:'mcp__notion__notion-update-page',tool_input:{unexpected:PAGE}},'operator'),e=>e.code==='CASE_TARGET_UNKNOWN');
  assert.equal(gate(f.c,f.configHash,{tool_name:'mcp__notion__notion-update-page',tool_input:{page_id:OTHER}},'operator').unrelated,true);
  assert.equal(gate(f.c,f.configHash,{tool_name:'mcp__notion__notion-fetch',tool_input:{id:PAGE}},'operator').unrelated,true);
});
test('valid canonical admission survives stale Router text; old text alone cannot create it',t=>{
  const f=fixture(t);close(f);
  assert.throws(()=>permit(f.c,f.configHash,'operator'));
  installSyntheticAdmission(f);const event={tool_name:'mcp__notion__notion-update-page',tool_input:{page_id:PAGE,
    properties:{'Authority Snapshot':'Router stale manual:synthetic-retired ACTIVE; use current canonical admission'}}};
  assert.equal(gate(f.c,f.configHash,event,'operator').issuer,f.authority.ownerId);
  assert.throws(()=>f.b.ownerProof({...f.proof(),ownerId:f.m.retiredOwnerId}),e=>e.code==='RETIRED_CASE_AUTHORITY');
  assert.throws(()=>permit(f.c,f.configHash,'guardrail'));
  f.b.state.caseExceptionControl.authority.generation='replacement';f.b.save();assert.throws(()=>permit(f.c,f.configHash,'operator'));
});
test('hook command exits 2 on denial and never returns permissionDecision allow',t=>{
  const f=fixture(t);close(f);const args=[path.join(__dirname,'case_gate.cjs'),'hook','--config',f.configPath,'--config-sha256',f.configHash,'--role','operator'];
  const input=JSON.stringify({tool_name:'mcp__notion__notion-update-page',tool_input:{page_id:PAGE}});
  const denied=cp.spawnSync(process.execPath,args,{input,encoding:'utf8'});assert.equal(denied.status,2);
  installSyntheticAdmission(f);const allowed=cp.spawnSync(process.execPath,args,{input,encoding:'utf8'});assert.equal(allowed.status,0);
  assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision,undefined);
});
test('targeted worker launch fails before systemctl without a canonical admission',t=>{
  const f=fixture(t);close(f);const r=cp.spawnSync(process.execPath,[path.join(__dirname,'case_gate.cjs'),'targeted-start',
    '--config',f.configPath,'--config-sha256',f.configHash,'--role','operator','--target-page',PAGE],{encoding:'utf8'});
  assert.equal(r.status,2);assert.match(r.stderr,/CASE_PERMIT_MISSING/);assert.equal(r.stdout,'');
});
test('the current recovery owner cannot use the exception to start unrelated batches',t=>{
  const f=fixture(t);close(f);assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'unapproved',edits:[f.admissionEdit],
    ownerProof:{...f.proof(),scope:'unapproved'}}),e=>e.code==='CASE_SCOPE');
});
test('an approved admission ID cannot export a different plan',t=>{
  const f=fixture(t);close(f);const before=tree(f.root);
  assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'synthetic-admission',
    edits:[{...f.admissionEdit,newStr:'state=UNAPPROVED'}],ownerProof:{...f.proof(),scope:'synthetic-admission'}}),e=>e.code==='CASE_SCOPE');
  assert.deepEqual(tree(f.root),before);
});
test('a damaged closed ticket is rejected rather than hidden as an idempotent replay',t=>{
  const f=fixture(t);close(f);f.b.state.batches[BATCH].ticketDisposition.status='ACTIVE';f.b.save();
  const before=tree(f.root);assert.throws(()=>f.b.handle({...f.input,apply:true}),e=>e.code==='CASE_CONTROL_INVALID');assert.deepEqual(tree(f.root),before);
});
for(const field of ['approvalBytes','freshPage','audit'])test('replay rejects tampered saved '+field,t=>{
  const f=fixture(t);close(f);const a=JSON.parse(fs.readFileSync(f.audit));
  if(field==='approvalBytes')a.approvalBytes+=' ';
  if(field==='freshPage')a.freshPage=page('PARTIAL');
  if(field==='audit')a.audit.classification='A';write(f.audit,a);const before=tree(f.root);
  assert.throws(()=>f.b.handle({...f.input,apply:true}),e=>['CASE_AUDIT_CHANGED','CASE_CONTROL_INVALID'].includes(e.code));assert.deepEqual(tree(f.root),before);
});
test('positive canonical dispatch evidence refuses risk closure',t=>{
  const f=fixture(t);f.restart();f.b.state.batches[BATCH].dispatch={phase:'SEND_INTENT'};f.b.save();
  const before=tree(f.root);assert.throws(()=>f.b.handle({...f.input,apply:true}),e=>e.code==='CASE_ORIGINAL_CHANGED');assert.deepEqual(tree(f.root),before);
});
test('admission save failure does not leave an in-memory grant',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);f.b.state.caseExceptionControl.admission=null;f.b.save();
  const before=fs.readFileSync(f.b.file,'utf8'),rename=fs.renameSync;
  fs.renameSync=(a,b)=>{if(b===f.b.file)throw Error('synthetic save failure');return rename(a,b);};
  try{assert.throws(()=>f.b.handle({action:'record_case_admission',ownerProof:f.proof(),batchIds:['synthetic-admission']}));}finally{fs.renameSync=rename;}
  assert.equal(f.b.state.caseExceptionControl.admission,null);assert.equal(fs.readFileSync(f.b.file,'utf8'),before);assert.throws(()=>permit(f.c,f.configHash,'operator'));
});
test('release save failure keeps memory and disk exclusive and blocks subsequent unapproved work',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const before=fs.readFileSync(f.b.file,'utf8'),rename=fs.renameSync;
  fs.renameSync=(a,b)=>{if(b===f.b.file)throw Error('synthetic release failure');return rename(a,b);};
  try{assert.throws(()=>f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:claimPage(f)}));}finally{fs.renameSync=rename;}
  assert.equal(f.b.state.caseExceptionControl.exclusive,true);assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
  assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'unapproved',edits:[f.admissionEdit],ownerProof:{...f.proof(),scope:'unapproved'}}),e=>e.code==='CASE_SCOPE');
});
test('two real exception processes serialize one terminal disposition',async t=>{
  const f=fixture(t);f.b.close();const input=path.join(f.dir,'input.json');write(input,f.input);
  const args=[path.join(__dirname,'recover_exception.cjs'),'--apply','--manifest',f.input.manifestPath,
    '--approved-manifest-sha256',f.input.approvedManifestHash,'--input',input,'--approval',f.input.approvalPath,
    '--approved-approval-sha256',f.input.approvedApprovalHash];
  const run=()=>new Promise(resolve=>{const p=cp.spawn(process.execPath,args);let out='';p.stdout.on('data',d=>out+=d);p.on('close',status=>resolve({status,out}));});
  const results=await Promise.all([run(),run()]);assert.ok(results.some(r=>r.status===0),JSON.stringify(results));
  const j=JSON.parse(fs.readFileSync(path.join(f.root,'journal.json')));assert.equal(j.active,null);assert.equal(j.batches[BATCH].status,'CLOSED_EXCEPTION_UNCONFIRMED');
  assert.equal(j.caseExceptionControl.retiredOwnerId,f.m.retiredOwnerId);assert.equal(fs.existsSync(path.join(f.root,'broker.lock')),false);
  assert.deepEqual(j.batches[BATCH].receipt,JSON.parse(fs.readFileSync(f.audit)).journalBefore.batches[BATCH].receipt);
});
test('admission rejects a completed batch with a different planned scope',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);f.b.state.caseExceptionControl.admission=null;
  f.b.state.batches['synthetic-admission'].planHash='f'.repeat(64);f.b.save();
  assert.throws(()=>f.b.handle({action:'record_case_admission',ownerProof:f.proof(),batchIds:['synthetic-admission']}),e=>e.code==='CASE_ADMISSION');
});
test('recovery exclusivity is released only after a fresh actual source CLAIM observation',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);
  assert.throws(()=>f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:page()}),e=>e.code==='CASE_OWN_CLAIM_REQUIRED');
  const p=claimPage(f);
  assert.equal(f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:p}).released,true);
  assert.equal(f.b.state.caseExceptionControl.exclusive,false);assert.equal(permit(f.c,f.configHash,'operator').issuer,f.authority.ownerId);
});
for(const state of ['completed','in_progress'])test('actual central ownership adapter consumes canonical authority and observed run '+state,async t=>{
  const f=fixture(t);close(f);const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'central_case_owner.js'),'utf8'));
  let reads=0;
  const fn=factory({mcp__codex_apps__automations_peek:async()=>{reads++;return {structuredContent:{structuredContent:{automations:[{id:'synthetic-central',run_details:{last_run:{id:'synthetic-run',recorded_status:state}}}]}}};}},
    async()=>f.b.state.caseExceptionControl,{centralTaskId:'synthetic-central',actor:{kind:'manual',...f.authority},
      assertPrerequisites:async({batchId})=>({allowed:true,batchId,observedAt:new Date().toISOString()})});
  const proof=await fn({batchId:BATCH});assert.equal(reads,1);
  if(state==='completed')assert.equal(f.b.ownerProof(proof).ownerId,f.authority.ownerId);
  else assert.throws(()=>f.b.ownerProof(proof),e=>e.code==='OWNERSHIP_FENCE');
});
test('central adapter refuses missing prerequisite checks and a retired marker as actor',async t=>{
  const f=fixture(t);close(f);const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'central_case_owner.js'),'utf8'));
  const tools={mcp__codex_apps__automations_peek:async()=>({structuredContent:{automations:[{id:'synthetic-central',run_details:{last_run:{id:'run',recorded_status:'completed'}}}]}})};
  const base={centralTaskId:'synthetic-central',actor:{kind:'manual',ownerId:f.m.retiredOwnerId,generation:'old'}};
  await assert.rejects(factory(tools,async()=>f.b.state.caseExceptionControl,base)({batchId:BATCH}),/PREREQUISITES_CAPABILITY_REQUIRED/);
  await assert.rejects(factory(tools,async()=>f.b.state.caseExceptionControl,{...base,assertPrerequisites:async({batchId})=>({allowed:true,batchId,observedAt:new Date().toISOString()})})({batchId:BATCH}),/CASE_OWNER_CONFLICT/);
});
for(const [delay,lease] of [[61000,120000],[3000,2000]])test('delayed central reply cannot renew prerequisite freshness '+delay,async t=>{
  const f=fixture(t);close(f);let clock=Date.now();class FakeDate extends Date{static now(){return clock;}}
  const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'central_case_owner.js'),'utf8'),{Date:FakeDate});
  const fn=factory({mcp__codex_apps__automations_peek:async()=>{clock+=delay;return {structuredContent:{automations:[{
    id:'synthetic-central',run_details:{last_run:{id:'run',recorded_status:'completed'}}}]}};}},async()=>f.b.state.caseExceptionControl,
    {centralTaskId:'synthetic-central',actor:{kind:'manual',...f.authority},assertPrerequisites:async({batchId})=>({
      allowed:true,batchId,observedAt:new Date(clock).toISOString(),validUntil:new Date(clock+lease).toISOString()})});
  await assert.rejects(fn({batchId:BATCH}),/PREREQUISITES_NOT_CURRENT/);
});
for(const target of ['plan','packet','completed-edits'])test('canonical permit rejects tampered '+target+' binding',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const c=f.b.state.caseExceptionControl;
  if(target==='plan')c.admissionPlanHashes['synthetic-admission']='1'.repeat(64);
  if(target==='packet'){
    const other=path.join(f.dir,'OTHER-PACKET');write(other,'different source');
    c.worker.packetPath=other;c.worker.packetHash=hash('different source');c.admission.packetHash=c.worker.packetHash;
  }
  if(target==='completed-edits')f.b.state.batches['synthetic-admission'].edits[0].newStr='state=OTHER';
  f.b.save();assert.throws(()=>permit(f.c,f.configHash,'operator'),e=>['CASE_CONTROL_INVALID','CASE_PERMIT_INVALID'].includes(e.code));
});
test('saved intake observation resumes after its original freshness window without fabricating a new CLAIM',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const source=claimPage(f),rename=fs.renameSync;
  fs.renameSync=(a,b)=>{if(b===f.b.file)throw Error('synthetic release journal failure');return rename(a,b);};
  try{assert.throws(()=>f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:source}));}finally{fs.renameSync=rename;}
  f.restart();const now=Date.now,advanced=now()+600001;Date.now=()=>advanced;
  try{
    const proof={...f.proof(),observedAt:new Date(advanced).toISOString(),validUntil:new Date(advanced+60000).toISOString()};
    const result=f.b.handle({action:'release_case_owner',ownerProof:proof,page:source});assert.equal(result.released,true);
    assert.equal(f.b.state.caseExceptionControl.actualIntakeObservation.sourceHash,hash(JSON.stringify(source)));
  }finally{Date.now=now;}
});
function successorFixture(t,changeBefore=()=>{}) {
  const f=fixture(t);close(f);
  const id='synthetic-admission',ownerProof={...f.proof(),scope:id};
  const begin=f.b.handle({action:'fence_begin',batchId:id,edits:[f.admissionEdit],ownerProof});
  f.b.handle({action:'fence_halt',batchId:id,executor:begin.executor,planHash:begin.planHash,reason:'Synthetic pre-prepare freshness failure'});
  f.b.handle({action:'fence_recover_unsent',batchId:id,ownerProof,apply:true,
    planHash:begin.planHash,ticket:null,snapshotHash:null,expectedPhase:'UNSENT',
    expectedError:f.b.state.batches[id].error,journalHash:hash(fs.readFileSync(f.b.file,'utf8'))});
  changeBefore(f);f.b.save();
  const previousControls=f.m.controls.files.map((x,i)=>{
    const backupPath=path.join(f.backup,'case-control-'+i);write(backupPath,fs.readFileSync(x.path,'utf8'));
    return {originalPath:x.path,sha256:x.sha256,backupPath};
  });
  const referencePath=path.join(f.dir,'successor-preimages.json');write(referencePath,[{pageId:PAGE,page:page()}]);
  const supplement={schema:'EXACT_CASE_SUCCESSOR_V1',root:f.root,batchId:BATCH,sourceHead:'d'.repeat(40),
    originalManifestHash:f.input.approvedManifestHash,gateConfigHash:f.configHash,
    journalHash:hash(fs.readFileSync(f.b.file,'utf8')),predecessor:{batchId:id,batchHash:hash(JSON.stringify(f.b.state.batches[id]))},
    nextAttempt:{batchId:'synthetic-admission-retry',planHash:begin.planHash},
    referencePages:{path:referencePath,sha256:hash(fs.readFileSync(referencePath,'utf8'))},
    controls:structuredClone(f.m.controls),previousControls};
  const supplementPath=path.join(f.dir,'successor.json'),approvalPath=path.join(f.dir,'successor-approval.json');
  const input={action:'authorize_case_successor',batchId:BATCH,apply:false,supplementPath,approvalPath,
    ownerProof:f.proof(),pages:[{pageId:PAGE,page:page()}]};
  const sign=()=>{
    write(supplementPath,supplement);input.approvedSupplementHash=hash(JSON.stringify(supplement));
    write(approvalPath,{schema:'CASE_SUCCESSOR_APPROVAL_V1',status:'APPROVED',sourceHead:supplement.sourceHead,
      supplementHash:input.approvedSupplementHash,preservesOriginalUncertainty:true,freshnessMs:30000,sendPermitMs:15000,
      userMessageReference:'synthetic separate exact-head operational approval'});
    input.approvedApprovalHash=hash(fs.readFileSync(approvalPath,'utf8'));
  };
  sign();return Object.assign(f,{supplement,successorInput:input,sign,
    successorAudit:path.join(f.root,hash(BATCH)+'.successor-authorization.json')});
}
const authorize=f=>f.b.handle({...f.successorInput,apply:true,ownerProof:f.proof()});
test('one-case successor check-only is read-only and commit preserves all prior records and retired IDs',t=>{
  const f=successorFixture(t),before=JSON.parse(fs.readFileSync(f.b.file)),files=tree(f.root);
  f.restart(false);assert.equal(f.b.handle(f.successorInput).eligiblePendingApproval,true);assert.deepEqual(tree(f.root),files);
  f.restart();const out=authorize(f);assert.equal(out.authorized,true);assert.equal(out.workerClaimCreated,false);
  assert.deepEqual(f.b.state.batches,before.batches);
  const c=f.b.state.caseExceptionControl;for(const key of Object.keys(before.caseExceptionControl))assert.deepEqual(c[key],before.caseExceptionControl[key]);
  assert.equal(c.admission,null);assert.equal(c.exclusive,true);assert.equal(f.b.state.active,null);
  const parent=before.batches['synthetic-admission'];assert.equal(parent.status,'ABORTED_UNWRITTEN');assert.equal(parent.error,'Synthetic pre-prepare freshness failure');
  const snapshot=tree(f.root);assert.equal(authorize(f).alreadyAuthorized,true);assert.deepEqual(tree(f.root),snapshot);
  f.restart();assert.equal(authorize(f).alreadyAuthorized,true);
  assert.throws(()=>f.b.handle({action:'fence_begin',batchId:'synthetic-admission',edits:[f.admissionEdit],ownerProof:{...f.proof(),scope:'synthetic-admission'}}),e=>e.code==='CASE_SCOPE');
  assert.throws(()=>f.b.handle({action:'authorize',batchId:BATCH,ticket:f.spec.ticket,page:page()}));
  assert.equal(installSyntheticAdmission(f,f.supplement.nextAttempt.batchId).admitted,true);
  assert.equal(permit(f.c,f.configHash,'operator').issuer,f.authority.ownerId);
  assert.equal(f.b.state.batches[BATCH].exceptionDisposition.originalApplication,'UNCONFIRMED');
});
for(const [name,change] of [
  ['active batch',f=>f.b.state.active='synthetic-admission'],
  ['admitted worker',f=>f.b.state.caseExceptionControl.admission={forged:true}],
  ['sent attempt',f=>f.b.state.batches['synthetic-admission'].dispatch.attempts=[{phase:'SEND_INTENT'}]],
  ['partial application',f=>f.b.state.batches['synthetic-admission'].next=1],
  ['pending ticket',f=>f.b.state.batches['synthetic-admission'].receipt={ticket:'old-ticket'}],
  ['provider observation',f=>f.b.state.batches['synthetic-admission'].dispatch.provider={status:'UNKNOWN'}],
  ['unrevoked executor',f=>f.b.state.batches['synthetic-admission'].dispatch.revoked=false],
  ['wrong status',f=>f.b.state.batches['synthetic-admission'].status='HALTED'],
  ['wrong phase',f=>f.b.state.batches['synthetic-admission'].dispatch.phase='ACKNOWLEDGED'],
  ['different parent owner',f=>f.b.state.batches['synthetic-admission'].dispatch.owner.generation='different'],
  ['missing terminal audit',f=>f.b.state.batches['synthetic-admission'].reconciliations=[]]
])test('successor rejects '+name+' even in an exactly pinned new supplement',t=>{
  const f=successorFixture(t,change),before=tree(f.root);assert.throws(()=>authorize(f));assert.deepEqual(tree(f.root),before);
});
for(const [name,change] of [
  ['different case',f=>f.supplement.batchId='other-case'],
  ['different parent',f=>f.supplement.predecessor.batchId='unrelated'],
  ['different plan',f=>f.supplement.nextAttempt.planHash='0'.repeat(64)],
  ['closed ID reuse',f=>f.supplement.nextAttempt.batchId='synthetic-admission'],
  ['original ID reuse',f=>f.supplement.nextAttempt.batchId=BATCH],
  ['policy change',f=>f.supplement.controls.files.push({path:'/different-policy',sha256:'f'.repeat(64)})],
  ['role hook change',f=>f.supplement.controls.roles[0].hookCommand+=' bypass'],
  ['changed backup pin',f=>f.supplement.previousControls[0].sha256='f'.repeat(64)]
])test('successor refuses approved supplement with '+name,t=>{
  const f=successorFixture(t);change(f);f.sign();const before=tree(f.root);assert.throws(()=>authorize(f));assert.deepEqual(tree(f.root),before);
});
for(const [name,change,code] of [
  ['changed body',f=>f.successorInput.pages[0].page=page('PARTIAL'),'CASE_TARGET_CHANGED'],
  ['changed revision',f=>f.successorInput.pages[0].page=page('BEFORE','2026-10-26T00:00:01Z'),'CASE_TARGET_CHANGED'],
  ['missing approval',f=>delete f.successorInput.approvalPath,'CASE_APPROVAL_REQUIRED'],
  ['approval tamper',f=>fs.appendFileSync(f.successorInput.approvalPath,' '),'CASE_PIN'],
  ['supplement tamper',f=>fs.appendFileSync(f.successorInput.supplementPath,' '),'CASE_PIN'],
  ['concurrent central',f=>f.proof=()=>({...f.input.ownerProof,conflicts:['actual-other-run']}),'OWNERSHIP_FENCE']
])test('successor rejects '+name+' without a journal or audit change',t=>{
  const f=successorFixture(t);change(f);const before=tree(f.root);
  assert.throws(()=>authorize(f),e=>e.code===code);assert.deepEqual(tree(f.root),before);
});
for(const target of ['audit','journal'])test('successor '+target+' save failure preserves canonical state and exact restart resumes once',t=>{
  const f=successorFixture(t),before=fs.readFileSync(f.b.file,'utf8'),rename=fs.renameSync;
  fs.renameSync=(a,b)=>{if(b===(target==='audit'?f.successorAudit:f.b.file))throw Error('synthetic '+target+' save failure');return rename(a,b);};
  try{assert.throws(()=>authorize(f));}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(f.b.file,'utf8'),before);assert.equal(f.b.state.caseExceptionControl.successor,undefined);
  f.restart();assert.equal(authorize(f).authorized,true);const files=tree(f.root);
  f.restart();assert.equal(authorize(f).alreadyAuthorized,true);assert.deepEqual(tree(f.root),files);
});
test('a second successor and tampered audit are rejected; concurrent executor cannot authorize',t=>{
  const f=successorFixture(t);assert.throws(()=>new Broker(f.root,policy),e=>e.code==='LOCKED');authorize(f);
  f.supplement.nextAttempt.batchId='third-attempt';f.sign();const before=tree(f.root);
  assert.throws(()=>authorize(f),e=>e.code==='CASE_SUCCESSOR_ALREADY_AUTHORIZED');assert.deepEqual(tree(f.root),before);
  fs.appendFileSync(f.successorAudit,' ');
  assert.throws(()=>permit(f.c,f.configHash,'operator'),e=>e.code==='CASE_PIN');
});
test('two successor processes persist one authorization and leave no duplicate admission',async t=>{
  const f=successorFixture(t),input=path.join(f.dir,'successor-input.json');write(input,{...f.successorInput,apply:true});f.b.close();
  const script='const fs=require("node:fs"),{Broker}=require('+JSON.stringify(path.join(__dirname,'broker.cjs'))+');'+
    'let b;try{b=new Broker('+JSON.stringify(f.root)+','+JSON.stringify(policy)+',{existingOnly:true});'+
    'console.log(JSON.stringify(b.handle(JSON.parse(fs.readFileSync(process.argv[1],"utf8")))))}'+
    'catch(e){console.log(JSON.stringify({error:e.code??e.message}));process.exitCode=1}finally{b?.close()}';
  const run=()=>new Promise(resolve=>{const p=cp.spawn(process.execPath,['-e',script,input]);let out='';p.stdout.on('data',x=>out+=x);p.on('close',status=>resolve({status,out}));});
  const results=await Promise.all([run(),run()]);assert.ok(results.some(x=>x.status===0),JSON.stringify(results));
  const state=JSON.parse(fs.readFileSync(path.join(f.root,'journal.json')));
  assert.equal(state.active,null);assert.equal(state.caseExceptionControl.admission,null);
  assert.equal(state.batches[f.supplement.nextAttempt.batchId],undefined);
  assert.equal(state.batches['synthetic-admission'].status,'ABORTED_UNWRITTEN');
  assert.equal(fs.existsSync(path.join(f.root,'broker.lock')),false);f.restart();
  assert.equal(authorize(f).alreadyAuthorized,true);
});
test('successor requires the new three-line checksum to match pinned broker, runner and unchanged policy',t=>{
  const f=successorFixture(t),approved=f.supplement.controls.files.find(x=>path.basename(x.path)==='approved.sha256');
  fs.writeFileSync(approved.path,'0'.repeat(64)+'  broker.cjs\n');approved.sha256=hash(fs.readFileSync(approved.path,'utf8'));f.sign();
  const before=tree(f.root);assert.throws(()=>authorize(f),e=>e.code==='CASE_SUCCESSOR_CONTROLS');assert.deepEqual(tree(f.root),before);
});
test('new real lease cannot release recovery on a mismatched native own session',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const p=claimPage(f);
  p.structuredContent.text=p.structuredContent.text.replace('"세션 ID":"new-synthetic-worker"','"세션 ID":"other-worker"');
  assert.throws(()=>f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:p}),e=>e.code==='CASE_OWN_CLAIM_REQUIRED');
});
for(const [field,native,value] of [['event_id','이벤트 ID',''],['event_id','이벤트 ID','   '],
  ['session_id','세션 ID',''],['session_id','세션 ID','   '],
  ['event_id','이벤트 ID',undefined],['session_id','세션 ID',undefined]])
test('matching empty own identity cannot release recovery '+field+JSON.stringify(value),t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const p=claimPage(f),text=p.structuredContent.text;
  const props=JSON.parse(text.match(/<properties>\n([\s\S]*?)\n<\/properties>/)[1]);
  const event=JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)[1]);props[native]=value;event.QUEUE_EVENT_V1[field]=value;
  p.structuredContent.text='<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n```json\n'+JSON.stringify(event)+'\n```\n</content>';
  assert.throws(()=>f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:p}),e=>e.code==='CASE_OWN_CLAIM_REQUIRED');
  assert.equal(f.b.state.caseExceptionControl.exclusive,true);
});
for(const lease of ['HELD','ACTIVE'])test('actual '+lease+' until protocol permits a fresh own CLAIM and release',t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const p=claimPage(f);
  p.structuredContent.text=p.structuredContent.text.replace('HELD until',lease+' until');
  assert.equal(f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:p}).released,true);
});
for(const value of ['CLAIM_HELD','RELEASED','HELD until 2026-02-30T01:00:00Z','ACTIVE until yesterday','HELD until 2020-01-01T00:00:00Z'])
test('own CLAIM refuses invalid or expired lease '+value,t=>{
  const f=fixture(t);close(f);installSyntheticAdmission(f);const p=claimPage(f);
  p.structuredContent.text=p.structuredContent.text.replace(/HELD until [^\"]+/,value);
  assert.throws(()=>f.b.handle({action:'release_case_owner',ownerProof:f.proof(),page:p}),e=>e.code==='CASE_OWN_CLAIM_REQUIRED');
  assert.equal(f.b.state.caseExceptionControl.exclusive,true);
});
test('canonical RPC delay precedes fresh prerequisites and cannot consume or renew their evidence window',async t=>{
  const f=fixture(t);close(f);let clock=Date.now();class FakeDate extends Date{static now(){return clock;}}
  const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'central_case_owner.js'),'utf8'),{Date:FakeDate});
  const order=[];
  const fn=factory({mcp__codex_apps__automations_peek:async()=>{order.push('central');return {structuredContent:{automations:[{
    id:'synthetic-central',run_details:{last_run:{id:'run',recorded_status:'completed'}}}]}};}},async()=>{
      order.push('canonical');clock+=24000;return f.b.state.caseExceptionControl;},
    {centralTaskId:'synthetic-central',actor:{kind:'manual',...f.authority},assertPrerequisites:async({batchId,canonical})=>{
      order.push('prerequisites');assert.equal(canonical.manifestHash,f.input.approvedManifestHash);
      const at=clock;clock+=5000;return {allowed:true,batchId,observedAt:new Date(at).toISOString()};}});
  const proof=await fn({batchId:BATCH});assert.deepEqual(order,['canonical','prerequisites','central']);
  assert.equal(Date.parse(proof.observedAt),clock-5000);assert.equal(Date.parse(proof.validUntil),clock+15000);
});
module.exports={fixture,close,installSyntheticAdmission,successorFixture};
