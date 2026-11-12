import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'workboard-ui-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');addUser('soltec@elsoltec.com','관리자','manager','workboard-test-123');
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('#login [name=login]').fill('soltec@elsoltec.com');await page.locator('#login [name=password]').fill('workboard-test-123');await page.locator('#login button').click();await page.locator('#workspace').waitFor();
 const open=async key=>{await page.locator(`.app-launcher [data-open=${key}]`).click();await page.locator('#'+key).waitFor();};
 const measurements=[];mkdirSync('/tmp/workboard-ui',{recursive:true});
 for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const key of ['approval','reports']){await open(key);const selector=key==='approval'?'#template-cards':'#report-template-cards';
   await page.locator(selector+' button').first().waitFor();await page.evaluate(()=>document.fonts.ready);
   const sizes=await page.locator(selector+' button').evaluateAll(es=>es.map(e=>({name:e.firstChild.textContent,height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize})));
   measurements.push({width:viewport.width,key,sizes});
  }
 }
 if(process.env.MEASURE_BEFORE){writeFileSync('/tmp/workboard-before.json',JSON.stringify(measurements,null,2));console.log(JSON.stringify(measurements));}
 else {writeFileSync('/tmp/workboard-after.json',JSON.stringify(measurements,null,2));}
 if(!process.env.MEASURE_BEFORE){
  for(const entry of measurements)for(const card of entry.sizes){assert.equal(card.font,'12px');assert.ok(Math.abs(card.height/56.09375-2/3)<.015,JSON.stringify(card));}
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const key of ['approval','reports']){
    await open(key);const root=page.locator('#'+key),filters=root.locator('.document-filters');
    assert.equal(await filters.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
    const bounds=await filters.locator('select,input').evaluateAll(es=>es.map(e=>({bottom:e.getBoundingClientRect().bottom,height:e.getBoundingClientRect().height,background:getComputedStyle(e).backgroundColor})));
    assert.equal(bounds[0].height,bounds[1].height);assert.ok(bounds.every(b=>b.background==='rgb(255, 255, 255)'));if(viewport.width>650)assert.ok(Math.abs(bounds[0].bottom-bounds[1].bottom)<1);
    assert.equal(await root.locator('.template-cards small').count(),0);assert.doesNotMatch(await root.locator('.template-cards').textContent(),/작성.*이사/);
    assert.equal(await root.locator('.template-cards').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),viewport.width>1000?6:2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await root.screenshot({path:`/tmp/workboard-ui/${key}-${viewport.width}.png`});
   }
  }
  await page.setViewportSize({width:1366,height:768});
  for(const key of ['approval','reports']){
   await open(key);const selector=key==='approval'?'#template-cards':'#report-template-cards',count=await page.locator(selector+' button').count();
   for(let i=0;i<count;i++){await open(key);const button=page.locator(selector+' button').nth(i),name=await button.textContent();await button.click();if(key==='reports')assert.equal(await page.locator('#report-form-title').textContent(),name);else {assert.equal(await page.evaluate(()=>selectedTemplate.name),name);const active=await page.locator('html').getAttribute('data-page');assert.ok(['leave','expense','draft'].includes(active));if(active==='draft')assert.equal(await page.locator('#draft-form-title').textContent(),name);}}
  }
  await page.evaluate(async()=>{const post=(path,body)=>api(path,body),base={start_date:'2026-11-01',end_date:'2026-12-31',description:''};
   const a=await post('projects',{...base,title:'A 진척률 검증',color:'#246cad'}),b=await post('projects',{...base,title:'B 완료 프로젝트',color:'#547e23'}),c=await post('projects',{...base,title:'C 빈 프로젝트',color:'#68717d'});
   const task=await post(`projects/${a.id}/tasks`,{title:'A 전용 공정',assignee_id:me.user.id,start_date:'2026-11-01',end_date:'2026-11-20'});
   for(let day=1;day<=13;day++)await post(`project-tasks/${task.id}/completion`,{date:'2026-11-'+String(day).padStart(2,'0'),completed:true,version:day});
   await post(`projects/${b.id}/tasks`,{title:'B 전용 완료 공정',assignee_id:me.user.id,start_date:'2026-11-01',end_date:'2026-11-02',completed:true});
   for(const id of ['daily_work_log','meeting_minutes']){const t=reportTemplates.find(t=>t.id===id),fields={};for(const f of t.fields)fields[f.key]=f.type==='date'?'2026-11-11':f.type==='time'?(f.key==='end_time'?'10:00':'09:00'):f.type==='money'?0:'검증 내용';await post('reports',{template_id:id,title:id+' 검색 검증',fields});}
   const d=await post('projects',{...base,title:'D 긴 프로젝트명 '.repeat(8),color:'#b13e50'});for(let i=0;i<14;i++)await post(`projects/${d.id}/tasks`,{title:'긴 공정 이름 '.repeat(12)+i,assignee_id:me.user.id,start_date:'2026-12-01',end_date:'2026-12-02'});
   window.fixture={d:d.id,a:a.id,b:b.id,c:c.id,task:task.id};await refresh();
  });
  for(const key of ['approval','reports']){
   await open(key);const prefix=key==='approval'?'approval':'report';await page.locator('#'+prefix+'-template-filter').selectOption('daily_work_log');
   await page.locator('#'+prefix+'-query').fill('daily_work_log');if(key==='reports')await page.locator('#report-search button').click();
   await page.waitForFunction(p=>document.querySelector('#'+p+'-documents').textContent.includes('daily_work_log 검색 검증'),prefix);assert.doesNotMatch(await page.locator('#'+prefix+'-documents').textContent(),/meeting_minutes/);
   await page.locator('#'+prefix+'-query').fill('없는제목');if(key==='reports')await page.locator('#report-search button').click();await page.locator('#'+prefix+'-documents .empty').waitFor();
  }
  await open('projects');await page.locator('#project-cards button').first().waitFor();
  const select=async name=>{await page.locator('#project-cards .work-card-title').getByText(name,{exact:true}).click();};
  const verify=async(name,value,task)=>{await select(name);assert.equal(await page.locator('.project-donut-center strong').textContent(),value+'%');assert.equal(await page.locator('.project-donut').getAttribute('data-progress'),String(value));if(task)assert.match(await page.locator('.project-donut').evaluate(e=>e.style.background),new RegExp(value+'%'));assert.equal(await page.locator('#project-overview h3').textContent(),name);if(task)assert.match(await page.locator('#project-history').textContent(),new RegExp(task));};
  await verify('A 진척률 검증',65,'A 전용 공정');assert.doesNotMatch(await page.locator('#project-history').textContent(),/B 전용/);assert.match(await page.locator('#project-overview').textContent(),/완료 0 \/ 전체 1/);
  await verify('B 완료 프로젝트',100,'B 전용 완료 공정');assert.doesNotMatch(await page.locator('#project-history').textContent(),/A 전용/);
  await verify('C 빈 프로젝트',0);assert.match(await page.locator('#project-overview').textContent(),/등록된 공정 없음/);assert.equal(await page.locator('#project-history .work-card').count(),0);
  await page.evaluate(async()=>{const original=api;let release,first=true;api=async(path,...args)=>{const result=await original(path,...args);if(path==='projects'&&first){first=false;await new Promise(r=>release=r);for(const p of result)p.title='오래된 응답';}return result;};const pending=loadProjects();while(!release)await new Promise(r=>setTimeout(r,5));await loadProjects();selectedProjectId=window.fixture.b;renderProjects();release();await pending;api=original;});
  assert.equal(await page.locator('#project-overview h3').textContent(),'B 완료 프로젝트');
  await verify('A 진척률 검증',65,'A 전용 공정');
  await page.locator('#project-month').fill('2026-11');await page.locator('#project-month').dispatchEvent('change');
  await page.getByRole('checkbox',{name:'A 전용 공정 완료 (2026-11-14)',exact:true}).check();await page.waitForFunction(()=>document.querySelector('.project-donut')?.dataset.progress==='70');
  assert.equal(await page.locator('#project-history progress').evaluate(e=>String(e.value)),'70');assert.equal(await page.locator('#project-comparison progress').evaluate(e=>e.value),70);
  await page.locator('#project-history .work-card-title').click();await page.locator('#business-dialog').getByRole('button',{name:'공정 수정 · 수행 내역 작성',exact:true}).click();
  const form=page.locator('#business-dialog form');await form.locator('[name=end_date]').fill('2026-11-28');await form.locator('[name=end_date]').dispatchEvent('change');await form.locator('[name=change_reason]').fill('일정 연장 검증');await form.getByRole('button',{name:'저장',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.project-donut')?.dataset.progress==='50');
  await page.locator('#project-history .work-card-title').click();await page.locator('.task-schedule-history summary').click();assert.match(await page.locator('#business-dialog').textContent(),/일정 연장 검증/);await page.keyboard.press('Escape');
  assert.equal(await page.locator('#project-progress,#project-progress-summary').count(),0);assert.equal(await page.locator('#project-history').count(),1);
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const positions=await page.locator('#project-overview,#project-history-panel,#project-cards').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));if(viewport.width>1150)assert.ok(positions[0].right<=positions[1].left);else assert.ok(positions[0].bottom<=positions[1].top);assert.ok(positions[2].top>=positions[1].bottom);await page.locator('#projects').screenshot({path:`/tmp/workboard-ui/projects-${viewport.width}.png`});}
  await page.evaluate(()=>{selectedProjectId=window.fixture.d;$('#project-month').value='2026-11';renderProjects();});assert.equal(await page.locator('.project-donut-center strong').textContent(),'0%');assert.equal(await page.locator('#project-history .work-card').count(),14);assert.equal(await page.locator('#project-history').evaluate(e=>e.scrollHeight>e.clientHeight),true);await page.locator('#project-history .work-card-title').last().click();assert.match(await page.locator('#business-dialog-title').textContent(),/0 · 일자별 수행 내역/);await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.project-workboard-top').screenshot({path:'/tmp/workboard-ui/projects-many-mobile.png'});
  await page.setViewportSize({width:1366,height:768});await select('B 완료 프로젝트');await page.locator('#project-history .work-card-title').click();await page.locator('#business-dialog').getByRole('button',{name:'공정 수정 · 수행 내역 작성',exact:true}).click();await page.locator('#business-dialog').getByRole('button',{name:'공정 삭제',exact:true}).click();await form.locator('[name=confirm]').check();await form.getByRole('button',{name:'저장',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#project-history .empty'));assert.equal(await page.locator('.project-donut-center strong').textContent(),'0%');
  console.log('PASS: measured card heights, aligned white filters, 6/2 columns, all 16 templates, search/type filters, selected-only 0/65/100%, stale-response protection, completion and schedule update, history and responsive layout');
 }

 assert.deepEqual(errors,[]);
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
