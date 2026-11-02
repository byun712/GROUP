import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {buildFormWorkbook} from '../form-excel.js';
import {approvalTemplates} from '../approvals.js';
import {reportTemplates} from '../report-templates.js';

const user={name:'작성자'};
const normalize=s=>String(s).replace(/\s/g,'');
const sample='한글과 English WWWMMM, 1234567890 · ΔP = 3.25 kPa; ±2.5%. 가족 👨‍👩‍👧‍👦 및 e\u0301 조합 문자\r\n둘째 줄\t공백 유지\n';
function textAfter(sheet,label,start=1,stop){
 let active=false,value='';
 for(let r=1;r<=sheet.rowCount;r++){
  const cell=sheet.getCell(r,start);if(cell.value===label){active=true;continue;}
  if(active){if(stop&&cell.value===stop)break;value+=String(cell.value??'');}
 }
 return value;
}

test('printable XLSX uses a static Korean font, A4 width-only scaling and bounded rows without truncating mixed-language text',async()=>{
 const content=sample.repeat(28)+'마지막 문장까지 보존';
 const book=await buildFormWorkbook(null,approvalTemplates.find(t=>t.id==='trip_report'),{title:'긴 제목 '.repeat(20),fields:{start_date:'2026-11-02',end_date:'2026-11-03',destination:'출장지',content}},{user});
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());const sheet=loaded.worksheets[0];
 assert.equal(sheet.pageSetup.paperSize,9);assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,0);assert.equal(sheet.pageSetup.orientation,'portrait');assert.equal(sheet.pageSetup.printTitlesRow,'1:2');
 assert.equal(normalize(textAfter(sheet,'출장 결과 보고')),normalize(content));
 assert.ok(sheet.rowCount>60,'long documents paginate through small rows');
 sheet.eachRow(row=>{assert.ok(row.height<=409.5,'Excel maximum row height');row.eachCell(cell=>{if(cell.type===ExcelJS.ValueType.Merge||cell.value===null)return;assert.equal(cell.font.name,'Malgun Gothic');assert.notEqual(cell.alignment?.horizontal,'distributed');assert.notEqual(cell.alignment?.horizontal,'justify');assert.ok((cell.font.size||11)>=8);});});
 const firstBody=Array.from({length:sheet.rowCount},(_,i)=>i+1).find(r=>sheet.getCell(r,1).value==='출장 결과 보고')+1;
 assert.equal(sheet.getCell(firstBody,1).border.left.style,'thin');assert.equal(sheet.getCell(firstBody,8).border.right.style,'thin');
 for(let r=firstBody;r<=sheet.rowCount;r++)assert.equal(sheet.getRow(r).height,20);
 assert.ok(![...content].includes('\ufffd'));assert.ok(!textAfter(sheet,'출장 결과 보고').includes('\ufffd'));
});

test('daily report columns retain unequal long texts; large expense amounts remain numeric and printable',async()=>{
 const completed=sample.repeat(14)+'실시 최종 문장',planned=sample.repeat(4)+'예정 최종 문장';
 const daily=await buildFormWorkbook(null,reportTemplates.find(t=>t.id==='daily_work_log'),{title:'일지',fields:{report_date:'2026-11-02',completed_work:completed,planned_work:planned,ongoing_work:'진행 최종 문장',notes:'특이 최종 문장'}},{user});
 const sheet=daily.worksheets[0];assert.equal(normalize(textAfter(sheet,'실시사항',1,'진행업무')),normalize(completed));
 let right='',recording=false;for(let r=1;r<=sheet.rowCount;r++){if(sheet.getCell(r,5).value==='예정사항'){recording=true;continue;}if(recording){if(sheet.getCell(r,1).value==='진행업무')break;right+=String(sheet.getCell(r,5).value??'');}}
 assert.equal(normalize(right),normalize(planned));assert.equal(sheet.getRow(sheet.rowCount).getCell(1).value,'특이 최종 문장');
 const expense=await buildFormWorkbook(null,approvalTemplates.find(t=>t.id==='expense'),{title:'고액 지출',items:[{category:'소모품비',description:'아주 긴 항목 설명 '.repeat(8),supply:999999999999,tax:1}]},{user});
 const money=[];expense.worksheets[0].eachRow(row=>row.eachCell(cell=>{if(cell.type===ExcelJS.ValueType.Number){money.push(cell.value);assert.ok(cell.font.size>=8);assert.equal(cell.numFmt,'#,##0');}}));
 for(const amount of [999999999999,1,1000000000000])assert.ok(money.includes(amount));
 const filenameFormula='=HYPERLINK("https://example.com")';const literal=await buildFormWorkbook(null,approvalTemplates.find(t=>t.id==='general'),{title:filenameFormula,fields:{content:filenameFormula}},{user});assert.equal(literal.worksheets[0].getCell('C4').type,ExcelJS.ValueType.String);
});
