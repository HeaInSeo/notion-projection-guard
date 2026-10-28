'use strict';
// One observed incident, not a general SEND_INTENT retry or HALTED reset.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);};
const incident=Object.freeze({batchId:'NODEKIT149-LANDED-20261028',
  journalHash:'52e9195a3bed8da684f43d64c43c0398b7187768068124426b9cd39c0aa5133a',
  planHash:'0d623c81345fbfd1150cea07291d0d7baf4d46ee6c148292ab6515f006f18539',
  ticket:'35863948-9245-41e7-9095-b3e08b2ef09b',
  snapshotHash:'f44cc7de03d4f84dfcbded9c966a763caab89f87bb32009c0b45b6d188bda35b',
  dispatchId:'3356717a-dea9-4da6-99a8-551ad6e0a573',
  executor:'1e3ff34f-ef06-44f4-a92e-f3a2f781220d',
  error:'OWNERSHIP_FENCE: Fresh same-generation scoped ownership and all prerequisites required',
  diagnosticHash:'4e5f27e60cc055dbbe2483d18e2e93a89f92a8210eace47d68302b21b9c4f565',
  runnerHash:'e37d7675e5d2645764421bb1877ddf4c9aeba8ae5d0b2bab1c568059c6c4148f'});
function createReconciler({pageData,plan,atomic,runtime}){
  const read=(file,privateOnly=true)=>{const st=fs.lstatSync(file);need(st.isFile()&&!st.isSymbolicLink()&&
    st.uid===process.geteuid()&&!(st.mode&(privateOnly?0o077:0o022)),
    'UNPERMITTED_PRIVATE_FILE');return fs.readFileSync(file,'utf8');};
  return function reconcile(b,input){
    b.assertLock();b.ownerProof(input.ownerProof);
    const raw=read(b.file),state=JSON.parse(raw),x=state.batches[incident.batchId],d=x?.dispatch,a=d?.attempts?.[0];
    need(typeof input.apply==='boolean'&&input.batchId===incident.batchId&&input.ownerProof.scope===incident.batchId&&
      state.active===incident.batchId&&hash(raw)===incident.journalHash&&JSON.stringify(state)===JSON.stringify(b.state)&&
      x.status==='HALTED'&&x.haltedFrom==='WRITE_PENDING'&&x.next===0&&x.error===incident.error&&
      x.planHash===incident.planHash&&hash(JSON.stringify(x.edits))===incident.planHash&&
      x.receipt?.ticket===incident.ticket&&x.receipt.snapshotHash===incident.snapshotHash&&
      d.phase==='SEND_INTENT'&&d.executor===incident.executor&&d.executor!==b.executor&&
      d.provider===null&&d.attempts.length===1&&a.dispatchId===incident.dispatchId&&a.ticket===incident.ticket&&
      !Object.hasOwn(a,'sendPermit')&&!Object.hasOwn(a,'provider')&&a.phase==='SEND_INTENT'&&a.index===0&&
      d.failure?.phase==='SEND_INTENT'&&d.failure.provider===null,'UNPERMITTED_EXACT_INCIDENT');
    const runner=read(path.join(runtime,'runner.js'),false);
    need(hash(runner)===incident.runnerHash,'UNPERMITTED_DRIVER_PIN');
    // In this pinned driver fence_confirm_send precedes update(). The actual
    // denied confirmation, no durable permit, and terminal caught failure are
    // all required; a mere absent result or unchanged page is never sufficient.
    const diagnosticPath=path.join(b.root,'manual-audits/automatic-followthrough-20261028-04386a5/run-3e9c232d-halted-result.json');
    const diagnosticRaw=read(diagnosticPath),diagnostic=JSON.parse(diagnosticRaw),q=diagnostic.nodekitBodyProjection;
    need(hash(diagnosticRaw)===incident.diagnosticHash&&q?.batchId===incident.batchId&&
      q.planHash===incident.planHash&&q.status==='HALTED'&&q.next===0&&q.phase==='SEND_INTENT'&&
      q.ticket===incident.ticket&&q.dispatchId===incident.dispatchId&&q.error===incident.error&&
      q.provider===null&&q.sendPermit===null&&q.notionBodyWritesObserved===0&&
      q.journalSha256===incident.journalHash&&diagnostic.diagnosis?.providerCallReached===false&&
      diagnostic.diagnosis.kind==='PREREQUISITE_FRESHNESS_EXPIRED_BEFORE_SEND_PERMIT',
      'UNPERMITTED_EXECUTION_EVIDENCE');
    const snapshotRaw=read(x.receipt.snapshot),s=JSON.parse(snapshotRaw),fresh=pageData(input.page,x.edits[0].pageId);
    need(hash(snapshotRaw)===incident.snapshotHash&&hash(JSON.stringify(s))===incident.snapshotHash&&
      s.ticket===incident.ticket&&s.batchId===incident.batchId&&s.index===0&&
      JSON.stringify(s.edit)===JSON.stringify(x.edits[0])&&fresh.body===s.page.body&&
      fresh.properties===s.page.properties&&fresh.revision===s.page.revision&&
      plan(fresh,x.edits[0]).expected===s.expected&&!fs.existsSync(x.receipt.snapshot+'.verified.json')&&
      !fs.existsSync(x.receipt.snapshot+'.actual.json'),'UNPERMITTED_PREIMAGE');
    const audit={kind:'EXACT_DENIED_SEND_CONFIRMATION_CONTINUATION',batchId:incident.batchId,
      journalBeforeHash:incident.journalHash,planHash:x.planHash,ticket:incident.ticket,
      oldExecutor:d.executor,newExecutor:b.executor,dispatchId:a.dispatchId,
      diagnosticHash:incident.diagnosticHash,owner:input.ownerProof,
      at:new Date().toISOString(),notionWrites:0,pageAdvances:0,ticketsCreated:0,
      reason:'The exact pinned runner received no send permit and never invoked the native mutation; preserve and revoke that exported intent.'};
    if(!input.apply)return {eligible:true,checkOnly:true,status:x.status,next:0,audit};
    const auditPath=path.join(b.root,'unpermitted-'+hash(incident.batchId)+'-'+crypto.randomUUID()+'.json');
    const fd=fs.openSync(auditPath,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({audit,journalBefore:state,diagnostic,freshPage:input.page}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const next=JSON.parse(raw),out=next.batches[incident.batchId];
    out.dispatch.attempts[0].revokedUnpermitted={at:audit.at,record:auditPath,reason:audit.kind};
    out.dispatch.executor=b.executor;out.dispatch.owner=JSON.parse(JSON.stringify(input.ownerProof));
    out.dispatch.phase='PREPARED';out.status='PREPARED';
    out.reconciliations=[...(out.reconciliations??[]),audit];
    b.assertLock();b.ownerProof(input.ownerProof);
    need(read(b.file)===raw,'UNPERMITTED_CANONICAL_CHANGED');atomic(b.file,next);b.state=next;
    return {status:'PREPARED',next:0,executor:b.executor,planHash:out.planHash,...out.receipt,
      auditPath,notionWrites:0,pageAdvances:0,ticketsCreated:0};
  };
}
module.exports={createReconciler,incident};
