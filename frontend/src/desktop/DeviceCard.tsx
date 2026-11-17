import {Lightbulb,AirVent,ScanLine,Bot,Power,Leaf,Star,ArrowUpRight} from 'lucide-react';import {Switch,Button} from '@arco-design/web-react';
import type {DeviceSnapshot,Mutate} from '../types';import {controlStyle,deviceSummary,sendDeviceCommand} from '../deviceControls/model';import {sourceLabel} from '../homeTelemetry';
const icons={light:Lightbulb,climate:AirVent,cover:ScanLine,cleaning:Bot,switch:Power,sensor:Leaf};
export default function DesktopDeviceCard({device,busy,mutate,onOpen,favorite,onFavorite}:{device:DeviceSnapshot;busy:boolean;mutate:Mutate;onOpen:()=>void;favorite:boolean;onFavorite:()=>void}){
 const Icon=icons[controlStyle(device)],v=device.state.values,disabled=busy||!device.state.online,has=(c:DeviceSnapshot['capabilities'][number])=>device.capabilities.includes(c);
 return <article className={'desktop-device '+(!device.state.online?'is-offline':v.power||v.cleaning?'is-active':'')}>
  <div className="desktop-device-top"><span className="desktop-device-symbol"><Icon size={22}/></span><span className={'device-availability '+(!device.state.online?'warning':'')}>{device.state.online?'在线':'离线'}</span><button className="favorite-icon" aria-label={`${favorite?'取消收藏':'收藏'}${device.name}`} aria-pressed={favorite} onClick={onFavorite}><Star size={17} fill={favorite?'currentColor':'none'}/></button></div>
  <button className="desktop-device-title" onClick={onOpen} title="查看设备详情"><span><strong>{device.name}</strong><small>{device.room} · {sourceLabel(device)}</small></span><ArrowUpRight size={17} aria-hidden/></button>
  <p className="desktop-device-reading">{deviceSummary(device)}</p>
  {(has('power')||has('cleaning')||has('position'))&&<div className="desktop-device-controls">{has('power')&&<Switch aria-label={device.name+'电源'} checked={v.power??false} disabled={disabled||v.power===undefined} onChange={value=>void sendDeviceCommand(mutate,device,{capability:'power',value})}/>} {has('cleaning')&&<Button size="small" disabled={disabled||v.cleaning===undefined} onClick={()=>void sendDeviceCommand(mutate,device,{capability:'cleaning',value:!v.cleaning})}>{v.cleaning?'暂停':'开始清扫'}</Button>}
   {has('position')&&(['open','stop','closed'] as const).map(value=><Button size="small" key={value} disabled={disabled} onClick={()=>void sendDeviceCommand(mutate,device,{capability:'position',value})}>{{open:'打开',stop:'停止',closed:'关闭'}[value]}</Button>)}
  </div>}
 </article>;
}
