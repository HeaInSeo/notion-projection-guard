'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verify:verifyBaseline}=require('./verify_review_timeout_candidate.cjs');
const FILES=['review_timeout_operational.cjs','review_timeout_operational_ledger.cjs',
  'review_timeout_evidence.cjs',
  'review_timeout_operational_worker.cjs','review_timeout_github.cjs',
  'review_timeout_history.cjs','review_timeout_operational_cases.cjs',
  'test-fixtures/review_timeout_operational_transport.cjs','REVIEW_TIMEOUT_OPERATIONS.md',
  'verify_review_timeout_operational.cjs'];
function verify(root=__dirname) {
  const baseline=verifyBaseline(root);
  const file=path.join(root,'deployment/review-timeout-operational.json');
  const raw=fs.readFileSync(file,'utf8'),m=JSON.parse(raw);
  if(m.version!==1||m.status!=='OPERATIONAL_CANDIDATE_NOT_DEPLOYED'||
    m.baselineCommit!=='2442583580c644aefe8a142c43532f61320dfda9'||
    m.operationalReplacementEntry!=='review_timeout_isolated.cjs:runIsolated'||
    JSON.stringify(Object.keys(m.sha256).sort())!==JSON.stringify([...FILES].sort()))
    throw Error('operational candidate manifest mismatch');
  const reads=[];
  for(const name of FILES) {
    const p=path.join(root,name),s=fs.lstatSync(p);
    if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(p)!==p)throw Error('unsafe operational source');
    const data=fs.readFileSync(p);
    if(crypto.createHash('sha256').update(data).digest('hex')!==m.sha256[name])
      throw Error('operational source hash mismatch: '+name);
    reads.push([p,data]);
  }
  for(const [p,data] of reads)if(!fs.readFileSync(p).equals(data))throw Error('source changed during verification');
  if(fs.readFileSync(file,'utf8')!==raw)throw Error('manifest changed during verification');
  return {status:'OPERATIONAL_CANDIDATE_MATCH',files:FILES.length,baseline,
    deployed:false,adopted:false};
}
if(require.main===module){try{console.log(JSON.stringify(verify()));}
  catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verify,FILES};
