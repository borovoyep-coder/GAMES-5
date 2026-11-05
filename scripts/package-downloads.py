from pathlib import Path
import json,zipfile
root=Path(__file__).resolve().parent.parent;p=root/'public';paths=sorted(str(f.relative_to(p)) for f in p.rglob('*') if f.is_file() and f.name not in ['vetatlas.zip','vetatlas-server.zip','package-manifest.json']);paths.append('package-manifest.json');(p/'package-manifest.json').write_text(json.dumps(paths,ensure_ascii=False,indent=2))
with zipfile.ZipFile(p/'downloads/vetatlas.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in paths:z.write(p/name,name)
with zipfile.ZipFile(p/'downloads/vetatlas-server.zip','w',zipfile.ZIP_DEFLATED) as z:
 for folder in ['public','worker','scripts','db','drizzle','tests','.openai']:
  for f in sorted((root/folder).rglob('*')):
   if f.is_file() and f.name not in ['vetatlas.zip','vetatlas-server.zip']:z.write(f,f.relative_to(root))
 for name in ['package.json','package-lock.json','drizzle.config.ts','README.md','.gitignore']:z.write(root/name,name)
print('Packaged static learning copy and full Worker source')
