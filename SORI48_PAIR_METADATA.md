# Exact Sori48 native metadata engine

`sori48_pair_metadata.cjs` uses the existing Broker lock, executor, canonical journal and atomic save. It has no Notion or process-start capability. It is a source component awaiting normal RPC/live-runner integration, immutable phase pinning, independent review and installation; adding it does not authorize production use.

The native rows are the existing **parent, child and pair**. The Sori index is a body-projection target, not one of the three worker rows with classification drift. Exact IDs, RELEASE events and heads are pinned in `ROWS`; worker proof, body content and other properties remain unchanged. The pair is last so its review request follows the other two metadata updates.

The trusted bootstrap must bind `inspectClosedUnknown` to the authenticated exact closure audit and `inspectBodyProjection` to the completed, verified eight-target canonical body transaction. Fresh same-run ownership and all three complete source pages are required. Callers cannot supply arbitrary metadata changes.

The transaction occupies canonical `active` through READY, SEND_INTENT, WRITE_PENDING and ACKED. The installed private RPC client's one-use dispatch/confirmation/send boundary must carry its native request. A durable actual ACK plus complete protected-content readback advances a row. After all three readbacks, the native transaction is COMPLETED and releases its own canonical transaction; the original UNKNOWN, late-observation duty and no-product/no-capacity semantics remain.

A restart may retire an intent only when the durable record contains no permit or provider result and the canonical lock and unchanged sources are verified. A persisted permit, including an expired one, blocks replay. Matching page content cannot replace a missing ACK. A saved actual ACK can finish readback under a new valid owner without another native call. Save failures reload actual disk state, including a rename that committed before its response was lost.

Before final source review, wire the native dispatch/confirm/ACK/verify operations into the pinned normal bridge and live runner, add the native-batch probe, and test the whole installed-command boundary. The body wrapper added at276a7831 also still needs a supported pair initializer: ordinary `normal_init` accepts LANDED IDs and requires the WIP reference, whereas its current wrapper supplies the corrected admission ID and eight body references. Do not count mocked-runner success as that integration.
