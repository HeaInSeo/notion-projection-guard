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
  async function sori48(references,apply){
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
    const method=apply?'applySori48Closure':'checkSori48Closure';
    need(typeof runner[method]==='function','NORMAL_SORI48_RUNNER_REQUIRED');
    let failure=null;
    try{return await runner[method](config.batchId);}
    catch(error){failure=error;throw error;}
    finally{await close(client,failure);}
  }
  async function pairBody(admission,references){
    admission=copy(admission);references=copy(references);
    need(admission?.schema==='SORI48_CORRECTED_HEAD_PAIR_PROJECTION_V1'&&
      admission.applyAuthorized===false&&admission.requiresCanonicalClosure===true&&
      admission.metadataReconciliationRequired===true&&Array.isArray(admission.edits)&&
      admission.edits.length===8&&new Set(admission.edits.map(e=>e.pageId)).size===8,
      'NORMAL_SORI48_PAIR_PLAN');
    const ids=admission.edits.map(e=>e.pageId),requiredReferences=[...ids,
      '40786e6dd1d181ec8addcd1269f9b0bb','3b286e6dd1d18194866dd8d7a28c7ab4'];
    need(admission.observationId==='SORI48-PAIR-ADMIT-CORRECTED-20261030'&&
      Array.isArray(references)&&references.length===requiredReferences.length&&
      new Set(references.map(r=>r.pageId)).size===requiredReferences.length&&
      requiredReferences.every(id=>references.some(r=>r.pageId===id)),
      'NORMAL_SORI48_PAIR_REFERENCES');
    const transport=config.createTransport(tools),client=createClient(transport);
    const runner=config.createLiveRunner(transport,{client,createWitness:config.createWitness,
      centralTaskId:config.centralTaskId,runId:config.runId,references,nativeExpectations:[],
      sori48Pair:true,binding:{repository:'sori',source:{pr:48}},witnessConfig:config.witnessConfig});
    let failure=null;
    try{
      const result=await runner.run(admission.observationId,admission.edits);
      need(result?.status==='COMPLETED','NORMAL_SORI48_PAIR_BODY_INCOMPLETE');
      return {status:'BODY_COMPLETE',observationId:admission.observationId,
        bodyTargets:admission.edits.length,receipt:result};
    }catch(error){failure=error;throw error;}
    finally{await close(client,failure);}
  }
  async function pairMetadata(admission,references){
    references=copy(references);
    const required=['3f586e6dd1d181ebb43dd7de62aa2ca4','3f586e6dd1d181cd9f5bdcdab6290de7',
      '3f586e6dd1d181ddb9f3e7217f64bfcd','3b286e6dd1d1817aa093fca807659f07',
      '3b286e6dd1d181f2a75cfbd3885071c4','3bf86e6dd1d18110938bc358e17c779e',
      '3ed86e6dd1d18118b0b8d98bb91892fb','3b286e6dd1d1811d9308d9a2b56c9de4',
      '40786e6dd1d181ec8addcd1269f9b0bb','3b286e6dd1d18194866dd8d7a28c7ab4'];
    need(Array.isArray(references)&&references.length===required.length&&
      new Set(references.map(r=>r.pageId)).size===required.length&&
      required.every(id=>references.some(r=>r.pageId===id)),'NORMAL_SORI48_PAIR_REFERENCES');
    const transport=config.createTransport(tools),client=createClient(transport);
    const runner=config.createLiveRunner(transport,{client,createWitness:config.createWitness,
      centralTaskId:config.centralTaskId,runId:config.runId,references,nativeExpectations:[],
      sori48Metadata:true,bodyEdits:admission.edits,
      witnessConfig:{...config.witnessConfig,sori48Metadata:true}});
    let failure=null;
    try{
      const result=await runner.runSori48Metadata('SORI48-PAIR-METADATA-CORRECTED-20261030');
      need(result?.status==='COMPLETED'&&result.next===3&&result.receipts?.length===3,
        'NORMAL_SORI48_PAIR_METADATA_INCOMPLETE');
      return {status:'NATIVE_COMPLETE',nativeTargets:3,receipt:result};
    }catch(error){failure=error;throw error;}
    finally{await close(client,failure);}
  }
  return {async checkSori48Closure(references){return sori48(references,false);},
  async applySori48Closure(references){return sori48(references,true);},
  async runSori48PairBody(admission,references){return pairBody(admission,references);},
  async runSori48PairReconciliation(admission,references){
    const body=await pairBody(admission,references),native=await pairMetadata(admission,references);
    return {status:'PAIR_RECONCILED',body,native};
  },
  async run(bundle,references){
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
