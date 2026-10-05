import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureMatchRound} from '../functions/_shared/match-round.ts';
function db(rounds,error=null){return {from:()=>({select:()=>({eq:()=>({limit:async()=>({data:rounds,error})})})})};}
test('existing single round is reused without losing its ID',async()=>{
  const round={id:'existing',label:'Ronde 2'};
  assert.equal(await ensureMatchRound(db([round]),'event',()=>assert.fail('must not create')),round);
});
test('missing round uses the same unique label for both trainers',async()=>{
  const ensure=async(_,table,match,values)=>{
    assert.equal(table,'rounds');assert.deepEqual(match,{event_id:'event',label:'Ronde 1'});assert.deepEqual(values,match);
    return {id:'one-round'};
  };
  const results=await Promise.all([ensureMatchRound(db([]),'event',ensure),ensureMatchRound(db([]),'event',ensure)]);
  assert.deepEqual(results,[{id:'one-round'},{id:'one-round'}]);
});
test('multiple historical rounds and database errors fail without deleting or guessing',async()=>{
  await assert.rejects(ensureMatchRound(db([{id:'a'},{id:'b'}]),'event',()=>assert.fail()),/wedstrijd_meerdere_rondes/);
  await assert.rejects(ensureMatchRound(db(null,new Error('database')),'event',()=>assert.fail()),/database/);
});
