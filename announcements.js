import {check,text,InputError} from './business-common.js';

export function initializeAnnouncements(db){
 db.exec(`CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY,author INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,content TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS announcement_replies(id INTEGER PRIMARY KEY,announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,author INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,content TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS announcement_replies_parent ON announcement_replies(announcement_id,id);`);
}
const columns='a.id,a.author,a.title,a.created,u.name,(SELECT count(*) FROM announcement_replies r WHERE r.announcement_id=a.id) reply_count';
export function announcementApi(db,path,method,user,body,send,url){try{
 if(path==='/api/announcements'&&method==='GET')return send(200,db.prepare(`SELECT ${columns},a.content FROM announcements a JOIN users u ON u.id=a.author ORDER BY a.id DESC LIMIT 100`).all());
 if(path==='/api/announcements/board'&&method==='GET'){
  const query=(url.searchParams.get('q')||'').trim(),page=Number(url.searchParams.get('page')||1);
  check(query.length<=200&&Number.isSafeInteger(page)&&page>=1&&page<=1000000,'검색어와 페이지를 확인하세요');
  const pattern='%'+query.replace(/[\\%_]/g,'\\$&')+'%',where="WHERE (a.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')";
  const total=db.prepare(`SELECT count(*) total FROM announcements a JOIN users u ON u.id=a.author ${where}`).get(pattern,pattern).total;
  const pages=Math.max(1,Math.ceil(total/10)),current=Math.min(page,pages);
  const rows=db.prepare(`SELECT ${columns} FROM announcements a JOIN users u ON u.id=a.author ${where} ORDER BY a.id DESC LIMIT 10 OFFSET ?`).all(pattern,pattern,(current-1)*10);
  return send(200,{rows,total,page:current,pages,page_size:10});
 }
 if(path==='/api/announcements'&&method==='POST'){
  if(!['manager','ceo'].includes(user.role))return send(403,{error:'이사와 대표이사만 공지를 작성할 수 있습니다'});
  check(text(body.title,120)&&text(body.content,8000),'제목(120자 이내)과 내용(8000자 이내)을 입력하세요');
  const result=db.prepare('INSERT INTO announcements(author,title,content,created) VALUES(?,?,?,?)').run(user.id,body.title.trim(),body.content.trim(),new Date().toISOString());
  return send(201,{ok:true,id:Number(result.lastInsertRowid)});
 }
 const match=/^\/api\/announcements\/(\d+)(\/replies)?$/.exec(path);
 if(match&&(method==='GET'&&!match[2]||method==='POST'&&match[2])){
  const item=db.prepare(`SELECT ${columns},a.content FROM announcements a JOIN users u ON u.id=a.author WHERE a.id=?`).get(Number(match[1]));
  if(!item)return send(404,{error:'공지사항을 찾을 수 없습니다'});
  if(method==='POST'){
   check(text(body.content,2000),'답변 내용을 1~2000자로 입력하세요');
   db.prepare('INSERT INTO announcement_replies(announcement_id,author,content,created) VALUES(?,?,?,?)').run(item.id,user.id,body.content.trim(),new Date().toISOString());
   return send(201,{ok:true});
  }
  const replies=db.prepare('SELECT r.id,r.author,r.content,r.created,u.name FROM announcement_replies r JOIN users u ON u.id=r.author WHERE r.announcement_id=? ORDER BY r.id').all(item.id);
  return send(200,{...item,replies});
 }
 return send(404,{error:'찾을 수 없습니다'});
}catch(error){if(error instanceof InputError)return send(400,{error:error.message});throw error;}}
