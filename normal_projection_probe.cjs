'use strict';
// Read-only evidence for ordinary projection ownership after case admission.
// No broker action, journal write, role start, ACK or intake permit is exposed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
function probe({root,runtime,caseModuleHash,brokerPid,batchId,inspectClosedUnknown},clock=Date.now) {
  const started=clock();
  need(path.isAbsolute(root??'')&&path.isAbsolute(runtime??'')&&root!==runtime,'NORMAL_PATH');
  need(Number.isSafeInteger(brokerPid)&&brokerPid>0&&/^[A-Za-z0-9-]{1,100}$/.test(batchId??''),'NORMAL_SCOPE');
  const read=file=>{
    const s=fs.lstatSync(file);
    need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.geteuid()&&!(s.mode&0o022),'NORMAL_FILE');
    return fs.readFileSync(file,'utf8');
  };
  const modulePath=path.join(runtime,'case_exception.cjs');
  need(/^[a-f0-9]{64}$/.test(caseModuleHash??'')&&digest(read(modulePath))===caseModuleHash,'NORMAL_CASE_PIN');
  const before=read(path.join(root,'journal.json')),state=JSON.parse(before);
  const ce=require(modulePath),manifest=ce.validateControl(root,state);ce.controls(manifest);
  need(state.caseExceptionControl?.exclusive===false,'NORMAL_EXCLUSIVE_OWNER');
  need(state.active===null||state.active===batchId,'NORMAL_CANONICAL_BARRIER');
  const terminal=new Set(['COMPLETED','ABORTED_UNWRITTEN','RECONCILED_PARTIAL','ABORTED_SUPERSEDED',
    'CLOSED_EXCEPTION_UNCONFIRMED']);
  const retainedUnknowns=[];
  for(const [id,b] of Object.entries(state.batches??{})){
    if(b.status==='CLOSED_SUPERSEDED_UNKNOWN'){
      need(id==='SORI48-PAIR-ADMIT-20261029'&&typeof inspectClosedUnknown==='function',
        'NORMAL_CLOSED_UNKNOWN_VALIDATOR');
      const evidence=inspectClosedUnknown();
      need(evidence?.valid===true&&evidence.batchId===id&&evidence.originalOutcome==='UNKNOWN'&&
        evidence.status==='CLOSED_SUPERSEDED_UNKNOWN'&&evidence.cleanTermination===false&&
        evidence.productAccepted===false&&/^[a-f0-9]{64}$/.test(evidence.privateAuditSha256??'')&&
        evidence.lateObservationRequired===true&&evidence.capacityReleased===false&&
        evidence.applyAuthorized===false,'NORMAL_CLOSED_UNKNOWN_INVALID');
      retainedUnknowns.push(evidence);
    }else need(id===batchId||terminal.has(b.status),'NORMAL_UNRESOLVED_BATCH');
  }
  const lockRaw=read(path.join(root,'broker.lock')),lock=JSON.parse(lockRaw);
  need(lock.pid===brokerPid&&typeof lock.executor==='string'&&lock.executor.length>0,'NORMAL_BROKER_LOCK');
  process.kill(brokerPid,0);
  need(read(path.join(root,'journal.json'))===before&&read(path.join(root,'broker.lock'))===lockRaw,'NORMAL_CANONICAL_CHANGED');
  const now=clock();need(now>=started&&now-started<30000,'NORMAL_PROBE_STALE');
  return {schema:'NORMAL_PROJECTION_PROBE_V1',batchId,root,brokerPid,brokerExecutor:lock.executor,
    observedAt:new Date(started).toISOString(),validUntil:new Date(started+30000).toISOString(),
    journalHash:digest(before),canonical:state.caseExceptionControl,controlsVerified:manifest.controls.files.length,
    active:state.active,retainedUnknowns,notionWrites:0,canonicalWrites:0,workerStarts:0};
}
module.exports={probe};
if(require.main===module) {
  try {
    const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
    need(args.length===12&&['--root','--runtime','--case-module-sha256','--broker-pid','--batch','--output'].every(k=>args.includes(k)),'NORMAL_ARGS');
    need(get('--output')==='json','NORMAL_ARGS');
    console.log('NPG-NORMAL/1 '+JSON.stringify(probe({root:get('--root'),runtime:get('--runtime'),
      caseModuleHash:get('--case-module-sha256'),brokerPid:Number(get('--broker-pid')),batchId:get('--batch')})));
  } catch(error) { console.log('NPG-NORMAL/1 '+JSON.stringify({error:error.message}));process.exitCode=1; }
}
