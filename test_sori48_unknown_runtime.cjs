'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRuntime,sha}=require('./sori48_unknown_runtime.cjs');

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sori48-runtime-'));
  fs.chmodSync(root,0o700);
  fs.mkdirSync(path.join(root,'manual-audits'),{mode:0o700});
  const before=JSON.stringify({active:'SORI48-PAIR-ADMIT-20261029'});
  fs.writeFileSync(path.join(root,'journal.json'),before,{mode:0o600});
  const runtime=createRuntime({root});
  return {root,before,runtime,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('private audit is durable, pinned, private and idempotent',async t=>{
  const f=fixture();t.after(f.cleanup);
  const audit={schema:'SORI48_SUPERSEDED_UNKNOWN_PRIVATE_AUDIT_V1',value:'retained'};
  const first=await f.runtime.persistAudit(audit);
  const second=await f.runtime.persistAudit(audit);
  assert.deepEqual(second,first);
  const bytes=fs.readFileSync(first.file);
  assert.equal(first.sha256,sha(bytes));
  assert.equal(fs.statSync(first.file).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(bytes),audit);
});

test('atomic write requires the exact preimage and verifies readback',async t=>{
  const f=fixture();t.after(f.cleanup);
  const after=JSON.stringify({active:null,status:'CLOSED_SUPERSEDED_UNKNOWN'});
  const readback=await f.runtime.atomicWrite(sha(f.before),after);
  assert.equal(readback,after);
  assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),after);
  assert.equal(fs.statSync(path.join(f.root,'journal.json')).mode&0o777,0o600);
});
test('preimage mismatch makes no journal or temporary-file change',async t=>{
  const f=fixture();t.after(f.cleanup);
  await assert.rejects(()=>f.runtime.atomicWrite('a'.repeat(64),'replacement'),
    /SORI48_RUNTIME_PREIMAGE/);
  assert.equal(fs.readFileSync(path.join(f.root,'journal.json'),'utf8'),f.before);
  assert.deepEqual(fs.readdirSync(f.root).filter(name=>name.includes('.tmp')),[]);
});

test('closure lock serializes operations and is removed after success',async t=>{
  const f=fixture();t.after(f.cleanup);
  await f.runtime.withLock(async()=>{
    await assert.rejects(()=>f.runtime.withLock(async()=>{}),
      /SORI48_RUNTIME_LOCK_BUSY/);
    assert.equal(fs.statSync(path.join(f.root,'.sori48-unknown-closure.lock')).mode&0o777,0o600);
  });
  assert.equal(fs.existsSync(path.join(f.root,'.sori48-unknown-closure.lock')),false);
});

test('closure lock is removed after an operation failure',async t=>{
  const f=fixture();t.after(f.cleanup);
  await assert.rejects(()=>f.runtime.withLock(async()=>{throw Error('synthetic');}),
    /synthetic/);
  assert.equal(fs.existsSync(path.join(f.root,'.sori48-unknown-closure.lock')),false);
});

test('symlink journal is rejected without changing its target',async t=>{
  const f=fixture();t.after(f.cleanup);
  const journal=path.join(f.root,'journal.json');
  const target=path.join(f.root,'target.json');
  fs.renameSync(journal,target);fs.symlinkSync(target,journal);
  await assert.rejects(()=>f.runtime.atomicWrite(sha(f.before),'replacement'),
    /SORI48_RUNTIME_JOURNAL_FILE/);
  assert.equal(fs.readFileSync(target,'utf8'),f.before);
});
