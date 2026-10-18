/** Isolated loopback synthetic fixture for real-browser beacon acceptance. */
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { botDatabase } from "../../scripts/simulation/config.ts";
import { createSchoolPlayServer } from "../../server/integration/SchoolPlayServer.ts";

const database=botDatabase(process.env.R2PL_PREPARATION_DATABASE_URL,"1");
const pool=new Pool({connectionString:database,max:16});
const campaign=randomUUID();
const play=await createSchoolPlayServer(pool,{web:4180,websocket:2572},campaign);
const [student,pathBuilder]=play.fixture.actors;
if(!student||!pathBuilder) throw new Error("Missing synthetic students");
// Start this test student with zero Crystals, so normal funding must exercise auto-conversion.
await pool.query("UPDATE r2pl_v2.wallet_accounts SET opening_balance=0,balance=0 WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-crystals'",[campaign,student.actorId]);
const path=[
  ...Array.from({length:46},(_,i)=>({x:510+i,z:280})),
  ...Array.from({length:29},(_,i)=>({x:555,z:281+i})),
  ...Array.from({length:140},(_,i)=>({x:500,z:290+i})),
];
for(const tile of path) {
  const result=await play.realtime.authority.apply(pathBuilder.actorId,0,randomBytes(16),tile.z*1000+tile.x);
  if(result.result.status==="rejected") throw new Error(`Fixture path rejected: ${JSON.stringify(result.result)}`);
}
console.log(JSON.stringify({campaign,url:"http://127.0.0.1:4180/",pathCommands:path.length,syntheticOnly:true}));
process.once("SIGINT",()=>void play.close().then(()=>pool.end()));
process.once("SIGTERM",()=>void play.close().then(()=>pool.end()));
