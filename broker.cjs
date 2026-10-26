#!/usr/bin/env node
'use strict';
// The broker owns planning and the durable page barrier. It has no Notion token.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const caseException = require('./case_exception.cjs');

class GuardError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new GuardError(code, message); }
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function privateFileBytes(file) {
  const st=fs.lstatSync(file);
  if(!path.isAbsolute(file)||!st.isFile()||st.isSymbolicLink()||st.uid!==process.geteuid()||(st.mode&0o077))
    fail('RECOVERY_EVIDENCE','Private owned absolute evidence file required');
  return fs.readFileSync(file,'utf8');
}
function loadUnwrittenManifest(file,approvedHash) {
  const bytes=privateFileBytes(file),s=JSON.parse(bytes),digest=/^[a-f0-9]{64}$/;
  if(!digest.test(approvedHash??'')||hash(bytes)!==approvedHash)
    fail('RECOVERY_MANIFEST_PIN','Separately approved exact private manifest bytes required');
  if(!s||typeof s!=='object'||s.schema!=='EXACT_UNWRITTEN_CASE_V1'||s.recoveryKind!=='POST_AUTHORIZE_PRE_INVOKE_VETO'||
      !path.isAbsolute(s.root??'')||!path.isAbsolute(s.runtime??'')||
      !/^[A-Za-z0-9_.:-]{1,150}$/.test(s.batchId??'')||['__proto__','prototype','constructor'].includes(s.batchId)||
      !['planHash','snapshotHash','journalHash','evidenceHash','adapterHash','installationHash'].every(k=>digest.test(s[k]??''))||
      !/^[a-f0-9]{40}$/.test(s.sourceCommit??'')||
      !['ticket','error','authorizationRequestId'].every(k=>typeof s[k]==='string'&&s[k].trim())||
      !['conversationId','responseMessageId'].every(k=>typeof s.caller?.[k]==='string'&&s.caller[k].trim())||
      Object.keys(s.pins??{}).sort().join(',')!=='approved.sha256,broker.cjs,policy.json,runner.js'||
      !Object.values(s.pins).every(h=>digest.test(h)))
    fail('RECOVERY_MANIFEST_PIN','Exact supported case identity, source and installed pins required');
  for(const k of ['evidence','installation']) {
    if(typeof s[k]!=='string'||path.isAbsolute(s[k])||path.relative(s.root,path.resolve(s.root,s[k])).startsWith('..'))
      fail('RECOVERY_MANIFEST_PIN','Evidence must remain inside the approved canonical root');
  }
  return {spec:s,manifestHash:approvedHash};
}
function assessUnwrittenExecution(spec,input) {
  const missing=(code,items)=>({classification:'C',code,riskObserved:false,missing:items,
    owner:'Original Code Mode invocation/tool execution record owner',
    next:'Obtain the scoped invocation terminal receipt and post-authorize native/transport/child-call segment; independently review its source and digest'});
  if(typeof input.rawExecutionTrace!=='string'||!/^[a-f0-9]{64}$/.test(input.approvedEvidenceHash??''))
    return missing('RECOVERY_EVIDENCE_MISSING',['original invocation identity/terminal receipt','post-authorize native/transport/child dispatch coverage']);
  if(hash(input.rawExecutionTrace)!==input.approvedEvidenceHash)
    return missing('RECOVERY_EVIDENCE_INVALID',['approved execution evidence bytes do not match']);
  let t;try{t=JSON.parse(input.rawExecutionTrace);}catch{return missing('RECOVERY_EVIDENCE_INVALID',['invalid execution record']);}
  if(!t||typeof t!=='object'||t.schema!=='REVIEWED_CODE_MODE_TRACE_V1'||t.purpose!=='NOTION_MUTATION'||
      t.provenance?.layer!=='CODE_MODE_CONTROL_PLANE'||
      typeof t.provenance?.independentReviewer!=='string'||!t.provenance.independentReviewer.trim())
    return missing('RECOVERY_EVIDENCE_MISSING',['Code Mode control-plane provenance; broker exit or another provider is insufficient']);
  const subject=t.subject,inv=t.invocation;
  if(!subject||!['batchId','planHash','ticket','snapshotHash'].every(k=>subject[k]===spec[k])||
      subject.conversationId!==spec.caller.conversationId||subject.responseMessageId!==spec.caller.responseMessageId||
      typeof inv?.id!=='string'||!inv.id.trim()||subject.invocationId!==inv.id)
    return missing('RECOVERY_EVIDENCE_INVALID',['original invocation/case correlation differs']);
  const sources=t.provenance.sourceRecords;
  if(!Array.isArray(sources)||!sources.length||sources.some(s=>!s||typeof s!=='object')||
      new Set(sources.map(s=>s.key)).size!==sources.length||
      sources.some(s=>typeof s.key!=='string'||!s.key||!/^[a-f0-9]{64}$/.test(s.sha256??'')||
        typeof input.sourceRecords?.[s.key]!=='string'||hash(input.sourceRecords[s.key])!==s.sha256))
    return missing('RECOVERY_EVIDENCE_INVALID',['pinned original source records are absent or changed']);
  const sourceKeys=new Set(sources.map(s=>s.key)),events=t.events;
  if(!Array.isArray(events)||!events.length||events.some(e=>!e||typeof e!=='object')||
      new Set(events.map(e=>e.id)).size!==events.length||
      events.some((e,i)=>typeof e.id!=='string'||!e.id||e.sequence!==i+1||e.invocationId!==inv.id||!sourceKeys.has(e.sourceRecord)))
    return missing('RECOVERY_EVIDENCE_INVALID',['ordered, source-bound events for one invocation required']);
  // Positive observed sends/live executions outrank incomplete negative coverage.
  // A broker's authorize/request export is a protocol event, not a native send.
  const routes=events.filter(e=>['NATIVE_MUTATION_INVOKED','TRANSPORT_HANDOFF','SEND_RESULT_UNKNOWN',
    'DISPATCH_PROCESS_CREATED','ASYNC_MUTATION_CREATED','QUEUED_MUTATION','DEFERRED_MUTATION'].includes(e.kind));
  const terminalIndex=events.findLastIndex(e=>e.kind==='INVOCATION_TERMINAL'&&
    ['COMPLETED','FAILED','CANCELLED','TERMINATED'].includes(e.status)&&e.resumable===false&&
    validUtcTimestamp(e.at)&&Date.parse(e.at)<=Date.now());
  // A historical RUNNING transition is consumed by that same invocation's
  // later terminal receipt. It is not a perpetual live-executor condition.
  events.forEach((e,i)=>{
    if(['EXECUTOR_RUNNING','EXECUTOR_RESUMABLE'].includes(e.kind)&&i>terminalIndex)routes.push(e);
    if(e.kind==='INVOCATION_TERMINAL'&&e.resumable===true&&i>terminalIndex)routes.push({...e,kind:'EXECUTOR_RESUMABLE'});
  });
  if(['RUNNING','RESUMABLE','YIELDED'].includes(inv.status))routes.push({kind:'EXECUTOR_'+inv.status,id:inv.id});
  if(inv.resumable===true)routes.push({kind:'EXECUTOR_RESUMABLE',id:inv.id});
  if(routes.length)return {classification:'B',code:'RECOVERY_OBSERVED_DISPATCH_OR_EXECUTOR',riskObserved:true,
    invocationId:inv.id,routes:routes.map(e=>Object.fromEntries(['kind','id','invocationId','providerRequestId','taskId','processRef','at']
      .filter(k=>typeof e[k]==='string').map(k=>[k,e[k]]))),owner:'Owner of the identified invocation/provider request or dispatch task',
    next:'Resolve only the observed route: confirm termination for the live invocation, or reconcile/cancel the correlated native request/task; retain barrier and obtain separate approval for security/permission changes'};
  const known=new Set(['AUTHORIZE_RETURNED','PRE_INVOKE_VETO','BROKER_PROTOCOL','OWNERSHIP_CHECK','NATIVE_READ',
    'EXECUTOR_RUNNING','EXECUTOR_RESUMABLE','INVOCATION_TERMINAL']);
  const gaps=[];
  if(events.some(e=>!known.has(e.kind)))gaps.push('unclassified call event');
  if(!events.some(e=>e.kind==='AUTHORIZE_RETURNED'&&e.requestId===spec.authorizationRequestId&&e.ticket===spec.ticket))
    gaps.push('original authorize-response correlation');
  const coverage=t.coverage??{};
  if(coverage.fromAuthorizationRequestId!==spec.authorizationRequestId||coverage.complete!==true||
      !['throughTerminal','nativeMutationCalls','transportHandoffs','childDispatchRoutes'].every(k=>coverage[k]===true))
    gaps.push('complete post-authorize native/transport/child-route span');
  const terminal=events.at(-1);
  if(!['COMPLETED','FAILED','CANCELLED','TERMINATED'].includes(inv.status)||inv.resumable!==false||
      terminal.kind!=='INVOCATION_TERMINAL'||terminal.id!==inv.terminalEventId||
      terminal.status!==inv.status||terminal.resumable!==false||!validUtcTimestamp(terminal.at)||Date.parse(terminal.at)>Date.now())
    gaps.push('original invocation terminal/non-resumable receipt');
  if(gaps.length)return missing('RECOVERY_EVIDENCE_MISSING',gaps);
  return {classification:'A',code:'VERIFIED_TERMINAL_NO_SEND',riskObserved:false,invocationId:inv.id,
    terminalEventId:terminal.id,terminalAt:terminal.at,approvedEvidenceHash:input.approvedEvidenceHash,
    nativeMutationCalls:0,transportHandoffs:0,childDispatchRoutes:0,
    recovery:'Exact terminal unwritten closure only; no additional hypothetical executor fencing required'};
}
function validUtcTimestamp(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return false;
  const stamp=Date.parse(value);
  return Number.isFinite(stamp)&&new Date(stamp).toISOString()===
    value.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>'.'+(fraction??'').padEnd(3,'0')+'Z');
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value.replaceAll('-', '')))
    fail('PAGE_ID', 'A native page UUID is required');
  return value.replaceAll('-', '').toLowerCase();
}
// Reviewed legacy central anchors only. A policy cannot authorize arbitrary
// CURRENT/worker headings or grant these pages the general prefix permission.
const legacyCentralSections = Object.freeze({
  '3f586e6dd1d181ebb43dd7de62aa2ca4': '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3',
  '3f586e6dd1d181cd9f5bdcdab6290de7': '## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED'
});
function exactCentralSection(edit, policy) {
  const pageId = id(edit.pageId);
  return legacyCentralSections[pageId] === edit.heading &&
    (policy.centralSections ?? []).some(s => s.pageId === pageId && s.heading === edit.heading);
}
function unwrap(value) {
  for (let n = 0; n < 5 && value?.structuredContent; n++) {
    if (value.isError) fail('FETCH_ERROR', 'Connector returned an error');
    value = value.structuredContent;
  }
  if (!value || value.isError || value.error) fail('FETCH_ERROR', 'No successful page result');
  return value;
}
function pageData(raw, expectedId) {
  const page = unwrap(raw);
  if (id(page.id) !== id(expectedId)) fail('WRONG_PAGE', 'Fetched page does not match the plan');
  if (page.truncated === true || (page.unknown_block_count ?? 0) !== 0 ||
      (page.unknown_block_ids?.length ?? 0) !== 0) fail('INCOMPLETE_READ', 'Incomplete native read');
  // A missing/invalid revision is not a concurrency token. In particular, two
  // incomplete reads must never authorize a write through null === null.
  const revision = page.page_last_edited_at;
  const stamp = typeof revision === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(revision)
    ? Date.parse(revision) : NaN;
  const canonical = typeof revision === 'string'
    ? revision.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => '.' + (fraction ?? '').padEnd(3, '0') + 'Z') : '';
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== canonical)
    fail('INCOMPLETE_READ', 'A valid UTC page revision is required');
  const text = page.text;
  if (typeof text !== 'string') fail('INCOMPLETE_READ', 'Missing page text');
  const begin = '<content>\n', end = '\n</content>';
  if (text.split(begin).length !== 2 || text.split(end).length !== 2)
    fail('INCOMPLETE_READ', 'Expected one complete content envelope');
  const start = text.indexOf(begin) + begin.length, stop = text.indexOf(end, start);
  if (stop < start || /<unknown\b|content (?:has been |is )?truncated/i.test(text))
    fail('INCOMPLETE_READ', 'Unknown or truncated blocks');
  const properties = text.match(/<properties>\n([\s\S]*?)\n<\/properties>/);
  if (!properties) fail('INCOMPLETE_READ', 'Missing properties envelope');
  // Compare parsed properties: key ordering is not a semantic change.
  let props;
  try { props = JSON.parse(properties[1]); } catch { fail('INCOMPLETE_READ', 'Invalid properties'); }
  const ordered = Object.fromEntries(Object.entries(props).sort(([a], [b]) => a.localeCompare(b)));
  return { body: text.slice(start, stop), properties: JSON.stringify(ordered),
    revision, raw: clone(raw) };
}
function headings(body) {
  const result = []; let offset = 0, fence = null, inline = null; const stack = [];
  const native = 'details|callout|columns|column|tabs|tab|table|synced_block|synced_block_reference|meeting-notes';
  const open = new RegExp('^\\s*<(' + native + ')(?:\\s|>)');
  const close = new RegExp('^\\s*</(' + native + ')>');
  for (const line of body.split('\n')) {
    // A heading/fence/native tag inside a preceding multiline code span has
    // no ownership meaning. Carry the same lexer state used by literal plans.
    if(inline) { inline=scanInline(line,inline).open;offset+=line.length+1;continue; }
    const code = line.match(/^\s*(`{3,}|~{3,})/);
    if (code) {
      if (!fence) {
        if(code[1][0]==='`' && line.slice(code[0].length).includes('`'))fail('STRUCTURE','Backtick fence info cannot contain backticks');
        fence = { char: code[1][0], size: code[1].length };
      } else if (code[1][0] === fence.char && code[1].length >= fence.size) {
        if(line.slice(code[0].length).trim())fail('STRUCTURE','Closing fence must occupy its own line');
        fence = null;
      }
    } else if (!fence) {
      const c = line.match(close), o = line.match(open);
      if(c || o) {
        // Structural tags must occupy their line; quoted attribute values may
        // contain >. Never silently discard a trailing inline-code opener.
        let quote=null,end=-1;
        for(let i=0;i<line.length;i++) {
          if(quote){if(line[i]===quote)quote=null;}
          else if(line[i]==='"'||line[i]==="'")quote=line[i];
          else if(line[i]==='>'){end=i+1;break;}
        }
        if(end<0||line.slice(end).trim())fail('STRUCTURE','Native structural tag must occupy its own line');
        if(c){if(stack.pop()!==c[1])fail('STRUCTURE','Unbalanced native container');}
        else if(!/\/>\s*$/.test(line))stack.push(o[1]);
      } else {
        const h = line.match(/^(#{1,4}) (.+)$/);
        if (h && !stack.length) result.push({ text: line, level: h[1].length, start: offset, end: offset + line.length });
        // Ordinary text inside containers can also open a multiline span.
        inline=scanInline(line).open;
      }
    }
    offset += line.length + 1;
  }
  if (fence || stack.length) fail('STRUCTURE', 'Incomplete fenced/native container');
  return result;
}
function validateEdit(edit, policy) {
  if (!edit || Object.keys(edit).some(k => !['pageId', 'heading', 'oldStr', 'newStr'].includes(k)))
    fail('EDIT_SCHEMA', 'Only pageId, heading, oldStr and newStr are accepted');
  const pageId = id(edit.pageId);
  const ownsHeading = Object.hasOwn(legacyCentralSections, pageId)
    ? exactCentralSection(edit, policy)
    : policy.headingPrefixes.some(prefix => edit.heading?.startsWith(prefix));
  if (!ownsHeading)
    fail('OWNERSHIP', 'Only explicit central-owned observation headings are editable');
  for (const field of ['oldStr', 'newStr']) {
    const value = edit[field];
    if (typeof value !== 'string' || !value.length || value.length > 1024 || /[\r\n\u0000]/.test(value))
      fail('RANGE_LIMIT', 'Use one nonempty exact literal of at most 1024 characters');
    // A fetched inline-code annotation may be serialized as <code>...</code>.
    // Admit only complete existing spans on the removal side. New text still
    // cannot introduce HTML/native tags, and own-event syntax is never masked.
    const syntax = field === 'oldStr' ? maskSerializedCode(value) : value;
    if (/^\s*#|```|~~~|<\/?[a-z][^>]*>/i.test(syntax) || /QUEUE_EVENT_V1/i.test(value))
      fail('PROTECTED_SYNTAX', 'Headings, native blocks and own event records are protected');
  }
  if (edit.oldStr === edit.newStr) fail('NO_CHANGE', 'No-op is not an update');
}
function validateScope(edit, policy) {
  validateEdit(edit, policy);
  const pageId = id(edit.pageId);
  if (!policy.canaryPages.includes(pageId) && (!policy.productionEnabled ||
      (!policy.productionPages.includes(pageId) && !exactCentralSection(edit, policy))))
    fail('PRODUCTION_HOLD', 'Production remains blocked until incident restoration');
}
function plainMarkup(text) {
  // Require explicit code/link markup for hostname-shaped filenames. Notion
  // can turn these into links, invalidating the exact post-write comparison.
  return text.replace(/(?<![\\`])(`{1,2})(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, match => ' '.repeat(match.length))
    .replace(/(?<!\\)\[[^\]\\\r\n]+\]\(https?:\/\/[^\s()\\]+\)/g, match => ' '.repeat(match.length));
}
function bareAutolinks(text) {
  return [...plainMarkup(text).matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\b/gi)]
    .map(match => match[0]);
}
function stableNewText(edit) {
  inlineSpans(edit.oldStr);inlineSpans(edit.newStr);
  // Notion exports newly written inline code as <code> and escapes literal
  // underscores. The removal side must keep accepting those exact exported
  // bytes, but a new central literal must not create another unacknowledgeable
  // write. Reject before begin/prepare/authorize; never normalize readbacks.
  if (/[`_]/.test(edit.newStr))
    fail('MARKDOWN_SERIALIZATION_RISK', 'New central text must avoid backticks and underscores; use plain hyphenated labels');
  if (bareAutolinks(edit.newStr).length)
    fail('AUTOLINK_RISK', 'Use an explicit Markdown link for hostname-shaped filenames and URLs');
  if (plainMarkup(edit.newStr).includes('->'))
    fail('MARKDOWN_ESCAPE_RISK', 'Use a Unicode arrow instead of a plain ASCII arrow');
}
function scanInline(text,open=null) {
  // Escapes outside spans are Markdown escapes; inside, backslashes are literal.
  const spans=[];
  for(let i=0;i<text.length;) {
    if(open?.html) {
      if(text.startsWith('</code>',i)) {
        const end=i+7;spans.push({start:open.start,end,html:true});open=null;i=end;continue;
      }
      if(/^<\/?code(?:\s|>|\/)/i.test(text.slice(i)))
        fail('INLINE_CODE_BOUNDARY','Only exact balanced serialized code tags are supported');
      i++;continue;
    }
    if(!open && text[i]==='\\') { i+=2; continue; }
    if(!open && text.startsWith('<code>',i)){open={start:i,html:true};i+=6;continue;}
    if(!open && /^<\/?code(?:\s|>|\/)/i.test(text.slice(i)))
      fail('INLINE_CODE_BOUNDARY','Only exact balanced serialized code tags are supported');
    if(text[i]!=='`') { i++; continue; }
    let end=i+1; while(text[end]==='`')end++;
    const size=end-i;
    if(!open)open={start:i,size};
    else if(size===open.size){spans.push({start:open.start,end});open=null;}
    i=end;
  }
  return {spans,open};
}
function maskSerializedCode(text) {
  // Historical halted plans can contain the original broken Markdown field.
  // Leave their existing admission/reconciliation path unchanged when there
  // is no serialized code wrapper to admit.
  if(!/<\/?code(?:\s|>|\/)/i.test(text))return text;
  const spans=inlineSpans(text).filter(span=>span.html);
  let out=text;
  for(const span of [...spans].reverse()) {
    if(/[<>]/.test(text.slice(span.start+6,span.end-7)))
      fail('PROTECTED_SYNTAX','Serialized code must contain plain text only');
    out=out.slice(0,span.start)+' '.repeat(span.end-span.start)+out.slice(span.end);
  }
  return out;
}
function inlineSpans(text) {
  const parsed=scanInline(text);
  if(parsed.open)fail('INLINE_CODE_BOUNDARY','Use complete balanced inline-code fields; never cut a field to fit the limit');
  return parsed.spans;
}
function inlineEdit(body,index,edit,start,stop) {
  // Parse from the owned section boundary, not the affected line: a span can
  // open on a preceding line and close here before another multiline span.
  const content=body.slice(start,stop),a=index-start,b=a+edit.oldStr.length;
  for(const span of inlineSpans(content))
    if((a>span.start&&a<span.end)||(b>span.start&&b<span.end))
      fail('INLINE_CODE_BOUNDARY','Selection begins or ends inside an existing inline-code field');
  inlineSpans(edit.oldStr);inlineSpans(edit.newStr);
  inlineSpans(content.slice(0,a)+edit.newStr+content.slice(b));
}
function reviewedArrowLiteral(edit) {
  if (bareAutolinks(edit.newStr).length ||
      plainMarkup(edit.newStr).split(' -> ').length !== 3 || edit.newStr.split('->').length !== 3)
    fail('RECONCILE_SCOPE', 'Only the two observed plain central arrows are admitted');
  return edit.newStr.replaceAll(' -> ', ' -\\> ');
}
function plan(page, edit) {
  // Decode only the observed underscore escape in a heading identity. Body,
  // offsets, properties, snapshots and post-write verification remain exact.
  const matches = headings(page.body).filter(h => h.text.replaceAll('\\_','_') === edit.heading);
  if (matches.length !== 1) fail('AMBIGUOUS_SECTION', 'Central heading must occur exactly once');
  const section = matches[0];
  const boundary = headings(page.body).find(h => h.start > section.start && h.level <= section.level);
  if (!boundary) fail('UNBOUNDED_SECTION', 'A following peer/parent heading is required');
  const index = page.body.indexOf(edit.oldStr);
  if (index < 0 || page.body.indexOf(edit.oldStr, index + 1) >= 0)
    fail('AMBIGUOUS_LITERAL', 'Old literal must occur exactly once in the entire body');
  if (index <= section.end || index + edit.oldStr.length > boundary.start)
    fail('OUTSIDE_SECTION', 'Literal crosses the explicit central section');
  // A nested native/fenced/worker proof section is never central-owned.
  const content = page.body.slice(section.end, boundary.start);
  if (headings(page.body).some(h => h.start > section.end && h.start < boundary.start))
    fail('PROTECTED_SECTION', 'Nested headings require a separately reviewed central section');
  if (/```|~~~|<\/?(?:synced_block|synced_block_reference|page|database|folder|unknown|meeting-notes)\b|QUEUE_EVENT_V1/.test(content))
    fail('PROTECTED_SECTION', 'Native/fenced/worker content prevents editing this section');
  if (/\b(?:event_id|session_id|lease_state)\s*[":=]/.test(content))
    fail('PROTECTED_SECTION', 'Worker own proof is present in the section');
  const before = page.body.slice(0, index), after = page.body.slice(index + edit.oldStr.length);
  inlineEdit(page.body,index,edit,section.end,boundary.start);
  const expected = before + edit.newStr + after;
  if (page.body.includes(edit.newStr)) fail('AMBIGUOUS_RESULT', 'New literal already occurs in the body');
  return { expected, beforeHash: hash(before), afterHash: hash(after), index,
    request: { page_id: id(edit.pageId), command: 'update_content', allow_async: false,
      allow_deleting_content: false, content_updates: [
        { old_str: edit.oldStr, new_str: edit.newStr, replace_all_matches: false }] } };
}
function syncDir(dir) {
  const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomic(file, value) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  const data = JSON.stringify(value);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); syncDir(path.dirname(file)); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  if (fs.readFileSync(file, 'utf8') !== data) fail('PERSISTENCE', 'Journal readback differs');
}
function read(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077)) fail('PERSISTENCE', 'Private regular file required');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

class Broker {
  constructor(root, policy, options={}) {
    const centralPrefixes = ['## CURRENT CENTRAL OBSERVATION', '## CURRENT CENTRAL ACTION', '## CURRENT INCIDENT MAINTENANCE'];
    if (!policy || typeof policy.productionEnabled !== 'boolean' ||
        !Array.isArray(policy.productionPages) || !Array.isArray(policy.canaryPages) ||
        !Array.isArray(policy.headingPrefixes) || !policy.headingPrefixes.length ||
        policy.headingPrefixes.some(p => !centralPrefixes.includes(p))) fail('POLICY', 'Invalid central-owned policy');
    for (const page of [...policy.productionPages, ...policy.canaryPages]) {
      if (id(page) !== page) fail('POLICY', 'Policy requires canonical page UUIDs');
    }
    if (policy.canaryPages.some(page => Object.hasOwn(legacyCentralSections, page)))
      fail('POLICY', 'Legacy central task pages are never canaries');
    const sections = Object.hasOwn(policy, 'centralSections') ? policy.centralSections : [];
    if (!Array.isArray(sections) || sections.length > 2)
      fail('POLICY', 'Only the two reviewed legacy central anchors are supported');
    const seen = new Set();
    for (const section of sections) {
      if (!section || Object.keys(section).length !== 2 ||
          typeof section.pageId !== 'string' || !Object.hasOwn(legacyCentralSections, section.pageId) ||
          section.heading !== legacyCentralSections[section.pageId] || seen.has(section.pageId))
        fail('POLICY', 'Exact reviewed page/heading pairs required');
      seen.add(section.pageId);
    }
    this.root = path.resolve(root); this.policy = policy; this.file = path.join(this.root, 'journal.json');
    this.executor=crypto.randomUUID();this.closed=false;
    this.readOnly=options.readOnly===true;
    if(!this.readOnly&&!options.existingOnly)fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(this.root);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077)) fail('PERSISTENCE', 'Private state directory required');
    if(options.existingOnly)privateFileBytes(this.file);
    // One process owns all batches. A process crash leaves this lock fail-closed.
    this.lock = path.join(this.root, 'broker.lock');
    if(!this.readOnly) {
      try { fs.writeFileSync(this.lock, JSON.stringify({ pid: process.pid, executor:this.executor, at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
      catch { fail('LOCKED', 'Existing broker lock requires owner inspection'); }
      syncDir(this.root);
    }
    this.state = fs.existsSync(this.file) ? read(this.file) : { version: 1, batches: {}, active: null };
    this.recovery = null;
    this.fencedInternal = false;
  }
  assertLock() {
    if(this.closed||this.readOnly)fail('EXECUTOR_FENCED','Executor is closed or read-only');
    const lock=read(this.lock);
    if(lock.pid!==process.pid||lock.executor!==this.executor)fail('EXECUTOR_FENCED','Canonical executor lock changed');
  }
  close() {
    if(this.closed)return;
    if(!this.readOnly){this.assertLock();fs.unlinkSync(this.lock);syncDir(this.root);}
    this.closed=true;
  }
  save() { if(this.readOnly)fail('READ_ONLY','Diagnostic broker cannot persist');this.assertLock();atomic(this.file, this.state); }
  current(batchId) {
    const b = this.state.batches[batchId];
    if (!b || this.state.active !== batchId) fail('BATCH', 'Batch is not current');
    if (b.status === 'HALTED') fail('HALTED', 'Manual reconciliation required; no later page is authorized');
    return b;
  }
  snapshot(batchId, n) { return path.join(this.root, hash(batchId) + '-' + n + '.json'); }
  // Fenced runners retain this canonical process lock through send/ACK/verify.
  // All participating central ownership transfers MUST take the same lock.
  // It cannot revoke a request already exported to an old/nonparticipating client.
  ownerProof(proof, binding) {
    caseException.validateControl(this.root,this.state);
    if (!proof || proof.prerequisites !== true || !Array.isArray(proof.conflicts) || proof.conflicts.length !== 0 ||
        !['ownerId','scope','generation'].every(k => typeof proof[k] === 'string' && proof[k].trim().length > 0) ||
        !/^[a-f0-9]{64}$/.test(proof.evidenceHash ?? '') ||
        !validUtcTimestamp(proof.observedAt) || !validUtcTimestamp(proof.validUntil) ||
        Date.parse(proof.observedAt) > Date.now() || Date.now()-Date.parse(proof.observedAt) > 30000 ||
        Date.parse(proof.validUntil) <= Date.now() ||
        (binding && ['ownerId','scope','generation'].some(k => proof[k] !== binding[k])))
      fail('OWNERSHIP_FENCE', 'Fresh same-generation scoped ownership and all prerequisites required');
    caseException.guardOwner(this.state, proof);
    return clone(proof);
  }
  fencedIdentity(input, requireProof=true) {
    this.assertLock();
    const b=this.state.batches[input.batchId],d=b?.dispatch;
    if(this.state.active!==input.batchId || !d || d.version!==1 ||
        d.executor!==this.executor || input.executor!==d.executor ||
        b.planHash!==input.planHash || (b.receipt && input.ticket!==b.receipt.ticket))
      fail('EXECUTOR_FENCED', 'Original live executor, immutable plan and ticket required; no restart replay');
    if(requireProof)this.ownerProof(input.ownerProof,d.owner);
    if(JSON.stringify(read(this.file))!==JSON.stringify(this.state))
      fail('PERSISTENCE','Canonical journal changed outside its executor lock');
    return b;
  }
  fencedLegacy(input) {
    this.fencedInternal=true;
    try{return this.handle(input);}finally{this.fencedInternal=false;}
  }
  fencedHandle(input) {
    this.assertLock();
    if(fs.existsSync(this.file)&&JSON.stringify(read(this.file))!==JSON.stringify(this.state))
      fail('PERSISTENCE','Canonical memory/disk differs; restart inspection is required');
    const {action,batchId}=input;
    if(!['fence_begin','fence_recover_unsent','fence_reconcile_prepared','fence_late_observation','fence_halt',
        'fence_prepare','fence_authorize','fence_dispatch','fence_confirm_send','fence_observe','fence_ack','fence_verify'].includes(action))
      fail('ACTION','Unknown fenced action; unsent recovery requires explicit check-only/apply');
    if(action==='fence_begin') {
      const owner=this.ownerProof(input.ownerProof);
      caseException.guardBatch(this.state,batchId,owner,input.edits);
      const checked=this.handle({action:'validate_batch',batchId,edits:input.edits});
      const previous=checked.reused?this.state.batches[batchId]:null;
      if(checked.status!=='READY'||previous?.dispatch||previous?.receipt)
        fail('FENCED_REPLAY','Use an explicit same-state recovery; never repeat begin');
      // An existing reconciled legacy READY plan has no pending exported ticket.
      // Adopt that same plan/progress, preserving every historical receipt/error.
      const b=previous??{planHash:hash(JSON.stringify(input.edits)),edits:clone(input.edits),next:0,status:'READY',receipt:null};
      b.dispatch={version:1,owner,executor:this.executor,phase:'UNSENT',attempts:[]};
      this.state.batches[batchId]=b;this.state.active=batchId;this.save();
      return {status:'READY',next:b.next,executor:this.executor,planHash:b.planHash};
    }
    if(action==='fence_reconcile_prepared') {
      const owner=this.ownerProof(input.ownerProof,input.binding);
      if(this.state.batches[batchId]?.dispatch)fail('FENCED_PROTOCOL_REQUIRED','Legacy recovery cannot consume a fenced transaction');
      // The supported no-send proof is checked before the same journal commit
      // installs the fenced executor. No legacy request is exported in between.
      this.reconcile({...input,action:'reconcile_receipts'});
      return this.reconcile({...input,action:'reconcile_unwritten',adoptFencedOwner:owner});
    }
    if(action==='fence_recover_unsent') {
      const b=this.state.batches[batchId],d=b?.dispatch;
      this.ownerProof(input.ownerProof);
      if(typeof input.apply!=='boolean'||this.state.active!==batchId||!d||
          input.ownerProof.scope!==d.owner.scope||input.planHash!==b.planHash||
          input.ticket!==(b.receipt?.ticket??null)||input.snapshotHash!==(b.receipt?.snapshotHash??null)||
          input.expectedError!==(b.error??null)||input.expectedPhase!==d.phase||
          hash(fs.readFileSync(this.file,'utf8'))!==input.journalHash||
          JSON.stringify(read(this.file))!==JSON.stringify(this.state)||
          hash(JSON.stringify(b.edits))!==b.planHash)
        fail('RECONCILE_IDENTITY','Exact original halted state and fresh recovery owner required');
      if(b.next!==0||!['UNSENT','PREPARED','AUTHORIZED'].includes(d.phase)||d.attempts.length!==0)
        fail('SEND_UNCERTAIN','Request export cannot be excluded; retain barrier and observe original dispatch');
      // A new process never accepts the old executor token. All exported-request
      // phases are excluded before a fresh executor may revoke an unsent ticket.
      const saved=d.executor;d.executor=this.executor;
      try {
        const check=this.fencedCloseUnsent({...input,executor:this.executor},false);
        if(!input.apply)return {...check,checkOnly:true};
        return this.fencedCloseUnsent({...input,executor:this.executor},true);
      } finally {if(this.state.active===batchId)d.executor=saved;}
    }
    if(action==='fence_late_observation') {
      const b=this.state.batches[batchId],d=b?.dispatch,a=d?.attempts.at(-1);
      this.ownerProof(input.ownerProof);
      if(typeof input.apply!=='boolean'||this.state.active!==batchId||!d||!a||
          !['SEND_INTENT','ACKNOWLEDGED'].includes(d.phase)||input.planHash!==b.planHash||
          input.ticket!==b.receipt?.ticket||input.dispatchId!==a.dispatchId||
          input.ownerProof.scope!==d.owner.scope||JSON.stringify(read(this.file))!==JSON.stringify(this.state)||
          !input.provider||input.provider.pageId!==b.edits[b.next].pageId||
          !['PENDING','SUCCEEDED','FAILED','UNKNOWN'].includes(input.provider.status)||
          (d.provider?.taskId&&d.provider.taskId!==input.provider.taskId))
        fail('DISPATCH_IDENTITY','Fresh scoped observation must bind the original provider correlation');
      const observed={provider:clone(input.provider),at:new Date().toISOString(),owner:input.ownerProof.ownerId,
        dispatchId:a.dispatchId,sourceHash:input.sourceHash};
      if(!/^[a-f0-9]{64}$/.test(input.sourceHash??''))fail('DISPATCH_IDENTITY','Raw provider observation digest required');
      const duplicate=d.observations?.some(x=>x.sourceHash===input.sourceHash&&
        JSON.stringify(x.provider)===JSON.stringify(input.provider));
      if(input.apply&&!duplicate){d.observations=[...(d.observations??[]),observed];this.save();}
      return {status:b.status,phase:d.phase,checkOnly:!input.apply,alreadyObserved:!!duplicate,
        recoveryOwner:input.ownerProof.ownerId,
        next:'Retain barrier; compare attributed terminal result plus complete page with an independently reviewed applied-result recovery. Never resend.'};
    }
    const noProof=['fence_halt','fence_ack','fence_observe','fence_verify'].includes(action);
    const b=this.fencedIdentity(input,!noProof),d=b.dispatch;
    if(action==='fence_halt') {
      if(b.status!=='HALTED') {
        b.haltedFrom=b.status;b.error=String(input.reason??'Fenced runner failed').slice(0,1000);
        if(input.readDetail!==undefined)b.readDetail=String(input.readDetail).slice(0,1000);
      }
      b.status='HALTED';
      d.failure={phase:d.phase,at:new Date().toISOString(),owner:d.owner.ownerId,
        next:d.phase==='SEND_INTENT'?'Observe original provider request/task and late results; never resend':
          d.phase==='ACKNOWLEDGED'?'Read full page and use reviewed applied-result reconciliation; never resend':
          'Fresh full preimage and explicit unsent closure; never reuse revoked ticket',
        provider:clone(input.provider??d.provider??null)};
      this.save();return {status:b.status,phase:d.phase,recovery:d.failure};
    }
    if(b.status==='HALTED')fail('HALTED','Preserve the original failure; use explicit supported recovery');
    if(action==='fence_prepare') {
      if(d.phase!=='UNSENT')fail('PAGE_BARRIER','Prior dispatch is unresolved');
      const r=this.fencedLegacy({...input,action:'prepare'});d.phase='PREPARED';this.save();return r;
    }
    const s=read(b.receipt?.snapshot??'');
    if(hash(JSON.stringify(s))!==b.receipt.snapshotHash||s.ticket!==input.ticket)
      fail('PERSISTENCE','Immutable snapshot changed');
    if(action==='fence_authorize'||action==='fence_dispatch') {
      const p=pageData(input.page,b.edits[b.next].pageId);
      if(p.body!==s.page.body||p.properties!==s.page.properties||p.revision!==s.page.revision)
        fail('CONCURRENT_CHANGE','Fresh page differs from the prepared preimage');
      validateScope(b.edits[b.next],this.policy);stableNewText(b.edits[b.next]);
      const generated=plan(p,b.edits[b.next]);
      if(generated.expected!==s.expected)fail('PLAN_DRIFT','Immutable plan changed');
      if(action==='fence_authorize') {
        if(b.status!=='PREPARED'||d.phase!=='PREPARED')fail('PAGE_BARRIER','Authorization is single-use');
        b.status='WRITE_PENDING';d.phase='AUTHORIZED';this.save();
        return {status:b.status,ticket:s.ticket,requestExported:false};
      }
      if(b.status!=='WRITE_PENDING'||d.phase!=='AUTHORIZED')fail('PAGE_BARRIER','Dispatch is single-use');
      // From this durable boundary onward, even a lost broker reply is uncertain.
      const attempt={index:b.next,ticket:s.ticket,dispatchId:crypto.randomUUID(),
        requestHash:hash(JSON.stringify(generated.request)),at:new Date().toISOString(),phase:'SEND_INTENT'};
      d.phase='SEND_INTENT';d.provider=null;d.attempts.push(attempt);this.save();
      return {status:'SEND_INTENT',dispatchId:attempt.dispatchId,request:generated.request};
    }
    const attempt=d.attempts.at(-1);
    if(!attempt||attempt.ticket!==input.ticket||attempt.dispatchId!==input.dispatchId)
      fail('DISPATCH_IDENTITY','Original dispatch correlation required');
    if(action==='fence_confirm_send') {
      if(d.phase!=='SEND_INTENT'||attempt.sendPermit)fail('PAGE_BARRIER','Send confirmation is single-use');
      const owner=this.ownerProof(input.ownerProof,d.owner);
      const permit={dispatchId:attempt.dispatchId,executor:this.executor,pageId:b.edits[b.next].pageId,
        ownerId:owner.ownerId,scope:owner.scope,generation:owner.generation,
        observedAt:owner.observedAt,validUntil:owner.validUntil};
      attempt.sendPermit=permit;this.save();return {status:'SEND_INTENT',permit};
    }
    if(action==='fence_observe') {
      if(d.phase!=='SEND_INTENT'||!attempt.sendPermit||input.provider?.status!=='PENDING'||
          typeof input.provider.taskId!=='string'||!input.provider.taskId||
          (d.provider?.taskId&&d.provider.taskId!==input.provider.taskId))
        fail('DISPATCH_IDENTITY','Original pending provider task required');
      d.provider=clone(input.provider);attempt.provider=clone(input.provider);this.save();return {status:'SEND_INTENT',provider:d.provider};
    }
    if(action==='fence_ack') {
      if(d.phase!=='SEND_INTENT'||!attempt.sendPermit||!input.provider||input.provider.status!=='SUCCEEDED'||
          input.provider.pageId!==b.edits[b.next].pageId||
          (d.provider?.taskId&&d.provider.taskId!==input.provider.taskId))
        fail('ACK_REQUIRED','One actual terminal provider result required');
      d.phase='ACKNOWLEDGED';d.provider=clone(input.provider);attempt.provider=clone(input.provider);attempt.phase=d.phase;this.save();
      return {status:'ACKNOWLEDGED'};
    }
    if(action==='fence_verify') {
      if(d.phase!=='ACKNOWLEDGED')fail('ACK_REQUIRED','Uncertain send cannot be verified as an ACK');
      const r=this.fencedLegacy({...input,action:'verify'});
      d.phase=r.status==='COMPLETED'?'VERIFIED':'UNSENT';this.save();return r;
    }
    fail('ACTION','Unknown fenced action');
  }
  fencedCloseUnsent(input,apply) {
      const b=this.state.batches[input.batchId],d=b.dispatch;
      this.ownerProof(input.ownerProof);
      if(input.ownerProof.scope!==d.owner.scope)fail('OWNERSHIP_FENCE','Same scoped recovery owner required');
      if(b.next!==0||d.attempts.length!==0||!['UNSENT','PREPARED','AUTHORIZED'].includes(d.phase)||
          !['READY','PREPARED','WRITE_PENDING','HALTED'].includes(b.status)||
          d.attempts.some(a=>a.index===b.next))
        fail('SEND_UNCERTAIN','A request may have escaped; no unsent closure or replay');
      let preserved;
      if(b.receipt) {
        const s=read(b.receipt.snapshot),p=pageData(input.page,b.edits[b.next].pageId);
        if(hash(JSON.stringify(s))!==b.receipt.snapshotHash||s.ticket!==b.receipt.ticket||
            s.batchId!==input.batchId||s.index!==b.next||JSON.stringify(s.edit)!==JSON.stringify(b.edits[b.next])||
            p.body!==s.page.body||p.properties!==s.page.properties||p.revision!==s.page.revision)
          fail('RECONCILE_CHANGED','Exact ticket/snapshot and fresh full preimage/revision required');
        preserved={bodyHash:hash(p.body),propertiesHash:hash(p.properties),revision:p.revision};
      }
      const audit={kind:'FENCED_UNSENT_TERMINAL',at:new Date().toISOString(),phase:d.phase,
        planHash:b.planHash,ticket:b.receipt?.ticket??null,next:b.next,notionWrites:0,
        reason:b.error??String(input.reason??'Pre-send gate rejected'),preserved};
      if(!apply)return {status:b.status,active:this.state.active,audit};
      // Terminal, never an ACK or applied COMPLETED. Preserve plan/error/receipt/progress.
      d.revoked=true;d.phase='REVOKED_UNSENT';b.status='ABORTED_UNWRITTEN';
      b.reconciliations=[...(b.reconciliations??[]),audit];this.state.active=null;this.save();
      return {status:b.status,active:null,audit};
  }
  reconcileVerifiedUnsent(input) {
    const loaded=loadUnwrittenManifest(input.manifestPath,input.approvedManifestHash),spec=loaded.spec;
    const requireFact=(ok,code,message)=>{if(!ok)fail(code,message);};
    const privateBytes=file=>{
      const st=fs.lstatSync(file);
      requireFact(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&!(st.mode&0o077),
        'RECOVERY_EVIDENCE','Private owned regular evidence required');
      return fs.readFileSync(file,'utf8');
    };
    requireFact(typeof input.apply==='boolean'&&(!this.readOnly||!input.apply),'READ_ONLY','Explicit check-only/apply required');
    requireFact(this.root===spec.root&&input.batchId===spec.batchId,'RECONCILE_IDENTITY','Exact canonical incident required');
    if(this.readOnly)requireFact(!fs.existsSync(this.lock),'LOCKED','A current recovery executor is present');
    else this.assertLock();
    this.ownerProof(input.ownerProof);
    requireFact(input.ownerProof.scope===spec.batchId,'OWNERSHIP_FENCE','Exact incident recovery scope required');
    for(const [name,pin] of Object.entries(spec.pins)) {
      const file=path.join(spec.runtime,name),st=fs.lstatSync(file);
      requireFact(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.geteuid()&&
        hash(fs.readFileSync(file,'utf8'))===pin,'INSTALLATION_PIN','Original installed bytes changed');
    }
    const installation=privateBytes(path.join(this.root,spec.installation)),installed=JSON.parse(installation);
    requireFact(hash(installation)===spec.installationHash&&installed.sourceCommit===spec.sourceCommit&&
      installed.policyChanged===false&&installed.workerServicesChanged===false&&
      Object.entries(spec.pins).filter(([n])=>n!=='approved.sha256').every(([n,h])=>installed.after?.[n]===h),
      'INSTALLATION_PIN','Original installation receipt required');
    const before=privateBytes(this.file),current=JSON.parse(before),b=current.batches[spec.batchId];
    requireFact(JSON.stringify(current)===JSON.stringify(this.state),'PERSISTENCE','Canonical memory/disk differs');
    const auditFile=path.join(this.root,hash(spec.batchId)+'.verified-unsent-closure.json');
    const auditBytes=fs.existsSync(auditFile)?privateBytes(auditFile):null;
    const existing=auditBytes?JSON.parse(auditBytes):null;
    const assessment=assessUnwrittenExecution(spec,input);
    if(assessment.classification!=='A') {
      const error=new GuardError(assessment.code,assessment.classification==='B'
        ? 'Observed dispatch/executor requires route-specific reconciliation; no unsent closure'
        : 'Execution records are missing, incomplete or invalid; no risk assertion and no unsent closure');
      error.assessment=assessment;throw error;
    }
    const original=existing?.journalBefore??current,originalBatch=original.batches[spec.batchId];
    requireFact(hash(JSON.stringify(original))===spec.journalHash&&original.active===spec.batchId&&
      originalBatch?.status==='HALTED'&&originalBatch.haltedFrom==='WRITE_PENDING'&&
      originalBatch.error===spec.error&&originalBatch.next===0&&originalBatch.edits?.length===1&&
      originalBatch.planHash===spec.planHash&&hash(JSON.stringify(originalBatch.edits))===spec.planHash&&
      originalBatch.receipt?.ticket===spec.ticket&&originalBatch.receipt.snapshotHash===spec.snapshotHash&&
      originalBatch.receipt.snapshot===this.snapshot(spec.batchId,0)&&!originalBatch.dispatch&&
      !originalBatch.reconciliations&&!originalBatch.verifications&&!originalBatch.readDetail,
      'RECONCILE_IDENTITY','Original plan/error/ticket/position and complete journal must be preserved');
    const evidenceBytes=privateBytes(path.join(this.root,spec.evidence)),evidence=JSON.parse(evidenceBytes);
    requireFact(hash(evidenceBytes)===spec.evidenceHash&&hash(evidence.adapterSource)===spec.adapterHash&&
      evidence.incident===spec.batchId&&evidence.facts?.notionMutationInvoked===false,
      'RECOVERY_EVIDENCE','Original no-send attestation/control-flow evidence changed');
    const s=JSON.parse(privateBytes(originalBatch.receipt.snapshot)),edit=originalBatch.edits[0];
    validateScope(edit,this.policy);const pre=pageData(s.page.raw,edit.pageId),fresh=pageData(input.page,edit.pageId),generated=plan(pre,edit);
    requireFact(hash(JSON.stringify(s))===spec.snapshotHash&&s.ticket===spec.ticket&&s.batchId===spec.batchId&&s.index===0&&
      JSON.stringify(s.edit)===JSON.stringify(edit)&&s.bodyHash===hash(s.page.body)&&s.expectedHash===hash(s.expected)&&
      s.propertiesHash===hash(s.page.properties)&&pre.body===s.page.body&&pre.properties===s.page.properties&&
      pre.revision===s.page.revision&&generated.expected===s.expected&&generated.beforeHash===s.beforeHash&&
      generated.afterHash===s.afterHash&&fresh.body===pre.body&&fresh.properties===pre.properties&&fresh.revision===pre.revision,
      'RECONCILE_CHANGED','Exact snapshot and full fresh body/properties/revision required');
    const prefix=hash(spec.batchId)+'-';
    requireFact(fs.readdirSync(this.root).filter(n=>n.startsWith(prefix)).every(n=>n===prefix+'0.json'),
      'SEND_UNCERTAIN','Unexpected applied/readback/future evidence exists');
    const audit={kind:'EXACT_VERIFIED_NO_SEND',batchId:spec.batchId,planHash:spec.planHash,
      ticket:spec.ticket,snapshotHash:spec.snapshotHash,journalBeforeHash:spec.journalHash,
      originalError:spec.error,haltedFrom:'WRITE_PENDING',next:0,notionWrites:0,pageAdvances:0,
      approvedManifestHash:loaded.manifestHash,approvedEvidenceHash:input.approvedEvidenceHash,
      execution:assessment,ticketRevoked:true,at:existing?.audit?.at??new Date().toISOString()};
    requireFact(validUtcTimestamp(audit.at)&&Date.parse(audit.at)<=Date.now()&&
      (!existing||(JSON.stringify(existing.audit)===JSON.stringify(audit)&&
        existing.manifestBytes===privateFileBytes(input.manifestPath)&&
        JSON.stringify(assessUnwrittenExecution(spec,{rawExecutionTrace:existing.rawExecutionTrace,
          sourceRecords:existing.sourceRecords,approvedEvidenceHash:input.approvedEvidenceHash}))===JSON.stringify(assessment)&&
        pageData(existing.freshPage,edit.pageId).body===pre.body&&
        pageData(existing.freshPage,edit.pageId).properties===pre.properties&&
        pageData(existing.freshPage,edit.pageId).revision===pre.revision)),
      'RECOVERY_EVIDENCE','Existing closure approval/drain differs');
    const expected=clone(original),closed=expected.batches[spec.batchId];
    closed.status='ABORTED_UNWRITTEN';closed.reconciliations=[audit];
    closed.ticketDisposition={ticket:spec.ticket,status:'REVOKED_UNSENT',executionEvidenceHash:input.approvedEvidenceHash};expected.active=null;
    if(b?.status==='ABORTED_UNWRITTEN') {
      requireFact(existing&&JSON.stringify(expected)===before,'PERSISTENCE','Terminal closure/audit differs');
      return {status:b.status,active:current.active,alreadyConsumed:true,checkOnly:!input.apply,auditFile};
    }
    requireFact(hash(before)===spec.journalHash,'RECONCILE_IDENTITY','Canonical state changed before closure');
    requireFact(privateBytes(this.file)===before&&(!this.readOnly||!fs.existsSync(this.lock)),
      'PERSISTENCE','State/owner changed during inspection');
    if(!input.apply)return {status:'HALTED',active:current.active,checkOnly:true,audit,assessment,eligible:true};
    // The broker API owns this transition. Audit first, original journal intact.
    // A crash between these writes resumes from the same audit with no deletion.
    if(!existing)atomic(auditFile,{audit,journalBefore:original,manifestBytes:privateFileBytes(input.manifestPath),
      rawExecutionTrace:input.rawExecutionTrace,sourceRecords:input.sourceRecords,freshPage:input.page});
    requireFact(privateBytes(this.file)===before,'PERSISTENCE','Canonical state changed before commit');
    atomic(this.file,expected);this.state=read(this.file);
    requireFact(JSON.stringify(this.state)===JSON.stringify(expected),'PERSISTENCE','Terminal readback differs');
    return {status:closed.status,active:null,checkOnly:false,auditFile,audit,journalAfterHash:hash(privateBytes(this.file))};
  }
  reconcileAutolink(input) {
    return this.reconcileRendering(input, 'package');
  }
  reconcileRendering(input, mode) {
    if (!['package', 'arrows'].includes(mode)) fail('RECONCILE_SCOPE', 'Unknown rendering incident');
    const { batchId, planHash, ticket, snapshotHash, actualHash, actualSnapshotHash } = input;
    const b = this.state.batches[batchId];
    // These are separately invoked, pinned incident recoveries, never a
    // normalization rule in verify() and never a second Notion mutation.
    if (!b || this.state.active !== batchId || b.status !== 'HALTED' ||
        b.error !== 'READBACK_MISMATCH' || input.expectedError !== b.error ||
        b.next !== 0 || b.edits.length !== (mode === 'package' ? 1 : 6) || b.planHash !== planHash ||
        hash(JSON.stringify(b.edits)) !== planHash || !b.receipt || b.receipt.ticket !== ticket ||
        b.receipt.snapshotHash !== snapshotHash || b.receipt.snapshot !== this.snapshot(batchId, 0))
      fail('RECONCILE_IDENTITY', 'Exact halted incident, immutable plan/ticket and snapshot required');
    const edit = b.edits[0];
    const seen = new Set();
    for (const [index, planned] of b.edits.entries()) {
      validateScope(planned, this.policy);
      const pageId = id(planned.pageId);
      if (seen.has(pageId)) fail('RECONCILE_IDENTITY', 'Duplicate recovery page');
      seen.add(pageId);
      if (index > 0) stableNewText(planned);
    }
    const file = b.receipt.snapshot, snapshot = read(file), actual = read(file + '.actual.json');
    const preimage = pageData(snapshot.page.raw, edit.pageId);
    const savedActual = pageData(actual.page.raw, edit.pageId);
    if (hash(JSON.stringify(snapshot)) !== snapshotHash || snapshot.batchId !== batchId ||
        snapshot.index !== 0 || snapshot.ticket !== ticket ||
        JSON.stringify(snapshot.edit) !== JSON.stringify(edit) ||
        snapshot.bodyHash !== hash(snapshot.page.body) ||
        snapshot.propertiesHash !== hash(snapshot.page.properties) ||
        snapshot.expectedHash !== hash(snapshot.expected) ||
        preimage.body !== snapshot.page.body || preimage.properties !== snapshot.page.properties ||
        preimage.revision !== snapshot.page.revision ||
        plan(snapshot.page, edit).expected !== snapshot.expected ||
        hash(JSON.stringify(actual)) !== actualSnapshotHash ||
        actual.actualHash !== actualHash || hash(actual.page.body) !== actualHash ||
        savedActual.body !== actual.page.body || savedActual.properties !== actual.page.properties ||
        savedActual.revision !== actual.page.revision)
      fail('PERSISTENCE', 'Canonical preimage or mismatched readback changed');
    let renderedLiteral, kind;
    if (mode === 'arrows') {
      renderedLiteral = reviewedArrowLiteral(edit); kind = 'REVIEWED_CENTRAL_ARROW_ESCAPING';
    } else {
      const token = 'package-cli.sh', rendered = '[package-cli.sh](http://package-cli.sh)';
      const risks = bareAutolinks(edit.newStr);
      if (risks.length !== 1 || risks[0] !== token || edit.newStr.split(token).length !== 2)
        fail('RECONCILE_SCOPE', 'Only the independently reviewed package-cli.sh autolink is admitted');
      renderedLiteral = edit.newStr.replace(token, rendered); kind = 'REVIEWED_PACKAGE_CLI_AUTOLINK';
    }
    const index = snapshot.page.body.indexOf(edit.oldStr);
    const before = snapshot.page.body.slice(0, index);
    const after = snapshot.page.body.slice(index + edit.oldStr.length);
    const expected = before + renderedLiteral + after;
    if (hash(before) !== snapshot.beforeHash || hash(after) !== snapshot.afterHash ||
        actual.page.body !== expected || actual.page.properties !== snapshot.page.properties)
      fail('RECONCILE_SCOPE', 'Mismatch is not confined to the reviewed rendering difference');
    const fresh = pageData(input.page, edit.pageId);
    if (fresh.body !== actual.page.body || fresh.properties !== actual.page.properties ||
        fresh.revision !== actual.page.revision)
      fail('RECONCILE_CHANGED', 'Fresh complete page must still equal the saved mismatched readback');
    const at = new Date().toISOString();
    const evidence = { kind, at, planHash, snapshotHash, actualHash, actualSnapshotHash,
      ticket, plannedExpectedHash:snapshot.expectedHash, protectedContent:'UNCHANGED', notionWrites:0 };
    const verified={page:fresh,bodyHash:hash(fresh.body),at,reconciliation:evidence};
    atomic(file + '.verified.json',verified);
    b.verifications=[...(b.verifications??[]),{index:0,snapshotHash:hash(JSON.stringify(snapshot)),verifiedHash:hash(JSON.stringify(verified))}];
    b.reconciliations = [...(b.reconciliations ?? []), evidence];
    b.next = 1; b.receipt = null; b.status = b.edits.length === 1 ? 'COMPLETED' : 'READY';
    if (b.status === 'COMPLETED') this.state.active = null;
    this.save();
    return { status:b.status, next:1, protectedContent:'UNCHANGED', bodyHash:hash(fresh.body),
      reconciliation:evidence };
  }
  verifiedExpected(snapshot, verified, batch, index) {
    const audit = verified.reconciliation;
    if (!audit) return snapshot.expected;
    if(audit.kind==='EXACT_APPLIED_REVISION_READ'){
      if(!(batch.reconciliations??[]).some(r=>JSON.stringify(r)===JSON.stringify(audit))||
          audit.batchId!==snapshot.batchId||audit.planHash!==batch.planHash||audit.index!==index||
          audit.error!=='REVISION_READ_ERROR'||audit.ticket!==snapshot.ticket||
          audit.snapshotHash!==hash(JSON.stringify(snapshot))||audit.bodyHash!==snapshot.expectedHash||
          audit.propertiesHash!==snapshot.propertiesHash||audit.revision!==verified.page.revision||
          audit.protectedContent!=='UNCHANGED'||audit.notionWrites!==0||audit.haltedFrom!=='WRITE_PENDING'||
          !validUtcTimestamp(audit.at)||verified.at!==audit.at||!Array.isArray(audit.prior)||
          audit.prior.length!==index||audit.prior.some((r,i)=>r.index!==i||
            r.snapshotHash!==hash(JSON.stringify(read(this.snapshot(snapshot.batchId,i))))||
            r.verifiedHash!==hash(JSON.stringify(read(this.snapshot(snapshot.batchId,i)+'.verified.json')))))
        fail('PERSISTENCE','Applied-state verification is not bound to its immutable recovery audit');
      return snapshot.expected;
    }
    if (index !== 0 || batch.edits.length !== 6 || audit.kind !== 'REVIEWED_CENTRAL_ARROW_ESCAPING' ||
        !(batch.reconciliations ?? []).some(record => JSON.stringify(record) === JSON.stringify(audit)) ||
        audit.planHash !== batch.planHash || audit.ticket !== snapshot.ticket ||
        audit.snapshotHash !== hash(JSON.stringify(snapshot)) || audit.plannedExpectedHash !== snapshot.expectedHash ||
        audit.protectedContent !== 'UNCHANGED' || audit.notionWrites !== 0 || !validUtcTimestamp(audit.at) || verified.at !== audit.at)
      fail('PERSISTENCE', 'Reviewed rendering receipt is not bound to the original audit');
    const actual = read(this.snapshot(snapshot.batchId, index) + '.actual.json');
    const saved = pageData(actual.page.raw, snapshot.edit.pageId);
    const expected = plan(snapshot.page, { ...snapshot.edit, newStr:reviewedArrowLiteral(snapshot.edit) }).expected;
    if (hash(JSON.stringify(actual)) !== audit.actualSnapshotHash || actual.actualHash !== audit.actualHash ||
        hash(actual.page.body) !== audit.actualHash || actual.page.body !== expected ||
        actual.page.properties !== snapshot.page.properties || saved.body !== actual.page.body ||
        saved.properties !== actual.page.properties || saved.revision !== actual.page.revision)
      fail('PERSISTENCE', 'Reviewed rendering evidence changed');
    return expected;
  }
  reconcileAppliedReadback(input) {
    const {batchId,planHash,expectedError,snapshotHash,apply}=input;
    const b=this.state.batches[batchId];
    if(this.state.active!==batchId||!b||b.status!=='HALTED'||b.planHash!==planHash||
        hash(JSON.stringify(b.edits))!==planHash||b.error!==expectedError||!b.receipt||
        b.receipt.snapshotHash!==snapshotHash||typeof apply!=='boolean')
      fail('RECONCILE_IDENTITY','Exact halted plan, error, pending snapshot and explicit apply/check required');
    if(expectedError!=='REVISION_READ_ERROR')
      fail('RECONCILE_SCOPE','Only the observed failed revision read admits exact applied-state recovery');
    if(b.haltedFrom!=='WRITE_PENDING')
      fail('RECONCILE_SCOPE','Durable pre-halt WRITE_PENDING authorization proof is required');
    for(const edit of b.edits){validateScope(edit,this.policy);stableNewText(edit);}
    if(JSON.stringify(read(this.file))!==JSON.stringify(this.state))
      fail('PERSISTENCE','Canonical journal changed outside its lock');
    const checkSnapshot=(s,index)=>{
      if(s.batchId!==batchId||s.index!==index||!s.ticket||
          JSON.stringify(s.edit)!==JSON.stringify(b.edits[index])||
          hash(s.page.body)!==s.bodyHash||hash(s.page.properties)!==s.propertiesHash||
          hash(s.expected)!==s.expectedHash)
        fail('PERSISTENCE','Canonical prepared snapshot changed');
      const raw=pageData(s.page.raw,b.edits[index].pageId),planned=plan(s.page,s.edit);
      if(raw.body!==s.page.body||raw.properties!==s.page.properties||raw.revision!==s.page.revision||
          planned.expected!==s.expected||planned.beforeHash!==s.beforeHash||planned.afterHash!==s.afterHash)
        fail('PERSISTENCE','Raw preimage or protected-content plan changed');
    };
    const prior=[];
    for(let index=0;index<b.next;index++){
      const file=this.snapshot(batchId,index),s=read(file),v=read(file+'.verified.json');
      checkSnapshot(s,index);
      const raw=pageData(v.page.raw,b.edits[index].pageId),expected=this.verifiedExpected(s,v,b,index);
      if(v.bodyHash!==hash(expected)||v.page.body!==expected||v.page.properties!==s.page.properties||
          raw.body!==v.page.body||raw.properties!==v.page.properties||raw.revision!==v.page.revision)
        fail('PERSISTENCE','Earlier protected-content verification receipt changed');
      prior.push({index,snapshotHash:hash(JSON.stringify(s)),verifiedHash:hash(JSON.stringify(v))});
    }
    const file=this.snapshot(batchId,b.next),s=read(file);
    if(b.receipt.snapshot!==file||hash(JSON.stringify(s))!==snapshotHash||s.ticket!==b.receipt.ticket||
        fs.existsSync(file+'.actual.json'))
      fail('PERSISTENCE','Pending ticket changed or a contradictory readback exists');
    checkSnapshot(s,b.next);
    const page=pageData(input.page,b.edits[b.next].pageId);
    if(page.body!==s.expected||page.properties!==s.page.properties||
        Date.parse(page.revision)<=Date.parse(s.page.revision))
      fail('RECONCILE_CHANGED','Fresh complete page must equal the entire planned output and unchanged properties');
    const verifiedFile=file+'.verified.json';let verified=fs.existsSync(verifiedFile)?read(verifiedFile):null;
    const audit={kind:'EXACT_APPLIED_REVISION_READ',batchId,planHash,error:expectedError,index:b.next,
      ticket:s.ticket,snapshotHash,bodyHash:hash(page.body),propertiesHash:hash(page.properties),
      revision:page.revision,prior,notionWrites:0,protectedContent:'UNCHANGED',haltedFrom:b.haltedFrom,
      at:verified?.at??new Date().toISOString(),readDetail:b.readDetail??null};
    if(verified){
      const raw=pageData(verified.page.raw,b.edits[b.next].pageId);
      if(verified.bodyHash!==audit.bodyHash||raw.body!==page.body||raw.properties!==page.properties||
          raw.revision!==page.revision||verified.page.body!==raw.body||
          verified.page.properties!==raw.properties||verified.page.revision!==raw.revision||
          typeof verified.at!=='string'||!Number.isFinite(Date.parse(verified.at))||
          JSON.stringify(verified.reconciliation)!==JSON.stringify(audit))
        fail('PERSISTENCE','Existing pending verification evidence differs');
    }
    if(!apply)return {status:'HALTED',checkOnly:true,next:b.next,audit};
    // This acknowledges only a freshly proven full output. It emits no Notion
    // request and never repeats the uncertain mutation or rewrites prior pages.
    if(!verified){verified={page,bodyHash:audit.bodyHash,at:audit.at,reconciliation:audit};atomic(verifiedFile,verified);}
    b.verifications=[...(b.verifications??[]),{index:b.next,snapshotHash,verifiedHash:hash(JSON.stringify(verified))}];
    b.reconciliations=[...(b.reconciliations??[]),audit];
    b.next++;b.receipt=null;b.status=b.next===b.edits.length?'COMPLETED':'READY';delete b.error;delete b.haltedFrom;delete b.readDetail;
    if(b.status==='COMPLETED')this.state.active=null;
    this.save();
    return {status:b.status,next:b.next,reconciled:true,audit};
  }
  verifiedFingerprint(s,v,b,index) {
    const edit=b.edits[index],raw=pageData(s.page.raw,edit.pageId),after=pageData(v.page.raw,edit.pageId),p=plan(s.page,s.edit);
    if(s.index!==index||JSON.stringify(s.edit)!==JSON.stringify(edit)||
        hash(s.page.body)!==s.bodyHash||hash(s.page.properties)!==s.propertiesHash||hash(s.expected)!==s.expectedHash||
        p.expected!==s.expected||p.beforeHash!==s.beforeHash||p.afterHash!==s.afterHash||
        raw.body!==s.page.body||raw.properties!==s.page.properties||raw.revision!==s.page.revision||
        v.page.body!==this.verifiedExpected(s,v,b,index)||v.bodyHash!==hash(v.page.body)||v.page.properties!==s.page.properties||
        after.body!==v.page.body||after.properties!==v.page.properties||after.revision!==v.page.revision)
      fail('PERSISTENCE','Prior protected-content verification changed');
    const fingerprint={index,snapshotHash:hash(JSON.stringify(s)),verifiedHash:hash(JSON.stringify(v))};
    const original=(b.verifications??[]).find(r=>r.index===index);
    if(original?JSON.stringify(original)!==JSON.stringify(fingerprint):!['REVIEWED_CENTRAL_ARROW_ESCAPING','EXACT_APPLIED_REVISION_READ'].includes(v.reconciliation?.kind))
      fail('PERSISTENCE','Original full receipt fingerprint or validated legacy rendering audit required');
    return fingerprint;
  }
  reconcileUnpreparedRead(input) {
    const {batchId,planHash,expectedError,apply}=input,b=this.state.batches[batchId];
    if(this.state.active!==batchId||!b||b.status!=='HALTED'||b.planHash!==planHash||
        hash(JSON.stringify(b.edits))!==planHash||b.error!==expectedError||typeof apply!=='boolean')
      fail('RECONCILE_IDENTITY','Exact halted batch, plan and error required');
    if(b.haltedFrom!=='READY'||b.receipt!==null||! /^(?:FETCH_ERROR|INCOMPLETE_READ):/.test(b.error))
      fail('RECONCILE_SCOPE','Only an unprepared failed native read may restore READY');
    if(JSON.stringify(read(this.file))!==JSON.stringify(this.state))fail('PERSISTENCE','Journal changed outside its lock');
    b.edits.forEach((edit,i)=>{validateScope(edit,this.policy);if(i>=b.next)stableNewText(edit);});
    const prefix=hash(batchId)+'-',prior=[],allowed=new Set();
    for(let i=0;i<b.next;i++){
      const file=this.snapshot(batchId,i),s=read(file),v=read(file+'.verified.json');
      if(s.batchId!==batchId)fail('PERSISTENCE','Prior snapshot batch changed');
      prior.push(this.verifiedFingerprint(s,v,b,i));
      allowed.add(prefix+i+'.json');allowed.add(prefix+i+'.json.verified.json');
      if(v.reconciliation?.kind==='REVIEWED_CENTRAL_ARROW_ESCAPING')allowed.add(prefix+i+'.json.actual.json');
    }
    for(const name of fs.readdirSync(this.root))if(name.startsWith(prefix)&&!allowed.has(name))
      fail('PERSISTENCE','Pending or unexpected prepared evidence exists');
    const page=pageData(input.page,b.edits[b.next].pageId);
    if(page.body.includes(b.edits[b.next].newStr))fail('RECONCILE_CHANGED','Already-applied output cannot restore an unwritten plan');
    const p=plan(page,b.edits[b.next]);
    const audit={kind:'UNPREPARED_NATIVE_READ',at:new Date().toISOString(),batchId,planHash,error:expectedError,
      next:b.next,prior,bodyHash:hash(page.body),propertiesHash:hash(page.properties),revision:page.revision,
      expectedHash:hash(p.expected),notionWrites:0,acknowledgedWrites:0,pageAdvances:0};
    if(!apply)return {status:'HALTED',checkOnly:true,next:b.next,audit};
    b.reconciliations=[...(b.reconciliations??[]),audit];b.status='READY';delete b.error;delete b.haltedFrom;
    this.save();return {status:'READY',next:b.next,audit};
  }
  reconcile(input) {
    const { batchId, planHash, expectedError, action } = input;
    const b = this.state.batches[batchId];
    if (this.state.active !== batchId || !b || b.status !== 'HALTED' ||
        b.planHash !== planHash || hash(JSON.stringify(b.edits)) !== planHash ||
        b.error !== expectedError || !b.receipt)
      fail('RECONCILE_IDENTITY', 'Exact halted batch, immutable plan and error required');
    const legacyDC=b.error.startsWith('REMOTE_ERROR: Error interacting with process: Invalid regular expression: ')&&
      b.error.includes('"action":"authorize"')&&b.error.includes(JSON.stringify(batchId))&&b.error.includes(JSON.stringify(b.receipt.ticket));
    const preparedRead=b.haltedFrom==='PREPARED'&&/^(?:FETCH_ERROR|INCOMPLETE_READ):/.test(b.error);
    const preparedMcp=b.haltedFrom==='PREPARED'&&b.error===
      'REMOTE_ERROR: McpServerError: MCP server is not initialized; send initialize and notifications/initialized before operational requests';
    const preparedUnwritten=preparedRead||preparedMcp;
    if(!legacyDC&&!preparedUnwritten)fail('RECONCILE_SCOPE','Only a proven unwritten authorize/read failure can be reconciled');
    if(preparedUnwritten){
      if(JSON.stringify(read(this.file))!==JSON.stringify(this.state))fail('PERSISTENCE','Journal changed outside its lock');
      const prefix=hash(batchId)+'-',allowed=new Set([prefix+b.next+'.json']);
      for(let i=0;i<b.next;i++){
        allowed.add(prefix+i+'.json');allowed.add(prefix+i+'.json.verified.json');
        const file=this.snapshot(batchId,i),s=read(file),v=read(file+'.verified.json');
        if(s.batchId!==batchId)fail('PERSISTENCE','Prior snapshot batch changed');
        this.verifiedFingerprint(s,v,b,i);
        if(v.reconciliation?.kind==='REVIEWED_CENTRAL_ARROW_ESCAPING')allowed.add(prefix+i+'.json.actual.json');
      }
      for(const name of fs.readdirSync(this.root))if(name.startsWith(prefix)&&!allowed.has(name))
        fail('PERSISTENCE','Unexpected pending or future prepared evidence exists');
    }
    for (const edit of b.edits) {
      validateScope(edit, this.policy);
    }
    const checkSnapshot = (snapshot, index) => {
      if (snapshot.batchId !== batchId || snapshot.index !== index ||
          JSON.stringify(snapshot.edit) !== JSON.stringify(b.edits[index]) ||
          hash(snapshot.page.body) !== snapshot.bodyHash ||
          hash(snapshot.page.properties) !== snapshot.propertiesHash ||
          hash(snapshot.expected) !== snapshot.expectedHash ||
          plan(snapshot.page, snapshot.edit).expected !== snapshot.expected)
        fail('PERSISTENCE', 'Canonical snapshot changed');
    };
    if (action === 'reconcile_receipts') {
      // Completed pages already have full protected-content verification.
      // Revalidate that immutable evidence; never write them again or restore
      // an old page over a worker's later legitimate records.
      const receipts = [];
      this.recovery = null;
      for (let index=0; index<b.next; index++) {
        const file=this.snapshot(batchId,index);
        const snapshot=read(file), verified=read(file+'.verified.json');
        if(preparedUnwritten)this.verifiedFingerprint(snapshot,verified,b,index);
        checkSnapshot(snapshot,index);
        const preimage=pageData(snapshot.page.raw,b.edits[index].pageId);
        const readback=pageData(verified.page.raw,b.edits[index].pageId);
        const expected=this.verifiedExpected(snapshot,verified,b,index);
        if (preimage.body!==snapshot.page.body || preimage.properties!==snapshot.page.properties ||
            preimage.revision!==snapshot.page.revision ||
            verified.bodyHash!==hash(expected) || verified.page.body!==expected ||
            verified.page.properties!==snapshot.page.properties ||
            readback.body!==verified.page.body || readback.properties!==verified.page.properties ||
            readback.revision!==verified.page.revision)
          fail('PERSISTENCE','Completed protected-content receipt changed');
        receipts.push({ index, pageId:b.edits[index].pageId,
          snapshotHash:hash(JSON.stringify(snapshot)), verifiedHash:hash(JSON.stringify(verified)),
          bodyHash:verified.bodyHash, verifiedAt:verified.at });
      }
      this.recovery={ batchId,planHash,expectedError,next:b.next,receipts,mode:'DURABLE_VERIFIED_RECEIPTS' };
      return { status:'HALTED',next:b.next,priorVerified:b.next,receipts };
    }
    if (action === 'reconcile_verified') {
      const index = input.index;
      if (!Number.isInteger(index) || index < 0 || index >= b.next)
        fail('RECONCILE_ORDER', 'Only prior verified pages can be checked');
      if (index === 0) this.recovery = { batchId, planHash, expectedError, next:0 };
      const recovery = this.recovery;
      if (!recovery || recovery.batchId !== batchId || recovery.planHash !== planHash ||
          recovery.expectedError !== expectedError || recovery.next !== index)
        fail('RECONCILE_ORDER', 'Check every prior receipt in canonical order');
      const file = this.snapshot(batchId, index);
      const snapshot = read(file), verified = read(file + '.verified.json');
      checkSnapshot(snapshot, index);
      const expected=this.verifiedExpected(snapshot,verified,b,index);
      if (verified.bodyHash !== hash(expected) || verified.page.body !== expected ||
          verified.page.properties !== snapshot.page.properties)
        fail('PERSISTENCE', 'Durable verified receipt changed');
      const page = pageData(input.page, b.edits[index].pageId);
      if (page.body !== verified.page.body || page.properties !== verified.page.properties ||
          page.revision !== verified.page.revision)
        fail('RECONCILE_CHANGED', 'An already verified page changed; keep the barrier');
      recovery.next++;
      return { status:'HALTED', checked:index, next:b.next, protectedContent:'UNCHANGED' };
    }
    if (input.ticket !== b.receipt.ticket)
      fail('RECONCILE_IDENTITY', 'Keep the original immutable write ticket');
    if (b.next > 0 && (!this.recovery || this.recovery.batchId !== batchId ||
        this.recovery.planHash !== planHash || this.recovery.expectedError !== expectedError ||
        this.recovery.next !== b.next))
      fail('RECONCILE_ORDER', 'Freshly verify every completed page before resuming');
    const snapshot = read(b.receipt.snapshot);
    if (b.receipt.snapshot !== this.snapshot(batchId, b.next) ||
        hash(JSON.stringify(snapshot)) !== b.receipt.snapshotHash || snapshot.ticket !== input.ticket)
      fail('PERSISTENCE', 'Immutable pending snapshot changed');
    checkSnapshot(snapshot, b.next);
    const page = pageData(input.page, b.edits[b.next].pageId);
    if (page.body !== snapshot.page.body || page.properties !== snapshot.page.properties ||
        page.revision !== snapshot.page.revision)
      fail('RECONCILE_CHANGED', 'Pending page must still equal its full preimage; no write is acknowledged');
    const fencedOwner=input.adoptFencedOwner?this.ownerProof(input.adoptFencedOwner):null;
    // Persist an audit trail. Do not advance next, invent a verified receipt,
    // remove snapshots, change edits, or accept an already-written output.
    b.reconciliations = [...(b.reconciliations ?? []), {
      kind:preparedMcp?'UNWRITTEN_PREPARED_MCP_INITIALIZATION':preparedRead?'UNWRITTEN_PREPARED_NATIVE_READ':'UNWRITTEN_DC_AUTHORIZATION', at:new Date().toISOString(), index:b.next,
      ticket:input.ticket, planHash, error:expectedError, priorVerified:b.next,
      bodyHash:hash(page.body), propertiesHash:hash(page.properties),
      mode:this.recovery?.mode ?? 'FRESH_PRIOR_PAGES', verifiedReceipts:this.recovery?.receipts ?? []
    }];
    b.status = 'PREPARED';
    if(fencedOwner)b.dispatch={version:1,owner:fencedOwner,executor:this.executor,phase:'PREPARED',attempts:[]};
    if(preparedUnwritten){delete b.error;delete b.haltedFrom;}
    this.recovery = null;
    this.save();
    return { status:'PREPARED', next:b.next, ticket:input.ticket, protectedContent:'UNCHANGED',
      ...(fencedOwner?{executor:this.executor,planHash:b.planHash}:{}) };
  }
  handle(input) {
    caseException.validateControl(this.root,this.state);
    if(input.action==='reconcile_scoped_exception')return caseException.reconcile(this,input);
    if(input.action==='authorize_case_successor')return caseException.authorizeSuccessor(this,input);
    if(input.action==='record_case_admission')return caseException.admit(this,input);
    if(input.action==='release_case_owner')return caseException.release(this,input);
    if(input.action==='case_authority')return clone(this.state.caseExceptionControl??null);
    if(this.readOnly&&!(input.action==='status'||input.action==='close'||input.action==='validate_owner_proof'||
        (input.action==='reconcile_verified_unsent'&&input.apply===false)))
      fail('READ_ONLY','Read-only diagnostics cannot mutate canonical state');
    if(input.action==='reconcile_verified_unsent')return this.reconcileVerifiedUnsent(input);
    if(input.action==='validate_owner_proof')return this.ownerProof(input.ownerProof,input.binding);
    if(typeof input?.action==='string'&&input.action.startsWith('fence_'))return this.fencedHandle(input);
    if(this.state.caseExceptionControl && !this.fencedInternal &&
        !['status','close','validate_batch','preflight','validate_owner_proof'].includes(input.action))
      fail('OWNER_FENCED_RUNNER_REQUIRED','Exception retirement requires the participating owner-checked runner');
    if(!this.fencedInternal&&this.state.batches[input?.batchId]?.dispatch&&
        !['status','close','validate_batch','preflight','begin'].includes(input.action))
      fail('FENCED_PROTOCOL_REQUIRED','Fenced transactions cannot use legacy actions or recovery');
    const { action, batchId } = input;
    if (action === 'status' && !Object.hasOwn(input, 'batchId')) return clone(this.state);
    if (action === 'close') return { status: 'CLOSED' };
    if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,150}$/.test(batchId) ||
        ['__proto__', 'prototype', 'constructor'].includes(batchId)) fail('BATCH_ID', 'Stable safe observation ID required');
    if (action === 'status') {
      if (!Object.hasOwn(this.state.batches, batchId)) fail('BATCH', 'Selected batch does not exist');
      const selected=this.state.batches[batchId],batch={};
      for(const field of ['planHash','edits','next','status','receipt','error','haltedFrom','dispatch'])
        if(Object.hasOwn(selected,field))batch[field]=selected[field];
      return { version:this.state.version, active:this.state.active,
        batches:{ [batchId]:clone(batch) } };
    }
    if (action === 'begin' || action === 'validate_batch') {
      const edits = input.edits;
      if (!Array.isArray(edits) || !edits.length || edits.length > 30) fail('EDIT_SCHEMA', '1–30 page edits required');
      const seen = new Set();
      for (const edit of edits) {
        validateScope(edit, this.policy);
        const page = id(edit.pageId);
        if (seen.has(page)) fail('DUPLICATE_PAGE', 'One minimal literal per page per batch');
        seen.add(page);
      }
      const key = hash(JSON.stringify(edits));
      const previous = Object.hasOwn(this.state.batches,batchId) ? this.state.batches[batchId] : null;
      if (previous) {
        if (previous.planHash !== key) fail('BATCH_REUSE', 'Observation ID cannot bind different edits');
        if (previous.status === 'READY') previous.edits.slice(previous.next).forEach(stableNewText);
        return { status: previous.status, next: previous.next, reused: true };
      }
      edits.forEach(stableNewText);
      if (this.state.active) fail('UNRESOLVED_BATCH', 'Previous batch must verify or be reconciled before any new batch');
      if(action==='validate_batch')return {status:'READY',next:0};
      this.state.batches[batchId] = { planHash: key, edits: clone(edits), next: 0, status: 'READY', receipt: null };
      this.state.active = batchId; this.save(); return { status: 'READY', next: 0 };
    }
    if(action==='preflight') {
      validateScope(input.edit,this.policy);stableNewText(input.edit);
      const p=plan(pageData(input.page,input.edit.pageId),input.edit);
      return {status:'SAFE_LITERAL',expectedHash:hash(p.expected),beforeHash:p.beforeHash,afterHash:p.afterHash};
    }
    if (action === 'reconcile_autolink') return this.reconcileAutolink(input);
    if (action === 'reconcile_escaped_arrows') return this.reconcileRendering(input, 'arrows');
    if (action === 'reconcile_applied_readback') return this.reconcileAppliedReadback(input);
    if (action === 'reconcile_unprepared_read') return this.reconcileUnpreparedRead(input);
    if (['reconcile_verified','reconcile_receipts','reconcile_unwritten'].includes(action)) return this.reconcile(input);
    const b = this.current(batchId), edit = b.edits[b.next];
    if (action === 'halt') {
      b.haltedFrom=b.status;
      if(input.readDetail!==undefined)b.readDetail=String(input.readDetail).slice(0,1000);
      b.status = 'HALTED'; b.error = String(input.reason ?? 'Connector or runner failed').slice(0,1000);
      this.save(); return { status: 'HALTED', next: b.next };
    }
    if (action === 'prepare') {
      if (b.status !== 'READY') fail('PAGE_BARRIER', 'Prior page has not verified');
      validateScope(edit, this.policy);
      stableNewText(edit);
      const page = pageData(input.page, edit.pageId), p = plan(page, edit);
      const ticket = crypto.randomUUID();
      const snapshot = { version: 1, batchId, index: b.next, ticket, edit, page,
        expected: p.expected, beforeHash: p.beforeHash, afterHash: p.afterHash,
        bodyHash: hash(page.body), expectedHash: hash(p.expected), propertiesHash: hash(page.properties) };
      const file = this.snapshot(batchId, b.next);
      // Snapshot is durably saved and re-read before the write ticket exists.
      atomic(file, snapshot);
      const reread = read(file);
      if (hash(reread.page.body) !== snapshot.bodyHash || hash(reread.expected) !== snapshot.expectedHash)
        fail('PERSISTENCE', 'Snapshot digest mismatch');
      b.status = 'PREPARED'; b.receipt = { ticket, snapshot: file, snapshotHash: hash(JSON.stringify(snapshot)) };
      this.save(); return { status: 'PREPARED', ticket, bodyHash: snapshot.bodyHash, snapshot: file };
    }
    if (!b.receipt || input.ticket !== b.receipt.ticket) fail('TICKET', 'Ticket does not match the current page');
    const snapshot = read(b.receipt.snapshot);
    if (hash(JSON.stringify(snapshot)) !== b.receipt.snapshotHash) fail('PERSISTENCE', 'Immutable snapshot changed');
    if (action === 'authorize') {
      if (b.status !== 'PREPARED') fail('PAGE_BARRIER', 'Write has already been authorized; never retry it');
      validateScope(edit, this.policy);
      stableNewText(edit);
      const page = pageData(input.page, edit.pageId);
      if (page.body !== snapshot.page.body || page.properties !== snapshot.page.properties ||
          page.revision !== snapshot.page.revision) fail('CONCURRENT_CHANGE', 'Page changed since the saved preimage');
      const p = plan(page, edit);
      if (p.expected !== snapshot.expected) fail('PLAN_DRIFT', 'Recomputed plan differs');
      b.status = 'WRITE_PENDING'; this.save();
      return { status: 'WRITE_PENDING', request: p.request, ticket: b.receipt.ticket };
    }
    if (action === 'verify') {
      if (b.status !== 'WRITE_PENDING') fail('PAGE_BARRIER', 'No pending write to verify');
      const page = pageData(input.page, edit.pageId);
      if (page.body !== snapshot.expected || page.properties !== snapshot.page.properties) {
        b.status = 'HALTED'; b.error = 'READBACK_MISMATCH';
        const actualFile = this.snapshot(batchId, b.next) + '.actual.json';
        // Set the barrier even if saving the unexpected readback fails.
        this.save(); atomic(actualFile, { page, actualHash: hash(page.body), at: new Date().toISOString() });
        fail('READBACK_MISMATCH', 'Protected content or properties changed; batch is halted');
      }
      const n = snapshot.edit.oldStr.length, m = snapshot.edit.newStr.length;
      const index = snapshot.page.body.indexOf(snapshot.edit.oldStr);
      if (hash(page.body.slice(0,index)) !== snapshot.beforeHash ||
          hash(page.body.slice(index+m)) !== snapshot.afterHash || page.body.length !== snapshot.page.body.length-n+m)
        fail('PROTECTED_CHANGE', 'Protected prefix/suffix differs');
      const verified={page,bodyHash:hash(page.body),at:new Date().toISOString()};
      atomic(b.receipt.snapshot + '.verified.json',verified);
      b.verifications=[...(b.verifications??[]),{index:b.next,snapshotHash:b.receipt.snapshotHash,
        verifiedHash:hash(JSON.stringify(verified))}];
      b.next++; b.receipt = null; b.status = b.next === b.edits.length ? 'COMPLETED' : 'READY';
      if (b.status === 'COMPLETED') this.state.active = null;
      this.save(); return { status: b.status, next: b.next, protectedContent: 'UNCHANGED', bodyHash: hash(page.body) };
    }
    fail('ACTION', 'Unknown broker action');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const state = args[args.indexOf('--state')+1], policyFile = args[args.indexOf('--policy')+1];
  if (!args.includes('--stdio') || !args.includes('--state') || !args.includes('--policy')) {
    process.stderr.write('Usage: broker.cjs --stdio --state ABSOLUTE_DIR --policy ABSOLUTE_JSON\n'); process.exit(2);
  }
  let broker;
  try { broker = new Broker(state, JSON.parse(fs.readFileSync(policyFile, 'utf8'))); }
  catch (e) { process.stdout.write('NPG/1 '+JSON.stringify({ code: e.code ?? 'ERROR', error: e.message })+'\n'); process.exit(1); }
  process.stdout.write('NPG/1 {"ready":true}\n');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    let request;
    try {
      request = JSON.parse(line);
      const result = broker.handle(request);
      process.stdout.write('NPG/1 '+JSON.stringify({ requestId: request.requestId, ok: true, result })+'\n', () => {
        if (request.action === 'close') { rl.close(); process.stdin.destroy(); process.exit(0); }
      });
    } catch (e) {
      process.stdout.write('NPG/1 '+JSON.stringify({ requestId: request?.requestId, ok: false, code: e.code ?? 'ERROR', error: e.message })+'\n');
    }
  });
  let closed = false;
  function close() { if (!closed) { closed = true; broker.close(); } }
  rl.on('close', close); process.on('exit', close);
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal, () => { close(); process.exit(0); });
}
module.exports = { Broker, GuardError, hash, pageData, plan, validateEdit, atomic, loadUnwrittenManifest, assessUnwrittenExecution };
