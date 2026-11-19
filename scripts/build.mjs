import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function build(out=join(root,'dist'),{revision=''}={}){
  out=resolve(out);const defaultOutput=join(root,'dist'),temporaryRoot=resolve(tmpdir());
  if(out===root||(out!==defaultOutput&&!out.startsWith(temporaryRoot+sep)))throw new Error('Build output must be the app dist directory or a dedicated temporary directory.');
  await mkdir(out,{recursive:true});
  for(const name of ['index.html','styles.css','manifest.webmanifest','assets','src'])await cp(join(root,name),join(out,name),{recursive:true});
  async function files(dir,prefix=''){const list=[];for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())list.push(...await files(join(dir,entry.name),name+'/'));else if(!['sw.js','config.js'].includes(name))list.push(name);}return list.sort();}
  const assets=await files(out),hash=createHash('sha256');for(const file of assets){hash.update(file);hash.update(await readFile(join(out,file)));}hash.update(revision);const version=hash.digest('hex').slice(0,16);
  await writeFile(join(out,'config.js'),`export const BUILD_MODE='production';\nexport const BUILD_VERSION=${JSON.stringify(version)};\n`);
  const urls=['/todo/','/todo/config.js',...assets.map(file=>'/todo/'+file)];
  const worker=`const CACHE='moa-todo-assets-${version}';
const ASSETS=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_TODO_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Only this app's static caches are touched. Keep old assets for existing tabs.
  const keys=(await caches.keys()).filter(key=>key.startsWith('moa-todo-assets-'));
  for(const key of keys.slice(0,-3))if(key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/todo/'))return;
  if(!ASSETS.includes(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>await cache.match(url.pathname)||fetch(event.request)));
});\n`;
  await writeFile(join(out,'sw.js'),worker);return {out,version,assets:urls.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // dist is generated only; rebuilding never touches browser data or GROUP files.
  await rm(join(root,'dist'),{recursive:true,force:true});console.log(await build());
}
