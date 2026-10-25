# Review timeout operational contract

REVIEW-TIMEOUT-20261025-v1 is separate from WIP. It does not edit execution-queues
section 3, broker targets/policy/journal, worker ownership or normal review,
uncertain-write and landing gates. The seven PR9 candidate files/hashes remain
unchanged. Candidate, installation and actual scheduled adoption are distinct.

## Storage, ownership and dispatch

Use exactly one owned local Linux 0700 canonical ledger directory, never NFS/SMB,
a copied/rolled-back ledger or reinitialization. Missing normal state is an error.
The explicit initializer runs once. All mutations use the original flock, exact
revision CAS, at-most-five-minute lease and monotonic fence. Initial requests
also fsync/read back UNKNOWN intent before POST. Locks span dispatch.
The same canonical directory also holds scope-marked append-only provider
observations and immutable full outbound-body records. Missing initialized
history requires same-scope reconciliation. Identical provider facts are
deduplicated without rewriting their first observation; fresh full snapshots
and retrieval times remain in immutable external evidence receipts.

All operational provider code runs in a separately supervised worker.
Replacements use review_timeout_isolated.cjs:runIsolated. Original requests and
observation use review_timeout_operational_worker.cjs:runTask. Supervisors import
no provider callbacks. Production createTransport refuses an in-process caller;
the CLI has no provider-module/fault-injection override. Only tests inject a
trusted fixture through the isolated-worker API.

Reuse existing GitHub CLI authentication in memory. Native HTTPS calls are
bounded, do not follow redirects and have no retry/detached-send behavior.
No credentials, permissions, account settings or cancellation capability are
installed or expanded. Socket/receipt/persistence/lease/watchdog errors never
retry the send or restore a spent attempt.

## Complete history migration

Preserve the complete private central prompt and schedule, both controller
ledgers, prior recovery receipts and all provider comment/review/thread pages.
The importer keeps immutable full provider snapshots and audit references.
Explicit-head/base manual requests can form one original and at most one
sufficiently late replacement. Existing chains are never overwritten.
Missing scope/base, third requests, conflicting bases, unknown managed UUIDs,
missing known local requests and opaque already-consumed recovery budgets are
quarantined. Do not import only a last request as a fresh original. Quarantine
has no automatic clear/reset.
Scope parsing requires an unambiguous exact/frozen or explicit labeled head
and one base, canonicalizes SHA case, and never selects Previous head by
substring. Edited request bodies retain all observed versions and quarantine.
Managed UUIDs bind the exact owning repo/PR/scope, immutable full body,
parent/fence, authenticated requester and any acknowledged provider comment ID.

PR-open automatic reviews remain preserved evidence, not the formal post-pair
request when that later phase is explicitly required. If a legacy recovery
replaced an automatic execution, retain its spent-budget constraint instead
of inventing an original intent. Preserve all old-head and late findings.
A new original cannot bypass an already in-flight provider execution on the
same head. If its automatic lineage cannot be safely migrated, keep a concrete
reconciliation blocker; do not rename a recovery into a fresh original.

## Real eligibility and provider limitations

The existing central policy owner supplies a fresh <=60-second attestation after
reading real authoritative sources. This trusted owner boundary does not grant
authority to an untrusted caller. Bind owner, actual run ID, lease fence, exact
repo/PR/head/base and full hashed source content. Required gates are authority,
wip, singleWriter, workerRelease, independentReview, uncertainWrite, usage,
currentHead, findingDisposition and ci. Each gate needs PASS, sourceIds and a
specific explanation; each source needs id/url/content/sha256/retrievedAt.
Missing/stale/HOLD gates block. Hashes prove preservation, not semantic PASS;
do not manufacture an attestation.

The provider additionally checks the real canonical barrier, open/non-draft
scope, complete fresh history, unresolved threads and unaccounted requests.
Immediately before POST it rechecks the live fence and durable UNKNOWN intent.
It fsyncs the entire immutable outbound body before POST and rechecks the
source-grant expiry, canonical barrier and retained provider holds afterward.
A positively scoped unrelated barrier does not block an independent repo.
Only valid matching nonempty plan hashes can prove that exemption. An unmapped
or missing-proof barrier cannot be assumed unrelated. Other independent work
continues under its existing gates.

One POST embeds exact head/base, unique request UUID, predecessor and fence.
The PR scope is checked before/after POST; changes leave UNKNOWN. GitHub issue
comments do not offer atomic head-conditioned review dispatch. This adapter
does not claim GitHub server fencing or atomic provider head binding. Real
verdicts still require actual commit/request attribution and existing gates.

The mutable Codex summary has no execution ID. Retain it as observation; it can
prevent a duplicate send but never becomes a request-bound CLEAN, cancels an
older execution or overwrites a newer decision. Ambiguous terminal evidence
stays RECONCILE_RESULTS. Unresolved provider threads block; preserve/dispose
late valid defects even after newer clean. The original core request-bound
result/disposition APIs keep their strict evidence requirements.
Every observed finding definition has a first-class durable hold. Disappearing
threads, isResolved, deleted comments or later clean summaries do not clear it.
Provider callbacks persist scoped observation intake before returning; later
calls enforce that intake even before the main ledger import. All observed
request bodies and edits remain effective history if the provider page changes.
Only an explicit definition/current-scope-bound responsible-owner disposition
with preserved source evidence can clear a finding hold. A changed head/base
requires reassessment. One bad scope yields PARTIAL and does not suppress
independently verified other scopes.

Watchdog SIGKILL/close confirms only local exit. Provider termination remains
UNKNOWN. Unique exact UUID/head/base/fence/parent lookup can acknowledge a
request already present only when its entire pre-recorded body and expected
authenticated requester match; copied progress/quoted comments never do.
Missing matches do not prove non-delivery or return
the spent budget.

## Existing scheduled central owner protocol

The installed wrapper's contract command supplies private paths and this text.
Keep the complete pre-existing prompt, reservation, WIP and every user HOLD.

1. Peek the existing automation's actual current run. Save private 0600 JSON:
   source=AUTOMATIONS_PEEK, automationId, isEnabled, schedule, retrievedAt, and
   the exact run_details.last_run object as run. It must be in_progress/current
   and match the unchanged hourly minute/second, not an immediate/manual run.
2. Write private input JSON: origin=SCHEDULED, actor=the existing automation
   owner, runId=the actual run ID, schedulerEvidenceFile=the proof path.
3. Invoke the installed wrapper: tick --input INPUT. Record its real receipt
   path/hash/run ID in the scheduled result. Tick exhausts provider pages in
   isolated workers, migrates conservatively and writes decisions; it sends
   nothing. Observation errors mean PARTIAL, never empty/free capacity.
4. Only for real eligible work, prepare --input INPUT with the exact scope and
   handoff={nextOwner,next,nextTrigger}. This acquires a live fence and returns
   contextFile. Write a fresh full-gate grant with that owner/fence/scope/runId,
   observedAt/expiresAt, sourceEvaluator=EXISTING_CENTRAL_POLICY_OWNER, sources
   and gates as above. Invoke send-original or send-replacement with an input
   containing contextFile and grantFile. Every new manual/post-pair request
   uses this path; never also use legacy direct @codex comment dispatch.
   Prepare is fencing/bookkeeping, not dispatch approval. Barriers are enforced
   on actual sends; local reconciliation/disposition remains possible.
5. For uncertain delivery, acquire a fresh prepare context for the same scope,
   then reconcile-delivery with contextFile/requestId. It only acknowledges
   unique exact existing delivery. It never sends or records cancellation.
6. For a retained finding, prepare the actual current scope, then invoke
   dispose-finding with contextFile/dispositionFile. The private disposition JSON
   must contain version=1, findingId, definitionSha256, owner (the fenced central
   assessor), responsibleOwner, sourceEvaluator=EXISTING_CENTRAL_POLICY_OWNER,
   disposition=FIXED or DISMISSED, assessedScope, fresh assessedAt, explanation,
   and sources with URL/full content/SHA256. The command independently observes
   the provider's current scope, retains that observation, and preserves a
   private immutable copy of the assessment. It grants no merge/review PASS.

At >=30 minutes warn; strictly beyond 60 classify timeout. A first timeout
is only a candidate and still needs every gate and isolated reservation/send.
A replacement timeout is BLOCKED with owner/next/trigger, never an automatic
third request. Checks occur on the existing reservation cadence; no minute
timer is added. Do not create a real replacement just to test adoption.

## Review, installation and rollback

Run both candidate verifiers, operational tests and the existing full CI suite.
Synthetic tests cover two real competing processes, synchronous infinite send,
abrupt post-send exit, intent/reload/no-resend, stale fences, complete pagination,
legacy budget migration, late findings and 30/60-minute boundaries. Synthetic
receipts do not prove provider/scheduled adoption.

Use the existing single ACTIVE branch/PR and independent normal review gates.
Install only the reviewed immutable commit; preserve historical manifests and
capture actual installed source/wrapper/config hashes separately. Then capture
the first real regular scheduled decision receipt. No real replacement is
required when history/existing gates correctly block one.

Rollback disables the new dispatcher under its owner and retains the entire
ledger, initialized marker, unknown intents, sources, findings and audit.
Never enable old and new send paths together or reset state to regain an attempt.
