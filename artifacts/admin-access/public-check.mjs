import { writeFile } from 'node:fs/promises';
const base='https://skai0o0.id.vn';
const cases=[
 ['GET','/health',200], ['GET','/admin',200], ['GET','/admin/login',200],
 ['GET','/api/admin/accounts',401], ['GET','/api/admin/audit',401],
 ['GET','/api/admin/rankings',401], ['GET','/api/admin/editor',403],
 ['GET','/api/admin/gift-pool',403], ['GET','/api/admin/gifts',403],
 ['GET','/api/fixture/world',401], ['POST','/api/admin/accounts',403],
 ['POST','/api/admin',403], ['POST','/api/admin-auth/login',403],
];
const results=await Promise.all(cases.map(async ([method,path,expected])=>{
 const r=await fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(15000)});
 await r.arrayBuffer();return {method,path,status:r.status,expected,pass:r.status===expected};
}));
const health=await (await fetch(base+'/health')).json();
const config=await (await fetch(base+'/api/portal/config')).json();
const data={results,passed:results.every(r=>r.pass),health,contractVersion:config.contractVersion,campaignId:config.campaignId,portalLoginUrl:config.portalLoginUrl};
await writeFile('artifacts/admin-access/public-check.json',JSON.stringify(data,null,2));
console.log(JSON.stringify(data));if(!data.passed)process.exitCode=1;
