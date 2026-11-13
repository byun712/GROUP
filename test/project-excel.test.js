import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {splitReportText,projectReportFilename,buildProjectWorkbook} from '../project-excel.js';

test('report text chunks retain Unicode, spaces and newlines; filenames are safe and use KST',()=>{
 const source='=SUM(1,2)\r\n한글 👨‍👩‍👧‍👦 e\u0301\t빈 줄\n\n'+('긴문자열WithoutSpaces_123 '.repeat(60));
 const chunks=splitReportText(source,80);assert.ok(chunks.length>10);assert.equal(chunks.join(''),source);
 assert.ok(chunks.every(c=>!c.includes('\ufffd')));
 assert.equal(projectReportFilename('CON: a/b\\c*?"<>|. ',new Date('2026-12-31T16:00:00Z')),'프로젝트보고서_CON_ a_b_c_______2027-01-01.xlsx');
});

test('hierarchical report associates every real entry, sorts ties stably and keeps a task with its first child in print',async()=>{
 const tasks=Array.from({length:24},(_,i)=>({id:100+i,title:'공정 '+(i+1),start_date:'2026-11-01',end_date:'2026-11-05',assignee:'김담당',participants:[{name:'이참여'}],total_days:5,completed_days:i%2?5:1,progress:i%2?100:20,status:i%2?'done':'doing'}));
 const entry=(id,task,notes,extra={})=>({id,task_id:task.id,task_title:task.title,notes,work_date:'2026-11-02',created:'2026-11-02T00:00:00Z',actor_name:'김작성',kind:'work',...extra});
 const long='=HYPERLINK("x")\r\n한글·<>& ± 👨‍👩‍👧‍👦 e\u0301\t _x0041_ _x000D_\n\n'+('매우 긴 실제 수행 내용\n'.repeat(160))+'마지막 원문';
 const history=[entry(3,tasks[0],'같은 일자·시각 두 번째',{actor_name:'이작성'}),entry(2,tasks[0],'같은 일자·시각 첫 번째'),entry(1,tasks[0],'같은 일자 먼저 작성',{created:'2026-11-01T23:00:00Z'}),entry(4,tasks[0],'다른 조회 월',{work_date:'2027-01-01'}),entry(5,tasks[1],long),entry(6,tasks[2],'이전 사용자가 작성한 기록',{kind:'legacy',work_date:''}),entry(7,tasks[2],'  공정 등록  ',{kind:'legacy'}),entry(8,tasks[2],'자동 생성',{kind:'created'}),entry(9,tasks[2],' \n '),entry(10,{id:9999,title:'다른 프로젝트'},'섞이면 안 됨')];
 for(let i=3;i<tasks.length;i++)history.push(entry(100+i,tasks[i],'실제 수행 '+i));
 const project={id:1,title:'계층형 검증',start_date:'2026-01-01',end_date:'2027-12-31',status:'active',progress:60,owner:'김등록',manager:'김담당',participants:[],tasks,history};
 const before=JSON.stringify(project),buffer=await buildProjectWorkbook(project,new Date('2026-11-02T00:00:00Z')).xlsx.writeBuffer(),book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 assert.equal(JSON.stringify(project),before,'export must not mutate task counts, days or progress');
 const [main,work]=book.worksheets,header=Number(main.pageSetup.printTitlesRow.split(':')[0]),records=new Map(),order=[],firstChildren=[];let parent=0,parentStart=0;
 for(let r=header+1;r<=main.rowCount;r++){
  const row=main.getRow(r),marker=row.getCell(1).value;
  if(typeof marker==='number'){parent=marker;parentStart=r;assert.equal(row.getCell(7).value,5);assert.equal(row.getCell(8).value,tasks[parent-1].completed_days);assert.equal(row.getCell(9).value,tasks[parent-1].progress/100);continue;}
  assert.equal(marker,'↳ '+parent);const note=row.getCell(2).note,comment=typeof note==='string'?note:note.texts.map(t=>t.text).join(''),id=Number(comment.match(/수행 기록 #(\d+)/)[1]),source=history.find(h=>h.id===id);
  assert.equal(source.task_id,tasks[parent-1].id,'entry must immediately follow its own task');assert.match(comment,new RegExp('공정 #'+source.task_id+' ·'));
  assert.equal(row.getCell(7).value,'수행일자\n'+(source.work_date||'미기록'));assert.equal(row.getCell(9).value,'작성자\n'+source.actor_name);
  if(!records.has(id))order.push(id);records.set(id,(records.get(id)||'')+row.getCell(2).value);assert.equal(row.getCell(2).type,ExcelJS.ValueType.String);assert.ok(row.height<=74);
  if(r===parentStart+1)firstChildren.push(parentStart);
 }
 assert.deepEqual(order,[1,2,3,4,5,6,...tasks.slice(3).map(t=>t.id)]);assert.equal(records.get(5),long);assert.equal(records.size,27);assert.equal(parent,24);assert.equal(main.autoFilter,undefined);assert.ok(work.autoFilter);
 const zip=await JSZip.loadAsync(buffer),xml=await zip.file('xl/worksheets/sheet1.xml').async('string'),breaks=[...xml.matchAll(/<brk id="(\d+)"/g)].map(m=>Number(m[1]));assert.ok(breaks.length>5);
 for(const r of firstChildren)assert.ok(!breaks.includes(r),'no page break between task and first child');
 assert.equal(main.pageSetup.printTitlesRow,header+':'+header);assert.equal(main.pageSetup.fitToWidth,1);assert.equal(main.pageSetup.fitToHeight,0);assert.equal(main.pageSetup.paperSize,9);
});

test('project XLSX exports the complete authorized project, real work and schedule history with bounded A4 rows',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'project-excel-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';delete process.env.PUBLIC_ORIGIN;
 const {server,addUser}=await import('../test-support/server.js');addUser('writer','작성자','employee','report-test-123');addUser('other','참여자','employee','report-test-123');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let db;
 try{
  const request=async(path,body,cookie='')=>fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
  const login=await request('login',{login:'writer',password:'report-test-123'}),cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(path,body)=>{const response=await request(path,body,cookie);assert.ok(response.ok,await response.clone().text());return response.json();};
  const people=await api('people'),writer=people.find(p=>p.name==='작성자'),other=people.find(p=>p.name==='참여자');
  const baseProject={start_date:'2026-01-01',end_date:'2027-12-31',manager_id:writer.id,participant_ids:[other.id],description:'원문 설명\n둘째 줄'};
  const project=await api('projects',{...baseProject,title:'=HYPERLINK("검증") / 보고서?'}),unrelated=await api('projects',{...baseProject,title:'다른 프로젝트 비혼합 검증'}),empty=await api('projects',{...baseProject,title:'빈 프로젝트'});
  const ids=[];
  for(let i=0;i<10;i++){const task=await api(`projects/${project.id}/tasks`,{title:i===0?'긴 공정명 '.repeat(20):'공정 '+i,assignee_id:writer.id,participant_ids:[other.id],start_date:i===9?'2027-01-01':'2026-11-01',end_date:i===9?'2027-01-02':'2026-11-10',completed:i===1});ids.push(task.id);}
  for(let i=1;i<=5;i++)await api(`project-tasks/${ids[0]}/completion`,{date:'2026-11-0'+i,completed:true,version:i});
  const long='=SUM(1,2)\n한글·특수문자 <>& ΔP ± 👨‍👩‍👧‍👦 e\u0301\n\n'+('수행 내용 English 123\n'.repeat(110))+'최종 수행 문장';
  await api(`project-tasks/${ids[0]}/update`,{work_date:'2026-11-03',notes:long,version:6});
  const reason='일정 변경 사유\n'+('한글·영문 reason 123 '.repeat(100))+'최종 변경 사유';
  await api(`project-tasks/${ids[0]}/update`,{end_date:'2026-11-12',work_date:'2026-11-10',notes:'실제로 함께 작성한 수행 기록',change_reason:reason,version:7});
  const secondLogin=await request('login',{login:'other',password:'report-test-123'}),secondCookie=secondLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await request(`project-tasks/${ids[0]}/update`,{work_date:'2026-11-03',notes:'같은 수행일자 다른 작성자의 기록',version:8},secondCookie)).status,200);
  await api(`project-tasks/${ids[9]}/update`,{work_date:'2027-01-02',notes:'다른 조회 월의 수행 기록',version:1});
  const foreignTask=await api(`projects/${unrelated.id}/tasks`,{title:'섞이면 안 되는 공정',assignee_id:writer.id,start_date:'2026-11-01',end_date:'2026-11-02'});
  await api(`project-tasks/${foreignTask.id}/update`,{work_date:'2026-11-01',notes:'다른 프로젝트의 수행 기록',version:1});
  db=new DatabaseSync(join(dir,'group.db'));db.prepare("INSERT INTO project_updates(task_id,actor,status,progress,notes,created,kind) VALUES(?,?,'done',100,'완료 체크로 공정 완료','2026-11-01T16:12:13.000Z','legacy')").run(ids[0],writer.id);
  db.prepare("UPDATE project_updates SET created='2026-11-01T16:12:13.000Z' WHERE task_id=? AND kind='work'").run(ids[0]);
  const current=(await api('projects')).find(p=>p.id===project.id);
  assert.equal(current.tasks.find(t=>t.id===ids[0]).progress,42);assert.equal(current.progress,14);
  assert.equal((await request(`projects/${project.id}/excel`)).status,401);
  assert.equal((await request('projects/999999/excel',null,cookie)).status,404);
  const response=await request(`projects/${project.id}/excel`,null,cookie);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);assert.equal(response.headers.get('cache-control'),'no-store');
  const filename=decodeURIComponent(response.headers.get('content-disposition').split("UTF-8''")[1]);assert.ok(filename.endsWith('.xlsx'));assert.doesNotMatch(filename,/[<>:"/\\|?*]/);
  const buffer=Buffer.from(await response.arrayBuffer()),book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  assert.deepEqual(book.worksheets.map(s=>s.name),['프로젝트 보고서','공정 수행 내역','일정 변경 내역']);
  const [main,work,changes]=book.worksheets;
  const header=sheet=>Number(sheet.pageSetup.printTitlesRow.split(':')[0]);
  const meta=label=>{for(let r=3;r<header(main);r++)if(main.getCell(r,1).value===label)return main.getCell(r,3);};
  assert.equal(meta('프로젝트명').value,current.title);assert.equal(meta('프로젝트명').type,ExcelJS.ValueType.String);assert.equal(meta('전체 진척률').value,current.progress/100);assert.equal(meta('전체 진척률').numFmt,'0%');
  const first=main.getRow(header(main)+1);assert.equal(first.getCell(7).value,12);assert.equal(first.getCell(8).value,5);assert.equal(first.getCell(9).value,.42);
  const taskNumbers=new Set();for(let r=header(main)+1;r<=main.rowCount;r++){const n=main.getCell(r,1).value;if(typeof n==='number')taskNumbers.add(n);};assert.equal(taskNumbers.size,10);
  const reconstruct=(sheet,idColumn,contentColumn)=>{const result=new Map();for(let r=header(sheet)+1;r<=sheet.rowCount;r++){const id=sheet.getCell(r,idColumn).value;if(typeof id==='number')result.set(id,(result.get(id)||'')+String(sheet.getCell(r,contentColumn).value??''));}return result;};
  const workRows=reconstruct(work,6,3),changeRows=reconstruct(changes,7,4);
  for(const h of current.history.filter(h=>h.kind==='work'))assert.equal(workRows.get(h.id),h.notes);
  for(const h of current.history.filter(h=>h.kind==='schedule'))assert.equal(changeRows.get(h.id),h.notes);
  assert.equal(work.getCell(header(work)+1,5).value,'2026-11-02 01:12:13');
  const inline=new Map();let parent=null;for(let r=header(main)+1;r<=main.rowCount;r++){const record=main.getRow(r);if(typeof record.getCell(1).value==='number'){parent=record.getCell(1).value;continue;}if(!String(record.getCell(1).value).startsWith('↳'))continue;assert.equal(record.getCell(1).value,'↳ '+parent);const note=record.getCell(2).note,comment=typeof note==='string'?note:note.texts.map(t=>t.text).join('');const id=Number(comment.match(/수행 기록 #(\d+)/)[1]);inline.set(id,(inline.get(id)||'')+record.getCell(2).value);assert.match(record.getCell(7).value,/수행일자/);assert.match(record.getCell(9).value,/작성자/);}
  assert.deepEqual(inline,workRows);assert.equal(main.autoFilter,undefined);
  assert.equal(workRows.size,4);assert.equal(changeRows.size,1);assert.ok(work.rowCount>20);
  for(const sheet of book.worksheets){
   assert.equal(sheet.pageSetup.paperSize,9);assert.equal(sheet.pageSetup.orientation,'landscape');assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,0);assert.ok(sheet.pageSetup.printArea);assert.equal(Boolean(sheet.autoFilter),sheet!==main);assert.equal(sheet.views[0].state,'frozen');
   sheet.eachRow(row=>{assert.ok(row.height<=74);row.eachCell(cell=>{assert.notEqual(cell.type,ExcelJS.ValueType.Formula);if(typeof cell.value==='string')assert.doesNotMatch(cell.value,/섞이면 안 되는 공정|다른 프로젝트의 수행 기록|완료 체크로 공정 완료/);});});
  }
  const zip=await JSZip.loadAsync(buffer);for(const number of [2,3])assert.match(await zip.file('xl/worksheets/sheet'+number+'.xml').async('string'),/<rowBreaks count="[1-9]/);
  const emptyBook=new ExcelJS.Workbook();await emptyBook.xlsx.load(Buffer.from(await (await request(`projects/${empty.id}/excel`,null,cookie)).arrayBuffer()));
  for(const [i,text] of [[0,'등록된 공정 없음'],[1,'등록된 공정 수행 내역 없음'],[2,'등록된 일정 변경 내역 없음']]){let found=false;emptyBook.worksheets[i].eachRow(row=>row.eachCell(cell=>{if(cell.value===text)found=true;}));assert.ok(found);}
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(writer.id);assert.equal((await request(`projects/${project.id}/excel`,null,cookie)).status,401);
  const out='/tmp/project-report-check';mkdirSync(out,{recursive:true});writeFileSync(join(out,'project-report.xlsx'),buffer);
 }finally{db?.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
