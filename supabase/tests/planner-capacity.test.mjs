import {test} from 'node:test';
import assert from 'node:assert/strict';
import capacity from '../../planner-capacity.js';
test('five lanes with 28 rounds gives maximum 140 single-discipline shooters',()=>{
  const slots=Array.from({length:28},(_,i)=>({starts_at:new Date(Date.UTC(2027,1,27,8,i*15)).toISOString(),capacity:5,booked:0}));
  assert.deepEqual(capacity.summarize(slots),[{day:'2027-02-27',slots:28,maxShooters:140,free:140,blocked:0}]);
});
test('different days and lane overrides are counted independently in Amsterdam time',()=>{
  assert.deepEqual(capacity.summarize([{starts_at:'2027-05-27T22:30:00Z',capacity:2,booked:1},{starts_at:'2027-05-28T08:00:00Z',capacity:3,booked:1},{starts_at:'2027-05-29T08:00:00Z',capacity:2,booked:0}]),[{day:'2027-05-28',slots:2,maxShooters:5,free:3,blocked:0},{day:'2027-05-29',slots:1,maxShooters:2,free:2,blocked:0}]);
});
test('blocked empty places are excluded, existing reservations and holds remain counted',()=>{
  assert.deepEqual(capacity.summarize([{starts_at:'2027-02-27T08:00Z',capacity:5,booked:0,blocked:true},{starts_at:'2027-02-27T08:15Z',capacity:5,booked:2,blocked:true},{starts_at:'2027-02-27T08:30Z',capacity:5,booked:1}]),[{day:'2027-02-27',slots:3,maxShooters:7,free:4,blocked:2}]);
  assert.deepEqual(capacity.summarize([]),[]);
});
