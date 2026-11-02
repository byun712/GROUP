import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {initializeDocumentWorkflow} from '../document-state.js';
import {initializeDocumentDeletion} from '../document-deletion.js';
import {snapshot,restore} from '../scripts/database.js';

test('author edits/resubmits all document families; director reapproves own rejection; versions, rounds, seals, quotas and final accounting remain consistent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-resubmit-'));process.env.DATA_DIR=join(dir,'live');
 const {server,addUser}=await import('../test-support/server.js');await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,db=new DatabaseSync(join(dir,'live','group.db'));db.exec('PRAGMA foreign_keys=ON');
 async function call(path,cookie,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const sessions={},ids={};
 try{
  for(const [login,role] of [['soltec@elsoltec.com','employee'],['author','employee'],['other','employee'],['director','manager'],['director2','manager'],['ceo','ceo'],['limited','employee']]){addUser(login,login,role,'resubmit-test-password');sessions[login]=(await call('login','',{login,password:'resubmit-test-password'})).cookie;ids[login]=(await call('me',sessions[login])).data.user.id;}
  const {author,director,ceo,limited}=sessions,admin=sessions['soltec@elsoltec.com'];
  const seal={content_type:'image/png',base64:readFileSync(new URL('../public/icon-192.png',import.meta.url)).toString('base64')};await call('seal',director,seal);await call('seal',ceo,seal);
  const sources=[
   ['leaves',{kind:'연차',start:'2026-11-02',end:'2026-11-02',reason:'초안'},{kind:'오전 반차',start:'2026-11-03',end:'2026-11-03',reason:'수정 휴가'}],
   ['expenses',{title:'초안',expense_date:'2026-11-02',vendor:'거래처',payment:'법인카드',evidence_type:'영수증',items:[{category:'기타',description:'항목',supply:100,tax:0}]},{title:'수정 지출',expense_date:'2026-11-03',vendor:'새 거래처',payment:'현금',evidence_type:'카드전표',items:[{category:'교통비',description:'버스',supply:200,tax:20}]}],
   ['approvals',{template_id:'general',title:'초안',fields:{content:'초안 내용'}},{template_id:'general',title:'수정 기안',fields:{content:'새 내용'}}],
   ['reports',{template_id:'daily_work_log',title:'초안',fields:{report_date:'2026-11-02',completed_work:'실시',planned_work:'예정'}},{template_id:'daily_work_log',title:'수정 보고',fields:{report_date:'2026-11-03',completed_work:'수정 실시',planned_work:'수정 예정',ongoing_work:'진행',notes:'특이사항'}}]
  ];
  for(const [source,body,edit] of sources){
   const id=(await call(source,author,body)).data.id;
   const get=async (cookie=author)=>(await call(source,cookie)).data.find(r=>r.id===id);
   const action=(cookie,action,version)=>call(`${source}/${id}/action`,cookie,{action,...(version?{expected_version:version}:{})});
   assert.equal((await get()).can_edit,true);
   for(const cookie of [sessions.other,admin,director,ceo])assert.equal((await call(`${source}/${id}/update`,cookie,{...edit,expected_version:1})).status,403);
   assert.equal((await call(`${source}/${id}/update`,author,{...edit})).status,409);
   assert.equal((await call(`${source}/${id}/update`,author,{...edit,expected_version:1})).status,200);
   assert.equal((await action(director,'approve',1)).status,409,'stale reviewer must refresh edited content');
   assert.equal((await call(`${source}/${id}/update`,author,{...body,expected_version:1})).status,409);
   assert.equal((await action(director,'approve',2)).status,200);
   assert.equal((await get()).can_edit,false);
   assert.equal((await call(`${source}/${id}/update`,author,{...body,expected_version:3})).status,403);
   assert.equal((await action(director,'reject',3)).status,200);
   let row=await get();assert.equal(row.can_edit,true);assert.equal(row.can_resubmit,true);assert.equal((await get(director)).can_reapprove,true);
   for(const cookie of [author,admin,sessions.director2,ceo])assert.equal((await action(cookie,'approve',row.version)).status,403);
   assert.equal((await action(director,'approve',row.version)).status,200);
   assert.equal((await get()).status,'ceo');
   assert.equal((await action(ceo,'reject')).status,200);
   row=await get();assert.equal(row.can_edit,true);assert.equal(row.can_delete,false);assert.equal((await get(director)).can_reapprove,false);
   assert.equal((await action(director,'approve')).status,403,'CEO rejection needs author resubmission');
   assert.equal((await call(`${source}/${id}/update`,author,{...edit,expected_version:row.version})).status,200);
   row=await get();
   assert.equal((await call(`${source}/${id}/resubmit`,sessions.other,{expected_version:row.version})).status,403);
   const results=await Promise.all([1,2].map(()=>call(`${source}/${id}/resubmit`,author,{expected_version:row.version})));
   assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
   row=await get();assert.equal(row.status,'manager');assert.equal(row.approval_round,2);assert.equal(row.history.at(-1).action,'resubmit');assert.equal(row.history.at(-1).stage,'author');assert.equal(row.history.at(-1).approval_round,2);
   // Round-one stamps stay in history, never in the new round's signature cells/export.
   const book=new ExcelJS.Workbook();await book.xlsx.load((await call(`${source}/${id}/excel`,author)).data);
   assert.equal(book.worksheets[0].getCell('G5').value,'결재 대기');assert.equal(book.worksheets[0].getCell('H5').value,'결재 대기');assert.equal(book.worksheets[0].getImages().length,0);
   assert.equal(row.history.filter(h=>h.has_signature&&h.approval_round===1).length,4);
   initializeDocumentDeletion(db);initializeDocumentWorkflow(db);assert.equal((await get()).approval_round,2);assert.equal((await get()).version,row.version);
   assert.equal((await action(director,'approve',row.version)).status,200);
   // An earlier CEO rejection must not lock director reconsideration in this new round.
   assert.equal((await get(director)).can_reject_after_approval,true);
   assert.equal((await action(director,'reject')).status,200);assert.equal((await action(director,'approve')).status,200);
   assert.equal((await action(ceo,'approve')).status,200);row=await get();
   assert.equal(row.status,'approved');assert.equal(row.can_edit,false);assert.equal(row.can_resubmit,false);
   for(const op of ['update','resubmit'])assert.equal((await call(`${source}/${id}/${op}`,author,{...body,expected_version:row.version})).status,403);
   assert.equal((await action(director,'reject')).status,403);assert.equal((await action(ceo,'approve')).status,403);
   if(source==='expenses'){const entries=db.prepare("SELECT * FROM journal_entries WHERE source_type='expense_approval' AND source_id=?").all(id);assert.equal(entries.length,1);assert.equal(row.total,220);}
   if(source==='leaves'){assert.equal((await call('leave-balance?year=2026',author)).data.balances[0].used,.5);const calendar=(await call('attendance/calendar?month=2026-11',author)).data.leaves;assert.equal(calendar.length,1);assert.equal(calendar[0].start,'2026-11-03');}
   const retry=(await call(source,author,body)).data.id;await call(`${source}/${retry}/action`,author,{action:'withdraw'});let recovered=(await call(source,author)).data.find(r=>r.id===retry);assert.equal(recovered.can_edit,true);assert.equal((await call(`${source}/${retry}/resubmit`,author,{expected_version:recovered.version})).status,200);assert.equal((await call(`${source}/${retry}/delete`,author,{confirm:true})).status,200);
  }
  // Legacy research expense documents can be corrected without enabling that retired new-form type.
  const legacyBody=sources.find(s=>s[0]==='expenses')[1],legacy=(await call('expenses',author,legacyBody)).data.id;
  db.prepare("UPDATE expense_requests SET form_type='research_expense',project_name='기존 과제',project_code='OLD' WHERE id=?").run(legacy);
  assert.equal((await call(`expenses/${legacy}/update`,author,{...legacyBody,form_type:'research_expense',project_name:'수정 과제',project_code:'NEW',expected_version:1})).status,200);
  assert.equal((await call('expenses',author)).data.find(r=>r.id===legacy).project_name,'수정 과제');
  assert.equal((await call('expenses',author,{...legacyBody,form_type:'research_expense',project_name:'신규 불가'})).status,400);
  assert.equal((await call(`expenses/${legacy}/delete`,author,{confirm:true,expected_version:1})).status,409);
  // Quota reacquisition, rollback on failed edits/reapproval/resubmission, and private preview exclusions.
  db.prepare("UPDATE leave_quotas SET grant_units=2 WHERE user_id=? AND year=2026 AND pool='annual'").run(ids.limited);
  const leave={kind:'연차',start:'2026-11-04',end:'2026-11-04',reason:'잔여 일수 검증'};
  const first=(await call('leaves',limited,leave)).data.id;
  assert.equal((await call('leave-preview',limited,{...leave,document_id:first})).data.allowed,true);
  assert.equal((await call('leave-preview',author,{...leave,document_id:first})).status,403);
  assert.equal((await call(`leaves/${first}/update`,limited,{...leave,end:'2026-11-05',expected_version:1})).status,409);
  let row=(await call('leaves',limited)).data.find(r=>r.id===first);assert.equal(row.end,leave.end);assert.equal(row.version,1);
  await call(`leaves/${first}/action`,director,{action:'reject'});
  const second=(await call('leaves',limited,{...leave,start:'2026-11-05',end:'2026-11-05'})).data.id;
  row=(await call('leaves',limited)).data.find(r=>r.id===first);const before=JSON.stringify(row.history);
  assert.equal((await call(`leaves/${first}/action`,director,{action:'approve'})).status,409);
  assert.equal((await call(`leaves/${first}/resubmit`,limited,{expected_version:row.version})).status,409);
  row=(await call('leaves',limited)).data.find(r=>r.id===first);assert.equal(row.status,'rejected');assert.equal(JSON.stringify(row.history),before);
  assert.equal((await call(`leaves/${first}/update`,limited,{...leave,reason:'반려 문서는 부족해도 내용 수정 가능',expected_version:row.version})).status,200);
  await call(`leaves/${second}/action`,limited,{action:'withdraw'});assert.equal((await call(`leaves/${first}/action`,director,{action:'approve'})).status,200);
  assert.equal((await call('leave-balance?year=2026',limited)).data.balances[0].used,1);
  assert.equal((await call('attendance/calendar?month=2026-11',limited)).data.leaves.length,1);
  // Persisted versions/rounds survive backup and migration; account purge removes history snapshots too.
  await snapshot(join(dir,'live','group.db'),join(dir,'backup.db'));await restore(join(dir,'backup.db'),join(dir,'restored'));
  const restored=new DatabaseSync(join(dir,'restored','group.db'));assert.equal(restored.prepare('SELECT max(approval_round) n FROM approval_requests').get().n,2);restored.close();
  assert.equal((await call(`users/${ids.author}/delete`,admin,{confirm_login:'author'})).status,200);
  for(const table of ['approval_requests','expense_requests'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`).get(ids.author).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM approval_decisions').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
