import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@arco-design/web-react';
import { ApiError, request } from './api';
import type { State, Mutate, Page, Session } from './types';
import Layout from './layout';
import { nav } from './layout/navigation';
import Home from './home';
import Scenes from './scenes';
import Automation from './automation';
import Billing from './billing';
import Profile from './profile';
import Login from './login';

const VR = lazy(() => import('./vr'));

function currentPage(): Page {
  return nav.find(({ id }) => '#' + id === location.hash)?.id ?? 'home';
}

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [state, setState] = useState<State>();
  const [session, setSession] = useState<Session>();
  const [authChecked, setAuthChecked] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const locked = useRef(false);
  function clearSession(setup = false) {
    generation.current++;
    setSession(undefined);
    setState(undefined);
    setNotice(undefined);
    setSetupRequired(setup);
    setAuthChecked(true);
  }
  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(error.setupRequired);
      return;
    }
    setNotice({ text: error instanceof Error ? error.message : '请求失败', error: true });
  }
  async function load() {
    const version = generation.current;
    setNotice(undefined);
    try {
      const currentSession = await request<Session>('/auth/session');
      if (version !== generation.current) return;
      setSession(currentSession);
      setAuthChecked(true);
      const snapshot = await request('/state');
      if (version === generation.current) setState(snapshot);
    } catch (error) {
      if (version === generation.current) handleError(error);
    }
  }
  function onLogin(value: Session) {
    generation.current++;
    setState(undefined);
    setSession(value);
    setNotice(undefined);
    void load();
  }
  async function logout() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await request<{ ok: boolean }>('/auth/logout', 'POST', {});
      clearSession();
    } catch (error) { handleError(error); }
    finally { locked.current = false; setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => clearSession(), Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    const update = () => setPage(currentPage());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const mutate: Mutate = async (path, method, body) => {
    if (locked.current) return false;
    locked.current = true;
    const version = generation.current;
    setBusy(true);
    setNotice(undefined);
    try {
      const snapshot = await request(path, method, body);
      if (version !== generation.current) return false;
      setState(snapshot);
      setNotice({ text: '操作已保存' });
      return true;
    } catch (error) {
      if (version === generation.current) handleError(error);
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!notice || notice.error) return;
    const timeout = setTimeout(() => setNotice(undefined), 2600);
    return () => clearTimeout(timeout);
  }, [notice]);

  if (!authChecked) return <div className="auth-viewport"><section className="panel auth-panel">
    {notice?.error ? <><p role="alert">{notice.text}</p><Button onClick={() => void load()}>重新连接</Button></> : '正在验证登录状态…'}
  </section></div>;
  if (!session) return <Login setupRequired={setupRequired} onLogin={onLogin} onSetupChange={setSetupRequired} />;

  const activePage = session.user.role === 'guest' && ['automation', 'billing'].includes(page) ? 'home' : page;
  const pages = state ? {
    home: <Home state={state} busy={busy} mutate={mutate} />,
    scenes: <Scenes busy={busy} mutate={mutate} />,
    automation: <Automation state={state} busy={busy || session.user.role !== 'admin'} mutate={mutate} />,
    vr: <Suspense fallback={<div className="panel">正在加载三维场景…</div>}><VR /></Suspense>,
    billing: <Billing state={state} busy={busy} mutate={mutate} />,
    profile: <Profile state={state} session={session} busy={busy} onLogout={() => void logout()} onSessionExpired={() => clearSession()} />,
  } satisfies Record<Page, ReactNode> : undefined;

  return <Layout page={activePage} role={session.user.role} state={state} busy={busy}>
    {notice && <div className={'notice' + (notice.error ? ' error' : '')} role={notice.error ? 'alert' : 'status'}>{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(undefined)}>×</button></div>}
    {pages ? pages[activePage] : <div className="panel">{notice?.error ? <Button onClick={() => void load()}>重新连接</Button> : '正在连接本地服务…'}</div>}
  </Layout>;
}
