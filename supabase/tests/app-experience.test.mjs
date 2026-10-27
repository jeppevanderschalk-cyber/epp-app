import test from 'node:test';
import assert from 'node:assert/strict';
import '../../app-experience.js';
const {filterRanking,progress,draftKey,readDraft,writeDraft}=globalThis.EppUx;
test('ranking search combines words and preserves official positions and identities',()=>{
  const rows=[{position:8,name:'José Test',club:'Club Noord',category:'A',shooterId:'one'}, {position:11,name:'José Test',club:'Club Zuid',category:'B',shooterId:'two'}];
  assert.deepEqual(filterRanking(rows,{query:'noord jose'}),[rows[0]]);
  assert.deepEqual(filterRanking(rows,{onlyId:'two'}),[rows[1]]);
  assert.deepEqual(filterRanking(rows,{category:'A',club:'Club Zuid'}),[]);
});
test('progress isolates shooters, deduplicates rounds, and compares two full groups of five',()=>{
  const rounds=Array.from({length:10},(_,i)=>({id:String(i),sid:'one',type:'parcours',score:200+i,ts:i}));
  const data=progress({rounds:[rounds[9],{id:'other',sid:'two',type:'parcours',score:250,ts:20}]},[{rounds}], 'one');
  assert.equal(data.parcours.length,10);assert.equal(data.latest.score,209);assert.equal(data.average,207);assert.equal(data.change,5);
  assert.equal(progress({rounds:rounds.slice(0,7)},[],'one').change,null);
});
test('concepts survive reload, separate account/club/scope and report storage failure',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const key=draftKey({id:'one',clubId:'a'},'training:stage1');
  assert.equal(writeDraft(storage,key,{hits5:'10'}),true);
  assert.equal(readDraft(storage,key).fields.hits5,'10');
  assert.equal(readDraft(storage,draftKey({id:'two',clubId:'a'},'training:stage1')),null);
  assert.equal(readDraft(storage,draftKey({id:'one',clubId:'b'},'training:stage1')),null);
  values.set(key,'invalid');assert.equal(readDraft(storage,key),null);
  assert.equal(writeDraft({setItem(){throw Error('quota');}},key,{}),false);
});
