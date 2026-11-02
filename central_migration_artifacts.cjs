'use strict';
// Immutable configuration history only. This inspector does not authenticate a
// current caller/run, install a source candidate, or authorize product writes.
const crypto=require('node:crypto');
const OLD_ACTOR='automation:6a742f6443e8819184310cd28e6162cd';
const NEW_ACTOR='automation:6ae6e6e4c880819192e89cd430271bfa';
const PINS=Object.freeze({
  authorizationBytes:'9912038cf2c91800be7f73b00d6c85ebfc07d1808c84cec8eb9fe465bfb3ed08',
  acceptanceBytes:'3419ad71f050487659bacdc6164d9ed15e5c25e1b2c10e5369d93df0c3d2fab4',
  cutoverBytes:'b293cf9b7bf3bc6e1ec74bbe39fc8df4beb71100deddb238cafe31c256236e97',
  configBytes:'3322aecfd2053446fd3b428d3d9d2b1a2d66cc0aca0fe40ccf147a3c7862be5f'
});
function inspectConfigurationBytes(input){
  // Do not accept caller-supplied expected hashes or a migration=true claim.
  const observed={};
  for(const [key,expected] of Object.entries(PINS)){
    const bytes=input?.[key];
    if(typeof bytes!=='string'||crypto.createHash('sha256').update(bytes).digest('hex')!==expected)
      throw Error('CENTRAL_MIGRATION_ARTIFACT_'+key);
    observed[key]=expected;
  }
  return Object.freeze({schema:'CENTRAL_MIGRATION_PINNED_CONFIGURATION_HISTORY_V1',
    oldActor:OLD_ACTOR,newActor:NEW_ACTOR,pins:Object.freeze(observed),
    grantsNothing:true,sourceCompatibility:false,currentOwnershipVerified:false});
}
module.exports={inspectConfigurationBytes,PINS,OLD_ACTOR,NEW_ACTOR};
