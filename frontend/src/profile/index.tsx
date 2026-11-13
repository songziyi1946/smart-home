import { Button } from '@arco-design/web-react';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import type { Session, State } from '../types';
import Members, { roleNames } from './Members';
import { formatTime } from '../utils';

export default function Profile({ state, session, busy, onLogout, onSessionExpired }: {
  state: State; session: Session; busy: boolean; onLogout: () => void; onSessionExpired: () => void;
}) {
  if (session.localPreview) return <div className="profile-page"><section className="panel profile-panel">
    <h2>本地预览</h2>
    <p>{state.devices.length} 台设备</p>
  </section></div>;
  const { user } = session;
  return <div className="profile-page"><div className="two-col">
    <section className="panel profile-panel">
      <div className="section-heading"><h2><UserRound />登录者信息</h2><span className="quality-badge">已登录</span></div>
      <div className="profile-identity"><span className="profile-avatar">{user.displayName.slice(0, 1)}</span><div><h3>{user.displayName}</h3><p className="muted">@{user.username}</p></div></div>
      <dl className="profile-details">
        <div><dt>账户角色</dt><dd><ShieldCheck size={16} />{roleNames[user.role]}</dd></div>
        {user.accessExpiresAt && <div><dt>家庭访问有效至</dt><dd>{formatTime(new Date(user.accessExpiresAt).toISOString())}</dd></div>}
        <div><dt>创建时间</dt><dd>{formatTime(user.createdAt)}</dd></div>
        <div><dt>本次登录</dt><dd>{formatTime(session.loggedInAt)}</dd></div>
        <div><dt>会话有效至</dt><dd>{formatTime(new Date(session.expiresAt).toISOString())}</dd></div>
      </dl>
      <Button disabled={busy} onClick={onLogout} icon={<LogOut size={16} />}>退出登录</Button>
    </section>
    <section className="panel profile-panel"><h2>我的家庭</h2><h3>{session.household.name}</h3><p>{state.devices.length} 台设备</p></section>
  </div>{user.role === 'admin' && <Members onSessionExpired={onSessionExpired} />}</div>;
}
