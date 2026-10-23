import { ColyseusSDK } from '@colyseus/sdk';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { decodeFrame, decodeAck, encodeLiveSubscribe, encodeExplore, M2_KIND } from '../../shared/protocol/m2.ts';

const base = 'http://127.0.0.1:4188';
const bootstrap = await (await fetch(`${base}/api/fixture/bootstrap`)).json();
if (!bootstrap.fixtureOnly) throw new Error('Local synthetic fixture required');
const player = bootstrap.players.filter(p => p.slot === 0)[1];
const room = await new ColyseusSDK('ws://127.0.0.1:2578').joinOrCreate('m2', { token: player.token });
let resolveAck;
room.onMessage('m2', raw => {
  const frame = decodeFrame(Uint8Array.from(raw));
  if (frame.kind === M2_KIND.ACK) resolveAck?.(decodeAck(frame.payload));
});
room.sendBytes('m2', encodeLiveSubscribe([Math.floor(player.home.z / 64) * 16 + Math.floor((player.home.x + 10) / 64)]));
let applied = 0;
for (let dz = -2; dz < 3; dz++) for (let dx = 10; dx < 15; dx++) {
  const ack = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ACK timeout')), 5000);
    resolveAck = value => { clearTimeout(timer); resolve(value); };
    room.sendBytes('m2', encodeExplore({ key: Uint8Array.from(Buffer.from(randomUUID().replaceAll('-', ''), 'hex')), tileIndex: (player.home.z + dz) * 1000 + player.home.x + dx, ruleVersion: 1, intent: 'explore' }));
  });
  if (ack.status === 1) applied++;
  await new Promise(resolve => setTimeout(resolve, 125));
}
await room.leave();
// Publish controlled visual fixtures on this throwaway campaign, never the hosted game.
const pool = new Pool({ connectionString: 'postgresql://realtime_fixture@127.0.0.1:55441/r2pl_prep_test_realtime' });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  const rows = (await db.query('SELECT id,data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1', [bootstrap.campaignId])).rows;
  const stop = rows.find(r => r.data.kind === 'unistop');
  const landmark = rows.find(r => r.id === 'fansipan');
  if (stop) await db.query('UPDATE r2pl_v2.game_world_objects SET data=$1 WHERE campaign_id=$2 AND id=$3', [JSON.stringify({ ...stop.data, x: player.home.x + 12, z: player.home.z - 3, ownerSchoolSlot: 0, ownerSchoolId: 'hcmut' }), bootstrap.campaignId, stop.id]);
  if (landmark) await db.query('UPDATE r2pl_v2.game_world_objects SET data=$1 WHERE campaign_id=$2 AND id=$3', [JSON.stringify({ ...landmark.data, x: player.home.x + 16, z: player.home.z + 4 }), bootstrap.campaignId, landmark.id]);
  await db.query("INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'beacon','fansipan',$2) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data", [bootstrap.campaignId, JSON.stringify({ holder: 0, solved: [0], pots: {}, cooldowns: {}, takeovers: 0 })]);
  await db.query('COMMIT');
  console.log(`Second client opened ${applied} additional tiles; published local UniStop/beacon fixtures.`);
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { db.release(); await pool.end(); }
process.exit();
