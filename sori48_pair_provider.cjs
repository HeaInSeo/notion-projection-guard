'use strict';
const {inspectPair}=require('./sori48_unknown_sources.js');
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
const CORRECTED_TEXT="observation-id: SORI48-PAIR-ADMIT-CORRECTED-20261030; Sori PR48 head b26246e4ab3870bf6f7516b08906791570b57163 and base 2fa7f5e12fa4474b194acf0d6e1a0273666642c1. Parent RELEASE93 and child RELEASE4 are frozen. Pair current CORRECTION57 retains prior RELEASE54 on cf4485d9; v55/v56 stay UNADMITTED, not acceptance. Guardrail-role admission: existing SR-SORI-SM-W02.A-20261010, prospective F1 delta cf4485d9..b26246e4 review only; require fresh own CLAIM, verdict and RELEASE. Operator case admission grants no Guardrail role. Scope P-a P-b P-c; excluded P-d server Discover production wire RPC credentials W08 W09 and product acceptance. Original stays CLOSED SUPERSEDED UNKNOWN next3 receipt3; late payload possible. No resend replay synthetic ACK or worker proof change. NOT ACCEPTED returns same writer and PR; PASS then normal managed Codex, thread disposition, CI and landing.";
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
  need(source?.readOk===true,'SOURCE');
  let evidence;try{evidence=inspectPair(source.raw);}catch{need(false,'PRIOR_PAIR_VERDICT');}
  need(JSON.stringify(evidence.event)===JSON.stringify(source.event),'PRIOR_PAIR_VERDICT');
  return evidence;
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
    const pair=priorPairVerdict(s.pair);
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
      reviewer:{currentVersion:57,currentKind:'CHECKPOINT',priorHead:OLD_HEAD,priorVersion:54,
        priorVerdict:'NOT ACCEPTED',unadmittedVersions:[55,56],reviewAccepted:false,requestedForHead:HEAD},
      reviewAdmission:{role:'guardrail',taskId:'SR-SORI-SM-W02.A-20261010',
        pageId:'3f586e6dd1d181cd9f5bdcdab6290de7',head:HEAD,base:BASE,
        sourceEvent:pair.event.event_id,scope:'PROSPECTIVE_F1_DELTA_REVIEW',
        requiresCompletedCentralProjection:true,requiresFreshOwnClaim:true,
        consumesUnadmittedReview:false,usesOperatorCaseAdmission:false},
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
