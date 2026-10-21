'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { verifyRuntime } = require('./verify_runtime.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npg-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceDir = path.join(dir, 'source'); fs.mkdirSync(sourceDir);
  const pins = {};
  for (const name of ['broker.cjs', 'runner.js', 'policy.json']) {
    // Executing/importing a runtime candidate would fail this test immediately.
    const bytes = 'throw new Error("must not execute runtime"); // ' + name;
    fs.writeFileSync(path.join(dir, name), bytes);
    pins[name] = hash(bytes);
    if (name !== 'policy.json') fs.writeFileSync(path.join(sourceDir, name), bytes);
  }
  fs.writeFileSync(path.join(sourceDir, 'complete_projection.js'), 'hosted entry');
  const release = { version: 1, repository: 'HeaInSeo/infra-lab', sourceCommit: '01b8a7897bc8709450f536744577313c805c66ca',
    runtimeSha256: { 'broker.cjs': pins['broker.cjs'], 'runner.js': pins['runner.js'] },
    policySha256: pins['policy.json'], hostedEntryPoint: {
      path: 'ops/notion-projection-guard/complete_projection.js', sha256: hash('hosted entry') } };
  fs.writeFileSync(path.join(dir, 'approved.sha256'), Object.entries(pins).map(([n, h]) => h + '  ' + n + '\n').join(''));
  const receiptPath = path.join(dir, 'receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify({ sourceCommit: release.sourceCommit,
    at: '2026-10-19T23:02:49.009Z', after: pins }));
  const journalPath = path.join(dir, 'journal.json');
  fs.writeFileSync(journalPath, '{"active":"unrelated-live-batch"}');
  fs.writeFileSync(path.join(dir, 'broker.lock'), 'existing worker lock');
  return { release, runtimeDir: dir, receiptPath, sourceDir };
}
test('offline verification works beside a live lock and changes no file bytes or modes', t => {
  const f = fixture(t);
  const snapshot = () => Object.fromEntries(fs.readdirSync(f.runtimeDir, { withFileTypes: true })
    .filter(e => e.isFile()).map(e => { const p = path.join(f.runtimeDir, e.name);
      return [e.name, { hash: hash(fs.readFileSync(p)), mode: fs.statSync(p).mode }]; }));
  const before = snapshot();
  assert.equal(verifyRuntime(f).status, 'MATCH');
  assert.deepEqual(snapshot(), before);
});
for (const name of ['broker.cjs', 'runner.js', 'policy.json']) {
  test('rejects changed runtime even when approved.sha256 and receipt are changed to match: ' + name, t => {
    const f = fixture(t), file = path.join(f.runtimeDir, name);
    fs.writeFileSync(file, 'different runtime');
    const manifest = path.join(f.runtimeDir, 'approved.sha256');
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(hash('throw new Error("must not execute runtime"); // ' + name), hash('different runtime')));
    const receipt = JSON.parse(fs.readFileSync(f.receiptPath)); receipt.after[name] = hash('different runtime');
    fs.writeFileSync(f.receiptPath, JSON.stringify(receipt));
    assert.throws(() => verifyRuntime(f), { code: 'RUNTIME_HASH_MISMATCH' });
  });
}
test('rejects duplicate manifest entries and stale install receipts', t => {
  const f = fixture(t), manifest = path.join(f.runtimeDir, 'approved.sha256');
  const original = fs.readFileSync(manifest, 'utf8');
  fs.writeFileSync(manifest, original.split('\n')[0] + '\n' + original.split('\n')[0] + '\n' + original.split('\n')[2] + '\n');
  assert.throws(() => verifyRuntime(f), { code: 'APPROVED_MANIFEST' });
  fs.writeFileSync(manifest, original);
  const receipt = JSON.parse(fs.readFileSync(f.receiptPath)); receipt.sourceCommit = 'b'.repeat(40);
  fs.writeFileSync(f.receiptPath, JSON.stringify(receipt));
  assert.throws(() => verifyRuntime(f), { code: 'INSTALL_RECEIPT_MISMATCH' });
});
test('rejects drift in the hosted entry source, independent of installed runtime', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.sourceDir, 'complete_projection.js'), 'other entry');
  assert.throws(() => verifyRuntime(f), { code: 'SOURCE_HASH_MISMATCH' });
});
test('CLI rejects duplicate flags and absent files with nonzero exit, without leaking file contents', t => {
  const f = fixture(t), script = path.join(__dirname, 'verify_runtime.cjs');
  const result = spawnSync(process.execPath, [script, '--release', f.receiptPath,
    '--release', f.receiptPath, '--runtime', f.runtimeDir, '--receipt', f.receiptPath], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'MISMATCH', code: 'ARGUMENTS' });
  const missing = spawnSync(process.execPath, [script, '--release', path.join(f.runtimeDir, 'absent.json'),
    '--runtime', f.runtimeDir, '--receipt', f.receiptPath], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.deepEqual(JSON.parse(missing.stdout), { status: 'MISMATCH', code: 'ENOENT' });
});
function gatedFixture(t) {
  const f = fixture(t);
  f.release.repository = 'HeaInSeo/notion-projection-guard';
  f.release.sourceCommit = 'c'.repeat(40);
  f.release.hostedEntryPoint.path = 'complete_projection.js';
  f.release.hostedSupervisionGate = {path:'supervision_gate.js',sha256:hash('reviewed pure supervision gate')};
  fs.writeFileSync(path.join(f.sourceDir,'supervision_gate.js'),'reviewed pure supervision gate');
  const receipt = JSON.parse(fs.readFileSync(f.receiptPath));receipt.sourceCommit=f.release.sourceCommit;
  fs.writeFileSync(f.receiptPath,JSON.stringify(receipt));
  return f;
}
test('declared hosted gate is read and covered in the verification result',t=>{
  const r=verifyRuntime(gatedFixture(t));
  assert.equal(r.status,'MATCH');assert.equal(r.hostedSupervisionGateChecked,true);
  assert.equal(r.legacyManifest,false);
});
for(const kind of ['stale','tampered','missing','symlink'])
  test('declared hosted gate rejects '+kind+' source independently of runtime hashes',t=>{
    const f=gatedFixture(t),file=path.join(f.sourceDir,'supervision_gate.js');
    if(kind==='missing'||kind==='symlink')fs.unlinkSync(file);
    if(kind==='symlink')fs.symlinkSync(path.join(f.sourceDir,'complete_projection.js'),file);
    if(kind==='stale')fs.writeFileSync(file,"const repositories = new Set(['nodekit','sori']);");
    if(kind==='tampered')fs.appendFileSync(file,' changed');
    assert.throws(()=>verifyRuntime(f),{code:kind==='missing'?'ENOENT':kind==='symlink'?'REGULAR_FILE_REQUIRED':'SOURCE_HASH_MISMATCH'});
  });
test('declared hosted gate cannot yield MATCH without a source directory',t=>{
  const f=gatedFixture(t);delete f.sourceDir;
  assert.throws(()=>verifyRuntime(f),{code:'SOURCE_REQUIRED'});
});
test('CLI refuses a declared gate without --source instead of returning MATCH',t=>{
  const f=gatedFixture(t),releasePath=path.join(f.runtimeDir,'release.json');
  fs.writeFileSync(releasePath,JSON.stringify(f.release));
  const r=spawnSync(process.execPath,[path.join(__dirname,'verify_runtime.cjs'),'--release',releasePath,
    '--runtime',f.runtimeDir,'--receipt',f.receiptPath],{encoding:'utf8'});
  assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stdout),{status:'MISMATCH',code:'SOURCE_REQUIRED'});
});
for(const descriptor of [null,{}, {path:'other.js',sha256:'a'.repeat(64)},
  {path:'../supervision_gate.js',sha256:'a'.repeat(64)},
  {path:'supervision_gate.js',sha256:'not-a-hash'}])
  test('declared gate schema rejects '+JSON.stringify(descriptor),t=>{
    const f=gatedFixture(t);f.release.hostedSupervisionGate=descriptor;
    assert.throws(()=>verifyRuntime(f),{code:'RELEASE_SCHEMA'});
  });
test('removing a declared gate from a new source is not a legacy manifest',t=>{
  const f=gatedFixture(t);delete f.release.hostedSupervisionGate;
  assert.throws(()=>verifyRuntime(f),{code:'HOSTED_GATE_REQUIRED'});
});
test('reviewed legacy source reports its hosted gate as not covered',t=>{
  const f=fixture(t),r=verifyRuntime(f);
  assert.equal(r.status,'MATCH');assert.equal(r.legacyManifest,true);
  assert.equal(r.hostedSupervisionGateChecked,false);
});
test('hosted gate changed after its hash read cannot pass final readback',t=>{
  const f=gatedFixture(t),gate=path.join(f.sourceDir,'supervision_gate.js');
  const manifest=path.join(f.runtimeDir,'approved.sha256'),read=fs.readFileSync;let reads=0;
  fs.readFileSync=function(file,...args){
    if(file===manifest&&++reads===2)fs.writeFileSync(gate,'changed after initial source check');
    return read.call(this,file,...args);
  };
  try{assert.throws(()=>verifyRuntime(f),{code:'CHANGED_DURING_READ'});}
  finally{fs.readFileSync=read;}
});
