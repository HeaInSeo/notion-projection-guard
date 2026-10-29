'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
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

  async function withLock(operation){
    need(typeof operation==='function','LOCK_OPERATION');
    trustedDirectory(root,'ROOT_DIRECTORY');
    let fd,identity;
    try{
      fd=fs.openSync(lockPath,fs.constants.O_CREAT|fs.constants.O_EXCL|
        fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    }catch(error){
      if(error.code==='EEXIST')throw Error('SORI48_RUNTIME_LOCK_BUSY');
      throw error;
    }
    try{
      identity=fs.fstatSync(fd);
      need(identity.isFile()&&identity.uid===ownerUid()&&!(identity.mode&0o077),
        'LOCK_FILE');
      const record=Buffer.from(JSON.stringify({schema:'SORI48_CLOSURE_LOCK_V1',
        pid:process.pid,createdAt:new Date().toISOString()}));
      fs.writeFileSync(fd,record);fs.fsyncSync(fd);syncDirectory(root);
      return await operation();
    }finally{
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
      const existing=fs.readFileSync(file);
      trustedFile(file,'AUDIT_FILE');
      need(existing.equals(bytes),'AUDIT_COLLISION');
      return {file,sha256:digest};
    }finally{if(fd!==undefined)fs.closeSync(fd);}
    syncDirectory(auditDirectory);
    need(fs.readFileSync(file).equals(bytes),'AUDIT_READBACK');
    trustedFile(file,'AUDIT_FILE');
    return {file,sha256:digest};
  }
  async function atomicWrite(expectedSha256,afterBytes){
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
      need(sha(fs.readFileSync(journalPath))===expectedSha256,'PREIMAGE_CHANGED');
      fs.renameSync(temp,journalPath);renamed=true;syncDirectory(root);
      trustedFile(journalPath,'JOURNAL_FILE');
      const readback=fs.readFileSync(journalPath,'utf8');
      need(readback===afterBytes,'JOURNAL_READBACK');
      return readback;
    }finally{
      if(fd!==undefined)fs.closeSync(fd);
      if(!renamed&&identity)removeOwned(temp,identity,root);
    }
  }
  return Object.freeze({withLock,persistAudit,atomicWrite});
}
module.exports={createRuntime,sha};
