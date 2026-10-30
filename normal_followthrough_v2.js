(function createNormalFollowthroughV2(tools,config){
  'use strict';
  const need=(v,c)=>{if(!v)throw Error(c);},copy=x=>JSON.parse(JSON.stringify(x));
  for(const k of ['createTransport','createClient','createLiveRunner','createWitness','createLandedProjection','createCommand'])
    need(typeof config[k]==='function','NORMAL_V2_FACTORY_REQUIRED');
  function createClient(transport){
    const client=config.createClient(transport,{...config.runnerConfig,command:config.createCommand(config.installation),
      allowLegacyRecovery:false,caseAckBridge:false,casePageStaging:false,caseLiveOwnership:false});
    need(typeof client.sendOnce==='function'&&typeof client.recoverPreCall==='function','NORMAL_RPC_CLIENT_REQUIRED');
    return client;
  }
  async function close(client,failure){
    try{await client.close();}catch(error){
      if(!failure)throw error;failure.closeError={message:error.message,code:error.code??null};
    }
  }
  return {async checkSori48Closure(references){
    references=copy(references);
    need(config.sori48Closure===true&&config.batchId==='SORI48-PAIR-ADMIT-20261029'&&
      /^[a-f0-9]{64}$/.test(config.schedulerEvidenceSha256??'')&&
      typeof config.createSori48SourceCollector==='function'&&Array.isArray(references)&&references.length>=4&&
      new Set(references.map(r=>r.pageId)).size===references.length,'NORMAL_SORI48_RUNNER_CONFIG');
    const transport=config.createTransport(tools),client=createClient(transport);
    const runner=config.createLiveRunner(transport,{client,createWitness:config.createWitness,
      centralTaskId:config.centralTaskId,runId:config.runId,references,nativeExpectations:[],
      sori48Closure:true,witnessConfig:{sori48Closure:true,
        schedulerEvidenceSha256:config.schedulerEvidenceSha256,
        createSori48SourceCollector:config.createSori48SourceCollector}});
    need(typeof runner.checkSori48Closure==='function','NORMAL_SORI48_RUNNER_REQUIRED');
    let failure=null;
    try{return await runner.checkSori48Closure(config.batchId);}
    catch(error){failure=error;throw error;}
    finally{await close(client,failure);}
  },async run(bundle,references){
    bundle=copy(bundle);references=copy(references);
    const ids=[bundle?.binding?.writer?.pageId,bundle?.binding?.reviewer?.pageId];
    need(Array.isArray(references)&&ids.every(id=>typeof id==='string'&&references.some(r=>r.pageId===id)),
      'NORMAL_V2_NATIVE_SCOPE');
    const transport=config.createTransport(tools),client=createClient(transport);
    const runner=config.createLiveRunner(transport,{client,createWitness:config.createWitness,
      centralTaskId:config.centralTaskId,runId:config.runId,references,nativeExpectations:bundle.native,
      binding:bundle.binding,recovery:config.recovery,witnessConfig:config.witnessConfig});
    let failure=null;
    try{return await config.createLandedProjection(tools,{createRunner:()=>runner,runnerConfig:{}}).run(bundle);}
    catch(error){failure=error;throw error;}
    finally{await close(client,failure);}
  }};
})
