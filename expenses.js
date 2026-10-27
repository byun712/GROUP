import {postApprovedExpense} from './accounting.js';
const categories=['식비','교통비','소모품비','통신비','교육비','기타'];
const payments=['법인카드','개인카드','계좌이체','현금'];
const evidenceTypes=['영수증','세금계산서','카드전표','기타'];
export function initializeExpenses(db){db.exec(`
 CREATE TABLE IF NOT EXISTS expense_requests(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,expense_date TEXT NOT NULL,vendor TEXT NOT NULL,payment TEXT NOT NULL,evidence_type TEXT NOT NULL,evidence_ref TEXT NOT NULL,notes TEXT NOT NULL,items TEXT NOT NULL,supply INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'manager',created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS expense_decisions(id INTEGER PRIMARY KEY,expense_id INTEGER NOT NULL REFERENCES expense_requests(id),actor INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,created TEXT NOT NULL);
`);
 for(const [column,definition] of [['form_type',"TEXT NOT NULL DEFAULT 'expense'"],['project_name',"TEXT NOT NULL DEFAULT ''"],['project_code',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare('PRAGMA table_info(expense_requests)').all().some(c=>c.name===column))db.exec(`ALTER TABLE expense_requests ADD COLUMN ${column} ${definition}`);
}
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const string=(value,max,required=true)=>typeof value==='string'&&value.length<=max&&(!required||!!value.trim());
export function validateExpense(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('지출결의서 입력 형식을 확인하세요');
 const {form_type='expense',project_name='',project_code='',title,expense_date,vendor,payment,evidence_type,evidence_ref='',notes='',items}=body;
 if(!['expense','research_expense'].includes(form_type)||!string(project_name,120,form_type==='research_expense')||!string(project_code,80,false)||!string(title,120)||!validDate(expense_date)||!string(vendor,100)||!payments.includes(payment)||!evidenceTypes.includes(evidence_type)||!string(evidence_ref,100,false)||!string(notes,2000,false)||!Array.isArray(items)||items.length<1||items.length>20)throw Error('제목·지출일·거래처·결제수단·증빙 종류와 항목(1~20개)을 확인하세요');
 let supply=0,tax=0;const clean=[];
 for(const item of items){if(!item||!categories.includes(item.category)||!string(item.description,100)||!Number.isSafeInteger(item.supply)||!Number.isSafeInteger(item.tax)||item.supply<0||item.tax<0||item.supply+item.tax<=0||item.supply+item.tax>1000000000000)throw Error('항목명과 금액을 확인하세요. 원 단위의 0 이상 정수를 입력하고 항목 합계는 0보다 커야 합니다');supply+=item.supply;tax+=item.tax;clean.push({category:item.category,description:item.description.trim(),supply:item.supply,tax:item.tax});}
 if(supply+tax>1000000000000)throw Error('총액은 1조 원 이하여야 합니다');
 return {form_type,project_name:form_type==='research_expense'?project_name.trim():'',project_code:form_type==='research_expense'?project_code.trim():'',title:title.trim(),expense_date,vendor:vendor.trim(),payment,evidence_type,evidence_ref:evidence_ref.trim(),notes:notes.trim(),items:clean,supply,tax,total:supply+tax};
}
export function expenseApi(db,path,method,user,body,send){
 if(path==='/api/expenses'&&method==='GET'){
  const rows=user.role==='employee'?db.prepare('SELECT e.*,u.name FROM expense_requests e JOIN users u ON u.id=e.user_id WHERE e.user_id=? ORDER BY e.id DESC').all(user.id):db.prepare('SELECT e.*,u.name FROM expense_requests e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC').all();
  for(const row of rows){row.items=JSON.parse(row.items);row.history=db.prepare('SELECT d.action,d.created,u.name,u.role FROM expense_decisions d JOIN users u ON u.id=d.actor WHERE expense_id=? ORDER BY d.id').all(row.id);}return send(200,rows);
 }
 if(path==='/api/expenses'&&method==='POST'){
  let e;try{e=validateExpense(body);}catch(error){return send(400,{error:error.message});}
  const result=db.prepare('INSERT INTO expense_requests(user_id,title,expense_date,vendor,payment,evidence_type,evidence_ref,notes,items,supply,tax,total,created,form_type,project_name,project_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(user.id,e.title,e.expense_date,e.vendor,e.payment,e.evidence_type,e.evidence_ref,e.notes,JSON.stringify(e.items),e.supply,e.tax,e.total,new Date().toISOString(),e.form_type,e.project_name,e.project_code);return send(201,{id:Number(result.lastInsertRowid),ok:true});
 }
 if(/^\/api\/expenses\/\d+\/action$/.test(path)&&method==='POST'){
  const id=Number(path.split('/')[3]),row=db.prepare('SELECT * FROM expense_requests WHERE id=?').get(id);if(!row)return send(404,{error:'지출결의서가 없습니다'});
  let next;if(body.action==='withdraw'&&row.user_id===user.id&&row.status==='manager')next='withdrawn';else if((row.user_id!==user.id||user.role==='manager')&&row.status===user.role&&['approve','reject'].includes(body.action))next=body.action==='reject'?'rejected':user.role==='manager'?'ceo':'approved';else return send(403,{error:'현재 단계에서 처리할 권한이 없습니다'});
  db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE expense_requests SET status=? WHERE id=?').run(next,id);db.prepare('INSERT INTO expense_decisions(expense_id,actor,action,created) VALUES(?,?,?,?)').run(id,user.id,body.action,new Date().toISOString());if(next==='approved')postApprovedExpense(db,row,user.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return send(200,{ok:true});
 }
 return send(404,{error:'찾을 수 없습니다'});
}
