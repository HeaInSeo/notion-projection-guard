#!/usr/bin/env node
'use strict';
// This gate never grants tool permissions. Success defers to existing policy;
// an invalid/missing case permit blocks only the protected task's writes.
const fs=require('node:fs'),path=require('node:path');
const {bytes,pinned,config,assertControl,guardOwner,controls}=require('./case_exception.cjs');
const {hash}=require('./broker.cjs');
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
function pageId(value) {
  if(typeof value!=='string')return null;
  const s=value.replaceAll('-','').toLowerCase();
  if(/^[a-f0-9]{32}$/.test(s))return s;
  const match=value.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:[?#/]|$)/i);
  return match?.[1].replaceAll('-','').toLowerCase()??null;
}
function readState(c,configHash) {
  const state=JSON.parse(bytes(path.join(c.root,'journal.json'))),x=state.caseExceptionControl;
  assertControl(state);
  need(x&&x.version===1&&x.batchId===c.batchId&&x.configHash===configHash,'CASE_PERMIT_MISSING');
  need(state.batches[c.batchId]?.status==='CLOSED_EXCEPTION_UNCONFIRMED'&&
    state.batches[c.batchId]?.exceptionDisposition?.manifestHash===x.manifestHash&&
    state.batches[c.batchId]?.ticketDisposition?.status==='REVOKED_LOCAL_ONLY','CASE_CONTROL_INVALID');
  const audit=JSON.parse(bytes(path.join(c.root,hash(c.batchId)+'.exception-closure.json')));
  need(hash(audit.manifestBytes??'')===x.manifestHash,'CASE_CONTROL_INVALID');
  const manifest=JSON.parse(audit.manifestBytes);
  need(manifest.gateConfigHash===configHash&&manifest.retiredOwnerId===x.retiredOwnerId&&
    JSON.stringify(manifest.authority)===JSON.stringify(x.authority),'CASE_CONTROL_INVALID');
  controls(manifest);
  return {state,x};
}
function permit(c,configHash,role) {
  const {state,x}=readState(c,configHash),a=x.admission;
  need(a&&a.taskId===c.taskId&&a.pageId===c.originalPageId&&a.role===role&&
    a.issuer===x.authority.ownerId&&a.generation===x.authority.generation&&
    a.issuer!==x.retiredOwnerId&&a.packetHash===x.worker.packetHash,'CASE_PERMIT_MISSING');
  guardOwner(state,{ownerId:a.issuer,generation:a.generation});
  pinned(x.worker.packetPath,x.worker.packetHash,false);pinned(x.worker.statusPath,x.worker.statusHash,false);
  need(Array.isArray(a.verified)&&a.verified.length===x.admissionBatchIds.length&&
    a.verified.every((v,i)=>v.batchId===x.admissionBatchIds[i]),'CASE_PERMIT_INVALID');
  for(const v of a.verified) {
    const b=state.batches[v.batchId];
    need(b?.status==='COMPLETED'&&b.planHash===v.planHash&&
      b.dispatch?.owner?.ownerId===a.issuer&&b.dispatch.owner.generation===a.generation&&
      JSON.stringify(b.verifications)===JSON.stringify(v.verifications),'CASE_PERMIT_INVALID');
    for(const r of v.verifications) {
      const base=path.join(c.root,hash(v.batchId)+'-'+r.index+'.json');
      pinned(base,r.snapshotHash);pinned(base+'.verified.json',r.verifiedHash);
    }
  }
  return {taskId:a.taskId,issuer:a.issuer,generation:a.generation};
}
function gate(c,configHash,event,role) {
  need(event&&typeof event.tool_name==='string'&&event.tool_input&&typeof event.tool_input==='object','CASE_HOOK_INPUT');
  const name=event.tool_name.toLowerCase(),a=event.tool_input;
  if(name.includes('notion')&& !/(?:^|__|[-_])(?:fetch|search|query|get|list)(?:[-_]|$)/.test(name)) {
    // Both currently observed namespaces use page_id. Also accept the provider's
    // UUID/URL spelling, and fail closed on an unknown mutation target shape.
    const targets=[a.page_id,a.id,a.parent?.page_id,a.parent?.id].filter(v=>v!==undefined).map(pageId);
    if(!targets.length&&/(?:^|[-_])create[-_]pages$/.test(name)&&!a.parent)return {unrelated:true};
    need(targets.length>0&&targets.every(Boolean),'CASE_TARGET_UNKNOWN');
    if(targets.includes(c.originalPageId))return permit(c,configHash,role);
  }
  // File and shell permissions remain with the existing worker policy. This
  // case gate enforces the actual native ownership-record boundary, not a shell
  // sandbox. In particular, it makes no source-write containment claim.
  return {unrelated:true};
}
function main(args) {
  const mode=args.shift(),opts={};
  need(['hook','launch','context','targeted-start'].includes(mode)&&args.length%2===0,'CASE_ARGUMENTS');
  for(let i=0;i<args.length;i+=2){need(['--config','--config-sha256','--role','--target-page'].includes(args[i])&&
    !Object.hasOwn(opts,args[i]),'CASE_ARGUMENTS');opts[args[i]]=args[i+1];}
  const c=config(opts['--config'],opts['--config-sha256']),role=opts['--role'];
  need(['operator','guardrail'].includes(role),'CASE_ARGUMENTS');
  if(mode==='hook') {
    const result=gate(c,opts['--config-sha256'],JSON.parse(fs.readFileSync(0,'utf8')),role);
    // Never use permissionDecision=allow: preserve the normal permission gate.
    process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',
      additionalContext:result.unrelated?'':'Use the current canonical case admission; the retired Router marker grants no authority.'}})+'\n');
    return;
  }
  // Generic scheduled scans can continue on other approved tasks. Protected
  // task writes still pass the per-tool hook, including writes in this run.
  const target=opts['--target-page'];
  const state=JSON.parse(bytes(path.join(c.root,'journal.json')));
  const control=state.caseExceptionControl||state.batches[c.batchId]?.status==='CLOSED_EXCEPTION_UNCONFIRMED'
    ?readState(c,opts['--config-sha256']).x:null;
  if(mode==='context') {
    process.stdout.write(JSON.stringify({taskId:c.taskId,originalPageId:c.originalPageId,
      authoritySource:'canonical caseExceptionControl.admission, never the Router scoped-owner marker',
      retiredOwnerId:control?.retiredOwnerId??null,admission:control?.admission??null,
      originalPacketIsPreservedAuditInput:true,originalStatusIsPreservedAuditInput:true,
      sourcePacket:control?.worker?.packetPath??null,
      instruction:'Use only the canonical current admission for this protected task, then all existing native authority/usage/WIP/repo/own CLAIM gates. Without admission, continue only independent already approved work. Do not repeat completed PREP or reviews.'})+'\n');
    return;
  }
  if(target!==undefined)need(pageId(target)===c.originalPageId,'CASE_TARGET_UNKNOWN');
  if(mode==='targeted-start')need(target!==undefined,'CASE_TARGET_UNKNOWN');
  if(target!==undefined)permit(c,opts['--config-sha256'],role);
  process.stdout.write(JSON.stringify({gate:'READY',scope:target?'CANONICAL_ADMISSION':'GENERIC_SCAN_ONLY',
    protectedTaskRequiresHook:true})+'\n');
  if(mode==='targeted-start') {
    // Actual central start path: no shell interpolation, same existing unit.
    const cp=require('node:child_process');
    const unit='claude-'+role+'-tick.service';
    const observed=cp.spawnSync('/usr/bin/systemctl',['--user','show',unit,'-p','ActiveState','-p','MainPID'],{encoding:'utf8'});
    need(observed.status===0&&observed.stdout.includes('ActiveState=inactive')&&observed.stdout.includes('MainPID=0'),'CASE_ROLE_BUSY');
    // A timer may win this race; systemd coalesces starts, and the wrapper's
    // existing role flock remains the actual duplicate-worker barrier.
    const started=cp.spawnSync('/usr/bin/systemctl',['--user','start','--no-block',unit],{encoding:'utf8'});
    need(started.status===0,'CASE_START_FAILED');
    process.stdout.write(JSON.stringify({requested:true,unit,ownClaimCreated:false})+'\n');
  }
}
if(require.main===module) {
  try{main(process.argv.slice(2));}
  catch(e){process.stderr.write((e.code??e.message)+'\n');process.exitCode=2;}
}
module.exports={pageId,permit,gate,readState,main};
