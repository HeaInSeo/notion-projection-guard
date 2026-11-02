'use strict';
const fs=require('node:fs'),path=require('node:path');
const artifacts=require('./central_migration_artifacts.cjs');
const AUDIT='/home/heain/.local/state/notion-projection-guard/manual-audits/sori48-closure-20261029';
const CONFIG='/home/heain/.local/share/review-timeout/config.json';
const V3=AUDIT+'/scheduler-migration-6ae6e6e4c880819192e89cd430271bfa/revision3';
const files=Object.freeze({authorizationBytes:AUDIT+'/CENTRAL_SCHEDULER_MIGRATION_AUTHORIZATION-20261101.json',
  acceptanceBytes:V3+'/CONFIG_REVIEW_ACCEPTANCE.json',cutoverBytes:V3+'/CUTOVER_VERIFIED.json',configBytes:CONFIG});
const need=(ok,why)=>{if(!ok)throw Error('CENTRAL_MIGRATION_FILE_'+why);};
function read(file){
  // Match the existing runtime boundary: the fixed immediate directory must
  // belong to this user and reject shared writes; realpath rejects aliases in
  // the full path. Do not impose new permissions on unrelated host ancestors.
  const parent=path.dirname(file),directory=fs.lstatSync(parent);
  need(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===process.geteuid()&&
    !(directory.mode&0o022)&&fs.realpathSync(parent)===parent,'DIRECTORY');
  const before=fs.lstatSync(file);
  need(before.isFile()&&!before.isSymbolicLink()&&before.uid===process.geteuid()&&
    !(before.mode&0o022)&&before.size<=4*1024*1024,'INPUT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const opened=fs.fstatSync(fd);
    need(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&
      opened.uid===process.geteuid()&&!(opened.mode&0o022)&&opened.size<=4*1024*1024,'OPENED');
    const bytes=fs.readFileSync(fd,'utf8'),after=fs.fstatSync(fd),current=fs.lstatSync(file);
    const same=s=>s.dev===opened.dev&&s.ino===opened.ino&&s.size===opened.size&&
      s.mtimeMs===opened.mtimeMs&&s.ctimeMs===opened.ctimeMs&&s.mode===opened.mode&&s.uid===opened.uid;
    need(same(after)&&same(current)&&!current.isSymbolicLink(),'CHANGED');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function collectPinnedConfiguration(){
  // No path/expected-hash/RPC overrides. Source installation and actual current
  // run authority remain separate gates; immutable cutover history grants none.
  const input=Object.fromEntries(Object.entries(files).map(([k,p])=>[k,read(p)]));
  const history=artifacts.inspectConfigurationBytes(input);
  for(const [k,p] of Object.entries(files))need(read(p)===input[k],'CHANGED');
  return Object.freeze({artifacts:Object.freeze(input),history,grantsNothing:true});
}
module.exports={collectPinnedConfiguration};
