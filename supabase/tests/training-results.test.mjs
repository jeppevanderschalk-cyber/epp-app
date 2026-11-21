import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../../score-ranking.js';
import '../../training-results.js';
import {trainingJournal} from '../functions/_shared/training-journal.ts';
const data={shooters:[{id:'a',naam:'A'},{id:'b',naam:'B'}],rounds:[{id:'1',sid:'a',trainingId:'today',type:'stage',stage:'s1',score:0},{id:'2',sid:'a',trainingId:'today',type:'stage',stage:'s1',score:40},{id:'3',sid:'b',trainingId:'today',type:'stage',stage:'s1',score:30},{id:'4',sid:'a',trainingId:'old',type:'stage',stage:'s1',score:50}]};
test('saved results retain every round including zero; ranks use stage average and training filter',()=>{
 const m=EppTrainingResults.model(data,'today');assert.equal(m.rounds.length,3);assert.equal(m.standings[0].sid,'b');assert.equal(m.standings[1].score,20);assert.equal(m.standings[1].rank,2);assert.equal(EppTrainingResults.model(data,'old','b').rounds.length,0);
});
test('parcours rankings preserve provisional ties when old rounds lack tie-break measurements',()=>{
 const m=EppTrainingResults.model({...data,rounds:[{sid:'a',type:'parcours',score:200},{sid:'b',type:'parcours',score:200,hits5:40}]});assert.deepEqual(m.standings.map(r=>r.rank),[1,1]);
});
test('all-training export uses the saved club standings and retains legacy summaries',()=>{
 const m=EppTrainingResults.model({...data,shooters:[...data.shooters,{id:'legacy',naam:'Historisch'}],bestParcours:{legacy:{score:210}},bestStageAverages:{s1:{a:{avg:50},b:{avg:30}}}});
 assert.equal(m.standings.find(r=>r.sid==='a'&&r.stage==='s1').score,50);assert.equal(m.standings.find(r=>r.sid==='legacy').score,210);
});
const sid='11111111-1111-4111-8111-111111111111';
function database({club='svbb',owner='owner'}={}){
 const calls=[],insertions=[];
 return {calls,insertions,from(table){return {select(){return this;},eq(k,v){calls.push([table,k,v]);return this;},maybeSingle:async()=>({data:table==='shooters'?{id:sid,linked_user_id:owner}:{club_code:club,active:true,membership_approved:true}}),insert:async value=>{insertions.push(value);return {};},or(v){calls.push(['or',v]);return this;},order(){return this;},range:async()=>({data:[]})};}};
}
const body={action:'journal_load',shooterId:sid,trainingId:'today'};
test('shooters cannot retrieve or add to another shooter diary',async()=>{
 const db=database();for(const action of ['journal_load','journal_add'])await assert.rejects(trainingJournal(db,{id:'outsider',club_code:'svbb',role:'schutter'},{...body,action,content:'forged'}),/geen_toegang/);assert.equal(db.insertions.length,0);
});
test('trainer diary access is restricted to their club, private entries remain excluded',async()=>{
 await assert.rejects(trainingJournal(database({club:'other'}),{id:'trainer',club_code:'svbb',role:'trainer'},body),/geen_toegang/);
 const db=database();await trainingJournal(db,{id:'trainer',club_code:'svbb',role:'trainer'},body);assert.ok(db.calls.some(c=>c[1]==='visibility'&&c[2]==='trainer'));assert.ok(!db.calls.some(c=>c[0]==='or'));
});
test('own journal is private regardless of forged visibility; author and club come from verified session',async()=>{
 const db=database();await trainingJournal(db,{id:'owner',club_code:'svbb',role:'schutter',display_name:'Owner'},{...body,action:'journal_add',content:' My note ',visibility:'trainer',author_id:'attacker'});
 assert.equal(db.insertions[0].visibility,'private');assert.equal(db.insertions[0].author_id,'owner');assert.equal(db.insertions[0].content,'My note');assert.ok(db.calls.some(c=>c[0]==='or'&&c[1].includes('owner')));
});
