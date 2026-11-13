/* Persistent business modules. Shares the authenticated shell in app.js. */
let businessCustomers=[],businessProjects=[],businessPeople=[],selectedProjectId=null,ledgerState=null,userState=[],userOptions={job_titles:[],organizations:[]};
const projectStates={planned:'계획',active:'진행',on_hold:'보류',completed:'완료'},taskStates={todo:'예정',doing:'진행',blocked:'보류',done:'완료'};
const roleNames={employee:'직원',manager:'이사',ceo:'대표이사'};
function monday(dateString=today()){const d=new Date(dateString+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
function bfield(form,name,label,options={}){const wrapper=text('label',label);let input;if(options.options){input=document.createElement('select');for(const [value,title] of options.options){const option=text('option',title);option.value=value;input.append(option);}}else if(options.type==='textarea'){input=document.createElement('textarea');input.maxLength=options.maxLength||3000;}else{input=document.createElement('input');input.type=options.type||'text';if(input.type==='text'||input.type==='password')input.maxLength=options.maxLength||200;if(input.type==='number'){input.min=options.min??'0';input.max=options.max??'1000000000000';input.step='1';}if(input.type==='file')input.accept='image/png,image/jpeg';if(input.type==='password'){input.minLength=12;input.autocomplete='new-password';}}input.name=name;input.required=options.required??false;if(input.type==='checkbox'){input.checked=!!options.value;wrapper.className='check-label';}else if(input.type!=='file')input.value=options.value??'';wrapper.append(input);form.append(wrapper);return input;}
function bmodal(title,build,save,after){$('#business-dialog-title').textContent=title;const body=$('#business-dialog-body');body.replaceChildren();const form=document.createElement('form'),error=text('p','','form-error');error.setAttribute('role','alert');form.append(error);build(form);const footer=text('div','','dialog-footer'),close=text('button','닫기','secondary');close.type='button';close.onclick=()=>$('#business-dialog').close();footer.append(close);if(save){const button=text('button','저장');footer.append(button);form.onsubmit=async e=>{e.preventDefault();button.disabled=true;error.textContent='';try{const result=await save(Object.fromEntries(new FormData(form)),form);$('#business-dialog').close();if(after)await after(result);}catch(e){error.textContent=e.message;}finally{button.disabled=false;}};}form.append(footer);body.append(form);if(!$('#business-dialog').open)$('#business-dialog').showModal();$('#business-dialog').scrollTop=0;}
function bcard(title,subtitle,onClick){const card=text('article','','work-card');const button=text('button',title,'work-card-title');button.onclick=onClick;card.append(button,text('p',subtitle));return card;}
function emptyCards(target,message){if(!target.childElementCount)target.append(text('p',message,'empty'));}
function initializeBusinessUI(){if(typeof me==='undefined'||!me)return;for(const e of document.querySelectorAll('.admin-only'))e.hidden=!me.user.is_admin;for(const e of document.querySelectorAll('.finance-only'))e.hidden=!['manager','ceo'].includes(me.user.role);$('#ledger-month').value=today().slice(0,7);$('#project-month').value=today().slice(0,7);let menu=$('#business-mega');if(!menu){menu=document.createElement('div');menu.id='business-mega';$('#menu-dialog .mega-menu').append(menu);}menu.replaceChildren(text('h3','업무 보드'));for(const [page,label] of [['projects','프로젝트'],['customers','고객사·명함'],['accounting','회계 관리'],['users','사용자 관리']]){if(page==='accounting'&&!['manager','ceo'].includes(me.user.role))continue;const button=text('button',label);button.onclick=()=>openPage(page);menu.append(button);}}
document.addEventListener('groupware-ready',initializeBusinessUI);if(typeof me!=='undefined'&&me)initializeBusinessUI();
document.addEventListener('workspace-page',event=>{const page=event.detail;if(page==='projects')run(loadProjects);else if(page==='customers')run(loadCustomers);else if(page==='accounting')run(loadAccounting);else if(page==='users')run(loadUsers);});

let projectLoadRequest=0,visibleProjectId=null;
function revealProjectCard(card){if(!card)return false;const list=$('#project-cards');if(!list.clientWidth)return false;const box=card.getBoundingClientRect(),view=list.getBoundingClientRect();if(box.left<view.left)list.scrollLeft+=box.left-view.left;else if(box.right>view.right)list.scrollLeft+=box.right-view.right;return true;}
window.addEventListener('resize',()=>revealProjectCard($('#project-cards .selected')));
$('#project-cards').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...$('#project-cards').querySelectorAll('.work-card-title')],index=buttons.indexOf(document.activeElement);if(!buttons.length)return;event.preventDefault();const next=buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)))];next.focus({preventScroll:true});revealProjectCard(next.closest('.work-card'));};
async function loadProjects(){const request=++projectLoadRequest,result=await Promise.all([api('projects'),api('customers'),api('people')]);if(request!==projectLoadRequest)return;[businessProjects,businessCustomers,businessPeople]=result;if(!businessProjects.some(p=>p.id===selectedProjectId)){const first=businessProjects[0];selectedProjectId=first?.id||null;if(first)$('#project-month').value=(today()>=first.start_date&&today()<=first.end_date?today():first.start_date).slice(0,7);}renderProjects();}
function projectProgressBar(value,label){const bar=document.createElement('progress');bar.className='project-progress-bar';bar.max=100;bar.value=value;bar.setAttribute('aria-label',label);return bar;}
// Reuse the existing arithmetic mean of server-calculated task progress everywhere.
function projectProgress(project){return project.progress;}
function taskColor(task){return `hsl(${(task.id*137.508%360).toFixed(3)} 58% 42%)`;}
function scrollProjectSummaryText(event){
 const target=event.currentTarget;if(target.scrollWidth<=target.clientWidth||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 event.preventDefault();target.scrollLeft=event.key==='Home'?0:event.key==='End'?target.scrollWidth:target.scrollLeft+(event.key==='ArrowRight'?60:-60);
}
function renderProjectOverview(){
 const target=$('#project-overview'),project=businessProjects.find(p=>p.id===selectedProjectId);
 if(!project){target.replaceChildren(text('p','프로젝트를 등록하면 진척률을 확인할 수 있습니다.','empty'));return;}
 const tasks=[...project.tasks].sort((a,b)=>a.id-b.id),total=tasks.length,progress=projectProgress(project),done=tasks.filter(t=>t.status==='done').length;
 const chart=text('div','','project-donut'),center=text('div','','project-donut-center');center.append(text('strong',progress+'%'),text('span','프로젝트 진척률'));chart.append(center);chart.setAttribute('role','img');chart.dataset.progress=progress;
 const segments=tasks.flatMap((task,i)=>{const start=i/total*100,end=(i+1)/total*100,filled=start+task.progress/total;return [`${taskColor(task)} ${start}% ${filled}%`,`#e8edf3 ${filled}% ${end}%`];});chart.style.background=total?'conic-gradient('+segments.join(',')+')':'#e8edf3';chart.style.setProperty('--segment-angle',(total?360/total:360)+'deg');
 chart.setAttribute('aria-label',`${project.title} · 진척률 ${progress}% (공정 ${done} / ${total})`);
 const summary=text('div','','project-summary-footer'),heading=text('div','','workboard-region-heading project-summary-heading'),swatch=text('span','','project-color-swatch'),title=text('h3',project.title);
 swatch.style.backgroundColor=project.color;title.tabIndex=0;title.title=project.title;title.onkeydown=scrollProjectSummaryText;
 heading.append(swatch,title,text('span',projectStates[project.status],'badge project-status-'+project.status));
 summary.tabIndex=0;summary.setAttribute('aria-label','프로젝트 기간과 진척률');summary.onkeydown=scrollProjectSummaryText;
 summary.append(text('span',project.start_date+' ~ '+project.end_date,'project-summary-dates'),text('span',' / ','project-summary-divider'),text('strong',`진척률 ${progress}% (공정 ${done} / ${total})`,'overview-caption'));
 const body=text('div','','project-summary-body');body.append(chart);target.replaceChildren(heading,body,summary);
}
let historyProject=null,historyNewest=null;
function renderProjectHistory(project){
 const history=$('#project-history'),scrollTop=history.scrollTop;history.replaceChildren();
 for(const task of [...(project?.tasks||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||b.id-a.id)){
  const meta=`담당자 ${task.assignee} · 참여자: ${(task.participants||[]).map(u=>u.name).join(', ')||'없음'} · ${task.completed_days}/${task.total_days}일 완료`;
  const row=bcard(task.title,meta,()=>showTaskHistory(task,project)),title=row.querySelector('.work-card-title'),heading=text('div','','task-summary-heading');title.title=task.title;
  heading.append(title,text('strong',`진척률 ${task.progress}%`,'task-progress-label'));row.prepend(heading);heading.after(text('p',task.start_date+' ~ '+task.end_date,'task-period'));row.querySelector('p:not(.task-period)').title=meta;row.dataset.taskHistory=task.id;row.append(projectProgressBar(task.progress,task.title+' 달성도'));history.append(row);
 }
 emptyCards(history,project?'등록된 공정이 없습니다.':'프로젝트를 선택해 주세요.');const newest=history.firstElementChild?.dataset.taskHistory;history.scrollTop=historyProject===project?.id&&historyNewest===newest?scrollTop:0;historyProject=project?.id;historyNewest=newest;
}
function renderTaskComparison(project){
 const target=$('#project-comparison'),same=target.dataset.projectId===String(project?.id||''),scroll=same?target.querySelector('.task-column-scroll')?.scrollLeft||0:0;
 target.dataset.projectId=project?.id||'';target.replaceChildren();$('#project-comparison-expand').disabled=!project;
 if(!project?.tasks.length)target.append(text('p',project?'등록된 공정이 없습니다.':'프로젝트를 선택해 주세요.','empty'));
 else {target.append(taskComparisonChart(project));target.querySelector('.task-column-scroll').scrollLeft=scroll;}
 if(typeof syncExpandedComparison==='function')syncExpandedComparison();
}
function taskComparisonChart(project,source=project.tasks){
 const tasks=[...source].sort((a,b)=>a.id-b.id);
 const chart=text('div','','task-column-chart'),axis=text('div','','task-column-axis'),scroll=text('div','','task-column-scroll'),series=text('div','','task-column-series');
 axis.setAttribute('aria-hidden','true');scroll.tabIndex=0;scroll.setAttribute('aria-label','공정 그래프 가로 스크롤 · 방향키로 공정 선택');
 for(const tick of [0,25,50,75,100]){const label=text('span',tick+'%');label.style.bottom=`calc(var(--comparison-plot-height,140px) * ${tick/100} - 8px)`;axis.append(label);}
 for(const task of tasks){
  const button=text('button','','task-column');button.type='button';button.dataset.comparisonTask=task.id;button.style.setProperty('--task-color',taskColor(task));button.style.setProperty('--task-progress',task.progress);
  button.title=task.title+' · '+task.progress+'%';button.setAttribute('aria-label',task.title+' · 진척률 '+task.progress+'% · 공정 상세 열기');
  const plot=text('span','','task-column-plot'),bar=text('span','','task-column-bar'),value=text('strong',task.progress+'%','task-column-value'),name=text('span',task.title,'task-column-name');
  bar.dataset.progress=task.progress;plot.append(bar,value);button.append(plot,name);button.onclick=()=>showTaskHistory(task,project);series.append(button);
 }
 scroll.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...series.children],index=buttons.indexOf(document.activeElement);event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)))]?.focus();};
 scroll.append(series);chart.append(axis,scroll);return chart;
}
$('#project-report').onclick=async()=>{
 const project=businessProjects.find(p=>p.id===selectedProjectId),status=$('#project-report-status'),button=$('#project-report');status.hidden=false;
 if(!project){status.textContent='엑셀 보고서를 내려받을 프로젝트를 선택하세요.';return;}
 button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='보고서 생성 중…';status.textContent=project.title+' · 전체 기간의 공정과 수행 기록을 준비하고 있습니다.';
 try{await downloadWorkbook('projects/'+project.id+'/excel');status.textContent=project.title+' · 엑셀 보고서를 다운로드했습니다.';}
 catch(error){status.textContent='엑셀 보고서 생성 실패: '+error.message;}
 finally{button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='엑셀 보고서';}
};

function renderProjects(){
 renderProjectOverview();
 const target=$('#project-cards'),scroll=target.scrollLeft,focused=target.contains(document.activeElement)?document.activeElement.closest('[data-project-id]')?.dataset.projectId:null;target.replaceChildren();
 for(const p of businessProjects){
  const card=bcard(p.title,`${p.company||'내부 업무'}\n${p.start_date} ~ ${p.end_date}`,()=>{selectedProjectId=p.id;const base=today()>=p.start_date&&today()<=p.end_date?today():p.start_date;$('#project-month').value=base.slice(0,7);renderProjects();});
  card.dataset.projectId=p.id;const title=card.querySelector('.work-card-title'),heading=text('div','','project-card-heading');title.title=p.title;title.setAttribute('aria-pressed',String(p.id===selectedProjectId));const swatch=text('span','','project-color-swatch');swatch.style.backgroundColor=p.color;swatch.title='프로젝트 색상';heading.append(swatch);
  heading.append(title,text('span',projectStates[p.status],'badge project-status-'+p.status));card.prepend(heading);card.querySelector('p').title=p.company||'내부 업무';
  card.querySelector('p').textContent=p.company||'내부 업무';card.append(text('p',p.start_date+' ~ '+p.end_date,'project-card-dates'));
  if(p.id===selectedProjectId)card.classList.add('selected');target.append(card);
 }
 emptyCards(target,'프로젝트를 등록하고 공정을 관리하세요.');target.scrollLeft=scroll;
 if(focused)target.querySelector(`[data-project-id="${focused}"] .work-card-title`)?.focus({preventScroll:true});
 if(visibleProjectId!==selectedProjectId&&revealProjectCard(target.querySelector('.selected')))visibleProjectId=selectedProjectId;
 const p=businessProjects.find(p=>p.id===selectedProjectId);$('#project-detail').hidden=!p;renderProjectHistory(p);renderTaskComparison(p);$('#project-edit').disabled=!p;$('#project-task-new').disabled=!p;if(!p)return;
 $('#project-title').textContent=p.title;$('#project-meta').replaceChildren(text('span',`${p.company||'내부 업무'} · ${p.start_date} ~ ${p.end_date}`),text('span',`등록자 ${p.owner} · 담당자 ${p.manager||p.owner} · 참여자: ${(p.participants||[]).map(u=>u.name).join(', ')||'없음'}`));$('#project-description').textContent=p.description;$('#project-description').hidden=!p.description;
 $('#project-status').value=p.status;$('#project-status').disabled=false;$('#project-status-save').hidden=false;$('#project-task-new').hidden=false;
 const changes=$('#project-change-list');changes.replaceChildren();$('#project-changes').hidden=!(p.changes||[]).length;
 for(const change of p.changes||[])changes.append(text('small',`${change.action==='status'?'프로젝트 상태 변경':'프로젝트 정보 수정'} · ${change.actor_name} · ${time(change.created)}`));
 const month=$('#project-month').value,[year,m]=month.split('-').map(Number);const grid=$('#project-task-board');grid.replaceChildren();if(!year||!m)return;const days=new Date(Date.UTC(year,m,0)).getUTCDate(),first=new Date(Date.UTC(year,m-1,1)).getUTCDay();for(const name of ['일','월','화','수','목','금','토'])grid.append(text('div',name,'calendar-cell calendar-day'));for(let i=0;i<first;i++)grid.append(text('div','','calendar-cell blank'));
 for(let day=1;day<=days;day++){const date=month+'-'+String(day).padStart(2,'0'),cell=text('div','','calendar-cell'+(date===today()?' today':'')),button=text('button',String(day),'calendar-date');button.setAttribute('aria-label',date+' 공정 등록');button.disabled=date<p.start_date||date>p.end_date;button.onclick=()=>createTask(date);cell.append(button);for(const task of p.tasks.filter(t=>t.start_date<=date&&t.end_date>=date)){const chip=text('button',task.title,'calendar-event task-event task-'+task.status);chip.title=`${task.assignee} · 참여자 ${(task.participants||[]).map(u=>u.name).join(', ')||'없음'} · ${taskStates[task.status]} · ${task.start_date} ~ ${task.end_date}`;applyProjectColor(chip,p.color);chip.onclick=()=>editTask(task,date);const item=text('div','','task-calendar-item'),label=text('label','','task-complete-label'),check=document.createElement('input');check.type='checkbox';check.checked=task.completed_dates.includes(date);check.dataset.taskComplete=task.id;check.setAttribute('aria-label',`${task.title} 완료 (${date})`);check.disabled=pendingTaskChecks.has(task.id);check.onchange=()=>run(()=>toggleTaskComplete(task,date,check.checked));label.append(check);item.append(label,chip);cell.append(item);}for(const event of (p.schedule_events||[]).filter(e=>e.start_date<=date&&e.end_date>=date)){const chip=text('button','일정 · '+event.title,'calendar-event project-schedule-event');applyProjectColor(chip,event.project_color||p.color);chip.onclick=()=>openSchedule(event);cell.append(chip);}grid.append(cell);}for(let i=0;i<(7-(first+days)%7)%7;i++)grid.append(text('div','','calendar-cell blank'));

}
function projectWorkDate(entry){return entry.work_date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(entry.created));}
function taskHistoryHeading(entry,label){
 const heading=text('div','','task-history-heading');heading.append(text('strong',`${projectWorkDate(entry)} · ${label}`));
 const author=text('span',entry.actor_name,'task-history-author');author.title='기록 시각: '+time(entry.created);heading.append(author);return heading;
}
function showTaskHistory(task,p){bmodal(task.title+' · 일자별 수행 내역',form=>{
 form.classList.add('task-history-form');
 const info=text('div','','task-history-info');info.append(text('p','담당자: '+task.assignee+' · 참여자: '+((task.participants||[]).map(u=>u.name).join(', ')||'없음')),text('p',`${task.start_date} ~ ${task.end_date} · ${task.completed_days}/${task.total_days}일 완료 · ${task.progress}%`));
 const edit=text('button','공정 수정 · 수행 내역 작성');edit.type='button';edit.onclick=()=>editTask(task);info.append(edit);form.append(info);
 if(task.completion_migrated)form.append(text('p','기존 공정에는 날짜별 완료 정보가 없어, 이전 진척률을 기준으로 시작일부터 초기 체크를 설정했습니다. 실제 완료한 날짜와 맞는지 달력에서 확인해 주세요.'));
 const completed=text('p',task.completed_dates.length?'완료한 날짜: '+task.completed_dates.join(', '):'아직 완료한 날짜가 없습니다.','task-completed-dates');form.append(completed);
 const entries=p.history.filter(h=>h.task_id===task.id),automaticNotes=new Set(['공정 등록','공정 정보 수정','완료 체크로 공정 완료','완료 체크 해제']);
 const work=entries.filter(h=>h.notes.trim()&&(h.kind==='work'||h.kind==='legacy'&&!automaticNotes.has(h.notes.trim()))).sort((a,b)=>projectWorkDate(b).localeCompare(projectWorkDate(a))||b.id-a.id);
 if(!work.length)form.append(text('p','등록된 수행 내역이 없습니다.','empty'));
 for(const h of work){const row=text('article','','task-history-detail');row.append(taskHistoryHeading(h,'수행 내역'),text('p',h.notes));form.append(row);}
 const schedule=entries.filter(h=>h.kind==='schedule').sort((a,b)=>b.created.localeCompare(a.created)||b.id-a.id);
 if(schedule.length){const details=text('details','','task-schedule-history');details.append(text('summary',`일정 변경 이력 (${schedule.length})`));
  for(const h of schedule){const row=text('article','','task-schedule-detail');row.append(taskHistoryHeading(h,'일정 변경'),text('p',`${h.before_start} ~ ${h.before_end} → ${h.after_start} ~ ${h.after_end}\n${h.notes}`));details.append(row);}form.append(details);
 }
},null);}

function peopleOptions(currentId,currentName){const people=[...businessPeople];if(currentId&&!people.some(u=>u.id===currentId))people.push({id:currentId,name:(currentName||'기존 담당자')+' (비활성)'});return people.map(u=>[String(u.id),u.name+(u.organization?' · '+u.organization:'')]);}
function participantFields(form,selected,leader){const group=text('fieldset','','project-participant-picker');group.append(text('legend','참여자 (여러 명 선택)'));const search=document.createElement('input');search.type='search';search.placeholder='이름·부서·직급 검색';search.setAttribute('aria-label','참여자 검색');group.append(search);const list=text('div','','project-participant-list'),people=new Map([...businessPeople,...selected].map(u=>[u.id,u]));for(const user of people.values()){const label=text('label','','check-label'),check=document.createElement('input');check.type='checkbox';check.name='participant_ids';check.value=user.id;check.checked=selected.some(u=>u.id===user.id);label.dataset.search=[user.name,user.organization,user.job_title].join(' ').toLocaleLowerCase();label.append(check,text('span',user.name+(user.job_title?' · '+user.job_title:'')+(user.organization?' · '+user.organization:'')+(user.active===0?' (비활성)':'')));list.append(label);}const sync=()=>{for(const check of list.querySelectorAll('input')){check.disabled=Number(check.value)===Number(leader.value);if(check.disabled)check.checked=false;}};leader.addEventListener('change',sync);sync();search.oninput=()=>{for(const label of list.children)label.hidden=!label.dataset.search.includes(search.value.trim().toLocaleLowerCase());};group.append(list,text('small','담당자는 참여자 목록에서 제외됩니다. 기존 비활성 참여자는 유지하거나 해제할 수 있습니다.'));form.append(group);}
const selectedParticipantIds=form=>[...form.querySelectorAll('[name=participant_ids]:checked')].filter(e=>!e.disabled).map(e=>Number(e.value));
function projectForm(p=null){bmodal(p?'프로젝트 수정':'프로젝트 등록',form=>{const manager=bfield(form,'manager_id','프로젝트 담당자',{options:peopleOptions(p?.manager_id,p?.manager),value:String(p?.manager_id||me.user.id),required:true});participantFields(form,p?.participants||[],manager);bfield(form,'color','프로젝트 색상',{options:[['#82358e','보라'],['#246cad','파랑'],['#547e23','초록'],['#ad5a13','주황'],['#886900','노랑'],['#b13e50','빨강'],['#087d9c','청록'],['#68717d','회색']],value:p?.color||['#82358e','#246cad','#547e23','#ad5a13','#886900','#b13e50','#087d9c','#68717d'][businessProjects.length%8]});bfield(form,'title','프로젝트 이름',{required:true,maxLength:150,value:p?.title});bfield(form,'customer_id','고객사',{options:[['','내부 업무'],...businessCustomers.map(c=>[String(c.id),c.company])],value:p?.customer_id?String(p.customer_id):''});bfield(form,'start_date','시작일',{type:'date',value:p?.start_date||today(),required:true});bfield(form,'end_date','종료일',{type:'date',value:p?.end_date||today(),required:true});bfield(form,'description','목표·설명',{type:'textarea',value:p?.description});if(p)bfield(form,'status','상태',{options:Object.entries(projectStates),value:p.status});},(values,form)=>api(p?`projects/${p.id}/update`:'projects',{...values,manager_id:Number(values.manager_id),participant_ids:selectedParticipantIds(form),customer_id:values.customer_id?Number(values.customer_id):null,...(p?{version:p.version}:{})}),async result=>{selectedProjectId=p?.id||result.id;await loadProjects();if(!$('#home').hidden)await loadHomeCalendar();if(!p){const created=businessProjects.find(row=>row.id===selectedProjectId);if(created)$('#project-month').value=(today()>=created.start_date&&today()<=created.end_date?today():created.start_date).slice(0,7);renderProjects();}});}
$('#project-new').onclick=()=>projectForm();$('#project-edit').onclick=()=>projectForm(businessProjects.find(p=>p.id===selectedProjectId));$('#project-month').onchange=renderProjects;$('#project-status-save').onclick=()=>run(async()=>{const p=businessProjects.find(p=>p.id===selectedProjectId);await api(`projects/${p.id}/status`,{status:$('#project-status').value,version:p.version});await loadProjects();});
function taskFields(form,p,task=null,date=null){bfield(form,'title','공정·할 일',{required:true,maxLength:150,value:task?.title});const assignee=bfield(form,'assignee_id','담당자',{options:peopleOptions(task?.assignee_id,task?.assignee),value:String(task?.assignee_id||me.user.id),required:true});participantFields(form,task?.participants||[],assignee);const start=date||task?.start_date||(today()>=p.start_date&&today()<=p.end_date?today():p.start_date);for(const [key,label] of [['start_date','공정 시작일'],['end_date','공정 종료일']]){const input=bfield(form,key,label,{type:'date',value:task?.[key]||start,required:true});input.min=p.start_date;input.max=p.end_date;}}
const pendingTaskChecks=new Set();
async function toggleTaskComplete(task,date,completed){if(pendingTaskChecks.has(task.id))return;pendingTaskChecks.add(task.id);for(const box of document.querySelectorAll(`[data-task-complete="${task.id}"]`))box.disabled=true;try{await api(`project-tasks/${task.id}/completion`,{date,completed,version:task.version});}finally{pendingTaskChecks.delete(task.id);await loadProjects();}}
function createTask(date=null){const p=businessProjects.find(p=>p.id===selectedProjectId);if(!p)return;bmodal('공정 등록',form=>{taskFields(form,p,null,date);form.append(text('p','공정률은 날짜별 완료 체크 수 ÷ 전체 일정 일수 × 100으로 자동 계산합니다. (주말 포함)'));},(values,form)=>api(`projects/${p.id}/tasks`,{...values,participant_ids:selectedParticipantIds(form),assignee_id:Number(values.assignee_id)}),loadProjects);}
$('#project-task-new').onclick=()=>createTask();
function deleteProjectTask(task){if(!me.user.is_admin)return;bmodal('공정 삭제',form=>{form.append(text('p',task.title+' 공정과 날짜별 완료 체크, 모든 수행 내용 및 일정 변경 사유를 영구 삭제합니다. 삭제 이력은 남기지 않으며 복구할 수 없습니다.'));bfield(form,'confirm','공정 및 수행 내역 삭제 확인',{type:'checkbox',required:true});},values=>api(`project-tasks/${task.id}/delete`,{confirm:values.confirm==='on',version:task.version}),loadProjects);}
function editTask(task,date=null){const p=businessProjects.find(p=>p.id===selectedProjectId);if(!p)return;bmodal('공정 수정 · 수행 내역',form=>{taskFields(form,p,task);if(me.user.is_admin){const remove=text('button','공정 삭제','danger');remove.type='button';remove.onclick=()=>deleteProjectTask(task);form.append(remove);}form.append(text('p',`현재 ${task.completed_days}/${task.total_days}일 완료 · ${task.progress}% (일정 변경 시 자동 재계산)`));const workDate=bfield(form,'work_date','수행 일자',{type:'date',value:date||(today()>=task.start_date&&today()<=task.end_date?today():task.start_date),required:true});workDate.min=task.start_date;workDate.max=task.end_date;const reason=bfield(form,'change_reason','일정 변경 사유 (기간 변경 시 필수)',{type:'textarea'});const sync=()=>{const start=form.elements.start_date.value,end=form.elements.end_date.value;reason.required=start!==task.start_date||end!==task.end_date;workDate.min=start;workDate.max=end;if(workDate.value<start||workDate.value>end)workDate.value=start;};form.elements.start_date.onchange=sync;form.elements.end_date.onchange=sync;bfield(form,'notes','해당 일자의 수행 내용·결과',{type:'textarea'});},(values,form)=>api(`project-tasks/${task.id}/update`,{...values,participant_ids:selectedParticipantIds(form),assignee_id:Number(values.assignee_id),version:task.version}),loadProjects);}
for(const [id,delta] of [['project-prev-month',-1],['project-next-month',1]])$('#'+id).onclick=()=>{const [year,m]=$('#project-month').value.split('-').map(Number),date=new Date(Date.UTC(year,m-1+delta,1));if(date.getUTCFullYear()<1000||date.getUTCFullYear()>9999)return;$('#project-month').value=date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');renderProjects();};

const expandedCustomers=new Set();let customerLoadRequest=0;
async function loadCustomers(){const request=++customerLoadRequest,userId=me?.user.id,result=await api('customers');if(request!==customerLoadRequest||me?.user.id!==userId)return;businessCustomers=result;for(const id of expandedCustomers)if(!result.some(c=>c.id===id))expandedCustomers.delete(id);renderCustomers();}
function renderCustomers(){
 const target=$('#customer-cards'),query=$('#customer-query').value.trim().toLocaleLowerCase();target.replaceChildren();
 for(const c of businessCustomers.filter(c=>[c.company,c.address,...c.contacts.flatMap(p=>[p.name,p.phone,p.email])].some(v=>v.toLocaleLowerCase().includes(query)))){
  const card=text('article','','work-card customer-card'),toggle=text('button','','customer-summary'),details=text('div','','customer-details');card.dataset.customerId=c.id;
  toggle.type='button';toggle.setAttribute('aria-expanded',String(expandedCustomers.has(c.id)));toggle.setAttribute('aria-controls','customer-details-'+c.id);
  toggle.append(text('strong',c.company,'customer-name'),text('span',c.address||'주소 미등록','customer-address'),text('span',`담당자 ${c.contacts.length}명`,'badge'),text('span','⌄','customer-arrow'));toggle.title=c.company+' · '+(c.address||'주소 미등록');
  details.id='customer-details-'+c.id;details.hidden=!expandedCustomers.has(c.id);details.append(text('p',c.company+'\n'+(c.address||'주소 미등록'),'customer-full'));
  toggle.onclick=()=>{const open=details.hidden;details.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)expandedCustomers.add(c.id);else expandedCustomers.delete(c.id);};
  const actions=text('div','','button-row');const add=text('button','+ 담당자·명함 등록');add.type='button';add.onclick=()=>editContact(c);actions.append(add);
  if(c.can_edit){const edit=text('button','고객사 수정','secondary');edit.onclick=()=>editCustomer(c);const remove=text('button','고객사 삭제','danger');remove.onclick=()=>deleteCustomer(c);actions.append(edit,remove);}details.append(actions);
  if(c.notes)details.append(text('p',c.notes,'customer-notes'));
  for(const p of c.contacts){const person=text('article','','contact-card');person.append(text('h3',p.name),text('p',p.position||'부서·직책 미등록'),text('p',p.phone||'전화·휴대폰 미등록'));
   if(p.email){const email=text('button',p.email,'contact-email');email.type='button';email.title='그룹웨어에서 메일 작성';email.onclick=()=>document.dispatchEvent(new CustomEvent('compose-mail',{detail:{to:p.email}}));person.append(email);}
   if(p.notes)person.append(text('p',p.notes));if(p.has_card){const img=document.createElement('img');img.src=`/api/contacts/${p.id}/card`;img.alt=p.name+' 명함';img.loading='lazy';img.className='business-card-image';person.append(img);}
   if(p.can_edit){const buttons=text('div','','button-row'),edit=text('button','담당자 수정','secondary'),remove=text('button','담당자 삭제','danger');edit.onclick=()=>editContact(c,p);remove.onclick=()=>deleteContact(c,p);buttons.append(edit,remove);person.append(buttons);}details.append(person);
  }
  if(!c.contacts.length)details.append(text('p','등록된 담당자가 없습니다','empty'));card.append(toggle,details);target.append(card);
 }
 emptyCards(target,'고객사를 등록하고 담당자와 명함을 보관하세요.');
}
function deleteCustomer(c){bmodal('고객사 삭제',form=>{form.append(text('p',c.company+' · 담당자와 연결 프로젝트가 없는 고객사만 삭제할 수 있습니다.'));bfield(form,'confirm','삭제 확인',{type:'checkbox',required:true});},values=>api(`customers/${c.id}/delete`,{version:c.version,confirm:values.confirm==='on'}),loadCustomers);}
function deleteContact(c,p){bmodal('담당자 삭제',form=>{form.append(text('p',p.name+' · 연락처와 명함을 삭제합니다.'));bfield(form,'confirm','삭제 확인',{type:'checkbox',required:true});},values=>api(`contacts/${p.id}/delete`,{version:p.version,confirm:values.confirm==='on'}),loadCustomers);}
$('#customer-query').oninput=renderCustomers;$('#customer-new').onclick=()=>editCustomer();
function editCustomer(customer=null){bmodal(customer?'고객사 수정':'고객사 등록',form=>{bfield(form,'company','회사명',{required:true,maxLength:150,value:customer?.company});bfield(form,'address','주소',{maxLength:300,value:customer?.address});bfield(form,'notes','회사 메모',{type:'textarea',maxLength:2000,value:customer?.notes});},values=>api(customer?`customers/${customer.id}/update`:'customers',{...values,...(customer?{version:customer.version}:{})}),loadCustomers);}
function readCard(file){return new Promise((resolve,reject)=>{if(!file||!file.size)return resolve(null);if(file.size>524288||!['image/png','image/jpeg'].includes(file.type))return reject(Error('명함 이미지는 PNG/JPEG 512KiB 이하로 선택하세요.'));const reader=new FileReader();reader.onload=()=>resolve({card_type:file.type,card_data:String(reader.result).split(',')[1]});reader.onerror=()=>reject(Error('파일을 읽을 수 없습니다'));reader.readAsDataURL(file);});}
function editContact(customer,contact=null){bmodal(contact?'담당자·명함 수정':'담당자·명함 등록',form=>{for(const [key,label,max] of [['name','이름',100],['position','부서·직책',100],['phone','전화·휴대폰',40],['email','이메일',150]])bfield(form,key,label,{required:key==='name',maxLength:max,value:contact?.[key]});bfield(form,'notes','상담·관계 메모',{type:'textarea',maxLength:2000,value:contact?.notes});bfield(form,'card','명함 이미지 (PNG/JPEG, 512KiB 이하)',{type:'file'});form.append(text('small','명함 이미지를 보관하며 텍스트 자동 인식은 하지 않습니다.'));},async(values,form)=>{const image=await readCard(form.elements.card.files[0]);delete values.card;return api(contact?`contacts/${contact.id}/update`:`customers/${customer.id}/contacts`,{...values,...image,...(contact?{version:contact.version}:{})});},async()=>{expandedCustomers.add(customer.id);await loadCustomers();});}

let payablePage=1,journalPage=1,accountingRequest=0;
document.addEventListener('groupware-ready',()=>{expandedCustomers.clear();payablePage=journalPage=1;ledgerState=null;accountingRequest++;customerLoadRequest++;});
async function loadAccounting(){const request=++accountingRequest,userId=me?.user.id,result=await api('accounting');if(request!==accountingRequest||me?.user.id!==userId)return;ledgerState=result;renderAccounting();}
function ledgerLink(label,action){const button=text('button',label,'cell-link');button.type='button';button.title=label;button.onclick=action;return button;}
function ledgerText(value){const span=text('span',value,'ledger-clip');span.title=value;return span;}
function renderLedgerPage(id,headers,rows,page,onPage){
 const target=$('#'+id),pages=Math.max(1,Math.ceil(rows.length/5)),current=Math.max(1,Math.min(page,pages));
 const grid=createGrid(headers,rows.slice((current-1)*5,current*5));grid.classList.add('ledger-table');grid.tabIndex=0;grid.setAttribute('aria-label',id==='payable-board'?'미지급 승인 지출 표':'회계 전표 표');target.replaceChildren(rows.length?grid:text('p',id==='payable-board'?'미지급 승인 지출이 없습니다.':'선택한 월의 전표가 없습니다.','empty'));
 const pager=$('#'+id+'-pager');pager.replaceChildren(text('span',`전체 ${rows.length.toLocaleString('ko-KR')}건`,'ledger-total'));const prev=text('button','이전','secondary'),next=text('button','다음','secondary'),label=text('span',`${current} / ${pages} 페이지`);label.setAttribute('aria-live','polite');prev.disabled=current===1;next.disabled=current===pages;prev.onclick=()=>onPage(current-1);next.onclick=()=>onPage(current+1);pager.append(prev,label,next);return current;
}
function renderAccounting(){
 if(!ledgerState)return;const cash=ledgerState.accounts.filter(a=>['101','103'].includes(a.code)).reduce((s,a)=>s+a.debit-a.credit,0);$('#ledger-cash').textContent=won(cash);$('#ledger-payable').textContent=won(ledgerState.payables.reduce((s,e)=>s+e.total,0));$('#ledger-count').textContent=ledgerState.entries.length.toLocaleString('ko-KR')+'건';
 payablePage=renderLedgerPage('payable-board',['문서','기안자','거래처','금액','지급 상태'],ledgerState.payables.map(e=>[ledgerLink(e.title,()=>payExpense(e)),ledgerText(e.name),ledgerText(e.vendor),won(e.total),'승인 · 지급 대기']),payablePage,p=>{payablePage=p;renderAccounting();});
 const month=$('#ledger-month').value,labels={expense_approval:'지출 승인',expense_payment:'지급 기록',manual_income:'수입 기록',manual_expense:'지출 기록'};
 journalPage=renderLedgerPage('ledger-entries',['전표일자','구분','적요','금액'],ledgerState.entries.filter(e=>!month||e.entry_date.startsWith(month)).map(e=>[e.entry_date,labels[e.source_type],ledgerLink(e.title,()=>editJournal(e)),won(e.amount)]),journalPage,p=>{journalPage=p;renderAccounting();});
 $('#ledger-balances').replaceChildren(createGrid(['코드','계정','차변 합계','대변 합계'],ledgerState.accounts.map(a=>[a.code,a.name,won(a.debit),won(a.credit)])));
}
$('#ledger-month').onchange=()=>{journalPage=1;renderAccounting();};
$('#ledger-export').onclick=async()=>{const button=$('#ledger-export'),status=$('#ledger-export-status');button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='다운로드 준비 중…';status.hidden=false;status.textContent='전체 장부의 계정별 합계를 준비하고 있습니다.';try{await downloadWorkbook('accounting/accounts/excel');status.textContent='계정별 합계 엑셀을 다운로드했습니다.';}catch(error){status.textContent='엑셀 다운로드 실패: '+error.message;}finally{button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='엑셀 다운로드';}};
function payExpense(e){bmodal('승인 지출 지급 기록',form=>{form.append(text('p',`${e.title} · ${won(e.total)}\n기안자 ${e.name} · 거래처 ${e.vendor}\n지출일 ${e.expense_date}\n은행 송금은 별도로 처리한 뒤 기록하세요.`));bfield(form,'entry_date','실제 지급일',{type:'date',required:true,value:today()});bfield(form,'bank','출납 계정',{options:[['103','보통예금'],['101','현금']],value:'103'});},values=>api(`accounting/expenses/${e.id}/pay`,values),loadAccounting);}
$('#ledger-manual').onclick=()=>bmodal('수입·지출 기록',form=>{form.append(text('p','승인 지출은 자동 반영되므로 이곳에 중복 입력하지 마세요.'));bfield(form,'kind','구분',{options:[['income','수입'],['expense','직접 지출']],value:'income'});bfield(form,'entry_date','일자',{type:'date',value:today(),required:true});bfield(form,'title','내용',{required:true,maxLength:200});bfield(form,'amount','금액 (원)',{type:'number',min:1,required:true});bfield(form,'bank','출납 계정',{options:[['103','보통예금'],['101','현금']],value:'103'});bfield(form,'category','비용 계정 (직접 지출일 때)',{options:[['501','식비'],['502','교통비'],['503','소모품비'],['504','통신비'],['505','교육비'],['506','4대보험'],['507','공과금'],['508','급여'],['509','기타비용']],value:'509'});},values=>api('accounting/manual',{...values,amount:Number(values.amount)}),loadAccounting);

function profileFields(form,u={}){bfield(form,'name','이름',{required:true,maxLength:80,value:u.name});bfield(form,'job_title','직급',{required:true,options:[['','직급 선택'],...userOptions.job_titles.map(v=>[v,v])],value:u.job_title||''});bfield(form,'organization','소속조직',{required:true,options:[['','소속조직 선택'],...userOptions.organizations.map(v=>[v,v])],value:u.organization||''});const phone=bfield(form,'phone','전화번호',{type:'tel',required:true,value:u.phone||''});phone.maxLength=40;const email=bfield(form,'email','이메일',{type:'email',required:true,value:u.email||''});email.maxLength=150;}
async function loadUsers(){
 [userState,userOptions]=await Promise.all([api('users'),api('user-options')]);$('#user-new').hidden=!me.user.is_admin;$('#user-new').disabled=false;
 const target=$('#user-cards'),headers=['이름','아이디','부서','직급','결재 역할','Admin','상태','관리'];target.className='user-directory';
 const rows=userState.map(u=>{const edit=()=>me.user.is_admin?editUser(u):editProfile(u),name=text('button',u.name,'work-card-title'),actions=text('div','','user-actions'),button=text('button','정보 수정','secondary');name.onclick=button.onclick=edit;actions.append(button,userPasswordButton(u));const identity=text('div','','user-identity');identity.append(name,text('small',u.phone||'전화번호 미설정'),text('small',u.email||'이메일 미설정'));return [identity,u.login,u.organization||'미설정',text('span',u.job_title||'미설정','badge'),text('span',roleNames[u.role],'badge'),text('span',u.is_admin?'Admin':'일반','badge'),text('span',u.active?'활성':'비활성','badge '+(u.active?'approved':'withdrawn')),actions];});
 const grid=createGrid(headers,rows);grid.querySelectorAll('tbody tr').forEach(row=>{if(row.children.length===headers.length)Array.from(row.children).forEach((cell,i)=>cell.dataset.label=headers[i]);});target.replaceChildren(grid);
}
$('#user-new').onclick=()=>bmodal('사용자 생성',form=>{bfield(form,'login','로그인 아이디',{required:true,maxLength:100});profileFields(form);bfield(form,'role','결재 역할',{options:Object.entries(roleNames),value:'employee'});bfield(form,'password','초기 비밀번호 (12자 이상)',{type:'password',required:true,maxLength:256});bfield(form,'is_admin','동일한 Admin 권한 부여',{type:'checkbox'});},values=>api('users',{...values,is_admin:values.is_admin==='on'}),loadUsers);
function editProfile(u){bmodal('내 사용자 정보 수정',form=>{bfield(form,'login','로그인 아이디',{required:true,maxLength:100,value:u.login});profileFields(form,u);form.append(userPasswordButton(u));form.append(text('small','아이디를 변경하면 새 아이디로 다시 로그인하세요. 직급·소속조직 수정으로 결재 역할이나 Admin 권한이 바뀌지 않습니다.'));},values=>api('users/me/update',values),()=>location.reload());}
function editUser(u){bmodal('사용자 정보·권한 관리',form=>{bfield(form,'login','로그인 아이디',{required:true,maxLength:100,value:u.login});profileFields(form,u);bfield(form,'role','결재 역할',{options:Object.entries(roleNames),value:u.role});bfield(form,'active','활성 계정',{type:'checkbox',value:u.active});bfield(form,'is_admin','Admin 권한',{type:'checkbox',value:u.is_admin});const reset=userPasswordButton(u);const remove=text('button','사용자 영구 삭제','danger');remove.type='button';remove.onclick=()=>deleteUser(u);form.append(remove,reset,text('small','권한·상태 변경 시 해당 사용자는 다시 로그인해야 합니다. 마지막 활성 Admin은 해제할 수 없습니다.'));},values=>api(`users/${u.id}/update`,{...values,active:values.active==='on',is_admin:values.is_admin==='on'}),async()=>{if(u.id===me.user.id)location.reload();else await loadUsers();});}
function userPasswordButton(u){const button=text('button','비밀번호 변경','secondary');button.type='button';button.onclick=()=>openUserPassword(u);return button;}
let passwordTarget=null,passwordSaving=false;
function openUserPassword(u){
 if(passwordSaving||u.id!==me.user.id&&!me.user.is_admin)return;
 const form=$('#user-password-form'),own=u.id===me.user.id;passwordTarget={id:u.id,name:u.name,login:u.login};form.reset();form.elements.password_confirm.setCustomValidity('');
 $('#user-password-target').textContent=`${u.name} (${u.login})`;
 $('#user-password-hint').textContent=own?'현재 비밀번호를 확인한 뒤 변경합니다. 변경 후 모든 기기에서 로그아웃되며 새 비밀번호로 다시 로그인하세요.':'Admin 권한으로 선택한 사용자의 비밀번호를 변경합니다. 해당 사용자는 모든 기기에서 로그아웃되며 새 비밀번호로 다시 로그인해야 합니다.';
 $('#user-password-error').textContent='';$('#user-password-current-label').hidden=!own;form.elements.current.disabled=!own;form.elements.current.required=own;
 $('#user-password-dialog').showModal();(own?form.elements.current:form.elements.password).focus();
}
for(const input of $('#user-password-form').querySelectorAll('input'))input.oninput=()=>$('#user-password-form').elements.password_confirm.setCustomValidity('');
$('#user-password-dialog').addEventListener('close',()=>{passwordTarget=null;$('#user-password-form').reset();$('#user-password-form').elements.password_confirm.setCustomValidity('');});
$('#user-password-form').onsubmit=async event=>{
 event.preventDefault();if(passwordSaving||!passwordTarget)return;
 const form=event.target,target=passwordTarget,own=target.id===me.user.id,button=$('#user-password-save');
 if(form.elements.password.value!==form.elements.password_confirm.value){form.elements.password_confirm.setCustomValidity('새 비밀번호가 일치하지 않습니다.');form.elements.password_confirm.reportValidity();return;}
 passwordSaving=true;button.disabled=true;$('#user-password-error').textContent='';
 try{
  await api(own?'security/password':`users/${target.id}/password`,{password:form.elements.password.value,...(own?{current:form.elements.current.value}:{})});
  $('#user-password-dialog').close();
  if(own)location.reload();else{await loadUsers();notice(target.name+'님의 비밀번호를 변경했습니다.');}
 }catch(error){if($('#user-password-dialog').open)$('#user-password-error').textContent=error.message;else notice(error);}
 finally{passwordSaving=false;button.disabled=false;}
}

document.addEventListener('open-project',event=>{selectedProjectId=event.detail;openPage('projects');});

document.addEventListener('schedule-updated',()=>{if(!$('#projects').hidden)run(loadProjects);});

function deleteUser(u){bmodal('사용자 영구 삭제',form=>{form.append(text('p',`${u.name} (${u.login})의 계정·메일·결재·근태·등록 프로젝트/고객사와 연결 기록을 보관 없이 삭제합니다. 복구할 수 없습니다.`));bfield(form,'confirm_login','삭제할 사용자 아이디를 그대로 입력',{required:true});},values=>api(`users/${u.id}/delete`,values),async()=>{if(u.id===me.user.id)location.reload();else await loadUsers();});}
function editJournal(entry){bmodal('회계 전표 수정',form=>{bfield(form,'entry_date','일자',{type:'date',value:entry.entry_date,required:true});bfield(form,'title','내용',{value:entry.title,required:true});bfield(form,'amount','금액 (원)',{type:'number',min:1,value:entry.amount,required:true});if(entry.source_type.startsWith('expense_'))form.append(text('small','연동 금액은 지출결의서 승인 금액을 따릅니다.'));for(const [i,l] of entry.lines.entries()){const row=text('div','','journal-edit-line');bfield(row,`code_${i}`,'계정',{options:ledgerState.accounts.map(a=>[a.code,a.name]),value:l.account_code});bfield(row,`debit_${i}`,'차변',{type:'number',value:l.debit,required:true});bfield(row,`credit_${i}`,'대변',{type:'number',value:l.credit,required:true});form.append(row);}const remove=text('button','전표 삭제','danger');remove.type='button';remove.onclick=()=>bmodal('회계 전표 삭제',f=>{f.append(text('p',entry.title+(entry.source_type==='expense_approval'?' · 연결된 지급 전표도 함께 삭제되며 자동 재생성하지 않습니다.':' · 삭제 후 복구할 수 없습니다.')));bfield(f,'confirm','삭제 확인',{type:'checkbox',required:true});},values=>api(`accounting/entries/${entry.id}/delete`,{version:entry.version,confirm:values.confirm==='on'}),loadAccounting);form.append(remove);},values=>api(`accounting/entries/${entry.id}/update`,{entry_date:values.entry_date,title:values.title,amount:Number(values.amount),version:entry.version,lines:entry.lines.map((_,i)=>({code:values[`code_${i}`],debit:Number(values[`debit_${i}`]),credit:Number(values[`credit_${i}`])}))}),loadAccounting);}
