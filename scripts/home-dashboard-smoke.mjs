import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-home-dashboard-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js'),password='home-dashboard-browser';
addUser('director','테스트 이사','manager',password);addUser('other','다른 직원','employee',password);
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const out=resolve(process.env.UI_SCREENSHOT_DIR||'/tmp/group-home-dashboard-ui');mkdirSync(out,{recursive:true});
 await page.goto(base);await page.locator('#login [name=login]').fill('director');await page.locator('#login [name=password]').fill(password);await page.locator('#login button').click();await page.locator('#workspace').waitFor();
 await page.evaluate(async()=>{
  const post=async(path,body)=>{const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());};
  for(let i=1;i<=8;i++)await post('schedules',{title:'검토 일정 '+i+(i===8?' <img src=x>':''),start_date:'2026-08-03',end_date:'2026-08-03',all_day:true,visibility:i%2?'company':'personal',participant_ids:[],description:'전체 내용 확인'});
  for(let i=1;i<=3;i++)await post('announcements',{title:'최근 공지 '+i+' · 연구 업무 안내',content:'공지 내용'});
 });
 await page.reload();await page.locator('#home-calendar-grid .calendar-day').first().waitFor();
 const ready=month=>page.waitForFunction(month=>{const grid=document.querySelector('#home-calendar-grid');return grid.dataset.month===month&&grid.getAttribute('aria-busy')==='false';},month);
 const selectMonth=async month=>{await page.locator('#home-calendar-month').fill(month);await page.locator('#home-calendar-month').dispatchEvent('change');await ready(month);};
 const checkFit=async label=>{
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>window.scrollTo(0,0));
  const result=await page.evaluate(()=>{
   const rect=e=>e.getBoundingClientRect().toJSON(),grid=document.querySelector('#home-calendar-grid'),cells=[...grid.querySelectorAll('.calendar-cell:not(.calendar-day)')];
   return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,grid:rect(grid),footer:rect(document.querySelector('footer')),cards:[...document.querySelectorAll('#home .home-summary-card')].map(rect),dates:[...grid.querySelectorAll('.calendar-date,.home-calendar-more:not([hidden])')].map(e=>({child:rect(e),parent:rect(e.closest('.calendar-cell'))})),lists:[...grid.querySelectorAll('.calendar-day-items')].map(e=>({child:rect(e),parent:rect(e.parentElement),overflow:getComputedStyle(e).overflowY})),cellHeights:cells.map(e=>rect(e).height)};
  });
  assert.ok(result.scrollWidth<=result.width,label+' horizontal overflow');const expectedHeight=Math.max(220,result.height-result.grid.top-28);assert.ok(Math.abs(result.grid.height-expectedHeight)<1,label+' viewport allocation with 220px minimum');assert.ok(result.footer.bottom<=Math.max(result.height,result.grid.bottom+28)+1,label+' footer');if(expectedHeight>220)assert.ok(result.grid.bottom<=result.height,label+' calendar');
  for(const {child,parent} of [...result.dates,...result.lists])assert.ok(child.top>=parent.top&&child.bottom<=parent.bottom+1&&child.right<=parent.right+1,label+' clipped date/event '+JSON.stringify({child,parent}));
  for(const list of result.lists)assert.equal(list.overflow,'auto',label+' scrollable day events');
  assert.ok(Math.max(...result.cellHeights)-Math.min(...result.cellHeights)<1,label+' equal week heights');
  return result;
 };
 assert.equal(await page.locator('#home .hero,#home>.stats').count(),0);assert.equal(await page.locator('#home-approval-action').innerText(),'승인 대기\n0\n결재함 보기 →');
 let smallHeight,largeHeight;
 for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1440,height:900},{width:1920,height:1080},{width:1366,height:680},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const month of ['2026-02','2026-08','2026-11']){await selectMonth(month);const r=await checkFit(JSON.stringify(size)+' '+month);if(month==='2026-08'){if(size.height===720)smallHeight=r.cellHeights[0];if(size.height===1080)largeHeight=r.cellHeights[0];await page.screenshot({path:join(out,`home-${size.width}x${size.height}.png`),fullPage:true});}}
 }
 assert.ok(largeHeight>smallHeight,'calendar expands on taller screens');
 await page.setViewportSize({width:1280,height:720});await selectMonth('2026-08');
 // Current calendar retains all events in a keyboard-scrollable day list.
 const cell=page.locator('#home-calendar-grid [data-date="2026-08-03"]'),items=cell.locator('.calendar-day-items');
 assert.equal(await items.locator('.calendar-event').count(),8);assert.equal(await items.locator('[hidden],img').count(),0);
 assert.equal(await page.locator('.home-calendar-more').count(),0);
 assert.ok(await items.evaluate(e=>e.scrollHeight>e.clientHeight));
 await items.focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('#home-calendar-grid [data-date="2026-08-03"] .calendar-day-items').scrollTop>0);
 await items.getByRole('button',{name:'검토 일정 8 <img src=x>',exact:true}).click();
 assert.equal(await page.locator('#schedule-form [name=title]').inputValue(),'검토 일정 8 <img src=x>');
 await page.locator('#schedule-form [name=title]').fill('수정한 일정 8');await page.locator('#schedule-save').click();await items.getByRole('button',{name:'수정한 일정 8',exact:true}).waitFor();
 await cell.getByRole('button',{name:'2026-08-03 일정 등록',exact:true}).click();assert.equal(await page.locator('#schedule-form [name=start_date]').inputValue(),'2026-08-03');await page.keyboard.press('Escape');
 await page.screenshot({path:join(out,'scrollable-day-events.png'),fullPage:true});
 // Status messages also leave the dates and controls accessible.
 await page.evaluate(()=>notice('일정을 저장했습니다.'));await checkFit('status message');
 await page.locator('.sidebar [data-tab=users]').click();await page.locator('#users').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.page),'users');
 await page.locator('.sidebar [data-tab=home]').click();await ready('2026-08');await checkFit('return home');
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>[...document.querySelectorAll('#home-calendar-grid .calendar-event')].every(e=>!e.hidden));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await items.locator('.calendar-event').count(),8);await page.screenshot({path:join(out,'home-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: combined attendance/approval panel, removed banner, larger notices; desktop viewport fit for 4/5/6 weeks, responsive rows, reachable sidebar, no clipped controls; scrollable schedules, keyboard, safe full titles, edit/register and mobile.');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
