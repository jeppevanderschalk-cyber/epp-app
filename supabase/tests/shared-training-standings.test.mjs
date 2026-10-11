import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trainingStandings} from '../functions/_shared/training-standings.ts';
const row=(kind,id,data)=>({kind,id,data});
test('personal, trainer and head rounds appear immediately with full names',()=>{
 const sources=[{entities:[row('shooter','p',{naam:'Peter Kruisselbrink'}),row('round','trainer',{id:'trainer',sid:'p',type:'parcours',score:190})]},
 {allowed:['p'],entities:[row('round','personal',{id:'personal',sid:'p',type:'parcours',score:200})]},
 {allowed:['p'],entities:[row('round','head',{id:'head',sid:'p',type:'parcours',score:210}),row('round','foreign',{id:'foreign',sid:'other',type:'parcours',score:250})]}];
 const r=trainingStandings(sources,[{id:'p',display_name:'Peter Kruisselbrink'}]);
 assert.equal(r.bestParcours.p.score,210);assert.equal(r.rounds.length,3);assert.ok(r.rounds.every(r=>r.naam==='Peter Kruisselbrink'));assert.equal(r.bestParcours.other,undefined);
});
test('archived and current rounds deduplicate while zero scores remain visible',()=>{
 const round={id:'r',sid:'p',type:'parcours',score:0};
 const r=trainingStandings([{entities:[row('round','r',round),row('archive','a',{rounds:[round]}),row('archive','excluded',{excludedFromStand:true,rounds:[{...round,id:'skip',score:250}]})]}]);
 assert.equal(r.rounds.length,1);assert.equal(r.bestParcours.p.score,0);
});
test('stage ranking keeps the highest training average and existing summaries',()=>{
 const r=trainingStandings([{entities:[row('stageBest','s1:p',{avg:35}),...[[40,'a'],[50,'a'],[20,'b']].map(([score,trainingId],i)=>row('round','r'+i,{id:'r'+i,sid:'p',type:'stage',stage:'s1',trainingId,score}))]}]);
 assert.equal(r.bestStageAverages.s1.p.avg,45);assert.equal(r.bestStageAverages.s1.p.rounds,2);
});
