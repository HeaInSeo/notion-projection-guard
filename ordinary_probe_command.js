(function createOrdinaryProbeCommand(installation) {
  'use strict';
  // Load this hosted factory from reviewed immutable source. Its literal Node
  // bootstrap verifies remote bytes before evaluating any new probe code.
  const names=['additional_mcp_transport.js','landed_task_projection.js',
    'normal_projection_prerequisites.js','normal_projection_probe.cjs','ordinary_followthrough.js'];
  const c=JSON.parse(JSON.stringify(installation));
  if(!c||!/^[a-f0-9]{40}$/.test(c.sourceHead??'')||!/^[a-f0-9]{64}$/.test(c.caseModuleHash??'')||
    ![c.root,c.runtime,c.extensionDirectory].every(p=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0'))||
    c.extensionDirectory!==c.runtime+'/extensions/'+c.sourceHead||!c.files||
    Object.keys(c.files).sort().join(',')!==names.slice().sort().join(',')||
    !names.every(n=>/^[a-f0-9]{64}$/.test(c.files[n])))throw Error('ORDINARY_INSTALLATION_MANIFEST');
  const code=String.raw`
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
    const c=JSON.parse(process.argv[1]),args=process.argv.slice(2),need=(ok,k)=>{if(!ok)throw Error(k);};
    const names=['additional_mcp_transport.js','landed_task_projection.js',
      'normal_projection_prerequisites.js','normal_projection_probe.cjs','ordinary_followthrough.js'];
    const root=path.resolve(c.extensionDirectory),dir=fs.lstatSync(root);
    need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.geteuid()&&!(dir.mode&0o022)&&
      fs.realpathSync(root)===root,'ORDINARY_EXTENSION_DIRECTORY');
    const data={};
    for(const name of names){
      const file=path.join(root,name),s=fs.lstatSync(file);
      need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.geteuid()&&!(s.mode&0o022),'ORDINARY_EXTENSION_FILE');
      const bytes=fs.readFileSync(file);
      need(crypto.createHash('sha256').update(bytes).digest('hex')===c.files[name],'ORDINARY_FILE_PIN');
      data[name]=bytes.toString('utf8');
    }
    need(args.length===6&&args[0]==='--output'&&args[1]==='json'&&args[2]==='--broker-pid'&&
      /^[1-9][0-9]*$/.test(args[3])&&args[4]==='--batch'&&/^[A-Za-z0-9-]{1,100}$/.test(args[5]),'ORDINARY_PROBE_ARGUMENTS');
    const m={exports:{}};
    // Evaluate the verified buffer instead of re-reading with require().
    new Function('require','module','exports',data['normal_projection_probe.cjs'])(require,m,m.exports);
    const out=m.exports.probe({root:c.root,runtime:c.runtime,caseModuleHash:c.caseModuleHash,
      brokerPid:Number(args[3]),batchId:args[5]});
    console.log('NPG-NORMAL/1 '+JSON.stringify({...out,sourceHead:c.sourceHead,extensionsVerified:names.length}));
  `;
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  return 'node -e '+quote(code)+' '+quote(JSON.stringify(c))+' --output json';
})
