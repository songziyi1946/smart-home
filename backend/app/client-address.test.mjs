import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientAddressPolicy} from './client-address.mjs';
import {createAuthThrottle} from './auth-throttle.mjs';
const req=(peer,header)=>({socket:{remoteAddress:peer},get:()=>header});
test('proxy identity is exact, normalized, explicit and independent from Express trust proxy',()=>{
  assert.throws(()=>clientAddressPolicy({SMART_HOME_TRUSTED_PROXY_IP:'172.30.47.0/24'}));
  const policy=clientAddressPolicy({SMART_HOME_TRUSTED_PROXY_IP:'172.30.47.3'});
  assert.equal(policy(req('::ffff:172.30.47.3','198.51.100.10')),'198.51.100.10');
  assert.equal(policy(req('172.30.47.4','198.51.100.10')),'172.30.47.4');
  assert.equal(clientAddressPolicy({})(req('127.0.0.1','198.51.100.10')),'127.0.0.1');
  for(const header of [undefined,'unknown','198.51.100.1, 203.0.113.1'])assert.throws(()=>policy(req('172.30.47.3',header)),{status:400});
  assert.equal(policy(req('172.30.47.3','2001:0db8:0000::1')),'2001:db8::1');
});
test('throttle state is bounded and expired windows recover without evicting blocked sources',()=>{
  let now=0;const limiter=createAuthThrottle({now:()=>now,clientAddress:r=>r.ip,maxSources:2});
  const request=ip=>{let status=200;const res={set(){},status(value){status=value;return this;},json(){}};limiter.middleware({ip},res,()=>{});return status;};
  assert.equal(request('a'),200);assert.equal(request('b'),200);assert.equal(request('c'),429);
  now=900001;assert.equal(request('c'),200);
});
test('Caddy overwrites the identity header and Compose pins the trusted peer',()=>{
  const caddy=readFileSync(new URL('../../deploy/Caddyfile',import.meta.url),'utf8');
  const compose=readFileSync(new URL('../../compose.yaml',import.meta.url),'utf8');
  assert.match(caddy,/header_up X-Smart-Home-Client-IP \{remote_host\}/);
  assert.equal((compose.match(/SMART_HOME_CADDY_IP:-172\.30\.47\.3/g)||[]).length,2);
});
