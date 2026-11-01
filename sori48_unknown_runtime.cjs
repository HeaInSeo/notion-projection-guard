'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const state=require('./sori48_unknown_state.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const need=(ok,why)=>{if(!ok)throw Error('SORI48_RUNTIME_'+why);};
const ownerUid=()=>process.geteuid();

function trustedDirectory(directory,why){
  const stat=fs.lstatSync(directory);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===ownerUid()&&
    !(stat.mode&0o022)&&fs.realpathSync(directory)===directory,why);
  return stat;
}
function trustedFile(file,why){
  const stat=fs.lstatSync(file);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===ownerUid()&&
    !(stat.mode&0o022)&&fs.realpathSync(file)===file,why);
  return stat;
}
function syncDirectory(directory){
  const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function removeOwned(file,identity,directory){
  try{
    const current=fs.lstatSync(file);
    if(current.dev===identity.dev&&current.ino===identity.ino){
      fs.unlinkSync(file);syncDirectory(directory);
    }
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
function createRuntime(options={}){
  const root=options.root;
  need(typeof root==='string'&&path.isAbsolute(root)&&!root.includes('\0'),'ROOT_PATH');
  trustedDirectory(root,'ROOT_DIRECTORY');
  const journalPath=path.join(root,'journal.json');
  const auditDirectory=options.auditDirectory??
    path.join(root,'manual-audits','sori48-closure-20261029');
  const relative=path.relative(root,auditDirectory);
  need(path.isAbsolute(auditDirectory)&&relative&&!relative.startsWith('..'+path.sep)&&
    !path.isAbsolute(relative),'AUDIT_PATH');
  const lockPath=path.join(root,'.sori48-unknown-closure.lock');
  let insideClosureLock=false;
  function canonical(){
    need(typeof options.getBroker==='function','CANONICAL_BROKER_REQUIRED');
    const broker=options.getBroker();
    need(broker?.root===root&&broker.file===journalPath&&typeof broker.assertLock==='function',
      'CANONICAL_BROKER_REQUIRED');
    broker.assertLock();
    const file=path.join(root,'broker.lock');trustedFile(file,'CANONICAL_LOCK');
    const lock=JSON.parse(fs.readFileSync(file,'utf8'));
    need(lock.pid===process.pid&&lock.executor===broker.executor,'CANONICAL_LOCK');
    trustedFile(journalPath,'JOURNAL_FILE');
    need(JSON.stringify(JSON.parse(fs.readFileSync(journalPath,'utf8')))===JSON.stringify(broker.state),
      'CANONICAL_MEMORY');
    return broker;
  }

  async function withLock(operation){
    need(typeof operation==='function','LOCK_OPERATION');
    trustedDirectory(root,'ROOT_DIRECTORY');
    canonical();
    let fd,identity;
    const open=()=>fs.openSync(lockPath,fs.constants.O_CREAT|fs.constants.O_EXCL|
      fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    try{fd=open();}catch(error){
      if(error.code!=='EEXIST')throw error;
      const prior=trustedFile(lockPath,'LOCK_FILE');
      need(!(prior.mode&0o077),'LOCK_FILE');
      const raw=fs.readFileSync(lockPath,'utf8'),old=JSON.parse(raw);
      need(old.schema==='SORI48_CLOSURE_LOCK_V1'&&Number.isSafeInteger(old.pid)&&old.pid>0&&
        Number.isFinite(Date.parse(old.createdAt)),'LOCK_FILE');
      try{process.kill(old.pid,0);throw Error('SORI48_RUNTIME_LOCK_BUSY');}
      catch(probeError){if(probeError.code!=='ESRCH')throw Error('SORI48_RUNTIME_LOCK_BUSY');}
      // Restart only after observed process absence, never from lock age.
      ensureAuditDirectory();
      const evidence=path.join(auditDirectory,'STALE_CLOSURE_LOCK-'+sha(raw)+'.json');
      try{fs.writeFileSync(evidence,raw,{flag:'wx',mode:0o600});}
      catch(saved){if(saved.code!=='EEXIST')throw saved;need(fs.readFileSync(evidence,'utf8')===raw,'LOCK_AUDIT');}
      const auditFd=fs.openSync(evidence,fs.constants.O_RDONLY);try{fs.fsyncSync(auditFd);}finally{fs.closeSync(auditFd);}
      syncDirectory(auditDirectory);canonical();
      need(fs.readFileSync(lockPath,'utf8')===raw,'LOCK_CHANGED');removeOwned(lockPath,prior,root);
      fd=open();
    }
    try{
      identity=fs.fstatSync(fd);
      need(identity.isFile()&&identity.uid===ownerUid()&&!(identity.mode&0o077),
        'LOCK_FILE');
      const record=Buffer.from(JSON.stringify({schema:'SORI48_CLOSURE_LOCK_V1',
        pid:process.pid,createdAt:new Date().toISOString()}));
      fs.writeFileSync(fd,record);fs.fsyncSync(fd);syncDirectory(root);
      insideClosureLock=true;
      const result=await operation();canonical();return result;
    }finally{
      insideClosureLock=false;
      if(fd!==undefined)fs.closeSync(fd);
      if(identity)removeOwned(lockPath,identity,root);
    }
  }
  function ensureAuditDirectory(){
    const parent=path.dirname(auditDirectory);
    trustedDirectory(parent,'AUDIT_PARENT');
    try{fs.mkdirSync(auditDirectory,{mode:0o700});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    trustedDirectory(auditDirectory,'AUDIT_DIRECTORY');
    need(!(fs.statSync(auditDirectory).mode&0o077),'AUDIT_DIRECTORY_PRIVATE');
  }
  async function persistAudit(audit){
    need(audit&&typeof audit==='object'&&!Array.isArray(audit),'AUDIT_INPUT');
    ensureAuditDirectory();
    const bytes=Buffer.from(JSON.stringify(audit));
    const digest=sha(bytes);
    const file=path.join(auditDirectory,
      'SORI48_SUPERSEDED_UNKNOWN_PRIVATE_AUDIT-'+digest+'.json');
    let fd,identity;
    try{
      fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|
        fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
      identity=fs.fstatSync(fd);
      need(identity.uid===ownerUid()&&!(identity.mode&0o077),'AUDIT_FILE');
      fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      trustedFile(file,'AUDIT_FILE');
      need(!(fs.statSync(file).mode&0o077),'AUDIT_FILE_PRIVATE');
      const existing=fs.readFileSync(file);
      need(existing.equals(bytes),'AUDIT_COLLISION');
      return {file,sha256:digest};
    }finally{if(fd!==undefined)fs.closeSync(fd);}
    syncDirectory(auditDirectory);
    need(fs.readFileSync(file).equals(bytes),'AUDIT_READBACK');
    trustedFile(file,'AUDIT_FILE');
    return {file,sha256:digest};
  }
  async function atomicWrite(expectedSha256,afterBytes){
    need(insideClosureLock,'CLOSURE_LOCK_REQUIRED');const broker=canonical();
    need(/^[a-f0-9]{64}$/.test(expectedSha256??''),'EXPECTED_SHA');
    need(typeof afterBytes==='string','AFTER_BYTES');
    trustedFile(journalPath,'JOURNAL_FILE');
    need(sha(fs.readFileSync(journalPath))===expectedSha256,'PREIMAGE');
    const temp=journalPath+'.sori48-'+crypto.randomUUID()+'.tmp';
    let fd,identity,renamed=false;
    try{
      fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|
        fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
      identity=fs.fstatSync(fd);
      need(identity.uid===ownerUid()&&!(identity.mode&0o077),'TEMP_FILE');
      fs.writeFileSync(fd,Buffer.from(afterBytes));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      trustedFile(journalPath,'JOURNAL_FILE');
      canonical();
      need(sha(fs.readFileSync(journalPath))===expectedSha256,'PREIMAGE_CHANGED');
      fs.renameSync(temp,journalPath);renamed=true;
      // The rename has happened even if a subsequent fsync/reply fails. Keep
      // the live broker consistent with disk; a fresh process verifies audit.
      broker.state=JSON.parse(afterBytes);syncDirectory(root);
      trustedFile(journalPath,'JOURNAL_FILE');
      const readback=fs.readFileSync(journalPath,'utf8');
      need(readback===afterBytes,'JOURNAL_READBACK');
      return readback;
    }finally{
      if(fd!==undefined)fs.closeSync(fd);
      if(!renamed&&identity)removeOwned(temp,identity,root);
    }
  }
  function inspectCommitted(){
    const broker=canonical(),id='SORI48-PAIR-ADMIT-20261029';
    if(broker.state.batches?.[id]?.status!==state.STATUS)return null;
    const digest=broker.state.batches[id].supersededUnknownDisposition?.privateAuditSha256;
    need(/^[a-f0-9]{64}$/.test(digest??''),'COMMITTED_AUDIT');
    trustedDirectory(auditDirectory,'AUDIT_DIRECTORY');
    const file=path.join(auditDirectory,'SORI48_SUPERSEDED_UNKNOWN_PRIVATE_AUDIT-'+digest+'.json');
    trustedFile(file,'AUDIT_FILE');need(!(fs.statSync(file).mode&0o077),'AUDIT_FILE_PRIVATE');
    const bytes=fs.readFileSync(file,'utf8');need(sha(bytes)===digest,'COMMITTED_AUDIT');
    const result=state.inspectPersisted(broker.state,bytes);canonical();return result;
  }
  return Object.freeze({withLock,persistAudit,atomicWrite,inspectCommitted});
}
module.exports={createRuntime,sha};
