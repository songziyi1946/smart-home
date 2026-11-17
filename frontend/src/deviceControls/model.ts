import type {DeviceSnapshot,DeviceCommand,Mutate} from '../types';
export function controlStyle(d:DeviceSnapshot){const c=d.capabilities;return c.includes('brightness')?'light':c.includes('targetTemperature')||c.includes('hvacMode')?'climate':c.includes('position')||c.includes('positionPercent')?'cover':c.includes('cleaning')?'cleaning':c.includes('power')?'switch':'sensor';}
export const metricLabels={temperature:'温度',humidity:'湿度',pm25:'PM2.5',co2:'CO₂',battery:'电量'} as const;
export const modeLabels={off:'关闭',cool:'制冷',heat:'制热',auto:'自动',heat_cool:'冷暖',dry:'除湿',fan_only:'送风'} as const;
export function deviceSummary(d:DeviceSnapshot){
 if(!d.state.online)return '设备离线';const v=d.state.values;const parts:string[]=[];
 if(d.capabilities.includes('power')&&v.power!==undefined)parts.push(v.power?'已开启':'已关闭');
 if(v.brightness!==undefined&&v.power!==false)parts.push(`亮度 ${v.brightness}%`);
 if(v.targetTemperature!==undefined)parts.push(`目标 ${v.targetTemperature}°C`);
 if(v.positionPercent!==undefined)parts.push(`打开 ${v.positionPercent}%`);else if(v.position!==undefined)parts.push({open:'已打开',stop:'已停止',closed:'已关闭'}[v.position]);
 if(v.cleaning!==undefined)parts.push(v.cleaning?'清扫中':'待机');
 if(v.occupancy!==undefined)parts.push(v.occupancy?'检测到活动':'无人活动');
 if(v.contact!==undefined)parts.push(v.contact==='open'?'门窗打开':'门窗关闭');
 if(v.binary!==undefined&&v.occupancy===undefined&&v.contact===undefined)parts.push(v.binary?'已触发':'未触发');
 if(v.temperature!==undefined)parts.push(`${v.temperature}°C`);if(v.humidity!==undefined)parts.push(`${v.humidity}% 湿度`);
 if(v.pm25!==undefined)parts.push(`PM2.5 ${v.pm25}`);if(v.co2!==undefined)parts.push(`CO₂ ${v.co2} ppm`);if(v.battery!==undefined)parts.push(`电量 ${Math.round(v.battery)}%`);
 return parts.slice(0,2).join(' · ')||'暂无数据';
}
export async function sendDeviceCommand(mutate:Mutate,device:DeviceSnapshot,command:DeviceCommand){
 if(!device.state.online||!device.capabilities.includes(command.capability))return false;
 return mutate('/devices/'+encodeURIComponent(device.id),'PATCH',command);
}
export function roomOptions(devices:DeviceSnapshot[]){const rooms=new Map<string,string>();for(const d of devices)rooms.set(d.roomId,d.room);return [...rooms].map(([id,name])=>({id,name})).sort((a,b)=>Number(a.id==='unassigned')-Number(b.id==='unassigned'));}
export function defaultFavorites(devices:DeviceSnapshot[]){
 const sorted=[...devices].sort((a,b)=>Number(a.state.source==='mock')-Number(b.state.source==='mock'));
 const chosen:DeviceSnapshot[]=[];const styles=new Set<string>();for(const d of sorted){const style=controlStyle(d);if(!styles.has(style)){styles.add(style);chosen.push(d);}if(chosen.length===4)break;}
 for(const d of sorted){if(chosen.length===4)break;if(!chosen.some(v=>v.id===d.id))chosen.push(d);}return chosen.map(d=>d.id);
}
