import {STATUSES,PRIORITIES,STORES,DEFAULT_PREFERENCES,ValidationError,ConflictError,textValue,dateOnly,todayInSeoul,shiftDate,validPreferences,TASK_ADDITIONS,tagsValue} from './model.js';

const present=(record,label)=>{if(!record)throw new ValidationError(`${label}이(가) 삭제되었거나 존재하지 않습니다.`);return record;};
const checkVersion=(record,version)=>{if(record.version!==version)throw new ConflictError();};
const choice=(map,value,label)=>{if(!Object.hasOwn(map,value))throw new ValidationError(`${label}을 확인하세요.`);return value;};
const blankId=value=>value===null||value===''?null:textValue(value,'연결 ID',200);
export class TodoService {
  constructor(provider,{now=()=>new Date().toISOString(),id=()=>crypto.randomUUID(),onChange=()=>{}}={}){this.provider=provider;this.now=now;this.id=id;this.onChange=onChange;}
  snapshot(){return this.provider.snapshot();}
  entity(){const time=this.now();return {id:this.id(),createdAt:time,updatedAt:time,version:1,externalRef:null,sample:false};}
  updated(record){return {...record,updatedAt:this.now(),version:record.version+1};}
  async write(stores,work){const result=await this.provider.transaction(stores,work);this.onChange();return result;}
  async saveTask(input,version){
    const fields={title:textValue(input.title,'제목',400),description:textValue(input.description??'','설명',20000,false),status:choice(STATUSES,input.status||'todo','상태'),priority:choice(PRIORITIES,input.priority||'none','우선순위'),dueDate:dateOnly(input.dueDate??null,true),projectId:blankId(input.projectId??null),processId:blankId(input.processId??null)};
    return this.write(['tasks','projects','processes','settings','profiles'],async repos=>{
      const old=input.id?present(await repos.tasks.get(input.id),'할 일'):null;
      if(old)checkVersion(old,version);
      const parentId=blankId(input.parentId===undefined?old?.parentId??null:input.parentId);
      if(old && parentId!==(old.parentId??null))throw new ValidationError('기존 할 일의 상위 연결은 변경할 수 없습니다.');
      if(parentId){
        if(parentId===input.id)throw new ValidationError('자신을 상위 할 일로 지정할 수 없습니다.');
        const parent=present(await repos.tasks.get(parentId),'상위 할 일');
        if(parent.parentId)throw new ValidationError('하위 작업은 한 단계까지만 등록할 수 있습니다.');
        fields.projectId=parent.projectId;fields.processId=parent.processId;
      }
      fields.parentId=parentId;
      fields.assigneeId=blankId(input.assigneeId===undefined?old?.assigneeId??null:input.assigneeId);
      if(fields.assigneeId)present(await repos.profiles.get(fields.assigneeId),'로컬 담당자');
      fields.tags=tagsValue(input.tags===undefined?old?.tags??[]:input.tags);
      if(fields.projectId)present(await repos.projects.get(fields.projectId),'프로젝트');
      if(fields.processId){const process=present(await repos.processes.get(fields.processId),'공정');if(process.projectId!==fields.projectId)throw new ValidationError('선택한 프로젝트에 속한 공정을 선택하세요.');}
      const task={...(old?this.updated(old):this.entity()),...fields,completedAt:fields.status==='done'?(old?.completedAt||this.now()):null};
      await repos.tasks.put(task);
      if(old&&!task.parentId&&(old.projectId!==task.projectId||old.processId!==task.processId)){
        for(const child of await repos.tasks.list())if(child.parentId===task.id)await repos.tasks.put({...this.updated(child),projectId:task.projectId,processId:task.processId});
      }
      await this.onboard(repos);return task;
    });
  }
  async deleteTask(id,version){return this.write(['tasks','workLogs'],async repos=>{
    checkVersion(present(await repos.tasks.get(id),'할 일'),version);
    const ids=new Set([id,...(await repos.tasks.list()).filter(t=>t.parentId===id).map(t=>t.id)]);
    for(const log of await repos.workLogs.list())if(ids.has(log.taskId))await repos.workLogs.delete(log.id);
    for(const taskId of ids)await repos.tasks.delete(taskId);
  });}
  async saveWorkLog(input,version){
    textValue(input.content,'업무 내용',30000);
    const fields={taskId:textValue(input.taskId,'할 일 ID',200),workDate:dateOnly(input.workDate),content:input.content};
    return this.write(['tasks','workLogs'],async repos=>{
      present(await repos.tasks.get(fields.taskId),'할 일');const old=input.id?present(await repos.workLogs.get(input.id),'업무 기록'):null;
      if(old){checkVersion(old,version);if(old.taskId!==fields.taskId)throw new ValidationError('업무 기록을 다른 할 일로 옮길 수 없습니다.');}
      const log={...(old?this.updated(old):this.entity()),...fields};await repos.workLogs.put(log);return log;
    });
  }
  async deleteWorkLog(id,version){return this.write(['workLogs'],async repos=>{checkVersion(present(await repos.workLogs.get(id),'업무 기록'),version);await repos.workLogs.delete(id);});}
  async saveProject(input,version){
    const fields={name:textValue(input.name,'프로젝트명',150),description:textValue(input.description??'','설명',2000,false)};
    return this.write(['projects'],async repos=>{const old=input.id?present(await repos.projects.get(input.id),'프로젝트'):null;if(old)checkVersion(old,version);const record={...(old?this.updated(old):this.entity()),...fields};await repos.projects.put(record);return record;});
  }
  async saveProcess(input,version){
    const fields={name:textValue(input.name,'공정명',150),projectId:textValue(input.projectId,'프로젝트',200)};
    return this.write(['projects','processes'],async repos=>{
      present(await repos.projects.get(fields.projectId),'프로젝트');const old=input.id?present(await repos.processes.get(input.id),'공정'):null;
      if(old){checkVersion(old,version);if(old.projectId!==fields.projectId)throw new ValidationError('기존 공정의 소속 프로젝트는 변경할 수 없습니다.');}
      const record={...(old?this.updated(old):this.entity()),...fields};await repos.processes.put(record);return record;
    });
  }
  async deleteReference(type,id,version){
    if(!['projects','processes'].includes(type))throw new ValidationError('삭제 대상을 확인하세요.');
    return this.write(['projects','processes','tasks'],async repos=>{
      checkVersion(present(await repos[type].get(id),'항목'),version);
      if((await repos.tasks.list()).some(task=>task[type==='projects'?'projectId':'processId']===id) || type==='projects'&&(await repos.processes.list()).some(p=>p.projectId===id))throw new ValidationError('연결된 할 일이나 공정이 있습니다. 연결을 먼저 해제해 주세요.');
      await repos[type].delete(id);
    });
  }
  async onboard(repos){const old=await repos.settings.get('preferences');await repos.settings.put({...(old?this.updated(old):this.entity()),id:'preferences',onboarded:true,values:old?.values||DEFAULT_PREFERENCES});}
  async savePreferences(values){return this.provider.transaction(['settings'],async repos=>{
    const old=await repos.settings.get('preferences');await repos.settings.put({...(old?this.updated(old):this.entity()),id:'preferences',values:validPreferences(values)});
  });}
  async seedExamples(){
    return this.write(STORES,async repos=>{
      if((await repos.tasks.list()).length || (await repos.projects.list()).length)throw new ValidationError('예시는 비어 있는 워크스페이스에서만 추가할 수 있습니다.');
      const today=todayInSeoul(new Date(this.now())),project={...this.entity(),name:'브랜드 웹사이트 리뉴얼',description:'로컬 예시 프로젝트입니다. 실제 GROUP 데이터와 연결되지 않았습니다.',sample:true};
      const process={...this.entity(),name:'콘텐츠 기획',projectId:project.id,sample:true};await repos.projects.put(project);await repos.processes.put(process);
      const examples=[
        ['이번 주에 집중할 세 가지 정리','종이에 적어 둔 생각을 한곳에 모아 보세요.\n완료율은 GROUP 공정 진척률과 별개입니다.','todo','medium',today,null,null],
        ['브랜드 소개 페이지 초안 다듬기','첫 문단은 짧고 명확하게.\n\n• 핵심 메시지 정리\n• 팀 피드백 반영','doing','high',today,project.id,process.id],
        ['레퍼런스 자료 검토하고 의견 남기기','기한이 지난 할 일도 오늘 보기에서 놓치지 않도록 모았습니다.','todo','high',shiftDate(today,-2),project.id,process.id],
        ['다음 주 킥오프 준비','논의할 내용과 필요한 자료를 정리합니다.','todo','medium',shiftDate(today,3),project.id,null],
        ['아이디어 메모를 모아 읽기 쉬운 문서로 정리하고 다음 회의에서 함께 검토할 질문 목록 작성하기','긴 제목은 오른쪽 상세 패널에서 전체를 읽고 수정할 수 있습니다.\n기한을 정하지 않은 개인 할 일입니다.','todo','low',null,null,null],
        ['프로젝트 작업 폴더 정리','이 항목은 완료 예시입니다. 필요하면 다시 할 일로 복원할 수 있습니다.','done','none',shiftDate(today,-1),project.id,null]
      ];
      for(let i=0;i<examples.length;i++){
        const [title,description,status,priority,dueDate,projectId,processId]=examples[i],task={...this.entity(),...structuredClone(TASK_ADDITIONS),title,description,status,priority,dueDate,projectId,processId,completedAt:status==='done'?this.now():null,sample:true};await repos.tasks.put(task);
        if(i===1)for(const [workDate,content] of [[shiftDate(today,-1),'기존 소개 페이지를 검토하고 핵심 메시지를 정리했습니다.'],[today,'첫 문단 초안을 작성했습니다.\n다음 작업: 팀 피드백을 받아 문장을 다듬기.']])await repos.workLogs.put({...this.entity(),taskId:task.id,workDate,content,sample:true});
      }await this.onboard(repos);
    });
  }
  async saveProfile(input,version){
    const name=textValue(input.name,'로컬 프로필 이름',100);
    return this.write(['profiles'],async repos=>{
      const old=(await repos.profiles.list())[0];if(old)checkVersion(old,version);
      const profile={...(old?this.updated(old):this.entity()),name};await repos.profiles.put(profile);return profile;
    });
  }
  async saveView(input,version){
    const name=textValue(input.name,'보기 이름',100),preferences=validPreferences(input.preferences);
    if(preferences.kind==='board')preferences.groupBy='status';if(preferences.kind==='calendar')preferences.groupBy='date';
    return this.write(['savedViews'],async repos=>{const old=input.id?present(await repos.savedViews.get(input.id),'저장한 보기'):null;if(old)checkVersion(old,version);const view={...(old?this.updated(old):this.entity()),name,preferences};await repos.savedViews.put(view);return view;});
  }
  async saveTemplate(input,version){
    const fields=templateFields(input);
    return this.write(['templates'],async repos=>{const old=input.id?present(await repos.templates.get(input.id),'템플릿'):null;if(old)checkVersion(old,version);const template={...(old?this.updated(old):this.entity()),...fields};await repos.templates.put(template);return template;});
  }
  async deleteDefinition(type,id,version){
    if(!['savedViews','templates'].includes(type))throw new ValidationError('삭제 대상을 확인하세요.');
    return this.write([type],async repos=>{checkVersion(present(await repos[type].get(id),'항목'),version);await repos[type].delete(id);});
  }
  async createFromTemplate(id,{dueDate=null,projectId=null,processId=null}={}){
    dueDate=dateOnly(dueDate,true);projectId=blankId(projectId);processId=blankId(processId);
    return this.write(['templates','tasks','projects','processes','settings'],async repos=>{
      const template=present(await repos.templates.get(id),'템플릿');
      if(projectId)present(await repos.projects.get(projectId),'프로젝트');
      if(processId&&present(await repos.processes.get(processId),'공정').projectId!==projectId)throw new ValidationError('선택한 프로젝트에 속한 공정을 선택하세요.');
      const common={...structuredClone(TASK_ADDITIONS),status:'todo',completedAt:null,priority:template.priority,tags:[...template.tags],dueDate,projectId,processId};
      const task={...this.entity(),...common,title:template.title,description:template.description};await repos.tasks.put(task);
      for(const title of template.subtasks)await repos.tasks.put({...this.entity(),...common,tags:[...template.tags],title,description:'',dueDate:null,parentId:task.id});
      await this.onboard(repos);return task;
    });
  }
  async exportBackup(){return {format:'group-todo-local-backup',schemaVersion:2,exportedAt:this.now(),timeZone:'Asia/Seoul',data:await this.snapshot()};}
  async restoreBackup(input){const data=validateBackup(input);return this.write(STORES,async repos=>{for(const name of STORES){for(const old of await repos[name].list())await repos[name].delete(old.id);for(const record of data[name])await repos[name].put(record);}});}
  async reset(){return this.write(STORES,async repos=>{for(const name of STORES)for(const record of await repos[name].list())await repos[name].delete(record.id);});}
}

export function validateBackup(input){
  if(input?.format!=='group-todo-local-backup'||![1,2].includes(input.schemaVersion)||!input.data)throw new ValidationError('지원하는 ToDo JSON 백업 파일이 아닙니다 (스키마 버전 1 또는 2).');
  const data=structuredClone(input.data),ids={};
  if(input.schemaVersion===1){for(const name of ['savedViews','templates','profiles'])data[name]=[];if(Array.isArray(data.tasks))data.tasks=data.tasks.map(task=>({...structuredClone(TASK_ADDITIONS),...task}));}
  for(const name of STORES){
    if(!Array.isArray(data[name])||data[name].length>50000)throw new ValidationError('백업 데이터 크기 또는 구조를 확인하세요.');
    ids[name]=new Set();
    for(const row of data[name]){
      if(!row||typeof row!=='object')throw new ValidationError('올바르지 않은 백업 항목입니다.');
      textValue(row.id,'ID',200);if(ids[name].has(row.id))throw new ValidationError('중복된 ID가 있는 백업입니다.');ids[name].add(row.id);
      for(const key of ['createdAt','updatedAt'])if(typeof row[key]!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(row[key])||!Number.isFinite(Date.parse(row[key])))throw new ValidationError('백업 시각 형식을 확인하세요.');
      if(!Number.isSafeInteger(row.version)||row.version<1||typeof row.sample!=='boolean')throw new ValidationError('백업 버전 또는 예시 표식을 확인하세요.');
      if(row.externalRef!==null&&(!row.externalRef||typeof row.externalRef.provider!=='string'||!Object.hasOwn(row.externalRef,'value')))throw new ValidationError('외부 연결 참조를 확인하세요.');
    }
  }
  for(const p of data.projects){textValue(p.name,'프로젝트명',150);textValue(p.description,'프로젝트 설명',2000,false);}
  for(const p of data.processes){textValue(p.name,'공정명',150);if(!ids.projects.has(p.projectId))throw new ValidationError('공정의 프로젝트 연결이 올바르지 않습니다.');}
  for(const task of data.tasks){
    textValue(task.title,'제목',400);textValue(task.description,'설명',20000,false);choice(STATUSES,task.status,'상태');choice(PRIORITIES,task.priority,'우선순위');dateOnly(task.dueDate,true);
    if(task.projectId!==null&&!ids.projects.has(task.projectId))throw new ValidationError('할 일의 프로젝트 연결이 올바르지 않습니다.');
    if(task.processId!==null&&!data.processes.some(p=>p.id===task.processId&&p.projectId===task.projectId))throw new ValidationError('할 일의 공정 연결이 올바르지 않습니다.');
    if(task.parentId!==null){const parent=data.tasks.find(t=>t.id===task.parentId);if(!parent||parent.id===task.id||parent.parentId||parent.projectId!==task.projectId||parent.processId!==task.processId)throw new ValidationError('하위 작업의 상위 연결 또는 소속을 확인하세요.');}
    if(task.assigneeId!==null&&!ids.profiles.has(task.assigneeId))throw new ValidationError('로컬 담당자 연결을 확인하세요.');
    task.tags=tagsValue(task.tags);
    if(task.status==='done'?typeof task.completedAt!=='string'||!Number.isFinite(Date.parse(task.completedAt)):task.completedAt!==null)throw new ValidationError('완료 시각을 확인하세요.');
  }
  for(const log of data.workLogs){if(!ids.tasks.has(log.taskId))throw new ValidationError('업무 기록의 할 일 연결이 올바르지 않습니다.');dateOnly(log.workDate);textValue(log.content,'업무 내용',30000);}
  for(const setting of data.settings){if(setting.id!=='preferences')throw new ValidationError('알 수 없는 화면 설정입니다.');setting.values=validPreferences(setting.values);setting.onboarded=setting.onboarded===true;}
  if(data.profiles.length>1)throw new ValidationError('로컬 프로필은 하나만 사용할 수 있습니다.');
  for(const profile of data.profiles)textValue(profile.name,'로컬 프로필 이름',100);
  for(const view of data.savedViews){textValue(view.name,'보기 이름',100);view.preferences=validPreferences(view.preferences);}
  for(const template of data.templates)Object.assign(template,templateFields(template));
  return Object.fromEntries(STORES.map(name=>[name,data[name]]));
}

function templateFields(input){
  const subtasks=input.subtasks??[];
  if(!Array.isArray(subtasks)||subtasks.length>100)throw new ValidationError('템플릿 하위 작업은 최대 100개입니다.');
  return {name:textValue(input.name,'템플릿 이름',100),title:textValue(input.title,'제목',400),description:textValue(input.description??'','설명',20000,false),priority:choice(PRIORITIES,input.priority??'none','우선순위'),tags:tagsValue(input.tags),subtasks:subtasks.map(title=>textValue(title,'하위 작업 제목',400))};
}
