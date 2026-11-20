/** Local contracts. External references are opaque, not a GROUP API schema.
 * @typedef {{provider:string, value:unknown}|null} ExternalRef
 * @typedef {{id:string, createdAt:string, updatedAt:string, version:number, externalRef:ExternalRef, sample:boolean}} Entity
 * @typedef {Entity & {name:string, description:string}} Project
 * @typedef {Entity & {name:string, projectId:string}} Process
 * @typedef {Entity & {title:string, description:string, status:'todo'|'doing'|'done', priority:'none'|'low'|'medium'|'high', dueDate:string|null, projectId:string|null, processId:string|null, completedAt:string|null,parentId:string|null,assigneeId:string|null,tags:string[]}} Task
 * @typedef {Entity & {taskId:string, workDate:string, content:string}} WorkLog
 * @typedef {Entity & {name:string,preferences:Object}} SavedView
 * @typedef {Entity & {name:string,title:string,description:string,priority:string,tags:string[],subtasks:string[]}} TaskTemplate
 * @typedef {Entity & {name:string}} LocalProfile
 */
export const STATUSES = {todo:'할 일', doing:'진행 중', done:'완료'};
export const PRIORITIES = {high:'높음', medium:'보통', low:'낮음', none:'없음'};
export const VIEWS = {all:'전체 할 일', today:'오늘', upcoming:'예정', projects:'프로젝트', done:'완료'};
export const DEFAULT_PREFERENCES = {view:'all', projectId:'', search:'', status:'', priority:'', sort:'created', includeCompleted:false,kind:'list',processId:'',assigneeId:'',tag:'',due:'',dueFrom:'',dueTo:'',groupBy:'none'};
export const LEGACY_STORES = ['projects', 'processes', 'tasks', 'workLogs', 'settings'];
export const STORES = [...LEGACY_STORES, 'savedViews', 'templates', 'profiles'];
export const TASK_ADDITIONS = {parentId:null,assigneeId:null,tags:[]};
export const VIEW_KINDS = {list:'목록',board:'보드',calendar:'캘린더'};
export class ValidationError extends Error {}
export class ConflictError extends Error {
  constructor(){ super('다른 창에서 이 항목이 변경되었습니다. 입력 내용은 보존했습니다. 최신 항목을 다시 열고 변경 사항을 확인해 주세요.'); }
}
export function textValue(value, label, max, required=true){
  if(typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new ValidationError(`${label}${required?'을(를) 입력하세요.':''} 최대 ${max.toLocaleString()}자입니다.`);
  return required ? value.trim() : value;
}
export function dateOnly(value, optional=false){
  if(optional && (value===null || value==='')) return null;
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError('날짜는 YYYY-MM-DD 형식으로 입력하세요.');
  const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
  if(y<1900 || date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d) throw new ValidationError('올바른 날짜를 입력하세요 (1900년 이후).');
  return value;
}
export function todayInSeoul(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
export function shiftDate(value,days){
  dateOnly(value);const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
export function displayDate(value){
  if(!value)return '마감일 없음';
  dateOnly(value);return new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',month:'long',day:'numeric',weekday:'short'}).format(new Date(value+'T00:00:00Z'));
}
export function displayInstant(value){
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
}
export function validPreferences(input={}){
  if(!input||typeof input!=='object')input={};
  return {...DEFAULT_PREFERENCES,
    view:Object.hasOwn(VIEWS,input.view)?input.view:'all',projectId:typeof input.projectId==='string'?input.projectId:'',
    search:typeof input.search==='string'?input.search.slice(0,400):'',status:Object.hasOwn(STATUSES,input.status)?input.status:'',
    priority:Object.hasOwn(PRIORITIES,input.priority)?input.priority:'',sort:['created','due','priority','title','updated'].includes(input.sort)?input.sort:'created',
    includeCompleted:input.includeCompleted===true,
    kind:Object.hasOwn(VIEW_KINDS,input.kind)?input.kind:'list',
    processId:typeof input.processId==='string'?input.processId:'',assigneeId:typeof input.assigneeId==='string'?input.assigneeId:'',
    tag:typeof input.tag==='string'?input.tag.slice(0,40):'',due:['','none','overdue','today','future','range'].includes(input.due)?input.due:'',
    dueFrom:validFilterDate(input.dueFrom),dueTo:validFilterDate(input.dueTo),groupBy:['none','status','priority','project','date'].includes(input.groupBy)?input.groupBy:'none'};
}
function validFilterDate(value){try{return value?dateOnly(value):'';}catch{return '';}}
export function selectTasks(snapshot,prefs,today=todayInSeoul()){
  const p=validPreferences(prefs),query=p.search.trim().toLocaleLowerCase('ko-KR');
  const rows=snapshot.tasks.filter(task=>{
    if(task.parentId)return false;
    if(p.view==='done' ? task.status!=='done' : !p.includeCompleted && task.status==='done')return false;
    if(p.view==='today' && (!task.dueDate || task.dueDate>today || task.status==='done'))return false;
    if(p.view==='upcoming' && (!task.dueDate || task.dueDate<=today || task.status==='done'))return false;
    if(p.view==='projects' && (p.projectId==='personal'?!!task.projectId:p.projectId?task.projectId!==p.projectId:!task.projectId))return false;
    if(p.view!=='projects' && p.projectId && (p.projectId==='personal'?!!task.projectId:task.projectId!==p.projectId))return false;
    if(p.processId && (p.processId==='none'?!!task.processId:task.processId!==p.processId))return false;
    const assignee=p.assigneeId==='me'?snapshot.profiles?.[0]?.id:p.assigneeId;
    if(p.assigneeId && (p.assigneeId==='none'?!!task.assigneeId:!assignee||task.assigneeId!==assignee))return false;
    if(p.tag && !(task.tags||[]).includes(p.tag))return false;
    if(p.due==='none' && task.dueDate || p.due==='overdue' && (!task.dueDate||task.dueDate>=today) || p.due==='today' && task.dueDate!==today || p.due==='future' && (!task.dueDate||task.dueDate<=today))return false;
    if(p.due==='range' && (!task.dueDate||p.dueFrom&&task.dueDate<p.dueFrom||p.dueTo&&task.dueDate>p.dueTo))return false;
    return (!p.status || task.status===p.status) && (!p.priority || task.priority===p.priority) && (!query || (task.title+'\n'+task.description).toLocaleLowerCase('ko-KR').includes(query));
  });
  const priority={high:0,medium:1,low:2,none:3},sort=p.view==='upcoming'?'due':p.sort;
  rows.sort((a,b)=>{
    // Today stays divided into overdue and today's work, regardless of secondary sort.
    if(p.view==='today'){const group=Number(a.dueDate===today)-Number(b.dueDate===today);if(group)return group;}
    let result=0;
    if(sort==='due')result=(a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99');
    if(sort==='priority')result=priority[a.priority]-priority[b.priority];
    if(sort==='title')result=a.title.localeCompare(b.title,'ko');
    if(sort==='created')result=b.createdAt.localeCompare(a.createdAt);
    if(sort==='updated')result=b.updatedAt.localeCompare(a.updatedAt);
    return result || a.id.localeCompare(b.id);
  });return rows;
}

export function subtaskSummary(snapshot,taskId){
  const children=snapshot.tasks.filter(t=>t.parentId===taskId);
  const completed=children.filter(t=>t.status==='done').length;
  return {total:children.length,completed,percent:children.length?Math.round(completed/children.length*100):null};
}
export function projectSummary(snapshot,projectId){
  const tasks=snapshot.tasks.filter(t=>!t.parentId && (projectId==='personal'?!t.projectId:projectId?t.projectId===projectId:!!t.projectId));
  const completed=tasks.filter(t=>t.status==='done').length;
  return {total:tasks.length,completed,percent:tasks.length?Math.round(completed/tasks.length*100):null};
}
export function tagsValue(value=[]){
  if(typeof value==='string')value=value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!Array.isArray(value)||value.length>20)throw new ValidationError('태그는 최대 20개까지 입력하세요.');
  return [...new Set(value.map(tag=>textValue(tag,'태그',40)))];
}
