import {mkdtempSync,rmSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {samplePdf} from '../test-support/pdf-fixture.js';
import {approvalTemplates} from '../approvals.js';
import {reportTemplates} from '../report-templates.js';
import {documentTypes} from '../document-state.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-copy-ui-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');
const password='copy-browser-test';
for(const [login,role] of [['author','employee'],['director','manager'],['ceo','ceo'],['other','employee']])addUser(login,login,role,password);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,db=new DatabaseSync(join(dir,'group.db'));
const cookies={};let browser;
async function call(login,path,body,status=200){
 const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookies[login]||''},body:body?JSON.stringify(body):undefined});
 const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;
}
function snapshot(source,id){const t=documentTypes[source];return {row:db.prepare(`SELECT * FROM ${t.table} WHERE id=?`).get(id),history:db.prepare(`SELECT * FROM ${t.history} WHERE ${t.key}=? ORDER BY id`).all(id),attachments:source==='expenses'?db.prepare('SELECT * FROM expense_attachments WHERE expense_id=? ORDER BY id').all(id):[]};}
const pdf=samplePdf(3),png=readFileSync(resolve('public/icon-192.png'));
const files=[{filename:'복사할 증빙.pdf',base64:pdf.toString('base64')},{filename:'증빙.png',base64:png.toString('base64')}];
const originalFields=t=>Object.fromEntries(t.fields.map(f=>[f.key,f.type==='date'?'2026-11-02':f.type==='time'?(f.key==='end_time'?'18:00':'09:00'):f.type==='money'?0:f.type==='select'?f.options.at(-1):f.type==='textarea'?'첫째 줄 원문\n둘째 줄 내용':f.label+' 원문']));
const expenseBody={form_type:'expense',title:'원문 지출',expense_date:'2026-11-02',vendor:'공통 거래처',payment:'계좌이체',evidence_type:'납부고지서',evidence_ref:'증빙 123',notes:'원래 비고\n다음 줄',items:[{category:'4대보험',description:'4대보험 납부',vendor:'보험 거래처',vendor_info:'은행 · 계좌 · 연락처',supply:12000,tax:0},{category:'급여',description:'급여 지급',vendor:'급여 거래처',vendor_info:'예금주',supply:15000,tax:0}],attachments:files};
const cases=[...approvalTemplates,...reportTemplates].map(t=>({kind:t.id,source:t.storage==='leave'?'leaves':t.storage==='expense'?'expenses':reportTemplates.includes(t)?'reports':'approvals',status:'approved'}));
for(const status of ['manager','ceo','rejected','withdrawn'])for(const [source,kind] of [['leaves','leave'],['expenses','expense'],['approvals','general'],['reports','daily_work_log']])cases.push({source,kind,status});
cases.push({source:'expenses',kind:'research_expense',status:'approved'});
try{
 for(const login of ['author','director','ceo','other']){
  const response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(response.status,200);cookies[login]=response.headers.get('set-cookie').split(';')[0];
 }
 for(const actor of ['director','ceo'])await call(actor,'seal',{content_type:'image/png',base64:png.toString('base64')});
 for(const [i,c] of cases.entries()){
  c.form=({leaves:'leave',expenses:'expense',approvals:'draft',reports:'report'})[c.source];
  const t=[...approvalTemplates,...reportTemplates].find(t=>t.id===c.kind);
  c.body=c.source==='leaves'?{kind:'연차',start:'2026-11-02',end:'2026-11-02',reason:'복사할 휴가 사유'}:c.source==='expenses'?{...expenseBody,title:'지출 원문 '+i}:{template_id:t.id,title:t.name+' 원문 '+i,fields:originalFields(t)};
  c.id=(await call('author',c.source,c.body,201)).id;
  if(c.kind==='research_expense')db.prepare("UPDATE expense_requests SET form_type='research_expense',project_name='기존 연구과제',project_code='R-123' WHERE id=?").run(c.id);
  if(['ceo','approved'].includes(c.status))await call('director',`${c.source}/${c.id}/action`,{action:'approve'});
  if(c.status==='approved')await call('ceo',`${c.source}/${c.id}/action`,{action:'approve'});
  if(c.status==='rejected')await call('director',`${c.source}/${c.id}/action`,{action:'reject'});
  if(c.status==='withdrawn')await call('author',`${c.source}/${c.id}/action`,{action:'withdraw'});
  c.original=(await call('author',c.source)).find(r=>r.id===c.id);c.snapshot=snapshot(c.source,c.id);
 }
 // Retired forms require a readable original, not an arbitrary ID or supplied form type.
 const retired=cases.at(-1),legacy={...expenseBody,form_type:'research_expense',project_name:'기존 연구과제',project_code:'R-123'};
 await call('author','expenses',legacy,400);await call('other','expenses',{...legacy,copy_from:retired.id},400);
 await call('author','expenses',{...legacy,copy_from:cases.find(c=>c.source==='expenses').id},400);
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=async name=>{await page.locator('#login [name=login]').fill(name);await page.locator('#login [name=password]').fill(password);await page.locator('#login button').click();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>document.querySelector('#home-expenses .cell-link'));};
 await page.goto(base);await login('author');
 const out=resolve(process.env.UI_SCREENSHOT_DIR||'/tmp/group-document-copy-ui');mkdirSync(out,{recursive:true});
 const homeTitle=page.locator('#home-expenses .cell-link').first();assert.equal(await homeTitle.evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');await homeTitle.hover();assert.equal(await homeTitle.evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
 await page.screenshot({path:join(out,'home-expense-white-title.png'),fullPage:true});
 const open=async c=>{await page.keyboard.press('Escape');await page.locator('.sidebar [data-tab=approval]').click();await page.locator('#approval-box-tabs [data-box=all]').click();await page.locator('#approval-template-filter').selectOption(c.kind);const number=({leaves:'LV',expenses:'EX',approvals:'AP',reports:'WR'})[c.source]+'-'+String(c.id).padStart(5,'0');await page.locator('#approval-query').fill(number);await page.locator('#approval-documents .cell-link').getByText(number,{exact:true}).click();};
 for(const [i,c] of cases.entries()){
  console.log('Copy case:',c.kind,c.status);
  await open(c);const count=(await call('author',c.source)).length;
  if(i===0)await page.screenshot({path:join(out,'approved-document-copy-button.png'),fullPage:true});
  await page.locator('#document-detail .document-copy').click();const form=page.locator('#'+c.form+'-form');await form.locator('.document-copy-notice').waitFor();
  assert.equal((await call('author',c.source)).length,count,'copy must not save before submission');
  const values=c.body.fields?{title:c.body.title,...c.body.fields}:Object.fromEntries(Object.entries(c.body).filter(([k])=>!['items','attachments'].includes(k)));
  if(c.kind==='research_expense')Object.assign(values,{form_type:'research_expense',project_name:'기존 연구과제',project_code:'R-123'});
  for(const [key,value] of Object.entries(values))assert.equal(await form.locator('[name='+key+']').inputValue(),String(value),c.kind+' '+key);
  assert.equal(await form.locator('.document-edit-notice').count(),0);
  if(c.source==='expenses'){
   for(const [n,item] of c.body.items.entries())for(const [key,value] of Object.entries(item))assert.equal(await form.locator('.expense-line').nth(n).locator('[data-field='+key+']').inputValue(),String(value));
   assert.equal(await form.locator('.expense-attachment-row').count(),2);assert.doesNotMatch(await form.locator('#expense-attachment-list').textContent(),/저장됨/);
   if(c.kind==='expense'&&c.status==='approved'){
    await page.locator('#expense-attachment-list button').getByText(files[0].filename,{exact:true}).click();await page.waitForFunction(()=>document.querySelector('#expense-preview-total').textContent==='/ 3쪽'&&!document.querySelector('#expense-preview-page').disabled);await page.locator('#expense-preview-dialog [data-close]').first().click();
    await page.screenshot({path:join(out,'copied-expense-editor.png'),fullPage:true});
   }
  }
  const changed='수정한 복사본 '+i;
  await form.locator('[name='+(c.source==='leaves'?'reason':'title')+']').fill(changed);
  if(c.source==='leaves'){await form.locator('[name=start]').fill('2027-01-04');await form.locator('[name=end]').fill('2027-01-04');await form.locator('[name=end]').press('Tab');}
  const pending=page.waitForResponse(r=>r.url()===base+'/api/'+c.source&&r.request().method()==='POST');
  await form.getByRole('button',{name:c.source==='expenses'?'지출결의서 상신':'결재 상신',exact:true}).click();const response=await pending;assert.equal(response.status(),201,await response.text());const id=(await response.json()).id;
  await page.waitForFunction(()=>[...document.querySelectorAll('.document-copy-notice')].length===0);
  const rows=await call('author',c.source),copy=rows.find(r=>r.id===id);assert.equal(rows.length,count+1);assert.notEqual(id,c.id);assert.equal(copy.status,'manager');assert.equal(copy.approval_round,1);assert.equal(copy.version,1);assert.equal(copy.ceo_processed,0);assert.equal(copy.name,'author');assert.deepEqual(copy.history,[]);assert.equal(copy[c.source==='leaves'?'reason':'title'],changed);
  if(c.body.fields)assert.deepEqual(copy.fields,c.body.fields);
  if(c.source==='expenses'){
   assert.deepEqual(copy.items,c.original.items);assert.equal(copy.total,c.original.total);assert.equal(copy.attachments.length,2);assert.equal(copy.form_type,c.original.form_type);assert.equal(copy.project_name,c.original.project_name);assert.equal(copy.project_code,c.original.project_code);
   for(const [n,file] of copy.attachments.entries()){assert.notEqual(file.id,c.original.attachments[n].id);const raw=await fetch(base+file.url,{headers:{Cookie:cookies.author}});assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),n===0?pdf:png);}
  }
  assert.deepEqual(snapshot(c.source,c.id),c.snapshot,'original must remain byte-for-byte unchanged');
 }
 // Cancel each form, then enter a fresh template: no hidden source ID or files survive.
 for(const source of ['leaves','expenses','approvals','reports']){
  const c=cases.find(c=>c.source===source);await open(c);const count=(await call('author',source)).length;await page.locator('.document-copy').click();const form=page.locator('#'+c.form+'-form');await form.locator('.document-copy-notice').waitFor();await form.getByRole('button',{name:'복사 취소',exact:true}).click();await page.locator('#document-dialog[open]').waitFor();assert.equal((await call('author',source)).length,count);assert.equal(await form.locator('.document-copy-notice').count(),0);if(source==='expenses')assert.equal(await page.locator('#expense-attachment-list .expense-attachment-row').count(),0);
 }
 // Failed attachment downloads leave the original view intact and create nothing.
 const expense=cases.find(c=>c.source==='expenses');await open(expense);await page.route('**/api/expenses/*/attachments/*',r=>r.fulfill({status:404,json:{error:'not found'}}));await page.locator('.document-copy').click();await page.locator('#message').filter({hasText:'첨부파일을 복사하지 못했습니다'}).waitFor();assert.equal(await page.locator('#document-dialog').evaluate(e=>e.open),true);assert.equal(await page.locator('.document-copy-notice').count(),0);await page.unroute('**/api/expenses/*/attachments/*');
 // A director can copy a readable employee document, but the new author is the director.
 await page.keyboard.press('Escape');await page.locator('#logout').click();await login('director');await open(expense);await page.locator('.document-copy').click();await page.locator('#expense-form .document-copy-notice').waitFor();await page.locator('#expense-form [name=title]').fill('이사가 복사한 새 지출');
 const saved=page.waitForResponse(r=>r.url()===base+'/api/expenses'&&r.request().method()==='POST');await page.locator('#expense-form').getByRole('button',{name:'지출결의서 상신',exact:true}).click();const copiedId=(await (await saved).json()).id,byDirector=(await call('director','expenses')).find(r=>r.id===copiedId);assert.equal(byDirector.name,'director');assert.equal(byDirector.status,'manager');assert.deepEqual(byDirector.history,[]);
 // Removing evidence from a copy does not remove the source's independently stored bytes.
 await call('director',`expenses/${copiedId}/update`,{...expenseBody,attachments:[],expected_version:byDirector.version});assert.deepEqual(snapshot('expenses',expense.id),expense.snapshot);
 assert.deepEqual(errors,[]);console.log(`PASS: white home expense titles; ${cases.length} copy/edit/submit cases covering all 16 active templates and five states; independent PDF/PNG attachments; empty approvals/signatures; original immutability; cancel/failure isolation; current author ownership; protected legacy copies.`);
}finally{await browser?.close();db.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
