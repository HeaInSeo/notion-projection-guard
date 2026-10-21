# NodeKit pointer incident: recovery and prevention

This is a candidate procedure, not a recovery or installation receipt. Execute
only after independent review, current-head Codex disposition and normal landing.

## Observed cause

`NODEKIT-CLI-UF-CLAIM-POINTER-20261021T0817Z` planned five central pointer edits.
The first page was written; the other four were never attempted. Notion exported
four backtick pairs as code tags and `KEEP_GATED` as `KEEP\_GATED`, changing the
new literal from 965 to 1010 characters. Both protected prefix/suffix hashes and
all properties were equal. Exact verification correctly halted at index zero.

The admission check previously recommended inline code to avoid autolinks and
did not reject underscore escaping. The optional plain observation style checked
marker identity but still allowed risky formatting after it. Neither path could
prove that its newly written literal would retain the planned exported bytes.

## Fixed behavior

- New broker literals reject any backtick or underscore before batch admission,
  preflight, prepare or authorization. Already exported old literals remain exact.
- Complete observations require explicit `plain-v1` and check the entire body
  literal and native observation reason, including text after the marker.
- Explicit links retain their prior admission rules. This closes the observed
  code/underscore transformations; it does not claim general Markdown round-trip
  stability. Unexpected body/property differences still halt exact verification.
- BORI has an exact O6 writer/pair native profile with the five existing shared
  body targets. The pure supervision gate also preserves BORI RELEASE/MERGED
  pending keys with the same task/input/time-bound own-receipt requirements.
  No BORI source body, worker authority or broker policy permission is added.

## Two separately pinned source trees

1. **Original-incident closure source:** full commit
   `fe9cb27bc2091dfd0bfc75132236fc07094a70e7`. Its adjacent broker is the currently
   installed broker, SHA256
   `4c639747b1d0b2ad53f0b66950230d34282fe228aa38a9fbf02453afb38561b7`.
   Extract this complete tree to a private staging directory. Do not overwrite
   its broker with the new prevention version. The helper requires the exact
   existing runtime broker/runner/policy pins and canonical state.
2. **Prevention source:** the separately reviewed new source commit in
   `deployment/runtime-nodekit-pointer-prevention.json`. Install only after the
   exact closure is read back. Runtime policy and canonical journal location are
   unchanged. Do not run the old incident helper from the new broker tree.

The normal merge should retain the reviewed closure commit. If a squash is used,
preserve/fetch that exact reviewed source before deleting its branch; a fresh
main checkout alone may not contain the unmerged precursor object.

## Explicit recovery sequence

Pause competing central writes using the existing owner procedure and preserve
the actual automation prompt/schedule. Verify no competing broker/owner, current
runtime hashes, original journal, snapshots and incident manifest before acting.
Never delete a lock or audit merely to make a command succeed.

In the private checkout of the exact closure tree, supply a JSON array of five
fresh, complete connector page results, in the order pinned by the helper:
Operator queue, Guardrail queue, hub, dashboard, Router.

```bash
node reconcile_nodekit_pointer_partial.cjs --check-only < fresh-five-pages.json
node reconcile_nodekit_pointer_partial.cjs --apply < fresh-five-pages.json
```

Re-read all five pages immediately before explicit apply. The first page must
still match its saved unexpected full body, properties and revision; the four
unattempted pages must remain valid unwritten literal plans. Drift rejects the
operation. The helper saves the complete original journal/fresh reads privately,
then marks only this exact batch `RECONCILED_PARTIAL` and clears its active barrier.
It retains the original plan, error, ticket and next=0. It does not write Notion,
create a successful ACK, advance a page or replay any remaining old instruction.
A crash after saving its audit remains blocked for explicit reconciliation.

Read back the resolution, active=null, unchanged original snapshot/actual bytes
and absence of a verified ACK. Then install the approved prevention tree using
the existing private backup/pin/readback procedure; do not mutate the journal.
Verify the new runtime and hosted entry hashes against the candidate manifest.

Adopt the new pinned `complete_projection.js` and broker together in the actual
supervisor caller. Build every new observation with explicit plain markers and
fresh native metadata. Validate dangerous payloads reject with zero writes and
an unchanged canonical state. Perform an approved plain canary and full exact
readback before a fresh complete BORI 5-body/2-native handoff observation. Only
that complete readback proves synchronization; closure alone does not.

## Validation

The Node 22/24 CI command includes exact incident closure, new prewrite rejection,
legacy recovery, preservation and all three repository manifest profiles:

```bash
node --test test_guard.cjs test_runtime.cjs test_revision.cjs supervision_gate_cases.cjs serialized_format_cases.cjs test_nodekit_pointer_partial.cjs
python3 -m unittest -v test_provenance.py
python3 verify_provenance.py
```

Synthetic cases contain no private page content. The actual incident pins are
compared with the preserved private manifest separately. Neither local tests nor
a candidate manifest implies deployment, worker intake or product acceptance.

Local verification on Node 24.19.0: 488/488 tests PASS; provenance unit
regressions 16/16 PASS; immutable history gate 35/35 pairs PASS. The 12 new
serialization-prevention cases fail against the pre-fix 7eb4ee6 broker/entry
(0 PASS, 12 FAIL) and pass with the new source. Node 22 and GitHub CI results
remain separate checks before landing.
