import {STATUSES,PRIORITIES,VIEWS,DEFAULT_PREFERENCES,validPreferences,selectTasks,todayInSeoul,shiftDate,displayDate,displayInstant,STORES,subtaskSummary} from '../domain/model.js';
import {el,$,field,options,selectInput,icon,button,watchDirty,formValues} from './dom.js';
import {board,calendar,groupedList} from './views.js';
import {workspaceMethods} from './workspace.js';
const VIEW_DESCRIPTION={all:'머릿속의 할 일을 꺼내 놓고, 하나씩 가볍게 끝내세요.',today:'오늘 해야 할 일에 집중하세요. 지난 기한도 함께 챙길 수 있어요.',upcoming:'다가오는 일들을 미리 살펴보고, 여유 있게 준비하세요.',projects:'프로젝트와 공정에 연결된 작업을 한곳에서 확인하세요.',done:'하나씩 쌓아 온 작은 성취들. 필요하면 다시 시작할 수 있어요.'};
const emptySnapshot=()=>Object.fromEntries(STORES.map(name=>[name,[]]));
export class TodoApp {
  constructor(service){this.service=service;this.data=emptySnapshot();this.prefs={...DEFAULT_PREFERENCES};this.selected=null;this.busy=false;this.refreshSerial=0;this.root=$('#app');}
  hasDrafts(root=document){return [...root.querySelectorAll('form[data-dirty="true"]')].some(form=>root!==document||!form.closest('dialog')||form.closest('dialog').open)||(root===document&&!!$('#quick-title')?.value.trim());}
  canNavigate(){if(this.busy){this.message('저장이 끝난 뒤 다시 시도해 주세요.');return false;}return !this.hasDrafts($('#detail-panel'))||confirm('상세 패널에 저장하지 않은 내용이 있습니다. 입력을 버리고 이동할까요?');}
  message(text,error=false){clearTimeout(this.messageTimer);let target=$('#app-message');const dialog=$('dialog[open]');if(dialog){target=$('.dialog-message',dialog);if(!target){target=el('p',{class:'dialog-message',role:'status','aria-live':'polite'});dialog.querySelector('.dialog-heading').after(target);}}target.hidden=false;target.className=(dialog?'dialog-message':'app-message')+(error?' error':'');target.textContent=text;if(!error){clearTimeout(this.messageTimer);this.messageTimer=setTimeout(()=>target.hidden=true,5000);}}
  fail(error){console.error(error.name, error.message);this.message('저장하지 못했습니다. '+(error.message||'브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.')+' 입력 내용은 유지됩니다.',true);}
  async run(action,{success='',refresh=true}={}){
    if(this.busy)return false;this.busy=true;document.body.setAttribute('aria-busy','true');
    try{await action();if(refresh)await this.refresh();if(success)this.message(success);return true;}
    catch(error){this.fail(error);return false;}finally{this.busy=false;document.body.removeAttribute('aria-busy');}
  }
  async start(){this.mount();await this.refresh({initial:true});this.minuteTimer=setInterval(()=>{if(this.day!==todayInSeoul()){this.renderList();this.renderNavigation();}},30000);}
  mount(){
    this.root.innerHTML=`<div class="app-shell">
      <aside class="sidebar" aria-label="주 메뉴"><a class="brand" href="./"><img src="./assets/icon.svg" width="32" height="32" alt=""><span>모아 <small>나의 작업 공간</small></span></a>
      <div class="workspace-label">개인 워크스페이스 <span class="local-tag">로컬</span></div><nav id="navigation"></nav>
      <div class="sidebar-section"><span>프로젝트</span><button id="manage-projects" class="icon-button" type="button" aria-label="프로젝트 및 공정 관리" title="프로젝트 및 공정 관리">+</button></div><div id="sidebar-projects"></div>
      <div class="sidebar-section"><span>저장한 보기</span><button id="save-view" class="icon-button" type="button" aria-label="현재 보기 저장" title="현재 보기 저장">+</button></div><div id="saved-views"></div><button id="templates-open" class="sidebar-action" type="button">업무 템플릿</button><div class="sidebar-bottom"><button id="settings-open" class="sidebar-action" type="button">설정 및 데이터</button><button id="install-app" class="sidebar-action" type="button" hidden>앱 설치</button><p class="storage-label"><i></i> 이 브라우저에 저장 · GROUP 미연결</p></div></aside>
      <main id="main-content" tabindex="-1"><div class="breadcrumb"><span>개인 워크스페이스</span><span>/</span><span id="breadcrumb-view"></span><span id="runtime-state" class="runtime-state"></span></div>
      <div id="app-message" class="app-message" role="status" aria-live="polite" hidden></div><div id="update-notice" class="update-notice" hidden><span>새 버전이 준비되었습니다.</span><button id="apply-update" type="button">저장 후 업데이트</button></div>
      <header class="page-header"><div class="page-symbol" id="page-symbol"></div><div class="page-title-line"><h1 id="view-title"></h1><span id="view-count" class="count-pill"></span></div><p id="view-description"></p></header>
      <div id="project-filter-row" class="project-filter-row" hidden><label for="project-filter">프로젝트</label><select id="project-filter"></select><button id="projects-manage-main" class="plain-button" type="button">프로젝트·공정 관리</button></div>
      <section class="list-section" aria-label="할 일 목록"><div class="list-toolbar"><div id="view-tabs" class="view-tabs" role="tablist" aria-label="보기 종류"></div><span id="list-count" class="count-pill"></span><label class="search-box"><span class="sr-only">할 일 검색</span><input id="search" type="search" placeholder="검색" maxlength="400" autocomplete="off"></label><button id="new-task" type="button" class="primary">새 할 일</button></div>
      <div class="filters"><label>상태 <select id="status-filter"><option value="">전체 상태</option></select></label><label>우선순위 <select id="priority-filter"><option value="">전체 우선순위</option></select></label><label>정렬 <select id="sort"><option value="created">최근 등록순</option><option value="due">마감일순</option><option value="priority">우선순위순</option><option value="title">제목순</option><option value="updated">최근 수정순</option></select></label><label class="completed-toggle"><input id="include-completed" type="checkbox"> 완료 포함</label><button id="clear-filters" class="plain-button" type="button">초기화</button></div>
      <div id="advanced-filters" class="filters advanced-filters"></div><div id="active-filters" class="active-filters" aria-live="polite"></div><div id="project-summary" class="project-summary" hidden></div><div id="task-list"></div><form id="quick-add" class="quick-add"><span aria-hidden="true">＋</span><label class="sr-only" for="quick-title">새 할 일 제목</label><input id="quick-title" name="title" maxlength="400" required placeholder="새 할 일 추가… Enter로 빠르게 저장" autocomplete="off"><button type="submit">추가 <span aria-hidden="true">↵</span></button></form>
      <div class="list-footer"><span id="list-footer-text"></span><span>기준 시간대 · Asia/Seoul</span></div></section><p class="quiet-note">작은 일도 한곳에. 기록은 이 브라우저에만 남아요.</p></main>
      <aside id="detail-panel" class="detail-panel" aria-label="할 일 상세" hidden></aside>
      <dialog id="workspace-dialog" aria-labelledby="workspace-title"></dialog><dialog id="settings-dialog" aria-labelledby="settings-title"></dialog><dialog id="projects-dialog" aria-labelledby="projects-title"></dialog>
    </div>`;
    const nav=$('#navigation');for(const [key,title] of Object.entries(VIEWS))nav.append(button([icon(key),el('span',{},title),el('small',{'data-count':key})],()=>this.changeView(key),{'data-view':key,class:'nav-item'}));
    this.mountWorkspace();
    $('#settings-open').prepend(icon('settings'));$('#search').parentElement.prepend(icon('search'));
    $('#settings-open').onclick=()=>this.openSettings();$('#manage-projects').onclick=$('#projects-manage-main').onclick=()=>this.openProjects();
    options($('#status-filter'),[['','전체 상태'],...Object.entries(STATUSES)],'');options($('#priority-filter'),[['','전체 우선순위'],...Object.entries(PRIORITIES)],'');
    for(const [selector,key,event] of [['#search','search','input'],['#status-filter','status','change'],['#priority-filter','priority','change'],['#sort','sort','change'],['#include-completed','includeCompleted','change'],['#project-filter','projectId','change']])$(selector).addEventListener(event,e=>{this.prefs[key]=key==='includeCompleted'?e.target.checked:e.target.value;if(key==='projectId')this.prefs.processId='';this.renderList();this.renderNavigation();this.savePreferences();});
    $('#clear-filters').onclick=()=>{this.prefs={...DEFAULT_PREFERENCES,view:this.prefs.view,kind:this.prefs.kind};this.syncFilters();this.renderList();this.savePreferences();};
    $('#quick-add').onsubmit=async event=>{
      event.preventDefault();if(this.busy)return;const input=$('#quick-title'),title=input.value;
      await this.run(async()=>{const task=await this.service.saveTask({title,status:'todo',priority:'none',dueDate:this.prefs.view==='today'?todayInSeoul():this.prefs.view==='upcoming'?shiftDate(todayInSeoul(),1):null,projectId:this.prefs.view==='projects'&&this.data.projects.some(p=>p.id===this.prefs.projectId)?this.prefs.projectId:null});input.value='';if(this.prefs.view==='done')this.changeView('all');if(this.prefs.view==='projects'&&!task.projectId)this.changeView('projects','personal');this.message('할 일을 추가했습니다.');return task;});input.focus();
    };
    for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('cancel',event=>{if(this.busy||this.hasDrafts(dialog)&&!confirm('저장하지 않은 입력을 버리고 닫을까요?'))event.preventDefault();});
    window.addEventListener('beforeunload',event=>{if(this.hasDrafts()||this.busy){event.preventDefault();event.returnValue='';}});
  }
  async refresh({initial=false,external=false}={}){
    const serial=++this.refreshSerial,data=await this.service.snapshot();if(serial!==this.refreshSerial)return;this.data=data;
    if(initial){this.prefs=validPreferences(data.settings.find(s=>s.id==='preferences')?.values);this.syncFilters();}
    this.renderNavigation();this.syncAdvanced();this.renderList();
    if(this.selected&&!this.hasDrafts($('#detail-panel'))){const task=data.tasks.find(t=>t.id===this.selected);if(task){const scroll=$('#detail-panel').scrollTop;this.renderDetail(task);$('#detail-panel').scrollTop=scroll;}else this.closeDetail(true);}
    else if(external&&this.selected)this.message('다른 창의 변경을 불러왔습니다. 작성 중인 내용은 유지합니다. 같은 항목을 저장하면 버전을 확인합니다.');
  }
  syncFilters(){for(const [id,key] of [['search','search'],['status-filter','status'],['priority-filter','priority'],['sort','sort']])$('#'+id).value=this.prefs[key];$('#include-completed').checked=this.prefs.includeCompleted;this.syncAdvanced();}
  savePreferences(){return this.service.savePreferences({...this.prefs}).catch(error=>this.message('화면 설정을 저장하지 못했습니다. '+error.message,true));}
  changeView(view,projectId=''){this.savedViewId=null;this.prefs={...DEFAULT_PREFERENCES,kind:this.prefs.kind,view,projectId,sort:view==='upcoming'?'due':'created'};this.syncFilters();this.renderNavigation();this.renderList();this.savePreferences();}
  renderNavigation(){
    for(const [view] of Object.entries(VIEWS)){const button=$(`[data-view="${view}"]`);button.setAttribute('aria-current',this.prefs.view===view?'page':'false');$('[data-count]',button).textContent=selectTasks(this.data,{...DEFAULT_PREFERENCES,view}).length;}
    this.renderSavedNavigation();
    const container=$('#sidebar-projects');container.replaceChildren(...this.data.projects.map(project=>button([el('span',{class:'project-square'},'▧'),el('span',{},project.name),project.sample?el('small',{class:'sample-badge'},'예시'):null],()=>this.changeView('projects',project.id),{class:'project-nav'+(this.prefs.view==='projects'&&this.prefs.projectId===project.id?' selected':''),title:project.name})));
    if(!this.data.projects.length)container.append(el('p',{class:'sidebar-empty'},'프로젝트를 연결해\n일을 모아 보세요.'));
  }
  renderList(){
    const active=document.activeElement,focused=$('#task-list').contains(active)?{id:active.closest('[data-task-id]')?.dataset.taskId,label:active.getAttribute('aria-label'),name:active.name,tag:active.tagName,top:window.scrollY}:null;
    const scrolls=[...$('#task-list').querySelectorAll('.table-scroll,.board-scroll,.calendar-scroll,.day-items')].map(n=>[n.scrollLeft,n.scrollTop]);
    this.day=todayInSeoul();const rows=selectTasks(this.data,this.prefs,this.day),view=this.prefs.view;
    $('#view-title').textContent=VIEWS[view];$('#view-description').textContent=VIEW_DESCRIPTION[view];$('#breadcrumb-view').textContent=VIEWS[view];$('#view-count').textContent=rows.length;$('#list-count').textContent=rows.length;$('#page-symbol').replaceChildren(icon(view));
    $('#include-completed').parentElement.hidden=['today','upcoming','done'].includes(view);$('#sort').disabled=view==='upcoming';if(view==='upcoming')$('#sort').value='due';
    $('#project-filter-row').hidden=view!=='projects';options($('#project-filter'),[['','모든 프로젝트'],['personal','연결 없는 개인 할 일'],...this.data.projects.map(p=>[p.id,p.name])],this.prefs.projectId);
    this.renderWorkspaceHeader();
    const target=$('#task-list');target.replaceChildren();const onboarded=this.data.settings.find(s=>s.id==='preferences')?.onboarded;
    if(this.prefs.kind==='calendar')target.append(calendar(this,rows));
    else if(this.prefs.kind==='board'&&this.data.tasks.length)target.append(board(this,rows));
    else if(!rows.length){const blank=el('div',{class:'empty-state'},el('div',{class:'empty-icon'},icon(view)),el('h2',{},this.data.tasks.length?'조건에 맞는 할 일이 없어요':onboarded?'목록이 비어 있어요':'오늘의 생각을, 첫 번째 할 일로'),el('p',{},this.data.tasks.length?'검색어나 필터를 바꿔 다시 살펴보세요.':'작은 할 일부터 시작해 보세요. 모든 기록은 이 브라우저에 저장됩니다.'));
      blank.append(button('직접 할 일 추가',()=>$('#quick-title').focus(),{class:'primary'}));if(!onboarded&&!this.data.tasks.length&&!this.data.projects.length)blank.append(button('예시 데이터로 둘러보기',()=>this.run(()=>this.service.seedExamples(),{success:'로컬 예시를 추가했습니다. 실제 GROUP 데이터가 아닙니다.'}),{class:'secondary','data-action':'seed'}));target.append(blank);
    }else if(view==='today'){
      for(const [label,filtered] of [['기한 지남',rows.filter(t=>t.dueDate<this.day)],['오늘 마감',rows.filter(t=>t.dueDate===this.day)]])if(filtered.length)target.append(el('h2',{class:'group-heading'+(label==='기한 지남'?' overdue':'')},label,el('span',{},filtered.length)),this.taskTable(filtered));
    }else target.append(...(groupedList(this,rows)||[this.taskTable(rows)]));
    const roots=this.data.tasks.filter(t=>!t.parentId);$('#list-footer-text').textContent=`최상위 할 일 ${rows.length}개 표시 · 전체 ${roots.length}개 중 완료 ${roots.filter(t=>t.status==='done').length}개`;
    [...target.querySelectorAll('.table-scroll,.board-scroll,.calendar-scroll,.day-items')].forEach((n,i)=>{if(scrolls[i]){n.scrollLeft=scrolls[i][0];n.scrollTop=scrolls[i][1];}});
    if(focused?.id){const row=target.querySelector(`[data-task-id="${CSS.escape(focused.id)}"]`),selector=focused.label?`[aria-label="${CSS.escape(focused.label)}"]`:focused.name?`[name="${CSS.escape(focused.name)}"]`:focused.tag.toLowerCase();const control=row?.matches(selector)?row:row?.querySelector(selector);(control||$('#quick-title')).focus({preventScroll:true});window.scrollTo({top:focused.top,behavior:'instant'});}
  }
  taskTable(tasks){
    const table=el('table',{class:'task-table'},el('caption',{class:'sr-only'},VIEWS[this.prefs.view]+' 목록'),el('colgroup',{},...['check','title','status','date','priority','project'].map(name=>el('col',{class:'col-'+name}))),el('thead',{},el('tr',{},...['완료','할 일','상태','마감일','우선순위','프로젝트 / 공정'].map((name,i)=>el('th',{scope:'col',class:i===0?'check-heading':''},i===0?el('span',{class:'sr-only'},name):name)))));
    const body=el('tbody');for(const task of tasks){
      const row=el('tr',{'data-task-id':task.id,class:(task.id===this.selected?'selected ':'')+(task.status==='done'?'is-done':'')});
      const check=el('input',{type:'checkbox',checked:task.status==='done','aria-label':task.title+(task.status==='done'?' 미완료로 복원':' 완료'),onchange:e=>this.inlineEdit(task,{status:e.target.checked?'done':'todo'},()=>e.target.checked=task.status==='done')});
      const title=button([el('span',{class:'task-title-text'},task.title),task.sample?el('small',{class:'sample-badge'},'예시'):null],()=>this.openTask(task.id),{class:'task-title-button',title:task.title,'aria-expanded':task.id===this.selected,'aria-controls':'detail-panel'});
      const status=selectInput('status',Object.entries(STATUSES),task.status,{'aria-label':task.title+' 상태',class:'inline-select status-'+task.status,onchange:e=>this.inlineEdit(task,{status:e.target.value},()=>e.target.value=task.status)});
      const date=el('input',{type:'date',value:task.dueDate,min:'1900-01-01',max:'9999-12-31','aria-label':task.title+' 마감일',class:'inline-date'+(task.dueDate&&task.dueDate<this.day&&task.status!=='done'?' overdue':''),onchange:e=>this.inlineEdit(task,{dueDate:e.target.value},()=>e.target.value=task.dueDate||'')});
      const priority=selectInput('priority',Object.entries(PRIORITIES),task.priority,{'aria-label':task.title+' 우선순위',class:'inline-select priority-'+task.priority,onchange:e=>this.inlineEdit(task,{priority:e.target.value},()=>e.target.value=task.priority)});
      const project=this.data.projects.find(p=>p.id===task.projectId),process=this.data.processes.find(p=>p.id===task.processId),link=el('div',{class:'task-link',title:[project?.name,process?.name].filter(Boolean).join(' / ')},el('span',{},project?.name||'—'),process?el('small',{},process.name):null);
      const count=subtaskSummary(this.data,task.id),titleCell=el('div',{},title,count.total?el('small',{class:'subtask-count'},`하위 작업 ${count.completed} / ${count.total} 완료`):null);
      for(const node of [check,titleCell,status,date,priority,link])row.append(el('td',{},node));body.append(row);
    }table.append(body);return el('div',{class:'table-scroll',tabindex:'0','aria-label':'할 일 표. 좁은 영역에서는 가로 스크롤'},table);
  }
  async inlineEdit(task,patch,revert){
    if(this.busy||task.id===this.selected&&this.hasDrafts($('#detail-panel'))){revert();this.message('작성 중인 상세 내용을 먼저 저장해 주세요.');return;}
    const ok=await this.run(()=>this.service.saveTask({...task,...patch},task.version));if(!ok)revert();
  }
  openTask(id){if(!this.canNavigate())return;const task=this.data.tasks.find(t=>t.id===id);if(!task)return;this.contextScroll=window.scrollY;this.selected=id;this.renderList();this.renderDetail(task);$('#detail-title').focus({preventScroll:true});}
  closeDetail(force=false){if(!force&&!this.canNavigate())return;const id=this.selected;this.selected=null;$('#detail-panel').hidden=true;$('#detail-panel').replaceChildren();this.root.querySelector('.app-shell').classList.remove('has-detail','wide-detail');$('#main-content').inert=false;this.wide=false;this.renderList();window.scrollTo({top:this.contextScroll??window.scrollY,behavior:'instant'});this.focusTaskReturn(id);}
  renderDetail(task){
    const panel=$('#detail-panel');panel.hidden=false;this.root.querySelector('.app-shell').classList.add('has-detail');panel.replaceChildren();
    panel.append(el('div',{class:'detail-top'},el('span',{},'할 일 상세'),task.sample?el('span',{class:'sample-badge'},'예시 데이터'):null,button(this.wide?'좁게 보기':'넓게 보기',()=>this.toggleWide(),{id:'wide-detail',class:'plain-button','aria-expanded':!!this.wide}),button(icon('close'),()=>this.closeDetail(),{class:'icon-button','aria-label':'상세 패널 닫기',title:'상세 패널 닫기'})));
    const form=el('form',{id:'task-edit'}),title=el('textarea',{id:'detail-title',name:'title',rows:3,maxlength:400,required:true,'aria-label':'할 일 제목',class:'detail-title'},task.title);form.append(title);
    const project=selectInput('projectId',[['','연결 없음'],...this.data.projects.map(p=>[p.id,p.name])],task.projectId),process=selectInput('processId',[],task.processId);
    const updateProcesses=(value='')=>{options(process,[['','연결 없음'],...this.data.processes.filter(p=>p.projectId===project.value).map(p=>[p.id,p.name])],value);process.disabled=!project.value;};updateProcesses(task.processId);if(task.parentId){project.disabled=true;process.disabled=true;}project.onchange=()=>updateProcesses();
    const props=el('div',{class:'properties'});for(const [name,control,key] of [['상태',selectInput('status',Object.entries(STATUSES),task.status),'dot'],['우선순위',selectInput('priority',Object.entries(PRIORITIES),task.priority),'flag'],['마감일',el('input',{name:'dueDate',type:'date',value:task.dueDate,min:'1900-01-01',max:'9999-12-31'}),'today'],['담당자',selectInput('assigneeId',[['','미지정'],...this.data.profiles.map(p=>[p.id,p.name+' (로컬)'])],task.assigneeId),'local'],['프로젝트',project,'projects'],['공정',process,'note']])props.append(el('label',{class:'property'},el('span',{},icon(key),name),control));form.append(props,field('태그 (쉼표로 구분)',el('input',{name:'tags',value:(task.tags||[]).join(', '),maxlength:820,placeholder:'예: 기획, 검토'})));if(task.parentId)form.append(el('p',{class:'section-note'},'하위 작업 · 프로젝트와 공정은 상위 할 일을 따릅니다.'));
    form.append(field('설명',el('textarea',{name:'description',rows:5,maxlength:20000,placeholder:'이 할 일에 필요한 맥락을 남겨 보세요.'},task.description)));
    this.addDescriptionPreview(form);
    const save=el('button',{type:'submit',class:'primary'},'변경사항 저장'),saved=el('span',{class:'save-hint'},'저장됨');form.append(el('div',{class:'form-actions'},saved,save));watchDirty(form);form.addEventListener('input',()=>saved.textContent='저장하지 않은 변경');form.addEventListener('change',()=>saved.textContent='저장하지 않은 변경');
    let version=task.version;form.onsubmit=async event=>{event.preventDefault();await this.run(async()=>{const result=await this.service.saveTask({id:task.id,...formValues(form)},version);version=result.version;form.dataset.dirty='false';saved.textContent='저장됨';this.message('변경사항을 저장했습니다.');},{refresh:false});await this.refresh({external:false});};
    panel.append(form);this.renderSubtasks(panel,task);panel.append(el('div',{class:'detail-divider'}),el('div',{class:'section-heading'},el('h2',{},'업무 수행 기록'),el('span',{id:'work-log-count',class:'count-pill'})),el('p',{class:'section-note'},'직접 수행한 내용을 기록하세요. 상태 변경은 기록을 만들지 않습니다.'),el('div',{id:'work-log-list'}));
    const logForm=el('form',{id:'work-log-form',class:'work-log-form'},el('input',{type:'hidden',name:'id'}),field('수행일',el('input',{name:'workDate',type:'date',value:todayInSeoul(),min:'1900-01-01',max:'9999-12-31',required:true})),field('업무 내용',el('textarea',{name:'content',rows:4,maxlength:30000,required:true,placeholder:'무엇을 진행했고, 어떤 결과가 있었나요?'})),el('div',{class:'form-actions'},button('수정 취소',()=>{this.resetLogForm(logForm);},{id:'log-cancel',class:'plain-button',hidden:true}),el('button',{type:'submit',id:'log-save',class:'secondary'},'기록 추가')));watchDirty(logForm);
    logForm.onsubmit=async event=>{event.preventDefault();await this.run(async()=>{await this.service.saveWorkLog({...formValues(logForm),taskId:task.id},Number(logForm.dataset.version));this.resetLogForm(logForm);},{refresh:false,success:'업무 기록을 저장했습니다.'});this.data=await this.service.snapshot();this.renderLogs(task.id);};panel.append(logForm);
    panel.append(el('div',{class:'detail-meta'},el('p',{},'등록 · '+displayInstant(task.createdAt)),el('p',{},'수정 · '+displayInstant(task.updatedAt)),task.completedAt?el('p',{},'완료 · '+displayInstant(task.completedAt)):null,el('p',{},'표시 시각 · 한국 시간')),
      button([icon('trash'),'할 일 삭제'],async()=>{if(!confirm('이 할 일과 하위 작업, 연결된 업무 수행 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;await this.run(async()=>{await this.service.deleteTask(task.id,version);this.selected=null;panel.hidden=true;panel.replaceChildren();this.root.querySelector('.app-shell').classList.remove('has-detail','wide-detail');$('#main-content').inert=false;this.wide=false;},{success:'할 일을 삭제했습니다.'});},{class:'danger-button'}));this.renderLogs(task.id);
  }
  resetLogForm(form){
    // Hidden input values and date defaults are not reliably cleared by reset().
    form.elements.id.value='';form.elements.workDate.value=todayInSeoul();form.elements.content.value='';
    delete form.dataset.version;form.dataset.dirty='false';$('#log-cancel').hidden=true;$('#log-save').textContent='기록 추가';
  }
  renderLogs(taskId){
    const target=$('#work-log-list');if(!target)return;const logs=this.data.workLogs.filter(log=>log.taskId===taskId).sort((a,b)=>b.workDate.localeCompare(a.workDate)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));$('#work-log-count').textContent=logs.length;
    target.replaceChildren(...logs.map(log=>el('article',{class:'work-log','data-log-id':log.id},el('header',{},el('strong',{},displayDate(log.workDate)),el('div',{},button('수정',()=>{const form=$('#work-log-form');if(form.dataset.dirty==='true'&&!confirm('작성 중인 업무 내용을 버리고 다른 기록을 수정할까요?'))return;form.elements.id.value=log.id;form.elements.workDate.value=log.workDate;form.elements.content.value=log.content;form.dataset.version=log.version;form.dataset.dirty='false';$('#log-cancel').hidden=false;$('#log-save').textContent='기록 수정';form.elements.content.focus();},{class:'plain-button'}),button('삭제',async()=>{if(!confirm('이 업무 기록을 삭제할까요?'))return;await this.run(()=>this.service.deleteWorkLog(log.id,log.version),{refresh:false,success:'기록을 삭제했습니다.'});this.data=await this.service.snapshot();this.renderLogs(taskId);},{class:'plain-button'}))),el('p',{},log.content),el('small',{},'생성 · '+displayInstant(log.createdAt)+' / 수정 · '+displayInstant(log.updatedAt)))));
    if(!logs.length)target.append(el('p',{class:'no-logs'},'아직 업무 수행 기록이 없습니다.'));
  }
  dialogHeader(dialog,title,id){return el('div',{class:'dialog-heading'},el('h2',{id},title),button(icon('close'),()=>{if(this.busy)return;if(this.hasDrafts(dialog)&&!confirm('저장하지 않은 입력을 버리고 닫을까요?'))return;dialog.close();},{class:'icon-button','aria-label':'닫기'}));}
  openProjects(selectedProject=''){
    const dialog=$('#projects-dialog');dialog.replaceChildren(this.dialogHeader(dialog,'프로젝트와 공정','projects-title'),el('p',{class:'section-note'},'로컬 연결 목록입니다. GROUP의 프로젝트나 진척률과 동기화하지 않습니다.'));
    const columns=el('div',{class:'reference-columns'}),projectBox=el('section'),processBox=el('section');columns.append(projectBox,processBox);dialog.append(columns);
    const projectSelect=selectInput('id',[['','새 프로젝트'],...this.data.projects.map(p=>[p.id,p.name])],selectedProject,{'aria-label':'관리할 프로젝트'});
    const projectForm=el('form',{id:'project-form'},el('h3',{},'프로젝트'),projectSelect,field('프로젝트명',el('input',{name:'name',required:true,maxlength:150,placeholder:'프로젝트 이름'})),field('설명',el('textarea',{name:'description',rows:3,maxlength:2000})),el('div',{class:'form-actions'},button('삭제',()=>remove('projects',projectSelect.value),{class:'danger-button'}),el('button',{type:'submit',class:'primary'},'프로젝트 저장')));watchDirty(projectForm);projectBox.append(projectForm);
    const fillProject=()=>{const p=this.data.projects.find(p=>p.id===projectSelect.value);projectForm.elements.name.value=p?.name||'';projectForm.elements.description.value=p?.description||'';projectForm.dataset.version=p?.version||'';projectForm.dataset.dirty='false';renderProcesses();};
    const remove=async(type,id)=>{const item=this.data[type].find(p=>p.id===id);if(!item)return;if(!confirm('선택한 '+(type==='projects'?'프로젝트':'공정')+'을 삭제할까요?'))return;const ok=await this.run(()=>this.service.deleteReference(type,id,item.version));if(ok)this.openProjects(type==='projects'?'':projectSelect.value);};
    const renderProcesses=()=>{
      processBox.replaceChildren(el('h3',{},'소속 공정'));if(!projectSelect.value){processBox.append(el('p',{class:'no-logs'},'프로젝트를 먼저 저장하거나 선택하세요.'));return;}
      const processes=this.data.processes.filter(p=>p.projectId===projectSelect.value),processSelect=selectInput('id',[['','새 공정'],...processes.map(p=>[p.id,p.name])],'',{'aria-label':'관리할 공정'}),processForm=el('form',{id:'process-form'},processSelect,field('공정명',el('input',{name:'name',required:true,maxlength:150,placeholder:'공정 이름'})),el('div',{class:'form-actions'},button('삭제',()=>remove('processes',processSelect.value),{class:'danger-button'}),el('button',{type:'submit',class:'primary'},'공정 저장')));watchDirty(processForm);
      processSelect.onchange=()=>{const p=processes.find(p=>p.id===processSelect.value);processForm.elements.name.value=p?.name||'';processForm.dataset.version=p?.version||'';processForm.dataset.dirty='false';};
      processForm.onsubmit=async event=>{event.preventDefault();const ok=await this.run(()=>this.service.saveProcess({...formValues(processForm),projectId:projectSelect.value},Number(processForm.dataset.version)));if(ok)this.openProjects(projectSelect.value);};processBox.append(processForm);
    };
    projectSelect.onchange=fillProject;projectForm.onsubmit=async event=>{event.preventDefault();let saved;const ok=await this.run(async()=>saved=await this.service.saveProject(formValues(projectForm),Number(projectForm.dataset.version)));if(ok)this.openProjects(saved.id);};fillProject();if(!dialog.open)dialog.showModal();
  }
  openSettings(){
    const dialog=$('#settings-dialog');dialog.replaceChildren(this.dialogHeader(dialog,'설정 및 데이터','settings-title'),el('div',{class:'settings-local'},icon('local'),el('strong',{},'이 브라우저에 저장 · GROUP 미연결')),el('p',{},'데이터는 현재 주소의 브라우저 프로필에 저장됩니다. 다른 기기·브라우저·주소와 자동 동기화되지 않습니다. 브라우저 데이터 삭제 또는 비공개 창 종료 시 데이터가 사라질 수 있으므로 JSON 백업을 보관하세요.'),el('p',{class:'section-note'},'날짜 기준: Asia/Seoul · 마감일/수행일은 YYYY-MM-DD · 생성/수정/완료 시각은 실제 시점으로 저장합니다.'),el('hr'));
    this.addProfileSettings(dialog);
    dialog.append(el('h3',{},'데이터 백업'),el('p',{},'프로젝트, 공정, 상위·하위 할 일, 업무 기록, 저장한 보기, 템플릿, 로컬 프로필과 화면 설정을 버전 2 JSON으로 내보냅니다. 이전 버전 1 백업도 복원할 수 있습니다.'),button([icon('download'),'JSON 내보내기'],async()=>{try{const data=await this.service.exportBackup(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a',{href:url,download:'모아_ToDo_백업_'+todayInSeoul()+'.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.message('JSON 백업을 내려받았습니다.');}catch(error){this.fail(error);}},{id:'export-json',class:'secondary'}));
    const restore=el('input',{type:'file',accept:'.json,application/json',id:'import-json'});restore.onchange=async()=>{const file=restore.files[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('20MB 이하의 백업 파일을 선택하세요.');const data=JSON.parse(await file.text());if(!confirm('현재 로컬 데이터를 이 백업으로 교체할까요? 저장하지 않은 입력도 사라집니다. 먼저 현재 데이터를 내보내세요.'))return;const ok=await this.run(()=>this.service.restoreBackup(data),{refresh:false});if(ok){this.closeDetail(true);$('#quick-title').value='';dialog.close();await this.refresh({initial:true});this.message('백업을 복원했습니다.');}}catch(error){this.fail(error);}finally{restore.value='';}};
    dialog.append(field('JSON 백업 복원 (현재 데이터 교체)',restore),el('hr'),el('h3',{},'로컬 데이터 초기화'),el('p',{},'이 ToDo의 데이터만 삭제합니다. GROUP 서버 데이터에는 접근하지 않습니다.'),button('ToDo 데이터 초기화',async()=>{if(prompt('모든 로컬 ToDo 데이터를 삭제하려면 “초기화”를 입력하세요.')!=='초기화')return;const ok=await this.run(()=>this.service.reset(),{refresh:false});if(ok){this.closeDetail(true);$('#quick-title').value='';dialog.close();await this.refresh({initial:true});this.message('ToDo 로컬 데이터를 초기화했습니다.');}},{id:'reset-data',class:'danger-button'}),el('hr'),el('h3',{},'연결 및 확장'),el('p',{},'현재 로그인·사용자 공유·GROUP API·서버 동기화·푸시 알림은 제공하지 않습니다. 할 일 완료는 GROUP 공정 진척률에 반영되지 않습니다. PC 웹 우선 버전이며 모바일 최적화는 후속 작업입니다.'),el('p',{id:'pwa-settings-status',class:'section-note'},'오프라인은 배포 빌드에서 정적 자산 캐시가 준비된 뒤 사용할 수 있습니다.'));
    dialog.showModal();
  }
}

Object.assign(TodoApp.prototype,workspaceMethods);
