import ExcelJS from 'exceljs';
import {imageSize} from 'image-size';
import {decisionHistory} from './signatures.js';

// A static Windows font avoids variable-font spacing differences in Excel's PDF renderer.
// The web application continues to use Noto Sans KR.
const FONT='Malgun Gothic',SIZE=11,LINE_HEIGHT=20;
const PURPLE='FF82358E',LIGHT='FFF7EFF9',BORDER='FFD6C7DD',INK='FF202020';
const koreanDate=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'';
const statusNames={manager:'이사 승인 대기',ceo:'대표이사 승인 대기',approved:'승인 완료',rejected:'반려',withdrawn:'회수'};
const actionNames={approve:'승인',reject:'반려',withdraw:'회수',edit:'내용 수정',resubmit:'재상신'};
const graphemes=new Intl.Segmenter('ko',{granularity:'grapheme'});
const font=(size=SIZE,bold=false,color=INK)=>({name:FONT,size,bold,color:{argb:color},charset:129,family:2});
const normalized=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');

// Conservative advance widths in ems. Never cut a surrogate pair, combining mark or emoji.
// The margin is deliberate: Excel versions and printer drivers have different font metrics.
function advance(character){
 if(/^[\u0020\u00a0]$/.test(character))return .36;
 if(/^[ilI.,:;'!|]$/.test(character))return .36;
 if(/^[mwMW@%&]$/.test(character))return 1;
 if(/^[A-Z]$/.test(character))return .8;
 if(/^[a-z0-9]$/.test(character))return .66;
 if(/^[\x21-\x7e]$/.test(character))return .6;
 return 1.1;
}
function widthOf(value,size=SIZE){return [...graphemes.segment(String(value))].reduce((sum,g)=>sum+advance(g.segment)*size,0);}
function colPoints(sheet,col){return Math.floor((sheet.getColumn(col).width||11.5)*7+5)*.75;}
function contentWidth(sheet,start,end){let width=0;for(let col=start;col<=end;col++)width+=colPoints(sheet,col);return Math.max(20,(width-10)*.96);}
function wrap(value,width,size=SIZE){
 const result=[];
 for(const paragraph of normalized(value).split('\n')){
  const characters=[...graphemes.segment(paragraph)].map(g=>g.segment);
  if(!characters.length){result.push('');continue;}
  let offset=0;
  while(offset<characters.length){
   let end=offset,used=0,space=-1;
   while(end<characters.length){const next=advance(characters[end])*size;if(end>offset&&used+next>width)break;used+=next;if(characters[end]===' ')space=end+1;end++;}
   // Prefer a word boundary for mixed English/Korean prose, retaining every character.
   if(end<characters.length&&space>offset&&space-offset>=(end-offset)*.5)end=space;
   result.push(characters.slice(offset,end).join(''));offset=end;
  }
 }
 return result;
}
function box(sheet,row,start,end,value,{header=false,size=SIZE,align=header?'center':'left',top=true,bottom=true,color=INK}={}){
 if(end>start)sheet.mergeCellsWithoutStyle(row,start,row,end);
 const cell=sheet.getCell(row,start);cell.value=value;cell.font=font(size,header,header?PURPLE:color);
 cell.alignment={vertical:'middle',horizontal:align,wrapText:true,shrinkToFit:false,readingOrder:'ltr'};
 const edge={style:'thin',color:{argb:BORDER}};
 for(let col=start;col<=end;col++){
  const c=sheet.getCell(row,col);c.border={...(top?{top:edge}:{}),...(bottom?{bottom:edge}:{}),...(col===start?{left:edge}:{}),...(col===end?{right:edge}:{})};
  if(header)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:LIGHT}};
 }
 return cell;
}
function makeSheet(workbook,name,expense=false){
 const sheet=workbook.addWorksheet(name,{properties:{defaultRowHeight:LINE_HEIGHT},pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,verticalCentered:false,blackAndWhite:false,showGridLines:false,showRowColHeaders:false,margins:{left:.5,right:.5,top:.5,bottom:.5,header:.2,footer:.2}}});
 sheet.columns=(expense?[8,8,8,8,19,19,11,11]:Array(8).fill(11.5)).map(width=>({width}));
 sheet.views=[{showGridLines:false,zoomScale:100}];
 sheet.headerFooter.oddFooter='&L&"Malgun Gothic,Regular"&8ELSOLTEC&R&"Malgun Gothic,Regular"&8&P / &N';
 return sheet;
}
function title(sheet,value){
 sheet.mergeCells('A1:H2');const cell=sheet.getCell('A1');cell.value=value;cell.font=font(18,true,PURPLE);cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};sheet.getRow(1).height=28;sheet.getRow(2).height=12;sheet.pageSetup.printTitlesRow='1:2';
}
function addSeal(workbook,sheet,db,source,h,col){
 if(!h?.has_signature)return;
 const seal=db.prepare('SELECT image,content_type FROM decision_signatures WHERE source=? AND decision_id=?').get(source==='reports'?'approvals':source,h.id);
 if(!seal?.image)return;
 const buffer=Buffer.from(seal.image),size=imageSize(buffer),width=colPoints(sheet,col),height=[5,6,7].reduce((n,r)=>n+sheet.getRow(r).height,0);
 const scale=Math.min((width-12)*4/3/size.width,(height-12)*4/3/size.height);
 const w=size.width*scale,hpx=size.height*scale;
 let offset=(height-hpx*.75)/2,r=5;while(offset>=sheet.getRow(r).height&&r<7){offset-=sheet.getRow(r).height;r++;}
 const imageId=workbook.addImage({buffer,extension:seal.content_type==='image/png'?'png':'jpeg'});
 sheet.addImage(imageId,{tl:{col:col-1+(width-w*.75)/2/width,row:r-1+offset/sheet.getRow(r).height},ext:{width:w,height:hpx},editAs:'oneCell'});
}
function fieldRows(template,document){
 if(template.id==='leave')return [['휴가 구분',document.kind||''],['시작일',document.start||''],['종료일',document.end||''],['신청 사유',document.reason||'','textarea']];
 if(['expense','research_expense'].includes(template.id))return [...(template.id==='research_expense'?[['연구과제',document.project_name||''],['과제 번호',document.project_code||'']]:[]),['지출일',document.expense_date||''],['거래처',document.vendor||''],['결제수단',document.payment||''],['증빙 종류',document.evidence_type||''],['증빙 번호',document.evidence_ref||''],['비고',document.notes||'','textarea']];
 return template.fields.map(f=>[f.label,document.fields?.[f.key]??'',f.type]);
}

export async function buildFormWorkbook(db,template,document,{saved=false,source='',user}={}){
 const workbook=new ExcelJS.Workbook();workbook.creator='ELSOLTEC';workbook.created=new Date();
 const expense=['expense','research_expense'].includes(template.id),sheet=makeSheet(workbook,'양식',expense);title(sheet,template.name);
 const history=saved?decisionHistory(db,source,document.id):[];
 const submitted=history.findLast(h=>h.approval_round===document.approval_round&&h.action==='resubmit')?.created||document.created;
 const meta=[['문서번호',saved?(source==='leaves'?'LV-':source==='expenses'?'EX-':source==='reports'?'WR-':'AP-')+String(document.id).padStart(5,'0'):'작성 중 양식'],['제목',document.title||''],['작성자',saved?document.name:user.name],['상신일',saved?koreanDate(submitted):''],['상태',saved?statusNames[document.status]:'작성 중 (미상신)']];
 for(let i=0;i<meta.length;i++){
  const row=i+3,lines=wrap(meta[i][1],contentWidth(sheet,3,5));
  box(sheet,row,1,2,meta[i][0],{header:true});box(sheet,row,3,5,lines.join('\n'));
  sheet.getRow(row).height=Math.max(26,lines.length*LINE_HEIGHT+4);
 }
 // Dates use two explicit lines inside narrow approval columns, without shrinking the page.
 sheet.getRow(4).height=Math.max(sheet.getRow(4).height,32);
 for(let index=0;index<3;index++){
  const col=6+index,label=['작성자','이사','대표이사'][index];
  const h=index?history.findLast(h=>h.approval_round===document.approval_round&&h.stage===(index===1?'manager':'ceo')&&['approve','reject'].includes(h.action)):null;
  box(sheet,3,col,col,label,{header:true,size:10});
  box(sheet,4,col,col,koreanDate(index?h?.created:saved?submitted:null).replace(' ','\n'),{size:8.5,align:'center'});
  const sealText=index?h?h.has_signature?'':h.action==='reject'?'반려\n서명 미등록':'서명 미등록':'결재 대기':'작성';
  for(let r=5;r<=7;r++)box(sheet,r,col,col,r===5?sealText:'',{size:9,align:'center',top:r===5,bottom:r===7});
  sheet.mergeCellsWithoutStyle(5,col,7,col);
  const name=index?h?h.name+(h.action==='reject'?' (반려)':''):label+' 결재':saved?document.name:user.name;
  const names=wrap(name,contentWidth(sheet,col,col),10);box(sheet,8,col,col,String(name??''),{size:10,align:'center'});
  sheet.getRow(8).height=Math.max(sheet.getRow(8).height||26,names.length*18+4);
  addSeal(workbook,sheet,db,source,h,col);
 }
 sheet.getRow(9).height=12;let row=10;
 const heading=label=>{box(sheet,row,1,8,label,{header:true});sheet.getRow(row++).height=25;};
 // One visual line per row lets Excel paginate between lines, not through a giant merged cell.
 const full=(label,value)=>{
  heading(label);const lines=wrap(value,contentWidth(sheet,1,8));
  lines.forEach((line,i)=>{box(sheet,row,1,8,line,{top:i===0,bottom:i===lines.length-1});sheet.getRow(row++).height=LINE_HEIGHT;});
 };
 if(template.layout==='daily'){
  box(sheet,row,1,2,'일자',{header:true});box(sheet,row,3,8,document.fields?.report_date||'');sheet.getRow(row++).height=26;
  box(sheet,row,1,4,'실시사항',{header:true});box(sheet,row,5,8,'예정사항',{header:true});sheet.getRow(row++).height=25;
  const left=wrap(document.fields?.completed_work||'',contentWidth(sheet,1,4)),right=wrap(document.fields?.planned_work||'',contentWidth(sheet,5,8));
  const count=Math.max(3,left.length,right.length);
  for(let i=0;i<count;i++){for(const [start,end,lines] of [[1,4,left],[5,8,right]])box(sheet,row,start,end,lines[i]||'',{top:i===0,bottom:i===count-1});sheet.getRow(row++).height=LINE_HEIGHT;}
  full('진행업무',document.fields?.ongoing_work||'');full('특이사항',document.fields?.notes||'');
 }else{
  for(const [label,value,type] of fieldRows(template,document)){
   if(type==='textarea'||String(value).length>150||/[\r\n]/.test(String(value)))full(label,value);
   else{
    const lines=wrap(value,contentWidth(sheet,3,8));box(sheet,row,1,2,label,{header:true});
    const cell=box(sheet,row,3,8,typeof value==='number'?value:lines.join('\n'));
    if(type==='money'&&typeof value==='number')cell.numFmt='#,##0" 원"';
    sheet.getRow(row++).height=Math.max(26,lines.length*LINE_HEIGHT+4);
   }
  }
  if(expense){
   for(const [start,end,label] of [[1,1,'비용 구분'],[2,4,'항목 내용'],[5,5,'공급가액'],[6,6,'부가세'],[7,8,'합계']])box(sheet,row,start,end,label,{header:true,size:10});sheet.getRow(row++).height=28;
   let total=0;
   for(const item of document.items||[]){
    const category=wrap(item.category,contentWidth(sheet,1,1),10),description=wrap(item.description,contentWidth(sheet,2,4)),count=Math.max(category.length,description.length);
    for(let i=0;i<count;i++){
     box(sheet,row,1,1,category[i]||'',{size:10,top:i===0,bottom:i===count-1});box(sheet,row,2,4,description[i]||'',{top:i===0,bottom:i===count-1});
     for(const [start,end,amount] of [[5,5,item.supply],[6,6,item.tax],[7,8,Number(item.supply||0)+Number(item.tax||0)]]){
      const value=Number.isSafeInteger(amount)?amount:0,formatted=new Intl.NumberFormat('en-US').format(value),size=Math.min(11,Math.floor(contentWidth(sheet,start,end)/widthOf(formatted,1)*4)/4);
      const cell=box(sheet,row,start,end,i===0?value:'',{size,align:'right',top:i===0,bottom:i===count-1});cell.numFmt='#,##0';
     }
     sheet.getRow(row++).height=LINE_HEIGHT;
    }
    if(item.vendor||item.vendor_info){const details=wrap('거래처: '+(item.vendor||document.vendor||'—')+(item.vendor_info?' · '+item.vendor_info:''),contentWidth(sheet,1,8),10);for(const line of details){box(sheet,row,1,8,line,{size:10});sheet.getRow(row++).height=LINE_HEIGHT;}}
    total+=Number(item.supply||0)+Number(item.tax||0);
   }
   box(sheet,row,1,4,'합계 (원)',{header:true});const totalCell=box(sheet,row,5,8,total,{align:'right'});totalCell.numFmt='#,##0';sheet.getRow(row++).height=28;
  }
 }
 if(expense&&document.attachments?.length)full('첨부파일 목록',document.attachments.map(f=>f.filename+' ('+Math.ceil(f.size/1024)+' KB)').join('\n'));
 sheet.pageSetup.printArea=`A1:H${row-1}`;
 // Keep the printable form compact. The full audit trail stays available in its own sheet.
 if(saved&&history.length){
  const audit=makeSheet(workbook,'결재 이력');title(audit,template.name+' · 결재 이력');let r=3;
  for(const h of history){
   const stage=h.stage==='manager'?'이사':h.stage==='ceo'?'대표이사':'작성자';
   const lines=wrap(`${h.approval_round}차 · ${stage} · ${h.name} · ${actionNames[h.action]||h.action} · ${koreanDate(h.created)}`,contentWidth(audit,1,8));
   for(const line of lines){box(audit,r,1,8,line);audit.getRow(r++).height=LINE_HEIGHT;}
  }
  audit.pageSetup.printArea=`A1:H${r-1}`;
 }
 workbook.views=[{activeTab:0,firstSheet:0}];
 return workbook;
}

// Shared conservative text metrics for other printable Excel reports.
export {wrap as wrapPrintText, contentWidth as printContentWidth};
