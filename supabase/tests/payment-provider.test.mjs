import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quote,configured,seal,unseal,paymentRequest,verifiedPayment,checkoutUrl,publicOrder,mollie,tokens} from '../functions/epp-payments/provider.ts';
const key='a'.repeat(64),choices=[{discipline:'pistool',slotId:'one'},{discipline:'optiek',slotId:'two'}];
const order={id:'order-id',match_id:'match-id',club_code:'apgs',organization_id:'org_apgs',profile_id:'pfl_apgs',amount_cents:2400,currency:'EUR',choices};
const config={clientId:'app_test',clientSecret:'only-a-fixture',encryptionKey:key,publicUrl:'https://epp-app.nl/',functionUrl:'https://example.supabase.co/functions/v1/epp-payments'};
const payment={id:'tr_fixture',mode:'live',profileId:'pfl_apgs',metadata:{eppOrderId:'order-id',club:'apgs'},amount:{currency:'EUR',value:'24.00'},status:'paid'};
test('only Standard and Optics are available at EUR12 each',()=>{
  assert.equal(quote([choices[0]]),1200);assert.equal(quote([choices[1]]),1200);assert.equal(quote(choices),2400);
  for(const bad of [[],[...choices,{discipline:'pcc',slotId:'three'}],[choices[0],choices[0]],[{discipline:'pcc',slotId:'x'}]])assert.throws(()=>quote(bad));
  assert.equal(configured(config),true);assert.equal(configured({...config,clientSecret:''}),false);
});
test('OAuth credentials are authenticated, encrypted and bound to the club',async()=>{
  const secret={accessToken:'sensitive-token',refreshToken:'sensitive-refresh'};
  const encrypted=await seal(secret,key,'club:apgs');assert.ok(!encrypted.includes(secret.accessToken));assert.ok(!encrypted.includes(secret.refreshToken));
  assert.deepEqual(await unseal(encrypted,key,'club:apgs'),secret);
  await assert.rejects(unseal(encrypted,key,'club:svbb'));
  await assert.rejects(unseal(encrypted,'b'.repeat(64),'club:apgs'));
  const altered=JSON.parse(encrypted),bytes=Buffer.from(altered.data,'base64');bytes[0]^=1;altered.data=bytes.toString('base64');await assert.rejects(unseal(JSON.stringify(altered),key,'club:apgs'));
});
test('request fixes price, recipient, metadata and return URLs on the server',()=>{
  const body=paymentRequest({...order,amountFromBrowser:1,bankAccountFromBrowser:'wrong'},config);
  assert.deepEqual(body.amount,{currency:'EUR',value:'24.00'});assert.equal(body.profileId,'pfl_apgs');assert.equal(body.method,'ideal');
  assert.equal(new URL(body.webhookUrl).searchParams.get('order'),order.id);assert.equal(new URL(body.redirectUrl).searchParams.get('match'),order.match_id);
  assert.equal(body.applicationFee,undefined);assert.equal(body.routing,undefined);
  assert.equal(paymentRequest({...order,provider_mode:'test'},config).testmode,true);
  assert.equal(body.testmode,undefined);
  assert.throws(()=>paymentRequest({...order,amount_cents:1},config));
});
test('provider status is verified, never inferred from redirect or webhook text',()=>{
  assert.equal(verifiedPayment(order,payment).status,'paid');
  for(const replacement of [{amount:{currency:'EUR',value:'12.00'}},{amount:{currency:'USD',value:'24.00'}},{profileId:'pfl_another'},{metadata:{eppOrderId:'wrong',club:'apgs'}},{metadata:{eppOrderId:'order-id',club:'svbb'}},{mode:'test'},{status:'unknown'},{id:'untrusted'},{amountRefunded:{currency:'EUR',value:'25.00'}}])assert.throws(()=>verifiedPayment(order,{...payment,...replacement}),JSON.stringify(replacement));
  assert.throws(()=>verifiedPayment({...order,provider_id:'tr_other'},payment));
  assert.equal(verifiedPayment(order,{...payment,amountRefunded:{currency:'EUR',value:'12.00'}}).refunded,1200);
  assert.equal(verifiedPayment({...order,provider_mode:'test'},{...payment,mode:'test'}).status,'paid');
});
test('no credential, actor id or raw provider data reaches browser responses',()=>{
  const result=publicOrder({...order,credentials:'secret',create_token:'secret',actor_id:'private',provider_id:'tr_fixture',status:'open',checkout_url:'javascript:alert(1)'});
  assert.equal(result.checkoutUrl,null);assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(result.actor_id,undefined);
  for(const url of ['javascript:alert(1)','https://mollie.com.evil.example/pay','https://evil.example/','https://user:pass@www.mollie.com/pay'])assert.equal(checkoutUrl(url),null);
  assert.equal(checkoutUrl('https://www.mollie.com/checkout/fixture'),'https://www.mollie.com/checkout/fixture');
});
test('payment creation uses stable idempotency and sanitized provider errors',async()=>{
  let sent;
  await mollie('/v2/payments','token',{method:'POST',key:'stable-key',body:{a:1}},async(url,options)=>{sent={url,...options};return Response.json(payment);});
  assert.equal(sent.headers['Idempotency-Key'],'stable-key');assert.equal(sent.headers.Authorization,'Bearer token');assert.equal(sent.url,'https://api.mollie.com/v2/payments');
  await assert.rejects(mollie('/v2/payments','secret',{},async()=>Response.json({message:'leaks secret'},{status:401})),{message:'betaaldienst_http_401'});
  await assert.rejects(mollie('/v2/payments','secret',{},async()=>{throw Error('leaks secret');}),{message:'betaaldienst_onbereikbaar'});
});
test('OAuth exchange uses server Basic auth and the exact redirect URI',async()=>{
  const grant={grant_type:'authorization_code',code:'once-only-code',redirect_uri:config.functionUrl+'?route=oauth_callback'};let sent;
  const result=await tokens(config,grant,async(url,options)=>{sent={url,...options};return Response.json({access_token:'at',refresh_token:'rt',expires_in:3600});});
  assert.equal(sent.url,'https://api.mollie.com/oauth2/tokens');assert.equal(sent.headers.Authorization,'Basic '+btoa(config.clientId+':'+config.clientSecret));
  assert.equal(new URLSearchParams(sent.body).get('redirect_uri'),grant.redirect_uri);assert.equal(result.refreshToken,'rt');
});
