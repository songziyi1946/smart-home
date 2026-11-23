import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MijiaConnection,{MijiaStatusSummary} from './profile/MijiaConnection.tsx';
import {captchaImageSource,roomBindingPayload} from './profile/model.ts';
import {isSimulatedDevice,onlineSummary,sourceLabel} from './homeTelemetry.ts';
import MobileDeviceCard from './mobile/DeviceCard.tsx';
import { MijiaProvider } from '../../backend/providers/mijia/index.mjs';
import { roomSummary } from './vr/room-state.ts';

test('room binding is explicit and never inferred from a matching display name',()=>{
  const rooms=[{id:'cloud-1',name:'客厅'},{id:'cloud-2',name:'卧室'},{id:'cloud-3',name:'自定义',mappedRoomId:'custom',mappedRoomName:'阁楼'}];
  assert.deepEqual(roomBindingPayload(rooms,{}),[]);
  assert.deepEqual(roomBindingPayload(rooms,{'cloud-1':'living','cloud-2':'','cloud-3':'custom'}),[
    {providerRoomId:'cloud-1',roomId:'living',roomName:'客厅'},
    {providerRoomId:'cloud-3',roomId:'custom',roomName:'阁楼'},
  ]);
  assert.deepEqual(roomBindingPayload(rooms,{'cloud-1':'unknown'}),[]);
});

test('verification images accept only bounded raster data and never remote login URLs',()=>{
  assert.equal(captchaImageSource('https://account.xiaomi.com/image?secret=example'),undefined);
  assert.equal(captchaImageSource('data:image/svg+xml;base64,PHN2Zz4='),undefined);
  assert.equal(captchaImageSource('javascript:alert(1)'),undefined);
  assert.equal(captchaImageSource('data:image/png;base64,'+'A'.repeat(1_500_001)),undefined);
  assert.equal(captchaImageSource('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
});

test('real Mijia state is labelled separately from simulator and local demonstration state',()=>{
  const actual={providerId:'mijia',state:{source:'mijia',online:false}};
  const simulator={providerId:'home-assistant',state:{source:'simulator',online:true}};
  assert.equal(sourceLabel(actual),'米家'); assert.equal(isSimulatedDevice(actual),false);
  assert.equal(sourceLabel(simulator),'模拟数据'); assert.equal(isSimulatedDevice(simulator),true);
  assert.deepEqual(onlineSummary([actual,simulator]),{online:1,total:2,offline:1,simulated:1});
});

test('preview and non-admin settings cannot render Xiaomi credential or challenge forms',()=>{
  for(const role of ['member','guest']){
    const html=renderToStaticMarkup(React.createElement(MijiaConnection,{session:{household:{id:'home',name:'home'},user:{id:'user',role},loggedInAt:'2026-11-23'},disabled:false,onSessionExpired(){}}));
    assert.match(html,/仅家庭管理员/); assert.ok(!html.includes('mijia-password')); assert.ok(!html.includes('<form'));
  }
  const preview=renderToStaticMarkup(React.createElement(MijiaConnection,{session:{localPreview:true,household:{id:'home',name:'home'},user:{id:'user',role:'admin'}},disabled:false,onSessionExpired(){}}));
  assert.match(preview,/登录后绑定/); assert.ok(!preview.includes('<form'));
});

test('offline connection status remains explicit and never promises current device state',()=>{
  const status={state:'offline',region:'cn',homes:[{id:'cloud',name:'测试家庭',rooms:[]}],selectedHomeId:'cloud',rooms:[],deviceCount:2,unsupportedCount:1,pollIntervalSeconds:15,lastSyncAt:'2026-11-23T10:00:00.000Z'};
  const html=renderToStaticMarkup(React.createElement(MijiaStatusSummary,{status}));
  assert.match(html,/暂时无法同步/); assert.match(html,/上次同步/); assert.match(html,/暂不支持当前能力/);
  assert.ok(!html.includes('连接正常')); assert.ok(!html.includes('约每'));
});
test('mobile real device cards use their actual Mijia source label', () => {
  const device = { id: 'mi:light', name: '实际灯具', roomId: 'living', room: '客厅', providerId: 'mijia', providerDeviceId: 'light', capabilities: ['power', 'brightness'], state: { deviceId: 'mi:light', source: 'mijia', online: true, values: { power: false, brightness: 60 } } };
  const html = renderToStaticMarkup(React.createElement(MobileDeviceCard, { device, busy: false, mutate: async () => true, onOpen() {} }));
  assert.match(html, /米家/); assert.ok(!html.includes('· HA'));
});
test('cloud device reports drive model lighting; accepted write targets cannot turn the model on', async t => {
  let reported = false;
  const type = (kind, name) => `urn:miot-spec-v2:${kind}:${name}:test`;
  const cloud = { authenticated: true,
    async listDevices() { return [{ id: 'light', name: '实际灯', model: 'fixture.light', roomId: 'cloud-room', roomName: '来源房间', online: true }]; },
    async getSpec() { return { services: [{ iid: 2, type: type('service', 'light'), properties: [{ iid: 1, type: type('property', 'on'), format: 'bool', access: ['read', 'write'] }, { iid: 2, type: type('property', 'brightness'), format: 'uint8', access: ['read', 'write'], 'value-range': [1, 100, 1], unit: 'percentage' }] }] }; },
    async getProperties(params) { return params.map(value => ({ ...value, code: 0, value: value.piid === 1 ? reported : 65 })); },
    async setProperties(params) { return params.map(value => ({ ...value, code: 0 })); },
  };
  const provider = new MijiaProvider({ cloud, homeId: 'fixture-home', roomBindings: { 'cloud-room': { id: 'living', name: '客厅' } }, pollIntervalMs: 60000 });
  t.after(() => provider.close()); await provider.start();
  assert.equal(roomSummary(provider.snapshot(), 'living').lighting, 0);
  await provider.executeCommand('light', { capability: 'power', value: true });
  assert.equal(roomSummary(provider.snapshot(), 'living').lighting, 0);
  reported = true; await provider.refresh();
  assert.equal(roomSummary(provider.snapshot(), 'living').lighting, 0.65);
  assert.equal(roomSummary(provider.snapshot(), 'living').source, '米家');
});
