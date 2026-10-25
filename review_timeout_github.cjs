'use strict';
// Trusted GitHub adapter. Native HTTPS, bounded calls, no transport retries.
const fs = require('node:fs');
const https = require('node:https');
const {execFileSync} = require('node:child_process');
const {scopeKey} = require('./review_timeout_policy.cjs');
const {need,digest,readPrivate,writeNew,persistObservationInbox,readObservationInbox,
  readOutboundRecords,retainedFindingHolds} = require('./review_timeout_operational_ledger.cjs');
const {outboundRecord,providerFindings,combineHistory} = require('./review_timeout_evidence.cjs');
const {migrate,opaqueActivities,activityResolution,activityBudgetCoverage,terminalObservationBlocks,
  retainedTerminalObservations} =
  require('./review_timeout_history.cjs');
const BOT = 'chatgpt-codex-connector[bot]';
const REQUIRED_GATES = ['authority','wip','singleWriter','workerRelease','independentReview',
  'uncertainWrite','usage','currentHead','findingDisposition','ci'];
function githubClient() {
  // Reuse the already authenticated CLI identity. Never persist or emit its token.
  const token = execFileSync('/usr/bin/gh',['auth','token'],
    {encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}).trim();
  need(token.length > 0,'existing GitHub authentication unavailable');
  return function api(method, route, body) {
    need(['GET','POST'].includes(method) && typeof route === 'string' &&
      route.startsWith('/') && !route.startsWith('//'),'invalid provider route');
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve,reject) => {
      let settled = false;
      const finish = (error,value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const req = https.request({hostname:'api.github.com',port:443,path:route,method,
        agent:false,headers:{Authorization:'Bearer ' + token,Accept:'application/vnd.github+json',
          'X-GitHub-Api-Version':'2022-11-28','User-Agent':'review-timeout-owner',
          ...(payload ? {'Content-Type':'application/json',
            'Content-Length':Buffer.byteLength(payload)} : {})}},res => {
        let size = 0; const chunks = [];
        res.on('data',chunk => {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) req.destroy(Error('PROVIDER_RESPONSE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        res.on('error',error => finish(error));
        res.on('end',() => {
          if (res.statusCode < 200 || res.statusCode >= 300)
            return finish(Error('GITHUB_HTTP_' + res.statusCode)); // Do not follow redirects.
          try { finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(Error('GITHUB_INVALID_JSON')); }
        });
      });
      const timer = setTimeout(() => req.destroy(Error('PROVIDER_IO_TIMEOUT')),8000);
      req.on('error',error => finish(error));
      if (payload) req.write(payload);
      req.end();
    });
  };
}
async function pages(api, route) {
  const all = [];
  for (let page = 1; page <= 10000; page++) {
    const data = await api('GET',route + '?per_page=100&page=' + page);
    need(Array.isArray(data),'provider array required');
    all.push(...data);
    if (data.length < 100) return all;
  }
  throw Error('HISTORY_PAGINATION_INCOMPLETE');
}
const THREAD_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated resolvedBy{login} comments(first:100){pageInfo{hasNextPage endCursor} nodes{databaseId body createdAt updatedAt url author{login} commit{oid} originalCommit{oid} replyTo{databaseId}}}}}}}}';
const COMMENT_QUERY = 'query($id:ID!,$after:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{databaseId body createdAt updatedAt url author{login} commit{oid} originalCommit{oid} replyTo{databaseId}}}}}';
async function threads(api,repo,pr) {
  const [owner,name] = repo.split('/'); const all = []; let after = null;
  do {
    const result = await api('POST','/graphql',{query:THREAD_QUERY,
      variables:{owner,name,number:pr,after}});
    need(!result.errors,'provider GraphQL error');
    const page = result.data?.repository?.pullRequest?.reviewThreads;
    need(page && Array.isArray(page.nodes),'complete review threads required');
    for (const t of page.nodes) {
      while (t.comments.pageInfo.hasNextPage) {
        const r = await api('POST','/graphql',{query:COMMENT_QUERY,
          variables:{id:t.id,after:t.comments.pageInfo.endCursor}});
        need(!r.errors && r.data?.node?.comments,'incomplete finding comments');
        t.comments.nodes.push(...r.data.node.comments.nodes);
        t.comments.pageInfo = r.data.node.comments.pageInfo;
      }
      all.push(t);
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    need(!page.pageInfo.hasNextPage || typeof after === 'string','missing provider cursor');
  } while (after);
  return all;
}
function currentScope(repo,pr,metadata) {
  return {repo,pr,head:metadata.head.sha,base:metadata.base.sha};
}
async function observe(api,repo,pr) {
  scopeKey({repo,pr,head:'a'.repeat(40),base:'b'.repeat(40)});
  const root = '/repos/' + repo;
  const before = await api('GET',root + '/pulls/' + pr);
  const [comments,reviews,inlineComments,reviewThreads] = await Promise.all([
    pages(api,root + '/issues/' + pr + '/comments'),
    pages(api,root + '/pulls/' + pr + '/reviews'),
    pages(api,root + '/pulls/' + pr + '/comments'),
    threads(api,repo,pr)
  ]);
  const after = await api('GET',root + '/pulls/' + pr);
  need(scopeKey(currentScope(repo,pr,before)) === scopeKey(currentScope(repo,pr,after)),
    'provider scope changed during history scan');
  return {version:1,repo,pr,observedAt:new Date().toISOString(),complete:true,
    current:currentScope(repo,pr,after),metadata:after,comments,reviews,inlineComments,
    threads:reviewThreads,provider:'GITHUB_CODEX',providerCancellation:'UNSUPPORTED',
    completeness:'All REST pages and all GraphQL thread/comment pages exhausted.'};
}
function validateGrant(grant, expected, now = Date.now()) {
  need(grant?.version === 1 && grant.owner === expected.owner &&
    grant.fence === expected.fence && scopeKey(grant.scope) === scopeKey(expected.scope),
  'eligibility owner/fence/scope mismatch');
  const age = now - Date.parse(grant.observedAt);
  need(Number.isFinite(age) && age >= 0 && age <= 60000 &&
    now < Date.parse(grant.expiresAt) &&
    Date.parse(grant.expiresAt) - Date.parse(grant.observedAt) <= 60000,
  'stale eligibility evidence');
  need(Array.isArray(grant.sources) && grant.sources.length > 0,'fresh source evidence required');
  const ids = new Set();
  for (const source of grant.sources) {
    need(typeof source.id === 'string' && !ids.has(source.id) &&
      typeof source.content === 'string' && digest(source.content) === source.sha256 &&
      Number.isFinite(Date.parse(source.retrievedAt)) &&
      now >= Date.parse(source.retrievedAt) && now - Date.parse(source.retrievedAt) <= 60000 &&
      typeof source.url === 'string' && source.url.length > 0,'invalid eligibility source');
    ids.add(source.id);
  }
  need(grant.gates && Object.keys(grant.gates).length === REQUIRED_GATES.length,
    'complete existing gates required');
  for (const gate of REQUIRED_GATES) {
    const g = grant.gates[gate];
    need(g?.state === 'PASS' && Array.isArray(g.sourceIds) && g.sourceIds.length > 0 &&
      g.sourceIds.every(id => ids.has(id)) && typeof g.explanation === 'string' &&
      g.explanation.length > 0,'existing gate denied or unevidenced: ' + gate);
  }
  need(grant.sourceEvaluator === 'EXISTING_CENTRAL_POLICY_OWNER' &&
    grant.runId === expected.runId,'existing policy owner attestation required');
  return true;
}
function canonicalBarrier(config, scope) {
  const file = config.canonicalJournal;
  const before = fs.statSync(file);
  need(before.isFile() && !fs.lstatSync(file).isSymbolicLink() &&
    fs.realpathSync(file) === file,'canonical journal unavailable');
  const bytes = fs.readFileSync(file,'utf8');
  const state = JSON.parse(bytes);
  if (!state.active) return null;
  const affected = config.barrierScopes?.[state.active];
  // A positively scoped unrelated barrier does not block an independent repo.
  const pin=config.barrierPlanHashes?.[state.active],actual=state.batches?.[state.active]?.planHash;
  if (Array.isArray(affected) && /^[a-f0-9]{64}$/.test(pin??'') &&
    /^[a-f0-9]{64}$/.test(actual??'') &&
    pin===actual &&
    !affected.map(x => x.toLowerCase()).includes(scope.repo.toLowerCase()))
    return null;
  return {reason:'EXISTING_CANONICAL_BARRIER',batch:state.active,
    status:state.batches?.[state.active]?.status ?? 'UNKNOWN',sha256:digest(bytes)};
}
function ownedState(config,context,fence) {
  const state=JSON.parse(readPrivate(config.directory+'/review-attempts.json'));
  need(state.lease&&context.token&&state.lease.id===context.token.id&&
    state.lease.owner===context.owner&&state.lease.fence===fence&&
    Date.now()<state.lease.expiresAt,'owner expired before actual provider operation');
  return state;
}
function providerStateHolds(config,state,scope,kind=null) {
  const history=readObservationInbox(config.directory,scope);
  const pending=history.flatMap(h=>providerFindings(h.snapshot));
  const findings=retainedFindingHolds(state,scope,pending);
  if(findings.length)return {reason:'PROVIDER_FINDING_DISPOSITION_REQUIRED',findingIds:findings};
  if((state.historyQuarantine??[]).some(q=>q.repo.toLowerCase()===scope.repo.toLowerCase()&&
    q.pr===scope.pr&&(!q.key||q.key===JSON.stringify([scope.repo.toLowerCase(),scope.pr,scope.head]))))
    return {reason:'DURABLE_HISTORY_QUARANTINE'};
  if(!history.length)return {reason:'PROVIDER_HISTORY_NOT_OBSERVED'};
  const combined=combineHistory(history.map(h=>h.snapshot));
  const activities=new Map((state.providerActivities??[]).filter(a=>
    a.repo.toLowerCase()===scope.repo.toLowerCase()&&a.pr===scope.pr)
    .map(a=>[a.id,a]));
  for(const a of opaqueActivities(history,state.chains))activities.set(a.id,a);
  for(const activity of [...activities.values()].filter(a=>a.head==='UNKNOWN'||a.head===scope.head)) {
    const recorded=(state.providerActivities??[]).find(a=>a.id===activity.id);
    const coverage=activityBudgetCoverage(activity,state.chains);
    if(coverage&&recorded?.status==='BUDGET_ACCOUNTED'&&
      recorded.resolution?.requestId===coverage.requestId)continue;
    const proof=activityResolution(activity,history,state.chains,state.historyQuarantine??[]);
    if(recorded?.status!=='PRE_FORMAL_PHASE_CONSUMED'||!proof||
      recorded.resolution?.evidence.sha256!==proof.evidence.sha256)
      return {reason:'INFLIGHT_PROVIDER_LINEAGE_REQUIRES_RECONCILIATION',activityId:activity.id};
  }
  const chain=state.chains.find(c=>c.scope.repo.toLowerCase()===scope.repo.toLowerCase()&&
    c.scope.pr===scope.pr&&c.scope.head===scope.head);
  // During a replacement's reservation/POST, an original finishing must stop
  // the extra request even if its result predates newly reserved attempt 2.
  const terminal=kind==='replacement'&&chain?retainedTerminalObservations(state,history)
    .filter(p=>terminalObservationBlocks(p,scope,chain.attempts[0].intentAt)):[];
  if(terminal.length)
    return {reason:'SHARED_SUMMARY_RESULTS_RECONCILIATION_REQUIRED',
      retainedTerminalIds:terminal.map(p=>p.id)};
  const migration=migrate(combined,'durable-observation-inbox',config.owner,state.chains,
    {requesterLogin:config.requesterLogin,
      outbound:readOutboundRecords(config.directory,state,config.requesterLogin,scope)});
  if(migration.quarantine.length)return {reason:'UNRECONCILED_PROVIDER_REQUEST'};
  for(const c of migration.chains) {
    const known=state.chains.find(x=>x.scope.repo.toLowerCase()===c.scope.repo.toLowerCase()&&
      x.scope.pr===c.scope.pr&&x.scope.head===c.scope.head);
    const ids=new Set((known?.attempts??[]).map(a=>String(a.providerCommentId??a.requestId)));
    if(c.attempts.some(a=>!ids.has(String(a.providerCommentId??a.requestId))))
      return {reason:'PROVIDER_REQUEST_NOT_IN_DURABLE_LEDGER'};
  }
  return null;
}
function makeTransport(config,context,api) {
  need(config.version === 1 && config.channel === 'GITHUB_CODEX' &&
    config.owner === context.owner && Array.isArray(config.allowedRepos)&&
    typeof config.requesterLogin==='string'&&config.requesterLogin.length>0,
  'invalid provider configuration');
  const permitted = scope => need(config.allowedRepos.map(x => x.toLowerCase())
    .includes(scope.repo.toLowerCase()),'repository is outside existing authority');
  return {
    readCurrent:async scope => {
      permitted(scope);
      return currentScope(scope.repo,scope.pr,
        await api('GET','/repos/' + scope.repo + '/pulls/' + scope.pr));
    },
    checkEligibility:async expected => {
      permitted(expected.scope);
      if (config.dispatchEnabled !== true) return {allowed:false,reason:'DISPATCH_DISABLED'};
      const barrier = canonicalBarrier(config,expected.scope);
      if (barrier) return {allowed:false,...barrier};
      const grantBytes = readPrivate(context.grantFile);
      const grant = JSON.parse(grantBytes);
      validateGrant(grant,{...expected,runId:context.runId});
      const fresh = await observe(api,expected.scope.repo,expected.scope.pr);
      let state=ownedState(config,context,expected.fence);
      persistObservationInbox(config.directory,fresh);
      state=ownedState(config,context,expected.fence);
      if (fresh.metadata.state !== 'open' || fresh.metadata.draft === true ||
        scopeKey(fresh.current) !== scopeKey(expected.scope))
        return {allowed:false,reason:'SCOPE_OR_PR_STATE_CHANGED'};
      const held=providerStateHolds(config,state,expected.scope,context.kind);
      if(held)return {allowed:false,...held};
      return {allowed:true,scopeKey:scopeKey(expected.scope),owner:expected.owner,
        fence:expected.fence,receipt:'central-grant-sha256:' + digest(grantBytes)};
    },
    send:async attempt => {
      permitted(attempt.scope);
      const route = '/repos/' + attempt.scope.repo + '/pulls/' + attempt.scope.pr;
      ownedState(config,context,attempt.reservedBy.fence);
      const fresh = await observe(api,attempt.scope.repo,attempt.scope.pr);
      let state=ownedState(config,context,attempt.reservedBy.fence);
      persistObservationInbox(config.directory,fresh);
      const before=fresh.metadata;
      need(before.state === 'open' && !before.draft &&
        scopeKey(fresh.current) ===
        scopeKey(attempt.scope),'scope changed before provider send');
      const record=outboundRecord(attempt,config.requesterLogin),body=record.body;
      state=ownedState(config,context,attempt.reservedBy.fence);
      const recorded = state.chains.flatMap(c => c.attempts)
        .find(a => a.requestId === attempt.requestId);
      need(recorded && recorded.delivery === 'UNKNOWN' &&
        scopeKey(recorded.scope) === scopeKey(attempt.scope) &&
        recorded.parentRequestId === attempt.parentRequestId &&
        recorded.reservedBy?.owner === context.owner &&
        recorded.reservedBy?.fence === attempt.reservedBy.fence,
      'canonical pre-send intent required');
      // Immutable full outbound bytes exist durably before POST. An existing
      // file is never overwritten or reused to repeat an uncertain send.
      const outbound=writeNew(config.directory,'outbound-'+attempt.requestId+'.json',record);
      state=ownedState(config,context,attempt.reservedBy.fence);
      // readCurrent itself awaits network I/O. Recheck expiring source authority
      // and a newly raised barrier at the last synchronous point before POST.
      need(!canonicalBarrier(config,attempt.scope),'canonical barrier raised before actual POST');
      validateGrant(JSON.parse(readPrivate(context.grantFile)),{
        scope:attempt.scope,owner:context.owner,fence:attempt.reservedBy.fence,
        runId:context.runId});
      need(!providerStateHolds(config,state,attempt.scope,context.kind),
        'retained provider evidence blocks actual POST');
      // Exactly one POST. A socket failure or non-2xx outcome is not retried.
      const sent = await api('POST','/repos/' + attempt.scope.repo + '/issues/' +
        attempt.scope.pr + '/comments',{body});
      need(sent.body === body && sent.user?.login===config.requesterLogin&&Number.isSafeInteger(sent.id) &&
        typeof sent.html_url === 'string','provider receipt mismatch');
      const after = await api('GET',route);
      need(scopeKey(currentScope(attempt.scope.repo,attempt.scope.pr,after)) ===
        scopeKey(attempt.scope),'scope changed after provider send; outcome UNKNOWN');
      return JSON.stringify({provider:'GITHUB_CODEX',requestId:attempt.requestId,
        commentId:sent.id,url:sent.html_url,scope:attempt.scope,requester:sent.user.login,
        outboundEvidence:outbound,bodySha256:record.bodySha256,
        binding:'EXPLICIT_COMMIT_IN_REQUEST_AND_PRE_POST_SCOPE_CHECKS',
        atomicProviderHeadFence:false,providerTermination:'UNKNOWN'});
    }
  };
}
async function createTransport(context) {
  need(process.argv[2] === '--worker' && process.connected === true,
    'operational transport requires an isolated worker');
  const config = JSON.parse(readPrivate(context.configFile,0o444));
  return makeTransport(config,context,githubClient());
}
module.exports = {githubClient,pages,threads,observe,currentScope,validateGrant,
  canonicalBarrier,makeTransport,createTransport,REQUIRED_GATES,providerStateHolds};
