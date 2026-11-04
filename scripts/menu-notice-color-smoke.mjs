import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'group-menu-color-'));
process.env.DATA_DIR=dir;process.env.NODE_ENV='development';process.env.OFFICE_IP='127.0.0.1';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');
addUser('writer','작성자','manager','browser-fixture-123');
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('#login [name=login]').fill('writer');await page.locator('#login [name=password]').fill('browser-fixture-123');await page.locator('#login button').click();await page.locator('#workspace').waitFor();
 const keys=['projects','mail','approval','reports','calendar','announcements','attendance','accounting','customers','users'];
 assert.deepEqual(await page.locator('.app-launcher button').evaluateAll(nodes=>nodes.map(n=>n.dataset.open)),keys);
 assert.deepEqual(await page.locator('.sidebar nav > button').evaluateAll(nodes=>nodes.map(n=>n.dataset.tab)),['home',...keys]);
 for(const viewport of [{width:1440,height:1000},{width:1280,height:720}]){
  await page.setViewportSize(viewport);await page.locator('.sidebar [data-tab=home]').click();await page.mouse.move(0,0);
  const dimensions=()=>page.locator('.app-launcher button').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>({width:n.offsetWidth,height:n.offsetHeight})));
  const homeSizes=await dimensions();
  for(const key of keys){await page.locator(`.app-launcher [data-open=${key}]`).click();await page.mouse.move(0,0);assert.deepEqual(await dimensions(),homeSizes,`launcher dimensions: ${key}`);}
  await page.locator('.app-launcher [data-open=approval]').click();assert.equal(await page.locator('#draft-menu').isVisible(),false);
  await page.locator('#new-draft').click();assert.equal(await page.locator('#draft-menu').isVisible(),true);
  await page.locator('#new-draft').click();assert.equal(await page.locator('#draft-menu').isVisible(),false);
  await page.locator('.sidebar [data-tab=users]').click();assert.equal(await page.locator('#users-submenu').isVisible(),false);
  await page.locator('.sidebar [data-tab=users]').click();assert.equal(await page.locator('#users-submenu').isVisible(),true);
  await page.locator('.app-launcher [data-open=users]').click();assert.equal(await page.locator('#users-submenu').isVisible(),false);
 }
 await page.setViewportSize({width:1440,height:1000});await page.locator('.sidebar [data-tab=home]').click();
 const boxes=await page.locator('.sidebar-approval-shortcuts button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
 assert.ok(Math.abs(boxes[0].width-boxes[0].height)<1,JSON.stringify(boxes));assert.equal(boxes[0].top,boxes[1].top);assert.ok(boxes[0].right<boxes[1].left);
 await page.locator('.sidebar [data-tab=announcements]').click();await page.locator('#notice-write').click();
 assert.deepEqual(await page.locator('#notice-form > label').evaluateAll(nodes=>nodes.map(n=>n.firstChild.textContent)),['게시판','작성자','제목','내용']);
 assert.equal(await page.locator('#notice-author').inputValue(),'작성자');
 await page.locator('#notice-form [name=title]').fill('첨부 공지');await page.locator('#notice-form [name=content]').fill('첫 본문');
 await page.locator('#notice-files').setInputFiles({name:'안내.txt',mimeType:'text/plain',buffer:Buffer.from('다운로드 검증')});
 await page.locator('#notice-file-list').getByText('안내.txt',{exact:true}).waitFor();await page.locator('#notice-save').click();await page.locator('#notice-editor').waitFor({state:'hidden'});
 await page.locator('#notices').getByRole('button',{name:'첨부 공지',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');await page.locator('#notice-attachments a').click();assert.equal((await downloadPromise).suggestedFilename(),'안내.txt');
 await page.locator('#notice-edit').click();await page.locator('#notice-form [name=content]').fill('수정된 본문');await page.locator('#notice-save').click();await page.locator('#notice-editor').waitFor({state:'hidden'});await page.locator('#notice-content').getByText('수정된 본문',{exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.evaluate(async()=>{const post=async(path,body)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};const day=today(),p=await post('projects',{title:'회색 프로젝트',color:'#68717d',start_date:day,end_date:day,description:''});await post('schedules',{title:'연결 일정',project_id:p.id,start_date:day,end_date:day,all_day:true,visibility:'company'});});
 await page.locator('.sidebar [data-tab=calendar]').click();const chip=page.locator('#calendar-grid .calendar-event').filter({hasText:'연결 일정'});await chip.waitFor();
 assert.equal(await chip.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(104, 113, 125)');assert.equal(await chip.evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
 await page.locator('.sidebar [data-tab=projects]').click();await page.locator('#project-cards').getByText('회색 프로젝트',{exact:true}).click();
 assert.equal(await page.locator('.project-color-swatch').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(104, 113, 125)');
 const projectChip=page.locator('#project-task-board .project-schedule-event');await projectChip.waitFor();assert.equal(await projectChip.first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(104, 113, 125)');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: menu order, square shortcuts, notice editor/upload/download/edit, project/calendar colors, mobile width');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
