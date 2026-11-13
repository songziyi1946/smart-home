import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Wifi, Zap } from 'lucide-react';
import type { Page, State, User } from '../types';
import { nav } from './navigation';

type LayoutProps = { page: Page; role: User['role']; state?: State; busy: boolean; children: ReactNode };

export default function Layout({ page, role, state, busy, children }: LayoutProps) {
  const [dashboardScale, setDashboardScale] = useState(() => Math.min(window.innerWidth / 1672, window.innerHeight / 941));
  useEffect(() => {
    const resize = () => setDashboardScale(Math.min(window.innerWidth / 1672, window.innerHeight / 941));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return <div className="dashboard-viewport"><div className="shell" style={{ transform: `translate(-50%, -50%) scale(${dashboardScale})` }}>
    <aside className="sidebar">
      <a className="brand" href="#home"><span>M</span><div>米家中枢<small>SMART HOME</small></div></a>
      <nav aria-label="主导航">{nav.filter(item => role !== 'guest' || !['automation', 'billing'].includes(item.id)).map(({ id, name, icon: Icon }) =>
        <a key={id} href={'#' + id} className={page === id ? 'selected' : ''} aria-current={page === id ? 'page' : undefined}>
          <Icon size={19} />{name}
        </a>)}</nav><div className="sidebar-footer"><Wifi size={16} /><span>本地演示环境<small>所有操作即时保存</small></span></div>
    </aside>
    <div className="workspace">
      <header className="top"><div className="home-title"><h1>{nav.find(({ id }) => id === page)?.name}</h1></div>
        <div className="top-status"><span><i className="online-dot" />{state?.devices.length ?? '–'} 台设备在线</span><span><Zap size={17} />{state?.devices.filter(d => ('on' in d && d.on) || (d.kind === 'robot' && d.cleaning)).length ?? '–'} 台运行中</span><DashboardClock /></div>
      </header>
      <main aria-busy={busy}>
        {children}
      </main>
    </div>
  </div></div>;
}

function DashboardClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  return <div className="dashboard-clock"><strong>{now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}</strong><small>{now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' })}</small></div>;
}
