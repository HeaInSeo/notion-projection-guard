(function createNormalLiveCommand(installation){
  'use strict';
  const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
    'normal_projection_probe.cjs','ordinary_followthrough.js','normal_bridge.cjs','normal_live_owner.js',
    'normal_live_runner.js','normal_followthrough_v2.js','normal_live_command.js','reconcile_unpermitted_dispatch.cjs',
    'normal_rpc_client.js','normal_unsent.cjs','reconcile_permit_expiry.cjs','sori_startup_control.cjs'];
  const phaseNames=['SORI48_UNKNOWN_CLOSURE_PROPOSAL.json','sori48_unknown_state.cjs','sori48_unknown_closure.cjs',
    'sori48_unknown_runtime.cjs','sori48_unknown_evidence.cjs','sori48_unknown_sources.js','sori48_pair_provider.cjs','sori48_pair_metadata.cjs'];
  const c=JSON.parse(JSON.stringify(installation));
  if(!c||!/^[a-f0-9]{40}$/.test(c.sourceHead??'')||!/^[a-f0-9]{64}$/.test(c.caseModuleHash??'')||
    ![c.root,c.runtime,c.extensionDirectory].every(p=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0'))||
    c.extensionDirectory!==c.runtime+'/extensions/'+c.sourceHead||!c.files||
    Object.keys(c.files).sort().join(',')!==names.slice().sort().join(',')||
    !names.every(n=>/^[a-f0-9]{64}$/.test(c.files[n]))||
    (c.phaseProviders!==undefined&&(!c.phaseProviders||
      Object.keys(c.phaseProviders).sort().join(',')!==phaseNames.slice().sort().join(',')||
      !phaseNames.every(n=>/^[a-f0-9]{64}$/.test(c.phaseProviders[n])))))throw Error('NORMAL_INSTALLATION_MANIFEST');
  const bootstrap=String.raw`
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
    const c=JSON.parse(process.argv[1]),need=(v,k)=>{if(!v)throw Error(k);};
    const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
    const names=['additional_mcp_transport.js','landed_task_projection.js','normal_projection_prerequisites.js',
      'normal_projection_probe.cjs','ordinary_followthrough.js','normal_bridge.cjs','normal_live_owner.js',
      'normal_live_runner.js','normal_followthrough_v2.js','normal_live_command.js','reconcile_unpermitted_dispatch.cjs',
      'normal_rpc_client.js','normal_unsent.cjs','reconcile_permit_expiry.cjs','sori_startup_control.cjs'];
    const phaseNames=['SORI48_UNKNOWN_CLOSURE_PROPOSAL.json','sori48_unknown_state.cjs','sori48_unknown_closure.cjs',
    'sori48_unknown_runtime.cjs','sori48_unknown_evidence.cjs','sori48_unknown_sources.js','sori48_pair_provider.cjs','sori48_pair_metadata.cjs'];
    const data={};
    const trusted=file=>{const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&
      s.uid===process.geteuid()&&!(s.mode&0o022),'NORMAL_RUNTIME_FILE');return fs.readFileSync(file);};
    function verifyExtensions(){
      const dir=fs.lstatSync(c.extensionDirectory);
      need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.geteuid()&&!(dir.mode&0o022)&&
        fs.realpathSync(c.extensionDirectory)===c.extensionDirectory,'NORMAL_EXTENSION_DIRECTORY');
      for(const n of names){const bytes=trusted(path.join(c.extensionDirectory,n));
        need(hash(bytes)===c.files[n],'NORMAL_EXTENSION_PIN');data[n]=bytes.toString('utf8');}
      if(c.phaseProviders)for(const n of phaseNames){const bytes=trusted(path.join(c.extensionDirectory,n));
        need(hash(bytes)===c.phaseProviders[n],'NORMAL_PHASE_PROVIDER_PIN');data[n]=bytes.toString('utf8');}
    }
    verifyExtensions();
    const casePath=path.join(c.runtime,'case_exception.cjs');
    need(hash(trusted(casePath))===c.caseModuleHash,'NORMAL_CASE_PIN');
    const ce=require(casePath),manifest=ce.validateControl(c.root,JSON.parse(trusted(path.join(c.root,'journal.json'))));
    ce.controls(manifest);
    const core=require(path.join(c.runtime,'broker.cjs'));ce.controls(manifest);verifyExtensions();
    const load=n=>{const m={exports:{}};new Function('require','module','exports',data[n])(require,m,m.exports);return m.exports;};
    const phaseCache={};
    const loadPhase=n=>{if(phaseCache[n])return phaseCache[n];need(phaseNames.includes(n),'NORMAL_PHASE_REQUIRE');
      if(n.endsWith('.json'))return phaseCache[n]=JSON.parse(data[n]);
      const m={exports:{}},localRequire=id=>id.startsWith('./')?loadPhase(path.basename(id)):require(id);
      new Function('require','module','exports','__dirname',data[n])(localRequire,m,m.exports,c.extensionDirectory);return phaseCache[n]=m.exports;};
    const baseProbe=load('normal_projection_probe.cjs').probe;
    let closureRuntime,sori48Metadata;
    const probe=args=>baseProbe({...args,inspectClosedUnknown:()=>closureRuntime?.inspectCommitted(),
      inspectNativeMetadata:()=>sori48Metadata?.status()});
    const reconcile=load('reconcile_unpermitted_dispatch.cjs').createReconciler({...core,runtime:c.runtime});
    const unsent=load('normal_unsent.cjs'),restoreUnsent=unsent.createUnsent(core),resumePrepared=unsent.createPreparedResumer(core),
      resumeUnprepared=unsent.createUnpreparedResumer(core);
    const reconcilePermitExpiry=load('reconcile_permit_expiry.cjs').createReconciler({...core,runtime:c.runtime,restoreUnsent});
    const control=load('sori_startup_control.cjs');
    const validateControlInit=control.createAdmission({runtime:c.runtime});
    const assessControlPermit=control.createAssessor({...core,runtime:c.runtime});
    const continueApprovedControl=control.createUserCase({...core,runtime:c.runtime});
    let sori48ClosureCheck,createSori48Metadata;
    if(c.phaseProviders){
      const runtime=loadPhase('sori48_unknown_runtime.cjs').createRuntime({root:c.root,getBroker:()=>b});
      closureRuntime=runtime;
      const provider=loadPhase('sori48_unknown_closure.cjs').createProvider(runtime);
      const pairProvider=loadPhase('sori48_pair_provider.cjs').createProvider();
      const nativeModule=loadPhase('sori48_pair_metadata.cjs');
      createSori48Metadata=broker=>nativeModule.createExecutor({broker,
        inspectClosedUnknown:()=>runtime.inspectCommitted(),
        inspectBodyProjection:()=>nativeModule.inspectBodyProjection(broker,pairProvider.validatePlan)});
      const collectRetention=loadPhase('sori48_unknown_evidence.cjs').createCollector({
        root:c.root,runtime:c.runtime,caseModuleHash:c.caseModuleHash});
      const approvalPath=path.join(c.root,'manual-audits','sori48-closure-20261029','USER_APPROVAL.json');
      sori48ClosureCheck=async input=>{
        const pairAdmission=pairProvider.plan(input.lateObservation);
        const result=await provider({...input,...(runtime.inspectCommitted()?{}:collectRetention()),
          approvalBytes:trusted(approvalPath).toString('utf8'),
          beforeBytes:trusted(path.join(c.root,'journal.json')).toString('utf8')});
        return {...result,pairAdmission};
      };
    }
    const b=new core.Broker(c.root,JSON.parse(trusted(path.join(c.runtime,'policy.json'))));
    if(createSori48Metadata)sori48Metadata=createSori48Metadata(b);
    const bridge=load('normal_bridge.cjs').createBridge({broker:b,probe,installation:c,
      reconcileUnpermitted:reconcile,reconcilePermitExpiry,restoreUnsent,resumePrepared,resumeUnprepared,verifyExtensions,
      validateControlInit,assessControlPermit,continueApprovedControl,sori48ClosureCheck,sori48Metadata});
    process.stdout.write('NPG/2 {"ready":true}\n');
    const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
    rl.on('line',async line=>{let q;try{q=JSON.parse(line);const result=await bridge.handle(q);
      const reply=JSON.stringify({requestId:q.requestId,ok:true,result});
      need(reply.length<=32760,'NORMAL_RPC_REPLY_TOO_LARGE');
      process.stdout.write('NPG/2 '+reply+'\n',()=>{
        if(q.action==='close'){rl.close();process.stdin.destroy();process.exit(0);}});
    }catch(e){process.stdout.write('NPG/2 '+JSON.stringify({requestId:q?.requestId,ok:false,code:e.code??'ERROR',error:e.message,
      ...(e.retryBeforeAction?{retryBeforeAction:e.retryBeforeAction}:{})})+'\n');}});
    let closed=false;const close=()=>{if(!closed){closed=true;b.close();}};
    rl.on('close',close);process.on('exit',close);
    for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>{close();process.exit(0);});
  `;
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  return 'node -e '+quote(bootstrap)+' '+quote(JSON.stringify(c));
})
