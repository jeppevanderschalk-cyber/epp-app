import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const path=new URL('../index.html',import.meta.url);
const html=await readFile(path,'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(m=>!/^<script[^>]*\bsrc=/i.test(m[0]));
const hashes=scripts.map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'");
const policy="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' "+hashes.join(' ')+"; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://nnsozxjkltcnexqpnwia.supabase.co; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'";
const meta='<meta http-equiv="Content-Security-Policy" content="'+policy+'" />';
const existing=/<meta http-equiv="Content-Security-Policy"[^>]*>/;
if(process.argv.includes('--update')){
  await writeFile(path,existing.test(html)?html.replace(existing,meta):html.replace('<meta charset="utf-8" />','<meta charset="utf-8" />\n'+meta+'\n<meta name="referrer" content="strict-origin-when-cross-origin" />'));
  console.log('Security policy updated for '+scripts.length+' inline scripts.');
}else if(!html.includes(meta)){throw new Error('CSP hashes are stale. Run node tools/security-policy.mjs --update.');}
else console.log('Security policy verified.');
