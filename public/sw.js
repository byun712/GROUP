// Never cache employee records, authentication responses or enrollment secrets.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><title>연결 확인</title><h1>인터넷 연결을 확인해 주세요.</h1><p>업무 기록 보호를 위해 오프라인에서는 그룹웨어를 사용할 수 없습니다.</p><a href="/">다시 연결</a></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
