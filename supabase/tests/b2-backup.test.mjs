import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {connectB2,uploadAndVerify,captureFromServer} from '../b2-backup.mjs';
const projectRef='nnsozxjkltcnexqpnwia',id='10000000-0000-4000-8000-000000000001';
const key=randomBytes(32).toString('hex');
const backup={id,created_at:'2026-10-05T12:00:00Z',checksum:'checksum',snapshot:{training_entities:[],shooters:[{name:'Secret person'}],memberships:[],results:[],epp_signups:[],app_accounts:[{password_hash:'secret-hash'}]}};
const record={projectRef,backup};
const credentials={keyId:'key-id',applicationKey:'secret-key',bucketId:'bucket-id'};
function mock({publicBucket=false,unrestricted=false,corrupt=false,evilUrl=false,missingRead=false}={}){
  let stored,name;const calls=[];
  const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  const fetchFn=async(url,options={})=>{
    const u=new URL(url);calls.push(u);
    assert.equal(options.redirect,'error');
    if(u.pathname.endsWith('b2_authorize_account'))return json({accountId:'account',authorizationToken:'account-token',apiInfo:{storageApi:{apiUrl:evilUrl?'https://evil.example':'https://api001.backblazeb2.com',downloadUrl:'https://f001.backblazeb2.com',allowed:{buckets:unrestricted?null:[{id:'bucket-id'}],capabilities:missingRead?['listBuckets','writeFiles']:['listBuckets','writeFiles','readFiles'],namePrefix:'epp/'+projectRef+'/'}}}});
    if(u.pathname.endsWith('b2_list_buckets'))return json({buckets:[{bucketId:'bucket-id',bucketType:publicBucket?'allPublic':'allPrivate'}]});
    if(u.pathname.endsWith('b2_get_upload_url'))return json({bucketId:'bucket-id',uploadUrl:'https://pod-001.backblazeb2.com/upload',authorizationToken:'upload-token'});
    if(u.pathname==='/upload'){
      stored=Buffer.from(options.body);name=decodeURIComponent(options.headers['X-Bz-File-Name']);
      assert(!stored.toString().includes('Secret person'));assert(!stored.toString().includes('secret-hash'));
      return json({bucketId:'bucket-id',fileId:'file-id',fileName:name,contentSha1:createHash('sha1').update(stored).digest('hex')});
    }
    if(u.pathname.endsWith('b2_download_file_by_id'))return new Response(corrupt?Buffer.from('corrupted'):stored);
    if(u.pathname.endsWith('epp_capture_backup'))return json(id);
    if(u.pathname.endsWith('platform_backups'))return json([backup]);
    throw new Error('Unexpected endpoint');
  };
  return {fetchFn,calls};
}
test('B2 roundtrip uploads ciphertext only and verifies decrypted content',async()=>{
  const m=mock(),connection=await connectB2(credentials,m.fetchFn);
  const result=await uploadAndVerify(record,key,connection,m.fetchFn);
  assert.equal(result.verified,true);assert.equal(result.backupId,id);
  assert.equal(m.calls.filter(u=>u.pathname==='/upload').length,1);
});
test('public buckets, account-wide keys and insufficient permissions are rejected before upload',async()=>{
  for(const options of [{publicBucket:true},{unrestricted:true},{missingRead:true},{evilUrl:true}]){
    const m=mock(options);await assert.rejects(connectB2(credentials,m.fetchFn));
    assert(!m.calls.some(u=>u.pathname==='/upload'||u.hostname==='evil.example'));
  }
});
test('corrupt download is never reported as a verified backup',async()=>{
  const m=mock({corrupt:true}),connection=await connectB2(credentials,m.fetchFn);
  await assert.rejects(uploadAndVerify(record,key,connection,m.fetchFn),/b2_download_verification/);
});
test('server capture fetches exactly the snapshot returned by the RPC',async()=>{
  const m=mock(),data=await captureFromServer('service-key',m.fetchFn);
  assert.deepEqual(data.backup,backup);assert.equal(data.projectRef,projectRef);
  assert(m.calls.every(u=>u.hostname===projectRef+'.supabase.co'));
});
