'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const legacySource=require('node:child_process').execFileSync('git',
  ['show','d77969f2d84776226c62f36c5fbfcf4af98de57f:broker.cjs'],{cwd:__dirname,encoding:'utf8'});
const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
assert.equal(hash(legacySource),'1e929736ca81a71090aebfdf9484fe95f6112fd77783326eaedbeeb2b259daf3');
const legacyModule={exports:{}};vm.runInNewContext(legacySource,{require,module:legacyModule,process,console});
const {Broker,atomic}=legacyModule.exports;
const BATCH='prepared-mcp-synthetic',ids=['a','b','c','d','e'].map(x=>x.repeat(32));
const heading='## CURRENT CENTRAL OBSERVATION · synthetic';
const error='REMOTE_ERROR: McpServerError: MCP server is not initialized; send initialize and notifications/initialized before operational requests';
function page(i,literal='status=BEFORE',props={title:'Synthetic'},revision='2026-10-22T01:00:00Z'){
  return {structuredContent:{id:ids[i],page_last_edited_at:revision,text:'<properties>\n'+JSON.stringify(props)+
    '\n</properties>\n<content>\n'+heading+'\n'+literal+'\n## WORKER HISTORY\npreserved proof '+i+'\n</content>'}};
}
function load(f,overrides={}){
  let source=fs.readFileSync(path.join(__dirname,'reconcile_bori_prepared_mcp.cjs'),'utf8');
  const replacements={ROOT:f.root,RUNTIME:f.runtime,RECEIPT:f.installation,RECEIPT_HASH:f.installationHash,BATCH,PLAN:f.b.state.batches[BATCH].planHash,
    TICKET:f.receipt.ticket,SNAPSHOT:f.receipt.snapshotHash,JOURNAL:f.journalHash,PINS:f.pins};
  for(const [name,value] of Object.entries(replacements))
    source=source.replace(new RegExp('^const '+name+'=[\\s\\S]*?;\\n','m'),'const '+name+'='+JSON.stringify(value)+';\n');
  const module={exports:{}};let imports=0;
  const req=name=>{
    if(name===path.join(f.runtime,'broker.cjs')){imports++;return {...legacyModule.exports,...overrides};}
    return require(name);
  };
  vm.runInNewContext(source,{module,require:req,process,console},{filename:'synthetic-prepared-mcp.cjs'});
  return {helper:module.exports,imports,source};
}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-mcp-helper-')),root=path.join(dir,'state'),runtime=path.join(dir,'runtime');
  fs.mkdirSync(runtime,{mode:0o700});
  const policy={productionEnabled:true,productionPages:ids,canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
  fs.writeFileSync(path.join(runtime,'broker.cjs'),legacySource,{mode:0o555});
  fs.writeFileSync(path.join(runtime,'runner.js'),'reviewed legacy runner synthetic bytes',{mode:0o555});
  fs.writeFileSync(path.join(runtime,'policy.json'),JSON.stringify(policy),{mode:0o444});
  const pins=Object.fromEntries(['broker.cjs','runner.js','policy.json'].map(n=>[n,hash(fs.readFileSync(path.join(runtime,n)))]));
  fs.writeFileSync(path.join(runtime,'approved.sha256'),Object.entries(pins).map(([n,h])=>h+'  '+n+'\n').join(''),{mode:0o444});
  const installation=path.join(dir,'installation.json');
  fs.writeFileSync(installation,JSON.stringify({sourceCommit:'d77969f2d84776226c62f36c5fbfcf4af98de57f',
    reviewedReleaseCommit:'c4f77e1b54dc59d365885ec56a2f414f51b2a229',after:pins,policyChanged:false,workerServicesChanged:false}),{mode:0o600});
  const b=new Broker(root,policy);t.after(()=>{if(fs.existsSync(b.lock))b.close();fs.rmSync(dir,{recursive:true,force:true});});
  const edits=ids.map(pageId=>({pageId,heading,oldStr:'status=BEFORE',newStr:'status=AFTER'}));
  b.handle({action:'begin',batchId:BATCH,edits});const raw=[];
  for(let i=0;i<4;i++){
    const r=b.handle({action:'prepare',batchId:BATCH,page:page(i)});
    b.handle({action:'authorize',batchId:BATCH,ticket:r.ticket,page:page(i)});
    raw.push(page(i,'status=AFTER'));b.handle({action:'verify',batchId:BATCH,ticket:r.ticket,page:raw[i]});
  }
  b.handle({action:'prepare',batchId:BATCH,page:page(4)});raw.push(page(4));
  b.handle({action:'halt',batchId:BATCH,reason:error});
  b.state.batches.unrelated={status:'COMPLETED',proof:'preserved unrelated private history'};b.save();
  const f={dir,root,runtime,policy,b,raw,pins,edits,installation,installationHash:hash(fs.readFileSync(installation)),
    receipt:b.state.batches[BATCH].receipt,journalHash:hash(fs.readFileSync(b.file))};
  f.helper=load(f).helper;return f;
}
function inventory(dir){
  return Object.fromEntries(fs.readdirSync(dir).sort().map(n=>{
    const file=path.join(dir,n);return [n,{hash:hash(fs.readFileSync(file)),mode:fs.statSync(file).mode}];
  }));
}
function unchanged(f,fn){
  const before=inventory(f.root),runtime=inventory(f.runtime);
  const installation=fs.existsSync(f.installation)?fs.readFileSync(f.installation,'utf8'):null;
  assert.throws(fn);
  assert.deepEqual(inventory(f.root),before);assert.deepEqual(inventory(f.runtime),runtime);
  assert.equal(fs.existsSync(f.installation)?fs.readFileSync(f.installation,'utf8'):null,installation);
}
test('legacy helper defaults to check-only and preserves every canonical/runtime file and mode',t=>{
  const f=fixture(t),before=inventory(f.root),runtime=inventory(f.runtime),state=JSON.stringify(f.b.state);
  const out=f.helper.apply(f.b,f.raw);
  assert.equal(out.checkOnly,true);assert.equal(out.status,'HALTED');assert.equal(out.next,4);
  assert.equal(JSON.stringify(f.b.state),state);assert.deepEqual(inventory(f.root),before);assert.deepEqual(inventory(f.runtime),runtime);
});
test('legacy helper restores only PREPARED with the original ticket, progress and four full receipts',t=>{
  const f=fixture(t),before=JSON.parse(fs.readFileSync(f.b.file)),files=inventory(f.root),runtime=inventory(f.runtime);
  // The old broker cannot admit the new error before explicit reviewed helper recovery.
  assert.throws(()=>f.b.handle({action:'reconcile_receipts',batchId:BATCH,planHash:before.batches[BATCH].planHash,expectedError:error}),e=>e.code==='RECONCILE_SCOPE');
  const out=f.helper.apply(f.b,f.raw,false),after=JSON.parse(fs.readFileSync(f.b.file)),b=after.batches[BATCH];
  assert.equal(out.status,'PREPARED');assert.equal(out.next,4);assert.equal(out.ticket,f.receipt.ticket);assert.equal(after.active,BATCH);
  const expected=structuredClone(before);expected.batches[BATCH].status='PREPARED';
  delete expected.batches[BATCH].error;delete expected.batches[BATCH].haltedFrom;
  expected.batches[BATCH].reconciliations=[out.audit];assert.equal(JSON.stringify(after),JSON.stringify(expected));
  for(const [n,value] of Object.entries(files))if(n!=='journal.json')assert.deepEqual(inventory(f.root)[n],value);
  assert.deepEqual(inventory(f.runtime),runtime);
  assert.equal(b.next,4);assert.deepEqual(b.receipt,before.batches[BATCH].receipt);
  for(const k of ['notionWrites','acknowledgedWrites','pageAdvances'])assert.equal(out.audit[k],0);
  const saved=JSON.parse(fs.readFileSync(out.auditFile));
  assert.equal(JSON.stringify(saved.journalBefore),JSON.stringify(before));assert.equal(saved.freshPages.length,5);
  assert.equal(saved.audit.error,error);assert.equal(saved.audit.haltedFrom,'PREPARED');assert.equal(fs.statSync(out.auditFile).mode&0o077,0);
  const authorized=f.b.handle({action:'authorize',batchId:BATCH,ticket:f.receipt.ticket,page:f.raw[4]});
  assert.equal(authorized.status,'WRITE_PENDING');assert.equal(authorized.request.page_id,ids[4]);
  assert.throws(()=>f.b.handle({action:'authorize',batchId:BATCH,ticket:f.receipt.ticket,page:f.raw[4]}),e=>e.code==='PAGE_BARRIER');
  assert.equal(f.b.handle({action:'verify',batchId:BATCH,ticket:f.receipt.ticket,page:page(4,'status=AFTER')}).status,'COMPLETED');
  assert.equal(f.b.state.active,null);assert.equal(JSON.stringify(f.b.state.batches.unrelated),JSON.stringify(before.batches.unrelated));
});
for(const [name,mutate] of [
 ['missing fresh read',f=>f.raw.pop()],
 ['fresh reads reordered',f=>{[f.raw[0],f.raw[1]]=[f.raw[1],f.raw[0]];}],
 ['prior protected body',f=>{f.raw[0]=page(0,'status=AFTER\nchanged proof');}],
 ['prior properties',f=>{f.raw[1]=page(1,'status=AFTER',{title:'changed'});}],
 ['prior revision',f=>{f.raw[2]=page(2,'status=AFTER',undefined,'2026-10-22T01:01:00Z');}],
 ['pending body',f=>{f.raw[4]=page(4,'status=BEFORE\nchanged proof');}],
 ['pending properties',f=>{f.raw[4]=page(4,undefined,{title:'changed'});}],
 ['pending revision',f=>{f.raw[4]=page(4,undefined,undefined,'2026-10-22T01:01:00Z');}],
 ['pending already applied',f=>{f.raw[4]=page(4,'status=AFTER');}],
 ['missing pending snapshot',f=>fs.unlinkSync(f.receipt.snapshot)],
 ['tampered pending snapshot',f=>{const s=JSON.parse(fs.readFileSync(f.receipt.snapshot));s.ticket='other';atomic(f.receipt.snapshot,s);}],
 ['missing prior receipt',f=>fs.unlinkSync(f.b.snapshot(BATCH,1)+'.verified.json')],
 ['tampered prior receipt',f=>{const p=f.b.snapshot(BATCH,1)+'.verified.json',v=JSON.parse(fs.readFileSync(p));v.at='changed';atomic(p,v);}],
 ['orphan pending actual',f=>atomic(f.receipt.snapshot+'.actual.json',{})],
 ['orphan pending verification',f=>atomic(f.receipt.snapshot+'.verified.json',{})],
 ['future snapshot',f=>atomic(f.b.snapshot(BATCH,5),{})],
 ['existing audit',f=>atomic(path.join(f.root,hash(BATCH)+'.prepared-mcp-initialization-recovery.json'),{})],
 ['changed journal',f=>{f.b.state.batches.unrelated.proof='changed';f.b.save();}],
 ['changed active',f=>{f.b.state.active='unrelated';f.b.save();}],
 ['post-write phase',f=>{f.b.state.batches[BATCH].haltedFrom='WRITE_PENDING';f.b.save();}],
 ['changed error',f=>{f.b.state.batches[BATCH].error=error+' extra';f.b.save();}],
 ['changed policy memory',f=>{f.policy.productionEnabled=false;}],
 ['wrong canonical root',f=>{f.b.root=f.dir;}],
 ['lost lock owner',f=>atomic(f.b.lock,{pid:-1})],
 ['runtime broker change',f=>{fs.chmodSync(path.join(f.runtime,'broker.cjs'),0o755);fs.appendFileSync(path.join(f.runtime,'broker.cjs'),'\nchanged');}],
 ['runtime runner change',f=>{fs.chmodSync(path.join(f.runtime,'runner.js'),0o755);fs.appendFileSync(path.join(f.runtime,'runner.js'),'changed');}],
 ['runtime policy change',f=>{fs.chmodSync(path.join(f.runtime,'policy.json'),0o644);fs.appendFileSync(path.join(f.runtime,'policy.json'),' ');}],
 ['approved manifest change',f=>{fs.chmodSync(path.join(f.runtime,'approved.sha256'),0o644);fs.appendFileSync(path.join(f.runtime,'approved.sha256'),'extra\n');}],
 ['installation receipt changed',f=>fs.appendFileSync(f.installation,' ')],
 ['missing installation receipt',f=>fs.unlinkSync(f.installation)]
])test('legacy helper refuses '+name+' without changing state or runtime',t=>{
  const f=fixture(t);mutate(f);unchanged(f,()=>f.helper.apply(f.b,f.raw,false));
});
test('legacy helper audit persistence failure preserves original HALTED barrier',t=>{
  const f=fixture(t),h=load(f,{atomic(){throw Error('synthetic disk full');}}).helper;
  unchanged(f,()=>h.apply(f.b,f.raw,false));assert.equal(f.b.state.batches[BATCH].status,'HALTED');
});
test('legacy helper journal persistence failure keeps HALTED and retains a fail-closed audit',t=>{
  const f=fixture(t),journal=fs.readFileSync(f.b.file,'utf8');
  const h=load(f,{atomic(file,value){if(file===f.b.file)throw Error('synthetic journal disk full');return atomic(file,value);}}).helper;
  assert.throws(()=>h.apply(f.b,f.raw,false));assert.equal(fs.readFileSync(f.b.file,'utf8'),journal);
  assert.equal(f.b.state.batches[BATCH].status,'HALTED');unchanged(f,()=>f.helper.apply(f.b,f.raw,false));
});
test('unapproved installed broker bytes are rejected before loading any broker module',t=>{
  const f=fixture(t);fs.chmodSync(path.join(f.runtime,'broker.cjs'),0o755);fs.writeFileSync(path.join(f.runtime,'broker.cjs'),'throw new Error("must not execute")');
  assert.throws(()=>load(f),/Approved installed runtime changed: broker.cjs/);
});
test('incident helper cannot be replayed and never accepts a string apply selector',t=>{
  const f=fixture(t);unchanged(f,()=>f.helper.apply(f.b,f.raw,'false'));
  f.helper.apply(f.b,f.raw,false);unchanged(f,()=>f.helper.apply(f.b,f.raw,false));
});
for(const input of ['fresh','invalid'])test('incident helper CLI closes its lock after '+input+' check-only input',t=>{
  const f=fixture(t),before=fs.readFileSync(f.b.file,'utf8'),source=load(f).source;
  const entry=path.join(f.dir,'synthetic-helper.cjs');fs.writeFileSync(entry,source);f.b.close();
  const result=require('node:child_process').spawnSync(process.execPath,[entry],{
    input:input==='fresh'?JSON.stringify(f.raw)+'\n':'invalid-json\n',encoding:'utf8',timeout:10000});
  assert.equal(result.status,input==='fresh'?0:1);assert.equal(fs.existsSync(f.b.lock),false);
  assert.equal(fs.readFileSync(f.b.file,'utf8'),before);
  if(input==='fresh')assert.match(result.stdout,/"checkOnly":true/);
});

const legacyRunnerSource=require('node:child_process').execFileSync('git',
  ['show','d77969f2d84776226c62f36c5fbfcf4af98de57f:runner.js'],{cwd:__dirname,encoding:'utf8'});
test('incident continuation keeps native reads, ACK/async and verification bodies verbatim from the pinned runner',()=>{
  const source=fs.readFileSync(path.join(__dirname,'continue_bori_prepared_mcp.js'),'utf8');
  for(const name of ['connectorData','fetchPage','asyncTask','update','verifyAfterWrite']){
    const expression=new RegExp('^  (?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^  }\\n','m');
    const match=source.match(expression);assert.ok(match,'Missing original function '+name);
    assert.ok(legacyRunnerSource.includes(match[0]),'Original function changed: '+name);
  }
});
function continuation(f,fault){
  const identity={batchId:BATCH,planHash:f.b.state.batches[BATCH].planHash,ticket:f.receipt.ticket,pageId:ids[4],next:5};
  const source=fs.readFileSync(path.join(__dirname,'continue_bori_prepared_mcp.js'),'utf8')
    .replace(/^const identity=[^\n]+;/m,'const identity='+JSON.stringify(identity)+';');
  let updates=0,fetches=0,closes=0,asyncReads=0,raw=structuredClone(f.raw[4]);const calls=[];
  const tools={
    async mcp__codex_apps__notion_fetch({id}){
      assert.equal(id,ids[4]);fetches++;
      if(fault==='postwrite-fetch'&&updates)throw Error('synthetic native read lost');
      return structuredClone(raw);
    },
    async mcp__codex_apps__notion_notion_update_page(request){
      updates++;assert.equal(request.page_id,ids[4]);assert.equal(request.command,'update_content');
      assert.equal(request.content_updates.length,1);assert.equal(request.allow_async,false);
      const change=request.content_updates[0];raw.structuredContent.text=raw.structuredContent.text.replace(change.old_str,change.new_str);
      if(fault==='lost-ack')throw Error('synthetic lost mutation acknowledgement');
      if(fault==='readback-mismatch')raw.structuredContent.text=raw.structuredContent.text.replace('preserved proof 4','changed protected proof');
      if(fault==='unknown-ack')return {content:[{type:'text',text:'Success without identity'}]};
      if(fault==='wrong-page-ack')return {structuredContent:{page_id:ids[0]}};
      if(fault?.startsWith('async'))return {structuredContent:{async_task:{task_id:'synthetic-task'}}};
      return {structuredContent:{page_id:ids[4]}};
    },
    async mcp__codex_apps__notion_notion_get_async_task({task_id}){
      assert.equal(task_id,'synthetic-task');asyncReads++;
      if(fault==='async-failed')return {structuredContent:{status:'failed'}};
      if(fault==='async-unknown')return {structuredContent:{status:'unknown'}};
      if(fault==='async-pending')return {structuredContent:{status:'running'}};
      return {structuredContent:{status:asyncReads<3?'running':'succeeded'}};
    }
  };
  const runner={
    async broker(request){
      calls.push(request.action);assert.notEqual(request.action,'status');
      if(request.action==='authorize'){
        const authorized=f.b.handle(request);
        if(fault==='authorize-lost-response')throw Error('BROKER_RESPONSE_UNKNOWN');
        if(fault==='wrong-authorization')authorized.request.page_id=ids[0];
        return authorized;
      }
      return f.b.handle(request);
    },
    async close(){closes++;f.b.close();}
  };
  const factory=vm.runInNewContext(source,{setTimeout:fn=>fn()});
  const api=factory(tools,{createRunner:()=>runner,runnerConfig:{}});
  return {api,calls,get updates(){return updates;},get fetches(){return fetches;},get closes(){return closes;},get asyncReads(){return asyncReads;}};
}
for(const fault of [undefined,'async-success'])test('incident continuation performs exactly one ordinary pending mutation and closes: '+String(fault),async t=>{
  const f=fixture(t);f.helper.apply(f.b,f.raw,false);const c=continuation(f,fault),out=await c.api.run();
  assert.equal(out.status,'COMPLETED');assert.equal(out.updateInvocations,1);assert.equal(c.updates,1);assert.equal(c.fetches,2);
  assert.equal(c.closes,1);assert.equal(fs.existsSync(f.b.lock),false);assert.equal(f.b.state.active,null);
  assert.deepEqual(c.calls,['authorize','verify']);assert.equal(f.b.state.batches[BATCH].next,5);
  if(fault)assert.equal(c.asyncReads,3);
});
for(const [fault,message,updates,phase] of [
 ['lost-ack','synthetic lost mutation acknowledgement',1,'WRITE_PENDING'],
 ['unknown-ack','NOTION_RESULT_UNKNOWN',1,'WRITE_PENDING'],
 ['wrong-page-ack','NOTION_RESULT_UNKNOWN',1,'WRITE_PENDING'],
 ['async-failed','ASYNC_FAILED',1,'WRITE_PENDING'],
 ['async-unknown','ASYNC_RESULT_UNKNOWN',1,'WRITE_PENDING'],
 ['async-pending','ASYNC_PENDING_RECONCILE_REQUIRED',1,'WRITE_PENDING'],
 ['authorize-lost-response','BROKER_RESPONSE_UNKNOWN',0,'WRITE_PENDING'],
 ['wrong-authorization','EXACT_PENDING_AUTHORIZATION_MISMATCH',0,'WRITE_PENDING'],
 ['postwrite-fetch','REVISION_READ_ERROR',1,'WRITE_PENDING'],
 ['readback-mismatch','Protected content or properties changed',1,undefined]
])test('incident continuation retains the barrier and never resends after '+fault,async t=>{
 const f=fixture(t);f.helper.apply(f.b,f.raw,false);const c=continuation(f,fault);
 await assert.rejects(c.api.run(),e=>e.message.includes(message));
 const b=f.b.state.batches[BATCH];assert.equal(c.updates,updates);assert.equal(c.closes,1);assert.equal(fs.existsSync(f.b.lock),false);
 assert.equal(b.status,'HALTED');assert.equal(b.next,4);assert.equal(b.receipt.ticket,f.receipt.ticket);
 if(phase)assert.equal(b.haltedFrom,phase);
 assert.equal(c.calls.filter(a=>a==='authorize').length,1);
 assert.equal(c.calls.filter(a=>a==='verify').length,fault==='readback-mismatch'?1:0);
 assert.ok(c.calls.includes('halt'));if(fault==='async-pending')assert.equal(c.asyncReads,20);
});
