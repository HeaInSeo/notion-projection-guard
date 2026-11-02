'use strict';
const fs=require('node:fs'),path=require('node:path');
const artifacts=require('./central_migration_artifacts.cjs');
const AUDIT='/home/heain/.local/state/notion-projection-guard/manual-audits/sori48-closure-20261029';
const CONFIG='/home/heain/.local/share/review-timeout/config.json';
const V3=AUDIT+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision3';
const files=Object.freeze({authorizationBytes:AUDIT+'/CENTRAL_SCHEDULER_MIGRATION_AUTHORIZATION-20261101.json',
  acceptanceBytes:V3+'/CONFIG_REVIEW_ACCEPTANCE.json',cutoverBytes:V3+'/CUTOVER_VERIFIED.json',configBytes:CONFIG});
const need=(ok,why)=>{if(!ok)throw Error('CENTRAL_MIGRATION_FILE_'+why);};
function read(file){
  // Match the existing runtime boundary: the fixed immediate directory must
  // belong to this user and reject shared writes; realpath rejects aliases in
  // the full path. Do not impose new permissions on unrelated host ancestors.
  const parent=path.dirname(file),directory=fs.lstatSync(parent);
  need(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===process.geteuid()&&
    !(directory.mode&0o022)&&fs.realpathSync(parent)===parent,'DIRECTORY');
  const before=fs.lstatSync(file);
  need(before.isFile()&&!before.isSymbolicLink()&&before.uid===process.geteuid()&&
    !(before.mode&0o022)&&before.size<=4*1024*1024,'INPUT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const opened=fs.fstatSync(fd);
    need(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&
      opened.uid===process.geteuid()&&!(opened.mode&0o022)&&opened.size<=4*1024*1024,'OPENED');
    const bytes=fs.readFileSync(fd,'utf8'),after=fs.fstatSync(fd),current=fs.lstatSync(file);
    const same=s=>s.dev===opened.dev&&s.ino===opened.ino&&s.size===opened.size&&
      s.mtimeMs===opened.mtimeMs&&s.ctimeMs===opened.ctimeMs&&s.mode===opened.mode&&s.uid===opened.uid;
    need(same(after)&&same(current)&&!current.isSymbolicLink(),'CHANGED');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function collectPinnedConfiguration(){
  // No path/expected-hash/RPC overrides. Source installation and actual current
  // run authority remain separate gates; immutable cutover history grants none.
  const input=Object.fromEntries(Object.entries(files).map(([k,p])=>[k,read(p)]));
  const history=artifacts.inspectConfigurationBytes(input);
  for(const [k,p] of Object.entries(files))need(read(p)===input[k],'CHANGED');
  return Object.freeze({artifacts:Object.freeze(input),history,grantsNothing:true});
}

const crypto=require('node:crypto'),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const runtimeFiles=Object.freeze({
  reviewInputBytes:AUDIT+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision4/MIGRATION_REVIEW_INPUT_V4.json',
  runtimeManifestBytes:'/home/heain/.local/share/review-timeout/runtime-approved.sha256',
  wrapperBytes:'/home/heain/.local/bin/review-timeout-supervision',
  contractBytes:'/home/heain/.local/share/review-timeout/CONTRACT.md'
});
const installationPath=AUDIT+'/PR25_IMMUTABLE_INSTALLATION_MANIFEST.json';
function validateInstalledExecution(installation,owner,observation){
  const snapshots=new Map(),record=file=>{
    const bytes=read(file);
    if(snapshots.has(file))need(snapshots.get(file)===bytes,'CHANGED');
    else snapshots.set(file,bytes);
    return bytes;
  };
  const task=artifacts.NEW_ACTOR.slice(11);
  need(installation?.root==='/home/heain/.local/state/notion-projection-guard'&&
    installation.runtime==='/home/heain/.local/share/notion-projection-guard'&&
    /^[a-f0-9]{40}$/.test(installation.sourceHead??'')&&
    installation.extensionDirectory===installation.runtime+'/extensions/'+installation.sourceHead,
    'INSTALLED_SOURCE_PATH');
  const file=owner?.schedulerEvidenceFile,relative=typeof file==='string'?path.relative(AUDIT,file):'';
  need(/^tick-capture-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/PROOF\.json$/.test(relative),
    'CAPTURE_PATH');
  const directory=path.dirname(file),proofBytes=record(file),proof=JSON.parse(proofBytes);
  const captureBytes=record(directory+'/CAPTURE.json'),capture=JSON.parse(captureBytes);
  need(proof.rawEvidenceFile===directory+'/RAW.json'&&proof.captureEvidenceFile===directory+'/CAPTURE.json'&&
    capture.directory===directory&&capture.rawPath===proof.rawEvidenceFile,'CAPTURE_PATH_BINDING');
  const rawBytes=record(directory+'/RAW.json'),tickStartBytes=record(directory+'/TICK_START.json'),
    tickResultBytes=record(directory+'/TICK_RESULT.json');
  const tickResult=JSON.parse(tickResultBytes),result=JSON.parse(tickResult.stdout);
  const decisionFile=result.evidence?.file,decisionDirectory='/home/heain/.local/state/review-timeout-evidence';
  need(result.receipt?.scheduledProof?.file===file&&typeof decisionFile==='string'&&
    path.dirname(decisionFile)===decisionDirectory&&/^decision-[a-f0-9-]{36}\.json$/.test(path.basename(decisionFile)),
    'DECISION_PATH');
  const decisionBytes=record(result.evidence.file),installationManifestBytes=record(installationPath);
  need(!(fs.lstatSync(installationPath).mode&0o222),'INSTALLATION_IMMUTABLE');
  const manifest=JSON.parse(installationManifestBytes);
  // Only known private audit receipts may substantiate the normal source gates.
  artifacts.inspectInstallation(installation,installationManifestBytes);
  for(const e of manifest.sourceGates.evidence){
    const relative=path.relative(AUDIT,e.file);
    need(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'SOURCE_EVIDENCE_PATH');
    need(digest(record(e.file))===e.sha256,'SOURCE_EVIDENCE_HASH');
  }
  const all={...installation.files,...installation.phaseProviders,...installation.migrationProviders};
  const extension=installation.extensionDirectory,dir=fs.lstatSync(extension);
  need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.geteuid()&&
    !(dir.mode&0o222)&&fs.realpathSync(extension)===extension,'INSTALLATION_DIRECTORY');
  for(const [n,pin] of Object.entries(all)){
    need(path.basename(n)===n,'INSTALLATION_FILENAME');
    const f=path.join(extension,n),bytes=record(f);
    need(!(fs.lstatSync(f).mode&0o222)&&digest(bytes)===pin,'INSTALLATION_FILE_PIN');
  }
  const pinned=Object.fromEntries(Object.entries(files).map(([k,p])=>[k,record(p)]));
  const runtime=Object.fromEntries(Object.entries(runtimeFiles).map(([k,p])=>[k,record(p)]));
  const checked=artifacts.inspectExecutionEvidence({artifacts:pinned,...runtime,owner,observation,
    proofBytes,captureBytes,rawBytes,tickStartBytes,tickResultBytes,decisionBytes,
    installation,installationManifestBytes});
  for(const [p,bytes] of snapshots)need(read(p)===bytes,'CHANGED');
  const now=Date.now(),at=Date.parse(checked.observedAt);
  need(at<=now&&now-at<30000,'OWNER_EXPIRED');
  need(checked.actor==='automation:'+task&&checked.runId===owner.runId,'OWNER_BINDING');
  return checked;
}
module.exports={collectPinnedConfiguration,validateInstalledExecution};
