import test from 'node:test';
import assert from 'node:assert/strict';
import { mapEntity, commandToService } from './mapping.mjs';
import { DeviceCommand } from '../../domain/devices/model.mjs';
const entity = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_updated: '2026-11-16T00:00:00Z' });

test('maps light, climate, cover, temperature/humidity, binary and vacuum into normalized capabilities', () => {
  const light = entity('light.test','on',{ brightness: 128, supported_color_modes: ['brightness'], friendly_name: '灯' });
  const mapped = mapEntity(light, { 'light.test': { id: 'living', name: '客厅' } });
  assert.deepEqual(mapped.state.values,{ power: true, brightness: 50 });
  assert.equal(mapped.device.roomId,'living');
  assert.equal(mapped.device.attributes,undefined);
  assert.deepEqual(mapEntity(entity('climate.test','cool',{supported_features:1,hvac_modes:['off','cool'],temperature:77,current_temperature:68,temperature_unit:'°F'})).state.values,
    {power:true,hvacMode:'cool',targetTemperature:25,temperature:20});
  assert.equal(mapEntity(entity('cover.test','open',{supported_features:11})).state.values.position,'open');
  assert.equal(mapEntity(entity('sensor.test','77',{device_class:'temperature',unit_of_measurement:'°F'})).state.values.temperature,25);
  assert.equal(mapEntity(entity('sensor.test','45',{device_class:'humidity',unit_of_measurement:'%'})).state.values.humidity,45);
  assert.equal(mapEntity(entity('binary_sensor.test','on')).state.values.binary,true);
  assert.deepEqual(mapEntity(entity('vacuum.test','cleaning',{supported_features:8260,battery_level:92})).state.values,{cleaning:true,battery:92});
});
test('unknown/unavailable remain offline and do not fabricate values; unsupported entities are omitted', () => {
  assert.equal(mapEntity(entity('switch.test','on')),null);
  assert.equal(mapEntity(entity('sensor.test','12',{device_class:'energy'})),null);
  assert.equal(mapEntity(entity('cover.test','open',{supported_features:1})),null);
  for (const state of ['unknown','unavailable']) {
    const value=mapEntity(entity('light.test',state,{supported_color_modes:['brightness'],brightness:128}));
    assert.equal(value.state.online,false);assert.deepEqual(value.state.values,{});
  }
  assert.equal(mapEntity(entity('cover.test','opening',{supported_features:11})).state.values.position,undefined);
});
test('service mapping validates support, mode, temperature bounds and read-only telemetry', () => {
  const light=entity('light.test','off',{supported_color_modes:['brightness']});
  assert.deepEqual(commandToService(light,{capability:'brightness',value:50}),{domain:'light',service:'turn_on',data:{entity_id:'light.test',brightness_pct:50}});
  const climate=entity('climate.test','off',{supported_features:1,hvac_modes:['off','cool'],min_temp:60,max_temp:86,temperature_unit:'°F'});
  assert.equal(commandToService(climate,{capability:'power',value:true}).data.hvac_mode,'cool');
  assert.equal(commandToService(climate,{capability:'targetTemperature',value:25}).data.temperature,77);
  assert.throws(()=>commandToService(climate,{capability:'targetTemperature',value:40}),{status:400});
  assert.throws(()=>commandToService(climate,{capability:'hvacMode',value:'heat'}),{status:400});
  assert.throws(()=>commandToService({...light,state:'unavailable'},{capability:'power',value:true}),{status:409});
  assert.throws(()=>commandToService(light,{capability:'cleaning',value:true}),{status:400});
  for(const capability of ['temperature','humidity','binary','battery']) assert.throws(()=>DeviceCommand.parse({capability,value:20}));
});
