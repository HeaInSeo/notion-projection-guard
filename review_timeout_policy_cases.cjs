'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {assess} = require('./review_timeout_policy.cjs');
const at = minutes => new Date(Date.UTC(2026, 9, 25) + minutes * 60000).toISOString();
function fixture(minutes = 61) {
  const scope = {repo:'example/project', pr:8, head:'a'.repeat(40), base:'b'.repeat(40)};
  return {version:1, scope, current:{...scope}, owner:'central', nextOwner:'review operator',
    next:'inspect exact requests and retained findings', nextTrigger:'result receipt or operator reconciliation', observedAt:at(minutes), results:[], findings:[],
    attempts:[{number:1, scope:{...scope}, requestId:'request-1', parentRequestId:null, owner:'central',
      intentAt:at(0), intentReceipt:'durable-intent-1', delivery:'ACKNOWLEDGED', requestReceipt:'request-url-1',
      channel:'GITHUB_CODEX', cancelSupported:false, termination:'UNKNOWN'}]};
}
function replacement(s) {
  s.attempts[0].timeoutReceipt = 'durable-timeout-1';
  s.attempts.push({...s.attempts[0], number:2, requestId:'request-2', parentRequestId:'request-1',
    intentAt:at(61), intentReceipt:'durable-intent-2', requestReceipt:'request-url-2'});
  return s;
}
function result(s, verdict = 'CLEAN', requestId = 'request-1') {
  s.results.push({resultId:'result-1', requestId, scope:{...s.scope}, receipt:'result-url', at:s.observedAt,
    verdict, findingIds:verdict === 'FINDINGS' ? ['defect-1'] : []});
  if (verdict === 'FINDINGS') s.findings.push({id:'defect-1', resultId:'result-1', receipt:'thread-url', disposition:'OPEN'});
  return s;
}
for (const [minutes, action] of [[0,'WAIT'],[29.999,'WAIT'],[30,'WARN'],[60,'WARN'],[60.001,'REPLACEMENT_CANDIDATE']])
  test('boundary at '+minutes+' minutes', () => assert.equal(assess(fixture(minutes)).action, action));
test('pure repeated assessment does not reserve, send, kill or pass', () => {
  const s=fixture(), before=structuredClone(s), a=assess(s), b=assess(s);
  assert.deepEqual(a,b); assert.deepEqual(s,before);
  assert.equal(a.dispatchAuthorized,false); assert.equal(a.gate,'NOT_ASSESSED');
  assert.equal(a.predecessorTermination,'UNKNOWN');
});
for (const delivery of ['INTENT','UNKNOWN']) test(delivery+' cannot be resent or timed into another attempt', () => {
  const s=fixture(1000); s.attempts[0].delivery=delivery;
  assert.equal(assess(s).reason,'RECONCILE_DELIVERY_NO_RESEND');
});
test('durable replacement prevents reentrant third request and eventually blocks with handoff', () => {
  const s=replacement(fixture(61)); assert.equal(assess(s).action,'WAIT');
  s.observedAt=at(121); assert.equal(assess(s).action,'WARN');
  s.observedAt=at(122); const r=assess(s);
  assert.equal(r.reason,'REPLACEMENT_TIMEOUT'); assert.equal(r.nextOwner,'review operator'); assert.ok(r.next);
  assert.equal(r.termination,'UNKNOWN');
});
test('supported cancellation requires observed exit, not timeout or cancel acknowledgement', () => {
  const s=fixture(); Object.assign(s.attempts[0],{channel:'MANAGED_PROCESS',cancelSupported:true,cancelReceipt:'ack'});
  assert.equal(assess(s).action,'VERIFY_TERMINATION');
  s.attempts[0].termination='CONFIRMED'; assert.throws(()=>assess(s));
  Object.assign(s.attempts[0],{terminationReceipt:'exit-observation',terminatedAt:at(61)});
  assert.equal(assess(s).action,'REPLACEMENT_CANDIDATE');
});
test('replacement timeout remains blocked even when cancellation is available', () => {
  const s=fixture(122); Object.assign(s.attempts[0],{channel:'MANAGED_PROCESS',cancelSupported:true,
    termination:'CONFIRMED',terminationReceipt:'exit',terminatedAt:at(61)});
  replacement(s); s.attempts[1].termination='UNKNOWN';
  assert.equal(assess(s).reason,'REPLACEMENT_TIMEOUT');
});
for (const field of ['head','base']) test('changed '+field+' rejects old clean evidence', () => {
  const s=result(fixture()); s.current[field]='c'.repeat(40);
  assert.equal(assess(s).reason,'SCOPE_CHANGED');
});
test('clean is only input to existing gates', () => {
  const r=assess(result(fixture())); assert.equal(r.action,'RECONCILE_RESULTS'); assert.equal(r.gate,'NOT_ASSESSED');
});
test('late original finding blocks despite replacement clean, and cannot disappear', () => {
  const s=result(replacement(fixture(100)),'FINDINGS');
  s.results.push({...s.results[0],resultId:'result-2',requestId:'request-2',verdict:'CLEAN',findingIds:[]});
  assert.equal(assess(s).reason,'FINDING_DISPOSITION_REQUIRED');
  s.findings=[]; assert.throws(()=>assess(s),/missing finding/);
});
test('old-head late defect is retained and requires new-head disposition evidence', () => {
  const s=result(fixture(),'FINDINGS'); s.current.head='c'.repeat(40);
  assert.deepEqual(assess(s).unresolvedFindings,['defect-1']);
  Object.assign(s.findings[0],{disposition:'FIXED',owner:'reviewer',evidence:'fix proof',assessedScope:s.scope});
  assert.deepEqual(assess(s).unresolvedFindings,['defect-1']);
});
test('valid finding resolution still does not bypass review gates', () => {
  const s=result(fixture(),'FINDINGS');
  Object.assign(s.findings[0],{disposition:'FIXED',owner:'reviewer',evidence:'fix proof',assessedScope:s.current});
  assert.equal(assess(s).action,'RECONCILE_RESULTS');
});
for (const [name, change] of [
  ['fake GitHub cancel',s=>{s.attempts[0].cancelSupported=true;}],
  ['missing owner',s=>{s.owner='';}],
  ['missing handoff',s=>{s.nextOwner='';}],
  ['missing trigger',s=>{s.nextTrigger='';}],
  ['future intent',s=>{s.attempts[0].intentAt=at(70);}],
  ['invalid calendar',s=>{s.observedAt='2026-02-30T00:00:00.000Z';}],
  ['short SHA',s=>{s.scope.head='abc';}],
  ['missing request receipt',s=>{delete s.attempts[0].requestReceipt;}],
  ['duplicate ID',s=>{replacement(s);s.attempts[1].requestId='request-1';}],
  ['wrong parent',s=>{replacement(s);s.attempts[1].parentRequestId='unknown';}],
  ['wrong repo',s=>{s.attempts[0].scope.repo='other/project';}],
  ['replacement before timeout',s=>{replacement(s);s.attempts[1].intentAt=at(60);}],
  ['missing timeout evidence',s=>{replacement(s);delete s.attempts[0].timeoutReceipt;}],
  ['channel conversion',s=>{replacement(s);s.attempts[1].channel='MANAGED_PROCESS';}],
  ['third attempt',s=>{replacement(s);s.attempts.push({...s.attempts[1],number:3});}],
  ['replacement of ambiguous request',s=>{replacement(s);s.attempts[0].delivery='UNKNOWN';}],
  ['replacement before exit',s=>{replacement(s);s.attempts.forEach(a=>Object.assign(a,{channel:'MANAGED_PROCESS',cancelSupported:true}));}],
  ['unbound result',s=>{result(s);s.results[0].requestId='other';}],
  ['unbound result head',s=>{result(s);s.results[0].scope.head='c'.repeat(40);}],
  ['duplicate result',s=>{result(s);s.results.push({...s.results[0]});}],
  ['unproven dismissal',s=>{result(s,'FINDINGS');s.findings[0].disposition='DISMISSED';}]
]) test('reject '+name,()=>{const s=fixture();change(s);assert.throws(()=>assess(s),/REVIEW_TIMEOUT_INPUT/);});

test('a second result cannot borrow the first result finding record', () => {
  const s=result(fixture(),'FINDINGS');
  s.results.push({...s.results[0],resultId:'result-2'});
  assert.throws(()=>assess(s),/missing finding/);
});
