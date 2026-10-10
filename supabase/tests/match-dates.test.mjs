import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../functions/_shared/match-dates.ts',import.meta.url),'utf8')).replace(': unknown','').replace(': string[]','');
const {matchDates}=await import('data:text/javascript,'+encodeURIComponent(source));
assert.deepEqual(matchDates(['2027-05-29','2027-05-28']),['2027-05-28','2027-05-29']);
assert.deepEqual(matchDates(['2027-05-28']),['2027-05-28']);
for(const dates of [[],['2027-05-28','2027-05-28'],['2027-02-30'],['2027-13-01'],[''],[null],['2027-5-28']])assert.throws(()=>matchDates(dates));
console.log('PASS match dates: ordered multiple days, single day compatibility, invalid and duplicate dates rejected');
