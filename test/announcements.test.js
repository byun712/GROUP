import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {initializeAnnouncements} from '../announcements.js';

test('announcement migration preserves existing notices and replies across initialization',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE announcements(id INTEGER PRIMARY KEY,author INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,content TEXT NOT NULL,created TEXT NOT NULL); INSERT INTO announcements VALUES(7,1,'기존 공지','여러 줄\n본문','2026-11-03T16:00:00Z');");
  initializeAnnouncements(db);db.prepare('INSERT INTO announcement_replies(announcement_id,author,content,created) VALUES(7,1,?,?)').run('기존 답변','2026-11-04T00:00:00Z');initializeAnnouncements(db);
  assert.equal(db.prepare('SELECT content FROM announcements WHERE id=7').get().content,'여러 줄\n본문');assert.equal(db.prepare('SELECT count(*) n FROM announcement_replies').get().n,1);
 }finally{db.close();}
});

test('announcement board searches all notices, paginates, counts real replies and enforces permissions and account deletion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-notice-test-'));process.env.DATA_DIR=dir;
 const {server,addUser}=await import('../test-support/server.js');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const cookies={},ids={};
 async function call(path,login='',body){const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie:cookies[login]||'','Content-Type':'application/json',Origin:base},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 try{
  for(const [login,name,role] of [['soltec@elsoltec.com','관리자','employee'],['writer','공지 작성자','manager'],['reader','열람 직원','employee'],['ceo','대표이사','ceo']]){addUser(login,name,role,'announcement-test-123');cookies[login]=(await call('login','',{login,password:'announcement-test-123'})).cookie;ids[login]=(await call('me',login)).data.user.id;}
  // Bootstrap makes the first Admin a director; use an employee Admin to test role separation.
  const fixture=new DatabaseSync(join(dir,'group.db'));try{fixture.prepare("UPDATE users SET role='employee' WHERE id=?").run(ids['soltec@elsoltec.com']);}finally{fixture.close();}
  assert.equal((await call('announcements/board')).status,401);
  for(const login of ['reader','soltec@elsoltec.com'])assert.equal((await call('announcements',login,{title:'무권한',content:'본문'})).status,403);
  for(const body of [{title:' ',content:'본문'},{title:'제목',content:' '},{title:'x'.repeat(121),content:'본문'}])assert.equal((await call('announcements','writer',body)).status,400);
  const first=(await call('announcements','writer',{title:'이전 공지 100%_검증',content:'<script>문자 그대로</script>\n둘째 줄'})).data.id;
  const editBody={title:'이전 공지 100%_검증',content:'수정 본문',attachments:[{filename:'안내.txt',base64:Buffer.from('공지 첨부 내용').toString('base64')}]};
  assert.equal((await call(`announcements/${first}/update`,'reader',editBody)).status,403);
  assert.equal((await call(`announcements/${first}/update`,'writer',editBody)).status,200);
  let edited=(await call(`announcements/${first}`,'reader')).data;assert.equal(edited.content,'수정 본문');assert.equal(edited.can_edit,false);assert.equal(edited.attachments.length,1);
  assert.equal((await call(`announcements/${first}/update`,'soltec@elsoltec.com',{title:edited.title,content:edited.content,attachments:[{id:edited.attachments[0].id}]})).status,200);
  edited=(await call(`announcements/${first}`,'reader')).data;
  const download=await fetch(`${base}/api/announcements/${first}/attachments/${edited.attachments[0].id}`,{headers:{cookie:cookies.reader}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(await download.text(),'공지 첨부 내용');
  assert.equal((await fetch(`${base}/api/announcements/${first}/attachments/${edited.attachments[0].id}`)).status,401);
  assert.equal((await call(`announcements/${first}/update`,'writer',{...editBody,attachments:[{id:999999}]})).status,400);
  for(let i=0;i<104;i++)assert.equal((await call('announcements','writer',{title:'공지 '+String(i).padStart(3,'0'),content:'검증 본문'})).status,201);
  assert.equal((await call('announcements','ceo',{title:'대표 안내',content:'직원 안내'})).status,201);
  const page=(await call('announcements/board','reader')).data;assert.equal(page.total,106);assert.equal(page.rows.length,10);assert.equal(page.pages,11);assert.ok(page.rows.every(r=>r.reply_count===0));assert.equal(page.rows[0].content,undefined);
  const last=(await call('announcements/board?page=999','reader')).data;assert.equal(last.page,11);assert.equal(last.rows.length,6);assert.equal(last.rows.at(-1).id,first);
  for(const q of ['100%_','100%_검증']){const result=(await call('announcements/board?q='+encodeURIComponent(q),'reader')).data;assert.equal(result.total,1);assert.equal(result.rows[0].id,first);}
  assert.equal((await call('announcements/board?q='+encodeURIComponent('공지 작성자'),'reader')).data.total,105);
  assert.equal((await call('announcements/board?q=없는내용','reader')).data.total,0);
  for(const query of ['page=0','page=-1','page=1.5','page=Infinity','q='+('x'.repeat(201))])assert.equal((await call('announcements/board?'+query,'reader')).status,400);
  assert.equal((await call(`announcements/${first}`)).status,401);assert.equal((await call('announcements/999999','reader')).status,404);
  assert.equal((await call(`announcements/${first}/replies`,'',{content:'무인증'})).status,401);
  assert.equal((await call('announcements/999999/replies','reader',{content:'없는 공지'})).status,404);
  for(const content of [' ', 'x'.repeat(2001),12])assert.equal((await call(`announcements/${first}/replies`,'reader',{content})).status,400);
  assert.equal((await call(`announcements/${first}/replies`,'reader',{author:ids.ceo,content:'직원 답변\n확인했습니다.'})).status,201);
  let detail=(await call(`announcements/${first}`,'reader')).data;assert.equal(detail.content,'수정 본문');assert.equal(detail.reply_count,1);assert.equal(detail.replies[0].author,ids.reader);assert.equal(detail.replies[0].content,'직원 답변\n확인했습니다.');
  assert.equal((await call('announcements/board?q=100%25_','writer')).data.rows[0].reply_count,1);
  assert.equal((await call(`users/${ids.reader}/delete`,'soltec@elsoltec.com',{confirm_login:'reader'})).status,200);detail=(await call(`announcements/${first}`,'writer')).data;assert.equal(detail.reply_count,0);assert.equal(detail.replies.length,0);
  await call(`announcements/${first}/replies`,'ceo',{content:'대표 답변'});
  assert.equal((await call(`users/${ids.writer}/delete`,'soltec@elsoltec.com',{confirm_login:'writer'})).status,200);assert.equal((await call(`announcements/${first}`,'ceo')).status,404);
  const db=new DatabaseSync(join(dir,'group.db'));try{assert.equal(db.prepare('SELECT count(*) n FROM announcement_replies').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
 }finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
