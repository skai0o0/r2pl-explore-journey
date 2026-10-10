import { Pool } from "pg";
import { createDurableSyntheticServer } from "../server/realtime/durableBootstrap.ts";
import { SchoolRegistry } from "../shared/world/registry.ts";

const url = process.env.R2PL_TEST_DATABASE_URL;
const [campaignId, actorId] = process.argv.slice(2);
if (!url || !campaignId || !actorId)
  throw new Error("Disposable database, campaign and actor are required");
const pool = new Pool({ connectionString: url, max: 4 });
const fixture = await createDurableSyntheticServer(
  pool,
  campaignId,
  new SchoolRegistry([{ id: "fixture-a", slot: 0 }]),
  [{ token: "m35-crash-token", actorId, schoolSlot: 0 }],
  3n,
  { afterCommit: () => process.exit(42) },
);
await fixture.server.listen(0, "127.0.0.1");
const address = fixture.transport.server?.address();
if (!address || typeof address === "string")
  throw new Error("Missing crash-test port");
process.send?.({ type: "ready", port: address.port });
