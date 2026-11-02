// Generate real API exports for inspection in Excel/Calc. Uses a disposable database.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'group-print-'));process.env.DATA_DIR=dir;process.env.NODE_ENV='development';delete process.env.PUBLIC_ORIGIN;
const {server,addUser}=await import('../test-support/server.js');
for(const [login,name,role] of [['staff','홍길동','employee'],['director','결재 이사','manager'],['ceo','대표이사','ceo']])addUser(login,name,role,'print-validation-123');
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,out=resolve(process.env.PRINT_OUTPUT_DIR||'/tmp/group-excel-print');mkdirSync(out,{recursive:true});
async function call(path,cookie,body){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.ok,true,await (!r.ok?r.text():Promise.resolve(path)));return r;}
try{
 const cookies={};for(const login of ['staff','director','ceo'])cookies[login]=(await call('login','',{login,password:'print-validation-123'})).headers.get('set-cookie').split(';')[0];
 for(const role of ['director','ceo'])await call('seal',cookies[role],{content_type:'image/png',base64:readFileSync(new URL('../public/icon-192.png',import.meta.url)).toString('base64')});
 const paragraphs=[
  '10월 28일 (수): 워크숍 및 학술대회 참가',
  '09:30–10:10  학술대회 등록 및 기술 자료 접수',
  '10:10–11:00  분과별 학술 발표 / 감속·압력시험 결과 토의',
  '주요 참석 분야: AI 및 데이터 기반 시스템 · 미래 에너지 · 기계 설계',
  '',
  '10월 29일 (목): 학술발표 및 현장 기술 교류',
  '발표 제목: LES Analysis of a 1/5-Scale i-SMR CVAP Model for Pressure PSD Generation',
  '주요 결과 요약 (Summary): 유동 특성, 압력 진동 및 구조 안정성에 대한 수치해석 결과를 비교했습니다.',
  '수치해석 방법 (Methods): CFD, SST k-omega, Reynolds number 1.4 × 10⁶, ΔP = 3.25 kPa.',
  '계측 주파수 20–200 Hz; σ = 0.015; 검증 구간 0 ≤ t ≤ 60 s; 압력 변화율 ±2.5%.',
  '결과 및 토의 (Results & Conclusions): 원문 영어 단어와 한글 간격이 겹치지 않고 숫자·괄호·기호도 읽을 수 있어야 합니다.',
  '긴 식별자 확인: WWWMMMM_pressurePSD_generation_without_spaces_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '',
  '10월 30일 (금): 공동 연구 검토 및 후속 일정 정리',
  '후속 조치: 실험 결과를 정리하고 고객사에 검토 자료를 전달합니다. 다음 회의에서 추가 시험 조건을 확정합니다.'
 ];
 const longContent=[...paragraphs,'',...paragraphs,'',...paragraphs,'', '마지막 문장: 본문 누락과 페이지 잘림 없이 출력 검증을 완료했습니다.'].join('\n');
 const docs=[
  ['trip-report','approvals',{template_id:'trip_report',title:'출장보고서 — 학술대회 참석 및 i-SMR 공동 연구 기술 교류 결과 보고',fields:{start_date:'2026-10-28',end_date:'2026-10-30',destination:'경주 학술대회장',content:longContent}}],
  ['daily-log','reports',{template_id:'daily_work_log',title:'일일업무일지 — 한글·영문 혼합 장문 인쇄 검증',fields:{report_date:'2026-11-02',completed_work:longContent,planned_work:'내일 실시할 업무\n고객사 의견 수렴 및 내부 회의\n'+paragraphs.join('\n'),ongoing_work:'진행업무 최종 문장',notes:'특이사항 최종 문장'}}],
  ['expense','expenses',{title:'출장 경비 정산 및 학술대회 참가 비용',expense_date:'2026-11-02',vendor:'학술대회 운영사',payment:'법인카드',evidence_type:'영수증',notes:'증빙 원본은 별도로 보관합니다.',items:Array.from({length:20},(_,i)=>({category:'기타',description:`항목 ${i+1}: 학술대회 참가 및 교통·숙박 비용 상세 내역`,supply:i===19?900000000000:100000,tax:10000}))}],
  ['leave','leaves',{kind:'연차',start:'2026-11-04',end:'2026-11-04',reason:'개인 일정으로 연차를 신청합니다. 승인 날짜와 서명이 정상 출력되어야 합니다.'}]
 ];
 const manifest=[];
 for(const [name,source,body] of docs){
  const {id}=await (await call(source,cookies.staff,body)).json();for(const role of ['director','ceo'])await call(`${source}/${id}/action`,cookies[role],{action:'approve'});
  const buffer=Buffer.from(await (await call(`${source}/${id}/excel`,cookies.staff)).arrayBuffer());writeFileSync(join(out,name+'.xlsx'),buffer);manifest.push({name,source,body});
 }
 const templates=[...await (await call('approval-templates',cookies.staff)).json(),...await (await call('report-templates',cookies.staff)).json()];
 for(const template of templates){const fields=Object.fromEntries((template.fields||[]).map(f=>[f.key,f.type==='money'?125000:f.type==='date'?'2026-11-02':f.type==='time'?'09:30':f.type==='select'?f.options[0]:'출력 확인: 한글과 English 123']));writeFileSync(join(out,'template-'+template.id+'.xlsx'),Buffer.from(await (await call('forms/export',cookies.staff,{template_id:template.id,title:template.name+' 인쇄 확인',fields})).arrayBuffer()));}
 writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(`Generated ${docs.length} approved documents and ${templates.length} templates in ${out}`);
}finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
