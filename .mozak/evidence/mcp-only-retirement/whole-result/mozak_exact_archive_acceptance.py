import json,os,pathlib,subprocess
r=pathlib.Path('/home/pitfa/.jcode/scratch/mozak-mcp-only-whole-result')
b=str(r/'package-prefix/bin/mozak')
e=dict(os.environ,HOME=str(r/'package-home'),XDG_CONFIG_HOME=str(r/'package-home/.config'))
commands=[['setup','check',str(r/'package-home')],['stack','catalog'],['lab','start',str(r/'package-lab'),'mozak','research','Exact final archive MCP acceptance','arxiv-mcp'],['lab','refresh',str(r/'package-lab'),str(r/'live/run.json')],['research','verify-tool',str(r/'live/fixture.json'),str(r/'live/response.json'),str(r/'live/run.json')],['adapter','run','historic']]
rows=[]
for args in commands:
 p=subprocess.run([b,*args],env=e,capture_output=True,text=True)
 expected=1 if args[0]=='adapter' else 0
 assert p.returncode==expected,(args,p.stdout,p.stderr)
 rows.append({'args':args,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
assert 'ready' in rows[0]['stdout']
assert 'retired' in rows[-1]['stderr']
assert not (r/'package-home/.config/mozak/adapters.json').exists()
(r/'exact-archive-acceptance.json').write_text(json.dumps({'passed':True,'build_id':'0.7.1-main-9dd5c0c5a952','adapter_registry_created':False,'receipts':rows},indent=2)+'\n')
print('EXACT FINAL ARCHIVE INSTALL, MCP INGEST AND RETIRED ROUTE PASSED')
