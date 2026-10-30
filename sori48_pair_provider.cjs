'use strict';
const BATCH='SORI48-PAIR-ADMIT-20261029';
const TICKET='cae1d7ac-ce48-417d-ad58-5180f0315d7d';
const DISPATCH='cdbeae84-e053-4cbc-bdfe-d9dea48e3dc5';
const HEAD='b26246e4ab3870bf6f7516b08906791570b57163';
const OLD_HEAD='cf4485d9f7823775760a03813d92ab205126f6c6';
const BASE='2fa7f5e12fa4474b194acf0d6e1a0273666642c1';
const TARGETS=['3b286e6dd1d1817aa093fca807659f07','3b286e6dd1d181f2a75cfbd3885071c4',
  '3bf86e6dd1d18110938bc358e17c779e','3ed86e6dd1d18118b0b8d98bb91892fb',
  '3b286e6dd1d1811d9308d9a2b56c9de4'];
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
function createProvider(){
  return Object.freeze({assess(observation){
    need(observation?.schema==='SORI48_FRESH_SOURCE_OBSERVATION_V1'&&observation.batchId===BATCH&&
      observation.ticket===TICKET&&observation.dispatchId===DISPATCH&&
      observation.classification==='CLEAR_OBSERVATION_ONLY'&&observation.freshSourcesComplete===true&&
      observation.stopAffectedActions===false&&observation.applyAuthorized===false&&
      observation.attributableTerminalResult===null&&observation.originalOutcome==='UNKNOWN','OBSERVATION');
    const s=observation.freshSources;
    event(s.original,'EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z',93,'operator',HEAD);
    event(s.child,'EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z',4,'operator-child',HEAD);
    event(s.pair,'EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',54,'guardrail',OLD_HEAD);
    const pair=unwrap(s.pair.raw),text=pair.text??'';
    need(/(?:^|\n)Verdict:\s*NOT ACCEPTED\b/.test(text),'PRIOR_PAIR_VERDICT');
    need(s.github?.readOk===true&&s.github.head===HEAD&&s.github.base===BASE&&s.github.checks?.readOk===true,
      'GITHUB');
    const checks=unwrap(s.github.checks.raw),runs=Array.isArray(checks.check_runs)?checks.check_runs:[];
    need(checks.total_count===4&&runs.length===4&&runs.every(r=>r.head_sha===HEAD&&
      r.status==='completed'&&r.conclusion==='success'),'CI');
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
  }});
}
module.exports={createProvider,BATCH,HEAD,OLD_HEAD,BASE,TARGETS};
