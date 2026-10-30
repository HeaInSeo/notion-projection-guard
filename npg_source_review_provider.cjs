'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const BATCH='NPG24-SORI48-SOURCE-REVIEW-ADMISSION';
const REVIEW_ROW='40786e6dd1d1818086faf517ccee6238';
const REPO='HeaInSeo/notion-projection-guard',PR=24;
const PRIOR_EVENT='EVT-GR-NPG23-D1-DELTA-REVIEW-RELEASE-20261029T111345Z';
const PRIOR_TASK='GR-NPG-NORMAL-FRESHNESS-20261028';
const copy=x=>JSON.parse(JSON.stringify(x));
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:stable(x)).digest('hex');
const need=(v,k)=>{if(!v)throw Error('NPG_SOURCE_REVIEW_'+k);};
function unwrap(raw){for(let i=0;i<10;i++){
  need(raw&&!raw.isError&&!raw.error,'READ');
  if(raw.structuredContent){raw=raw.structuredContent;continue;}
  if(Array.isArray(raw.content)){raw=JSON.parse(raw.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));continue;}
  return raw;
}throw Error('NPG_SOURCE_REVIEW_ENVELOPE');}
function page(raw,requireClosed=false){raw=unwrap(raw);const text=raw.text,meta=raw.metadata??{};
  need(raw.id?.replaceAll('-','')===REVIEW_ROW&&typeof text==='string'&&
    Number.isFinite(Date.parse(raw.page_last_edited_at))&&raw.truncated!==true&&meta.truncated!==true&&
    !(raw.unknown_block_count??0)&&!(meta.unknown_block_count??0)&&
    !(raw.unknown_block_ids?.length??0)&&!(meta.unknown_block_ids?.length??0),'PAGE');
  const bodies=[...text.matchAll(/<content>\n([\s\S]*?)\n<\/content>/g)];
  const props=[...text.matchAll(/<properties>\n([\s\S]*?)\n<\/properties>/g)];
  need(bodies.length===1&&props.length===1,'COMPLETE_PAGE');
  const body=bodies[0][1],properties=JSON.parse(props[0][1]);
  const matches=[...body.matchAll(/QUEUE_EVENT_V1\s+(\{[^\n]+\})/g)].map(m=>JSON.parse(m[1]));
  const prior=matches.filter(e=>e.event_id===PRIOR_EVENT);
  need(prior.length===1&&prior[0].task_id===PRIOR_TASK&&prior[0].version===22&&
    prior[0].role==='guardrail'&&prior[0].kind==='RELEASE'&&prior[0].lease_state==='RELEASED'&&
    properties['이벤트 ID']===PRIOR_EVENT&&properties['체크포인트 버전']===22&&
    properties['작업 ID']===PRIOR_TASK&&(!requireClosed||(properties['작업 상태']==='종료'&&
    properties['다음 담당자']==='없음'&&properties['큐 구획']==='완료 이력')),'PR23_HISTORY');
  return {body,properties,revision:raw.page_last_edited_at};
}
function github(raw,head,base){const p=unwrap(raw);
  need((p.number??p.pr_number)===PR&&(p.state??'open')==='open'&&p.merged!==true&&
    (p.head_sha??p.head?.sha)===head&&(p.base_sha??p.base?.sha)===base,'GITHUB_PR');
}
function checks(raw,head){const c=unwrap(raw),runs=Array.isArray(c.check_runs)?c.check_runs:[];
  need(c.total_count===runs.length&&runs.length>=4&&new Set(runs.map(r=>r.id)).size===runs.length&&
    runs.every(r=>r.head_sha===head&&r.status==='completed'&&r.conclusion==='success'),'GITHUB_CI');
}
function assess(input){need(input?.schema==='NPG_SOURCE_REVIEW_OBSERVATION_V1'&&
    /^[a-f0-9]{40}$/.test(input.head??'')&&/^[a-f0-9]{40}$/.test(input.base??'')&&
    input.repository===REPO&&input.pr===PR&&input.applyAuthorized===false,'OBSERVATION');
  github(input.github,input.head,input.base);checks(input.checks,input.head);page(input.reviewRow,true);
  need(input.sourceOwnerState==='RELEASED'&&input.canonical?.active===null&&
    input.canonical?.journalSha256==='0699a8ae84284cf96632fa47cd4fa4f10d51f32c5136b9229a2ae22bbf729c4f','GATES');
  return {schema:'NPG_SOURCE_REVIEW_ADMISSION_V1',eligible:true,applyAuthorized:false,
    repository:REPO,pr:PR,head:input.head,base:input.base,reviewRow:REVIEW_ROW,
    phase:'PR24-sori48-approved-unknown-closure-source-review',
    priorHistory:{eventId:PRIOR_EVENT,version:22,preserved:true},
    grantsWorkerProof:false,grantsReviewVerdict:false,grantsMerge:false,grantsInstallation:false};
}
function patch(a,at){return {'작업 상태':'실행재개','다음 담당자':'가드레일 에이전트','큐 구획':'현재',
  '차단 대상':'','재개 지시':'Distinct PR24 source review phase for exact head '+a.head+
    '. Fresh independent CLAIM, verdict and RELEASE required; PR23 RELEASE22 remains completed history.',
  '큐 정리 근거':'observation-id: NPG24-SORI48-SOURCE-REVIEW; exact PR24 head '+a.head+
    '; source owner RELEASED and exact-head CI green. This is REQUESTED only, not worker proof or PASS.',
  '저장소 식별자':REPO+' PR24 '+a.head,
  'date:큐 정리 시각:start':at,'date:큐 정리 시각:is_datetime':1};}
function validatePlan(p){
  need(p?.schema==='NPG_SOURCE_REVIEW_ADMISSION_V1'&&p.batchId===BATCH&&p.repository===REPO&&p.pr===PR&&
    /^[a-f0-9]{40}$/.test(p.head??'')&&/^[a-f0-9]{40}$/.test(p.base??'')&&p.reviewRow===REVIEW_ROW&&
    p.applyAuthorized===false&&p.grantsWorkerProof===false&&p.grantsReviewVerdict===false&&
    p.grantsMerge===false&&p.grantsInstallation===false&&p.priorHistory?.eventId===PRIOR_EVENT&&
    p.priorHistory.version===22&&p.priorHistory.preserved===true,'PLAN');
  const at=p.patch?.['date:큐 정리 시각:start'],expected=patch(p,at);
  need(Number.isFinite(Date.parse(at))&&stable(p.patch)===stable(expected)&&stable(p.request)===stable({
    page_id:REVIEW_ROW,command:'update_properties',allow_async:false,properties:expected}),'EXACT_PLAN');
  return true;
}
function createProvider(){return Object.freeze({assess,validatePlan,plan(input){const a=assess(input),at=input.observedAt;
  need(Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.now(),'TIME');
  const p={...a,batchId:BATCH,patch:patch(a,at),request:{page_id:REVIEW_ROW,command:'update_properties',
    allow_async:false,properties:patch(a,at)}};validatePlan(p);return p;}});}
function createExecutor({broker,providerPlan}){
  need(broker&&typeof broker.assertLock==='function'&&typeof broker.ownerProof==='function'&&
    typeof broker.save==='function'&&validatePlan(providerPlan),'TRUSTED_RUNTIME');
  const request=copy(providerPlan.request),planHash=sha(request);
  function guard(proof){broker.assertLock();need(stable(JSON.parse(fs.readFileSync(broker.file,'utf8')))===
    stable(broker.state),'MEMORY_DISK');need(proof?.scope===BATCH,'OWNER_SCOPE');broker.ownerProof(proof);}
  function save(change){const next=copy(broker.state);change(next);broker.state=next;try{broker.save();}
    catch(error){broker.state=JSON.parse(fs.readFileSync(broker.file,'utf8'));throw error;}}
  function record(){const r=broker.state.batches[BATCH];need(r?.kind==='NPG_SOURCE_REVIEW_NATIVE_V1'&&
    r.planHash===planHash&&stable(r.request)===stable(request),'RECORD');return r;}
  function live(raw,r,applied){const p=page(raw),expected={...r.snapshot.properties,...(applied?r.patch:{})};
    need(p.body===r.snapshot.body&&stable(p.properties)===stable(expected),'SOURCE_DRIFT');return p;}
  return Object.freeze({begin({ownerProof,row}){guard(ownerProof);
    if(broker.state.batches[BATCH])return this.status();need(broker.state.active===null,'ACTIVE');
    const snapshot=page(row,true);save(s=>{s.active=BATCH;s.batches[BATCH]={kind:'NPG_SOURCE_REVIEW_NATIVE_V1',
      status:'READY',request,patch:copy(providerPlan.patch),snapshot,planHash,attempt:null,receipt:null};});
    return this.status();},
  dispatch({ownerProof,row}){guard(ownerProof);const r=record();need(r.status==='READY','READY');live(row,r,false);
    const attempt={ticket:crypto.randomUUID(),dispatchId:crypto.randomUUID(),executor:broker.executor,
      phase:'SEND_INTENT',owner:copy(ownerProof),requestHash:sha(request)};
    save(s=>{const n=s.batches[BATCH];n.attempt=attempt;n.status='SEND_INTENT';});return {...copy(attempt),planHash,request};},
  confirm(input){guard(input.ownerProof);const r=record();live(input.row,r,false);
    need(r.status==='SEND_INTENT'&&input.ticket===r.attempt.ticket&&input.dispatchId===r.attempt.dispatchId&&
      input.executor===broker.executor,'ATTEMPT');
    const now=Date.now(),permit={dispatchId:r.attempt.dispatchId,executor:broker.executor,pageId:REVIEW_ROW,
      observedAt:input.ownerProof.observedAt,validUntil:new Date(Math.min(now+15000,Date.parse(input.ownerProof.validUntil))).toISOString()};
    save(s=>{s.batches[BATCH].status='WRITE_PENDING';s.batches[BATCH].attempt.permit=permit;});return {status:'WRITE_PENDING',permit};},
  acknowledge(input){guard(input.ownerProof);const r=record();need(r.status==='WRITE_PENDING'&&
      input.provider?.status==='SUCCEEDED'&&input.provider.pageId===REVIEW_ROW,'PROVIDER');
    save(s=>{s.batches[BATCH].status='ACKED';s.batches[BATCH].attempt.provider=copy(input.provider);});return this.status();},
  verify({ownerProof,row}){guard(ownerProof);const r=record();need(r.status==='ACKED','ACK_REQUIRED');const p=live(row,r,true);
    const receipt={pageId:REVIEW_ROW,requestHash:r.attempt.requestHash,dispatchId:r.attempt.dispatchId,
      verifiedHash:sha(p),provider:copy(r.attempt.provider)};
    save(s=>{const n=s.batches[BATCH];n.status='COMPLETED';n.receipt=receipt;s.active=null;});return this.status();},
  status(){broker.assertLock();const r=record();return {batchId:BATCH,status:r.status,planHash,
    receipt:copy(r.receipt),requestedOnly:true,workerProofChanged:false,priorHistoryPreserved:true};}});
}
module.exports={createProvider,createExecutor,validatePlan,BATCH,REVIEW_ROW,REPO,PR,PRIOR_EVENT,PRIOR_TASK};