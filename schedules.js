export function initializeSchedules(db){db.exec(`
 CREATE TABLE IF NOT EXISTS schedule_events(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,all_day INTEGER NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,visibility TEXT NOT NULL,location TEXT NOT NULL,description TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS schedule_changes(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES schedule_events(id),actor INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL);
`);}
const realDate=v=>typeof v==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const short=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
export function validateSchedule(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('일정 입력을 확인하세요');
 const {title,start_date,end_date,all_day,start_time='',end_time='',visibility,location='',description=''}=body;
 if(!short(title,120,true)||!realDate(start_date)||!realDate(end_date)||start_date>end_date||typeof all_day!=='boolean'||!['personal','company'].includes(visibility)||!short(location,200)||!short(description,2000))throw Error('제목·기간·공개 범위를 확인하세요');
 if(!all_day&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time)||`${start_date}T${start_time}`>=`${end_date}T${end_time}`))throw Error('일정 종료 시각은 시작 시각 이후여야 합니다');
 return {title:title.trim(),start_date,end_date,all_day:all_day?1:0,start_time:all_day?'':start_time,end_time:all_day?'':end_time,visibility,location:location.trim(),description:description.trim()};
}
export function scheduleApi(db,path,method,user,body,send,url){
 if(path==='/api/schedules'&&method==='GET'){
  const month=url.searchParams.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||Number(month.slice(0,4))<1000)return send(400,{error:'조회 월을 확인하세요'});
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10),start=month+'-01';
  const events=db.prepare("SELECT e.*,u.name FROM schedule_events e JOIN users u ON u.id=e.user_id WHERE e.deleted=0 AND (e.visibility='company' OR e.user_id=?) AND e.start_date<=? AND e.end_date>=? ORDER BY e.start_date,e.start_time,e.id").all(user.id,end,start).map(row=>({...row,all_day:!!row.all_day,can_edit:row.user_id===user.id}));
  const leaves=db.prepare("SELECT l.id,l.kind,l.start,l.end,u.name FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE l.status='approved' AND l.start<=? AND l.end>=? ORDER BY l.start,l.id").all(end,start);
  return send(200,{events,leaves});
 }
 if(path==='/api/schedules'&&method==='POST'){
  let e;try{e=validateSchedule(body);}catch(error){return send(400,{error:error.message});}const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{const result=db.prepare('INSERT INTO schedule_events(user_id,title,start_date,end_date,all_day,start_time,end_time,visibility,location,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(user.id,e.title,e.start_date,e.end_date,e.all_day,e.start_time,e.end_time,e.visibility,e.location,e.description,now,now);const id=Number(result.lastInsertRowid);db.prepare('INSERT INTO schedule_changes(event_id,actor,action,snapshot,created) VALUES(?,?,?,?,?)').run(id,user.id,'create',JSON.stringify(e),now);db.exec('COMMIT');return send(201,{ok:true,id});}catch(error){db.exec('ROLLBACK');throw error;}
 }
 const match=/^\/api\/schedules\/(\d+)\/(update|delete)$/.exec(path);
 if(match&&method==='POST'){
  const id=Number(match[1]),action=match[2],row=db.prepare('SELECT * FROM schedule_events WHERE id=? AND deleted=0').get(id);if(!row)return send(404,{error:'일정이 없습니다'});if(row.user_id!==user.id)return send(403,{error:'작성자만 일정을 변경할 수 있습니다'});if(!Number.isSafeInteger(body?.version)||body.version!==row.version)return send(409,{error:'일정이 변경되었습니다. 새로고침 후 다시 확인하세요'});
  let e;if(action==='update')try{e=validateSchedule(body);}catch(error){return send(400,{error:error.message});}const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
   if(action==='delete')db.prepare('UPDATE schedule_events SET deleted=1,version=version+1,updated=? WHERE id=?').run(now,id);else db.prepare('UPDATE schedule_events SET title=?,start_date=?,end_date=?,all_day=?,start_time=?,end_time=?,visibility=?,location=?,description=?,updated=?,version=version+1 WHERE id=?').run(e.title,e.start_date,e.end_date,e.all_day,e.start_time,e.end_time,e.visibility,e.location,e.description,now,id);
   db.prepare('INSERT INTO schedule_changes(event_id,actor,action,snapshot,created) VALUES(?,?,?,?,?)').run(id,user.id,action,JSON.stringify(action==='delete'?row:e),now);db.exec('COMMIT');return send(200,{ok:true});
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return send(404,{error:'찾을 수 없습니다'});
}
