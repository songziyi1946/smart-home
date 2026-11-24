import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Popconfirm } from '@arco-design/web-react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { ApiError, request } from '../api';
import type { Session } from '../types';
import { aiConnectionOwnerKey, validateAIConnectionInput, type AIConnection, type AIConnectionInput } from './ai-connections-model';
import './ai-connections.css';

const endpoint = '/ai/connections';
type ConnectionsResponse = { connections: AIConnection[]; configured: boolean };
const emptyForm = (): AIConnectionInput => ({ name: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-terra', apiKey: '' });

export default function AIConnections({ session, disabled, onSessionExpired }: { session: Session; disabled: boolean; onSessionExpired: () => void }) {
  if (session.user.role === 'guest') return null;
  const ownerKey = aiConnectionOwnerKey(session);
  if (!ownerKey) return <section className="panel ai-connections"><h2>我的 AI</h2><p>真实登录后可配置个人 AI 服务。</p></section>;
  return <PersonalAIConnections key={ownerKey} disabled={disabled} onSessionExpired={onSessionExpired} />;
}

function PersonalAIConnections({ disabled, onSessionExpired }: { disabled: boolean; onSessionExpired: () => void }) {
  const [connections, setConnections] = useState<AIConnection[]>();
  const [configured, setConfigured] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), generation = useRef(0), locked = useRef(false);
  const formId = useId();
  const blocked = disabled || pending;
  function reportError(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) {
      setConnections(undefined); setForm(emptyForm()); setError(''); setNotice(''); onSessionExpired(); return;
    }
    setError(reason instanceof Error ? reason.message : 'AI 服务暂不可用，请稍后重试');
  }
  async function run(action: 'load' | 'save' | 'test' | 'delete', connection?: AIConnection) {
    if (locked.current || (action !== 'load' && disabled)) return;
    if (action === 'save') {
      const invalid = validateAIConnectionInput(form); if (invalid) { setError(invalid); return; }
    }
    if ((action === 'test' || action === 'delete') && !connection) return;
    locked.current = true;
    const epoch = ++generation.current, current = () => mounted.current && generation.current === epoch;
    setPending(true); setError(''); setNotice('');
    try {
      if (action === 'load') {
        const result = await request<ConnectionsResponse>(endpoint);
        if (current()) { setConnections(result.connections); setConfigured(result.configured); }
      } else if (action === 'save') {
        const input = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as AIConnectionInput;
        const result = await request<AIConnection>(endpoint, 'POST', input);
        if (current()) {
          setConnections(items => [...(items ?? []), result]); setForm(emptyForm()); setNotice('AI 服务已保存，仅当前账号可用。');
        }
      } else {
        const path = `${endpoint}/${encodeURIComponent(connection!.id)}`;
        await request<{ ok: true }>(action === 'test' ? path + '/test' : path, action === 'test' ? 'POST' : 'DELETE', {});
        if (current()) {
          if (action === 'delete') setConnections(items => items?.filter(item => item.id !== connection!.id));
          setNotice(action === 'test' ? `${connection!.name}：连接成功` : '已删除此 AI 服务');
        }
      }
    } catch (reason) { if (current()) reportError(reason); }
    finally { if (current()) { locked.current = false; setPending(false); } }
  }
  useEffect(() => {
    mounted.current = true; void run('load');
    return () => { mounted.current = false; generation.current++; locked.current = false; };
  }, []);
  function update(key: keyof AIConnectionInput, value: string) { setForm(current => ({ ...current, [key]: value })); }
  return <div className="ai-connections">
    <section className="panel">
      <header><h2><Sparkles size={19} />我的 AI</h2><Button icon={<RefreshCw size={15} />} disabled={blocked} onClick={() => void run('load')}>刷新</Button></header>
      <p className="settings-muted">仅当前账号可用</p>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {notice && <p className="ai-notice" role="status">{notice}</p>}
      {!connections ? <p role="status">{pending ? '正在读取 AI 服务…' : '尚未读取 AI 服务，请重试。'}</p> : !connections.length ? <p className="settings-muted">尚未配置 AI 服务</p> : <div className="ai-connection-list">
        {connections.map(connection => <article key={connection.id}>
          <div className="ai-connection-heading"><h3>{connection.name}</h3><span className="settings-badge">密钥已保存</span></div>
          <dl><div><dt>模型</dt><dd>{connection.model}</dd></div><div><dt>接口地址</dt><dd>{connection.baseUrl}</dd></div></dl>
          <div className="settings-actions"><Button disabled={blocked || !configured} onClick={() => void run('test', connection)}>测试连接</Button><Popconfirm title={`删除“${connection.name}”？`} content="删除后，此账号将不能再使用该连接。" okText="删除" cancelText="取消" onOk={() => run('delete', connection)} disabled={blocked}><Button status="danger" disabled={blocked}>删除</Button></Popconfirm></div>
        </article>)}
      </div>}
    </section>
    <section className="panel">
      <header><h2>添加 AI 服务</h2></header>
      {!configured ? <p role="status">AI 服务配置暂不可用，请联系管理员。</p> : <form className="ai-connection-form" onSubmit={event => { event.preventDefault(); void run('save'); }}>
        <fieldset disabled={blocked || !connections}>
          <label htmlFor={formId + '-name'}>服务名称<Input id={formId + '-name'} value={form.name} maxLength={80} placeholder="例如：我的 OpenAI" onChange={value => update('name', value)} disabled={blocked || !connections} /></label>
          <label htmlFor={formId + '-url'}>接口地址<Input id={formId + '-url'} value={form.baseUrl} maxLength={2048} onChange={value => update('baseUrl', value)} disabled={blocked || !connections} autoComplete="off" /></label>
          <p className="settings-muted">接口协议：OpenAI Responses</p>
          <label htmlFor={formId + '-model'}>模型名称<Input id={formId + '-model'} value={form.model} maxLength={160} onChange={value => update('model', value)} disabled={blocked || !connections} autoComplete="off" /></label>
          <label htmlFor={formId + '-key'}>API 密钥<Input id={formId + '-key'} type="password" value={form.apiKey} maxLength={8192} placeholder="输入 API 密钥" onChange={value => update('apiKey', value)} disabled={blocked || !connections} autoComplete="off" spellCheck={false} /></label>
          <Button htmlType="submit" type="primary" loading={pending} disabled={blocked || !connections}>保存 AI 服务</Button>
        </fieldset>
      </form>}
    </section>
  </div>;
}
