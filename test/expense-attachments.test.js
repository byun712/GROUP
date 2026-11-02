import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {samplePdf} from '../test-support/pdf-fixture.js';
import {snapshot,restore} from '../scripts/database.js';
import {initializeExpenses,validateExpense} from '../expenses.js';
import {prepareExpenseAttachments} from '../expense-attachments.js';

const body=()=>({title:'보험·공과금·급여 지급',expense_date:'2026-11-02',vendor:'',payment:'계좌이체',evidence_type:'기타',items:[{category:'4대보험',description:'보험료',vendor:'보험공단',vendor_info:'자동이체',supply:20000,tax:0},{category:'공과금',description:'공공요금',vendor:'공공기관',vendor_info:'은행 123-456 / 담당 부서',supply:30000,tax:3000},{category:'급여',description:'월 급여',vendor:'급여 수령인',vendor_info:'급여 계좌',supply:1000000,tax:0}]});
const upload=(filename,bytes)=>({filename,base64:bytes.toString('base64')});
test('expense attachment size/type validation and per-line vendor compatibility',()=>{
 const e=validateExpense(body());assert.equal(e.total,1053000);assert.equal(e.items[1].vendor,'공공기관');assert.match(e.vendor,/보험공단/);
 const legacy=validateExpense({...body(),vendor:'공통 거래처',items:[{category:'식비',description:'식사',supply:100,tax:0}]});assert.equal(legacy.items[0].vendor,'공통 거래처');
 for(const patch of [{vendor:'x'.repeat(101)},{vendor_info:'x'.repeat(301)},{vendor:123},{category:'잘못된 항목'}])assert.throws(()=>validateExpense({...body(),items:[{...body().items[0],...patch}]}));
 const pdf=upload('증빙.pdf',samplePdf());assert.equal(prepareExpenseAttachments(null,[pdf])[0].content_type,'application/pdf');
 for(const files of [[{...pdf,filename:'../증빙.pdf'}],[{...pdf,filename:'위장.html'}],[{...pdf,base64:Buffer.from('<script>bad</script>').toString('base64')}],Array(11).fill(pdf),[{...pdf,base64:'invalid'}]])assert.throws(()=>prepareExpenseAttachments(null,files));
 const large=Buffer.alloc(8*1048576,32);large.write('%PDF-1.4\n');large.write('%%EOF',large.length-5);assert.throws(()=>prepareExpenseAttachments(null,Array(3).fill(upload('large.pdf',large))));assert.throws(()=>prepareExpenseAttachments(null,[upload('too-big.pdf',Buffer.alloc(10*1048576+1))]));
});

test('evidence is atomic, private, immutable after approval, printable, backed up and deleted with its expense/user',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-evidence-'));process.env.DATA_DIR=join(dir,'live');const {server,addUser}=await import('../test-support/server.js');await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,db=new DatabaseSync(join(dir,'live','group.db'));db.exec('PRAGMA foreign_keys=ON');
 async function call(path,cookie,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,headers:r.headers,data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  const s={},ids={};for(const [login,role] of [['soltec@elsoltec.com','manager'],['staff','employee'],['other','employee'],['director','manager'],['ceo','ceo']]){addUser(login,login,role,'expense-upload-test');s[login]=(await call('login','',{login,password:'expense-upload-test'})).cookie;ids[login]=(await call('me',s[login])).data.user.id;}
  const pdf=samplePdf(),png=readFileSync(new URL('../public/icon-192.png',import.meta.url));
  const result=await call('expenses',s.staff,{...body(),attachments:[upload('보험 증빙.pdf',pdf),upload('영수증.png',png)]});assert.equal(result.status,201);const id=result.data.id;
  const get=async()=>(await call('expenses',s.staff)).data.find(e=>e.id===id);let row=await get();assert.equal(row.attachments.length,2);assert.ok(row.attachments.every(a=>!('content' in a)&&!('base64' in a)));
  const first=row.attachments[0],second=row.attachments[1],url=first.url.slice(5);assert.deepEqual((await call(url,s.staff)).data,pdf);assert.equal((await call(url)).status,401);assert.equal((await call(url,s.other)).status,404);
  for(const cookie of [s.director,s.ceo,s['soltec@elsoltec.com']])assert.equal((await call(url,cookie)).status,200);
  const response=await call(url,s.staff);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition'),/attachment;/);
  const otherId=(await call('expenses',s.other,{...body(),attachments:[upload('별도.pdf',pdf)]})).data.id,other=(await call('expenses',s.other)).data[0].attachments[0];
  assert.equal((await call(`expenses/${id}/attachments/${other.id}`,s.staff)).status,404);
  assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),title:'실패할 수정',attachments:[{id:other.id}],expected_version:1})).status,400);assert.equal((await get()).title,body().title);assert.equal((await get()).version,1);
  assert.equal((await call(`expenses/${id}/update`,s.other,{...body(),attachments:[],expected_version:1})).status,403);
  assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),attachments:[{id:first.id},upload('새 증빙.png',png)],expected_version:1})).status,200);
  row=await get();assert.equal(row.attachments[0].id,first.id);assert.ok(row.attachments[1].id>second.id);assert.equal((await call(second.url.slice(5),s.staff)).status,404);
  assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),attachments:[],expected_version:1})).status,409);assert.equal((await get()).attachments.length,2);
  assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),expected_version:2})).status,200);assert.equal((await get()).attachments.length,2,'older clients preserve attachments when omitted');
  const count=db.prepare('SELECT count(*) n FROM expense_requests').get().n;assert.equal((await call('expenses',s.staff,{...body(),attachments:[upload('bad.pdf',Buffer.from('bad'))]})).status,400);assert.equal(db.prepare('SELECT count(*) n FROM expense_requests').get().n,count);
  await call(`expenses/${id}/action`,s.director,{action:'approve'});row=await get();assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),attachments:[],expected_version:row.version})).status,403);
  await call(`expenses/${id}/action`,s.director,{action:'reject'});row=await get();assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),attachments:[{id:first.id}],expected_version:row.version})).status,200);
  await call(`expenses/${id}/action`,s.director,{action:'approve'});await call(`expenses/${id}/action`,s.ceo,{action:'approve'});row=await get();assert.equal(row.status,'approved');assert.equal(row.attachments.length,1);
  const ledger=(await call('accounting',s.director)).data,entry=ledger.entries.find(e=>e.source_type==='expense_approval'&&e.source_id===id);assert.deepEqual(entry.lines.filter(l=>l.debit&&l.account_code!=='135').map(l=>l.account_code),['506','507','508']);
  const book=new ExcelJS.Workbook();await book.xlsx.load((await call(`expenses/${id}/excel`,s.staff)).data);const values=[];book.worksheets[0].eachRow(r=>r.eachCell(c=>{if(c.type!==ExcelJS.ValueType.Merge)values.push(String(c.value));}));assert.ok(values.join('').includes('공공기관'));assert.ok(values.join('').includes('은행 123-456 / 담당 부서'));assert.ok(values.join('').includes('보험 증빙.pdf'));
  assert.equal((await call(`expenses/${id}/update`,s.staff,{...body(),attachments:[],expected_version:row.version})).status,403);
  initializeExpenses(db);assert.deepEqual((await call(url,s.staff)).data,pdf);
  await snapshot(join(dir,'live','group.db'),join(dir,'backup.db'));await restore(join(dir,'backup.db'),join(dir,'restored'));const restored=new DatabaseSync(join(dir,'restored','group.db'));assert.deepEqual(Buffer.from(restored.prepare('SELECT content FROM expense_attachments WHERE id=?').get(first.id).content),pdf);restored.close();
  assert.equal((await call(`expenses/${otherId}/delete`,s.other,{confirm:true})).status,200);assert.equal(db.prepare('SELECT count(*) n FROM expense_attachments WHERE expense_id=?').get(otherId).n,0);
  assert.equal((await call(`users/${ids.staff}/delete`,s['soltec@elsoltec.com'],{confirm_login:'staff'})).status,200);assert.equal(db.prepare('SELECT count(*) n FROM expense_attachments').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
