import hashlib
import json
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import urllib.error

repo = pathlib.Path('/opt/r2pl-game')
service = 'r2pl-game.service'
baseline = '1dd08e7d65d9c42879f02d43937565230b19d211'
index_hash = '850abed2009754438d663ae2e2f480c5b0aa45b86eec39df31dbdd981d8faa46'
expected = {
    'server/integration/SchoolPlayServer.ts': 'a925bab60dd786ca4b08f11aca96ab4bc44739d7e9ecd3d05d694ab503d3e597',
    'server/realtime/GatewayRoom.ts': 'a9bee00c7121eb3f2682bc82c782e4478aa1fadcc59f72edad32e3baf80dffd3',
}

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def request(path, body=None):
    headers = {'Origin': 'https://skai0o0.id.vn', 'Content-Type': 'application/json'}
    req = urllib.request.Request('http://127.0.0.1:4176' + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=4)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, response.read()

assert run('systemctl', 'show', service, '-p', 'MainPID', '--value') == '919779'
assert sha(repo/'dist/client/index.html') == index_hash
assert not run('systemctl', 'show', service, '-p', 'DropInPaths', '--value')
other_pids = {s: run('systemctl', 'show', s, '-p', 'MainPID', '--value') for s in ['r2pl-standalone.service', 'r2pl-portal.service']}
status, old_contract = request('/api/partner/v1/openapi.json')
assert status == 200

work = pathlib.Path(tempfile.mkdtemp(prefix='r2pl-production-auth-20261019-', dir='/opt'))
rollback = work/'rollback'
release = work/'release'
rollback.mkdir()
archive = work/'baseline.tar'
subprocess.run(['git', '-C', str(repo), 'archive', '--output', str(archive), baseline], check=True)
with tarfile.open(archive) as tar:
    for member in tar.getmembers():
        assert rollback in (rollback/member.name).resolve().parents
        if member.issym():
            assert rollback in (rollback/member.name).parent.joinpath(member.linkname).resolve().parents
    tar.extractall(rollback)
# The running server reads this contract from disk on each request; preserve
# the already-published files even though its process uses older gameplay code.
shutil.copytree(repo/'integration', rollback/'integration', dirs_exist_ok=True)
shutil.copytree(rollback, release, symlinks=True)
with tarfile.open('/tmp/r2pl-production-auth-only.tar') as tar:
    assert set(tar.getnames()) == set(expected)
    for member in tar.getmembers():
        assert member.isfile()
        data = tar.extractfile(member).read()
        assert hashlib.sha256(data).hexdigest() == expected[member.name]
        (release/member.name).write_bytes(data)
for target in [rollback, release]:
    (target/'node_modules').symlink_to(repo/'node_modules')
    (target/'dist').mkdir(exist_ok=True)
    (target/'dist/client').symlink_to(repo/'dist/client')
    subprocess.run(['node', '--experimental-strip-types', '--check', 'server/integration/SchoolPlayServer.ts'], cwd=target, check=True)
    subprocess.run(['node', '--experimental-strip-types', '--check', 'server/realtime/GatewayRoom.ts'], cwd=target, check=True)

changed = [str(p.relative_to(release)) for p in release.rglob('*') if p.is_file() and not p.is_symlink() and 'node_modules' not in p.parts and 'dist' not in p.parts and p.read_bytes() != (rollback/p.relative_to(release)).read_bytes()]
assert set(changed) == set(expected), changed
assert (release/'integration/openapi.json').read_bytes() == old_contract

def config(target):
    return '[Service]\nWorkingDirectory=' + str(target) + '\nExecStart=\nExecStart=/usr/bin/node --env-file=/opt/r2pl-game/.env.portal --experimental-strip-types scripts/start-portal.ts\n'

(work/'original.service').write_bytes(pathlib.Path('/etc/systemd/system/r2pl-game.service').read_bytes())
(work/'rollback.conf').write_text(config(rollback))
(work/'release.conf').write_text(config(release))
manifest = {'baseline': baseline, 'changedFiles': expected, 'clientSha256': index_hash, 'release': str(release), 'rollback': str(rollback), 'otherPids': other_pids, 'productionChanged': False}
manifest_path = work/'deployment.json'
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
dropin = pathlib.Path('/etc/systemd/system/r2pl-game.service.d/100-auth-hardening.conf')
assert not dropin.exists()
dropin.parent.mkdir(exist_ok=True)

def activate(target):
    dropin.write_text(config(target))
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'restart', service], check=True, timeout=40)
    for attempt in range(20):
        try:
            status, body = request('/health')
            if status == 200 and json.loads(body).get('mode') == 'production':
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Production health verification failed')

try:
    activate(release)
    assert request('/api/fixture/world')[0] == 401
    assert request('/api/fixture/bootstrap')[0] == 401
    assert request('/matchmake/joinOrCreate/m2', {'token': 'a'*64})[0] == 400
    assert request('/api/partner/v1/members', {})[0] == 401
    assert request('/api/partner/v1/openapi.json')[1] == old_contract
    assert sha(repo/'dist/client/index.html') == index_hash
    for name, pid in other_pids.items():
        assert run('systemctl', 'show', name, '-p', 'MainPID', '--value') == pid
    manifest.update(productionChanged=True, deployedAtUTC=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), mainPid=run('systemctl', 'show', service, '-p', 'MainPID', '--value'), verification='PASS')
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest, indent=2), flush=True)
except Exception:
    activate(rollback)
    manifest.update(productionChanged=True, verification='ROLLED_BACK')
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
    print('Automatic rollback activated:', rollback, flush=True)
    raise
