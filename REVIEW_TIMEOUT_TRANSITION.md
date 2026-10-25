# Review timeout adapter: local candidate, not installed

This is an additive contract for execution-queues §3. It is **not** a projection
broker target. The broker's allowlist, canonical journal, policy.json, existing
runtime manifest, WIP/HOLD and supervision gate remain unchanged. No production
transport, scheduler, credentials or private prompt is included.

## Local interface and guarantees

`review_timeout_ledger.cjs` exports `ReviewLedger` and `budgetKey`. It requires
Linux `flock`, one local filesystem and one owned 0700 directory, separate from
all broker state. Files are owned regular 0600 files; symlinks/hardlinks are
rejected for ledger and lock. Every owner and operation must use this **same**
canonical directory. Multiple machines, NFS and multiple copies of the ledger
are unsupported. A directory copy, rollback or manual edit can invalidate the
budget; never use these as recovery. Same-UID hostile code is outside the trust
boundary. This is an application lock/fence, not a GitHub server fencing token.

- `initialize()` is explicit and one-time. A durable marker prevents automatic
  reinitialization after missing state. Interrupted initialization requires owner
  reconciliation, not deleting the marker. An existing state is never reset.
- `read()` reloads under the kernel lock. Mutations require the returned exact
  revision. `acquire(owner, leaseMs, revision)` issues a new random token and
  increasing fence only if the prior lease is absent/expired. `renew(token,
  leaseMs, revision)` requires a live lease. Lease duration is at most 5 minutes;
  expiration does not reset attempt budgets. Keep token/ledger private.
- `importOriginal(token, revision, snapshot)` imports an already observed original
  request and receipt once per repo/PR/head. It never sends the original request.
  Seed **all existing requests and findings** from original sources before
  adoption. This initial importer accepts one original, not an already retried
  chain; existing replacement/uncertain histories require a separately reviewed
  exact migration, and must remain blocked until then. Do not import only the
  last request and erase lineage. Repo name case and base changes cannot create
  a second budget for the same head. Repository renames need explicit migration.
- `dispatchReplacement(token, revision, key, {readCurrent, checkEligibility, send})`
  reloads state under flock, validates the token/revision, reads current exact
  scope and checks existing authority gates. `readCurrent(scope)` supplies fresh
  `{repo,pr,head,base}`. `checkEligibility({scope,owner,fence})` must enforce existing
  execution-queues permissions, WIP/HOLD and canonical barriers and return
  `{allowed:true, receipt, scopeKey, owner, fence}` for that exact input; missing,
  denied or mismatched proof blocks. The supplied adapter does not query those
  systems or manufacture their approval.
- Eligible replacement reserves the sole budget, UUID request ID, parent ID,
  owner fence, first timeout and UNKNOWN intent with write/fsync/rename/directory
  fsync/readback **before** send. Fresh head/base, lease and eligibility are checked
  again after reservation. A changed head/base or HOLD consumes the reservation
  conservatively and does not send. `send(attempt)` receives the complete immutable
  attempt, including exact scope and ID, and must return the actual request
  receipt string. It is called once. It must not contain internal retries or
  detached sends, and must bind the request to the exact head/base and expose its
  ID for later lookup. Merely commenting against an unverified current PR head
  is insufficient. GitHub atomic head-bound dispatch is not claimed by this code.
- The lock spans dispatch so two processes cannot reserve or send concurrently.
  The low-level in-process API requires **nonblocking callbacks** that return
  control to the event loop. Its timer bounds cooperative asynchronous waits
  (10 seconds by default, configurable 1–30000 milliseconds). A monotonic
  after-return check also refuses receipts returned after the deadline by a slow
  synchronous callback. Such receipts leave UNKNOWN, never ACKNOWLEDGED. This
  API alone cannot interrupt a synchronous infinite loop and is **NOT ACCEPTED
  as the operational dispatch entry point**.
- Operational dispatch must use `runIsolated` from `review_timeout_isolated.cjs`:
  a separate supervisor process owns the wall-time deadline and runs all provider
  module code in a worker process. The supervisor imports no provider callbacks.
  It SIGKILLs the local worker at the deadline, waits for the process close event
  and only then reports its confirmed local exit. The kernel releases the
  worker's lock. A blocked caller event loop cannot block the separate supervisor.
  This depends on a healthy supervisor/OS and interruptible local storage; it is
  not a guarantee against supervisor death, host failure or uninterruptible
  kernel I/O. Those require the existing service/host supervision and recovery.
- `runIsolated({directory, token, revision, key, transportModule, context,
  timeoutMs, ioTimeoutMs})` accepts an absolute, regular trusted provider module.
  `timeoutMs` (1–30000ms) bounds total worker lifetime, including module loading;
  `ioTimeoutMs` bounds each cooperative callback. The module exports
  `createTransport(context)` returning `readCurrent/checkEligibility/send` (and
  an optional synthetic clock for tests). It must not retry, spawn detached
  sends, share lock descriptors with children, or send after it has returned.
  The module is executable trusted configuration, not untrusted callback text.
  Use reviewed immutable module bytes and bind the real provider request to its
  exact scope/ID. No production provider implementation is included.
- The worker also receives the supervisor's monotonic deadline. Late callback
  returns cannot acknowledge even if the event-loop timer was delayed. A timed
  out supervisor response means **outcome unknown**, not successful provider
  cancellation. Reload the same ledger: a completed receipt may already have
  been durably recorded before worker termination, otherwise retain UNKNOWN.
  Never resend. Local adapter termination does not cancel a GitHub review.
  After receipt, the live fence is checked again before durable acknowledgement.
  Lease expiration after send retains UNKNOWN even if transport returned success.
- `recordResult(token, revision, key, result, findings)` atomically retains the
  complete result/finding pair. Late predecessor findings remain even after a
  replacement clean. `disposeFinding(...)` requires a responsible owner and
  evidence bound to the assessed current scope. Findings for older heads block
  a newer head's replacement until re-assessed. Results never grant merge PASS.
- `reconcileDelivery(token, revision, key, requestId, receipt)` records evidence
  that the exact uncertain request already exists; it does not send. If absence
  cannot be proven, keep UNKNOWN. Even confirmed non-send does not automatically
  restore the spent replacement budget. `read()` exposes audit decisions and
  original `nextOwner/next/nextTrigger`; no scheduler or notification is provided.
- Crash after intent, crash after actual send and failure to persist the receipt
  all leave the same conservative budget. There is no stale-lock unlink: the
  kernel lock is held by the parent open-file descriptor and released on close/process exit. Lock contention waits
  at most one second and then reports BUSY. Retry a read after BUSY; do not retry
  an external send. `afterIntent/afterSend` are fault-injection hooks used only
  by synthetic tests, not production integration configuration.

## Candidate pins and verification

`deployment/review-timeout-candidate.json` pins the new modules and tests using
SHA256 and explicitly declares `LOCAL_CANDIDATE_NOT_DEPLOYED`. It is not an
installation receipt. The existing source provenance/runtime manifest is
unchanged. Read the candidate manifest and verifier from the same independently
reviewed immutable commit; editing both hashes and code is not verification.

```
node --test review_timeout_policy_cases.cjs review_timeout_ledger_cases.cjs
node verify_review_timeout_candidate.cjs
```

The tests use temporary 0700 directories and synthetic receipts. Two real child
processes race for one head. Child processes exit immediately after durable
intent and after a fsynced synthetic delivery, then a fresh adapter reloads the
ledger and refuses resend. The independent-review 150ms synchronous callback
with a 10ms deadline now retains UNKNOWN. An infinite synchronous send is killed
by the separate watchdog; another OS process reloads the durable intent and
refuses resend. No GitHub/Notion requests are made by these tests.

## Safe adoption handoff — not performed

1. Parent/existing owner checks concurrent work, independent review and normal
   landing gates. Resolve a reviewed full commit and candidate hashes; publish
   and land only through the authorized single ACTIVE lane.
2. Existing execution-queues §3 owner must read and preserve the complete private
   central policy/prompt and current scheduling configuration, then attach this
   separate timeout contract. That read/preserve/update path has **not been
   established** in the parent context. This is a real adoption blocker; do not
   replace the prompt with this template or route policy writes through the
   public broker/Notion direct writes.
3. Stop/reconcile existing review dispatchers under that owner's authority before
   activating the sole new path. Inventory exact repo/PR/head/base/request IDs,
   existing replacement histories, unknown sends and findings. Select the one
   protected canonical timeout ledger location; initialize/import only when the
   complete history fits the reviewed migration contract. Keep the broker
   journal untouched. Never backfill invented receipts or worker ownership.
4. Review a real transport/observer/eligibility adapter separately and use the
   isolated supervisor entry point. The direct in-process API is not accepted
   for operational dispatch. Verify exact
   head binding, bounded calls without internal retries, request-ID lookup, live
   result ingestion and old-head finding reconciliation. There is no verified
   GitHub Codex cancel API; leave termination UNKNOWN. Managed-process cancellation
   is policy-only in this candidate; no CLI/CI conversion or gate equivalence is
   implemented.
5. Prepare a new reviewed installation record with full commit, file hashes,
   private state location/permissions, previous dispatcher shutdown evidence and
   preserved full prompt readback. Do not edit historical deployment receipts or
   claim installation from this candidate manifest. Test crash recovery and
   concurrent owners in the actual approved environment before enabling sends.
6. Verify actual scheduled-run receipts for adoption. If replacement times out,
   preserve explicit BLOCKED and owner/next/trigger. Continue independent work
   under existing gates. Rollback disables the new dispatcher and preserves the
   entire ledger/unknown intents/findings; never enable old and new dispatchers
   simultaneously or reset state to regain a retry.

Current authorization covers local code, synthetic tests and a local reviewable
commit only. Push, PR creation/merge, deployment, server commands, schedule changes
and real review requests remain unperformed and require the parent's next stage.
