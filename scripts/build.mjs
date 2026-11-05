import {readFile,writeFile,readdir,mkdir,rm,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function walk(dir){const list=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())list.push(...await walk(p));else list.push(p);}return list.sort();}
const publicRoot=path.join(root,'public');
const manifest=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
if(manifest.static)throw new Error('Worker build must omit static manifest field');
const offlineFiles=(await walk(publicRoot)).map(p=>'./'+path.relative(publicRoot,p).replaceAll(path.sep,'/')).filter(p=>!p.startsWith('./downloads/')&&!['./sw.js','./_headers','./package-manifest.json','./README.md','./offline-assets.json'].includes(p)).map(p=>/\.(js|css)$/.test(p)?p+'?v=3':p);offlineFiles.push('./');await writeFile(path.join(publicRoot,'offline-assets.json'),JSON.stringify(offlineFiles));
const files=await walk(publicRoot),assetMap={};
for(const p of files){const data=await readFile(p),name='/'+path.relative(publicRoot,p).replaceAll(path.sep,'/');assetMap[name]=[data.toString('base64'),createHash('sha256').update(data).digest('hex')];}
let api=await readFile(path.join(root,'worker/api.mjs'),'utf8');api=api.replace(/export\s+async\s+function\s+handleApi/,'async function handleApi');
const runtime=`
const TYPES={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2',txt:'text/plain; charset=utf-8',md:'text/plain; charset=utf-8',webmanifest:'application/manifest+json',zip:'application/zip',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
function secure(response){const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','strict-origin-when-cross-origin');h.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});}
export default {async fetch(request,env,ctx){
 try{
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/'))return secure(await handleApi(request,env));
  if(!['GET','HEAD'].includes(request.method))return secure(new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}}));
  if(/^\\/(account|progress|tests|practice(?:\\/[a-z-]+)?|disease\\/[a-z-]+)$/.test(url.pathname))return Response.redirect(url.origin+'/#'+url.pathname+url.search,302);
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch(e){return secure(new Response('Bad path',{status:400}));}
  const name=pathname==='/'?'/index.html':pathname,asset=ASSETS[name];
  if(!asset)return secure(new Response('File not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}}));
  const etag='"'+asset[1]+'"';
  const headers={'Content-Type':TYPES[name.split('.').pop()]||'application/octet-stream',ETag:etag,'Cache-Control':name==='/index.html'||name==='/sw.js'?'no-cache':'public, max-age=3600'};
  if(name==='/sw.js')headers['Service-Worker-Allowed']='/';
  if(request.headers.get('If-None-Match')===etag)return secure(new Response(null,{status:304,headers}));
  const binary=atob(asset[0]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  return secure(new Response(request.method==='HEAD'?null:bytes,{status:200,headers}));
 }catch(error){console.error('Request failure:',error instanceof Error?error.message:'unknown');return secure(new Response('Сервис временно недоступен. Попробуйте позже.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}}));}
}};
`;
const output=path.join(root,'dist');await rm(output,{recursive:true,force:true});await mkdir(path.join(output,'server'),{recursive:true});await mkdir(path.join(output,'.openai'),{recursive:true});await mkdir(path.join(output,'migrations'),{recursive:true});
await writeFile(path.join(output,'server/index.js'),'const ASSETS='+JSON.stringify(assetMap)+';\n'+api+'\n'+runtime);
await writeFile(path.join(output,'.openai/hosting.json'),JSON.stringify(manifest,null,2));
for(const f of await walk(path.join(root,'migrations')))await copyFile(f,path.join(output,'migrations',path.basename(f)));
await writeFile(path.join(output,'server/wrangler.json'),JSON.stringify({name:'vetatlas',main:'index.js',compatibility_date:'2026-08-06',d1_databases:[{binding:'DB',database_name:'vetatlas-students',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:'../migrations'}]},null,2));
console.log(JSON.stringify({assets:files.length,workerBytes:(await readFile(path.join(output,'server/index.js'))).length,project:manifest.project_id}));
