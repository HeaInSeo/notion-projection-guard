(function createOrdinaryFollowthrough(tools,config) {
  'use strict';
  // The adoption entry wires the new pieces to the unchanged runner. There is
  // no caller-selectable native scope separate from the validated task binding.
  const need=(ok,code)=>{if(!ok)throw Error(code);};
  for(const name of ['createTransport','createRunner','createCaseOwner','createPrerequisites','createLandedProjection','createProbeCommand'])
    need(typeof config[name]==='function','ORDINARY_FACTORY_REQUIRED');
  return {async run(bundle,references) {
    bundle=JSON.parse(JSON.stringify(bundle));references=JSON.parse(JSON.stringify(references));
    need(bundle?.binding&&Array.isArray(references),'ORDINARY_BINDING_REQUIRED');
    const nativePageIds=[bundle.binding.writer?.pageId,bundle.binding.reviewer?.pageId];
    need(nativePageIds.every(id=>typeof id==='string'&&references.some(r=>r.pageId===id)),'ORDINARY_NATIVE_SCOPE');
    const transport=config.createTransport(tools);
    let assertOwnership;
    const client=config.createRunner(transport,{...config.runnerConfig,
      // This entry exposes ordinary run only, with no case recovery bridges.
      caseAckBridge:false,casePageStaging:false,caseLiveOwnership:false,
      allowLegacyRecovery:false,assertOwnership:input=>assertOwnership(input)});
    try {
      const prerequisites=config.createPrerequisites(tools,{
        batchId:bundle.observationId,centralTaskId:config.centralTaskId,runId:config.runId,
        root:config.root,references,nativePageIds,nativeExpectations:bundle.native,edits:bundle.edits,
        extensionSourceHead:config.installation?.sourceHead,
        probeCommand:config.createProbeCommand(config.installation),getBrokerPid:transport.getNpgBrokerPid
      });
      assertOwnership=config.createCaseOwner(tools,client.broker,{
        centralTaskId:config.centralTaskId,
        actor:{kind:'scheduled',ownerId:'automation:'+config.centralTaskId,generation:config.runId},
        assertPrerequisites:prerequisites
      });
      return await config.createLandedProjection(tools,{createRunner:()=>client,runnerConfig:{}}).run(bundle);
    } finally {await client.close();}
  }};
})
