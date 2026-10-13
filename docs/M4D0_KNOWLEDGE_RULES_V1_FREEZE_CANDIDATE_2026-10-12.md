# Knowledge Rules v1 — Canonical Freeze Candidate (M4-D0)

> **2026-10-13 scope update:** Owner now authorizes feasible development and blocked-integration preparation, prioritizing Gamenote V2 for conflicting product ideas. [Preparation increment](INTEGRATION_PREPARATION_REPORT_2026-10-13.md) delivers contracts, synthetic running transactions and reward references. The historical no-implementation wording below applies to the earlier Knowledge stage; it does not prohibit this authorized infrastructure work. No Knowledge state machine, production ruleVersion or live mutation has been activated.

Date: 2026-10-12
Status: OWNER-DIRECTED CANDIDATE + TECH-LEAD CHOICES. Not an approved immutable production ruleVersion. Does not authorize M4-D1, migrations, timers, or production mutation.
Authority: explicit 2026-10-12 owner answers culminating in docs/M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md. The owner explicitly rejects a 6-hour grace period and a non-resetting two-hour fade. Earlier Rev2, 24H contest, D01-D34, SC01-SC70, Gamenote and pure candidate code are historical only where they contradict this document.

## A. Economic invariants and geometry

A1. New Knowledge: 1 Point per newly discovered tile, owner balance baseline. Another school's already-owned tile: 2 Points per tile for first authorized guest membership, owner balance baseline. Signed price ruleVersion and no-change response required before production.
A2. Shared membership: at most TWO participating universities within one Contest, maximum 16 stable school slots in registry; reject a third school's attempt to enter that Contest without debiting.
A3. Shared cluster is a connected component using FOUR orthogonal tile sides; diagonal corners do not connect. Group by exact unordered school pair (A+B); B+C does not merge A+B for billing. One-tile bridge can merge components; splitting one bridge can split them.
A4. First 24 hours after lawful shared activation: no maintenance charge. Subsequent periods: 1 Point per SCHOOL per connected shared cluster per paid 24-hour cycle, regardless of cluster size (current owner example/balance baseline). Merge/split billing geometry changes at NEXT boundary, not retroactively. No general ambient decay outside active Shared Knowledge.
A5. Upkeep is not a historic per-tile 1 Point each day; never wire old 24H terminal defender/transfer candidate rules.
A6. Authorized student wallet is the only Points debit source for a student's contribution. Server validates verified school membership. Wallet operations must not be inferred from emailed domains, client schoolSlot, fixture-credit or unsynced km.

## B. Ownership and lifecycle

B1. Every tile has current legal Knowledge holder(s), remembered/discovered geography per school, and optional immutable incumbent snapshot for current Contest. Incumbent is lawful holder immediately before the NEW contest opens, NOT the historical first explorer. Example: A first discovered T, B lawfully inherited T, C contests; incumbent is B.
B2. During SHARED, both schools have active Knowledge for score and visibility, each owing only its separate school/cluster upkeep when due. Shared membership survives beyond 24h while maintained.
B3. When one side stops legally maintaining at the committed upkeep boundary, resolve one departure transaction in server/DB order; do not add 6h grace. Active two-school Contest ends as SHARED and is replaced by the applicable terminal or successor-claim state.
B4. If the departing school was GUEST and the lawful INCUMBENT still holds valid Knowledge, incumbent automatically retains its OWN tiles at 0 extra Points, no confirmation click, no two-hour rolling fade, no 48-hour hard window. Sole-owned tiles have no further shared-cluster upkeep.
B5. If departing school was INCUMBENT and GUEST remains, create one immutable succession case at t0 with frozen incumbent per-tile snapshots, claimant school, eligible tile set and requiredN. Only non-incumbent inherited tiles need consolidation payment. In mixed-origin cluster, never charge for claimant tiles where it was already incumbent.
B6. Cost for one consolidation case: exact CEIL(N/2) Points; odd N always rounds UP. Examples N=0=>0, N=1=>1, N=7=>4, N=20=>10, N=21=>11. N and component/tile snapshot freeze at t0; no fee-changing scan midclaim. N=0 has no payable case and valid incumbent-owned tiles remain.
B7. Immediately on t0, atomically persist rollingDecayDeadline=t0+2 hours AND immutableHardDeadline=t0+48 hours. NO extra grace; NO timer anchored to full forgetting; NO extension of hard deadline.
B8. While CLAIMING, an eligible contribution of at least 1 Point, accepted in durable DB order STRICTLY BEFORE BOTH active deadlines, resets only rollingDecayDeadline=min(acceptedAt+2 hours,immutableHardDeadline). It contributes to sum accepted toward CEIL(N/2). Repeated valid contributions may roll two-hour deadline, but never beyond hard 48h.
B9. If accepted contributions meet required Points strictly before deadline, immediately SUCCESS: consolidate inherited tiles as claimant's sole legal Knowledge; consume the accepted escrow one time; publish state and score once; terminate rolling timer.
B10. If rolling deadline expires before paid total meets required cost, FAILURE immediately: unowned inherited tiles become neutral and ALL accepted contributors are owed individual exact refunds. Do not wait for 48h if rolling timer has already expired. If 48h hard deadline arrives with insufficient funds, immediate FAILURE regardless of a recently reset rolling timer. No later revival by payments.
B11. At exact deadline equality, cutoff wins: reject contribution without wallet debit. Use server-authoritative durable timestamps and serializable ordering; job wakeup time does not create a grace window. Recompute deadlines from persisted t0 and accepted contributions after crash; never trust browser clock.
B12. Owner excludes a two-schools-forgot-simultaneously gameplay branch for v1. Process first authoritative committed withdrawal/departure; a genuine unresolved same-instant concurrency conflict fails closed to audited operator-review state (no arbitrary ownership or double debit) until a formal policy exists. This is an engineering integrity fallback, not third-school competition.
B13. A single abandoned incumbent-owned tile may remain legally owned while a neighboring former guest subset becomes neutral. Always settle mixed-ownership partial outcomes PER TILE; never destroy incumbent-owned Knowledge as a side effect of unpaid claim.
B14. Do not identify 48h as "48 hours after quên hoàn toàn"; both timers begin at one successor event t0. The two-hour deadline can reset, so there is no guaranteed full forgetting at t0+2h after a valid contribution.

## C. Wallet and settlement — delegated technical decisions

C1. Case record: campaign, immutable rule snapshot/version, connected component and eligible tile snapshot hash, contestId, incumbent per-tile holder, receiver school, t0, requiredPoints, receivedPoints, rollingDeadline, hardDeadline, state, revision.
C2. Each accepted contribution transaction: unique contributionId/idempotency key, caseId, verified actorId, original payer walletId, amount (integer >=1), accepted server timestamp and immutable ledger debit. ONE row per transaction, NOT one row per Point. No hidden second spendable escrow wallet.
C3. Lock case and wallet in consistent order in a PostgreSQL transaction; cap accepted amount at remaining fee and return the actual accepted amount to the client. Reject empty/no-change, expired, retry-with-different-payload, outsider and insufficient-wallet without side effects.
C4. On SUCCESS, atomically settle case, ownership and money exactly once. On FAILURE, atomically record neutral/score projection and refund OBLIGATIONS exactly once; refund credits can subsequently be processed in bounded, retry-safe batches. A refund is not "completed" until wallet credit commits. Refund to ORIGINAL contributing account/wallet, never to previous incumbent or the school's pooled treasury.
C5. Conservation for failed case: accepted escrow = completed actual wallet refunds + outstanding durable refund liabilities. Idempotency uniqueness per contribution + refund prevents duplicate credits or debits through reconnect, retry, workers or outages.
C6. Preserve audit, avoid per-tile/per-Point monetary records and use compact component snapshots and event-driven jobs; use chunk/sector authoritative transactions, filtered outbox and consistency tests. Profile hotspots and table growth before operational launch. No production SQL is yet authorized.

## D. C-08 projection and C-12 scoring

D1. School members can see their own discovered/remembered fog geography and legally active Knowledge. Remembering an abandoned region is NOT present ownership. Public and rival students NEVER receive raw rival school bitmasks, stored fog history, private Point/Crystal wallets or individual contributor identities.
D2. Safe public view: published terrain, approved HQ/Landmark geometry, active Beacon school, threshold and aggregate published scoreboard. Authenticated members: own fog, owned/Shared tiles, own Contest status/deadlines and aggregate CLAIMING target/current/remaining; each contributor sees only their personal payment and refund receipts. Counterpart sees only Contest/contact-zone shared facts it legitimately participates in; no rival wallet, donor ledger, private upkeep debt or hidden Chest coordinates.
D3. Chest discovery/treasure map is PER VERIFIED ACTOR, not universally visible to their school. Spectator gets only published delayed/aggregated view. Audit admin access segregated by role (editor vs finance). Validate on all snapshots, deltas, errors, reconnect, logs and replay.
D4. An ACTIVE owned Knowledge tile yields +1 school Knowledge to EACH legally active member. One physical Shared tile yields +1 to A and +1 to B; school sum can exceed unique world tiles. Forgotten/neutral Knowledge yields 0. PROVISIONAL claimant pending consolidation yields 0 Knowledge until SUCCESS, as a tech-lead anti-gaming rule; after SUCCESS increase by settled eligible tile count. Historical fog history alone scores 0.
D5. Leaderboard default: descending current active Knowledge count; ties earlier server timestamp reaching this score, then immutable school slot ascending. Event bonuses/buffs and ranking adjustment cadence are future separate ruleVersion decisions, not smuggled into Knowledge score.

## E. Versioning, scope and owner signoff

E1. This is one canonical candidate to read BEFORE older drafts; add a visible superseded pointer to conflicting old specs. Preserve their history and acceptance examples without treating them as production cases.
E2. Signed production record later needs immutable ruleVersion, owner approver, effective campaign/time, formal parameter table and migration/rollback plan. Do not silently select old numeric dev fixtures or create production commands. C-01/C-03/C-08/C-12 Knowledge-only development may be approved separately from M5 running API, M6 reward, final 8-HQ world design.
E3. Cross-system details are documented in docs/M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md: 8-school roster and HQ30x30/UniStop10x2/Chest2x2/Landmark40x40, world design later, Landmark 1000 Crystals + linear 5% of BASE (1000,1050,1100,1150), separate school pots, per-student positive current-week running sync for UniStop, finite private Chest + key + editor. Those do not become deployed by Knowledge freeze.
E4. Explicit later owner/release gates remain: validated identity/running contract; real world placement/editor publish; BTC stock/Gift/buffs; M3.6 measured hotspot launch gate; M4-C visual/browser/GPU QA. Production is OFF.

## F. Canonical acceptance gates K01–K24

| Case | Acceptance |
|---|---|
| K01 | Repeat already-known tile => no extra entry debit or revision. |
| K02 | Enter guest on fresh already-known tile => one 2-Point debit, separate from incumbent's history. |
| K03 | One five-tile 4-neighbor shared component => upkeep 1 Point for EACH school/cycle, not five. |
| K04 | Diagonal-only clusters remain separate; pair A+B does not merge B+C. |
| K05 | Merge/split component midcycle => only NEXT cycle bill changes, no prior prorating. |
| K06 | 24h free shared-upkeep expires; first paid due at boundary, no 6h grace. |
| K07 | Guest lapses; valid incumbent stays => free automatic sole ownership; no claim timer. |
| K08 | Incumbent lapses; guest still valid => rolling 2h and hard 48h created together at server t0. |
| K09 | N=7 => ceil(7/2)=4; N=21=>11; mixed incumbent tiles excluded from N. |
| K10 | Valid 1-Point deposit at t0+1h => rolling deadline t0+3h; hard remains t0+48h. |
| K11 | Second deposit while rolling open => deadline resets from THAT accepted time; no 48h reset. |
| K12 | At exact rolling deadline payment rejected, 0 debit; failure settlement wins. |
| K13 | At exact hard 48h deadline payment rejected, 0 debit; failure settlement wins. |
| K14 | If rolling deadline expires at hour 6 with hard deadline still at hour48 => fail at hour6, not hour48. |
| K15 | Success as soon as deposited total reaches ceil(N/2), terminate timers; transfer one time. |
| K16 | Request overfills case => accept no more than exact remaining amount; ACK actual charge. |
| K17 | Two students race last Point => only total required charged, one success, no extra. |
| K18 | P1=3, P2=2 in failed case => P1 refunded3 and P2 refunded2, each exactly once. |
| K19 | Partial refund worker crash => persist outstanding remaining liabilities; retry without duplicates. |
| K20 | Replay after ACK loss or restart => same result, no second debit/settlement. |
| K21 | A original explorer, B lawful owner, C new guest => incumbent B. |
| K22 | Shared A+B single tile => each school gets +1; claimant provisional => no inherited score until success. |
| K23 | Lost Knowledge's remembered geography stays private, no active ownership/score; spectator cannot retrieve masks. |
| K24 | Third school attempts to join two-party active relation => server denies/no debit. |

Test fixtures below should be implemented only AFTER a separate M4-D1 authorization; historical smoke tests should be retained as explicitly obsolete tests, not edited to silently pass against the new semantics.
