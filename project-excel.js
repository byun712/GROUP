import ExcelJS from 'exceljs';
import {projectReportData} from './projects.js';
import {wrapPrintText,printContentWidth} from './excel-print-layout.js';

const SIZE=10.5,LINE_HEIGHT=17,INK='FF26374E',ACCENT='FF246CAD',LIGHT='FFEDF3F8';
const projectStates={planned:'계획',active:'진행',on_hold:'보류',completed:'완료'};
const taskStates={todo:'예정',doing:'진행',blocked:'보류',done:'완료'};
const koreanTime=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'';
const font=(bold=false,size=SIZE)=>({name:'Malgun Gothic',size,bold,color:{argb:INK},charset:129});
const segmenter=new Intl.Segmenter('ko',{granularity:'grapheme'});

// Split only between graphemes. Joining the chunks reproduces the original text,
// including newlines, spaces and tabs; soft wrapping never changes stored content.
export function splitReportText(value,width,maxLines=4){
 const source=String(value??'');
 if(!source)return [''];
 const characters=[...segmenter.segment(source)].map(s=>s.segment),chunks=[];
 let offset=0;
 while(offset<characters.length){
  let low=offset+1,high=Math.min(characters.length,offset+2000),end=low;
  while(low<=high){
   const middle=Math.floor((low+high)/2),candidate=characters.slice(offset,middle).join('');
   if(wrapPrintText(candidate,width,SIZE).length<=maxLines){end=middle;low=middle+1;}else high=middle-1;
  }
  chunks.push(characters.slice(offset,end).join(''));offset=end;
 }
 return chunks;
}
function styleCell(cell,{header=false,numeric=false}={}){
 cell.font=font(header);
 cell.alignment={vertical:'top',horizontal:numeric?'right':'left',wrapText:true,shrinkToFit:false};
 cell.border={bottom:{style:'hair',color:{argb:'FFDCE4ED'}}};
 if(header){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:LIGHT}};cell.alignment.vertical='middle';}
}
function makeSheet(workbook,name,widths,project){
 const sheet=workbook.addWorksheet(name,{properties:{defaultRowHeight:23},pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,showGridLines:false,margins:{left:.35,right:.35,top:.4,bottom:.4,header:.15,footer:.15}}});
 sheet.columns=widths.map(width=>({width}));sheet.views=[{showGridLines:false}];
 sheet.headerFooter.oddHeader='&L&"Malgun Gothic,Regular"&8ELSOLTEC · 프로젝트 #'+project.id;
 sheet.headerFooter.oddFooter='&L&"Malgun Gothic,Regular"&8한국 시간 기준&R&P / &N';
 sheet.mergeCells(1,1,1,widths.length);const title=sheet.getCell(1,1);title.value=name;title.font=font(true,20);title.font.color={argb:ACCENT};title.alignment={vertical:'middle'};sheet.getRow(1).height=36;
 sheet.getRow(2).height=10;
 return sheet;
}
function metadata(sheet,row,label,value,numberFormat){
 const last=sheet.columnCount,width=printContentWidth(sheet,3,last),chunks=typeof value==='number'?[value]:splitReportText(value,width);
 for(const part of chunks){
  sheet.mergeCells(row,1,row,2);sheet.mergeCells(row,3,row,last);
  const key=sheet.getCell(row,1),cell=sheet.getCell(row,3);key.value=label;cell.value=part;
  styleCell(key,{header:true});styleCell(cell,{numeric:typeof part==='number'});if(numberFormat)cell.numFmt=numberFormat;
  sheet.getRow(row).height=Math.max(24,wrapPrintText(part,width,SIZE).length*LINE_HEIGHT+6);row++;
 }
 return row;
}
function tableHeader(sheet,row,labels){
 let lines=1;
 labels.forEach((label,i)=>{const cell=sheet.getCell(row,i+1);cell.value=label;styleCell(cell,{header:true});lines=Math.max(lines,wrapPrintText(label,printContentWidth(sheet,i+1,i+1),SIZE).length);});
 sheet.getRow(row).height=Math.max(32,lines*LINE_HEIGHT+6);
 sheet.views=[{state:'frozen',ySplit:row,topLeftCell:'A'+(row+1),showGridLines:false}];
 sheet.pageSetup.printTitlesRow=row+':'+row;
 return row+1;
}
function recordRows(sheet,row,values,formats={},repeatColumns=[]){
 const chunks=values.map((value,i)=>typeof value==='number'?[value]:splitReportText(value,printContentWidth(sheet,i+1,i+1)));
 const count=Math.max(...chunks.map(parts=>parts.length));
 for(let n=0;n<count;n++){
  let lines=1;
  chunks.forEach((parts,i)=>{
   const value=parts[n]??(repeatColumns.includes(i)&&parts.length===1?parts[0]:''),cell=sheet.getCell(row,i+1);
   cell.value=value;styleCell(cell,{numeric:typeof value==='number'});if(formats[i])cell.numFmt=formats[i];
   lines=Math.max(lines,wrapPrintText(value,printContentWidth(sheet,i+1,i+1),SIZE).length);
  });
  sheet.getRow(row).height=Math.max(24,lines*LINE_HEIGHT+6);row++;
 }
 return row;
}
function finish(sheet,header,end){
 sheet.autoFilter={from:{row:header,column:1},to:{row:Math.max(header,end),column:sheet.columnCount}};
 sheet.pageSetup.printArea=`A1:${sheet.getColumn(sheet.columnCount).letter}${end}`;
 // A4 landscape, conservative printable height. Break between bounded rows;
 // repeat the table header on continuation pages, never shrink to one page tall.
 let used=0;
 for(let r=1;r<=end;r++){
  const height=sheet.getRow(r).height||23;
  if(used+height>480){sheet.getRow(r-1).addPageBreak();used=sheet.getRow(header).height||32;}
  used+=height;
 }
}
export function buildProjectWorkbook(project,generatedAt=new Date()){
 const workbook=new ExcelJS.Workbook();workbook.creator='ELSOLTEC';workbook.created=generatedAt;
 const main=makeSheet(workbook,'프로젝트 보고서',[6,26,12,12,13,24,9,9,10,10],project);
 let row=3;
 for(const [label,value,format] of [
  ['프로젝트명',project.title],['기관 / 고객사',project.company||'내부 업무'],['프로젝트 기간',project.start_date+' ~ '+project.end_date],
  ['프로젝트 상태',projectStates[project.status]||project.status],['전체 진척률',project.progress/100,'0%'],['등록자',project.owner],['담당자',project.manager||project.owner],
  ['참여자',project.participants.map(p=>p.name).join(', ')||'없음'],['생성일시 (한국 시간)',koreanTime(generatedAt)],...(project.description?[['프로젝트 설명',project.description]]:[])
 ])row=metadata(main,row,label,value,format);
 row++;const mainHeader=row;row=tableHeader(main,row,['순번','공정명','시작일','종료일','담당자','참여자','전체 일수','완료 일수','진척률','상태']);
 const tasks=[...project.tasks].sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.id-b.id);
 tasks.forEach((task,index)=>{row=recordRows(main,row,[index+1,task.title,task.start_date,task.end_date,task.assignee,task.participants.map(p=>p.name).join(', ')||'없음',task.total_days,task.completed_days,task.progress/100,taskStates[task.status]||task.status],{0:'0',6:'0',7:'0',8:'0%'},[0,2,3,4,6,7,8,9]);});
 if(!tasks.length)row=metadata(main,row,'공정 현황','등록된 공정 없음');
 finish(main,mainHeader,row-1);

 const work=makeSheet(workbook,'공정 수행 내역',[12,25,54,13,23,9,12],project);
 row=metadata(work,3,'프로젝트명',project.title);const workHeader=row;row=tableHeader(work,row,['수행일자','공정명','수행 내용','작성자','기록 작성일시 (한국 시간)','기록 ID','기록 구분']);
 const automaticLegacy=new Set(['완료 체크로 공정 완료','완료 체크 해제','공정 등록','공정 정보 수정']);
 const entries=project.history.filter(h=>(h.kind==='work'||h.kind==='legacy'&&!automaticLegacy.has(h.notes))&&h.notes?.trim())
  .sort((a,b)=>(a.work_date||'').localeCompare(b.work_date||'')||a.task_id-b.task_id||a.created.localeCompare(b.created)||a.id-b.id);
 for(const h of entries)row=recordRows(work,row,[h.work_date||'미기록',h.task_title,h.notes,h.actor_name,koreanTime(h.created),h.id,h.kind==='legacy'?'이전 기록':'수행 기록'],{5:'0'},[0,1,3,4,5,6]);
 if(!entries.length)row=metadata(work,row,'수행 기록','등록된 공정 수행 내역 없음');
 finish(work,workHeader,row-1);

 const changes=makeSheet(workbook,'일정 변경 내역',[24,23,23,40,13,23,9],project);
 row=metadata(changes,3,'프로젝트명',project.title);const changesHeader=row;row=tableHeader(changes,row,['공정명','변경 전 일정','변경 후 일정','변경 사유','변경자','변경일시 (한국 시간)','기록 ID']);
 const schedules=project.history.filter(h=>h.kind==='schedule').sort((a,b)=>a.created.localeCompare(b.created)||a.task_id-b.task_id||a.id-b.id);
 for(const h of schedules)row=recordRows(changes,row,[h.task_title,h.before_start+' ~ '+h.before_end,h.after_start+' ~ '+h.after_end,h.notes,h.actor_name,koreanTime(h.created),h.id],{6:'0'},[0,1,2,4,5,6]);
 if(!schedules.length)row=metadata(changes,row,'일정 변경','등록된 일정 변경 내역 없음');
 finish(changes,changesHeader,row-1);
 return workbook;
}
export function projectReportFilename(title,date){
 const safe=Array.from(String(title).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').trim().replace(/[. ]+$/g,'')).slice(0,80).join('')||'프로젝트';
 return '프로젝트보고서_'+safe+'_'+koreanTime(date).slice(0,10)+'.xlsx';
}
export async function projectExcelApi(db,path,method,user,send,res){
 if(method!=='GET')return send(405,{error:'GET 요청으로 엑셀 보고서를 다운로드하세요'});
 const id=Number(path.match(/\/projects\/(\d+)\/excel$/)?.[1]);
 if(!Number.isSafeInteger(id)||id<1)return send(400,{error:'프로젝트 번호를 확인하세요'});
 const project=projectReportData(db,id,user);if(!project)return send(404,{error:'프로젝트가 없거나 조회할 수 없습니다'});
 try{
  const generatedAt=new Date(),workbook=buildProjectWorkbook(project,generatedAt),buffer=await workbook.xlsx.writeBuffer();
  res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="project-report.xlsx"; filename*=UTF-8''${encodeURIComponent(projectReportFilename(project.title,generatedAt))}`,'Cache-Control':'no-store'});
  res.end(Buffer.from(buffer));
 }catch(error){console.error('Project Excel export failed:',error.message);return send(500,{error:'프로젝트 보고서 파일 생성에 실패했습니다. 잠시 후 다시 시도하세요.'});}
}
