import {STORES,LEGACY_STORES,TASK_ADDITIONS} from '../domain/model.js';
import {REPOSITORIES} from './contracts.js';
export const DATABASE_NAME='group-todo-local';
export const DATABASE_VERSION=2;
// Schema changes are atomic; existing IDs, text, dates and relations are retained.
export function migrateDatabase(db,oldVersion,transaction){
  if(oldVersion<1)for(const name of LEGACY_STORES)db.createObjectStore(name,{keyPath:'id'});
  if(oldVersion<2){
    for(const name of ['savedViews','templates','profiles'])db.createObjectStore(name,{keyPath:'id'});
    const tasks=transaction.objectStore('tasks');
    for(const key of ['parentId','assigneeId'])tasks.createIndex(key,key,{unique:false});
    const cursor=tasks.openCursor();
    cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;entry.update({...structuredClone(TASK_ADDITIONS),...entry.value});entry.continue();};
  }
}
export function openDatabase(factory=globalThis.indexedDB,{onBlocked=()=>{},onVersionChange=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    if(!factory){reject(new Error('이 브라우저에서 IndexedDB를 사용할 수 없습니다. 일반 브라우저 창에서 다시 열어 주세요.'));return;}
    const request=factory.open(DATABASE_NAME,DATABASE_VERSION);
    request.onupgradeneeded=event=>{
      migrateDatabase(request.result,event.oldVersion,request.transaction);
      if(event.oldVersion<1){
        for(const [store,key] of [['processes','projectId'],['tasks','projectId'],['tasks','processId'],['tasks','dueDate'],['workLogs','taskId']])request.transaction.objectStore(store).createIndex(key,key,{unique:false});
      }
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>onBlocked();
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();onVersionChange();};resolve(db);};
  });
}
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
function repositories(transaction,names){
  return Object.fromEntries(names.map(name=>{
    const store=transaction.objectStore(name),driver={list:()=>requestResult(store.getAll()),get:id=>requestResult(store.get(id)),put:async record=>{await requestResult(store.put(record));},delete:async id=>{await requestResult(store.delete(id));}};
    return [name,new REPOSITORIES[name](driver)];
  }));
}
export class IndexedDbProvider {
  constructor(db){this.db=db;}
  async run(names,mode,work){
    const transaction=this.db.transaction(names,mode);
    const done=new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||new Error('저장 작업이 취소되었습니다.'));transaction.onerror=()=>{};});
    // Attach a handler immediately even if the callback fails before completion.
    done.catch(()=>{});
    try{const result=await work(repositories(transaction,names));await done;return result;}
    catch(error){try{transaction.abort();}catch{}await done.catch(()=>{});throw error;}
  }
  transaction(names,work){return this.run(names,'readwrite',work);}
  snapshot(){return this.run(STORES,'readonly',async repos=>Object.fromEntries(await Promise.all(STORES.map(async name=>[name,await repos[name].list()]))));}
  close(){this.db.close();}
}
