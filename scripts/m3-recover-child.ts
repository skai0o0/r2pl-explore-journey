import { createHash } from "node:crypto";
import { Pool } from "pg";
import { readAuthoritativeChunk } from "../server/persistence/M3TestMutation.ts";

const [campaignId, chunkIdText, slotText] = process.argv.slice(2);
const url = process.env.R2PL_TEST_DATABASE_URL;
if (!url || !campaignId || !chunkIdText || !slotText)
  throw new Error("Missing fixture recovery arguments");
const pool = new Pool({
  connectionString: url,
  max: 1,
  options: "-c search_path=r2pl_v2,public",
});
try {
  const client = await pool.connect();
  try {
    const chunk = await readAuthoritativeChunk(
      client,
      campaignId,
      Number(chunkIdText),
      Number(slotText),
    );
    process.stdout.write(
      `${JSON.stringify({
        revision: chunk.revision.toString(),
        maskSha256: createHash("sha256").update(chunk.mask).digest("hex"),
        fogSha256: createHash("sha256").update(chunk.fog).digest("hex"),
      })}\n`,
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
