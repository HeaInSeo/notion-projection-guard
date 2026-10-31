'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProvider,HEAD,OLD_HEAD,BASE,TARGETS,OBSERVATION_ID,CORRECTED_TEXT}=require('./sori48_pair_provider.cjs');
const prior=require('./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json').observedUnwrittenTargets.targets[0].plannedLiteral;
const headings=[
  '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3',
  '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue',
  '## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard'];
const central=(i,literal)=>headings[i].replaceAll('_','\\_')+'\n\npreserved prefix; '+literal+' preserved suffix '+'.'.repeat(1200)+'\n\n## HISTORY\npreserve';
const ev=(event_id,version,role,head)=>({readOk:true,event:{event_id,version,role,kind:'RELEASE',
  lease_state:'RELEASED',repo_pr:'HeaInSeo/sori#48',head_or_digest:'head '+head}});
const page=(id,body)=>({structuredContent:{id,page_last_edited_at:'2026-10-30T00:00:00Z',
  text:'<properties>\n{}\n</properties>\n<content>\n'+body+'\n</content>'}});
function observation(){
  const original=ev('EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z',93,'operator',HEAD);
  original.raw=page('3f586e6dd1d181ebb43dd7de62aa2ca4',central(0,prior));
  const pair=ev('EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',54,'guardrail',OLD_HEAD);
  pair.raw=page('3f586e6dd1d181cd9f5bdcdab6290de7',
    '## GUARDRAIL QUEUE EVENT (current) · RELEASE v54\n\n```json\nQUEUE_EVENT_V1 '+JSON.stringify(pair.event)+
    '\n```\n\n<b>Verdict: NOT ACCEPTED on PR48 exact cf4485d9. P0=0, P1=0, P2=1.</b> Reviewer: independent.\n\n'+central(1,prior));
  return {schema:'SORI48_FRESH_SOURCE_OBSERVATION_V1',batchId:'SORI48-PAIR-ADMIT-20261029',
    ticket:'cae1d7ac-ce48-417d-ad58-5180f0315d7d',dispatchId:'cdbeae84-e053-4cbc-bdfe-d9dea48e3dc5',
    classification:'CLEAR_OBSERVATION_ONLY',freshSourcesComplete:true,stopAffectedActions:false,
    applyAuthorized:false,attributableTerminalResult:null,originalOutcome:'UNKNOWN',
    freshSources:{original,
      child:ev('EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z',4,'operator-child',HEAD),pair,
      index:{readOk:true,pageId:'3f586e6dd1d181ddb9f3e7217f64bfcd',raw:page('3f586e6dd1d181ddb9f3e7217f64bfcd',central(2,prior))},
      github:{readOk:true,head:HEAD,base:BASE,checks:{readOk:true,raw:{structuredContent:{
        total_count:13,check_runs:['CodeQL','Registry Push/Pull Smoke','Run on Ubuntu','Analyze actions',
          'Analyze go','Proto regenerate-diff','Lint (Run on Ubuntu)','Actionlint','Run on Ubuntu',
          'Registry Push/Pull Smoke','Proto regenerate-diff','Lint (Run on Ubuntu)','Actionlint']
          .map((name,i)=>({id:i+1,name,app:{slug:name==='CodeQL'?'github-advanced-security':'github-actions'},
            head_sha:HEAD,status:'completed',conclusion:'success'}))}}}}
    },targets:TARGETS.map((pageId,i)=>({pageId,readOk:true,oldLiteralCount:1,plannedLiteralCount:0,
      staleCurrentAdmissionCandidate:false,raw:page(pageId,central(i+3,'Sori retains its separate gates.'))}))};
}
test('exact corrected-head admission is check-only and preserves UNKNOWN',()=>{
  const r=createProvider().assess(observation());
  assert.equal(r.eligible,true);assert.equal(r.applyAuthorized,false);assert.equal(r.head,HEAD);
  assert.deepEqual(r.preservation,{originalOutcome:'UNKNOWN',next:3,receiptCount:3,latePayloadPossible:true});
  assert.equal(r.grantsWorkerProof,false);assert.equal(r.grantsProductionApply,false);
});
test('provider builds one check-only corrected projection over the preserved three ACK and five unwritten targets',()=>{
  const r=createProvider().plan(observation());
  assert.equal(r.observationId,OBSERVATION_ID);assert.equal(r.applyAuthorized,false);
  assert.equal(r.requiresCanonicalClosure,true);assert.equal(r.metadataReconciliationRequired,true);
  assert.equal(r.edits.length,8);assert.equal(new Set(r.edits.map(e=>e.pageId)).size,8);
  assert.ok(r.edits.every(e=>e.newStr===CORRECTED_TEXT&&e.oldStr!==e.newStr));
  assert.deepEqual(r.preservation,{originalOutcome:'UNKNOWN',next:3,receiptCount:3,latePayloadPossible:true});
});
test('provider refuses a plan without the fresh index source',()=>{
  const o=observation();delete o.freshSources.index;assert.throws(()=>createProvider().plan(o),/INDEX_SOURCE/);
});
test('provider refuses a corrected projection already present on any target',()=>{
  const o=observation(),t=o.targets[0];t.raw=page(t.pageId,central(3,CORRECTED_TEXT));
  assert.throws(()=>createProvider().plan(o),/CORRECTED_ALREADY_PRESENT/);
});
for(const [name,change] of [
  ['head',o=>o.freshSources.github.head='0'.repeat(40)],
  ['ci',o=>o.freshSources.github.checks.raw.structuredContent.check_runs[0].conclusion='failure'],
  ['incomplete ci response',o=>o.freshSources.github.checks.raw.structuredContent.total_count=14],
  ['missing required job',o=>o.freshSources.github.checks.raw.structuredContent.check_runs[0].name='Unrelated'],
  ['duplicate check id',o=>o.freshSources.github.checks.raw.structuredContent.check_runs[1].id=1],
  ['wrong check app',o=>o.freshSources.github.checks.raw.structuredContent.check_runs[0].app.slug='other'],
  ['prior verdict',o=>o.freshSources.pair.raw.structuredContent.text='Verdict: PASS'],
  ['target drift',o=>o.targets[0].plannedLiteralCount=1],
  ['terminal result',o=>o.attributableTerminalResult={status:'SUCCEEDED'}],
  ['caller apply',o=>o.applyAuthorized=true]
])test('provider refuses '+name,()=>{const o=observation();change(o);assert.throws(()=>createProvider().assess(o));});

test('bounded edits preserve same-paragraph prefixes, long suffixes and every worker section',()=>{
  const o=observation(),p=createProvider().plan(o);
  for(const [i,e] of p.edits.entries()){
    assert.ok(e.oldStr.length<=1024);assert.ok(e.newStr.length<=1024);
    if(i<3)assert.equal(e.oldStr,prior);
    const raw=i<3?o.freshSources[['original','pair','index'][i]].raw:o.targets[i-3].raw;
    const before=raw.structuredContent.text,after=before.replace(e.oldStr,e.newStr);
    assert.ok(after.includes('preserved prefix; '+e.newStr+' preserved suffix '+'.'.repeat(1200)));
    assert.equal(after.replace(e.newStr,e.oldStr),before);
    if(i===1)assert.equal(after.slice(0,after.indexOf(headings[1].replaceAll('_','\\_'))),
      before.slice(0,before.indexOf(headings[1].replaceAll('_','\\_'))));
  }
});
for(const [name,change] of [
  ['historical verdict',p=>p.text=p.text.replace('Verdict: NOT ACCEPTED','Verdict: PASS')+'\n## HISTORY\nVerdict: NOT ACCEPTED on PR48 exact cf4485d9'],
  ['fenced verdict',p=>p.text=p.text.replace('<b>Verdict:', '```text\n<b>Verdict:').replace('</b> Reviewer: independent.','</b> Reviewer: independent.\n```')],
  ['quoted verdict',p=>p.text=p.text.replace('<b>Verdict:','> <b>Verdict:')],
  ['wrong verdict head',p=>p.text=p.text.replace('exact cf4485d9','exact b26246e4')],
  ['changed own event',p=>p.text=p.text.replace('"version":54','"version":55')]
])test('current verdict parser refuses '+name,()=>{
  const o=observation();change(o.freshSources.pair.raw.structuredContent);
  assert.throws(()=>createProvider().assess(o),/PRIOR_PAIR_VERDICT/);
});
for(const [name,change] of [
  ['literal only in history',p=>p.text=p.text.replace(prior,'missing').replace('## HISTORY','## HISTORY\n'+prior)],
  ['duplicated literal',p=>p.text=p.text.replace(prior,prior+' '+prior)],
  ['unrelated heading',p=>p.text=p.text.replace('## CURRENT · 마지막 중앙 관측','## UNRELATED')]
])test('plan refuses '+name,()=>{
  const o=observation();change(o.freshSources.original.raw.structuredContent);
  assert.throws(()=>createProvider().plan(o),/PRIOR_ADMISSION|PLAN_HEADING/);
});
