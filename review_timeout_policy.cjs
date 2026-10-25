'use strict';
// Pure policy only: no I/O, clock, cancellation, dispatch, ledger or gate approval.
const WARNING_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 60 * 60 * 1000;
const need = (ok, message) => { if (!ok) throw new Error('REVIEW_TIMEOUT_INPUT: ' + message); };
const text = x => typeof x === 'string' && x.trim().length > 0;
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
function stamp(x) {
  need(typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
    Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x, 'canonical UTC timestamp required');
  return Date.parse(x);
}
function scopeKey(s) {
  need(s && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repo) &&
    Number.isSafeInteger(s.pr) && s.pr > 0 && sha(s.head) && sha(s.base), 'exact repo/PR/head/base required');
  return JSON.stringify([s.repo, s.pr, s.head, s.base]);
}
function assess(s) {
  need(s?.version === 1, 'version required');
  const now = stamp(s.observedAt), key = scopeKey(s.scope), currentKey = scopeKey(s.current);
  need(text(s.owner) && text(s.nextOwner) && text(s.next) && text(s.nextTrigger), 'central owner and blocked handoff required');
  need(Array.isArray(s.attempts) && s.attempts.length >= 1 && s.attempts.length <= 2,
    'complete lineage of one original and at most one replacement required');
  need(Array.isArray(s.results) && Array.isArray(s.findings), 'retained results and findings required');
  const ids = new Set();
  for (const [i, a] of s.attempts.entries()) {
    need(a.number === i + 1 && text(a.requestId) && !ids.has(a.requestId) &&
      a.parentRequestId === (i ? s.attempts[0].requestId : null) && scopeKey(a.scope) === key,
      'unique ordered same-scope request lineage required');
    ids.add(a.requestId);
    need(a.owner === s.owner && text(a.intentReceipt) && stamp(a.intentAt) <= now,
      'owner-bound durable intent required');
    need(['INTENT', 'UNKNOWN', 'ACKNOWLEDGED'].includes(a.delivery), 'delivery state required');
    need(['GITHUB_CODEX', 'MANAGED_PROCESS'].includes(a.channel) && typeof a.cancelSupported === 'boolean',
      'known channel and observed cancellation capability required');
    need(a.channel !== 'GITHUB_CODEX' || a.cancelSupported === false, 'no verified GitHub Codex cancel API');
    if (a.delivery === 'ACKNOWLEDGED') need(text(a.requestReceipt), 'request receipt required');
    need(['UNKNOWN', 'CONFIRMED'].includes(a.termination), 'termination evidence state required');
    if (a.termination === 'CONFIRMED') need(text(a.terminationReceipt) &&
      stamp(a.terminatedAt) >= stamp(a.intentAt) && stamp(a.terminatedAt) <= now,
      'actual exit observation required; cancel acknowledgement is insufficient');
    if (i) {
      const prior = s.attempts[0];
      need(stamp(a.intentAt) - stamp(prior.intentAt) > TIMEOUT_MS &&
        a.channel === prior.channel && prior.delivery === 'ACKNOWLEDGED' && text(prior.timeoutReceipt) &&
        (!prior.cancelSupported || (prior.termination === 'CONFIRMED' &&
          stamp(prior.terminatedAt) <= stamp(a.intentAt))), 'replacement requires prior timeout and exit/UNKNOWN evidence');
    }
  }
  const resultIds = new Set();
  for (const r of s.results) {
    const a = s.attempts.find(a => a.requestId === r.requestId);
    need(a && scopeKey(r.scope) === key && text(r.resultId) && !resultIds.has(r.resultId) && text(r.receipt) &&
      ['CLEAN', 'FINDINGS', 'FAILED'].includes(r.verdict) && stamp(r.at) >= stamp(a.intentAt) && stamp(r.at) <= now,
      'unique request-bound result required');
    resultIds.add(r.resultId);
    need(Array.isArray(r.findingIds) && new Set(r.findingIds).size === r.findingIds.length &&
      (r.verdict === 'FINDINGS' ? r.findingIds.length > 0 : r.findingIds.length === 0), 'verdict/finding list mismatch');
  }
  const findingIds = new Set(), unresolved = [];
  for (const f of s.findings) {
    const r = s.results.find(r => r.resultId === f.resultId);
    need(r && r.findingIds.includes(f.id) && text(f.id) && !findingIds.has(f.id) && text(f.receipt),
      'unique retained finding bound to result required');
    findingIds.add(f.id);
    need(['OPEN', 'FIXED', 'DISMISSED'].includes(f.disposition), 'explicit finding disposition required');
    if (f.disposition === 'OPEN') unresolved.push(f.id);
    else {
      need(text(f.owner) && text(f.evidence), 'resolved finding requires evidence and responsible owner');
      if (scopeKey(f.assessedScope) !== currentKey) unresolved.push(f.id);
    }
  }
  need(s.results.every(r => r.findingIds.every(id => s.findings.some(f => f.id === id && f.resultId === r.resultId))), 'missing finding; late defects cannot be discarded');
  const a = s.attempts.at(-1), age = now - stamp(a.intentAt);
  const out = (action, reason, extra = {}) => ({action, reason, scopeKey:key,
    requestId:a.requestId, attempt:a.number, owner:s.owner, nextOwner:s.nextOwner, next:s.next, nextTrigger:s.nextTrigger,
    warning:age >= WARNING_MS, timedOut:age > TIMEOUT_MS, unresolvedFindings:[...unresolved],
    retainedResultIds:[...resultIds], gate:'NOT_ASSESSED', dispatchAuthorized:false, ...extra});
  // Retain and validate late evidence even when ownership/scope or delivery blocks action.
  if (key !== currentKey) return out('BLOCKED', 'SCOPE_CHANGED');
  if (s.attempts.some(a => a.delivery !== 'ACKNOWLEDGED')) return out('BLOCKED', 'RECONCILE_DELIVERY_NO_RESEND');
  if (unresolved.length) return out('BLOCKED', 'FINDING_DISPOSITION_REQUIRED');
  const latestResults = s.results.filter(r => r.requestId === a.requestId);
  if (latestResults.length) return out('RECONCILE_RESULTS', 'APPLY_EXISTING_REVIEW_GATES');
  if (age <= TIMEOUT_MS) return out(age >= WARNING_MS ? 'WARN' : 'WAIT', 'AWAIT_RESULT');
  if (a.number === 2) return out('BLOCKED', 'REPLACEMENT_TIMEOUT', {termination:a.termination});
  if (a.cancelSupported && a.termination !== 'CONFIRMED')
    return out('VERIFY_TERMINATION', 'CANCEL_IF_SUPPORTED_AND_CONFIRM_EXIT');
  return out('REPLACEMENT_CANDIDATE', 'RESERVE_ONCE_UNDER_CENTRAL_OWNER', {
    predecessorTermination:a.termination, replacementNumber:2, parentRequestId:a.requestId});
}
module.exports = {assess, scopeKey, WARNING_MS, TIMEOUT_MS};
