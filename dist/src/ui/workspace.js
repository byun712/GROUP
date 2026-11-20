import {DEFAULT_PREFERENCES,STATUSES,PRIORITIES,VIEWS,VIEW_KINDS,validPreferences,todayInSeoul,shiftDate,subtaskSummary,projectSummary} from '../domain/model.js';
import {el,$,field,options,selectInput,button,watchDirty,formValues} from './dom.js';
import {markdownPreview} from './markdown.js';
const FILTERS=[['projectId','프로젝트'],['processId','공정'],['due','마감일'],['assigneeId','담당자'],['tag','태그'],['groupBy','그룹']];
export const workspaceMethods={
  mountWorkspace(){
    for(const [kind,label] of Object.entries(VIEW_KINDS))$('#view-tabs').append(button(label,()=>{this.prefs.kind=kind;this.renderList();this.savePreferences();},{role:'tab','data-kind':kind,'aria-controls':'task-list'}));
    for(const [key,label] of FILTERS)$('#advanced-filters').append(field(label,selectInput(key,[],'',{id:'filter-'+key,onchange:e=>{
      this.prefs[key]=e.target.value;if(key==='projectId')this.prefs.processId='';this.renderList();this.renderNavigation();this.savePreferences();
    }})));
    for(const [key,label] of [['dueFrom','시작 날짜'],['dueTo','끝 날짜']])$('#advanced-filters').append(field(label,el('input',{id:'filter-'+key,type:'date',min:'1900-01-01',max:'9999-12-31',onchange:e=>{this.prefs[key]=e.target.value;this.renderList();this.savePreferences();}})));
    $('#new-task').onclick=()=>this.openCreate();$('#templates-open').onclick=()=>this.openTemplates();$('#save-view').onclick=()=>this.openSaveView();
  },
  syncAdvanced(){
    if(!$('#advanced-filters'))return;
    const p=this.prefs,values={
      projectId:[['','전체 프로젝트'],['personal','개인 할 일'],...this.data.projects.map(x=>[x.id,x.name])],
      processId:[['','전체 공정'],['none','공정 미지정'],...this.data.processes.filter(x=>!p.projectId||x.projectId===p.projectId).map(x=>[x.id,x.name])],
      due:[['','전체 날짜'],['none','날짜 미지정'],['overdue','기한 지남'],['today','오늘 마감'],['future','오늘 이후'],['range','기간 지정']],
      assigneeId:[['','전체 담당자'],['none','담당자 미지정'],...(this.data.profiles.length?[['me','내 업무 (로컬)'],...this.data.profiles.map(x=>[x.id,x.name+' (로컬)'])]:[])],
      tag:[['','전체 태그'],...[...new Set(this.data.tasks.flatMap(t=>t.tags||[]))].sort().map(x=>[x,x])],
      groupBy:[['none','그룹 없음'],['status','상태별'],['priority','우선순위별'],['project','프로젝트별'],['date','마감일별']]
    };
    for(const [key] of FILTERS){const list=values[key];if(p[key]&&!list.some(([id])=>id===p[key]))list.push([p[key],'이전 조건 (대상 없음)']);options($('#filter-'+key),list,p[key]);}
    $('#filter-projectId').parentElement.hidden=p.view==='projects';$('#filter-groupBy').parentElement.hidden=p.kind!=='list';
    for(const key of ['dueFrom','dueTo']){const input=$('#filter-'+key);input.parentElement.hidden=p.due!=='range';input.value=p[key];}
  },
  renderWorkspaceHeader(){
    this.syncAdvanced();for(const tab of document.querySelectorAll('[data-kind]')){tab.setAttribute('aria-selected',tab.dataset.kind===this.prefs.kind?'true':'false');tab.tabIndex=0;}
    const saved=this.data.savedViews.find(v=>v.id===this.savedViewId);if(saved)$('#view-title').textContent=saved.name+(JSON.stringify(validPreferences(saved.preferences))===JSON.stringify(validPreferences(this.prefs))?'':' · 조건 변경됨');
    const p=this.prefs,labels=[VIEWS[p.view],p.view==='done'?'완료 항목':p.includeCompleted?'완료 포함':'미완료 기준'];
    if(p.search)labels.push('검색: '+p.search);if(p.status)labels.push('상태: '+STATUSES[p.status]);if(p.priority)labels.push('우선순위: '+PRIORITIES[p.priority]);
    for(const [key,label] of FILTERS)if(p[key]&&key!=='groupBy')labels.push(label+': '+($('#filter-'+key).selectedOptions[0]?.textContent||p[key]));
    if(p.due==='range')labels.push(`${p.dueFrom||'시작 제한 없음'} ~ ${p.dueTo||'종료 제한 없음'}`);
    if(p.dueFrom&&p.dueTo&&p.due==='range'&&p.dueFrom>p.dueTo)labels.push('날짜 범위를 확인하세요');
    if(p.kind==='board')labels.push('상태별 열');if(p.kind==='calendar')labels.push('마감일 기준');
    $('#active-filters').replaceChildren(...labels.map(label=>el('span',{class:'filter-chip'},label)),button('현재 보기 저장',()=>this.openSaveView(),{class:'plain-button'}));
    const summary=$('#project-summary');summary.hidden=!(p.view==='projects'||p.projectId);
    if(!summary.hidden){const n=projectSummary(this.data,p.projectId);summary.replaceChildren(el('strong',{},n.total?`ToDo 완료율 ${n.percent}% · ${n.completed} / ${n.total} 완료`:'등록된 할 일 없음'),el('span',{},'프로젝트 전체 최상위 할 일 기준 · 하위 작업 제외 · 보기 필터와 무관'),el('span',{},'GROUP 공정 진척률 · 미연결'));}
  },
  renderSavedNavigation(){
    const target=$('#saved-views');target.replaceChildren();
    for(const view of this.data.savedViews)target.append(el('div',{class:'saved-view-row'},button(view.name,()=>{this.savedViewId=view.id;this.prefs=validPreferences(view.preferences);this.syncFilters();this.renderNavigation();this.renderList();this.savePreferences();},{class:'saved-view-link',title:view.name,'aria-current':view.id===this.savedViewId?'page':'false','data-saved-view':view.id}),button('⋯',()=>this.openSaveView(view),{class:'plain-button','aria-label':view.name+' 보기 관리'})));
    if(!this.data.savedViews.length)target.append(el('p',{class:'sidebar-empty'},'자주 쓰는 조건을 저장하세요.'));
  },
  workspaceDialog(title){
    const dialog=$('#workspace-dialog');if(dialog.open&&this.hasDrafts(dialog)&&!confirm('저장하지 않은 입력을 버리고 이동할까요?'))return null;
    dialog.replaceChildren(this.dialogHeader(dialog,title,'workspace-title'));if(!dialog.open)dialog.showModal();return dialog;
  },
  openSaveView(existing=null){
    const dialog=this.workspaceDialog(existing?'저장한 보기 관리':'현재 보기 저장');if(!dialog)return;
    const form=el('form',{id:'saved-view-form'},field('보기 이름',el('input',{name:'name',value:existing?.name||'',required:true,maxlength:100,placeholder:'예: 우선순위 높은 업무'})),el('p',{},'현재 화면의 메뉴, 보기 종류, 검색·필터·정렬·그룹 기준을 저장합니다. 할 일은 복제하지 않습니다.'),el('button',{type:'submit',class:'primary'},existing?'현재 조건으로 갱신':'보기 저장'));watchDirty(form);
    form.onsubmit=async e=>{e.preventDefault();const ok=await this.run(()=>this.service.saveView({id:existing?.id,name:form.elements.name.value,preferences:this.prefs},existing?.version));if(ok){form.dataset.dirty='false';dialog.close();}};
    dialog.append(form);if(existing)dialog.append(button('보기 삭제',async()=>{if(!confirm('저장한 보기만 삭제할까요? 할 일은 유지됩니다.'))return;const ok=await this.run(()=>this.service.deleteDefinition('savedViews',existing.id,existing.version));if(ok)dialog.close();},{class:'danger-button'}));form.elements.name.focus();
  },
  openCreate(date=undefined,templateId=''){
    const dialog=this.workspaceDialog('새 할 일');if(!dialog)return;
    const template=this.data.templates.find(t=>t.id===templateId),defaultDate=date===undefined?(this.prefs.view==='today'?todayInSeoul():this.prefs.view==='upcoming'?shiftDate(todayInSeoul(),1):''):date;
    const project=selectInput('projectId',[['','연결 없음'],...this.data.projects.map(p=>[p.id,p.name])],this.prefs.projectId),process=selectInput('processId',[],'');
    const update=()=>options(process,[['','연결 없음'],...this.data.processes.filter(p=>p.projectId===project.value).map(p=>[p.id,p.name])],'');update();project.onchange=update;
    const title=el('input',{name:'title',required:true,maxlength:400,value:template?.title||''});if(template)title.readOnly=true;
    const form=el('form',{id:'create-task-form'},template?el('p',{},'템플릿: '+template.name+' · 새 ID와 미완료 상태로 생성합니다.'):null,field('제목',title),field('마감일',el('input',{name:'dueDate',type:'date',value:defaultDate,min:'1900-01-01',max:'9999-12-31'})),field('프로젝트',project),field('공정',process),el('button',{type:'submit',class:'primary'},'할 일 만들기'));watchDirty(form);
    form.onsubmit=async e=>{e.preventDefault();let task;const ok=await this.run(async()=>{const values=formValues(form);task=template?await this.service.createFromTemplate(template.id,values):await this.service.saveTask(values);});if(ok){form.dataset.dirty='false';dialog.close();this.openTask(task.id);this.message('새 할 일을 만들었습니다. 현재 필터와 맞지 않으면 목록에서는 숨겨질 수 있습니다.');}};
    dialog.append(form);title.focus();
  },
  focusTaskReturn(id){
    const task=this.data.tasks.find(t=>t.id===id),key=task?.parentId||id;
    const anchor=$(`[data-task-id="${CSS.escape(key)}"] .task-title-button`)||$(`[data-task-id="${CSS.escape(key)}"] .board-title`)||$(`button[data-task-id="${CSS.escape(key)}"]`);
    (anchor||$('#main-content')).focus({preventScroll:true});
  },
  toggleWide(){
    this.wide=!this.wide;this.root.querySelector('.app-shell').classList.toggle('wide-detail',this.wide);$('#main-content').inert=this.wide;
    const button=$('#wide-detail');button.textContent=this.wide?'좁게 보기':'넓게 보기';button.setAttribute('aria-expanded',String(this.wide));button.focus({preventScroll:true});
  },
  addDescriptionPreview(form){
    const description=form.elements.description,preview=el('div',{id:'description-preview',hidden:true});
    const toggle=button('미리보기',()=>{preview.hidden=!preview.hidden;if(!preview.hidden)preview.replaceChildren(markdownPreview(description.value));toggle.textContent=preview.hidden?'미리보기':'미리보기 닫기';toggle.setAttribute('aria-expanded',String(!preview.hidden));},{id:'preview-description',class:'secondary','aria-expanded':'false'});
    form.append(el('div',{class:'editor-tools'},el('small',{},'# 제목 · - 목록 · - [ ] 체크 · [링크](https://…)'),toggle),preview);
    description.addEventListener('input',()=>{if(!preview.hidden)preview.replaceChildren(markdownPreview(description.value));});
  },
  renderSubtasks(panel,task){
    let section=$('#subtasks',panel);const draft=section?.querySelector('#subtask-form'),draftTitle=draft?.elements.title.value||'',dirty=draft?.dataset.dirty==='true';if(!section){section=el('section',{id:'subtasks',class:'subtask-section'});panel.append(section);}section.replaceChildren();
    if(task.parentId){const parent=this.data.tasks.find(t=>t.id===task.parentId);if(parent)section.append(button('↑ 상위 할 일: '+parent.title,()=>this.openTask(parent.id),{class:'parent-link'}));return;}
    const summary=subtaskSummary(this.data,task.id);section.append(el('div',{class:'section-heading'},el('h2',{},'하위 작업'),el('small',{},`${summary.completed} / ${summary.total} 완료`)));
    for(const child of this.data.tasks.filter(t=>t.parentId===task.id)){
      const check=el('input',{type:'checkbox',checked:child.status==='done','aria-label':child.title+' 하위 작업 완료',onchange:async e=>{
        const ok=await this.run(()=>this.service.saveTask({...child,status:e.target.checked?'done':'todo'},child.version));if(!ok)e.target.checked=child.status==='done';else this.renderSubtasks($('#detail-panel'),task);
      }});
      section.append(el('div',{class:'subtask-row','data-child-id':child.id},check,button(child.title,()=>this.openTask(child.id),{class:'subtask-title',title:child.title}),button('삭제',async()=>{if(!confirm('이 하위 작업과 업무 기록을 삭제할까요?'))return;const ok=await this.run(()=>this.service.deleteTask(child.id,child.version));if(ok)this.renderSubtasks($('#detail-panel'),task);},{class:'plain-button','aria-label':child.title+' 하위 작업 삭제'})));
    }
    const form=el('form',{id:'subtask-form',class:'subtask-add'},el('input',{name:'title',placeholder:'하위 작업 추가',required:true,maxlength:400,'aria-label':'하위 작업 제목'}),el('button',{type:'submit',class:'secondary'},'추가'));watchDirty(form);
    form.onsubmit=async e=>{e.preventDefault();const ok=await this.run(()=>this.service.saveTask({title:form.elements.title.value,parentId:task.id}),{refresh:false});if(ok){form.dataset.dirty='false';form.elements.title.value='';await this.refresh();this.renderSubtasks($('#detail-panel'),task);}};
    form.elements.title.value=draftTitle;form.dataset.dirty=String(dirty);section.append(form,button('이 할 일로 템플릿 만들기',()=>this.openTemplates('',task),{class:'plain-button'}));
  },
  addProfileSettings(dialog){
    const profile=this.data.profiles[0],form=el('form',{id:'profile-form'},el('h3',{},'로컬 프로필'),el('p',{},'내 업무 필터에 사용하는 표시 이름입니다. 실제 로그인 계정이나 접근 권한이 아닙니다. 등록하지 않으면 담당자 미지정으로 사용할 수 있습니다.'),field('표시 이름',el('input',{name:'name',value:profile?.name||'',required:true,maxlength:100})),el('button',{type:'submit',class:'secondary'},'프로필 저장'));watchDirty(form);let version=profile?.version;
    form.onsubmit=async e=>{e.preventDefault();const ok=await this.run(async()=>{const result=await this.service.saveProfile(formValues(form),version);version=result.version;});if(ok){form.dataset.dirty='false';this.message('로컬 프로필을 저장했습니다.');}};dialog.append(form,el('hr'));
  },
  openTemplates(selected='',source=null){
    const dialog=this.workspaceDialog('업무 템플릿');if(!dialog)return;
    const template=this.data.templates.find(t=>t.id===selected),seed=template||source||{},subtitles=template?.subtasks||this.data.tasks.filter(t=>t.parentId===source?.id).map(t=>t.title);
    const picker=selectInput('template',[['','새 템플릿'],...this.data.templates.map(t=>[t.id,t.name])],selected,{'aria-label':'템플릿 선택'});dialog.append(picker,el('p',{},'직접 실행할 때만 새 할 일을 만듭니다. 완료 상태·완료 시각·업무 기록·이전 마감일은 복제하지 않습니다.'));
    const form=el('form',{id:'template-form'},field('템플릿 이름',el('input',{name:'name',value:template?.name||'',required:true,maxlength:100})),field('기본 제목',el('input',{name:'title',value:seed.title||'',required:true,maxlength:400})),field('기본 설명',el('textarea',{name:'description',rows:4,maxlength:20000},seed.description||'')),field('우선순위',selectInput('priority',Object.entries(PRIORITIES),seed.priority||'none')),field('태그 (쉼표 구분)',el('input',{name:'tags',value:(seed.tags||[]).join(', '),maxlength:820})),field('하위 작업 (한 줄에 하나)',el('textarea',{name:'subtasks',rows:4},subtitles.join('\n'))),el('button',{type:'submit',class:'primary'},'템플릿 저장'));watchDirty(form);
    picker.onchange=()=>{const previous=selected;this.openTemplates(picker.value);if(dialog.contains(picker))picker.value=previous;};
    form.onsubmit=async e=>{e.preventDefault();let result;const ok=await this.run(async()=>{const values=formValues(form);result=await this.service.saveTemplate({...values,id:template?.id,subtasks:values.subtasks.split('\n').map(s=>s.trim()).filter(Boolean)},template?.version);});if(ok){form.dataset.dirty='false';this.openTemplates(result.id);}};dialog.append(form);
    if(template)dialog.append(el('div',{class:'form-actions'},button('템플릿 삭제',async()=>{if(!confirm('템플릿만 삭제할까요? 생성한 할 일은 유지됩니다.'))return;const ok=await this.run(()=>this.service.deleteDefinition('templates',template.id,template.version));if(ok){form.dataset.dirty='false';this.openTemplates();}},{class:'danger-button'}),button('이 템플릿으로 새 할 일',()=>this.openCreate('',template.id),{class:'secondary'})));
  }
};
