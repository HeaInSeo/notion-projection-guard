# Saved-ACK verification for the Sori case

This is a source candidate, not permission to operate or evidence of recovery.
`case_ack_bridge.cjs` is restricted to the existing Sori ownership incident and
its one cb729 admission successor. It loads the installed cb729 Broker only
after checking seven exact installed hashes. Neither the bridge nor the new
caller is installed over those pinned runtime files. Original exception,
successor authorization, hooks, policy, plan and worker packet stay unchanged.

The original application remains `UNCONFIRMED`, classification C. This path
does not obtain missing Code Mode control-plane evidence, infer no send from an
equal page, or revoke an already exported request. It handles the **new
successor's saved successful ACK**, not the uncertain original transaction.

## Preconditions and execution

After exact-head review and the one prospective operating approval, an immutable
copy of this source may serve as the command of the evaluated reviewed `runner.js`:

```text
node /absolute/reviewed/source/case_ack_bridge.cjs --stdio --apply
```

Omit `--apply` for a read-only bridge. Production root, runtime, incident,
successor ID, plan and installed source hashes are constants with no CLI
override. A group-writable executable, changed installed control, different
owner generation, competing broker lock or another case is refused.

The original `run` path still delegates prepare/authorize/dispatch/send/ACK/verify
to the installed Broker. No request or error is rewritten by the bridge.
If a verification read/RPC fails **after a durable successful ACK**, close the
old executor and inspect the canonical phase. Require a recorded HALTED /
WRITE_PENDING failure and ACKNOWLEDGED dispatch; SEND_INTENT, unknown ACK,
partial/mismatched data or another error stays blocked.

Create a new caller with `caseAckBridge: true`, the bridge command and the existing
fresh central ownership callback. It must retain the existing 30-second source
freshness and 15-second send bounds; an in-progress competing central remains a
conflict. Any maintenance pause or changed automation prompt belongs in the
explicit operating approval, not this helper.

1. `reconcileAcknowledged(batchId, planHash, false)` fetches every earlier
   completed page and the pending full page and returns check-only evidence.
2. With the approved scope still valid, a new caller's
   `reconcileAcknowledged(batchId, planHash, true)` fetches fresh evidence again.
   The bridge binds original plan/index/ticket/snapshot, request hash,
   dispatch/send permit/executor, saved SUCCEEDED provider and prior verified
   fingerprints. Entire body must equal the planned output, properties must be
   unchanged and revision must be later than the preimage.
3. Apply saves a private full audit, then the verified receipt, then canonical
   progress with the full recovery-record digest. It makes zero native requests and creates no ACK. Original failure
   fields remain. The remaining batch stops at READY/VERIFIED_STOPPED, or becomes
   COMPLETED if this was the final page. Only verified application of this
   successor page is recorded; the original exception is not reclassified.
4. Preserve the returned restoration digest. If that reply was lost, close and
   use `case_recovery_status` through a new bridge to read the committed receipt.
   Status and continuation reconstruct the allowed progress from that pinned
   full record and any digest-linked continuation intents. Changed provider,
   ticket, request hash, original failure or record is refused rather than given
   a newly trusted journal hash. Saved full-page evidence is also checked after
   an interrupted commit, including raw/body/property/revision consistency.
   Committed continuation records and their digests stay required after later
   ordinary page progress; a missing or changed intent also blocks a later ACK recovery.
   Do not resend the missing mutation/recovery request as a polling technique.
5. `continueVerifiedCase(batchId, planHash, restoration)` is a separate deliberate
   invocation. It freshly checks all prior receipts/pages and remaining preflight
   pages, records an executor adoption under the canonical lock and only then
   enters the ordinary fresh prepare/authorize/dispatch/send/ACK/verify loop.
   Completed tickets are never reused. No grant is created by a matching page or
   the restoration receipt alone.

## Unprepared successor and staged full inputs

The second, separate path handles only this successor halted from READY at index
zero with no receipt/ticket, an empty UNSENT attempt list and the exact
`OWNERSHIP_FENCE` failure. It requires the three fixed complete preimages,
including properties and revision. Any prepared ticket or attempted export
rejects this path. The original uncertain incident is not its input.

Use a new runner **and a new prerequisite callback factory for each invocation**,
with `caseAckBridge: true` and `casePageStaging: true`. Bootstrap references are
bound to that runner's live broker PID/executor and cannot be shared with a later
runner. With the real private collector, even semantic check-only uses
`--stdio --apply` to hold the canonical process lock; its method's `apply: false`
keeps canonical files and native pages unchanged. Process-level read-only
(`--stdio` without `--apply`) does not hold the required collector lock.

- `resumeCaseUnprepared(batchId, planHash, false)` checks the exact halted state
  and all original preimages, without an adoption, ticket or native request.
- `resumeCaseUnprepared(batchId, planHash, true)` explicitly saves the unprepared
  adoption audit and **immediately continues normal gated page writes**. It may
  create tickets and send the planned remaining mutations. This caller differs
  from ACK reconciliation, whose apply remains zero-native and whose continuation
  is a separate call. Do not use the `true` method as a status/check-only call.

`ownedPage` transfers a single immutable operation to the current bridge before
fresh ownership observation. Single-use metadata consumption invokes the pinned
Broker's unchanged checks synchronously. A stage is no grant and cannot extend
an expired permit, survive restart, bypass a changed snapshot or authorize send
confirmation. Lost replies are inspected on the same journal before any explicit
recovery; no staging token, ticket or uncertain mutation is blindly replayed.

## Failure handling and actual completion

### Actual operating path with local live facts

The real operating collector can also run through an explicitly reviewed,
owned, hash-pinned private module supplied as `--live-provider PATH
--live-provider-sha256 SHA256`. These options select only the reviewed proof
provider; production roots, case, successor, plan and installed pins stay fixed.
The module is checked before import and on both sides of each awaited call.

Set `caseLiveOwnership: true` and supply `collectLiveOwnership` in addition to
the two case flags. The approved caller first establishes a full immutable
authority reference under this broker PID/executor. For every operation it
fetches and compares all three full current authority pages and observes the
paused central task's actual terminal run. Those observations travel as data,
not a grant. After receiving them, the pinned module collects current server
facts locally, retains the earliest native/central/server observation, and
immediately executes the ordinary Broker ownership check and operation. This
removes the grant's extra cloud return trip. All 30-second source and 15-second
send bounds remain. `case_live_send` invokes only the ordinary single-use send
confirmation for an already existing dispatch. The caller still performs its
final synchronous permit check before the actual native tool invocation.

The same locked module can call `case_live_admit` for only the existing completed
successor's normal `record_case_admission`. After observing the actual worker's
fresh own CLAIM, `case_stage_release` and `case_consume_live_release` delegate
only to normal `release_case_owner`; matching bodies or a module response cannot
replace the genuine-CLAIM/lease checks. These paths do not create worker proof.
Commands are serialized while live facts are pending. Closing the executor
prevents any later awaited proof from performing an operation. A stage is
consumed once even when proof collection fails, and no mutation is retried.

An audit/receipt/journal save failure leaves the old progress barrier and the
private files in place. An exact new-process reconciliation can finish the saved
audit after all evidence is rechecked. Changed evidence rejects. A failed
continuation save preserves its uncommitted intent; a new locked process may
explicitly adopt only the still-unprepared next index after all checks, with a new
intent. Never delete either audit to retry, edit the journal, reset state, clear
the original error, acknowledge an uncertain send or automatically roll back data.
If receipt write/fsync fails before rename, only an owned private temporary file
with the exact current ticket-index name and a UUIDv4 suffix may be retained as
an incomplete write. Its bytes must be an exact UTF-8 byte prefix of the verified
receipt already present in the immutable audit. No audit, different bytes or
another index rejects it. The original file stays in place; its size and digest
are linked to canonical recovery progress and checked again later. It never
becomes the verified receipt or independent proof of successful application.
This helper is not a recovery for every possible failure phase. A different
phase/error, prepared future ticket, changed source/data or uncertain send stops
at that exact point for a scoped decision; no fallback resend is available.

After complete protected-page verification, use the existing normal case admission
and launch gates. Observe the existing writer's real, fresh own CLAIM on the
original task, then `release_case_owner` and read back `exclusive=false` and its
saved intake observation. End the approved quiet window. Tests, PR merge,
helper completion and packet launch do not prove this actual intake.

The Operator sprint restart pilot and wiki cleanup follow current recovery.
They do not alter the original own proof or expand the helper's fixed case scope.
