import { useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { LockKeyhole } from 'lucide-react';
import { ApiError, request } from '../api';
import type { Session } from '../types';

export default function Login({ setupRequired, onLogin, onSetupChange }: {
  setupRequired: boolean; onLogin: (session: Session) => void; onSetupChange: (required: boolean) => void;
}) {
  const [joining, setJoining] = useState(false);
  const [homeName, setHomeName] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username.trim())) {
      setError('用户名需为 3–32 位字母、数字、下划线或连字符，不能包含中文或空格');
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setError('密码长度需为 12–128 位');
      return;
    }
    setBusy(true); setError('');
    try {
      onLogin(await request<Session>(setupRequired ? '/auth/setup' : joining ? '/auth/join' : '/auth/login', 'POST', { username, password, displayName, homeName, code }));
    } catch (error) {
      if (setupRequired && error instanceof ApiError && error.status === 409) onSetupChange(false);
      setError(error instanceof Error ? error.message : '登录失败，请重试');
    } finally { setBusy(false); }
  }
  return <div className="auth-viewport"><section className="panel auth-panel">
    <div className="auth-brand"><LockKeyhole size={30} /><span>Home OS</span></div>
    <h1>{setupRequired ? '创建你的家庭' : joining ? '加入家庭' : '欢迎回家'}</h1>
    <p className="muted">{setupRequired ? '设置家庭名称和管理员账户，开始连接家人。' : joining ? '输入家庭管理员提供的一次性邀请码，设置你自己的账户。' : '使用你的家庭账户登录，设备控制权限随身份生效。'}</p>
    <form onSubmit={event => void submit(event)}>
      {setupRequired && <label className="form-field"><span>家庭名称</span><Input aria-label="家庭名称" value={homeName} onChange={setHomeName} maxLength={40} placeholder="例如：我们的家" required /></label>}
      {!setupRequired && joining && <label className="form-field"><span>家庭邀请码</span><Input aria-label="家庭邀请码" value={code} onChange={setCode} minLength={12} maxLength={12} pattern="[A-Fa-f0-9]{12}" autoComplete="off" required /></label>}
      {(setupRequired || joining) && <label className="form-field"><span>显示名称</span><Input aria-label="显示名称" autoComplete="nickname" value={displayName} onChange={setDisplayName} maxLength={40} required /></label>}
      <label className="form-field"><span>用户名</span><Input aria-label="用户名" autoComplete="username" value={username} onChange={setUsername} minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-]{3,32}" required /></label>
      {setupRequired && <p className="muted">用户名为 3–32 位字母、数字、下划线或连字符。</p>}
      <label className="form-field"><span>密码</span><Input.Password aria-label="密码" autoComplete={setupRequired || joining ? 'new-password' : 'current-password'} value={password} onChange={setPassword} minLength={12} maxLength={128} required /></label>
      {setupRequired && <p className="muted">密码长度为 12–128 位。</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <Button type="primary" htmlType="submit" long loading={busy}>{setupRequired ? '创建家庭并登录' : joining ? '加入并登录' : '登录'}</Button>
    </form>
    {!setupRequired && <Button type="text" long disabled={busy} onClick={() => { setJoining(!joining); setError(''); setPassword(''); }}>{joining ? '已有家庭账户？返回登录' : '收到邀请？加入家庭'}</Button>}
  </section></div>;
}
