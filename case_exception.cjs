'use strict';
// A separately approved risk disposition. Never changes C into A, sends a
// Notion mutation, or represents revocation of an already exported payload.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const clone=x=>JSON.parse(JSON.stringify(x));
function bytes(file,privateOnly=true) {
  need(path.isAbsolute(file),'CASE_PATH');const st=fs.lstatSync(file);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&
    !(st.mode&(privateOnly?0o077:0o022)),'CASE_FILE');
  return fs.readFileSync(file,'utf8');
}
function pinned(file,sha,privateOnly=true) {
  need(/^[a-f0-9]{64}$/.test(sha??''),'CASE_PIN');const raw=bytes(file,privateOnly);
  need(digest(raw)===sha,'CASE_PIN');return raw;
}
function config(file,sha) {
  const c=JSON.parse(pinned(file,sha));
  need(c.schema==='SCOPED_CASE_GATE_V1'&&path.isAbsolute(c.root??'')&&
    typeof c.batchId==='string'&&typeof c.taskId==='string'&&
    /^[a-f0-9]{32}$/.test(c.originalPageId??'')&&
    typeof c.workerRole==='string','CASE_GATE_SCHEMA');
  return c;
}
function assertControl(state) {
  const closed=Object.values(state.batches??{}).filter(b=>b.status==='CLOSED_EXCEPTION_UNCONFIRMED');
  if(!closed.length&&!state.caseExceptionControl)return;
  const c=state.caseExceptionControl;
  need(closed.length===1&&c?.version===1&&c.retiredOwnerId&&c.authority&&
    closed[0].exceptionDisposition?.retiredOwnerId===c.retiredOwnerId&&
    closed[0].exceptionDisposition?.manifestHash===c.manifestHash&&c.configHash,'CASE_CONTROL_INVALID');
}
function validateControl(root,state) {
  assertControl(state);const c=state.caseExceptionControl;if(!c)return null;
  const a=JSON.parse(bytes(path.join(root,digest(c.batchId)+'.exception-closure.json')));
  need(digest(a.manifestBytes??'')===c.manifestHash,'CASE_CONTROL_INVALID');
  const m=JSON.parse(a.manifestBytes);
  const batch=state.batches[c.batchId],original=a.journalBefore?.batches?.[c.batchId];
  need(original&&JSON.stringify(batch.exceptionDisposition)===JSON.stringify(a.audit)&&
    digest(a.approvalBytes??'')===a.audit?.approvalHash&&
    batch.ticketDisposition?.ticket===original.receipt?.ticket&&
    batch.ticketDisposition?.status==='REVOKED_LOCAL_ONLY'&&batch.ticketDisposition?.externalPayloadRevoked===false,
    'CASE_CONTROL_INVALID');
  for(const k of ['planHash','edits','next','receipt','error','haltedFrom'])
    need(JSON.stringify(batch[k])===JSON.stringify(original[k]),'CASE_CONTROL_INVALID');
  for(const k of ['retiredOwnerId','authority','worker','admissionBatchIds','admissionPlanHashes'])
    need(JSON.stringify(c[k])===JSON.stringify(m[k]),'CASE_CONTROL_INVALID');
  need(c.configHash===m.gateConfigHash&&typeof c.exclusive==='boolean','CASE_CONTROL_INVALID');
  if(c.exclusive===false) {
    const observation=JSON.parse(bytes(path.join(root,digest(c.batchId)+'.intake-observation.json')));
    need(observation.manifestHash===c.manifestHash&&JSON.stringify(observation.observation)===JSON.stringify(c.actualIntakeObservation)&&
      digest(JSON.stringify(observation.source))===c.actualIntakeObservation.sourceHash,'CASE_CONTROL_INVALID');
  }
  return m;
}
function guardOwner(state,proof) {
  assertControl(state);
  const c=state.caseExceptionControl;if(!c)return;
  need(c.version===1&&c.retiredOwnerId&&c.authority&&c.manifestHash&&c.configHash,'CASE_CONTROL_INVALID');
  need(proof?.ownerId!==c.retiredOwnerId,'RETIRED_CASE_AUTHORITY');
  if(c.exclusive===true)need(proof?.ownerId===c.authority.ownerId&&
    proof.generation===c.authority.generation,'CASE_OWNER_CONFLICT');
}
function guardBatch(state,batchId,proof,edits) {
  const c=state.caseExceptionControl;if(!c?.exclusive)return;
  need(c.admissionBatchIds.includes(batchId)&&proof?.scope===batchId&&
    digest(JSON.stringify(edits))===c.admissionPlanHashes[batchId],'CASE_SCOPE');
}
function controls(manifest) {
  const files=manifest.controls?.files;
  need(Array.isArray(files)&&files.length>=7&&new Set(files.map(f=>f.path)).size===files.length,'CASE_CONTROLS');
  for(const f of files)pinned(f.path,f.sha256,false);
  const names=new Set(files.map(f=>path.basename(f.path)));
  for(const n of ['broker.cjs','runner.js','case_exception.cjs','case_gate.cjs','central_case_owner.js'])need(names.has(n),'CASE_CONTROLS');
  need(Array.isArray(manifest.controls.roles)&&manifest.controls.roles.length===2&&
    manifest.controls.roles.map(r=>r.role).sort().join(',')==='guardrail,operator','CASE_CONTROLS');
  for(const r of manifest.controls.roles) {
    const wrapper=files.find(f=>f.path===r.wrapper),settings=files.find(f=>f.path===r.settings);
    need(wrapper&&settings&&['operator','guardrail'].includes(r.role),'CASE_CONTROLS');
    const text=pinned(wrapper.path,wrapper.sha256,false),j=JSON.parse(pinned(settings.path,settings.sha256,false));
    need(text.includes('--settings '+r.settings)&&text.includes('case_gate.cjs launch'),'CASE_CONTROLS');
    const h=j.hooks?.PreToolUse;
    need(Array.isArray(h)&&h.some(v=>v.matcher==='.*'&&v.hooks?.some(x=>x.type==='command'&&
      x.command===r.hookCommand&&x.onFailure==='block'&&x.async!==true)),'CASE_CONTROLS');
    need(r.hookCommand.includes('case_gate.cjs hook')&&r.hookCommand.includes(manifest.gateConfigHash), 'CASE_CONTROLS');
  }
}
function loadManifest(input) {
  const raw=pinned(input.manifestPath,input.approvedManifestHash),m=JSON.parse(raw);
  need(m.schema==='EXACT_SCOPED_EXCEPTION_V1'&&/^[a-f0-9]{40}$/.test(m.sourceHead??'')&&
    m.retiredOwnerId&&m.authority?.ownerId&&m.authority.generation&&
    m.authority.ownerId!==m.retiredOwnerId&&Array.isArray(m.admissionBatchIds)&&m.admissionBatchIds.length>0&&
    new Set(m.admissionBatchIds).size===m.admissionBatchIds.length&&
    Object.keys(m.admissionPlanHashes??{}).sort().join(',')===[...m.admissionBatchIds].sort().join(',')&&
    Object.values(m.admissionPlanHashes).every(h=>/^[a-f0-9]{64}$/.test(h)),'CASE_MANIFEST');
  need(m.risk?.classification==='C'&&m.risk.originalApplication==='UNCONFIRMED'&&
    m.risk.externalRequestRevoked===false&&m.risk.acceptedImpact==='SCOPED_ROUTER_OWNER_LITERAL_ONLY', 'CASE_RISK');
  const {loadUnwrittenManifest}=require('./broker.cjs');
  const {spec}=loadUnwrittenManifest(m.originalManifestPath,m.originalManifestHash);
  const c=config(m.gateConfigPath,m.gateConfigHash);
  need(c.root===spec.root&&c.batchId===spec.batchId&&c.taskId===m.worker.taskId&&
    c.originalPageId===m.worker.originalPageId&&c.workerRole===m.worker.role,'CASE_CORRELATION');
  return {raw,m,spec,c};
}
function reconcile(b,input) {
  const {hash,pageData,plan,atomic,assessUnwrittenExecution}=require('./broker.cjs');
  const {raw,m,spec}=loadManifest(input);
  need(typeof input.apply==='boolean'&&(!b.readOnly||!input.apply),'READ_ONLY');
  need(b.root===spec.root&&input.batchId===spec.batchId,'CASE_CORRELATION');
  if(b.readOnly)need(!fs.existsSync(b.lock),'LOCKED');else b.assertLock();
  b.ownerProof(input.ownerProof);
  need(input.ownerProof.ownerId===m.authority.ownerId&&input.ownerProof.generation===m.authority.generation&&
    input.ownerProof.scope===spec.batchId,'CASE_OWNER_CONFLICT');
  controls(m);
  need(m.controls.files.some(f=>f.path===path.join(spec.runtime,'broker.cjs')&&f.sha256===digest(bytes(path.join(__dirname,'broker.cjs'),false)))&&
    m.controls.files.some(f=>f.path===path.join(spec.runtime,'case_exception.cjs')&&f.sha256===digest(bytes(__filename,false))), 'CASE_EXECUTED_SOURCE');
  const before=bytes(b.file),state=JSON.parse(before),batch=state.batches[spec.batchId];
  need(JSON.stringify(state)===JSON.stringify(b.state),'PERSISTENCE');
  const auditFile=path.join(b.root,hash(spec.batchId)+'.exception-closure.json');
  const prior=fs.existsSync(auditFile)?JSON.parse(bytes(auditFile)):null;
  const assessment=assessUnwrittenExecution(spec,input);
  need(assessment.classification==='C'&&assessment.riskObserved===false&&
    assessment.code==='RECOVERY_EVIDENCE_MISSING','CASE_OBSERVED_OR_INVALID_EVIDENCE');
  const original=prior?.journalBefore??state,old=original.batches[spec.batchId];
  need(hash(JSON.stringify(original))===spec.journalHash&&original.active===spec.batchId&&
    old?.status==='HALTED'&&old.haltedFrom==='WRITE_PENDING'&&old.error===spec.error&&old.next===0&&
    old.edits?.length===1&&hash(JSON.stringify(old.edits))===spec.planHash&&old.planHash===spec.planHash&&
    old.receipt?.ticket===spec.ticket&&old.receipt.snapshotHash===spec.snapshotHash&&
    old.receipt.snapshot===b.snapshot(spec.batchId,0)&&!old.dispatch&&!old.verifications&&!old.reconciliations&&!old.readDetail,
    'CASE_ORIGINAL_CHANGED');
  const evidence=JSON.parse(pinned(path.join(spec.root,spec.evidence),spec.evidenceHash));
  need(evidence.incident===spec.batchId&&hash(evidence.adapterSource)===spec.adapterHash&&
    evidence.facts?.notionMutationInvoked===false,'CASE_EVIDENCE');
  // The original installation receipt remains immutable; the new installation
  // preserves its before pins in a separately reviewed installation manifest.
  pinned(path.join(spec.root,spec.installation),spec.installationHash);
  need(JSON.stringify(m.controls.originalPins)===JSON.stringify(spec.pins),'CASE_ORIGINAL_INSTALLATION');
  for(const [n,pin] of Object.entries(spec.pins))pinned(path.join(m.controls.originalBackup,n),pin,false);
  pinned(m.worker.packetPath,m.worker.packetHash,false);pinned(m.worker.statusPath,m.worker.statusHash,false);
  const snapshot=JSON.parse(pinned(old.receipt.snapshot,spec.snapshotHash)),edit=old.edits[0];
  const pre=pageData(snapshot.page.raw,edit.pageId),fresh=pageData(input.page,edit.pageId),generated=plan(pre,edit);
  need(snapshot.batchId===spec.batchId&&snapshot.ticket===spec.ticket&&snapshot.index===0&&
    JSON.stringify(snapshot.edit)===JSON.stringify(edit)&&hash(pre.body)===snapshot.bodyHash&&
    hash(pre.properties)===snapshot.propertiesHash&&generated.expected===snapshot.expected&&
    generated.beforeHash===snapshot.beforeHash&&generated.afterHash===snapshot.afterHash&&
    edit.pageId===m.risk.pageId&&hash(edit.oldStr)===m.risk.oldLiteralHash&&hash(edit.newStr)===m.risk.newLiteralHash&&
    edit.newStr.includes(m.retiredOwnerId),'CASE_TARGET');
  need(fresh.body===pre.body&&fresh.properties===pre.properties&&fresh.revision===pre.revision,'CASE_TARGET_CHANGED');
  const prefix=hash(spec.batchId)+'-';
  need(fs.readdirSync(b.root).filter(n=>n.startsWith(prefix)).every(n=>n===prefix+'0.json'),'CASE_OBSERVED_APPLICATION');
  const approval=input.approvalPath?JSON.parse(pinned(input.approvalPath,input.approvedApprovalHash)):null;
  if(input.apply)need(approval?.schema==='SCOPED_EXCEPTION_APPROVAL_V1'&&approval.status==='APPROVED'&&
    approval.manifestHash===input.approvedManifestHash&&approval.sourceHead===m.sourceHead&&
    approval.acceptsUnconfirmedApplication===true&&approval.acceptsUncancelledExternalPayload===true&&
    approval.acceptedImpact===m.risk.acceptedImpact&&typeof approval.userMessageReference==='string'&&
    approval.userMessageReference.trim(),'CASE_APPROVAL_REQUIRED');
  const audit={kind:'SCOPED_EXCEPTION_UNCONFIRMED',batchId:spec.batchId,manifestHash:input.approvedManifestHash,
    approvalHash:input.approvedApprovalHash??prior?.audit?.approvalHash??null,sourceHead:m.sourceHead,
    classification:'C',originalApplication:'UNCONFIRMED',originalExternalRequestRevoked:false,
    recoveryNotionWrites:0,pageAdvances:0,retiredOwnerId:m.retiredOwnerId,
    at:prior?.audit?.at??new Date().toISOString()};
  need(Number.isFinite(Date.parse(audit.at))&&Date.parse(audit.at)<=Date.now(),'CASE_AUDIT_CHANGED');
  if(prior) {
    const saved=pageData(prior.freshPage,edit.pageId);
    need(prior.manifestBytes===raw&&digest(prior.approvalBytes??'')===audit.approvalHash&&
      saved.body===pre.body&&saved.properties===pre.properties&&saved.revision===pre.revision&&
      JSON.stringify(prior.audit)===JSON.stringify(audit),'CASE_AUDIT_CHANGED');
  }
  const expected=clone(original),closed=expected.batches[spec.batchId];
  closed.status='CLOSED_EXCEPTION_UNCONFIRMED';closed.exceptionDisposition=audit;
  closed.ticketDisposition={ticket:spec.ticket,status:'REVOKED_LOCAL_ONLY',externalPayloadRevoked:false};
  expected.caseExceptionControl={version:1,batchId:spec.batchId,manifestHash:input.approvedManifestHash,
    configHash:m.gateConfigHash,retiredOwnerId:m.retiredOwnerId,authority:clone(m.authority),exclusive:true,
    worker:clone(m.worker),admissionBatchIds:clone(m.admissionBatchIds),
    admissionPlanHashes:clone(m.admissionPlanHashes),admission:null};
  expected.active=null;
  if(batch?.status==='CLOSED_EXCEPTION_UNCONFIRMED') {
    need(prior&&JSON.stringify(prior.journalBefore)===JSON.stringify(original)&&prior.manifestBytes===raw&&
      JSON.stringify(prior.audit)===JSON.stringify(audit)&&JSON.stringify(batch)===JSON.stringify(closed)&&
      JSON.stringify(state.caseExceptionControl?.authority)===JSON.stringify(m.authority)&&
      JSON.stringify(state.caseExceptionControl?.worker)===JSON.stringify(m.worker)&&
      JSON.stringify(state.caseExceptionControl?.admissionPlanHashes)===JSON.stringify(m.admissionPlanHashes)&&
      state.caseExceptionControl?.retiredOwnerId===m.retiredOwnerId&&state.caseExceptionControl?.configHash===m.gateConfigHash,
      'CASE_REPLAY_CHANGED');
    return {status:batch.status,alreadyConsumed:true,active:state.active,notionWrites:0};
  }
  need(digest(before)===spec.journalHash,'CASE_ORIGINAL_CHANGED');
  need(!prior||(prior.manifestBytes===raw&&JSON.stringify(prior.journalBefore)===JSON.stringify(original)&&
    JSON.stringify(prior.audit)===JSON.stringify(audit)),'CASE_AUDIT_CHANGED');
  if(!input.apply)return {status:'HALTED',eligiblePendingApproval:true,classification:'C',
    disposition:'CLOSED_EXCEPTION_UNCONFIRMED',externalPayloadRevoked:false,protectedContent:'UNCHANGED'};
  if(!prior)atomic(auditFile,{audit,journalBefore:original,manifestBytes:raw,
    approvalBytes:bytes(input.approvalPath),freshPage:input.page});
  need(bytes(b.file)===before,'PERSISTENCE');
  // Retirement, local ticket revocation and barrier removal share one commit.
  atomic(b.file,expected);b.state=JSON.parse(bytes(b.file));
  need(JSON.stringify(b.state)===JSON.stringify(expected),'PERSISTENCE');
  return {status:closed.status,active:null,classification:'C',protectedContent:'UNCHANGED',
    originalApplication:'UNCONFIRMED',externalPayloadRevoked:false,auditFile,journalHash:digest(bytes(b.file))};
}
function admit(b,input) {
  const {hash,atomic}=require('./broker.cjs');b.assertLock();b.ownerProof(input.ownerProof);
  const before=bytes(b.file);need(before===JSON.stringify(b.state),'PERSISTENCE');
  const next=clone(b.state),c=next.caseExceptionControl;
  need(c&&next.active===null&&input.ownerProof.ownerId===c.authority.ownerId&&
    input.ownerProof.generation===c.authority.generation&&input.ownerProof.scope===c.batchId,'CASE_OWNER_CONFLICT');
  need(Array.isArray(input.batchIds)&&JSON.stringify(input.batchIds)===JSON.stringify(c.admissionBatchIds),'CASE_ADMISSION');
  const verified=input.batchIds.map(id=>{
    const x=next.batches[id];
    need(x?.status==='COMPLETED'&&x.planHash===c.admissionPlanHashes[id]&&hash(JSON.stringify(x.edits))===x.planHash&&
      x.dispatch?.owner?.ownerId===c.authority.ownerId&&
      x.dispatch.owner.generation===c.authority.generation&&x.next===x.edits.length&&
      x.verifications?.length===x.edits.length,'CASE_ADMISSION');
    for(const v of x.verifications) {
      const s=JSON.parse(bytes(b.snapshot(id,v.index))),actual=bytes(b.snapshot(id,v.index)+'.verified.json');
      need(hash(actual)===v.verifiedHash&&hash(JSON.stringify(s))===v.snapshotHash,'CASE_ADMISSION');
    }
    return {batchId:id,planHash:x.planHash,verifications:clone(x.verifications)};
  });
  pinned(c.worker.packetPath,c.worker.packetHash,false);pinned(c.worker.statusPath,c.worker.statusHash,false);
  const receipt={taskId:c.worker.taskId,pageId:c.worker.originalPageId,role:c.worker.role,
    issuer:c.authority.ownerId,generation:c.authority.generation,packetHash:c.worker.packetHash,verified};
  if(c.admission){need(JSON.stringify(c.admission)===JSON.stringify(receipt),'CASE_ADMISSION');return {alreadyConsumed:true};}
  c.admission=receipt;need(bytes(b.file)===before,'PERSISTENCE');atomic(b.file,next);
  b.state=JSON.parse(bytes(b.file));need(JSON.stringify(b.state)===JSON.stringify(next),'PERSISTENCE');
  return {admitted:true,receipt,workerClaimCreated:false};
}
function release(b,input) {
  const {pageData,atomic}=require('./broker.cjs');b.assertLock();b.ownerProof(input.ownerProof);
  const before=bytes(b.file);need(before===JSON.stringify(b.state),'PERSISTENCE');
  const next=clone(b.state),c=next.caseExceptionControl;
  need(c?.admission&&next.active===null&&input.ownerProof.ownerId===c.authority.ownerId&&
    input.ownerProof.generation===c.authority.generation&&input.ownerProof.scope===c.batchId,'CASE_OWNER_CONFLICT');
  const observationFile=path.join(b.root,digest(c.batchId)+'.intake-observation.json');
  const previous=fs.existsSync(observationFile)?JSON.parse(bytes(observationFile)):null;
  const reference=previous?Date.parse(previous.observation?.observedAt):Date.now();
  need(Number.isFinite(reference)&&reference<=Date.now()&&(!previous||
    (previous.manifestHash===c.manifestHash&&digest(JSON.stringify(input.page))===previous.observation?.sourceHash)),
    'CASE_CONTROL_INVALID');
  const p=pageData(input.page,c.worker.originalPageId),props=JSON.parse(p.properties);
  const candidates=[];
  for(const block of p.body.matchAll(/```(?:json)?\n([\s\S]*?)\n```/g)) {
    try{const x=JSON.parse(block[1].replace(/^QUEUE_EVENT_V1\s*/,''));candidates.push(x.QUEUE_EVENT_V1??x);}catch{}
  }
  const e=candidates.find(e=>e.event_id===props['이벤트 ID']&&e.version===props['체크포인트 버전']);
  need(e?.kind==='CLAIM'&&e.task_id===c.worker.taskId&&e.role===c.worker.role&&
    Number.isSafeInteger(e.version)&&e.version>c.worker.sourceVersion&&
    typeof e.session_id==='string'&&e.session_id===props['세션 ID']&&e.lease_state==='CLAIM_HELD'&&
    Number.isFinite(Date.parse(e.event_at_utc))&&Date.parse(e.event_at_utc)<=reference&&
    reference-Date.parse(e.event_at_utc)<300000,'CASE_OWN_CLAIM_REQUIRED');
  if(c.exclusive===false)return {alreadyReleased:true,ownClaimEventId:e.event_id};
  c.exclusive=false;c.actualIntakeObservation={eventId:e.event_id,version:e.version,sessionId:e.session_id,
    sourceHash:digest(JSON.stringify(input.page)),observedAt:previous?.observation?.observedAt??new Date().toISOString()};
  const observation={manifestHash:c.manifestHash,observation:c.actualIntakeObservation,source:input.page};
  if(previous)need(JSON.stringify(previous)===JSON.stringify(observation),'CASE_CONTROL_INVALID');
  else atomic(observationFile,observation);
  need(bytes(b.file)===before,'PERSISTENCE');atomic(b.file,next);b.state=JSON.parse(bytes(b.file));
  need(JSON.stringify(b.state)===JSON.stringify(next),'PERSISTENCE');
  return {released:true,ownClaimEventId:e.event_id,workerRecordsChanged:false};
}
module.exports={bytes,pinned,config,assertControl,validateControl,guardOwner,guardBatch,reconcile,admit,release,loadManifest,controls};
