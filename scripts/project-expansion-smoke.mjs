import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'project-expansion-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js'),password='expansion-fixture-123';addUser('soltec@elsoltec.com','김설계','manager',password);addUser('writer','이검증','employee',password);
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,out=process.env.UI_SCREENSHOT_DIR||'/tmp/project-expansion';mkdirSync(out,{recursive:true});let browser,db;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#login [name=login]').fill('soltec@elsoltec.com');await page.locator('#login [name=password]').fill(password);await page.locator('#login button').click();await page.locator('#workspace').waitFor();await page.locator('.app-launcher [data-open=projects]').click();await page.locator('#project-cards .empty').waitFor();assert.equal(await page.locator('#project-comparison-expand').isDisabled(),true);
 await page.evaluate(async()=>{
  const projects=[];for(const count of [0,1,6,23]){
   const p=await api('projects',{title:count===6?'검증·인증 프로젝트':'공정 '+count+'개 프로젝트',start_date:'2026-01-01',end_date:'2027-12-31'}),ids=[];
   for(let i=0;i<count;i++){
    const t=await api(`projects/${p.id}/tasks`,{title:['INERIS 검증','SW시험성적서 발급','IRIS 성과 등록 · 긴 공정명 전체 확인을 위한 설계 자료 검토'][i]||'공정 '+(i+1),assignee_id:me.user.id,start_date:'2026-11-01',end_date:'2026-11-05',completed:i%5===3});ids.push(t.id);
    if(i%5===1||i%5===2)for(let d=1;d<=i%5;d++)await api(`project-tasks/${t.id}/completion`,{date:'2026-11-0'+d,completed:true,version:d});
   }projects.push({...p,ids});
  }
  const selected=projects[2];await api(`project-tasks/${selected.ids[0]}/update`,{version:1,work_date:'2026-11-02',notes:'검증 시나리오 작성\n한글·특수문자 ΔP ± <>& 확인'});await api(`project-tasks/${selected.ids[0]}/update`,{version:2,work_date:'2026-11-03',notes:'검증 결과 정리'});await api(`project-tasks/${selected.ids[1]}/update`,{version:2,work_date:'2026-11-02',notes:'성적서 초안 작성'});
  window.expansionFixture=projects;await loadProjects();
 });
 const projects=await page.evaluate(()=>expansionFixture);db=new DatabaseSync(join(dir,'group.db'));db.prepare("UPDATE project_tasks SET status='blocked' WHERE id=?").run(projects[2].ids[4]);await page.evaluate(()=>loadProjects());
 const select=async p=>{await page.locator(`#project-cards [data-project-id="${p.id}"] .work-card-title`).click();await page.evaluate(()=>document.fonts.ready);};
 const overlay=page.locator('#project-expanded'),expand=page.locator('#project-comparison-expand'),collapse=page.locator('#project-comparison-collapse');
 const snapshot=()=>page.evaluate(()=>({scroll:[scrollX,scrollY],selected:selectedProjectId,compact:document.querySelector('#project-comparison .task-column-scroll')?.scrollLeft||0,boards:['#project-overview','#project-comparison-panel','#project-history-panel','#project-cards','#project-detail','.app-launcher','.sidebar','.topbar'].map(s=>({selector:s,...document.querySelector(s).getBoundingClientRect().toJSON()}))}));
 const sameLayout=(a,b)=>{assert.deepEqual(b.scroll,a.scroll);assert.equal(b.selected,a.selected);for(let i=0;i<a.boards.length;i++)for(const key of ['x','y','width','height'])assert.ok(Math.abs(a.boards[i][key]-b.boards[i][key])<1,`${a.boards[i].selector} ${key} changed`);};
 for(const p of projects){await select(p);await expand.click();await overlay.waitFor();assert.equal(await overlay.locator('.task-column').count(),p.ids.length);if(!p.ids.length)await overlay.getByText('등록된 공정이 없습니다.',{exact:true}).waitFor();await collapse.click();}
 const geometry=[];
 for(const viewport of [{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
  await page.setViewportSize(viewport);await select(projects[3]);await expand.scrollIntoViewIfNeeded();await page.locator('#project-comparison .task-column-scroll').evaluate(e=>e.scrollLeft=160);await page.evaluate(()=>document.fonts.ready);
  const before=await snapshot();await page.screenshot({path:join(out,'compact-'+viewport.width+'.png')});await expand.click();await overlay.waitFor();const opened=await snapshot();sameLayout(before,opened);geometry.push({viewport,before,opened});
  assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);assert.equal(page.context().pages().length,1);
  assert.equal(await page.locator('#project-history-panel').evaluate(e=>e.inert),true);await page.evaluate(()=>document.querySelector('#project-task-new').focus());assert.equal(await collapse.evaluate(e=>e===document.activeElement),true);
  assert.equal(await overlay.evaluate(e=>getComputedStyle(e).position),'fixed');assert.ok((await overlay.boundingBox()).width>(await page.locator('#project-comparison-panel').boundingBox()).width||viewport.width===390);
  const metrics=await overlay.locator('.task-column').evaluateAll(es=>es.map(e=>({name:e.querySelector('.task-column-name').textContent,value:Number(e.querySelector('.task-column-bar').dataset.progress),bar:e.querySelector('.task-column-bar').getBoundingClientRect().toJSON(),label:e.querySelector('.task-column-value').getBoundingClientRect().toJSON(),plot:e.querySelector('.task-column-plot').getBoundingClientRect().toJSON()})));
  for(const m of metrics){assert.ok(m.label.top>=m.plot.top-1,'100% label not clipped');assert.ok(m.label.bottom<=m.plot.bottom+1);if(m.value===0)assert.equal(m.bar.height,0);}
  const full=await page.locator('#project-expanded-summary').textContent();await overlay.locator('[data-comparison-filter=done]').click();assert.ok((await overlay.locator('.task-column-bar').evaluateAll(es=>es.map(e=>Number(e.dataset.progress)))).every(n=>n===100));assert.equal(await page.locator('#project-expanded-summary').textContent(),full);
  await overlay.locator('[data-comparison-filter=doing]').click();const expected=await page.evaluate(()=>businessProjects.find(p=>p.id===selectedProjectId).tasks.filter(t=>t.status==='doing').length);assert.equal(await overlay.locator('.task-column').count(),expected);
  await overlay.locator('[data-comparison-filter=all]').click();await page.locator('#project-expanded-search').fill('iris');assert.equal(await overlay.locator('.task-column').count(),1);await page.locator('#project-expanded-search').fill('없는 검색 결과');await overlay.getByText('검색·필터에 맞는 공정이 없습니다.',{exact:true}).waitFor();assert.equal(await page.locator('#project-expanded-summary').textContent(),full);await page.locator('#project-expanded-search').fill('');
  await overlay.locator('.task-column-scroll').focus();await page.keyboard.press('End');assert.equal(await overlay.locator('.task-column').last().evaluate(e=>e===document.activeElement),true);assert.ok(await overlay.locator('.task-column-scroll').evaluate(e=>e.scrollLeft>0));await page.keyboard.press('Home');
  await page.screenshot({path:join(out,'expanded-'+viewport.width+'.png')});await overlay.locator('.task-column').first().click();await page.locator('#business-dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await overlay.isVisible(),true);await page.keyboard.press('Escape');assert.equal(await overlay.isVisible(),false);
  assert.equal(await expand.evaluate(e=>e===document.activeElement),true);const closed=await snapshot();sameLayout(before,closed);assert.equal(closed.compact,before.compact);geometry.at(-1).closed=closed;await page.screenshot({path:join(out,'collapsed-'+viewport.width+'.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.setViewportSize({width:1366,height:768});await select(projects[2]);
 for(let i=0;i<4;i++){await expand.click();await collapse.click();assert.equal(await page.locator('#project-cards').evaluate(e=>e.inert),false);}
 await expand.click();const all=await page.locator('#project-expanded-summary').textContent();await overlay.locator('[data-comparison-filter=doing]').click();assert.equal(await overlay.locator('.task-column').count(),2);await overlay.locator('[data-comparison-filter=all]').click();assert.equal(await overlay.locator('.task-column').count(),6);
 await page.evaluate(async()=>{const p=businessProjects.find(p=>p.id===selectedProjectId),t=p.tasks[0];await api(`project-tasks/${t.id}/completion`,{date:'2026-11-01',completed:true,version:t.version});await loadProjects();});assert.equal(await overlay.isVisible(),true);assert.notEqual(await page.locator('#project-expanded-summary').textContent(),all);assert.equal(await overlay.locator('.task-column-bar').first().getAttribute('data-progress'),'20');assert.equal(await page.locator('#project-comparison .task-column-bar').first().getAttribute('data-progress'),'20');
 await page.locator('#project-expanded-search').fill('검색 결과 없음');const downloadEvent=page.waitForEvent('download');await page.locator('#project-report').click();const download=await downloadEvent;const book=new ExcelJS.Workbook();await book.xlsx.readFile(await download.path());copyFileSync(await download.path(),join(out,'project-report-example.xlsx'));const main=book.worksheets[0],header=Number(main.pageSetup.printTitlesRow.split(':')[0]);
 const numbers=new Set(),notes=[];for(let r=header+1;r<=main.rowCount;r++){const a=main.getCell(r,1).value;if(typeof a==='number')numbers.add(a);else if(String(a).startsWith('↳'))notes.push(main.getCell(r,2).value);}assert.equal(numbers.size,6);assert.deepEqual(notes,['검증 시나리오 작성\n한글·특수문자 ΔP ± <>& 확인','검증 결과 정리','성적서 초안 작성']);assert.equal(main.autoFilter,undefined);assert.equal(book.worksheets.length,3);
 await page.locator('.sidebar [data-tab=home]').click();assert.equal(await overlay.isVisible(),false);assert.equal(await page.locator('#project-detail').evaluate(e=>e.inert),false);await page.locator('.app-launcher [data-open=projects]').click();await expand.click();await page.evaluate(id=>document.dispatchEvent(new CustomEvent('open-project',{detail:id})),projects[0].id);await page.waitForFunction(()=>!expandedComparison);assert.equal(await overlay.isVisible(),false);
 assert.deepEqual(errors,[]);writeFileSync(join(out,'geometry.json'),JSON.stringify(geometry,null,2)+'\n');console.log('PASS: in-page expansion/collapse/Escape/focus; unchanged board geometry and scroll; 0/1/6/23 tasks, filters/search/summary/live updates; navigation cleanup; hierarchical full-project XLSX; 1366/1920/390.');
}finally{db?.close();await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
