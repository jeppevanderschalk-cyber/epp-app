import assert from 'node:assert/strict';
import test from 'node:test';
import '../../training-store.js';
const {diff,rebase,flatten,decode}=globalThis.EppStore;
const base=()=>({shooters:[{id:'s',naam:'Test'}],stageShots:{s1:10},currentTraining:{id:'t',mode:'parcours',startedAt:1,updatedAt:1,rounds:[]}});
const round=(id,score)=>({id,trainingId:'t',sid:'s',type:'parcours',score,ts:1});
test('absent settings are not fabricated as an existing database row',()=>{
  const empty=decode([]);
  assert.equal(empty.stageShots,undefined);
  assert.deepEqual(diff({},empty),[]);
  const ops=diff(empty,base());
  assert.equal(ops.find(op=>op.id==='stageShots').expected,null);
  assert.deepEqual(diff(decode(Object.values(flatten(base()))),base()),[]);
});
test('legacy empty settings queues merge into an empty server without losing rounds',()=>{
  const oldBase={...decode([]),stageShots:{}};
  const wanted=base();wanted.currentTraining.rounds=[round('pending',210)];
  const remote=decode([]),merged=rebase(oldBase,wanted,remote);
  assert.deepEqual(merged.conflicts,[]);
  assert.equal(merged.payload.currentTraining.rounds[0].score,210);
  assert.equal(diff(remote,merged.payload).find(op=>op.id==='stageShots').expected,null);
});
test('an actually stored empty settings row retains its expected value',()=>{
  const stored=decode([{kind:'meta',id:'stageShots',data:{}}]);
  assert.deepEqual(diff(stored,{stageShots:{s1:10}})[0].expected,{});
});
test('independent concurrent round additions do not overwrite each other',()=>{
  const original=base(),local=base(),remote=base();
  local.currentTraining.rounds.push(round('a',220));local.currentTraining.updatedAt=2;
  remote.currentTraining.rounds.push(round('b',230));remote.currentTraining.updatedAt=3;
  const merged=rebase(original,local,remote);
  assert.deepEqual(merged.conflicts,[]);
  assert.deepEqual(merged.payload.currentTraining.rounds.map(r=>r.id),['b','a']);
  assert.equal(diff(original,local).length,1);
});
test('a concurrent correction is a conflict, not a silent overwrite',()=>{
  const original=base();original.currentTraining.rounds=[round('a',200)];
  const local=structuredClone(original),remote=structuredClone(original);
  local.currentTraining.rounds[0].score=210;remote.currentTraining.rounds[0].score=220;
  assert.deepEqual(rebase(original,local,remote).conflicts,[{kind:'round',id:'a'}]);
});
test('deleted rounds are not resurrected by a stale copy',()=>{
  const original=base();original.currentTraining.rounds=[round('a',200)];
  const local=structuredClone(original);local.currentTraining.rounds=[];
  assert.equal(rebase(original,local,original).payload.currentTraining.rounds.length,0);
  assert.equal(diff(original,local)[0].value,null);
});
test('a retry of an already applied mutation is idempotent',()=>{
  const original=base(),local=base();local.currentTraining.rounds=[round('a',200)];
  assert.equal(rebase(original,local,local).conflicts.length,0);
  assert.equal(rebase(original,local,local).payload.currentTraining.rounds.length,1);
});
test('offline queues survive serialization without losing expected values',()=>{
  const original=base(),local=base();local.currentTraining.rounds=[round('a',200)];
  const queue=JSON.parse(JSON.stringify({base:original,wanted:local}));
  assert.deepEqual(diff(queue.base,queue.wanted),diff(original,local));
});
test('archived training survives round deletion and format roundtrip',()=>{
  const original=base();original.archives=[{id:'old',closedAt:2,rounds:[round('x',240)]}];
  const rebuilt=decode(Object.values(flatten(original)));
  assert.equal(rebuilt.archives[0].rounds[0].score,240);
});
