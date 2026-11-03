import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import ExcelJS from 'exceljs';
import {attendanceCsv} from '../attendance.js';

test('attendance CSV includes employee profile, quoted text, formula protection and Korean dates with seconds',async()=>{
 const profile={name:'=SUM(1,2)',job_title:'대리',organization:'사업,"개발"\n본부',login:'staff',email:'staff@example.com',phone:'+82 10-1234-5678'};
 const csv=attendanceCsv(profile,'2026-11',[{day:'2026-11-02',clock_in:'2026-11-01T23:54:28.000Z',clock_out:'2026-11-02T09:01:08.000Z'},{day:'2026-11-03',clock_in:'2026-11-02T23:56:32.000Z',clock_out:null}]);
 assert.equal(Buffer.from(csv).subarray(0,3).toString('hex'),'efbbbf');assert.ok(csv.endsWith('\r\n'));
 const sheet=await new ExcelJS.Workbook().csv.read(Readable.from([csv]),{map:v=>v});
 assert.deepEqual(sheet.getRow(2).values.slice(1),['이름','직급','소속조직']);assert.deepEqual(sheet.getRow(3).values.slice(1),["'=SUM(1,2)",'대리',profile.organization]);
 assert.deepEqual(sheet.getRow(5).values.slice(1),['staff','staff@example.com',"'+82 10-1234-5678"]);
 assert.deepEqual(sheet.getRow(8).values.slice(1),['날짜','출근 시각 (한국 시간)','퇴근 시각 (한국 시간)']);
 assert.deepEqual(sheet.getRow(9).values.slice(1),['2026-11-02','2026. 11. 2. 오전 8:54:28','2026. 11. 2. 오후 6:01:08']);
 assert.deepEqual(sheet.getRow(10).values.slice(1),['2026-11-03','2026. 11. 3. 오전 8:56:32','—']);
 const empty=attendanceCsv(profile,'2026-12',[]);assert.ok(empty.endsWith('날짜,출근 시각 (한국 시간),퇴근 시각 (한국 시간)\r\n'));assert.ok(empty.includes('staff@example.com'));
});
