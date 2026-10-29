import {check,text,date,transaction,InputError} from './business-common.js';
const dayCount=(start,end)=>Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
const taskDays=(start,end)=>Array.from({length:dayCount(start,end)},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10));
function taskCompletion(t){const completed=JSON.parse(t.completed_dates||'[]').filter(d=>d>=t.start_date&&d<=t.end_date),total=dayCount(t.start_date,t.end_date);const progress=completed.length===total?100:Math.min(99,Math.round(completed.length/total*100));return {completed_dates:completed,total_days:total,completed_days:completed.length,progress,status:completed.length===total?'done':completed.length?'doing':t.status==='blocked'?'blocked':'todo'};}
export function initializeProjects(db){db.exec(`CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY,title TEXT NOT NULL,customer_id INTEGER REFERENCES customers(id),owner_id INTEGER NOT NULL REFERENCES users(id),start_date TEXT NOT NULL,end_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'planned',description TEXT NOT NULL,created TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS project_tasks(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),title TEXT NOT NULL,assignee_id INTEGER NOT NULL REFERENCES users(id),week_start TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'todo',progress INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS project_updates(id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL REFERENCES project_tasks(id),actor INTEGER NOT NULL REFERENCES users(id),status TEXT NOT NULL,progress INTEGER NOT NULL,notes TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_changes(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),actor INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL);`);
 for(const column of ['start_date','end_date'])if(!db.prepare('PRAGMA table_info(project_tasks)').all().some(c=>c.name===column))db.exec(`ALTER TABLE project_tasks ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
 for(const t of db.prepare("SELECT t.*,p.start_date project_start,p.end_date project_end FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.start_date='' OR t.end_date=''").all()){const end=new Date(Date.parse(t.week_start)+6*86400000).toISOString().slice(0,10);db.prepare('UPDATE project_tasks SET start_date=?,end_date=? WHERE id=?').run(t.week_start<t.project_start?t.project_start:t.week_start,end>t.project_end?t.project_end:end,t.id);}
 if(!db.prepare('PRAGMA table_info(project_tasks)').all().some(c=>c.name==='completion_migrated'))db.exec('ALTER TABLE project_tasks ADD COLUMN completion_migrated INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(project_tasks)').all().some(c=>c.name==='completed_dates'))db.exec('ALTER TABLE project_tasks ADD COLUMN completed_dates TEXT');
 for(const [name,definition] of [['work_date',"TEXT NOT NULL DEFAULT ''"],['kind',"TEXT NOT NULL DEFAULT 'legacy'"],['before_start',"TEXT NOT NULL DEFAULT ''"],['before_end',"TEXT NOT NULL DEFAULT ''"],['after_start',"TEXT NOT NULL DEFAULT ''"],['after_end',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare('PRAGMA table_info(project_updates)').all().some(c=>c.name===name))db.exec(`ALTER TABLE project_updates ADD COLUMN ${name} ${definition}`);
 db.exec('CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 db.prepare("INSERT INTO app_settings(key,value) VALUES('project_task_id_sequence',?) ON CONFLICT(key) DO UPDATE SET value=CAST(max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").run(String(db.prepare('SELECT coalesce(max(id),0) n FROM project_tasks').get().n));
 // Preserve legacy progress as initial checked days; no fabricated daily work entries.
 for(const t of db.prepare('SELECT * FROM project_tasks WHERE completed_dates IS NULL').all()){const days=taskDays(t.start_date,t.end_date),count=t.status==='done'?days.length:Math.min(days.length-1,Math.round(days.length*t.progress/100)),completed=days.slice(0,Math.max(0,count));const next=taskCompletion({...t,completed_dates:JSON.stringify(completed)});db.prepare('UPDATE project_tasks SET completed_dates=?,progress=?,status=?,completion_migrated=? WHERE id=?').run(JSON.stringify(completed),next.progress,next.status,t.progress>0?1:0,t.id);}

}
// Project collaboration is available to every authenticated active user.
const canManage=()=>true;
export function projectApi(db,path,method,user,body,send){try{
 if(path==='/api/project-options'&&method==='GET')return send(200,db.prepare('SELECT id,title,start_date,end_date,status FROM projects ORDER BY id DESC').all());
 if(path==='/api/people'&&method==='GET')return send(200,db.prepare('SELECT id,name,role,job_title,organization,email FROM users WHERE active=1 ORDER BY name,id').all());
 if(path==='/api/projects'&&method==='GET'){const rows=db.prepare('SELECT p.*,u.name owner,c.company FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN customers c ON c.id=p.customer_id ORDER BY p.id DESC').all();for(const p of rows){p.can_manage=canManage(p,user);p.tasks=db.prepare('SELECT t.*,u.name assignee FROM project_tasks t JOIN users u ON u.id=t.assignee_id WHERE project_id=? ORDER BY week_start,t.id').all(p.id).map(t=>({...t,...taskCompletion(t),can_update:p.can_manage||t.assignee_id===user.id}));p.history=db.prepare("SELECT h.*,u.name actor_name,t.title task_title,t.week_start,t.start_date,t.end_date FROM project_updates h JOIN users u ON u.id=h.actor JOIN project_tasks t ON t.id=h.task_id WHERE t.project_id=? AND NOT (h.kind='legacy' AND h.notes IN ('완료 체크로 공정 완료','완료 체크 해제')) ORDER BY h.id DESC").all(p.id);p.schedule_events=db.prepare("SELECT e.*,u.name,p.title project_title FROM schedule_events e JOIN users u ON u.id=e.user_id JOIN projects p ON p.id=e.project_id WHERE e.project_id=? AND e.deleted=0 AND (e.visibility='company' OR e.user_id=? OR (e.visibility='participants' AND EXISTS(SELECT 1 FROM schedule_participants sp WHERE sp.event_id=e.id AND sp.user_id=?))) ORDER BY e.start_date,e.id").all(p.id,user.id,user.id).map(e=>({...e,all_day:!!e.all_day,can_edit:true,can_delete:e.user_id===user.id,can_manage_sharing:e.user_id===user.id||!!user.is_admin,participants:db.prepare('SELECT u.id,u.name,u.job_title,u.organization,u.email,u.active FROM schedule_participants sp JOIN users u ON u.id=sp.user_id WHERE sp.event_id=? ORDER BY u.name,u.id').all(e.id)}));p.changes=db.prepare('SELECT c.*,u.name actor_name FROM project_changes c JOIN users u ON u.id=c.actor WHERE project_id=? ORDER BY c.id DESC LIMIT 50').all(p.id);}return send(200,rows);}
 if(path==='/api/projects'&&method==='POST'){
  check(text(body.title,150)&&date(body.start_date)&&date(body.end_date)&&body.start_date<=body.end_date&&text(body.description??'',3000,false),'프로젝트 이름·기간·설명을 확인하세요');const customer=body.customer_id||null;if(customer)check(Number.isSafeInteger(customer)&&!!db.prepare('SELECT id FROM customers WHERE id=?').get(customer),'고객사를 확인하세요');
  const result=db.prepare('INSERT INTO projects(title,customer_id,owner_id,start_date,end_date,description,created) VALUES(?,?,?,?,?,?,?)').run(body.title.trim(),customer,user.id,body.start_date,body.end_date,body.description||'',new Date().toISOString());return send(201,{ok:true,id:Number(result.lastInsertRowid)});
 }
 const edit=/^\/api\/projects\/(\d+)\/update$/.exec(path);if(edit&&method==='POST'){
  const p=db.prepare('SELECT * FROM projects WHERE id=?').get(Number(edit[1]));if(!p)return send(404,{error:'프로젝트가 없습니다'});if(body.version!==p.version)return send(409,{error:'프로젝트가 변경되었습니다. 다시 조회하세요'});
  check(text(body.title,150)&&date(body.start_date)&&date(body.end_date)&&body.start_date<=body.end_date&&text(body.description??'',3000,false)&&['planned','active','on_hold','completed'].includes(body.status),'프로젝트 이름·기간·상태를 확인하세요');const customer=body.customer_id||null;if(customer)check(Number.isSafeInteger(customer)&&!!db.prepare('SELECT id FROM customers WHERE id=?').get(customer),'고객사를 확인하세요');
  check(!db.prepare('SELECT id FROM project_tasks WHERE project_id=? AND (start_date<? OR end_date>?)').get(p.id,body.start_date,body.end_date),'등록 공정의 기간을 포함하도록 프로젝트 기간을 선택하세요');
  transaction(db,()=>{db.prepare('UPDATE projects SET title=?,customer_id=?,start_date=?,end_date=?,description=?,status=?,version=version+1 WHERE id=?').run(body.title.trim(),customer,body.start_date,body.end_date,body.description||'',body.status,p.id);db.prepare("INSERT INTO project_changes(project_id,actor,action,snapshot,created) VALUES(?,?,'update',?,?)").run(p.id,user.id,JSON.stringify({before:p,after:body}),new Date().toISOString());});return send(200,{ok:true});
 }
 let match=/^\/api\/projects\/(\d+)\/(status|tasks)$/.exec(path);if(match&&method==='POST'){
  const p=db.prepare('SELECT * FROM projects WHERE id=?').get(Number(match[1]));if(!p)return send(404,{error:'프로젝트가 없습니다'});if(!canManage(p,user))return send(403,{error:'프로젝트 담당자만 공정을 관리할 수 있습니다'});
  if(match[2]==='status'){check(['planned','active','on_hold','completed'].includes(body.status),'상태를 확인하세요');if(body.version!==p.version)return send(409,{error:'프로젝트가 변경되었습니다. 다시 조회하세요'});transaction(db,()=>{db.prepare('UPDATE projects SET status=?,version=version+1 WHERE id=?').run(body.status,p.id);db.prepare("INSERT INTO project_changes(project_id,actor,action,snapshot,created) VALUES(?,?,'status',?,?)").run(p.id,user.id,JSON.stringify({before:p.status,after:body.status}),new Date().toISOString());});return send(200,{ok:true});}
  let start=body.start_date,end=body.end_date;
  if(start===undefined){check(date(body.week_start)&&new Date(body.week_start+'T00:00:00Z').getUTCDay()===1,'주 시작일은 월요일이어야 합니다');const weekEnd=new Date(Date.parse(body.week_start)+6*86400000).toISOString().slice(0,10);start=body.week_start<p.start_date?p.start_date:body.week_start;end=weekEnd>p.end_date?p.end_date:weekEnd;}
  check(text(body.title,150)&&date(start)&&date(end)&&start<=end&&dayCount(start,end)<=3660&&start>=p.start_date&&end<=p.end_date&&Number.isSafeInteger(body.assignee_id)&&!!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(body.assignee_id),'공정명·담당자·프로젝트 내 공정 기간을 확인하세요');const d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const week=d.toISOString().slice(0,10);
  check(body.completed===undefined||typeof body.completed==='boolean','완료 여부는 체크 값이어야 합니다');const status=body.completed?'done':'todo',progress=body.completed?100:0;const id=transaction(db,()=>{const taskId=Number(db.prepare("UPDATE app_settings SET value=max(CAST(value AS INTEGER),(SELECT coalesce(max(id),0) FROM project_tasks))+1 WHERE key='project_task_id_sequence' RETURNING value").get().value);const r=db.prepare('INSERT INTO project_tasks(id,project_id,title,assignee_id,week_start,start_date,end_date,status,progress,completed_dates) VALUES(?,?,?,?,?,?,?,?,?,?)').run(taskId,p.id,body.title.trim(),body.assignee_id,week,start,end,status,progress,JSON.stringify(body.completed?taskDays(start,end):[]));db.prepare("INSERT INTO project_updates(task_id,actor,status,progress,notes,created,kind) VALUES(?,?,?,?,'공정 등록',?,'created')").run(r.lastInsertRowid,user.id,status,progress,new Date().toISOString());return Number(r.lastInsertRowid);});return send(201,{ok:true,id});
 }
 match=/^\/api\/project-tasks\/(\d+)\/delete$/.exec(path);if(match&&method==='POST'){
  if(!user.is_admin)return send(403,{error:'Admin만 공정을 삭제할 수 있습니다'});
  const task=db.prepare('SELECT id,version FROM project_tasks WHERE id=?').get(Number(match[1]));if(!task)return send(404,{error:'공정이 없습니다'});
  check(body.confirm===true,'공정과 모든 수행 내역의 삭제를 확인하세요');if(body.version!==task.version)return send(409,{error:'공정이 변경되었습니다. 다시 조회하세요'});
  db.exec('PRAGMA secure_delete=ON');transaction(db,()=>{db.prepare('DELETE FROM project_updates WHERE task_id=?').run(task.id);db.prepare('DELETE FROM project_tasks WHERE id=?').run(task.id);});return send(200,{ok:true});
 }
 match=/^\/api\/project-tasks\/(\d+)\/(update|completion)$/.exec(path);if(match&&method==='POST'){
  const t=db.prepare('SELECT t.*,p.owner_id,p.start_date project_start,p.end_date project_end FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?').get(Number(match[1]));if(!t)return send(404,{error:'공정이 없습니다'});if(body.version!==t.version)return send(409,{error:'공정이 변경되었습니다. 다시 조회하세요'});
  if(match[2]==='completion'){
   check(date(body.date)&&body.date>=t.start_date&&body.date<=t.end_date&&typeof body.completed==='boolean','공정 기간 내 날짜와 완료 여부를 확인하세요');
   transaction(db,()=>{const completed=new Set(JSON.parse(t.completed_dates));if(body.completed)completed.add(body.date);else completed.delete(body.date);const dates=[...completed].sort(),next=taskCompletion({...t,completed_dates:JSON.stringify(dates)});db.prepare('UPDATE project_tasks SET completed_dates=?,progress=?,status=?,version=version+1 WHERE id=?').run(JSON.stringify(dates),next.progress,next.status,t.id);});
   return send(200,{ok:true});
  }
  const title=body.title??t.title,start=body.start_date??t.start_date,end=body.end_date??t.end_date,assignee=body.assignee_id??t.assignee_id;
  check(text(title,150)&&date(start)&&date(end)&&start<=end&&dayCount(start,end)<=3660&&start>=t.project_start&&end<=t.project_end&&Number.isSafeInteger(assignee)&&!!db.prepare('SELECT id FROM users WHERE id=? AND (active=1 OR id=?)').get(assignee,t.assignee_id),'공정 이름·기간(최대 3,660일)·담당자를 확인하세요');
  check(text(body.notes??'',3000,false),'수행 내역은 3,000자 이내로 입력하세요');
  const scheduleChanged=start!==t.start_date||end!==t.end_date;
  check(!scheduleChanged||text(body.change_reason,3000),'일정 변경 사유를 입력하세요');
  check(body.change_reason===undefined||text(body.change_reason,3000,false),'일정 변경 사유는 3,000자 이내로 입력하세요');
  const workDate=body.work_date??start;check(date(workDate)&&workDate>=start&&workDate<=end,'수행 일자는 공정 기간 내에서 선택하세요');
  const day=new Date(start+'T00:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);const week=day.toISOString().slice(0,10);
  transaction(db,()=>{
   // Keep checks outside the revised range, so restoring the range restores those checks.
   const next=taskCompletion({...t,start_date:start,end_date:end});
   db.prepare('UPDATE project_tasks SET progress=?,status=?,title=?,assignee_id=?,start_date=?,end_date=?,week_start=?,version=version+1 WHERE id=?').run(next.progress,next.status,title.trim(),assignee,start,end,week,t.id);
   const insert=(kind,notes,work_date='')=>db.prepare('INSERT INTO project_updates(task_id,actor,status,progress,notes,created,kind,work_date,before_start,before_end,after_start,after_end) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(t.id,user.id,next.status,next.progress,notes,new Date().toISOString(),kind,work_date,t.start_date,t.end_date,start,end);
   if(scheduleChanged)insert('schedule',body.change_reason.trim());
   if(body.notes?.trim())insert('work',body.notes.trim(),workDate);
   if(!scheduleChanged&&!body.notes?.trim()&&(title.trim()!==t.title||assignee!==t.assignee_id))insert('info','공정 정보 수정');
  });return send(200,{ok:true});
 }

 return send(404,{error:'찾을 수 없습니다'});
}catch(error){if(error instanceof InputError)return send(400,{error:error.message});throw error;}}
