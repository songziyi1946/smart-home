import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Modal, Popconfirm } from '@arco-design/web-react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { ApiError, request } from '../api';
import type { Session } from '../types';
import { aiConnectionOwnerKey, validateAIConnectionInput, type AIConnection, type AIConnectionInput, type AIConnectionFieldErrors } from './ai-connections-model';
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
  const [fieldErrors, setFieldErrors] = useState<AIConnectionFieldErrors>({});
  const [saveError, setSaveError] = useState('');
  const [adding, setAdding] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), generation = useRef(0), locked = useRef(false);
  const formId = useId();
  const blocked = disabled || pending;
  function reportError(reason: unknown, saving = false) {
    if (reason instanceof ApiError && reason.status === 401) {
      setConnections(undefined); setForm(emptyForm()); setFieldErrors({}); setSaveError(''); setAdding(false); setError(''); setNotice(''); onSessionExpired(); return;
    }
    (saving ? setSaveError : setError)(reason instanceof Error ? reason.message : 'AI 服务暂不可用，请稍后重试');
  }
  async function run(action: 'load' | 'save' | 'test' | 'delete', connection?: AIConnection) {
    if (locked.current || (action !== 'load' && disabled)) return;
    if (action === 'save') {
      const invalid = validateAIConnectionInput(form);
      setFieldErrors(invalid); setSaveError(''); setError('');
      const first = Object.keys(invalid)[0];
      if (first) {
        const input = formRef.current?.elements.namedItem(first) as HTMLInputElement | null;
        input?.focus(); input?.scrollIntoView({ block: 'center', behavior: 'auto' });
        return;
      }
    }
    if ((action === 'test' || action === 'delete') && !connection) return;
    locked.current = true;
    const epoch = ++generation.current, current = () => mounted.current && generation.current === epoch;
    setPending(true); setError(''); setSaveError(''); setNotice('');
    try {
      if (action === 'load') {
        const result = await request<ConnectionsResponse>(endpoint);
        if (current()) { setConnections(result.connections); setConfigured(result.configured); }
      } else if (action === 'save') {
        const input = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as AIConnectionInput;
        const result = await request<AIConnection>(endpoint, 'POST', input);
        if (current()) {
          setConnections(items => [...(items ?? []), result]); setForm(emptyForm()); setFieldErrors({}); setAdding(false); setNotice('连接验证成功，AI 服务已添加。');
        }
      } else {
        const path = `${endpoint}/${encodeURIComponent(connection!.id)}`;
        await request<{ ok: true }>(action === 'test' ? path + '/test' : path, action === 'test' ? 'POST' : 'DELETE', {});
        if (current()) {
          if (action === 'delete') setConnections(items => items?.filter(item => item.id !== connection!.id));
          setNotice(action === 'test' ? `${connection!.name}：连接成功` : '已删除此 AI 服务');
        }
      }
    } catch (reason) { if (current()) reportError(reason, action === 'save'); }
    finally { if (current()) { locked.current = false; setPending(false); } }
  }
  useEffect(() => {
    mounted.current = true; void run('load');
    return () => { mounted.current = false; generation.current++; locked.current = false; };
  }, []);
  function update(key: keyof AIConnectionInput, value: string) {
    setForm(current => ({ ...current, [key]: value })); setSaveError('');
    if (fieldErrors[key]) setFieldErrors(current => ({ ...current, [key]: validateAIConnectionInput({ ...form, [key]: value })[key] }));
  }
  const fields = [
    { key: 'name', label: '服务名称', maxLength: 80, placeholder: '例如：我的 OpenAI' },
    { key: 'baseUrl', label: '接口地址', maxLength: 2048 },
    { key: 'model', label: '模型名称', maxLength: 160 },
    { key: 'apiKey', label: 'API 密钥', maxLength: 8192, placeholder: '输入 API 密钥' },
  ] as const;
  return <div className="ai-connections">
    <section className="panel">
      <header><h2><Sparkles size={19} />我的 AI</h2><div className="settings-actions"><Button icon={<RefreshCw size={15} />} disabled={blocked} onClick={() => void run('load')}>刷新</Button><Button type="primary" disabled={blocked || !connections || !configured} onClick={() => { setForm(emptyForm()); setFieldErrors({}); setSaveError(''); setAdding(true); }}>添加 AI 服务</Button></div></header>
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
    <Modal title="添加 AI 服务" visible={adding} onCancel={() => { if (!pending) { setAdding(false); setForm(emptyForm()); setFieldErrors({}); setSaveError(''); } }} footer={null}
      closable={!pending} maskClosable={!pending} escToExit={!pending} unmountOnExit style={{ width: 'min(480px, calc(100vw - 24px))' }} className="ai-connection-modal">
      {!configured ? <p role="status">AI 服务配置暂不可用，请联系管理员。</p> : <form ref={formRef} className="ai-connection-form" noValidate onSubmit={event => { event.preventDefault(); void run('save'); }}>
        <fieldset disabled={blocked || !connections}>
          {fields.map(field => <div key={field.key} className="ai-connection-field">
            <label htmlFor={formId + '-' + field.key}>{field.label}<span className="ai-field-required" aria-hidden="true"> *</span></label>
            <Input id={formId + '-' + field.key} name={field.key} value={form[field.key]} maxLength={field.maxLength}
              placeholder={'placeholder' in field ? field.placeholder : undefined} type={field.key === 'apiKey' ? 'password' : 'text'}
              onChange={value => update(field.key, value)} disabled={blocked || !connections} autoComplete="off" spellCheck={false}
              status={fieldErrors[field.key] ? 'error' : undefined} aria-required="true" aria-invalid={!!fieldErrors[field.key]}
              aria-describedby={fieldErrors[field.key] ? formId + '-' + field.key + '-error' : undefined} />
            {fieldErrors[field.key] && <p id={formId + '-' + field.key + '-error'} className="ai-field-error" role="alert">{fieldErrors[field.key]}</p>}
            {field.key === 'baseUrl' && <p className="settings-muted">接口协议：OpenAI Responses</p>}
          </div>)}
          {saveError && <p className="settings-error" role="alert">{saveError}</p>}
          <p className="settings-muted">验证接口连接及模型访问权限，通过后自动添加。</p>
          <div className="ai-form-actions"><Button disabled={pending} onClick={() => { setAdding(false); setForm(emptyForm()); setFieldErrors({}); setSaveError(''); }}>取消</Button><Button htmlType="submit" type="primary" loading={pending} disabled={blocked || !connections}>{pending ? '正在验证连接…' : '验证并添加'}</Button></div>
        </fieldset>
      </form>}
    </Modal>
  </div>;
}
