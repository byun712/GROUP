import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-resubmit-ui-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');
for(const [login,name,role] of [['author','작성자','employee'],['director','결재 이사','manager'],['ceo','대표이사','ceo']])addUser(login,name,role,'resubmit-browser-test');
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 const login=async name=>{await page.locator('#login [name=login]').fill(name);await page.locator('#login [name=password]').fill('resubmit-browser-test');await page.locator('#login button').click();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>document.querySelector('#home-calendar-grid').dataset.month);};
 const relogin=async name=>{await page.keyboard.press('Escape');await page.locator('#logout').click();await login(name);};
 const call=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{path,body});
 const open=async kind=>{await page.keyboard.press('Escape');await page.locator('.sidebar [data-tab=approval]').click();await page.locator('#approval-box-tabs [data-box=all]').click();await page.locator('#approval-template-filter').selectOption(kind);await page.locator('#approval-documents .cell-link').click();};
 const confirm=async label=>{await page.locator('#document-detail .detail-actions').getByRole('button',{name:label,exact:true}).click();const form=page.locator('#business-dialog form');await form.locator('[name=confirm]').check();await form.getByRole('button',{name:'저장',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#business-dialog').open);await page.waitForFunction(label=>document.querySelector('#message').textContent===(label==='승인 후 반려'?'이사 승인을 반려로 변경했습니다.':label+' 처리를 완료했습니다.'),label);};
 await login('author');
 const docs=[
  {source:'leaves',kind:'leave',form:'leave',field:'reason',body:{kind:'연차',start:'2026-11-02',end:'2026-11-02',reason:'원래 휴가 사유'}},
  {source:'expenses',kind:'expense',form:'expense',field:'title',body:{title:'원래 지출',expense_date:'2026-11-02',vendor:'기존 거래처',payment:'법인카드',evidence_type:'영수증',items:[{category:'교통비',description:'교통비 내용',supply:1000,tax:100},{category:'식비',description:'식비 내용',supply:5000,tax:0}]}},
  {source:'approvals',kind:'general',form:'draft',field:'content',body:{template_id:'general',title:'원래 기안',fields:{content:'원래 기안 내용'}}},
  {source:'reports',kind:'daily_work_log',form:'report',field:'completed_work',body:{template_id:'daily_work_log',title:'원래 일지',fields:{report_date:'2026-11-02',completed_work:'실시 원본',planned_work:'예정 원본',ongoing_work:'진행 원본',notes:'특이사항 원본'}}}
 ];
 for(const d of docs)d.id=(await call(d.source,d.body)).id;
 await page.reload();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>document.querySelector('#home-calendar-grid').dataset.month);
 const out=resolve(process.env.UI_SCREENSHOT_DIR||'/tmp/group-resubmission-ui');mkdirSync(out,{recursive:true});
 // The same existing forms must populate every field and save into the original document.
 for(const d of docs){
  await open(d.kind);await page.getByRole('button',{name:'문서 수정',exact:true}).click();const form=page.locator('#'+d.form+'-form');
  const values=d.body.fields?{title:d.body.title,...d.body.fields}:Object.fromEntries(Object.entries(d.body).filter(([k])=>k!=='items'));
  for(const [key,value] of Object.entries(values))assert.equal(await form.locator('[name='+key+']').inputValue(),String(value));
  if(d.source==='expenses'){assert.equal(await form.locator('.expense-line').count(),2);assert.equal(await form.locator('[data-field=supply]').nth(1).inputValue(),'5000');}
  await form.locator('[name='+d.field+']').fill('승인 전 수정 내용');await form.getByRole('button',{name:'수정 저장',exact:true}).click();await page.locator('#document-dialog[open]').waitFor();
  assert.match(await page.locator('#document-detail').textContent(),/승인 전 수정 내용/);const rows=await call(d.source);assert.equal(rows.length,1);assert.equal(rows[0].version,2);
 }
 await relogin('director');
 for(const d of docs){await open(d.kind);await page.locator('#document-detail .detail-actions').getByRole('button',{name:'반려',exact:true}).click();await page.getByRole('button',{name:'반려 후 다시 승인',exact:true}).waitFor();await confirm('반려 후 다시 승인');await page.waitForFunction(()=>!document.querySelector('#document-detail .approval-step.rejected'));assert.equal((await call(d.source))[0].status,'ceo');await confirm('승인 후 반려');}
 await relogin('author');
 for(const d of docs){
  await open(d.kind);await page.getByRole('button',{name:'문서 수정',exact:true}).click();const form=page.locator('#'+d.form+'-form');assert.equal(await form.locator('[name='+d.field+']').inputValue(),'승인 전 수정 내용');
  const content=d.source==='expenses'?'반려 후 수정 지출':Array(16).fill('반려 사유를 보완한 수정 내용입니다.').join('\n');await form.locator('[name='+d.field+']').fill(content);
  if(d.source==='reports'){await page.waitForTimeout(100);assert.equal(await form.locator('[name=completed_work]').evaluate(e=>e.scrollHeight<=e.clientHeight+2),true);await page.screenshot({path:join(out,'report-edit.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1440,height:1050});}
  await form.getByRole('button',{name:'수정 저장',exact:true}).click();await page.locator('#document-dialog[open]').waitFor();assert.equal((await call(d.source))[0].status,'rejected');await confirm('재상신');
  await page.waitForFunction(()=>!document.querySelector('#document-detail .approval-step.rejected'));
  assert.equal((await call(d.source))[0].approval_round,2);assert.match(await page.locator('#document-detail .approval-step').nth(1).textContent(),/결재 대기/);assert.doesNotMatch(await page.locator('#document-detail .approval-step').nth(2).textContent(),/반려/);assert.match(await page.locator('#document-detail .detail-history').textContent(),/2차 · 작성자 · 재상신/);
  await page.screenshot({path:join(out,d.source+'-resubmitted.png'),fullPage:true});
 }
 // Cancel and choosing a fresh template must leave no hidden edit target behind.
 await open('general');await page.getByRole('button',{name:'문서 수정',exact:true}).click();await page.locator('#draft-form [name=title]').fill('저장하지 않을 수정');await page.getByRole('button',{name:'수정 취소',exact:true}).click();assert.doesNotMatch(await page.locator('#document-detail').textContent(),/저장하지 않을 수정/);await page.keyboard.press('Escape');await page.locator('#draft-menu [data-template=general]').click();assert.equal(await page.locator('#draft-form [name=title]').inputValue(),'');assert.equal(await page.locator('#draft-submit').textContent(),'결재 상신');
 assert.deepEqual(errors,[]);console.log('PASS: all four existing forms populate/edit in place; director rejection/reapproval; author rejected edits and resubmission; round-specific approval cells/history; expense lines, textarea growth, mobile layout, cancel and fresh drafts.');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
