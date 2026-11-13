/* An in-page chart workspace. Original boards remain mounted and keep their geometry. */
let expandedComparison=null;
const comparisonOverlay=$('#project-expanded');

function positionExpandedComparison(){
 if(!expandedComparison)return;
 const area=$('#projects').getBoundingClientRect(),board=$('.project-workboard-top').getBoundingClientRect(),topbar=$('.topbar').getBoundingClientRect();
 const top=Math.max(Math.max(0,topbar.bottom)+8,Math.min(board.top,innerHeight-240));
 Object.assign(comparisonOverlay.style,{left:area.left+'px',top:top+'px',width:area.width+'px',height:Math.max(160,innerHeight-top-12)+'px'});
}
function closeExpandedComparison(restoreFocus=true){
 if(!expandedComparison)return;
 const previous=expandedComparison;expandedComparison=null;comparisonOverlay.hidden=true;
 $('#project-expanded-chart').replaceChildren();
 for(const {element,inert,ariaHidden} of previous.covered){element.inert=inert;if(ariaHidden===null)element.removeAttribute('aria-hidden');else element.setAttribute('aria-hidden',ariaHidden);}
 $('#project-comparison-expand').setAttribute('aria-expanded','false');
 const compact=$('#project-comparison .task-column-scroll');if(compact)compact.scrollLeft=previous.compactScroll;
 if(restoreFocus&&!$('#projects').hidden){$('#project-comparison-expand').focus({preventScroll:true});window.scrollTo({left:previous.scrollX,top:previous.scrollY,behavior:'instant'});}
}
function renderExpandedComparison(resetScroll=false){
 if(!expandedComparison)return;
 const project=businessProjects.find(p=>p.id===selectedProjectId);
 if(!project||project.id!==expandedComparison.projectId||$('#projects').hidden){closeExpandedComparison(false);return;}
 const target=$('#project-expanded-chart'),oldScroll=target.querySelector('.task-column-scroll')?.scrollLeft||0;
 const focused=target.contains(document.activeElement)?document.activeElement.closest('[data-comparison-task]')?.dataset.comparisonTask:null;
 const query=$('#project-expanded-search').value.trim().toLocaleLowerCase(),filter=expandedComparison.filter;
 const tasks=project.tasks.filter(t=>(filter==='all'||t.status===filter)&&t.title.toLocaleLowerCase().includes(query));
 $('#project-expanded-project').textContent=project.title;
 $('#project-expanded-count').textContent=`전체 ${project.tasks.length}개 · 현재 표시 ${tasks.length}개`;
 for(const button of comparisonOverlay.querySelectorAll('[data-comparison-filter]'))button.setAttribute('aria-pressed',String(button.dataset.comparisonFilter===filter));
 target.replaceChildren(tasks.length?taskComparisonChart(project,tasks):text('p',project.tasks.length?'검색·필터에 맞는 공정이 없습니다.':'등록된 공정이 없습니다.','empty'));
 const scroller=target.querySelector('.task-column-scroll');if(scroller)scroller.scrollLeft=resetScroll?0:oldScroll;
 if(focused){const replacement=target.querySelector(`[data-comparison-task="${focused}"]`);(replacement||$('#project-comparison-collapse')).focus({preventScroll:true});}
 const done=project.tasks.filter(t=>t.status==='done').length,ordered=[...project.tasks].sort((a,b)=>a.progress-b.progress||a.id-b.id),lowest=ordered[0];
 const summary=$('#project-expanded-summary');summary.replaceChildren(text('strong','프로젝트 전체 기준'),text('span',`전체 진척률 ${projectProgress(project)}%`),text('span',`완료 공정 ${done} / ${project.tasks.length}`));
 const low=text('span',lowest?`가장 낮은 진척률: ${lowest.title} · ${lowest.progress}%${ordered.filter(t=>t.progress===lowest.progress).length>1?' (동률 '+ordered.filter(t=>t.progress===lowest.progress).length+'개)':''}`:'가장 낮은 진척률: 공정 없음','comparison-lowest');
 if(lowest)low.title=ordered.filter(t=>t.progress===lowest.progress).map(t=>t.title+' · '+t.progress+'%').join('\n');summary.append(low);
 positionExpandedComparison();
}
function syncExpandedComparison(){if(expandedComparison)renderExpandedComparison();}
function openExpandedComparison(){
 if(expandedComparison||$('#projects').hidden||!businessProjects.some(p=>p.id===selectedProjectId))return;
 const covered=['#project-overview','#project-comparison-panel','#project-history-panel','#project-cards','#project-detail'].map(selector=>{const element=$(selector);return {element,inert:element.inert,ariaHidden:element.getAttribute('aria-hidden')};});
 expandedComparison={projectId:selectedProjectId,filter:'all',covered,scrollX:window.scrollX,scrollY:window.scrollY,compactScroll:$('#project-comparison .task-column-scroll')?.scrollLeft||0};
 $('#project-expanded-search').value='';comparisonOverlay.hidden=false;comparisonOverlay.scrollTop=0;renderExpandedComparison();
 $('#project-comparison-expand').setAttribute('aria-expanded','true');$('#project-comparison-collapse').focus({preventScroll:true});
 for(const {element} of covered){element.inert=true;element.setAttribute('aria-hidden','true');}
}
$('#project-comparison-expand').onclick=openExpandedComparison;
$('#project-comparison-collapse').onclick=()=>closeExpandedComparison();
$('#project-expanded-search').oninput=()=>renderExpandedComparison(true);
for(const button of comparisonOverlay.querySelectorAll('[data-comparison-filter]'))button.onclick=()=>{if(expandedComparison){expandedComparison.filter=button.dataset.comparisonFilter;renderExpandedComparison(true);}};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&expandedComparison&&!document.querySelector('dialog[open]')){event.preventDefault();closeExpandedComparison();}});
document.addEventListener('workspace-page',event=>{if(event.detail!=='projects'||expandedComparison?.projectId!==selectedProjectId)closeExpandedComparison(false);});
document.addEventListener('groupware-ready',()=>closeExpandedComparison(false));
window.addEventListener('resize',positionExpandedComparison);
window.addEventListener('scroll',positionExpandedComparison,{passive:true});
new ResizeObserver(positionExpandedComparison).observe($('#projects>.panel'));
