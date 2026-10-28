'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);};
const privateRead=file=>{const s=fs.lstatSync(file);
  need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.geteuid()&&!(s.mode&0o077),'NO_SEND_PRIVATE');
  return fs.readFileSync(file,'utf8');};
function priorEvidence(b,x,pages,pageData,pending){
  need(Array.isArray(pages)&&pages.length===x.next&&(x.verifications??[]).length===x.next,'NO_SEND_PRIOR_PAGES');
  const prior=[],prefix=hash(b.state.active)+'-',allowed=new Set(pending?[prefix+x.next+'.json']:[]);
  for(let index=0;index<x.next;index++){
    const p=b.snapshot(b.state.active,index),ps=privateRead(p),pv=privateRead(p+'.verified.json'),
      snapshot=JSON.parse(ps),verified=JSON.parse(pv),fingerprint=b.verifiedFingerprint(snapshot,verified,x,index),
      native=pageData(pages[index],x.edits[index].pageId);
    need(snapshot.batchId===b.state.active&&hash(ps)===fingerprint.snapshotHash&&hash(pv)===fingerprint.verifiedHash&&
      native.body===verified.page.body&&native.properties===verified.page.properties&&
      Date.parse(native.revision)>=Date.parse(verified.page.revision),'NO_SEND_PRIOR_CHANGED');
    allowed.add(prefix+index+'.json');allowed.add(prefix+index+'.json.verified.json');
    if(verified.reconciliation?.kind==='REVIEWED_CENTRAL_ARROW_ESCAPING')allowed.add(prefix+index+'.json.actual.json');
    prior.push(fingerprint);
  }
  for(const name of fs.readdirSync(b.root))need(!name.startsWith(prefix)||allowed.has(name),'NO_SEND_UNEXPECTED_EVIDENCE');
  return prior;
}
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
    need(exact||d.attempts.filter(v=>v.index===x.next&&
      v.revokedBeforeCall?.reason==='LIVE_PRE_CALL_EXPIRED_CONTINUATION').length<2,
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
function createPreparedResumer({pageData,plan,atomic}){
  const read=privateRead;
  return function resume(b,input){
    b.assertLock();b.ownerProof(input.ownerProof);
    const raw=read(b.file),state=JSON.parse(raw),x=state.batches[input.batchId],d=x?.dispatch;
    need(typeof input.apply==='boolean'&&state.active===input.batchId&&
      JSON.stringify(state)===JSON.stringify(b.state)&&x?.receipt&&
      (x.status==='PREPARED'||x.status==='HALTED'&&x.haltedFrom==='PREPARED')&&
      d?.version===1&&d.phase==='PREPARED'&&typeof d.executor==='string'&&d.executor!==b.executor&&
      Number.isSafeInteger(x.next)&&x.next>=0&&x.next<x.edits.length&&typeof x.receipt.ticket==='string'&&
      d.owner?.ownerId===input.ownerProof.ownerId&&d.owner.scope===input.ownerProof.scope&&
      input.ownerProof.scope===input.batchId&&input.planHash===x.planHash&&hash(JSON.stringify(x.edits))===x.planHash&&
      Array.isArray(d.attempts)&&d.attempts.every(a=>Number.isSafeInteger(a.index)&&a.index>=0&&a.index<=x.next),
      'PREPARED_RESUME_BOUNDARY');
    const file=b.snapshot(input.batchId,x.next),sr=read(file),s=JSON.parse(sr),edit=x.edits[x.next];
    const fresh=pageData(input.page,edit.pageId),generated=plan(fresh,edit),saved=pageData(s.page.raw,edit.pageId);
    need(x.receipt.snapshot===file&&hash(sr)===x.receipt.snapshotHash&&hash(JSON.stringify(s))===x.receipt.snapshotHash&&
      s.batchId===input.batchId&&s.index===x.next&&s.ticket===x.receipt.ticket&&
      JSON.stringify(s.edit)===JSON.stringify(edit)&&saved.body===s.page.body&&
      saved.properties===s.page.properties&&saved.revision===s.page.revision&&
      s.bodyHash===hash(s.page.body)&&s.propertiesHash===hash(s.page.properties)&&
      s.expectedHash===hash(s.expected)&&fresh.body===s.page.body&&fresh.properties===s.page.properties&&
      fresh.revision===s.page.revision&&generated.expected===s.expected&&
      generated.beforeHash===s.beforeHash&&generated.afterHash===s.afterHash&&
      !fs.existsSync(file+'.actual.json')&&!fs.existsSync(file+'.verified.json'),
      'PREPARED_RESUME_PREIMAGE');
    const current=d.attempts.filter(a=>a.index===x.next),revocations=[];
    if(d.provider){
      const previous=d.attempts.at(-1);
      need(current.length===0&&previous?.index<x.next&&previous.phase==='ACKNOWLEDGED'&&
        d.provider.status==='SUCCEEDED'&&JSON.stringify(previous.provider)===JSON.stringify(d.provider),
        'PREPARED_RESUME_PROVIDER_UNRESOLVED');
    }
    for(const a of current){
      const revoked=a.revokedBeforeCall;
      need(a.phase==='SEND_INTENT'&&!a.provider&&revoked&&
        ['LIVE_PRE_CALL_EXPIRED_CONTINUATION','EXACT_PRE_CALL_EXPIRED_CONTINUATION'].includes(revoked.reason)&&
        a.ticket===s.ticket&&a.requestHash===hash(JSON.stringify(generated.request))&&
        a.sendPermit?.dispatchId===a.dispatchId&&a.sendPermit.pageId===edit.pageId&&
        Date.parse(a.sendPermit.validUntil)<=Date.now()&&
        typeof revoked.record==='string'&&path.dirname(revoked.record)===b.root&&
        path.basename(revoked.record).startsWith('precall-'+hash(input.batchId)+'-'),
        'PREPARED_RESUME_SEND_UNRESOLVED');
      const bytes=read(revoked.record),record=JSON.parse(bytes),audit=record.audit,
        before=record.journalBefore,prior=before?.batches?.[input.batchId],attempt=prior?.dispatch?.attempts?.at(-1);
      const unrevoked=JSON.parse(JSON.stringify(a));delete unrevoked.revokedBeforeCall;
      need(audit&&audit.kind===revoked.reason&&audit.at===revoked.at&&audit.batchId===input.batchId&&
        audit.planHash===x.planHash&&audit.index===x.next&&audit.ticket===s.ticket&&
        audit.dispatchId===a.dispatchId&&audit.oldExecutor===a.sendPermit.executor&&
        JSON.stringify(audit.permit)===JSON.stringify(a.sendPermit)&&
        audit.notionWrites===0&&audit.pageAdvances===0&&audit.ticketsCreated===0&&
        audit.journalBeforeHash===hash(JSON.stringify(before))&&before.active===input.batchId&&
        prior.planHash===x.planHash&&prior.next===x.next&&prior.dispatch.phase==='SEND_INTENT'&&
        prior.dispatch.provider===null&&JSON.stringify(prior.receipt)===JSON.stringify(x.receipt)&&
        JSON.stringify(attempt)===JSON.stringify(unrevoked)&&attempt?.dispatchId===a.dispatchId&&attempt.ticket===a.ticket&&
        !attempt.provider&&!attempt.revokedBeforeCall&&
        JSON.stringify(attempt.sendPermit)===JSON.stringify(a.sendPermit)&&
        (x.reconciliations??[]).some(v=>JSON.stringify(v)===JSON.stringify(audit)),
        'PREPARED_RESUME_REVOCATION_AUDIT');
      revocations.push({dispatchId:a.dispatchId,record:revoked.record,sha256:hash(bytes)});
    }
    const prior=priorEvidence(b,x,input.pages,pageData,true);
    const audit={kind:'PREPARED_NO_SEND_CONTINUATION',at:new Date().toISOString(),batchId:input.batchId,
      planHash:x.planHash,index:x.next,ticket:s.ticket,snapshotHash:x.receipt.snapshotHash,
      oldExecutor:d.executor,newExecutor:b.executor,owner:input.ownerProof,journalBeforeHash:hash(raw),
      revocations,prior,notionWrites:0,pageAdvances:0,ticketsCreated:0};
    if(!input.apply)return {eligible:true,checkOnly:true,status:x.status,next:x.next,audit};
    const auditPath=path.join(b.root,'prepared-resume-'+hash(input.batchId)+'-'+crypto.randomUUID()+'.json');
    const fd=fs.openSync(auditPath,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({audit,journalBefore:state,freshPage:input.page,priorPages:input.pages}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const next=JSON.parse(raw),out=next.batches[input.batchId];
    out.status='PREPARED';out.dispatch.phase='PREPARED';out.dispatch.executor=b.executor;
    out.dispatch.owner=JSON.parse(JSON.stringify(input.ownerProof));
    out.reconciliations=[...(out.reconciliations??[]),audit];
    b.assertLock();b.ownerProof(input.ownerProof);need(read(b.file)===raw,'PREPARED_RESUME_CHANGED');
    atomic(b.file,next);b.state=next;
    return {status:'PREPARED',next:out.next,executor:b.executor,planHash:out.planHash,...out.receipt,
      auditPath,notionWrites:0,pageAdvances:0,ticketsCreated:0};
  };
}
function createUnpreparedResumer({pageData,plan,atomic}){
  return function resume(b,input){
    b.assertLock();b.ownerProof(input.ownerProof);
    const raw=privateRead(b.file),state=JSON.parse(raw),x=state.batches[input.batchId],d=x?.dispatch;
    need(typeof input.apply==='boolean'&&state.active===input.batchId&&JSON.stringify(state)===JSON.stringify(b.state)&&
      x?.receipt===null&&(x.status==='READY'||x.status==='HALTED'&&x.haltedFrom==='READY')&&
      d?.version===1&&d.phase==='UNSENT'&&typeof d.executor==='string'&&d.executor!==b.executor&&
      Number.isSafeInteger(x.next)&&x.next>=0&&x.next<x.edits.length&&input.planHash===x.planHash&&
      hash(JSON.stringify(x.edits))===x.planHash&&d.owner?.ownerId===input.ownerProof.ownerId&&
      d.owner.scope===input.ownerProof.scope&&input.ownerProof.scope===input.batchId&&
      Array.isArray(d.attempts)&&d.attempts.every(a=>Number.isSafeInteger(a.index)&&a.index>=0&&a.index<x.next),
      'UNPREPARED_RESUME_BOUNDARY');
    const previous=d.attempts.at(-1);
    need(x.next===0?!previous&&!d.provider:
      previous?.index===x.next-1&&previous.phase==='ACKNOWLEDGED'&&d.provider?.status==='SUCCEEDED'&&
      d.provider.pageId===x.edits[x.next-1].pageId&&JSON.stringify(previous.provider)===JSON.stringify(d.provider),
      'UNPREPARED_RESUME_PROVIDER');
    const prior=priorEvidence(b,x,input.pages,pageData,false),fresh=pageData(input.page,x.edits[x.next].pageId),
      generated=plan(fresh,x.edits[x.next]);
    const audit={kind:'UNPREPARED_NO_SEND_CONTINUATION',at:new Date().toISOString(),batchId:input.batchId,
      planHash:x.planHash,index:x.next,oldExecutor:d.executor,newExecutor:b.executor,owner:input.ownerProof,
      journalBeforeHash:hash(raw),prior,bodyHash:hash(fresh.body),propertiesHash:hash(fresh.properties),
      revision:fresh.revision,expectedHash:hash(generated.expected),notionWrites:0,pageAdvances:0,ticketsCreated:0};
    if(!input.apply)return {eligible:true,checkOnly:true,status:x.status,next:x.next,audit};
    const auditPath=path.join(b.root,'unprepared-resume-'+hash(input.batchId)+'-'+crypto.randomUUID()+'.json'),fd=fs.openSync(auditPath,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({audit,journalBefore:state,freshPage:input.page,priorPages:input.pages}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const next=JSON.parse(raw),out=next.batches[input.batchId];out.status='READY';out.dispatch.executor=b.executor;
    out.dispatch.owner=JSON.parse(JSON.stringify(input.ownerProof));out.reconciliations=[...(out.reconciliations??[]),audit];
    b.assertLock();b.ownerProof(input.ownerProof);need(privateRead(b.file)===raw,'UNPREPARED_RESUME_CHANGED');
    atomic(b.file,next);b.state=next;
    return {status:'READY',next:out.next,executor:b.executor,planHash:out.planHash,auditPath,
      notionWrites:0,pageAdvances:0,ticketsCreated:0};
  };
}
module.exports={createUnsent,createPreparedResumer,createUnpreparedResumer};
