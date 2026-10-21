#!/usr/bin/env node
'use strict';
// One reviewed legacy incident. Missing original authorization stays UNKNOWN:
// close a superseded observation, never acknowledge or replay its pending write.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {Broker,hash,pageData,plan,atomic}=require('./broker.cjs');
const ROOT='/home/heain/.local/state/notion-projection-guard';
const RUNTIME='/home/heain/.local/share/notion-projection-guard';
const REVIEWED=Object.freeze({"batchId":"SORI-TRUST-20261021-R4-CLAIM40","planHash":"ed2c198174520ea22891f5460197053c167db70ead786e15eb23c365e6cca6d1","snapshotHash":"d3329cbb752ee49174bab13c23c0e7a471e5e710340b19d99c1076e21e7c81bf","error":"REVISION_READ_ERROR","next":2,"targets":["3f586e6dd1d181ebb43dd7de62aa2ca4","3f586e6dd1d181cd9f5bdcdab6290de7","3f586e6dd1d181ddb9f3e7217f64bfcd","3b286e6dd1d1817aa093fca807659f07","3b286e6dd1d181f2a75cfbd3885071c4","3bf86e6dd1d18110938bc358e17c779e","3ed86e6dd1d18118b0b8d98bb91892fb","3b286e6dd1d1811d9308d9a2b56c9de4"],"sources":[{"id":"3f586e6dd1d1819d823df1102a7fbcf6","bodyHash":"bf730f998b3a3ccec042715db222ee600b6b94417ab6927d53b9cc8926220d76","propertiesHash":"222360085eb22b15c366a5b3412198ead049ca5425ac1b6fdd822530ce56392c","revision":"2026-10-20T23:09:05.998Z"},{"id":"3f586e6dd1d181c89236cd70730bfff6","bodyHash":"9a6783b9961ad1ea01ffefbcb0e5c12991b5e755d0905655e63f5fa4a140be4b","propertiesHash":"1c58b65fd8838c7e319b75f79b9fd808dbf9297056f81f12012a3f33c0c4207e","revision":"2026-10-20T23:43:24.359Z"}],"prior":[{"index":0,"snapshotHash":"e1b8833c7473b4f018ef84975c829bbbe7bcb11f035f668c64cf528890e871e6","verifiedHash":"6565f41ee492f3a060e38e592607eea363940dc1e35f3e50aaaa10849d8478af","verifiedAt":"2026-10-20T23:06:47.054Z"},{"index":1,"snapshotHash":"21c1847718aa2f4d6f23c47e0a0b60a762cfe16a398254654a7399d520cded38","verifiedHash":"4132da45505abe71ae5398c10e3d1bff81aaeabddae1ffcf4ae9d8867d29f992","verifiedAt":"2026-10-20T23:07:11.231Z"}]});
const PINS={'broker.cjs':'5c4627be6dcd2433b8296933bf7273e2ce205c7644e2bf65ce601274a2a3b74c','runner.js':'d72764b5befaa3dc12f681bbaafaa8ea3d9db5f3acd17d43ca05fec342cbb01e','policy.json':'804709b778ea5fe82eac705654d06f52af8391aa0504d8e0582f3a87022fdf1b'};
function must(ok,why){if(!ok)throw new Error('CLAIM40_CLOSURE: '+why);}
function read(file){const st=fs.lstatSync(file);must(st.isFile()&&!st.isSymbolicLink()&&!(st.mode&0o077),'Private regular evidence required');return JSON.parse(fs.readFileSync(file,'utf8'));}
function runtimePins(){for(const [name,pin] of Object.entries(PINS))must(hash(fs.readFileSync(path.join(RUNTIME,name),'utf8'))===pin,'Existing approved runtime changed');}
function inspect(broker,input){
 const r=REVIEWED,b=broker.state.batches[r.batchId];
 must(broker.state.active===r.batchId&&b?.status==='HALTED'&&b.next===r.next&&b.error===r.error&&
  b.haltedFrom===undefined&&b.planHash===r.planHash&&hash(JSON.stringify(b.edits))===r.planHash&&
  b.receipt?.snapshotHash===r.snapshotHash&&b.edits.length===r.targets.length&&
  b.edits.every((e,i)=>e.pageId===r.targets[i]),'Exact legacy batch, scope and immutable plan required');
 must(JSON.stringify(read(broker.file))===JSON.stringify(broker.state),'Canonical journal drift');
 // Reapply current production policy without changing this batch.
 const policy=broker.handle({action:'begin',batchId:r.batchId,edits:b.edits});
 must(policy.status==='HALTED'&&policy.next===r.next&&policy.reused,'Existing policy admission changed');
 must(Array.isArray(input?.targets)&&input.targets.length===r.targets.length&&
  Array.isArray(input.sources)&&input.sources.length===r.sources.length,'Complete ordered fresh targets and sources required');
 const pages=input.targets.map((raw,i)=>pageData(raw,r.targets[i]));
 const sourcePages=input.sources.map((raw,i)=>pageData(raw,r.sources[i].id));
 for(let i=0;i<r.sources.length;i++){
  const p=sourcePages[i],pin=r.sources[i];
  must(hash(p.body)===pin.bodyHash&&hash(p.properties)===pin.propertiesHash&&p.revision===pin.revision,
   'Pinned r4 RELEASE41/PASS26 source changed or a later own event exists');
 }
 const prefix=hash(r.batchId)+'-',allowed=new Set();
 for(let i=0;i<=r.next;i++){allowed.add(prefix+i+'.json');if(i<r.next)allowed.add(prefix+i+'.json.verified.json');}
 for(const name of fs.readdirSync(broker.root))if(name.startsWith(prefix))must(allowed.has(name),'Unexpected pending/actual/verified evidence');
 const receipts=[];
 for(let i=0;i<=r.next;i++){
  const file=broker.snapshot(r.batchId,i),s=read(file),e=b.edits[i],raw=pageData(s.page.raw,e.pageId),p=plan(s.page,e);
  must(s.batchId===r.batchId&&s.index===i&&JSON.stringify(s.edit)===JSON.stringify(e)&&
   hash(s.page.body)===s.bodyHash&&hash(s.page.properties)===s.propertiesHash&&hash(s.expected)===s.expectedHash&&
   raw.body===s.page.body&&raw.properties===s.page.properties&&raw.revision===s.page.revision&&
   p.expected===s.expected&&p.beforeHash===s.beforeHash&&p.afterHash===s.afterHash,'Prepared evidence changed');
  must(pages[i].body===s.expected&&pages[i].properties===s.page.properties,'Entire observed output/properties differ');
  if(i<r.next){
   const v=read(file+'.verified.json'),vraw=pageData(v.page.raw,e.pageId);
   must(!v.reconciliation&&v.bodyHash===s.expectedHash&&v.page.body===s.expected&&
    v.page.properties===s.page.properties&&vraw.body===v.page.body&&vraw.properties===v.page.properties&&
    vraw.revision===v.page.revision&&pages[i].revision===v.page.revision,'Original full verification changed');
   const receipt={index:i,snapshotHash:hash(JSON.stringify(s)),verifiedHash:hash(JSON.stringify(v)),verifiedAt:v.at};
   must(JSON.stringify(receipt)===JSON.stringify(r.prior[i]),'Pinned complete prior receipt changed');
   receipts.push(receipt);
  }else{
   must(b.receipt.snapshot===file&&b.receipt.ticket===s.ticket&&hash(JSON.stringify(s))===r.snapshotHash&&
    Date.parse(pages[i].revision)>Date.parse(s.page.revision),'Pending snapshot or newer observed output changed');
  }
 }
 for(let i=r.next+1;i<pages.length;i++){
  must(!pages[i].body.includes(b.edits[i].newStr),'A supposedly unprepared later output is already present');
  plan(pages[i],b.edits[i]); // Scoped original old literal is still present once.
 }
 return {kind:'REVIEWED_SUPERSEDED_CLAIM40_CLOSURE',batchId:r.batchId,planHash:r.planHash,next:r.next,
  pendingSnapshotHash:r.snapshotHash,originalError:r.error,originalAuthorization:'UNKNOWN',
  observedExactOutputs:3,durableVerifiedOutputs:2,unpreparedRemaining:5,notionWrites:0,
  acknowledgedWrites:0,pageAdvances:0,receipts,sources:r.sources,
  freshTargets:pages.map((p,i)=>({pageId:r.targets[i],bodyHash:hash(p.body),propertiesHash:hash(p.properties),revision:p.revision})),
  successor:'D01 TRUST r4 RELEASE41 and independent PASS26 supersede the old CLAIM40 observation; product admission remains gated'};
}
function applyClosure(broker,input,checkOnly=true){
 runtimePins();must(broker.root===ROOT,'Canonical root required');
 const before=fs.readFileSync(broker.file,'utf8'),audit=inspect(broker,input);
 must(fs.readFileSync(broker.file,'utf8')===before,'Journal changed during inspection');
 if(checkOnly)return {checkOnly:true,audit};
 const auditFile=path.join(ROOT,hash(REVIEWED.batchId)+'.claim40-superseded-closure.json');
 must(!fs.existsSync(auditFile),'Existing closure evidence requires reconciliation');
 audit.at=new Date().toISOString();audit.journalBeforeHash=hash(before);
 const after=JSON.parse(before),b=after.batches[REVIEWED.batchId];
 b.status='ABORTED_SUPERSEDED';b.resolution=audit;after.active=null;
 atomic(auditFile,{audit,journalBefore:JSON.parse(before),freshPages:input});
 must(fs.readFileSync(broker.file,'utf8')===before,'Journal changed before terminal closure');
 atomic(broker.file,after);must(JSON.stringify(read(broker.file))===JSON.stringify(after),'Closure readback differs');
 broker.state=after;
 return {checkOnly:false,status:b.status,next:b.next,active:null,auditFile,audit};
}
if(require.main===module){
 let broker;const args=process.argv.slice(2);
 try{must(args.length===1&&['--check-only','--apply'].includes(args[0]),'Choose explicit check-only or apply');runtimePins();broker=new Broker(ROOT,JSON.parse(fs.readFileSync(path.join(RUNTIME,'policy.json'),'utf8')));}
 catch(e){process.stdout.write('NPG-C40 '+JSON.stringify({ok:false,error:e.message})+'\n');process.exit(1);}
 let closed=false;function close(){if(!closed){closed=true;broker.close();}}
 process.on('exit',close);for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>process.exit(1));
 process.stdout.write('NPG-C40 {"ready":true}\n');
 const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 rl.once('line',line=>{try{const result=applyClosure(broker,JSON.parse(line),args[0]==='--check-only');process.stdout.write('NPG-C40 '+JSON.stringify({ok:true,...result})+'\n',()=>process.exit(0));}catch(e){process.stdout.write('NPG-C40 '+JSON.stringify({ok:false,error:e.message})+'\n',()=>process.exit(1));}});
 rl.on('close',close);
}
module.exports={inspect,applyClosure};
