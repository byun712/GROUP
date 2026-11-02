/* Shared form behavior: natural textarea height, native XLSX downloads and signed approval cells. */
function growFormFields(){for(const input of document.querySelectorAll('textarea')){if(!input.getClientRects().length)continue;const style=getComputedStyle(input);if(!input.dataset.autoMin)input.dataset.autoMin=String(Math.max(parseFloat(style.minHeight)||0,input.getBoundingClientRect().height));input.style.height='auto';input.style.height=Math.ceil(Math.max(Number(input.dataset.autoMin),input.scrollHeight+(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.borderBottomWidth)||0)))+'px';}}
let growQueued=false;function queueGrow(){if(growQueued)return;growQueued=true;requestAnimationFrame(()=>{growQueued=false;growFormFields();});}document.addEventListener('input',e=>{if(e.target instanceof HTMLTextAreaElement)growFormFields();});document.addEventListener('reset',queueGrow,true);window.addEventListener('resize',queueGrow);document.fonts?.ready.then(queueGrow);document.fonts?.addEventListener('loadingdone',queueGrow);new MutationObserver(queueGrow).observe(document.body,{childList:true,subtree:true});queueGrow();
function shortSignDate(value){if(!value)return '—';const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).reduce((a,p)=>(a[p.type]=p.value,a),{});return `${p.month}/${p.day} ${p.hour}:${p.minute}`;}
function renderSignedFlow(row,source,ownerLabel){const submitted=(row.history||[]).findLast(h=>h.approval_round===row.approval_round&&h.action==='resubmit')?.created||row.created;const flow=text('div','','approval-flow signed-flow');for(const [index,label] of [ownerLabel,'이사','대표이사'].entries()){const stage=index===1?'manager':'ceo',history=index?(row.history||[]).findLast(h=>h.approval_round===row.approval_round&&h.stage===stage&&['approve','reject'].includes(h.action)):null,done=index===0||!!history,current=index>0&&row.status===stage,cell=text('div','','approval-step'+(done?' done':current?' current':'')+(history?.action==='reject'?' rejected':''));cell.append(text('strong',label));const date=text('time',index?history?shortSignDate(history.created):'—':shortSignDate(submitted),'approval-sign-date');if(index?history?.created:submitted){date.dateTime=index?history.created:submitted;date.title=time(date.dateTime);}cell.append(date);const imageBox=text('div','','approval-sign-image');if(history?.signature_url){const image=document.createElement('img');image.src=history.signature_url;image.alt=label+' '+history.name+' 서명·도장';imageBox.append(image);}else imageBox.append(text('small',index?history?'서명 미등록':current?'결재 대기':'—':'작성'));cell.append(imageBox,text('small',index?history?history.name+(history.action==='reject'?' · 반려':''):current?'승인 대기':'—':row.name));flow.append(cell);}return flow;}
async function downloadWorkbook(path,body,fallback='ELSOLTEC-양식.xlsx'){const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});if(!response.ok){let message='엑셀 다운로드에 실패했습니다';try{message=(await response.json()).error||message;}catch{}throw Error(message);}const disposition=response.headers.get('content-disposition')||'',encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i),name=encoded?decodeURIComponent(encoded[1]):fallback,url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function appendExcelDownload(container,source,row){const button=text('button','엑셀 다운로드','secondary document-excel');button.type='button';button.onclick=()=>run(async()=>{button.disabled=true;try{await downloadWorkbook(`${source}/${row.id}/excel`);}finally{button.disabled=false;}});container.append(button);}
$('#draft-excel').onclick=()=>run(async()=>{if(!selectedTemplate)throw Error('기안 양식을 먼저 선택하세요');const fields={};for(const f of selectedTemplate.fields){const value=$('#draft-form [name='+f.key+']').value;fields[f.key]=f.type==='money'&&value!==''?Number(value):value;}await downloadWorkbook('forms/export',{template_id:selectedTemplate.id,title:$('#draft-form [name=title]').value,fields});});
$('#leave-excel').onclick=()=>run(()=>downloadWorkbook('forms/export',{template_id:'leave',...Object.fromEntries(new FormData($('#leave-form')))}));
$('#expense-excel').onclick=()=>run(async()=>{const values=Object.fromEntries(new FormData($('#expense-form'))),items=[...document.querySelectorAll('.expense-line')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,['supply','tax'].includes(input.dataset.field)?Number(input.value):input.value])));await downloadWorkbook('forms/export',{...values,template_id:'expense',items});});
$('#report-excel').onclick=()=>run(async()=>{if(!reportEditingTemplate)throw Error('업무보고 양식을 먼저 선택하세요');const fields={};for(const f of reportEditingTemplate.fields){const value=$('#report-form [name='+f.key+']').value;fields[f.key]=f.type==='money'&&value!==''?Number(value):value;}await downloadWorkbook('forms/export',{template_id:reportEditingTemplate.id,title:$('#report-form [name=title]').value,fields});});
async function loadSealSettings(){if(!['manager','ceo'].includes(me?.user.role))return;const seal=await api('seal');$('#seal-preview').hidden=!seal.has_image;$('#seal-remove').hidden=!seal.has_image;$('#seal-state').textContent=seal.has_image?`${seal.width} × ${seal.height}px · 등록일 ${time(seal.updated)}`:'아직 등록한 이미지가 없습니다.';if(seal.has_image)$('#seal-preview').src='/api/seal/image?v='+encodeURIComponent(seal.updated);else $('#seal-preview').removeAttribute('src');}
const sealBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('이미지를 읽을 수 없습니다'));reader.readAsDataURL(file);});
$('#seal-form').onsubmit=e=>{e.preventDefault();run(async()=>{const file=$('#seal-file').files[0];if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>524288)throw Error('512KB 이하의 PNG/JPG 이미지를 선택하세요');$('#seal-save').disabled=true;try{await api('seal',{content_type:file.type,base64:await sealBase64(file)});$('#seal-form').reset();await loadSealSettings();notice('본인의 서명·도장 이미지를 등록했습니다.');}finally{$('#seal-save').disabled=false;}});};
$('#seal-remove').onclick=()=>run(async()=>{await api('seal/delete',{});await loadSealSettings();notice('등록 이미지를 삭제했습니다. 기존 결재 문서의 이미지는 유지됩니다.');});
document.addEventListener('workspace-page',e=>{if(e.detail==='sealSettings')run(loadSealSettings);queueGrow();});document.addEventListener('groupware-ready',()=>{for(const e of document.querySelectorAll('.approver-only'))e.hidden=!['manager','ceo'].includes(me?.user.role);queueGrow();});

function appendDirectorRejection(container,source,row){if(!row.can_reject_after_approval)return;const button=text('button','승인 후 반려','danger');button.type='button';button.onclick=()=>bmodal('이사 승인 후 반려',form=>{form.append(text('p','내가 승인한 문서를 반려로 변경합니다. 현재 상신 회차에서 대표이사가 처리하기 전까지만 가능합니다.'));bfield(form,'confirm','승인 후 반려 확인',{type:'checkbox',required:true});},()=>api(`${source}/${row.id}/action`,{action:'reject',expected_version:row.version}),async()=>{await refresh();showWorkflowDocument(source,row.id);notice('이사 승인을 반려로 변경했습니다.');});container.append(button);}

const documentEdits={};
const workflowForms={leaves:'leave',expenses:'expense',approvals:'draft',reports:'report'};
function showWorkflowDocument(source,id){({leaves:showDocument,expenses:showExpense,approvals:showDraft,reports:showReport})[source](id);}
function workflowSubmit(source){return $('#'+workflowForms[source]+'-form').querySelector('button:not([type=button])');}
function clearDocumentEdit(source,reset=false){
 delete documentEdits[source];
 const form=$('#'+workflowForms[source]+'-form');
 form.querySelector('.document-edit-notice')?.remove();
 const button=workflowSubmit(source);button.textContent=source==='expenses'?'지출결의서 상신':'결재 상신';button.disabled=false;
 if(reset){form.reset();if(source==='expenses'){$('#expense-form-type').querySelector('[value=research_expense]')?.remove();updateResearchFields();$('#expense-lines').replaceChildren();addExpenseLine();form.elements.expense_date.value=today();}}
}
function editWorkflowDocument(source,row){
 $('#document-dialog').close();
 if(source==='reports')selectReportTemplate(row.template_id);
 else selectTemplate(source==='leaves'?'leave':source==='expenses'?'expense':row.template_id);
 const form=$('#'+workflowForms[source]+'-form');documentEdits[source]={...row};
 if(source==='expenses'&&row.form_type==='research_expense'){$('#expense-form-type').append(new Option('지출결의서(연구개발비·기존)','research_expense'));}
 const values=['approvals','reports'].includes(source)?{title:row.title,...row.fields}:row;
 for(const [key,value] of Object.entries(values)){const input=form.elements.namedItem(key);if(input instanceof HTMLElement&&'value' in input)input.value=value??'';}
 if(source==='expenses'){
  updateResearchFields();$('#expense-lines').replaceChildren();
  for(const item of row.items){addExpenseLine();const line=$('#expense-lines').lastElementChild;for(const input of line.querySelectorAll('[data-field]'))input.value=item[input.dataset.field];}updateExpenseTotal();
 }
 const banner=text('div','','document-edit-notice');banner.setAttribute('role','status');banner.append(text('strong',`기존 문서 수정 · ${row.approval_round}차 · ${statuses[row.status]}`),text('p',row.status==='manager'?'저장하면 결재 대기 중인 문서 내용이 변경됩니다.':'저장 후 문서 상세에서 재상신하면 이사 결재부터 다시 진행합니다.'));
 const cancel=text('button','수정 취소','secondary');cancel.type='button';cancel.onclick=()=>{clearDocumentEdit(source,true);openPage(source==='reports'?'reports':'approval');showWorkflowDocument(source,row.id);};banner.append(cancel);form.prepend(banner);workflowSubmit(source).textContent='수정 저장';
 form.scrollIntoView({block:'start'});form.querySelector('input:not([disabled]),textarea,select')?.focus({preventScroll:true});queueGrow();if(source==='leaves')run(updateLeaveForm);
}
async function saveDocumentEdit(source,body){
 const row=documentEdits[source];if(!row)return false;
 const button=workflowSubmit(source);button.disabled=true;
 try{await api(`${source}/${row.id}/update`,{...body,expected_version:row.version});clearDocumentEdit(source,true);await refresh();openPage(source==='reports'?'reports':'approval');showWorkflowDocument(source,row.id);notice('문서를 수정했습니다.'+(row.status==='manager'?'':' 확인 후 재상신할 수 있습니다.'));return true;}finally{button.disabled=false;}
}
function appendDocumentWorkflow(container,source,row){
 if(row.can_edit){const edit=text('button','문서 수정','secondary document-edit');edit.type='button';edit.onclick=()=>editWorkflowDocument(source,row);container.append(edit);}
 for(const [allowed,label,operation,body,description] of [
  [row.can_resubmit,'재상신','resubmit',{},'저장된 내용으로 이사 결재부터 다시 진행합니다. 이전 결재 이력은 보존됩니다.'],
  [row.can_reapprove,'반려 후 다시 승인','action',{action:'approve'},'현재 문서 내용을 확인하고 다시 승인합니다. 승인 후 대표이사 결재 대기로 이동합니다.']
 ]){if(!allowed)continue;const button=text('button',label);button.type='button';button.onclick=()=>bmodal(label,form=>{form.append(text('p',description));bfield(form,'confirm',label+' 확인',{type:'checkbox',required:true});},()=>api(`${source}/${row.id}/${operation}`,{...body,expected_version:row.version}),async()=>{await refresh();showWorkflowDocument(source,row.id);notice(label+' 처리를 완료했습니다.');});container.append(button);}
}
