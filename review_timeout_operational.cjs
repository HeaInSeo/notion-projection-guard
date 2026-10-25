'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {OperationalLedger,need,digest,readPrivate,writeNew,readOutboundRecords} =
  require('./review_timeout_operational_ledger.cjs');
const {budgetKey} = require('./review_timeout_ledger.cjs');
const {WARNING_MS,TIMEOUT_MS,scopeKey} = require('./review_timeout_policy.cjs');
const {runIsolated} = require('./review_timeout_isolated.cjs');
const {runTask} = require('./review_timeout_operational_worker.cjs');
const {migrate,decisionFor,bodyScope} = require('./review_timeout_history.cjs');
const {managedCommentMatches} = require('./review_timeout_evidence.cjs');
const {verify} = require('./verify_review_timeout_candidate.cjs');
const utc = () => new Date().toISOString();
function loadConfig(file) {
  const config = JSON.parse(readPrivate(file,0o444));
  need(config.version === 1 && config.channel === 'GITHUB_CODEX' &&
    typeof config.owner === 'string' && Array.isArray(config.allowedRepos) &&
    typeof config.requesterLogin==='string'&&config.requesterLogin.length>0&&
    Array.isArray(config.seedTargets) && path.isAbsolute(config.directory) &&
    path.isAbsolute(config.evidenceDirectory),'invalid operational configuration');
  return config;
}
function ensureLocal(directory) {
  const type = fs.statfsSync(directory).type;
  need(type !== 0x6969 && type !== 0x517b,'NFS/SMB ledger unsupported');
  const s = fs.lstatSync(directory);
  need(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() &&
    (s.mode & 0o777) === 0o700 && fs.realpathSync(directory) === path.resolve(directory),
  'owned local canonical 0700 directory required');
}
function quarantineForLegacy(config,snapshot,migrations) {
  const ids = new Set(snapshot.comments.map(c => String(c.id)));
  for (const h of config.legacyConstraints ?? []) {
    if (h.repo.toLowerCase() !== snapshot.repo.toLowerCase() || h.pr !== snapshot.pr) continue;
    need(typeof h.evidence === 'string' && h.evidence.length > 0,'legacy constraint evidence required');
    if (h.budgetAlreadyConsumed || h.requestIds.some(id => !ids.has(String(id)))) {
      migrations.quarantine.push({repo:snapshot.repo,pr:snapshot.pr,key:h.key ?? null,
        reason:h.budgetAlreadyConsumed ? 'PREEXISTING_REPLACEMENT_BUDGET_CONSUMED' :
          'LOCAL_HISTORY_REQUEST_NOT_FOUND_IN_PROVIDER',
        requestIds:h.requestIds.map(String),legacyEvidence:h.evidence});
    }
  }
}
function barrierFor(config,scope) {
  const p = config.canonicalJournal;
  need(p && fs.lstatSync(p).isFile() && !fs.lstatSync(p).isSymbolicLink() &&
    fs.realpathSync(p) === p,'existing canonical journal unavailable');
  const state = JSON.parse(fs.readFileSync(p,'utf8'));
  if (!state.active) return null;
  const affected = config.barrierScopes?.[state.active];
  const pin=config.barrierPlanHashes?.[state.active],actual=state.batches?.[state.active]?.planHash;
  if (Array.isArray(affected) && /^[a-f0-9]{64}$/.test(pin??'') &&
    /^[a-f0-9]{64}$/.test(actual??'') && pin===actual &&
    !affected.map(x => x.toLowerCase()).includes(scope.repo.toLowerCase())) return null;
  return {reason:'EXISTING_CANONICAL_BARRIER',batch:state.active,
    status:state.batches?.[state.active]?.status ?? 'UNKNOWN'};
}
function scheduledProof(config,input) {
  if (input.origin !== 'SCHEDULED') return null;
  const proof = JSON.parse(readPrivate(input.schedulerEvidenceFile));
  need(proof.source === 'AUTOMATIONS_PEEK' && proof.automationId === config.automationId &&
    proof.isEnabled === true && proof.schedule === config.schedule &&
    proof.run?.id === input.runId && proof.run.recorded_status === 'in_progress' &&
    Number.isFinite(Date.parse(proof.run.started_at)) &&
    Date.parse(proof.run.started_at) <= Date.now() &&
    Date.now() - Date.parse(proof.retrievedAt) >= 0 &&
    Date.now() - Date.parse(proof.retrievedAt) <= 120000,
  'actual currently running scheduled automation evidence required');
  const start = config.schedule.match(/DTSTART(?:;[^:]*)?:(\d{8})T(\d{2})(\d{2})(\d{2})Z?/);
  const scheduled = new Date(proof.run.scheduled_for);
  need(start && config.schedule.includes('RRULE:FREQ=HOURLY') &&
    Number.isFinite(scheduled.getTime()) &&
    scheduled.getUTCMinutes() === Number(start[3]) &&
    scheduled.getUTCSeconds() === Number(start[4]),
  'manual/immediate run is not a regular hourly adoption receipt');
  return {file:input.schedulerEvidenceFile,sha256:digest(readPrivate(input.schedulerEvidenceFile)),
    runId:proof.run.id,scheduledFor:proof.run.scheduled_for,startedAt:proof.run.started_at};
}
async function tick(config,input,{observer = runTask} = {}) {
  need(['SCHEDULED','MANUAL_VERIFICATION'].includes(input.origin) &&
    typeof input.runId === 'string' && input.runId.length > 0,'explicit run origin/ID required');
  const proof = scheduledProof(config,input);
  if (input.origin === 'SCHEDULED') need(input.actor === config.owner,'scheduled owner mismatch');
  ensureLocal(config.directory); ensureLocal(config.evidenceDirectory);
  const startedAt = utc(), targets = new Map();
  const add = t => {
    need(config.allowedRepos.map(x => x.toLowerCase()).includes(t.repo.toLowerCase()) &&
      Number.isSafeInteger(t.pr) && t.pr > 0,'target outside configured scope');
    targets.set(t.repo.toLowerCase() + '#' + t.pr,t);
  };
  config.seedTargets.forEach(add);
  const errors = [];
  if (config.discoverOpen !== false) for (const repo of config.allowedRepos) {
    const r = await observer({operation:'discover',repo,timeoutMs:30000});
    if (r.action === 'DISCOVERED') r.targets.forEach(add);
    else errors.push({repo,reason:r.reason ?? 'DISCOVERY_INCOMPLETE'});
  }
  const observations = [];
  for (const target of targets.values()) {
    const r = await observer({operation:'observe',...target,timeoutMs:30000});
    if (r.action !== 'OBSERVED') { errors.push({...target,reason:r.reason}); continue; }
    need(r.snapshot.complete === true,'partial history cannot establish capacity');
    const evidence = writeNew(config.evidenceDirectory,
      'provider-' + crypto.randomUUID() + '.json',r.snapshot);
    observations.push({snapshot:r.snapshot,evidence});
  }
  const ledger = new OperationalLedger(config.directory);
  let state = await ledger.read();
  const token = await ledger.acquire(input.actor,300000,state.revision);
  const decisions = [];
  try {
    for (const {snapshot,evidence} of observations) {
      try {
      state = await ledger.read();
      const migration = {quarantine:[]};
      quarantineForLegacy(config,snapshot,migration);
      state = await ledger.importObserved(token,state.revision,evidence,{
        owner:config.owner,requesterLogin:config.requesterLogin,quarantine:migration.quarantine});
      for (const c of state.chains.filter(c =>
        c.scope.repo.toLowerCase() === snapshot.repo.toLowerCase() && c.scope.pr === snapshot.pr)) {
        let d = decisionFor(c,state,snapshot);
        const barrier = barrierFor(config,c.scope);
        if (d.action === 'REPLACEMENT_CANDIDATE' && barrier)
          d = {...d,action:'BLOCKED',reason:barrier.reason,barrier,
            policyCandidatePreserved:true};
        decisions.push({repo:c.scope.repo,pr:c.scope.pr,head:c.scope.head,base:c.scope.base,...d});
      }
      for (const q of state.historyQuarantine.filter(q =>
        q.repo.toLowerCase() === snapshot.repo.toLowerCase() && q.pr === snapshot.pr &&
        (!q.key || !state.chains.some(c => budgetKey(c.scope) === q.key)))) {
        const requested = snapshot.comments.filter(c => q.requestIds.includes(String(c.id)));
        const time = requested.length ? Math.max(...requested.map(c => Date.parse(c.created_at))) : null;
        decisions.push({repo:q.repo,pr:q.pr,action:'BLOCKED',
          reason:'HISTORY_RECONCILIATION_REQUIRED',historyReason:q.reason,
          warning:time === null ? null : Date.now() - time >= WARNING_MS,
          timedOut:time === null ? null : Date.now() - time > TIMEOUT_MS,
          owner:config.owner,nextOwner:config.owner,
          next:'Reconcile the complete preserved legacy lineage without resetting its budget.',
          nextTrigger:'Reviewed exact history reconciliation.',gate:'NOT_ASSESSED',
          dispatchAuthorized:false,retainedEvidence:q.evidence});
      }
      } catch(error) {
        errors.push({repo:snapshot.repo,pr:snapshot.pr,reason:'SCOPE_HISTORY_RECONCILIATION_REQUIRED',
          detail:String(error.message).slice(0,250)});
        decisions.push({repo:snapshot.repo,pr:snapshot.pr,action:'BLOCKED',
          reason:'SCOPE_HISTORY_RECONCILIATION_REQUIRED',owner:config.owner,nextOwner:config.owner,
          next:'Reconcile this preserved scope history; do not infer free budget.',
          nextTrigger:'Verified same-scope reconciliation.',gate:'NOT_ASSESSED',dispatchAuthorized:false});
      }
    }
    state = await ledger.read();
    await ledger.release(token,state.revision);
  } catch (error) {
    // No deletion/reset/reinitialization, even on an interrupted import.
    throw error;
  }
  const receipt = {version:1,contract:'REVIEW-TIMEOUT-20261025-v1',
    origin:input.origin,runId:input.runId,actor:input.actor,scheduledProof:proof,
    startedAt,completedAt:utc(),warningMs:WARNING_MS,timeoutMs:TIMEOUT_MS,
    replacementLimit:1,canonicalDirectory:config.directory,ownerFence:token.fence,
    isolatedProviderObservations:true,replacementEntry:'review_timeout_isolated.cjs:runIsolated',
    originalEntry:'review_timeout_operational_worker.cjs:runTask',
    scopeCoverage:errors.length ? 'PARTIAL' : 'CONFIGURED_SCOPES_COMPLETE',
    configuredScopeCount:targets.size,observedScopeCount:observations.length,
    errors,decisions,newRequests:0,replacementRequests:0,providerTermination:'UNKNOWN',
    gate:'NOT_ASSESSED',wipContract:'SEPARATE_UNCHANGED'};
  const evidence = writeNew(config.evidenceDirectory,'decision-' + crypto.randomUUID() + '.json',receipt);
  return {receipt,evidence};
}
async function prepare(config,input) {
  need(input.actor === config.owner && input.origin === 'SCHEDULED','existing scheduled owner required');
  const proof = scheduledProof(config,input);
  scopeKey(input.scope);
  need(config.allowedRepos.map(x => x.toLowerCase()).includes(input.scope.repo.toLowerCase()),
    'unregistered repository');
  const ledger = new OperationalLedger(config.directory);
  let state = await ledger.read();
  const token = await ledger.acquire(input.actor,300000,state.revision);
  const context = {version:1,token,scope:input.scope,runId:input.runId,origin:input.origin,
    owner:input.actor,configFile:input.configFile,scheduledProof:proof,
    handoff:input.handoff,createdAt:utc()};
  const evidence = writeNew(config.evidenceDirectory,'prepared-' + crypto.randomUUID() + '.json',context);
  return {contextFile:evidence.file,contextSha256:evidence.sha256,owner:token.owner,
    fence:token.fence,scope:input.scope,runId:input.runId,
    next:'The existing central policy owner must write a fresh <=60s full-gate source attestation.'};
}
async function dispatch(config,input,kind) {
  need(config.dispatchEnabled === true,'dispatch disabled');
  const prepared = JSON.parse(readPrivate(input.contextFile));
  need(prepared.owner === config.owner && prepared.origin === 'SCHEDULED','invalid prepared owner');
  const ledger = new OperationalLedger(config.directory);
  let state = await ledger.read();
  ledger.authorize(state,prepared.token,state.revision);
  need(!barrierFor(config,prepared.scope),'existing canonical barrier blocks dispatch');
  const common = {directory:config.directory,token:prepared.token,revision:state.revision,
    timeoutMs:30000,ioTimeoutMs:10000,context:{owner:prepared.owner,runId:prepared.runId,
      configFile:prepared.configFile,grantFile:input.grantFile,kind,
      token:prepared.token}};
  let result;
  if (kind === 'replacement') {
    need(!(state.historyQuarantine ?? []).some(q =>
      q.repo.toLowerCase() === prepared.scope.repo.toLowerCase() && q.pr === prepared.scope.pr &&
      (!q.key || q.key === budgetKey(prepared.scope))),'history quarantine blocks replacement');
    result = await runIsolated({...common,key:budgetKey(prepared.scope),
      transportModule:path.join(__dirname,'review_timeout_github.cjs')});
  } else {
    result = await runTask({...common,operation:'original',scope:prepared.scope,
      handoff:prepared.handoff});
  }
  state = await ledger.read();
  // An unconfirmed supervisor exit must not release a potentially live local worker.
  if (result.reason !== 'SUPERVISOR_EXIT_OUTCOME_UNKNOWN')
    await ledger.release(prepared.token,state.revision);
  const receipt = {version:1,kind,origin:'SCHEDULED',runId:prepared.runId,at:utc(),result,
    providerTermination:'UNKNOWN',gate:'NOT_ASSESSED',entry:kind === 'replacement' ?
      'review_timeout_isolated.cjs:runIsolated' : 'review_timeout_operational_worker.cjs:runTask'};
  const evidence = writeNew(config.evidenceDirectory,'dispatch-' + crypto.randomUUID() + '.json',receipt);
  return {receipt,evidence};
}
async function reconcile(config,input,{observer=runTask}={}) {
  const prepared = JSON.parse(readPrivate(input.contextFile));
  need(prepared.owner === config.owner && prepared.origin === 'SCHEDULED','invalid prepared owner');
  const ledger = new OperationalLedger(config.directory);
  let state = await ledger.read();
  ledger.authorize(state,prepared.token,state.revision);
  const key = budgetKey(prepared.scope);
  const chain = state.chains.find(c => budgetKey(c.scope) === key);
  const attempt = chain?.attempts.find(a => a.requestId === input.requestId);
  need(attempt && attempt.delivery !== 'ACKNOWLEDGED','exact uncertain intent required');
  const outbound=readOutboundRecords(config.directory,state,config.requesterLogin,prepared.scope)[attempt.requestId];
  const r = await observer({operation:'observe',repo:prepared.scope.repo,
    pr:prepared.scope.pr,timeoutMs:30000});
  need(r.action === 'OBSERVED','complete provider lookup unavailable; keep UNKNOWN');
  const evidence = writeNew(config.evidenceDirectory,
    'delivery-lookup-' + crypto.randomUUID() + '.json',r.snapshot);
  state=await ledger.importObserved(prepared.token,state.revision,evidence,{
    owner:config.owner,requesterLogin:config.requesterLogin});
  const matches = r.snapshot.comments.filter(c =>
    managedCommentMatches(c,chain,attempt,r.snapshot,outbound,config.requesterLogin));
  let result = {action:'BLOCKED',reason:'EXACT_DELIVERY_NOT_PROVEN_KEEP_UNKNOWN',
    requestId:attempt.requestId};
  if (matches.length === 1) {
    state = await ledger.read();
    const receipt = JSON.stringify({requestId:attempt.requestId,commentId:matches[0].id,
      url:matches[0].html_url,scope:attempt.scope,evidence,requester:matches[0].user.login,
      bodySha256:outbound.bodySha256,providerTermination:'UNKNOWN'});
    await ledger.reconcileDelivery(prepared.token,state.revision,key,attempt.requestId,receipt);
    result = {action:'DELIVERY_RECONCILED',requestId:attempt.requestId,commentId:matches[0].id};
  }
  state = await ledger.read();
  await ledger.release(prepared.token,state.revision);
  return {result,evidence,newRequests:0,providerTermination:'UNKNOWN',gate:'NOT_ASSESSED'};
}
async function disposeFinding(config,input) {
  const prepared=JSON.parse(readPrivate(input.contextFile));
  need(prepared.owner===config.owner&&prepared.origin==='SCHEDULED','invalid prepared owner');
  const ledger=new OperationalLedger(config.directory);
  let state=await ledger.read();
  ledger.authorize(state,prepared.token,state.revision);
  const packet=JSON.parse(readPrivate(input.dispositionFile));
  need(scopeKey(packet.assessedScope)===scopeKey(prepared.scope),'assessment/prepared scope mismatch');
  const observed=await runTask({operation:'observe',repo:prepared.scope.repo,
    pr:prepared.scope.pr,timeoutMs:30000});
  need(observed.action==='OBSERVED'&&
    scopeKey(observed.snapshot.current)===scopeKey(packet.assessedScope),
  'fresh actual provider scope required for finding disposition');
  const observation=writeNew(config.evidenceDirectory,
    'finding-assessment-observation-'+crypto.randomUUID()+'.json',observed.snapshot);
  state=await ledger.importObserved(prepared.token,state.revision,observation,{
    owner:config.owner,requesterLogin:config.requesterLogin});
  const evidence=writeNew(config.evidenceDirectory,
    'finding-disposition-'+crypto.randomUUID()+'.json',packet);
  await ledger.disposeProviderFinding(prepared.token,state.revision,packet.findingId,evidence);
  state=await ledger.read();await ledger.release(prepared.token,state.revision);
  return {action:'FINDING_DISPOSITION_RECORDED',findingId:packet.findingId,evidence,
    gate:'NOT_ASSESSED',newRequests:0};
}
async function main(argv) {
  const command = argv[0], flags = {};
  for (let i = 1; i < argv.length; i += 2) {
    need(argv[i]?.startsWith('--') && typeof argv[i+1] === 'string','named CLI arguments required');
    flags[argv[i].slice(2)] = argv[i+1];
  }
  need(flags.config,'--config required');
  // Verify the original immutable PR9 candidate without turning it into an installation receipt.
  verify(__dirname);
  const config = loadConfig(flags.config);
  let input = flags.input ? JSON.parse(readPrivate(flags.input)) : {};
  input = {...input,configFile:flags.config};
  if (command === 'initialize') {
    need(!fs.existsSync(config.directory),'explicit new canonical directory only');
    fs.mkdirSync(config.directory,{mode:0o700});
    ensureLocal(config.directory);
    const l = new OperationalLedger(config.directory);
    return {action:'INITIALIZED_ONCE',revision:(await l.initialize()).revision,
      canonicalDirectory:config.directory};
  }
  if (command === 'tick') return tick(config,input);
  if (command === 'prepare') return prepare(config,input);
  if (command === 'send-original') return dispatch(config,input,'original');
  if (command === 'send-replacement') return dispatch(config,input,'replacement');
  if (command === 'reconcile-delivery') return reconcile(config,input);
  if (command === 'dispose-finding') return disposeFinding(config,input);
  throw Error('unknown operational command');
}
if (require.main === module) main(process.argv.slice(2)).then(
  result => process.stdout.write(JSON.stringify(result) + '\n'),
  error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
module.exports = {loadConfig,ensureLocal,quarantineForLegacy,barrierFor,scheduledProof,
  tick,prepare,dispatch,reconcile,disposeFinding,main};
