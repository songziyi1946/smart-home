import {House, Zap, ReceiptText, Settings, Box, Layers, LayoutGrid, SlidersHorizontal} from 'lucide-react';
export const nav = [
 {id:'home',name:'家庭总览',shortName:'家庭',icon:House},
 {id:'rooms',name:'房间',shortName:'房间',icon:LayoutGrid},
 {id:'devices',name:'设备管理',shortName:'设备',icon:SlidersHorizontal},
 {id:'scenes',name:'生活场景',shortName:'场景',icon:Layers},
 {id:'vr',name:'空间漫游',shortName:'空间',icon:Box},
 {id:'automation',name:'自动化',shortName:'自动化',icon:Zap},
 {id:'billing',name:'能源与缴费',shortName:'缴费',icon:ReceiptText},
 {id:'profile',name:'家庭设置',shortName:'设置',icon:Settings},
] as const;
export function visibleNavigation(role:string){return nav.filter(item=>role!=='guest'||!['automation','billing'].includes(item.id));}

export function resolvePage(hash:string): import('../types').Page { const id=hash.replace(/^#/, '');return id==='account'?'account':nav.find(item=>item.id===id)?.id??'home'; }
