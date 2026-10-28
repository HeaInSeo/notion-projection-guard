'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);};
function createUnsent({pageData,plan,atomic}){
  return function restore(b,input,{exact=false,diagnostic=null}={}){
    b.assertLock();b.ownerProof(input.ownerProof);
    const raw=fs.readFileSync(b.file,'utf8'),state=JSON.parse(raw),x=state.batches[input.batchId],d=x?.dispatch,a=d?.attempts?.at(-1);
    need(JSON.stringify(state)===JSON.stringify(b.state)&&state.active===input.batchId&&
      x.planHash===input.planHash&&hash(JSON.stringify(x.edits))===input.planHash&&
      x.receipt?.ticket===input.ticket&&d.phase==='SEND_INTENT'&&d.provider===null&&
      a?.index===x.next&&a.ticket===input.ticket&&a.dispatchId===input.dispatchId&&
      a.phase==='SEND_INTENT'&&!a.provider&&!a.revokedBeforeCall&&
      JSON.stringify(a.sendPermit)===JSON.stringify(input.permit)&&
      Date.parse(a.sendPermit?.validUntil)<=Date.now()&&
      (exact?['ownerId','scope']:['ownerId','scope','generation']).every(k=>a.sendPermit[k]===input.ownerProof[k])&&
      (exact?x.status==='HALTED':x.status==='WRITE_PENDING'&&d.executor===b.executor&&input.executor===b.executor),
      'NORMAL_UNSENT_IDENTITY');
    need(exact||d.attempts.filter(v=>v.index===x.next&&v.revokedBeforeCall).length<2,
      'NORMAL_PRE_CALL_EXPIRY_BUDGET');
    const file=x.receipt.snapshot,st=fs.lstatSync(file);
    need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&!(st.mode&0o077),
      'NORMAL_UNSENT_PRIVATE');
    const snapshotRaw=fs.readFileSync(file,'utf8'),s=JSON.parse(snapshotRaw),fresh=pageData(input.page,x.edits[x.next].pageId);
    const generated=plan(fresh,s.edit);
    need(hash(snapshotRaw)===x.receipt.snapshotHash&&hash(JSON.stringify(s))===x.receipt.snapshotHash&&
      file===b.snapshot(input.batchId,x.next)&&s.batchId===input.batchId&&s.index===x.next&&s.ticket===input.ticket&&
      JSON.stringify(s.edit)===JSON.stringify(x.edits[x.next])&&fresh.body===s.page.body&&
      fresh.properties===s.page.properties&&fresh.revision===s.page.revision&&
      generated.expected===s.expected&&hash(JSON.stringify(generated.request))===a.requestHash&&!fs.existsSync(file+'.actual.json')&&
      !fs.existsSync(file+'.verified.json'),'NORMAL_UNSENT_PREIMAGE');
    const audit={kind:exact?'EXACT_PRE_CALL_EXPIRED_CONTINUATION':'LIVE_PRE_CALL_EXPIRED_CONTINUATION',
      batchId:input.batchId,planHash:x.planHash,index:x.next,ticket:input.ticket,dispatchId:a.dispatchId,
      oldExecutor:d.executor,newExecutor:b.executor,owner:input.ownerProof,journalBeforeHash:hash(raw),
      permit:a.sendPermit,at:new Date().toISOString(),notionWrites:0,pageAdvances:0,ticketsCreated:0};
    if(input.apply===false)return {eligible:true,checkOnly:true,status:x.status,next:x.next,audit};
    const auditPath=path.join(b.root,'precall-'+hash(input.batchId)+'-'+crypto.randomUUID()+'.json');
    const fd=fs.openSync(auditPath,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({audit,journalBefore:state,freshPage:input.page,diagnostic}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const next=JSON.parse(raw),out=next.batches[input.batchId];
    out.dispatch.attempts.at(-1).revokedBeforeCall={at:audit.at,record:auditPath,reason:audit.kind};
    out.dispatch.executor=b.executor;out.dispatch.owner=JSON.parse(JSON.stringify(input.ownerProof));
    out.dispatch.phase='PREPARED';out.status='PREPARED';
    out.reconciliations=[...(out.reconciliations??[]),audit];
    b.assertLock();b.ownerProof(input.ownerProof);
    need(fs.readFileSync(b.file,'utf8')===raw,'NORMAL_UNSENT_CHANGED');atomic(b.file,next);b.state=next;
    return {status:'PREPARED',next:out.next,executor:b.executor,planHash:out.planHash,...out.receipt,
      auditPath,notionWrites:0,pageAdvances:0,ticketsCreated:0};
  };
}
module.exports={createUnsent};
