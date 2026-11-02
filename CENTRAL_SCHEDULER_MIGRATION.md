# Central scheduler migration execution

PR25 preserves the original Sori48 incident owner
automation:6a742f6443e8819184310cd28e6162cd. It admits the prospective
automation:6ae6e6e4c880819192e89cd430271bfa executor only through the
separately reviewed installed server dependency. Configuration acceptance,
an RPC migration flag, a staged source checkout, and bootstrap readiness
each confer no execution authority.

## Invocation and clock binding

Every new-central witness independently observes both scheduler tasks. The
old task must be disabled with a known terminal last run (or an explicitly
null last run); the new task must match the reviewed exact schedule,
timezone and prompt, remain enabled and in_progress, and retain the same
run ID, scheduled_for and started_at captured at invocation entry.

Pass the original capture's PROOF.json as schedulerEvidenceFile and its
exact digest as schedulerEvidenceSha256 in the normal V2 runner config.
The original capture directory is fixed beneath the existing Sori48 audit
directory. Caller-selectable artifact paths, expected hash overrides and
alternate raw/legacy runtime entry points are unsupported.

The installed collector reads CAPTURE, RAW, PROOF, TICK_START and
TICK_RESULT and the original decision file. It checks actual call-start
and completion times, exact raw and proof hashes, full run identity, an
actual successful scheduled decision with complete configured coverage,
and the original 120-second capture-to-tick limit. That limit belongs to
the original tick. Subsequent sources use their existing 30-second
freshness bound and cannot restamp the original observation or borrow a
later run. The live witness follows the completed tick.

The same installed verifier runs before every new-central broker mutation
and inside both initial and committed/restart closure paths before any
incident receipt is returned. The canonical lock, original prior-executor
absence checks, exact closure approval and source/late-result gates still
apply. No provider result is inferred from unchanged pages or task expiry.

## Normal installation receipt

After genuine independent review, managed current-head review, CI, normal
expected-head landing and main CI, the normal installer writes
PR25_IMMUTABLE_INSTALLATION_MANIFEST.json in the existing Sori48 audit
directory. Use NPG_IMMUTABLE_EXTENSION_MANIFEST_V1 with the same identity
and installation fields as PR24, now covering exactly 25 files: the
existing 15 normal files, 8 Sori48 providers, and 2 migration modules.
The directory must be 0555 and all installed files and this manifest 0444.
The installer retains every previous source installation.

The manifest also contains sourceGates, schema
NPG_PR25_NORMAL_SOURCE_GATES_V1:

- scope: exact repo HeaInSeo/notion-projection-guard, pr 25, head, base, tree.
- independent: PASS, matching head/base/tree, the reviewer's genuine eventId,
  sessionId, positive releaseVersion and confirmed bodyNativeParity.
- managed: CLEAN, matching head/base and the actual full requestId.
- sourceCI: matching source head and conclusion success.
- landing: expectedHead and actual mergedCommit.
- mainCI: matching merged commit and conclusion success.
- evidence: private raw audit file and SHA-256 entries for each of
  independent, managed, sourceCI, landing and mainCI.

These entries are recorded from the genuine normal gates, not fabricated
by the implementation author. The collector re-reads every raw evidence
file, verifies all 25 immutable source bytes against both installation
inputs and the manifest, checks reviewed/merged tree equality, and
rechecks all files after validation. A candidate cannot be installed merely
to review itself. Absence or inconsistency of any normal receipt rejects
execution; it does not change the gate or authorize fallback.

## Remaining operational acceptance

Passing isolated tests does not close the incident. After normal source
installation, a genuine central invocation must separately complete 2-C1
(exact superseded-UNKNOWN disposition with no Notion call), 2-C2 (eight body
projections), and 2-C3 (three native/role handoffs), with full protected
readback. Original next=3, three receipts, proposal bytes, dispatch owner,
request budgets and late-payload uncertainty remain preserved.
