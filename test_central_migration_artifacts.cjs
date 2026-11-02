'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const actual=require('./central_migration_artifacts.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
  // Synthetic pin substitution isolates byte validation; fixtures grant no
  // production authority and never claim real cutover/source installation.
  const input=Object.fromEntries(Object.keys(actual.PINS).map(k=>[k,JSON.stringify({synthetic:k})]));
  let source=fs.readFileSync(path.join(__dirname,'central_migration_artifacts.cjs'),'utf8');
  for(const [k,h] of Object.entries(actual.PINS))source=source.replace(h,sha(input[k]));
  const module={exports:{}};vm.runInNewContext(source,{require,module});
  return {input,inspect:module.exports.inspectConfigurationBytes};
}
test('pinned configuration history grants no current run or source authority',()=>{
  const {input,inspect}=fixture(),r=inspect(input);
  assert.equal(r.oldActor,actual.OLD_ACTOR);assert.equal(r.newActor,actual.NEW_ACTOR);
  assert.equal(r.grantsNothing,true);assert.equal(r.currentOwnershipVerified,false);
  assert.equal(r.sourceCompatibility,false);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.pins));
});
for(const key of Object.keys(actual.PINS)){
 test('changed exact bytes rejected even with caller expected hash: '+key,()=>{
  const {input,inspect}=fixture();input[key]+='\n';input.expectedHashes={[key]:sha(input[key])};input.migration=true;
  assert.throws(()=>inspect(input),new RegExp('CENTRAL_MIGRATION_ARTIFACT_'+key));
 });
 test('missing artifact rejected: '+key,()=>{
  const {input,inspect}=fixture();delete input[key];assert.throws(()=>inspect(input),/CENTRAL_MIGRATION_ARTIFACT_/);
 });
}
test('self-declared migration cannot substitute for pinned historical bytes',()=>{
 assert.throws(()=>actual.inspectConfigurationBytes({migration:true,accepted:true}),/CENTRAL_MIGRATION_ARTIFACT_/);
 assert.throws(()=>actual.inspectConfigurationBytes(null),/CENTRAL_MIGRATION_ARTIFACT_/);
});
