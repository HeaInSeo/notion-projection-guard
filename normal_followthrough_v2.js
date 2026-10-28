(function createNormalFollowthroughV2(tools,config){
  'use strict';
  const need=(v,c)=>{if(!v)throw Error(c);},copy=x=>JSON.parse(JSON.stringify(x));
  for(const k of ['createTransport','createClient','createLiveRunner','createWitness','createLandedProjection','createCommand'])
    need(typeof config[k]==='function','NORMAL_V2_FACTORY_REQUIRED');
  return {async run(bundle,references){
    bundle=copy(bundle);references=copy(references);
    const ids=[bundle?.binding?.writer?.pageId,bundle?.binding?.reviewer?.pageId];
    need(Array.isArray(references)&&ids.every(id=>typeof id==='string'&&references.some(r=>r.pageId===id)),
      'NORMAL_V2_NATIVE_SCOPE');
    const transport=config.createTransport(tools);
    const client=config.createClient(transport,{...config.runnerConfig,command:config.createCommand(config.installation),
      allowLegacyRecovery:false,caseAckBridge:false,casePageStaging:false,caseLiveOwnership:false});
    need(typeof client.sendOnce==='function'&&typeof client.recoverPreCall==='function','NORMAL_RPC_CLIENT_REQUIRED');
    const runner=config.createLiveRunner(transport,{client,createWitness:config.createWitness,
      centralTaskId:config.centralTaskId,runId:config.runId,references,nativeExpectations:bundle.native,
      binding:bundle.binding,recovery:config.recovery});
    try{return await config.createLandedProjection(tools,{createRunner:()=>runner,runnerConfig:{}}).run(bundle);}
    finally{await client.close();}
  }};
})
