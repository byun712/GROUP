import {STATUSES,PRIORITIES,displayDate,shiftDate,subtaskSummary} from '../domain/model.js';
import {el,button,selectInput} from './dom.js';
export function board(app,tasks){
  const grid=el('div',{class:'board-grid','aria-label':'상태별 보드'});
  for(const [state,label] of Object.entries(STATUSES)){
    const rows=tasks.filter(t=>t.status===state),column=el('section',{class:'board-column','data-status':state},el('h2',{},el('span',{class:'status-badge '+state},label),el('small',{},rows.length)));
    for(const task of rows){const summary=subtaskSummary(app.data,task.id);
      column.append(el('article',{class:'board-card','data-task-id':task.id},
        button(task.title,()=>app.openTask(task.id),{class:'board-title',title:task.title}),
        el('div',{class:'card-properties'},el('span',{},task.dueDate?displayDate(task.dueDate):'날짜 미지정'),el('span',{class:'priority-badge '+task.priority},PRIORITIES[task.priority])),
        summary.total?el('small',{class:'subtask-count'},`하위 작업 ${summary.completed} / ${summary.total} 완료`):null,
        selectInput('status',Object.entries(STATUSES),task.status,{'aria-label':task.title+' 상태',class:'inline-select status-'+task.status,onchange:e=>app.inlineEdit(task,{status:e.target.value},()=>e.target.value=task.status)})));
    }
    if(!rows.length)column.append(el('p',{class:'board-empty'},'표시할 할 일이 없습니다.'));
    grid.append(column);
  }
  return el('div',{class:'board-scroll',tabindex:'0','aria-label':'상태별 보드 가로 스크롤'},grid);
}
export function calendar(app,tasks){
  const month=app.calendarMonth||app.day.slice(0,7),[year,m]=month.split('-').map(Number),first=month+'-01';
  const weekday=new Date(first+'T00:00:00Z').getUTCDay(),start=shiftDate(first,-weekday);
  const move=step=>{const date=new Date(first+'T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+step);if(date.getUTCFullYear()<1900||date.getUTCFullYear()>9999)return;app.calendarMonth=date.toISOString().slice(0,7);app.renderList();};
  const frame=el('section',{class:'calendar-view','aria-label':'마감일 캘린더'},el('div',{class:'calendar-toolbar'},el('h2',{},`${year}년 ${m}월`),button('이전 달',()=>move(-1)),button('이번 달',()=>{app.calendarMonth=app.day.slice(0,7);app.renderList();}),button('다음 달',()=>move(1))));
  const grid=el('div',{class:'calendar-grid'});
  for(const label of ['일','월','화','수','목','금','토'])grid.append(el('div',{class:'weekday'},label));
  for(let i=0;i<42;i++){
    const date=shiftDate(start,i),rows=tasks.filter(t=>t.dueDate===date),cell=el('section',{class:'calendar-day'+(date.startsWith(month)?'':' adjacent')+(date===app.day?' is-today':''),'aria-label':date,'data-date':date});
    cell.append(button(String(Number(date.slice(-2)))+' +',()=>app.openCreate(date),{class:'day-add','aria-label':date+'에 할 일 추가',title:date+'에 할 일 추가'}));
    const items=el('div',{class:'day-items',tabindex:rows.length>3?'0':null,'aria-label':date+' 할 일 '+rows.length+'개'});
    for(const task of rows)items.append(button([el('span',{class:'calendar-dot '+task.status}),task.title],()=>app.openTask(task.id),{class:'calendar-task '+task.status,title:task.title,'data-task-id':task.id}));
    cell.append(items);if(rows.length>3)cell.append(el('small',{class:'day-count'},`${rows.length}개 · 안에서 스크롤`));grid.append(cell);
  }
  frame.append(el('div',{class:'calendar-scroll'},grid));
  const undated=tasks.filter(t=>!t.dueDate),other=tasks.filter(t=>t.dueDate&&!t.dueDate.startsWith(month));
  frame.append(el('div',{class:'undated'},el('h3',{},`날짜 미지정 · ${undated.length}`),...undated.map(task=>button(task.title,()=>app.openTask(task.id),{class:'undated-task',title:task.title,'data-task-id':task.id})),!undated.length?el('p',{},'날짜 미지정 할 일이 없습니다.'):null));
  if(other.length)frame.append(el('p',{class:'calendar-note'},`현재 조건의 다른 달 업무 ${other.length}개 · 이전/다음 달로 이동해 확인하세요.`));
  return frame;
}
export function groupedList(app,tasks){
  const group=app.prefs.groupBy;if(group==='none'||app.prefs.view==='today')return null;
  const groups=new Map();
  for(const task of tasks){let label;
    if(group==='status')label=STATUSES[task.status];if(group==='priority')label=PRIORITIES[task.priority];
    if(group==='project')label=app.data.projects.find(p=>p.id===task.projectId)?.name||'개인 할 일';
    if(group==='date')label=task.dueDate||'날짜 미지정';
    const key=group==='project'?task.projectId:label;if(!groups.has(key))groups.set(key,{label,rows:[]});groups.get(key).rows.push(task);
  }
  return [...groups.values()].map(({label,rows})=>el('section',{},el('h2',{class:'group-heading'},label,el('span',{},rows.length)),app.taskTable(rows)));
}
