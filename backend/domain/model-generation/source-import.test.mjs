import test from 'node:test';
import assert from 'node:assert/strict';
import { shareToken, sceneDescriptors, importPanoramaSource } from './source-import.mjs';
const share = 'https://vr.shinewonder.com/pano/page/publik/pklimit?inf=MGMAFDMG@D@ACLDG@';
const base = 'https://vr-img-cdn.shinewonder.com/pano/pano_store/2026_05_05/test/test.tiles/';
const info = {title:'测试作品',needPassword:1,vtProject:[{panoList:[{pid:123,title:'客厅',thumburl:base+'thumb.jpg'}]}]};
const xml = '<krpano><scene name="s_123"><image><cube url="'+base+'%s.jpg"/></image></scene></krpano>';
const jpeg = Buffer.from([255,216,255,192,0,17,8,0,1,0,1,3,1,17,0,2,17,0,3,17,0,255,217]);

test('only supported public share URLs and allowlisted image paths enter the importer', () => {
  assert.equal(shareToken(share), 'MGMAFDMG@D@ACLDG@');
  for (const url of ['http://127.0.0.1/a', share.replace('vr.shinewonder.com','vr.shinewonder.com.evil.test'), share.replace('https://','https://user:secret@'), 'https://vr.shinewonder.com/other?inf=x']) assert.throws(() => shareToken(url));
  const [scene] = sceneDescriptors(info, xml);
  assert.equal(scene.faces.length,6);assert.match(scene.faces[0].pathname,/r.jpg$/);assert.match(scene.faces[5].pathname,/b.jpg$/);
  assert.throws(()=>sceneDescriptors({...info,needPassword:2},xml));
  assert.throws(()=>sceneDescriptors(info,'<!DOCTYPE x>'+xml));
  assert.throws(()=>sceneDescriptors(info,xml.replaceAll('vr-img-cdn.shinewonder.com','127.0.0.1')));
  assert.throws(()=>sceneDescriptors({...info,vtProject:[{panoList:[{pid:123,thumburl:'https://example.com/x.jpg'}]}]},xml));
});

test('public access checks precede images, and the importer never follows denied or paid access', async () => {
  const calls=[];
  const run=async(access=200)=>importPanoramaSource(share,{resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async request=>{
    const path=request.url.pathname;calls.push(path);assert.equal(request.headers.Authorization,undefined);
    let value;if(path.endsWith('/Validation'))value={code:200,state:200,data:{destroy:0,type:1,tUrl:'vivi=42&viewType=201'}};
    else if(path.endsWith('/getUserDouSufficient'))value={code:access};
    else if(path.endsWith('/getVtShowInfo'))value={code:200,data:info};
    else if(path.endsWith('.xml'))return{status:200,body:Buffer.from(xml)};
    else return{status:200,body:jpeg};
    return{status:200,body:Buffer.from(JSON.stringify(value))};
  }});
  await assert.rejects(run(403),/额外访问权限/);assert.equal(calls.length,2);
  calls.length=0;const result=await run();assert.equal(result.title,'测试作品');assert.equal(result.scenes[0].faces.length,6);assert.equal(calls.length,11);
});

test('malformed upstream data and nonpublic DNS fail without leaking upstream content',async()=>{
  await assert.rejects(importPanoramaSource(share,{resolve:async()=>[{address:'127.0.0.1',family:4}],transport:()=>assert.fail('must not fetch')}),/暂时无法读取/);
  await assert.rejects(importPanoramaSource(share,{resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async()=>({status:200,body:Buffer.from('upstream-private-debug')})}),error=>!error.message.includes('upstream-private-debug'));
});

 test('withdrawn or unapproved works cannot bypass the public viewer status gate', async () => {
  let calls=0;
  await assert.rejects(importPanoramaSource(share,{resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async()=>{calls++;return{status:200,body:Buffer.from(JSON.stringify({code:200,state:200,data:{destroy:0,type:1,tUrl:'vivi=42&viewType=201'},userVrInfo:{status:5}}))};}}),/删除|审核/);
  assert.equal(calls,1);
});
