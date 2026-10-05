import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberNames,memberUsername} from '../functions/_shared/member-account.ts';
test('personal accounts require first and last name',()=>{
  assert.throws(()=>memberNames('Jeppe',''));
  assert.throws(()=>memberNames('', 'van der Schalk'));
  assert.throws(()=>memberNames('First\u0000','Last'));
  assert.throws(()=>memberNames('a'.repeat(71),'Last'));
  assert.deepEqual(memberNames('  Anne  Marie ',' de  Vries '),{firstName:'Anne Marie',lastName:'de Vries',displayName:'Anne Marie de Vries'});
});
test('name-based login is stable and not an administrator username',async()=>{
  assert.equal(await memberUsername(' Anne  Marie','de Vries '),await memberUsername('anne marie','DE VRIES'));
  assert.match(await memberUsername('beheer','trainer'),/^lid\.[0-9a-f]{40}$/);
  assert.notEqual(await memberUsername('Anne','de Vries'),await memberUsername('Anna','de Vries'));
});
