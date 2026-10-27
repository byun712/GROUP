export function initializeSchedules(db){db.exec(`
 CREATE TABLE IF NOT EXISTS schedule_events(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,all_day INTEGER NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,visibility TEXT NOT NULL,location TEXT NOT NULL,description TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS schedule_participants(event_id INTEGER NOT NULL REFERENCES schedule_events(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(event_id,user_id));
 CREATE TABLE IF NOT EXISTS schedule_changes(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES schedule_events(id),actor INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL);
`);if(!db.prepare('PRAGMA table_info(schedule_events)').all().some(c=>c.name==='project_id'))db.exec('ALTER TABLE schedule_events ADD COLUMN project_id INTEGER REFERENCES projects(id)');}
const realDate=v=>typeof v==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const short=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
export function validateSchedule(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('일정 입력을 확인하세요');
 const {title,start_date,end_date,all_day,start_time='',end_time='',visibility,location='',description=''}=body;
 if(!short(title,120,true)||!realDate(start_date)||!realDate(end_date)||start_date>end_date||typeof all_day!=='boolean'||!['personal','company','participants'].includes(visibility)||!short(location,200)||!short(description,2000))throw Error('제목·기간·공개 범위를 확인하세요');
 if(!all_day&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time)||`${start_date}T${start_time}`>=`${end_date}T${end_time}`))throw Error('일정 종료 시각은 시작 시각 이후여야 합니다');
 return {title:title.trim(),start_date,end_date,all_day:all_day?1:0,start_time:all_day?'':start_time,end_time:all_day?'':end_time,visibility,location:location.trim(),description:description.trim()};
}
function participants(db,body,eventId=null){const existing=eventId?db.prepare('SELECT user_id FROM schedule_participants WHERE event_id=?').all(eventId).map(r=>r.user_id):[];const ids=body.participant_ids===undefined?existing:body.participant_ids;
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw Error('참여 인원 선택을 확인하세요');
 for(const id of ids){const person=db.prepare('SELECT active FROM users WHERE id=?').get(id);if(!person||!person.active&&!existing.includes(id))throw Error('활성 사용자만 새 참여자로 선택할 수 있습니다');}
 if(body.visibility==='personal'&&ids.length)throw Error('참여자가 있는 일정은 참여자 공유 또는 회사 일정으로 선택하세요');return ids;
}
function storeParticipants(db,eventId,ids){db.prepare('DELETE FROM schedule_participants WHERE event_id=?').run(eventId);for(const id of ids)db.prepare('INSERT INTO schedule_participants VALUES(?,?)').run(eventId,id);}
function canView(db,row,user){return row.user_id===user.id||row.visibility==='company'||row.visibility==='participants'&&!!db.prepare('SELECT 1 FROM schedule_participants WHERE event_id=? AND user_id=?').get(row.id,user.id);}
function linkedProject(db,body,current=null){const id=body.project_id===undefined?current:body.project_id;if(id===null||id==='')return null;if(!Number.isSafeInteger(id)||!db.prepare('SELECT id FROM projects WHERE id=?').get(id))throw Error('연결할 프로젝트를 확인하세요');return id;}
export function scheduleApi(db,path,method,user,body,send,url){
 if(path==='/api/schedules'&&method==='GET'){
  const month=url.searchParams.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||Number(month.slice(0,4))<1000)return send(400,{error:'조회 월을 확인하세요'});
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10),start=month+'-01';
  const events=db.prepare("SELECT e.*,u.name,p.title project_title FROM schedule_events e JOIN users u ON u.id=e.user_id LEFT JOIN projects p ON p.id=e.project_id WHERE e.deleted=0 AND (e.visibility='company' OR e.user_id=? OR (e.visibility='participants' AND EXISTS(SELECT 1 FROM schedule_participants p WHERE p.event_id=e.id AND p.user_id=?))) AND e.start_date<=? AND e.end_date>=? ORDER BY e.start_date,e.start_time,e.id").all(user.id,user.id,end,start).map(row=>({...row,all_day:!!row.all_day,can_edit:true,can_delete:row.user_id===user.id,can_manage_sharing:row.user_id===user.id||!!user.is_admin,participants:db.prepare('SELECT u.id,u.name,u.job_title,u.organization,u.email,u.active FROM schedule_participants p JOIN users u ON u.id=p.user_id WHERE p.event_id=? ORDER BY u.name,u.id').all(row.id)}));
  const leaves=db.prepare("SELECT l.id,l.kind,l.start,l.end,u.name FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE l.status='approved' AND l.start<=? AND l.end>=? ORDER BY l.start,l.id").all(end,start);
  return send(200,{events,leaves});
 }
 if(path==='/api/schedules'&&method==='POST'){
  let e;try{e=validateSchedule(body);e.participant_ids=participants(db,body);e.project_id=linkedProject(db,body);}catch(error){return send(400,{error:error.message});}const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{const result=db.prepare('INSERT INTO schedule_events(user_id,title,start_date,end_date,all_day,start_time,end_time,visibility,location,description,created,updated,project_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(user.id,e.title,e.start_date,e.end_date,e.all_day,e.start_time,e.end_time,e.visibility,e.location,e.description,now,now,e.project_id);const id=Number(result.lastInsertRowid);storeParticipants(db,id,e.participant_ids);db.prepare('INSERT INTO schedule_changes(event_id,actor,action,snapshot,created) VALUES(?,?,?,?,?)').run(id,user.id,'create',JSON.stringify(e),now);db.exec('COMMIT');return send(201,{ok:true,id});}catch(error){db.exec('ROLLBACK');throw error;}
 }
 const match=/^\/api\/schedules\/(\d+)\/(update|delete)$/.exec(path);
 if(match&&method==='POST'){
  const id=Number(match[1]),action=match[2],row=db.prepare('SELECT * FROM schedule_events WHERE id=? AND deleted=0').get(id);if(!row)return send(404,{error:'일정이 없습니다'});if(!canView(db,row,user))return send(403,{error:'일정 접근 권한이 없습니다'});if(action==='delete'&&row.user_id!==user.id)return send(403,{error:'작성자만 일정을 삭제할 수 있습니다'});if(!Number.isSafeInteger(body?.version)||body.version!==row.version)return send(409,{error:'일정이 변경되었습니다. 새로고침 후 다시 확인하세요'});
  let e;if(action==='update')try{e=validateSchedule(body);e.participant_ids=participants(db,body,id);e.project_id=linkedProject(db,body,row.project_id);}catch(error){return send(400,{error:error.message});}if(action==='update'&&row.user_id!==user.id&&!user.is_admin){const original=db.prepare('SELECT user_id FROM schedule_participants WHERE event_id=? ORDER BY user_id').all(id).map(p=>p.user_id);if(e.visibility!==row.visibility||JSON.stringify([...e.participant_ids].sort((a,b)=>a-b))!==JSON.stringify(original))return send(403,{error:'공개 범위·참여자 변경은 작성자 또는 Admin만 가능합니다'});}const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
   if(action==='delete')db.prepare('UPDATE schedule_events SET deleted=1,version=version+1,updated=? WHERE id=?').run(now,id);else db.prepare('UPDATE schedule_events SET title=?,start_date=?,end_date=?,all_day=?,start_time=?,end_time=?,visibility=?,location=?,description=?,updated=?,project_id=?,version=version+1 WHERE id=?').run(e.title,e.start_date,e.end_date,e.all_day,e.start_time,e.end_time,e.visibility,e.location,e.description,now,e.project_id,id);
   if(action==='update')storeParticipants(db,id,e.participant_ids);db.prepare('INSERT INTO schedule_changes(event_id,actor,action,snapshot,created) VALUES(?,?,?,?,?)').run(id,user.id,action,JSON.stringify(action==='delete'?row:e),now);db.exec('COMMIT');return send(200,{ok:true});
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return send(404,{error:'찾을 수 없습니다'});
}
