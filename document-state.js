export const documentTypes = {
  leaves: {table:'leave_requests',history:'decisions',key:'leave_id'},
  expenses: {table:'expense_requests',history:'expense_decisions',key:'expense_id'},
  approvals: {table:'approval_requests',history:'approval_decisions',key:'request_id'},
  reports: {table:'approval_requests',history:'approval_decisions',key:'request_id'}
};

export function initializeDocumentWorkflow(db) {
  for (const t of Object.values(documentTypes).slice(0,3)) {
    for (const [table,column,definition] of [
      [t.table,'version','INTEGER NOT NULL DEFAULT 1'],
      [t.table,'approval_round','INTEGER NOT NULL DEFAULT 1'],
      [t.history,'approval_round','INTEGER NOT NULL DEFAULT 1'],
      [t.history,'document_snapshot',"TEXT NOT NULL DEFAULT ''"]
    ]) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const canEditDocument = (row,user) => row.user_id===user.id && ['manager','rejected','withdrawn'].includes(row.status);
export const canResubmitDocument = (row,user) => canEditDocument(row,user) && ['rejected','withdrawn'].includes(row.status);

// A director can reconsider their own rejection. CEO rejections require author resubmission.
export function canReapproveDocument(db,source,row,user) {
  if (user.role!=='manager'||row.status!=='rejected') return false;
  const t=documentTypes[source];
  const last=db.prepare(`SELECT actor,action,decision_stage FROM ${t.history} WHERE ${t.key}=? AND approval_round=? AND action IN ('approve','reject') ORDER BY id DESC LIMIT 1`).get(row.id,row.approval_round);
  return !!last && last.actor===user.id && last.action==='reject' && last.decision_stage==='manager';
}

export function documentPermissions(db,source,row,user) {
  return {can_edit:canEditDocument(row,user),can_resubmit:canResubmitDocument(row,user),can_reapprove:canReapproveDocument(db,source,row,user)};
}
