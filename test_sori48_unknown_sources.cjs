'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'sori48_unknown_sources.js'),'utf8');
const proposal=JSON.parse(fs.readFileSync(path.join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')));
const {CORRECTED_TEXT}=require('./sori48_pair_provider.cjs');
const p=proposal.evidenceOfSupersession,head=p.newHead,base='2fa7f5e12fa4474b194acf0d6e1a0273666642c1';
function fixture(){
  const pages=new Map(),calls=[];
  const page=(id,body,native={})=>({structuredContent:{id,page_last_edited_at:'2026-10-29T04:00:00Z',
    text:'<properties>\n'+JSON.stringify(native)+'\n</properties>\n<content>\n'+body+'\n</content>'}});
  const specs=[['3f586e6dd1d181ebb43dd7de62aa2ca4',p.writerRelease,93,'operator',head],
    ['40786e6dd1d181ec8addcd1269f9b0bb',p.childRelease,4,'operator-child',head],
    ['3f586e6dd1d181cd9f5bdcdab6290de7',p.pairPriorRelease,54,'guardrail',p.oldHead]];
  for(const [id,event_id,version,role,frozenHead] of specs){
    const event={event_id,version,role,kind:'RELEASE',lease_state:'RELEASED',repo_pr:'HeaInSeo/sori#48',
      head_or_digest:frozenHead,session_id:'session-'+role,task_id:'task-'+role,event_at_utc:'2026-10-29T03:00:00Z'};
    pages.set(id,page(id,'## OWN QUEUE EVENT (current)\n```json\nQUEUE_EVENT_V1 '+JSON.stringify(event)+'\n```',
      {'이벤트 ID':event_id,'체크포인트 버전':version,'세션 ID':event.session_id,'작업 ID':event.task_id,'저장소 식별자':frozenHead}));
  }
  // Both live guardrail_queue and dashboard serialize this replacement inline.
  const before='PR149 provider terminations remain UNKNOWN, budgets stay consumed and no third PR149 request is allowed. ';
  const after=' NodeKit CLI COMPLETE 27/156 main d63869c6, deduped; BORI user managed.';
  for(const t of proposal.observedUnwrittenTargets.targets)pages.set(t.pageId,page(t.pageId,t.heading+'\n\n'+before+t.oldLiteral+after+'\n\n## HISTORY\npreserve'));
  const prior=proposal.observedUnwrittenTargets.targets[0].plannedLiteral;
  pages.set('3f586e6dd1d181ddb9f3e7217f64bfcd',page('3f586e6dd1d181ddb9f3e7217f64bfcd',
    '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index\n\n'+prior+'\n\n## HISTORY\npreserve'));
  const githubPR={number:48,state:'open',merged:false,head_sha:head,base_sha:base};
  const required=['CodeQL','Registry Push/Pull Smoke','Run on Ubuntu','Analyze actions',
    'Analyze go','Proto regenerate-diff','Lint (Run on Ubuntu)','Actionlint'];
  const checks={total_count:required.length,check_runs:required.map((name,i)=>({id:i+1,name,head_sha:head,
    status:'completed',conclusion:'success',app:{slug:name==='CodeQL'?'github-advanced-security':'github-actions'}}))};
  const tools={mcp__codex_apps__notion_fetch:async({id})=>{calls.push(id);if(!pages.has(id))throw Error('missing');return pages.get(id);},
    mcp__codex_apps__github_get_pr_info:async()=>({structuredContent:githubPR}),
    mcp__codex_apps__github_fetch:async()=>({structuredContent:{content:JSON.stringify(checks)}})};
  const factory=vm.runInNewContext(source),collector=factory(tools);
  return {pages,calls,tools,collector,githubPR,checks,page,specs};
}
test('collector reads exact5-source/5-target scope and grants no apply or no-send claim',async()=>{
  const f=fixture(),r=await f.collector.collect();assert.equal(r.classification,'CLEAR_OBSERVATION_ONLY');
  assert.equal(r.targets.length,5);assert.equal(r.freshSources.original.event.version,93);
  assert.equal(r.freshSources.index.readOk,true);
  assert.equal(f.calls.length,9);assert.equal(new Set(f.calls).size,9);
  assert.equal(r.applyAuthorized,false);assert.equal(r.originalOutcome,'UNKNOWN');
  assert.equal(r.attributableTerminalResult,null);
});
for(const [name,change] of [
  ['missing target',f=>f.pages.delete(proposal.observedUnwrittenTargets.targets[0].pageId)],
  ['truncated target',f=>f.pages.get(proposal.observedUnwrittenTargets.targets[0].pageId).structuredContent.truncated=true],
  ['unknown blocks',f=>f.pages.get(proposal.observedUnwrittenTargets.targets[0].pageId).structuredContent.unknown_block_ids=['omitted']],
  ['unclosed body',f=>{const x=f.pages.get(f.specs[0][0]).structuredContent;x.text=x.text.replace('</content>','');}],
  ['native session mismatch',f=>{const x=f.pages.get(f.specs[0][0]).structuredContent;x.text=x.text.replace('"세션 ID":"session-operator"','"세션 ID":"other"');}],
  ['changed head',f=>f.githubPR.head_sha='f'.repeat(40)],
  ['changed base',f=>f.githubPR.base_sha='f'.repeat(40)],
  ['merged PR',f=>f.githubPR.merged=true],
  ['partial CI',f=>f.checks.total_count++],
  ['failed CI rerun',f=>f.checks.check_runs[0].conclusion='failure'],
  ['pending CI rerun',f=>{f.checks.check_runs[0].status='in_progress';f.checks.check_runs[0].conclusion=null;}],
  ['missing required job',f=>{f.checks.check_runs.pop();f.checks.total_count--;}],
  ['wrong required app',f=>f.checks.check_runs[0].app.slug='github-actions'],
  ['duplicate check identity',f=>f.checks.check_runs[1].id=f.checks.check_runs[0].id],
  ['invalid check identity',f=>f.checks.check_runs[0].id=0],
  ['wrong CI head',f=>f.checks.check_runs[0].head_sha='f'.repeat(40)]
])test(name+' remains UNKNOWN and stops affected actions',async()=>{
  const f=fixture();change(f);const r=await f.collector.collect();assert.equal(r.classification,'UNKNOWN');
  assert.equal(r.stopAffectedActions,true);assert.equal(r.freshSourcesComplete,false);
});
test('late original announcement is drift without any corrective write',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0],x=f.pages.get(t.pageId).structuredContent;
  x.text=x.text.replace(t.oldLiteral,t.plannedLiteral);const r=await f.collector.collect();
  assert.equal(r.classification,'DRIFT');assert.equal(r.targets[0].plannedLiteralCount,1);assert.equal(r.applyAuthorized,false);
});
test('Notion escaped underscores match the same central heading without rewriting evidence',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0],x=f.pages.get(t.pageId).structuredContent;
  x.text=x.text.replace(t.heading,t.heading.replaceAll('_','\\_'));
  const r=await f.collector.collect();assert.equal(r.classification,'CLEAR_OBSERVATION_ONLY');
  assert.equal(r.targets[0].raw.structuredContent.text,x.text);
});
test('different central wording promoting old head is a drift candidate',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0],x=f.pages.get(t.pageId).structuredContent;
  x.text=x.text.replace(t.oldLiteral,'Sori '+p.oldHead+' is admitted to review.');
  assert.equal((await f.collector.collect()).classification,'DRIFT');
});
test('exact approved corrected projection remains clear after the first shared write',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0],x=f.pages.get(t.pageId).structuredContent;
  x.text=x.text.replace(t.oldLiteral,CORRECTED_TEXT);const r=await f.collector.collect();
  assert.equal(r.classification,'CLEAR_OBSERVATION_ONLY');
  assert.equal(r.targets[0].staleCurrentAdmissionCandidate,false);
});
test('attributed newer projection text is not drift merely because the text changed',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0],x=f.pages.get(t.pageId).structuredContent;
  x.text=x.text.replace(t.oldLiteral,'Current projection references '+head+'; acceptance remains gated.');
  assert.equal((await f.collector.collect()).classification,'CLEAR_OBSERVATION_ONLY');
});
test('callers cannot supply raw evidence and captured reader cannot be replaced',async()=>{
  const f=fixture();await assert.rejects(()=>f.collector.collect({fake:true}),/NO_CALLER_EVIDENCE/);
  f.tools.mcp__codex_apps__notion_fetch=()=>{throw Error('replacement');};
  assert.equal((await f.collector.collect()).classification,'CLEAR_OBSERVATION_ONLY');
});

test('all five in-place corrected writes remain clear with the real inline surroundings',async()=>{
  const f=fixture();
  for(const [i,t] of proposal.observedUnwrittenTargets.targets.entries()){
    const x=f.pages.get(t.pageId).structuredContent;
    assert.equal(x.text.split(t.oldLiteral).length-1,1);
    x.text=x.text.replace(t.oldLiteral,CORRECTED_TEXT);
    const r=await f.collector.collect();
    assert.equal(r.classification,'CLEAR_OBSERVATION_ONLY','shared write '+(i+1));
    assert.equal(r.stopAffectedActions,false);
    assert.equal(r.targets.filter(y=>y.oldLiteralCount===0).length,i+1);
    assert.equal(r.originalOutcome,'UNKNOWN');assert.equal(r.applyAuthorized,false);
  }
});
for(const [name,projection] of [
  ['altered corrected text',CORRECTED_TEXT.replace('receipt3','receipt4')],
  ['duplicate corrected text',CORRECTED_TEXT+' '+CORRECTED_TEXT],
  ['corrected text plus same-paragraph late old admission',CORRECTED_TEXT+' Sori '+p.oldHead+' is admitted to review.'],
  ['corrected text plus separate-paragraph late old admission',CORRECTED_TEXT+'\n\nSori '+p.oldHead+' is admitted to review.'],
  ['corrected text plus original planned admission',CORRECTED_TEXT+' '+proposal.observedUnwrittenTargets.targets[0].plannedLiteral]
])test(name+' still stops affected actions',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0],x=f.pages.get(t.pageId).structuredContent;
  x.text=x.text.replace(t.oldLiteral,projection);const r=await f.collector.collect();
  assert.equal(r.classification,'DRIFT');assert.equal(r.stopAffectedActions,true);
  assert.equal(r.originalOutcome,'UNKNOWN');assert.equal(r.applyAuthorized,false);
});
test('exact corrected standalone paragraph remains clear',async()=>{
  const f=fixture(),t=proposal.observedUnwrittenTargets.targets[0];
  f.pages.set(t.pageId,f.page(t.pageId,t.heading+'\n\n'+CORRECTED_TEXT+'\n\n## HISTORY\npreserve'));
  assert.equal((await f.collector.collect()).classification,'CLEAR_OBSERVATION_ONLY');
});

test('each live observation rejects a failed or pending CI rerun after an initial clear observation',async()=>{
  const f=fixture();assert.equal((await f.collector.collect()).classification,'CLEAR_OBSERVATION_ONLY');
  f.checks.check_runs[0].conclusion='failure';
  assert.equal((await f.collector.collect()).stopAffectedActions,true);
  f.checks.check_runs[0].status='in_progress';f.checks.check_runs[0].conclusion=null;
  assert.equal((await f.collector.collect()).classification,'UNKNOWN');
});

test('live witness refuses failed and pending CI before any write can be admitted',async()=>{
  const f=fixture(),task='a'.repeat(32),run='synthetic-run';
  f.tools.mcp__codex_apps__automations_peek=async()=>({structuredContent:{automations:[{id:task,
    is_enabled:true,run_details:{last_run:{id:run,recorded_status:'in_progress'}}}]}});
  const owner=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'normal_live_owner.js'),'utf8'));
  const refs=[...f.pages].slice(0,4).map(([pageId,page])=>({pageId,page}));
  const witness=owner(f.tools,{centralTaskId:task,runId:run,referenceToken:'test-reference',
    batchId:proposal.batchId,references:refs,edits:[],nativeExpectations:[],sori48Closure:true,
    schedulerEvidenceSha256:'b'.repeat(64),createSori48SourceCollector:vm.runInNewContext(source)});
  await witness({batchId:proposal.batchId});
  for(const status of ['completed','in_progress']){
    f.checks.check_runs[0].status=status;f.checks.check_runs[0].conclusion=status==='completed'?'failure':null;
    await assert.rejects(()=>witness({batchId:proposal.batchId}),/NORMAL_SORI48_SOURCE_OBSERVATION/);
  }
});
