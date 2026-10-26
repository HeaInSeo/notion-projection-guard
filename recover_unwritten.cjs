#!/usr/bin/env node
'use strict';
// Read private, separately approved case/evidence inputs; never send a mutation.
const fs=require('node:fs'),path=require('node:path');
const {Broker,loadUnwrittenManifest}=require('./broker.cjs');
function privateJson(file) {
  const st=fs.lstatSync(file);
  if(!path.isAbsolute(file)||!st.isFile()||st.isSymbolicLink()||st.uid!==process.geteuid()||(st.mode&0o077))
    throw Error('Private owned absolute input required');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function main(args) {
  const mode=args.shift(),options={};
  if(!['--check-only','--apply'].includes(mode)||args.length%2)throw Error('Explicit check-only/apply and paired flags required');
  for(let i=0;i<args.length;i+=2) {
    const flag=args[i];
    if(!['--manifest','--approved-manifest-sha256','--input','--approved-evidence-sha256'].includes(flag)||
        Object.hasOwn(options,flag)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid or duplicate recovery argument');
    options[flag]=args[i+1];
  }
  if(!options['--manifest']||!options['--approved-manifest-sha256']||!options['--input'])throw Error('Approved private manifest and input required');
  const {spec}=loadUnwrittenManifest(options['--manifest'],options['--approved-manifest-sha256']);
  const input=privateJson(options['--input']),apply=mode==='--apply';
  // existingOnly rejects a missing state/journal before acquiring any lock.
  const b=new Broker(spec.root,JSON.parse(fs.readFileSync(path.join(spec.runtime,'policy.json'),'utf8')),
    {readOnly:!apply,existingOnly:true});
  try {
    const r=b.handle({...input,action:'reconcile_verified_unsent',apply,
      manifestPath:options['--manifest'],approvedManifestHash:options['--approved-manifest-sha256'],
      approvedEvidenceHash:options['--approved-evidence-sha256']??null});
    process.stdout.write(JSON.stringify({ok:true,...r})+'\n');
  } finally {b.close();}
}
if(require.main===module) {
  try{main(process.argv.slice(2));}
  catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.code??'ARGUMENTS',
    assessment:e.assessment??null,error:e.message,
    next:e.assessment?.next??'Preserve the existing state and inspect the exact rejection; do not resume or resend'})+'\n');process.exitCode=1;}
}
module.exports={main};
