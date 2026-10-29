import {check,date,InputError,transaction} from './business-common.js';
export function initializeAttendance(db){
 if(!db.prepare('PRAGMA table_info(attendance)').all().some(c=>c.name==='version'))db.exec('ALTER TABLE attendance ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
 db.exec('CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 db.prepare("INSERT INTO app_settings(key,value) VALUES('attendance_id_sequence',?) ON CONFLICT(key) DO UPDATE SET value=CAST(max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").run(String(db.prepare('SELECT coalesce(max(id),0) n FROM attendance').get().n));
}
export function nextAttendanceId(db){return Number(db.prepare("UPDATE app_settings SET value=max(CAST(value AS INTEGER),(SELECT coalesce(max(id),0) FROM attendance))+1 WHERE key='attendance_id_sequence' RETURNING value").get().value);}
function targetUser(db,user,url){const raw=url.searchParams.get('user_id'),id=raw===null?user.id:Number(raw);check(Number.isSafeInteger(id)&&id>0,'사용자를 확인하세요');if(id!==user.id&&!user.is_admin)return {error:403};const target=db.prepare('SELECT id,name,job_title,organization,active FROM users WHERE id=?').get(id);return target||{error:404};}
function monthRange(url){const month=url.searchParams.get('month');check(typeof month==='string'&&/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month),'조회 월을 YYYY-MM 형식으로 입력하세요');return {month,start:month+'-01',end:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10)};}
// Admin input is a local Korean date/time; never interpret it in the server timezone.
export function koreanTimestamp(value){check(typeof value==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)&&date(value.slice(0,10)),'출퇴근 시각을 한국 날짜·시간으로 입력하세요');return new Date(value+(value.length===16?':00':'')+'+09:00').toISOString();}
export function attendanceApi(db,path,method,user,body,send,res,url){try{
 if((path==='/api/attendance/calendar'||path==='/api/attendance/export')&&method==='GET'){
  const range=monthRange(url),target=targetUser(db,user,url);if(target.error)return send(target.error,{error:target.error===403?'본인의 근태만 조회할 수 있습니다':'사용자를 찾을 수 없습니다'});
  const records=db.prepare('SELECT id,user_id,day,clock_in,clock_out,version FROM attendance WHERE user_id=? AND day>=? AND day<=? ORDER BY day').all(target.id,range.start,range.end);
  if(path.endsWith('/export')){const local=v=>v?new Date(v).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}):'';const csv='\uFEFF날짜,출근(한국시간),퇴근(한국시간)\r\n'+records.map(r=>[r.day,local(r.clock_in),local(r.clock_out)].join(',')).join('\r\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="attendance-${target.id}-${range.month}.csv"`,'Cache-Control':'no-store'});res.end(csv);return;}
  const users=user.is_admin?db.prepare('SELECT id,name,job_title,organization,active FROM users ORDER BY active DESC,name,id').all():[target];
  const leaves=db.prepare("SELECT id,user_id,kind,start,end,status FROM leave_requests WHERE user_id=? AND status IN ('ceo','approved') AND start<=? AND end>=? ORDER BY start,id").all(target.id,range.end,range.start);
  return send(200,{month:range.month,user:target,users,records,leaves,can_manage:!!user.is_admin});
 }
 const match=/^\/api\/attendance\/(\d+)\/(update|delete)$/.exec(path);if(match&&method==='POST'){
  if(!user.is_admin)return send(403,{error:'Admin만 근태 기록을 수정하거나 삭제할 수 있습니다'});
  const row=db.prepare('SELECT * FROM attendance WHERE id=?').get(Number(match[1]));if(!row)return send(404,{error:'근태 기록이 없습니다'});
  if(body.version!==row.version)return send(409,{error:'근태 기록이 변경되었습니다. 다시 조회하세요'});
  if(match[2]==='delete'){check(body.confirm===true,'삭제 확인이 필요합니다');db.exec('PRAGMA secure_delete=ON');transaction(db,()=>db.prepare('DELETE FROM attendance WHERE id=?').run(row.id));return send(200,{ok:true});}
  const clockIn=koreanTimestamp(body.clock_in),clockOut=body.clock_out===''||body.clock_out===null?null:koreanTimestamp(body.clock_out);
  check(body.clock_in.slice(0,10)===row.day,'출근 날짜는 해당 근태 기록 날짜와 같아야 합니다');check(!clockOut||clockOut>=clockIn,'퇴근 시각은 출근 시각 이후여야 합니다');
  db.prepare('UPDATE attendance SET clock_in=?,clock_out=?,version=version+1 WHERE id=?').run(clockIn,clockOut,row.id);return send(200,{ok:true});
 }
 return send(404,{error:'찾을 수 없습니다'});
}catch(error){if(error instanceof InputError)return send(400,{error:error.message});throw error;}}
