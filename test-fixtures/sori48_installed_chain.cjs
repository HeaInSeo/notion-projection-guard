'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const clone=x=>JSON.parse(JSON.stringify(x));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const BODY_BATCH='SORI48-PAIR-ADMIT-CORRECTED-20261030';
const BATCH='SORI48-PAIR-METADATA-CORRECTED-20261030';
const BODY_IDS=['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7',
 '3f586e6dd1d181ddb9f3e7217f64bfcd','3b286e6dd1d1817aa093fca807659f07',
 '3b286e6dd1d181f2a75cfbd3885071c4','3bf86e6dd1d18110938bc358e17c779e',
 '3ed86e6dd1d18118b0b8d98bb91892fb','3b286e6dd1d1811d9308d9a2b56c9de4'];
const CHILD='40786e6dd1d181ec8addcd1269f9b0bb',WIP='3b286e6dd1d18194866dd8d7a28c7ab4';
const ROWS=require('../sori48_pair_metadata.cjs').ROWS;
const SOURCE_REVIEW=require('../npg_source_review_provider.cjs'),REVIEW_ROW=SOURCE_REVIEW.REVIEW_ROW;
const headings=['## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3',
 '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED',
 '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index',
 '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue',
 '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue',
 '## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING',
 '## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard'];async function closedState(repo,root,dir){
 const proposal=clone(require('../SORI48_UNKNOWN_CLOSURE_PROPOSAL.json')),oldEdits=[{pageId:'synthetic',newStr:'old-head'}];
 proposal.planHash=sha(JSON.stringify(oldEdits));proposal.before.total=1;
 const old={status:'HALTED',haltedFrom:'WRITE_PENDING',error:proposal.before.error,next:3,planHash:proposal.planHash,
  edits:oldEdits,receipt:{ticket:proposal.ticket,snapshotHash:proposal.snapshotHash},
  dispatch:{executor:proposal.oldExecutor,attempts:[{dispatchId:proposal.dispatchId,sendPermit:{opaque:'retained'}}]},
  verifications:[{index:0},{index:1},{index:2}]};
 const before={active:proposal.batchId,batches:{[proposal.batchId]:old},
  keepOriginalUnknown:{next:3,receipts:[1,2,3],outcome:'UNKNOWN'},
  caseExceptionControl:{exclusive:false,manifestHash:'e'.repeat(64),immutable:'retained'}};
 const beforeBytes=JSON.stringify(before);proposal.journalSha256=sha(beforeBytes);
 const proposalBytes=JSON.stringify(proposal),proposalHash=sha(proposalBytes),realState=require('../sori48_unknown_state.cjs'),
  realClosure=require('../sori48_unknown_closure.cjs');
 const approval={schema:'SORI48_EXACT_CLOSURE_USER_DECISION_V1',status:'APPROVED',proposalSha256:proposalHash,
  batchId:proposal.batchId,journalSha256:proposal.journalSha256,preservesOriginalUncertainty:true,
  acceptsLateOriginalPayloadApplicationRisk:true,normalSourceGatesRequired:true,
  noSendReplayAckOrWorkerProofRewrite:true,otherCasesAuthorized:false,applied:false};
 const approvalBytes=JSON.stringify(approval),approvalHash=sha(approvalBytes);
 const phase={'SORI48_UNKNOWN_CLOSURE_PROPOSAL.json':proposalBytes,
  'sori48_unknown_state.cjs':fs.readFileSync(path.join(repo,'sori48_unknown_state.cjs'),'utf8')
   .replace(realState.PROPOSAL_SHA256,proposalHash).replace(realState.APPROVAL_SHA256,approvalHash),
  'sori48_unknown_closure.cjs':fs.readFileSync(path.join(repo,'sori48_unknown_closure.cjs'),'utf8')
   .replace(realClosure.APPROVAL_SHA256,approvalHash).replace(realClosure.CORRECTED_HEAD,'c'.repeat(40))}; const phaseNames=['SORI48_UNKNOWN_CLOSURE_PROPOSAL.json','sori48_unknown_state.cjs','sori48_unknown_closure.cjs',
  'sori48_unknown_runtime.cjs','sori48_unknown_evidence.cjs','sori48_unknown_sources.js',
  'sori48_pair_provider.cjs','sori48_pair_metadata.cjs','npg_source_review_provider.cjs'];
 for(const n of phaseNames){if(!Object.hasOwn(phase,n))phase[n]=fs.readFileSync(path.join(repo,n));
  fs.writeFileSync(path.join(dir,n),phase[n],{mode:0o600});}
 const closure=require(path.join(dir,'sori48_unknown_closure.cjs'));
 const input={apply:true,approvalBytes,beforeBytes,
  owner:{actor:closure.OWNER,runId:'scheduled-test-run',scheduledProofSha256:'a'.repeat(64)},
  priorExecutorEvidence:{schema:'SORI48_PRIOR_EXECUTOR_EVIDENCE_V1',status:'ABSENT_VERIFIED',batchId:proposal.batchId,
   ticket:proposal.ticket,dispatchId:proposal.dispatchId,oldExecutor:proposal.oldExecutor,oldBrokerPid:2680832,
   absenceScope:'LOCAL_OLD_PROCESS_AND_CURRENT_CANONICAL_LOCK_ONLY',oldProcessPresent:false,
   currentLock:{pid:1234,executor:'current-executor'},attributableTerminalResult:null},
  originalEvidencePreserved:true,verifiedReceiptCount:3,original18Verified:true,
  freshSources:{original:{readOk:true},child:{readOk:true},pair:{readOk:true},github:{readOk:true,head:'c'.repeat(40)}},
  lateObservation:{batchId:proposal.batchId,ticket:proposal.ticket,dispatchId:proposal.dispatchId,
   attributableTerminalResult:null,freshSourcesComplete:true,targets:proposal.observedUnwrittenTargets.targets.map(x=>
    ({pageId:x.pageId,readOk:true,oldLiteralCount:1,plannedLiteralCount:0}))}};
 let audit,afterBytes;await closure.createProvider({withLock:fn=>fn(),persistAudit:async value=>{
  audit=value;return {sha256:sha(JSON.stringify(value))};},atomicWrite:async(expected,value)=>{
  assert.equal(expected,proposal.journalSha256);afterBytes=value;return value;}})(input);
 return {phase,phaseNames,approvalBytes,audit,afterBytes};
}async function createFixture(t,loseNativeResult){
 const repo=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'sori48-installed-chain-')),
  runtime=path.join(root,'runtime'),head='b'.repeat(40),dir=path.join(runtime,'extensions',head),
  auditDir=path.join(root,'manual-audits','sori48-closure-20261029');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.mkdirSync(auditDir,{recursive:true,mode:0o700});
 const closed=await closedState(repo,root,dir),auditHash=sha(JSON.stringify(closed.audit));
 fs.writeFileSync(path.join(auditDir,'SORI48_SUPERSEDED_UNKNOWN_PRIVATE_AUDIT-'+auditHash+'.json'),
  JSON.stringify(closed.audit),{mode:0o600});
 fs.writeFileSync(path.join(auditDir,'USER_APPROVAL.json'),closed.approvalBytes,{mode:0o600});
 fs.writeFileSync(path.join(root,'journal.json'),closed.afterBytes,{mode:0o600});
 const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
  'normal_projection_probe.cjs','ordinary_followthrough.js','normal_bridge.cjs','normal_live_owner.js',
  'normal_live_runner.js','normal_followthrough_v2.js','normal_live_command.js','reconcile_unpermitted_dispatch.cjs',
  'normal_rpc_client.js','normal_unsent.cjs','reconcile_permit_expiry.cjs','sori_startup_control.cjs'],files={};
 for(const n of names){const bytes=fs.readFileSync(path.join(repo,n));fs.writeFileSync(path.join(dir,n),bytes,{mode:0o600});
  files[n]=sha(bytes);}
 fs.copyFileSync(path.join(repo,'broker.cjs'),path.join(runtime,'broker.cjs'));fs.chmodSync(path.join(runtime,'broker.cjs'),0o600);
 const ce='module.exports={validateControl:()=>({controls:{files:[]}}),controls:()=>{},guardOwner:()=>{},guardBatch:()=>{},reconcile:()=>{},authorizeSuccessor:()=>{},admit:()=>{},release:()=>{}};';
 fs.writeFileSync(path.join(runtime,'case_exception.cjs'),ce,{mode:0o600}); const prior=require('../SORI48_UNKNOWN_CLOSURE_PROPOSAL.json').observedUnwrittenTargets.targets[0].plannedLiteral,
  corrected=require('../sori48_pair_provider.cjs').CORRECTED_TEXT;
 const edits=BODY_IDS.map((pageId,i)=>({pageId,heading:headings[i],oldStr:i<3?prior:'Sori retains its separate gates.',
  newStr:corrected}));
 const policy={productionEnabled:true,productionPages:[...new Set([...BODY_IDS,...ROWS.map(r=>r[0]),REVIEW_ROW])],
  canaryPages:[],headingPrefixes:['## CURRENT CENTRAL OBSERVATION','## CURRENT INCIDENT MAINTENANCE'],
  centralSections:edits.slice(0,2).map(e=>({pageId:e.pageId,heading:e.heading}))};
 fs.writeFileSync(path.join(runtime,'policy.json'),JSON.stringify(policy),{mode:0o600});
 const installation={root,runtime,sourceHead:head,extensionDirectory:dir,caseModuleHash:sha(ce),files,
  phaseProviders:Object.fromEntries(closed.phaseNames.map(n=>[n,sha(closed.phase[n])]))};
 const pages={};
 for(let i=0;i<ROWS.length;i++){const s=ROWS[i],event={event_id:s[1],version:s[2],role:s[3],kind:'RELEASE',
  lease_state:'RELEASED',repo_pr:'HeaInSeo/sori#48',head_or_digest:s[4],session_id:'session-'+i,task_id:'task-'+i};
  const props={'이벤트 ID':event.event_id,'체크포인트 버전':event.version,'세션 ID':event.session_id,
   '작업 ID':event.task_id,'저장소 식별자':s[4],'큐 구획':'현재','작업 상태':'검증대기','Title':'preserve'};
  pages[s[0]]={structuredContent:{id:s[0],page_last_edited_at:'2026-10-30T00:00:00Z',
   text:'<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n## '+s[3]+
   ' QUEUE EVENT (current)\n\n```json\nQUEUE_EVENT_V1 '+JSON.stringify(event)+'\n```\n\n## HISTORY\nuntouched\n</content>'}};} for(const edit of edits){if(!pages[edit.pageId])pages[edit.pageId]={structuredContent:{id:edit.pageId,
  page_last_edited_at:'2026-10-30T00:00:00Z',text:'<properties>\n{"title":"preserve"}\n</properties>\n<content>\n## SOURCE\npreserve\n</content>'}};
  pages[edit.pageId].structuredContent.text=pages[edit.pageId].structuredContent.text.replace('\n</content>',
   '\n'+edit.heading+'\n'+edit.oldStr+'\n## AFTER\nprotected\n</content>');}
 pages[WIP]={structuredContent:{id:WIP,page_last_edited_at:'2026-10-30T00:00:00Z',
  text:'<properties>\n{"title":"policy"}\n</properties>\n<content>\npolicy\n</content>'}};
 const reviewEvent={event_id:SOURCE_REVIEW.PRIOR_EVENT,task_id:SOURCE_REVIEW.PRIOR_TASK,
  phase:'PR23-r3-D1-delta-review',role:'guardrail',session_id:'old-review',version:22,kind:'RELEASE',
  event_at_utc:'2026-10-29T11:13:45Z',repo_pr:'HeaInSeo/notion-projection-guard#23',
  head_or_digest:'441624c4',lease_state:'RELEASED'};
 const reviewProps={'이벤트 ID':reviewEvent.event_id,'체크포인트 버전':22,'작업 ID':reviewEvent.task_id,
  '작업 상태':'종료','다음 담당자':'없음','큐 구획':'완료 이력','세션 ID':'old-review','Authority Gate':'READY'};
 pages[REVIEW_ROW]={structuredContent:{id:REVIEW_ROW,page_last_edited_at:'2026-10-30T00:00:00Z',
  text:'<properties>\n'+JSON.stringify(reviewProps)+'\n</properties>\n<content>\n## GUARDRAIL QUEUE EVENT (current)\nQUEUE_EVENT_V1 '+
   JSON.stringify(reviewEvent)+'\n\n## HISTORY\npreserved\n</content>'}};
 const children=new Map(),starts=[],waitLine=(record,predicate)=>new Promise((resolve,reject)=>{
  const found=record.lines.find(predicate);if(found)return resolve(found);
  const timer=setTimeout(()=>reject(Error('installed command timeout: '+record.stderr)),5000);
  record.waiters.push(line=>{if(predicate(line)){clearTimeout(timer);resolve(line);return true;}return false;});});
 const text=s=>({content:[{type:'text',text:s}]});
 const transport={async mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_start_process({command}){
  const child=spawn('/bin/sh',['-c',command],{stdio:['pipe','pipe','pipe']}),
   record={child,lines:[],waiters:[],stderr:'',buffer:''};
  children.set(child.pid,record);starts.push(child.pid);child.stderr.on('data',x=>record.stderr+=x);
  child.stdout.on('data',x=>{record.buffer+=x;for(;;){const i=record.buffer.indexOf('\n');if(i<0)break;
   const line=record.buffer.slice(0,i);record.buffer=record.buffer.slice(i+1);record.lines.push(line);
   record.waiters=record.waiters.filter(fn=>!fn(line));}});
  return text('Process started with PID '+child.pid+'\n'+await waitLine(record,line=>line.includes('"ready":true')));
 }}; transport.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_interact_with_process=
  async({pid,input})=>{const record=children.get(pid),requestId=JSON.parse(input).requestId;
   record.child.stdin.write(input);return text(await waitLine(record,line=>line.includes('"requestId":"'+requestId+'"')));};
 transport.mcp__codex_apps__dev_server___additional_mcp__dev_server_additional_mcp_read_process_output=
  async({pid})=>text(children.get(pid).lines.slice(-2).join('\n'));
 transport.mcp__codex_apps__notion_fetch=async({id})=>clone(pages[id]);
 transport.mcp__codex_apps__automations_peek=async()=>({structuredContent:{automations:[{id:'a'.repeat(32),
  is_enabled:true,run_details:{last_run:{id:'installed-run',recorded_status:'in_progress'}}}]}});
 let writes=0,lost=false;
 transport.mcp__codex_apps__notion_notion_update_page=async request=>{writes++;
  const p=pages[request.page_id].structuredContent;
  if(request.command==='update_content')for(const u of request.content_updates)p.text=p.text.replace(u.old_str,()=>u.new_str);
  else p.text=p.text.replace(/<properties>\n([\s\S]*?)\n<\/properties>/,(_,raw)=>
   '<properties>\n'+JSON.stringify({...JSON.parse(raw),...request.properties})+'\n</properties>');
  if(loseNativeResult&&!lost&&request.command==='update_properties'){lost=true;throw Error('LOST_INSTALLED_NATIVE_REPLY');}
  return {structuredContent:{page_id:request.page_id}};};
 t.after(()=>{for(const r of children.values())if(!r.child.killed)r.child.kill('SIGKILL');
  fs.rmSync(root,{recursive:true,force:true});}); const load=n=>require('node:vm').runInNewContext(fs.readFileSync(path.join(repo,n),'utf8'),{setTimeout});
 const entry=load('normal_followthrough_v2.js')(transport,{createTransport:()=>transport,
  createClient:load('normal_rpc_client.js'),createLiveRunner:load('normal_live_runner.js'),
  createWitness:load('normal_live_owner.js'),createLandedProjection(){},createCommand:load('normal_live_command.js'),
  centralTaskId:'a'.repeat(32),runId:'installed-run',installation,
  createSori48SourceCollector:()=>({collect:async()=>({schema:'SORI48_FRESH_SOURCE_OBSERVATION_V1',
   batchId:'SORI48-PAIR-ADMIT-20261029',classification:'CLEAR_OBSERVATION_ONLY',freshSourcesComplete:true,
   applyAuthorized:false,attributableTerminalResult:null})})});
 const refs=[...BODY_IDS,CHILD,WIP].map(pageId=>({pageId,page:clone(pages[pageId])}));
 const sourceObservation={schema:'NPG_SOURCE_REVIEW_OBSERVATION_V1',
  repository:'HeaInSeo/notion-projection-guard',pr:24,head,base:'c'.repeat(40),
  observedAt:new Date().toISOString(),applyAuthorized:false,sourceOwnerState:'RELEASED',
  canonical:{active:null,journalSha256:'0699a8ae84284cf96632fa47cd4fa4f10d51f32c5136b9229a2ae22bbf729c4f'},
  reviewRow:clone(pages[REVIEW_ROW]),
  github:{structuredContent:{number:24,state:'open',merged:false,head_sha:head,base_sha:'c'.repeat(40)}},
  checks:{structuredContent:{total_count:4,check_runs:[1,2,3,4].map(id=>
   ({id,head_sha:head,status:'completed',conclusion:'success'}))}}};
 const sourceReviewAdmission=SOURCE_REVIEW.createProvider().plan(sourceObservation);
 const sourceReviewRefs=[REVIEW_ROW,WIP,BODY_IDS[5],BODY_IDS[4]].map(pageId=>
  ({pageId,page:clone(pages[pageId])}));
 const admission={schema:'SORI48_CORRECTED_HEAD_PAIR_PROJECTION_V1',observationId:BODY_BATCH,
  applyAuthorized:false,requiresCanonicalClosure:true,metadataReconciliationRequired:true,edits};
 return {entry,admission,refs,sourceReviewAdmission,sourceReviewRefs,root,starts,get writes(){return writes;}};
}
module.exports={createFixture,BATCH};