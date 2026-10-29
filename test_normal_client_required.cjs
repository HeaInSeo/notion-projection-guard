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
