#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Broker}=require('./broker.cjs');
const {bytes,loadManifest}=require('./case_exception.cjs');
function main(args) {
  const mode=args.shift(),opts={};
  if(!['--check-only','--apply'].includes(mode)||args.length%2)throw Error('Explicit mode required');
  for(let i=0;i<args.length;i+=2) {
    if(!['--manifest','--approved-manifest-sha256','--input','--approval','--approved-approval-sha256'].includes(args[i])||
      Object.hasOwn(opts,args[i]))throw Error('Invalid arguments');opts[args[i]]=args[i+1];
  }
  const input=JSON.parse(bytes(opts['--input'])),apply=mode==='--apply';
  Object.assign(input,{manifestPath:opts['--manifest'],approvedManifestHash:opts['--approved-manifest-sha256'],
    approvalPath:opts['--approval'],approvedApprovalHash:opts['--approved-approval-sha256'],apply});
  const {spec}=loadManifest(input);
  const b=new Broker(spec.root,JSON.parse(fs.readFileSync(path.join(spec.runtime,'policy.json'),'utf8')),
    {readOnly:!apply,existingOnly:true});
  try{process.stdout.write(JSON.stringify(b.handle({...input,action:'reconcile_scoped_exception'}))+'\n');}
  finally{b.close();}
}
if(require.main===module)try{main(process.argv.slice(2));}catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.code??'ARGUMENTS',error:e.message})+'\n');process.exitCode=1;}
module.exports={main};
