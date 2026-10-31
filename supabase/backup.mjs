import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const projectRef='nnsozxjkltcnexqpnwia';
const maxSize=128*1024*1024;
function keyBytes(key){
  if(!/^[a-f0-9]{64}$/i.test(key||''))throw new Error('Een sleutel van 64 hex-tekens is verplicht.');
  return Buffer.from(key,'hex');
}
function validate(record){
  if(record?.projectRef!==projectRef||!record.backup?.id||!record.backup?.created_at||!record.backup?.checksum)throw new Error('Onbekend project of onvolledige back-up.');
  for(const table of ['training_entities','shooters','memberships','results','epp_signups','app_accounts']){
    if(!Array.isArray(record.backup.snapshot?.[table]))throw new Error('Ontbrekende tabel: '+table);
  }
  return record;
}
export function encryptBackup(record,key){
  validate(record);
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);
  cipher.setAAD(Buffer.from('EPP-BACKUP-v1'));
  const ciphertext=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(record)))),cipher.final()]);
  return JSON.stringify({format:'EPP-BACKUP',version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')});
}
export function decryptBackup(encrypted,key){
  if(Buffer.byteLength(encrypted)>maxSize)throw new Error('Back-up is te groot.');
  const envelope=JSON.parse(encrypted);
  if(envelope.format!=='EPP-BACKUP'||envelope.version!==1)throw new Error('Onbekend back-upformaat.');
  const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');
  if(iv.length!==12||tag.length!==16)throw new Error('Ongeldige versleuteling.');
  const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),iv);
  decipher.setAAD(Buffer.from('EPP-BACKUP-v1'));decipher.setAuthTag(tag);
  const zipped=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);
  return validate(JSON.parse(gunzipSync(zipped,{maxOutputLength:maxSize}).toString('utf8')));
}
async function main(){
  const [action,input,output]=process.argv.slice(2);
  if(action==='generate-key'){
    if(!input)throw new Error('Geef een privaat sleutelbestand op.');
    await writeFile(input,randomBytes(32).toString('hex')+'\n',{mode:0o600,flag:'wx'});
    console.log('Herstelsleutel aangemaakt. Bewaar deze apart van de back-ups.');return;
  }
  const key=process.env.EPP_BACKUP_KEY||(process.env.EPP_BACKUP_KEY_FILE?String(await readFile(process.env.EPP_BACKUP_KEY_FILE,'utf8')).trim():'');
  keyBytes(key);
  if(action==='capture'){
    if(!input)throw new Error('Geef een uitvoerbestand op.');
    const root=fileURLToPath(new URL('../',import.meta.url));
    if(String(await readFile(resolve(root,'supabase/.temp/project-ref'),'utf8')).trim()!==projectRef)throw new Error('De CLI is aan een ander project gekoppeld.');
    // The owner CLI exports one consistent database snapshot, never browser data.
    const query=sql=>JSON.parse(execFileSync('supabase',['db','query','--linked',sql,'--output-format','json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:maxSize})).rows;
    const id=query('select public.epp_capture_backup() as id')[0].id;
    if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Ongeldig snapshot-ID.');
    const backup=query("select id,created_at,checksum,snapshot from public.platform_backups where id='"+id+"'")[0];
    const encrypted=encryptBackup({projectRef,exportedAt:new Date().toISOString(),backup},key);
    decryptBackup(encrypted,key);
    await writeFile(input,encrypted,{mode:0o600,flag:'wx'});
    console.log('Versleutelde back-up gemaakt en herstelbaarheid gecontroleerd.');return;
  }
  if(!input)throw new Error('Geef een invoerbestand op.');
  if(action==='encrypt'){
    if(!output)throw new Error('Geef een uitvoerbestand op.');
    await writeFile(output,encryptBackup(JSON.parse(await readFile(input,'utf8')),key),{mode:0o600,flag:'wx'});
  }else if(action==='check'||action==='decrypt'){
    const record=decryptBackup(await readFile(input,'utf8'),key);
    if(action==='decrypt'){
      if(!output)throw new Error('Geef een privaat uitvoerbestand op.');
      await writeFile(output,JSON.stringify(record),{mode:0o600,flag:'wx'});
    }
    console.log('Back-up geldig; inhoud ontsleuteld en gecontroleerd. Database niet gewijzigd.');
  }else throw new Error('Gebruik generate-key, capture, encrypt, check of decrypt.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  console.error('Back-up mislukt. Controleer actie, bestanden, sleutel en projecttoegang. Bestaande bestanden zijn niet overschreven.');process.exitCode=1;
});
