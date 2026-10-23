import pathlib, subprocess, tempfile, tarfile, uuid, shutil, sys
root = pathlib.Path(tempfile.mkdtemp(prefix='r2pl-gift-pool-test-', dir='/tmp'))
db = 'r2pl_prep_test_gift_' + uuid.uuid4().hex[:12]
created = False
result = 1
try:
    subprocess.run(['git', '-C', '/opt/r2pl-game', 'archive', '--output', str(root/'base.tar'), 'HEAD'], check=True)
    for archive in [root/'base.tar', pathlib.Path('/tmp/r2pl-gift-pool-changes.tar')]:
        with tarfile.open(archive) as t:
            for member in t.getmembers():
                if root not in (root/member.name).resolve().parents:
                    raise RuntimeError('Unsafe archive member')
            t.extractall(root)
    (root/'node_modules').symlink_to('/opt/r2pl-game/node_modules')
    subprocess.run(['chown', '-R', 'postgres:postgres', str(root)], check=True)
    subprocess.run(['runuser', '-u', 'postgres', '--', 'createdb', db], check=True, cwd='/tmp')
    created = True
    url = 'postgresql://postgres@localhost/' + db + '?host=/var/run/postgresql'
    result = subprocess.run(['runuser', '-u', 'postgres', '--', 'env', 'R2PL_PREPARATION_DATABASE_URL='+url, 'node', '--experimental-strip-types', '--test', '--test-concurrency=1', 'tests/demo-admin-portal.test.ts', 'tests/signed-gameplay.test.ts', 'tests/gameplay-ui-postgres.test.ts', 'tests/gift-pool.test.ts', 'tests/amtech-editor.test.ts'], cwd=root).returncode
    print('GIFT_POOL_TEST_EXIT', result, flush=True)
finally:
    if created:
        subprocess.run(['runuser', '-u', 'postgres', '--', 'dropdb', db], check=True, cwd='/tmp')
    if root.resolve().parent == pathlib.Path('/tmp') and root.name.startswith('r2pl-gift-pool-test-'):
        shutil.rmtree(root)
sys.exit(result)
