import { useEffect, useRef, useState } from 'react';
import { Button, Input, Popconfirm } from '@arco-design/web-react';
import { Plug, RefreshCw } from 'lucide-react';
import { ApiError, request } from '../api';
import type { Session } from '../types';
import type { MijiaChallenge, MijiaRegion, MijiaStatus } from '../../../packages/contracts/mijia';
import { captchaImageSource, mijiaStateLabels, modelRoomOptions, roomBindingPayload } from './model';

const endpoint = '/integrations/mijia';
const regions: Record<MijiaRegion, string> = { cn: '中国大陆', de: '欧洲', us: '美国', ru: '俄罗斯', sg: '新加坡', tw: '中国台湾', i2: '印度' };

export function MijiaStatusSummary({ status }: { status: MijiaStatus }) {
  return <div className="mijia-status" role="status">
    <strong>{mijiaStateLabels[status.state]}</strong>
    {status.selectedHomeId && <p>{status.homes.find(home => home.id === status.selectedHomeId)?.name || '已选择家庭'} · {status.deviceCount} 台已接入设备</p>}
    {status.lastSyncAt && <small>上次同步：{new Date(status.lastSyncAt).toLocaleString('zh-CN')}</small>}
    {status.unsupportedCount > 0 && <p>{status.unsupportedCount} 台设备暂不支持当前能力，未显示为可控设备。</p>}
    {status.state === 'connected' && <small>约每 {status.pollIntervalSeconds} 秒读取设备反馈；操作后的状态以设备回报为准。</small>}
    {status.error && <p className="settings-error">{status.error}</p>}
  </div>;
}

export default function MijiaConnection({ session, disabled, onSessionExpired }: {
  session: Session; disabled: boolean; onSessionExpired: () => void;
}) {
  if (session.localPreview) return <section className="panel"><h2>米家账号与设备</h2><p>请使用家庭管理员账号登录后绑定米家。</p></section>;
  if (session.user.role !== 'admin') return <section className="panel"><h2>米家账号与设备</h2><p>仅家庭管理员可以配置米家接入。已接入的设备可在设备页面使用。</p></section>;
  return <MijiaSetup key={`${session.household.id}:${session.user.id}:${session.loggedInAt}`} disabled={disabled} onSessionExpired={onSessionExpired} />;
}

function MijiaSetup({ disabled, onSessionExpired }: { disabled: boolean; onSessionExpired: () => void }) {
  const [status, setStatus] = useState<MijiaStatus>();
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [region, setRegion] = useState<MijiaRegion>('cn');
  const [loginOpen, setLoginOpen] = useState(false), [homeId, setHomeId] = useState('');
  const [captcha, setCaptcha] = useState(''), [code, setCode] = useState('');
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [clock, setClock] = useState(Date.now);
  const mounted = useRef(false), generation = useRef(0), locked = useRef(false);
  const challenge = status?.challenge;
  const expired = !!challenge && (!Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= clock);
  const blocked = disabled || pending;
  const sentToCurrentMethod = !!challenge?.sent && challenge.sentMethod === method;

  function applyStatus(next: MijiaStatus) {
    setStatus(next); setClock(Date.now());
    setHomeId(next.selectedHomeId ?? '');
    setBindings(Object.fromEntries(next.rooms.map(room => [room.id, room.mappedRoomId ?? ''])));
    setRegion(next.region);
    if (next.state === 'choose_home' || next.state === 'connected') setLoginOpen(false);
    if (next.state === 'unbound' || next.state === 'reauth_required') setLoginOpen(true);
    const firstMethod = next.challenge?.methods?.[0]?.id;
    if (firstMethod) setMethod(current => next.challenge?.sentMethod ?? (next.challenge?.methods?.some(option => option.id === current) ? current : firstMethod));
  }

  async function run(path = '', verb = 'GET', body?: unknown) {
    if (locked.current || (verb !== 'GET' && disabled)) return;
    locked.current = true;
    const version = ++generation.current;
    const current = () => mounted.current && generation.current === version;
    setPending(true); setError(''); setNotice('');
    try {
      const next = await request<MijiaStatus>(endpoint + path, verb, body);
      if (current()) {
        applyStatus(next);
        if (path === '/rooms') setNotice('房间关联已保存。');
        else if (path === '/home' || path === '/refresh') setNotice(next.state === 'connected' ? '已读取设备反馈。' : '连接状态已更新。');
      }
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status === 401) { onSessionExpired(); return; }
      setError(error instanceof Error ? error.message : '米家接入暂时不可用，请重试');
      // A rejected code may rotate its image challenge in the server-side session.
      if (path === '/challenge') {
        try { const latest = await request<MijiaStatus>(endpoint); if (current()) applyStatus(latest); }
        catch (refreshError) { if (current() && refreshError instanceof ApiError && refreshError.status === 401) onSessionExpired(); }
      }
    } finally {
      if (current()) { locked.current = false; setPending(false); }
    }
  }

  useEffect(() => {
    mounted.current = true;
    void run();
    return () => { mounted.current = false; generation.current++; locked.current = false; };
  }, []);
  useEffect(() => {
    if (!challenge) return;
    setCaptcha(''); setCode('');
    const remaining = Date.parse(challenge.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { setClock(Date.now()); return; }
    const timeout = setTimeout(() => setClock(Date.now()), Math.min(remaining + 20, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [challenge?.id, challenge?.expiresAt, challenge?.image, challenge?.captchaImage]);

  function login(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || locked.current || !username.trim() || !password) return;
    const credentials = { username: username.trim(), password, region };
    setPassword(''); setCaptcha(''); setCode('');
    void run('/login', 'POST', credentials);
  }
  function submitChallenge(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge || expired || blocked) return;
    if (challenge.type === 'captcha' && captcha.trim()) {
      const answer = captcha.trim(); setCaptcha('');
      void run('/challenge', 'POST', { id: challenge.id, action: 'captcha', captcha: answer });
    } else if (challenge.type === 'verification' && sentToCurrentMethod && code.trim()) {
      const answer = code.trim(); setCode('');
      void run('/challenge', 'POST', { id: challenge.id, action: 'verify', code: answer });
    }
  }
  function sendCode() {
    if (!challenge || expired || blocked) return;
    const answer = captcha.trim(); setCaptcha('');
    void run('/challenge', 'POST', { id: challenge.id, action: 'send', method, ...(answer ? { captcha: answer } : {}) });
  }
  const showLogin = !challenge && loginOpen;
  const authenticated = status && ['choose_home', 'connected', 'offline'].includes(status.state);

  return <section className="panel mijia-connection" aria-busy={pending}>
    <header><h2><Plug size={19} />米家账号与设备</h2><Button size="small" icon={<RefreshCw size={15} />} disabled={blocked} onClick={() => void run()}>检查连接</Button></header>
    {!status && !error && <p role="status">正在检查米家连接…</p>}
    {status && <MijiaStatusSummary status={status} />}
    {error && <p className="settings-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {showLogin && <form className="mijia-form" onSubmit={login}>
      <p>使用小米账号登录，可按提示完成图片验证码和短信或邮箱验证，无需米家 App。</p>
      <fieldset disabled={blocked}>
        <label>账号所在地区<select aria-label="米家账号地区" value={region} onChange={event => setRegion(event.target.value as MijiaRegion)}>{Object.entries(regions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>小米账号<Input aria-label="小米账号" name="mijia-username" value={username} onChange={setUsername} autoComplete="off" maxLength={128} required placeholder="手机号、邮箱或小米账号 ID" /></label>
        <label>小米账号密码<Input.Password aria-label="小米账号密码" name="mijia-password" value={password} onChange={setPassword} autoComplete="off" maxLength={128} required /></label>
        <p className="settings-muted">密码仅用于本次登录，不保存到工作台。</p>
        <Button type="primary" htmlType="submit" loading={pending} disabled={!username.trim() || !password}>登录小米账号</Button>
      </fieldset>
      {status && !['unbound', 'reauth_required'].includes(status.state) && <Button type="text" disabled={blocked} onClick={() => { setPassword(''); setLoginOpen(false); }}>取消重新登录</Button>}
    </form>}
    {challenge && <div className="mijia-challenge">
      {expired ? <p role="status">本次验证已过期，请重新登录。</p> : <form className="mijia-form" onSubmit={submitChallenge}>
        <fieldset disabled={blocked}>
          {challenge.type === 'captcha' ? <>
            <h3>输入图片验证码</h3>
            <Captcha image={challenge.image} />
            <label>图片验证码<Input aria-label="米家图片验证码" value={captcha} onChange={setCaptcha} autoComplete="off" maxLength={20} required /></label>
            <Button type="primary" htmlType="submit" loading={pending} disabled={!captcha.trim()}>继续登录</Button>
          </> : <>
            <h3>验证账号身份</h3>
            {challenge.methods?.length ? <>
              <label>验证方式<select aria-label="米家验证方式" value={method} onChange={event => { setMethod(event.target.value as 'phone' | 'email'); setCode(''); }}>{challenge.methods.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              {challenge.captchaImage && <><Captcha image={challenge.captchaImage} /><label>图片验证码<Input aria-label="米家发码图片验证码" value={captcha} onChange={setCaptcha} autoComplete="off" maxLength={20} /></label></>}
              <Button htmlType="button" disabled={!!challenge.captchaImage && !captcha.trim()} onClick={sendCode}>{challenge.sent ? '重新发送验证码' : '发送验证码'}</Button>
              {sentToCurrentMethod && <p role="status">验证码已发送，请查看所选手机或邮箱。</p>}
              <label>短信或邮箱验证码<Input aria-label="米家账号验证码" value={code} onChange={setCode} autoComplete="one-time-code" maxLength={20} required /></label>
              <Button type="primary" htmlType="submit" loading={pending} disabled={!code.trim() || !sentToCurrentMethod}>完成验证</Button>
            </> : <p role="status">此账号暂未提供可用的手机或邮箱验证方式，请取消后重试。</p>}
          </>}
        </fieldset>
      </form>}
      <Button type="text" disabled={blocked} onClick={() => { setCaptcha(''); setCode(''); setPassword(''); void run('/login', 'DELETE', {}); }}>{expired ? '重新登录' : '取消本次登录'}</Button>
    </div>}
    {authenticated && <>
      {status.homes.length ? <form className="mijia-form" onSubmit={event => { event.preventDefault(); if (homeId && !blocked) void run('/home', 'POST', { homeId }); }}>
        <label>选择要接入的米家家庭<select aria-label="要接入的米家家庭" value={homeId} disabled={blocked} required onChange={event => setHomeId(event.target.value)}><option value="">请选择家庭</option>{status.homes.map(home => <option key={home.id} value={home.id}>{home.name}</option>)}</select></label>
        <Button htmlType="submit" type={status.selectedHomeId ? 'secondary' : 'primary'} disabled={blocked || !homeId || homeId === status.selectedHomeId}>{status.selectedHomeId ? '切换家庭' : '导入家庭设备'}</Button>
      </form> : <p role="status">此账号下暂未发现可接入的家庭，请确认账号和地区是否正确。</p>}
      {status.selectedHomeId && <div className="mijia-room-mapping">
        <h3>关联三维房间</h3><p>选择米家房间在立体户型中的位置，保存后即可跟随设备状态显示。</p>
        {status.rooms.length ? <form className="mijia-form" onSubmit={event => { event.preventDefault(); if (!blocked) void run('/rooms', 'PUT', { bindings: roomBindingPayload(status.rooms, bindings) }); }}>
          <fieldset disabled={blocked}>{status.rooms.map(room => <label key={room.id}><span>{room.name}{room.deviceCount !== undefined ? ` · ${room.deviceCount} 台设备` : ''}</span><select aria-label={`${room.name}对应的三维房间`} value={bindings[room.id] ?? ''} onChange={event => setBindings(current => ({ ...current, [room.id]: event.target.value }))}>
            <option value="">暂不关联</option>{bindings[room.id] && !modelRoomOptions.some(option => option.id === bindings[room.id]) && <option value={bindings[room.id]}>当前关联：{room.mappedRoomName || '其他房间'}</option>}{modelRoomOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select></label>)}<Button htmlType="submit" disabled={blocked}>保存房间关联</Button></fieldset>
        </form> : <p>尚未发现房间信息。设备仍可在设备页面查看。</p>}
        <p className="settings-muted">连接后，可在场景中选择实际设备；已有示例场景不会自动改用新设备。</p>
      </div>}
    </>}
    {status && status.state !== 'unbound' && <div className="mijia-actions">
      {status.selectedHomeId && <Button disabled={blocked} onClick={() => void run('/refresh', 'POST', {})}>同步设备状态</Button>}
      {!challenge && !showLogin && <Button disabled={blocked} onClick={() => { setError(''); setPassword(''); setLoginOpen(true); }}>重新登录</Button>}
      <Popconfirm title="解除米家绑定并移除本工作台中的米家设备？" onOk={() => run('', 'DELETE', {})} disabled={blocked}><Button status="danger" disabled={blocked}>解除绑定</Button></Popconfirm>
    </div>}
  </section>;
}

function Captcha({ image }: { image?: MijiaChallenge['image'] }) {
  const source = captchaImageSource(image);
  return source ? <img className="mijia-captcha" src={source} alt="小米账号图片验证码" /> : <p role="status">验证码图片暂不可用，请取消后重新登录。</p>;
}
