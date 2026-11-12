import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'project-summary-layout-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');
const password='summary-layout-fixture';addUser('soltec@elsoltec.com','설계 담당자','manager',password);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const phase=process.env.CAPTURE_BASELINE?'before':'after',out=process.env.UI_SCREENSHOT_DIR||'/tmp/project-summary-layout';mkdirSync(out,{recursive:true});let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[],measurements=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#login [name=login]').fill('soltec@elsoltec.com');await page.locator('#login [name=password]').fill(password);await page.locator('#login button').click();await page.locator('#workspace').waitFor();
 await page.locator('.app-launcher [data-open=projects]').click();await page.locator('#project-cards .empty').waitFor();
 assert.equal(await page.locator('.project-donut').count(),0);
 if(phase==='after')assert.ok(await page.locator('#project-overview').evaluate(e=>{const c=e.getBoundingClientRect(),p=e.querySelector('.empty').getBoundingClientRect();return p.top>=c.top&&p.bottom<=c.bottom;}),'empty message fits');
 await page.evaluate(async()=>{
  const base={start_date:'2026-07-27',end_date:'2027-02-26',color:'#b45309'};
  const sample=await api('projects',{...base,title:'[KEPCO E&C] 스택 설계'}),empty=await api('projects',{...base,title:'공정 없는 프로젝트'}),zero=await api('projects',{...base,title:'0% 미착수 프로젝트'}),complete=await api('projects',{...base,title:'100% 완료 프로젝트'}),long=await api('projects',{...base,title:'[KEPCO E&C] 장기 설계 프로젝트 · '+ '긴 프로젝트명 전체 확인 '.repeat(6)});
  const tasks=[];for(const [title,days] of [['설계 자료 검토',2],['구조 설계',1],['최종 검토',0]]){const t=await api(`projects/${sample.id}/tasks`,{title,assignee_id:me.user.id,start_date:'2026-07-27',end_date:'2026-07-31'});tasks.push(t.id);for(let d=0;d<days;d++)await api(`project-tasks/${t.id}/completion`,{date:'2026-07-'+(27+d),completed:true,version:d+1});}
  await api(`projects/${zero.id}/tasks`,{title:'미착수 공정',assignee_id:me.user.id,start_date:'2026-07-27',end_date:'2026-07-31'});
  await api(`projects/${complete.id}/tasks`,{title:'완료 공정',assignee_id:me.user.id,start_date:'2026-07-27',end_date:'2026-07-27',completed:true});
  for(let i=0;i<9;i++)await api(`projects/${long.id}/tasks`,{title:'다수 공정 '+(i+1),assignee_id:me.user.id,start_date:'2026-07-27',end_date:'2026-07-31'});
  window.summaryFixture={sample:sample.id,empty:empty.id,zero:zero.id,complete:complete.id,long:long.id,tasks};await loadProjects();
 });
 const fixture=await page.evaluate(()=>summaryFixture);
 const select=async id=>{await page.locator(`#project-cards [data-project-id="${id}"] .work-card-title`).click();await page.evaluate(()=>document.fonts.ready);};
 async function metrics(){return page.locator('#project-overview').evaluate(card=>{
  const rect=e=>e.getBoundingClientRect().toJSON(),title=card.querySelector('h3'),ring=card.querySelector('.project-donut'),body=card.querySelector('.project-summary-body'),footer=card.querySelector('.project-summary-footer');
  const headers=[...document.querySelectorAll('.project-workboard-top .workboard-region-heading')];
  return {card:rect(card),paddingTop:getComputedStyle(card).paddingTop,status:rect(card.querySelector('.badge')),title:rect(title),titleWidth:title.scrollWidth,titleClient:title.clientWidth,titleWhiteSpace:getComputedStyle(title).whiteSpace,ring:rect(ring),body:rect(body),footer:footer?{...rect(footer),scroll:footer.scrollWidth,client:footer.clientWidth,font:getComputedStyle(footer).fontSize,text:footer.textContent}:null,info:[...card.querySelectorAll('.project-summary-dates,.overview-caption')].map(e=>({...rect(e),scroll:e.scrollWidth,client:e.clientWidth,font:getComputedStyle(e).fontSize})),headers:headers.map(rect),titles:headers.map(e=>rect(e.querySelector('h2,h3'))),panels:[...document.querySelectorAll('.project-workboard-top>.workboard-region')].map(rect)};
 });}
 for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
  await page.setViewportSize(viewport);await select(fixture.sample);await page.locator('.project-workboard-top').scrollIntoViewIfNeeded();
  const m=await metrics();measurements.push({viewport,...m});
  assert.equal(await page.locator('.project-donut-center strong').textContent(),'20%');assert.equal(await page.locator('.overview-caption').textContent(),'진척률 20% (공정 0 / 3)');assert.doesNotMatch(await page.locator('#project-overview').textContent(),/평균|날짜별|완료 체크|NaN/);
  if(phase==='after'){
   assert.equal(m.titleWhiteSpace,'nowrap');assert.ok(m.titleWidth<=m.titleClient+1,'sample title fully visible');assert.ok(m.ring.width>=195,'actual ring diameter');assert.ok(m.ring.width/m.card.width>.56&&m.ring.width/m.card.width<.64,'roughly 60 percent of card width');assert.equal(m.paddingTop,'14px');assert.ok(Math.abs(m.status.y+m.status.height/2-m.title.y-m.title.height/2)<1,'status and title share center');assert.ok(Math.abs(m.ring.width-m.ring.height)<1);
   assert.ok(Math.abs(m.ring.x+m.ring.width/2-m.card.x-m.card.width/2)<1,'ring horizontally centered');assert.ok(Math.abs(m.ring.y+m.ring.height/2-m.body.y-m.body.height/2)<1,'ring vertically centered in body');
   assert.ok(m.title.bottom<m.ring.top&&m.ring.bottom<m.footer.top,'three separate areas');assert.equal(m.footer.text,'2026-07-27 ~ 2027-02-26 / 진척률 20% (공정 0 / 3)');assert.ok(m.footer.scroll<=m.footer.client+1,'entire footer fits one line');assert.ok(m.info.every(r=>Math.abs(r.top-m.info[0].top)<1&&r.height<=24&&r.scroll<=r.client+1),'single footer baseline');
   assert.equal(m.headers.length,3);assert.ok(m.panels.every(p=>Math.abs(p.height-m.card.height)<1),'equal panel heights');assert.ok(m.titles.every((t,i)=>Math.abs(t.top-m.panels[i].top-(m.titles[0].top-m.card.top))<1),'same title inset');
   if(viewport.width>1150){assert.ok(m.panels.every(p=>Math.abs(p.top-m.card.top)<1&&Math.abs(p.bottom-m.card.bottom)<1));assert.ok(m.titles.every(t=>Math.abs(t.top-m.titles[0].top)<1&&Math.abs(t.height-m.titles[0].height)<1),'aligned title baselines');}else assert.ok(m.panels[0].bottom<=m.panels[1].top&&m.panels[1].bottom<=m.panels[2].top);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const history=await page.locator('#project-history').evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,visible:[...e.children].filter(c=>c.getBoundingClientRect().top<e.getBoundingClientRect().bottom-1).length}));assert.equal(history.visible,2);assert.ok(history.scroll>history.height);
  }
  await page.locator('.project-workboard-top').screenshot({path:join(out,`${phase}-panels-${viewport.width}.png`)});await page.locator('#project-overview').screenshot({path:join(out,`${phase}-summary-${viewport.width}.png`)});
  if(phase==='after'){
   for(const [id,value,done,total] of [[fixture.empty,0,0,0],[fixture.zero,0,0,1],[fixture.complete,100,1,1],[fixture.long,0,0,9]]){await select(id);assert.equal(await page.locator('.project-donut-center strong').textContent(),value+'%');assert.equal(await page.locator('.overview-caption').textContent(),`진척률 ${value}% (공정 ${done} / ${total})`);const n=await metrics();assert.equal(n.titleWhiteSpace,'nowrap');assert.ok(n.footer.scroll<=n.footer.client+1);assert.ok(Math.abs(n.ring.x+n.ring.width/2-n.card.x-n.card.width/2)<1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
   const longTitle=page.locator('#project-overview h3');assert.equal(await longTitle.evaluate(e=>getComputedStyle(e).textOverflow),'clip');await longTitle.focus();await page.keyboard.press('End');assert.ok(await longTitle.evaluate(e=>e.scrollLeft>0),'long name scrolls to its end without ellipsis');await page.keyboard.press('Home');assert.equal(await longTitle.evaluate(e=>e.scrollLeft),0);
   await select(fixture.sample);const colors=await page.evaluate(()=>{const p=businessProjects.find(p=>p.id===selectedProjectId);return {background:getComputedStyle(document.querySelector('.project-donut')).backgroundImage,colors:[...document.querySelectorAll('.task-column-bar')].map(e=>getComputedStyle(e).backgroundColor),values:p.tasks.map(t=>t.progress)};});assert.deepEqual(colors.values,[40,20,0]);for(const color of colors.colors)assert.ok(colors.background.includes(color),'same task color in ring and columns');
   await page.locator('#project-history .work-card-title').first().click();await page.locator('#business-dialog').waitFor();await page.getByRole('button',{name:'공정 수정 · 수행 내역 작성',exact:true}).waitFor();await page.keyboard.press('Escape');await page.locator('#project-task-new').click();await page.locator('#business-dialog [name=title]').waitFor();await page.keyboard.press('Escape');
  }
 }
 if(phase==='after'){
  await page.setViewportSize({width:1366,height:768});await select(fixture.sample);await page.locator('#project-month').fill('2026-07');await page.locator('#project-month').dispatchEvent('change');await page.getByRole('checkbox',{name:'최종 검토 완료 (2026-07-27)',exact:true}).check();await page.waitForFunction(()=>document.querySelector('.project-donut-center strong').textContent==='27%');assert.equal(await page.locator('.overview-caption').textContent(),'진척률 27% (공정 0 / 3)');
  await page.getByRole('checkbox',{name:'최종 검토 완료 (2026-07-27)',exact:true}).uncheck();await page.waitForFunction(()=>document.querySelector('.project-donut-center strong').textContent==='20%');
  const detail=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:2,storageState:await page.context().storageState()});await detail.goto(base);await detail.locator('#workspace').waitFor();await detail.locator('.app-launcher [data-open=projects]').click();await detail.locator(`#project-cards [data-project-id="${fixture.sample}"] .work-card-title`).click();await detail.evaluate(()=>document.fonts.ready);await detail.locator('#project-overview').screenshot({path:join(out,'after-summary-detail-2x.png')});await detail.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,`${phase}-measurements.json`),JSON.stringify(measurements,null,2)+'\n');console.log(phase==='before'?'Captured baseline at 1366/1920/390.':'PASS: centered enlarged live donut, one-line footer, shared headers/heights, 0/20/100/empty/many/long, task details/add/completion and three viewports.');
 console.log(JSON.stringify(measurements.map(m=>({width:m.viewport.width,card:m.card.width,height:m.card.height,diameter:m.ring.width,info:m.info.map(r=>({width:r.width,font:r.font})),footer:m.footer&&{width:m.footer.client,scroll:m.footer.scroll}}))));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
