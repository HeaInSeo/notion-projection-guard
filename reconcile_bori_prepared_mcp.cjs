#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const ROOT='/home/heain/.local/state/notion-projection-guard';
const RUNTIME='/home/heain/.local/share/notion-projection-guard';
const SOURCE='d77969f2d84776226c62f36c5fbfcf4af98de57f';
const RECEIPT='/home/heain/.local/state/notion-projection-guard/manual-audits/nodekit-pointer-bori-operator-20261021/install-P2-c4f77e1/installation.json';
const RECEIPT_HASH='b3767b6145712b0bbdbe38512feb6db9eb493013faba6451a3c493fa8b18f6d5';
const BATCH='BORI-AUTH15-DRIFT-REPAIR-20261022';
const PLAN='a5bab1162d1a8127a11e0bd8f447fe7b3852ede2e41189653674b9f91986c8ac';
const TICKET='29ab3ddd-dfa0-4b38-888e-b715d24a85f5';
const SNAPSHOT='6ddc216c5504d4de808972b462e0a02d318895920dcb55cf636ec9257846b8d3';
const JOURNAL='fa956d9c67a1ad3487fc2cfb9430ed28ddff105ee15c10eaa501840953af503a';
const ERROR='REMOTE_ERROR: McpServerError: MCP server is not initialized; send initialize and notifications/initialized before operational requests';
const PINS={'broker.cjs':'1e929736ca81a71090aebfdf9484fe95f6112fd77783326eaedbeeb2b259daf3',
  'runner.js':'99a77bf6b5fd88e1b6c9492da54157b141534aa7eec22d547b57337285a8f109',
  'policy.json':'804709b778ea5fe82eac705654d06f52af8391aa0504d8e0582f3a87022fdf1b'};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function must(ok,message){if(!ok)throw new Error('BORI_PREPARED_MCP: '+message);}
function bytes(file,privateFile=false){
  const st=fs.lstatSync(file);
  must(st.isFile()&&!st.isSymbolicLink()&&(!privateFile||!(st.mode&0o077)),'Regular unsymlinked evidence required');
  return fs.readFileSync(file,'utf8');
}
const read=file=>JSON.parse(bytes(file,true));
function pins(){
  for(const [name,pin] of Object.entries(PINS))must(hash(bytes(path.join(RUNTIME,name)))===pin,'Approved installed runtime changed: '+name);
  const receiptBytes=bytes(RECEIPT,true),receipt=JSON.parse(receiptBytes);
  must(hash(receiptBytes)===RECEIPT_HASH&&receipt.sourceCommit===SOURCE&&
    receipt.reviewedReleaseCommit==='c4f77e1b54dc59d365885ec56a2f414f51b2a229'&&
    receipt.policyChanged===false&&receipt.workerServicesChanged===false&&
    Object.entries(PINS).every(([n,h])=>receipt.after?.[n]===h),'Original installation receipt changed');
  const lines=bytes(path.join(RUNTIME,'approved.sha256')).trimEnd().split('\n'),manifest={};
  must(lines.length===3,'Exact approved runtime manifest required');
  for(const line of lines){
    const m=/^([a-f0-9]{64})  (broker\.cjs|runner\.js|policy\.json)$/.exec(line);
    must(m&&!Object.hasOwn(manifest,m[2]),'Invalid approved runtime manifest');manifest[m[2]]=m[1];
  }
  must(Object.entries(PINS).every(([n,h])=>manifest[n]===h),'Approved manifest differs from the reviewed installed source');
}
// Check installed bytes before importing the existing broker. The helper neither
// installs its adjacent updated broker nor patches the installed module.
pins();
const {Broker,pageData,plan,validateEdit,atomic}=require(path.join(RUNTIME,'broker.cjs'));
const AUDIT=path.join(ROOT,hash(BATCH)+'.prepared-mcp-initialization-recovery.json');
function inspect(broker,raw){
  must(broker instanceof Broker&&broker.root===ROOT,'Canonical installed broker required');
  const lock=read(broker.lock);must(lock.pid===process.pid,'Current process must own the canonical broker lock');
  const journal=bytes(broker.file,true),b=broker.state.batches[BATCH];
  must(hash(journal)===JOURNAL&&JSON.stringify(JSON.parse(journal))===JSON.stringify(broker.state),'Original canonical journal changed');
  must(broker.state.active===BATCH&&b?.status==='HALTED'&&b.haltedFrom==='PREPARED'&&b.error===ERROR&&
    b.readDetail==null&&b.next===4&&b.edits?.length===5&&b.planHash===PLAN&&hash(JSON.stringify(b.edits))===PLAN&&
    b.receipt?.ticket===TICKET&&b.receipt.snapshot===broker.snapshot(BATCH,4)&&b.receipt.snapshotHash===SNAPSHOT,
    'Exact original prepared incident, immutable plan and ticket required');
  must(!fs.existsSync(AUDIT),'Existing recovery audit requires separate reconciliation');
  // begin() reuses this immutable HALTED batch while rechecking current scope.
  const admission=broker.handle({action:'begin',batchId:BATCH,edits:b.edits});
  must(admission.reused===true&&admission.status==='HALTED'&&admission.next===4,'Existing production policy admission changed');
  return inspectPages(broker,b,raw);
}
function inspectPages(broker,b,raw){
  must(Array.isArray(raw)&&raw.length===5,'Five complete fresh reads in original edit order required');
  const pages=raw.map((p,i)=>pageData(p,b.edits[i].pageId)),prefix=hash(BATCH)+'-',allowed=new Set([prefix+'4.json']),receipts=[];
  for(let i=0;i<5;i++){
    const edit=b.edits[i],file=broker.snapshot(BATCH,i),s=read(file),before=pageData(s.page.raw,edit.pageId);
    validateEdit(edit,broker.policy);const generated=plan(s.page,edit);
    must(s.batchId===BATCH&&s.index===i&&typeof s.ticket==='string'&&s.ticket.length>0&&JSON.stringify(s.edit)===JSON.stringify(edit)&&
      hash(s.page.body)===s.bodyHash&&hash(s.page.properties)===s.propertiesHash&&hash(s.expected)===s.expectedHash&&
      before.body===s.page.body&&before.properties===s.page.properties&&before.revision===s.page.revision&&
      generated.expected===s.expected&&generated.beforeHash===s.beforeHash&&generated.afterHash===s.afterHash,'Immutable full snapshot changed');
    if(i<4){
      allowed.add(prefix+i+'.json');allowed.add(prefix+i+'.json.verified.json');
      const v=read(file+'.verified.json'),saved=pageData(v.page.raw,edit.pageId);
      broker.verifiedFingerprint(s,v,b,i);
      must(!v.reconciliation&&v.bodyHash===s.expectedHash&&v.page.body===s.expected&&v.page.properties===s.page.properties&&
        saved.body===v.page.body&&saved.properties===v.page.properties&&saved.revision===v.page.revision&&
        pages[i].body===v.page.body&&pages[i].properties===v.page.properties&&pages[i].revision===v.page.revision,
        'Prior full verified receipt or fresh protected page changed');
      receipts.push({index:i,snapshotHash:hash(JSON.stringify(s)),verifiedHash:hash(JSON.stringify(v)),verifiedAt:v.at,
        freshBodyHash:hash(pages[i].body),freshPropertiesHash:hash(pages[i].properties),freshRevision:pages[i].revision});
    }else{
      must(hash(JSON.stringify(s))===SNAPSHOT&&s.ticket===TICKET&&pages[i].body===s.page.body&&
        pages[i].properties===s.page.properties&&pages[i].revision===s.page.revision,'Pending original full preimage, revision or snapshot changed');
    }
  }
  for(const n of fs.readdirSync(ROOT))if(n.startsWith(prefix))must(allowed.has(n),'Unexpected pending or future evidence exists');
  return {kind:'UNWRITTEN_PREPARED_MCP_INITIALIZATION',reviewedSourceCommit:SOURCE,batchId:BATCH,planHash:PLAN,error:ERROR,
    haltedFrom:'PREPARED',index:4,next:4,ticket:TICKET,snapshotHash:SNAPSHOT,priorVerified:4,receipts,
    pendingBodyHash:hash(pages[4].body),pendingPropertiesHash:hash(pages[4].properties),pendingRevision:pages[4].revision,
    notionWrites:0,acknowledgedWrites:0,pageAdvances:0};
}
function apply(broker,raw,checkOnly=true){
  pins();must(typeof checkOnly==='boolean','Explicit boolean check-only selection required');
  const journalBefore=bytes(broker.file,true),audit=inspect(broker,raw);
  must(bytes(broker.file,true)===journalBefore,'Canonical journal changed during inspection');
  if(checkOnly)return {checkOnly:true,status:'HALTED',next:4,audit};
  audit.at=new Date().toISOString();audit.journalBeforeHash=hash(journalBefore);
  const expected=JSON.parse(journalBefore),b=expected.batches[BATCH];
  b.status='PREPARED';delete b.error;delete b.haltedFrom;
  b.reconciliations=[...(b.reconciliations??[]),audit];
  atomic(AUDIT,{audit,journalBefore:JSON.parse(journalBefore),freshPages:raw});
  pins();must(bytes(broker.file,true)===journalBefore,'Canonical journal changed before restoration');
  atomic(broker.file,expected);const after=read(broker.file);
  must(JSON.stringify(after)===JSON.stringify(expected),'Restored journal readback differs');broker.state=after;
  return {checkOnly:false,status:'PREPARED',next:4,ticket:TICKET,audit,auditFile:AUDIT,
    restoration:{journalHash:hash(bytes(broker.file,true)),auditHash:hash(bytes(AUDIT,true))}};
}

function inspectRestored(broker,raw,restoration){
  pins();
  must(broker instanceof Broker&&broker.root===ROOT,'Canonical installed broker required');
  must(read(broker.lock).pid===process.pid,'Current process must own the canonical broker lock');
  must(restoration&&Object.keys(restoration).sort().join(',')==='auditHash,journalHash'&&
    Object.values(restoration).every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)),
    'Exact helper restoration receipt required');
  const journal=bytes(broker.file,true),auditBytes=bytes(AUDIT,true),saved=JSON.parse(auditBytes);
  must(hash(journal)===restoration.journalHash&&hash(auditBytes)===restoration.auditHash,
    'Restored canonical journal or recovery audit changed');
  must(saved&&hash(JSON.stringify(saved.journalBefore))===JOURNAL&&
    saved.audit?.journalBeforeHash===JOURNAL,'Original recovery audit journal changed');
  const expected=JSON.parse(JSON.stringify(saved.journalBefore)),b=expected.batches[BATCH];
  must(expected.active===BATCH&&b.status==='HALTED'&&b.haltedFrom==='PREPARED'&&b.error===ERROR&&
    b.next===4&&b.planHash===PLAN&&hash(JSON.stringify(b.edits))===PLAN&&
    b.receipt.ticket===TICKET&&b.receipt.snapshotHash===SNAPSHOT,'Original recovery identity changed');
  b.status='PREPARED';delete b.error;delete b.haltedFrom;
  b.reconciliations=[...(b.reconciliations??[]),saved.audit];
  must(journal===JSON.stringify(expected)&&JSON.stringify(broker.state)===journal,
    'Exact restored plan, in-memory state or prior journal evidence changed');
  const admission=broker.handle({action:'begin',batchId:BATCH,edits:b.edits});
  must(admission.reused===true&&admission.status==='PREPARED'&&admission.next===4,
    'Restored production policy admission changed');
  const actual=inspectPages(broker,b,raw);
  actual.at=saved.audit.at;actual.journalBeforeHash=JOURNAL;
  must(JSON.stringify(actual)===JSON.stringify(saved.audit),'Restored full page or prior receipt proof changed');
  must(bytes(broker.file,true)===journal&&bytes(AUDIT,true)===auditBytes,
    'Restored evidence changed during verification');
  return {status:'PREPARED',batchId:BATCH,planHash:PLAN,ticket:TICKET,next:4,restoration};
}
function handleContinuation(broker,input){
  must(input&&typeof input==='object','Continuation request required');
  if(input.action==='close')return broker.handle({action:'close'});
  must(input.batchId===BATCH,'Exact continuation batch required');
  if(input.action==='verify_restored_prepared'||input.action==='authorize'){
    must(input.planHash===PLAN&&input.ticket===TICKET,'Exact continuation plan and ticket required');
    const verified=inspectRestored(broker,input.pages,input.restoration);
    if(input.action==='verify_restored_prepared')return verified;
    const pending=pageData(input.page,broker.state.batches[BATCH].edits[4].pageId);
    const observed=pageData(input.pages[4],broker.state.batches[BATCH].edits[4].pageId);
    must(pending.body===observed.body&&pending.properties===observed.properties&&
      pending.revision===observed.revision,'Pending authorization read differs from restored proof');
    // Synchronous revalidation and legacy authorization share this broker lock.
    return broker.handle({action:'authorize',batchId:BATCH,ticket:TICKET,page:input.page});
  }
  must(['verify','halt'].includes(input.action),'Only the exact pending continuation is supported');
  if(input.action==='verify')must(input.ticket===TICKET,'Exact verification ticket required');
  return broker.handle(input);
}
function serveContinuation(broker,close){
  const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  process.stdout.write('NPG/1 '+JSON.stringify({ready:true})+'\n');
  rl.on('line',line=>{
    let input;
    try{
      input=JSON.parse(line);must(typeof input.requestId==='string'&&input.requestId.length>0,'Request ID required');
      const result=handleContinuation(broker,input);
      process.stdout.write('NPG/1 '+JSON.stringify({requestId:input.requestId,ok:true,result})+'\n');
      if(input.action==='close'){close();rl.close();process.stdin.pause();}
    }catch(error){process.stdout.write('NPG/1 '+JSON.stringify({requestId:input?.requestId,ok:false,
      code:error.code??'EXACT_RESTORATION',error:error.message})+'\n');}
  });
  rl.on('close',close);
}

if(require.main===module){
  let broker,closed=false;
  function close(){if(broker&&!closed){closed=true;broker.close();}}
  process.on('exit',close);for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>process.exit(1));
  try{
    const args=process.argv.slice(2);
    const serving=args.length===1&&args[0]==='--serve-continuation';
    must(serving||(args.length<=1&&args.every(a=>['--check-only','--apply'].includes(a))),
      'Choose check-only, explicit apply or exact continuation');
    pins();broker=new Broker(ROOT,JSON.parse(bytes(path.join(RUNTIME,'policy.json'))));
    if(serving){serveContinuation(broker,close);}else{
    const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
    let received=false,rejected=false,replied=false;
    function reply(value,status){
      if(replied)return;replied=true;
      process.stdout.write('NPG-BM1 '+JSON.stringify(value)+'\n',()=>process.exit(status));
    }
    process.stdout.write('NPG-BM1 {"ready":true}\n');
    rl.on('line',line=>{
      if(replied)return;
      if(received){rejected=true;reply({ok:false,error:'BORI_PREPARED_MCP: Exactly one evidence JSON line required'},1);return;}
      received=true;
      // Let readline report any additional lines already in this input chunk
      // before inspecting/applying the first. Interactive callers need no EOF.
      setImmediate(()=>{
        if(rejected)return;
        try{const result=apply(broker,JSON.parse(line),!args.includes('--apply'));reply({ok:true,...result},0);}
        catch(e){reply({ok:false,error:e.message},1);}
      });
    });
    rl.on('close',()=>{
      if(!received)reply({ok:false,error:'BORI_PREPARED_MCP: Evidence input required before EOF'},1);
    });
    }
  }catch(e){process.stdout.write('NPG-BM1 '+JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=1;}
}
module.exports={inspect,apply,inspectRestored,handleContinuation};
