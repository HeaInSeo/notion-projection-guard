'use strict';
// Separate supervisor event loop; provider callbacks run only in the worker.
// SIGKILL stops local adapter execution. It does NOT cancel a provider review.
const {fork}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
function valid(input) {
  if(!input||!path.isAbsolute(input.transportModule)||!path.isAbsolute(input.directory)||
    !Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>30000)
    throw Error('REVIEW_ISOLATED: absolute paths and 1..30000ms timeout required');
  const stat=fs.lstatSync(input.transportModule);
  if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(input.transportModule)!==input.transportModule)
    throw Error('REVIEW_ISOLATED: regular trusted transport module required');
}
const startChild=mode=>fork(__filename,[mode],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
function runIsolated(input) {
  valid(input);
  return new Promise((resolve,reject)=>{
    const supervisor=startChild('--supervisor');let result;
    supervisor.on('message',message=>{result=message;});
    supervisor.on('error',reject);
    supervisor.on('exit',()=>resolve(result??{action:'BLOCKED',reason:'SUPERVISOR_EXIT_OUTCOME_UNKNOWN'}));
    supervisor.send(input,error=>{if(error)reject(error);});
  });
}
function report(result) {
  if(!process.connected)process.exit(0);
  process.send(result,()=>process.exit(0));
}
async function worker(input) {
  valid(input);
  const {ReviewLedger}=require('./review_timeout_ledger.cjs');
  // createTransport is trusted configuration, never serialized callback source.
  // It must not retry, spawn detached sends or leak lock descriptors to children.
  const transport=await require(input.transportModule).createTransport(input.context);
  const ledger=new ReviewLedger(input.directory,{clock:transport.clock??Date.now,
    ioTimeoutMs:input.ioTimeoutMs??10000,deadlineNs:input.deadlineNs});
  return ledger.dispatchReplacement(input.token,input.revision,input.key,transport);
}
function supervise(input) {
  valid(input);
  const deadline=process.hrtime.bigint()+BigInt(input.timeoutMs)*1000000n;
  const child=startChild('--worker');let result,expired=false,killRequested=false;
  const stop=()=>{expired=true;killRequested=child.kill('SIGKILL')||killRequested;};
  const timer=setTimeout(stop,input.timeoutMs);
  // Parent cancellation cannot leave an unobserved local worker running.
  process.on('disconnect',stop);
  child.on('message',message=>{
    if(process.hrtime.bigint()>=deadline)stop();else result=message;
  });
  child.on('error',()=>{result={action:'BLOCKED',reason:'LOCAL_ADAPTER_START_FAILED'};});
  child.on('close',(code,signal)=>{
    clearTimeout(timer);
    if(process.hrtime.bigint()>=deadline)expired=true;
    if(expired||code!==0)report({action:'BLOCKED',reason:'LOCAL_ADAPTER_OUTCOME_UNKNOWN',
      deadlineExceeded:expired,localWorkerExitConfirmed:true,killRequested,exitCode:code,signal,
      providerTermination:'UNKNOWN',next:'Reload the same ledger and reconcile the exact request ID; never resend.'});
    else report(result??{action:'BLOCKED',reason:'LOCAL_ADAPTER_RESULT_MISSING'});
  });
  child.send({...input,deadlineNs:deadline.toString()},error=>{if(error)stop();});
}
if(require.main===module) {
  process.once('message',input=>{
    if(process.argv[2]==='--supervisor') {
      try{supervise(input);}catch{report({action:'BLOCKED',reason:'ISOLATED_INPUT_INVALID'});}
    } else if(process.argv[2]==='--worker') {
      worker(input).then(report,()=>report({action:'BLOCKED',reason:'LOCAL_ADAPTER_ERROR_OUTCOME_UNKNOWN'}));
    } else report({action:'BLOCKED',reason:'ISOLATED_MODE_INVALID'});
  });
}
module.exports={runIsolated};
