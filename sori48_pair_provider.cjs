'use strict';
const BATCH='SORI48-PAIR-ADMIT-20261029';
const TICKET='cae1d7ac-ce48-417d-ad58-5180f0315d7d';
const DISPATCH='cdbeae84-e053-4cbc-bdfe-d9dea48e3dc5';
const HEAD='b26246e4ab3870bf6f7516b08906791570b57163';
const OLD_HEAD='cf4485d9f7823775760a03813d92ab205126f6c6';
const BASE='2fa7f5e12fa4474b194acf0d6e1a0273666642c1';
const PRIOR_ADMISSION=require('./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json').observedUnwrittenTargets.targets[0].plannedLiteral;
const TARGETS=['3b286e6dd1d1817aa093fca807659f07','3b286e6dd1d181f2a75cfbd3885071c4',
  '3bf86e6dd1d18110938bc358e17c779e','3ed86e6dd1d18118b0b8d98bb91892fb',
  '3b286e6dd1d1811d9308d9a2b56c9de4'];
const OBSERVATION_ID='SORI48-PAIR-ADMIT-CORRECTED-20261030';
const SOURCE_TARGETS=[
  ['original','3f586e6dd1d181ebb43dd7de62aa2ca4','## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3'],
  ['pair','3f586e6dd1d181cd9f5bdcdab6290de7','## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED'],
  ['index','3f586e6dd1d181ddb9f3e7217f64bfcd','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index']];
const SHARED_HEADINGS=[
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue',
  '## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub',
  '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard'];
const CORRECTED_TEXT='observation-id: '+OBSERVATION_ID+'; Sori PR48 corrected head '+HEAD+' and base '+BASE+' carry parent own RELEASE93 and child own RELEASE4; four workflows succeeded. Pair RELEASE54 NOT ACCEPTED applies only to prior head '+OLD_HEAD+'. The existing pair is requested for independent affected delta review of the corrected head only; this text is not PASS, worker CLAIM, or product acceptance. Scope is P-a P-b P-c. P-d, server, Discover, production, wire, RPC, credentials, W08 and W09 remain excluded. First admission stays CLOSED SUPERSEDED UNKNOWN with next3, receipt3, provider UNKNOWN and possible late payload. No replay, resend, synthetic ACK, or worker proof change is authorized. Next is a genuine pair CLAIM, verdict and RELEASE; NOT ACCEPTED returns the same writer and PR, while PASS continues current-head Codex, finding and thread disposition, required CI and normal landing.';
const need=(ok,why)=>{if(!ok)throw Error('SORI48_PAIR_PROVIDER_'+why);};
function unwrap(raw){
  for(let i=0;i<10;i++){
    need(raw&&!raw.isError&&!raw.error,'READ_ERROR');
    if(raw.structuredContent){raw=raw.structuredContent;continue;}
    if(typeof raw.content==='string'){try{raw=JSON.parse(raw.content);continue;}catch{return raw;}}
    if(Array.isArray(raw.content)){raw=JSON.parse(raw.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));continue;}
    return raw;
  }
  throw Error('SORI48_PAIR_PROVIDER_ENVELOPE');
}
function event(source,eventId,version,role,head){
  const e=source?.event;
  need(source?.readOk===true&&e?.event_id===eventId&&e.version===version&&e.role===role&&
    e.kind==='RELEASE'&&e.lease_state==='RELEASED'&&e.repo_pr?.toLowerCase()==='heainseo/sori#48'&&
    e.head_or_digest?.includes(head),'SOURCE');
}
function body(raw,pageId){
  const p=unwrap(raw),id=p?.id?.replaceAll('-','');
  need(id===pageId&&typeof p.text==='string'&&p.truncated!==true&&!(p.unknown_block_count??0)&&
    !(p.unknown_block_ids?.length??0),'PLAN_PAGE');
  const matches=[...p.text.matchAll(/<content>\s*([\s\S]*?)\s*<\/content>/g)];
  need(matches.length===1,'PLAN_BODY');return matches[0][1];
}
function scopedLiteral(raw,pageId,heading,literal){
  const text=body(raw,pageId),lines=text.split('\n'),matches=lines.filter(l=>l.replace(/\\_/g,'_')===heading);
  need(!text.includes('observation-id: '+OBSERVATION_ID+';'),'CORRECTED_ALREADY_PRESENT');
  need(matches.length===1,'PLAN_HEADING');
  const start=text.indexOf(matches[0])+matches[0].length,end=text.indexOf('\n## ',start);
  const section=text.slice(start,end<0?undefined:end);
  need(typeof literal==='string'&&literal.length>0&&literal.length<=1024&&
    text.split(literal).length===2&&section.split(literal).length===2,'PRIOR_ADMISSION');
  return literal;
}
function priorPairVerdict(source){
  const text=body(source.raw,SOURCE_TARGETS[1][1]);
  need(/^## GUARDRAIL QUEUE EVENT \(current\)(?: ·|\n)/.test(text),'PRIOR_PAIR_VERDICT');
  const end=text.indexOf('\n## '),section=text.slice(0,end<0?undefined:end);
  const events=[...section.matchAll(/QUEUE_EVENT_V1\s+(\{[^\n]+\})/g)];
  need(events.length===1,'PRIOR_PAIR_VERDICT');
  const own=JSON.parse(events[0][1]);
  need(JSON.stringify(own)===JSON.stringify(source.event),'PRIOR_PAIR_VERDICT');
  let fence=null;
  const verdicts=section.replace(/<code>[\s\S]*?<\/code>/g,'').split('\n').filter(line=>{
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;return false;}
    return !fence;
  }).map(l=>l.replace(/<\/?(?:b|strong)>/g,'').replace(/^\*\*(.*?)\*\*/,'$1').trim())
    .filter(l=>l.startsWith('Verdict:'));
  need(verdicts.length===1&&/^Verdict:\s*NOT ACCEPTED\b/.test(verdicts[0])&&
    new RegExp('\\b'+OLD_HEAD.slice(0,8)+'(?:'+OLD_HEAD.slice(8)+')?\\b').test(verdicts[0]),'PRIOR_PAIR_VERDICT');
}
function assess(observation){
    need(observation?.schema==='SORI48_FRESH_SOURCE_OBSERVATION_V1'&&observation.batchId===BATCH&&
      observation.ticket===TICKET&&observation.dispatchId===DISPATCH&&
      observation.classification==='CLEAR_OBSERVATION_ONLY'&&observation.freshSourcesComplete===true&&
      observation.stopAffectedActions===false&&observation.applyAuthorized===false&&
      observation.attributableTerminalResult===null&&observation.originalOutcome==='UNKNOWN','OBSERVATION');
    const s=observation.freshSources;
    event(s.original,'EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z',93,'operator',HEAD);
    event(s.child,'EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z',4,'operator-child',HEAD);
    event(s.pair,'EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',54,'guardrail',OLD_HEAD);
    priorPairVerdict(s.pair);
    need(s.github?.readOk===true&&s.github.head===HEAD&&s.github.base===BASE&&s.github.checks?.readOk===true,
      'GITHUB');
    const checks=unwrap(s.github.checks.raw),runs=Array.isArray(checks.check_runs)?checks.check_runs:[];
    // Workflow totals and check-run totals differ: this frozen head has13
    // check runs. Require the complete response and every known required job.
    const requiredChecks=['CodeQL','Registry Push/Pull Smoke','Run on Ubuntu','Analyze actions',
      'Analyze go','Proto regenerate-diff','Lint (Run on Ubuntu)','Actionlint'];
    need(checks.total_count===runs.length&&runs.length>=requiredChecks.length&&
      new Set(runs.map(r=>r.id)).size===runs.length&&runs.every(r=>Number.isSafeInteger(r.id)&&r.id>0&&
        r.head_sha===HEAD&&r.status==='completed'&&r.conclusion==='success')&&
      requiredChecks.every(name=>runs.some(r=>r.name===name&&
        r.app?.slug===(name==='CodeQL'?'github-advanced-security':'github-actions'))),'CI');
    need(Array.isArray(observation.targets)&&observation.targets.length===TARGETS.length&&
      TARGETS.every((id,i)=>observation.targets[i]?.pageId===id&&observation.targets[i].readOk===true&&
        observation.targets[i].oldLiteralCount===1&&observation.targets[i].plannedLiteralCount===0&&
        observation.targets[i].staleCurrentAdmissionCandidate===false),'TARGET_BASELINE');
    return {schema:'SORI48_CORRECTED_HEAD_PAIR_ADMISSION_V1',eligible:true,applyAuthorized:false,
      batchId:BATCH,head:HEAD,base:BASE,writer:{parentRelease:93,childRelease:4},
      reviewer:{priorHead:OLD_HEAD,priorVersion:54,priorVerdict:'NOT ACCEPTED',acceptedForHead:HEAD},
      scope:['P-a','P-b','P-c'],excluded:['P-d','server','Discover','production','wire','RPC','credentials','W08','W09'],
      next:'Existing pair may take a genuine new CLAIM for independent affected-delta review.',
      preservation:{originalOutcome:'UNKNOWN',next:3,receiptCount:3,latePayloadPossible:true},
      grantsWorkerProof:false,grantsProductionApply:false};
}
function plan(observation){
  const assessment=assess(observation),s=observation.freshSources;
  need(s.index?.readOk===true&&s.index.pageId===SOURCE_TARGETS[2][1],'INDEX_SOURCE');
  const edits=SOURCE_TARGETS.map(([name,pageId,heading])=>({pageId,heading,
    oldStr:scopedLiteral(s[name].raw,pageId,heading,PRIOR_ADMISSION),newStr:CORRECTED_TEXT}));
  for(let i=0;i<TARGETS.length;i++){
    const t=observation.targets[i];
    edits.push({pageId:t.pageId,heading:SHARED_HEADINGS[i],
      oldStr:scopedLiteral(t.raw,t.pageId,SHARED_HEADINGS[i],'Sori retains its separate gates.'),newStr:CORRECTED_TEXT});
  }
  need(new Set(edits.map(e=>e.pageId)).size===8&&CORRECTED_TEXT.length<=1024&&!/[`_]/.test(CORRECTED_TEXT),'PLAN');
  return {schema:'SORI48_CORRECTED_HEAD_PAIR_PROJECTION_V1',observationId:OBSERVATION_ID,
    applyAuthorized:false,requiresCanonicalClosure:true,metadataReconciliationRequired:true,
    edits,source:assessment,preservation:assessment.preservation};
}
function validatePlan(edits){
  const expected=[...SOURCE_TARGETS.map(([,pageId,heading])=>({pageId,heading,oldStr:PRIOR_ADMISSION,newStr:CORRECTED_TEXT})),
    ...TARGETS.map((pageId,i)=>({pageId,heading:SHARED_HEADINGS[i],oldStr:'Sori retains its separate gates.',newStr:CORRECTED_TEXT}))];
  need(Array.isArray(edits)&&edits.length===expected.length&&edits.every((edit,i)=>
    Object.keys(edit).sort().join(',')==='heading,newStr,oldStr,pageId'&&
    Object.entries(expected[i]).every(([key,value])=>edit[key]===value)),'EXACT_PLAN');
  return true;
}
function createProvider(){return Object.freeze({assess,plan,validatePlan});}
module.exports={createProvider,BATCH,HEAD,OLD_HEAD,BASE,TARGETS,OBSERVATION_ID,CORRECTED_TEXT};
