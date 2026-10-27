# R1 current execution follow-through

PR13 was merged at `cca2220`, with the reviewed tree and main CI passing.
The first actual successor execution failed at `fence_prepare`: its real
prerequisite observation expired while the full Router page crossed MCP.
No provider call was issued. At that first interruption the same successor was
HALTED from READY at index zero, with no receipt, no ticket and an empty UNSENT
dispatch-attempt list. The later current boundary is recorded below under
“Actual PR14 landing and final prepared interruption”.
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

## Actual PR14 landing and final prepared interruption

The user explicitly approved the one-head Codex-completion exception for
3aaef6b, normally merged as4a713906cfcc84fc6db99e1c93dd9d199d40a452;
the reviewed tree matched and main CI40505166333 passed. Codex was still
uncompleted, not clean or cancelled. Production then made exactly two native
calls: Router and the Sori original both received successful ACKs and full
protected-page verification. At index2 the third page was prepared, then the
page-staging RPC failed with the MCP uninitialized-session error. No current
index dispatch/export or third native call occurred. The executor was closed.

The halted journal9abccbc5ba51f9602eddaeede4dfc50460e63716cde5f28a80b829003875abb7
pins the boundary. The bounded follow-up adopts only its final prepared ticket
after fresh prior receipts/pages, pending full preimage and exact ownership.
It retains all preceding errors, audits, successful dispatches and verifications;
audit-first adoption creates no ticket, ACK or page advancement. Normal final
authorization/send/verification follows only an explicit caller invocation.
Unexported authorization can be freshly reauthorized; current-index export
remains an uncertainty barrier. The earlier helper is not repurposed by editing
the production journal or replacing the installed runtime. New source review,
tests/actual transport acceptance and an exact operating decision are required;
the3aaef6b exception does not automatically extend to another head.

At source preparation this delta has not passed operational acceptance. The
central automation is paused under the current execution authorization. Existing
worker timers, source packet, HOLDs, independent review and landing gates remain.
