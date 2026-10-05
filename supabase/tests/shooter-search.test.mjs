import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const helper = html.slice(html.indexOf('const shooterCandidates ='), html.indexOf('const TabLandelijk ='));
const candidates = vm.runInNewContext(helper + '\nshooterCandidates;', {CLUB:{label:'Testclub'}});
const published = {sources:{ind:{rows:[
  {name:'A. Test',club:'Club A'},
  {name:'A. Test',club:'Club A'},
  {name:'A. Test',club:'Club B'},
  {name:'B. Test',club:'Club A'},
]},open:{rows:[{name:'B. Test',club:'Club A'}]},teams:{rows:[{name:'Team A',club:'Club A'}]}}};

test('deduplicates published shooters without treating teams as shooters',()=>{
  const result=candidates([],published);
  assert.equal(result.length,3);
  assert.equal(result.filter(s=>s.name==='A. Test').length,2);
  assert.equal(result.some(s=>s.name==='Team A'),false);
});

test('prefers database IDs over matching published names',()=>{
  const result=candidates([{id:'uuid-1',public_id:'EPP-1',display_name:'b. test'}],published);
  assert.equal(result.length,3);
  const selected=result.find(s=>s.id==='uuid-1');
  assert.equal(selected.publicId,'EPP-1');
  assert.equal(selected.club,'Testclub');
});

test('preserves separate database shooters with the same name',()=>{
  const result=candidates([
    {id:'uuid-1',public_id:'EPP-1',display_name:'B. Test'},
    {id:'uuid-2',public_id:'EPP-2',display_name:'B. Test'},
  ],published);
  assert.equal(result.filter(s=>s.name==='B. Test').length,2);
});

test('score form requires explicit selection and keeps the 50-shot check',()=>{
  const form=html.slice(html.indexOf('const TabLandelijk ='),html.indexOf('// ── TabStand'));
  assert.match(form,/\(selectedShooter \|\| newShooter\).*shots===50/);
  assert.match(form,/let shooterId=selectedShooter\?\.id/);
  assert.match(form,/roundId,expectedRevision:revision/);
  assert.doesNotMatch(form,/entryMode:"total"/);
});

test('loads club directory using the authenticated session, not each keystroke',()=>{
  const form=html.slice(html.indexOf('const TabLandelijk ='),html.indexOf('// ── TabStand'));
  assert.doesNotMatch(form,/Schutters van vereniging ophalen|onClick:loadDirectory/);
  assert.doesNotMatch(form,/directoryPassword|Trainerwachtwoord voor offici/);
  assert.match(form,/\},\[isTrainer\]\)/);
  assert.match(form,/return\(\)=>\{active=false;\}/);
});
test('official competition prepares its score entry automatically without round controls',()=>{
  const form=html.slice(html.indexOf('const TabLandelijk ='),html.indexOf('// ── TabStand'));
  assert.match(form,/action:"prepare_match",matchId/);
  assert.match(form,/\[isTrainer,matchId\]/);
  assert.match(form,/!matchLoading && !resultLoading/);
  assert.doesNotMatch(form,/Rondenummer|Kies ronde|Ronde aanmaken|roundNumber/);
});
