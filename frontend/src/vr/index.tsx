import { useEffect, useRef, useState } from 'react';
import { Button, Switch } from '@arco-design/web-react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Expand, Footprints, House, RotateCcw, Upload } from 'lucide-react';
import { createViewer, type Viewer, type ViewerStatus } from './viewer';
import { viewpoints } from './plan';
import './style.css';

export default function VR() {
  const host = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewer = useRef<Viewer>();
  const [status, setStatus] = useState<ViewerStatus>({ mode: 'walk', position: [8.65, 5.65], heading: 0 });
  const [error, setError] = useState('');
  const [night, setNight] = useState(false);
  const [lights, setLights] = useState(true);
  const [roof, setRoof] = useState(true);
  const [modelName, setModelName] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { viewer.current = createViewer(host.current!, setStatus); setReady(true); }
    catch { setError('无法启动三维渲染，请启用浏览器硬件加速，并使用支持 WebGL2 的浏览器重试。'); }
    return () => { viewer.current?.dispose(); viewer.current = undefined; };
  }, []);
  async function importModel(file?: File) {
    if (!file || !viewer.current) return;
    setLoading(true); setError('');
    try { await viewer.current.importModel(file); setModelName(file.name); }
    catch (error) { setError(error instanceof Error ? error.message : '模型导入失败，请检查是否为未压缩、贴图内嵌的 GLB。'); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await page.current?.requestFullscreen(); }
    catch { setError('当前浏览器不支持全屏，请使用浏览器窗口查看。'); }
  }
  function hold(event: React.PointerEvent<HTMLButtonElement>, key: string) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); viewer.current?.hold(key, true);
  }
  return <section ref={page} className="vr-page" aria-label="三维实景漫游">
    <div className="vr-toolbar">
      <div><h2><House />家庭三维漫游</h2><p>{modelName ? '本地模型 · 当前会话查看' : '按户型图与效果图重建 · 层高暂按 2.7 m'}</p></div>
      <div className="button-row">
        <Button disabled={!ready} type={status.mode === 'walk' ? 'primary' : 'secondary'} icon={<Footprints size={16} />} onClick={() => viewer.current?.setMode('walk')}>室内行走</Button>
        <Button disabled={!ready} type={status.mode === 'orbit' ? 'primary' : 'secondary'} icon={<Box size={16} />} onClick={() => viewer.current?.setMode('orbit')}>户型总览</Button>
        <Button disabled={!ready} aria-label="全屏查看" icon={<Expand size={17} />} onClick={() => void fullscreen()} />
      </div>
    </div>
    <div className="vr-workspace">
      <div className="vr-stage">
        <div ref={host} className="vr-canvas" />
        <div className="vr-view-label"><span className="online-dot" />{status.mode === 'walk' ? '第一人称漫游' : '三维户型总览'}<small>{modelName || '参考重建模型'}</small></div>
        {!ready && !error && <div className="vr-message" role="status">正在构建三维场景…</div>}
        {error && <div className="vr-message vr-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
        {status.mode === 'walk' && ready && <div className="vr-movement" aria-label="漫游方向控制">
          {([{ key: 'KeyW', label: '向前移动', Icon: ArrowUp }, { key: 'KeyA', label: '向左移动', Icon: ArrowLeft }, { key: 'KeyS', label: '向后移动', Icon: ArrowDown }, { key: 'KeyD', label: '向右移动', Icon: ArrowRight }]).map(({ key, label, Icon }) =>
            <button key={key} className={'vr-key-' + key} aria-label={label} onClick={() => viewer.current?.step(key, .15)} onPointerDown={event => hold(event, key)} onPointerUp={() => viewer.current?.hold(key, false)} onPointerCancel={() => viewer.current?.hold(key, false)} onLostPointerCapture={() => viewer.current?.hold(key, false)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) viewer.current?.hold(key, true); }} onKeyUp={() => viewer.current?.hold(key, false)} onBlur={() => viewer.current?.hold(key, false)}><Icon size={19} /></button>)}
        </div>}
        <div className="vr-help">{status.mode === 'walk' ? '拖动环顾 · 点击画面后 WASD / 方向键移动 · Shift 加速 · 滚轮调视角' : '拖动旋转 · 右键平移 · 滚轮缩放'}</div>
      </div>
      <aside className="vr-inspector">
        <div className="vr-section-title">空间导航 <span>PLAN / 01</span></div>
        <svg className="vr-map" viewBox="-.3 -.4 13.6 8.4" role="img" aria-label="户型小地图及当前相机位置">
          <path d="M0 0H5.94V.89H12.91V6.14H5.7V7.53H0Z" fill="#172e40" stroke="#6a9bb6" strokeWidth=".07" />
          <path d="M0 3.52H3.3M4.2 3.52H5.94M3.95 0V2.2M3.95 2.8V3.52M5.94 .89V2.7M5.94 3.2V3.52M9.91 .89V1.8M9.91 2.8V4.17H12.91M9.91 5.55V6.14" fill="none" stroke="#7697ac" strokeWidth=".06" />
          <g fill="#94b8cd" fontSize=".38" textAnchor="middle"><text x="2" y="1.7">主卧</text><text x="4.9" y="1.7">主卫</text><text x="2.7" y="5.5">客厅</text><text x="7.8" y="2.6">餐厨</text><text x="11.4" y="2.6">书房</text><text x="11.4" y="5.25">客卫</text><text x="8.6" y="5.65">入户</text></g>
          {!modelName && status.mode === 'walk' && <g transform={`translate(${status.position[0]} ${status.position[1]}) rotate(${-status.heading * 180 / Math.PI})`}><path d="M0 -.65L-.34 .12L.34 .12Z" fill="#77dcff" opacity=".4" /><circle r=".13" fill="#a3efff" stroke="#fff" strokeWidth=".035" /></g>}
        </svg>
        <div className="vr-room-buttons">{viewpoints.map(point => <button key={point.id} disabled={!ready || !!modelName} onClick={() => { viewer.current?.view(point.id); viewer.current?.focus(); }}>{point.name}</button>)}</div>
        <div className="vr-section-title">场景设置</div>
        <label className="vr-setting">夜间环境<Switch checked={night} disabled={!ready} onChange={value => { setNight(value); viewer.current?.setNight(value); }} /></label>
        <label className="vr-setting">参考模型照明<Switch checked={lights} disabled={!ready || !!modelName} onChange={value => { setLights(value); viewer.current?.setLights(value); }} /></label>
        <label className="vr-setting">室内显示顶面<Switch checked={roof} disabled={!ready || !!modelName || status.mode !== 'walk'} onChange={value => { setRoof(value); viewer.current?.setRoof(value); }} /></label>
        <div className="vr-section-title">设计师模型</div>
        <p className="vr-note">收到完整 GLB 后可直接替换查看，文件仅在当前浏览器内读取。导入模型会按整体跨度归一化，准确比例仍需原模型校准。</p>
        <input ref={fileInput} type="file" accept=".glb" hidden onChange={event => void importModel(event.target.files?.[0])} />
        <Button long loading={loading} disabled={!ready || loading} icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>导入 GLB 模型</Button>
        {modelName && <><p className="vr-model-name">{modelName}</p><Button long icon={<RotateCcw size={15} />} disabled={loading} onClick={() => { viewer.current?.resetModel(); setModelName(''); }}>恢复参考场景</Button></>}
        <div className="vr-dimension"><b>12.91 × 7.53 m</b><span>外轮廓最大尺寸 · 以图纸标注为准</span></div>
      </aside>
    </div>
    <p className="vr-disclaimer">当前为依据图纸重建的三维参考场景，家具造型、层高和局部细节待原模型校准。灯光设置仅影响本页预览。</p>
  </section>;
}
