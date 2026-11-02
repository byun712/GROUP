import {expenseAttachmentList,prepareExpenseAttachments,saveExpenseAttachments} from './expense-attachments.js';
import {documentTypes,canEditDocument,canResubmitDocument,canReapproveDocument} from './document-state.js';
import {canRejectAfterApproval} from './document-deletion.js';
import {validateDraft,approvalTemplates} from './approvals.js';
import {reportTemplates} from './report-templates.js';
import {validateExpense} from './expenses.js';
import {replaceLeaveCharges,assertLeaveApproval,LEAVE_KINDS} from './leave-management.js';
import {captureSignature} from './signatures.js';
import {postApprovedExpense} from './accounting.js';
import {InputError} from './business-common.js';

function editedValues(source,row,body) {
  if (source==='leaves') {
    if (!LEAVE_KINDS.includes(body.kind)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000)
      throw new InputError('휴가 종류·기간·사유를 확인하세요');
    return {kind:body.kind,start:body.start,end:body.end,reason:body.reason.trim()};
  }
  try {
    if (source==='expenses') {
      // Retired research forms remain editable without reintroducing them in the new-form menu.
      const values=validateExpense({...body,form_type:row.form_type},{allowResearch:row.form_type==='research_expense'});
      return {...values,items:JSON.stringify(values.items)};
    }
    if (body.template_id!==row.template_id) throw Error('수정 시 문서 양식을 변경할 수 없습니다');
    const values=validateDraft(body,source==='reports'?reportTemplates:approvalTemplates);
    return {...values,fields:JSON.stringify(values.fields)};
  } catch(e) {throw new InputError(e.message);}
}

export function documentWorkflowApi(db,path,method,user,body,send) {
  const match=path.match(/^\/api\/(leaves|expenses|approvals|reports)\/(\d+)\/(update|resubmit|action)$/);
  if (!match||method!=='POST') return false;
  const [,source,idText,operation]=match,t=documentTypes[source],id=Number(idText);
  db.exec('BEGIN IMMEDIATE');
  const stop=(status,error)=>{db.exec('ROLLBACK');send(status,{error});return true;};
  try {
    const row=db.prepare(`SELECT * FROM ${t.table} WHERE id=?`).get(id);
    if (!row||['approvals','reports'].includes(source)&&reportTemplates.some(t=>t.id===row.template_id)!==(source==='reports'))
      return stop(404,'문서가 없습니다');
    let action,stage,next=row.status,round=row.approval_round;
    if (operation==='update') {
      if (!canEditDocument(row,user)) return stop(403,'작성자만 이사 승인 전 또는 반려·회수 문서를 수정할 수 있습니다');
      action='edit';stage='author';
    } else if (operation==='resubmit') {
      if (!canResubmitDocument(row,user)) return stop(403,'작성자만 반려·회수 문서를 재상신할 수 있습니다');
      action='resubmit';stage='author';next='manager';round++;
    } else {
      action=body.action;stage=action==='withdraw'?'author':user.role;
      if (action==='reject'&&canRejectAfterApproval(db,source,row,user)) next='rejected';
      else if (action==='approve'&&canReapproveDocument(db,source,row,user)) next='ceo';
      else if (action==='withdraw'&&row.user_id===user.id&&row.status==='manager') next='withdrawn';
      else if (row.status===user.role&&['approve','reject'].includes(action)) next=action==='reject'?'rejected':user.role==='manager'?'ceo':'approved';
      else return stop(403,'현재 단계에서 처리할 권한이 없습니다');
    }
    // Editing/resubmission always requires the version viewed by the author.
    // Optional for older action clients; all current UI actions send it.
    if ((operation!=='action'||body.expected_version!==undefined)&&body.expected_version!==row.version)
      return stop(409,'문서 내용 또는 결재 상태가 변경되었습니다. 문서를 다시 조회하세요');
    const before=source==='expenses'?{...row,attachments:expenseAttachmentList(db,row.id)}:row;
    if (operation==='update') {
      const files=source==='expenses'?prepareExpenseAttachments(db,body.attachments,id):null;
      const values=editedValues(source,row,body);
      if (source==='leaves'&&(values.kind!==row.kind||values.start!==row.start||values.end!==row.end))
        replaceLeaveCharges(db,row,values);
      const columns=Object.keys(values);
      db.prepare(`UPDATE ${t.table} SET ${columns.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...Object.values(values),id);
      if(files)saveExpenseAttachments(db,id,files);
    }
    // Inactive requests must reacquire their allowance before they become pending/approved.
    if (source==='leaves'&&(action==='approve'||action==='resubmit')) assertLeaveApproval(db,row);
    db.prepare(`UPDATE ${t.table} SET status=?,approval_round=?,version=version+1,ceo_processed=max(ceo_processed,?) WHERE id=?`)
      .run(next,round,Number(stage==='ceo'&&['approve','reject'].includes(action)),id);
    const created=new Date().toISOString();
    const decision=db.prepare(`INSERT INTO ${t.history}(${t.key},actor,action,created,decision_stage,approval_round,document_snapshot) VALUES(?,?,?,?,?,?,?)`)
      .run(id,user.id,action,created,stage,round,JSON.stringify(before));
    captureSignature(db,source,decision.lastInsertRowid,user,created);
    if (source==='expenses'&&next==='approved') postApprovedExpense(db,row,user.id);
    db.exec('COMMIT');send(200,{ok:true,id,version:row.version+1,approval_round:round});return true;
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
