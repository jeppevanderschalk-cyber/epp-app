import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationVisibility,hideIdentity,hideTrainingNames,hideTeamIdentities} from '../functions/_shared/publication.ts';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const dbFor=rows=>({rpc:async(name,args)=>{assert.equal(name,'epp_publication_states');assert.ok(args.p_shooters.every(id=>[first,second].includes(id)));return {data:rows,error:null};}});
test('only explicit opt-in and own identity are visible; legacy and missing records fail closed',async()=>{
  const visible=await publicationVisibility(dbFor([{shooter_id:first,account_id:'one',allowed:false},{shooter_id:second,account_id:'two',allowed:true}]),[first,second,'legacy-local-id'], 'viewer');
  assert.deepEqual([...visible],[second]);
  const own=await publicationVisibility(dbFor([{shooter_id:first,account_id:'one',allowed:false}]),[first],'one');assert.equal(own.has(first),true);
  const missing=await publicationVisibility(dbFor([{shooter_id:first}]),[first],undefined);assert.equal(missing.size,0);
  await assert.rejects(publicationVisibility({rpc:async()=>({error:Error('unavailable')})},[first],'viewer'));
});
test('published rankings hide name, club, public number and qualification while preserving score and rank',()=>{
  const row={name:'Private Name',club:'Private Club',publicId:'EPP-123',qualification:{title:'Master'},score:240,position:2,resultId:'result'};
  const hidden=hideIdentity(row,false);assert.equal(hidden.name,'Anonieme schutter');assert.equal(hidden.club,null);assert.equal(hidden.publicId,null);assert.equal(hidden.qualification,null);assert.equal(hidden.score,240);assert.equal(hidden.position,2);assert.ok(!JSON.stringify(hidden).includes('Private'));
  assert.deepEqual(hideIdentity(row,true),row);
});
test('shared training masks names in rounds and nested personal bests',()=>{
  const data={shooters:[{id:first,naam:'Private Name'},{id:second,naam:'Visible Name'}],rounds:[{id:'r',sid:first,score:230,naam:'Private Name',details:{club:'Private Club'}}],bestParcours:{[first]:{score:230,naam:'Private Name'}},bestStageAverages:{s1:{[first]:{avg:45,naam:'Private Name'}}}};
  const result=hideTrainingNames(data,new Set([second]));assert.equal(result.shooters[0].naam,'Anonieme schutter');assert.equal(result.shooters[1].naam,'Visible Name');assert.equal(result.rounds[0].naam,'Anonieme schutter');assert.equal(result.bestParcours[first].score,230);assert.equal(result.bestStageAverages.s1[first].avg,45);assert.ok(!JSON.stringify(result).includes('Private'));
});
test('team directory and members respect consent; club administrators retain only their own operational names',async()=>{
  const db=dbFor([{shooter_id:first,allowed:false},{shooter_id:second,allowed:false}]);
  const data={shooters:[{id:first,name:'Own Club Name',clubs:[{code:'apgs'}]},{id:second,name:'Other Club Name',clubs:[{code:'svbb'}]}],teams:[{clubCode:'apgs',members:[{id:first,name:'Own Club Name',club:'APGS'}]},{clubCode:'svbb',members:[{id:second,name:'Other Club Name',club:'SVBB'}]}]};
  const member=await hideTeamIdentities(db,data,{id:'member',role:'schutter',club_code:'apgs'});assert.ok(!JSON.stringify(member).includes('Club Name'));assert.deepEqual(member.shooters[0].clubs,[]);
  const admin=await hideTeamIdentities(db,data,{id:'admin',role:'trainer',is_admin:true,club_code:'apgs'});assert.equal(admin.shooters[0].name,'Own Club Name');assert.equal(admin.shooters[1].name,'Anonieme schutter');assert.equal(admin.teams[0].members[0].name,'Own Club Name');assert.equal(admin.teams[1].members[0].name,'Anonieme schutter');
});
