import Devices from './desktop/Devices';
import {emptyFilters} from './desktop/model';
import type {DeviceFilters} from './desktop/model';
import './desktop/style.css';
import './home/style.css';
import {useMobile} from './mobile/hooks';
import {MobileHome,RoomsPage} from './mobile/Views';
import DevicePanel from './deviceControls/Panel';
import './mobile/style.css';
import './mobile/today.css';
import {StatusPanel,PageSkeleton} from './ui/StatusPanel';
import type {ConnectionStatus} from './connection';
import Scenes from './scenes';
import { subscribeState } from './stateStream';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, request } from './api';
import type { State, Mutate, Page, Session, SceneRun } from './types';
import Layout from './layout';
import { resolvePage } from './layout/navigation';
import Home from './home';
import Automation from './automation';
import Billing from './billing';
import Profile from './profile';
import Login from './login';

const VR = lazy(() => import('./vr'));

function currentPage(): Page {
  return resolvePage(location.hash);
}

export default function App() {
  const mobile=useMobile();
  const [selectedDevice,setSelectedDevice]=useState<string>();
  const openDevice=(id:string)=>{history.pushState({devicePanel:id},'',location.href);setSelectedDevice(id);};
  const closeDevice=()=>{setSelectedDevice(undefined);if(history.state?.devicePanel)history.back();};
  useEffect(()=>{const back=()=>setSelectedDevice(typeof history.state?.devicePanel==='string'?history.state.devicePanel:undefined);window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
  const [deviceFilters,setDeviceFilters]=useState<DeviceFilters>({...emptyFilters});
  const openDirectory=(patch:Partial<DeviceFilters>={})=>{setDeviceFilters({...emptyFilters,...patch});location.hash='devices';};
  const [mobileRoom,setMobileRoom]=useState('all');
  const [offlineOnly,setOfflineOnly]=useState(false);
  const [page, setPage] = useState(currentPage);
  useEffect(()=>{window.scrollTo(0,0);setSelectedDevice(undefined);},[page]);
  const [room, setRoom] = useState('客厅');
  const [nightMode, setNightMode] = useState(() => {try{return window.localStorage.getItem('smart-home-theme') === 'dark';}catch{return false;}});
  const [state, setState] = useState<State>();
  const [session, setSession] = useState<Session>();
  const openRoom=(id:string)=>{setMobileRoom(id);setOfflineOnly(false);location.hash='rooms';};
  const [authChecked, setAuthChecked] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const locked = useRef(false);
  const [connection,setConnection]=useState<ConnectionStatus>('connecting');
  const [lastReceived,setLastReceived]=useState<number>();
  const [streamAttempt,setStreamAttempt]=useState(0);
  const connected=useRef(false);
  const reconnect=()=>{setConnection(navigator.onLine?'connecting':'offline');setStreamAttempt(value=>value+1);};
  function clearSession(setup = false) {
    generation.current++;
    connected.current=false;
    setConnection('connecting');
    setLastReceived(undefined);
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
    const version = generation.current;
    let stopped = false;
    let checkingSession = false;
    connected.current=false;
    setConnection(navigator.onLine?'connecting':'offline');
    const watchdog=setTimeout(()=>{if(!stopped&&!connected.current)setConnection(navigator.onLine?'error':'offline');},10000);
    const offline=()=>{connected.current=false;setConnection('offline');};
    const online=()=>setStreamAttempt(value=>value+1);
    window.addEventListener('offline',offline);window.addEventListener('online',online);
    const close = subscribeState(
      snapshot => { if (!stopped && version === generation.current) {connected.current=true;clearTimeout(watchdog);setConnection('live');setLastReceived(Date.now());setState(snapshot);} },
      () => { if (!stopped && version === generation.current) clearSession(); },
      () => {
        if(stopped)return;
        connected.current=false;
        setConnection(navigator.onLine?'reconnecting':'offline');
        // Revalidate only on a stream failure, never periodically. EventSource retries transport failures.
        if (checkingSession || stopped) return;
        checkingSession = true;
        void request<Session>('/auth/session').catch(error => {
          if (!stopped && version === generation.current && error instanceof ApiError && error.status === 401) clearSession(error.setupRequired);
        }).finally(() => { checkingSession = false; });
      },
    );
    return () => { stopped = true; clearTimeout(watchdog);window.removeEventListener('offline',offline);window.removeEventListener('online',online);close(); };
  }, [session,streamAttempt]);

  useEffect(() => {
    if (!session || session.localPreview) return;
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
    if(!connected.current){setNotice({text:'连接恢复后再试，当前显示上次同步的数据。',error:true});return false;}
    locked.current = true;
    const version = generation.current;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await request<{run?:SceneRun}>(path, method, body);
      if (version !== generation.current) return false;
      if(result.run?.status==='failed'){setNotice({text:'场景执行失败：'+result.run.reason,error:true});return false;}
      setNotice({ text: result.run ? '场景动作已下发，请查看设备反馈' : '操作已保存' });
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
  useEffect(() => {
    document.documentElement.dataset.theme = nightMode ? 'dark' : 'light';
    document.body.dataset.theme = nightMode ? 'dark' : 'light';
    document.body.setAttribute('arco-theme', nightMode ? 'dark' : 'light');
    try{window.localStorage.setItem('smart-home-theme', nightMode ? 'dark' : 'light');}catch{/* Theme remains available for this session. */}
  }, [nightMode]);

  if (!authChecked) return <div className="auth-viewport">
    <StatusPanel kind={notice?.error?'error':'loading'} title={notice?.error?'暂时无法连接家庭':'正在验证家庭会话'} description={notice?.text} onRetry={notice?.error?()=>void load():undefined} retryLabel="重新连接"/>
  </div>;
  if (!session) return <Login setupRequired={setupRequired} onLogin={onLogin} onSetupChange={setSetupRequired} />;

  const activePage = session.user.role === 'guest' && ['automation', 'billing'].includes(page) ? 'home' : page;
  const householdName = session.localPreview ? '我的家' : session.household.name.trim() || '我的家';
  const controlsBusy=busy||connection!=='live';
  const pages = state ? {
    home: mobile?<MobileHome state={state} live={connection==='live'} canViewAutomation={session.user.role!=='guest'} onRoom={openRoom} onOffline={()=>{setMobileRoom('all');setOfflineOnly(true);location.hash='rooms';}} busy={controlsBusy} mutate={mutate} onOpen={openDevice}/>:<Home state={state} live={connection==='live'} canViewAutomation={session.user.role!=='guest'} busy={controlsBusy} mutate={mutate} onOpen={openDevice} onRoom={openRoom} onOffline={()=>openDirectory({status:'offline'})} onDevices={()=>openDirectory()}/>,
    devices: <Devices state={state} busy={controlsBusy} mutate={mutate} onOpen={openDevice} filters={deviceFilters} onFilters={setDeviceFilters} role={session.user.role}/>,
    rooms: <RoomsPage state={state} roomId={mobileRoom} onRoom={setMobileRoom} offlineOnly={offlineOnly} onOfflineChange={setOfflineOnly} busy={controlsBusy} mutate={mutate} onOpen={openDevice}/>,
    account: <Profile onDevices={()=>openRoom('all')} key="account" initialSection="members" state={state} session={session} householdName={householdName} busy={controlsBusy} pending={busy} onLogout={()=>void logout()} onSessionExpired={()=>clearSession()}/>,
    scenes: <Scenes state={state} canManage={session.user.role==='admin'} busy={controlsBusy} pending={busy} mutate={mutate}/>,
    automation: <Automation state={state} busy={controlsBusy} pending={busy} mutate={mutate} canManage={session.user.role==='admin'}/>,
    vr: <Suspense fallback={<StatusPanel kind="loading" title="正在加载空间视图"/>}><VR state={state} busy={controlsBusy} mutate={mutate} selectedRoom={room} onRoomChange={setRoom} nightMode={nightMode} /></Suspense>,
    billing: <Billing state={state} busy={controlsBusy} pending={busy} mutate={mutate} />,
    profile: <Profile onDevices={()=>openRoom('all')} key="profile" state={state} session={session} householdName={householdName} busy={controlsBusy} pending={busy} onLogout={() => void logout()} onSessionExpired={() => clearSession()} />,
  } satisfies Record<Page, ReactNode> : undefined;

  return <Layout mobile={mobile} householdName={householdName} connection={connection} lastReceived={lastReceived} onReconnect={reconnect} page={activePage} role={session.user.role} state={state} busy={busy} nightMode={nightMode} onNightModeChange={setNightMode}>
    {notice && <div className={'notice' + (notice.error ? ' error' : '')} role={notice.error ? 'alert' : 'status'}>{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(undefined)}>×</button></div>}
    {pages ? pages[activePage] : connection==='connecting'?<PageSkeleton/>:<StatusPanel kind={connection==='offline'?'offline':'error'} title="暂未取得家庭状态" description="连接恢复后将自动同步。" onRetry={reconnect} retryLabel="重新连接"/>}
    <DevicePanel device={state?.devices.find(d=>d.id===selectedDevice)} visible={!!selectedDevice} mobile={mobile} busy={controlsBusy} mutate={mutate} onClose={closeDevice}/>
  </Layout>;
}
