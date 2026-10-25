'use strict';
// Linux/local-filesystem adapter. No GitHub, Notion, broker or scheduler access.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const policy = require('./review_timeout_policy.cjs');
const need = (ok, message) => { if (!ok) throw new Error('REVIEW_LEDGER: ' + message); };
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const clone = x => structuredClone(x);
function budgetKey(scope) {
  policy.scopeKey(scope);
  return JSON.stringify([scope.repo.toLowerCase(), scope.pr, scope.head]); // base never resets the budget
}
class ReviewLedger {
  constructor(directory, {clock = Date.now, ioTimeoutMs = 10000, deadlineNs = null} = {}) {
    need(path.isAbsolute(directory), 'absolute private directory required');
    const stat = fs.lstatSync(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700 &&
      stat.uid === process.getuid(), 'owned private 0700 directory required');
    need(fs.realpathSync(directory) === path.resolve(directory), 'no symlink directory ancestors');
    this.directory = directory; this.file = path.join(directory, 'review-attempts.json');
    this.lock = path.join(directory, 'review-attempts.lock'); this.clock = clock;
    need(Number.isSafeInteger(ioTimeoutMs)&&ioTimeoutMs>0&&ioTimeoutMs<=30000,'bounded I/O deadline required');
    this.ioTimeoutMs=ioTimeoutMs;
    need(deadlineNs===null||(typeof deadlineNs==='string'&&/^[0-9]+$/.test(deadlineNs)), 'invalid watchdog deadline');
    this.deadlineNs=deadlineNs===null?null:BigInt(deadlineNs);
    try { fs.closeSync(fs.openSync(this.lock, 'wx', 0o600)); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    this.regular(this.lock);
  }
  regular(file) {
    const s = fs.lstatSync(file);
    need(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.uid === process.getuid() &&
      (s.mode & 0o777) === 0o600, 'owned regular 0600 file required');
  }
  now() { const n=this.clock(); need(Number.isSafeInteger(n) && n >= 0, 'clock invalid'); return n; }
  deadlineAlive() {
    need(this.deadlineNs===null||process.hrtime.bigint()<this.deadlineNs,'LOCAL_ADAPTER_DEADLINE_UNKNOWN');
  }
  async bounded(fn) {
    const start=process.hrtime.bigint();
    const ioDeadline=start+BigInt(this.ioTimeoutMs)*1000000n;
    const deadline=this.deadlineNs===null||ioDeadline<this.deadlineNs?ioDeadline:this.deadlineNs;
    need(start<deadline,'IO_TIMEOUT_UNKNOWN');
    let timer;
    try {
      const result=await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('REVIEW_LEDGER: IO_TIMEOUT_UNKNOWN')),
          Math.max(1,Number((deadline-start)/1000000n)));
      })]);
      // Timers cannot run during synchronous callbacks. Check the monotonic clock
      // after return as well: a late receipt must never promote UNKNOWN to ACK.
      need(process.hrtime.bigint()<deadline,'IO_TIMEOUT_UNKNOWN');
      return result;
    } finally {clearTimeout(timer);}
  }
  async locked(fn) {
    this.regular(this.lock);
    // Linux flock belongs to the shared open-file description. Child fd 3 and
    // this parent fd reference the same description: lock survives flock exit,
    // and closing the parent fd (including process death) releases it.
    const fd=fs.openSync(this.lock,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
    try {
      const code=await new Promise((resolve,reject)=>{
        const child=spawn('flock',['-w','1','-E','75','3'],{stdio:['ignore','ignore','ignore',fd]});
        child.on('error',reject);child.on('exit',resolve);
      });
      need(code===0,'BUSY_OR_LOCK_UNAVAILABLE');
      return await fn();
    } finally {fs.closeSync(fd);}
  }
  load() {
    this.regular(this.file);
    const s=JSON.parse(fs.readFileSync(this.file,'utf8'));
    need(s.version===1 && Number.isSafeInteger(s.revision) && s.revision>=0 &&
      Number.isSafeInteger(s.fence) && s.fence>=0 && Number.isSafeInteger(s.lastAt) &&
      Array.isArray(s.chains) && Array.isArray(s.audit), 'invalid ledger');
    need(new Set(s.chains.map(c=>budgetKey(c.scope))).size===s.chains.length, 'duplicate head budget');
    const requests=s.chains.flatMap(c=>c.attempts.map(a=>a.requestId));
    need(new Set(requests).size===requests.length,'duplicate request identity');
    need(s.lease===null || (nonempty(s.lease.owner)&&nonempty(s.lease.id)&&
      s.lease.fence===s.fence&&Number.isSafeInteger(s.lease.expiresAt)), 'invalid owner lease');
    for(const c of s.chains) policy.assess({...c,observedAt:new Date(s.lastAt).toISOString()});
    return s;
  }
  save(s) {
    const temp=path.join(this.directory,'.review-'+randomUUID()+'.tmp');
    const bytes=JSON.stringify(s)+'\n';
    const fd=fs.openSync(temp,'wx',0o600);
    try { fs.writeFileSync(fd,bytes);fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
    fs.renameSync(temp,this.file);
    const dir=fs.openSync(this.directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
    need(fs.readFileSync(this.file,'utf8')===bytes,'readback failed');
  }
  async initialize() {
    return this.locked(()=>{
      need(!fs.existsSync(this.file),'already initialized; never reset an existing ledger');
      const marker=fs.openSync(path.join(this.directory,'review-initialized'),'wx',0o600);
      try {fs.writeFileSync(marker,'version=1\n');fs.fsyncSync(marker);} finally {fs.closeSync(marker);}
      const dir=fs.openSync(this.directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
      const s={version:1,revision:0,fence:0,lastAt:this.now(),lease:null,chains:[],audit:[]};
      this.save(s);return clone(s);
    });
  }
  async read() { return this.locked(()=>clone(this.load())); }
  check(s, revision) {
    this.deadlineAlive();
    need(s.revision===revision,'REVISION_CONFLICT');
    const now=this.now();need(now>=s.lastAt,'CLOCK_ROLLBACK');return now;
  }
  authorize(s, token, revision) {
    const now=this.check(s,revision);
    need(token && s.lease && token.owner===s.lease.owner && token.fence===s.lease.fence &&
      token.id===s.lease.id && now<s.lease.expiresAt,'STALE_OR_EXPIRED_OWNER');return now;
  }
  commit(s,now,kind,detail) {
    s.lastAt=now;s.revision++;
    s.audit.push({revision:s.revision,at:new Date(now).toISOString(),kind,...detail});
    this.save(s);return clone(s);
  }
  async acquire(owner, leaseMs, revision) {
    return this.locked(()=>{
      const s=this.load(),now=this.check(s,revision);
      need(nonempty(owner) && Number.isSafeInteger(leaseMs) && leaseMs>0 && leaseMs<=300000,'owner/lease invalid');
      need(!s.lease || now>=s.lease.expiresAt,'OWNER_BUSY');
      s.lease={owner,fence:++s.fence,id:randomUUID(),expiresAt:now+leaseMs};
      this.commit(s,now,'ACQUIRE',{owner,fence:s.fence});return clone(s.lease);
    });
  }
  async renew(token, leaseMs, revision) {
    return this.locked(()=>{
      const s=this.load(),now=this.authorize(s,token,revision);
      need(Number.isSafeInteger(leaseMs)&&leaseMs>0&&leaseMs<=300000,'lease invalid');
      s.lease.expiresAt=now+leaseMs;return this.commit(s,now,'RENEW',{fence:token.fence});
    });
  }
  async importOriginal(token, revision, snapshot) {
    return this.locked(()=>{
      const s=this.load(),now=this.authorize(s,token,revision),c=clone(snapshot);
      need(c.attempts?.length===1 && c.attempts[0].delivery==='ACKNOWLEDGED','only evidenced original request import');
      policy.assess({...c,observedAt:new Date(now).toISOString()});
      need(!s.chains.some(x=>budgetKey(x.scope)===budgetKey(c.scope)),'HEAD_BUDGET_EXISTS');
      need(!s.chains.some(x=>x.attempts.some(a=>a.requestId===c.attempts[0].requestId)),'REQUEST_ID_EXISTS');
      s.chains.push(c);return this.commit(s,now,'IMPORT_ORIGINAL',{key:budgetKey(c.scope)});
    });
  }
  chain(s,key) {const c=s.chains.find(c=>budgetKey(c.scope)===key);need(c,'unknown chain');return c;}
  async recordResult(token,revision,key,result,findings) {
    return this.locked(()=>{
      const s=this.load(),now=this.authorize(s,token,revision),c=this.chain(s,key);
      const existing=c.results.find(r=>r.resultId===result.resultId);
      if(existing) {
        need(JSON.stringify(existing)===JSON.stringify(result) && findings.every(f=>
          c.findings.some(old=>JSON.stringify(old)===JSON.stringify(f))),'result replay differs');
        return clone(s);
      }
      c.results.push(clone(result));c.findings.push(...clone(findings));
      policy.assess({...c,observedAt:new Date(now).toISOString()});
      return this.commit(s,now,'RESULT',{key,resultId:result.resultId});
    });
  }
  async disposeFinding(token,revision,key,id,disposition,current) {
    return this.locked(()=>{
      const s=this.load(),now=this.authorize(s,token,revision),c=this.chain(s,key),f=c.findings.find(f=>f.id===id);
      need(f && ['FIXED','DISMISSED'].includes(disposition.disposition) && nonempty(disposition.owner) &&
        nonempty(disposition.evidence),'finding disposition evidence required');
      policy.scopeKey(current);
      need(current.repo===c.scope.repo && current.pr===c.scope.pr,'unrelated disposition scope');
      Object.assign(f,{disposition:disposition.disposition,owner:disposition.owner,
        evidence:disposition.evidence,assessedScope:clone(current)});
      // Old-head evidence stays in its original chain; current assessment is recorded separately.
      return this.commit(s,now,'DISPOSITION',{key,id,disposition:clone(disposition),current:clone(current)});
    });
  }
  async reconcileDelivery(token,revision,key,requestId,receipt) {
    return this.locked(()=>{
      const s=this.load(),now=this.authorize(s,token,revision),c=this.chain(s,key);
      const a=c.attempts.find(a=>a.requestId===requestId);
      need(a && a.delivery!=='ACKNOWLEDGED' && nonempty(receipt),'exact observed request receipt required');
      a.delivery='ACKNOWLEDGED';a.requestReceipt=receipt;
      return this.commit(s,now,'RECONCILE_DELIVERY',{key,requestId,receipt});
    });
  }
  async dispatchReplacement(token,revision,key,{readCurrent,checkEligibility,send,afterIntent,afterSend}) {
    need(typeof readCurrent==='function'&&typeof send==='function'&&typeof checkEligibility==='function','injected observation/transport required');
    return this.locked(async()=>{
      const s=this.load();this.authorize(s,token,revision);
      const c=this.chain(s,key),current=clone(await this.bounded(()=>readCurrent(clone(c.scope))));
      policy.scopeKey(current);
      let now=this.authorize(s,token,revision);
      const eligible=async()=>{
        const e=await this.bounded(()=>checkEligibility({scope:clone(c.scope),owner:token.owner,fence:token.fence}));
        this.authorize(s,token,s.revision);
        return e?.allowed===true&&nonempty(e.receipt)&&e.scopeKey===policy.scopeKey(c.scope)&&
          e.owner===token.owner&&e.fence===token.fence ? clone(e) : null;
      };
      const eligibility=await eligible();
      now=this.authorize(s,token,revision);
      if(!eligibility) {
        this.commit(s,now,'ELIGIBILITY_BLOCKED',{key,nextOwner:c.nextOwner,next:c.next,nextTrigger:c.nextTrigger});
        return {action:'BLOCKED',reason:'EXISTING_GATES_NOT_SATISFIED'};
      }
      // Every retained finding for this PR, including old heads, must be accounted for.
      const priorOpen=s.chains.some(x=>x.scope.repo.toLowerCase()===current.repo.toLowerCase()&&x.scope.pr===current.pr&&
        x.findings.some(f=>f.disposition==='OPEN'||policy.scopeKey(f.assessedScope)!==policy.scopeKey(current)));
      const decision=policy.assess({...c,current,observedAt:new Date(now).toISOString()});
      if(priorOpen || decision.action!=='REPLACEMENT_CANDIDATE') {
        const d=priorOpen?{...decision,action:'BLOCKED',reason:'RETAINED_FINDING_DISPOSITION_REQUIRED'}:decision;
        this.commit(s,now,'DECISION',{key,current,decision:d});return d;
      }
      need(c.attempts[0].channel==='GITHUB_CODEX','only existing GitHub review transport; no channel conversion');
      c.attempts[0].timeoutReceipt='ledger-revision-'+(s.revision+1);
      const a={number:2,scope:clone(c.scope),requestId:randomUUID(),parentRequestId:c.attempts[0].requestId,
        owner:c.owner,intentAt:new Date(now).toISOString(),intentReceipt:'ledger-revision-'+(s.revision+1),
        delivery:'UNKNOWN',channel:'GITHUB_CODEX',cancelSupported:false,termination:'UNKNOWN',
        reservedBy:{owner:token.owner,fence:token.fence},eligibility};
      c.attempts.push(a);
      this.commit(s,now,'INTENT',{key,requestId:a.requestId,fence:token.fence});
      // UNKNOWN before invoking transport covers death both before and after send.
      if(afterIntent)await this.bounded(afterIntent);
      now=this.authorize(s,token,s.revision);
      const latest=await this.bounded(()=>readCurrent(clone(c.scope)));
      now=this.authorize(s,token,s.revision);
      if(policy.scopeKey(latest)!==policy.scopeKey(c.scope)) {
        this.commit(s,now,'SCOPE_CHANGED_AFTER_INTENT',{key,current:latest});
        return {action:'BLOCKED',reason:'SCOPE_CHANGED_AFTER_INTENT'};
      }
      const latestEligibility=await eligible();
      now=this.authorize(s,token,s.revision);
      if(!latestEligibility) {
        this.commit(s,now,'ELIGIBILITY_CHANGED_AFTER_INTENT',{key});
        return {action:'BLOCKED',reason:'EXISTING_GATES_NOT_SATISFIED'};
      }
      let receipt;
      try {receipt=await this.bounded(()=>send(clone(a)));if(afterSend)await this.bounded(afterSend);}
      catch(e) {return {action:'BLOCKED',reason:'UNCERTAIN_SEND',requestId:a.requestId};}
      // Expired owners may not acknowledge: durable UNKNOWN remains for exact-ID reconciliation.
      now=this.authorize(s,token,s.revision);
      need(nonempty(receipt),'transport receipt missing; UNKNOWN retained');
      a.delivery='ACKNOWLEDGED';a.requestReceipt=receipt;
      this.commit(s,now,'RECEIPT',{key,requestId:a.requestId,receipt});
      return {action:'REQUEST_RECORDED',requestId:a.requestId,gate:'NOT_ASSESSED'};
    });
  }
}
module.exports={ReviewLedger,budgetKey};
