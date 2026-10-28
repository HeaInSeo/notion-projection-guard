'use strict';
// The legacy client did not have a live no-call token. Admit only this exact,
// independently evidenced pre-call failure, not another exported send intent.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);};
const incident=Object.freeze({batchId:'NODEKIT149-LANDED-20261028',index:3,
 journalHash:'ba7876e5dc754061ea7772c4cbfd70fc5779f6eb8e4940f797c47bf153b4e8b2',
 planHash:'0d623c81345fbfd1150cea07291d0d7baf4d46ee6c148292ab6515f006f18539',
 ticket:'c9738fca-5a4e-4b16-9a43-9da4afe8d3b9',
 snapshotHash:'aef50e9c73ba5556edd76146d78be857f5f9a52a656661c0ebe350b94e443e73',
 dispatchId:'e28e44f4-6adc-4cf7-adc6-18b47c41901b',executor:'7dd1a685-b9ce-4beb-a859-25c588afc66f',
 driverSource:'092d80db537ca8f5f55db2800cf482c997754e6f',
 driverHash:'32af5ba5e1e36577a247673c6f5c57f4a422e005e8b206e35fd74525ad5c6b29',
 diagnosticHash:'b02b35b7696d1ffa311e3cdad52980bdbd718954c7ece2433fdedc3002af7bca',
 traceHash:'288c0d7d9c436898bf000fb877d25ed055bb21fde37aec02175b55d9b07e9b8a'});
function createReconciler({pageData,runtime,restoreUnsent}){
 const read=(file,privateOnly=true)=>{const s=fs.lstatSync(file);
  need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.geteuid()&&!(s.mode&(privateOnly?0o077:0o022)),
    'PERMIT_RECOVERY_PRIVATE');return fs.readFileSync(file,'utf8');};
 return function reconcile(b,input){
  b.assertLock();b.ownerProof(input.ownerProof);
  const raw=read(b.file),state=JSON.parse(raw),x=state.batches[incident.batchId],d=x?.dispatch,a=d?.attempts?.at(-1);
  need(typeof input.apply==='boolean'&&input.batchId===incident.batchId&&state.active===incident.batchId&&
   hash(raw)===incident.journalHash&&JSON.stringify(state)===JSON.stringify(b.state)&&
   x.status==='HALTED'&&x.haltedFrom==='WRITE_PENDING'&&x.error==='SEND_PERMIT_EXPIRED_OR_FENCED'&&
   x.next===incident.index&&x.planHash===incident.planHash&&x.edits.length===6&&
   x.receipt?.ticket===incident.ticket&&x.receipt.snapshotHash===incident.snapshotHash&&
   d.executor===incident.executor&&d.executor!==b.executor&&d.phase==='SEND_INTENT'&&d.provider===null&&
   d.attempts.length===5&&a.dispatchId===incident.dispatchId&&a.ticket===incident.ticket&&
   a.index===incident.index&&a.phase==='SEND_INTENT'&&a.sendPermit&&!a.provider&&
   d.failure?.phase==='SEND_INTENT'&&d.failure.provider===null,'PERMIT_RECOVERY_EXACT_INCIDENT');
  const dir=path.join(b.root,'manual-audits/automatic-followthrough-20261028-04386a5');
  const diagnosticRaw=read(path.join(dir,'v2-partial-failure-20261028.json'));
  const traceRaw=read(path.join(dir,'permit-expiry-failed-call-trace-20261028.json'));
  const diagnostic=JSON.parse(diagnosticRaw),trace=JSON.parse(traceRaw),q=diagnostic.recovery;
  need(hash(diagnosticRaw)===incident.diagnosticHash&&hash(traceRaw)===incident.traceHash&&
   hash(read(path.join(runtime,'extensions',incident.driverSource,'normal_live_runner.js'),false))===incident.driverHash&&
   q?.batchId===incident.batchId&&q.exactPlanHash===incident.planHash&&q.next===incident.index&&
   q.verifiedBodyTargets===3&&q.failure?.providerMutationInvoked===false&&
   q.failure.code==='SEND_PERMIT_EXPIRED_OR_FENCED'&&q.canonicalJournal.sha256===incident.journalHash&&
   trace.canonical?.sha256===incident.journalHash&&trace.canonical.dispatchId===incident.dispatchId&&
   trace.canonical.receipt?.ticket===incident.ticket&&trace.canonical.provider===null&&
   JSON.stringify(trace.canonical.permit)===JSON.stringify(a.sendPermit)&&
   trace.noNativeCalledEvidence?.conclusion==='INDEX3_NOTION_NATIVE_CALL_NOT_INVOKED',
   'PERMIT_RECOVERY_EXECUTION_EVIDENCE');
  need(Array.isArray(input.pages)&&input.pages.length===incident.index&&x.verifications?.length===incident.index,
    'PERMIT_RECOVERY_PRIOR_PAGES');
  for(let index=0;index<incident.index;index++){
   const f=b.snapshot(incident.batchId,index),sr=read(f),vr=read(f+'.verified.json'),s=JSON.parse(sr),v=JSON.parse(vr);
   const fingerprint=b.verifiedFingerprint(s,v,x,index),fresh=pageData(input.pages[index],x.edits[index].pageId);
   need(hash(sr)===fingerprint.snapshotHash&&hash(vr)===fingerprint.verifiedHash&&
    JSON.stringify(trace.priorVerified?.[index])===JSON.stringify(fingerprint)&&
    fresh.body===v.page.body&&fresh.properties===v.page.properties&&
    Date.parse(fresh.revision)>=Date.parse(v.page.revision),'PERMIT_RECOVERY_PRIOR_CHANGED');
  }
  return restoreUnsent(b,{...input,planHash:incident.planHash,ticket:incident.ticket,
    dispatchId:incident.dispatchId,permit:a.sendPermit},{exact:true,diagnostic:{diagnostic,trace}});
 };
}
module.exports={createReconciler,incident};
