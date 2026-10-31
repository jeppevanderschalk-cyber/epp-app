import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {encryptBackup,decryptBackup} from '../backup.mjs';
const key=randomBytes(32).toString('hex');
const record={projectRef:'nnsozxjkltcnexqpnwia',backup:{id:'test',created_at:'2026-10-05',checksum:'database-checksum',snapshot:{training_entities:[{score:210}],shooters:[{name:'Privaat'}],memberships:[],results:[],epp_signups:[],app_accounts:[{password_hash:'private-hash'}]}}};
test('encrypted backup restores every field without exposing names or credentials',()=>{
  const encrypted=encryptBackup(record,key);
  assert.deepEqual(decryptBackup(encrypted,key),record);
  assert(!encrypted.includes('Privaat'));assert(!encrypted.includes('private-hash'));
  assert.notEqual(encryptBackup(record,key),encrypted);
});
test('wrong recovery key cannot decrypt',()=>{
  assert.throws(()=>decryptBackup(encryptBackup(record,key),randomBytes(32).toString('hex')));
});
test('damaged ciphertext and metadata fail closed',()=>{
  const envelope=JSON.parse(encryptBackup(record,key));
  const data=Buffer.from(envelope.data,'base64');data[0]^=1;envelope.data=data.toString('base64');
  assert.throws(()=>decryptBackup(JSON.stringify(envelope),key));
  envelope.version=2;assert.throws(()=>decryptBackup(JSON.stringify(envelope),key));
});
test('incomplete snapshots and wrong projects are rejected',()=>{
  assert.throws(()=>encryptBackup({...record,projectRef:'another-project'},key));
  assert.throws(()=>encryptBackup({...record,backup:{...record.backup,snapshot:{}}},key));
  assert.throws(()=>encryptBackup(record,'weak-key'));
});
test('CLI verifies private files and refuses to overwrite recovery material',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'epp-backup-test-'));
  const script=fileURLToPath(new URL('../backup.mjs',import.meta.url));
  const run=(args,env={})=>execFileSync(process.execPath,[script,...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  try{
    const keyFile=join(dir,'recovery.key'),source=join(dir,'source.json'),encrypted=join(dir,'backup.encrypted'),restored=join(dir,'restored.json');
    run(['generate-key',keyFile]);
    const originalKey=await readFile(keyFile,'utf8');
    assert.throws(()=>run(['generate-key',keyFile]));
    assert.equal(await readFile(keyFile,'utf8'),originalKey);
    await writeFile(source,JSON.stringify(record),{mode:0o600});
    const env={EPP_BACKUP_KEY:'',EPP_BACKUP_KEY_FILE:keyFile};
    run(['encrypt',source,encrypted],env);run(['check',encrypted],env);run(['decrypt',encrypted,restored],env);
    assert.deepEqual(JSON.parse(await readFile(restored,'utf8')),record);
    for(const path of [keyFile,encrypted,restored])assert.equal((await stat(path)).mode&0o777,0o600);
    assert.throws(()=>run(['encrypt',source,encrypted],env));
  }finally{await rm(dir,{recursive:true,force:true});}
});
