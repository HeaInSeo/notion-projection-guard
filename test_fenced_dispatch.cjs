'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {Broker,hash}=require('./broker.cjs');
const A='a'.repeat(32),B='b'.repeat(32),heading='## CURRENT CENTRAL OBSERVATION · dispatch';
const edit={pageId:A,heading,oldStr:'state=BEFORE',newStr:'state=AFTER'};
const policy={productionEnabled:true,productionPages:[A,B],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
function page(value='BEFORE',props={title:'Test'},revision='2026-10-26T00:00:00Z',pageId=A) {
  return {structuredContent:{id:pageId,page_last_edited_at:revision,text:'<properties>\n'+JSON.stringify(props)+
    '\n</properties>\n<content>\n'+heading+'\nstate='+value+'\n## WORKER PROOF\npreserved history\n</content>'}};
}
function proof(changes={}) {
  return {ownerId:'central:test',scope:'sori-admin',generation:'one',prerequisites:true,conflicts:[],
    evidenceHash:'a'.repeat(64),observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),...changes};
}
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'npg-fence-'));let b=new Broker(root,policy);
  t.after(()=>{if(!b.closed)b.close();fs.rmSync(root,{recursive:true,force:true});});
  const f={root,get b(){return b;},restart(){b.close();b=new Broker(root,policy);return b;}};
  f.start=(edits=[edit])=>{const r=b.handle({action:'fence_begin',batchId:'case',edits,ownerProof:proof()});
    f.ctx={batchId:'case',executor:r.executor,planHash:r.planHash};return r;};
  f.call=(action,args={})=>b.handle({...f.ctx,action,ownerProof:proof(),...args});
  f.prepare=()=>{const r=f.call('fence_prepare',{page:page()});f.ctx.ticket=r.ticket;return r;};
  f.authorize=()=>f.call('fence_authorize',{page:page()});
  f.dispatch=(confirm=true)=>{const r=f.call('fence_dispatch',{page:page()});f.ctx.dispatchId=r.dispatchId;
    if(confirm)f.call('fence_confirm_send');return r;};
  f.recovery=(apply=false,extra={})=>({action:'fence_recover_unsent',...f.ctx,ownerProof:proof(),apply,
    journalHash:hash(fs.readFileSync(b.file,'utf8')),snapshotHash:b.state.batches.case.receipt?.snapshotHash??null,
    expectedError:b.state.batches.case.error??null,expectedPhase:b.state.batches.case.dispatch.phase,page:page(),...extra});
  return f;
}
const inventory=root=>Object.fromEntries(fs.readdirSync(root).sort().map(n=>[n,hash(fs.readFileSync(path.join(root,n),'utf8'))]));
function rejectedUnchanged(f,fn,code) {
  const before=inventory(f.root);assert.throws(fn,e=>!code||e.code===code);assert.deepEqual(inventory(f.root),before);
}
test('historical post-authorize/pre-tool ownership veto is reproduced and legacy recovery refuses it',t=>{
  const f=fixture(t),b=f.b;b.handle({action:'begin',batchId:'historical',edits:[edit]});
  const r=b.handle({action:'prepare',batchId:'historical',page:page()});
  const a=b.handle({action:'authorize',batchId:'historical',ticket:r.ticket,page:page()});
  assert.ok(a.request);let calls=0;
  const callback=()=>{throw Error('Central in-flight conflict; do not mutate');calls++;};
  assert.throws(callback);assert.equal(calls,0);
  b.handle({action:'halt',batchId:'historical',reason:'Central in-flight conflict; do not mutate'});
  assert.equal(b.state.batches.historical.haltedFrom,'WRITE_PENDING');
  assert.throws(()=>b.handle({action:'reconcile_receipts',batchId:'historical',planHash:b.state.batches.historical.planHash,
    expectedError:b.state.batches.historical.error}),e=>e.code==='RECONCILE_SCOPE');
});
for(const changes of [{conflicts:['scheduled-central']},{conflicts:''},{conflicts:{length:0}},
  {prerequisites:false},{generation:''},{scope:'   '},
  {observedAt:'2020-01-01T00:00:00Z'},{validUntil:'2020-01-01T00:00:00Z'}])
test('pre-admission conflict/invalid proof creates no journal, snapshot or ticket '+JSON.stringify(changes),t=>{
  const f=fixture(t);rejectedUnchanged(f,()=>f.b.handle({action:'fence_begin',batchId:'case',edits:[edit],ownerProof:proof(changes)}),'OWNERSHIP_FENCE');
  assert.equal(f.b.state.active,null);assert.deepEqual(fs.readdirSync(f.root),['broker.lock']);
});
test('normal fenced path exports only once after SEND_INTENT and verifies after a real ACK',t=>{
  const f=fixture(t);f.start();f.prepare();const a=f.authorize();assert.equal(a.request,undefined);
  assert.equal(f.b.state.batches.case.dispatch.phase,'AUTHORIZED');
  const d=f.dispatch();assert.ok(d.request);assert.equal(f.b.state.batches.case.dispatch.phase,'SEND_INTENT');
  rejectedUnchanged(f,()=>f.call('fence_dispatch',{page:page()}),'PAGE_BARRIER');
  f.call('fence_ack',{provider:{status:'SUCCEEDED',pageId:A}});
  assert.equal(f.call('fence_verify',{page:page('AFTER')}).status,'COMPLETED');assert.equal(f.b.state.active,null);
});
for(const changes of [{generation:'two'},{ownerId:'other'},{scope:'other'},
  {conflicts:['central']},{validUntil:'2020-01-01T00:00:00Z'}])
test('post-authorize owner/generation/lease change blocks request export '+JSON.stringify(changes),t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();
  rejectedUnchanged(f,()=>f.call('fence_dispatch',{page:page(),ownerProof:proof(changes)}),'OWNERSHIP_FENCE');
  assert.equal(f.b.state.batches.case.dispatch.phase,'AUTHORIZED');
});
for(const p of [page('BEFORE',{title:'changed'}),page('BEFORE',{title:'Test'},'2026-10-26T00:00:01Z'),page('CHANGED')])
test('fresh dispatch full body/properties/revision drift blocks export '+JSON.stringify(p).slice(-50),t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();
  rejectedUnchanged(f,()=>f.call('fence_dispatch',{page:p}),'CONCURRENT_CHANGE');
});
test('explicit unsent recovery is read-only in check mode, terminal in apply mode, and preserves original history',t=>{
  const f=fixture(t);f.start();const r=f.prepare();f.authorize();
  f.call('fence_halt',{reason:'ownership changed'});const before=JSON.parse(fs.readFileSync(f.b.file));
  const input=f.recovery(),files=inventory(f.root);assert.equal(f.b.handle(input).checkOnly,true);assert.deepEqual(inventory(f.root),files);
  const out=f.b.handle({...input,apply:true});assert.equal(out.status,'ABORTED_UNWRITTEN');assert.equal(f.b.state.active,null);
  const b=f.b.state.batches.case;for(const k of ['planHash','edits','next','receipt','error','haltedFrom'])assert.deepEqual(b[k],before.batches.case[k]);
  assert.equal(JSON.parse(fs.readFileSync(r.snapshot)).ticket,f.ctx.ticket);
  rejectedUnchanged(f,()=>f.b.handle({...input,apply:true}),'RECONCILE_IDENTITY');
  rejectedUnchanged(f,()=>f.call('fence_dispatch',{page:page()}),'EXECUTOR_FENCED');
});
test('restarted executor can explicitly close only a never-exported original ticket',t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();f.call('fence_halt',{reason:'pre-send failure'});const input=f.recovery();
  f.restart();rejectedUnchanged(f,()=>f.call('fence_dispatch',{page:page()}),'EXECUTOR_FENCED');
  assert.equal(f.b.handle(input).checkOnly,true);assert.equal(f.b.handle({...input,apply:true}).status,'ABORTED_UNWRITTEN');
});
test('old live Broker object cannot dispatch or unlink a successor lock after close',t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();const old=f.b;f.restart();const lock=fs.readFileSync(f.b.lock,'utf8');
  assert.throws(()=>old.handle({...f.ctx,action:'fence_dispatch',page:page(),ownerProof:proof()}),e=>e.code==='EXECUTOR_FENCED');
  old.close();assert.equal(fs.readFileSync(f.b.lock,'utf8'),lock);
});
for(const phase of ['SEND_INTENT','ACKNOWLEDGED'])
test('no-send recovery remains blocked after request export or ACK, including restart '+phase,t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();f.dispatch();
  if(phase==='ACKNOWLEDGED')f.call('fence_ack',{provider:{status:'SUCCEEDED',pageId:A}});
  f.call('fence_halt',{reason:'lost result'});const input=f.recovery();f.restart();
  rejectedUnchanged(f,()=>f.b.handle(input),'SEND_UNCERTAIN');assert.equal(f.b.state.active,'case');
});
test('pending and terminal provider task IDs must remain correlated',t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();f.dispatch();
  f.call('fence_observe',{provider:{status:'PENDING',pageId:A,taskId:'original'}});
  rejectedUnchanged(f,()=>f.call('fence_observe',{provider:{status:'PENDING',pageId:A,taskId:'other'}}),'DISPATCH_IDENTITY');
  rejectedUnchanged(f,()=>f.call('fence_ack',{provider:{status:'SUCCEEDED',pageId:A,taskId:'other'}}),'ACK_REQUIRED');
});
test('late results have a correlated observation path with no acknowledgement, replay or barrier release',t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();f.dispatch();f.call('fence_observe',{provider:{status:'PENDING',pageId:A,taskId:'original'}});
  f.call('fence_halt',{reason:'async polling lost'});f.restart();
  const input={...f.ctx,action:'fence_late_observation',apply:false,ownerProof:proof(),provider:{status:'SUCCEEDED',pageId:A,taskId:'original'},sourceHash:'b'.repeat(64)};
  const before=inventory(f.root);assert.equal(f.b.handle(input).checkOnly,true);assert.deepEqual(inventory(f.root),before);
  f.b.handle({...input,apply:true});const after=inventory(f.root);assert.equal(f.b.handle({...input,apply:true}).alreadyObserved,true);assert.deepEqual(inventory(f.root),after);
  assert.equal(f.b.state.active,'case');assert.equal(f.b.state.batches.case.next,0);
});
test('two execution/recovery processes cannot acquire the same canonical lock',t=>{
  const f=fixture(t);assert.throws(()=>new Broker(f.root,policy),e=>e.code==='LOCKED');
  const child=require('node:child_process').spawnSync(process.execPath,['-e',
    'try{new (require('+JSON.stringify(path.join(__dirname,'broker.cjs'))+').Broker)('+JSON.stringify(f.root)+','+JSON.stringify(policy)+');process.exit(2)}catch(e){process.stdout.write(e.code);process.exit(e.code==="LOCKED"?0:1)}'],{encoding:'utf8'});
  assert.equal(child.status,0);assert.equal(child.stdout,'LOCKED');
});
for(const action of ['authorize','prepare','verify','reconcile_unwritten','reconcile_applied_readback','reconcile_unprepared_read'])
test('fenced batch rejects legacy bypass '+action,t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();
  rejectedUnchanged(f,()=>f.b.handle({...f.ctx,action,page:page()}),'FENCED_PROTOCOL_REQUIRED');
});
test('altered snapshot or ticket cannot authorize or recover an unsent transaction',t=>{
  const f=fixture(t);f.start();const r=f.prepare();
  rejectedUnchanged(f,()=>f.call('fence_authorize',{ticket:'other',page:page()}),'EXECUTOR_FENCED');
  fs.appendFileSync(r.snapshot,' ');const s=JSON.parse(fs.readFileSync(r.snapshot));s.ticket='tampered';fs.writeFileSync(r.snapshot,JSON.stringify(s));
  rejectedUnchanged(f,()=>f.authorize(),'PERSISTENCE');
});
const createRunner=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'runner.js'),'utf8'),{setTimeout:fn=>setTimeout(fn,0)});
function orchestration(t,{fault,ownershipFault}={}) {
  const f=fixture(t),events=[];let value=page(),writes=0,late;
  const tools={
    async mcp__codex_apps__remote_desktop_commander_start_process(){return {content:[{type:'text',text:'PID 1\nNPG/1 {"ready":true}'}]};},
    async mcp__codex_apps__remote_desktop_commander_interact_with_process({input}) {
      const q=JSON.parse(input);events.push(q.action);let out;
      try{out={ok:true,requestId:q.requestId,result:f.b.handle(q)};}catch(e){out={ok:false,requestId:q.requestId,code:e.code,error:e.message};}
      if(fault==='lost-dispatch-reply'&&q.action==='fence_dispatch')return {content:[]};
      return {content:[{type:'text',text:'NPG/1 '+JSON.stringify(out)}]};
    },
    async mcp__codex_apps__remote_desktop_commander_read_process_output(){return {content:[]};},
    async mcp__codex_apps__notion_fetch(){events.push('fetch');return structuredClone(value);},
    async mcp__codex_apps__notion_notion_update_page() {
      events.push('SEND');writes++;
      if(fault==='late-write') {late=()=>{value=page('AFTER');};return {structuredContent:{async_task:{task_id:'late-task'}}};}
      value=page('AFTER');if(fault==='lost-ack')throw Error('provider reply lost after apply');
      return {structuredContent:{page_id:A}};
    },
    async mcp__codex_apps__notion_notion_get_async_task(){throw Error('poll response lost');}
  };
  const runner=createRunner(tools,{deviceId:'synthetic',command:'synthetic',assertOwnership:async({phase})=>{
    events.push('owner:'+phase);return proof(ownershipFault===phase?{generation:'two',conflicts:['other']}:{ });
  }});
  return {...f,runner,events,
    runnerWithProof:fn=>createRunner(tools,{deviceId:'synthetic',command:'synthetic',allowLegacyRecovery:true,assertOwnership:fn}),
    get writes(){return writes;},late:()=>late(),get page(){return value;}};
}
test('current runner checks gates before durable begin and before request export',async t=>{
  const f=orchestration(t);assert.equal((await f.runner.run('case',[edit])).status,'COMPLETED');assert.equal(f.writes,1);
  assert.ok(f.events.indexOf('owner:begin')<f.events.indexOf('fence_begin'));
  assert.ok(f.events.indexOf('owner:dispatch')<f.events.indexOf('fence_dispatch'));
  assert.ok(f.events.indexOf('fence_dispatch')<f.events.indexOf('SEND'));
  assert.ok(f.events.indexOf('fence_ack')<f.events.indexOf('fence_verify'));
});
test('current runner post-authorize conflict leaves a supported unsent state with zero sends',async t=>{
  const f=orchestration(t,{ownershipFault:'dispatch'});await assert.rejects(f.runner.run('case',[edit]),/OWNERSHIP_FENCE/);
  assert.equal(f.writes,0);assert.equal(f.b.state.batches.case.status,'HALTED');assert.equal(f.b.state.batches.case.dispatch.phase,'AUTHORIZED');
});
for(const fault of ['lost-dispatch-reply','lost-ack','late-write'])
test('current runner retains uncertainty, original provider correlation and next owner for '+fault,async t=>{
  const f=orchestration(t,{fault});await assert.rejects(f.runner.run('case',[edit]));
  const b=f.b.state.batches.case;assert.equal(b.status,'HALTED');assert.equal(b.dispatch.phase,'SEND_INTENT');
  assert.equal(f.b.state.active,'case');assert.match(b.dispatch.failure.next,/original provider/);
  assert.equal(f.writes,fault==='lost-dispatch-reply'?0:1);
  if(fault==='late-write'){assert.equal(b.dispatch.provider.taskId,'late-task');f.late();assert.match(f.page.structuredContent.text,/state=AFTER/);assert.equal(f.b.state.active,'case');}
});
test('removed public close action cannot mutate state under apply:false or bypass the explicit recovery API',t=>{
  const f=fixture(t);f.start();f.prepare();
  rejectedUnchanged(f,()=>f.call('fence_close_unsent',{apply:false,page:page()}),'ACTION');
  rejectedUnchanged(f,()=>f.call('fence_close_unsent',{apply:true,page:page()}),'ACTION');
});
test('a partially verified batch never receives whole-transaction ABORTED_UNWRITTEN closure',t=>{
  const f=fixture(t);f.start([edit,{...edit,pageId:B}]);f.prepare();f.authorize();f.dispatch();
  f.call('fence_ack',{provider:{status:'SUCCEEDED',pageId:A}});f.call('fence_verify',{page:page('AFTER')});
  f.ctx.ticket=null;const raw=page('BEFORE',undefined,undefined,B);
  const p=f.call('fence_prepare',{page:raw});f.ctx.ticket=p.ticket;f.call('fence_authorize',{page:raw});
  f.call('fence_halt',{reason:'second page pre-send conflict'});
  rejectedUnchanged(f,()=>f.b.handle(f.recovery(false,{page:raw})),'SEND_UNCERTAIN');
  assert.equal(f.b.state.active,'case');assert.equal(f.b.state.batches.case.next,1);
});
for(const second of ['async','sync'])
test('two-page current runner preserves attempt-local provider IDs for async → '+second,async t=>{
  const f=fixture(t),pages=new Map([[A,page()],[B,page('BEFORE',undefined,undefined,B)]]);let sends=0;
  const tools={
    async mcp__codex_apps__remote_desktop_commander_start_process(){return {content:[{type:'text',text:'PID 1\nNPG/1 {"ready":true}'}]};},
    async mcp__codex_apps__remote_desktop_commander_interact_with_process({input}) {
      const q=JSON.parse(input);let r;try{r={ok:true,requestId:q.requestId,result:f.b.handle(q)};}
      catch(e){r={ok:false,requestId:q.requestId,code:e.code,error:e.message};}
      return {content:[{type:'text',text:'NPG/1 '+JSON.stringify(r)}]};
    },
    async mcp__codex_apps__notion_fetch({id}){return structuredClone(pages.get(id));},
    async mcp__codex_apps__notion_notion_update_page(request) {
      const n=sends++;pages.set(request.page_id,page('AFTER',undefined,undefined,request.page_id));
      return n===0||second==='async'?{structuredContent:{async_task:{task_id:'task-'+n}}}:{structuredContent:{page_id:request.page_id}};
    },
    async mcp__codex_apps__notion_notion_get_async_task(){return {structuredContent:{status:'succeeded'}};}
  };
  const runner=createRunner(tools,{deviceId:'synthetic',command:'synthetic',assertOwnership:async()=>proof()});
  assert.equal((await runner.run('case',[edit,{...edit,pageId:B}])).status,'COMPLETED');assert.equal(sends,2);
  const attempts=f.b.state.batches.case.dispatch.attempts;assert.equal(attempts[0].provider.taskId,'task-0');
  assert.equal(attempts[1].provider.taskId,second==='async'?'task-1':null);assert.equal(f.b.state.active,null);
});
function legacyPrepared(f) {
  f.b.handle({action:'begin',batchId:'case',edits:[edit]});
  const r=f.b.handle({action:'prepare',batchId:'case',page:page()});
  f.b.handle({action:'halt',batchId:'case',reason:'FETCH_ERROR: interrupted pre-authorization read'});
  return {planHash:f.b.state.batches.case.planHash,ticket:r.ticket};
}
for(const bad of [{prerequisites:false,conflicts:['CURRENT_CENTRAL_OWNER']},{conflicts:''},
  {observedAt:'2020-01-01T00:00:00Z'}])
test('current runner validates returned legacy recovery proof before any mutation '+JSON.stringify(bad),async t=>{
  const f=orchestration(t),i=legacyPrepared(f),before=inventory(f.root);
  const runner=f.runnerWithProof(async()=>proof(bad));await assert.rejects(runner.resume('case',i.planHash),/OWNERSHIP_FENCE/);
  assert.equal(f.writes,0);assert.deepEqual(inventory(f.root),before);
});
test('supported legacy PREPARED recovery atomically enters the current fenced path using the same ticket',async t=>{
  const f=orchestration(t),i=legacyPrepared(f),runner=f.runnerWithProof(async()=>proof());
  const out=await runner.resume('case',i.planHash);assert.equal(out.status,'COMPLETED');assert.equal(f.writes,1);
  assert.ok(f.events.includes('fence_reconcile_prepared'));assert.ok(f.events.includes('fence_authorize'));
  assert.equal(f.events.includes('authorize'),false);assert.equal(f.b.state.batches.case.dispatch.attempts[0].ticket,i.ticket);
});
for(const phase of ['legacy-reconcile','authorize','dispatch'])
test('owner generation change at current legacy continuation '+phase+' prevents all native sends',async t=>{
  const f=orchestration(t),i=legacyPrepared(f);
  const runner=f.runnerWithProof(async({phase:p})=>proof(p===phase?{generation:'two'}:{}));
  await assert.rejects(runner.resume('case',i.planHash),/OWNERSHIP_FENCE/);assert.equal(f.writes,0);assert.equal(f.b.state.active,'case');
  if(phase==='legacy-reconcile')assert.equal(f.b.state.batches.case.dispatch,undefined);
  else assert.ok(['PREPARED','AUTHORIZED'].includes(f.b.state.batches.case.dispatch.phase));
});
for(const method of ['resumeUnprepared','reconcileAutolink'])
test('current '+method+' refuses a returned central conflict before changing a legacy journal',async t=>{
  const f=orchestration(t);f.b.handle({action:'begin',batchId:'case',edits:[edit]});
  if(method==='reconcileAutolink')f.b.handle({action:'prepare',batchId:'case',page:page()});
  f.b.handle({action:'halt',batchId:'case',reason:method==='resumeUnprepared'?'FETCH_ERROR: pre-prepare':'READBACK_MISMATCH'});
  const before=inventory(f.root),b=f.b.state.batches.case,runner=f.runnerWithProof(async()=>proof({prerequisites:false,conflicts:['other']}));
  const call=method==='resumeUnprepared'?runner.resumeUnprepared('case',b.planHash):runner.reconcileAutolink('case',b.planHash,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64));
  await assert.rejects(call,/OWNERSHIP_FENCE/);assert.equal(f.writes,0);assert.deepEqual(inventory(f.root),before);
});
test('single-use send confirmation is required before accepting any native provider result',t=>{
  const f=fixture(t);f.start();f.prepare();f.authorize();f.dispatch(false);
  rejectedUnchanged(f,()=>f.call('fence_ack',{provider:{status:'SUCCEEDED',pageId:A}}),'ACK_REQUIRED');
  f.call('fence_confirm_send');rejectedUnchanged(f,()=>f.call('fence_confirm_send'),'PAGE_BARRIER');
});
for(const delayedReply of ['fence_dispatch','fence_confirm_send'])
test('a delayed '+delayedReply+' reply cannot cause a native send after its source lease expires',async t=>{
  const f=fixture(t),realNow=Date.now,start=realNow();let now=start,writes=0;
  const sourceProof=proof({observedAt:new Date(start).toISOString(),validUntil:new Date(start+60000).toISOString()});
  const Clock=class extends Date {static now(){return now;}};
  const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'runner.js'),'utf8'),{Date:Clock,setTimeout:fn=>setTimeout(fn,0)});
  const tools={
    async mcp__codex_apps__remote_desktop_commander_start_process(){return {content:[{type:'text',text:'PID 1\nNPG/1 {"ready":true}'}]};},
    async mcp__codex_apps__remote_desktop_commander_interact_with_process({input}) {
      const q=JSON.parse(input);let result;try{result={ok:true,requestId:q.requestId,result:f.b.handle(q)};}
      catch(e){result={ok:false,requestId:q.requestId,code:e.code,error:e.message};}
      if(q.action===delayedReply)now+=120000;
      return {content:[{type:'text',text:'NPG/1 '+JSON.stringify(result)}]};
    },
    async mcp__codex_apps__notion_fetch(){return page();},
    async mcp__codex_apps__notion_notion_update_page(){writes++;return {structuredContent:{page_id:A}};}
  };
  Date.now=()=>now;
  try {
    const runner=factory(tools,{deviceId:'synthetic',command:'synthetic',assertOwnership:async()=>structuredClone(sourceProof)});
    await assert.rejects(runner.run('case',[edit]),/OWNERSHIP_FENCE|SEND_PERMIT_EXPIRED/);
  } finally {Date.now=realNow;}
  assert.equal(writes,0);assert.equal(f.b.state.batches.case.dispatch.phase,'SEND_INTENT');assert.equal(f.b.state.active,'case');
  const b=f.b.state.batches.case;
  rejectedUnchanged(f,()=>f.b.handle(f.recovery(false,{batchId:'case',planHash:b.planHash,ticket:b.receipt.ticket})),'SEND_UNCERTAIN');
});
test('owner conflict discovered at final send confirmation never invokes the native tool',async t=>{
  const f=orchestration(t,{ownershipFault:'send'});await assert.rejects(f.runner.run('case',[edit]),/OWNERSHIP_FENCE/);
  assert.equal(f.writes,0);assert.equal(f.b.state.batches.case.dispatch.phase,'SEND_INTENT');assert.equal(f.b.state.active,'case');
});
