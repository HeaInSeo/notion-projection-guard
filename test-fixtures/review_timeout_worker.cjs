'use strict';
// Synthetic transport only. A separate process exercises OS locks and abrupt death.
const fs=require('node:fs');
const {ReviewLedger}=require('../review_timeout_ledger.cjs');
const input=JSON.parse(process.argv[2]);
const ledger=new ReviewLedger(input.directory,{clock:()=>input.now});
ledger.dispatchReplacement(input.token,input.revision,input.key,{
  readCurrent:async()=>{await new Promise(resolve=>setTimeout(resolve,50));return input.scope;},
  checkEligibility:async x=>({...x,scopeKey:require('../review_timeout_policy.cjs').scopeKey(x.scope),allowed:true,receipt:'synthetic-gates'}),
  afterIntent:input.crash==='intent'?()=>process.exit(81):undefined,
  afterSend:input.crash==='send'?()=>process.exit(82):undefined,
  send:async a=>{
    const fd=fs.openSync(input.directory+'/synthetic-deliveries','a',0o600);
    try{fs.writeSync(fd,a.requestId+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    await new Promise(resolve=>setTimeout(resolve,100));
    return 'synthetic-receipt:'+a.requestId;
  }
}).then(r=>{process.stdout.write(JSON.stringify(r));}).catch(e=>{
  process.stdout.write(JSON.stringify({error:e.message}));process.exitCode=1;
});
