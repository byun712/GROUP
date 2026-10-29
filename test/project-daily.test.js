import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeProjects} from '../projects.js';
test('daily completion is independent, cumulative, versioned, and recalculated on schedule changes without work-log noise',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-daily-'));process.env.DATA_DIR=dir;
 const {server,addUser}=await import('../test-support/server.js');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,cookie,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
 addUser('owner','등록자','employee','daily-test-123');addUser('other','협업자','employee','daily-test-123');
 const owner=(await call('login','',{login:'owner',password:'daily-test-123'})).cookie,other=(await call('login','',{login:'other',password:'daily-test-123'})).cookie;
 const project=(await call('projects',owner,{title:'일자별 프로젝트',start_date:'2026-11-01',end_date:'2026-12-31',description:''})).data.id;
 const task=(await call(`projects/${project}/tasks`,owner,{title:'설계',assignee_id:1,start_date:'2026-11-01',end_date:'2026-11-04'})).data.id;
 const get=async()=> (await call('projects',owner)).data.find(p=>p.id===project);
 let p=await get();assert.equal(p.tasks[0].total_days,4);assert.equal(p.history.length,1);
 for(const [date,version,progress] of [['2026-11-01',1,25],['2026-11-02',2,50]]){assert.equal((await call(`project-tasks/${task}/completion`,other,{date,completed:true,version})).status,200);p=await get();assert.equal(p.tasks[0].progress,progress);}
 assert.deepEqual(p.tasks[0].completed_dates,['2026-11-01','2026-11-02']);assert.equal(p.history.length,1);
 assert.equal((await call(`project-tasks/${task}/completion`,owner,{date:'2026-11-03',completed:true,version:1})).status,409);
 assert.equal((await call(`project-tasks/${task}/completion`,owner,{date:'2026-11-05',completed:true,version:3})).status,400);
 assert.equal((await call(`project-tasks/${task}/completion`,owner,{date:'2026-11-03',completed:'true',version:3})).status,400);
 assert.equal((await call(`project-tasks/${task}/completion`,owner,{date:'2026-11-01',completed:false,version:3})).status,200);
 p=await get();assert.equal(p.tasks[0].progress,25);assert.deepEqual(p.tasks[0].completed_dates,['2026-11-02']);assert.equal(p.history.length,1);
 assert.equal((await call(`project-tasks/${task}/update`,other,{end_date:'2026-11-05',version:4})).status,400);
 assert.equal((await call(`project-tasks/${task}/update`,other,{end_date:'2026-11-05',change_reason:'고객 요청으로 1일 연장',work_date:'2026-11-02',notes:'설계 초안 완료',version:4})).status,200);
 p=await get();assert.equal(p.tasks[0].progress,20);assert.equal(p.history.length,3);assert.equal(p.history.find(h=>h.kind==='work').work_date,'2026-11-02');const change=p.history.find(h=>h.kind==='schedule');assert.equal(change.notes,'고객 요청으로 1일 연장');assert.equal(change.before_end,'2026-11-04');assert.equal(change.after_end,'2026-11-05');
 // Shorten away a checked day; its check stops counting, but is preserved for a restored range.
 assert.equal((await call(`project-tasks/${task}/update`,owner,{start_date:'2026-11-03',end_date:'2026-11-05',change_reason:'착수일 조정',version:5})).status,200);
 p=await get();assert.equal(p.tasks[0].progress,0);assert.deepEqual(p.tasks[0].completed_dates,[]);
 assert.equal((await call(`project-tasks/${task}/update`,owner,{start_date:'2026-11-01',end_date:'2026-11-05',change_reason:'원래 착수일 복원',version:6})).status,200);
 p=await get();assert.equal(p.tasks[0].progress,20);assert.deepEqual(p.tasks[0].completed_dates,['2026-11-02']);
 let version=7;for(const date of ['2026-11-01','2026-11-03','2026-11-04','2026-11-05'])assert.equal((await call(`project-tasks/${task}/completion`,owner,{date,completed:true,version:version++})).status,200);
 p=await get();assert.equal(p.tasks[0].progress,100);assert.equal(p.tasks[0].status,'done');assert.equal(p.tasks[0].completed_days,5);assert.equal(p.history.length,5);
 assert.equal((await call(`project-tasks/${task}/update`,other,{end_date:'2026-11-06',change_reason:'추가 검증일',version})).status,200);p=await get();assert.equal(p.tasks[0].progress,83);assert.equal(p.tasks[0].status,'doing');
 assert.equal((await call(`project-tasks/${task}/completion`,'',{date:'2026-11-06',completed:true,version:version+1})).status,401);
 } finally {await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
test('legacy task migration preserves completed tasks and work notes and runs only once',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE customers(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE projects(id INTEGER PRIMARY KEY,title TEXT,customer_id INTEGER,owner_id INTEGER,start_date TEXT,end_date TEXT,status TEXT,description TEXT,created TEXT,version INTEGER);INSERT INTO projects VALUES(1,'기존',NULL,1,'2026-11-01','2026-11-30','active','','2026-11-01',1);CREATE TABLE project_tasks(id INTEGER PRIMARY KEY,project_id INTEGER,title TEXT,assignee_id INTEGER,week_start TEXT,status TEXT,progress INTEGER,version INTEGER,start_date TEXT,end_date TEXT);INSERT INTO project_tasks VALUES(1,1,'완료',1,'2026-11-02','done',100,3,'2026-11-03','2026-11-05');INSERT INTO project_tasks VALUES(2,1,'진행',1,'2026-11-02','doing',50,4,'2026-11-03','2026-11-06');");
 initializeProjects(db);initializeProjects(db);const rows=db.prepare('SELECT * FROM project_tasks ORDER BY id').all();assert.deepEqual(JSON.parse(rows[0].completed_dates),['2026-11-03','2026-11-04','2026-11-05']);assert.equal(rows[0].progress,100);assert.equal(rows[0].version,3);assert.deepEqual(JSON.parse(rows[1].completed_dates),['2026-11-03','2026-11-04']);assert.equal(db.prepare('SELECT count(*) n FROM project_updates').get().n,0);
 }finally{db.close();}
});
