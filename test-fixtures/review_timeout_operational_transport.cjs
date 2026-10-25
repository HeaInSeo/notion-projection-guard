'use strict';
const fs = require('node:fs');
async function createTransport(context) {
  return {
    readCurrent:async () => context.scope,
    checkEligibility:async ({scope,owner,fence}) => ({
      allowed:true,scopeKey:JSON.stringify([scope.repo,scope.pr,scope.head,scope.base]),
      owner,fence,receipt:'synthetic-existing-gates'
    }),
    send:async attempt => {
      const state = JSON.parse(fs.readFileSync(context.ledgerFile,'utf8'));
      const recorded = state.chains.flatMap(c => c.attempts).find(a => a.requestId === attempt.requestId);
      if (!recorded || recorded.delivery !== 'UNKNOWN') throw Error('send without durable intent');
      fs.appendFileSync(context.deliveryFile,attempt.requestId + '\n',{mode:0o600});
      if (context.behavior === 'exit-after-send') process.exit(73);
      if (context.behavior === 'sync-infinite') { while (true) {} }
      return 'synthetic-request-receipt:' + attempt.requestId;
    }
  };
}
module.exports = {createTransport};
