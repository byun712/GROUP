// Template metadata is shared with the browser through an authenticated API.
const field=(key,label,type='text',extra={})=>({key,label,type,required:true,...extra});
export const approvalTemplates=[
 {id:'purchase_order',name:'발주서',storage:'draft',fields:[field('vendor','거래처'),field('due_date','납기일','date'),field('items','발주 품목·규격·수량','textarea'),field('amount','발주 총액 (원)','money')]},
 {id:'proposal',name:'품의서',storage:'draft',fields:[field('purpose','품의 목적'),field('content','품의 내용','textarea'),field('amount','예상 비용 (원)','money')]},
 {id:'overtime',name:'초과근무신청서',storage:'draft',fields:[field('work_date','근무일','date'),field('start_time','시작 시각','time'),field('end_time','종료 시각','time'),field('content','업무 내용','textarea')],description:'같은 날짜의 초과근무를 신청합니다. 자정을 넘으면 날짜별로 나눠 신청하세요.'},
 {id:'leave',name:'휴가신청서',storage:'leave'},
 {id:'expense',name:'지출결의서',storage:'expense'},
 {id:'general',name:'기안서',storage:'draft',fields:[field('content','기안 내용','textarea')]},
 {id:'explanation',name:'사유서',storage:'draft',fields:[field('event_date','발생일','date'),field('content','사유 및 경위','textarea')]},
 {id:'condolence',name:'경조사신청서',storage:'draft',fields:[field('event_type','경조사 구분','select',{options:['결혼','출산','조의','기타']}),field('event_date','행사일','date'),field('relation','대상자와의 관계'),field('content','신청 내용','textarea')]},
 {id:'trip_order',name:'출장명령서',storage:'draft',fields:[field('start_date','출장 시작일','date'),field('end_date','출장 종료일','date'),field('destination','출장지'),field('content','출장 목적','textarea'),field('amount','예상 경비 (원)','money')]},
 {id:'trip_report',name:'출장보고서',storage:'draft',fields:[field('start_date','출장 시작일','date'),field('end_date','출장 종료일','date'),field('destination','출장지'),field('content','출장 결과 보고','textarea')]},
 {id:'trip_expense',name:'출장비청구서',storage:'draft',fields:[field('start_date','출장 시작일','date'),field('end_date','출장 종료일','date'),field('content','교통·숙박 등 청구 내역','textarea'),field('amount','청구 총액 (원)','money')]},
 {id:'resignation',name:'사직서',storage:'draft',fields:[field('resign_date','희망 퇴사일','date'),field('content','사직 사유 및 인수인계','textarea')]}
];
export function initializeApprovals(db){db.exec(`CREATE TABLE IF NOT EXISTS approval_requests(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),template_id TEXT NOT NULL,title TEXT NOT NULL,fields TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'manager',created TEXT NOT NULL,schema_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS approval_decisions(id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES approval_requests(id),actor INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,created TEXT NOT NULL);`);}
const realDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateDraft(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('기안 내용을 확인하세요');
 const template=approvalTemplates.find(t=>t.id===body.template_id&&t.storage==='draft');
 if(!template||typeof body.title!=='string'||!body.title.trim()||body.title.length>120||!body.fields||typeof body.fields!=='object'||Array.isArray(body.fields))throw Error('양식·제목·입력 항목을 확인하세요');
 const fields={};for(const f of template.fields){const v=body.fields[f.key];let valid;
 if(f.type==='money')valid=Number.isSafeInteger(v)&&v>=0&&v<=1000000000000;
 else if(f.type==='date')valid=realDate(v);
 else if(f.type==='time')valid=typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
 else if(f.type==='select')valid=f.options.includes(v);
 else valid=typeof v==='string'&&!!v.trim()&&v.length<=(f.type==='textarea'?5000:200);
 if(!valid)throw Error(f.label+' 입력을 확인하세요');fields[f.key]=typeof v==='string'?v.trim():v;
 }
 if(fields.start_date&&fields.start_date>fields.end_date)throw Error('종료일은 시작일 이후여야 합니다');
 if(template.id==='overtime'&&fields.start_time>=fields.end_time)throw Error('종료 시각은 시작 시각 이후여야 합니다');
 return {template_id:template.id,title:body.title.trim(),fields};
}
export function approvalApi(db,path,method,user,body,send){
 if(path==='/api/approval-templates'&&method==='GET')return send(200,approvalTemplates);
 if(path==='/api/approvals'&&method==='GET'){
  const rows=user.role==='employee'?db.prepare('SELECT a.*,u.name FROM approval_requests a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY a.id DESC').all(user.id):db.prepare('SELECT a.*,u.name FROM approval_requests a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC').all();
  for(const row of rows){row.fields=JSON.parse(row.fields);row.history=db.prepare('SELECT d.action,d.created,u.name FROM approval_decisions d JOIN users u ON u.id=d.actor WHERE request_id=? ORDER BY d.id').all(row.id);}return send(200,rows);
 }
 if(path==='/api/approvals'&&method==='POST'){
  let draft;try{draft=validateDraft(body);}catch(error){return send(400,{error:error.message});}
  const result=db.prepare('INSERT INTO approval_requests(user_id,template_id,title,fields,created) VALUES(?,?,?,?,?)').run(user.id,draft.template_id,draft.title,JSON.stringify(draft.fields),new Date().toISOString());return send(201,{id:Number(result.lastInsertRowid),ok:true});
 }
 if(/^\/api\/approvals\/\d+\/action$/.test(path)&&method==='POST'){
  const id=Number(path.split('/')[3]),row=db.prepare('SELECT * FROM approval_requests WHERE id=?').get(id);if(!row)return send(404,{error:'기안 문서가 없습니다'});
  let next;if(body.action==='withdraw'&&row.user_id===user.id&&row.status==='manager')next='withdrawn';else if(row.status===user.role&&['approve','reject'].includes(body.action))next=body.action==='reject'?'rejected':user.role==='manager'?'ceo':'approved';else return send(403,{error:'현재 단계에서 처리할 권한이 없습니다'});
  db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE approval_requests SET status=? WHERE id=?').run(next,id);db.prepare('INSERT INTO approval_decisions(request_id,actor,action,created) VALUES(?,?,?,?)').run(id,user.id,body.action,new Date().toISOString());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return send(200,{ok:true});
 }
 return send(404,{error:'찾을 수 없습니다'});
}
