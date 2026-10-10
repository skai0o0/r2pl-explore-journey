# Play R2PL V2 locally (M4-B)

This is a **development-only synthetic world**. It listens on loopback, uses four fixed test identities, and rejects a database URL that is not loopback. Use a disposable PostgreSQL 16 database, never the V1 Supabase project or production credentials.

## Start

1. Install Node.js 22.12+ and run `npm ci` in this repository.
2. Start PostgreSQL 16 on this computer and create an empty, disposable database whose user can create a schema. Keep its durable storage between game restarts if you want progress to persist.
3. Set these environment variables in the terminal that will start the game:

   ```powershell
   $env:R2PL_DEV_PLAY = '1'
   $env:R2PL_TEST_DATABASE_URL = 'postgresql://YOUR_TEST_USER:YOUR_TEST_PASSWORD@127.0.0.1:5432/YOUR_DISPOSABLE_DB'
   npm run play:local
   ```

   The launcher applies the two existing V2 migrations, seeds a separate synthetic campaign once, builds the browser client, and starts the game. It does not reset balances or world knowledge on restart.

4. Open **http://127.0.0.1:4173**. Open a second browser tab at the same address and choose **Dawn · Explorer 2**. Click or tap a map tile in either tab. Both Dawn sessions see the authorized update. Switch a tab to Dusk to see its separate school knowledge.

Drag to pan, use the wheel, pinch gesture, or `+`/`−` to zoom, and use the HQ, Landmark, and Overview buttons to navigate. Keyboard shortcuts `H`, `L`, and `O` reach those destinations. Clicking a tile selects it and immediately submits exploration. The HUD shows committing, reveal, or rejection feedback. A newly explored tile costs one **test-only fixture credit**; repeating it costs none. Each synthetic explorer starts with 30 credits. The local launcher explicitly enables development rule version 0; contest, decay, and Landmark candidates are not active gameplay.

Press `Ctrl+C` in the game terminal to stop the game. The local browser and Colyseus ports are **4173** and **2567**. Do not expose either port to a network: the fixed test tokens are visible in the browser by design.

## Review evidence

- [Dawn desktop](docs/screenshots/m4a-dawn-desktop.jpg)
- [Dusk desktop](docs/screenshots/m4a-dusk-desktop.jpg)
- [Narrow viewport](docs/screenshots/m4a-dawn-mobile.jpg)
- [M4-A report](docs/M4A_REPORT.md)
- [Improved Dawn gameplay](docs/screenshots/m4b-dawn-gameplay.png)
- [Improved Dusk gameplay](docs/screenshots/m4b-dusk-gameplay.png)
- [M4-B integration report](docs/M4B_REPORT.md)

The official school registry, campaign exploration cost, production identity, rewards, running integration, and production visibility policy are still pending owner decisions. This launcher cannot enable production gameplay.
