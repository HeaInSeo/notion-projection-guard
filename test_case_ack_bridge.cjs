'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const A='a'.repeat(32),B='b'.repeat(32),batchId='synthetic-admission';
const failure='REMOTE_ERROR: McpServerError: MCP server is not initialized; send initialize and notifications/initialized before operational requests';
const helper=path.join(__dirname,'case_ack_bridge.cjs');
const page=(pageId=A,value='BEFORE',revision='2026-10-26T00:00:00Z',props={title:'Synthetic'})=>({structuredContent:{id:pageId,page_last_edited_at:revision,
  text:'<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n## CURRENT CENTRAL OBSERVATION · synthetic\nstate='+value+'\n## WORKER PROOF\nkeep\n</content>'}});
const before=id=>page(id),after=id=>page(id,'ADMITTED','2026-10-26T00:00:01Z');
function fixture(t,{index=0,ack=true}={}){
  let bridge;
  t.after(()=>bridge?.close());
  // Reuse only the synthetic fixture definitions, without registering their
  // unrelated tests. Two pages exercise both prior verification and remaining
  // continuation. This CONFIG substitution is test-only, never a CLI option.
  const fixtureSource=fs.readFileSync(path.join(__dirname,'test_case_exception.cjs'),'utf8')
    .replace('productionPages:[PAGE]','productionPages:[PAGE,OTHER]')
    .replace('hash(JSON.stringify([admissionEdit]))','hash(JSON.stringify([admissionEdit,{...admissionEdit,pageId:OTHER}]))');
  const fixtureModule={exports:{}},localRequire=createRequire(__filename);
  vm.runInNewContext(fixtureSource,{module:fixtureModule,__dirname,__filename:path.join(__dirname,'test_case_exception.cjs'),process,Buffer,
    require:n=>n==='node:test'?{test:()=>{}}:localRequire(n)});
  const f=fixtureModule.exports.fixture(t);fixtureModule.exports.close(f);
  const edits=[f.admissionEdit,{...f.admissionEdit,pageId:B}],ownerProof=()=>({...f.proof(),scope:batchId,
    validUntil:new Date(Date.now()+15000).toISOString()});
  const started=f.b.handle({action:'fence_begin',batchId,edits,ownerProof:ownerProof()});
  let ctx={batchId,planHash:started.planHash,executor:started.executor};
  for(let i=0;i<=index;i++){
    const id=edits[i].pageId,r=f.b.handle({...ctx,action:'fence_prepare',page:before(id),ownerProof:ownerProof()});ctx.ticket=r.ticket;
    f.b.handle({...ctx,action:'fence_authorize',page:before(id),ownerProof:ownerProof()});
    const d=f.b.handle({...ctx,action:'fence_dispatch',page:before(id),ownerProof:ownerProof()});ctx.dispatchId=d.dispatchId;
    f.b.handle({...ctx,action:'fence_confirm_send',ownerProof:ownerProof()});
    if(i<index||ack)f.b.handle({...ctx,action:'fence_ack',provider:{status:'SUCCEEDED',pageId:id,taskId:null}});
    if(i<index)f.b.handle({...ctx,action:'fence_verify',page:after(id)});
  }
  f.b.handle({...ctx,action:'fence_halt',reason:failure});f.b.close();
  const config={root:f.root,runtime:f.runtime,caseId:f.m.risk?f.spec.batchId:null,batchId,planHash:started.planHash,installedHead:f.m.sourceHead,
    pins:Object.fromEntries(fs.readdirSync(f.runtime).map(n=>[n,hash(fs.readFileSync(path.join(f.runtime,n)))]))};
  const mod={exports:{}};
  const source=fs.readFileSync(helper,'utf8').replace(/^const CONFIG=[\s\S]*?;\nconst hash=/m,'const CONFIG='+JSON.stringify(config)+';\nconst hash=');
  vm.runInNewContext(source,{module:mod,require:createRequire(helper),__filename:helper,process,Buffer});
  bridge=mod.exports.createBridge({readOnly:false});
  const result={...f,edits,ctx,ownerProof,config,get bridge(){return bridge;},
    createAnother:options=>mod.exports.createBridge(options),
    restart(readOnly=false){bridge.close();bridge=mod.exports.createBridge({readOnly});return bridge;},
    input(apply=false){const s=bridge.handle({action:'case_recovery_status',batchId}),x=s.batches[batchId];
      return {action:'case_reconcile_acknowledged',batchId,planHash:x.planHash,journalHash:s.journalHash,
        ticket:x.receipt?.ticket,snapshotHash:x.receipt?.snapshotHash,dispatchId:x.dispatch?.attempts.at(-1)?.dispatchId,
        expectedError:x.error,priorPages:edits.slice(0,x.next).map(e=>after(e.pageId)),page:after(edits[x.next].pageId),ownerProof:ownerProof(),apply};},
    continuation(restoration){const s=bridge.handle({action:'case_recovery_status',batchId}),x=s.batches[batchId];
      return {action:'case_continue_verified',batchId,planHash:x.planHash,journalHash:s.journalHash,restoration,
        priorPages:edits.slice(0,x.next).map(e=>after(e.pageId)),remainingPages:edits.slice(x.next).map(e=>before(e.pageId)),ownerProof:ownerProof()};}
  };
  return result;
}
const journal=f=>JSON.parse(fs.readFileSync(path.join(f.root,'journal.json')));
const inventory=root=>Object.fromEntries(fs.readdirSync(root).filter(n=>n!=='broker.lock'&&fs.lstatSync(path.join(root,n)).isFile()).sort()
  .map(n=>[n,hash(fs.readFileSync(path.join(root,n)))]));
function unchanged(f,input,code){const before=inventory(f.root);assert.throws(()=>f.bridge.handle(input),e=>!code||e.code===code);
  assert.deepEqual(inventory(f.root),before);}
test('check-only and applied saved-ACK recovery preserve runtime, original exception and failure, with no native interface',t=>{
  const f=fixture(t),runtime=inventory(f.runtime),old=journal(f),files=inventory(f.root);
  assert.equal(f.bridge.handle(f.input()).checkOnly,true);assert.deepEqual(inventory(f.root),files);
  const r=f.bridge.handle(f.input(true)),now=journal(f);assert.equal(r.status,'READY');assert.equal(r.next,1);assert.equal(r.notionWrites,0);
  assert.equal(now.batches[batchId].error,failure);assert.equal(now.batches[batchId].dispatch.phase,'VERIFIED_STOPPED');
  assert.deepEqual(now.batches[f.spec.batchId],old.batches[f.spec.batchId]);assert.deepEqual(now.caseExceptionControl,old.caseExceptionControl);
  assert.deepEqual(inventory(f.runtime),runtime);assert.equal(now.active,batchId);
  assert.equal(typeof f.bridge.update,'undefined');
});
test('last page recovers only attributed application and preserves all prior verification fingerprints',t=>{
  const f=fixture(t,{index:1}),old=journal(f),r=f.bridge.handle(f.input(true)),now=journal(f);
  assert.equal(r.status,'COMPLETED');assert.equal(now.active,null);assert.equal(now.batches[batchId].next,2);
  assert.deepEqual(now.batches[batchId].verifications[0],old.batches[batchId].verifications[0]);
  assert.equal(now.batches[f.spec.batchId].status,'CLOSED_EXCEPTION_UNCONFIRMED');
});
test('an equal page without a saved terminal ACK cannot close or advance',t=>{
  const f=fixture(t,{ack:false});unchanged(f,f.input(true),'CASE_ACK_ATTRIBUTION');assert.equal(journal(f).batches[batchId].next,0);
});
for(const key of ['batchId','planHash','journalHash','ticket','snapshotHash','dispatchId','expectedError'])
test('wrong recovery identity rejects without evidence changes: '+key,t=>{const f=fixture(t);unchanged(f,{...f.input(true),[key]:'wrong'});});
for(const change of [{generation:'other'},{conflicts:['other-writer']},{validUntil:'2020-01-01T00:00:00Z'}])
test('fresh same scoped owner is mandatory '+JSON.stringify(change),t=>{const f=fixture(t),q=f.input(true);
  unchanged(f,{...q,ownerProof:{...q.ownerProof,...change}});});
for(const bad of [page(A,'ADMITTED','2026-10-26T00:00:00Z'),page(A,'ADMITTED','2026-10-26T00:00:02Z',{title:'changed'}),
  page(A,'ADMITTED plus changed worker proof','2026-10-26T00:00:01Z')])
test('fresh whole output/properties/later revision are required '+JSON.stringify(bad).slice(-55),t=>{
  const f=fixture(t);unchanged(f,{...f.input(true),page:bad},'CASE_ACK_CHANGED');});
test('a changed prior verified revision rejects final-page recovery',t=>{
  const f=fixture(t,{index:1}),q=f.input(true);q.priorPages=[page(A,'ADMITTED','2026-10-26T00:00:02Z')];unchanged(f,q,'CASE_ACK_PRIOR_CHANGED');
});
test('historical permit uses the 30s source bound when the 15s issuance followed a slow prerequisite read',t=>{
  const f=fixture(t),file=path.join(f.root,'journal.json'),x=journal(f),a=x.batches[batchId].dispatch.attempts[0];
  a.at=new Date(Date.now()-20000).toISOString();a.sendPermit.observedAt=new Date(Date.now()-15000).toISOString();
  a.sendPermit.validUntil=new Date(Date.now()+14000).toISOString();fs.writeFileSync(file,JSON.stringify(x));
  f.restart();assert.equal(f.bridge.handle(f.input(true)).status,'READY');
});
for(const target of ['snapshot','provider','sendPermit','attempt','plan','contradictory'])
test('evidence tampering rejects '+target,t=>{
  const f=fixture(t),file=path.join(f.root,'journal.json'),x=journal(f),b=x.batches[batchId];
  if(target==='snapshot')fs.appendFileSync(b.receipt.snapshot,' ');
  if(target==='provider')b.dispatch.provider={...b.dispatch.provider,pageId:B};
  if(target==='sendPermit')b.dispatch.attempts[0].sendPermit.executor='other-executor';
  if(target==='attempt')b.dispatch.attempts[0].requestHash='a'.repeat(64);
  if(target==='plan')b.edits[0].newStr='tampered';
  if(target==='contradictory')fs.writeFileSync(b.receipt.snapshot+'.actual.json','{}',{mode:0o600});
  if(!['snapshot','contradictory'].includes(target))fs.writeFileSync(file,JSON.stringify(x));
  f.restart();unchanged(f,f.input(true));
});
for(const target of ['audit','verified','journal'])
test('interrupted '+target+' save leaves old progress and exact restart commits once',t=>{
  const f=fixture(t),q=f.input(true),before=fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),rename=fs.renameSync;
  const pending=journal(f).batches[batchId].receipt.snapshot;
  fs.renameSync=(from,to)=>{if((target==='audit'&&to.endsWith('.ack-recovery-0.json'))||
    (target==='verified'&&to===pending+'.verified.json')||(target==='journal'&&to===path.join(f.root,'journal.json')))throw Error('synthetic failed '+target);
    return rename(from,to);};
  try{assert.throws(()=>f.bridge.handle(q));}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),before);
  f.restart();assert.equal(f.bridge.handle(f.input(true)).next,1);
  unchanged(f,q);assert.equal(journal(f).batches[batchId].verifications.length,1);
});
test('read-only mode refuses mutation before changing memory or disk',t=>{
  const f=fixture(t);f.restart(true);const files=inventory(f.root);
  assert.equal(f.bridge.handle(f.input(false)).checkOnly,true);unchanged(f,f.input(true),'READ_ONLY');
  unchanged(f,{action:'fence_begin',batchId,edits:f.edits,ownerProof:f.ownerProof()},'READ_ONLY');assert.deepEqual(inventory(f.root),files);
});
test('canonical process lock refuses a competing bridge',t=>{
  const f=fixture(t);assert.throws(()=>f.createAnother({readOnly:false}),e=>e.code==='LOCKED');
  const reader=f.createAnother({readOnly:true});
  try{assert.throws(()=>reader.handle(f.input(false)),e=>e.code==='LOCKED');}finally{reader.close();}
});
test('verified recovery does not authorize a later write; explicit continuation uses a new live executor and ordinary gates',t=>{
  const f=fixture(t),r=f.bridge.handle(f.input(true));f.restart();
  unchanged(f,{...f.ctx,action:'fence_prepare',page:before(B),ownerProof:f.ownerProof()},'EXECUTOR_FENCED');
  const adopted=f.bridge.handle(f.continuation(r.restoration));
  assert.notEqual(adopted.executor,f.ctx.executor);const live={batchId,planHash:adopted.planHash,executor:adopted.executor};
  unchanged(f,f.continuation(r.restoration),'CASE_ACK_CONTINUATION');
  const p=f.bridge.handle({...live,action:'fence_prepare',page:before(B),ownerProof:f.ownerProof()});live.ticket=p.ticket;
  unchanged(f,{...live,action:'fence_authorize',page:before(B),ownerProof:{...f.ownerProof(),generation:'stale'}},'OWNERSHIP_FENCE');
  f.bridge.handle({...live,action:'fence_authorize',page:before(B),ownerProof:f.ownerProof()});
  const dispatch=f.bridge.handle({...live,action:'fence_dispatch',page:before(B),ownerProof:f.ownerProof()});
  assert.equal(dispatch.request.page_id,B);assert.equal(journal(f).batches[batchId].dispatch.attempts.length,2);
});
test('continuation save failure and restart preserve failed intent, original error and zero new dispatches',t=>{
  const f=fixture(t),r=f.bridge.handle(f.input(true)),before=fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===path.join(f.root,'journal.json'))throw Error('synthetic continuation save');return rename(from,to);};
  try{assert.throws(()=>f.bridge.handle(f.continuation(r.restoration)));}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),before);f.restart();
  assert.equal(f.bridge.handle(f.continuation(r.restoration)).status,'READY');
  assert.equal(journal(f).batches[batchId].dispatch.attempts.length,1);assert.equal(journal(f).batches[batchId].error,failure);
});
test('a changed recovery audit cannot be adopted after an interrupted journal save',t=>{
  const f=fixture(t),rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===path.join(f.root,'journal.json'))throw Error('synthetic save');return rename(from,to);};
  try{assert.throws(()=>f.bridge.handle(f.input(true)));}finally{fs.renameSync=rename;}
  const file=path.join(f.root,hash(batchId)+'.ack-recovery-0.json'),saved=JSON.parse(fs.readFileSync(file));
  saved.audit.recoveryOwner.ownerId='wrong-owner';fs.writeFileSync(file,JSON.stringify(saved));f.restart();
  unchanged(f,f.input(true),'CASE_ACK_AUDIT');
});
test('changed full fresh evidence after a partial save rejects recovery instead of blessing the saved bytes',t=>{
  const f=fixture(t),rename=fs.renameSync,before=fs.readFileSync(path.join(f.root,'journal.json'),'utf8');
  fs.renameSync=(from,to)=>{if(to===path.join(f.root,'journal.json'))throw Error('synthetic save');return rename(from,to);};
  try{assert.throws(()=>f.bridge.handle(f.input(true)));}finally{fs.renameSync=rename;}
  const file=path.join(f.root,hash(batchId)+'.ack-recovery-0.json'),saved=JSON.parse(fs.readFileSync(file));
  saved.freshPage.body='tampered saved evidence';fs.writeFileSync(file,JSON.stringify(saved));f.restart();
  unchanged(f,f.input(true),'CASE_ACK_AUDIT');assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),before);
});
for(const target of ['provider','requestHash','ticket','error','record'])
test('receipt re-query cannot re-hash changed committed recovery evidence into authority '+target,t=>{
  const f=fixture(t),r=f.bridge.handle(f.input(true)),file=path.join(f.root,'journal.json'),x=journal(f),b=x.batches[batchId];
  if(target==='provider')b.dispatch.attempts[0].provider.status='FAILED';
  if(target==='requestHash')b.dispatch.attempts[0].requestHash='f'.repeat(64);
  if(target==='ticket')b.dispatch.attempts[0].ticket='other-ticket';
  if(target==='error')b.error='changed original error';
  if(target==='record')fs.appendFileSync(path.join(f.root,hash(batchId)+'.ack-recovery-0.json'),' ');
  else fs.writeFileSync(file,JSON.stringify(x));
  f.restart();unchanged(f,{action:'case_recovery_status',batchId},'CASE_ACK_AUDIT');
  const q={action:'case_continue_verified',batchId,planHash:f.ctx.planHash,journalHash:hash(fs.readFileSync(file)),restoration:r.restoration,
    priorPages:[after(A)],remainingPages:[before(B)],ownerProof:f.ownerProof()};
  unchanged(f,q,'CASE_ACK_AUDIT');assert.equal(journal(f).batches[batchId].dispatch.attempts.length,1);
});
test('lost continuation reply can re-query and explicitly adopt unchanged committed progress in a fresh process',t=>{
  const f=fixture(t),r=f.bridge.handle(f.input(true));f.bridge.handle(f.continuation(r.restoration));f.restart();
  const s=f.bridge.handle({action:'case_recovery_status',batchId});
  assert.equal(f.bridge.handle(f.continuation(s.restoration)).status,'READY');
  assert.equal(journal(f).batches[batchId].dispatch.attempts.length,1);
});
function secondAckFailure(f){
  const r=f.bridge.handle(f.input(true)),a=f.bridge.handle(f.continuation(r.restoration)),live={batchId,planHash:a.planHash,executor:a.executor};
  const p=f.bridge.handle({...live,action:'fence_prepare',page:before(B),ownerProof:f.ownerProof()});live.ticket=p.ticket;
  f.bridge.handle({...live,action:'fence_authorize',page:before(B),ownerProof:f.ownerProof()});
  const d=f.bridge.handle({...live,action:'fence_dispatch',page:before(B),ownerProof:f.ownerProof()});live.dispatchId=d.dispatchId;
  f.bridge.handle({...live,action:'fence_confirm_send',ownerProof:f.ownerProof()});
  f.bridge.handle({...live,action:'fence_ack',provider:{status:'SUCCEEDED',pageId:B,taskId:null}});
  f.bridge.handle({...live,action:'fence_halt',reason:failure});f.restart();
}
test('a second supported ACK interruption remains recoverable after explicit normal continuation',t=>{
  const f=fixture(t);secondAckFailure(f);
  const status=f.bridge.handle({action:'case_recovery_status',batchId});assert.equal(status.restoration,null);
  assert.equal(status.batches[batchId].dispatch.phase,'ACKNOWLEDGED');
  assert.equal(f.bridge.handle(f.input(true)).status,'COMPLETED');
  assert.equal(journal(f).batches[batchId].ackRecoveries.length,2);
});
test('past provider tampering stays rejected while a new pending ACK is being inspected',t=>{
  const f=fixture(t);secondAckFailure(f);const file=path.join(f.root,'journal.json'),x=journal(f);
  x.batches[batchId].dispatch.attempts[0].provider.status='FAILED';fs.writeFileSync(file,JSON.stringify(x));f.restart();
  unchanged(f,{action:'case_recovery_status',batchId},'CASE_ACK_AUDIT');assert.equal(journal(f).batches[batchId].next,1);
});
const createRunner=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'runner.js'),'utf8'),{setTimeout:fn=>setTimeout(fn,0)});
function transport(f,{loseRecoveryReply=false,ownerFault}={}){
  const pages=new Map([[A,after(A)],[B,before(B)]]),events=[];let writes=0,sequence=0;
  const tools={
    async mcp__codex_apps__remote_desktop_commander_start_process(){f.restart();return {content:[{type:'text',text:'PID '+(++sequence)+'\nNPG/1 {"ready":true}'}]};},
    async mcp__codex_apps__remote_desktop_commander_interact_with_process({input}){
      const q=JSON.parse(input);events.push(q.action);let r;
      try{r={ok:true,requestId:q.requestId,result:f.bridge.handle(q)};}catch(e){r={ok:false,requestId:q.requestId,code:e.code,error:e.message};}
      if(q.action==='close')f.bridge.close();
      if(loseRecoveryReply&&q.action==='case_reconcile_acknowledged')return {content:[]};
      return {content:[{type:'text',text:'NPG/1 '+JSON.stringify(r)}]};
    },
    async mcp__codex_apps__remote_desktop_commander_read_process_output(){return {content:[]};},
    async mcp__codex_apps__notion_fetch({id}){events.push('fetch:'+id);return structuredClone(pages.get(id));},
    async mcp__codex_apps__notion_notion_update_page(request){writes++;events.push('native:'+request.page_id);
      pages.set(request.page_id,after(request.page_id));return {structuredContent:{page_id:request.page_id}};}
  };
  return {events,get writes(){return writes;},runner:()=>createRunner(tools,{deviceId:'synthetic',command:'synthetic incident bridge',caseAckBridge:true,
    assertOwnership:async({phase})=>({...f.ownerProof(),...(phase===ownerFault?{conflicts:['other-writer']}:{} )})})};
}
test('runner verifies the existing ACK with zero sends, then explicitly continues only the remaining target',async t=>{
  const f=fixture(t),io=transport(f),r=await io.runner().reconcileAcknowledged(batchId,f.ctx.planHash,true);
  assert.equal(io.writes,0);assert.equal(r.status,'READY');
  assert.equal((await io.runner().continueVerifiedCase(batchId,f.ctx.planHash,r.restoration)).status,'COMPLETED');
  assert.equal(io.writes,1);assert.equal(io.events.filter(v=>v==='native:'+A).length,0);
  assert.equal(journal(f).batches[batchId].dispatch.attempts.length,2);
});
test('lost recovery reply is not resent and readback provides its committed receipt',async t=>{
  const f=fixture(t),io=transport(f,{loseRecoveryReply:true});
  await assert.rejects(io.runner().reconcileAcknowledged(batchId,f.ctx.planHash,true),/BROKER_RESPONSE_UNKNOWN/);
  assert.equal(io.writes,0);assert.equal(io.events.filter(v=>v==='case_reconcile_acknowledged').length,1);
  f.restart();const readback=f.bridge.handle({action:'case_recovery_status',batchId});assert.equal(readback.batches[batchId].next,1);
  assert.equal(typeof readback.restoration.auditHash,'string');
});
test('current ownership change after recovery blocks all continuation sends',async t=>{
  const f=fixture(t),io=transport(f,{ownerFault:'dispatch'}),r=await io.runner().reconcileAcknowledged(batchId,f.ctx.planHash,true);
  await assert.rejects(io.runner().continueVerifiedCase(batchId,f.ctx.planHash,r.restoration),/OWNERSHIP_FENCE/);
  assert.equal(io.writes,0);assert.equal(journal(f).batches[batchId].status,'HALTED');
  assert.equal(journal(f).batches[batchId].reconciliations[0].error,failure);
});
