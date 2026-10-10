# M4-B playable parallel-development increment

## What is playable

The loopback-only browser build retains the M4-A durable Colyseus/PostgreSQL world and protocol v1. Antigravity improved the fog and knowledge presentation, tile reticles and reveal feedback, camera controls, school HUD, and desktop/mobile layout. MiMo supplied a pure, versioned development exploration rule. Codex wired that rule into the existing locked PostgreSQL transaction, so eligibility, wallet debit, chunk/fog mutation, idempotency result, and outbox event retain the same commit boundary. The rule is enabled only by `scripts/play-local.ts` with `R2PL_DEV_PLAY=1`.

Two Dawn browser sessions were exercised at `127.0.0.1:4173`. Explorer 1 explored tile `(247,257)`, reducing its fixture balance from 29 to 28. Explorer 2 received the visible tile in real time; clicking it returned `already explored` with zero debit and left its balance at 30. After reloading Explorer 2, the tile still returned `already explored`. A Dusk session separately explored `(807,787)` and spent one of its own fixture credits. Existing regression tests verify cross-school fog isolation and durable replay. Screenshots: [Dawn](screenshots/m4b-dawn-gameplay.png), [Dusk](screenshots/m4b-dusk-gameplay.png).

## Contributions

| Owner | Model / branch | Source commit | Contribution |
| --- | --- | --- | --- |
| Antigravity | `gemini-3.8-flash-high`, `feat/m4b-antigravity-ui` | `b9b45fd` (integrated as `8fe5ee1`) | Client fog, camera, HUD, selection and action feedback |
| Xiaomi MiMo | `xiaomi/mimo-v2.6-pro`, High, `feat/m4b-mimo-gameplay` | `a87bde2` (integrated as `c04e5bc`) | Pure development exploration rule, explicit contest/decay/Landmark candidates, 25 rule tests |
| Codex | `codex/m4a-playable` | `1c74044`, `675c233`, `43e41f4` and final integration commit | Small shared contract, transactional rule adapter, client integration fixes, database/browser verification |

Both CLIs passed model/authentication and worktree edit checks. Their assigned V2 files were shared under the owner's explicit approval; no credentials, production data, or V1 source were passed. Codex reviewed and integrated both branches. MiMo's candidate mechanics remain pure proposals: they are not routed through Colyseus or persisted.

## Verification

- TypeScript strict compilation: passed.
- Biome lint/format check: passed.
- Browser bundle: 714.91 kB JavaScript (190.55 kB gzip), 12.40 kB CSS (3.58 kB gzip). Vite reports the existing >500 kB chunk warning.
- PostgreSQL 16 regression suite: 52/52 passed with `--test-concurrency=1` against a disposable local database. The first parallel run hit the cluster's default 20-connection limit; this was a test environment capacity issue, not an action failure. The fresh database was migrated before the passing run.
- Two-session browser interaction, shared knowledge, balance, and reload: passed as described above.

## Still placeholder or pending

The two universities, tokens, 30-credit opening balances, and one-credit exploration cost are synthetic development fixtures. Shared Knowledge contests, decay, Landmark contribution/puzzles, rewards, gacha, physical prizes, running integration, and real student identity are inactive. Product Owner decisions remain necessary for C-01 exploration currency/cost and shared entry/defense, C-02 Landmark thresholds and takeover, C-03 contest/decay timing and deadlines, C-04 official school slots/map, C-08 production visibility, and C-09 puzzles/buffs. The documented 1,000-client hotspot limitation remains a production launch blocker. This increment does not claim production capacity.

Stop here for owner feedback before another gameplay milestone.
