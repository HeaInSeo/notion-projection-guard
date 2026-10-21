'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
// Reproduce the original halted batch with the exact pre-fix broker. Its
// reviewed source is an ancestor of main, independent of the PR branch.
const legacySource=require('node:child_process').execFileSync('git',
  ['show','7eb4ee624035b9416daf2f0fa6e2c7804ed48544:broker.cjs'],{cwd:__dirname,encoding:'utf8'});
assert.equal(require('node:crypto').createHash('sha256').update(legacySource).digest('hex'),
  '4c639747b1d0b2ad53f0b66950230d34282fe228aa38a9fbf02453afb38561b7');
const legacyModule={exports:{}};
vm.runInNewContext(legacySource,{require,module:legacyModule,__dirname,process,console});
const {Broker,hash,atomic}=legacyModule.exports;
const BATCH='NODEKIT-CLI-UF-CLAIM-POINTER-20261021T0817Z';
const IDS=['3b286e6dd1d1817aa093fca807659f07','3b286e6dd1d181f2a75cfbd3885071c4','3ed86e6dd1d18118b0b8d98bb91892fb','3b286e6dd1d1811d9308d9a2b56c9de4','3bf86e6dd1d18110938bc358e17c779e'];
const heading='## CURRENT CENTRAL OBSERVATION · synthetic';
function page(id,literal,props={title:'Synthetic'},revision='2026-10-21T08:17:00Z'){
  return {structuredContent:{id,text:'<page>\n<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n'+heading+'\n'+literal+'\n## HISTORY\nimmutable worker proof\n</content>\n</page>',page_last_edited_at:revision}};
}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nk-pointer-')),runtime=path.join(root,'runtime');fs.mkdirSync(runtime);
  const policy={productionEnabled:true,productionPages:IDS,canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']};
  const b=new Broker(root,policy);t.after(()=>{if(fs.existsSync(b.lock))b.close();fs.rmSync(root,{recursive:true,force:true});});
  const edits=IDS.map(pageId=>({pageId,heading,oldStr:'status=OLD',newStr:'status=`ACTIVE`; pair=KEEP_GATED'}));
  b.handle({action:'begin',batchId:BATCH,edits});const receipt=b.handle({action:'prepare',batchId:BATCH,page:page(IDS[0],edits[0].oldStr)});
  b.handle({action:'authorize',batchId:BATCH,ticket:receipt.ticket,page:page(IDS[0],edits[0].oldStr)});
  const raw=IDS.map((id,i)=>page(id,i?'status=OLD':'status=<code>ACTIVE</code>; pair=KEEP\\_GATED'));
  assert.throws(()=>b.handle({action:'verify',batchId:BATCH,ticket:receipt.ticket,page:raw[0]}),/Protected content/);
  const f=b.snapshot(BATCH,0),s=JSON.parse(fs.readFileSync(f)),a=JSON.parse(fs.readFileSync(f+'.actual.json'));
  fs.writeFileSync(path.join(runtime,'broker.cjs'),legacySource);fs.copyFileSync(path.join(__dirname,'runner.js'),path.join(runtime,'runner.js'));fs.writeFileSync(path.join(runtime,'policy.json'),JSON.stringify(policy));
  const pins=Object.fromEntries(['broker.cjs','runner.js','policy.json'].map(n=>[n,hash(fs.readFileSync(path.join(runtime,n),'utf8'))]));
  const at=s.page.body.indexOf(edits[0].oldStr),before=s.page.body.slice(0,at),after=s.page.body.slice(at+edits[0].oldStr.length),literal=a.page.body.slice(before.length,a.page.body.length-after.length);
  // Compile an isolated copy with synthetic incident pins. Production constants
  // stay immutable and no real page text or private journal enters the tests.
  let src=fs.readFileSync(path.join(__dirname,'reconcile_nodekit_pointer_partial.cjs'),'utf8');
  const replacements={ROOT:root,RUNTIME:runtime,PLAN:b.state.batches[BATCH].planHash,TICKET:receipt.ticket,PINS:pins,FILES:{'0.json':hash(fs.readFileSync(f,'utf8')),'0.json.actual.json':hash(fs.readFileSync(f+'.actual.json','utf8'))},LITERAL:{old:hash(edits[0].oldStr),planned:hash(edits[0].newStr),actual:hash(literal)},BODY:{expected:s.expectedHash,actual:a.actualHash,before:hash(before),after:hash(after)}};
  for(const [name,value] of Object.entries(replacements))src=src.replace(new RegExp('const '+name+'=[^\\n]+;'), 'const '+name+'='+JSON.stringify(value)+';');
  const module={exports:{}};vm.runInNewContext(src,{require:n=>n==='./broker.cjs'?legacyModule.exports:require(n),module,__dirname:runtime,process,console});
  return {b,raw,f,s,a,edits,helper:module.exports,root,runtime};
}
test('check-only is unchanged; explicit partial closure retains original progress/evidence and blocks old replay',t=>{
  const x=fixture(t),before=fs.readFileSync(x.b.file,'utf8'),snap=fs.readFileSync(x.f,'utf8'),actual=fs.readFileSync(x.f+'.actual.json','utf8');
  assert.equal(x.helper.apply(x.b,x.raw).checkOnly,true);assert.equal(fs.readFileSync(x.b.file,'utf8'),before);
  const result=x.helper.apply(x.b,x.raw,false);assert.equal(result.status,'RECONCILED_PARTIAL');assert.equal(x.b.state.active,null);
  const old=JSON.parse(before).batches[BATCH],closed=x.b.state.batches[BATCH];for(const k of Object.keys(old))if(k!=='status')assert.equal(JSON.stringify(closed[k]),JSON.stringify(old[k]));
  assert.equal(fs.readFileSync(x.f,'utf8'),snap);assert.equal(fs.readFileSync(x.f+'.actual.json','utf8'),actual);assert.equal(fs.existsSync(x.f+'.verified.json'),false);
  assert.equal(result.audit.notionWrites,0);assert.equal(result.audit.acknowledgedWrites,0);assert.equal(result.audit.pageAdvances,0);
  assert.equal(x.b.handle({action:'begin',batchId:BATCH,edits:x.edits}).status,'RECONCILED_PARTIAL');
  assert.throws(()=>x.b.handle({action:'prepare',batchId:BATCH,page:x.raw[0]}),/not current/);
  assert.throws(()=>x.helper.apply(x.b,x.raw,false));
});
for(const [label,change] of [
  ['fresh worker suffix change',x=>{x.raw[0]=page(IDS[0],'status=<code>ACTIVE</code>; pair=KEEP\\_GATED\nnew worker proof');}],
  ['fresh properties change',x=>{x.raw[0]=page(IDS[0],'status=<code>ACTIVE</code>; pair=KEEP\\_GATED',{title:'changed'});}],
  ['fresh revision change',x=>{x.raw[0]=page(IDS[0],'status=<code>ACTIVE</code>; pair=KEEP\\_GATED',{title:'Synthetic'},'2026-10-21T08:18:00Z');}],
  ['remaining already applied',x=>{x.raw[1]=page(IDS[1],x.edits[1].newStr);}],
  ['missing page',x=>x.raw.pop()],['wrong order',x=>x.raw.reverse()],
  ['additional prepared evidence',x=>fs.writeFileSync(x.b.snapshot(BATCH,1),'{}',{mode:0o600})],
  ['saved mismatch tamper',x=>fs.appendFileSync(x.f+'.actual.json',' ')],
  ['original snapshot tamper',x=>fs.appendFileSync(x.f,' ')],
  ['policy revoked',x=>{x.b.policy.productionEnabled=false;}],
  ['journal drift',x=>{const j=JSON.parse(fs.readFileSync(x.b.file));j.extra=true;atomic(x.b.file,j);}],
  ['runtime drift',x=>fs.appendFileSync(path.join(x.runtime,'runner.js'),' ')],
  ['wrong active batch',x=>{x.b.state.active='other';x.b.save();}],
  ['wrong progress',x=>{x.b.state.batches[BATCH].next=1;x.b.save();}],
  ['changed plan',x=>{x.b.state.batches[BATCH].edits[4].newStr='changed';x.b.save();}]
])test('fail closed without journal writes: '+label,t=>{const x=fixture(t);change(x);const before=fs.readFileSync(x.b.file,'utf8');assert.throws(()=>x.helper.apply(x.b,x.raw,false));assert.equal(fs.readFileSync(x.b.file,'utf8'),before);});
test('preserved audit after interrupted closure refuses a second application',t=>{const x=fixture(t);const file=path.join(x.root,hash(BATCH)+'.nodekit-pointer-partial-closure.json');fs.writeFileSync(file,'{}',{mode:0o600});const before=fs.readFileSync(x.b.file,'utf8');assert.throws(()=>x.helper.apply(x.b,x.raw,false),/Existing audit/);assert.equal(fs.readFileSync(x.b.file,'utf8'),before);});
