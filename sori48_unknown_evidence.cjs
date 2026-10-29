'use strict';
// Local retention evidence only. This cannot establish prior-executor absence,
// scheduler ownership, fresh product sources or a provider terminal result.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const proposal=require('./SORI48_UNKNOWN_CLOSURE_PROPOSAL.json');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const need=(ok,why)=>{if(!ok)throw Error('SORI48_EVIDENCE_'+why);};
function read(file,privateOnly=false){
  const st=fs.lstatSync(file);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&
    !(st.mode&(privateOnly?0o077:0o022))&&fs.realpathSync(file)===file,'FILE');
  return fs.readFileSync(file,'utf8');
}
function createCollector({root,runtime,caseModuleHash}){
  for(const dir of [root,runtime]){
    need(typeof dir==='string'&&path.isAbsolute(dir),'PATH');
    const st=fs.lstatSync(dir);
    need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&
      !(st.mode&0o022)&&fs.realpathSync(dir)===dir,'DIRECTORY');
  }
  need(/^[a-f0-9]{64}$/.test(caseModuleHash??''),'CASE_PIN');
  return function collect(){
    const journalPath=path.join(root,'journal.json'),beforeBytes=read(journalPath,true);
    need(sha(beforeBytes)===proposal.journalSha256,'JOURNAL');
    const before=JSON.parse(beforeBytes),batch=before.batches?.[proposal.batchId];
    need(before.active===proposal.batchId&&batch?.status===proposal.before.status&&
      batch.next===3&&batch.planHash===proposal.planHash&&
      sha(JSON.stringify(batch.edits))===proposal.planHash,'INCIDENT');
    const modulePath=path.join(runtime,'case_exception.cjs');
    need(sha(read(modulePath))===caseModuleHash,'CASE_PIN');
    const ce=require(modulePath),manifest=ce.validateControl(root,before);
    need(Array.isArray(manifest?.controls?.files)&&manifest.controls.files.length===18,
      'ORIGINAL18_MANIFEST');
    ce.controls(manifest);
    const prefix=sha(proposal.batchId)+'-',files=[],receipts=[];
    const get=(index,suffix)=>{
      const file=path.join(root,prefix+index+suffix),bytes=read(file,true);
      files.push({path:file,sha256:sha(bytes)});return JSON.parse(bytes);
    };
    need(Array.isArray(batch.verifications)&&batch.verifications.length===3&&
      batch.verifications.every((v,i)=>v.index===i),'RECEIPT_COUNT');
    for(let i=0;i<3;i++){
      const snapshot=get(i,'.json'),verified=get(i,'.json.verified.json'),pin=batch.verifications[i];
      need(snapshot.batchId===proposal.batchId&&snapshot.index===i&&
        JSON.stringify(snapshot.edit)===JSON.stringify(batch.edits[i])&&
        sha(JSON.stringify(snapshot))===pin.snapshotHash&&
        sha(JSON.stringify(verified))===pin.verifiedHash,'RECEIPT_PIN');
      need(typeof snapshot.expected==='string'&&verified.page?.body===snapshot.expected&&
        sha(snapshot.expected)===snapshot.expectedHash&&verified.bodyHash===snapshot.expectedHash&&
        verified.page.properties===snapshot.page?.properties&&
        Number.isFinite(Date.parse(verified.at)),'RECEIPT_CONTENT');
      receipts.push({...pin,verifiedAt:verified.at});
    }
    const pending=get(3,'.json');
    need(batch.receipt?.snapshot===path.join(root,prefix+'3.json')&&
      batch.receipt.ticket===proposal.ticket&&batch.receipt.snapshotHash===proposal.snapshotHash&&
      pending.batchId===proposal.batchId&&pending.index===3&&pending.ticket===proposal.ticket&&
      sha(JSON.stringify(pending))===proposal.snapshotHash,'PENDING_PIN');
    const allowed=new Set(files.map(f=>path.basename(f.path)));
    need(fs.readdirSync(root).filter(n=>n.startsWith(prefix)).every(n=>allowed.has(n)),
      'UNEXPECTED_EVIDENCE');
    for(const file of files)need(sha(read(file.path,true))===file.sha256,'EVIDENCE_CHANGED');
    ce.controls(manifest);
    need(read(journalPath,true)===beforeBytes&&sha(read(modulePath))===caseModuleHash,'CHANGED');
    return {beforeBytes,originalEvidencePreserved:true,verifiedReceiptCount:3,original18Verified:true,
      retentionEvidence:{schema:'SORI48_LOCAL_RETENTION_EVIDENCE_V1',observedAt:new Date().toISOString(),
        journalSha256:sha(beforeBytes),receipts,files,controlFiles:manifest.controls.files,
        priorExecutorStatus:'NOT_ASSESSED',freshSourcesStatus:'NOT_ASSESSED',applyAuthorized:false}};
  };
}
module.exports={createCollector};
