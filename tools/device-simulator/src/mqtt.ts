import mqtt from 'mqtt';
import type {Simulator, VirtualDevice} from './core.ts';
export const root='smart-home-simulator';
export const base=(id:string)=>`${root}/devices/${id}`;
export function discovery(d:VirtualDevice,prefix='homeassistant'){
 const b=base(d.id),state_topic=b+'/state';
 const common={name:d.name,unique_id:d.id,default_entity_id:`${d.type==='motion'||d.type==='contact'?'binary_sensor':d.type}.${d.id}`,availability:[{topic:root+'/availability'},{topic:b+'/availability'}],availability_mode:'all',json_attributes_topic:b+'/attributes'};
 const dev={identifiers:[d.id],name:d.name,manufacturer:'Home OS Simulator',model:'Virtual Home'};
 let domain=d.type,config:Record<string,unknown>={};
 if(d.type==='light')config={schema:'json',state_topic,command_topic:b+'/set',brightness:true,supported_color_modes:['color_temp'],min_color_temp_kelvin:2000,max_color_temp_kelvin:6500,color_temp_kelvin:true};
 if(d.type==='climate')config={modes:['off','cool','heat','auto'],mode_command_topic:b+'/mode/set',mode_state_topic:state_topic,mode_state_template:'{{ value_json.hvacMode }}',temperature_command_topic:b+'/temperature/set',temperature_state_topic:state_topic,temperature_state_template:'{{ value_json.targetTemperature }}',current_temperature_topic:state_topic,current_temperature_template:'{{ value_json.currentTemperature }}',min_temp:16,max_temp:30,temperature_unit:'C'};
 if(d.type==='cover')config={command_topic:b+'/set',set_position_topic:b+'/position/set',position_topic:state_topic,position_template:'{{ value_json.position }}',state_topic,value_template:"{{ 'closed' if value_json.position == 0 else ('open' if value_json.position == value_json.target else ('opening' if value_json.target > value_json.position else 'closing')) }}"};
 if(d.type==='vacuum')config={schema:'state',command_topic:b+'/set',state_topic,supported_features:['start','pause','stop','return_home','status']};
 if(d.type==='motion'||d.type==='contact'){domain='binary_sensor';config={state_topic,device_class:d.type==='motion'?'motion':'door',value_template:d.type==='motion'?"{{ 'ON' if value_json.occupancy else 'OFF' }}":"{{ 'ON' if value_json.contact == 'open' else 'OFF' }}"};}
 if(d.type==='environment'){
  const cmps=Object.fromEntries(['temperature','humidity','pm25','co2'].map(key=>[key,{platform:'sensor',unique_id:d.id+'_'+key,default_entity_id:'sensor.'+d.id+'_'+key,name:key,device_class:({pm25:'pm25',co2:'carbon_dioxide'} as Record<string,string>)[key]??key,unit_of_measurement:({temperature:'°C',humidity:'%',pm25:'µg/m³',co2:'ppm'} as Record<string,string>)[key],state_topic,value_template:`{{ value_json.${key} }}`,json_attributes_topic:b+'/attributes'}]));
  return {topic:`${prefix}/device/${d.id}/config`,config:{device:dev,origin:{name:'Home OS Simulator',sw_version:'1.0'},components:cmps,availability:common.availability,availability_mode:'all'}};
 }
 return {topic:`${prefix}/${domain}/${d.id}/config`,config:{...common,...config,device:dev}};
}
export function parseCommand(topic:string,payload:string,d:VirtualDevice){
 const b=base(d.id);if(!topic.startsWith(b+'/'))throw Error('Topic mismatch');const channel=topic.slice(b.length+1);
 if(d.type==='light'&&channel==='set'){const p=JSON.parse(payload);if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['state','brightness','color_temp','color_temp_kelvin','color_mode','transition'].includes(k)))throw Error('Invalid light payload');const out:Record<string,unknown>={};if(p.state!==undefined){if(!['ON','OFF'].includes(p.state))throw Error('Invalid power');out.power=p.state==='ON';}if(p.brightness!==undefined){if(!Number.isFinite(p.brightness)||p.brightness<0||p.brightness>255)throw Error('Invalid brightness');out.brightness=Math.max(1,Math.round(p.brightness/255*100));}if(p.color_temp_kelvin!==undefined)out.colorTemperature=p.color_temp_kelvin;else if(p.color_temp!==undefined)out.colorTemperature=Math.round(1000000/p.color_temp);return out;}
 if(d.type==='climate'&&channel==='mode/set')return {hvacMode:payload};
 if(d.type==='climate'&&channel==='temperature/set'&&payload.trim())return {targetTemperature:Number(payload)};
 if(d.type==='cover'){if(channel==='position/set'&&payload.trim())return {target:Number(payload)};if(channel==='set'&&['OPEN','CLOSE','STOP'].includes(payload))return {target:payload==='OPEN'?100:payload==='CLOSE'?0:d.state.position};}
 if(d.type==='vacuum'&&channel==='set'){const activity=({start:'cleaning',pause:'paused',stop:'idle',return_to_base:'returning'} as Record<string,string>)[payload];if(activity)return {activity};}
 throw Error('Unsupported command');
}
export function wireState(d:VirtualDevice){const s=d.state;if(d.type==='light')return {state:s.power?'ON':'OFF',brightness:Math.round(Number(s.brightness)*255/100),color_temp_kelvin:s.colorTemperature,color_mode:'color_temp'};if(d.type==='vacuum')return {state:s.activity,battery_level:Math.round(Number(s.battery))};return s;}
export function connectSimulator(sim:Simulator,options:{url?:string;username?:string;password?:string;discoveryPrefix?:string;log?:(s:string)=>void}={}){
 const prefix=options.discoveryPrefix??'homeassistant';if(!/^[\w/-]+$/.test(prefix))throw Error('Invalid discovery prefix');const log=options.log??console.log;
 const client=mqtt.connect(options.url??'mqtt://127.0.0.1:18883',{username:options.username,password:options.password,clientId:'virtual_home_simulator',reconnectPeriod:1000,will:{topic:root+'/availability',payload:'offline',qos:1,retain:true}});
 const publish=(topic:string,payload:unknown)=>client.publishAsync(topic,typeof payload==='string'?payload:JSON.stringify(payload),{qos:1,retain:true});
 async function state(d:VirtualDevice){if(!client.connected)return;await publish(base(d.id)+'/availability',d.online?'online':'offline');if(d.online){await publish(base(d.id)+'/attributes',{source:'simulator',last_seen:new Date().toISOString(),...(d.type==='vacuum'?{battery_level:Math.round(Number(d.state.battery))}:{})});await publish(base(d.id)+'/state',wireState(d));}log(`[state] ${d.id} ${d.online?'online':'offline'}`);}
 async function announce(){for(const d of sim.devices){const item=discovery(d,prefix);await publish(item.topic,item.config);await state(d);}await publish(root+'/availability','online');log('[discovery] Virtual Home published');}
 // Serialize publications so reset and later telemetry cannot overtake each other.
 let queue=Promise.resolve();const enqueue=(work:()=>Promise<void>)=>{queue=queue.then(work).catch(()=>log('[mqtt] publish failed'));};
 const changed=(d:VirtualDevice)=>enqueue(()=>state(d));sim.on('change',changed);
 client.on('connect',()=>{log('[simulator] MQTT connected');void client.subscribeAsync([root+'/devices/+/set',root+'/devices/+/+/set',prefix+'/status']).then(()=>enqueue(announce)).catch(()=>log('[mqtt] subscription failed'));});
 client.on('message',(topic,payload,packet)=>{if(topic===prefix+'/status'){if(payload.toString()==='online')enqueue(announce);return;}if(packet.retain)return;try{const id=topic.split('/')[2],d=sim.get(id);const accepted=sim.command(id,parseCommand(topic,payload.toString(),d));log(`[command] ${id} ${accepted?'queued':'ignored: offline'}`);}catch{log('[command] rejected');}});
 client.on('error',()=>log('[mqtt] connection error'));
 return {client,async close(){sim.off('change',changed);if(client.connected){await queue;await publish(root+'/availability','offline');}await client.endAsync(true);}};
}
