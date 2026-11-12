import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-design-refinement-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');
for(const [login,role] of [['soltec@elsoltec.com','manager'],['employee','employee'],['director','manager']])addUser(login,login,role,'browser-fixture-123');
const seed=new DatabaseSync(join(dir,'group.db')),adminId=seed.prepare("SELECT id FROM users WHERE login='soltec@elsoltec.com'").get().id;
for(let day=1;day<=6;day++){const date='2026-11-'+String(day).padStart(2,'0');seed.prepare('INSERT INTO attendance(user_id,day,clock_in,clock_out,ip) VALUES(?,?,?,?,?)').run(adminId,date,date+'T00:00:00Z',date+'T09:00:00Z','127.0.0.1');}seed.close();
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 const login=async name=>{await page.locator('#login').waitFor();await page.evaluate(()=>{window.designReady=false;document.addEventListener('groupware-ready',()=>window.designReady=true,{once:true});});await page.locator('#login [name=login]').fill(name);await page.locator('#login [name=password]').fill('browser-fixture-123');await page.locator('#login button').click();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>window.designReady);};
 const open=async key=>{await page.locator(`.app-launcher [data-open=${key}]`).click();await page.locator('#'+key).waitFor();};
 await login('soltec@elsoltec.com');await open('announcements');await page.locator('#notices .empty').waitFor();assert.match(await page.locator('#notices').textContent(),/등록된 공지사항이 없습니다/);
 await page.evaluate(async()=>{const post=async(path,body)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
 await post('announcements',{title:'아주 긴 공지 제목 '.repeat(10),content:'본문'});
 const customer=await post('customers',{company:'긴 고객사 이름 '.repeat(10),address:'서울특별시 '.repeat(20),notes:''});
 await post(`customers/${customer.id}/contacts`,{name:'김담당',position:'사업개발 본부장',phone:'010-1234-5678',email:'long.customer.address@example.com',notes:''});
 for(let i=0;i<12;i++)await post('schedules',{title:'많은 일정 '+i+' 긴 제목 '.repeat(8),start_date:today(),end_date:today(),all_day:true,visibility:'company'});
 });
 await open('announcements');await page.locator('#notices .cell-link').first().waitFor();await page.locator('#notice-query').fill('없는검색어');await page.locator('#notice-search button').click();await page.locator('#notices .empty').waitFor();assert.match(await page.locator('#notices').textContent(),/검색 결과가 없습니다/);await page.locator('#notice-query').fill('');await page.locator('#notice-search button').click();await page.locator('#notices .cell-link').first().waitFor();
 mkdirSync('/tmp/group-refinement',{recursive:true});
 for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
 await page.setViewportSize(viewport);
 for(const key of ['home','announcements','attendance','accounting','customers','users']){
 if(key==='home')await page.locator('.sidebar [data-tab=home]').click();else await open(key);
 if(key==='attendance'){if(await page.locator('#records').isHidden())await page.locator('#attendance-details-toggle').click();await page.locator('#export-month').fill('2026-11');await page.locator('#export-month').dispatchEvent('change');await page.waitForFunction(()=>document.querySelectorAll('#records tbody tr').length===5);await page.locator('.attendance-record-pager button').last().click();assert.equal(await page.locator('#records tbody tr').count(),1);await page.locator('.attendance-record-pager button').first().click();}
 if(key==='users')await page.locator('#user-cards td').first().waitFor();
 if(key==='accounting'){await page.waitForFunction(()=>document.querySelector('#ledger-count').textContent.endsWith('건'));await page.evaluate(()=>{ledgerState.accounts=[{code:'101',name:'현금',debit:0,credit:999999999999},{code:'103',name:'예금',debit:0,credit:0}];renderAccounting();});assert.match(await page.locator('#ledger-cash').textContent(),/-999,999,999,999/);}
 if(key==='customers'){await page.locator('.customer-summary').first().waitFor();if(await page.locator('.customer-details').first().isHidden())await page.locator('.customer-summary').first().click();assert.match(await page.locator('#customer-cards').textContent(),/사업개발 본부장/);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${key} overflow at ${viewport.width}`);
 await page.locator('#'+key).screenshot({path:`/tmp/group-refinement/${key}-${viewport.width}.png`});
 }
 }
 await page.setViewportSize({width:1366,height:768});await open('customers');await page.locator('.customer-details .contact-email').click();await page.locator('#mail-compose-dialog').waitFor();assert.equal(await page.locator('#mail-compose-form [name=to]').inputValue(),'long.customer.address@example.com');
 await open('attendance');await page.locator('#clock-in').click();await page.waitForFunction(()=>document.querySelector('#clock-in').disabled);assert.match(await page.locator('#attendance-action-status').textContent(),/출근 등록 완료/);await page.locator('#clock-out').click();await page.waitForFunction(()=>document.querySelector('#clock-out').disabled);assert.match(await page.locator('#attendance-action-status').textContent(),/출근·퇴근 등록이 완료/);
 for(const [name,finance] of [['employee',false],['director',true]]){await page.locator('#logout').click();await login(name);assert.equal(await page.locator('.app-launcher [data-open=accounting]').isVisible(),finance);await open('users');await page.locator('#user-cards td').first().waitFor();assert.equal(await page.locator('#user-new').isVisible(),false);assert.equal(await page.locator('#user-cards tbody tr').count(),1);}
 assert.deepEqual(errors,[]);console.log('PASS: 1366/1920/390 layouts, long data, crowded home calendar, empty/search notices, large negative/zero amounts, customer compose, attendance actions, user/approver/Admin visibility');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
