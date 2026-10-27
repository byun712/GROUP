import {randomBytes,scryptSync} from 'node:crypto';
export const JOB_TITLES=['대표이사','이사','본부장','연구소장','부장','차장','과장','대리','사원'];
export const ORGANIZATIONS=['경영본부','기업부설연구소','사업본부','기술개발본부'];
export const FIRST_ADMIN='soltec@elsoltec.com';
export function initializeAccounts(db){
 if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='is_admin'))db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
 for(const column of ['job_title','organization','phone','email'])if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name===column))db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
 db.exec(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS account_audit(id INTEGER PRIMARY KEY,actor INTEGER,action TEXT NOT NULL,target INTEGER,details TEXT NOT NULL,created TEXT NOT NULL);`);bootstrapAdmin(db);
}
export function bootstrapAdmin(db){if(db.prepare("SELECT value FROM app_settings WHERE key='admin_bootstrapped'").get())return;const u=db.prepare('SELECT id FROM users WHERE lower(trim(login))=? AND active=1').get(FIRST_ADMIN);if(!u)return;db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE users SET is_admin=1,role='manager' WHERE id=?").run(u.id);db.prepare("INSERT INTO app_settings VALUES('admin_bootstrapped','1')").run();db.prepare("INSERT INTO account_audit(actor,action,target,details,created) VALUES(NULL,'bootstrap',?,'initial administrator',?)").run(u.id,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
export function protectLastAdmin(db,id,active,isAdmin){const u=db.prepare('SELECT active,is_admin FROM users WHERE id=?').get(id);if(u?.active&&u.is_admin&&(!active||!isAdmin)&&db.prepare('SELECT count(*) n FROM users WHERE active=1 AND is_admin=1 AND id<>?').get(id).n===0)throw Error('마지막 활성 관리자는 해제하거나 비활성화할 수 없습니다');}
function audit(db,user,action,target,details){db.prepare('INSERT INTO account_audit(actor,action,target,details,created) VALUES(?,?,?,?,?)').run(user.id,action,target,JSON.stringify(details),new Date().toISOString());}
const columns='id,login,name,role,active,is_admin,job_title,organization,phone,email';
function profile(body,current={},required=false){const value={};for(const key of ['name','job_title','organization','phone','email'])value[key]=body[key]===undefined?(current[key]||''):body[key];
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>80)throw Error('이름을 확인하세요');
 if((required||body.job_title!==undefined)&&!JOB_TITLES.includes(value.job_title))throw Error('직급을 선택하세요');
 if((required||body.organization!==undefined)&&!ORGANIZATIONS.includes(value.organization))throw Error('소속조직을 선택하세요');
 if(typeof value.phone!=='string'||value.phone.length>40||((required||value.phone)&&(!/^[0-9+(). #\-]+$/.test(value.phone)||!/[0-9]/.test(value.phone))))throw Error('전화번호를 확인하세요');
 if(typeof value.email!=='string'||value.email.length>150||((required||value.email)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)))throw Error('이메일을 확인하세요');
 return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,v.trim()]));}
function saveProfile(db,id,p){db.prepare('UPDATE users SET name=?,job_title=?,organization=?,phone=?,email=? WHERE id=?').run(p.name,p.job_title,p.organization,p.phone,p.email,id);}
export function accountApi(db,path,method,user,body,send,addUser){
 if(path==='/api/user-options'&&method==='GET')return send(200,{job_titles:JOB_TITLES,organizations:ORGANIZATIONS});
 if(path==='/api/users/me'&&method==='GET')return send(200,db.prepare('SELECT '+columns+' FROM users WHERE id=?').get(user.id));
 if(path==='/api/users/me/update'&&method==='POST'){
  if(['role','active','is_admin','login','password'].some(key=>key in body))return send(403,{error:'개인 정보 화면에서는 권한이나 로그인 정보를 변경할 수 없습니다'});
  let p;try{p=profile(body,{},true);}catch(error){return send(400,{error:error.message});}
  db.exec('BEGIN IMMEDIATE');try{saveProfile(db,user.id,p);audit(db,user,'self_profile_update',user.id,{fields:Object.keys(p)});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return send(200,{ok:true});
 }
 if(path==='/api/users'&&method==='GET')return send(200,user.is_admin?db.prepare('SELECT '+columns+' FROM users ORDER BY id').all():[db.prepare('SELECT '+columns+' FROM users WHERE id=?').get(user.id)]);
 if(!user.is_admin)return send(403,{error:'다른 사용자 관리 및 권한 변경은 Admin 권한이 필요합니다'});
 if(path==='/api/users'&&method==='POST'){
  let p;try{p=profile(body,{},true);}catch(error){return send(400,{error:error.message});}
  if(!body||typeof body.login!=='string'||!/^[-A-Za-z0-9_.@+]{3,100}$/.test(body.login)||!['employee','manager','ceo'].includes(body.role)||typeof body.password!=='string'||body.password.length<12||body.password.length>256||typeof body.is_admin!=='boolean')return send(400,{error:'아이디·역할·비밀번호(12~256자)를 확인하세요'});
  if(db.prepare('SELECT id FROM users WHERE lower(login)=lower(?)').get(body.login))return send(409,{error:'이미 사용 중인 아이디입니다'});
  addUser(body.login,p.name,body.role,body.password);const target=db.prepare('SELECT id FROM users WHERE login=?').get(body.login);saveProfile(db,target.id,p);if(body.is_admin)db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(target.id);audit(db,user,'create',target.id,{role:body.role,is_admin:body.is_admin});return send(201,{ok:true,id:target.id});
 }
 const match=/^\/api\/users\/(\d+)\/(update|password)$/.exec(path);if(match&&method==='POST'){
  const id=Number(match[1]),u=db.prepare('SELECT '+columns+' FROM users WHERE id=?').get(id);if(!u)return send(404,{error:'사용자가 없습니다'});
  if(match[2]==='password'){if(typeof body.password!=='string'||body.password.length<12||body.password.length>256)return send(400,{error:'비밀번호는 12~256자여야 합니다'});const salt=randomBytes(16).toString('hex');db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,scryptSync(body.password,salt,64).toString('hex'),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(db,user,'password_reset',id,{});return send(200,{ok:true});}
  let p;try{p=profile(body,u);}catch(error){return send(400,{error:error.message});}
  if(!['employee','manager','ceo'].includes(body.role)||typeof body.active!=='boolean'||typeof body.is_admin!=='boolean')return send(400,{error:'역할·활성 상태·Admin 권한을 확인하세요'});
  try{protectLastAdmin(db,id,body.active,body.is_admin);}catch(e){return send(409,{error:e.message});}
  db.exec('BEGIN IMMEDIATE');try{saveProfile(db,id,p);db.prepare('UPDATE users SET role=?,active=?,is_admin=? WHERE id=?').run(body.role,Number(body.active),Number(body.is_admin),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(db,user,'update',id,{role:body.role,active:body.active,is_admin:body.is_admin});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(200,{ok:true});
 }
 return send(404,{error:'찾을 수 없습니다'});
}
