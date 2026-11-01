'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {probe}=require('./normal_projection_probe.cjs');
const id='SORI48-PAIR-ADMIT-20261029';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sori48-probe-')),runtime=path.join(root,'runtime');
  fs.mkdirSync(runtime,{mode:0o700});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ce='exports.validateControl=()=>({controls:{files:[]}});exports.controls=()=>{};';
  fs.writeFileSync(path.join(runtime,'case_exception.cjs'),ce,{mode:0o600});
  const state={active:null,caseExceptionControl:{exclusive:false},batches:{[id]:{status:'CLOSED_SUPERSEDED_UNKNOWN'}}};
  fs.writeFileSync(path.join(root,'journal.json'),JSON.stringify(state),{mode:0o600});
  fs.writeFileSync(path.join(root,'broker.lock'),JSON.stringify({pid:process.pid,executor:'current'}),{mode:0o600});
  const evidence={valid:true,batchId:id,status:'CLOSED_SUPERSEDED_UNKNOWN',originalOutcome:'UNKNOWN',
    cleanTermination:false,productAccepted:false,privateAuditSha256:'a'.repeat(64),
    lateObservationRequired:true,capacityReleased:false,applyAuthorized:false};
  return {root,state,evidence,options:{root,runtime,brokerPid:process.pid,batchId:'NODEKIT150-LANDED-20261028',
    caseModuleHash:crypto.createHash('sha256').update(ce).digest('hex'),inspectClosedUnknown:()=>evidence}};
}
test('validated retired UNKNOWN remains explicit and never frees capacity',t=>{
  const f=fixture(t),r=probe(f.options);assert.equal(r.retainedUnknowns.length,1);
  assert.equal(r.retainedUnknowns[0].originalOutcome,'UNKNOWN');assert.equal(r.retainedUnknowns[0].capacityReleased,false);
});
for(const [name,change] of [
  ['missing validator',f=>delete f.options.inspectClosedUnknown],
  ['unvalidated audit',f=>f.evidence.valid=false],['capacity claim',f=>f.evidence.capacityReleased=true],
  ['product acceptance',f=>f.evidence.productAccepted=true],['clean termination',f=>f.evidence.cleanTermination=true],
  ['lost obligation',f=>f.evidence.lateObservationRequired=false],['wrong case',f=>f.evidence.batchId='other']
])test('ordinary projection refuses '+name,t=>{
  const f=fixture(t);change(f);assert.throws(()=>probe(f.options));
});
