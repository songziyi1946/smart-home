import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PersonalAiVault } from '../infrastructure/personal-ai-vault.mjs';
import { PersonalAiService } from '../providers/ai/service.mjs';
import { publicAddress, normalizeAiBaseUrl, resolvePublic } from '../providers/ai/transport.mjs';
import { createPersonalAiRouter } from './ai-routes.mjs';
import { createAuth, authorizeHousehold, validateOrigin } from '../auth.mjs';

const connection = () => ({name:'个人识图服务',baseUrl:'https://ai.example/v1/',model:'vision-model',apiKey:'fixture-owner-secret'});
const publicDns = async () => [{address:'8.8.8.8',family:4}];
const response = value => ({status:200,body:Buffer.from(JSON.stringify(value))});
function storage(t) {
  const root=mkdtempSync(join(tmpdir(),'home-personal-ai-')),data=join(root,'data'),key=randomBytes(32);mkdirSync(data);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const vault=new PersonalAiVault(data,key,undefined,{});return {root,data,key,vault};
}

test('personal AI vault is encrypted, restart-safe, owner-scoped and rejects unsafe files and wrong keys', t=>{
  const f=storage(t), service=new PersonalAiService({vault:f.vault});
  const a=service.create('alice',connection()), b=service.create('bob',{...connection(),apiKey:'fixture-bob-secret'});
  assert.deepEqual(service.list('alice').connections.map(value=>value.id),[a.id]);
  assert.deepEqual(service.list('bob').connections.map(value=>value.id),[b.id]);
  assert.deepEqual(service.list('admin').connections,[]);
  assert.throws(()=>service.getForOwner('bob',a.id),{status:404}); assert.throws(()=>service.remove('admin',a.id),{status:404});
  assert.throws(()=>service.create('local',connection()),{status:403});
  assert.throws(()=>service.create('alice',{...connection(),ownerId:'bob'}));
  assert.ok(!JSON.stringify(service.list('alice')).includes('secret')); assert.equal(a.hasKey,true); assert.equal(a.protocol,'openai-responses');
  const bytes=readFileSync(f.vault.path,'utf8');assert.ok(!bytes.includes('fixture-owner-secret'));assert.ok(!bytes.includes('alice'));
  assert.equal(statSync(f.vault.path).mode&0o777,0o600);assert.deepEqual(readdirSync(f.data),[]);
  const restored=new PersonalAiService({vault:new PersonalAiVault(f.data,f.key,undefined,{})});assert.deepEqual(restored.list('alice'),service.list('alice'));
  const wrong=new PersonalAiVault(f.data,randomBytes(32),undefined,{});assert.throws(()=>wrong.load(),/无法读取/);assert.throws(()=>wrong.save({version:1,connections:[]}),/无法读取/);assert.equal(readFileSync(f.vault.path,'utf8'),bytes);
  chmodSync(f.vault.path,0o644);assert.throws(()=>f.vault.load(),/无法读取/);chmodSync(f.vault.path,0o600);
  const symlink=join(f.root,'link.ai.enc');symlinkSync(f.vault.path,symlink);const linked=new PersonalAiVault(f.data,f.key,symlink,{});assert.throws(()=>linked.load(),/无法读取/);assert.throws(()=>linked.save({version:1,connections:[]}),/无法读取/);
  const alias=join(f.root,'alias');symlinkSync(f.data,alias,'dir');assert.throws(()=>new PersonalAiVault(f.data,f.key,join(alias,'account.ai.enc'),{}),/业务数据目录之外/);
  service.remove('alice',a.id);assert.deepEqual(service.list('alice').connections,[]);assert.equal(service.list('bob').connections.length,1);
  assert.ok(readdirSync(f.root).every(name=>!name.endsWith('.tmp')));
});

test('AI endpoints reject private and mapped addresses; DNS answers are checked on every call and pinned', async t=>{
  for(const value of ['127.0.0.1','10.1.1.1','100.100.100.200','169.254.169.254','172.20.1.1','192.168.1.1','192.0.2.1','198.18.0.1','203.0.113.1','224.0.0.1','168.63.129.16','::1','::','fc00::1','fe80::1','::ffff:8.8.8.8','2001:db8::1','2002:0808:0808::1'])assert.equal(publicAddress(value),false,value);
  for(const value of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(value),true,value);
  for(const value of ['http://ai.example/v1','https://a:b@ai.example','https://ai.example/?secret=x','https://ai.example/#hash','https://127.1/v1','https://0x7f000001/v1','https://[::ffff:127.0.0.1]/v1','https://localhost/v1'])assert.throws(()=>normalizeAiBaseUrl(value),{status:400});
  await assert.rejects(resolvePublic(new URL('https://ai.example'),{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]}),{status:400});
  const f=storage(t);let privateDns=false,called=0;
  const service=new PersonalAiService({vault:f.vault,resolve:async()=>privateDns?[{address:'127.0.0.1',family:4}]:publicDns(),transport:async args=>{called++;assert.equal(args.url.href,'https://ai.example/v1/models');assert.deepEqual(args.addresses,[{address:'8.8.8.8',family:4}]);assert.equal(args.headers.Authorization,'Bearer fixture-owner-secret');return response({data:[{id:'vision-model'}]});}});
  const a=service.create('alice',connection());assert.equal(called,0);assert.deepEqual(await service.test('alice',a.id),{ok:true});privateDns=true;await assert.rejects(service.test('alice',a.id),{status:400});assert.equal(called,1);
  await assert.rejects(service.test('admin',a.id),{status:404});assert.equal(called,1);
});

test('Responses requests force selected model, bounded generation and no storage; redirects and errors never echo keys', async t=>{
  const f=storage(t);let mode='ok',calls=0;
  const service=new PersonalAiService({vault:f.vault,resolve:publicDns,transport:async args=>{
    calls++;assert.equal(args.url.href,'https://ai.example/v1/responses');const body=JSON.parse(args.body);assert.equal(body.model,'vision-model');assert.equal(body.store,false);assert.equal(body.max_output_tokens,6000);assert.deepEqual(body.reasoning,{effort:'low'});
    if(mode==='redirect')return {status:302,body:Buffer.from('fixture-owner-secret')};
    if(mode==='auth')return {status:401,body:Buffer.from('fixture-owner-secret')};
    if(mode==='throw')throw Error('fixture-owner-secret');
    if(mode==='large')return {status:200,body:Buffer.alloc(4*1024*1024+1)};
    return response({output:[{content:[{text:'{"rooms":[]}'}]}],usage:{total_tokens:12}});
  }});
  const a=service.create('alice',connection()), payload={input:'floor plan',model:'wrong',max_output_tokens:999999,store:true};
  const result=await service.requestResponses('alice',a.id,payload);assert.equal(result.usage.total_tokens,12);assert.ok(!JSON.stringify(result).includes('secret'));
  for(mode of ['redirect','auth','throw','large'])await assert.rejects(service.requestResponses('alice',a.id,payload),error=>{assert.ok(!error.message.includes('fixture-owner-secret'));assert.equal(error.status,502);return true;});
  const before=calls;await assert.rejects(service.requestResponses('bob',a.id,payload),{status:404});assert.equal(calls,before);
});

test('deleting a connection cancels its pending call and timeouts also cover DNS resolution', async t=>{
  const f=storage(t);let entered;const begun=new Promise(resolve=>{entered=resolve;});
  const service=new PersonalAiService({vault:f.vault,resolve:publicDns,transport:()=>{entered();return new Promise(()=>{});}});
  const a=service.create('alice',connection()), call=service.test('alice',a.id);const rejected=assert.rejects(call,{status:499});await begun;service.remove('alice',a.id);await rejected;
  const timeout=new PersonalAiService({vault:f.vault,timeoutMs:15,resolve:()=>new Promise(()=>{})});const b=timeout.create('bob',connection());
  // Keep the test process alive while the production timeout is deliberately unref'd.
  const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(timeout.test('bob',b.id),{status:504});}finally{clearTimeout(keepAlive);}
});

async function httpFixture(t) {
  const f=storage(t),auth=createAuth({file:join(f.data,'auth.json')}),app=express();let resolveResponse,called,hold=false,lastSignal;
  let upstream=()=>response({data:[{id:'vision-model'}]});
  const service=new PersonalAiService({vault:f.vault,resolve:publicDns,transport:async args=>{lastSignal=args.signal;assert.equal(args.method,'GET');assert.equal(args.url.pathname,'/v1/models');called?.();return hold?new Promise(resolve=>{resolveResponse=resolve;}):upstream();}});
  app.use(express.json({limit:'32kb'}));app.use('/api',validateOrigin);app.use('/api/auth',auth.router);app.use('/api',auth.requireAuth,authorizeHousehold);
  const routes=createPersonalAiRouter({service,sessionFor:auth.sessionFor,subscribeAuth:auth.subscribeSessions});app.use('/api/ai',routes.router);
  app.use((error,_req,res,_next)=>res.status(error instanceof z.ZodError?400:error.status||500).json({message:error.message}));
  const server=await new Promise((resolve,reject)=>{const value=app.listen(0,'127.0.0.1',error=>error?reject(error):resolve(value));});
  t.after(()=>{routes.close();service.close();server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,{method='GET',body,cookie,origin,signal}={}) {const res=await fetch(base+'/api'+path,{method,signal,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0],cache:res.headers.get('cache-control')};}
  const admin=await request('/auth/setup',{method:'POST',body:{username:'ai_admin',password:'fixture-platform-password',displayName:'管理员',homeName:'家庭'}});assert.equal(admin.status,200);
  async function invite(role,username){const inv=await request('/auth/invitations',{method:'POST',cookie:admin.cookie,body:{role,expiresInHours:24,...(role==='guest'?{accessHours:1}:{})}});const joined=await request('/auth/join',{method:'POST',body:{username,password:'fixture-member-password',displayName:username,code:inv.body.code}});assert.equal(joined.status,200);return {cookie:joined.cookie,user:joined.body.user};}
  return {request,admin:admin.cookie,invite,vault:f.vault,setResponse:value=>{upstream=()=>value;},begun:()=>{hold=true;return new Promise(resolve=>{called=resolve;});},aborted:()=>lastSignal?.aborted?Promise.resolve():new Promise(resolve=>lastSignal.addEventListener('abort',resolve,{once:true})),finish:()=>{hold=false;resolveResponse?.(response({data:[{id:'vision-model'}]}));}};
}

test('same-browser users and admin cannot see, test or remove another account connection; revoked sessions cancel work',async t=>{
  const f=await httpFixture(t),alice=await f.invite('member','alice_ai'),bob=await f.invite('member','bob_ai'),guest=await f.invite('guest','guest_ai'),prefix='/ai/connections';
  assert.equal((await f.request(prefix)).status,401);assert.equal((await f.request(prefix,{cookie:guest.cookie})).status,403);
  assert.equal((await f.request(prefix,{method:'POST',cookie:alice.cookie,origin:'https://other.example',body:connection()})).status,403);
  const saved=await f.request(prefix,{method:'POST',cookie:alice.cookie,body:connection()});assert.equal(saved.status,200);assert.ok(!JSON.stringify(saved).includes('fixture-owner-secret'));assert.equal(saved.cache,'no-store');
  const a=saved.body;
  for(const cookie of [bob.cookie,f.admin]) {
    assert.deepEqual((await f.request(prefix,{cookie})).body.connections,[]);
    assert.equal((await f.request(prefix+'/'+a.id+'/test',{method:'POST',body:{},cookie})).status,404);
    assert.equal((await f.request(prefix+'/'+a.id,{method:'DELETE',body:{},cookie})).status,404);
  }
  const begun=f.begun(),pending=f.request(prefix+'/'+a.id+'/test',{method:'POST',body:{},cookie:alice.cookie});await begun;
  assert.equal((await f.request('/auth/members/'+alice.user.id,{method:'DELETE',body:{},cookie:f.admin})).status,200);
  const canceled=await pending;assert.equal(canceled.status,403);assert.ok(!JSON.stringify(canceled).includes('fixture-owner-secret'));f.finish();
  assert.equal((await f.request(prefix,{cookie:alice.cookie})).status,401);
});

test('successful Responses cannot echo API keys through strings, object keys or escaped nested plan JSON', async t=>{
  const f=storage(t);let body;
  const service=new PersonalAiService({vault:f.vault,resolve:publicDns,transport:async()=>({status:200,body:Buffer.from(body)})});
  const a=service.create('alice',connection()),secret=connection().apiKey;
  const escaped=[...secret].map(character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const payloads=[
    JSON.stringify({output_text:'model notes: '+secret}),
    `{"output":[{"content":[{"text":"${escaped}"}]}]}`,
    JSON.stringify({[secret]:'hidden field'}),
    JSON.stringify({output_text:`{"plan":{"notes":["${escaped}"]}}`}),
  ];
  for(body of payloads){
    await assert.rejects(service.requestResponses('alice',a.id,{input:'read plan'}),error=>{assert.equal(error.status,502);assert.equal(error.message,'AI 服务返回了不安全的内容，已拒绝保存');assert.ok(!error.message.includes(secret));return true;});
  }
  body=JSON.stringify({output_text:JSON.stringify({plan:{notes:['普通估算备注']}}),usage:{input_tokens:12}});
  const result=await service.requestResponses('alice',a.id,{input:'read plan'});assert.equal(result.usage.input_tokens,12);
});

test('new AI connections are verified without temporary persistence and saved once only after selected model succeeds', async t=>{
  const f=await httpFixture(t),alice=await f.invite('member','verify_alice'),bob=await f.invite('member','verify_bob'),prefix='/ai/connections';
  f.setResponse({status:401,body:Buffer.from('fixture-owner-secret')});
  const rejected=await f.request(prefix,{method:'POST',cookie:alice.cookie,body:connection()});
  assert.equal(rejected.status,502);assert.ok(!JSON.stringify(rejected.body).includes('fixture-owner-secret'));assert.deepEqual(f.vault.load().connections,[]);
  f.setResponse(response({data:[{id:'different-model'}]}));
  const unavailable=await f.request(prefix,{method:'POST',cookie:alice.cookie,body:connection()});assert.equal(unavailable.status,400);assert.deepEqual(f.vault.load().connections,[]);
  const begun=f.begun(),pending=f.request(prefix,{method:'POST',cookie:alice.cookie,body:connection()});await begun;
  for(const cookie of [alice.cookie,bob.cookie,f.admin])assert.deepEqual((await f.request(prefix,{cookie})).body.connections,[]);
  assert.deepEqual(f.vault.load().connections,[]);f.finish();
  const saved=await pending;assert.equal(saved.status,200);assert.equal(saved.body.hasKey,true);assert.ok(!JSON.stringify(saved.body).includes('fixture-owner-secret'));
  assert.equal(f.vault.load().connections.length,1);assert.equal(f.vault.load().connections[0].ownerId,alice.user.id);
  assert.equal((await f.request(prefix,{cookie:alice.cookie})).body.connections.length,1);assert.deepEqual((await f.request(prefix,{cookie:bob.cookie})).body.connections,[]);
});

test('revoked sessions and disconnected verification requests cannot leave new AI credentials behind', async t=>{
  const f=await httpFixture(t),alice=await f.invite('member','revoke_verify'),bob=await f.invite('member','disconnect_verify'),prefix='/ai/connections';
  let begun=f.begun();const revoked=f.request(prefix,{method:'POST',cookie:alice.cookie,body:connection()});await begun;
  assert.equal((await f.request('/auth/logout',{method:'POST',cookie:alice.cookie,body:{}})).status,200);
  assert.equal((await revoked).status,403);f.finish();assert.deepEqual(f.vault.load().connections,[]);
  const controller=new AbortController();begun=f.begun();const disconnected=f.request(prefix,{method:'POST',cookie:bob.cookie,body:connection(),signal:controller.signal});
  const rejection=assert.rejects(disconnected,error=>error.name==='AbortError');await begun;const upstreamAborted=f.aborted();controller.abort();await rejection;await upstreamAborted;f.finish();
  assert.deepEqual(f.vault.load().connections,[]);assert.deepEqual((await f.request(prefix,{cookie:bob.cookie})).body.connections,[]);
});
