// Existing workflow fixtures explicitly receive a generous test-only leave allowance.
// Production addUser always starts with zero allowance; quota-policy tests import server.js directly.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {addUser as createUser} from '../server.js';
export {server,manageUser} from '../server.js';
export function addUser(...args){const result=createUser(...args);const db=new DatabaseSync(resolve(process.env.DATA_DIR,'group.db'));try{const user=db.prepare('SELECT id FROM users WHERE login=?').get(args[0]);for(const year of new Set([2026,2027,new Date().getUTCFullYear()]))for(const pool of ['annual','regular','health','reward'])db.prepare('INSERT OR IGNORE INTO leave_quotas(user_id,year,pool,grant_units) VALUES(?,?,?,2000)').run(user.id,year,pool);}finally{db.close();}return result;}
