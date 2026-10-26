'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {Broker,hash,assessUnwrittenExecution}=require('./broker.cjs');
const A='a'.repeat(32),BATCH='synthetic-post-authorize-veto';
const heading='## CURRENT CENTRAL OBSERVATION · synthetic incident';
const error='Synthetic scoped owner conflict';
const policy={productionEnabled:true,productionPages:[A],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
function page(value='BEFORE',props={title:'Synthetic'},revision='2026-10-26T00:00:00Z') {
  return {structuredContent:{id:A,page_last_edited_at:revision,text:'<properties>\n'+JSON.stringify(props)+
    '\n</properties>\n<content>\n'+heading+'\nstate='+value+'\n## WORKER PROOF\nuntouched\n</content>'}};
}
function privateWrite(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
}
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-unwritten-')),root=path.join(dir,'state'),runtime=path.join(dir,'runtime');
  fs.mkdirSync(runtime,{mode:0o700});const b=new Broker(root,policy);
  const edit={pageId:A,heading,oldStr:'state=BEFORE',newStr:'state=AFTER'};
  b.handle({action:'begin',batchId:BATCH,edits:[edit]});
  const receipt=b.handle({action:'prepare',batchId:BATCH,page:page()});b.handle({action:'authorize',batchId:BATCH,ticket:receipt.ticket,page:page()});
  b.handle({action:'halt',batchId:BATCH,reason:error});b.state.batches.unrelated={status:'COMPLETED',proof:'preserved'};b.save();
  const batch=b.state.batches[BATCH],adapterSource='synthetic adapter: gate rejected before native mutation';
  const evidence={incident:BATCH,facts:{notionMutationInvoked:false},adapterSource};privateWrite(path.join(root,'evidence.json'),evidence);
  const pins={};for(const [n,bytes] of Object.entries({'broker.cjs':'synthetic pinned installed broker','runner.js':'synthetic pinned installed runner',
    'policy.json':JSON.stringify(policy),'approved.sha256':'synthetic pinned manifest'})) {
    privateWrite(path.join(runtime,n),bytes);fs.chmodSync(path.join(runtime,n),0o444);pins[n]=hash(bytes);
  }
  privateWrite(path.join(root,'installation.json'),{sourceCommit:'b'.repeat(40),policyChanged:false,workerServicesChanged:false,after:pins});
  const spec={schema:'EXACT_UNWRITTEN_CASE_V1',recoveryKind:'POST_AUTHORIZE_PRE_INVOKE_VETO',root,runtime,batchId:BATCH,
    planHash:batch.planHash,ticket:receipt.ticket,snapshotHash:batch.receipt.snapshotHash,journalHash:hash(fs.readFileSync(b.file,'utf8')),
    evidence:'evidence.json',evidenceHash:hash(JSON.stringify(evidence)),adapterHash:hash(adapterSource),error,
    caller:{conversationId:'synthetic-conversation',responseMessageId:'synthetic-response'},authorizationRequestId:'synthetic-authorize-request',
    installation:'installation.json',installationHash:hash(fs.readFileSync(path.join(root,'installation.json'),'utf8')),sourceCommit:'b'.repeat(40),pins};
  const manifestPath=path.join(dir,'case.json');privateWrite(manifestPath,spec);b.close();let engine=new Broker(root,policy,{readOnly:true,existingOnly:true});
  t.after(()=>{if(!engine.closed)engine.close();fs.rmSync(dir,{recursive:true,force:true});});
  // Every source below is explicitly synthetic; it is not production evidence.
  const sourceRecords={invocation:JSON.stringify({synthetic:true,id:'synthetic-invocation',status:'FAILED',resumable:false}),
    calls:JSON.stringify({synthetic:true,authorizeReturned:true,nativeMutationCalls:[],childDispatch:[]})};
  const trace={schema:'REVIEWED_CODE_MODE_TRACE_V1',purpose:'NOTION_MUTATION',
    provenance:{layer:'CODE_MODE_CONTROL_PLANE',independentReviewer:'synthetic-independent-reviewer',
      sourceRecords:Object.entries(sourceRecords).map(([key,bytes])=>({key,sha256:hash(bytes)}))},
    subject:{batchId:BATCH,planHash:spec.planHash,ticket:spec.ticket,snapshotHash:spec.snapshotHash,
      ...spec.caller,invocationId:'synthetic-invocation'},
    invocation:{id:'synthetic-invocation',status:'FAILED',resumable:false,terminalEventId:'terminal'},
    coverage:{fromAuthorizationRequestId:spec.authorizationRequestId,complete:true,throughTerminal:true,
      nativeMutationCalls:true,transportHandoffs:true,childDispatchRoutes:true},
    events:[{id:'authorize',sequence:1,invocationId:'synthetic-invocation',kind:'AUTHORIZE_RETURNED',
      requestId:spec.authorizationRequestId,ticket:spec.ticket,sourceRecord:'calls'},
      {id:'veto',sequence:2,invocationId:'synthetic-invocation',kind:'PRE_INVOKE_VETO',error,sourceRecord:'calls'},
      {id:'terminal',sequence:3,invocationId:'synthetic-invocation',kind:'INVOCATION_TERMINAL',status:'FAILED',
        resumable:false,at:'2026-10-26T01:00:00Z',sourceRecord:'invocation'}]};
  const input={action:'reconcile_verified_unsent',batchId:BATCH,apply:false,page:page(),manifestPath,
    approvedManifestHash:hash(fs.readFileSync(manifestPath,'utf8')),sourceRecords,
    rawExecutionTrace:JSON.stringify(trace),approvedEvidenceHash:hash(JSON.stringify(trace)),
    ownerProof:{ownerId:'manual:synthetic-recovery',scope:BATCH,generation:'fresh',prerequisites:true,conflicts:[],
      evidenceHash:'a'.repeat(64),observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString()}};
  return {dir,root,runtime,spec,input,receipt,manifestPath,get b(){return engine;},
    mutateTrace(fn){const x=JSON.parse(input.rawExecutionTrace);fn(x);input.rawExecutionTrace=JSON.stringify(x);input.approvedEvidenceHash=hash(input.rawExecutionTrace);},
    restart(apply=false){engine.close();engine=new Broker(root,policy,{readOnly:!apply,existingOnly:true});return engine;},
    audit:path.join(root,hash(BATCH)+'.verified-unsent-closure.json')};
}
const inventory=root=>Object.fromEntries(fs.readdirSync(root).sort().map(n=>[n,hash(fs.readFileSync(path.join(root,n),'utf8'))]));
function unchanged(f,fn,code) {
  const files=inventory(f.root),runtime=inventory(f.runtime);assert.throws(fn,e=>!code||e.code===code);
  assert.deepEqual(inventory(f.root),files);assert.deepEqual(inventory(f.runtime),runtime);
}
test('A: ended original invocation with no native/transport/child sends needs no additional hypothetical fencing',t=>{
  const f=fixture(t),before=inventory(f.root),out=f.b.handle(f.input);
  assert.equal(out.assessment.classification,'A');assert.equal(out.eligible,true);assert.deepEqual(inventory(f.root),before);
  assert.equal(fs.existsSync(path.join(f.root,'broker.lock')),false);assert.equal(fs.existsSync(f.audit),false);
});
test('A apply is terminal unwritten, retains original fields and ticket, and repeated apply adds no writes',t=>{
  const f=fixture(t),before=JSON.parse(fs.readFileSync(path.join(f.root,'journal.json')));f.restart(true);
  assert.equal(f.b.handle({...f.input,apply:true}).status,'ABORTED_UNWRITTEN');assert.equal(f.b.state.active,null);
  const b=f.b.state.batches[BATCH];for(const k of ['planHash','edits','next','receipt','error','haltedFrom'])assert.equal(JSON.stringify(b[k]),JSON.stringify(before.batches[BATCH][k]));
  assert.equal(b.ticketDisposition.status,'REVOKED_UNSENT');assert.deepEqual(f.b.state.batches.unrelated,before.batches.unrelated);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.audit)).journalBefore,before);
  const files=inventory(f.root);assert.equal(f.b.handle({...f.input,apply:true}).alreadyConsumed,true);assert.deepEqual(inventory(f.root),files);
  assert.throws(()=>f.b.handle({action:'authorize',batchId:BATCH,ticket:f.spec.ticket,page:page()}),e=>e.code==='BATCH');
  f.restart(true);assert.equal(f.b.handle({...f.input,apply:true}).alreadyConsumed,true);
});
for(const kind of ['NATIVE_MUTATION_INVOKED','TRANSPORT_HANDOFF','SEND_RESULT_UNKNOWN','DISPATCH_PROCESS_CREATED',
  'ASYNC_MUTATION_CREATED','QUEUED_MUTATION','DEFERRED_MUTATION'])
test('B: actual '+kind+' rejects no-send closure even when negative coverage is incomplete',t=>{
  const f=fixture(t);f.mutateTrace(x=>{x.coverage.complete=false;x.events.splice(2,0,{id:'actual-route',sequence:3,
    invocationId:x.invocation.id,kind,sourceRecord:'calls',taskId:'synthetic-actual-route'});x.events[3].sequence=4;});
  const a=assessUnwrittenExecution(f.spec,f.input);assert.equal(a.classification,'B');assert.equal(a.riskObserved,true);
  unchanged(f,()=>f.b.handle(f.input),'RECOVERY_OBSERVED_DISPATCH_OR_EXECUTOR');
});
for(const kind of ['EXECUTOR_RUNNING','EXECUTOR_RESUMABLE']) {
  test('A: historical '+kind+' is consumed by a later same-invocation terminal',t=>{
    const f=fixture(t);f.mutateTrace(x=>{x.events.splice(2,0,{id:'running',sequence:3,invocationId:x.invocation.id,kind,sourceRecord:'invocation'});x.events[3].sequence=4;});
    assert.equal(assessUnwrittenExecution(f.spec,f.input).classification,'A');assert.equal(f.b.handle(f.input).eligible,true);
  });
  test('B: '+kind+' observed after a terminal remains a real unresolved execution',t=>{
    const f=fixture(t);f.mutateTrace(x=>x.events.push({id:'resumed',sequence:4,invocationId:x.invocation.id,kind,sourceRecord:'invocation'}));
    assert.equal(assessUnwrittenExecution(f.spec,f.input).classification,'B');
    unchanged(f,()=>f.b.handle(f.input),'RECOVERY_OBSERVED_DISPATCH_OR_EXECUTOR');
  });
}
for(const status of ['RUNNING','RESUMABLE','YIELDED'])test('B: current invocation status '+status+' blocks no-send closure',t=>{
  const f=fixture(t);f.mutateTrace(x=>x.invocation.status=status);
  assert.equal(assessUnwrittenExecution(f.spec,f.input).classification,'B');
  unchanged(f,()=>f.b.handle(f.input),'RECOVERY_OBSERVED_DISPATCH_OR_EXECUTOR');
});
test('B: FAILED but explicitly resumable is an observed resumable invocation',t=>{
  const f=fixture(t);f.mutateTrace(x=>{x.invocation.resumable=true;x.events.at(-1).resumable=true;});
  const a=assessUnwrittenExecution(f.spec,f.input);assert.equal(a.classification,'B');assert.equal(a.riskObserved,true);
  unchanged(f,()=>f.b.handle(f.input),'RECOVERY_OBSERVED_DISPATCH_OR_EXECUTOR');
});
test('B: a latest terminal explicitly marked resumable remains an observed route',t=>{
  const f=fixture(t);f.mutateTrace(x=>{delete x.invocation.resumable;x.events.at(-1).resumable=true;});
  assert.equal(assessUnwrittenExecution(f.spec,f.input).classification,'B');
});
for(const [name,mutate,code] of [
  ['no original invocation record',f=>delete f.input.rawExecutionTrace,'RECOVERY_EVIDENCE_MISSING'],
  ['unreviewed evidence',f=>f.input.approvedEvidenceHash=null,'RECOVERY_EVIDENCE_MISSING'],
  ['unapproved trace change',f=>f.input.rawExecutionTrace+=' ','RECOVERY_EVIDENCE_INVALID'],
  ['source bytes changed',f=>f.input.sourceRecords.calls+='changed','RECOVERY_EVIDENCE_INVALID'],
  ['null normalized record',f=>{f.input.rawExecutionTrace='null';f.input.approvedEvidenceHash=hash('null');},'RECOVERY_EVIDENCE_MISSING'],
  ['null event',f=>f.mutateTrace(x=>x.events[1]=null),'RECOVERY_EVIDENCE_INVALID'],
  ['null source reference',f=>f.mutateTrace(x=>x.provenance.sourceRecords[0]=null),'RECOVERY_EVIDENCE_INVALID'],
  ['only broker exit is known',f=>f.mutateTrace(x=>x.provenance.layer='DEV_SERVER_BROKER_PROTOCOL'),'RECOVERY_EVIDENCE_MISSING'],
  ['different provider review execution',f=>f.mutateTrace(x=>x.purpose='CODEX_REVIEW'),'RECOVERY_EVIDENCE_MISSING'],
  ['outer invocation status unknown',f=>f.mutateTrace(x=>x.invocation.status='UNKNOWN'),'RECOVERY_EVIDENCE_MISSING'],
  ['resumability unknown',f=>f.mutateTrace(x=>x.invocation.resumable='UNKNOWN'),'RECOVERY_EVIDENCE_MISSING'],
  ['resumability absent',f=>f.mutateTrace(x=>delete x.invocation.resumable),'RECOVERY_EVIDENCE_MISSING'],
  ['terminal event missing',f=>f.mutateTrace(x=>x.events.pop()),'RECOVERY_EVIDENCE_MISSING'],
  ['incomplete call segment',f=>f.mutateTrace(x=>x.coverage.complete=false),'RECOVERY_EVIDENCE_MISSING'],
  ['child route coverage unknown',f=>f.mutateTrace(x=>delete x.coverage.childDispatchRoutes),'RECOVERY_EVIDENCE_MISSING'],
  ['unclassified event',f=>f.mutateTrace(x=>x.events[1].kind='UNKNOWN_CALL'),'RECOVERY_EVIDENCE_MISSING'],
  ['wrong original invocation',f=>f.mutateTrace(x=>x.invocation.id='different'),'RECOVERY_EVIDENCE_INVALID'],
  ['wrong ticket correlation',f=>f.mutateTrace(x=>x.subject.ticket='different'),'RECOVERY_EVIDENCE_INVALID'],
  ['manifest changed without approval',f=>fs.appendFileSync(f.manifestPath,' '),'RECOVERY_MANIFEST_PIN'],
  ['fresh revision changed',f=>f.input.page=page('BEFORE',undefined,'2026-10-26T00:00:01Z'),'RECONCILE_CHANGED'],
  ['fresh protected property changed',f=>f.input.page=page('BEFORE',{title:'changed'}),'RECONCILE_CHANGED'],
  ['partly applied page',f=>f.input.page=page('PARTIAL'),'RECONCILE_CHANGED'],
  ['already applied page',f=>f.input.page=page('AFTER'),'RECONCILE_CHANGED'],
  ['competing owner',f=>f.input.ownerProof.conflicts=['scheduled'],'OWNERSHIP_FENCE'],
  ['other recovery scope',f=>f.input.ownerProof.scope='other','OWNERSHIP_FENCE'],
  ['original incident evidence changed',f=>fs.appendFileSync(path.join(f.root,'evidence.json'),' '),'RECOVERY_EVIDENCE'],
  ['installed pin changed',f=>{fs.chmodSync(path.join(f.runtime,'runner.js'),0o644);fs.appendFileSync(path.join(f.runtime,'runner.js'),' ');},'INSTALLATION_PIN'],
  ['original ticket changed',f=>{const j=JSON.parse(fs.readFileSync(f.b.file));j.batches[BATCH].receipt.ticket='other';privateWrite(f.b.file,j);f.restart();},'RECONCILE_IDENTITY'],
  ['snapshot changed',f=>{const s=JSON.parse(fs.readFileSync(f.receipt.snapshot));s.ticket='other';privateWrite(f.receipt.snapshot,s);},'RECONCILE_CHANGED'],
  ['unexpected write evidence',f=>privateWrite(f.receipt.snapshot+'.actual.json',{}),'SEND_UNCERTAIN']
])test('missing/invalid/conflicting evidence refuses '+name+' without mutation',t=>{
  const f=fixture(t);mutate(f);unchanged(f,()=>f.b.handle(f.input),code);assert.equal(f.b.state.active,BATCH);
});
test('C reports a missing record, not an observed late executor',t=>{
  const f=fixture(t);delete f.input.rawExecutionTrace;
  const a=assessUnwrittenExecution(f.spec,f.input);assert.equal(a.classification,'C');assert.equal(a.riskObserved,false);assert.equal(a.routes,undefined);
});
test('check-only rejects an existing recovery lock without changing or acquiring it',t=>{
  const f=fixture(t);privateWrite(path.join(f.root,'broker.lock'),{pid:999,executor:'other'});
  unchanged(f,()=>f.b.handle(f.input),'LOCKED');fs.unlinkSync(path.join(f.root,'broker.lock'));
});
test('audit-first/journal failure resumes after restart using the same immutable audit without deletion',t=>{
  const f=fixture(t);f.restart(true);const before=fs.readFileSync(f.b.file,'utf8'),rename=fs.renameSync;
  fs.renameSync=function(from,to){if(to===f.b.file)throw Error('synthetic journal failure');return rename.call(this,from,to);};
  try{assert.throws(()=>f.b.handle({...f.input,apply:true}),/journal failure/);}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(f.b.file,'utf8'),before);const saved=fs.readFileSync(f.audit,'utf8');f.restart(true);
  assert.equal(f.b.handle({...f.input,apply:true}).status,'ABORTED_UNWRITTEN');assert.equal(fs.readFileSync(f.audit,'utf8'),saved);
});
test('tampered audit after persistence failure cannot be published as closure',t=>{
  const f=fixture(t);f.restart(true);const rename=fs.renameSync;
  fs.renameSync=function(from,to){if(to===f.b.file)throw Error('synthetic crash');return rename.call(this,from,to);};
  try{assert.throws(()=>f.b.handle({...f.input,apply:true}));}finally{fs.renameSync=rename;}
  const a=JSON.parse(fs.readFileSync(f.audit));a.audit.notionWrites=1;privateWrite(f.audit,a);f.restart(true);
  unchanged(f,()=>f.b.handle({...f.input,apply:true}),'RECOVERY_EVIDENCE');assert.equal(f.b.state.active,BATCH);
});
test('missing existing canonical state is never initialized by recovery',t=>{
  const f=fixture(t),absent=path.join(f.dir,'absent');assert.throws(()=>new Broker(absent,policy,{existingOnly:true}));assert.equal(fs.existsSync(absent),false);
  f.b.close();fs.unlinkSync(path.join(f.root,'journal.json'));assert.throws(()=>new Broker(f.root,policy,{existingOnly:true}));assert.equal(fs.existsSync(path.join(f.root,'broker.lock')),false);
});
test('read-only recovery cannot execute apply or any ordinary mutating action',t=>{
  const f=fixture(t);unchanged(f,()=>f.b.handle({...f.input,apply:true}),'READ_ONLY');
  unchanged(f,()=>f.b.handle({action:'begin',batchId:'new',edits:[]}),'READ_ONLY');
});
test('two real recovery processes permit one closure and no duplicate terminal write',async t=>{
  const f=fixture(t);f.b.close();const inputPath=path.join(f.dir,'input.json');privateWrite(inputPath,{...f.input,apply:true});
  const code='const fs=require("node:fs");let b;try{b=new(require('+JSON.stringify(path.join(__dirname,'broker.cjs'))+').Broker)('+JSON.stringify(f.root)+','+JSON.stringify(policy)+',{existingOnly:true});const r=b.handle(JSON.parse(fs.readFileSync('+JSON.stringify(inputPath)+',"utf8")));process.stdout.write(JSON.stringify({ok:true,already:!!r.alreadyConsumed}));}catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.code}));}finally{if(b)b.close();}';
  const run=()=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,['-e',code]);let out='',err='';
    p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',exit=>exit?reject(Error(err)):resolve(JSON.parse(out)));});
  const results=await Promise.all([run(),run()]);assert.equal(results.filter(x=>x.ok&&!x.already).length,1);
  for(const r of results)assert.ok(r.ok||r.code==='LOCKED');
  const j=JSON.parse(fs.readFileSync(path.join(f.root,'journal.json')));assert.equal(j.active,null);assert.equal(j.batches[BATCH].reconciliations.length,1);
});
