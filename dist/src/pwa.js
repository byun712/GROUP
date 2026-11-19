import {BUILD_MODE} from '../config.js';
export async function configurePwa(app){
  const install=document.querySelector('#install-app'),state=document.querySelector('#runtime-state');let promptEvent,registration,applying=false;
  const onlineState=()=>state.textContent=navigator.onLine?'로컬 워크스페이스':'오프라인';window.addEventListener('online',onlineState);window.addEventListener('offline',onlineState);onlineState();
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;install.hidden=false;});
  window.addEventListener('appinstalled',()=>{install.hidden=true;promptEvent=null;app.message('앱이 설치되었습니다. 같은 브라우저 프로필의 로컬 데이터를 사용합니다.');});
  install.onclick=async()=>{if(!promptEvent)return;await promptEvent.prompt();await promptEvent.userChoice;promptEvent=null;install.hidden=true;};
  if(BUILD_MODE!=='production'){state.textContent='개발 모드 · 오프라인 캐시 꺼짐';return;}
  if(!('serviceWorker' in navigator)||!window.isSecureContext){app.message('서비스 워커는 HTTPS 또는 localhost에서 사용할 수 있습니다. 로컬 저장은 계속 사용할 수 있습니다.');return;}
  function showUpdate(){if(registration?.waiting&&navigator.serviceWorker.controller)document.querySelector('#update-notice').hidden=false;}
  let controller=navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    const previous=controller;controller=navigator.serviceWorker.controller;
    // The first activation is not an update. Only an explicit request reloads.
    if(applying&&!app.hasDrafts()&&!app.busy)location.reload();
    else if(previous&&previous!==controller)document.querySelector('#update-notice').hidden=false;
  });
  try{
    registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    registration.addEventListener('updatefound',()=>{const installing=registration.installing;installing?.addEventListener('statechange',()=>{if(installing.state==='installed'){if(registration.waiting)showUpdate();else state.textContent='오프라인 준비됨';}});});
    await navigator.serviceWorker.ready;state.textContent=navigator.onLine?'오프라인 준비됨':'오프라인';showUpdate();
    document.querySelector('#apply-update').onclick=async()=>{
      if(app.hasDrafts()||app.busy){app.message('작성 중인 내용을 먼저 저장하거나 취소해 주세요. 업데이트는 입력을 지우지 않습니다.',true);return;}
      if(registration.waiting){applying=true;registration.waiting.postMessage({type:'ACTIVATE_TODO_UPDATE'});}else location.reload();
    };

  }catch(error){app.message('오프라인 자산 준비에 실패했습니다. 연결을 확인하고 다시 열어 주세요. '+error.message,true);}
}
