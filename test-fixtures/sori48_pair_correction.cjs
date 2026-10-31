'use strict';
// Synthetic worker history; no production page content or real CLAIM is made.
const id='3f586e6dd1d181cd9f5bdcdab6290de7',head='b26246e4ab3870bf6f7516b08906791570b57163',
 old='cf4485d9f7823775760a03813d92ab205126f6c6',session='94a6ff51-93cd-48c3-9e85-0338100883b1';
const specs=[
 [57,'CHECKPOINT','EVT-GR-SORI-W02-1B-PR48-F1-ADMISSION-GAP-CORRECTION-20261031T194313Z',head,session,'2026-10-31T19:43:13Z','RELEASED'],
 [56,'RELEASE','EVT-GR-SORI-W02-1B-PR48-F1-DELTA-REVIEW-RELEASE-20261031T194201Z',head,session,'2026-10-31T19:42:01Z','RELEASED'],
 [55,'CLAIM','EVT-GR-SORI-W02-1B-PR48-F1-DELTA-REVIEW-CLAIM-20261031T193908Z',head,session,'2026-10-31T19:39:08Z','HELD until 2026-10-31T20:24:08Z'],
 [54,'RELEASE','EVT-GR-SORI-W02-1B-PR48-STARTUP-REVIEW-RELEASE-20261029T024438Z',old,'5f80ca6a-6899-492c-b3f4-9ed4d3efa466','2026-10-29T02:44:38Z','RELEASED']];
const events=specs.map(s=>({event_id:s[2],version:s[0],role:'guardrail',kind:s[1],head_or_digest:s[3],
 task_id:'SR-SORI-SM-W02.A-20261010',session_id:s[4],event_at_utc:s[5],lease_state:s[6],repo_pr:'HeaInSeo/sori#48'}));
function pairPage(extra=''){
 const e=events[0],props={'이벤트 ID':e.event_id,'체크포인트 버전':57,'세션 ID':session,
  '작업 ID':e.task_id,'저장소 식별자':head,'Title':'preserve','큐 구획':'현재','작업 상태':'검증대기'};
 const body=events.map((ev,i)=>'## GUARDRAIL QUEUE EVENT ('+(i?'history':'current')+') · '+
  (i?'preserved':'CORRECTION v57')+'\n\n```json\nQUEUE_EVENT_V1 '+JSON.stringify(ev)+'\n```\n\n'+
  (i===0?'v55/v56 are UNADMITTED independent review; not a pair acceptance.':
   i===3?'<b>Verdict: NOT ACCEPTED on PR48 exact cf4485d9. P0=0, P1=0, P2=1.</b> Reviewer: independent.':'preserve')).join('\n\n');
 return {structuredContent:{id,page_last_edited_at:'2026-10-31T19:43:39.190Z',
  text:'<properties>\n'+JSON.stringify(props)+'\n</properties>\n<content>\n'+body+'\n\n'+extra+'\n</content>'}};
}
module.exports={pairPage,events};
