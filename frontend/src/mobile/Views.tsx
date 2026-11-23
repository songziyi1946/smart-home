export {default as QuickScenes} from '../home/QuickActions';
import {StatusPanel} from '../ui/StatusPanel';
import {ChevronRight,Box,Star,Leaf} from 'lucide-react';
import type {DeviceSnapshot,State,Mutate} from '../types';import DeviceCard from './DeviceCard';import {roomOptions} from '../deviceControls/model';import {metricReading,occupancyReading} from '../homeTelemetry';
export function EnvironmentSummary({devices}:{devices:DeviceSnapshot[]}){
 const anchor=metricReading(devices,'temperature')??metricReading(devices,'humidity')??metricReading(devices,'co2')??metricReading(devices,'pm25');const selected=anchor?devices.filter(d=>d.roomId===anchor.device.roomId):devices;
 const readings=Object.fromEntries((['temperature','humidity','pm25','co2'] as const).map(key=>[key,metricReading(selected,key)]));
 return <details className="mobile-environment"><summary><Leaf size={18}/><span>{anchor?anchor.device.room+'环境':'环境信息'}<small>{readings.temperature?`${readings.temperature.value}°C`:'温度暂无数据'} · {readings.humidity?`${readings.humidity.value}%`:'湿度暂无数据'}</small></span><ChevronRight size={16}/></summary><div className="environment-expanded">{([['temperature','温度','°C'],['humidity','湿度','%'],['pm25','PM2.5','μg/m³'],['co2','CO₂','ppm']] as const).map(([key,label,unit])=><div key={key}><small>{label}</small><strong>{readings[key]?`${readings[key].value} ${unit}`:'暂无数据'}</strong><small>{readings[key]?.source??'未接入或离线'}</small></div>)}</div></details>;
}
type DeviceProps={busy:boolean;mutate:Mutate;onOpen:(id:string)=>void};
export {default as MobileHome} from './Today';
export function RoomsPage({state,roomId,onRoom,offlineOnly,onOfflineChange,...props}:{state:State;roomId:string;onRoom:(id:string)=>void;offlineOnly:boolean;onOfflineChange:(value:boolean)=>void}&DeviceProps){
 const rooms=roomOptions(state.devices),selected=rooms.some(r=>r.id===roomId)?roomId:'all';const devices=state.devices.filter(d=>(selected==='all'||d.roomId===selected)&&(!offlineOnly||!d.state.online));
 return <div className="rooms-page"><div className="room-chip-row" aria-label="按房间查看"><button aria-pressed={selected==='all'} onClick={()=>onRoom('all')}>全部</button>{rooms.map(room=><button key={room.id} aria-pressed={selected===room.id} onClick={()=>onRoom(room.id)}>{room.name}</button>)}</div><div className="mobile-section-heading"><h2>{selected==='all'?'全部设备':rooms.find(r=>r.id===selected)?.name}</h2><button aria-pressed={offlineOnly} onClick={()=>onOfflineChange(!offlineOnly)}>{offlineOnly?'显示全部':'只看离线'}</button></div><p className="muted">{devices.length} 项设备</p>
  {devices.length?<div className="mobile-device-grid">{devices.map(device=><DeviceCard key={device.id} device={device} busy={props.busy} mutate={props.mutate} onOpen={()=>props.onOpen(device.id)}/>)}</div>:<StatusPanel compact kind="empty" title={offlineOnly?"当前没有离线设备":selected==="all"?"尚未发现设备":"这个房间暂无设备"} action={state.devices.length?<button className="quiet-button" onClick={()=>{onRoom("all");onOfflineChange(false);}}>查看全部设备</button>:<a className="quiet-button" href="#profile">查看家庭设置</a>}/>}
  {selected!=='all'&&<EnvironmentSummary devices={state.devices.filter(d=>d.roomId===selected)}/>}
  <a href="#vr" className="mobile-secondary-link"><Box size={18}/>空间视图 / VR <ChevronRight size={16}/></a>
 </div>;
}
