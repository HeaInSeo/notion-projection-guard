'use strict';
// Additive operational adapter. The independently reviewed PR9 files stay unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {ReviewLedger, budgetKey} = require('./review_timeout_ledger.cjs');
const policy = require('./review_timeout_policy.cjs');
const {providerFindings,combineHistory,UUID,validOutbound} = require('./review_timeout_evidence.cjs');
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
function privateDirectory(p) {
  const s=fs.lstatSync(p);
  need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&
    (s.mode&0o777)===0o700&&fs.realpathSync(p)===path.resolve(p),'unsafe observation directory');
}
function inboxPaths(directory,scope) {
  const key=digest(JSON.stringify([scope.repo.toLowerCase(),scope.pr]));
  return {marker:path.join(directory,'provider-observations-'+key+'.marker.json'),
    root:path.join(directory,'provider-observation-inbox'),
    scoped:path.join(directory,'provider-observation-inbox',key)};
}
function observationFingerprint(snapshot) {
  const facts={...snapshot};delete facts.observedAt;
  return digest(JSON.stringify(facts));
}
function readObservationInbox(directory,scope) {
  const p=inboxPaths(directory,scope);
  if(!fs.existsSync(p.marker)) {
    need(!fs.existsSync(p.scoped),'untracked observation inbox'); return [];
  }
  const marker=JSON.parse(readPrivate(p.marker));
  need(marker.version===1&&marker.repo===scope.repo.toLowerCase()&&marker.pr===scope.pr,
    'observation scope marker mismatch');
  need(fs.existsSync(p.root)&&fs.existsSync(p.scoped),'missing initialized observation history');
  privateDirectory(p.root);privateDirectory(p.scoped);
  return fs.readdirSync(p.scoped).map(name=>{
    need(/^[a-f0-9]{64}\.json$/.test(name),'unexpected observation evidence');
    const bytes=readPrivate(path.join(p.scoped,name));
    const s=JSON.parse(bytes);
    need(observationFingerprint(s)+'.json'===name,'observation evidence hash mismatch');
    need(s.version===1&&s.complete===true&&s.repo.toLowerCase()===scope.repo.toLowerCase()&&
      s.pr===scope.pr&&Array.isArray(s.comments)&&Array.isArray(s.threads)&&
      Array.isArray(s.reviews)&&Array.isArray(s.inlineComments),'invalid observation evidence');
    return {snapshot:s,evidence:{file:path.join(p.scoped,name),sha256:digest(bytes)}};
  });
}
function persistObservationInbox(directory,snapshot) {
  const p=inboxPaths(directory,snapshot);
  if(!fs.existsSync(p.marker)) {
    need(!fs.existsSync(p.scoped),'untracked existing observation scope');
    writeNew(directory,path.basename(p.marker),{version:1,repo:snapshot.repo.toLowerCase(),pr:snapshot.pr});
    if(!fs.existsSync(p.root)) fs.mkdirSync(p.root,{mode:0o700});
    privateDirectory(p.root);
    fs.mkdirSync(p.scoped,{mode:0o700});
  }
  // Marker present but history missing is a reconciliation error, never a new inbox.
  readObservationInbox(directory,snapshot);
  const name=observationFingerprint(snapshot)+'.json';
  const file=path.join(p.scoped,name);
  if(fs.existsSync(file))need(observationFingerprint(JSON.parse(readPrivate(file)))===
    observationFingerprint(snapshot),'existing observation differs');
  else writeNew(p.scoped,name,snapshot);
  return readObservationInbox(directory,snapshot);
}
function readOutboundRecords(directory,state,requester,scope=null) {
  const result={};
  for(const c of state.chains) {
    if(scope&&(c.scope.repo.toLowerCase()!==scope.repo.toLowerCase()||c.scope.pr!==scope.pr))continue;
    for(const a of c.attempts) {
    if(!UUID.test(a.requestId))continue;
    const file=path.join(directory,'outbound-'+a.requestId+'.json');
    if(!fs.existsSync(file))continue;
    const record=JSON.parse(readPrivate(file));
    need(validOutbound(record,a,requester),'outbound request evidence mismatch');
    result[a.requestId]=record;
  }}
  return result;
}
function retainedFindingHolds(state,scope,pending=[]) {
  const all=new Map((state.providerFindings??[]).filter(f=>
    f.repo.toLowerCase()===scope.repo.toLowerCase()&&f.pr===scope.pr).map(f=>[f.id,f]));
  for(const f of pending)if(!all.has(f.id))all.set(f.id,{...f,disposition:'OPEN'});
  const holds=[];
  for(const f of all.values()) {
    let valid=['FIXED','DISMISSED'].includes(f.disposition);
    try {
      const bytes=readPrivate(f.dispositionEvidence.file),p=JSON.parse(bytes);
      valid=valid&&policy.scopeKey(f.assessedScope)===policy.scopeKey(scope)&&
        typeof f.dispositionOwner==='string'&&f.dispositionOwner.length>0&&
        digest(bytes)===f.dispositionEvidence.sha256&&p.findingId===f.id&&
        p.definitionSha256===f.definitionSha256&&p.owner===f.dispositionOwner&&
        p.disposition===f.disposition&&policy.scopeKey(p.assessedScope)===policy.scopeKey(scope);
    } catch {valid=false;}
    if(!valid)holds.push(f.id);
  }
  return holds;
}
class OperationalLedger extends ReviewLedger {
  async release(token, revision) {
    return this.locked(() => {
      const s = this.load(), now = this.authorize(s, token, revision);
      s.lease = null;
      return this.commit(s, now, 'RELEASE_OWNER', {owner:token.owner, fence:token.fence});
    });
  }
  async importObserved(token, revision, evidence, context = {}) {
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
      const history=persistObservationInbox(this.directory,snapshot);
      const combined=combineHistory(history.map(x=>x.snapshot));
      const {migrate}=require('./review_timeout_history.cjs');
      const migrations=migrate(combined,evidence.sha256,context.owner??token.owner,s.chains,
        {requesterLogin:context.requesterLogin,
          outbound:readOutboundRecords(this.directory,s,context.requesterLogin,snapshot)});
      migrations.quarantine.push(...(context.quarantine??[]));
      s.providerFindings??=[];
      for(const h of history)for(const f of providerFindings(h.snapshot)) {
        const old=s.providerFindings.find(x=>x.id===f.id&&
          x.repo.toLowerCase()===f.repo.toLowerCase()&&x.pr===f.pr);
        if(!old)s.providerFindings.push({...f,disposition:'OPEN',assessedScope:null,
          firstObservedAt:h.snapshot.observedAt,sourceEvidence:clone(h.evidence)});
      }
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
  async disposeProviderFinding(token,revision,id,receipt) {
    return this.locked(()=>{
      const s=this.load(),now=this.authorize(s,token,revision);
      const raw=readPrivate(receipt.file);
      need(digest(raw)===receipt.sha256,'disposition evidence hash mismatch');
      const p=JSON.parse(raw),f=(s.providerFindings??[]).find(x=>x.id===id);
      need(f&&p.version===1&&p.findingId===id&&
        p.definitionSha256===f.definitionSha256&&p.owner===token.owner&&
        p.sourceEvaluator==='EXISTING_CENTRAL_POLICY_OWNER'&&
        ['FIXED','DISMISSED'].includes(p.disposition)&&
        typeof p.responsibleOwner==='string'&&p.responsibleOwner.length>0&&
        typeof p.explanation==='string'&&p.explanation.length>0,
      'explicit owner and definition-bound finding disposition required');
      policy.scopeKey(p.assessedScope);
      need(p.assessedScope.repo.toLowerCase()===f.repo.toLowerCase()&&p.assessedScope.pr===f.pr&&
        Number.isFinite(Date.parse(p.assessedAt))&&now>=Date.parse(p.assessedAt)&&
        now-Date.parse(p.assessedAt)<=60000&&Array.isArray(p.sources)&&p.sources.length>0,
      'fresh scope-bound finding assessment required');
      for(const source of p.sources)need(typeof source.url==='string'&&source.url.length>0&&
        typeof source.content==='string'&&source.content.length>0&&
        digest(source.content)===source.sha256,'finding source evidence required');
      f.dispositionHistory??=[];
      f.dispositionHistory.push({disposition:p.disposition,owner:token.owner,
        responsibleOwner:p.responsibleOwner,assessedScope:clone(p.assessedScope),
        evidence:clone(receipt),at:new Date(now).toISOString()});
      Object.assign(f,{disposition:p.disposition,dispositionOwner:token.owner,
        assessedScope:clone(p.assessedScope),dispositionEvidence:clone(receipt)});
      return this.commit(s,now,'PROVIDER_FINDING_DISPOSITION',{id,owner:token.owner,
        disposition:p.disposition,scope:clone(p.assessedScope),receipt:clone(receipt)});
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
module.exports = {OperationalLedger,need,digest,readPrivate,writeNew,readObservationInbox,
  persistObservationInbox,readOutboundRecords,retainedFindingHolds};
