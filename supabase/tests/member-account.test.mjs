import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberNames,memberUsername,memberEmail,emailUsername,loginUsername} from '../functions/_shared/member-account.ts';
test('personal accounts require first and last name',()=>{
  assert.throws(()=>memberNames('Jeppe',''));
  assert.throws(()=>memberNames('', 'van der Schalk'));
  assert.throws(()=>memberNames('First\u0000','Last'));
  assert.throws(()=>memberNames('a'.repeat(71),'Last'));
  assert.deepEqual(memberNames('  Anne  Marie ',' de  Vries '),{firstName:'Anne Marie',lastName:'de Vries',displayName:'Anne Marie de Vries'});
});
test('new account identities use normalized email, not a potentially shared name',async()=>{
  assert.equal(memberEmail(' Person@Example.nl '),'person@example.nl');
  assert.throws(()=>memberEmail('wrong'));assert.throws(()=>memberEmail('a\nb@example.nl'));
  assert.equal(await emailUsername(' Person@Example.nl '),await emailUsername('person@example.nl'));
  assert.notEqual(await emailUsername('one@example.nl'),await emailUsername('two@example.nl'));
  assert.match(await emailUsername('one@example.nl'),/^lid\.[a-f0-9]{40}$/);
});
test('name-based login is stable and not an administrator username',async()=>{
  assert.equal(await memberUsername(' Anne  Marie','de Vries '),await memberUsername('anne marie','DE VRIES'));
  assert.match(await memberUsername('beheer','trainer'),/^lid\.[0-9a-f]{40}$/);
  assert.notEqual(await memberUsername('Anne','de Vries'),await memberUsername('Anna','de Vries'));
});

test('chosen login usernames normalize case and reject reserved identities',()=>{
  assert.equal(loginUsername('  Anne.123_abc-x  '),'anne.123_abc-x');
  for(const value of ['',null,123,'ab','a'.repeat(31),'two words','a@example.nl','beheer','KIJKER','hoofdbeheer','trainer','lid.fake','removed.fake','a\nname'])assert.throws(()=>loginUsername(value),/gebruikersnaam_ongeldig/);
});
