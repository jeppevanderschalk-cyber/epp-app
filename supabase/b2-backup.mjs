import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptBackup,decryptBackup} from './backup.mjs';

const projectRef='nnsozxjkltcnexqpnwia';
const supabaseUrl='https://'+projectRef+'.supabase.co';
const prefix='epp/'+projectRef+'/';
const maxBytes=128*1024*1024;
const sha1=value=>createHash('sha1').update(value).digest('hex');

function trustedB2Url(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.backblazeb2.com')||url.port||url.username||url.password)throw new Error('b2_endpoint');
  return url.toString();
}
async function request(fetchFn,url,options={}){
  const response=await fetchFn(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('http_'+response.status);
  return response;
}
async function boundedBody(response){
  if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('backup_too_large');
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>maxBytes)throw new Error('backup_too_large');parts.push(Buffer.from(part));}
  return Buffer.concat(parts);
}

export async function connectB2(config,fetchFn=fetch){
  const {keyId,applicationKey,bucketId}=config;
  if(!keyId||!applicationKey||!bucketId)throw new Error('b2_configuration');
  const authorization='Basic '+Buffer.from(keyId+':'+applicationKey).toString('base64');
  const auth=await (await request(fetchFn,'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',{headers:{Authorization:authorization}})).json();
  const api=auth.apiInfo?.storageApi,allowed=api?.allowed;
  // Require a single-bucket key; never use the account-wide master key.
  if(!auth.authorizationToken||allowed?.buckets?.length!==1||allowed.buckets[0].id!==bucketId)throw new Error('b2_bucket_restriction');
  for(const capability of ['listBuckets','writeFiles','readFiles'])if(!allowed.capabilities?.includes(capability))throw new Error('b2_capabilities');
  if(!prefix.startsWith(allowed.namePrefix||''))throw new Error('b2_prefix_restriction');
  const apiUrl=trustedB2Url(api.apiUrl),downloadUrl=trustedB2Url(api.downloadUrl);
  const headers={Authorization:auth.authorizationToken,'Content-Type':'application/json'};
  const call=async(action,body)=>(await request(fetchFn,new URL('/b2api/v4/'+action,apiUrl),{method:'POST',headers,body:JSON.stringify(body)})).json();
  const listed=await call('b2_list_buckets',{accountId:auth.accountId,bucketId});
  const bucket=listed.buckets?.find(b=>b.bucketId===bucketId);
  if(bucket?.bucketType!=='allPrivate')throw new Error('b2_bucket_must_be_private');
  return {call,bucketId,downloadUrl,token:auth.authorizationToken};
}

export async function uploadAndVerify(record,key,connection,fetchFn=fetch){
  const encrypted=Buffer.from(encryptBackup(record,key));
  if(encrypted.length>maxBytes)throw new Error('backup_too_large');
  const id=record.backup.id;
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('backup_id');
  const date=new Date(record.backup.created_at);
  if(Number.isNaN(date.getTime()))throw new Error('backup_date');
  const filename=prefix+date.toISOString().slice(0,10)+'/'+id+'.encrypted';
  const upload=await connection.call('b2_get_upload_url',{bucketId:connection.bucketId});
  if(upload.bucketId!==connection.bucketId||!upload.authorizationToken)throw new Error('b2_upload_bucket');
  const result=await (await request(fetchFn,trustedB2Url(upload.uploadUrl),{method:'POST',headers:{
    Authorization:upload.authorizationToken,'X-Bz-File-Name':encodeURIComponent(filename),
    'Content-Type':'application/octet-stream','X-Bz-Content-Sha1':sha1(encrypted)
  },body:encrypted})).json();
  if(!result.fileId||result.bucketId!==connection.bucketId||result.fileName!==filename||result.contentSha1!==sha1(encrypted))throw new Error('b2_upload_verification');
  const url=new URL('/b2api/v4/b2_download_file_by_id',connection.downloadUrl);url.searchParams.set('fileId',result.fileId);
  const downloaded=await boundedBody(await request(fetchFn,url,{headers:{Authorization:connection.token}}));
  if(!downloaded.equals(encrypted))throw new Error('b2_download_verification');
  const restored=decryptBackup(downloaded.toString('utf8'),key);
  if(JSON.stringify(restored)!==JSON.stringify(record))throw new Error('b2_restore_verification');
  return {backupId:id,fileId:result.fileId,bytes:encrypted.length,verified:true};
}

export async function captureFromServer(serviceKey,fetchFn=fetch){
  if(!serviceKey)throw new Error('supabase_configuration');
  const headers={apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'};
  const id=await (await request(fetchFn,supabaseUrl+'/rest/v1/rpc/epp_capture_backup',{method:'POST',headers,body:'{}'})).json();
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('backup_id');
  const url=supabaseUrl+'/rest/v1/platform_backups?select=id,created_at,checksum,snapshot&id=eq.'+encodeURIComponent(id);
  const rows=JSON.parse((await boundedBody(await request(fetchFn,url,{headers}))).toString('utf8'));
  if(rows.length!==1||rows[0].id!==id)throw new Error('backup_missing');
  return {projectRef,exportedAt:new Date().toISOString(),backup:rows[0]};
}

async function main(){
  const connection=await connectB2({keyId:process.env.EPP_B2_KEY_ID,applicationKey:process.env.EPP_B2_APPLICATION_KEY,bucketId:process.env.EPP_B2_BUCKET_ID});
  if(process.argv[2]==='check-connection'){console.log('B2 connected: private bucket and restricted application key verified.');return;}
  if(process.argv[2]!=='run')throw new Error('action');
  const key=process.env.EPP_BACKUP_KEY||(process.env.EPP_BACKUP_KEY_FILE?String(await readFile(process.env.EPP_BACKUP_KEY_FILE,'utf8')).trim():'');
  if(!/^[0-9a-f]{64}$/i.test(key))throw new Error('recovery_key');
  const record=await captureFromServer(process.env.EPP_BACKUP_SUPABASE_SERVICE_ROLE_KEY);
  const result=await uploadAndVerify(record,key,connection);
  // Only non-sensitive verification metadata is logged, never records or tokens.
  console.log(JSON.stringify(result));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  const code=/^(b2_[a-z_]+|backup_[a-z_]+|http_[0-9]+|supabase_configuration|recovery_key|action)$/.test(error.message)?error.message:'unexpected_failure';
  console.error('B2 backup failed: '+code+'. No verified external backup was recorded.');process.exitCode=1;
});
