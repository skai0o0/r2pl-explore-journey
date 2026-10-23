from pathlib import Path
import tarfile, shutil, subprocess, os, json
base=Path('/opt/r2pl-admin-20261019-k6gt99n4');release=base/'release'
with tarfile.open('/tmp/r2pl-admin-ui.tar') as t:
 for m in t.getmembers():
  if release not in (release/m.name).resolve().parents:raise RuntimeError('Unsafe archive')
 t.extractall(release)
subprocess.run(['node','node_modules/vite/bin/vite.js','build','client','--outDir','../dist/client-next','--emptyOutDir'],cwd=release,check=True)
current=release/'dist/client';next_dir=release/'dist/client-next';previous=release/'dist/client-before-admin-final'
if previous.exists():raise RuntimeError('Previous client backup already exists')
shutil.copytree(current/'assets',next_dir/'assets',dirs_exist_ok=True)
current.rename(previous)
try:next_dir.rename(current)
except:previous.rename(current);raise
# Production release is operator-owned; the preview user only needs read access.
os.chown(base,0,0);base.chmod(0o755)
for directory,dirs,files in os.walk(release,followlinks=False):
 os.chown(directory,0,0)
 for name in files:os.lchown(Path(directory)/name,0,0)
 for name in dirs:
  if (Path(directory)/name).is_symlink():os.lchown(Path(directory)/name,0,0)
state_path=base/'preview.json';state=json.loads(state_path.read_text());state.pop('password',None);state_path.write_text(json.dumps(state));state_path.chmod(0o600)
print('Client switched atomically; production process unchanged; temporary root password removed from preview metadata')
