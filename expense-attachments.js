import {imageSize} from 'image-size';
import {check} from './business-common.js';
import {readableDocument} from './signatures.js';

export const ATTACHMENT_LIMITS={count:10,fileBytes:10*1024*1024,totalBytes:20*1024*1024};
export function initializeExpenseAttachments(db){
 db.exec(`CREATE TABLE IF NOT EXISTS expense_attachments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,
  content BLOB NOT NULL,created TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS expense_attachments_document ON expense_attachments(expense_id);`);
}
export function expenseAttachmentList(db,id){
 return db.prepare('SELECT id,filename,content_type,size,created FROM expense_attachments WHERE expense_id=? ORDER BY id').all(id).map(a=>({...a,url:`/api/expenses/${id}/attachments/${a.id}`}));
}
export function prepareExpenseAttachments(db,input,id=null){
 const existing=id?expenseAttachmentList(db,id):[];
 if(input===undefined)return existing;
 check(Array.isArray(input)&&input.length<=ATTACHMENT_LIMITS.count,'첨부파일은 최대 10개까지 등록하세요');
 const used=new Set();let total=0;
 return input.map(item=>{
  check(item&&typeof item==='object'&&!Array.isArray(item),'첨부파일 정보를 확인하세요');
  if(item.id!==undefined){
   const old=existing.find(a=>a.id===item.id);
   check(old&&!used.has(old.id)&&item.base64===undefined,'현재 문서에 등록된 첨부파일만 유지할 수 있습니다');
   used.add(old.id);total+=old.size;check(total<=ATTACHMENT_LIMITS.totalBytes,'첨부파일 합계는 20MB 이하여야 합니다');return old;
  }
  check(typeof item.filename==='string'&&item.filename.isWellFormed()&&item.filename.trim().length>0&&item.filename.length<=200&&!/[\u0000-\u001f\u007f/\\]/.test(item.filename),'첨부파일 이름을 확인하세요');
  check(typeof item.base64==='string'&&item.base64.length<=Math.ceil(ATTACHMENT_LIMITS.fileBytes/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64),'파일은 개당 10MB 이하의 올바른 파일이어야 합니다');
  const content=Buffer.from(item.base64,'base64');check(content.length>0&&content.length<=ATTACHMENT_LIMITS.fileBytes,'파일은 개당 10MB 이하여야 합니다');
  let type;
  if(/^%PDF-\d\.\d/.test(content.subarray(0,8).toString('ascii'))&&content.subarray(-2048).includes(Buffer.from('%%EOF')))type='application/pdf';
  else{
   let size;try{size=imageSize(content);}catch{}
   check(size&&['png','jpg'].includes(size.type)&&size.width>0&&size.height>0&&size.width<=16000&&size.height<=16000&&size.width*size.height<=40000000,'미리보기는 PDF·PNG·JPG 파일만 지원합니다');
   type=size.type==='png'?'image/png':'image/jpeg';
  }
  const extension=item.filename.toLowerCase().split('.').pop();
  check(type==='application/pdf'?extension==='pdf':type==='image/png'?extension==='png':['jpg','jpeg'].includes(extension),'파일 확장자와 실제 파일 형식이 일치해야 합니다');
  total+=content.length;check(total<=ATTACHMENT_LIMITS.totalBytes,'첨부파일 합계는 20MB 이하여야 합니다');
  return {filename:item.filename.trim(),content_type:type,size:content.length,content};
 });
}
// The caller holds the same transaction as document creation/editing.
export function saveExpenseAttachments(db,id,files){
 const kept=new Set(files.filter(f=>f.id).map(f=>f.id));
 for(const file of expenseAttachmentList(db,id))if(!kept.has(file.id))db.prepare('DELETE FROM expense_attachments WHERE id=? AND expense_id=?').run(file.id,id);
 for(const file of files)if(!file.id)db.prepare('INSERT INTO expense_attachments(expense_id,filename,content_type,size,content,created) VALUES(?,?,?,?,?,?)').run(id,file.filename,file.content_type,file.size,file.content,new Date().toISOString());
}
export function expenseAttachmentApi(db,path,user,send,res){
 const match=path.match(/^\/api\/expenses\/(\d+)\/attachments\/(\d+)$/);if(!match)return false;
 const [,id,attachmentId]=match;
 if(!readableDocument(db,'expenses',id,user)){send(404,{error:'문서가 없거나 접근할 수 없습니다'});return true;}
 const file=db.prepare('SELECT * FROM expense_attachments WHERE id=? AND expense_id=?').get(Number(attachmentId),Number(id));
 if(!file){send(404,{error:'첨부파일이 없습니다'});return true;}
 res.writeHead(200,{'Content-Type':file.content_type,'Content-Length':file.size,'Cache-Control':'no-store','Content-Disposition':`attachment; filename="expense-evidence.${file.content_type==='application/pdf'?'pdf':file.content_type==='image/png'?'png':'jpg'}"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`});res.end(Buffer.from(file.content));return true;
}
