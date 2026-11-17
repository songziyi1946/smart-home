import {Lightbulb,AirVent,ScanLine,Bot,Power,Leaf,ChevronRight} from 'lucide-react';
import type {DeviceSnapshot,Mutate} from '../types';import {sourceLabel} from '../homeTelemetry';import {controlStyle,deviceSummary,sendDeviceCommand} from '../deviceControls/model';
export const deviceIcons={light:Lightbulb,climate:AirVent,cover:ScanLine,cleaning:Bot,switch:Power,sensor:Leaf};
export default function DeviceCard({device,busy,mutate,onOpen}:{device:DeviceSnapshot;busy:boolean;mutate:Mutate;onOpen:()=>void}){
 const Icon=deviceIcons[controlStyle(device)],v=device.state.values,hasPower=device.capabilities.includes('power');const active=device.state.online&&(v.power===true||v.cleaning===true);
 return <article className={'mobile-device'+(active?' is-active':'')+(!device.state.online?' is-offline':'')}>
  <button className="mobile-device-main" onClick={onOpen} aria-label={`查看${device.name}详情`}><Icon size={22}/><strong>{device.name}</strong><span>{deviceSummary(device)}</span><small>{device.room} · {sourceLabel(device)==='模拟数据'?'模拟':'HA'}</small></button>
  {hasPower?<button className="mobile-device-power" aria-label={`${v.power?'关闭':'开启'}${device.name}`} aria-pressed={!!v.power} disabled={busy||!device.state.online||v.power===undefined} onClick={()=>void sendDeviceCommand(mutate,device,{capability:'power',value:!v.power})}><Power size={19}/></button>:<ChevronRight className="mobile-device-chevron" size={16} aria-hidden/>}
 </article>;
}
