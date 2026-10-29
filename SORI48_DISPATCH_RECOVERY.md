# Sori PR48 dispatch incident and recovery boundary

## Observed source and halted operation

Sori PR48 is OPEN at `b26246e4ab3870bf6f7516b08906791570b57163` over
`2fa7f5e12fa4474b194acf0d6e1a0273666642c1`. The F1 correction has genuine
parent frozen RELEASE93 (`EVT-SORI-W02-1B-I-PR48-F1-RELEASE-20261029T031819Z`)
and child frozen RELEASE4 (`EVT-SORI-W02-1B-I-PR48-F1-CHILD-RELEASE-20261029T031657Z`).
The four head workflow runs succeeded. The existing pair still has NOT ACCEPTED
RELEASE54 on the prior head `cf4485d9f7823775760a03813d92ab205126f6c6`.
Those source facts do not grant a fresh review verdict or permission to replay.

The active canonical batch `SORI48-PAIR-ADMIT-20261029` is the FIRST admission
of that older head, not the corrected-head admission. It has three historical
ACK/full verification receipts and is HALTED at index3 of8, from WRITE_PENDING,
with `SEND_PERMIT_EXPIRED_OR_FENCED` and an unacknowledged SEND_INTENT:

- plan `30df155ce2847b9700dd3f992372070743cabb5058c4e29c76e64586db83d54b`
- ticket `cae1d7ac-ce48-417d-ad58-5180f0315d7d`
- snapshot `83e130c52368f166ded98a8942fa8b8a5e24af42b8639656f06bb47d3dee7d85`
- dispatch `cdbeae84-e053-4cbc-bdfe-d9dea48e3dc5`
- executor `a9edb89e-cdc7-4aef-9058-357381599110`
- original central run `f91b72c5-e47c-8324-aac0-6be9bfebb214`

The observed journal after its03:36Z UNKNOWN observation has SHA256
`0699a8ae84284cf96632fa47cd4fa4f10d51f32c5136b9229a2ae22bbf729c4f`.
It is an observation, never a permanent recovery grant.

## Recovered original transport evidence

The original Additional MCP local history contains the core broker start at
02:29:26Z with PID2680832 and NPG/1 replies. It correlates that executor and
exact dispatch to `projection-2680832-50` (fence_confirm_send), followed by
`projection-2680832-51` (fence_halt) and `projection-2680832-52` (close).
The durable permit expired at02:40:19.532Z; the HALT was recorded at02:40:27.720Z.
This establishes that the old core path was used, rather than the reviewed
NPG/2 client/bridge with its private one-use no-call token. It is evidence of a
wiring/adoption defect; the stale direct-broker instruction in the saved central
prompt and obsolete runner.js wiring in the adoption document explain how that
path remained selectable.

This history logs Additional MCP calls only, omits oversized outputs and does
not contain a complete outer JavaScript execution trace or Notion connector
call ledger. A closed broker, provider:null, an expired permit, the unchanged
page or absence of a Notion task ID cannot turn UNKNOWN into a no-send proof.
No such negative claim is made here.

## Prevention and current recovery ownership

Current ordinary transactions must use `normal_rpc_client.js` and the reviewed
`normal_live_command.js`/bridge. The live runner now refuses an incomplete
client BEFORE broker initialization or any durable intent, and has no legacy
native-call fallback. The adopting entry already had a client check; direct
control callers must meet the same boundary. Regressions use the real RPC client
for delayed permits and lost native responses. The private branded no-call
recovery and its bounded renewal budget are unchanged.

A missing reviewed phase/admission provider is `RECOVERY_CAPABILITY_REQUIRED`,
owned by central/NPG source maintenance. Do not synthesize an owner proof, start
a raw core broker, paste an inline client or borrow an older case helper to fill
that gap. The current incident needs an actual recovery engineering action and
receipt; merely reporting the next6h/12h bucket is not that action.

This patch grants NO Sori48 recovery, retry, ACK, ticket revocation, journal
closure, page advance, new batch, service start, review verdict or product
acceptance. The UNKNOWN attempt, exact journal, three ACKs and all worker proofs
remain untouched. An attributable original terminal result or independently
verified original no-call evidence must enter a reviewed matching reconciliation.
If that proof is unavailable, a separately authenticated, incident-specific
reviewed exception proposal is required before continuing with UNKNOWN preserved.
The PR22 startup-control approval has a different batch and ticket and does not
approve this incident. Neither a local test nor this source landing removes the
existing HALT.
