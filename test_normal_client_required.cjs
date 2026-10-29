'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const create=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'normal_live_runner.js'),'utf8'));
for(const missing of ['legacy','sendOnce','recoverPreCall','consumeSourceExpiry','broker','close'])
test('ordinary live runner refuses '+missing+' adapter before broker init or native calls',()=>{
 let control=0,native=0;
 const client={broker(){control++;},close(){control++;},sendOnce(){control++;},recoverPreCall(){control++;},consumeSourceExpiry(){control++;}};
 if(missing==='legacy'){delete client.sendOnce;delete client.recoverPreCall;delete client.consumeSourceExpiry;}
 else delete client[missing];
 const tools={mcp__codex_apps__notion_fetch(){native++;},mcp__codex_apps__notion_notion_update_page(){native++;}};
 assert.throws(()=>create()(tools,{client}),/NORMAL_RPC_CLIENT_REQUIRED/);
 assert.equal(control,0);assert.equal(native,0);
});

test('completed transaction closes only the client captured before caller replacement',async()=>{
 let close=0,replacement=0;
 const client={async broker(q){return q.action==='normal_init'?{referenceToken:'bound'}:{status:'COMPLETED'};},
  async close(){close++;},sendOnce(){throw Error('must not send');},recoverPreCall(){throw Error('must not recover');},consumeSourceExpiry(){return false;}};
 const config={client,centralTaskId:'1'.repeat(32),runId:'run',references:[{pageId:'a'.repeat(32)}],
  binding:{repository:'nodekit',source:{pr:149}},createWitness:()=>async()=>({})};
 const runner=create()({},config);
 config.client={async close(){replacement++;throw Error('replaced client must not run');}};
 const r=await runner.run('NODEKIT149-LANDED-20261028',[]);
 assert.equal(r.alreadyConsumed,true);assert.equal(close,1);assert.equal(replacement,0);
});

test('replacing the expiry consumer cannot turn an unbranded failure into retries',async()=>{
 let stages=0,original=0,replacement=0,native=0;
 const client={async broker(q){
   if(q.action==='normal_init')return {referenceToken:'bound'};
   if(q.action==='validate_batch')return {status:'READY',next:0};
   if(q.action==='preflight')return {};
   if(q.action==='case_stage_input'){stages++;return {stageId:'stage',inputHash:'input'};}
   if(q.action==='case_consume_live')throw Error('unbranded failure');
   throw Error('unexpected '+q.action);
  },async close(){},sendOnce(){native++;},recoverPreCall(){throw Error('must not recover');},
  consumeSourceExpiry(){original++;return false;}};
 const config={client,centralTaskId:'1'.repeat(32),runId:'run',references:[{pageId:'a'.repeat(32)}],
  binding:{repository:'nodekit',source:{pr:149}},createWitness:()=>async()=>({})};
 const runner=create()({async mcp__codex_apps__notion_fetch(){return {structuredContent:{complete:true}};}},config);
 client.consumeSourceExpiry=()=>{replacement++;return true;};
 await assert.rejects(runner.run('NODEKIT149-LANDED-20261028',[{pageId:'a'.repeat(32)}]),/unbranded failure/);
 assert.equal(stages,1);assert.equal(original,1);assert.equal(replacement,0);assert.equal(native,0);
});
