import {randomBytes,scryptSync} from 'node:crypto';
export const FIRST_ADMIN='soltec@elsoltec.com';
export function initializeAccounts(db){
 if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='is_admin'))db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
 db.exec(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS account_audit(id INTEGER PRIMARY KEY,actor INTEGER,action TEXT NOT NULL,target INTEGER,details TEXT NOT NULL,created TEXT NOT NULL);`);bootstrapAdmin(db);
}
export function bootstrapAdmin(db){if(db.prepare("SELECT value FROM app_settings WHERE key='admin_bootstrapped'").get())return;const u=db.prepare('SELECT id FROM users WHERE lower(trim(login))=? AND active=1').get(FIRST_ADMIN);if(!u)return;db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE users SET is_admin=1,role='manager' WHERE id=?").run(u.id);db.prepare("INSERT INTO app_settings VALUES('admin_bootstrapped','1')").run();db.prepare("INSERT INTO account_audit(actor,action,target,details,created) VALUES(NULL,'bootstrap',?,'initial administrator',?)").run(u.id,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
export function protectLastAdmin(db,id,active,isAdmin){const u=db.prepare('SELECT active,is_admin FROM users WHERE id=?').get(id);if(u?.active&&u.is_admin&&(!active||!isAdmin)&&db.prepare('SELECT count(*) n FROM users WHERE active=1 AND is_admin=1 AND id<>?').get(id).n===0)throw Error('마지막 활성 관리자는 해제하거나 비활성화할 수 없습니다');}
function audit(db,user,action,target,details){db.prepare('INSERT INTO account_audit(actor,action,target,details,created) VALUES(?,?,?,?,?)').run(user.id,action,target,JSON.stringify(details),new Date().toISOString());}
export function accountApi(db,path,method,user,body,send,addUser){
 if(!user.is_admin)return send(403,{error:'Admin 권한이 필요합니다'});
 if(path==='/api/users'&&method==='GET')return send(200,db.prepare('SELECT id,login,name,role,active,is_admin FROM users ORDER BY id').all());
 if(path==='/api/users'&&method==='POST'){
  if(!body||typeof body.login!=='string'||!/^[-A-Za-z0-9_.@+]{3,100}$/.test(body.login)||typeof body.name!=='string'||!body.name.trim()||body.name.length>80||!['employee','manager','ceo'].includes(body.role)||typeof body.password!=='string'||body.password.length<12||body.password.length>256||typeof body.is_admin!=='boolean')return send(400,{error:'아이디·이름·역할·비밀번호(12~256자)를 확인하세요'});
  if(db.prepare('SELECT id FROM users WHERE lower(login)=lower(?)').get(body.login))return send(409,{error:'이미 사용 중인 아이디입니다'});
  addUser(body.login,body.name.trim(),body.role,body.password);const target=db.prepare('SELECT id FROM users WHERE login=?').get(body.login);if(body.is_admin)db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(target.id);audit(db,user,'create',target.id,{role:body.role,is_admin:body.is_admin});return send(201,{ok:true,id:target.id});
 }
 const match=/^\/api\/users\/(\d+)\/(update|password)$/.exec(path);if(match&&method==='POST'){
  const id=Number(match[1]),u=db.prepare('SELECT id FROM users WHERE id=?').get(id);if(!u)return send(404,{error:'사용자가 없습니다'});
  if(match[2]==='password'){if(typeof body.password!=='string'||body.password.length<12||body.password.length>256)return send(400,{error:'비밀번호는 12~256자여야 합니다'});const salt=randomBytes(16).toString('hex');db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,scryptSync(body.password,salt,64).toString('hex'),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(db,user,'password_reset',id,{});return send(200,{ok:true});}
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80||!['employee','manager','ceo'].includes(body.role)||typeof body.active!=='boolean'||typeof body.is_admin!=='boolean')return send(400,{error:'이름·역할·활성 상태·Admin 권한을 확인하세요'});
  try{protectLastAdmin(db,id,body.active,body.is_admin);}catch(e){return send(409,{error:e.message});}
  db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET name=?,role=?,active=?,is_admin=? WHERE id=?').run(body.name.trim(),body.role,Number(body.active),Number(body.is_admin),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(db,user,'update',id,{role:body.role,active:body.active,is_admin:body.is_admin});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(200,{ok:true});
 }
 return send(404,{error:'찾을 수 없습니다'});
}
