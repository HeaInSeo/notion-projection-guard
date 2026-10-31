'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pairPage,events}=require('./test-fixtures/sori48_pair_correction.cjs');
const collector=require('./sori48_unknown_sources.js');
test('current CORRECTION57 links preserved 54/55/56 without accepting an unadmitted PASS',()=>{
 const raw=pairPage(),before=JSON.stringify(raw),p=collector.inspectPair(raw);
 assert.equal(p.event.version,57);assert.equal(p.event.kind,'CHECKPOINT');
 assert.equal(p.priorRelease.version,54);assert.equal(p.priorRelease.kind,'RELEASE');
 assert.equal(p.unadmittedClaim.version,55);assert.equal(p.unadmittedRelease.version,56);
 assert.equal(p.reviewAccepted,false);assert.equal(p.requiresFreshAdmittedReview,true);
 assert.equal(JSON.stringify(raw),before);
});
for(const [name,change] of [
 ['wrong current role',p=>p.text=p.text.replace('"role":"guardrail"','"role":"operator"')],
 ['wrong current head',p=>p.text=p.text.replace('b26246e4ab3870bf6f7516b08906791570b57163','f'.repeat(40))],
 ['wrong incident',p=>p.text=p.text.replaceAll('HeaInSeo/sori#48','HeaInSeo/sori#49')],
 ['wrong task',p=>p.text=p.text.replaceAll('SR-SORI-SM-W02.A-20261010','other')],
 ['current relabeled RELEASE',p=>p.text=p.text.replace('"kind":"CHECKPOINT"','"kind":"RELEASE"')],
 ['current active lease',p=>p.text=p.text.replace('"lease_state":"RELEASED"','"lease_state":"ACTIVE until 2099-01-01T00:00:00Z"')],
 ['native event mismatch',p=>p.text=p.text.replace('"이벤트 ID":"'+events[0].event_id+'"','"이벤트 ID":"other"')],
 ['native session mismatch',p=>p.text=p.text.replace('"세션 ID":"'+events[0].session_id+'"','"세션 ID":"other"')],
 ['native version mismatch',p=>p.text=p.text.replace('"체크포인트 버전":57','"체크포인트 버전":54')],
 ['missing correction disposition',p=>p.text=p.text.replace('UNADMITTED independent review','ACCEPTED review')],
 ['altered historical54 verdict',p=>p.text=p.text.replace('Verdict: NOT ACCEPTED','Verdict: PASS')],
 ['altered historical55 event',p=>p.text=p.text.replace(events[2].event_id,'other')],
 ['altered historical56 event',p=>p.text=p.text.replace(events[1].event_id,'other')],
 ['history masquerading as current',p=>p.text=p.text.replace('(history)','(current)')],
 ['duplicate linked history',p=>p.text=p.text.replace('</content>',pairPage().structuredContent.text.match(/<content>\n([\s\S]*?)\n<\/content>/)[1]+'\n</content>')],
 ['incomplete response',p=>p.truncated=true],
 ['unknown blocks',p=>p.unknown_block_ids=['missing']],
 ['missing properties',p=>p.text=p.text.replace('</properties>','')]
])test('pair evidence refuses '+name,()=>{const raw=pairPage();change(raw.structuredContent);assert.throws(()=>collector.inspectPair(raw),/SORI48_PAIR_EVIDENCE_/);});
test('Code Mode and CommonJS expose the identical pair validator',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const factory=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'sori48_unknown_sources.js'),'utf8'));
 assert.equal(JSON.stringify(factory.inspectPair(pairPage())),JSON.stringify(collector.inspectPair(pairPage())));
});
