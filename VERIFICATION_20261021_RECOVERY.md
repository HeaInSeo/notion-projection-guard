# Native-read recovery: cause and validation

The preserved incident records establish two distinct failures: a post-update
revision read in CLAIM40, and a later native fetch before the first prepare in
the successor synchronization. The latter retained READY as its durable phase,
next=0, no receipt and no body writes. The saved generic error omitted the native
provider response, so a network, service or permission cause cannot be inferred
from that record. Current successful reads do not prove the historical cause.

The operational blockage was prolonged because the installed recovery handled
neither the original post-write revision-read case nor the later pre-prepare
native-read case. PR4 reconciled the former; PR5 adds explicitly checked READY
and PREPARED recovery to the same immutable plan. Source changes and CI alone
do not install it or complete the live synchronization.

The final PR5 review also found that matching absent/invalid timestamps in a
legacy arrow audit and verification receipt were accepted. Both recovery phases
now require a canonical valid UTC timestamp. Ten red-first cases cover absent,
null, empty, malformed and calendar-invalid values in both phases and verify
that rejected evidence and the journal remain byte-identical.

The runner now retries only failed read-only connector calls, at most three
attempts. Successful but incomplete, wrong or mismatched pages still face the
ordinary broker checks. Page/phase/attempt/provider cause survives a final read
failure. Four end-to-end tests inject two failures at preflight, prepare,
authorize and post-write verify and establish exactly one mutation each. Lost
ACK, async failure and full protected-content mismatch remain blocked. Explicit
unprepared recovery restores READY with zero writes/ACKs/page advances, then
uses the ordinary original plan. No automatic HALTED reset is added.

Validation before publication: Node 24 full suite 442/442; provenance unit tests
16/16. The exact-head GitHub checks and review, installation receipt, canonical
batch completion and complete body/native readback remain separate evidence.
