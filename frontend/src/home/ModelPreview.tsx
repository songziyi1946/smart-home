import { useEffect, useRef, useState } from 'react';
import { createViewer, type Viewer } from '../vr/viewer';
import { builtinDesignForVersion, currentBuiltinVersion } from '../vr/builtin-presets';
import { canonicalRoom } from '../constants';
import '../vr/style.css';

export default function ModelPreview({ room, overview }: { room: string; overview: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const [error, setError] = useState(false);
  const rooms = builtinDesignForVersion(currentBuiltinVersion).rooms;
  const viewpoint = rooms.find(value => value.name === room) ?? rooms.find(value => value.controlRoom === canonicalRoom(room));
  useEffect(() => {
    try { viewer.current = createViewer(host.current!, status => setError(status.modelState === 'error'), undefined, currentBuiltinVersion); }
    catch { setError(true); }
    return () => { viewer.current?.dispose(); viewer.current = undefined; };
  }, []);
  useEffect(() => {
    if (overview || !viewpoint) viewer.current?.overview();
    else viewer.current?.view(viewpoint.id);
  }, [overview, viewpoint]);
  return <div className="home-model-preview">
    <div ref={host} className="home-model-canvas" />
    <span className="preview-caption">{overview || !viewpoint ? '全屋模型' : room + '模型'}</span>
    {error && <div className="preview-error" role="status">无法显示模型，请重试或检查浏览器硬件加速</div>}
  </div>;
}
