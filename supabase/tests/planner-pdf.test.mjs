import test from 'node:test';
import assert from 'node:assert/strict';
import '../../planner-pdf.js';
const fixture=()=>({managing:true,match:{organizer:'SV Test',match_dates:['2030-03-30','2030-03-31']},slots:[{id:'b',starts_at:'2030-03-31T08:00:00Z',ends_at:'2030-03-31T08:15:00Z',capacity:5},{id:'a',starts_at:'2030-03-30T08:00:00Z',ends_at:'2030-03-30T08:15:00Z',capacity:5,blocked:true}],roster:[{shooterId:'one',name:'Zoë Núñez',clubs:['SV Noord'],choices:[{discipline:'pistool',slotId:'a'},{discipline:'optiek',slotId:'b'},{discipline:'pistool',slotId:'a'}]},{shooterId:'two',name:'Andere schutter',choices:[{discipline:'pistool',slotId:null},{discipline:'optiek',slotId:'deleted'}]}]});
test('organizer PDF groups all slots by Amsterdam date, preserves both starts and unassigned shooters',()=>{
 const m=EppPlannerPdf.schedule(fixture());assert.equal(m.slotCount,2);assert.equal(m.starts,2);assert.equal(m.shooters,1);assert.equal(m.days[0].slots[0].time,'09:00 - 09:15');assert.equal(m.days[1].slots[0].time,'10:00 - 10:15');assert.equal(m.days[0].slots[0].blocked,true);assert.equal(m.days[0].slots[0].entries[0].name,'Zoë Núñez');assert.equal(m.unassigned.length,2);assert.ok(m.unassigned.some(e=>e.status==='Tijdslot niet beschikbaar'));
});
test('PDF keeps empty slots and separates pending payments from confirmed registrations',()=>{
 const v=fixture();v.slots.push({id:'empty',starts_at:'2030-03-30T09:00:00Z',ends_at:'2030-03-30T09:15:00Z',capacity:0,blocked:true});
 v.paymentOrders=[{id:'open',shooterId:'three',name:'Betaling',status:'open',choices:[{discipline:'pistool',slotId:'a'}]},{id:'duplicate',shooterId:'one',name:'Zoë',status:'pending',choices:[{discipline:'pistool',slotId:'a'}]},{id:'canceled',shooterId:'four',status:'open',registrationCanceled:true,choices:[{discipline:'pistool',slotId:'a'}]}];
 const m=EppPlannerPdf.schedule(v);assert.equal(m.starts,2);assert.equal(m.pendingCount,1);assert.equal(m.slotCount,3);assert.equal(m.days[0].slots[1].entries.length,0);assert.equal(m.days[0].slots[0].entries[0].status,'Ingeschreven');assert.equal(m.days[0].slots[0].entries[1].status,'Betaling loopt');
});
test('full PDF requires explicit organizer authorization and complete roster data',async()=>{
 for(const managing of [false,undefined,'true'])assert.throws(()=>EppPlannerPdf.schedule({...fixture(),managing}),/organiserende vereniging/);
 await assert.rejects(EppPlannerPdf.create({...fixture(),managing:false}),/organiserende vereniging/);
 assert.throws(()=>EppPlannerPdf.schedule({...fixture(),roster:undefined}),/volledige planning/);
});
