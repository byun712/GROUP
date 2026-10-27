const $=s=>document.querySelector(s);let me;
const statuses={manager:'실장 승인 대기',ceo:'대표이사 승인 대기',approved:'승인 완료',rejected:'반려',withdrawn:'회수'};
const actions={approve:'승인',reject:'반려',withdraw:'회수'};
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
function notice(e){$('#message').textContent=e.message||e;}
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
const time=s=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—';
async function refresh(){const [leaves,records]=await Promise.all([api('leaves'),api('attendance')]);$('#documents').replaceChildren();if(!leaves.length)$('#documents').append(text('p','등록된 문서가 없습니다.'));for(const l of leaves){const a=document.createElement('article');a.append(text('strong',`${l.name} · ${l.kind} · ${statuses[l.status]}`),text('p',`${l.start} ~ ${l.end}\n${l.reason}`));for(const h of l.history)a.append(text('small',`${h.name} · ${actions[h.action]} · ${time(h.created)}`));const choices=[];if(l.user_id===me.user.id&&l.status==='manager')choices.push('withdraw');if(l.user_id!==me.user.id&&l.status===me.user.role)choices.push('approve','reject');for(const action of choices){const b=text('button',actions[action]);b.onclick=()=>run(async()=>{await api(`leaves/${l.id}/action`,{action});await refresh();});a.append(b);}$('#documents').append(a);}$('#records').replaceChildren();for(const r of records)$('#records').append(text('p',`${r.day} · 출근 ${time(r.clock_in)} / 퇴근 ${time(r.clock_out)}`));}
async function run(fn){$('#message').textContent='';try{await fn();}catch(e){notice(e);}}
async function boot(){me=await api('me');$('#login').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;$('#welcome').textContent=`${me.user.name}님, 안녕하세요.`;$('#network').textContent=me.officeAllowed?'사무실 네트워크 · 출퇴근 등록 가능':'사외 네트워크 · 결재와 메일 이용 가능';$('#clock-in').disabled=$('#clock-out').disabled=!me.officeAllowed;$('#mail-description').textContent=me.mailAllowed?'공용 메일함: soltec@elsoltec.com · 실장 전용':'개인 메일은 웹메일에서 이용해 주세요. 공용 메일함은 실장 전용입니다.';$('#mfa-status').textContent=me.user.mfaEnabled?'2단계 인증 사용 중':'2단계 인증 미등록 · 운영 환경에서는 등록 후 업무 기능을 사용할 수 있습니다.';$('#mfa-setup').hidden=!!me.user.mfaEnabled;if(!me.user.mfaEnabled){document.querySelector('[data-tab=security]').click();}try{await refresh();}catch(e){notice(e);}}
$('#login-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('login',Object.fromEntries(new FormData(e.target)));e.target.reset();await boot();});};
$('#leave-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('leaves',Object.fromEntries(new FormData(e.target)));e.target.reset();await refresh();notice('휴가 신청을 등록했습니다.');});};
$('#logout').onclick=()=>run(async()=>{await api('logout',{});location.reload();});
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const id of ['leave','attendance','mail','security'])$('#'+id).hidden=id!==b.dataset.tab;};
for(const action of ['in','out'])$('#clock-'+action).onclick=()=>run(async()=>{await api('attendance',{action});await refresh();notice('등록했습니다.');});
boot().catch(e=>{if(e.message!=='로그인이 필요합니다')notice(e);});

$('#mfa-setup').onsubmit=e=>{e.preventDefault();run(async()=>{const result=await api('security/mfa/setup',Object.fromEntries(new FormData(e.target)));e.target.reset();$('#mfa-secret').textContent=result.secret;$('#mfa-enroll').hidden=false;});};
$('#mfa-confirm').onsubmit=e=>{e.preventDefault();run(async()=>{await api('security/mfa/confirm',Object.fromEntries(new FormData(e.target)));e.target.reset();$('#mfa-secret').textContent='';$('#mfa-enroll').hidden=true;await boot();notice('2단계 인증 등록이 완료되었습니다. 다음 로그인부터 새로운 인증 코드가 필요합니다.');});};
$('#password-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('security/password',Object.fromEntries(new FormData(e.target)));location.reload();});};

let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install-app').hidden=false;});
$('#install-app').onclick=()=>run(async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#install-app').hidden=true;});
window.addEventListener('appinstalled',()=>{$('#install-app').hidden=true;installPrompt=null;});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>notice('앱 설치 기능을 사용할 수 없습니다. 브라우저에서는 계속 이용할 수 있습니다.'));
$('#export-month').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
$('#export-form').onsubmit=event=>{event.preventDefault();run(async()=>{const response=await fetch('/api/attendance/export?month='+encodeURIComponent($('#export-month').value));if(!response.ok){const error=await response.json();throw Error(error.error);}const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='attendance-'+$('#export-month').value+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
