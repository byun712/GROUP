// Optional browser validation: install Playwright separately, then run this file.
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-ui-'));
process.env.DATA_DIR=dir;process.env.OFFICE_IP='127.0.0.1';process.env.NODE_ENV='development';process.env.TRUSTED_PROXY_IPS='';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../server.js');
for(const [login,role,name] of [['staff','employee','테스트 직원'],['manager','manager','테스트 실장'],['ceo','ceo','테스트 대표']])addUser(login,name,role,'browser-test-123');
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function loginApi(login){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password:'browser-test-123'})});return r.headers.get('set-cookie').split(';')[0];}
const cookie=await loginApi('staff');
for(let i=0;i<12;i++){const r=await fetch(base+'/api/leaves',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({kind:'연차',start:'2026-11-02',end:'2026-11-02',reason:i===0?'검색확인 문서':'브라우저 검증 '+i})});assert.equal(r.status,201);}
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#login-form [name=login]').fill('manager');await page.locator('#login-form [name=password]').fill('browser-test-123');await page.locator('#login-form button').click();await page.locator('#welcome').filter({hasText:'실장님'}).waitFor();
 await page.locator('#all-menu').click();await page.locator('#menu-dialog [data-view=action]').click();await page.locator('#documents tbody tr').first().waitFor();assert.equal(await page.locator('#documents tbody tr').count(),10);assert.equal(await page.locator('#document-total').textContent(),'조회 12건 / 전체 12건');
 await page.locator('#document-next').click();assert.equal(await page.locator('#documents tbody tr').count(),2);await page.locator('#documents tbody tr button').first().click();await page.locator('#document-dialog').waitFor({state:'visible'});await page.locator('#document-detail .detail-actions button').filter({hasText:'승인'}).click();await page.waitForFunction(()=>document.querySelector('#document-detail').textContent.includes('대표이사 승인 대기'));await page.keyboard.press('Escape');
 await page.keyboard.press('F3');assert.equal(await page.locator('#document-query').evaluate(e=>e===document.activeElement),true);await page.locator('#document-query').fill('검색확인');await page.locator('#leave-filter').selectOption('all');await page.locator('#document-search button').first().click();assert.equal(await page.locator('#documents tbody tr').count(),1);assert.equal(await page.locator('#document-total').textContent(),'조회 1건 / 전체 12건');
 await page.locator('#documents tbody button').click();await page.locator('#document-detail .detail-actions button').filter({hasText:'승인'}).click();await page.waitForFunction(()=>document.querySelector('#document-detail').textContent.includes('대표이사 승인 대기'));await page.keyboard.press('Escape');
 await page.locator('#document-reset').click();await page.locator('[data-tab=attendance]').click();await page.locator('#clock-in').click();await page.waitForFunction(()=>document.querySelector('#clock-in').disabled);assert.equal(await page.locator('#records tbody tr').count(),1);
 await page.locator('[data-tab=announcements]').click();await page.locator('#notice-form [name=title]').fill('업무 안내');await page.locator('#notice-form [name=content]').fill('신규 그룹웨어 테스트');await page.locator('#notice-form button').click();await page.locator('#notices summary').filter({hasText:'업무 안내'}).waitFor();
 await page.locator('[data-tab=home]').click();await page.waitForFunction(()=>document.querySelector('#home-in').textContent!=='—');await page.locator('[data-tab=leave]').click();
 if(process.env.UI_SCREENSHOT_DIR){mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.UI_SCREENSHOT_DIR,'erp-workbench.png'),fullPage:true});}
 await page.locator('#documents tbody button').first().click();if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.UI_SCREENSHOT_DIR,'erp-document.png'),fullPage:true});await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#all-menu').click();assert.equal(await page.locator('#menu-dialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
 const ceoCookie=await loginApi('ceo');const r=await fetch(base+'/api/leaves/1/action',{method:'POST',headers:{cookie:ceoCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'approve'})});assert.equal(r.status,200);
 console.log('PASS: ERP menus, 12-record pagination/search, detail approvals, F3/Esc, attendance, notices, home refresh, mobile, no JS errors.');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
