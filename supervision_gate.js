(function createSupervisionGate() {
  'use strict';
  // Pure accounting: this module never writes Notion, releases ownership,
  // retries a broker batch, starts a worker or grants execution authority.
  const need=(ok,message)=>{if(!ok)throw new Error('SUPERVISION_INPUT: '+message);};
  const nonempty=x=>typeof x==='string'&&x.trim().length>0;
  const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
  const time=x=>{
    if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x))return false;
    const stamp=Date.parse(x),canonical=x.replace(/(?:\.(\d{1,3}))?Z$/,(_,f)=>'.'+(f??'').padEnd(3,'0')+'Z');
    return Number.isFinite(stamp)&&new Date(stamp).toISOString()===canonical;
  };
  const actions=new Set(['PROMOTE','RECIRCULATE','KEEP_GATED','DONE']);
  const repositories=new Set(['nodekit','sori']); // Same scope as complete_projection.js.
  function eventKey(event) {
    need(repositories.has(event.repository)&&event.source,'known projection repository/source required');
    const s=event.source;
    need(time(s.at),'source time required');
    if(s.kind==='MERGED') {
      need(Number.isSafeInteger(s.pr)&&s.pr>0&&s.merged===true&&sha(s.head)&&sha(s.mergeSha),'actual merged PR/full SHAs required');
      return event.repository+'#'+s.pr+':'+s.head+':'+s.mergeSha+':MERGED';
    }
    need(s.kind==='RELEASE'&&nonempty(s.taskId)&&nonempty(s.eventId)&&sha(s.head),'own RELEASE identity required');
    return JSON.stringify(['RELEASE',event.repository,s.taskId,s.eventId,s.head]);
  }
  function canonicalBarrier(canonical) {
    need(canonical&&Object.hasOwn(canonical,'active')&&Array.isArray(canonical.nonterminal),'fresh canonical state required');
    return canonical.active!==null||canonical.nonterminal.length>0;
  }
  function carriedRepository(key) {
    const merged=key.match(/^(nodekit|sori)#([1-9]\d*):([a-f0-9]{40}):([a-f0-9]{40}):MERGED$/);
    if(merged){need(Number.isSafeInteger(Number(merged[2])),'invalid carried PR number');return merged[1];}
    let value;try{value=JSON.parse(key);}catch{need(false,'unknown carried event key');}
    need(Array.isArray(value)&&value.length===5&&value[0]==='RELEASE'&&repositories.has(value[1])&&
      nonempty(value[2])&&nonempty(value[3])&&sha(value[4])&&JSON.stringify(value)===key,'noncanonical carried RELEASE key');
    return value[1];
  }
  function ownProof(receipt,id,key,earliest,now) {
    return receipt&&typeof receipt==='object'&&receipt.taskId===id&&receipt.inputKey===key&&
      nonempty(receipt.eventId)&&nonempty(receipt.sessionId)&&
      ['CLAIM','CHECKPOINT','RELEASE'].includes(receipt.kind)&&time(receipt.at)&&
      Date.parse(receipt.at)>=earliest&&Date.parse(receipt.at)<=now;
  }
  function prewriteDecision(input) {
    const blocked=canonicalBarrier(input.canonical);
    need(Number.isSafeInteger(input.bodyWrites)&&input.bodyWrites>=0,'body write count required');
    need(Number.isSafeInteger(input.attempt)&&input.attempt>=1,'attempt required');
    // Never infer zero writes from the wording of an exception.
    if(blocked||input.bodyWrites!==0||input.bodyRunnerEntered!==false||input.resultsKnown!==true||input.batchRegistered!==false)
      return {action:'PRESERVE_AND_RECONCILE',retry:false};
    if(input.phase!=='NATIVE_PREFLIGHT'||input.reason!=='NATIVE_EXPECTATION_CHANGED')
      return {action:'REPORT_CAPABILITY',retry:false};
    if(input.attempt>=3)return {action:'RECORD_PENDING',retry:false};
    return {action:'REOBSERVE_SAME_REPOSITORY',retry:true};
  }
  function assess(snapshot) {
    need(snapshot?.version===1&&time(snapshot.observedAt),'version/clock required');
    need(Array.isArray(snapshot.events)&&Array.isArray(snapshot.previousPending),'events/previous pending required');
    const blocked=canonicalBarrier(snapshot.canonical),now=Date.parse(snapshot.observedAt);
    const pending=new Map(),issues=[],eligible=new Set(),seen=new Set();
    for(const old of snapshot.previousPending) {
      need(nonempty(old.key)&&repositories.has(old.repository)&&time(old.firstSeenAt)&&!pending.has(old.key),'unique known prior pending identity required');
      need(carriedRepository(old.key)===old.repository,'carried key/repository mismatch');
      need(Date.parse(old.firstSeenAt)<=now,'prior pending time is in the future');
      const sourceAt=Object.hasOwn(old,'sourceAt')?old.sourceAt:old.firstSeenAt;
      need(time(sourceAt)&&Date.parse(sourceAt)<=Date.parse(old.firstSeenAt),'invalid carried source time');
      need(Array.isArray(old.expectedSuccessors)&&old.expectedSuccessors.length>0&&
        new Set(old.expectedSuccessors).size===old.expectedSuccessors.length&&old.expectedSuccessors.every(nonempty),
        'carried successor identities required');
      pending.set(old.key,{...old,sourceAt,expectedSuccessors:[...old.expectedSuccessors],status:'UNOBSERVED_PENDING'});
    }
    const add=(key,repository,code,detail)=>issues.push({key,repository,code,detail});
    for(const event of snapshot.events) {
      const key=eventKey(event),repo=event.repository;
      need(!seen.has(key),'duplicate event');seen.add(key);
      need(Date.parse(event.source.at)<=now,'source time is in the future');
      const carried=pending.get(key);
      if(carried)need(Date.parse(event.source.at)===Date.parse(carried.sourceAt),'source timestamp changed for carried event');
      need(Array.isArray(event.expectedSuccessors)&&event.expectedSuccessors.length>0&&
        new Set(event.expectedSuccessors).size===event.expectedSuccessors.length&&event.expectedSuccessors.every(nonempty),'canonical successor IDs required');
      const expectedSuccessors=[...new Set([...(carried?.expectedSuccessors??[]),...event.expectedSuccessors])];
      need(Array.isArray(event.successors),'successor dispositions required');
      const actual=new Map();
      for(const s of event.successors){need(nonempty(s.id)&&!actual.has(s.id),'unique successor ID required');actual.set(s.id,s);}
      need([...actual.keys()].every(id=>expectedSuccessors.includes(id)),'unexpected successor');
      let complete=true;
      if(event.projection?.status!=='COMPLETE'||event.projection.sourceKey!==key||!nonempty(event.projection.certificate)) {
        complete=false;add(key,repo,'PROJECT_SOURCE','fresh single-repository complete manifest required');
      }
      // Another repository's valid worker can delay shared worker intake, but
      // is never a reason to drop this repository's projection/decision.
      if(event.deferredBecauseOtherRepository===true) {
        complete=false;add(key,repo,'CROSS_REPOSITORY_DEFER','replan this repository independently');
      }
      for(const id of expectedSuccessors) {
        const s=actual.get(id);
        if(!s||!actions.has(s.action)||s.sourceKey!==key||!nonempty(s.owner)||!nonempty(s.next)) {
          complete=false;add(key,repo,'DECIDE_SUCCESSOR',id);continue;
        }
        if(s.action==='KEEP_GATED') {
          const b=s.blocker;
          if(!b||!nonempty(b.owner)||!nonempty(b.trigger)||!nonempty(b.source)||b.conditionMet!==false) {
            complete=false;add(key,repo,'INVALID_WAIT',id);
          }
        } else if(s.action==='DONE') {
          const proof=s.completionReceipt;
          if(!ownProof(proof,id,key,Date.parse(event.source.at),now)||proof.kind!=='RELEASE'||
            proof.verdict!=='PASS'||!nonempty(proof.acceptanceReceipt)) {
            complete=false;add(key,repo,'MISSING_COMPLETION_PROOF',id);
          }
        } else {
          const h=s.handoff;
          const request=h&&time(h.requestedAt)&&Date.parse(h.requestedAt)>=Date.parse(event.source.at)&&
            Date.parse(h.requestedAt)<=now&&nonempty(h.requestReceipt);
          const own=h?.ownReceipt;
          const received=request&&ownProof(own,id,key,Date.parse(h.requestedAt),now);
          if(!received){complete=false;add(key,repo,request?'AWAIT_OWN_RECEIPT':'DISPATCH_SUCCESSOR',id);}
        }
      }
      if(complete)pending.delete(key);
      else {
        const prior=pending.get(key);
        pending.set(key,{key,repository:repo,sourceAt:prior?.sourceAt??event.source.at,
          firstSeenAt:prior?.firstSeenAt??event.source.at,expectedSuccessors,
          status:blocked?'CANONICAL_BARRIER':'ACTION_PENDING'});
        if(!blocked)eligible.add(repo);
      }
    }
    if(blocked)add(snapshot.canonical.active,null,'CANONICAL_BARRIER','preserve current batch and use its existing reconcile path');
    return {status:blocked||pending.size?'PENDING':'COMPLETE',canonicalBarrier:blocked,
      eligibleRepositories:[...eligible].sort(),issues,pending:[...pending.values()],
      productAcceptance:'NOT_ASSESSED'};
  }
  return {assess,eventKey,prewriteDecision};
})
