import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeAttendance,nextAttendanceId} from '../attendance.js';
import {snapshot,restore} from '../scripts/database.js';
test('Admin-only task hard deletion and personal attendance calendar/edit/delete; leave registration follows director approval',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-admin-attendance-'));process.env.DATA_DIR=join(dir,'live');process.env.OFFICE_IP='220.120.152.40';process.env.TRUSTED_PROXY_IPS='';
 const {server,addUser}=await import('../server.js');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const db=new DatabaseSync(join(dir,'live','group.db'));db.exec('PRAGMA foreign_keys=ON');
 async function call(path,cookie,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const type=r.headers.get('content-type');return {status:r.status,data:type?.includes('json')?await r.json():await r.text(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
 for(const [login,role] of [['soltec@elsoltec.com','employee'],['staff','employee'],['other','employee'],['director','manager'],['ceo','ceo']])addUser(login,login,role,'admin-attendance-test-123');
 db.prepare("UPDATE users SET role='employee' WHERE login='soltec@elsoltec.com'").run();
 const cookies={};for(const login of ['soltec@elsoltec.com','staff','other','director','ceo'])cookies[login]=(await call('login','',{login,password:'admin-attendance-test-123'})).cookie;
 const admin=cookies['soltec@elsoltec.com'],staff=cookies.staff,director=cookies.director,ceo=cookies.ceo,staffId=db.prepare("SELECT id FROM users WHERE login='staff'").get().id;
 // A non-approver Admin can delete; roles alone never grant deletion.
 const project=(await call('projects',staff,{title:'삭제 검증',start_date:'2026-11-01',end_date:'2026-11-30',description:''})).data.id;
 const task=(await call(`projects/${project}/tasks`,staff,{title:'공정과 기록 전체 삭제',assignee_id:staffId,start_date:'2026-11-01',end_date:'2026-11-03'})).data.id;
 assert.equal((await call(`project-tasks/${task}/completion`,staff,{date:'2026-11-01',completed:true,version:1})).status,200);
 assert.equal((await call(`project-tasks/${task}/update`,staff,{end_date:'2026-11-04',change_reason:'일정 검토 연장',notes:'기록 삭제 대상',work_date:'2026-11-01',version:2})).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM project_updates WHERE task_id=?').get(task).n,3);
 for(const cookie of [staff,director,ceo])assert.equal((await call(`project-tasks/${task}/delete`,cookie,{confirm:true,version:3})).status,403);
 assert.equal((await call(`project-tasks/${task}/delete`,'',{confirm:true,version:3})).status,401);
 assert.equal((await call(`project-tasks/${task}/delete`,admin,{confirm:false,version:3})).status,400);
 assert.equal((await call(`project-tasks/${task}/delete`,admin,{confirm:true,version:2})).status,409);
 const audits=db.prepare('SELECT count(*) n FROM account_audit').get().n,changes=db.prepare('SELECT count(*) n FROM project_changes').get().n;
 assert.equal((await call(`project-tasks/${task}/delete`,admin,{confirm:true,version:3})).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM project_updates WHERE task_id=?').get(task).n,0);assert.equal(db.prepare('SELECT id FROM project_tasks WHERE id=?').get(task),undefined);
 assert.equal(db.prepare('SELECT count(*) n FROM account_audit').get().n,audits);assert.equal(db.prepare('SELECT count(*) n FROM project_changes').get().n,changes);
 let projects=(await call('projects',staff)).data;assert.equal(projects[0].tasks.length,0);assert.equal(projects[0].history.length,0);
 const nextTask=(await call(`projects/${project}/tasks`,staff,{title:'남길 공정',assignee_id:staffId,start_date:'2026-11-01',end_date:'2026-11-01'})).data.id;assert.ok(nextTask>task);assert.equal((await call(`project-tasks/${task}/delete`,admin,{confirm:true,version:1})).status,404);
 // Seed an existing attendance record; registration remains restricted to the office.
 const attendance=Number(db.prepare('INSERT INTO attendance(user_id,day,clock_in,clock_out,ip) VALUES(?,?,?,?,?)').run(staffId,'2026-11-02','2026-11-02T00:00:00.000Z','2026-11-02T09:00:00.000Z','220.120.152.40').lastInsertRowid);
 for(const cookie of [admin,staff])assert.equal((await call('attendance',cookie,{action:'in'})).status,403);
 assert.equal((await call('attendance/calendar?month=2026-11','')).status,401);
 assert.equal((await call('attendance/calendar?month=2026-13',staff)).status,400);
 const adminId=db.prepare("SELECT id FROM users WHERE login='soltec@elsoltec.com'").get().id;
 assert.equal((await call(`attendance/calendar?month=2026-11&user_id=${adminId}`,staff)).status,403);
 assert.equal((await call(`attendance/export?month=2026-11&user_id=${staffId}`,director)).status,403);
 let calendar=(await call('attendance/calendar?month=2026-11',staff)).data;assert.equal(calendar.users.length,1);assert.equal(calendar.can_manage,false);assert.equal(calendar.records.length,1);assert.equal(calendar.records[0].ip,undefined);
 calendar=(await call(`attendance/calendar?month=2026-11&user_id=${staffId}`,admin)).data;assert.equal(calendar.users.length,5);assert.equal(calendar.can_manage,true);
 for(const cookie of [staff,director,ceo]){assert.equal((await call(`attendance/${attendance}/update`,cookie,{clock_in:'2026-11-02T08:30',clock_out:'2026-11-02T18:30',version:1})).status,403);assert.equal((await call(`attendance/${attendance}/delete`,cookie,{confirm:true,version:1})).status,403);}
 for(const body of [{clock_in:'2026-11-02T18:30',clock_out:'2026-11-02T08:30'},{clock_in:'2026-11-03T09:00',clock_out:''},{clock_in:'2026-02-30T09:00',clock_out:''},{clock_in:'2026-11-02T25:00',clock_out:''}])assert.equal((await call(`attendance/${attendance}/update`,admin,{...body,version:1})).status,400);
 assert.equal((await call(`attendance/${attendance}/update`,admin,{clock_in:'2026-11-02T08:30:15',clock_out:'2026-11-02T18:30:45',version:1})).status,200);
 let row=db.prepare('SELECT * FROM attendance WHERE id=?').get(attendance);assert.equal(row.clock_in,'2026-11-01T23:30:15.000Z');assert.equal(row.clock_out,'2026-11-02T09:30:45.000Z');assert.equal(row.version,2);assert.equal(row.ip,'220.120.152.40');
 assert.equal((await call(`attendance/${attendance}/update`,admin,{clock_in:'2026-11-02T09:00',clock_out:'',version:1})).status,409);
 assert.equal((await call(`attendance/${attendance}/update`,admin,{clock_in:'2026-11-02T23:00',clock_out:'2026-11-03T06:00',version:2})).status,200);
 assert.equal((await call(`attendance/${attendance}/update`,admin,{clock_in:'2026-11-02T09:00',clock_out:'',version:3})).status,200);row=db.prepare('SELECT * FROM attendance WHERE id=?').get(attendance);assert.equal(row.clock_out,null);
 const csv=await call(`attendance/export?month=2026-11&user_id=${staffId}`,admin);assert.equal(csv.status,200);assert.match(csv.data,/2026-11-02 09:00:00/);
 // Leave appears immediately after the director signs; no reason is exposed in calendars.
 const leaveBody={kind:'연차',start:'2026-11-02',end:'2026-11-03',reason:'민감한 휴가 사유'};
 const leave=(await call('leaves',staff,leaveBody)).data.id;
 assert.equal((await call('attendance/calendar?month=2026-11',staff)).data.leaves.length,0);
 await call(`leaves/${leave}/action`,director,{action:'approve'});
 for(const path of ['attendance/calendar?month=2026-11','schedules?month=2026-11','calendar?month=2026-11']){const result=(await call(path,staff)).data;const rows=Array.isArray(result)?result:result.leaves;assert.equal(rows.length,1);assert.equal(rows[0].reason,undefined);}
 assert.equal((await call('attendance/calendar?month=2026-11',cookies.other)).data.leaves.length,0);
 await call(`leaves/${leave}/action`,ceo,{action:'reject'});assert.equal((await call('attendance/calendar?month=2026-11',staff)).data.leaves.length,0);assert.equal((await call('schedules?month=2026-11',staff)).data.leaves.length,0);
 const deletedLeave=(await call('leaves',staff,leaveBody)).data.id;await call(`leaves/${deletedLeave}/action`,director,{action:'approve'});assert.equal((await call(`leaves/${deletedLeave}/delete`,staff,{confirm:true})).status,200);assert.equal((await call('attendance/calendar?month=2026-11',staff)).data.leaves.length,0);
 const finalLeave=(await call('leaves',staff,{...leaveBody,kind:'오전 반차',end:leaveBody.start})).data.id;await call(`leaves/${finalLeave}/action`,director,{action:'approve'});await call(`leaves/${finalLeave}/action`,ceo,{action:'approve'});assert.equal((await call('attendance/calendar?month=2026-11',staff)).data.leaves[0].kind,'오전 반차');
 assert.equal((await call(`attendance/${attendance}/delete`,admin,{confirm:false,version:4})).status,400);assert.equal((await call(`attendance/${attendance}/delete`,admin,{confirm:true,version:1})).status,409);assert.equal((await call(`attendance/${attendance}/delete`,admin,{confirm:true,version:4})).status,200);assert.equal((await call('attendance/calendar?month=2026-11',staff)).data.records.length,0);assert.equal(db.prepare('SELECT id FROM attendance WHERE id=?').get(attendance),undefined);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 await snapshot(join(dir,'live','group.db'),join(dir,'backup.db'));await restore(join(dir,'backup.db'),join(dir,'restore'));const restored=new DatabaseSync(join(dir,'restore','group.db'));try{assert.equal(restored.prepare('SELECT count(*) n FROM project_updates WHERE task_id=?').get(task).n,0);assert.equal(restored.prepare('SELECT count(*) n FROM attendance').get().n,0);assert.equal(restored.prepare('SELECT count(*) n FROM leave_requests WHERE id=?').get(finalLeave).n,1);}finally{restored.close();}
 }finally{db.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('attendance migration keeps existing times and assigns non-reused identifiers after deletion',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE attendance(id INTEGER PRIMARY KEY,user_id INTEGER,day TEXT,clock_in TEXT,clock_out TEXT,ip TEXT);INSERT INTO attendance VALUES(7,1,'2026-11-02','2026-11-02T00:00:00.000Z',NULL,'220.120.152.40');");initializeAttendance(db);initializeAttendance(db);const row=db.prepare('SELECT * FROM attendance WHERE id=7').get();assert.equal(row.version,1);assert.equal(row.clock_in,'2026-11-02T00:00:00.000Z');assert.equal(row.clock_out,null);assert.equal(row.ip,'220.120.152.40');assert.equal(nextAttendanceId(db),8);db.exec('DELETE FROM attendance');assert.equal(nextAttendanceId(db),9);}finally{db.close();}
});
