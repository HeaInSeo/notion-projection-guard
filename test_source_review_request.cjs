'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const m=require('./source_review_request.cjs');
const now=Date.parse('2026-11-01T00:00:00Z'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const r={repository:m.REPO,pr:24,role:'guardrail',taskId:m.TASK,row:m.ROW,sessionId:m.SESSION,
  triggerKind:'MANUAL_SCOPED_SOURCE_REVIEW',head:'a'.repeat(40),base:'b'.repeat(40),tree:'c'.repeat(40),
  createdAt:new Date(now).toISOString(),sourceDirectory:'/tmp/frozen-candidate'};
 const o={repository:m.REPO,pr:24,state:'open',head:r.head,base:r.base,tree:r.tree,clean:true,
  observedAt:r.createdAt,priorRequestKeys:[],currentOwn:{role:'guardrail',task_id:m.TASK,session_id:m.SESSION,
   kind:'RELEASE',lease_state:'RELEASED',head_or_digest:'d'.repeat(40)},
  installedSource:'441624c4a0e34cc0ea874859f154711ef0af825b',
  legacyCaseLaunch:{gate:'READY',scope:'GENERIC_SCAN_ONLY'},sourceRowHook:{unrelated:true}};
 return {r,o};
}
test('explicit source request selects existing scoped CLI without candidate installation or product admission',()=>{
 const {r,o}=fixture(),p=m.prepare(r,o,now);
 assert.equal(p.route,'EXISTING_SCOPED_CLI');assert.equal(p.candidateInstallationRequired,false);
 assert.equal(p.workerClaimCreated,false);assert.equal(p.productionApplyAuthority,false);
 assert.ok(p.argv.includes(m.SESSION));assert.ok(p.argv[1].includes(r.head));
 assert.ok(!p.argv.includes('--dangerously-skip-permissions'));assert.equal(p.launchRequirements.length,5);
});
for(const [name,change] of [
 ['wrong role',f=>f.r.role='operator'],['wrong head',f=>f.o.head='e'.repeat(40)],
 ['wrong base',f=>f.o.base='e'.repeat(40)],['wrong tree',f=>f.o.tree='e'.repeat(40)],
 ['stale request',f=>f.r.createdAt=new Date(now-300000).toISOString()],
 ['stale source',f=>f.o.observedAt=new Date(now-30000).toISOString()],
 ['competing lease',f=>{f.o.currentOwn.kind='CLAIM';f.o.currentOwn.lease_state='ACTIVE until 2026-11-01T01:00:00Z';}],
 ['wrong task',f=>f.r.taskId='SORI-PRODUCT'],['wrong session',f=>f.r.sessionId='other'],
 ['same-head completed review',f=>f.o.currentOwn.head_or_digest=f.r.head],
 ['duplicate intent',f=>f.o.priorRequestKeys=[m.requestKey(f.r)]],
 ['unverified installed source',f=>f.o.installedSource=f.r.head]
])test('source entry rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>m.prepare(f.r,f.o,now),/SOURCE_REVIEW_/);});
test('old immutable PR23 case hook accepts source-row request but still denies protected product writes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-source-bootstrap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const baseline='91c33c5c11266605adfdedcc269b9949cee7a798';
 for(const name of ['case_gate.cjs','case_exception.cjs','broker.cjs']){
  const bytes=cp.execFileSync('git',['show',baseline+':'+name],{cwd:__dirname});
  fs.writeFileSync(path.join(dir,name),bytes);assert.equal(sha(bytes),sha(fs.readFileSync(path.join(__dirname,name))));
 }
 const protectedId='3f586e6dd1d181ebb43dd7de62aa2ca4',config={schema:'SCOPED_CASE_GATE_V1',root:dir,
  batchId:'old-protected-case',taskId:'SQ-SORI-SM-W02.A-20261010',originalPageId:protectedId,workerRole:'operator'};
 const bytes=JSON.stringify(config),file=path.join(dir,'gate.json');fs.writeFileSync(file,bytes,{mode:0o600});
 fs.writeFileSync(path.join(dir,'journal.json'),JSON.stringify({batches:{}}),{mode:0o600});
 const args=[path.join(dir,'case_gate.cjs'),'hook','--config',file,'--config-sha256',sha(bytes),'--role','guardrail'];
 const invoke=id=>cp.spawnSync(process.execPath,args,{input:JSON.stringify({tool_name:'mcp__notion__notion_update_page',tool_input:{page_id:id}}),encoding:'utf8'});
 const allowed=invoke(m.ROW);assert.equal(allowed.status,0,allowed.stderr);
 assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.additionalContext,'');
 const denied=invoke(protectedId);assert.equal(denied.status,2);assert.match(denied.stderr,/CASE_PERMIT_MISSING/);
 const {r,o}=fixture();assert.equal(m.prepare(r,o,now).argv.includes(m.SESSION),true);
 assert.equal(fs.readFileSync(path.join(dir,'journal.json'),'utf8'),JSON.stringify({batches:{}}));
});
test('existing role flock and durable request-key intent prevent competing or duplicate CLI entry',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npg-source-once-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {r,o}=fixture(),plan=m.prepare(r,o,now),lock=path.join(dir,'role.lock'),marker=path.join(dir,plan.requestKey+'.json');
 const holder=cp.spawn('/usr/bin/flock',['-n',lock,process.execPath,'-e',
  "process.stdout.write('held\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],{stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(holder.exitCode===null)holder.kill('SIGTERM');});
 await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);});
 const child="const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'wx',0o600);fs.writeSync(fd,'synthetic request, no CLAIM');fs.fsyncSync(fd);fs.closeSync(fd);";
 const launch=()=>cp.spawnSync('/usr/bin/flock',['-n',lock,process.execPath,'-e',child,marker],{encoding:'utf8'});
 assert.notEqual(launch().status,0);assert.equal(fs.existsSync(marker),false);
 const exited=new Promise(resolve=>holder.once('exit',resolve));holder.stdin.end();await exited;
 assert.equal(launch().status,0);const first=fs.readFileSync(marker,'utf8');
 const repeated=launch();assert.notEqual(repeated.status,0);assert.match(repeated.stderr,/EEXIST/);
 assert.equal(fs.readFileSync(marker,'utf8'),first);
});

test('new PR identity is explicit in payload and dedupe key, never aliased to PR24',()=>{
 const {r,o}=fixture();const old=m.prepare(r,o,now);r.pr=25;o.pr=25;
 const next=m.prepare(r,o,now);assert.notEqual(next.requestKey,old.requestKey);
 assert.match(next.argv[1],/PR25 head/);assert.doesNotMatch(next.argv[1],/PR24 head/);
 o.pr=24;assert.throws(()=>m.prepare(r,o,now),/CURRENT_SOURCE/);
});
for(const pr of [0,-1,1.5,'25',null,Number.MAX_SAFE_INTEGER+1])
 test('invalid PR identity rejected: '+String(pr),()=>{const {r,o}=fixture();r.pr=pr;o.pr=pr;assert.throws(()=>m.prepare(r,o,now),/SCOPE/);});
