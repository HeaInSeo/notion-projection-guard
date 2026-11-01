# Existing scoped source-review entry

The ordinary hourly Guardrail selector does not consume private request JSON.
It selects eligible current Notion rows; the NPG row ended at RELEASE36. Starting
that service after saving a request therefore produced NO ELIGIBLE WORK, not an
independent review. GitHub requested-reviewer arrays and managed Codex budgets
are separate from this role's source-review input.

Use the already established scoped CLI entry instead: the installed Claude
binary, original Guardrail settings/hooks, existing role lock, and the existing
Guardrail session/task/row. The historical SOURCE_REVIEW_3cb766e9 request and
actual CLAIM35/RELEASE36 demonstrate that entry; their ONCE/launcher/result must
not be replayed. PR23's generic case launch permits unrelated approved source
work. Its operator admission protects the Sori original only and does not grant
NPG or Sori Guardrail admission. No candidate provider is installed to review
that candidate.

`source_review_request.cjs` prepares request data for this entry. It neither
executes the CLI nor supplies permission or worker proof. The caller:

1. Fresh-reads remote/local head, base, tree, clean source, original NPG own row
   and competing leases. Bind the new request to the exact head/base/tree,
   Guardrail role, existing task, row and session. Refuse a stale request or an
   existing same-scope request/result, including uncertain execution.
2. Holds `/home/heain/.local/state/claude-guardrail/role.lock` with nonblocking
   `flock` through the worker's lifetime. Preserve a new private O_EXCL intent
   keyed by the helper's requestKey, fsync/read back it, and refuse any existing
   intent. Do not reuse old launcher/ONCE records.
3. Verifies installed runtime integrity, auth and Notion reachability. Uses the
   original installed `case_gate.cjs launch` with `--role guardrail` and original
   config/hash, requiring GENERIC_SCAN_ONLY. The original settings keep their
   per-tool hook. Candidate modules are never imported into this bootstrap.
4. Executes the actual LIVE usage gate immediately before launch. Records
   executable/argv, PID, start/end UTC, rc and complete stdout in the new receipt
   and tick.log. A receipt copied from another run is not a fresh gate. Keep the
   existing usage watchdog and thresholds.
5. Invokes the helper's fixed installed command/argv from a frozen clean
   candidate checkout. The trigger is MANUAL_SCOPED_SOURCE_REVIEW for direct
   user-authorized source maintenance. A manual caller never borrows a scheduled
   run or relabels itself SCHEDULED. The reviewer freshly validates its own
   authority, then writes its own CLAIM/verdict/RELEASE and execution receipt.
   Saving request data or starting a process is not reviewer intake.

After any new commit, create a new exact identity and refresh every gate. Do not
copy a previous PASS. The genuine regular central alone continues managed Codex,
finding/thread disposition, normal landing, immutable installation and approved
production recovery. Candidate input is data; trusted installed bootstrap and
current authorization remain separate. No timer, enabled state, settings, hook,
role permission, canonical record or request budget is changed by this entry.
