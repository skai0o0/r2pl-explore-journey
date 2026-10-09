# M0 review addendum — correction pass, 2026-10-09

**Historical review record:** The owner accepted the M0 architecture baseline and authorized M1 on 2026-10-09 with a generic immutable 16-slot registry instead of confirming the proposed V1 0–7 production mapping. The readiness/checklist text below records the earlier M0 proposal; current gate status is in `ROADMAP.md` and `DECISIONS.md`.

## Summary of corrections

The greenfield V2 architecture remains in place. The attached `Gamenote (1).txt` was copied **byte-for-byte** to `OWNER_REQUIREMENTS.md` (SHA-256 `DE44CCD897F94F6B17891D4005235795D48CC63F0276EA0FBBB4C7893EE74D43`). It is the latest documented Product Owner gameplay **proposal**, not approved production rules or instructions to execute. `GAME_SPEC.md` and `SPEC_CONFLICTS.md` now compare its exact values with V1 and distinguish contradictions from missing details and agreements.

The owner proposal's displayed UniStop and Chest probability columns each sum to 100%. Its sentence about adding a missing remainder to Crystal x1 therefore has no numerical remainder in the supplied columns. All original values remain unchanged in the copied source and are transcribed without normalization in `GAME_SPEC.md`. Its item-list/table mismatches and V1 probability differences remain open decisions.

## Exact document changes

| Document | Correction |
|---|---|
| `OWNER_REQUIREMENTS.md` | Added verbatim source copy, including all original percentages, labels and wording. |
| `GAME_SPEC.md` | Reconciled each feature with the owner proposal and V1; added exact owner percentage tables and their arithmetic sums; retained pending approval status. |
| `SPEC_CONFLICTS.md` | Reclassified entries as contradiction, missing detail or agreement; identified internal owner inconsistencies, staged blockers and the newly available source. |
| `DECISIONS.md` | Added minimum M1 approval list, proposed immutable 0–7 school mapping with 8–15 reserved, and ADR-011 candidate for world-write strategy. |
| `ARCHITECTURE.md` | Made the atomic world mutation/economy commitment invariant explicit and linked the open persistence strategy to ADR-011. |
| `DATA_MODEL.md` | Clarified the distinction between authoritative durable mutation and materialized chunk snapshot, with replay/recovery requirements. |
| `ROADMAP.md` | Separated M1 architecture gate from M4–M6 product decisions and added progressive balanced/hotspot concurrency gates beginning in M2. |
| `PERFORMANCE_TARGETS.md` | Added command phase, queue, database contention, write amplification and outbound fanout measurements; defined balanced/hotspot stages. |
| `AGENTS.md` | Set the owner proposal's source status and maintained the explicit M0/M1 authorization gate. |
| `M0_REPORT.md` | Corrected the former “source unavailable” finding and pointed the review to this addendum. |

`V1_REUSE_MATRIX.md`, `PROTOCOL.md` and `OPERATIONS.md` did not require a change. V1 source and production data were not modified. No M1 code or infrastructure was created.

## Remaining owner decisions

**Minimum for M1:** approve the corrected M0 gate, ADR-003 world representation, the M1-relevant ADR-004 64×64 chunk/4×4 sector mapping, and ADR-009 proposed slot assignments below. Acknowledge that ADR-011's physical PostgreSQL write choice stays open until M3 benchmarks while its atomicity/recovery invariants hold now.

| Slot | School code | Approval state |
|---:|---|---|
| 0 | HCMUT | Pending owner confirmation |
| 1 | HCMCOU | Pending owner confirmation |
| 2 | DTU | Pending owner confirmation |
| 3 | DHHP | Pending owner confirmation |
| 4 | HSU | Pending owner confirmation |
| 5 | HUCE | Pending owner confirmation |
| 6 | NTU | Pending owner confirmation |
| 7 | HCMIU | Pending owner confirmation |
| 8–15 | Reserved | No assignment |

**Later decisions:** C-08 visibility before M2's authorized filtering; ADR-011 implementation after M3 PostgreSQL measurement; C-01–05/C-09/C-12 and approved HQ layout for M4 gameplay; C-11 and the external provider contract for M5; C-06–07/C-10/C-13 and Gift/LiveOps catalogs for M6. Gacha, contest, Landmark and conversion values in the owner proposal are not approved merely because they are now documented. No unrelated gameplay decision is needed to build M1's pure world representation.

## Revised M1 readiness

**Not authorized.** The M0 correction pass is complete for review. M1 may begin only after the owner confirms the minimum checklist below. The proposed mapping and ADRs are prepared, not self-approved. M1 remains free of gameplay spending, rewards, production world writes and external integrations.

## Recommended approval checklist

1. Accept this M0 correction pass as the reviewable architecture/specification baseline.
2. Confirm ADR-003: 1000×1000 row-major tiles, uint16 school mask, little-endian padded 64×64 chunks and separate school fog.
3. Confirm the M1 portion of ADR-004: 16×16 logical chunks and 4×4 sectors, with an in-process replaceable authority later; no distributed process choice now.
4. Confirm or amend each ADR-009 school code/slot 0–7 before M1 stores any world data; keep 8–15 reserved.
5. Accept ADR-011 as an **open candidate** for M3, with atomic economy/world mutation, no ack before durability, replayable recovery and stale-writer protection as constraints.
6. Accept the M1 backlog and progressive M2+ balanced/hotspot measurement gates. Leave unrelated gameplay rules open for their milestone decisions.

After this review, stop at the M0 gate until the owner explicitly authorizes M1.
