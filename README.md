# R2PL Game V2 — M1 world foundation

This is the greenfield V2 workspace. `land-rush-prototype/` is a read-only V1 reference. M1 implements the approved million-cell world format with synthetic school fixtures only; it has no gameplay, production school roster, database transactions or realtime game server.

Requires Node.js 22.12+ and npm. From the workspace root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:client
npm run bench:world
npm run report:size
```

`npm test` includes a loopback Colyseus transport test and requires local socket access. For the visual fixture run `npx vite client --host 127.0.0.1`, then open its local URL in a WebGL browser. M1 measurements and limitations are in `docs/M1_REPORT.md`; approved and pending decisions are in `docs/DECISIONS.md`.
