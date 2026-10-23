from pathlib import Path
import subprocess, shutil, urllib.request, json, time
base=Path('/opt/r2pl-admin-20261019-k6gt99n4');release=base/'release'
units=['r2pl-game.service','r2pl-standalone.service','r2pl-portal.service']
def pid(unit):return subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip()
before={unit:pid(unit) for unit in units}
old=subprocess.check_output(['systemctl','show','r2pl-game.service','-p','WorkingDirectory','--value'],text=True).strip()
shutil.copytree('/opt/r2pl-game/dist/client/assets',release/'dist/client/assets',dirs_exist_ok=True)
dropin=Path('/etc/systemd/system/r2pl-game.service.d/110-admin-access.conf')
if dropin.exists():raise RuntimeError('Deployment override already exists')
dropin.write_text('[Service]\nWorkingDirectory='+str(release)+'\n')
subprocess.run(['systemctl','daemon-reload'],check=True)
try:
 subprocess.run(['systemctl','restart','r2pl-game.service'],check=True)
 for i in range(60):
  try:
   with urllib.request.urlopen('http://127.0.0.1:4190/health',timeout=2) as r: health=json.load(r)
   if health.get('mode')=='production' and health.get('contractVersion')==1:break
  except Exception:time.sleep(.2)
 else:raise RuntimeError('New release not healthy')
 with urllib.request.urlopen('http://127.0.0.1:4190/api/portal/config') as r:config=json.load(r)
 assert config['campaignId']=='2e00774c-4a8f-4c58-bff6-ed9092901d8f'
 assert config['portalLoginUrl']=='https://predatorleague.acervietnam.com.vn/portal/r2pl/login'
 with urllib.request.urlopen('http://127.0.0.1:4190/admin') as r:assert r.status==200
 for unit in units[1:]:assert pid(unit)==before[unit], 'Unrelated service changed'
 result={'release':str(release),'previousRelease':old,'health':health,'campaignId':config['campaignId'],'beforePids':before,'afterPids':{unit:pid(unit) for unit in units},'rollback':'Remove '+str(dropin)+'; daemon-reload; restart r2pl-game.service. Migration 009 is additive.'}
 (base/'production-deployment.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result))
except:
 dropin.unlink();subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','r2pl-game.service'],check=True)
 raise
