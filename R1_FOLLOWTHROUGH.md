# R1 current execution follow-through

PR13 was merged at `cca2220`, with the reviewed tree and main CI passing.
The first actual successor execution failed at `fence_prepare`: its real
prerequisite observation expired while the full Router page crossed MCP.
No provider call was issued. The same successor is HALTED from READY at index
zero, with no receipt, no ticket and an empty UNSENT dispatch-attempt list.
This is separate from the original uncertain ownership transaction, which
remains CLOSED_EXCEPTION_UNCONFIRMED and is not reclassified.

The bounded delta keeps installed runtime/control pins and the successor ID:

- Stage one immutable page-bearing operation in the current bridge process
  before collecting its fresh authority. The single-use metadata consumption
  synchronously invokes the unchanged Broker's normal owner/snapshot checks.
  Staging grants no authority, cannot extend a permit and disappears on restart.
- Explicit check-only/apply recovery of only this unprepared, never-exported
  successor requires the fixed complete original preimages, original plan and
  journal, fresh same-generation owner and canonical lock. Audit-first executor
  adoption preserves the old error/failure and makes no ticket, page advance,
  new batch or native request. Each subsequent page still passes ordinary gates.
- Every committed unprepared-adoption record remains digest-linked and required
  after later normal page progress. A lost adoption reply requires fresh explicit
  adoption of the still-unprepared state; a prepared ticket or any attempted
  export rejects this recovery.
- Private fact collection may overlap independent server facts with native full
  reads. Its authority time is the earliest actual observation; the 30-second
  source bound and 15-second send bound stay unchanged. No old observation is
  relabelled as current and no original control is overwritten.

The first staged full-size rehearsal still exceeded a short grant during its
cloud return trip. The actual operating path therefore supplies a separately
reviewed hash-pinned local proof provider: after fresh full native/central
observations arrive, it gathers server facts and invokes the unchanged Broker
check locally. Only the resulting operation reply crosses MCP. The explicit
same-case admission and genuine-CLAIM release also use that locked local fact
path; their original Broker acceptance conditions stay unchanged. Native Notion
mutations remain in the caller behind its final permit check. Closure fences
pending asynchronous proofs; CLI commands are serialized.

Acceptance requires source regressions, current-head independent delta review,
normal CI/Codex/expected-head landing, and an actual large-MCP rehearsal of this
order with zero production writes. Production then uses check-only followed by
explicit same-successor continuation, full protected-page readback, existing
admission, the rightful existing writer's own CLAIM and canonical owner release.
The sprint restart/wiki pilot remains the subsequent R1.3/R1.4 work, not a new
precondition for recovery. NodeKit PR149 and its spent replacement budget stay
outside this delta.

At source preparation this delta has not passed operational acceptance. The
central automation is paused under the current execution authorization. Existing
worker timers, source packet, HOLDs, independent review and landing gates remain.
