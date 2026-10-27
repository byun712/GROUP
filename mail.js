import {initializeMailOrganization,mailOrganizationApi,validFolder,classifyMail,pageSizes} from './mail-organization.js';
import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
const LIMIT=15*1024*1024;
const validEmail=s=>typeof s==='string'&&s.length<=254&&/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s);
function requireValue(ok,message){if(!ok)throw Error(message);}
export function initializeMail(db,dir){
 db.exec(`CREATE TABLE IF NOT EXISTS mail_accounts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),email TEXT NOT NULL,username TEXT NOT NULL,password TEXT NOT NULL,pop_host TEXT NOT NULL,pop_port INTEGER NOT NULL,pop_security TEXT NOT NULL,smtp_host TEXT NOT NULL,smtp_port INTEGER NOT NULL,smtp_security TEXT NOT NULL,signature TEXT NOT NULL DEFAULT '',UNIQUE(user_id,email));
 CREATE TABLE IF NOT EXISTS mail_messages(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES mail_accounts(id),uid TEXT,folder TEXT NOT NULL,sender TEXT NOT NULL,recipients TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,sent_at TEXT NOT NULL,size INTEGER NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,UNIQUE(account_id,uid));
 CREATE TABLE IF NOT EXISTS mail_attachments(id INTEGER PRIMARY KEY,message_id INTEGER NOT NULL REFERENCES mail_messages(id),filename TEXT NOT NULL,content_type TEXT NOT NULL,content BLOB NOT NULL);`);
 initializeMailOrganization(db);
 const keyPath=resolve(dir,'mail-key');
 if(!existsSync(keyPath)){
  if(db.prepare('SELECT count(*) n FROM mail_accounts').get().n)throw Error('메일 암호화 키가 없습니다. data/mail-key를 백업에서 복원하세요.');
  writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});
 }
 const key=readFileSync(keyPath);requireValue(key.length===32,'메일 암호화 키 오류');
 const encrypt=password=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return JSON.stringify({iv:iv.toString('base64'),data:Buffer.concat([cipher.update(password,'utf8'),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')});};
 const decrypt=password=>{const p=JSON.parse(password),c=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));c.setAuthTag(Buffer.from(p.tag,'base64'));return Buffer.concat([c.update(Buffer.from(p.data,'base64')),c.final()]).toString('utf8');};
 return {encrypt,decrypt,busy:new Set()};
}
// Buffered POP3 reader: multiline replies are dot-unstuffed, capped and timed out.
class PopReader{
 constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.waiter=null;this.failure=null;this.onData=b=>{this.buffer=Buffer.concat([this.buffer,b]);if(this.buffer.length>LIMIT*2){this.fail(Error('메일 응답 용량 초과'));socket.destroy();}this.wake();};this.onError=e=>this.fail(e);this.onClose=()=>this.fail(Error('POP3 연결이 종료되었습니다'));socket.on('data',this.onData);socket.on('error',this.onError);socket.on('close',this.onClose);socket.setTimeout(20000,()=>socket.destroy(Error('POP3 응답 시간 초과')));}
 wake(){this.waiter?.();this.waiter=null;}fail(e){this.failure=e;this.wake();}
 async line(){for(;;){const i=this.buffer.indexOf('\r\n');if(i>=0){const l=this.buffer.subarray(0,i);this.buffer=this.buffer.subarray(i+2);return l;}if(this.failure)throw this.failure;await new Promise(r=>this.waiter=r);}}
 async ok(){const l=(await this.line()).toString();requireValue(l.startsWith('+OK'),'POP3 서버가 요청을 거절했습니다. 계정 및 연결 설정을 확인하세요.');return l;}
 async command(cmd,multi=false){this.socket.write(cmd+'\r\n');await this.ok();if(!multi)return;const lines=[];let size=0;for(;;){let line=await this.line();if(line.equals(Buffer.from('.')))break;if(line[0]===46)line=line.subarray(1);size+=line.length+2;requireValue(size<=LIMIT,'수신 메일은 15MB까지 지원합니다');lines.push(line,Buffer.from('\r\n'));}return Buffer.concat(lines);}
 detach(){this.socket.off('data',this.onData);this.socket.off('error',this.onError);this.socket.off('close',this.onClose);}
}
async function connectPop(a,password){
 let socket=a.pop_security==='tls'?tls.connect({host:a.pop_host,port:a.pop_port,servername:net.isIP(a.pop_host)?undefined:a.pop_host}):net.connect({host:a.pop_host,port:a.pop_port});
 const reader=new PopReader(socket);try{await once(socket,a.pop_security==='tls'?'secureConnect':'connect');await reader.ok();if(a.pop_security==='starttls'){await reader.command('STLS');reader.detach();socket=tls.connect({socket,servername:net.isIP(a.pop_host)?undefined:a.pop_host});const secure=new PopReader(socket);await once(socket,'secureConnect');await secure.command('USER '+a.username);await secure.command('PASS '+password);return secure;}await reader.command('USER '+a.username);await reader.command('PASS '+password);return reader;}catch(e){socket.destroy();throw e;}
}
function insertMessage(db,account,uid,folder,message,size){
 if(folder==='inbox')folder=classifyMail(db,account,message);
 db.exec('BEGIN IMMEDIATE');try{const r=db.prepare('INSERT INTO mail_messages(account_id,uid,folder,sender,recipients,subject,body,sent_at,size,is_read) VALUES(?,?,?,?,?,?,?,?,?,?)').run(account,uid,folder,message.sender,message.recipients,message.subject,message.body,message.date,size,folder==='sent'?1:0);for(const a of message.attachments)db.prepare('INSERT INTO mail_attachments(message_id,filename,content_type,content) VALUES(?,?,?,?)').run(r.lastInsertRowid,a.filename||'attachment',a.contentType||'application/octet-stream',a.content);db.exec('COMMIT');return Number(r.lastInsertRowid);}catch(e){db.exec('ROLLBACK');throw e;}
}
export async function mailApi(db,state,path,method,user,b,send,res,url){
 const accounts=()=>db.prepare('SELECT id,email,username,pop_host,pop_port,pop_security,smtp_host,smtp_port,smtp_security,signature FROM mail_accounts WHERE user_id=? ORDER BY id').all(user.id);
 const own=id=>db.prepare('SELECT * FROM mail_accounts WHERE id=? AND user_id=?').get(Number(id),user.id);
 try{
 if(mailOrganizationApi(db,state,path,method,user,b,send,url,own))return;
 if(path==='/api/mail/accounts'&&method==='GET')return send(200,accounts());
 if(path==='/api/mail/accounts'&&method==='POST'){
  requireValue(validEmail(b.email),'이메일 주소를 확인하세요');requireValue(typeof b.username==='string'&&b.username.length>0&&b.username.length<=254&&!/[\r\n\0]/.test(b.username),'메일 사용자 아이디를 확인하세요');
  for(const p of ['pop','smtp']){requireValue(typeof b[p+'_host']==='string'&&/^[a-zA-Z0-9.-]{1,253}$/.test(b[p+'_host']),'서버 주소에는 호스트 이름만 입력하세요');requireValue(Number.isInteger(b[p+'_port'])&&b[p+'_port']>0&&b[p+'_port']<=65535,'포트를 확인하세요');requireValue(['none','starttls','tls'].includes(b[p+'_security']),'보안 연결 설정을 확인하세요');}
  const old=b.id?own(b.id):null;requireValue(!b.id||old,'계정을 찾을 수 없습니다');requireValue(!old||!state.busy.has(old.id),'메일 작업이 진행 중입니다');requireValue(typeof b.signature==='string'&&b.signature.length<=2000,'서명은 2000자까지 입력하세요');requireValue((!b.password&&old)||typeof b.password==='string'&&b.password.length>0&&b.password.length<=512&&!/[\r\n\0]/.test(b.password),'메일 계정 비밀번호를 입력하세요');
  const values=[b.email,b.username,b.password?state.encrypt(b.password):old.password,b.pop_host,b.pop_port,b.pop_security,b.smtp_host,b.smtp_port,b.smtp_security,b.signature];
  if(old)db.prepare('UPDATE mail_accounts SET email=?,username=?,password=?,pop_host=?,pop_port=?,pop_security=?,smtp_host=?,smtp_port=?,smtp_security=?,signature=? WHERE id=?').run(...values,old.id);else{requireValue(accounts().length<10,'메일 계정은 10개까지 등록 가능합니다');db.prepare('INSERT INTO mail_accounts(email,username,password,pop_host,pop_port,pop_security,smtp_host,smtp_port,smtp_security,signature,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values,user.id);}return send(200,{ok:true});
 }
 if(path==='/api/mail/messages'&&method==='GET'){
  const a=own(url.searchParams.get('account'));requireValue(a,'메일 계정을 선택하세요');const folder=url.searchParams.get('folder')||'inbox',q=(url.searchParams.get('q')||'').slice(0,100),size=Number(url.searchParams.get('page_size')||db.prepare('SELECT page_size FROM mail_preferences WHERE account_id=?').get(a.id)?.page_size||20);requireValue(pageSizes.includes(size),'표시 개수는 20~100개, 10개 단위로 선택하세요');requireValue(folder==='all'||validFolder(db,a.id,folder),'메일함 오류');const filter=`account_id=? AND ${folder==='all'?"folder NOT IN ('sent','spam','trash')":'folder=?'} AND (subject LIKE ? OR sender LIKE ? OR recipients LIKE ?)`;const args=[a.id,...(folder==='all'?[]:[folder]),'%'+q+'%','%'+q+'%','%'+q+'%'],total=db.prepare('SELECT count(*) n FROM mail_messages WHERE '+filter).get(...args).n,page=Math.max(1,Math.min(Math.max(1,Math.ceil(total/size)),Math.floor(Number(url.searchParams.get('page')))||1));return send(200,{total,page,page_size:size,messages:db.prepare('SELECT id,sender,recipients,subject,sent_at,size,is_read,(SELECT count(*) FROM mail_attachments WHERE message_id=m.id) attachment_count FROM mail_messages m WHERE '+filter+' ORDER BY sent_at DESC,id DESC LIMIT ? OFFSET ?').all(...args,size,(page-1)*size)});
 }
 const match=path.match(/^\/api\/mail\/messages\/(\d+)(?:\/(move))?$/);
 if(match){const m=db.prepare('SELECT m.* FROM mail_messages m JOIN mail_accounts a ON a.id=m.account_id WHERE m.id=? AND a.user_id=?').get(Number(match[1]),user.id);requireValue(m,'메일을 찾을 수 없습니다');if(method==='GET'&&!match[2]){db.prepare('UPDATE mail_messages SET is_read=1 WHERE id=?').run(m.id);return send(200,{...m,attachments:db.prepare('SELECT id,filename,length(content) size FROM mail_attachments WHERE message_id=?').all(m.id)});}if(method==='POST'&&match[2]){requireValue(validFolder(db,m.account_id,b.folder),'메일함 오류');db.prepare('UPDATE mail_messages SET folder=? WHERE id=?').run(b.folder,m.id);return send(200,{ok:true});}}
 const att=path.match(/^\/api\/mail\/attachments\/(\d+)$/);if(att&&method==='GET'){const a=db.prepare('SELECT t.* FROM mail_attachments t JOIN mail_messages m ON m.id=t.message_id JOIN mail_accounts a ON a.id=m.account_id WHERE t.id=? AND a.user_id=?').get(Number(att[1]),user.id);requireValue(a,'첨부파일을 찾을 수 없습니다');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(a.filename).replace(/'/g,'%27')}`,'Cache-Control':'no-store'});return res.end(Buffer.from(a.content));}
 if((path==='/api/mail/sync'||path==='/api/mail/send')&&method==='POST'){
  const a=own(b.account_id);requireValue(a,'메일 계정을 선택하세요');requireValue(!state.busy.has(a.id),'이 계정에서 메일 작업이 진행 중입니다');state.busy.add(a.id);try{
   const password=state.decrypt(a.password);
   if(path.endsWith('/sync')){let reader;try{reader=await connectPop(a,password);const uidLines=(await reader.command('UIDL',true)).toString('utf8').trim().split('\r\n').filter(Boolean);let received=0,remaining=0;for(const line of uidLines.reverse()){const m=line.match(/^(\d+) ([!-~]{1,200})$/);requireValue(m,'POP3 UIDL 응답을 확인할 수 없습니다');if(db.prepare('SELECT id FROM mail_messages WHERE account_id=? AND uid=?').get(a.id,m[2]))continue;if(received>=30){remaining++;continue;}const raw=await reader.command('RETR '+m[1],true);const mail=await simpleParser(raw,{skipHtmlToText:false,skipTextToHtml:true,maxHtmlLengthToParse:LIMIT});insertMessage(db,a.id,m[2],'inbox',{sender:mail.from?.text||'',recipients:mail.to?.text||'',subject:mail.subject||'(제목 없음)',body:mail.text||'',date:mail.date&&!Number.isNaN(+mail.date)?mail.date.toISOString():new Date().toISOString(),attachments:mail.attachments},raw.length);received++;}await reader.command('QUIT');return send(200,{ok:true,received,remaining});}finally{reader?.socket.destroy();}}
   requireValue(Array.isArray(b.to)&&b.to.length>0&&b.to.length<=30&&b.to.every(validEmail),'받는 사람 이메일을 확인하세요 (최대 30명)');requireValue(typeof b.subject==='string'&&b.subject.trim()&&b.subject.length<=200&&!/[\r\n]/.test(b.subject),'제목을 확인하세요');requireValue(typeof b.text==='string'&&b.text.length<=100000,'본문은 10만 자까지 입력하세요');requireValue(Array.isArray(b.attachments)&&b.attachments.length<=10,'첨부파일은 최대 10개입니다');let total=0;const attachments=b.attachments.map(t=>{requireValue(typeof t.filename==='string'&&t.filename.length>0&&t.filename.length<=255&&!/[\r\n\0/\\]/.test(t.filename),'첨부파일 이름 오류');requireValue(typeof t.base64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(t.base64),'첨부파일 형식 오류');const content=Buffer.from(t.base64,'base64');total+=content.length;requireValue(total<=10*1024*1024,'첨부파일 합계는 10MB까지 지원합니다');return {filename:t.filename,content,contentType:'application/octet-stream'};});
   const transport=nodemailer.createTransport({host:a.smtp_host,port:a.smtp_port,secure:a.smtp_security==='tls',requireTLS:a.smtp_security==='starttls',ignoreTLS:a.smtp_security==='none',auth:{user:a.username,pass:password},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,disableFileAccess:true,disableUrlAccess:true});const body=b.text+(a.signature?'\n\n'+a.signature:'');let result;try{result=await transport.sendMail({from:a.email,to:b.to,subject:b.subject,text:body,attachments,disableFileAccess:true,disableUrlAccess:true});}finally{transport.close();}if(!result.accepted?.length)throw Error('SMTP 서버가 메일을 수락하지 않았습니다');const id=insertMessage(db,a.id,null,'sent',{sender:a.email,recipients:result.accepted.join(', '),subject:b.subject,body,date:new Date().toISOString(),attachments},Buffer.byteLength(body)+total);return send(200,{ok:true,id,rejected:result.rejected||[]});
  }catch(e){if(e.code||/POP3|SMTP|certificate|connect|timeout/i.test(e.message))return send(400,{error:'메일 서버 연결 또는 인증에 실패했습니다. 서버 주소·포트·보안 방식·메일 비밀번호를 확인하세요.'});throw e;}finally{state.busy.delete(a.id);}
 }
 return send(404,{error:'메일 요청을 찾을 수 없습니다'});
 }catch(e){return send(400,{error:e.code==='SQLITE_CONSTRAINT_UNIQUE'?'이미 등록된 메일 계정입니다':e.message});}
}
