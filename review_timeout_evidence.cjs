'use strict';
const crypto = require('node:crypto');
const {scopeKey} = require('./review_timeout_policy.cjs');
const need = (ok, message) => { if (!ok) throw Error('REVIEW_EVIDENCE: ' + message); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BOT = 'chatgpt-codex-connector[bot]';
function requestBody(a) {
  scopeKey(a.scope);
  need(UUID.test(a.requestId) && Number.isSafeInteger(a.reservedBy?.fence) &&
    a.reservedBy.fence > 0 && typeof a.reservedBy.owner === 'string' &&
    (a.parentRequestId === null || typeof a.parentRequestId === 'string'),
  'immutable managed request fields required');
  return '@codex review\n\nReview only frozen head ' + a.scope.head +
    ' against base ' + a.scope.base + '. Do not substitute a later head.\n' +
    'Exact head: ' + a.scope.head + '\nBase: ' + a.scope.base + '\n' +
    'Review-Timeout-Request: ' + a.requestId + '\n' +
    'Parent request: ' + (a.parentRequestId ?? 'NONE') + '\n' +
    'Owner fence: ' + a.reservedBy.fence + '\n' +
    'This request does not cancel any predecessor or waive any review gate.';
}
function outboundRecord(a,requester) {
  need(typeof requester === 'string' && requester.length > 0,'authenticated requester required');
  const body = requestBody(a);
  return {version:1,requestId:a.requestId,scope:structuredClone(a.scope),
    parentRequestId:a.parentRequestId,reservedBy:structuredClone(a.reservedBy),
    requester,body,bodySha256:digest(body)};
}
function validOutbound(record,a,requester) {
  try {
    const expected = outboundRecord(a,requester);
    return record?.version === 1 && record.requestId === expected.requestId &&
      scopeKey(record.scope) === scopeKey(expected.scope) &&
      record.parentRequestId === expected.parentRequestId &&
      record.reservedBy?.owner === expected.reservedBy.owner &&
      record.reservedBy?.fence === expected.reservedBy.fence &&
      record.requester === requester && record.body === expected.body &&
      record.bodySha256 === expected.bodySha256;
  } catch { return false; }
}
function managedCommentMatches(comment,chain,attempt,snapshot,record,requester) {
  if (chain.scope.repo.toLowerCase() !== snapshot.repo.toLowerCase() ||
    chain.scope.pr !== snapshot.pr || !validOutbound(record,attempt,requester) ||
    comment.user?.login !== requester || comment.body !== record.body ||
    !Number.isFinite(Date.parse(comment.created_at)) ||
    Date.parse(comment.created_at) < Date.parse(attempt.intentAt)) return false;
  if (attempt.delivery === 'ACKNOWLEDGED') {
    try {
      const receipt = JSON.parse(attempt.requestReceipt);
      if (String(receipt.commentId) !== String(comment.id) ||
        receipt.requestId!==attempt.requestId ||
        scopeKey(receipt.scope)!==scopeKey(attempt.scope)) return false;
    } catch { return false; }
  }
  return true;
}
function providerFindings(snapshot) {
  const findings = [], covered = new Set();
  const add = (providerKey,definition,sourceHead) => {
    const definitionSha256 = digest(JSON.stringify(definition));
    findings.push({id:'provider-finding:'+digest(JSON.stringify([
      snapshot.repo.toLowerCase(),snapshot.pr,providerKey,definitionSha256])),providerKey,
      repo:snapshot.repo,pr:snapshot.pr,definition,definitionSha256,
      sourceHead:typeof sourceHead === 'string' ? sourceHead.toLowerCase() : 'UNKNOWN'});
  };
  for (const t of snapshot.threads) {
    const comments = t.comments?.nodes ?? [];
    for (const c of comments) covered.add(String(c.databaseId));
    const root = comments[0];
    const relevant = comments.filter((c,i) => i === 0 || c.author?.login === BOT)
      .map(c => ({id:String(c.databaseId),body:c.body,author:c.author?.login ?? 'UNKNOWN'}));
    add('github-thread:' + t.id,{threadId:t.id,comments:relevant,
      missingCommentDetails:comments.length === 0},
    root?.originalCommit?.oid ?? root?.commit?.oid);
  }
  for (const c of snapshot.inlineComments) if (!covered.has(String(c.id))) {
    add('github-inline:' + c.id,{commentId:String(c.id),body:c.body,
      author:c.user?.login ?? 'UNKNOWN'},c.original_commit_id ?? c.commit_id);
  }
  for (const c of [...snapshot.reviews,...snapshot.comments]) {
    if (c.user?.login !== BOT || !(c.body ?? '').match(/\bP[0-3]\b|CHANGES_REQUESTED/i) ||
      (c.body ?? '').includes('codex-pull-request-review-summary')) continue;
    add('github-provider-message:' + c.id,{commentId:String(c.id),body:c.body,
      author:BOT},c.commit_id);
  }
  return findings;
}
function combineHistory(snapshots) {
  need(snapshots.length > 0,'provider observation history required');
  const sorted = [...snapshots].sort((a,b) => Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const latest = sorted.at(-1), all = new Map(), requestIds = new Set();
  for (const s of sorted) {
    need(s.repo.toLowerCase() === latest.repo.toLowerCase() && s.pr === latest.pr,
      'cross-scope observation history');
    for (const c of s.comments) {
      if (/^\s*@codex\s+review\b/i.test(c.body ?? '') ||
        (c.body ?? '').includes('Review-Timeout-Request:')) requestIds.add(String(c.id));
      const key = String(c.id) + ':' + digest(c.body ?? '');
      if (!all.has(key)) all.set(key,c);
    }
  }
  return {...latest,requestCommentHistory:[...all.values()]
    .filter(c => requestIds.has(String(c.id)))};
}
module.exports = {need,digest,UUID,requestBody,outboundRecord,validOutbound,
  managedCommentMatches,providerFindings,combineHistory};
