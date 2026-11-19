export {latestFailures, attention} from '../homeTelemetry';
import type {DeviceSnapshot} from '../types';import {controlStyle} from '../deviceControls/model';
export type DeviceFilters={query:string;room:string;category:string;status:string;source:string;favoritesOnly:boolean};
export const emptyFilters:DeviceFilters={query:'',room:'all',category:'all',status:'all',source:'all',favoritesOnly:false};
export function filterDevices(devices:DeviceSnapshot[],filters:DeviceFilters,favorites:string[]){const query=filters.query.trim().toLocaleLowerCase();return devices.filter(d=>(!query||`${d.name} ${d.room} ${d.id}`.toLocaleLowerCase().includes(query))&&(filters.room==='all'||d.roomId===filters.room)&&(filters.category==='all'||controlStyle(d)===filters.category)&&(filters.status==='all'||d.state.online===(filters.status==='online'))&&(filters.source==='all'||d.state.source===filters.source)&&(!filters.favoritesOnly||favorites.includes(d.id)));}
