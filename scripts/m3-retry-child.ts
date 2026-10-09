import { Pool } from "pg";
import { M3TestMutationService } from "../server/persistence/M3TestMutation.ts";

const [campaignId, actorId, schoolSlot, keyHex, tileIndex, cost] =
  process.argv.slice(2);
const url = process.env.R2PL_TEST_DATABASE_URL;
if (
  !url ||
  !campaignId ||
  !actorId ||
  !schoolSlot ||
  !keyHex ||
  !tileIndex ||
  !cost
)
  throw new Error("Missing fixture retry arguments");
const pool = new Pool({
  connectionString: url,
  max: 1,
  options: "-c search_path=r2pl_v2,public",
});
try {
  const outcome = await new M3TestMutationService(pool).apply({
    campaignId,
    actorId,
    schoolSlot: Number(schoolSlot),
    key: Buffer.from(keyHex, "hex"),
    tileIndex: Number(tileIndex),
    cost: BigInt(cost),
  });
  process.stdout.write(`${JSON.stringify(outcome.result)}\n`);
} finally {
  await pool.end();
}
