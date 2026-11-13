import { House, LayoutGrid, Zap, ReceiptText, UserRound } from 'lucide-react';

export const nav = [
  { id: 'home', name: '首页', icon: House }, { id: 'scenes', name: '场景', icon: LayoutGrid },
  { id: 'automation', name: '自动化', icon: Zap }, { id: 'vr', name: 'VR实景', icon: House },
  { id: 'billing', name: '缴费', icon: ReceiptText }, { id: 'profile', name: '我的', icon: UserRound },
] as const;
