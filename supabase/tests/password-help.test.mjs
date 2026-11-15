import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../password-help-ui.js',import.meta.url),'utf8');
test('proposed temporary passwords are random and meet the account password requirements',()=>{
 const context={crypto};runInNewContext(source+'\nglobalThis.generate=temporaryAccountPassword;',context);
 const passwords=Array.from({length:100},()=>context.generate());
 for(const password of passwords)assert.match(password,/^[A-Za-z0-9_-]{16}$/);
 assert.equal(new Set(passwords).size,100);
});
