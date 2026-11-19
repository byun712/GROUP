import {openDatabase,IndexedDbProvider} from './data/indexed-db.js';
import {TodoService} from './domain/service.js';
import {TodoApp} from './ui/app.js';
import {configurePwa} from './pwa.js';
let app;
try{
  const db=await openDatabase(undefined,{onBlocked:()=>{document.querySelector('#app').textContent='다른 ToDo 창에서 저장소를 사용하고 있습니다. 다른 창을 닫으면 계속 진행합니다.';},onVersionChange:()=>app?.message('다른 창에서 저장소가 업데이트되었습니다. 작성 중인 내용을 복사해 보관한 뒤 새로고침해 주세요.',true)});
  const channel='BroadcastChannel' in window?new BroadcastChannel('group-todo-local-changes'):null;
  const service=new TodoService(new IndexedDbProvider(db),{onChange:()=>channel?.postMessage({type:'changed'})});app=new TodoApp(service);await app.start();
  channel?.addEventListener('message',()=>app.refresh({external:true}).catch(error=>app.fail(error)));
  await configurePwa(app);
}catch(error){
  const target=document.querySelector('#app');target.replaceChildren();const heading=document.createElement('h1'),description=document.createElement('p'),retry=document.createElement('button');heading.textContent='작업 공간을 열지 못했습니다';description.textContent='기존 데이터를 지우지 않았습니다. 브라우저 저장소 권한과 다른 창을 확인해 주세요. '+error.message;retry.textContent='다시 시도';retry.onclick=()=>location.reload();target.className='boot-message';target.append(heading,description,retry);
}
