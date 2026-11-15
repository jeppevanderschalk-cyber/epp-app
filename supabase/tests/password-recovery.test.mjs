import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryToken,recoveryPassword,sendRecoveryMail} from '../functions/_shared/password-recovery.ts';
test('recovery uses independent 256-bit tokens and enforces password lengths',()=>{
 const a=recoveryToken(),b=recoveryToken();assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);
 for(const value of [null,{},'short','a'.repeat(257)])assert.throws(()=>recoveryPassword(value),/nieuw_wachtwoord_ongeldig/);
 assert.equal(recoveryPassword('a'.repeat(10)),'a'.repeat(10));assert.equal(recoveryPassword('a'.repeat(256)),'a'.repeat(256));
});
test('mail links have a fixed trusted origin and keep the token in the fragment',async()=>{
 let sent;
 await sendRecoveryMail('member@example.invalid','a'.repeat(64),{apiKey:'test-secret',from:'EPP <epp@example.invalid>'},async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return Response.json({id:'sent'});});
 assert.equal(sent.url,'https://api.resend.com/emails');assert.deepEqual(sent.body.to,['member@example.invalid']);
 assert.match(sent.body.text,/https:\/\/epp-app.nl\/#wachtwoord-herstellen=a{64}/);assert.match(sent.body.text,/30 minuten/);
 assert.ok(!sent.options.body.includes('test-secret'));assert.ok(!sent.options.body.includes('password_hash'));
});
test('mail provider errors and malformed successes are detected',async()=>{
 for(const status of [403,429,500])await assert.rejects(sendRecoveryMail('a@example.invalid','a'.repeat(64),{apiKey:'secret',from:'EPP'},async()=>new Response('',{status})),/resetmail_niet_verstuurd/);
 await assert.rejects(sendRecoveryMail('a@example.invalid','a'.repeat(64),{apiKey:'secret',from:'EPP'},async()=>Response.json({})),/resetmail_niet_verstuurd/);
});
