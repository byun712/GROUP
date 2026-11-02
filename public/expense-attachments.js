let expenseAttachments=[],expenseAttachmentBusy=false;
let expensePreviewGeneration=0,expensePdf=null,expensePdfLoading=null,expenseRenderTask=null,expensePreviewAbort=null,expensePreviewUrl=null,expensePreviewPage=1;
let expensePdfModule,expensePageBusy=false,expensePageRequest=0;
const expenseFileSize=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
function setExpenseAttachments(files=[]){expenseAttachments=files.map(f=>({...f}));$('#expense-files').value='';renderExpenseAttachments();}
function setExpenseAttachmentBusy(busy){expenseAttachmentBusy=busy;$('#expense-files').disabled=busy;renderExpenseAttachments();}
function renderExpenseAttachments(){
 const list=$('#expense-attachment-list');list.replaceChildren();
 expenseAttachments.forEach((file,index)=>{
  const row=text('div','','expense-attachment-row'),preview=text('button',file.filename,'secondary');preview.type='button';preview.onclick=()=>openExpensePreview(file);
  const remove=text('button','제거','secondary');remove.type='button';remove.disabled=expenseAttachmentBusy;remove.setAttribute('aria-label',file.filename+' 제거');remove.onclick=()=>{expenseAttachments.splice(index,1);renderExpenseAttachments();};
  row.append(preview,text('small',expenseFileSize(file.size)+(file.id?' · 저장됨':' · 저장 예정')),remove);list.append(row);
 });
 $('#expense-attachment-summary').textContent=expenseAttachments.length?`${expenseAttachments.length}개 · ${expenseFileSize(expenseAttachments.reduce((n,f)=>n+f.size,0))} · 상신 또는 수정 저장 시 함께 저장됩니다.`:'첨부파일이 없습니다.';
}
$('#expense-files').addEventListener('change',event=>{
 const selected=[...event.target.files];event.target.value='';
 try{
  if(expenseAttachments.length+selected.length>10)throw Error('첨부파일은 최대 10개까지 선택하세요');
  for(const file of selected){if(!/\.(pdf|png|jpe?g)$/i.test(file.name))throw Error('PDF·PNG·JPG 파일을 선택하세요');if(!file.size||file.size>10*1048576)throw Error('파일은 개당 10MB 이하여야 합니다');}
  if(expenseAttachments.reduce((n,f)=>n+f.size,0)+selected.reduce((n,f)=>n+f.size,0)>20*1048576)throw Error('첨부파일 합계는 20MB 이하여야 합니다');
  expenseAttachments.push(...selected.map(file=>({filename:file.name,size:file.size,content_type:/\.pdf$/i.test(file.name)?'application/pdf':/\.png$/i.test(file.name)?'image/png':'image/jpeg',file})));
  $('#expense-attachment-error').textContent='';renderExpenseAttachments();
 }catch(error){$('#expense-attachment-error').textContent=error.message;}
});
const expenseBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('첨부파일을 읽을 수 없습니다'));reader.readAsDataURL(file);});
async function expenseAttachmentPayload(){return Promise.all(expenseAttachments.map(async f=>f.id?{id:f.id}:{filename:f.filename,base64:await expenseBase64(f.file)}));}
async function copyExpenseAttachments(files){
 const copies=[];
 for(const source of files){
  const response=await fetch(source.url);
  if(!response.ok)throw Error('첨부파일을 복사하지 못했습니다. 문서를 다시 조회한 후 복사하세요.');
  const blob=await response.blob();
  if(blob.size!==source.size)throw Error('첨부파일을 모두 불러오지 못했습니다. 다시 복사하세요.');
  const file=new File([blob],source.filename,{type:source.content_type});
  copies.push({filename:file.name,size:file.size,content_type:file.type,file});
 }
 return copies;
}
function appendExpenseAttachments(container,files=[]){
 const section=text('section','','expense-evidence');section.append(text('h3','증빙 첨부파일'));
 if(!files.length)section.append(text('small','첨부파일이 없습니다.'));
 for(const file of files){const row=text('div','','expense-attachment-row'),preview=text('button',file.filename+' · 미리보기','secondary');preview.type='button';preview.onclick=()=>openExpensePreview(file);const download=text('a','다운로드','button-link');download.href=file.url;download.download=file.filename;row.append(preview,text('small',expenseFileSize(file.size)),download);section.append(row);}
 container.append(section);
}
function clearExpensePreview(){
 expensePreviewGeneration++;expensePageRequest++;expensePageBusy=false;expensePreviewAbort?.abort();expensePreviewAbort=null;expenseRenderTask?.cancel();expenseRenderTask=null;
 expensePdfLoading?.destroy().catch(()=>{});expensePdfLoading=null;expensePdf=null;
 if(expensePreviewUrl)URL.revokeObjectURL(expensePreviewUrl);expensePreviewUrl=null;
 $('#expense-preview-image').removeAttribute('src');const canvas=$('#expense-preview-canvas');canvas.width=canvas.height=1;
 $('#expense-preview-download').removeAttribute('href');
}
function updateExpensePreviewControls(){const busy=expensePageBusy||!!expenseRenderTask||!expensePdf;$('#expense-preview-prev').disabled=busy||expensePreviewPage<=1;$('#expense-preview-next').disabled=busy||expensePreviewPage>=expensePdf.numPages;$('#expense-preview-page').disabled=busy;$('#expense-preview-zoom').disabled=busy;$('#expense-preview-page').value=String(expensePreviewPage);$('#expense-preview-total').textContent=expensePdf?`/ ${expensePdf.numPages}쪽`:'';if(expensePdf)$('#expense-preview-page').max=String(expensePdf.numPages);}
async function renderExpensePdfPage(){
 if(!expensePdf)return;const generation=expensePreviewGeneration,request=++expensePageRequest;expensePageBusy=true;updateExpensePreviewControls();
 try{
  const previous=expenseRenderTask;previous?.cancel();if(previous)await previous.promise.catch(()=>{});if(generation!==expensePreviewGeneration||request!==expensePageRequest)return;const page=await expensePdf.getPage(expensePreviewPage);if(generation!==expensePreviewGeneration||request!==expensePageRequest)return;
  const base=page.getViewport({scale:1}),container=$('#expense-preview-content'),zoom=Number($('#expense-preview-zoom').value);
  const width=Math.max(200,container.clientWidth-28)*zoom,scale=width/base.width,ratio=Math.min(window.devicePixelRatio||1,2),pixelScale=Math.min(scale*ratio,4096/base.width,8192/base.height,Math.sqrt(16000000/(base.width*base.height)));
  const viewport=page.getViewport({scale:pixelScale}),canvas=$('#expense-preview-canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=Math.round(base.width*scale)+'px';canvas.style.height=Math.round(base.height*scale)+'px';
  canvas.hidden=false;$('#expense-preview-image').hidden=true;$('#expense-preview-error').textContent='페이지를 불러오는 중…';
  const task=page.render({canvasContext:canvas.getContext('2d'),viewport});expenseRenderTask=task;updateExpensePreviewControls();await task.promise;
  if(generation!==expensePreviewGeneration||request!==expensePageRequest||expenseRenderTask!==task)return;expenseRenderTask=null;expensePageBusy=false;$('#expense-preview-error').textContent='';$('#expense-preview-content').scrollTop=0;updateExpensePreviewControls();
 }catch(error){if(generation===expensePreviewGeneration&&request===expensePageRequest&&error.name!=='RenderingCancelledException'){expenseRenderTask=null;expensePageBusy=false;$('#expense-preview-error').textContent='PDF 페이지를 표시하지 못했습니다. 다운로드하여 확인하세요.';updateExpensePreviewControls();}}
}
async function openExpensePreview(file){
 clearExpensePreview();const generation=expensePreviewGeneration,dialog=$('#expense-preview-dialog');
 $('#expense-preview-title').textContent=file.filename;$('#expense-preview-error').textContent='파일을 불러오는 중…';$('#expense-preview-canvas').hidden=true;$('#expense-preview-image').hidden=true;$('#expense-preview-tools').hidden=file.content_type!=='application/pdf';$('#expense-preview-zoom').value='1';expensePreviewPage=1;updateExpensePreviewControls();
 if(!dialog.open)dialog.showModal();
 try{
  let blob=file.file;
  if(!blob){expensePreviewAbort=new AbortController();const response=await fetch(file.url,{signal:expensePreviewAbort.signal});if(!response.ok){const error=await response.json();throw Error(error.error||'첨부파일을 불러오지 못했습니다');}blob=await response.blob();}
  if(generation!==expensePreviewGeneration)return;expensePreviewUrl=URL.createObjectURL(blob);$('#expense-preview-download').href=expensePreviewUrl;$('#expense-preview-download').download=file.filename;
  if(file.content_type==='application/pdf'){
   expensePdfModule??=import('/vendor/pdfjs/pdf.mjs').catch(error=>{expensePdfModule=null;throw error;});const pdfjs=await expensePdfModule;if(generation!==expensePreviewGeneration)return;
   pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';const bytes=new Uint8Array(await blob.arrayBuffer());if(generation!==expensePreviewGeneration)return;
   const task=pdfjs.getDocument({data:bytes,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false,enableXfa:false});expensePdfLoading=task;
   const pdf=await task.promise;if(generation!==expensePreviewGeneration)return;expensePdf=pdf;await renderExpensePdfPage();
  }else{const img=$('#expense-preview-image');img.onload=()=>{if(generation===expensePreviewGeneration)$('#expense-preview-error').textContent='';};img.onerror=()=>{if(generation===expensePreviewGeneration)$('#expense-preview-error').textContent='이미지를 표시하지 못했습니다. 다운로드하여 확인하세요.';};img.src=expensePreviewUrl;img.alt=file.filename;img.hidden=false;}
 }catch(error){if(generation===expensePreviewGeneration&&error.name!=='AbortError')$('#expense-preview-error').textContent=error.name==='PasswordException'?'암호가 설정된 PDF입니다. 다운로드한 뒤 암호를 입력해 확인하세요.':(error.message?.includes('문서')||error.message?.includes('첨부파일')?error.message:'미리보기를 표시하지 못했습니다. 다운로드하여 확인하세요.');}
}
$('#expense-preview-dialog').addEventListener('close',clearExpensePreview);
$('#expense-preview-prev').onclick=()=>{expensePreviewPage--;renderExpensePdfPage();};$('#expense-preview-next').onclick=()=>{expensePreviewPage++;renderExpensePdfPage();};
$('#expense-preview-page').onchange=event=>{expensePreviewPage=Math.max(1,Math.min(expensePdf?.numPages||1,Math.trunc(Number(event.target.value))||1));renderExpensePdfPage();};$('#expense-preview-zoom').onchange=renderExpensePdfPage;
let expenseResizeTimer;window.addEventListener('resize',()=>{clearTimeout(expenseResizeTimer);if($('#expense-preview-dialog').open&&expensePdf)expenseResizeTimer=setTimeout(renderExpensePdfPage,180);});
$('#expense-form').addEventListener('reset',()=>{setExpenseAttachments();$('#expense-attachment-error').textContent='';});
renderExpenseAttachments();
