import { useEffect, useState } from 'react';
import { Button, Modal, Select } from '@arco-design/web-react';
import { UserPlus } from 'lucide-react';
import { ApiError, request } from '../api';
import type { User } from '../types';
import { formatTime } from '../utils';

export const roleNames = { admin: '家庭管理员', member: '家庭成员', guest: '限时访客' };
export default function Members({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [members, setMembers] = useState<User[]>([]);
  const [role, setRole] = useState<'member' | 'guest'>('member');
  const [guestHours, setGuestHours] = useState(24);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number }>();
  const [removing, setRemoving] = useState<User>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function failure(error: unknown) {
    if (error instanceof ApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : '操作失败');
  }
  async function load() {
    try { setMembers((await request<{ members: User[] }>('/auth/members')).members); }
    catch (error) { failure(error); }
  }
  useEffect(() => { void load(); }, []);
  async function createInvite() {
    setBusy(true); setError('');
    try { setInvite(await request('/auth/invitations', 'POST', { role, guestHours })); }
    catch (error) { failure(error); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true); setError('');
    try {
      await request('/auth/members/' + removing.id, 'DELETE', {});
      setRemoving(undefined);
      await load();
    } catch (error) { failure(error); }
    finally { setBusy(false); }
  }
  return <section className="panel household-members">
    <div className="section-heading"><h2><UserPlus />家庭成员与访客</h2><Button size="small" disabled={busy} onClick={() => void load()}>刷新成员</Button></div>
    <p className="muted">每位家人使用自己的账户。访客仅可控制设备和场景，到期自动失效。</p>
    <ul className="records">{members.map(member => <li key={member.id}>
      <span>{member.displayName}<small>@{member.username} · {roleNames[member.role]}{member.accessExpiresAt ? ' · 有效至 ' + formatTime(new Date(member.accessExpiresAt).toISOString()) : ''}</small></span>
      {member.role !== 'admin' && <Button status="danger" size="small" disabled={busy} onClick={() => setRemoving(member)}>移除</Button>}
    </li>)}</ul>
    <div className="button-row invite-controls">
      <Select aria-label="邀请身份" value={role} onChange={setRole} style={{ width: 140 }} options={[{ label: '家庭成员', value: 'member' }, { label: '限时访客', value: 'guest' }]} />
      {role === 'guest' && <Select aria-label="访客访问时长" value={guestHours} onChange={setGuestHours} style={{ width: 140 }} options={[{ label: '1 小时', value: 1 }, { label: '24 小时', value: 24 }, { label: '7 天', value: 168 }]} />}
      <Button type="primary" loading={busy} onClick={() => void createInvite()}>生成邀请码</Button>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <Modal visible={!!invite} title="邀请加入家庭" footer={null} onCancel={() => setInvite(undefined)}>
      {invite && <div className="invite-result"><p>将邀请码提供给要加入的家人，让对方在登录页选择“加入家庭”。</p><strong>{invite.code}</strong><p className="muted">{formatTime(new Date(invite.expiresAt).toISOString())} 前有效，仅可使用一次。</p></div>}
    </Modal>
    <Modal visible={!!removing} title="移除家庭访问权限" onCancel={() => setRemoving(undefined)} onOk={() => void remove()} confirmLoading={busy} okText="移除" cancelText="取消"><p>移除 {removing?.displayName} 后，其登录会话和家庭访问权限立即失效。</p></Modal>
  </section>;
}
