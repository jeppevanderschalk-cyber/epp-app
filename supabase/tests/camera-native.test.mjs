import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../camera-native.js',import.meta.url),'utf8');
function setup(){
 const messages=[],scope={File,Uint8Array,atob,webkit:{messageHandlers:{eppCamera:{postMessage:v=>messages.push(v)}}}};
 vm.runInNewContext(source,scope);return {bridge:scope.EppCameraNative,messages};
}
const photo=(extra={})=>({id:'11111111-1111-4111-8111-111111111111',contextId:'series-a',mime:'image/jpeg',base64:'/9j/2Q==',...extra});
test('no native capture UI outside the helper app',()=>{const scope={};vm.runInNewContext(source,scope);assert.equal(scope.EppCameraNative.available(),false);});
test('same photo delivered concurrently and retried is processed once',async()=>{
 const {bridge}=setup();let calls=0,release;
 bridge.attach('series-a',async file=>{calls++;assert.equal(file.type,'image/jpeg');await new Promise(r=>release=r);return {ok:true,phase:'review'};});
 const a=bridge.receivePhoto(photo()),b=bridge.receivePhoto(photo());await new Promise(r=>setTimeout(r,0));release();
 await Promise.all([a,b]);await bridge.receivePhoto(photo());assert.equal(calls,1);
});
test('changed shooter, invalid image and unmounted camera cannot accept photos',async()=>{
 const {bridge,messages}=setup();let calls=0;const detach=bridge.attach('series-a',async()=>{calls++;return {ok:true};});
 await assert.rejects(bridge.receivePhoto(photo({contextId:'another-stage'})));
 await assert.rejects(bridge.receivePhoto(photo({mime:'text/html'})));
 await assert.rejects(bridge.receivePhoto(photo({base64:'SGVsbG8='})));
 detach();await assert.rejects(bridge.receivePhoto(photo()));assert.equal(calls,0);assert.equal(messages.at(-1).captureAllowed,false);
});
test('capture requests and status carry the current context only',()=>{
 const {bridge,messages}=setup();bridge.attach('series-a',async()=>({ok:true}));
 bridge.state({contextId:'stale',captureAllowed:true});assert.equal(messages.length,0);
 bridge.capture();assert.equal(messages[0].contextId,'series-a');assert.equal(messages[0].type,'capture');
});
test('failed photo delivery can be retried without being marked completed',async()=>{
 const {bridge}=setup();let calls=0;
 bridge.attach('series-a',async()=>{if(++calls===1)throw Error('not ready');return {ok:true};});
 await assert.rejects(bridge.receivePhoto(photo()));assert.equal((await bridge.receivePhoto(photo())).ok,true);assert.equal(calls,2);
});
