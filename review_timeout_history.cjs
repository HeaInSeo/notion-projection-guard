'use strict';
const {budgetKey} = require('./review_timeout_ledger.cjs');
const {scopeKey,TIMEOUT_MS,assess} = require('./review_timeout_policy.cjs');
const {need} = require('./review_timeout_operational_ledger.cjs');
const utc = x => new Date(x).toISOString();
const SHA = '[a-f0-9]{40}';
function bodyScope(body, repo, pr) {
  const get = label => body.match(new RegExp(label +
    '\\s*(?:sha|commit)?\\s*[:=]?\\s*[\x60*]*(' + SHA + ')','i'))?.[1];
  const head = get('(?:exact[- ]head|frozen[- ]head|head)');
  const base = get('base');
  if (!head || !base) return null;
  const scope = {repo,pr,head,base}; scopeKey(scope); return scope;
}
function migrate(snapshot, evidenceSha256, owner, existing = []) {
  need(snapshot.complete === true, 'incomplete history cannot be migrated');
  const groups = new Map(), quarantine = [], managed = new Map();
  const q = (reason, requestIds, key = null) => quarantine.push({
    repo:snapshot.repo,pr:snapshot.pr,key,reason,requestIds});
  for (const comment of snapshot.comments) {
    if (!/^\s*@codex\s+review\b/i.test(comment.body ?? '') ||
      /\[bot\]$/.test(comment.user?.login ?? '')) continue;
    const marker = (comment.body ?? '').match(/^Review-Timeout-Request: ([a-f0-9-]{36})$/m)?.[1];
    if (marker) {
      if (managed.has(marker)) q('DUPLICATE_MANAGED_REQUEST_ID',[marker]);
      managed.set(marker,comment);
      const known = existing.flatMap(c => c.attempts).find(a => a.requestId === marker);
      if (!known) q('MANAGED_INTENT_NOT_IN_CANONICAL_LEDGER',[marker]);
      continue;
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
      const state = JSON.parse(match[1]).code_review;
      const times = [...(c.body ?? '').matchAll(/datetime="([^"]+)"/g)].map(x => x[1]);
      return [{commentId:String(c.id),updatedAt:c.updated_at,...state,
        providerTime:times.length ? utc(times[0]) : null}];
    } catch { return []; }
  });
  return states.sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}
function decisionFor(chain, state, snapshot, now = Date.now()) {
  const key = budgetKey(chain.scope);
  const base = assess({...chain,current:snapshot.current,observedAt:new Date(now).toISOString()});
  const hold = (state.historyQuarantine ?? []).find(q =>
    q.repo.toLowerCase() === chain.scope.repo.toLowerCase() &&
    q.pr === chain.scope.pr && (!q.key || q.key === key));
  if (hold) return {...base,action:'BLOCKED',reason:'HISTORY_RECONCILIATION_REQUIRED',
    historyReason:hold.reason,retainedEvidence:hold.evidence};
  const open = snapshot.threads.filter(t => t.isResolved !== true);
  if (open.length) return {...base,action:'BLOCKED',reason:'PROVIDER_FINDING_DISPOSITION_REQUIRED',
    retainedFindingIds:open.map(t => t.id)};
  const latest = chain.attempts.at(-1), provider = summary(snapshot);
  // The mutable shared summary has no execution ID. It can prevent duplicate sends,
  // but can never become a request-specific CLEAN verdict or overwrite prior results.
  if (provider && provider.commit_sha === chain.scope.head &&
    provider.providerTime && Date.parse(provider.providerTime) >= Date.parse(latest.intentAt) &&
    provider.status && !['running','pending','queued'].includes(provider.status.toLowerCase()))
    return {...base,action:'RECONCILE_RESULTS',reason:'SHARED_SUMMARY_NOT_REQUEST_SPECIFIC',
      providerObservation:provider,gate:'NOT_ASSESSED'};
  return {...base,providerObservation:provider};
}
module.exports = {bodyScope,migrate,summary,decisionFor};
