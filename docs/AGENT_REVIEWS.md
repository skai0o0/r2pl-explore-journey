# M3.5 independent agent review evidence

**Policy:** the Multi-Agent Review section of root `AGENTS.md` is active. Codex owns all edits, integration, measurements and final decisions. Both CLIs received bounded read-only requests; neither was permitted to migrate data or edit the repository. No V1 production Supabase connection was used.

## Antigravity — ADR-011, ownership and fanout

Installed CLI: `agy.exe`. The first headless `--mode plan --sandbox` attempt to inspect files produced no review because a requested `command` permission could not be prompted for; it exited with the CLI diagnostic `no output produced ... command permission ... auto-denied`. We did **not** use `--dangerously-skip-permissions`. A second `--mode plan --sandbox --print-timeout 120s` request supplied a self-contained design summary and explicitly forbade tools/files/commands; it returned a substantive critique with exit code 0. Scope limitation: this was a **design-summary review, not source inspection**.

Requested topics: approved full-chunk ADR-011 baseline versus log candidate, PostgreSQL transaction ownership, one-process sector queue, leased outbox, indexed school/chunk fanout, school-filtered revisioned snapshots, and the measured 1,000-client hotspot timeout. The returned review prioritized outbox/fanout amplification, possible relay ordering and lease behavior, sector queue blocking, full-chunk WAL pressure, and resync storms. It proposed direct postcommit local fanout, batching and a future ADR-011 revisit.

Codex disposition:

| Review finding | Evidence and decision |
|---|---|
| Outbox plus per-action hotspot fanout can lag committed ACKs | **Accepted as measured risk.** Two 1,000-client/250-actions/s hotspot trials ACKed all commands but failed 10-second convergence, with 738 and 68 pending outbox rows. Trial 2 recorded 11.64 s p95 commit-to-delta enqueue and 641,271 delivered recipients. Investigate relay and outbound throughput before capacity claims. |
| Lease timeout, out-of-order publication and duplicate delivery can cause gaps | **Future multirelay risk.** M3.5 has one process and one serialized relay drain. Repeated event IDs and stale revisions are ignored or snapshot-resynced. Multiworker publication needs ordered/fenced contract before use. No observed resync in successful load runs. |
| Quarantined event creates a permanent revision hole unless a tombstone is published | **Not applicable to current code.** Quarantine first forces fresh authoritative snapshots and resets each affected subscription generation/revision. Subsequent events can advance from that snapshot. Focused quarantine recovery test passes. |
| One sector queue serializes all 256 chunks | **Incorrect premise.** M1/M2 divide 16×16 chunks into 16 logical sectors of 4×4 chunks; only commands within one sector share that queue. Hotspot queue delay is measured, but it is not one global queue. |
| Full-chunk writes caused the failed hotspot convergence and mutation logs remove locks | **Not established.** M3.5 trial 2 had 0.75 ms p95 chunk-head lock and 18.4 ms p95 transaction while delta enqueue reached 11.64 s. The log candidate still serializes on chunk head. Keep ADR-011 revisitable and benchmark under representative sustained load; do not reverse the owner-approved baseline from this result. |
| Direct postcommit local fanout could remove polling delay | **Candidate only.** Any fast path must retain the durable outbox for a crash after commit before publish, deduplicate its later relay delivery, and preserve contiguous per-school revisions. No such change was introduced in M3.5. |
| Coalesce v1 deltas to reduce frames | **Declined without a versioned contract.** v1 requires one contiguous revision per frame. The v2 ordered-batch candidate remains on the isolated branch and has no production rollout approval. |
| Resync storms could affect the primary database | **Valid untested stress case.** Current snapshots are bounded by session rate limits and sector queues, but simultaneous reconnect/gap storms need an explicit later workload. The completed runs recorded zero resyncs, so storms did not explain their latency. |

## Xiaomi MiMo — transaction, retry/recovery and delta edges

Installed `mimo.ps1`; provider listing succeeded with the available Xiaomi credential. A `mimo run ... --pure` read-only source review completed. MiMo found the transactional idempotency and chunk-head lock path sound for the synthetic one-process scope and raised these edge cases:

| Review finding | Codex disposition |
|---|---|
| Poison outbox row could stall the relay indefinitely | **Fixed.** Migration 2 adds auditable `outbox_dead_letters`; invalid projection is quarantined only after subscriber snapshot recovery. Focused PostgreSQL test passes. |
| An exception in a postcommit hook could emit a false rejected ACK | **Fixed.** `CommittedResultInterrupted` causes the durable core to close that session; a restarted retry returns the saved result. Process-exit-before-ACK network test passes. |
| Snapshot assumed full-chunk materialization if campaign write strategy changed | **Fixed.** Migration 2 forbids strategy updates; adapter startup and transaction path require `full_chunk`. Mutation-log remains a separate M3 benchmark candidate. |
| Multi-instance relay could reorder publication | **Accepted future limitation.** M3.5 is explicitly single-process; no multiserver publication or fencing claim. |
| Lock-timeout/deadlock errors are generic internal rejects | **Accepted observability/UX limitation.** The committed-key retry path remains safe, but a later public command contract should classify transient errors without leaking internal data. |
| ACK revision should update the session viewport revision | **Declined.** ACK is private command outcome and independent of viewport delivery; advancing a subscription on ACK could skip a delta. Subscription snapshot and outbox-delivered deltas control the viewport revision. |
| Slow resync snapshot can occupy a sector queue | **Accepted capacity risk.** Current queue depth/wait and snapshot metrics make it visible; sustained reconnect/gap storms are not yet benchmarked. |
| Outbox mask zero could pass projection validation | **Fixed.** Decoder now requires the exact affected school bit, valid tile edge and bounded positive view revision. |

The review was advisory. Codex checked each point against code and PostgreSQL tests. No agent modified files, selected gameplay rules, approved protocol v2, or changed ADR-011.

A follow-up `mimo run --pure` request attached the finalized transaction, relay, durable-core and v1 protocol files for a second edge-case pass. It started but returned no findings after an extended wait, so Codex interrupted it. The completed review above is the MiMo evidence; the follow-up is **not** counted as a second successful review or as validation of the final patches.

## M3.6 read-only review requests, 2026-10-10

The root `AGENTS.md` Multi-Agent Review policy remained active. Codex requested independent review without granting either CLI edit, migration or production access. These attempts did **not** return substantive findings, so M3.6 has no successful new external review.

| CLI | Bounded request and invocation | Availability/result | Codex disposition |
|---|---|---|---|
| Antigravity | `agy --mode plan --sandbox --print-timeout 60s -p ...` received a self-contained ADR-011/sector/outbox/fanout summary, 1,000-client hotspot measurements, and an explicit no-tools/no-edits instruction. | `agy.exe` installed. CLI reported `You are not logged into Antigravity`, attempted interactive authentication, and could not reach its network endpoint. Interrupted; **no review returned**. | Retained Codex's measured bottleneck conclusion; no Antigravity claim is attributed to M3.6. Owner may authenticate the CLI for a later independent design pass. |
| Xiaomi MiMo | `mimo run --pure` with read-only attached `DurableRealtimeCore.ts`, `M35FixtureAuthority.ts`, `OutboxRelay.ts` and `m36-delivery.test.ts`; asked for ordering, replay, duplicate, crash and school-isolation edge cases. | Installed. Initial sandbox attempt could not write its own SQLite journal; the escalated run started (`build · mimo-v2.5`) but returned no findings after more than a minute and was interrupted. **No M3.6 source review returned**. | Prior M3.5 MiMo findings above remain historical evidence, not approval of the M3.6 telemetry edits. Codex integrated and ran the 26-test suite directly. |

No supporting agent modified shared files. The missing M3.6 reviewer feedback is an open review limitation, not a passed gate.
