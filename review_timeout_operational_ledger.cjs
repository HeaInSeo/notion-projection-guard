'use strict';
// Additive operational adapter. The independently reviewed PR9 files stay unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {ReviewLedger, budgetKey} = require('./review_timeout_ledger.cjs');
const policy = require('./review_timeout_policy.cjs');
const need = (ok, message) => { if (!ok) throw Error('REVIEW_OPERATIONAL: ' + message); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = x => structuredClone(x);
function readPrivate(file, mode = 0o600) {
  const s = fs.lstatSync(file);
  need(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 &&
    s.uid === process.getuid() && (s.mode & 0o777) === mode &&
    fs.realpathSync(file) === path.resolve(file), 'unsafe private file');
  return fs.readFileSync(file, 'utf8');
}
function writeNew(directory, name, object) {
  need(path.basename(name) === name, 'simple evidence name required');
  const file = path.join(directory, name);
  const data = JSON.stringify(object) + '\n';
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const d = fs.openSync(directory, 'r');
  try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  need(readPrivate(file) === data, 'evidence readback failed');
  return {file, sha256:digest(data)};
}
class OperationalLedger extends ReviewLedger {
  async release(token, revision) {
    return this.locked(() => {
      const s = this.load(), now = this.authorize(s, token, revision);
      s.lease = null;
      return this.commit(s, now, 'RELEASE_OWNER', {owner:token.owner, fence:token.fence});
    });
  }
  async importObserved(token, revision, evidence, migrations) {
    return this.locked(() => {
      const s = this.load(), now = this.authorize(s, token, revision);
      const bytes = readPrivate(evidence.file);
      need(digest(bytes) === evidence.sha256, 'history evidence hash mismatch');
      const snapshot = JSON.parse(bytes);
      need(snapshot.complete === true && snapshot.version === 1 &&
        Array.isArray(snapshot.comments) && Array.isArray(snapshot.reviews) &&
        Array.isArray(snapshot.inlineComments) && Array.isArray(snapshot.threads) &&
        snapshot.current.repo === snapshot.repo && snapshot.current.pr === snapshot.pr,
      'complete provider history required');
      need(migrations.evidenceSha256 === evidence.sha256, 'migration source mismatch');
      s.historyQuarantine ??= [];
      s.observations ??= {};
      for (const q of migrations.quarantine) {
        need(q.repo === snapshot.repo && q.pr === snapshot.pr &&
          typeof q.reason === 'string' && Array.isArray(q.requestIds), 'invalid quarantine');
        const item = {...q, evidence:clone(evidence)};
        const id = digest(JSON.stringify([q.repo.toLowerCase(), q.pr, q.key, q.reason, q.requestIds]));
        if (!s.historyQuarantine.some(x => x.id === id)) s.historyQuarantine.push({...item,id});
      }
      for (const c of migrations.chains) {
        policy.assess({...c, observedAt:new Date(now).toISOString()});
        const key = budgetKey(c.scope), old = s.chains.find(x => budgetKey(x.scope) === key);
        if (old) {
          const known = new Set(old.attempts.map(a => String(a.providerCommentId ?? a.requestId)));
          const extra = c.attempts.filter(a => !known.has(String(a.providerCommentId ?? a.requestId)));
          if (extra.length) {
            const q = {repo:snapshot.repo,pr:snapshot.pr,key,
              reason:'UNRECONCILED_EXISTING_CHAIN_EXTENSION',requestIds:extra.map(a => a.requestId)};
            const id = digest(JSON.stringify(q));
            if (!s.historyQuarantine.some(x => x.id === id))
              s.historyQuarantine.push({...q,id,evidence:clone(evidence)});
          }
          continue; // Never replace a chain, roll back its intent, or replenish its budget.
        }
        need(!s.chains.some(x => x.attempts.some(a =>
          c.attempts.some(b => b.requestId === a.requestId))), 'duplicate migrated request');
        s.chains.push(clone(c));
      }
      // Keep every immutable observation, including old results and unresolved old-head findings.
      const id = snapshot.repo.toLowerCase() + '#' + snapshot.pr;
      const old = s.observations[id];
      const observedMs = Date.parse(snapshot.observedAt);
      need(Number.isFinite(observedMs) && observedMs <= now &&
        (!old || observedMs >= Date.parse(old.observedAt)), 'stale provider observation');
      s.observations[id] = {observedAt:snapshot.observedAt,evidence:clone(evidence)};
      return this.commit(s,now,'IMPORT_OBSERVED_HISTORY',{scope:id,evidence:clone(evidence),
        quarantined:migrations.quarantine.length,chains:migrations.chains.length});
    });
  }
  async dispatchOriginal(token, revision, scope, handoff, transport) {
    return this.locked(async () => {
      const s = this.load();
      this.authorize(s,token,revision);
      const key = budgetKey(scope);
      need(!s.chains.some(x => budgetKey(x.scope) === key), 'HEAD_BUDGET_EXISTS');
      need(!(s.historyQuarantine ?? []).some(q => q.repo.toLowerCase() === scope.repo.toLowerCase() &&
        q.pr === scope.pr && (!q.key || q.key === key)), 'HISTORY_QUARANTINED');
      need(transport && typeof transport.readCurrent === 'function' &&
        typeof transport.checkEligibility === 'function' && typeof transport.send === 'function',
      'trusted provider callbacks required');
      const eligibility = async () => {
        const e = await this.bounded(() => transport.checkEligibility({scope:clone(scope),
          owner:token.owner,fence:token.fence}));
        this.authorize(s,token,s.revision);
        return e?.allowed === true && e.scopeKey === policy.scopeKey(scope) &&
          e.owner === token.owner && e.fence === token.fence && typeof e.receipt === 'string' &&
          e.receipt.length > 0;
      };
      const current = await this.bounded(() => transport.readCurrent(clone(scope)));
      need(policy.scopeKey(current) === policy.scopeKey(scope), 'SCOPE_CHANGED');
      if (!(await eligibility())) return {action:'BLOCKED',reason:'EXISTING_GATES_NOT_SATISFIED'};
      let now = this.authorize(s,token,s.revision);
      const a = {number:1,scope:clone(scope),requestId:crypto.randomUUID(),parentRequestId:null,
        owner:token.owner,intentAt:new Date(now).toISOString(),
        intentReceipt:'ledger-revision-' + (s.revision + 1),delivery:'UNKNOWN',
        channel:'GITHUB_CODEX',cancelSupported:false,termination:'UNKNOWN',
        reservedBy:{owner:token.owner,fence:token.fence}};
      const c = {version:1,scope:clone(scope),current:clone(scope),owner:token.owner,
        nextOwner:handoff?.nextOwner,next:handoff?.next,nextTrigger:handoff?.nextTrigger,
        attempts:[a],results:[],findings:[]};
      policy.assess({...c,observedAt:new Date(now).toISOString()});
      s.chains.push(c);
      this.commit(s,now,'ORIGINAL_INTENT',{key,requestId:a.requestId,fence:token.fence});
      const latest = await this.bounded(() => transport.readCurrent(clone(scope)));
      if (policy.scopeKey(latest) !== policy.scopeKey(scope) || !(await eligibility()))
        return {action:'BLOCKED',reason:'REVALIDATION_AFTER_INTENT_FAILED',requestId:a.requestId};
      this.authorize(s,token,s.revision);
      let receipt;
      try { receipt = await this.bounded(() => transport.send(clone(a))); }
      catch { return {action:'BLOCKED',reason:'UNCERTAIN_SEND',requestId:a.requestId}; }
      now = this.authorize(s,token,s.revision);
      need(typeof receipt === 'string' && receipt.length > 0, 'missing provider receipt');
      a.delivery = 'ACKNOWLEDGED'; a.requestReceipt = receipt;
      this.commit(s,now,'ORIGINAL_RECEIPT',{key,requestId:a.requestId,receipt});
      return {action:'REQUEST_RECORDED',requestId:a.requestId,gate:'NOT_ASSESSED'};
    });
  }
}
module.exports = {OperationalLedger,need,digest,readPrivate,writeNew};
