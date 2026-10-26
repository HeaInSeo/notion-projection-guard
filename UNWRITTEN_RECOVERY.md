# Evidence-based terminal no-send recovery

This candidate separates one transaction's closure from general dispatch fencing.
Code, independent review, public publication, merge, installation and operational
apply are distinct stages. This document grants none of those operational rights.

## Evidence classification

The recovery engine derives a decision from a reviewed execution record. It does
not accept a caller-supplied A/B/C verdict or infer safety from elapsed time.

| Class | Required observed facts | Decision |
| --- | --- | --- |
| A | The same original Code Mode invocation ended and cannot resume; a complete post-authorize segment shows zero native mutation calls, zero transport handoffs and no separate dispatch route | Exact terminal unwritten closure may be eligible. No extra hypothetical late-executor fencing is required |
| B | An attributable native mutation/transport/async/queued/deferred/process send was created, or an observed live/resumable invocation lacks a later terminal receipt | No no-send closure. Resolve the specific identified invocation/request/task |
| C | Invocation identity, terminal state, source provenance or relevant call coverage is missing, incomplete or invalid | No closure. Report the missing evidence and access alternatives; do not claim an executor or send exists |

Positive send evidence takes priority over incomplete negative coverage. A broker
authorize response returning a request is a protocol event, not a native send.
Broker exit is not Code Mode invocation exit. A different provider's review job
cannot establish the write invocation's state. Historical RUNNING is consumed by
a later terminal for that same invocation; an actual send remains send evidence.

`RECOVERY_EVIDENCE_MISSING` and `RECOVERY_EVIDENCE_INVALID` identify C.
`RECOVERY_OBSERVED_DISPATCH_OR_EXECUTOR` identifies B and lists only the observed
correlations. Missing records do not become `EXECUTOR_NOT_FENCED` by assumption.

## Minimal reviewed record and trust boundary

`REVIEWED_CODE_MODE_TRACE_V1` is a normalized, independently reviewed extraction,
not a claim that this repository implements an undocumented provider export API.
It records one invocation, the original authorize correlation and the relevant
post-authorize call span through its terminal receipt. It need not contain the
whole conversation/account log. It includes:

- Purpose `NOTION_MUTATION`, original conversation/response and invocation ID,
  exact batch/plan/ticket/snapshot, and the original authorization request ID.
- Code Mode control-plane provenance, independent reviewer, original source
  record keys and hashes. Raw source bytes accompany the extraction privately.
- Ordered source-bound events for broker protocol, native calls, transport,
  dispatch children and invocation state. A source-specific locator or review
  note can identify the supporting fields within an original record.
- Explicit coverage of native mutation calls, transport handoffs and child
  dispatch creation, plus the original terminal status and resumability.

The engine checks approved bytes, source hashes, identity, ordering, coverage,
terminal state and observed event types. The independent evidence reviewer must
verify that the source is authentic, maps correctly to these facts and covers
the original Code Mode/native-call boundary. A matching hash does not perform
that semantic review. A self-report, server-only log, unchanged page or synthetic
test cannot substitute for it. No missing production trace may be invented.

## Private exact case manifest

Internal roots, incident IDs, journal/ticket/snapshot digests, original error,
caller references, runtime pins and installation receipt are private inputs in
`EXACT_UNWRITTEN_CASE_V1`, recovery kind `POST_AUTHORIZE_PRE_INVOKE_VETO`.
They are not public source constants. The separately approved manifest digest
pins its exact bytes. The engine reloads it and requires the exact original
canonical root, complete journal, plan, error, ticket, snapshot and installation.
It cannot choose an empty replacement state. The CLI uses `existingOnly` and
fails before lock acquisition if the canonical root or journal is absent.

The public candidate must be audited through every new reachable commit, not
only its final working tree. Preserve superseded unpublished work privately
before constructing a sanitized candidate on the same active branch. Do not
rewrite existing public history or publish private archive refs.

## Check-only and explicit apply

```sh
node /reviewed/source/recover_unwritten.cjs --check-only \
  --manifest /private/case.json --approved-manifest-sha256 REVIEWED_MANIFEST_HASH \
  --input /private/fresh-input.json --approved-evidence-sha256 REVIEWED_TRACE_HASH
```

`--check-only` creates no lock, audit or canonical write. Missing execution input
returns C with precise missing facts. Check-only is an observation, not a write
reservation. A separately authorized `--apply` reacquires the canonical lock and
revalidates the original state, current scoped ownership, complete fresh page,
properties, revision, installed pins and approved evidence. Any changed revision,
partial application, unexpected future/readback evidence or conflict blocks.

Only A can produce `ABORTED_UNWRITTEN`; it never marks an unapplied transaction
COMPLETED. The original plan, error, halted phase, receipt, next=0 and unrelated
history remain preserved. The audit saves the original full journal, fresh page,
manifest and execution evidence before publishing the terminal disposition and
ticket revocation. A journal-write failure resumes from that exact validated
audit without deletion. Repeated closure and restart add no duplicate writes;
future authorization with the closed transaction/ticket is rejected.

Case closure uses the reviewed broker API, not raw journal editing, error
substitution, a fresh state or a retry of the original mutation.

## Route-specific B handling and C alternatives

| Observed route | Owner and next action |
| --- | --- |
| Live/resumable Code Mode invocation | Its execution control-plane owner obtains an actual terminal receipt; do not infer it from age or a server PID |
| Native mutation or transport handoff | The original request owner correlates the provider response/task and complete preservation readback; no resend |
| Async/queued/deferred send | Inspect that actual task's result; use supported cancellation only if available and verify its outcome |
| Separate dispatch process | Its process owner confirms termination and resolves any already handed-off provider request |
| No control-plane record available | Obtain the scoped original invocation/tool segment through the originating connected browser, or an original execution-record export; record which access path is unavailable |

Security/credential/permission changes are not automatic recovery actions. If an
observed route requires them, describe its specific dependency, affected scope
and separate approval. Do not build or revoke infrastructure to stop an executor
whose existence has not been established. If C persists, offer the concrete
record-access alternatives and distinguish data access from apply approval.

## Separate recurrence prevention

The current runner retains owner/prerequisite checks before durable begin,
prepare and authorize. Authorize does not export a request; dispatch durably
records SEND_INTENT before export. A final same-owner confirmation and synchronous
lease check run immediately before the native tool invocation. Each dispatch has
its own provider correlation, permit, ACK and full verification. Delayed replies,
lost responses and late writes remain uncertain and cannot use no-send closure.
Supported legacy PREPARED recovery atomically adopts the original ticket into
that current path. All returned legacy owner proofs are actually validated.

These are participating-client guarantees. Adoption of all real central write
entries, lock participation and the actual ownership adapter is separately
designed and verified. The unfinished general deployment does not add a
prerequisite to a case whose A evidence and exact closure guards are satisfied.

After approved closure, verify the canonical barrier and full protected content/
properties, recheck current central ownership, then reuse the existing accepted
packet and existing writer. Actual own CLAIM is distinct from admission/start;
central does not write worker CLAIM, lease or RELEASE. Other products' evidence
conditions, review budgets and normal landing gates remain independently in force.

## Tests

`test_unwritten_recovery.cjs` exercises A, positive B with incomplete coverage,
C versus actual risk, wrong provider/layer, consumed historical running state,
tampering, exact pins, revision changes, repeated closure, restart, audit-first
failure, two real recovery processes and absent-state refusal.
`test_fenced_dispatch.cjs` retains the separate dispatch-race and lease/response
delay regressions. Synthetic evidence validates code behavior, not a real case.
