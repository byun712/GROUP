import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,taskInput} from './helpers.mjs';
import {selectTasks,subtaskSummary,projectSummary,LEGACY_STORES} from '../src/domain/model.js';
import {validateBackup} from '../src/domain/service.js';

test('one-level subtasks inherit and atomically follow parent affiliations, without duplicate progress',async()=>{
  const {service}=setup(),p=await service.saveProject({name:'A'}),q=await service.saveProject({name:'B'}),process=await service.saveProcess({name:'공정',projectId:p.id});
  let parent=await service.saveTask({...taskInput,projectId:p.id,processId:process.id});
  const child=await service.saveTask({title:'하위',parentId:parent.id,projectId:q.id}),second=await service.saveTask({title:'둘째',parentId:parent.id,status:'done'});
  assert.equal(child.projectId,p.id);assert.equal(child.processId,process.id);
  await assert.rejects(()=>service.saveTask({title:'중첩',parentId:child.id}),/한 단계/);
  await assert.rejects(()=>service.saveTask({...parent,parentId:parent.id},parent.version),/상위/);
  assert.deepEqual(projectSummary(await service.snapshot(),p.id),{total:1,completed:0,percent:0});
  assert.deepEqual(subtaskSummary(await service.snapshot(),parent.id),{total:2,completed:1,percent:50});
  await service.saveTask({...child,status:'done'},child.version);assert.equal((await service.snapshot()).tasks.find(t=>t.id===parent.id).status,'todo');
  parent=await service.saveTask({...parent,projectId:q.id,processId:null},parent.version);const data=await service.snapshot();
  assert.ok(data.tasks.filter(t=>t.parentId).every(t=>t.projectId===q.id&&t.processId===null));
  assert.equal(projectSummary(data,p.id).percent,null);assert.equal(selectTasks(data,{includeCompleted:true}).length,1);
  await assert.rejects(()=>service.saveTask({...second,title:'낡은 창'},second.version),/다른 창/);
});
test('parent deletion cascades children and their logs, preserves unrelated work',async()=>{
  const {service}=setup(),parent=await service.saveTask(taskInput),child=await service.saveTask({title:'하위',parentId:parent.id}),other=await service.saveTask({...taskInput,title:'다른 업무'});
  for(const task of [parent,child,other])await service.saveWorkLog({taskId:task.id,workDate:'2026-11-19',content:task.title});
  await service.deleteTask(parent.id,parent.version);const data=await service.snapshot();assert.deepEqual(data.tasks.map(t=>t.id),[other.id]);assert.deepEqual(data.workLogs.map(t=>t.taskId),[other.id]);
});
test('combined local filters have identical membership for list, board and calendar',async()=>{
  const {service}=setup(),profile=await service.saveProfile({name:'로컬 이름'}),project=await service.saveProject({name:'P'}),process=await service.saveProcess({name:'X',projectId:project.id});
  const good=await service.saveTask({...taskInput,title:'설계 검토',status:'doing',priority:'high',tags:['검토','검토'],assigneeId:profile.id,projectId:project.id,processId:process.id,dueDate:'2026-11-20'});
  await service.saveTask({...taskInput,title:'다른 업무'});await service.saveTask({title:'하위',parentId:good.id});
  const prefs={search:'설계',status:'doing',priority:'high',projectId:project.id,processId:process.id,assigneeId:'me',tag:'검토',due:'range',dueFrom:'2026-11-19',dueTo:'2026-11-21'};
  const data=await service.snapshot();for(const kind of ['list','board','calendar'])assert.deepEqual(selectTasks(data,{...prefs,kind}).map(t=>t.id),[good.id]);
  assert.equal(selectTasks(data,{...prefs,dueFrom:'2026-11-21'}).length,0);assert.equal(selectTasks(data,{due:'none',assigneeId:'none'}).length,1);
  assert.deepEqual(good.tags,['검토']);await assert.rejects(()=>service.saveTask({...good,assigneeId:'missing'},good.version),/담당자/);
});
test('saved views contain conditions only and respond to current tasks; grouping is explicit',async()=>{
  const {service}=setup();let task=await service.saveTask({...taskInput,priority:'high'});let view=await service.saveView({name:'높은 우선순위',preferences:{priority:'high',kind:'board'}});
  assert.equal(view.preferences.groupBy,'status');assert.equal((await service.snapshot()).tasks.length,1);assert.equal(selectTasks(await service.snapshot(),view.preferences).length,1);
  task=await service.saveTask({...task,priority:'low'},task.version);assert.equal(selectTasks(await service.snapshot(),view.preferences).length,0);
  view=await service.saveView({...view,preferences:{kind:'calendar'}},view.version);assert.equal(view.preferences.groupBy,'date');
  await service.deleteDefinition('savedViews',view.id,view.version);assert.equal((await service.snapshot()).tasks[0].id,task.id);
});
test('templates create independent IDs, reset state and dates, and copy no work logs',async()=>{
  const {service}=setup(),template=await service.saveTemplate({name:'릴리스',title:'배포 검토',description:'첫 줄\n둘째 줄',priority:'high',tags:['배포'],subtasks:['테스트','검토']});
  const first=await service.createFromTemplate(template.id,{dueDate:'2026-11-20'});await service.saveTask({...first,status:'done'},first.version);await service.saveWorkLog({taskId:first.id,workDate:'2026-11-19',content:'실제 수행 내용'});
  const second=await service.createFromTemplate(template.id);const data=await service.snapshot(),children=data.tasks.filter(t=>t.parentId===second.id);
  assert.equal(new Set(data.tasks.map(t=>t.id)).size,6);assert.notEqual(first.id,second.id);assert.equal(second.status,'todo');assert.equal(second.completedAt,null);assert.equal(second.dueDate,null);assert.equal(children.length,2);assert.ok(children.every(t=>t.status==='todo'&&t.completedAt===null));assert.equal(data.workLogs.length,1);assert.equal(data.workLogs[0].taskId,first.id);
});
test('atomic write failure preserves parent and children affiliations and rejects incomplete templates',async()=>{
  const {service,provider}=setup(),a=await service.saveProject({name:'A'}),b=await service.saveProject({name:'B'}),parent=await service.saveTask({...taskInput,projectId:a.id});await service.saveTask({title:'하위',parentId:parent.id});
  const before=await service.snapshot();provider.fail=true;await assert.rejects(()=>service.saveTask({...parent,projectId:b.id},parent.version));assert.deepEqual(await service.snapshot(),before);provider.fail=false;
  await assert.rejects(()=>service.saveTemplate({name:'잘못된 예시',title:'T',subtasks:['']}));assert.equal((await service.snapshot()).templates.length,0);
});
test('v1 backups preserve original values and IDs with additive defaults; v2 backups round-trip new models',async()=>{
  const {service}=setup();await service.seedExamples();const export2=await service.exportBackup();
  const legacy={...export2,schemaVersion:1,data:Object.fromEntries(LEGACY_STORES.map(k=>[k,structuredClone(export2.data[k])]))};
  for(const t of legacy.data.tasks){delete t.parentId;delete t.tags;delete t.assigneeId;}
  const restored=setup();await restored.service.restoreBackup(legacy);const upgraded=await restored.service.snapshot();
  for(const old of legacy.data.tasks){const t=upgraded.tasks.find(t=>t.id===old.id);for(const key of Object.keys(old))assert.deepEqual(t[key],old[key]);assert.equal(t.parentId,null);assert.deepEqual(t.tags,[]);}
  await restored.service.saveProfile({name:'로컬'});await restored.service.saveView({name:'보드',preferences:{kind:'board'}});await restored.service.saveTemplate({name:'템플릿',title:'업무'});
  const backup=await restored.service.exportBackup();assert.equal(backup.schemaVersion,2);const copy=setup();await copy.service.restoreBackup(backup);assert.deepEqual(await copy.service.snapshot(),backup.data);
});
test('backup validation rejects cycles, nested parents, mismatched inheritance and unknown local assignees',async()=>{
  const {service}=setup(),p=await service.saveProject({name:'P'}),parent=await service.saveTask({...taskInput,projectId:p.id});await service.saveTask({title:'하위',parentId:parent.id});
  const backup=await service.exportBackup();for(const corrupt of [d=>{d.tasks[0].parentId=d.tasks[0].id;},d=>{d.tasks[0].parentId=d.tasks[1].id;},d=>{d.tasks[1].projectId=null;},d=>{d.tasks[1].assigneeId='invalid';}]){const bad=structuredClone(backup);corrupt(bad.data);assert.throws(()=>validateBackup(bad));}
});
