# Ordinary landing and successor intake

## Recovering a control reply without replaying input

After a failed or deferred control envelope, the client may read only the same
process's retained two-line reply. The frame must match that one request ID and
the existing bounded protocol. Input is sent once. Up to twelve retained reads
may tolerate transport failures; an absent/mismatched reply remains unknown.
Malformed or oversized frames fail immediately. This does not follow a deferred
provider task, retry a native call or change ownership/permit deadlines.

Close is attempted once per client, even if its reply stays unknown. The runner
and adopting entry preserve a primary failure and attach a separate closeError;
cleanup cannot replace the reason that originally stopped the operation.

## Expired source proof before an action

A stale witness never grants authority. Before invoking a staged operation or
send confirmation, the bridge can return a correlated
`NORMAL_SOURCE_EXPIRED_NO_ACTION` rejection. Only the real RPC reply, matching
that request's stage or confirmation identity, brands a one-use client error.
The runner may obtain entirely new native/central reads and try that uninvoked
operation at most twice more. It neither changes an old timestamp nor replays a
native call. A source reader that itself exceeds thirty seconds likewise reads
anew within a bounded budget. Changed sources, transport uncertainty, broker
failures after action entry and forged/native exceptions do not qualify.

If an executor already closed at READY/UNSENT without a current receipt or send
attempt, `normal_reconcile_unprepared` verifies every earlier complete native
page/receipt, the same plan/owner/scope and a fresh pending-page literal plan.
It requires terminal acknowledged provider correlation for the previous page,
or no attempts/provider at index zero. Check-only writes nothing. Apply privately
audits the full preimage, transfers only executor/owner and restores READY at the
same index, without a ticket, native call, ACK or page advance. The ordinary
prepare then creates its first pending ticket. A HALTED-from-READY entry requires
explicit `recovery:{apply:true,kind:'UNPREPARED_NO_SEND'}`. It cannot admit a
current uncertain send, AUTHORIZED state, pending provider or changed prior page.

Both prepared and unprepared continuations now scan all `hash(batch)-*` evidence
against the exact allowed set. Unexpected current/future snapshots or sidecars
are refused. A prior actual sidecar is allowed only by its validated historical
central-arrow reconciliation. This closes the PR19 evidence-directory parity
follow-up without changing any original control or timing limit.

## Continuing a prepared transaction after transport loss

An ordinary entry may encounter the same active batch at PREPARED after its
previous broker closed cleanly. The new executor first assesses and then applies
`normal_reconcile_prepared` under freshly observed actual central ownership.
It checks the immutable plan, same ticket, full pending snapshot and exact native
preimage, properties and revision. Every earlier full verification receipt and
fresh protected native page must match. Current-page send attempts are admitted
only when each expired permit already has its private zero-call revocation audit;
an unrevoked, pending or unknown native send remains blocked. A prior page's
terminal successful provider may remain only with its acknowledged earlier attempt.

Check-only writes nothing. Apply saves a full private audit and transfers only
the prepared executor and current owner; it preserves the ticket, plan, history,
earlier receipts and page position. It neither creates a ticket, sends, ACKs nor
advances. The normal fresh authorize/send/ACK/full verification follows. The
original broker lock must be held by the new executor, so a live prior executor
cannot be adopted. A HALTED prepared transaction additionally requires explicit
`recovery: {apply:true,kind:'PREPARED_NO_SEND'}`. Other HALTs do not enter this path.

When input staging loses its reply, a correlated halt may discard that unconsumed
stage and record its action, input hash and stage ID. Discarding a stage grants no
authority and never consumes it. The halt remains subject to the same live
executor, plan, original controls and canonical lock checks.

## Bounded replies and pre-call permit expiry

The current ordinary entry uses `normal_rpc_client.js` as `createClient`.
Install all fourteen files declared by `normal_live_command.js` from the same
reviewed source. This entry uses Additional MCP directly and bounded `NPG/2`
reply frames. Retained reads request the final frame and its trailing blank
line, rather than returning a preceding multi-megabyte input echo. Only bounded
metadata uses prompt matching, so a send confirmation can return directly;
full page inputs never enter that path. Bounded metadata waits up to three
seconds for its short reply, avoiding unnecessary retained-output round trips.
Requests are never resent.
The original eighteen control files, source freshness of thirty seconds and
send validity of at most fifteen seconds remain unchanged.

The bridge binds one private no-call token to each confirmed dispatch. The
client keeps that token out of the runner's result and consumes it before
invoking the native update. Only its own synchronous expired-permit branch can
offer the one-use token to a fresh ownership-bound continuation. A forged error,
native exception, lost result, mismatched request, provider task or different
executor cannot enter that branch. The continuation verifies the entire pending
preimage, revision, immutable request, ticket and current attempt. It privately
audits and revokes only the expired, uncalled attempt, restores the same ticket
to PREPARED and authorizes a new permit. At most two such renewals are allowed
per page, excluding the one explicit legacy-incident revocation; persistent
delay halts without calling Notion. No native invocation
is retried. A crash before durable revocation loses the process-local token and
remains blocked. After durable zero-call revocation, only the prepared continuation
above can transfer a closed executor, with a fresh full preservation check.

`reconcile_permit_expiry.cjs` separately admits only the legacy NodeKit149
index-three incident. Its literal journal, driver, diagnostic, failure-trace,
ticket, snapshot, dispatch and original three receipt fingerprints must match.
All three earlier complete native bodies and properties are freshly checked
against their immutable full verification receipts, and the pending page must
still equal its complete original preimage and revision. Check-only writes
nothing. Explicit apply saves a full private audit and restores PREPARED on the
same index, plan and ticket under actual fresh central ownership. It neither
acknowledges a write nor advances a page. The original five attempts and their
permits, prior failure, earlier receipts and other journal state are retained.
Run the existing bundle with `recovery: {apply:true,kind:'PRE_CALL_EXPIRED'}`
only after independent source review, current-head Codex, CI, normal landing
and verified installation. Ordinary native ACK and full readback then apply to
the remaining pages. Other HALTs and unknown native outcomes remain blocked.

Tests exercise the real runner, RPC client and bridge through delayed permit
renewal, a lost native result, bounded exhaustion and the full HALTED legacy
recovery through completion of only the remaining three pages. These tests do
not substitute for actual scheduled projection and genuine successor intake.

## Local ownership consumption under slow transport

The first scheduled adoption of PR16 halted at `SEND_INTENT` before a send
permit existed. The original hosted provider could lose its 30-second source
window while waiting for multiple control-plane replies. Its timestamps must
not be renewed, and the halted transaction must not be replayed.

`normal_followthrough_v2.js` is the corrected ordinary entry. Load its factories
from the same reviewed immutable source and install all eleven files declared
by `normal_live_command.js` in a new versioned directory. The literal command
bootstrap checks every extension before evaluating it, validates the original
case manifest and all original controls, then starts `normal_bridge.cjs` under
the original canonical broker lock. No original control file is replaced.

Wire `createTransport`, the unchanged `runner.js` as `createClient`,
`normal_live_runner.js` as `createLiveRunner`, `normal_live_owner.js` as
`createWitness`, `landed_task_projection.js` as `createLandedProjection`, and
`normal_live_command.js` as `createCommand`. Supply the installation manifest,
actual central task/run identifiers and the existing device configuration.
Call `run(bundle, references)` with the same validated merged-task binding and
fresh original/pair/Router/WIP references used by the first entry.

Every full operation is staged before its fresh native and scheduler reads.
Those reads run concurrently and retain the start timestamp. The locked local
consumer checks the actual enabled in-progress run, reference token, complete
source matches, original controls, current batch and installed extensions before
issuing a proof directly to the unchanged broker. There is no extra hosted
owner-proof round trip. Source freshness stays 30 seconds; the send permit stays
at most 15 seconds and is synchronously checked before the sole native call.
The `case_stage_input`, `case_consume_live` and `case_live_send` protocol names
are compatibility names for the pinned transport's bounded metadata handling;
this command never loads or borrows the incident-specific Sori bridge/provider.

All ordinary sources, plans, native scope, worker proof, main-branch merge and
full protected readback gates remain in `landed_task_projection.js`. BORI is
excluded. A failed or uncertain mutation is never retried.

### Exact denied-confirmation recovery

`reconcile_unpermitted_dispatch.cjs` is limited by literal journal, plan,
snapshot, dispatch, ticket, runner and diagnostic pins to the observed
`NODEKIT149-LANDED-20261028` failure. It is not a general SEND_INTENT recovery.
The original pinned driver calls Notion only after successful confirmation and
the synchronous permit check. This recovery requires its actual caught denial,
no durable permit, no provider/task, the complete unchanged native preimage and
revision, fresh scheduled ownership and the same canonical lock. A lost reply
with a saved permit, changed page, absent evidence or different journal fails.

Only the adopting owner may explicitly set `recovery: {apply: true}` for that
exact incident. The runner performs read-only assessment and then a new full
read and new ownership observation before apply. Apply saves a private complete
preimage audit, revokes the exact unpermitted exported intent, retains the old
failure and attempt, and restores PREPARED on the same plan/index/ticket under
the new executor. It makes zero Notion calls, creates zero tickets and advances
zero pages. The ordinary runner then performs new authorization, dispatch,
confirmation, its one native call, ACK and full verification. Neither the old
executor nor a second recovery may consume the revoked intent. Missing/lost
recovery results require inspection; there is no automatic reset or replay.

The exclusive recovery provider is intentionally restricted to its original
incident. Do not weaken it or reuse it for ordinary `exclusive=false` work.
`landed_task_projection.js` and `normal_projection_prerequisites.js` provide the
ordinary scheduled path, without changing the original 18 pinned controls.

## Adoption

Use one reviewed immutable source commit after normal CI, independent review,
current-head Codex and expected-head landing. No earlier exact-head exception
applies to this change. Install the new files in a separate versioned directory;
retain the existing broker, runner, complete entry, policy, approved hashes,
case controls, role hooks, timers, credentials and canonical journal. Save private
preimages, new file hashes and an installation receipt. Never alter a historical
exception manifest to accept new runtime bytes. This is not a second state root.

Before activating the central prompt pointer, verify the old controls using
`case_exception.validateControl` and `controls`, and verify every new source hash.
Keep the existing central enabled state and hourly schedule. Keep the watch read
only. Source publication, installation, prompt readback and actual scheduled
adoption are separate receipts.

## One normal transaction

For each actual merged source, follow the current task's original and reciprocal
pair links. Do not look up a repository through a completed historical task. The
binding contains repository, writer/reviewer page IDs, task IDs, exact phases,
event IDs, versions and sessions, plus `source: {kind:'MERGED',pr,head,mergeSha}`.
The entry verifies both latest native own RELEASEs, released leases, current
authority, distinct worker sessions, the pair's PASS and actual GitHub merge.
When a successor already has a newer own RELEASE, keep that latest identity in
the binding and explicitly provide `writer.sourceRelease` and/or
`reviewer.sourceRelease` with the older same-task event identity. Both events
must exist in the complete native body; the frozen source matches the merged
head, while the latest native identity stays current and is never rolled back.
The verdict is read only from the section following its bound review event;
quoted or code-example PASS text is not a verdict. The actual merged PR must
target the repository's current default branch.
It rejects BORI, whose dedicated writer remains under its existing contract.
No PR number, batch name or NodeKit phase is hardcoded in the new path.

Prepare the same six central metadata fields and mandatory body manifest as the
existing complete entry. NodeKit has six bodies and the current original/pair;
Sori has eight bodies and its existing original/pair. Reconcile native metadata
through the existing minimal central-property path and verify preservation.
Do not update worker event/version/session/lease/Authority or own body. Read full
native pages and all mandatory body targets, including the role queues, Router,
hub and dashboard. The resulting certificate covers projection only.

Freeze `references` as `{pageId,page}` objects containing full actual Notion
responses for the original, pair, Router and applied WIP policy (plus any other
authority sources needed by that task). Set `nativePageIds` to the bound pair and
`edits` to the exact body edits. A provider reads these pages afresh at every
ownership boundary; only the exact planned body literal and exact declared
central metadata expectations may differ. An unexpected central HOLD, changed
own proof, authority, policy,
unknown/truncated block or other source change fails closed. Do not refresh the
reference to hide a failed comparison during a live batch.

Use `ordinary_followthrough.js` as the adopting entry. It constructs one transport
and runner per transaction in Code Mode and derives provider native scope from
the same task binding. All factories
below are evaluated from their pinned function-expression source. `runner` and
`caseOwner` are the unchanged installed sources. Load the hosted
`ordinary_probe_command.js` factory from the same immutable reviewed source.
It constructs a literal bootstrap that verifies all five remote extension files
against the approved installation manifest before evaluating the exact verified
probe buffer. Symlinks, writable files, path drift and any hash mismatch block
the probe. This hosted factory is not a sixth installed runtime file.
`installation` contains `root`, `runtime`, `sourceHead`, `caseModuleHash`,
`extensionDirectory=runtime+'/extensions/'+sourceHead`, and the five SHA256
values in `files`. The provider appends only a validated PID and batch ID.

```js
const ordinary = ordinaryFollowthrough(tools, {
  createTransport: additionalTransport, createRunner: runner,
  createCaseOwner: caseOwner, createPrerequisites: normalPrerequisites,
  createLandedProjection: landedProjection, createProbeCommand: ordinaryProbeCommand,
  centralTaskId, runId: actualScheduledRun.id, root: canonicalRoot,
  installation, runnerConfig: existingRunnerConfig
});
const certificate = await ordinary.run(bundle, references);
```

The probe independently validates the unchanged case controls, same live broker
lock, ordinary ownership and same canonical batch. It writes nothing. The hosted
provider and existing case owner independently observe the real enabled,
`in_progress` central run. No manual session may supply a synthetic scheduled
generation. The existing broker retains send permits, ACK uncertainty handling,
durable pending state and full preservation readbacks. Unknown writes are never
retried using another batch or root.

## Finish the cycle

Consume the existing `supervision_gate.eventKey` for the real merged source.
Record each existing successor's disposition, exact owner, remaining trigger and
evidence in the existing controller/gate state. Preserve previous pending keys,
source timestamps, expected successors and uncertain provider history. Do not
open a second ledger or manufacture a worker checkpoint.

In the same central cycle, update the original/pair and all shared projections
from the verified merge. Return the repository's old landing hold only after
fresh normal landing/main checks and slot reconciliation. Recompute genuine
released-wait inventory from source events rather than leaving a merged PR in
the old count. This does not establish global free execution capacity.

Before dispatch, obtain a complete **role-relevant** census: read all current,
conditional-wait, unknown and unfinished rows for that role with real pagination;
follow own events, leases, receipts and runtime/ownership sources. Record query
scope, real cursor/end, observed IDs and unresolved rows. A repository-only list,
SQL failure, missing page or `PARTIAL` census cannot establish a free role slot.
Keep prepared backlog separate from currently claimable work. Do not silently
drop another repository or an unknown worker from the census. All existing
usage/provider, model, HOLD, ownership, worktree and single modifying PR gates
remain. Same-task correction and new inventory retain the applied WIP meanings.

For a verified eligible successor, reconcile the existing original/pair's native
handoff and the actual Operator/Guardrail queue in the same observation. Use the
existing worker service/timer and one real request receipt; do not create a new
worker or fake CLAIM. Observe the worker's own new event/version/session, phase,
input/head and event time after the request. A service start, configuration save,
REQUESTED row or unchanged historical RELEASE is not RECEIVED. The existing gate
remains pending until its own-receipt test is satisfied. Pair review waits for a
new frozen writer RELEASE and never rereviews the landed head.

Two idle receipts or an internal handoff older than one central cycle require an
actual action that cycle or a precise capability failure, owner and next action.
Do not repeatedly ask the user to refresh a consumed merge or supply a new
per-PR provider. Preserve late findings and previously spent review budgets.

Runtime acceptance requires both a real scheduled complete projection and actual
successor own intake on the existing Sori and NodeKit tasks. Until these exist,
report the exact unfinished stage; local tests or source merge alone do not
establish operational completion or product acceptance.
