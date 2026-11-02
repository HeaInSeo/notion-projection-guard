'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const actual=require('./central_migration_artifacts.cjs');
const audit='/home/heain/.local/state/notion-projection-guard/manual-audits/sori48-closure-20261029';
const config='/home/heain/.local/share/review-timeout/config.json';
function fixture(t,hook){
 // A private home-dir fixture avoids intentionally world-writable /tmp ancestry.
 const root=fs.mkdtempSync(path.join(os.homedir(),'npg-migration-files-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const v=root+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision3';fs.mkdirSync(v,{recursive:true,mode:0o700});
 const files={authorizationBytes:root+'/CENTRAL_SCHEDULER_MIGRATION_AUTHORIZATION-20261101.json',
  acceptanceBytes:v+'/CONFIG_REVIEW_ACCEPTANCE.json',cutoverBytes:v+'/CUTOVER_VERIFIED.json',configBytes:root+'/config.json'};
 const values=Object.fromEntries(Object.keys(files).map(k=>[k,JSON.stringify({synthetic:k})]));
 for(const [k,p] of Object.entries(files))fs.writeFileSync(p,values[k],{mode:0o600});
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 let a=fs.readFileSync(path.join(__dirname,'central_migration_artifacts.cjs'),'utf8');
 for(const [k,h] of Object.entries(actual.PINS))a=a.replace(h,sha(values[k]));
 const am={exports:{}};vm.runInNewContext(a,{require,module:am});
 let source=fs.readFileSync(path.join(__dirname,'central_migration_files.cjs'),'utf8').replace(audit,root).replace(config,root+'/config.json');
 const m={exports:{}};vm.runInNewContext(source,{require:id=>id==='./central_migration_artifacts.cjs'?am.exports:id==='node:fs'&&hook?hook(fs,files):require(id),module:m,process});
 return {files,root,collect:m.exports.collectPinnedConfiguration};
}
test('fixed-path collector validates bytes and returns immutable history without authority',t=>{
 const f=fixture(t),r=f.collect({configBytes:'caller override ignored'});
 assert.equal(r.grantsNothing,true);assert.equal(r.history.sourceCompatibility,false);
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.artifacts));
});
for(const kind of ['symlink','writable','changed bytes','missing','directory'])test('rejects '+kind,t=>{
 const f=fixture(t),p=f.files.configBytes;
 if(kind==='symlink'){fs.renameSync(p,p+'.real');fs.symlinkSync(p+'.real',p);}
 if(kind==='writable')fs.chmodSync(p,0o666);
 if(kind==='changed bytes')fs.appendFileSync(p,'\n');
 if(kind==='missing')fs.unlinkSync(p);
 if(kind==='directory'){fs.unlinkSync(p);fs.mkdirSync(p);}
 assert.throws(()=>f.collect());
});
test('rejects group-writable parent',t=>{
 const f=fixture(t);fs.chmodSync(f.root,0o770);assert.throws(()=>f.collect(),/DIRECTORY/);
});
test('descriptor replacement between lstat and open is rejected',t=>{
 const f=fixture(t,(native,files)=>({...native,openSync(p,...args){
  if(p===files.configBytes){native.renameSync(p,p+'.original');native.copyFileSync(p+'.original',p);}
  return native.openSync(p,...args);
 }}));assert.throws(()=>f.collect(),/OPENED/);
});
test('replacement after descriptor read is rejected',t=>{
 const f=fixture(t,(native,files)=>({...native,readFileSync(fd,...args){
  const bytes=native.readFileSync(fd,...args);
  if(typeof fd==='number'){const p=files.configBytes;native.renameSync(p,p+'.original');native.copyFileSync(p+'.original',p);}
  return bytes;
 }}));assert.throws(()=>f.collect(),/CHANGED|ENOENT/);
});
