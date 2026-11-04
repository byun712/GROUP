import {check,text,transaction,InputError} from './business-common.js';

export function initializeAnnouncements(db){
 db.exec(`CREATE TABLE IF NOT EXISTS announcement_files(id INTEGER PRIMARY KEY AUTOINCREMENT,announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,filename TEXT NOT NULL,content BLOB NOT NULL); CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY,author INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,content TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS announcement_replies(id INTEGER PRIMARY KEY,announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,author INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,content TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS announcement_replies_parent ON announcement_replies(announcement_id,id);`);
}
function attachmentList(db,id){return db.prepare('SELECT id,filename,length(content) size FROM announcement_files WHERE announcement_id=? ORDER BY id').all(id);}
function prepareFiles(db,input,id){
 if(input===undefined)return null;
 check(Array.isArray(input)&&input.length<=5,'첨부파일은 최대 5개입니다');let total=0;const used=new Set();
 return input.map(f=>{let item;if(f?.id!==undefined){check(Number.isSafeInteger(f.id)&&!used.has(f.id),'첨부파일을 확인하세요');used.add(f.id);item=db.prepare('SELECT filename,content FROM announcement_files WHERE id=? AND announcement_id=?').get(f.id,id);check(!!item,'첨부파일을 확인하세요');}else{check(f&&typeof f.filename==='string'&&f.filename.isWellFormed()&&f.filename.trim()&&f.filename.length<=180&&!/[\\/\x00-\x1f\x7f]/.test(f.filename),'파일명을 확인하세요');check(typeof f.base64==='string'&&f.base64.length<=6990508&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64),'파일은 5MB 이하여야 합니다');item={filename:f.filename,content:Buffer.from(f.base64,'base64')};}check(item.content.length>0&&item.content.length<=5*1024*1024,'파일은 5MB 이하여야 합니다');total+=item.content.length;check(total<=10*1024*1024,'첨부파일 합계는 10MB 이하여야 합니다');return item;});
}
function saveFiles(db,id,files){if(files===null)return;db.prepare('DELETE FROM announcement_files WHERE announcement_id=?').run(id);for(const f of files)db.prepare('INSERT INTO announcement_files(announcement_id,filename,content) VALUES(?,?,?)').run(id,f.filename,f.content);}
const columns='a.id,a.author,a.title,a.created,u.name,(SELECT count(*) FROM announcement_replies r WHERE r.announcement_id=a.id) reply_count';
export function announcementApi(db,path,method,user,body,send,url,res){try{
 const file=/^\/api\/announcements\/(\d+)\/attachments\/(\d+)$/.exec(path);if(file&&method==='GET'){const f=db.prepare('SELECT filename,content FROM announcement_files WHERE announcement_id=? AND id=?').get(Number(file[1]),Number(file[2]));if(!f)return send(404,{error:"첨부파일이 없습니다"});res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Disposition":"attachment; filename=download; filename*=UTF-8\'\'"+encodeURIComponent(f.filename),"Cache-Control":"no-store"});res.end(f.content);return;}
 const edit=/^\/api\/announcements\/(\d+)\/update$/.exec(path);if(edit&&method==='POST'){const n=db.prepare('SELECT * FROM announcements WHERE id=?').get(Number(edit[1]));if(!n)return send(404,{error:"공지사항이 없습니다"});if(n.author!==user.id&&!user.is_admin)return send(403,{error:"작성자 또는 Admin만 수정할 수 있습니다"});check(text(body.title,120)&&text(body.content,8000),"제목과 내용을 확인하세요");const files=prepareFiles(db,body.attachments,n.id);transaction(db,()=>{db.prepare('UPDATE announcements SET title=?,content=? WHERE id=?').run(body.title.trim(),body.content.trim(),n.id);saveFiles(db,n.id,files);});return send(200,{ok:true,id:n.id});}
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
  const files=prepareFiles(db,body.attachments,null);const id=transaction(db,()=>{const result=db.prepare('INSERT INTO announcements(author,title,content,created) VALUES(?,?,?,?)').run(user.id,body.title.trim(),body.content.trim(),new Date().toISOString());
  const id=Number(result.lastInsertRowid);saveFiles(db,id,files);return id;});return send(201,{ok:true,id});
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
  return send(200,{...item,replies,can_edit:item.author===user.id||!!user.is_admin,attachments:attachmentList(db,item.id)});
 }
 return send(404,{error:'찾을 수 없습니다'});
}catch(error){if(error instanceof InputError)return send(400,{error:error.message});throw error;}}
