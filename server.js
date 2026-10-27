import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {clientIp} from './network.js';
const root=resolve(import.meta.dirname);
const dir=process.env.DATA_DIR||resolve(root,'data');mkdirSync(dir,{recursive:true,mode:0o700});
const db=new DatabaseSync(resolve(dir,'group.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,login TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('employee','manager','ceo')),salt TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS leave_requests(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),kind TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'manager',created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY,leave_id INTEGER REFERENCES leave_requests(id),actor INTEGER REFERENCES users(id),action TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),day TEXT NOT NULL,clock_in TEXT NOT NULL,clock_out TEXT,ip TEXT NOT NULL,UNIQUE(user_id,day));`);
// Additive migrations preserve existing employee and business records.
for(const [table,column,definition] of [['users','active','INTEGER NOT NULL DEFAULT 1'],['users','totp_secret','TEXT'],['users','totp_pending','TEXT'],['users','totp_last','INTEGER NOT NULL DEFAULT -1'],['sessions','mfa','INTEGER NOT NULL DEFAULT 0']]){
 if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// Remove obsolete authenticator keys without deleting accounts or business records.
db.exec('UPDATE users SET totp_secret=NULL,totp_pending=NULL,totp_last=-1 WHERE totp_secret IS NOT NULL OR totp_pending IS NOT NULL');
export function manageUser(action,login){const u=db.prepare('SELECT id FROM users WHERE login=?').get(login);if(!u)throw Error('계정을 찾을 수 없습니다');if(action==='user:disable')db.prepare('UPDATE users SET active=0 WHERE id=?').run(u.id);else if(action==='user:enable')db.prepare('UPDATE users SET active=1 WHERE id=?').run(u.id);else throw Error('지원하지 않는 계정 명령');db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);}
const hash=(password,salt)=>scryptSync(password,salt,64);
export function addUser(login,name,role,password){if(!['employee','manager','ceo'].includes(role)||!login||!name||password.length<12)throw Error('역할과 계정 정보를 확인하세요. 비밀번호는 12자 이상이어야 합니다.');const salt=randomBytes(16).toString('hex');db.prepare('INSERT INTO users(login,name,role,salt,hash) VALUES(?,?,?,?,?)').run(login,name,role,salt,hash(password,salt).toString('hex'));}
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const office=process.env.OFFICE_IP||'220.120.152.40';
const ipOf=clientIp;
function cookie(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8)||'';}
const failures=new Map();
export const server=http.createServer(async(req,res)=>{const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};try{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
const path=new URL(req.url,'http://localhost').pathname;
if(!path.startsWith('/api/')){if(req.method!=='GET')return send(405,{error:'허용되지 않는 요청'});const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'}[path];if(!file)return send(404,{error:'찾을 수 없습니다'});res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.png')?'image/png':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(resolve(root,'public',file)));return;}
if(req.method==='POST'){const origin=req.headers.origin;const expected=process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;if(origin&&origin!==expected)return send(403,{error:'허용되지 않은 출처'});if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{error:'JSON 요청만 허용됩니다'});}
let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)return send(413,{error:'요청이 너무 큽니다'});}try{body=JSON.parse(raw);}catch{return send(400,{error:'잘못된 JSON'});}}
if(path==='/api/login'&&req.method==='POST'){const ip=ipOf(req),now=Date.now();let limit=failures.get(ip);if(limit&&limit.until<now){failures.delete(ip);limit=null;}if(limit?.count>=10)return send(429,{error:'잠시 후 다시 시도하세요'});const u=db.prepare('SELECT * FROM users WHERE login=?').get(String(body.login||''));const pass=String(body.password||'');const actual=hash(pass,u?.salt||'invalid');if(!u||!u.active||!timingSafeEqual(actual,Buffer.from(u.hash,'hex'))){failures.set(ip,{count:(limit?.count||0)+1,until:limit?.until||now+900000});return send(401,{error:'계정 또는 비밀번호를 확인하세요'});}failures.delete(ip);const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(token,u.id,now+8*3600000);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`);return send(200,{ok:true});}
const user=db.prepare('SELECT u.id,u.login,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1').get(cookie(req),Date.now());if(!user)return send(401,{error:'로그인이 필요합니다'});
if(path==='/api/security/password'&&req.method==='POST'){
 const u=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);if(typeof body.password!=='string'||body.password.length<12||body.password.length>256||!timingSafeEqual(hash(String(body.current||''),u.salt),Buffer.from(u.hash,'hex')))return send(400,{error:'현재 비밀번호 및 새 비밀번호(12~256자)를 확인하세요'});
 const salt=randomBytes(16).toString('hex');db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash(body.password,salt).toString('hex'),user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);return send(200,{ok:true});
}
if(path==='/api/me'&&req.method==='GET')return send(200,{user,officeAllowed:ipOf(req)===office,mailAllowed:user.role==='manager'});
if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(cookie(req));res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
if(path==='/api/leaves'&&req.method==='GET'){const rows=user.role==='employee'?db.prepare('SELECT l.*,u.name FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE user_id=? ORDER BY l.id DESC').all(user.id):db.prepare('SELECT l.*,u.name FROM leave_requests l JOIN users u ON u.id=l.user_id ORDER BY l.id DESC').all();for(const row of rows)row.history=db.prepare('SELECT d.action,d.created,u.name FROM decisions d JOIN users u ON u.id=d.actor WHERE leave_id=? ORDER BY d.id').all(row.id);return send(200,rows);}
if(path==='/api/leaves'&&req.method==='POST'){const {kind,start,end,reason}=body;const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;if(!['연차','오전 반차','오후 반차'].includes(kind)||!valid(start)||!valid(end)||start>end||(kind!=='연차'&&start!==end)||typeof reason!=='string'||!reason.trim()||reason.length>2000)return send(400,{error:'휴가 종류·기간·사유를 확인하세요'});db.prepare('INSERT INTO leave_requests(user_id,kind,start,end,reason,created) VALUES(?,?,?,?,?,?)').run(user.id,kind,start,end,reason.trim(),new Date().toISOString());return send(201,{ok:true});}
if(/^\/api\/leaves\/\d+\/action$/.test(path)&&req.method==='POST'){const id=Number(path.split('/')[3]);const row=db.prepare('SELECT * FROM leave_requests WHERE id=?').get(id);if(!row)return send(404,{error:'문서가 없습니다'});let next;if(body.action==='withdraw'&&row.user_id===user.id&&row.status==='manager')next='withdrawn';else if(row.user_id!==user.id&&row.status===user.role&&['approve','reject'].includes(body.action))next=body.action==='reject'?'rejected':user.role==='manager'?'ceo':'approved';else return send(403,{error:'현재 단계에서 처리할 권한이 없습니다'});db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE leave_requests SET status=? WHERE id=?').run(next,id);db.prepare('INSERT INTO decisions(leave_id,actor,action,created) VALUES(?,?,?,?)').run(id,user.id,body.action,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(200,{ok:true});}
if(path==='/api/attendance/export'&&req.method==='GET'){
 const month=new URL(req.url,'http://localhost').searchParams.get('month');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return send(400,{error:'조회 월을 YYYY-MM 형식으로 입력하세요'});
 const rows=db.prepare("SELECT day,clock_in,clock_out FROM attendance WHERE user_id=? AND substr(day,1,7)=? ORDER BY day").all(user.id,month);
 const local=value=>value?new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}):'';
 const csv='\uFEFF날짜,출근(한국시간),퇴근(한국시간)\r\n'+rows.map(r=>[r.day,local(r.clock_in),local(r.clock_out)].join(',')).join('\r\n');
 res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="attendance-${month}.csv"`,'Cache-Control':'no-store'});res.end(csv);return;
}
if(path==='/api/attendance'&&req.method==='GET')return send(200,db.prepare('SELECT * FROM attendance WHERE user_id=? ORDER BY day DESC LIMIT 90').all(user.id));
if(path==='/api/attendance'&&req.method==='POST'){if(ipOf(req)!==office)return send(403,{error:'사무실 네트워크에서만 출퇴근 등록이 가능합니다'});const today=day(),row=db.prepare('SELECT * FROM attendance WHERE user_id=? AND day=?').get(user.id,today);if(body.action==='in'&&!row)db.prepare('INSERT INTO attendance(user_id,day,clock_in,ip) VALUES(?,?,?,?)').run(user.id,today,new Date().toISOString(),ipOf(req));else if(body.action==='out'&&row&&!row.clock_out)db.prepare('UPDATE attendance SET clock_out=? WHERE id=?').run(new Date().toISOString(),row.id);else return send(409,{error:'출퇴근 등록 순서 또는 중복 여부를 확인하세요'});return send(200,{ok:true});}
return send(404,{error:'찾을 수 없습니다'});
}catch(e){console.error(e.message);if(!res.headersSent)send(500,{error:'서버 처리 중 오류가 발생했습니다'});else res.end();}});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv[2]==='user:add'){try{addUser(...process.argv.slice(3,6),process.env.NEW_USER_PASSWORD||'');console.log('계정을 생성했습니다.');}catch(e){console.error(e.message);process.exitCode=1;}}else if(process.argv[2]?.startsWith('user:')){try{manageUser(process.argv[2],process.argv[3]);console.log('계정 상태를 변경하고 세션을 종료했습니다.');}catch(e){console.error(e.message);process.exitCode=1;}}else server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Groupware started'));}
