import { onlineSummary } from '../homeTelemetry';
import { isRunning } from '../devices';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Moon, PanelLeftClose, PanelLeftOpen, Sun, Zap } from 'lucide-react';
import type { Page, State, User } from '../types';
import TodayAlmanac from '../calendar';
import { nav } from './navigation';

type LayoutProps = { page: Page; role: User['role']; state?: State; busy: boolean; nightMode: boolean; onNightModeChange: (value: boolean) => void; children: ReactNode };

export default function Layout({ page, role, state, busy, nightMode, onNightModeChange, children }: LayoutProps) {
  const [expanded, setExpanded] = useState(false);
  const compact = !expanded;
  const online = state ? onlineSummary(state.devices) : undefined;

  return <div className="dashboard-viewport"><div className={'shell' + (compact ? ' shell-compact' : '')}>
    <aside className="sidebar">
      <a className="brand" href="#home" aria-label="米家中枢首页"><span>M</span><div>米家中枢</div></a>
      <nav aria-label="主导航">{nav.filter(item => role !== 'guest' || !['automation', 'billing'].includes(item.id)).map(({ id, name, icon: Icon }) =>
        <a key={id} href={'#' + id} className={page === id ? 'selected' : ''} aria-current={page === id ? 'page' : undefined}>
          <Icon size={19} /><span>{name}</span>
        </a>)}</nav>
      <button className="sidebar-toggle" type="button" title={compact ? '展开菜单' : '收起菜单'} aria-label={compact ? '展开导航' : '收起导航'} aria-expanded={!compact} onClick={() => setExpanded(!expanded)}>
        {compact ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>
    </aside>
    <div className="workspace">
      <header className="top"><div className="home-title"><h1>{nav.find(({ id }) => id === page)?.name}</h1></div>
        <div className="top-status"><span title={online?.simulated ? `含 ${online.simulated} 台模拟设备；按设备记录统计` : '按设备记录统计'}><i className={online?.online ? "online-dot" : "online-dot offline-dot"} />{online ? `${online.online}/${online.total} 在线 · ${online.offline} 离线${online.simulated ? ' · 含模拟' : ''}` : '暂无数据'}</span><span><Zap size={17} />{state?.devices.filter(d => isRunning(d)).length ?? '–'} 台运行中</span><button className="theme-toggle" type="button" aria-pressed={nightMode} aria-label={nightMode ? '切换到日间模式' : '切换到夜间模式'} onClick={() => onNightModeChange(!nightMode)}>{nightMode ? <Sun size={16} /> : <Moon size={16} />}{nightMode ? '日间' : '夜间'}</button><DashboardClock /></div>
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
  return <div className="dashboard-clock">
    <button type="button" className="dashboard-clock-trigger" aria-haspopup="dialog" aria-controls="today-almanac">
      <strong>{now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}</strong>
      <small>{now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' })}</small>
    </button>
    <TodayAlmanac now={now} />
  </div>;
}
