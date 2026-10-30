'use strict';
// Exact-case native transaction. The existing Broker owns its lock, journal
// and atomic save. This module has no Notion, process-start or replay capability.
const crypto=require('node:crypto'),fs=require('node:fs');
const BATCH='SORI48-PAIR-METADATA-CORRECTED-20261030';
const BODY_BATCH='SORI48-PAIR-ADMIT-CORRECTED-20261030';
const HEAD='b26246e4ab3870bf6f7516b08906791570b57163';
const OLD_HEAD='cf4485d9f7823775760a03813d92ab205126f6c6';
const ROWS=[
  ['3f586e6dd1d181ebb43dd7de62aa2ca4','EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z',93,'operator',HEAD],
  ['40786e6dd1d181ec8addcd1269f9b0bb','EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z',4,'operator-child',HEAD],
  ['3f586e6dd1d181cd9f5bdcdab6290de7','EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',54,'guardrail',OLD_HEAD]];
const copy=x=>JSON.parse(JSON.stringify(x));
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:stable(x)).digest('hex');
const need=(v,k)=>{if(!v)throw Error('SORI48_METADATA_'+k);};
function page(raw,spec){
  for(let i=0;i<12;i++){
    need(raw&&!raw.isError&&!raw.error,'READ');
    if(raw.structuredContent){raw=raw.structuredContent;continue;}
    if(Array.isArray(raw.content)){raw=JSON.parse(raw.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));continue;}
    break;
  }
  const meta=raw.metadata??{},text=raw.text;
  need(raw.id?.replaceAll('-','')===spec[0]&&typeof text==='string'&&
    Number.isFinite(Date.parse(raw.page_last_edited_at))&&raw.truncated!==true&&meta.truncated!==true&&
    !(raw.unknown_block_count??0)&&!(meta.unknown_block_count??0)&&
    !(raw.unknown_block_ids?.length??0)&&!(meta.unknown_block_ids?.length??0),'PAGE');
  const bodies=[...text.matchAll(/<content>\n([\s\S]*?)\n<\/content>/g)];
  const props=[...text.matchAll(/<properties>\n([\s\S]*?)\n<\/properties>/g)];
  need(bodies.length===1&&props.length===1,'COMPLETE_PAGE');
  const body=bodies[0][1],properties=JSON.parse(props[0][1]);
  need(!/<unknown\b|content (?:has been |is )?truncated/i.test(body)&&
    /^## .*QUEUE EVENT \(current\)/.test(body),'CURRENT_EVENT');
  const end=body.indexOf('\n## '),current=body.slice(0,end<0?undefined:end);
  const events=[...current.matchAll(/QUEUE_EVENT_V1\s+(\{[^\n]+\})/g)];
  need(events.length===1,'OWN_EVENT');const e=JSON.parse(events[0][1]);
  need(e.event_id===spec[1]&&e.version===spec[2]&&e.role===spec[3]&&e.kind==='RELEASE'&&
    e.lease_state==='RELEASED'&&e.repo_pr?.toLowerCase()==='heainseo/sori#48'&&
    e.head_or_digest?.split(/[^a-f0-9]+/).includes(spec[4])&&
    properties['이벤트 ID']===e.event_id&&properties['체크포인트 버전']===e.version&&
    properties['세션 ID']===e.session_id&&properties['작업 ID']===e.task_id&&
    properties['저장소 식별자']?.includes(spec[4]),'OWN_PARITY');
  return {pageId:spec[0],body,properties,revision:raw.page_last_edited_at};
}
function patches(at){
  return ROWS.map((r,i)=>({
    '작업 상태':i===2?'실행재개':'검증대기','다음 담당자':'가드레일 에이전트',
    '큐 구획':i===2?'현재':'조건 대기',
    '차단 대상':i===2?'':'Sori PR48 corrected head independent pair verdict pending',
    '재개 지시':'Sori PR48 '+HEAD+'; existing pair affected delta review; genuine own CLAIM and RELEASE required. P-a P-b P-c only; no product acceptance.',
    '큐 정리 근거':'observation-id: '+BODY_BATCH+'; parent RELEASE93 and child RELEASE4; prior pair RELEASE54 is for '+OLD_HEAD+' only. Provider UNKNOWN and late observation duty retained.',
    'date:큐 정리 시각:start':at,'date:큐 정리 시각:is_datetime':1
  }));
}
function createExecutor({broker,inspectClosedUnknown,inspectBodyProjection}){
  need(broker&&typeof broker.assertLock==='function'&&typeof broker.ownerProof==='function'&&
    typeof broker.save==='function'&&typeof inspectClosedUnknown==='function'&&
    typeof inspectBodyProjection==='function','TRUSTED_RUNTIME');
  function guard(proof){
    broker.assertLock();need(stable(JSON.parse(fs.readFileSync(broker.file,'utf8')))===stable(broker.state),'MEMORY_DISK');
    need(proof?.scope===BATCH,'OWNER_SCOPE');broker.ownerProof(proof);
    const closed=inspectClosedUnknown(),body=inspectBodyProjection();
    need(closed?.valid===true&&closed.batchId==='SORI48-PAIR-ADMIT-20261029'&&
      closed.status==='CLOSED_SUPERSEDED_UNKNOWN'&&closed.originalOutcome==='UNKNOWN'&&closed.lateObservationRequired===true&&
      closed.cleanTermination===false&&closed.capacityReleased===false&&closed.productAccepted===false,'CLOSURE');
    need(body?.valid===true&&body.batchId===BODY_BATCH&&body.status==='COMPLETED'&&
      body.verifiedTargets===8,'BODY_TRANSACTION');
  }
  function save(change){
    const next=copy(broker.state);change(next);broker.state=next;
    try{broker.save();}catch(error){
      // Atomic rename may have committed even if its reply was lost. Consume
      // actual disk state; never restore the old state or infer a native result.
      broker.state=JSON.parse(fs.readFileSync(broker.file,'utf8'));throw error;
    }
  }
  function record(){const r=broker.state.batches[BATCH];
    need(r?.kind==='SORI48_PAIR_NATIVE_METADATA_V1'&&r.planHash===sha(r.requests)&&
      stable(r.patches)===stable(patches(r.startedAt)),'RECORD');
    need(r.requests.length===3&&r.snapshots.length===3&&r.next>=0&&r.next<=3,'RECORD');
    need(stable(r.requests)===stable(ROWS.map((spec,i)=>({page_id:spec[0],command:'update_properties',
      allow_async:false,properties:r.patches[i]})))&&r.receipts.length===r.next,'RECORD');
    return r;
  }
  function attempt(n,fields){
    Object.assign(n.attempt,fields);
    const saved=n.attempts.find(a=>a.dispatchId===n.attempt.dispatchId);
    need(saved,'ATTEMPT_HISTORY');Object.assign(saved,fields);
  }
  function live(pages,r){
    need(Array.isArray(pages)&&pages.length===3,'THREE_SOURCES');
    return ROWS.map((spec,i)=>{
      const p=page(pages[i],spec),old=r.snapshots[i],expected={...old.properties,...(i<r.next?r.patches[i]:{})};
      need(p.body===old.body&&stable(p.properties)===stable(expected),'SOURCE_DRIFT');return p;
    });
  }
  function identity(input,r){
    need(input.batchId===BATCH&&broker.state.active===BATCH&&input.ticket===r.attempt?.ticket&&
      input.dispatchId===r.attempt?.dispatchId&&input.executor===r.attempt?.executor&&
      input.planHash===r.planHash,'ATTEMPT');
  }
  return Object.freeze({
    begin({ownerProof,pages}){
      guard(ownerProof);
      if(broker.state.batches[BATCH])return this.status();
      need(broker.state.active===null&&Array.isArray(pages)&&pages.length===3,'ACTIVE');
      const snapshots=ROWS.map((spec,i)=>page(pages[i],spec)),at=new Date().toISOString(),changes=patches(at);
      const requests=ROWS.map((spec,i)=>({page_id:spec[0],command:'update_properties',allow_async:false,properties:changes[i]}));
      save(s=>{s.active=BATCH;s.batches[BATCH]={kind:'SORI48_PAIR_NATIVE_METADATA_V1',status:'READY',next:0,
        startedAt:at,patches:changes,requests,snapshots,planHash:sha(requests),attempt:null,attempts:[],receipts:[]};});
      return this.status();
    },
    dispatch({ownerProof,pages}){
      guard(ownerProof);const r=record();
      need(broker.state.active===BATCH&&r.status==='READY'&&r.next<3,'READY');live(pages,r);
      const attempt={ticket:crypto.randomUUID(),dispatchId:crypto.randomUUID(),executor:broker.executor,
        index:r.next,requestHash:sha(r.requests[r.next]),owner:copy(ownerProof),phase:'SEND_INTENT'};
      save(s=>{const n=s.batches[BATCH];n.attempt=attempt;n.attempts.push(attempt);n.status='SEND_INTENT';});
      return {batchId:BATCH,planHash:r.planHash,...copy(attempt),request:copy(r.requests[r.next])};
    },
    confirm(input){
      guard(input.ownerProof);const r=record();identity(input,r);live(input.pages,r);
      need(r.status==='SEND_INTENT'&&r.attempt.executor===broker.executor&&
        r.attempt.owner.ownerId===input.ownerProof.ownerId&&
        r.attempt.owner.generation===input.ownerProof.generation,'CONFIRM');
      const now=Date.now(),permit={dispatchId:r.attempt.dispatchId,executor:broker.executor,pageId:ROWS[r.next][0],
        observedAt:input.ownerProof.observedAt,validUntil:new Date(Math.min(now+15000,Date.parse(input.ownerProof.validUntil))).toISOString()};
      save(s=>{const n=s.batches[BATCH];n.status='WRITE_PENDING';attempt(n,{permit,phase:'WRITE_PENDING'});});
      return {status:'WRITE_PENDING',permit};
    },
    acknowledge(input){
      guard(input.ownerProof);const r=record();identity(input,r);
      need(r.status==='WRITE_PENDING'&&r.attempt.executor===broker.executor&&
        input.ownerProof.ownerId===r.attempt.owner.ownerId&&input.ownerProof.generation===r.attempt.owner.generation&&
        input.provider?.status==='SUCCEEDED'&&input.provider.pageId===ROWS[r.next][0],'PROVIDER');
      save(s=>{const n=s.batches[BATCH];n.status='ACKED';attempt(n,{provider:copy(input.provider),phase:'ACKED'});});
      return this.status();
    },
    resumeUnconfirmed({ownerProof,pages}){
      guard(ownerProof);const r=record();
      need(broker.state.active===BATCH&&r.status==='SEND_INTENT'&&r.attempt?.phase==='SEND_INTENT'&&
        !Object.hasOwn(r.attempt,'permit')&&!Object.hasOwn(r.attempt,'provider'),'NO_PERMIT_REQUIRED');
      live(pages,r);
      // Under the exclusive canonical lock, the durable ledger proves this
      // reviewed client never received a confirmation grant. A persisted
      // permit, including an expired one, makes this path unavailable.
      save(s=>{const n=s.batches[BATCH];attempt(n,{phase:'RETIRED_WITHOUT_PERMIT'});
        n.attempt=null;n.status='READY';});
      return this.status();
    },
    verify({ownerProof,pages}){
      guard(ownerProof);const r=record();need(r.status==='ACKED'&&broker.state.active===BATCH,'ACK_REQUIRED');
      // Only a durable actual ACK permits readback to advance. An expected
      // page alone, a timeout or a new owner can never manufacture that ACK.
      const expected=copy(r);expected.next++;
      const readback=live(pages,expected),receipt={pageId:ROWS[r.next][0],dispatchId:r.attempt.dispatchId,
        requestHash:r.attempt.requestHash,verifiedHash:sha(readback[r.next]),provider:copy(r.attempt.provider)};
      save(s=>{const n=s.batches[BATCH];n.receipts.push(receipt);n.next++;n.attempt=null;
        n.status=n.next===3?'COMPLETED':'READY';if(n.status==='COMPLETED')s.active=null;});
      return this.status();
    },
    status(){
      broker.assertLock();const r=record();
      return {batchId:BATCH,status:r.status,next:r.next,planHash:r.planHash,receipts:copy(r.receipts),
        replayAllowed:false,originalOutcome:'UNKNOWN',lateObservationRequired:true,
        productAccepted:false,capacityReleased:false};
    }
  });
}
module.exports={createExecutor,BATCH,BODY_BATCH,HEAD,OLD_HEAD,ROWS,patches};
