import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {initializeCrm} from '../crm.js';
import {buildAccountWorkbook} from '../accounting-excel.js';

test('account XLSX matches all-time balances, preserves numeric values and rejects unauthorized users; CRM deletion preserves dependencies and permissions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'account-crm-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';delete process.env.PUBLIC_ORIGIN;
 const {server,addUser}=await import('../test-support/server.js');const password='fixture-account-test';
 for(const [login,role] of [['manager','manager'],['ceo','ceo'],['staff','employee'],['other','employee'],['soltec@elsoltec.com','employee']])addUser(login,login,role,password);
 // A standalone Admin does not receive accounting access.
 const db=new DatabaseSync(join(dir,'group.db'));db.prepare("UPDATE users SET role='employee' WHERE login='soltec@elsoltec.com'").run();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,cookies={};
 const call=(path,user,body)=>fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie:cookies[user]||''},body:body?JSON.stringify(body):undefined});
 const ok=async(path,user,body)=>{const r=await call(path,user,body);assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  for(const login of ['manager','ceo','staff','other','soltec@elsoltec.com']){const r=await call('login','',{login,password});assert.equal(r.status,200);cookies[login]=r.headers.get('set-cookie').split(';')[0];}
  for(const user of ['staff','soltec@elsoltec.com'])for(const path of ['accounting','accounting/accounts/excel'])assert.equal((await call(path,user)).status,403);
  assert.equal((await call('accounting/accounts/excel','')).status,401);
  for(const [month,kind,amount] of [['2026-01','income',1234567],['2026-11','expense',2345678]])await ok('accounting/manual','manager',{kind,entry_date:month+'-02',title:'다른 월 포함',amount,bank:'103',category:'509'});
  const longName='=긴 계정 이름 '.repeat(15);db.prepare('UPDATE ledger_accounts SET name=? WHERE code=?').run(longName,'509');
  const state=await ok('accounting','manager');assert.equal(state.accounts.find(a=>a.code==='103').debit-state.accounts.find(a=>a.code==='103').credit,-1111111);
  for(const user of ['manager','ceo']){
   const r=await call('accounting/accounts/excel?month=2026-11&page=2',user);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheetml/);assert.match(decodeURIComponent(r.headers.get('content-disposition')),/계정별합계_전체장부_\d{4}-\d{2}-\d{2}\.xlsx/);
   const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));const sh=wb.worksheets[0];assert.equal(sh.rowCount,state.accounts.length+5);assert.match(sh.getCell('A2').value,/전체 장부/);
   for(const [i,a] of state.accounts.entries()){const values=sh.getRow(i+6).values;assert.deepEqual(values.slice(1),[a.code,a.name,a.debit,a.credit]);assert.equal(sh.getCell(i+6,3).type,ExcelJS.ValueType.Number);assert.match(sh.getCell(i+6,3).numFmt,/#,##0/);}
   assert.equal(sh.pageSetup.fitToWidth,1);assert.equal(sh.pageSetup.fitToHeight,0);assert.equal(sh.views[0].ySplit,5);assert.ok(sh.autoFilter);assert.ok(sh.getRow(sh.rowCount).height>26);
  }
  const fixed=buildAccountWorkbook(state.accounts,new Date('2026-12-31T16:00:00Z'));assert.match(fixed.worksheets[0].getCell('A3').value,/2027-01-01 01:00:00/);
  assert.equal((await call('accounting/accounts/excel','manager',{})).status,405);
  db.prepare("UPDATE users SET active=0 WHERE login='ceo'").run();assert.equal((await call('accounting/accounts/excel','ceo')).status,401);
  const c=await ok('customers','staff',{company:'보존 고객사',address:'서울'}),contact=await ok(`customers/${c.id}/contacts`,'staff',{name:'담당자',email:'person@example.com'});
  assert.equal((await call(`contacts/${contact.id}/delete`,'other',{version:1,confirm:true})).status,403);
  assert.equal((await call(`contacts/${contact.id}/delete`,'staff',{version:2,confirm:true})).status,409);
  assert.equal((await call(`contacts/${contact.id}/delete`,'staff',{version:1,confirm:false})).status,400);
  assert.equal((await call(`customers/${c.id}/delete`,'staff',{version:1,confirm:true})).status,409);
  await ok(`contacts/${contact.id}/delete`,'staff',{version:1,confirm:true});
  const p=await ok('projects','staff',{title:'연결 프로젝트',customer_id:c.id,start_date:'2026-11-01',end_date:'2026-11-30'});
  assert.equal((await call(`customers/${c.id}/delete`,'staff',{version:1,confirm:true})).status,409);assert.equal(db.prepare('SELECT customer_id FROM projects WHERE id=?').get(p.id).customer_id,c.id);
  const empty=await ok('customers','staff',{company:'삭제할 고객사'});assert.equal((await call(`customers/${empty.id}/delete`,'other',{version:1,confirm:true})).status,403);await ok(`customers/${empty.id}/delete`,'staff',{version:1,confirm:true});
  initializeCrm(db);initializeCrm(db);
  const next=await ok('customers','staff',{company:'새 고객사'});assert.ok(next.id>empty.id);const newContact=await ok(`customers/${c.id}/contacts`,'staff',{name:'새 담당자'});assert.ok(newContact.id>contact.id);
  assert.equal((await call(`contacts/${contact.id}/delete`,'staff',{version:1,confirm:true})).status,404);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
