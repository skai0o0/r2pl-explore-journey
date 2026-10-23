import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migratePortalDatabase} from '../../server/persistence/PortalMigrations.ts';
import {createSchoolPlayServer} from '../../server/integration/SchoolPlayServer.ts';
const url=new URL('postgresql://handoff_audit@127.0.0.1:55449/postgres');
url.password=fs.readFileSync('.m35-local-db/pwfile','utf8').trim();
const admin=new Pool({connectionString:url.href});
await admin.query('CREATE DATABASE r2pl_prep_test_visible_fix').catch(error => {if(error.code!=='42P04')throw error;});
url.pathname='/r2pl_prep_test_visible_fix';
const pool=new Pool({connectionString:url.href,max:16});
await migratePortalDatabase(pool);
const play=await createSchoolPlayServer(pool,{web:4318,websocket:2578},randomUUID(),{actorsPerSchool:27});
console.log('Verification game ready: http://127.0.0.1:4318');
console.log('Type reconnect to close only observer sockets, or stop to end verification.');
process.stdin.on('data',async data=>{
 const command=String(data).trim();
 if(command==='reconnect'){
   for(const socket of play.realtime.transport.wss.clients) socket.close(4000,'verification_reconnect');
   console.log('Verification sockets closed; server remains available.');
 }else if(command==='metrics'){
   console.log(JSON.stringify(play.realtime.core.metrics.snapshot().counters));
 }else if(command==='stop'){
   await play.close();await pool.end();await admin.end();process.exit(0);
 }
});
