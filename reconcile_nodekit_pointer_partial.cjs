#!/usr/bin/env node
'use strict';
// Exact incident closure. No Notion request, successful ACK, or page advance.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {Broker,hash,pageData,plan,atomic,validateEdit}=require('./broker.cjs');
const ROOT='/home/heain/.local/state/notion-projection-guard';
const RUNTIME='/home/heain/.local/share/notion-projection-guard';
const BATCH='NODEKIT-CLI-UF-CLAIM-POINTER-20261021T0817Z';
const PLAN='2cdec16dd39de14dffef51c6f886a8cf7999cb63b9b0d0444aeb1091a536c896';
const TICKET='641eb1fe-0dd4-4411-acf1-81ecce3c8c20';
const IDS=['3b286e6dd1d1817aa093fca807659f07','3b286e6dd1d181f2a75cfbd3885071c4','3ed86e6dd1d18118b0b8d98bb91892fb','3b286e6dd1d1811d9308d9a2b56c9de4','3bf86e6dd1d18110938bc358e17c779e'];
const PINS={'broker.cjs':'4c639747b1d0b2ad53f0b66950230d34282fe228aa38a9fbf02453afb38561b7','runner.js':'99a77bf6b5fd88e1b6c9492da54157b141534aa7eec22d547b57337285a8f109','policy.json':'804709b778ea5fe82eac705654d06f52af8391aa0504d8e0582f3a87022fdf1b'};
const FILES={'0.json':'d5e7bfa5385bbe2d5743da7ef465195147fc05603951054dc7f358a9af5cc5b6','0.json.actual.json':'24ceb620f4250077fe25b1ab9cb00a7a6b5c5b367e08c17b5740acb89b662291'};
const LITERAL={old:'575f92b45b34b0d5ac4cf90101f1ad0d76d0e664ae842447444017c24a699397',planned:'d168dccfbf92d710b4edd98a5dcb2478896c244ebdaf701309eab04287b6c09a',actual:'1da2d73439371cf5f54eec7736e1f64347ee5573fe3bc80f78d378f3c349a899'};
const BODY={expected:'02cdd46cf8b68c044d57a63228e99ad7ad7f9fb2221101292366bc254d2b7d04',actual:'6c2c39ab8ba9049a6cea8bd3ae086d0c852a46dc610658183c18ebb8b7707677',before:'21ecbee06b99c266b4536e206c9bbedc749b75473585ee4ebfee92edd4910959',after:'67277a7f71c8988c3e978eed676f620585fabe09ab5d0fa10267c1b508a4d2cc'};
function must(ok,why){if(!ok)throw new Error('NODEKIT_POINTER_PARTIAL: '+why);}
function read(file){const st=fs.lstatSync(file);must(st.isFile()&&!st.isSymbolicLink()&&!(st.mode&0o077),'Private regular evidence required');return JSON.parse(fs.readFileSync(file,'utf8'));}
function pins(){for(const [name,h] of Object.entries(PINS))must(hash(fs.readFileSync(path.join(RUNTIME,name),'utf8'))===h,'Runtime changed: '+name);must(hash(fs.readFileSync(path.join(__dirname,'broker.cjs'),'utf8'))===PINS['broker.cjs'],'Helper broker differs');}
function inspect(broker,raw){
  const b=broker.state.batches[BATCH],prefix=hash(BATCH)+'-';
  must(broker.state.active===BATCH&&b?.status==='HALTED'&&b.error==='READBACK_MISMATCH'&&b.next===0&&b.planHash===PLAN&&hash(JSON.stringify(b.edits))===PLAN&&b.edits.length===5&&b.receipt?.ticket===TICKET&&b.receipt.snapshot===broker.snapshot(BATCH,0)&&b.receipt.snapshotHash===FILES['0.json'],'Exact halted original batch/plan/ticket required');
  must(JSON.stringify(read(broker.file))===JSON.stringify(broker.state),'Journal changed outside lock');
  must(b.edits.every((e,i)=>e.pageId===IDS[i]),'Ordered original scope changed');
  must(broker.handle({action:'begin',batchId:BATCH,edits:b.edits}).status==='HALTED','Original scope/policy revoked');
  for(const n of fs.readdirSync(broker.root))if(n.startsWith(prefix))must(Object.hasOwn(FILES,n.slice(prefix.length)),'Unexpected prepared or acknowledged evidence');
  for(const [n,h] of Object.entries(FILES)){read(path.join(broker.root,prefix+n));must(hash(fs.readFileSync(path.join(broker.root,prefix+n),'utf8'))===h,'Original evidence changed: '+n);}
  must(Array.isArray(raw)&&raw.length===5,'Five complete ordered fresh pages required');
  const pages=raw.map((v,i)=>pageData(v,IDS[i]));
  const file=broker.snapshot(BATCH,0),s=read(file),a=read(file+'.actual.json'),e=b.edits[0];
  validateEdit(e,broker.policy);
  const pre=pageData(s.page.raw,IDS[0]),saved=pageData(a.page.raw,IDS[0]);
  const at=s.page.body.indexOf(e.oldStr),before=s.page.body.slice(0,at),after=s.page.body.slice(at+e.oldStr.length);
  must(at>=0&&s.page.body.indexOf(e.oldStr,at+1)<0&&s.batchId===BATCH&&s.index===0&&s.ticket===TICKET&&JSON.stringify(s.edit)===JSON.stringify(e)&&pre.body===s.page.body&&pre.properties===s.page.properties&&pre.revision===s.page.revision&&hash(pre.body)===s.bodyHash&&hash(pre.properties)===s.propertiesHash&&plan(s.page,e).expected===s.expected&&hash(s.expected)===s.expectedHash&&s.expectedHash===BODY.expected&&hash(before)===s.beforeHash&&s.beforeHash===BODY.before&&hash(after)===s.afterHash&&s.afterHash===BODY.after,'Complete canonical preimage/plan changed');
  must(hash(e.oldStr)===LITERAL.old&&hash(e.newStr)===LITERAL.planned,'Original literals changed');
  must(saved.body===a.page.body&&saved.properties===a.page.properties&&saved.revision===a.page.revision&&saved.properties===s.page.properties&&hash(saved.body)===a.actualHash&&a.actualHash===BODY.actual,'Saved full mismatch changed');
  must(saved.body.startsWith(before)&&saved.body.endsWith(after),'Protected prefix/suffix changed');
  const literal=saved.body.slice(before.length,saved.body.length-after.length);
  must(hash(literal)===LITERAL.actual&&saved.body===before+literal+after,'Difference exceeds exact recorded central literal');
  must(pages[0].body===saved.body&&pages[0].properties===saved.properties&&pages[0].revision===saved.revision,'Fresh applied page changed; preserve later evidence');
  for(let i=1;i<5;i++){validateEdit(b.edits[i],broker.policy);plan(pages[i],b.edits[i]);}
  return {kind:'REVIEWED_NODEKIT_POINTER_PARTIAL_CLOSURE',batchId:BATCH,planHash:PLAN,next:0,observedMisrenderedWrites:1,unattemptedEdits:4,notionWrites:0,acknowledgedWrites:0,pageAdvances:0,protectedContent:'UNCHANGED; EXACT_CENTRAL_RENDERING_DIFFERENCE_NOT_ACKNOWLEDGED',files:FILES,fresh:pages.map((p,i)=>({pageId:IDS[i],bodyHash:hash(p.body),propertiesHash:hash(p.properties),revision:p.revision}))};
}
function apply(broker,raw,checkOnly=true){
  pins();must(broker.root===ROOT,'Canonical state required');
  const before=fs.readFileSync(broker.file,'utf8'),audit=inspect(broker,raw);
  must(fs.readFileSync(broker.file,'utf8')===before,'Journal changed during inspection');
  if(checkOnly)return {checkOnly:true,audit};
  const auditFile=path.join(ROOT,hash(BATCH)+'.nodekit-pointer-partial-closure.json');must(!fs.existsSync(auditFile),'Existing audit requires reconciliation');
  audit.at=new Date().toISOString();audit.journalBeforeHash=hash(before);
  const after=JSON.parse(before);after.batches[BATCH].status='RECONCILED_PARTIAL';after.batches[BATCH].resolution=audit;after.active=null;
  atomic(auditFile,{audit,journalBefore:JSON.parse(before),freshPages:raw});
  must(fs.readFileSync(broker.file,'utf8')===before,'Journal changed before explicit closure');
  atomic(broker.file,after);must(JSON.stringify(read(broker.file))===JSON.stringify(after),'Closure readback differs');broker.state=after;
  return {checkOnly:false,status:'RECONCILED_PARTIAL',active:null,next:0,auditFile,audit};
}
if(require.main===module){
  let broker;try{must(process.argv.slice(2).every(a=>['--check-only','--apply'].includes(a))&&!(process.argv.includes('--check-only')&&process.argv.includes('--apply')),'Choose check-only or explicit apply');pins();broker=new Broker(ROOT,JSON.parse(fs.readFileSync(path.join(RUNTIME,'policy.json'),'utf8')));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exit(1);}
  let closed=false;function close(){if(!closed){closed=true;broker.close();}}process.on('exit',close);for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.on(s,()=>process.exit(1));
  const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});process.stdout.write('{"ready":true}\n');
  rl.once('line',line=>{try{const r=apply(broker,JSON.parse(line),!process.argv.includes('--apply'));process.stdout.write(JSON.stringify({ok:true,...r})+'\n',()=>process.exit(0));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n',()=>process.exit(1));}});rl.on('close',close);
}
module.exports={inspect,apply};
