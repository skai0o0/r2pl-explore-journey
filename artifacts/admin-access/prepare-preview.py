from pathlib import Path
import subprocess, tempfile, tarfile, shutil, json, secrets, uuid, time, urllib.request

base=Path(tempfile.mkdtemp(prefix='r2pl-admin-20261019-',dir='/opt'))
release=base/'release';release.mkdir()
subprocess.run(['git','-C','/opt/r2pl-game','archive','--output',str(base/'source.tar'),'HEAD'],check=True)
for archive in [base/'source.tar',Path('/tmp/r2pl-admin-changes.tar')]:
 with tarfile.open(archive) as t:
  for m in t.getmembers():
   if release not in (release/m.name).resolve().parents:raise RuntimeError('Unsafe archive member')
  t.extractall(release)
(release/'node_modules').symlink_to('/opt/r2pl-game/node_modules')
extra=Path('/opt/r2pl-game/client/public/models/landmarks')
if extra.exists():shutil.copytree(extra,release/'client/public/models/landmarks',dirs_exist_ok=True)
subprocess.run(['npm','run','build:client'],cwd=release,check=True)
# Retain old content-addressed chunks for clients already open during a rollout.
shutil.copytree('/opt/r2pl-game/dist/client/assets',release/'dist/client/assets',dirs_exist_ok=True)
db='r2pl_prep_test_admin_preview_'+uuid.uuid4().hex[:10]
campaign=str(uuid.uuid4());password='PreviewOnly-'+secrets.token_hex(16)
env=base/'preview.env'
env.write_text('\n'.join([
 'DATABASE_URL=postgresql://postgres@localhost/'+db+'?host=/var/run/postgresql',
 'PORTAL_CAMPAIGN_ID='+campaign,'PUBLIC_ORIGIN=http://127.0.0.1:4318',
 'PORTAL_LOGIN_URL=http://127.0.0.1:4180/login','PUBLIC_WEBSOCKET_URL=ws://127.0.0.1:4318',
 'PORTAL_KEYS_JSON='+json.dumps({'preview':secrets.token_hex(32)},separators=(',',':')),
 'ADMIN_KEY='+secrets.token_hex(32),'PORTAL_MODE=staging','PORT=4198','WS_PORT=2578'
 ])+'\n');env.chmod(0o600)
subprocess.run(['chown','-R','postgres:postgres',str(base)],check=True)
subprocess.run(['runuser','-u','postgres','--','createdb',db],check=True,cwd='/tmp')
node=['/usr/bin/node','--env-file='+str(env),'--experimental-strip-types']
subprocess.run(['runuser','-u','postgres','--',*node,'scripts/migrate-portal.ts'],cwd=release,check=True)
subprocess.run(['systemd-run','--unit=r2pl-admin-preview','--uid=postgres','--property=WorkingDirectory='+str(release),*node,'scripts/start-portal.ts'],check=True)
for i in range(50):
 try:
  with urllib.request.urlopen('http://127.0.0.1:4198/health',timeout=2) as r:
   if r.status==200:break
 except Exception:time.sleep(.2)
else:raise RuntimeError('Preview not healthy')
subprocess.run(['runuser','-u','postgres','--',*node,'scripts/bootstrap-root-admin.ts'],input=password+'\n',text=True,cwd=release,check=True)
state={'base':str(base),'release':str(release),'database':db,'campaign':campaign,'password':password}
(base/'preview.json').write_text(json.dumps(state));(base/'preview.json').chmod(0o600)
Path('/tmp/r2pl-admin-preview-state').write_text(str(base/'preview.json'))
print('PREVIEW_READY',release)
