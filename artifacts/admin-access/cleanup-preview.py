from pathlib import Path
import json, re, subprocess
base=Path('/opt/r2pl-admin-20261019-k6gt99n4')
state=json.loads((base/'preview.json').read_text())
db=state['database']
if not re.fullmatch(r'r2pl_prep_test_admin_preview_[0-9a-f]{10}',db):raise RuntimeError('Not a disposable preview database')
subprocess.run(['systemctl','stop','r2pl-admin-preview.service'],check=True)
subprocess.run(['runuser','-u','postgres','--','dropdb',db],check=True,cwd='/tmp')
for filename in ['preview.env','preview.json']:(base/filename).unlink()
print('Disposable preview stopped and removed; Production release and backup retained')
