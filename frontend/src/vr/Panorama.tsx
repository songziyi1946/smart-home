import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { createPanoramaViewer, type PanoramaStatus } from './panorama-viewer';
import type { PanoramaScene } from './panoramas';

export default function Panorama({ scene }: { scene?: PanoramaScene }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof createPanoramaViewer>>();
  const [status, setStatus] = useState<PanoramaStatus>('loading');
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setUnavailable(false);
    try { viewer.current = createPanoramaViewer(host.current!, setStatus); }
    catch { setUnavailable(true); }
    return () => { viewer.current?.dispose(); viewer.current = undefined; };
  }, [attempt]);
  useEffect(() => { if (scene) viewer.current?.load(scene); }, [scene, attempt]);
  return <>
    <div ref={host} className="vr-canvas vr-panorama-canvas" aria-hidden={!scene} hidden={!scene} />
    <div className="vr-view-label">{scene?.room ?? '暂无全景'}</div>
    {!scene ? <div className="vr-message" role="status">这个房间暂无全景，请选择其他房间。</div>
      : unavailable || status === 'error' ? <div className="vr-message vr-error" role="alert">
        {unavailable ? '无法启动全景渲染，请检查浏览器硬件加速。' : '全景图片加载失败，请重试或切换其他房间。'}
        <button className="vr-panorama-retry" onClick={() => setAttempt(value => value + 1)}>重试</button>
      </div> : status === 'loading' && <div className="vr-message" role="status">正在加载{scene.room}全景…</div>}
    {scene && <div className="vr-panorama-tools" aria-label="全景视角控制">
      <button disabled={unavailable || status !== 'ready'} aria-label="放大全景" onClick={() => viewer.current?.zoom(-10)}><Plus size={18} /></button>
      <button disabled={unavailable || status !== 'ready'} aria-label="缩小全景" onClick={() => viewer.current?.zoom(10)}><Minus size={18} /></button>
      <button disabled={unavailable || status !== 'ready'} aria-label="重置全景视角" onClick={() => viewer.current?.reset()}><RotateCcw size={18} /></button>
    </div>}
  </>;
}
