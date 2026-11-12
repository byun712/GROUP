import ExcelJS from 'exceljs';
import {accountBalances,canReadAccounting} from './accounting.js';
import {wrapPrintText,printContentWidth} from './excel-print-layout.js';

const koreaTime=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date);
export function buildAccountWorkbook(accounts,generatedAt=new Date()){
 const workbook=new ExcelJS.Workbook();workbook.creator='ELSOLTEC';workbook.created=generatedAt;
 const sheet=workbook.addWorksheet('계정별 합계',{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.4,right:.4,top:.5,bottom:.5,header:.2,footer:.2}}});
 sheet.columns=[{width:14},{width:38},{width:23},{width:23}];
 for(const [row,value] of [[1,'계정별 합계'],[2,'집계 기준: 전체 장부 · 전표 월 및 목록 페이지와 무관 · 단위: 원'],[3,'생성일시 (한국 시간): '+koreaTime(generatedAt)]]){
  sheet.mergeCells(row,1,row,4);const cell=sheet.getCell(row,1);cell.value=value;cell.font={name:'Malgun Gothic',size:row===1?20:11,bold:row===1};cell.alignment={vertical:'middle',wrapText:true};sheet.getRow(row).height=row===1?36:30;
 }
 sheet.getRow(5).values=['계정코드','계정명','차변 합계','대변 합계'];sheet.getRow(5).height=28;
 for(const a of accounts)sheet.addRow([a.code,a.name,a.debit,a.credit]);
 for(let r=5;r<=sheet.rowCount;r++){
  const row=sheet.getRow(r);let lines=1;
  row.eachCell((cell,c)=>{cell.font={name:'Malgun Gothic',size:11,bold:r===5};cell.alignment={vertical:'top',horizontal:c>=3?'right':'left',wrapText:true};cell.border={bottom:{style:'hair',color:{argb:'FFDCE4ED'}}};
   if(r===5)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEDF3F8'}};
   if(r>5&&c>=3)cell.numFmt='#,##0;[Red]-#,##0;0';
   lines=Math.max(lines,wrapPrintText(String(cell.value),printContentWidth(sheet,c,c),11).length);
  });row.height=Math.max(26,lines*17+8);
 }
 sheet.views=[{state:'frozen',ySplit:5,topLeftCell:'A6'}];sheet.autoFilter=`A5:D${Math.max(5,sheet.rowCount)}`;
 sheet.pageSetup.printTitlesRow='5:5';sheet.pageSetup.printArea=`A1:D${sheet.rowCount}`;sheet.headerFooter.oddFooter='&L단위: 원&R&P / &N';
 return workbook;
}
export async function accountingExcelApi(db,method,user,send,res){
 if(!canReadAccounting(user))return send(403,{error:'결재 역할이 이사·대표이사인 사용자만 회계 메뉴를 사용할 수 있습니다'});
 if(method!=='GET')return send(405,{error:'GET 요청으로 엑셀을 다운로드하세요'});
 // Same unfiltered query as /api/accounting; pagination/month apply only to journal display.
 const accounts=accountBalances(db),now=new Date();
 try{
  const buffer=await buildAccountWorkbook(accounts,now).xlsx.writeBuffer(),filename='계정별합계_전체장부_'+koreaTime(now).slice(0,10)+'.xlsx';
  res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="account-balances.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store'});res.end(Buffer.from(buffer));
 }catch(error){console.error('Account workbook export failed:',error.message);return send(500,{error:'계정별 합계 파일 생성에 실패했습니다. 잠시 후 다시 시도하세요.'});}
}
