import {House, Zap, ReceiptText, Settings, Box, Layers, LayoutGrid, SlidersHorizontal} from 'lucide-react';
export const nav = [
 {id:'home',name:'家庭总览',shortName:'家庭',icon:House,group:'daily'},
 {id:'rooms',name:'房间',shortName:'房间',icon:LayoutGrid,group:'daily'},
 {id:'devices',name:'设备管理',shortName:'设备',icon:SlidersHorizontal,group:'daily'},
 {id:'scenes',name:'生活场景',shortName:'场景',icon:Layers,group:'daily'},
 {id:'vr',name:'空间漫游',shortName:'空间',icon:Box,group:'manage'},
 {id:'automation',name:'自动化',shortName:'自动化',icon:Zap,group:'manage'},
 {id:'billing',name:'能源与缴费',shortName:'缴费',icon:ReceiptText,group:'manage'},
 {id:'profile',name:'家庭设置',shortName:'设置',icon:Settings,group:'manage'},
] as const;
export function visibleNavigation(role:string){return nav.filter(item=>role!=='guest'||!['automation','billing'].includes(item.id));}

export function resolvePage(hash:string): import('../types').Page { const id=hash.replace(/^#/, '');return id==='account'?'account':nav.find(item=>item.id===id)?.id??'home'; }
