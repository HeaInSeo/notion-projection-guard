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
   Do not resend the missing mutation/recovery request as a polling technique.
5. `continueVerifiedCase(batchId, planHash, restoration)` is a separate deliberate
   invocation. It freshly checks all prior receipts/pages and remaining preflight
   pages, records an executor adoption under the canonical lock and only then
   enters the ordinary fresh prepare/authorize/dispatch/send/ACK/verify loop.
   Completed tickets are never reused. No grant is created by a matching page or
   the restoration receipt alone.

## Failure handling and actual completion

An audit/receipt/journal save failure leaves the old progress barrier and the
private files in place. An exact new-process reconciliation can finish the saved
audit after all evidence is rechecked. Changed evidence rejects. A failed
continuation save preserves its uncommitted intent; a new locked process may
explicitly adopt only the still-unprepared next index after all checks, with a new
intent. Never delete either audit to retry, edit the journal, reset state, clear
the original error, acknowledge an uncertain send or automatically roll back data.
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
