import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-home-calendar-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js'),password='home-calendar-browser';
for(const [login,role] of [['staff','employee'],['other','employee'],['director','manager'],['ceo','ceo']])addUser(login,login,role,password);
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,cookies={};let browser;
async function api(login,path,body,status=200){const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookies[login]},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;}
try{
 for(const login of ['staff','other','director','ceo']){const r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200);cookies[login]=r.headers.get('set-cookie').split(';')[0];}
 const staff=(await api('staff','me')).user,other=(await api('other','me')).user;
 const project=(await api('staff','projects',{title:'연구 개발 프로젝트',start_date:'2026-10-01',end_date:'2027-01-31',manager_id:staff.id,description:'캘린더 연동 검증'},201)).id;
 const event=(title,more={})=>({title,start_date:'2026-11-03',end_date:'2026-11-03',all_day:true,visibility:'company',description:'일정 상세 설명',location:'회의실',project_id:null,participant_ids:[],...more});
 await api('staff','schedules',event('프로젝트 검토 회의',{project_id:project,all_day:false,start_time:'09:00',end_time:'10:00'}),201);
 await api('staff','schedules',event('내 업무 집중',{visibility:'personal'}),201);
 await api('other','schedules',event('참여자 초대 회의',{visibility:'participants',participant_ids:[staff.id]}),201);
 await api('other','schedules',event('다른 직원 비공개',{visibility:'personal'}),201);
 await api('other','schedules',event('초대받지 않은 회의',{visibility:'participants',participant_ids:[other.id]}),201);
 await api('staff','schedules',event('월 경계 일정',{start_date:'2026-10-31',end_date:'2026-11-02'}),201);
 await api('staff','schedules',event('연말 이월 일정',{start_date:'2026-12-31',end_date:'2027-01-02'}),201);
 const leave=(await api('staff','leaves',{kind:'연차',start:'2026-11-06',end:'2026-11-06',reason:'승인된 휴가'},201)).id;
 await api('director',`leaves/${leave}/action`,{action:'approve'});
 await api('staff','leaves',{kind:'연차',start:'2026-11-09',end:'2026-11-09',reason:'미승인 휴가'},201);
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const out=resolve(process.env.UI_SCREENSHOT_DIR||'/tmp/group-home-calendar-ui');mkdirSync(out,{recursive:true});
 await page.goto(base);await page.locator('#login [name=login]').fill('staff');await page.locator('#login [name=password]').fill(password);await page.locator('#login button').click();await page.locator('#workspace').waitFor();
 const ready=month=>page.waitForFunction(month=>{const g=document.querySelector('#home-calendar-grid');return g.dataset.month===month&&g.getAttribute('aria-busy')==='false';},month);
 const selectMonth=async month=>{await page.locator('#home-calendar-month').fill(month);await page.locator('#home-calendar-month').dispatchEvent('change');await ready(month);};
 const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());await ready(now.slice(0,7));
 assert.equal(await page.locator('#home-expenses,#home-documents,#home-expense-count').count(),0);assert.doesNotMatch(await page.locator('#home').textContent(),/최근 지출결의서|최근 결재 문서/);
 await selectMonth('2026-11');const home=page.locator('#home-calendar-grid');assert.equal(await home.locator('.calendar-date').count(),30);
 for(const title of ['프로젝트 검토 회의','내 업무 집중','참여자 초대 회의','월 경계 일정'])assert.match(await home.textContent(),new RegExp(title));
 assert.doesNotMatch(await home.textContent(),/다른 직원 비공개|초대받지 않은 회의|미승인 휴가/);assert.equal(await home.locator('.event-leave').count(),1);assert.equal(await home.locator('.event-company').filter({hasText:'월 경계 일정'}).count(),2);
 await page.screenshot({path:join(out,'home-calendar.png'),fullPage:true});
 // Existing schedules can be changed from home, then immediately appear in both views.
 await home.getByRole('button',{name:'09:00 프로젝트 검토 회의',exact:true}).click();await page.locator('#schedule-form [name=title]').fill('프로젝트 검토 회의 수정');await page.locator('#schedule-save').click();await page.locator('#message').filter({hasText:'일정을 저장했습니다.'}).waitFor();await ready('2026-11');assert.match(await home.textContent(),/프로젝트 검토 회의 수정/);assert.equal(await page.locator('#home').isVisible(),true);
 await home.getByRole('button',{name:'2026-11-12 일정 등록',exact:true}).click();assert.equal(await page.locator('#schedule-form [name=start_date]').inputValue(),'2026-11-12');await page.locator('#schedule-form [name=title]').fill('홈에서 등록한 일정');await page.locator('#schedule-save').click();await page.locator('#message').filter({hasText:'일정을 저장했습니다.'}).waitFor();await ready('2026-11');await home.getByRole('button',{name:'홈에서 등록한 일정',exact:true}).click();await page.locator('#schedule-delete').click();await page.locator('#message').filter({hasText:'일정을 삭제했습니다.'}).waitFor();await ready('2026-11');assert.doesNotMatch(await home.textContent(),/홈에서 등록한 일정/);
 await page.locator('#home-calendar-open').click();assert.equal(await page.locator('#calendar-month').inputValue(),'2026-11');await page.getByRole('button',{name:'2026-11-03 일정 등록',exact:true}).click();await page.keyboard.press('Escape');await page.locator('#calendar-week-toggle').click();const row=page.locator('#calendar-events .schedule-list-row').filter({hasText:'프로젝트 검토 회의 수정'});await row.waitFor();
 const boxes=await row.evaluate(e=>[...e.children].map(n=>{const r=n.getBoundingClientRect();return {y:r.y+r.height/2,height:r.height};}));assert.ok(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))<2,'desktop details and actions stay on one line');assert.ok((await row.boundingBox()).height<60);assert.equal(await row.getByRole('button',{name:'일정 수정',exact:true}).isVisible(),true);
 await page.screenshot({path:join(out,'compact-schedule-list.png'),fullPage:true});await row.getByRole('button',{name:'연결 프로젝트 열기',exact:true}).click();await page.locator('#project-title').filter({hasText:'연구 개발 프로젝트'}).waitFor();
 // Returning home refetches leave changes made by a reviewer.
 await api('ceo',`leaves/${leave}/action`,{action:'reject'});await page.locator('.sidebar [data-tab=home]').click();await ready('2026-11');assert.equal(await home.locator('.event-leave').count(),0);
 await selectMonth('2026-12');await page.locator('#home-calendar-next').click();await ready('2027-01');assert.equal(await home.locator('.event-company').filter({hasText:'연말 이월 일정'}).count(),2);await page.locator('#home-calendar-prev').click();await ready('2026-12');await page.locator('#home-calendar-today').click();await ready(now.slice(0,7));
 // An older slow month response must not overwrite a more recent selection.
 await page.route('**/api/schedules?month=2027-02',async route=>{await new Promise(r=>setTimeout(r,250));await route.fulfill({json:{events:[{...event('오래된 응답'),start_date:'2027-02-01',end_date:'2027-02-01'}],leaves:[]}});});
 await page.locator('#home-calendar-month').fill('2027-02');await page.locator('#home-calendar-month').dispatchEvent('change');await selectMonth('2026-11');await page.waitForTimeout(300);assert.equal(await home.getAttribute('data-month'),'2026-11');assert.doesNotMatch(await home.textContent(),/오래된 응답/);await page.unroute('**/api/schedules?month=2027-02');
 for(const [tab,cards,documents,count] of [['approval','#template-cards','#approval-documents',12],['reports','#report-template-cards','#report-documents',4]]){
  await page.locator('.sidebar [data-tab='+tab+']').click();assert.equal(await page.locator(cards+' button').count(),count);const picker=await page.locator(cards).boundingBox(),list=await page.locator(documents).boundingBox();assert.ok(picker.y>list.y+list.height);const card=await page.locator(cards+' button').first().boundingBox();assert.ok(card.width<200&&card.height<=65,'compact template size');await page.screenshot({path:join(out,tab+'-compact-templates.png'),fullPage:true});
  await page.locator(cards+' button').first().click();assert.equal(await page.locator(tab==='approval'?'#draft-form':'#report-form').isVisible(),true);
 }
 await page.setViewportSize({width:390,height:844});
 for(const tab of ['home','calendar','approval','reports']){await page.locator('.sidebar [data-tab='+tab+']').click();if(tab==='home')await ready('2026-11');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,tab+' mobile overflow');}
 await page.locator('.sidebar [data-tab=home]').click();await ready('2026-11');await page.screenshot({path:join(out,'home-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: home replaces recent lists with permission-filtered schedules and director-approved leaves; KST month/date controls and stale-response protection; home create/edit/delete and calendar/project links; one-line desktop schedule rows; compact form pickers below both inboxes; mobile layouts.');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
