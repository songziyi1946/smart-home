import { useEffect, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { ApiError, request } from '../api';
import type { Session } from '../types';

export default function HouseholdName({ session, name, disabled, onSaved, onSessionExpired }: {
  session: Session; name: string; disabled: boolean;
  onSaved: (session: Session) => void; onSessionExpired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(name); }, [name]);
  if (!editing) return <span className="settings-home-name">{name}{session.user.role === 'admin' && !session.localPreview &&
    <Button type="text" size="small" disabled={disabled} onClick={() => { setError(''); setEditing(true); }}>修改</Button>}</span>;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || saving || !draft.trim()) return;
    setSaving(true); setError('');
    try {
      const updated = await request<Session>('/auth/household', 'PATCH', { name: draft.trim() });
      onSaved(updated); setEditing(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else setError(error instanceof Error ? error.message : '家庭名称保存失败，请重试');
    } finally { setSaving(false); }
  }
  return <form className="settings-name-editor" onSubmit={event => void save(event)}>
    <Input aria-label="新的家庭名称" value={draft} onChange={setDraft} maxLength={40} disabled={disabled || saving} required />
    <div className="settings-actions"><Button type="primary" size="small" htmlType="submit" loading={saving} disabled={disabled || !draft.trim()}>保存</Button>
      <Button size="small" disabled={saving} onClick={() => { setDraft(name); setEditing(false); }}>取消</Button></div>
    {error && <p className="settings-error" role="alert">{error}</p>}
  </form>;
}
