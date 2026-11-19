const CACHE='moa-todo-assets-bd10f998af29c575';
const ASSETS=["/todo/","/todo/config.js","/todo/assets/icon-192.png","/todo/assets/icon-512.png","/todo/assets/icon.svg","/todo/index.html","/todo/manifest.webmanifest","/todo/src/data/contracts.js","/todo/src/data/indexed-db.js","/todo/src/domain/model.js","/todo/src/domain/service.js","/todo/src/main.js","/todo/src/pwa.js","/todo/src/ui/app.js","/todo/src/ui/dom.js","/todo/styles.css"];
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
});
