'use strict';
// Request data for the existing scoped source-review CLI. Never installs a
// candidate, starts a service, writes a worker event or grants role authority.
const crypto=require('node:crypto');
const REPO='HeaInSeo/notion-projection-guard',ROW='40786e6dd1d1818086faf517ccee6238';
const TASK='GR-NPG-NORMAL-FRESHNESS-20261028',SESSION='1a591656-4902-4b98-a6cb-afca7eba849c';
const need=(v,k)=>{if(!v)throw Error('SOURCE_REVIEW_'+k);};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function requestKey(r){return sha(JSON.stringify([REPO,r.pr,r.head,r.base,r.tree,'guardrail',TASK,ROW,SESSION]));}
function prepare(request,observation,now=Date.now()){
  const r=JSON.parse(JSON.stringify(request)),o=JSON.parse(JSON.stringify(observation));
  need(r.repository===REPO&&Number.isSafeInteger(r.pr)&&r.pr>0&&r.role==='guardrail'&&r.taskId===TASK&&
    r.row===ROW&&r.sessionId===SESSION&&r.triggerKind==='MANUAL_SCOPED_SOURCE_REVIEW','SCOPE');
  for(const k of ['head','base','tree'])need(/^[a-f0-9]{40}$/.test(r[k]??''),'IDENTITY');
  const at=Date.parse(r.createdAt),observed=Date.parse(o.observedAt);
  need(Number.isFinite(at)&&Number.isFinite(observed)&&at<=now&&observed<=now&&
    now-at<300000&&now-observed<30000,'STALE');
  need(o.repository===REPO&&o.pr===r.pr&&o.state==='open'&&o.head===r.head&&
    o.base===r.base&&o.tree===r.tree&&o.clean===true,'CURRENT_SOURCE');
  need(o.currentOwn?.role==='guardrail'&&o.currentOwn.task_id===TASK&&
    o.currentOwn.session_id===SESSION&&o.currentOwn.kind==='RELEASE'&&
    o.currentOwn.lease_state==='RELEASED','COMPETING_OWNER');
  const key=requestKey(r);
  need(Array.isArray(o.priorRequestKeys)&&!o.priorRequestKeys.includes(key)&&
    !o.currentOwn.head_or_digest?.includes(r.head),'DUPLICATE');
  need(o.installedSource==='441624c4a0e34cc0ea874859f154711ef0af825b'&&
    o.legacyCaseLaunch?.gate==='READY'&&o.legacyCaseLaunch.scope==='GENERIC_SCAN_ONLY'&&
    o.sourceRowHook?.unrelated===true,'LEGACY_BOOTSTRAP');
  const payload=`MANUAL_SCOPED_SOURCE_REVIEW under the current direct user source-maintenance instruction. `+
    `Review only ${REPO} PR${r.pr} head ${r.head}, base ${r.base}, tree ${r.tree}, clean source ${r.sourceDirectory}. `+
    `Existing Guardrail task ${TASK}, row ${ROW}, same session ${SESSION}. Read the current own row, `+
    `role/domain authority and source first; independently refuse any conflict or newer owner. `+
    `This explicit source request selects the existing task; the generic hourly queue selector does not consume private request files. `+
    `The installed PR23 CLI and case hooks remain unchanged. Its operator admission applies only to the protected Sori original; `+
    `it grants no NPG or Sori Guardrail authority. No candidate installation or product projection precedes this review. `+
    `Record only your own genuine dated CLAIM, independent verdict and RELEASE on the existing NPG row and execution receipt, `+
    `with native/body parity and the exact input identity. Prior PASS is historical. No source edits, new task/session, `+
    `central/product/queue/canonical writes, Codex request, thread action, merge, install, replay or synthetic ACK. `+
    `The source request is not a CLAIM, PASS, product admission or Stage2 completion.`;
  const tools=['mcp__notion','mcp__claude_ai_Notion__notion-fetch','mcp__claude_ai_Notion__notion-search',
    'mcp__claude_ai_Notion__notion-query-data-sources','mcp__claude_ai_Notion__notion-update-page',
    'Bash(gh:*)','Bash(git:*)','Bash(date:*)','Bash(/home/heain/.local/bin/claude-role-alert.sh:*)','Read','Grep','Glob','TodoWrite'];
  need(typeof r.sourceDirectory==='string'&&r.sourceDirectory.startsWith('/')&&!r.sourceDirectory.includes('\0'),'SOURCE_PATH');
  return {schema:'NPG_SCOPED_SOURCE_REVIEW_REQUEST_V1',requestKey:key,request:r,
    route:'EXISTING_SCOPED_CLI',candidateInstallationRequired:false,workerClaimCreated:false,
    productionApplyAuthority:false,eligibilityIsNotAuthority:true,
    launchRequirements:['Hold the existing Guardrail role.lock through the worker lifetime',
      'Create one durable O_EXCL intent for this requestKey; any existing intent prevents duplicate launch',
      'Recheck exact remote/local source, current own event and competing leases immediately before launch',
      'Verify installed runtime integrity, auth, MCP and original case hooks without changing them',
      'Run LIVE usage gate immediately before launch; preserve command/PID/start/end/rc/stdout and monitor usage'],
    command:'/home/heain/.local/bin/claude',argv:['-p',payload,'--permission-mode','default',
      '--permission-prompts','none','--allowedTools',...tools,'--settings',
      '/home/heain/.local/share/notion-projection-guard/case-guardrail-settings.json',
      '--resume',SESSION,'--output-format','json']};
}
module.exports={prepare,requestKey,REPO,ROW,TASK,SESSION};
