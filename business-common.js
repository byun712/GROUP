export class InputError extends Error{}
export function check(condition,message){if(!condition)throw new InputError(message);}
export function text(value,max,required=true){return typeof value==='string'&&value.length<=max&&(!required||!!value.trim());}
export function date(value){return typeof value==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function money(value){return Number.isSafeInteger(value)&&value>0&&value<=1000000000000;}
export function operator(user){return !!user.is_admin||['manager','ceo'].includes(user.role);}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
