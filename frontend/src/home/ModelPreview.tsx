import { useEffect, useRef, useState } from 'react';
import { createViewer, type Viewer } from '../vr/viewer';
import { viewpoints } from '../vr/plan';

export default function ModelPreview({ room, overview }: { room: string; overview: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const [error, setError] = useState(false);
  const viewpoint = viewpoints.find(point => point.name === room);
  useEffect(() => {
    try { viewer.current = createViewer(host.current!, () => {}); }
    catch { setError(true); }
    return () => { viewer.current?.dispose(); viewer.current = undefined; };
  }, []);
  useEffect(() => {
    if (overview || !viewpoint) viewer.current?.setMode('orbit');
    else viewer.current?.view(viewpoint.id);
  }, [overview, viewpoint]);
  return <div className="home-model-preview">
    <div ref={host} className="home-model-canvas" />
    <span className="preview-caption">{overview ? '全屋模型 · 拖动旋转' : viewpoint ? room + ' · 模型预览' : room + '暂无模型定位 · 展示全屋'}</span>
    {error && <div className="preview-error" role="status">无法显示模型，请检查浏览器硬件加速</div>}
  </div>;
}
