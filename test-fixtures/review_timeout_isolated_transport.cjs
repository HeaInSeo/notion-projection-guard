'use strict';
const fs=require('node:fs');
const {scopeKey}=require('../review_timeout_policy.cjs');
exports.createTransport=async context=>({
  clock:()=>context.now,
  readCurrent:()=>context.scope,
  checkEligibility:x=>({...x,scopeKey:scopeKey(x.scope),allowed:true,receipt:'synthetic-gates'}),
  send:a=>{
    const fd=fs.openSync(context.directory+'/isolated-synthetic-deliveries','a',0o600);
    try{fs.writeSync(fd,a.requestId+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(context.mode==='INFINITE_SYNC')for(;;){} // Only watchdog can interrupt this.
    if(context.mode==='SLOW_SYNC') {
      const until=process.hrtime.bigint()+150000000n;
      while(process.hrtime.bigint()<until){}
    }
    return 'synthetic-isolated-receipt';
  }
});
