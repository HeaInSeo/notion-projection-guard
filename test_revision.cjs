'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Broker,pageData}=require('./broker.cjs');
const id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const heading='## CURRENT CENTRAL OBSERVATION · revision regression';
const edit={pageId:id,heading,oldStr:'status=`BEFORE`',newStr:'status=`AFTER`'};
function page(revision){
  const value={id,text:'<properties>\n{"title":"Test"}\n</properties>\n<content>\n'+heading+'\n'+edit.oldStr+'\n## WORKER HISTORY\npreserved\n</content>'};
  if(revision!==undefined)value.page_last_edited_at=revision;
  return {structuredContent:value};
}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-revision-'));
  const b=new Broker(dir,{productionEnabled:true,productionPages:[id],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']});
  t.after(()=>{b.close();fs.rmSync(dir,{recursive:true,force:true});});return b;
}
for(const revision of [undefined,null,'',0,{},[],false,'fresh','2026-10-20','2026-02-30T00:00:00Z',
  '2026-10-20T25:00:00Z',' 2026-10-20T00:00:00Z','2026-10-20T00:00:00Z ']){
  test('incomplete revision rejected before preflight or prepare: '+JSON.stringify(revision),t=>{
    const b=fixture(t),input=page(revision);
    const reject=fn=>assert.throws(fn,error=>error.code==='INCOMPLETE_READ');
    reject(()=>b.handle({action:'preflight',batchId:'revision',edit,page:input}));
    assert.equal(b.state.active,null);assert.deepEqual(b.state.batches,{});
    assert.deepEqual(fs.readdirSync(b.root),['broker.lock']);
    b.handle({action:'begin',batchId:'revision',edits:[edit]});
    reject(()=>b.handle({action:'prepare',batchId:'revision',page:input}));
    assert.equal(b.state.batches.revision.status,'READY');
    assert.equal(b.state.batches.revision.receipt,null);
    assert.deepEqual(fs.readdirSync(b.root).sort(),['broker.lock','journal.json']);
  });
}
test('valid native UTC revisions are preserved as exact concurrency tokens',()=>{
  for(const revision of ['2026-10-20T00:00:00Z','2026-10-20T00:00:00.1Z','2026-10-20T00:00:00.123Z'])
    assert.equal(pageData(page(revision),id).revision,revision);
});
test('missing authorize revision cannot issue a mutation or alter the prepared barrier',t=>{
  const b=fixture(t);b.handle({action:'begin',batchId:'revision',edits:[edit]});
  const valid=page('2026-10-20T00:00:00.000Z');
  const receipt=b.handle({action:'prepare',batchId:'revision',page:valid});
  const before=fs.readFileSync(b.file,'utf8');
  for(const invalid of [page(undefined),page(null),page('')])
    assert.throws(()=>b.handle({action:'authorize',batchId:'revision',ticket:receipt.ticket,page:invalid}),e=>e.code==='INCOMPLETE_READ');
  assert.equal(fs.readFileSync(b.file,'utf8'),before);
  assert.equal(b.handle({action:'authorize',batchId:'revision',ticket:receipt.ticket,page:valid}).request.command,'update_content');
});
