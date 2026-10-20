'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {Broker,pageData,plan}=require('./broker.cjs');
const A='a'.repeat(32),heading='## CURRENT CENTRAL OBSERVATION · operator_queue';
const exportedHeading=heading.replaceAll('_','\\_');
const oldStr='observation\\_id=<code>OLD-1</code>; state=<code>WAIT</code>';
const newStr='observation-id: NEW-1; state: REQUESTED';
const proof='## WORKER HISTORY\n```json\n{"QUEUE_EVENT_V1":true,"event_id":"real","session_id":"own","lease_state":"RELEASED"}\n```\n<page url="https://notion.so/'+A+'">Child</page>';
const body=(literal=oldStr)=>'historical <code>literal `tick`</code>\n'+exportedHeading+'\n'+literal+'\n'+proof;
const edit=(changes={})=>({pageId:A,heading,oldStr,newStr,...changes});
function page(content=body(),props={title:'Test','이벤트 ID':'real'},revision='2026-10-20T00:00:00Z'){
  return {structuredContent:{id:A,text:'<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n'+content+'\n</content>',page_last_edited_at:revision}};
}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-serialized-'));
  const b=new Broker(dir,{productionEnabled:true,productionPages:[A],canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION']});
  t.after(()=>{b.close();fs.rmSync(dir,{recursive:true,force:true});});return b;
}
function preflight(b,e=edit(),p=page()){
  return b.handle({action:'preflight',batchId:'format',edit:e,page:p});
}
function prepared(b,e=edit(),p=page()){
  b.handle({action:'begin',batchId:'format',edits:[e]});
  return b.handle({action:'prepare',batchId:'format',page:p});
}
function authorize(b,r,p=page()){
  return b.handle({action:'authorize',batchId:'format',ticket:r.ticket,page:p});
}
const reject=(code,fn)=>assert.throws(fn,e=>e.code===code);

test('serialized code and escaped heading pass preflight without registering a batch',t=>{
  const b=fixture(t);assert.equal(preflight(b).status,'SAFE_LITERAL');
  assert.equal(b.state.active,null);assert.deepEqual(b.state.batches,{});
  assert.deepEqual(fs.readdirSync(b.root),['broker.lock']);
});
test('serialized replacement preserves exact exported heading, history and worker properties',t=>{
  const b=fixture(t),r=prepared(b),request=authorize(b,r).request;
  assert.deepEqual(request.content_updates,[{old_str:oldStr,new_str:newStr,replace_all_matches:false}]);
  const verified=b.handle({action:'verify',batchId:'format',ticket:r.ticket,page:page(body(newStr))});
  assert.equal(verified.status,'COMPLETED');assert.equal(verified.protectedContent,'UNCHANGED');
  const result=plan(pageData(page(),A),edit());
  assert.equal(result.expected,body(newStr));assert.ok(result.expected.endsWith(proof));
});
test('underscore heading compatibility also works with the original Markdown literal format',t=>{
  const b=fixture(t),e=edit({oldStr:'status=`OLD`',newStr:'status=`NEW`'});
  assert.equal(preflight(b,e,page(body(e.oldStr))).status,'SAFE_LITERAL');
});
for(const selection of ['WAIT','state=<code>WAIT</code>','OLD-1</code>; state=<code>WAIT</code>']){
  test('selection must not cut a serialized code field: '+selection,t=>{
    const b=fixture(t),e=edit({oldStr:selection,newStr:'ready'});
    if(selection==='state=<code>WAIT</code>')assert.equal(preflight(b,e).status,'SAFE_LITERAL');
    else reject('INLINE_CODE_BOUNDARY',()=>preflight(b,e));
    assert.equal(b.state.active,null);
  });
}
for(const literal of ['status=<code>WAIT','status=WAIT</code>','status=<CODE>WAIT</CODE>',
  'status=<code class="x">WAIT</code>','status=<code>one<code>two</code></code>',
  'status=<code>one</CODE></code>'])test('malformed serialized code is refused: '+literal,t=>{
    const b=fixture(t);reject('INLINE_CODE_BOUNDARY',()=>preflight(b,edit({oldStr:literal}),page(body(literal))));
    assert.equal(b.state.active,null);
  });
for(const literal of ['status=<code><page>child</page></code>','status=<code><b>bold</b></code>',
  'status=<code>QUEUE_EVENT_V1</code>','status=<page>child</page>'])
  test('serialized code cannot mask native or worker syntax: '+literal,t=>{
    const b=fixture(t);reject('PROTECTED_SYNTAX',()=>preflight(b,edit({oldStr:literal}),page(body(literal))));
  });
for(const replacement of ['status=<code>NEW</code>','status=<b>NEW</b>','status=QUEUE_EVENT_V1'])
  test('new text still cannot introduce HTML or worker syntax: '+replacement,t=>{
    reject('PROTECTED_SYNTAX',()=>preflight(fixture(t),edit({newStr:replacement})));
  });
test('an ASCII token inside a serialized code field cannot be used to bypass boundaries',t=>{
  reject('INLINE_CODE_BOUNDARY',()=>preflight(fixture(t),edit({oldStr:'OLD-1',newStr:'NEW-1'})));
});
test('an escaped alias plus the canonical heading is ambiguous',t=>{
  reject('AMBIGUOUS_SECTION',()=>preflight(fixture(t),edit(),page(heading+'\nother\n'+body())));
});
test('escaped worker or unapproved headings gain no editing permission',t=>{
  reject('OWNERSHIP',()=>preflight(fixture(t),edit({heading:'## WORKER HISTORY'})));
});
test('a central heading inside multiline serialized code grants no ownership',t=>{
  const content='<code>historical\n'+exportedHeading+'\n'+oldStr.replaceAll('<code>','').replaceAll('</code>','')+'\n</code>\n'+proof;
  reject('AMBIGUOUS_SECTION',()=>preflight(fixture(t),edit({oldStr:'WAIT',newStr:'READY'}),page(content)));
});
test('a fake peer heading or fence inside serialized code does not shorten the owned range',t=>{
  const content=exportedHeading+'\n<code>example\n## FAKE PEER\n```\n</code>\n'+oldStr+'\n'+proof;
  // The existing conservative section policy still refuses the fenced content.
  reject('PROTECTED_SECTION',()=>preflight(fixture(t),edit(),page(content)));
});
test('a fake peer heading inside serialized code does not authorize an inner selection',t=>{
  const content=exportedHeading+'\n<code>example\n## FAKE PEER\nWAIT\n</code>\n'+proof;
  reject('INLINE_CODE_BOUNDARY',()=>preflight(fixture(t),edit({oldStr:'WAIT',newStr:'READY'}),page(content)));
});
for(const change of ['body','properties','revision'])test('fresh authorization still rejects concurrent '+change,t=>{
  const b=fixture(t),r=prepared(b),p=change==='body'?page(body()+'\nnew history'):
    change==='properties'?page(body(),{title:'Changed','이벤트 ID':'real'}):page(body(),undefined,'2026-10-20T00:01:00Z');
  reject('CONCURRENT_CHANGE',()=>authorize(b,r,p));
  assert.equal(b.state.batches.format.status,'PREPARED');
});
for(const change of ['heading escape','worker suffix','worker property','code serialization'])
  test('exact verification still halts on '+change,t=>{
    const b=fixture(t),r=prepared(b);authorize(b,r);
    let content=body(newStr),props={title:'Test','이벤트 ID':'real'};
    if(change==='heading escape')content=content.replace(exportedHeading,heading);
    if(change==='worker suffix')content+='\nnew own release';
    if(change==='worker property')props['이벤트 ID']='new';
    if(change==='code serialization')content=content.replace('<code>literal `tick`</code>','`literal tick`');
    reject('READBACK_MISMATCH',()=>b.handle({action:'verify',batchId:'format',ticket:r.ticket,page:page(content,props)}));
    assert.equal(b.state.batches.format.status,'HALTED');assert.equal(b.state.batches.format.next,0);
    reject('UNRESOLVED_BATCH',()=>b.handle({action:'begin',batchId:'later',edits:[edit()]}));
  });

const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'complete_projection.js'),'utf8'));
const shared=[
  ['3b286e6dd1d1817aa093fca807659f07','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue'],
  ['3b286e6dd1d181f2a75cfbd3885071c4','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue'],
  ['3bf86e6dd1d18110938bc358e17c779e','## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING'],
  ['3ed86e6dd1d18118b0b8d98bb91892fb','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub'],
  ['3b286e6dd1d1811d9308d9a2b56c9de4','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard']];
const native={nodekit:['3f386e6dd1d18110bf66c5204284ed46','3f386e6dd1d181b5b467e20fafa69365'],
  sori:['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7']};
const bodies={nodekit:[['3f086e6dd1d1818e9aecdc093a08cda9','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · nodekit_index']],
  sori:[[native.sori[0],'## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3'],
    [native.sori[1],'## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED'],
    ['3f586e6dd1d181ddb9f3e7217f64bfcd','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index']]};
function projection(repositories=['sori']){
  const nativeIds=repositories.flatMap(r=>native[r]),targets=repositories.flatMap(r=>bodies[r]).concat(shared);
  const properties={'작업 상태':'검증대기','다음 담당자':'설계 에이전트','큐 구획':'조건 대기',
    '차단 대상':'design review','재개 지시':'existing D01 follow-up','큐 정리 근거':'observation_id=`PLAIN-TEST-1`; source'};
  const bundle={observationId:'PLAIN-TEST-1',bodyMarkerStyle:'plain-v1',repositories,
    native:nativeIds.map(pageId=>({pageId,properties:{...properties}})),
    edits:targets.map(([pageId,heading])=>({pageId,heading,oldStr:'previous: '+pageId,newStr:'observation-id: PLAIN-TEST-1; next: '+pageId}))};
  const pages=new Map([...new Set([...nativeIds,...targets.map(([id])=>id)])].map(id=>[id,{
    body:(targets.find(([target])=>target===id)?.[1]??'## Native')+'\nprevious: '+id+'\n'+proof,
    props:{...properties,'이벤트 ID':'genuine-release'},revision:'2026-10-20T00:00:00Z'}]));
  let reads=0,calls=0;
  const tools={async mcp__codex_apps__notion_fetch({id}){
    reads++;const p=pages.get(id);return {structuredContent:{id,text:'<properties>\n'+JSON.stringify(p.props)+
      '\n</properties>\n<content>\n'+p.body+'\n</content>',page_last_edited_at:p.revision}};
  }};
  const config={createRunner(){return {async run(id,edits){calls++;
    for(const e of edits)pages.get(e.pageId).body=pages.get(e.pageId).body.replace(e.oldStr,e.newStr);
    return {status:'COMPLETED'};
  }};}};
  return {bundle,pages,client:factory(tools,config),get calls(){return calls;},get reads(){return reads;}};
}
for(const repos of [['nodekit'],['sori'],['nodekit','sori']])test('plain identity requires full mandatory native and body readback: '+repos,async()=>{
  const f=projection(repos),r=await f.client.run(f.bundle);
  assert.equal(r.bodyTargets,repos.length===2?9:repos[0]==='sori'?8:6);
  assert.equal(r.nativeTargets,repos.length*2);assert.equal(r.protectedContent,'UNCHANGED');assert.equal(f.calls,1);
  for(const p of f.pages.values())assert.equal(p.props['이벤트 ID'],'genuine-release');
});
for(const [name,mutate] of [
  ['unknown style',b=>{b.bodyMarkerStyle='normalize-v1';}],
  ['underscore in plain identity',b=>{b.observationId='PLAIN_TEST_1';}],
  ['legacy marker in plain body',b=>{b.edits[0].newStr='observation_id=`PLAIN-TEST-1`; next';}],
  ['plain marker in legacy body',b=>{delete b.bodyMarkerStyle;}],
  ['mixed duplicate identity',b=>{b.edits[0].newStr+='; observation_id=`STALE`';}],
  ['plain duplicate identity',b=>{b.edits[0].newStr+='; observation-id: STALE';}],
  ['plain identity in native metadata',b=>{b.native[0].properties['큐 정리 근거']='observation-id: PLAIN-TEST-1; next';}],
  ['mixed metadata duplicate',b=>{b.native[0].properties['큐 정리 근거']+='; observation-id: STALE';}],
  ['missing mandatory body',b=>{b.edits.pop();}],
  ['missing mandatory native',b=>{b.native.pop();}]
])test('invalid plain manifest rejects before reads or writes: '+name,async()=>{
  const f=projection();mutate(f.bundle);await assert.rejects(f.client.run(f.bundle));
  assert.equal(f.calls,0);assert.equal(f.reads,0);
});
