# M4-A — playable local vertical slice

**Status, 2026-10-10:** ready for owner play review. M5 and full M4 gameplay remain unauthorized. Start with [`README_PLAY.md`](../README_PLAY.md).

## What can be played

- A browser page renders the complete 1,000 × 1,000 terrain with a Three.js camera, drag navigation, wheel/button zoom, a gaming HUD, two public synthetic Headquarters and a public Landmark visual placeholder.
- Four fixed local test explorers belong to two synthetic universities. Each starts with 30 `fixture-credit`; an explicitly synthetic rule-version-0 exploration costs one credit only for a newly explored tile. The UI shows pending, committed, no-change and failure feedback. It labels all fixture mechanics and identities.
- Clicking/tapping a tile sends the existing protocol-v1 EXPLORE command to the Colyseus gateway. The server validates and routes it through the sector queue and PostgreSQL transaction. A successful ACK follows commit. The same transaction records the wallet debit, world mask/fog, idempotency result and outbox event. The outbox relays school-filtered deltas; snapshots/resync restore client knowledge on reload or reconnect.
- Visible school knowledge comes only from the authorized `ProjectionReplica`. The public fixture terrain, HQ markers and Landmark do not encode hidden knowledge. Each tab keeps its own synthetic player selection.

## Verification

Tested on Windows with Node 24.19.0, PostgreSQL 16.15 on loopback, a separate disposable `r2pl_play` database, and two in-app browser tabs. A Dawn Explorer 1 click committed tile `(222,242)` and reduced its balance to 28 after two total new tiles. A simultaneous Dawn Explorer 2 session returned **already explored, no credit spent** at that tile. Reload retained Dawn Explorer 2's balance and tile knowledge. For a separate live-delivery check, Dawn Explorer 1 committed `(204,244)` while Dawn Explorer 2's page stayed open; only the expected 18 × 18 pixel map region changed in before/after 1280 × 720 screenshots, without reloading or clicking the second page. Dusk Explorer 1 committed `(797,774)`, reduced from 30 to 29, and after server process restart the same tile returned **already explored, no credit spent** with balance 29. Separate tab selections survived independent reloads. The database fixture was not reset for these checks.

`npm run typecheck` and `npm run lint` passed. `npm test` with `R2PL_TEST_DATABASE_URL` pointing at the disposable local database passed **26/26**, including PostgreSQL atomicity, idempotency, school isolation, reconnect, outbox and crash/retry regression tests. `npm run build:client` passed. Browser bundle: HTML 3.46 kB, CSS 7.72 kB, JavaScript 707.03 kB (188.63 kB gzip). Vite warns that the JavaScript chunk exceeds 500 kB; it includes Three.js and the Colyseus client. No protocol, database schema, or production rule change was made for M4-A.

Screenshots: [Dawn desktop](screenshots/m4a-dawn-desktop.jpg), [Dusk desktop](screenshots/m4a-dusk-desktop.jpg), [narrow viewport](screenshots/m4a-dawn-mobile.jpg).

## Placeholders and next iteration

The terrain and marker positions are synthetic art. The Landmark has no puzzle, buff, takeover or reward behavior. There is no official school roster, production identity, running API, gifts, gacha, production visibility policy or approved campaign cost. The four local tokens are intentionally public, and the launcher refuses a non-loopback database URL. The fixture must never be exposed as a production service.

The M3.6 1,000-client/250-actions/s hotspot backlog and high visible latency remain a **production launch blocker**. The local playable prototype makes no capacity claim. For the next gameplay iteration, the owner should review the playable feel and decide the minimum C-01 exploration cost/currency, C-04 school/map layout, C-08 visibility, and C-09 Landmark interaction rules. Production identity and launch-scale delivery need separate approval and validation. No M5 work has begun.
