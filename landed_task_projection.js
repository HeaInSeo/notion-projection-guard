(function createLandedTaskProjection(tools, config) {
  'use strict';
  // Ordinary MERGED follow-through. Current original/pair IDs come from fresh
  // linked own RELEASEs, not the historical task IDs in complete_projection.js.
  // All body mutations still use the unchanged approved durable broker/runner.
  const shared=[
    ['3b286e6dd1d1817aa093fca807659f07','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · operator_queue'],
    ['3b286e6dd1d181f2a75cfbd3885071c4','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · guardrail_queue'],
    ['3bf86e6dd1d18110938bc358e17c779e','## CURRENT INCIDENT MAINTENANCE · BODY_RANGE_OVERWRITE-20261011T2334Z · RESTORED_VERIFIED / ADOPTION_PENDING'],
    ['3ed86e6dd1d18118b0b8d98bb91892fb','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · hub'],
    ['3b286e6dd1d1811d9308d9a2b56c9de4','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · dashboard']];
  const repos={
    nodekit:{github:'HeaInSeo/NodeKit',
      bodies:[['3f086e6dd1d1818e9aecdc093a08cda9','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · nodekit_index']]},
    sori:{github:'HeaInSeo/sori',
      bodies:[['3f586e6dd1d181ebb43dd7de62aa2ca4','## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A KEEP_GATED ON W01.3'],
        ['3f586e6dd1d181cd9f5bdcdab6290de7','## CURRENT · 마지막 중앙 관측 · QSYNC-20261010T145034Z-v6 · W02.A REVIEW KEEP_GATED'],
        ['3f586e6dd1d181ddb9f3e7217f64bfcd','## CURRENT CENTRAL OBSERVATION · NPR-20261012 · sori_index']]}};
  const requiredProps=['작업 상태','다음 담당자','큐 구획','차단 대상','재개 지시','큐 정리 근거'];
  const centralProps=new Set([...requiredProps,'설계에이전트 답변','저장소 식별자',
    'date:큐 정리 시각:start','date:큐 정리 시각:is_datetime']);
  const must=(ok,why)=>{if(!ok)throw new Error('PROJECTION_BUNDLE: '+why);};
  const stable=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
  const count=(text,literal)=>text.split(literal).length-1;
  function identity(text,marker){
    return typeof text==='string'&&(text===marker||text.startsWith(marker+';'))&&
      [...text.matchAll(/(?:^|[^A-Za-z0-9_])(?:observation_id\s*=|observation-id:\s*)/g)].length===1;
  }
  function data(raw,id){
    for(let n=0;n<8;n++){
      must(!raw?.isError&&!raw?.error,'Fetch failed');
      if(raw?.structuredContent){raw=raw.structuredContent;continue;}
      if(Array.isArray(raw?.content)){
        try{raw=JSON.parse(raw.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));continue;}catch{}
      }
      break;
    }
    must(raw&&!raw.isError&&!raw.error&&raw.id?.replaceAll('-','').toLowerCase()===id,'Wrong or failed page');
    const text=raw.text;
    must(raw.truncated!==true&&!(raw.unknown_block_count??0)&&!(raw.unknown_block_ids?.length??0)&&
      typeof text==='string'&&!/<unknown\b|content (?:has been |is )?truncated/i.test(text)&&
      count(text,'<content>\n')===1&&count(text,'\n</content>')===1,'Complete native page required');
    const start=text.indexOf('<content>\n')+10,stop=text.indexOf('\n</content>',start);
    const props=text.match(/<properties>\n([\s\S]*?)\n<\/properties>/);
    must(stop>=start&&props&&typeof raw.page_last_edited_at==='string','Complete properties and revision required');
    return {body:text.slice(start,stop),props:JSON.parse(props[1]),revision:raw.page_last_edited_at};
  }
  function manifest(bundle){
    must(bundle&&/^[A-Za-z0-9_-]{1,100}$/.test(bundle.observationId),'Literal observation ID required');
    must(Array.isArray(bundle.repositories)&&bundle.repositories.length>0&&
      new Set(bundle.repositories).size===bundle.repositories.length&&bundle.repositories.every(r=>Object.hasOwn(repos,r)),'Known distinct repositories required');
    const bodies=bundle.repositories.flatMap(r=>repos[r].bodies).concat(shared);
    must(bundle.repositories.length===1,'One repository per source transaction required');
    const binding=bundle.binding;
    must(binding&&binding.repository===bundle.repositories[0]&&binding.source?.kind==='MERGED'&&
      Number.isSafeInteger(binding.source.pr)&&binding.source.pr>0&&
      /^[a-f0-9]{40}$/.test(binding.source.head??'')&&/^[a-f0-9]{40}$/.test(binding.source.mergeSha??'')&&
      ['writer','reviewer'].every(role=>{
        const p=binding[role];return p&&/^[a-f0-9]{32}$/.test(p.pageId??'')&&
          ['taskId','phase','eventId','sessionId'].every(k=>typeof p[k]==='string'&&p[k].length>0)&&
          Number.isSafeInteger(p.version)&&p.version>0&&(!p.sourceRelease||
            (p.sourceRelease.taskId===p.taskId&&['phase','eventId','sessionId'].every(k=>
              typeof p.sourceRelease[k]==='string'&&p.sourceRelease[k].length>0)&&
              Number.isSafeInteger(p.sourceRelease.version)&&p.sourceRelease.version>0&&p.sourceRelease.version<p.version));
      })&&binding.writer.pageId!==binding.reviewer.pageId&&binding.writer.taskId!==binding.reviewer.taskId&&
      binding.writer.sessionId!==binding.reviewer.sessionId,
      'Linked current task/pair and frozen merged source required');
    const native=[binding.writer.pageId,binding.reviewer.pageId];
    if(binding.repository==='sori')must(native[0]===repos.sori.bodies[0][0]&&native[1]===repos.sori.bodies[1][0],
      'Sori central body capability must match the bound original/pair');
    must(Array.isArray(bundle.edits)&&bundle.edits.length===bodies.length&&
      new Set(bundle.edits.map(e=>e.pageId)).size===bodies.length,'Every mandatory body target required exactly once');
    must(Array.isArray(bundle.native)&&bundle.native.length===native.length&&
      new Set(bundle.native.map(n=>n.pageId)).size===native.length,'Every native metadata target required exactly once');
    must(bundle.observationMarkerStyle==='plain-v1','New projections require explicit plain-v1 observation markers');
    must(/^[A-Za-z0-9-]+$/.test(bundle.observationId),'Plain identity must avoid Markdown escapes');
    const observationMarker='observation-id: '+bundle.observationId;
    const edits=bodies.map(([id,heading])=>{
      const e=bundle.edits.find(e=>e.pageId===id);
      must(e&&e.heading===heading&&typeof e.oldStr==='string'&&e.oldStr.length>0&&e.oldStr!==e.newStr&&
        identity(e.newStr,observationMarker),'Wrong target/heading or missing unique shared observation ID');
      must(!/[`_]/.test(e.newStr),'New body literal risks Notion Markdown serialization');
      return e;
    });
    for(const id of native){
      const n=bundle.native.find(n=>n.pageId===id),p=n?.properties;
      must(p&&requiredProps.every(k=>Object.hasOwn(p,k))&&Object.keys(p).every(k=>centralProps.has(k))&&
        identity(p['큐 정리 근거'],observationMarker),'Native central metadata manifest with unique identity required');
      must(!/[`_]/.test(p['큐 정리 근거']),'New native observation text risks Notion Markdown serialization');
    }
    return {edits,native,ids:[...new Set([...native,...bodies.map(([id])=>id)])]};
  }
  async function readAll(ids){
    const pages=new Map();
    // Bounded reads avoid flooding the connector with all complete page bodies.
    for(let i=0;i<ids.length;i+=3){
      const group=await Promise.all(ids.slice(i,i+3).map(async id=>[id,data(await tools.mcp__codex_apps__notion_fetch({id}),id)]));
      for(const [id,p] of group)pages.set(id,p);
    }
    return pages;
  }
  function ownRelease(p,expected,role,binding,native){
    const props=p.props;
    must(props['작업 ID']===expected.taskId&&props['이벤트 ID']===expected.eventId&&
      props['세션 ID']===expected.sessionId&&props['체크포인트 버전']===expected.version&&
      props['Authority Gate']==='READY','Current native own identity/authority required');
    must(props['작업 상태']!=='종료'||(native?.properties['작업 상태']==='종료'&&
      native.properties['다음 담당자']==='없음'&&native.properties['큐 구획']==='완료 이력'),
      'Closed current task must remain closed with no next owner');
    const records=[...p.body.matchAll(/```json\n([\s\S]*?)\n```/g)].flatMap(m=>{
      try{
        const literal=m[1],e=literal.startsWith('QUEUE_EVENT_V1 ')?JSON.parse(literal.slice(15)):
          JSON.parse(literal).QUEUE_EVENT_V1;
        return e?[{event:e,end:m.index+m[0].length}]:[];
      }catch{return [];}
    });
    const events=records.map(r=>r.event);
    const matches=events.filter(e=>e.event_id===expected.eventId);
    must(matches.length===1,'Exactly one matching own event required');
    const e=matches[0],latest=Math.max(...events.filter(e=>e.task_id===expected.taskId).map(e=>e.version));
    must(e.task_id===expected.taskId&&e.phase===expected.phase&&e.session_id===expected.sessionId&&
      e.version===expected.version&&e.version===latest&&e.role===role&&e.kind==='RELEASE'&&
      e.lease_state==='RELEASED'&&Number.isFinite(Date.parse(e.event_at_utc))&&Date.parse(e.event_at_utc)<=Date.now(),
      'Frozen latest own RELEASE required');
    // A successor may have completed before an older merge's projection. Bind
    // the immutable source RELEASE separately, without making it current again.
    const frozen=expected.sourceRelease??expected,source=records.filter(r=>r.event.event_id===frozen.eventId);
    must(source.length===1,'Exactly one frozen source RELEASE required');
    const s=source[0].event;
    must(s.task_id===expected.taskId&&s.phase===frozen.phase&&s.session_id===frozen.sessionId&&
      s.version===frozen.version&&s.role===role&&s.kind==='RELEASE'&&s.lease_state==='RELEASED'&&
      Number.isFinite(Date.parse(s.event_at_utc))&&Date.parse(s.event_at_utc)<=Date.parse(e.event_at_utc)&&
      typeof s.head_or_digest==='string'&&s.head_or_digest.split(/[^a-f0-9]+/).includes(binding.source.head)&&
      typeof s.repo_pr==='string'&&s.repo_pr.toLowerCase().includes(repos[binding.repository].github.toLowerCase())&&
      new RegExp('#'+binding.source.pr+'(?:\\D|$)').test(s.repo_pr),'Frozen merged-source own RELEASE required');
    return source[0];
  }
  function linked(p,id){
    return ['대상 행','후속 행'].some(k=>Array.isArray(p.props[k])&&p.props[k].some(v=>
      typeof v==='string'&&v.replaceAll('-','').toLowerCase().endsWith('/'+id)));
  }
  function bindingProof(bundle,pages){
    const b=bundle.binding,w=pages.get(b.writer.pageId),r=pages.get(b.reviewer.pageId);
    const writerSource=ownRelease(w,b.writer,'operator',b,bundle.native.find(n=>n.pageId===b.writer.pageId));
    const reviewerSource=ownRelease(r,b.reviewer,'guardrail',b,bundle.native.find(n=>n.pageId===b.reviewer.pageId));
    must(writerSource.event.session_id!==reviewerSource.event.session_id,'Independent source sessions required');
    const end=r.body.indexOf('\n## ',reviewerSource.end);
    const section=r.body.slice(reviewerSource.end,end<0?r.body.length:end);
    let fence=null;
    const lines=section.replace(/<code>[\s\S]*?<\/code>/g,'').split('\n').filter(line=>{
      const m=line.match(/^\s*(`{3,}|~{3,})/);
      if(m){if(!fence)fence=m[1];else if(m[1][0]===fence[0]&&m[1].length>=fence.length)fence=null;return false;}
      return !fence;
    }).map(l=>l.replace(/<[^>]*>/g,'').replace(/^\*\*(.*?)\*\*$/,'$1'));
    must(lines.some(l=>/^Verdict:\s*PASS\b.*P0=0,\s*P1=0,\s*P2=0/.test(l)),
      'Bound source independent verdict line with no P0-P2 required');
    must(linked(w,b.reviewer.pageId)&&linked(r,b.writer.pageId),'Reciprocal original/pair relationship required');
  }
  async function mergedSource(bundle){
    const b=bundle.binding;
    let p=await tools.mcp__codex_apps__github_get_pr_info({repository_full_name:repos[b.repository].github,pr_number:b.source.pr});
    for(let n=0;n<8;n++){
      must(!p?.isError&&!p?.error,'GitHub source failed');
      if(p?.structuredContent){p=p.structuredContent;continue;}
      if(Array.isArray(p?.content)){try{p=JSON.parse(p.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));continue;}catch{}}
      break;
    }
    // Accept the connector's normalized PR or GitHub's public PR shape.
    must(p&&(p.merged===true||p.merged_at)&&
      (p.head_sha??p.head?.sha)===b.source.head&&
      (p.merge_commit_sha??p.merge_sha)===b.source.mergeSha,'Actual merged PR/head/tree lineage required');
    const base=typeof p.base==='string'?p.base:p.base?.ref;
    let repo=await tools.mcp__codex_apps__github_fetch({url:'https://api.github.com/repos/'+repos[b.repository].github});
    for(let n=0;n<8;n++){
      must(!repo?.isError&&!repo?.error,'GitHub repository source failed');
      if(repo?.structuredContent){repo=repo.structuredContent;continue;}
      if(Array.isArray(repo?.content)){try{repo=JSON.parse(repo.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));continue;}catch{}}
      if(typeof repo?.content==='string'){try{repo=JSON.parse(repo.content);continue;}catch{}}
      break;
    }
    must(typeof base==='string'&&base===repo?.default_branch,'Merged source must target the current default branch');
  }
  function metadata(bundle,pages){
    for(const n of bundle.native)for(const [k,v] of Object.entries(n.properties))
      must(stable({v:pages.get(n.pageId).props[k]})===stable({v}),'Native property differs: '+n.pageId+'/'+k);
  }
  async function run(bundle){
    // Deep copy before awaits: mutable caller input must not change the plan.
    bundle=JSON.parse(JSON.stringify(bundle));
    const m=manifest(bundle),before=await readAll(m.ids);
    bindingProof(bundle,before);await mergedSource(bundle);
    metadata(bundle,before); // Properties are reconciled separately, with their own preservation readback.
    for(const e of m.edits){
      const b=before.get(e.pageId).body;
      must(count(b,e.oldStr)===1||count(b,e.newStr)===1,'Planned literal missing or ambiguous');
    }
    const runner=config.createRunner(tools,config.runnerConfig);
    const receipt=await runner.run(bundle.observationId,m.edits);
    must(receipt.status==='COMPLETED','Body batch incomplete');
    const after=await readAll(m.ids);metadata(bundle,after);
    bindingProof(bundle,after);await mergedSource(bundle);
    for(const id of m.ids){
      const a=before.get(id),b=after.get(id),e=m.edits.find(e=>e.pageId===id);
      const expected=e&&count(a.body,e.newStr)!==1?a.body.replace(e.oldStr,()=>e.newStr):a.body;
      must(b.body===expected&&stable(b.props)===stable(a.props),'Source/protected content changed: '+id);
      if(e)must(count(b.body,e.newStr)===1,'Final target absent: '+id);
    }
    return {status:'COMPLETE',observationId:bundle.observationId,repositories:bundle.repositories,
      bodyTargets:m.edits.length,nativeTargets:m.native.length,protectedContent:'UNCHANGED',binding:bundle.binding,
      scope:'PROJECTION_ONLY; REQUESTED is not worker CLAIM or product acceptance',
      receipt,readback:m.ids.map(id=>({pageId:id,revision:after.get(id).revision}))};
  }
  return {run};
})
