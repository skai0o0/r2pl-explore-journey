import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

target = 'https://predatorleague.acervietnam.com.vn/portal/r2pl'
env_path = pathlib.Path('/opt/r2pl-game/.env.portal')
nginx_path = pathlib.Path('/etc/nginx/conf.d/r2pl-game.conf')
release = pathlib.Path(subprocess.check_output(['systemctl', 'show', 'r2pl-game.service', '-p', 'WorkingDirectory', '--value'], text=True).strip())
assert release == pathlib.Path('/opt/r2pl-production-auth-20261019-1e94wydb/release')
backup = pathlib.Path(tempfile.mkdtemp(prefix='partner-login-', dir=str(release.parent)))
backup.chmod(0o700)
original_env = env_path.read_text()
original_nginx = nginx_path.read_text()
shutil.copy2(env_path, backup/'env.portal')
(backup/'env.portal').chmod(0o600)
shutil.copy2(nginx_path, backup/'nginx.conf')
new_env, count = re.subn(r'^PORTAL_LOGIN_URL=.*$', 'PORTAL_LOGIN_URL='+target, original_env, flags=re.M)
assert count == 1
old_route = '        root /var/www/r2pl;\n        try_files /production-login.html =503;'
assert original_nginx.count(old_route) == 1
new_nginx = original_nginx.replace(old_route, '        return 302 '+target+'$is_args$args;')
other_pids = {s: subprocess.check_output(['systemctl', 'show', s, '-p', 'MainPID', '--value'], text=True).strip() for s in ['r2pl-standalone.service', 'r2pl-portal.service']}
client = pathlib.Path('/opt/r2pl-game/dist/client/index.html')
client_hash = hashlib.sha256(client.read_bytes()).hexdigest()

def get(path):
    try:
        response = urllib.request.urlopen('http://127.0.0.1:4176'+path, timeout=4)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, response.read()

old_contract = get('/api/partner/v1/openapi.json')[1]
changed = False
try:
    env_path.write_text(new_env)
    changed = True
    subprocess.run(['node', '--env-file='+str(env_path), '--experimental-strip-types', '--input-type=module', '-e', "import {portalConfigFromEnv} from './server/integration/PortalConfig.ts'; const c=portalConfigFromEnv();if(c.mode!=='production'||c.publicOrigin!=='https://skai0o0.id.vn'||c.portalLoginUrl!=='"+target+"')throw Error('Invalid production login config');"], cwd=release, check=True)
    nginx_path.write_text(new_nginx)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    subprocess.run(['systemctl', 'restart', 'r2pl-game.service'], check=True, timeout=40)
    for attempt in range(20):
        try:
            status, raw = get('/api/portal/config')
            if status == 200 and json.loads(raw).get('portalLoginUrl') == target:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('New login configuration not served')
    assert get('/api/fixture/world')[0] == 401
    assert get('/api/partner/v1/openapi.json')[1] == old_contract
    assert hashlib.sha256(client.read_bytes()).hexdigest() == client_hash
    for service, pid in other_pids.items():
        assert subprocess.check_output(['systemctl', 'show', service, '-p', 'MainPID', '--value'], text=True).strip() == pid
    result = {'portalLoginUrl': target, 'release': str(release), 'backupDirectory': str(backup), 'mainPid': subprocess.check_output(['systemctl', 'show', 'r2pl-game.service', '-p', 'MainPID', '--value'], text=True).strip(), 'updatedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()), 'clientUnchanged': True, 'contractUnchanged': True, 'demoPortalUnchanged': True, 'legacyLoginRedirect': True}
    (backup/'result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2), flush=True)
except Exception:
    if changed:
        shutil.copy2(backup/'env.portal', env_path)
        shutil.copy2(backup/'nginx.conf', nginx_path)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        subprocess.run(['systemctl', 'restart', 'r2pl-game.service'], check=True, timeout=40)
        print('Previous login configuration restored', flush=True)
    raise
