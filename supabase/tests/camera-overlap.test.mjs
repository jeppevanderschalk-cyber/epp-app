import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const scope={};vm.runInNewContext(readFileSync(new URL('../../camera-series.js',import.meta.url),'utf8'),scope);
function evidence(circles,rx=6,ry=6){
 const width=64,height=64,pixels=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(circles.some(([cx,cy])=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1))pixels[y*width+x]=1;
 return scope.EppCameraSeries.holeEvidence(pixels,width,height,rx,ry);
}
for(const [name,points,rx,ry] of [
 ['one circular hole',[[24,24]],6,6],
 ['two overlapping holes',[[24,24],[31,24]],6,6],
 ['three overlapping holes',[[24,24],[31,24],[27,31]],6,6],
 ['non-square image scale',[[24,24],[34,24]],8,5]
])test(name,()=>{
 const result=evidence(points,rx,ry);
 assert.equal(result.arcCount,points.length,JSON.stringify(result));
 for(const [x,y] of points)assert(result.centers.some(p=>Math.hypot(p.x-x,p.y-y)<3),JSON.stringify(result));
 if(points.length>1)assert(result.areaEquivalent<points.length,'overlap area must not be counted as summed full holes');
});
test('complete overlap remains one visible hole',()=>assert.equal(evidence([[24,24],[24,24]]).arcCount,1));
test('too few pixels cannot produce reliable circle fits',()=>assert.equal(evidence([[24,24]],1,1).arcCount,0));
test('empty mask produces no circles',()=>assert.equal(evidence([]).arcCount,0));
