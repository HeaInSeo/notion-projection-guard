#!/usr/bin/env node
'use strict';
// Synthetic MCP endpoint for the real CLI hook test. No Notion/network access.
const fs=require('node:fs'),readline=require('node:readline');
const receipt=process.argv[2];
function reply(id,result){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
  let r;try{r=JSON.parse(line);}catch{return;}
  if(r.id===undefined)return;
  if(r.method==='initialize')return reply(r.id,{protocolVersion:r.params.protocolVersion,
    capabilities:{tools:{}},serverInfo:{name:'synthetic-case-hook-test',version:'1'}});
  if(r.method==='tools/list')return reply(r.id,{tools:[{name:'notion-update-page',
    description:'Synthetic harmless endpoint. Records that the tool was called; never contacts Notion.',
    inputSchema:{type:'object',properties:{page_id:{type:'string'},command:{type:'string'}},required:['page_id','command']}}]});
  if(r.method==='tools/call') {
    fs.appendFileSync(receipt,JSON.stringify({synthetic:true,name:r.params.name,arguments:r.params.arguments})+'\n',{mode:0o600});
    return reply(r.id,{content:[{type:'text',text:'Synthetic call completed; no external mutation.'}]});
  }
  reply(r.id,{});
});
