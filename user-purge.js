// Hard deletion only: no inactive-user copy, trash bin or retained account audit.
export function purgeUser(db,id){
 db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
 try{
  db.prepare('DELETE FROM decision_signatures WHERE actor=?').run(id);db.prepare('DELETE FROM user_seals WHERE user_id=?').run(id);
  for(const [source,history,key,parent] of [['leaves','decisions','leave_id','leave_requests'],['expenses','expense_decisions','expense_id','expense_requests'],['approvals','approval_decisions','request_id','approval_requests']])db.prepare(`DELETE FROM decision_signatures WHERE source=? AND decision_id IN (SELECT d.id FROM ${history} d JOIN ${parent} p ON p.id=d.${key} WHERE p.user_id=?)`).run(source,id);
  db.prepare("INSERT OR IGNORE INTO ledger_exclusions(source_type,source_id) SELECT source_type,source_id FROM journal_entries WHERE posted_by=? AND source_type='expense_approval' AND source_id NOT IN (SELECT id FROM expense_requests WHERE user_id=?)").run(id,id);
  db.prepare("DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE posted_by=? OR (source_type IN ('expense_approval','expense_payment') AND source_id IN (SELECT id FROM expense_requests WHERE user_id=?)))").run(id,id);
  db.prepare("DELETE FROM journal_entries WHERE posted_by=? OR (source_type IN ('expense_approval','expense_payment') AND source_id IN (SELECT id FROM expense_requests WHERE user_id=?))").run(id,id);
  db.prepare('DELETE FROM ledger_exclusions WHERE source_id IN (SELECT id FROM expense_requests WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM leave_charges WHERE leave_id IN (SELECT id FROM leave_requests WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM leave_grant_history WHERE actor=? OR user_id=?').run(id,id);db.prepare('DELETE FROM leave_quotas WHERE user_id=?').run(id);db.prepare('DELETE FROM leave_profiles WHERE user_id=?').run(id);
  for(const [child,parent,key] of [['decisions','leave_requests','leave_id'],['expense_decisions','expense_requests','expense_id'],['approval_decisions','approval_requests','request_id']]){db.prepare(`DELETE FROM ${child} WHERE actor=? OR ${key} IN (SELECT id FROM ${parent} WHERE user_id=?)`).run(id,id);db.prepare(`DELETE FROM ${parent} WHERE user_id=?`).run(id);}
  db.prepare("DELETE FROM schedule_changes WHERE EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(snapshot) THEN json_extract(snapshot,'$.participant_ids') ELSE '[]' END) WHERE value=?)").run(id);
  db.prepare('DELETE FROM schedule_changes WHERE actor=? OR event_id IN (SELECT id FROM schedule_events WHERE user_id=? UNION SELECT event_id FROM schedule_participants WHERE user_id=?)').run(id,id,id);
  db.prepare('DELETE FROM schedule_participants WHERE user_id=? OR event_id IN (SELECT id FROM schedule_events WHERE user_id=?)').run(id,id);
  db.prepare('DELETE FROM schedule_events WHERE user_id=?').run(id);
  db.prepare('UPDATE schedule_events SET project_id=NULL WHERE project_id IN (SELECT id FROM projects WHERE owner_id=?)').run(id);
  db.prepare('DELETE FROM project_updates WHERE actor=? OR task_id IN (SELECT id FROM project_tasks WHERE assignee_id=? OR project_id IN (SELECT id FROM projects WHERE owner_id=?))').run(id,id,id);
  db.prepare('DELETE FROM project_tasks WHERE assignee_id=? OR project_id IN (SELECT id FROM projects WHERE owner_id=?)').run(id,id);
  db.prepare('DELETE FROM project_changes WHERE actor=? OR project_id IN (SELECT id FROM projects WHERE owner_id=?)').run(id,id);
  db.prepare('DELETE FROM projects WHERE owner_id=?').run(id);
  db.prepare('UPDATE projects SET customer_id=NULL WHERE customer_id IN (SELECT id FROM customers WHERE created_by=?)').run(id);
  db.prepare('DELETE FROM customer_contacts WHERE created_by=? OR customer_id IN (SELECT id FROM customers WHERE created_by=?)').run(id,id);
  db.prepare('DELETE FROM customers WHERE created_by=?').run(id);
  db.prepare('DELETE FROM mail_attachments WHERE message_id IN (SELECT m.id FROM mail_messages m JOIN mail_accounts a ON a.id=m.account_id WHERE a.user_id=?)').run(id);
  db.prepare('DELETE FROM mail_messages WHERE account_id IN (SELECT id FROM mail_accounts WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM mail_rules WHERE account_id IN (SELECT id FROM mail_accounts WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM mail_folders WHERE account_id IN (SELECT id FROM mail_accounts WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM mail_preferences WHERE account_id IN (SELECT id FROM mail_accounts WHERE user_id=?)').run(id);
  db.prepare('DELETE FROM mail_accounts WHERE user_id=?').run(id);
  for(const [table,column] of [['attendance','user_id'],['sessions','user_id'],['announcements','author']])db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(id);
  db.prepare('DELETE FROM account_audit WHERE actor=? OR target=?').run(id,id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}
