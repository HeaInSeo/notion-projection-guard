'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const {Broker,hash,pageData}=require('./broker.cjs');
test('legacy helper rejects an adjacent broker before loading unreviewed module code',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claim40-module-pin-')),sentinel=path.join(root,'executed');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'broker.cjs'),'require("fs").writeFileSync('+JSON.stringify(sentinel)+',"bad");');
 const source=fs.readFileSync(path.join(__dirname,'reconcile_claim40_superseded.cjs'),'utf8');
 assert.throws(()=>vm.runInNewContext(source,{require:createRequire(__filename),module:{exports:{}},process,Buffer,__dirname:root}),/Adjacent reviewed broker module differs/);
 assert.equal(fs.existsSync(sentinel),false);
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claim40-closure-'));fs.chmodSync(root,0o700);
 const ids=Array.from({length:8},(_,i)=>String(i+1).repeat(32)),heading='## CURRENT CENTRAL OBSERVATION · test',oldStr='central_status=WAIT',newStr='central_status=CLAIM40';
 const page=(id,value,rev='2026-10-20T23:00:00Z')=>({structuredContent:{id,page_last_edited_at:rev,text:'<properties>\n{"title":"immutable"}\n</properties>\n<content>\n'+heading+'\n'+value+'\n## WORKER\nreal own evidence\n</content>'}});
 const policy={productionEnabled:true,productionPages:ids,canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
 const b=new Broker(root,policy),batchId='SORI-TRUST-20261021-R4-CLAIM40',edits=ids.map(pageId=>({pageId,heading,oldStr,newStr}));
 b.handle({action:'begin',batchId,edits});const targets=ids.map(id=>page(id,oldStr)),prior=[];
 for(let i=0;i<3;i++){
  const r=b.handle({action:'prepare',batchId,page:targets[i]});b.handle({action:'authorize',batchId,ticket:r.ticket,page:targets[i]});
  targets[i]=page(ids[i],newStr,'2026-10-20T23:01:00Z');
  if(i<2){b.handle({action:'verify',batchId,ticket:r.ticket,page:targets[i]});const file=b.snapshot(batchId,i),s=JSON.parse(fs.readFileSync(file)),v=JSON.parse(fs.readFileSync(file+'.verified.json'));prior.push({index:i,snapshotHash:hash(JSON.stringify(s)),verifiedHash:hash(JSON.stringify(v)),verifiedAt:v.at});}
 }
 b.handle({action:'halt',batchId,reason:'REVISION_READ_ERROR'});delete b.state.batches[batchId].haltedFrom;b.save();
 b.state.batches.unrelated={status:'COMPLETED',immutable:'retained'};b.save();
 const sources=['9'.repeat(32),'a'.repeat(32)].map(id=>page(id,'frozen RELEASE41 / PASS26'));
 const sourcePins=sources.map((raw,i)=>{const p=pageData(raw,raw.structuredContent.id);return {id:raw.structuredContent.id,bodyHash:hash(p.body),propertiesHash:hash(p.properties),revision:p.revision};});
 const batch=b.state.batches[batchId],reviewed={batchId,planHash:batch.planHash,snapshotHash:batch.receipt.snapshotHash,error:batch.error,next:2,targets:ids,sources:sourcePins,prior};
 const runtime=path.join(root,'runtime');fs.mkdirSync(runtime);const pins={};
 for(const n of ['broker.cjs','runner.js','policy.json']){fs.writeFileSync(path.join(runtime,n),n);pins[n]=hash(n);}
 let source=fs.readFileSync(path.join(__dirname,'reconcile_claim40_superseded.cjs'),'utf8');
 for(const [key,value] of [['ROOT',root],['RUNTIME',runtime],['REVIEWED',reviewed],['PINS',pins]]){
  const re=new RegExp('^const '+key+'=.*;$','m');assert.equal((source.match(re)||[]).length,1);
  source=source.replace(re,'const '+key+'='+JSON.stringify(value)+';');
 }
 const mod={exports:{}};vm.runInNewContext(source,{require:createRequire(__filename),module:mod,process,Buffer,__dirname}, {filename:'synthetic-reviewed-closure.cjs'});
 t.after(()=>{if(fs.existsSync(path.join(root,'broker.lock')))b.close();fs.rmSync(root,{recursive:true,force:true});});
 return {b,root,input:{targets,sources},helper:mod.exports,batchId};
}
test('reviewed legacy closure preserves unknown authorization, pending ticket, next and all other batches',t=>{
 const {b,input,helper,batchId}=fixture(t),before=fs.readFileSync(b.file,'utf8'),original=JSON.parse(before).batches[batchId];
 const check=helper.applyClosure(b,input,true);assert.equal(check.audit.acknowledgedWrites,0);assert.equal(fs.readFileSync(b.file,'utf8'),before);
 const result=helper.applyClosure(b,input,false),after=JSON.parse(fs.readFileSync(b.file));
 assert.equal(result.status,'ABORTED_SUPERSEDED');assert.equal(after.active,null);assert.equal(after.batches[batchId].next,2);
 assert.equal(JSON.stringify(after.batches[batchId].receipt),JSON.stringify(original.receipt));assert.equal(after.batches[batchId].error,original.error);
 assert.equal(after.batches[batchId].planHash,original.planHash);assert.equal(JSON.stringify(after.batches.unrelated),JSON.stringify(JSON.parse(before).batches.unrelated));
 assert.equal(result.audit.notionWrites,0);assert.equal(result.audit.pageAdvances,0);assert.equal(result.audit.originalAuthorization,'UNKNOWN');
 assert.throws(()=>helper.applyClosure(b,input,false),/Exact legacy batch/);
});
for(const kind of ['prior time','pending body','source body','source props','later output','missing target','policy','journal drift','authorization known'])test('legacy closure refuses '+kind,t=>{
 const {b,input,helper,batchId}=fixture(t);
 if(kind==='prior time'){const file=b.snapshot(batchId,0)+'.verified.json',v=JSON.parse(fs.readFileSync(file));delete v.at;fs.writeFileSync(file,JSON.stringify(v));}
 if(kind==='pending body')input.targets[2].structuredContent.text=input.targets[2].structuredContent.text.replace('real own evidence','real own evidence plus worker change');
 if(kind==='source body')input.sources[0].structuredContent.text=input.sources[0].structuredContent.text.replace('real own evidence','real own evidence plus later CLAIM');
 if(kind==='source props')input.sources[1].structuredContent.text=input.sources[1].structuredContent.text.replace('immutable','new worker');
 if(kind==='later output')input.targets[3].structuredContent.text=input.targets[3].structuredContent.text.replace('central_status=WAIT','central_status=CLAIM40');
 if(kind==='missing target')input.targets.pop();
 if(kind==='policy')b.policy.productionEnabled=false;
 if(kind==='journal drift'){const d=JSON.parse(fs.readFileSync(b.file));d.extra='outside lock';fs.writeFileSync(b.file,JSON.stringify(d));}
 if(kind==='authorization known'){b.state.batches[batchId].haltedFrom='WRITE_PENDING';b.save();}
 const before=fs.readFileSync(b.file,'utf8');assert.throws(()=>helper.applyClosure(b,input,false));
 assert.equal(fs.readFileSync(b.file,'utf8'),before);assert.equal(b.state.active,batchId);
});
