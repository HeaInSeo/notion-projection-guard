'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {createRequire}=require('node:module');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sori48-retention-')),runtime=path.join(root,'runtime');
  fs.chmodSync(root,0o700);fs.mkdirSync(runtime,{mode:0o700});
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')));
  const write=(file,obj)=>fs.writeFileSync(file,typeof obj==='string'?obj:JSON.stringify(obj),{mode:0o600});
  const prefix=sha(spec.batchId)+'-',edits=Array.from({length:8},(_,i)=>({pageId:String(i),newStr:'old'}));
  spec.planHash=sha(JSON.stringify(edits));const verifications=[];
  for(let i=0;i<3;i++){
    const s={batchId:spec.batchId,index:i,edit:edits[i],expected:'saved body',expectedHash:sha('saved body'),page:{properties:'native proof'}};
    const v={page:{body:s.expected,properties:s.page.properties},bodyHash:s.expectedHash,at:'2026-10-29T02:00:00Z'};
    write(path.join(root,prefix+i+'.json'),s);write(path.join(root,prefix+i+'.json.verified.json'),v);
    verifications.push({index:i,snapshotHash:sha(JSON.stringify(s)),verifiedHash:sha(JSON.stringify(v))});
  }
  const pending={batchId:spec.batchId,index:3,ticket:spec.ticket};spec.snapshotHash=sha(JSON.stringify(pending));
  write(path.join(root,prefix+'3.json'),pending);
  const b={status:'HALTED',next:3,planHash:spec.planHash,edits,verifications,
    receipt:{snapshot:path.join(root,prefix+'3.json'),ticket:spec.ticket,snapshotHash:spec.snapshotHash}};
  const journal={active:spec.batchId,batches:{[spec.batchId]:b}};
  const journalPath=path.join(root,'journal.json');write(journalPath,journal);spec.journalSha256=sha(fs.readFileSync(journalPath));
  const modulePath=path.join(runtime,'case_exception.cjs'),moduleBytes='synthetic pinned case module';write(modulePath,moduleBytes);
  let controlsOk=true,controlCalls=0;
  const ce={validateControl:()=>({controls:{files:Array.from({length:18},(_,i)=>({path:'control-'+i,sha256:'a'.repeat(64)}))}}),
    controls:()=>{controlCalls++;if(!controlsOk)throw Error('CONTROL_CHANGED');}};
  const source=fs.readFileSync(path.join(__dirname,'sori48_unknown_evidence.cjs'),'utf8'),m={exports:{}};
  const native=createRequire(__filename),req=id=>id==='./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json'?spec:id===modulePath?ce:native(id);
  vm.runInNewContext(source,{require:req,module:m,process});
  const collect=m.exports.createCollector({root,runtime,caseModuleHash:sha(moduleBytes)});
  return {root,journalPath,prefix,collect,b,spec,write,modulePath,ce,setControls:v=>controlsOk=v,get controlCalls(){return controlCalls;}};
}
test('fresh local collection preserves bytes and does not infer executor absence or apply permission',t=>{
  const f=fixture(t),before=fs.readFileSync(f.journalPath,'utf8'),r=f.collect();
  assert.equal(r.beforeBytes,before);assert.equal(r.verifiedReceiptCount,3);assert.equal(r.original18Verified,true);
  assert.equal(r.retentionEvidence.files.length,7);assert.equal(r.retentionEvidence.priorExecutorStatus,'NOT_ASSESSED');
  assert.equal(r.priorExecutorEvidence.status,'NOT_ASSESSED');
  assert.equal(r.priorExecutorEvidence.dispatchId,f.spec.dispatchId);
  assert.equal(r.retentionEvidence.applyAuthorized,false);assert.equal(f.controlCalls,2);
  assert.equal(fs.readFileSync(f.journalPath,'utf8'),before);
});
for(const [name,change] of [
  ['journal bytes',f=>fs.appendFileSync(f.journalPath,'\n')],
  ['missing verified receipt',f=>fs.unlinkSync(path.join(f.root,f.prefix+'1.json.verified.json'))],
  ['receipt tamper',f=>f.write(path.join(f.root,f.prefix+'0.json.verified.json'),{})],
  ['pending tamper',f=>f.write(path.join(f.root,f.prefix+'3.json'),{})],
  ['new terminal evidence',f=>f.write(path.join(f.root,f.prefix+'3.json.verified.json'),{})],
  ['case module tamper',f=>fs.appendFileSync(f.modulePath,'changed')],
  ['changed control',f=>f.setControls(false)],
  ['symlink receipt',f=>{const p=path.join(f.root,f.prefix+'0.json');fs.renameSync(p,p+'.target');fs.symlinkSync(p+'.target',p);}],
  ['public receipt',f=>fs.chmodSync(path.join(f.root,f.prefix+'0.json'),0o644)]
])test('refuses '+name+' without a journal write',t=>{
  const f=fixture(t);change(f);const before=fs.readFileSync(f.journalPath,'utf8');
  assert.throws(()=>f.collect());assert.equal(fs.readFileSync(f.journalPath,'utf8'),before);
});
test('missing original18 manifest entries cannot pass as verification',t=>{
  const f=fixture(t);f.ce.validateControl=()=>({controls:{files:[]}});
  assert.throws(()=>f.collect(),/ORIGINAL18_MANIFEST/);
});
