import assert from 'node:assert/strict';
import rules from '../../score-ranking.js';
const row={final_score:230,hits5:35,rapid_score:45,rapid_time_ms:14000,total_time_ms:280000};
for(const [key,value] of [['final_score',231],['hits5',36],['rapid_score',46],['rapid_time_ms',13000],['total_time_ms',270000]])assert(rules.compare({...row,[key]:value},row)<0,key);
assert(rules.compare({...row,hits5:36,rapid_time_ms:15000},row)<0);
assert.equal(rules.compare({...row,rapid_time_ms:null},{...row,rapid_time_ms:13000}),0);
for(const rows of [[{...row,rapid_time_ms:null},{...row,rapid_time_ms:13000}],[{...row,rapid_time_ms:13000},{...row,rapid_time_ms:null}]])assert.equal(rules.best(rows).rapid_time_ms,null);
assert.deepEqual(rules.rank([{...row,id:'slow'},{...row,id:'fast',rapid_time_ms:13000},{...row,id:'same',rapid_time_ms:13000}]).map(r=>[r.id,r.position]),[['fast',1],['same',1],['slow',3]]);
for(const shuffled of [[{...row,id:'slow'}, {...row,id:'unknown',rapid_time_ms:null},{...row,id:'fast',rapid_time_ms:13000}],[{...row,id:'fast',rapid_time_ms:13000},{...row,id:'slow'}, {...row,id:'unknown',rapid_time_ms:null}]]){
  const ranked=rules.rank(shuffled);assert(ranked.every(r=>r.position===1&&r.provisional));
}
assert.equal(rules.milliseconds('12,40'),12400);assert.equal(rules.milliseconds('12.005'),12005);
assert.equal(rules.milliseconds(''),null);assert(Number.isNaN(rules.milliseconds('0')));assert(Number.isNaN(rules.milliseconds('1e3')));
const rapid={hits5:8,hits4:2,hits3:0,hits2:0,misses:0},rest={hits5:32,hits4:8,hits3:0,hits2:0,misses:0};
const result=rules.counted(rapid,rest,'12.40','280',5,10,'Ongeldige storing');
assert.equal(result.final_score,235);assert.equal(result.hits5,40);assert.equal(result.rapid_score,48);assert.equal(result.total_time_ms,290000);
assert.throws(()=>rules.counted({...rapid,hits5:7},rest,'12','280'));
assert.throws(()=>rules.counted(rapid,rest,'12','10'));
assert.throws(()=>rules.counted(rapid,rest,'12','280',5));
console.log('PASS all five tiebreaks, shared ranks, order-independent unknown times, decimal parsing, 10+40 counts, penalties');
