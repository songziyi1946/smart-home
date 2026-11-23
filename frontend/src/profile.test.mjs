import test from 'node:test';import assert from 'node:assert/strict';
import {integrationSummary,roleDetails,permissionRows,guestAccessText} from './profile/model.ts';
import {authorizeHousehold} from '../../backend/auth.mjs';
test('integration overview distinguishes device provenance from provider connection health',()=>{assert.deepEqual(integrationSummary([]),{ha:0,haOnline:0,mock:0,simulator:0,mijia:0,mijiaOnline:0});const ds=[{providerId:'mock',state:{online:true,source:'mock'}},{providerId:'home-assistant',state:{online:true,source:'simulator'}},{providerId:'home-assistant',state:{online:false,source:'home-assistant'}},{providerId:'mijia',state:{online:true,source:'mijia'}}];assert.deepEqual(integrationSummary(ds),{ha:2,haOnline:1,mock:1,simulator:1,mijia:1,mijiaOnline:1});});
test('permission descriptions match unchanged household authorization for common operations',()=>{
 function allowed(role,path,method){let permitted=false;const res={status:()=>res,json:()=>{}};authorizeHousehold({user:{role},path,method},res,()=>{permitted=true});return permitted;}
 for(const role of ['admin','member','guest']){assert.equal(allowed(role,'/devices/lamp','PATCH'),true);assert.equal(allowed(role,'/scenes/home','POST'),true);assert.equal(allowed(role,'/automations','POST'),role==='admin');assert.equal(allowed(role,'/expenses','POST'),role!=='guest');}
 assert.match(roleDetails.guest,/不可查看成员/);assert.match(roleDetails.member,/不能管理成员/);assert.equal(permissionRows.at(-1).guest,'不可查看名单');
});
test('guest duration is counted from joining, separately from invitation expiry',()=>{assert.equal(guestAccessText(1),'加入后 1 小时');assert.equal(guestAccessText(24),'加入后 24 小时');assert.equal(guestAccessText(168),'加入后 7 天');});
