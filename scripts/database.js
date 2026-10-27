import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,openSync,closeSync,chmodSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function snapshot(source,target){
 source=resolve(source);target=resolve(target);
 if(source===target)throw Error('원본과 대상 경로는 달라야 합니다');
 let db;let reserved=false;
 try{
  db=new DatabaseSync(source,{readOnly:true});
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('데이터 무결성 검사 실패');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name);
  if(!['users','sessions','leave_requests','decisions','attendance'].every(t=>tables.includes(t)))throw Error('그룹웨어 데이터베이스가 아닙니다');
  mkdirSync(dirname(target),{recursive:true,mode:0o700});closeSync(openSync(target,'wx',0o600));reserved=true;
  await backup(db,target);chmodSync(target,0o600);
 }catch(error){if(reserved)unlinkSync(target);throw error;}finally{db?.close();}
}
export async function restore(source,destination){
 destination=resolve(destination);
 if(existsSync(destination))throw Error('복원은 존재하지 않는 새 디렉터리에만 가능합니다');
 mkdirSync(destination,{recursive:false,mode:0o700});
 await snapshot(source,resolve(destination,'group.db'));
 const db=new DatabaseSync(resolve(destination,'group.db'));
 try{db.exec('DELETE FROM sessions');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [command,source,target]=process.argv.slice(2);if(!source||!target||!['backup','restore'].includes(command))throw Error('사용법: node scripts/database.js backup 원본DB 새백업파일 | restore 백업파일 새데이터디렉터리');if(command==='backup')await snapshot(source,target);else await restore(source,target);console.log('완료: '+resolve(target));}catch(error){console.error(error.message);process.exitCode=1;}
}
