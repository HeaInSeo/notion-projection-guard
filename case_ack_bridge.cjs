#!/usr/bin/env node
'use strict';
// One incident only. Execute from a reviewed source tree; never install over
// the pinned runtime or edit its successor authorization to accept new bytes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const CONFIG={root:'/home/heain/.local/state/notion-projection-guard',runtime:'/home/heain/.local/share/notion-projection-guard',
  caseId:'SORI-ADMIN-ADMIT-20261026-6c2a084f-OWNERSHIP',batchId:'SORI-CASE-CB729C5-ADMISSION-20261027',
  planHash:'a2f8d657dc45154aaee6441b51fd0f6629903a66f86db2ba3a0d640314314eea',
  initialJournalHash:'5fbe608bcdaec9cb60c95c3559787dce3e4a3beba38749149e4a1be4a62f3dd5',
  initialExecutorHash:'0648a69845e5c55b6a67236846d0d92199b1f24f0bfc0349391d6f5a8f48db10',
  preimages:[
    ['3bf86e6dd1d18110938bc358e17c779e','ae543e858db2861344679330bcfcb13518869c21cb40defe6fb03ca5b60dbe68','8aebc7243e0302fa640e6b9940334062747f5884948c8df75eb503df61fd66ab','2026-10-25T19:57:04.822Z'],
    ['3f586e6dd1d181ebb43dd7de62aa2ca4','0aac07bb6d92a4c37ddefa66f3d01f2177110c112dea50e6e56082f901eb5a25','9d04c6c01db0369aa70f9f6a9013b64d34ffb9108cfed18131553123e8dbcfa9','2026-10-25T19:53:02.734Z'],
    ['3b286e6dd1d1817aa093fca807659f07','d8e3eeea723b56c19b87317dde99abb5674f4b388d07c0e19eecbf30fec66e0a','3c0d97a8eebc20b18daca05d63bafc3816fcdb805bfe44678d2f56c54bac4463','2026-10-25T21:22:17.343Z']],
  installedHead:'cb729c57093c7bbea27139e7e4be130a0fe8e064',pins:{
    'broker.cjs':'e03728e3a66c9ad479738491346592b9478e4f10f4fc24b7ef03f99f4879e05d',
    'runner.js':'e37d7675e5d2645764421bb1877ddf4c9aeba8ae5d0b2bab1c568059c6c4148f',
    'case_exception.cjs':'e40f19f45e09283e504e0272ae47b1fbe7c7c147522fe04c6b86962233cf0196',
    'case_gate.cjs':'e41af2461a8b7d2d6355eb03331a51fab2740edd1ac76e849af38ce2538f5b6a',
    'central_case_owner.js':'e1ab27a501a21444d2ccb4a62a8a30fa0b72a1d2918088aa410f02b8b27d5865',
    'policy.json':'804709b778ea5fe82eac705654d06f52af8391aa0504d8e0582f3a87022fdf1b',
    'approved.sha256':'ff6e007a32285afe9e29b82e35ca8d286a253895cc475aadd3989b955aff7878'}};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),clone=x=>JSON.parse(JSON.stringify(x));
function need(ok,code,message=code){if(!ok)throw Object.assign(new Error(message),{code});}
function bytes(file,privateFile=true){
  const st=fs.lstatSync(file);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&!(st.mode&(privateFile?0o077:0o022)),
    'CASE_ACK_FILE','Owned unchanged regular file required');
  return fs.readFileSync(file,'utf8');
}
const read=file=>JSON.parse(bytes(file));
const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&/Z$/.test(x);
function pins(){for(const [name,pin] of Object.entries(CONFIG.pins))
  need(hash(bytes(path.join(CONFIG.runtime,name),false))===pin,'CASE_ACK_RUNTIME',name+' changed');}
function createBridge({readOnly=true}={}){
  pins(); // Before importing any installed executable.
  const {Broker,pageData,plan,validateEdit,atomic}=require(path.join(CONFIG.runtime,'broker.cjs'));
  const control=require(path.join(CONFIG.runtime,'case_exception.cjs'));
  const b=new Broker(CONFIG.root,JSON.parse(bytes(path.join(CONFIG.runtime,'policy.json'),false)),{existingOnly:true,readOnly});
  const prefix=hash(CONFIG.batchId),auditFile=index=>path.join(CONFIG.root,prefix+'.ack-recovery-'+index+'.json');
  let staged=null;
  const stagedActions=new Set(['fence_prepare','fence_authorize','fence_dispatch',
    'case_reconcile_acknowledged','case_continue_verified','case_restore_unprepared']);
  function scope(){
    pins();const m=control.validateControl(b.root,b.state),c=b.state.caseExceptionControl;
    need(c?.batchId===CONFIG.caseId&&c.exclusive===true&&c.admission===null&&
      m?.sourceHead===CONFIG.installedHead&&m.admissionBatchIds?.length===1&&
      m.admissionBatchIds[0]===CONFIG.batchId&&m.admissionPlanHashes[CONFIG.batchId]===CONFIG.planHash,'CASE_ACK_SCOPE');
    control.controls(m);return c;
  }
  function current(input){
    const c=scope(),raw=bytes(b.file),batch=b.state.batches[CONFIG.batchId];
    if(readOnly)need(!fs.existsSync(b.lock),'LOCKED');else b.assertLock();
    need(input.batchId===CONFIG.batchId&&input.planHash===CONFIG.planHash&&batch&&
      b.state.active===CONFIG.batchId&&batch.planHash===CONFIG.planHash&&hash(JSON.stringify(batch.edits))===CONFIG.planHash&&
      JSON.stringify(JSON.parse(raw))===JSON.stringify(b.state)&&hash(raw)===input.journalHash,'CASE_ACK_IDENTITY');
    b.ownerProof(input.ownerProof,batch.dispatch?.owner);
    need(input.ownerProof.scope===CONFIG.batchId&&input.ownerProof.ownerId===c.authority.ownerId&&
      input.ownerProof.generation===c.authority.generation,'CASE_ACK_OWNER');
    return {raw,batch};
  }
  function snapshot(batch,index){
    const source=bytes(b.snapshot(CONFIG.batchId,index)),s=JSON.parse(source),edit=batch.edits[index],p=plan(s.page,edit),raw=pageData(s.page.raw,edit.pageId);
    validateEdit(edit,b.policy);
    need(source===JSON.stringify(s)&&s.batchId===CONFIG.batchId&&s.index===index&&typeof s.ticket==='string'&&s.ticket&&
      JSON.stringify(s.edit)===JSON.stringify(edit)&&s.bodyHash===hash(s.page.body)&&s.propertiesHash===hash(s.page.properties)&&
      s.expectedHash===hash(s.expected)&&p.expected===s.expected&&p.beforeHash===s.beforeHash&&p.afterHash===s.afterHash&&
      raw.body===s.page.body&&raw.properties===s.page.properties&&raw.revision===s.page.revision,'CASE_ACK_SNAPSHOT');
    return s;
  }
  function prior(batch,pages){
    history(batch);
    need(Array.isArray(pages)&&pages.length===batch.next,'CASE_ACK_PRIOR');
    need((batch.verifications??[]).length===batch.next,'CASE_ACK_PRIOR');
    return pages.map((raw,index)=>{
      const s=snapshot(batch,index),v=read(b.snapshot(CONFIG.batchId,index)+'.verified.json');
      const fingerprint=b.verifiedFingerprint(s,v,batch,index),fresh=pageData(raw,batch.edits[index].pageId);
      need(fresh.body===v.page.body&&fresh.properties===v.page.properties&&fresh.revision===v.page.revision,'CASE_ACK_PRIOR_CHANGED');
      return fingerprint;
    });
  }
  const temporaryPattern=index=>new RegExp('^'+prefix+'-'+index+'\\.json\\.verified\\.json\\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.tmp$');
  function temporaryEvidence(evidence,verified,index){
    need(Array.isArray(evidence),'CASE_ACK_TEMPORARY');
    const expected=Buffer.from(JSON.stringify(verified));
    for(const item of evidence){
      need(typeof item.name==='string'&&temporaryPattern(index).test(item.name),'CASE_ACK_TEMPORARY');
      const file=path.join(b.root,item.name);bytes(file);
      const raw=fs.readFileSync(file);
      need(raw.length===item.size&&hash(raw)===item.sha256&&raw.length<=expected.length&&
        raw.equals(expected.subarray(0,raw.length)),'CASE_ACK_TEMPORARY');
    }
  }
  function inventory(batch,pending,expectedTemporary=null){
    const allowed=new Set();for(let i=0;i<batch.next+(pending?1:0);i++){
      allowed.add(prefix+'-'+i+'.json');allowed.add(prefix+'-'+i+'.json.verified.json');
    }
    for(const ref of batch.ackRecoveries??[]){
      const saved=read(auditFile(ref.index));temporaryEvidence(ref.temporaryReceipts??[],saved.verified,ref.index);
      for(const item of ref.temporaryReceipts??[])allowed.add(item.name);
    }
    const found=[],pattern=temporaryPattern(batch.next);
    for(const name of fs.readdirSync(b.root))if(name.startsWith(prefix+'-')&&!allowed.has(name)){
      need(pending&&expectedTemporary&&pattern.test(name),'CASE_ACK_ORPHAN','Unexpected or contradictory page evidence');
      const file=path.join(b.root,name);bytes(file);const raw=fs.readFileSync(file);
      found.push({name,size:raw.length,sha256:hash(raw)});
    }
    found.sort((a,b)=>a.name.localeCompare(b.name));
    if(found.length)temporaryEvidence(found,expectedTemporary,batch.next);
    return found;
  }
  function fullPage(value,id,expected){
    need(value&&JSON.stringify(pageData(value.raw,id))===JSON.stringify(value)&&
      value.body===expected.body&&value.properties===expected.properties&&value.revision===expected.revision,'CASE_ACK_AUDIT');
  }
  function recoveredState(record,recordHash,temporaryReceipts=[]){
    const next=clone(record.journalBefore),out=next.batches[CONFIG.batchId],a=record.audit,index=a.index;
    need(a.kind==='SCOPED_CASE_SAVED_ACK_VERIFICATION'&&a.caseId===CONFIG.caseId&&a.batchId===CONFIG.batchId&&
      a.planHash===CONFIG.planHash&&out?.next===index&&out.receipt?.ticket===a.ticket&&
      hash(JSON.stringify(record.journalBefore))===a.journalHash,'CASE_ACK_AUDIT');
    out.verifications=[...(out.verifications??[]),{index,snapshotHash:a.snapshotHash,verifiedHash:hash(JSON.stringify(record.verified))}];
    out.reconciliations=[...(out.reconciliations??[]),a];
    out.ackRecoveries=[...(out.ackRecoveries??[]),{index,recordHash,...(temporaryReceipts.length?{temporaryReceipts}:{} )}];
    out.next++;out.receipt=null;out.status=out.next===out.edits.length?'COMPLETED':'READY';
    out.dispatch.phase=out.status==='COMPLETED'?'VERIFIED':'VERIFIED_STOPPED';
    if(out.status==='COMPLETED')next.active=null;
    return next;
  }
  function history(x){
    unpreparedHistory(x);
    const refs=x.ackRecoveries??[];
    need(new Set(refs.map(v=>v.index)).size===refs.length,'CASE_ACK_AUDIT');
    for(const ref of refs){
      const raw=bytes(auditFile(ref.index));need(hash(raw)===ref.recordHash,'CASE_ACK_AUDIT');
      const saved=JSON.parse(raw),a=saved.audit,original=saved.journalBefore?.batches?.[CONFIG.batchId];
      temporaryEvidence(ref.temporaryReceipts??[],saved.verified,ref.index);
      need(Number.isInteger(ref.index)&&ref.index>=0&&ref.index<x.next&&a?.index===ref.index&&
        a.kind==='SCOPED_CASE_SAVED_ACK_VERIFICATION'&&a.batchId===CONFIG.batchId&&a.planHash===CONFIG.planHash&&
        original?.next===ref.index&&hash(JSON.stringify(saved.journalBefore))===a.journalHash&&
        JSON.stringify(x.dispatch.attempts.slice(0,ref.index+1))===JSON.stringify(original.dispatch.attempts)&&
        x.reconciliations.filter(v=>v.kind===a.kind&&v.index===ref.index).length===1&&
        x.reconciliations.some(v=>JSON.stringify(v)===JSON.stringify(a)),'CASE_ACK_AUDIT');
      const s=snapshot(x,ref.index),verified=read(b.snapshot(CONFIG.batchId,ref.index)+'.verified.json');
      need(JSON.stringify(verified)===JSON.stringify(saved.verified)&&s.ticket===a.ticket,'CASE_ACK_AUDIT');
      b.verifiedFingerprint(s,verified,x,ref.index);
    }
    const continuations=x.caseContinuations??[];
    need(new Set(continuations.map(v=>v.executor)).size===continuations.length&&
      continuations.length===(x.reconciliations??[]).filter(v=>v.kind==='SCOPED_CASE_VERIFIED_CONTINUATION').length,'CASE_ACK_AUDIT');
    for(const ref of continuations){
      const matches=x.reconciliations.filter(v=>v.kind==='SCOPED_CASE_VERIFIED_CONTINUATION'&&v.newExecutor===ref.executor);
      need(matches.length===1,'CASE_ACK_AUDIT');const a=matches[0];
      const file=path.join(b.root,prefix+'.verified-continuation-'+a.journalHash+'-'+a.newExecutor+'.json'),raw=bytes(file),intent=JSON.parse(raw);
      need(hash(raw)===ref.recordHash&&JSON.stringify(intent.audit)===JSON.stringify(a)&&
        hash(JSON.stringify(intent.journalBefore))===a.journalHash,'CASE_ACK_AUDIT');
      committedRecovery(a.index-1,intent.journalBefore);
    }
  }
  function committedRecovery(index,state=b.state){
    const x=state.batches[CONFIG.batchId],refs=x.ackRecoveries?.filter(v=>v.index===index),file=auditFile(index),raw=bytes(file);
    need(refs?.length===1&&refs[0].recordHash===hash(raw),'CASE_ACK_AUDIT');
    const saved=JSON.parse(raw);temporaryEvidence(refs[0].temporaryReceipts??[],saved.verified,index);
    const projected=recoveredState(saved,hash(raw),refs[0].temporaryReceipts??[]),out=projected.batches[CONFIG.batchId];
    // Reconstruct the only permitted changes since the pinned recovery record.
    // Re-hashing a modified live journal must never make it valid evidence.
    const suffix=(x.reconciliations??[]).slice(out.reconciliations.length);
    for(const a of suffix){
      need(a.kind==='SCOPED_CASE_VERIFIED_CONTINUATION'&&a.index===out.next&&a.recoveryAuditHash===hash(raw)&&
        a.journalHash===hash(JSON.stringify(projected))&&a.oldExecutor===out.dispatch.executor&&
        typeof a.newExecutor==='string'&&/^[a-f0-9-]{36}$/.test(a.newExecutor),'CASE_ACK_AUDIT');
      const fileNext=path.join(b.root,prefix+'.verified-continuation-'+a.journalHash+'-'+a.newExecutor+'.json'),intent=bytes(fileNext);
      need(JSON.stringify(JSON.parse(intent))===JSON.stringify({audit:a,journalBefore:clone(projected)}),'CASE_ACK_AUDIT');
      out.dispatch.executor=a.newExecutor;out.dispatch.owner=clone(a.owner);out.dispatch.phase='UNSENT';
      out.reconciliations=[...out.reconciliations,a];
      out.caseContinuations=[...(out.caseContinuations??[]),{recordHash:hash(intent),executor:a.newExecutor}];
    }
    need(JSON.stringify(projected)===JSON.stringify(state),'CASE_ACK_AUDIT','Canonical state differs from the saved ACK recovery and committed continuation records');
    return {saved,recordHash:hash(raw)};
  }
  function reconcile(input){
    need(typeof input.apply==='boolean'&&(!readOnly||!input.apply),'READ_ONLY');
    const {raw,batch:x}=current(input),d=x.dispatch,a=d?.attempts?.at(-1),index=x.next;
    const errors=['REVISION_READ_ERROR','BROKER_RESPONSE_UNKNOWN','REMOTE_RESULT_UNKNOWN',
      'REMOTE_ERROR: McpServerError: MCP server is not initialized; send initialize and notifications/initialized before operational requests'];
    need(x.status==='HALTED'&&x.haltedFrom==='WRITE_PENDING'&&errors.includes(x.error)&&x.error===input.expectedError&&
      d?.version===1&&d.phase==='ACKNOWLEDGED'&&!d.revoked&&a&&a.index===index&&a.ticket===input.ticket&&
      a.ticket===x.receipt?.ticket&&a.dispatchId===input.dispatchId&&a.phase==='ACKNOWLEDGED'&&
      d.attempts.length===index+1&&d.attempts.every((v,i)=>v.index===i&&v.phase==='ACKNOWLEDGED')&&
      x.receipt.snapshot===b.snapshot(CONFIG.batchId,index)&&x.receipt.snapshotHash===input.snapshotHash&&
      d.failure?.phase==='ACKNOWLEDGED'&&JSON.stringify(d.failure.provider)===JSON.stringify(d.provider),'CASE_ACK_ATTRIBUTION');
    const s=snapshot(x,index),permit=a.sendPermit;
    need(hash(JSON.stringify(s))===input.snapshotHash&&s.ticket===input.ticket&&
      a.requestHash===hash(JSON.stringify(plan(s.page,s.edit).request))&&
      a.provider?.status==='SUCCEEDED'&&a.provider.pageId===s.edit.pageId&&JSON.stringify(a.provider)===JSON.stringify(d.provider)&&
      permit?.dispatchId===a.dispatchId&&permit.executor===d.executor&&permit.pageId===s.edit.pageId&&
      ['ownerId','scope','generation'].every(k=>permit[k]===d.owner[k])&&
      stamp(a.at)&&stamp(permit.observedAt)&&stamp(permit.validUntil)&&
      Date.parse(permit.observedAt)>=Date.parse(a.at)&&Date.parse(permit.validUntil)>Date.parse(permit.observedAt)&&
      // observedAt is the earlier prerequisite read, not the callback return.
      // The pinned owner factory bounds send authority to 15s from its return
      // and 30s from that source read; historical permit span may exceed 15s.
      Date.parse(permit.validUntil)-Date.parse(permit.observedAt)<=30000,'CASE_ACK_ATTRIBUTION');
    const receipts=prior(x,input.priorPages),page=pageData(input.page,s.edit.pageId);
    need(page.body===s.expected&&page.properties===s.page.properties&&Date.parse(page.revision)>Date.parse(s.page.revision),
      'CASE_ACK_CHANGED','Entire expected output, unchanged properties and a later revision required');
    const file=auditFile(index),saved=fs.existsSync(file)?read(file):null;
    const verifiedFile=b.snapshot(CONFIG.batchId,index)+'.verified.json';
    const existing=fs.existsSync(verifiedFile)?read(verifiedFile):null;
    if(existing)need(existing.page.body===page.body&&existing.page.properties===page.properties&&existing.page.revision===page.revision&&
      JSON.stringify(pageData(existing.page.raw,s.edit.pageId))===JSON.stringify(existing.page)&&
      existing.bodyHash===hash(page.body)&&stamp(existing.at)&&!existing.reconciliation,'CASE_ACK_VERIFIED');
    if(saved){
      fullPage(saved.freshPage,s.edit.pageId,page);
      fullPage(saved.verified?.page,s.edit.pageId,page);
      need(saved.verified.bodyHash===hash(page.body)&&stamp(saved.verified.at)&&saved.verified.at===saved.audit.at,'CASE_ACK_AUDIT');
    }
    const audit={kind:'SCOPED_CASE_SAVED_ACK_VERIFICATION',at:saved?.audit.at??existing?.at??new Date().toISOString(),
      caseId:CONFIG.caseId,batchId:CONFIG.batchId,planHash:CONFIG.planHash,index,ticket:s.ticket,
      snapshotHash:input.snapshotHash,journalHash:hash(raw),error:x.error,haltedFrom:x.haltedFrom,
      oldExecutor:d.executor,dispatch:clone(a),provider:clone(d.provider),prior:receipts,
      bodyHash:hash(page.body),propertiesHash:hash(page.properties),revision:page.revision,
      recoveryOwner:Object.fromEntries(['ownerId','scope','generation'].map(k=>[k,input.ownerProof[k]])),installedHead:CONFIG.installedHead,
      helperHash:hash(bytes(__filename,false)),notionWrites:0,acknowledgementsCreated:0,pageAdvances:1};
    need(stamp(audit.at)&&Date.parse(audit.at)>=Date.parse(a.at)&&Date.parse(audit.at)<=Date.now(),'CASE_ACK_AUDIT');
    const verified=existing??saved?.verified??{page,bodyHash:audit.bodyHash,at:audit.at};
    const record={audit,journalBefore:JSON.parse(raw),freshPage:saved?.freshPage??page,verified};
    if(saved)need(JSON.stringify(saved)===JSON.stringify(record),'CASE_ACK_AUDIT');
    const temporaryReceipts=inventory(x,true,saved?.verified??null);
    if(!input.apply)return {checkOnly:true,status:x.status,next:index,audit,temporaryReceipts};
    b.assertLock();pins();need(bytes(b.file)===raw,'PERSISTENCE');
    if(!saved)atomic(file,record); // Audit, then receipt, then canonical progress.
    if(!existing)atomic(verifiedFile,verified);
    temporaryEvidence(temporaryReceipts,verified,index);
    const next=recoveredState(record,hash(bytes(file)),temporaryReceipts),out=next.batches[CONFIG.batchId];
    // Preserve the original failure verbatim; this is verified application of
    // this successor page, never proof of non-application of the original case.
    need(bytes(b.file)===raw,'PERSISTENCE');atomic(b.file,next);b.state=read(b.file);
    return {status:out.status,next:out.next,notionWrites:0,protectedContent:'UNCHANGED',
      restoration:{journalHash:hash(bytes(b.file)),auditHash:hash(bytes(file)),index}};
  }
  function continueVerified(input){
    const {raw,batch:x}=current(input),d=x.dispatch,r=input.restoration;
    need(!readOnly&&x.status==='READY'&&x.receipt===null&&x.next>0&&
      ['VERIFIED_STOPPED','UNSENT'].includes(d?.phase)&&(d.phase!=='UNSENT'||d.executor!==b.executor)&&d.attempts.length===x.next&&
      d.attempts.every((v,i)=>v.index===i&&v.phase==='ACKNOWLEDGED')&&r?.index===x.next-1,'CASE_ACK_CONTINUATION');
    const {saved,recordHash}=committedRecovery(r.index);
    need(recordHash===r.auditHash&&saved.audit?.index===r.index&&
      (d.phase==='UNSENT'||r.journalHash===hash(raw)),'CASE_ACK_CONTINUATION');
    inventory(x,false);const receipts=prior(x,input.priorPages);
    need(Array.isArray(input.remainingPages)&&input.remainingPages.length===x.edits.length-x.next,'CASE_ACK_CONTINUATION');
    input.remainingPages.forEach((page,i)=>b.handle({action:'preflight',batchId:CONFIG.batchId,edit:x.edits[x.next+i],page}));
    const audit={kind:'SCOPED_CASE_VERIFIED_CONTINUATION',at:new Date().toISOString(),journalHash:hash(raw),
      recoveryAuditHash:r.auditHash,index:x.next,prior:receipts,oldExecutor:d.executor,newExecutor:b.executor,
      owner:clone(input.ownerProof),notionWrites:0};
    const fileNext=path.join(b.root,prefix+'.verified-continuation-'+hash(raw)+'-'+b.executor+'.json');
    const record={audit,journalBefore:JSON.parse(raw)};
    // Preserve an uncommitted intent after a failed save. A fresh locked
    // process may explicitly adopt the still-unprepared next index, repeating
    // all evidence checks and appending its own executor-specific intent.
    need(!fs.existsSync(fileNext),'CASE_ACK_CONTINUATION_AUDIT');
    atomic(fileNext,record);const next=JSON.parse(raw),out=next.batches[CONFIG.batchId];
    out.dispatch.executor=b.executor;out.dispatch.owner=clone(input.ownerProof);out.dispatch.phase='UNSENT';
    out.reconciliations=[...(out.reconciliations??[]),audit];
    out.caseContinuations=[...(out.caseContinuations??[]),{recordHash:hash(JSON.stringify(record)),executor:b.executor}];
    pins();need(bytes(b.file)===raw,'PERSISTENCE');atomic(b.file,next);b.state=read(b.file);
    return {status:'READY',next:out.next,executor:b.executor,planHash:out.planHash};
  }
  function unsent(x,checkInventory=true){
    need(x.next===0&&x.receipt===null&&x.dispatch?.version===1&&x.dispatch.phase==='UNSENT'&&
      x.dispatch.attempts.length===0&&!x.dispatch.revoked&&!x.dispatch.provider&&
      !(x.verifications?.length)&&!(x.ackRecoveries?.length),'CASE_UNPREPARED_SEND_UNCERTAIN');
    if(checkInventory)inventory(x,false);
  }
  function preimages(pages,edits){
    need(Array.isArray(pages)&&pages.length===CONFIG.preimages.length&&pages.length===edits.length,'CASE_UNPREPARED_PAGES');
    return pages.map((raw,index)=>{
      const [id,bodyHash,propertiesHash,revision]=CONFIG.preimages[index],p=pageData(raw,id);
      need(edits[index].pageId===id&&hash(p.body)===bodyHash&&hash(p.properties)===propertiesHash&&
        p.revision===revision,'CASE_UNPREPARED_CHANGED');
      return p;
    });
  }
  function unpreparedHistory(x){
    const refs=x.unpreparedContinuations??[],events=(x.reconciliations??[]).filter(v=>v.kind==='SCOPED_CASE_UNPREPARED_CONTINUATION');
    need(refs.length===events.length&&new Set(refs.map(v=>v.executor)).size===refs.length,'CASE_UNPREPARED_AUDIT');
    for(const [index,ref] of refs.entries()){
      const a=events[index];
      need(a&&a.newExecutor===ref.executor&&a.batchId===CONFIG.batchId&&a.planHash===CONFIG.planHash&&
        /^[a-f0-9]{64}$/.test(a.journalHash)&&/^[a-f0-9-]{36}$/.test(a.newExecutor),'CASE_UNPREPARED_AUDIT');
      const file=path.join(b.root,prefix+'.unprepared-continuation-'+a.journalHash+'-'+a.newExecutor+'.json'),raw=bytes(file),record=JSON.parse(raw);
      need(hash(raw)===ref.recordHash&&JSON.stringify(record.audit)===JSON.stringify(a)&&
        hash(JSON.stringify(record.journalBefore))===a.journalHash&&a.notionWrites===0&&
        a.ticketsCreated===0&&a.pageAdvances===0,'CASE_UNPREPARED_AUDIT');
      const old=record.journalBefore.batches[CONFIG.batchId];unsent(old,false);
      need(old.error==='OWNERSHIP_FENCE: Fresh same-generation scoped ownership and all prerequisites required'&&
        old.haltedFrom==='READY'&&JSON.stringify(old.edits)===JSON.stringify(x.edits)&&a.oldExecutor===old.dispatch.executor&&
        JSON.stringify(old.unpreparedContinuations??[])===JSON.stringify(refs.slice(0,index))&&
        JSON.stringify((old.reconciliations??[]).filter(v=>v.kind===a.kind))===JSON.stringify(events.slice(0,index)),
        'CASE_UNPREPARED_AUDIT');
      preimages(record.pages.map(p=>p.raw),old.edits);
      record.pages.forEach((p,i)=>need(JSON.stringify(pageData(p.raw,old.edits[i].pageId))===JSON.stringify(p),'CASE_UNPREPARED_AUDIT'));
    }
    // The exact zero-history executor and first halted preimage are fixed for
    // this incident. A later HALT cannot impersonate the initial entry after
    // removal of all adoption references, events and files.
    let tip=CONFIG.initialExecutorHash;
    for(const a of x.reconciliations??[]){
      if(a.kind==='SCOPED_CASE_UNPREPARED_CONTINUATION'||a.kind==='SCOPED_CASE_VERIFIED_CONTINUATION'){
        need(hash(a.oldExecutor??'')===tip,'CASE_UNPREPARED_AUDIT');
        if(a.kind==='SCOPED_CASE_VERIFIED_CONTINUATION'){
          const matches=(x.caseContinuations??[]).filter(v=>v.executor===a.newExecutor);
          const file=path.join(b.root,prefix+'.verified-continuation-'+a.journalHash+'-'+a.newExecutor+'.json'),raw=bytes(file),record=JSON.parse(raw);
          need(matches.length===1&&hash(raw)===matches[0].recordHash&&JSON.stringify(record.audit)===JSON.stringify(a)&&
            hash(JSON.stringify(record.journalBefore))===a.journalHash,'CASE_UNPREPARED_AUDIT');
        }
        tip=hash(a.newExecutor??'');
      }else if(a.kind==='SCOPED_CASE_SAVED_ACK_VERIFICATION')need(hash(a.oldExecutor??'')===tip,'CASE_UNPREPARED_AUDIT');
    }
    need(hash(x.dispatch.executor)===tip,'CASE_UNPREPARED_AUDIT');
    if(refs.length===0&&x.next===0&&x.receipt===null&&x.dispatch.phase==='UNSENT')
      need(hash(bytes(b.file))===CONFIG.initialJournalHash,'CASE_UNPREPARED_AUDIT');
  }
  function restoreUnprepared(input){
    need(typeof input.apply==='boolean'&&(!readOnly||!input.apply),'READ_ONLY');
    const {raw,batch:x}=current(input);unsent(x);unpreparedHistory(x);
    need(input.expectedError===x.error&&x.error==='OWNERSHIP_FENCE: Fresh same-generation scoped ownership and all prerequisites required'&&
      x.haltedFrom==='READY'&&((x.status==='HALTED'&&x.dispatch.failure?.phase==='UNSENT')||
      (x.status==='READY'&&x.unpreparedContinuations?.length>0&&x.dispatch.executor!==b.executor)),
      'CASE_UNPREPARED_IDENTITY');
    const pages=preimages(input.pages,x.edits);
    const audit={kind:'SCOPED_CASE_UNPREPARED_CONTINUATION',at:new Date().toISOString(),batchId:CONFIG.batchId,
      planHash:CONFIG.planHash,journalHash:hash(raw),oldExecutor:x.dispatch.executor,newExecutor:b.executor,
      owner:clone(input.ownerProof),notionWrites:0,ticketsCreated:0,pageAdvances:0};
    if(!input.apply)return {checkOnly:true,status:x.status,next:0,audit};
    const file=path.join(b.root,prefix+'.unprepared-continuation-'+hash(raw)+'-'+b.executor+'.json');
    need(!fs.existsSync(file),'CASE_UNPREPARED_AUDIT');
    const record={audit,journalBefore:JSON.parse(raw),pages};atomic(file,record);
    const next=JSON.parse(raw),out=next.batches[CONFIG.batchId];
    out.status='READY';out.dispatch.executor=b.executor;out.dispatch.owner=clone(input.ownerProof);
    out.reconciliations=[...(out.reconciliations??[]),audit];
    out.unpreparedContinuations=[...(out.unpreparedContinuations??[]),{executor:b.executor,recordHash:hash(bytes(file))}];
    pins();need(bytes(b.file)===raw,'PERSISTENCE');atomic(b.file,next);b.state=read(b.file);
    return {status:'READY',next:0,executor:b.executor,planHash:out.planHash,notionWrites:0};
  }
  function handle(input){
    if(input.action==='close')return b.handle(input);
    scope();
    if(b.state.batches[CONFIG.batchId])unpreparedHistory(b.state.batches[CONFIG.batchId]);
    if(input.action==='case_stage_input'){
      need(input.batchId===CONFIG.batchId&&input.operation?.batchId===CONFIG.batchId&&
        stagedActions.has(input.operation.action)&&!Object.hasOwn(input.operation,'ownerProof')&&!staged,'CASE_STAGE_INPUT');
      const operation=clone(input.operation),stageId=crypto.randomUUID(),inputHash=hash(JSON.stringify(operation));
      staged={stageId,inputHash,operation,executor:b.executor};
      return {stageId,inputHash};
    }
    if(input.action==='case_consume_input'){
      need(input.batchId===CONFIG.batchId&&staged&&input.stageId===staged.stageId&&input.inputHash===staged.inputHash&&
        staged.executor===b.executor,'CASE_STAGE_IDENTITY');
      const operation=staged.operation;staged=null;
      // Consume exactly once and run the original action's fresh owner and
      // snapshot checks synchronously. Staging itself grants no authority.
      return handle({...operation,ownerProof:input.ownerProof});
    }
    if(input.action==='case_recovery_status'){
      need(input.batchId===CONFIG.batchId,'CASE_ACK_SCOPE');
      const raw=bytes(b.file);need(raw===JSON.stringify(b.state),'PERSISTENCE');
      const selected=b.state.batches[CONFIG.batchId],last=selected?.reconciliations?.findLast(v=>v.kind==='SCOPED_CASE_SAVED_ACK_VERIFICATION');
      if(selected)history(selected);
      let restoration=null;
      if(last&&selected.next===last.index+1&&selected.status==='READY'&&selected.receipt===null&&
          ['VERIFIED_STOPPED','UNSENT'].includes(selected.dispatch?.phase)){
        const {recordHash}=committedRecovery(last.index);
        restoration={journalHash:hash(raw),auditHash:recordHash,index:last.index};
      }
      return {...b.handle({action:'status',batchId:CONFIG.batchId}),journalHash:hash(raw),restoration};
    }
    if(input.action==='case_reconcile_acknowledged')return reconcile(input);
    if(input.action==='case_continue_verified')return continueVerified(input);
    if(input.action==='case_restore_unprepared')return restoreUnprepared(input);
    if(readOnly)need(['status','case_authority','validate_owner_proof','validate_batch','preflight'].includes(input.action),'READ_ONLY');
    need(['case_authority','validate_owner_proof'].includes(input.action)||input.batchId===CONFIG.batchId,'CASE_ACK_SCOPE');
    need(['status','case_authority','validate_owner_proof','validate_batch','preflight','fence_begin',
      'fence_prepare','fence_authorize','fence_dispatch','fence_confirm_send','fence_observe','fence_ack','fence_verify','fence_halt'].includes(input.action),
      'CASE_ACK_ACTION');
    return b.handle(input);
  }
  return {handle,close:()=>b.close()};
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(!args.includes('--stdio')||args.some(v=>!['--stdio','--apply'].includes(v))){
    process.stderr.write('Usage: case_ack_bridge.cjs --stdio [--apply]\n');process.exit(2);
  }
  let bridge;try{bridge=createBridge({readOnly:!args.includes('--apply')});}
  catch(e){process.stdout.write('NPG/1 '+JSON.stringify({code:e.code??'ERROR',error:e.message})+'\n');process.exit(1);}
  const rl=require('node:readline').createInterface({input:process.stdin,crlfDelay:Infinity});
  process.stdout.write('NPG/1 {"ready":true}\n');
  rl.on('line',line=>{let q;try{q=JSON.parse(line);const result=bridge.handle(q);
    process.stdout.write('NPG/1 '+JSON.stringify({requestId:q.requestId,ok:true,result})+'\n',()=>{
      if(q.action==='close'){rl.close();process.stdin.destroy();process.exit(0);}
    });}catch(e){process.stdout.write('NPG/1 '+JSON.stringify({requestId:q?.requestId,ok:false,code:e.code??'ERROR',error:e.message})+'\n');}});
  rl.on('close',()=>bridge.close());process.on('exit',()=>bridge.close());
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{bridge.close();process.exit(0);});
}
module.exports={createBridge};
