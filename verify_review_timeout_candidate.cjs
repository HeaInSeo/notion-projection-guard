'use strict';
// Read-only local candidate check. Never imports the adapter or reads private state.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILES=['review_timeout_policy.cjs','review_timeout_ledger.cjs',
  'review_timeout_policy_cases.cjs','review_timeout_ledger_cases.cjs','test-fixtures/review_timeout_worker.cjs'];
function verify(root=__dirname) {
 const file=path.join(root,'deployment/review-timeout-candidate.json');
 const regular=p=>{const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error('nonregular candidate file');};
 regular(file);const raw=fs.readFileSync(file,'utf8'),m=JSON.parse(raw);
 if(m.version!==1||m.status!=='LOCAL_CANDIDATE_NOT_DEPLOYED'||m.productionEnabled!==false||
   m.repository!=='HeaInSeo/notion-projection-guard'||
   JSON.stringify(Object.keys(m.sha256).sort())!==JSON.stringify([...FILES].sort()))throw Error('candidate manifest mismatch');
 const reads=[];
 for(const name of FILES){
  const p=path.join(root,name);regular(p);const data=fs.readFileSync(p);
  if(crypto.createHash('sha256').update(data).digest('hex')!==m.sha256[name])throw Error('candidate hash mismatch: '+name);
  reads.push([p,data]);
 }
 for(const [p,data] of reads){regular(p);if(!fs.readFileSync(p).equals(data))throw Error('candidate changed during verification');}
 regular(file);if(fs.readFileSync(file,'utf8')!==raw)throw Error('manifest changed during verification');
 return {status:'LOCAL_CANDIDATE_MATCH',files:FILES.length,deployed:false,adopted:false};
}
if(require.main===module){try{console.log(JSON.stringify(verify()));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verify,FILES};
