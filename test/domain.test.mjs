import test from 'node:test';
import assert from 'node:assert/strict';
import {TodoService,validateBackup} from '../src/domain/service.js';
import {STORES,todayInSeoul,shiftDate,dateOnly,selectTasks,DEFAULT_PREFERENCES,ConflictError} from '../src/domain/model.js';
import {REPOSITORIES} from '../src/data/contracts.js';
class MemoryProvider {
  data=Object.fromEntries(STORES.map(name=>[name,[]]));
  fail=false;
  async snapshot(){return structuredClone(this.data);}
  async transaction(names,work){
    const next=structuredClone(this.data),repos=Object.fromEntries(names.map(name=>[name,new REPOSITORIES[name]({list:async()=>structuredClone(next[name]),get:async id=>structuredClone(next[name].find(row=>row.id===id)),put:async record=>{if(this.fail)throw new Error('QuotaExceededError');const i=next[name].findIndex(row=>row.id===record.id);if(i<0)next[name].push(structuredClone(record));else next[name][i]=structuredClone(record);},delete:async id=>{next[name]=next[name].filter(row=>row.id!==id);}})]));
    const result=await work(repos);this.data=next;return result;
  }
}
function setup(){const provider=new MemoryProvider();let id=0,time='2026-11-18T15:30:00.000Z';return {provider,service:new TodoService(provider,{id:()=>String(++id),now:()=>time}),setTime:value=>time=value};}
const taskInput={title:'할 일',description:'여러 줄\n설명',priority:'medium',status:'todo',dueDate:null,projectId:null,processId:null};
test('Korean day boundaries and date-only values do not drift across UTC or leap days',()=>{
  assert.equal(todayInSeoul(new Date('2026-11-18T14:59:59Z')),'2026-11-18');assert.equal(todayInSeoul(new Date('2026-11-18T15:00:00Z')),'2026-11-19');
  assert.equal(shiftDate('2024-02-28',1),'2024-02-29');assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.equal(dateOnly('2026-11-19'),'2026-11-19');assert.equal(dateOnly('',true),null);
  for(const bad of ['2025-02-29','2026-13-01','2026-00-10','2026-02-31','2026-1-1','1899-12-31'])assert.throws(()=>dateOnly(bad));
});
test('completion stores a real instant, repeated save preserves it, restore clears it without fabricated work',async()=>{
  const {service,setTime}=setup();let task=await service.saveTask(taskInput);assert.equal(task.completedAt,null);
  task=await service.saveTask({...task,status:'done'},task.version);assert.equal(task.completedAt,'2026-11-18T15:30:00.000Z');setTime('2026-11-19T00:00:00.000Z');
  task=await service.saveTask({...task,title:'완료 항목 수정'},task.version);assert.equal(task.completedAt,'2026-11-18T15:30:00.000Z');task=await service.saveTask({...task,status:'doing'},task.version);assert.equal(task.completedAt,null);assert.equal((await service.snapshot()).workLogs.length,0);
  task=await service.saveTask({...task,status:'done'},task.version);assert.equal(task.completedAt,'2026-11-19T00:00:00.000Z');
});
test('projects, processes and personal tasks preserve relationships, with linked deletion guarded',async()=>{
  const {service}=setup();const a=await service.saveProject({name:'A'}),b=await service.saveProject({name:'B'}),process=await service.saveProcess({name:'공정',projectId:a.id});
  await assert.rejects(()=>service.saveTask({...taskInput,projectId:b.id,processId:process.id}),/소속|속한/);
  await assert.rejects(()=>service.saveTask({...taskInput,processId:process.id}),/공정/);
  const task=await service.saveTask({...taskInput,projectId:a.id,processId:process.id});assert.equal(task.processId,process.id);
  await assert.rejects(()=>service.deleteReference('processes',process.id,process.version),/연결/);await assert.rejects(()=>service.deleteReference('projects',a.id,a.version),/연결/);
  await service.saveTask({...task,projectId:null,processId:null},task.version);await service.deleteReference('processes',process.id,process.version);await service.deleteReference('projects',a.id,a.version);
  assert.equal((await service.snapshot()).tasks.length,1);
});
test('work logs retain task ownership through edits; deleting a task cascades only its logs',async()=>{
  const {service}=setup(),a=await service.saveTask(taskInput),b=await service.saveTask({...taskInput,title:'B'});const log=await service.saveWorkLog({taskId:a.id,workDate:'2026-11-19',content:'첫 줄\n\n한글 ΔP <script> & 이모지 👩‍💻'});
  await service.saveWorkLog({taskId:a.id,workDate:'2026-11-19',content:'두 번째 기록'});const other=await service.saveWorkLog({taskId:b.id,workDate:'2026-11-20',content:'다른 할 일의 기록'});
  await assert.rejects(()=>service.saveWorkLog({...log,taskId:b.id},log.version),/옮길 수/);
  await service.saveWorkLog({...log,content:'내용 수정\n두 줄'},log.version);await service.deleteTask(a.id,a.version);assert.deepEqual((await service.snapshot()).workLogs.map(row=>row.id),[other.id]);
  await assert.rejects(()=>service.saveWorkLog({taskId:a.id,workDate:'2026-11-19',content:'삭제된 작업'}),/존재하지/);
});
test('stale task and log writes reject rather than overwrite another tab',async()=>{
  const {service}=setup(),task=await service.saveTask(taskInput);await service.saveTask({...task,title:'다른 탭 변경'},task.version);
  await assert.rejects(()=>service.saveTask({...task,title:'덮어쓰기'},task.version),ConflictError);await assert.rejects(()=>service.deleteTask(task.id,task.version),ConflictError);
  const log=await service.saveWorkLog({taskId:task.id,workDate:'2026-11-19',content:'업무'});await service.saveWorkLog({...log,content:'다른 탭 기록'},log.version);await assert.rejects(()=>service.deleteWorkLog(log.id,log.version),ConflictError);
  assert.equal((await service.snapshot()).tasks[0].title,'다른 탭 변경');
});
test('views, overdue grouping, search, priority and deterministic sorting use the full local snapshot',()=>{
  const rows=[['a','todo','2026-11-18','high',null],['b','doing','2026-11-19','low','p'],['c','todo','2026-11-21','medium','p'],['d','done','2026-11-19','high','p'],['e','todo',null,'none',null]].map(([id,status,dueDate,priority,projectId])=>({...taskInput,id,title:id==='b'?'한글 제목':id,description:id==='a'?'찾을 설명':'',createdAt:'2026-11-19T00:00:00Z',updatedAt:'2026-11-19T00:00:00Z',status,dueDate,priority,projectId})),snapshot={tasks:rows};
  const selected=prefs=>selectTasks(snapshot,{...DEFAULT_PREFERENCES,...prefs},'2026-11-19').map(t=>t.id);
  assert.deepEqual(selected({}),['a','b','c','e']);assert.deepEqual(selected({view:'today'}),['a','b']);assert.deepEqual(selected({view:'upcoming'}),['c']);assert.deepEqual(selected({view:'done'}),['d']);assert.deepEqual(selected({view:'projects',projectId:'p'}),['b','c']);assert.deepEqual(selected({view:'projects',projectId:'personal'}),['a','e']);
  assert.deepEqual(selected({includeCompleted:true,status:'done'}),['d']);assert.deepEqual(selected({search:'찾을 설명'}),['a']);assert.deepEqual(selected({search:'한글',status:'doing'}),['b']);assert.deepEqual(selected({priority:'high'}),['a']);assert.deepEqual(selected({sort:'priority'}),['a','c','b','e']);assert.deepEqual(selected({sort:'due'}),['a','b','c','e']);assert.equal(rows.length,5);
});
test('write failure leaves the stored state unchanged and permits retry with the same input',async()=>{
  const {provider,service}=setup();const task=await service.saveTask(taskInput),input={...task,title:'보존할 입력'};provider.fail=true;await assert.rejects(()=>service.saveTask(input,task.version),/Quota/);assert.equal(input.title,'보존할 입력');assert.equal((await service.snapshot()).tasks[0].title,'할 일');provider.fail=false;await service.saveTask(input,task.version);assert.equal((await service.snapshot()).tasks[0].title,'보존할 입력');
});
test('examples are opt-in, marked and never regenerated on reads or after deletion',async()=>{
  const {service}=setup();assert.equal((await service.snapshot()).tasks.length,0);await service.seedExamples();let data=await service.snapshot();assert.equal(data.tasks.length,6);assert.ok(data.tasks.every(t=>t.sample));assert.equal(data.workLogs.length,2);assert.equal(data.settings[0].onboarded,true);
  await assert.rejects(()=>service.seedExamples(),/비어/);for(const task of data.tasks)await service.deleteTask(task.id,task.version);data=await service.snapshot();assert.equal(data.tasks.length,0);assert.equal((await service.snapshot()).tasks.length,0);assert.equal(data.settings[0].onboarded,true);
});
test('backups round-trip without data loss; future schema, duplicates and orphan relationships are rejected atomically',async()=>{
  const {service}=setup();await service.seedExamples();const backup=await service.exportBackup(),copy=setup();await copy.service.restoreBackup(JSON.parse(JSON.stringify(backup)));assert.deepEqual(await copy.service.snapshot(),backup.data);
  const invalids=[];let bad=structuredClone(backup);bad.schemaVersion=999;invalids.push(bad);bad=structuredClone(backup);bad.data.tasks.push(bad.data.tasks[0]);invalids.push(bad);bad=structuredClone(backup);bad.data.workLogs[0].taskId='missing';invalids.push(bad);bad=structuredClone(backup);bad.data.processes[0].projectId='missing';invalids.push(bad);bad=structuredClone(backup);bad.data.tasks[0].completedAt=backup.exportedAt;invalids.push(bad);
  for(const invalid of invalids){assert.throws(()=>validateBackup(invalid));await assert.rejects(()=>copy.service.restoreBackup(invalid));assert.deepEqual(await copy.service.snapshot(),backup.data);}
  await copy.service.reset();assert.equal((await copy.service.snapshot()).tasks.length,0);
});
