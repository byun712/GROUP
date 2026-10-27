import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {simpleParser} from 'mailparser';
import {snapshot,restore} from '../scripts/database.js';
import {initializeMail} from '../mail.js';
const dir=mkdtempSync(join(tmpdir(),'group-mail-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../server.js');addUser('mailone','메일 사용자','employee','mail-test-password');addUser('mailtwo','다른 사용자','employee','mail-test-password');
const raw='From: Sender <sender@example.com>\r\nTo: mailbox@example.com\r\nSubject: incoming attachment\r\nDate: Tue, 27 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello <script>alert(1)</script>\r\n--test\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="sample.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\naW5jb21pbmc=\r\n--test--\r\n';
let deleted=false,delivered='',mailCount=1;
const pop=net.createServer(s=>{s.write('+OK test\r\n');let buf='';s.on('data',chunk=>{buf+=chunk;while(buf.includes('\r\n')){const n=buf.indexOf('\r\n'),line=buf.slice(0,n);buf=buf.slice(n+2);if(line==='UIDL')s.write('+OK\r\n1 unique-message\r\n'+(mailCount===2?'2 second-message\r\n':'')+'.\r\n');else if(line==='RETR 1'||line==='RETR 2')s.write('+OK\r\n'+raw+'.\r\n');else if(line.startsWith('DELE')){deleted=true;s.write('+OK\r\n');}else if(line==='QUIT'){s.end('+OK\r\n');}else s.write('+OK\r\n');}});});
const smtp=net.createServer(s=>{s.write('220 test ESMTP\r\n');let buf='',data=false,lines=[];s.on('data',chunk=>{buf+=chunk;while(buf.includes('\r\n')){const n=buf.indexOf('\r\n'),line=buf.slice(0,n);buf=buf.slice(n+2);if(data){if(line==='.'){delivered=lines.join('\r\n');data=false;s.write('250 accepted\r\n');}else lines.push(line.startsWith('..')?line.slice(1):line);continue;}if(/^EHLO/.test(line))s.write('250-test\r\n250 AUTH PLAIN\r\n');else if(/^AUTH/.test(line))s.write('235 authenticated\r\n');else if(line==='DATA'){data=true;lines=[];s.write('354 go\r\n');}else if(line==='QUIT')s.end('221 bye\r\n');else s.write('250 ok\r\n');}});});
await Promise.all([server,pop,smtp].map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));const base='http://127.0.0.1:'+server.address().port;
async function login(login){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password:'mail-test-password'})});return r.headers.get('set-cookie').split(';')[0];}
const one=await login('mailone'),two=await login('mailtwo');
async function call(path,body,cookie=one){const r=await fetch(base+'/api/mail/'+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
let id;
test('POP3 synchronization, SMTP MIME attachments, encrypted credentials and mailbox isolation',async()=>{
 try{
 const settings={email:'mailbox@example.com',username:'mailbox@example.com',password:'external-mail-secret',pop_host:'127.0.0.1',pop_port:pop.address().port,pop_security:'none',smtp_host:'127.0.0.1',smtp_port:smtp.address().port,smtp_security:'none',signature:'ELSOLTEC signature'};
 assert.equal((await call('accounts',settings)).status,200);const a=await call('accounts');id=a.data[0].id;assert.equal(a.data[0].password,undefined);
 const db=new DatabaseSync(join(dir,'group.db'));const saved=db.prepare('SELECT password FROM mail_accounts').get().password;assert.ok(!saved.includes('external-mail-secret'));db.close();assert.equal(readFileSync(join(dir,'mail-key')).length,32);
 assert.equal((await call('sync',{account_id:id})).data.received,1);assert.equal((await call('sync',{account_id:id})).data.received,0);assert.equal(deleted,false);
 const inbox=(await call('messages?account='+id)).data;assert.equal(inbox.total,1);const message=(await call('messages/'+inbox.messages[0].id)).data;assert.match(message.body,/<script>/);assert.equal(message.attachments[0].filename,'sample.txt');
 let download=await fetch(base+'/api/mail/attachments/'+message.attachments[0].id,{headers:{cookie:one}});assert.equal(await download.text(),'incoming');assert.match(download.headers.get('content-disposition'),/^attachment/);
 assert.deepEqual((await call('accounts',undefined,two)).data,[]);assert.equal((await call('messages?account='+id,undefined,two)).status,400);assert.equal((await call('messages/'+message.id,undefined,two)).status,400);download=await fetch(base+'/api/mail/attachments/'+message.attachments[0].id,{headers:{cookie:two}});assert.equal(download.status,400);
 const send={account_id:id,to:['recipient@example.com'],subject:'첨부 발송 확인',text:'한국어 본문',attachments:[{filename:'시험.txt',base64:Buffer.from('첨부 내용').toString('base64')}]};assert.equal((await call('send',send)).status,200);const parsed=await simpleParser(delivered);assert.equal(parsed.subject,send.subject);assert.match(parsed.text,/ELSOLTEC signature/);assert.equal(parsed.attachments[0].filename,'시험.txt');assert.equal(parsed.attachments[0].content.toString(),'첨부 내용');assert.equal((await call('messages?account='+id+'&folder=sent')).data.total,1);
 assert.equal((await call('send',{...send,to:['victim@example.com\r\nBcc: hidden@example.com']})).status,400);assert.equal((await call('send',{...send,attachments:[{filename:'../secret',base64:'YQ=='}]})).status,400);
 assert.equal((await call('accounts',{...settings,id,password:''})).status,200);assert.equal((await call('sync',{account_id:id})).data.received,0);
 assert.equal((await call('messages/'+message.id+'/move',{folder:'trash'})).status,200);assert.equal((await call('messages?account='+id+'&folder=trash')).data.total,1);
 await call('folders',{account_id:id,name:'자동 수신함'});const folder=(await call('organization?account='+id)).data.folders[0].id;await call('rules',{account_id:id,folder_id:folder,field:'subject',match_type:'contains',pattern:'incoming',priority:1,enabled:true});mailCount=2;assert.equal((await call('sync',{account_id:id})).data.received,1);assert.equal((await call('messages?account='+id+'&folder=f_'+folder)).data.total,1);
 const backup=join(dir,'backup.db'),restored=join(dir,'restored');await snapshot(join(dir,'group.db'),backup);assert.equal(readFileSync(backup+'.mail-key').length,32);await restore(backup,restored);const restoredDb=new DatabaseSync(join(restored,'group.db'));const restoredMail=initializeMail(restoredDb,restored);assert.equal(restoredMail.decrypt(restoredDb.prepare('SELECT password FROM mail_accounts').get().password),'external-mail-secret');restoredDb.close();
 }finally{await Promise.all([server,pop,smtp].map(s=>new Promise(r=>s.close(r))));rmSync(dir,{recursive:true,force:true});}
});
