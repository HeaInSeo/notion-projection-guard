# Local review-timeout candidate verification

Baseline: `ac95acf6b64bb68a62b785f0e1a1b72129f9d62c` (remote main read back on
2026-10-25). GitHub open PR query returned no open PRs. Existing remote branches
were preserved. Issue #8 transport-factory verification is outside this change.
Workspace AGENTS.md and OPERATIONS.md were read; `/workspace/.agents` was empty
and this repository had no `.agents/skills` directory.

Local environment: Linux, Node v24.19.0, Python 3.12.14, system `flock`.

```
node --test test_guard.cjs test_runtime.cjs test_revision.cjs supervision_gate_cases.cjs serialized_format_cases.cjs test_nodekit_pointer_partial.cjs review_timeout_policy_cases.cjs review_timeout_ledger_cases.cjs
# 688 passed, 0 failed, 0 skipped
python3 -m unittest -v test_provenance.py
# 17 passed
python3 verify_provenance.py
# 35 preserved history pairs and 15 migration blobs verified; existing pins unchanged
node verify_review_timeout_candidate.cjs
# LOCAL_CANDIDATE_MATCH, files:5, deployed:false, adopted:false
git diff --check
# no errors
```

The new tests comprise 39 pure policy cases and 17 ledger/candidate cases.
Integration evidence includes two independent Node processes with delayed fresh
reads racing on the same head; only one durable reservation and synthetic
delivery exists after reload. Separate child processes exit with code 81 after
intent and code 82 after fsynced synthetic send. Fresh adapters reload the same
UNKNOWN request ID and refuse resend in both cases. Other cases cover lease
renewal/expiry/stale fencing/CAS, expired owner after send, hung transport,
head/base drift on both sides of intent, retained late findings after replacement
clean, old-head finding reassessment, exhausted retry budget, WIP/HOLD eligibility
before/after intent, case-insensitive head budgets, corruption/missing state,
clock rollback, private modes and candidate hash/symlink rejection.

CI configuration now includes the new cases and candidate pin verification in
its existing Node 22/24 matrix. Only Node 24 was executed locally; remote CI has
not run. No independent review or production validation is claimed here.

No broker, runner, supervision_gate, policy.json, installed-runtime descriptor
or existing provenance pin was changed. No private operational source, token,
real receipt, journal or full central prompt was copied into the repository.
The new manifest is explicitly a nonproduction local candidate, not an installed
release. No push, PR creation/merge, remote server access, deployment, schedule
change, real Codex request or cancel operation was performed.

Actual policy/prompt adoption remains blocked on the existing execution-queues
§3 owner's authorized read/preserve/update path, which has not been established.
A real bounded, head-bound observer/eligibility/transport adapter and complete
existing request-history migration must be reviewed before adoption. The exact
scope and safe transition requirements are in REVIEW_TIMEOUT_TRANSITION.md.
