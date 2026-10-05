import hashlib,json,pathlib,shutil,subprocess
root=pathlib.Path('/home/pitfa/.jcode/scratch/mozak-mcp-only-whole-result')
old='/home/pitfa/.local/lib/mozak/versions/0.7.1-main-eceddef3b7c0/mozak'
new='/home/pitfa/Documents/mozak/target/debug/mozak'
area=root/'history-parity-v2'
area.mkdir(exist_ok=False)
rows=[]
for fixture in sorted((root/'history').iterdir()):
    if not fixture.is_dir(): continue
    for operation in ['status','review']:
        results=[]
        for label,binary in [('old',old),('new',new)]:
            destination=area/fixture.name/operation/label
            shutil.copytree(fixture,destination)
            proc=subprocess.run([binary,'lab',operation,str(destination)],capture_output=True)
            results.append(proc)
            (destination.parent/(label+'.stdout')).write_bytes(proc.stdout)
            (destination.parent/(label+'.stderr')).write_bytes(proc.stderr)
        a,b=results
        equal=(a.returncode,a.stdout,a.stderr)==(b.returncode,b.stdout,b.stderr)
        rows.append({'fixture':fixture.name,'operation':operation,'old_exit':a.returncode,'new_exit':b.returncode,'equal':equal,'stdout_sha256':hashlib.sha256(b.stdout).hexdigest(),'stderr':b.stderr.decode()})
report={'schema_version':1,'checks':rows,'checks_count':len(rows),'matched':sum(x['equal'] for x in rows),'successful':sum(x['new_exit']==0 for x in rows),'matching_refusals':sum(x['equal'] and x['new_exit']!=0 for x in rows),'passed':all(x['equal'] for x in rows),'boundary':'Disposable twin copies only. Rejection is compared as well as success.'}
(root/'history-parity-v2.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert report['checks_count']==24 and report['passed']
