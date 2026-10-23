const origin = 'https://skai0o0.id.vn';
const tests = [
 ['GET','/health'],['GET','/api/fixture/world'],['POST','/matchmake/joinOrCreate/m2'],['POST','/matchmake/create/m2'],['GET','/api/fixture/bootstrap'],['GET','/api/game'],['GET','/api/game/tile?index=500500'],
 ['GET','/api/fixture/me'],['GET','/api/fixture/chests'],['GET','/api/fixture/receipts'],
 ['GET','/api/admin'],['GET','/api/admin/editor'],['GET','/api/admin/gifts'],['GET','/api/admin/gift-pool'],
 ['POST','/api/game'],['POST','/api/admin'],['POST','/api/admin/editor/draft'],['POST','/api/admin/gifts/redeem'],
 ['POST','/api/fixture/bots/start'],['POST','/api/fixture/bots/stop'],['GET','/api/fixture/rewards'],
 ['POST','/api/partner/v1/members'],['POST','/api/partner/v1/running'],['POST','/api/partner/v1/launches'],
 ['POST','/api/portal/session'],['POST','/api/portal/ws-ticket'],['GET','/api/dummy/v1/me'],
 ['GET','/.env'],['GET','/.env.portal'],['GET','/.git/config'],['GET','/artifacts/partner-credentials/.env.production'],
 ['GET','/matchmake/joinOrCreate/m2'],
];
const probes=[];
for(const [method,path] of tests){
 const r=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Admin-Key':'dev-map-admin',Authorization:'Bearer dev-school-0-actor-0'},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(10000)});
 const text=await r.text(); let data={}; try{data=JSON.parse(text)}catch{}
 probes.push({method,path,status:r.status,error:data.error??null});
}
console.log(JSON.stringify({checkedAtUTC:new Date().toISOString(),origin,probes},null,2));
