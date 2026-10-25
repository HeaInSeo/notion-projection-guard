'use strict';
// The supervisor loads no provider module. All provider code runs in its child.
const {fork} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {need} = require('./review_timeout_operational_ledger.cjs');
function runTask(input) {
  need(['observe','discover','original'].includes(input.operation),'unknown isolated operation');
  need(Number.isSafeInteger(input.timeoutMs) && input.timeoutMs > 0 &&
    input.timeoutMs <= 30000,'bounded isolated deadline required');
  return new Promise((resolve,reject) => {
    const supervisor = fork(__filename,['--supervisor'],
      {stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
    let result;
    supervisor.on('message',value => { result = value; });
    supervisor.on('error',reject);
    supervisor.on('exit',() => resolve(result ??
      {action:'BLOCKED',reason:'SUPERVISOR_EXIT_OUTCOME_UNKNOWN',providerTermination:'UNKNOWN'}));
    supervisor.send(input,error => { if (error) reject(error); });
  });
}
function report(result) {
  if (!process.connected) return process.exit(0);
  process.send(result,() => process.exit(0));
}
function supervisor(input) {
  const deadline = process.hrtime.bigint() + BigInt(input.timeoutMs) * 1000000n;
  const child = fork(__filename,['--worker'],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
  let result, expired = false, killRequested = false;
  const stop = () => { expired = true; killRequested = child.kill('SIGKILL') || killRequested; };
  const timer = setTimeout(stop,input.timeoutMs);
  process.on('disconnect',stop);
  child.on('message',value => {
    if (process.hrtime.bigint() >= deadline) stop(); else result = value;
  });
  child.on('error',() => { result = {action:'BLOCKED',reason:'LOCAL_WORKER_START_FAILED'}; });
  child.on('close',(code,signal) => {
    clearTimeout(timer);
    if (expired || process.hrtime.bigint() >= deadline || code !== 0)
      report({action:'BLOCKED',reason:'LOCAL_ADAPTER_OUTCOME_UNKNOWN',
        localWorkerExitConfirmed:true,killRequested,exitCode:code,signal,
        providerTermination:'UNKNOWN',next:'Reload the same canonical ledger; never resend.'});
    else report(result ?? {action:'BLOCKED',reason:'LOCAL_WORKER_RESULT_MISSING'});
  });
  child.send({...input,deadlineNs:deadline.toString()},error => { if (error) stop(); });
}
async function worker(input) {
  // Only tests inject a separately reviewed trusted module. The operational CLI
  // has no flag, configuration field or prepared-context override for this path.
  if (input.operation === 'original' && input.transportModule) {
    const p = input.transportModule, s = fs.lstatSync(p);
    need(path.isAbsolute(p) && s.isFile() && !s.isSymbolicLink() &&
      fs.realpathSync(p) === p,'trusted regular test transport required');
    const transport = await require(p).createTransport(input.context);
    const {OperationalLedger} = require('./review_timeout_operational_ledger.cjs');
    const ledger = new OperationalLedger(input.directory,{deadlineNs:input.deadlineNs,
      ioTimeoutMs:input.ioTimeoutMs ?? 10000});
    return ledger.dispatchOriginal(input.token,input.revision,input.scope,input.handoff,transport);
  }
  const provider = require('./review_timeout_github.cjs');
  if (input.operation === 'observe')
    return {action:'OBSERVED',snapshot:await provider.observe(provider.githubClient(),input.repo,input.pr)};
  if (input.operation === 'discover') {
    const pulls = await provider.pages(provider.githubClient(),'/repos/' + input.repo + '/pulls');
    return {action:'DISCOVERED',targets:pulls.filter(p => p.state === 'open')
      .map(p => ({repo:input.repo,pr:p.number}))};
  }
  const {OperationalLedger,readPrivate} = require('./review_timeout_operational_ledger.cjs');
  const transport = await provider.createTransport(input.context);
  const ledger = new OperationalLedger(input.directory,{deadlineNs:input.deadlineNs,
    ioTimeoutMs:input.ioTimeoutMs ?? 10000});
  return ledger.dispatchOriginal(input.token,input.revision,input.scope,input.handoff,transport);
}
if (require.main === module) process.once('message',input => {
  if (process.argv[2] === '--supervisor') {
    try { supervisor(input); } catch { report({action:'BLOCKED',reason:'INVALID_ISOLATED_INPUT'}); }
  } else if (process.argv[2] === '--worker') {
    worker(input).then(report,error => report({action:'BLOCKED',
      reason:'LOCAL_PROVIDER_OR_OPERATION_ERROR',detail:String(error.message).slice(0,250),
      providerTermination:'UNKNOWN'}));
  } else report({action:'BLOCKED',reason:'INVALID_WORKER_MODE'});
});
module.exports = {runTask};
