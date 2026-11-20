import {STORES} from '../src/domain/model.js';
import {TodoService} from '../src/domain/service.js';
import {REPOSITORIES} from '../src/data/contracts.js';
export class MemoryProvider {
  data=Object.fromEntries(STORES.map(name=>[name,[]]));
  fail=false;
  async snapshot(){return structuredClone(this.data);}
  async transaction(names,work){
    const next=structuredClone(this.data),repos=Object.fromEntries(names.map(name=>[name,new REPOSITORIES[name]({list:async()=>structuredClone(next[name]),get:async id=>structuredClone(next[name].find(row=>row.id===id)),put:async record=>{if(this.fail)throw new Error('QuotaExceededError');const i=next[name].findIndex(row=>row.id===record.id);if(i<0)next[name].push(structuredClone(record));else next[name][i]=structuredClone(record);},delete:async id=>{next[name]=next[name].filter(row=>row.id!==id);}})]));
    const result=await work(repos);this.data=next;return result;
  }
}
export function setup(){const provider=new MemoryProvider();let id=0,time='2026-11-18T15:30:00.000Z';return {provider,service:new TodoService(provider,{id:()=>String(++id),now:()=>time}),setTime:value=>time=value};}
export const taskInput={title:'할 일',description:'여러 줄\n설명',priority:'medium',status:'todo',dueDate:null,projectId:null,processId:null};
