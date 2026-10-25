'use strict';
const {budgetKey} = require('./review_timeout_ledger.cjs');
const {scopeKey,TIMEOUT_MS,assess} = require('./review_timeout_policy.cjs');
const {need,managedCommentMatches,providerFindings} = require('./review_timeout_evidence.cjs');
const {retainedFindingHolds} = require('./review_timeout_operational_ledger.cjs');
const utc = x => new Date(x).toISOString();
const SHA = '[a-f0-9]{40}';
function bodyScope(body, repo, pr) {
  if(typeof body!=='string')return null;
  const get = pattern => [...body.matchAll(new RegExp(pattern,'gim'))]
    .map(m=>m[1].toLowerCase());
  const explicit=get('\\b(?:exact[- ]head|frozen[- ]head)\\s*(?:sha|commit)?\\s*[:=]?\\s*[\x60*]*('+SHA+')\\b');
  const fallback=get('^\\s*(?:[-*]\\s*)?head\\s*(?:sha|commit)?\\s*[:=]\\s*[\x60*]*('+SHA+')\\b');
  const heads=[...new Set(explicit.length?explicit:fallback)];
  const bases=[...new Set(get('\\bbase\\s*(?:sha|commit)?\\s*[:=]?\\s*[\x60*]*('+SHA+')\\b'))];
  if(heads.length!==1||bases.length!==1)return null;
  const scope={repo,pr,head:heads[0],base:bases[0]};
  try {scopeKey(scope);return scope;} catch {return null;}
}
function migrate(snapshot, evidenceSha256, owner, existing = [], binding = {}) {
  need(snapshot.complete === true, 'incomplete history cannot be migrated');
  const groups = new Map(), quarantine = [], managed = new Map();
  const q = (reason, requestIds, key = null) => quarantine.push({
    repo:snapshot.repo,pr:snapshot.pr,key,reason,requestIds});
  const comments=snapshot.requestCommentHistory??snapshot.comments;
  const versions=new Map(),ambiguous=new Set();
  for(const c of comments) {
    const id=String(c.id),b=versions.get(id)??new Set();
    b.add(c.body??'');versions.set(id,b);
  }
  for(const[id,bodies]of versions)if(bodies.size>1) {
    ambiguous.add(id);q('REQUEST_BODY_EDIT_HISTORY_REQUIRES_RECONCILIATION',[id]);
  }
  for (const comment of comments) {
    if(ambiguous.has(String(comment.id)))continue;
    if (!/^\s*@codex\s+review\b/i.test(comment.body ?? '') ||
      /\[bot\]$/.test(comment.user?.login ?? '')) continue;
    const marker = (comment.body ?? '').match(/^Review-Timeout-Request: ([a-f0-9-]{36})$/m)?.[1];
    if (marker) {
      if (managed.has(marker)) q('DUPLICATE_MANAGED_REQUEST_ID',[marker]);
      managed.set(marker,comment);
      const chain=existing.find(c=>c.attempts.some(a=>a.requestId===marker));
      const known=chain?.attempts.find(a=>a.requestId===marker);
      if (!known) q('MANAGED_INTENT_NOT_IN_CANONICAL_LEDGER',[marker]);
      else if(!managedCommentMatches(comment,chain,known,snapshot,
        binding.outbound?.[marker],binding.requesterLogin))
        q('MANAGED_REQUEST_SCOPE_BODY_OR_REQUESTER_MISMATCH',[marker]);
      continue;
    }
    if((comment.body??'').includes('Review-Timeout-Request:')) {
      q('INVALID_MANAGED_REQUEST_MARKER',[String(comment.id)]);continue;
    }
    if(Number.isFinite(Date.parse(comment.updated_at))&&
      Date.parse(comment.updated_at)>Date.parse(comment.created_at)) {
      q('LEGACY_REQUEST_EDITED_BEFORE_OBSERVATION',[String(comment.id)]);continue;
    }
    if(!Number.isFinite(Date.parse(comment.created_at))||
      Date.parse(comment.created_at)>Date.parse(snapshot.observedAt)) {
      q('INVALID_REQUEST_TIMESTAMP',[String(comment.id)]);continue;
    }
    const scope = bodyScope(comment.body ?? '',snapshot.repo,snapshot.pr);
    if (!scope) { q('LEGACY_REQUEST_SCOPE_OR_BASE_UNKNOWN',[String(comment.id)]); continue; }
    const key = budgetKey(scope), list = groups.get(key) ?? [];
    list.push({comment,scope}); groups.set(key,list);
  }
  const chains = [];
  for (const [key, list] of groups) {
    list.sort((a,b) => Date.parse(a.comment.created_at) - Date.parse(b.comment.created_at) ||
      String(a.comment.id).localeCompare(String(b.comment.id)));
    if (list.length > 2 || list.some(x => scopeKey(x.scope) !== scopeKey(list[0].scope))) {
      q('EXISTING_BUDGET_EXHAUSTED_OR_SCOPE_AMBIGUOUS',list.map(x => String(x.comment.id)),key);
      continue;
    }
    if (list.length === 2 && Date.parse(list[1].comment.created_at) -
      Date.parse(list[0].comment.created_at) <= TIMEOUT_MS) {
      q('LEGACY_SECOND_REQUEST_NOT_A_VALID_TIMEOUT_REPLACEMENT',
        list.map(x => String(x.comment.id)),key); continue;
    }
    const scope = list[0].scope;
    const firstId = 'github-comment:' + list[0].comment.id;
    const attempts = list.map(({comment},i) => ({
      number:i+1,scope:structuredClone(scope),requestId:'github-comment:' + comment.id,
      providerCommentId:String(comment.id),parentRequestId:i ? firstId : null,owner,
      observedRequester:comment.user?.login ?? 'UNKNOWN',
      intentAt:utc(comment.created_at),
      intentReceipt:'observed-existing-request:' + comment.html_url,
      delivery:'ACKNOWLEDGED',requestReceipt:comment.html_url,
      channel:'GITHUB_CODEX',cancelSupported:false,termination:'UNKNOWN',
      ...(i === 0 && list.length === 2 ?
        {timeoutReceipt:'observed-request-timestamp-delta:' + evidenceSha256} : {})
    }));
    const c = {version:1,scope,current:structuredClone(snapshot.current),owner,
      nextOwner:owner,next:'Observe exact results and retained findings; use the existing review gates.',
      nextTrigger:'Fresh provider evidence or one eligible timeout replacement.',
      attempts,results:[],findings:[],
      migration:{evidenceSha256,sourceCommentIds:list.map(x => String(x.comment.id)),
        automaticReviews:'Retained in full provider evidence; never substituted for a post-pair request.',
        termination:'UNKNOWN; local execution and provider cancellation are distinct.'}};
    assess({...c,observedAt:snapshot.observedAt}); chains.push(c);
  }
  return {evidenceSha256,chains,quarantine};
}
function summary(snapshot) {
  const comments = snapshot.comments.filter(c => c.user?.login === 'chatgpt-codex-connector[bot]');
  const states = comments.flatMap(c => {
    const match = (c.body ?? '').match(/<!-- codex-review-state:v1 (.*?) -->/);
    if (!match) return [];
    try {
      const parsed=JSON.parse(match[1]);
      need(Object.prototype.hasOwnProperty.call(parsed,'code_review'),'unsupported provider state schema');
      const state=parsed.code_review;
      need(state===null||(state&&Object.prototype.hasOwnProperty.call(state,'status')),
        'missing provider review status');
      const times = [...(c.body ?? '').matchAll(/datetime="([^"]+)"/g)].map(x => x[1]);
      const rawTime=times[0],knownTime=rawTime&&Number.isFinite(Date.parse(rawTime));
      const trigger=(c.body??'').match(/\|\s*(Manual request|PR opened|Draft marked ready)\s*\|/i)?.[1]??'UNKNOWN';
      return [{commentId:String(c.id),updatedAt:c.updated_at,...state,
        ...(typeof state?.commit_sha==='string'&&/^[a-f0-9]{40}$/i.test(state.commit_sha)?
          {commit_sha:state.commit_sha.toLowerCase()}:{}),
        ...(state?.status===null&&state?.commit_sha?{status:'pending'}:{}),trigger,
        providerTime:knownTime ? utc(rawTime) : null}];
    } catch { return []; }
  });
  return states.sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}
function terminalObservationBlocks(provider,scope,referenceAt) {
  return !!provider&&provider.commit_sha===scope.head&&provider.status&&
    !['running','pending','queued'].includes(provider.status.toLowerCase())&&
    (!provider.providerTime||Date.parse(provider.providerTime)>=Date.parse(referenceAt));
}
function activityBudgetCoverage(activity,chains) {
  const reference=activity.startedAt??activity.observedProviderTime;
  if(activity.trigger.toLowerCase()!=='manual request'||!reference)return null;
  const candidates=chains.filter(c=>c.scope.repo.toLowerCase()===activity.repo.toLowerCase()&&
    c.scope.pr===activity.pr&&c.scope.head===activity.head).flatMap(c=>c.attempts)
    .filter(a=>a.delivery==='ACKNOWLEDGED'&&typeof a.requestReceipt==='string'&&
      a.requestReceipt.length>0&&Date.parse(a.intentAt)<=Date.parse(reference))
    .sort((a,b)=>Date.parse(b.intentAt)-Date.parse(a.intentAt));
  const a=candidates[0];
  return a?{kind:'EXISTING_REQUEST_BUDGET_ACCOUNTED',requestId:a.requestId,
    requestReceipt:a.requestReceipt,providerTermination:'UNKNOWN',gate:'NOT_ASSESSED'}:null;
}
function opaqueActivities(history,chains=[]) {
  const combined=require('./review_timeout_evidence.cjs').combineHistory(history.map(h=>h.snapshot));
  const comments=combined.requestCommentHistory??combined.comments, found=new Map();
  for(const h of [...history].sort((a,b)=>Date.parse(a.snapshot.observedAt)-Date.parse(b.snapshot.observedAt))) {
    const p=summary(h.snapshot);
    if(!p) {
      for(const c of h.snapshot.comments.filter(c=>c.user?.login==='chatgpt-codex-connector[bot]'&&
        (c.body??'').includes('codex-review-state:v1'))) {
        const id='provider-activity:'+require('./review_timeout_evidence.cjs').digest(
          JSON.stringify([combined.repo.toLowerCase(),combined.pr,'UNPARSEABLE',String(c.id)]));
        if(!found.has(id))found.set(id,{id,repo:combined.repo,pr:combined.pr,head:'UNKNOWN',
          startedAt:null,trigger:'UNPARSEABLE_PROVIDER_STATE',firstEvidence:h.evidence,
          providerTermination:'UNKNOWN'});
      }
      continue;
    }
    const inflight=['running','pending','queued'].includes((p.status??'').toLowerCase());
    if(!p.status)continue;
    const knownManual=p.trigger.toLowerCase()==='manual request'&&p.providerTime&&comments.some(c=>{
      const scope=bodyScope(c.body??'',combined.repo,combined.pr);
      return scope&&scope.head===p.commit_sha&&/^\s*@codex\s+review\b/i.test(c.body??'')&&
        Date.parse(c.updated_at??c.created_at)<=Date.parse(c.created_at)&&
        Date.parse(c.created_at)<=Date.parse(p.providerTime);
    });
    if(knownManual)continue;
    if(p.status.toLowerCase()==='completed'&&typeof p.has_any_findings==='boolean'&&
      /^[a-f0-9]{40}$/.test(p.commit_sha??'')&&
      ['pr opened','draft marked ready'].includes(p.trigger.toLowerCase()))continue;
    const head=/^[a-f0-9]{40}$/.test(p.commit_sha??'')?p.commit_sha:'UNKNOWN';
    const id='provider-activity:'+require('./review_timeout_evidence.cjs').digest(
      JSON.stringify([combined.repo.toLowerCase(),combined.pr,head,p.providerTime,p.trigger,p.commentId]));
    const activity={id,repo:combined.repo,pr:combined.pr,head,
      startedAt:inflight?p.providerTime:null,observedProviderTime:p.providerTime,
      trigger:p.trigger,firstEvidence:h.evidence,
      providerTermination:'UNKNOWN'};
    if(!activityBudgetCoverage(activity,chains)&&!found.has(id))found.set(id,activity);
  }
  return [...found.values()];
}
function activityResolution(activity,history,chains,quarantine) {
  const activities=opaqueActivities(history,chains);
  if(activity.head==='UNKNOWN'||!activity.startedAt||
    !['pr opened','draft marked ready'].includes(activity.trigger.toLowerCase())||
    activities.filter(a=>a.head===activity.head).length!==1)return null;
  if(quarantine.some(q=>q.repo.toLowerCase()===activity.repo.toLowerCase()&&q.pr===activity.pr&&
    (!q.key||JSON.parse(q.key)[2]===activity.head)))return null;
  const manualTimes=chains.filter(c=>c.scope.repo.toLowerCase()===activity.repo.toLowerCase()&&
    c.scope.pr===activity.pr&&c.scope.head===activity.head).flatMap(c=>c.attempts.map(a=>Date.parse(a.intentAt)));
  for(const h of history) {
    const p=summary(h.snapshot);
    if(terminalObservationBlocks(p,{head:activity.head},activity.startedAt)&&p.providerTime&&
      p.status.toLowerCase()==='completed'&&typeof p.has_any_findings==='boolean'&&
      !manualTimes.some(at=>at<=Date.parse(p.providerTime)))
      return {kind:'PRE_FORMAL_PHASE_RESULT_OBSERVED',evidence:h.evidence,
        providerTime:p.providerTime,providerTermination:'UNKNOWN',gate:'NOT_ASSESSED'};
  }
  return null;
}
function decisionFor(chain, state, snapshot, now = Date.now()) {
  const key = budgetKey(chain.scope);
  const base = assess({...chain,current:snapshot.current,observedAt:new Date(now).toISOString()});
  const hold = (state.historyQuarantine ?? []).find(q =>
    q.repo.toLowerCase() === chain.scope.repo.toLowerCase() &&
    q.pr === chain.scope.pr && (!q.key || q.key === key));
  const findingHolds=retainedFindingHolds(state,snapshot.current,providerFindings(snapshot));
  const activityHolds=(state.providerActivities??[]).filter(a=>
    a.repo.toLowerCase()===snapshot.repo.toLowerCase()&&a.pr===snapshot.pr&&
    (a.head==='UNKNOWN'||a.head===snapshot.current.head)&&a.status==='PENDING').map(a=>a.id);
  if (snapshot.metadata.state !== 'open')
    return {...base,action:'HISTORICAL',reason:'PR_TERMINATED_PRESERVE_ALL_EVIDENCE',
      retainedFindingIds:findingHolds,
      retainedActivityIds:activityHolds,
      historicalQuarantine:hold?.reason ?? null,dispatchAuthorized:false,
      next:'Preserve late results/findings; existing owner disposes valid defects.',
      nextTrigger:'New provider evidence; no request for the terminated PR.'};
  if (hold) return {...base,action:'BLOCKED',reason:'HISTORY_RECONCILIATION_REQUIRED',
    historyReason:hold.reason,retainedEvidence:hold.evidence,retainedFindingIds:findingHolds};
  if (findingHolds.length) return {...base,action:'BLOCKED',
    reason:'PROVIDER_FINDING_DISPOSITION_REQUIRED',retainedFindingIds:findingHolds,
    next:'Existing owner records explicit definition- and current-scope-bound finding disposition.',
    nextTrigger:'Verified responsible owner and evidence for every retained finding.'};
  if(activityHolds.length)return {...base,action:'BLOCKED',
    reason:'OPAQUE_PROVIDER_LINEAGE_UNRECONCILED',retainedActivityIds:activityHolds,
    next:'Reconcile the exact observed automatic/provider lineage without a fresh budget.',
    nextTrigger:'Verified existing request budget or pre-formal phase evidence.'};
  const latest = chain.attempts.at(-1), provider = summary(snapshot);
  // The mutable shared summary has no execution ID. It can prevent duplicate sends,
  // but can never become a request-specific CLEAN verdict or overwrite prior results.
  if (terminalObservationBlocks(provider,chain.scope,latest.intentAt))
    return {...base,action:'RECONCILE_RESULTS',reason:'SHARED_SUMMARY_NOT_REQUEST_SPECIFIC',
      providerObservation:provider,gate:'NOT_ASSESSED'};
  return {...base,providerObservation:provider};
}
module.exports = {bodyScope,migrate,summary,decisionFor,terminalObservationBlocks,
  opaqueActivities,activityResolution,activityBudgetCoverage};
