'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'sori48_unknown_sources.js'),'utf8');
const proposal=JSON.parse(fs.readFileSync(path.join(__dirname,'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')));
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
  for(const t of proposal.observedUnwrittenTargets.targets)pages.set(t.pageId,page(t.pageId,t.heading+'\n\n'+t.oldLiteral+'\n\n## HISTORY\npreserve'));
  const githubPR={number:48,state:'open',merged:false,head_sha:head,base_sha:base};
  const checks={total_count:1,check_runs:[{head_sha:head,status:'completed',conclusion:'success'}]};
  const tools={mcp__codex_apps__notion_fetch:async({id})=>{calls.push(id);if(!pages.has(id))throw Error('missing');return pages.get(id);},
    mcp__codex_apps__github_get_pr_info:async()=>({structuredContent:githubPR}),
    mcp__codex_apps__github_fetch:async()=>({structuredContent:{content:JSON.stringify(checks)}})};
  const factory=vm.runInNewContext(source),collector=factory(tools);
  return {pages,calls,tools,collector,githubPR,checks,page,specs};
}
test('collector reads exact4-source/5-target scope and grants no apply or no-send claim',async()=>{
  const f=fixture(),r=await f.collector.collect();assert.equal(r.classification,'CLEAR_OBSERVATION_ONLY');
  assert.equal(r.targets.length,5);assert.equal(r.freshSources.original.event.version,93);
  assert.equal(f.calls.length,8);assert.equal(new Set(f.calls).size,8);
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
  ['partial CI',f=>f.checks.total_count=2],
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
