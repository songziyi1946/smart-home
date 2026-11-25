import { viewpointForRoom } from './plan';
import { builtinDesignForVersion } from './builtin-presets';
import type { ModelVersion } from '../../../packages/contracts/space-models';

export default function SpaceMap({ room, onSelect, version }: { room: string; onSelect: (room: string) => void; version?: ModelVersion }) {
  const selectedId = version ? room : viewpointForRoom(room)?.id;
  const builtin = !version || version.source === 'builtin';
  const designModel = builtinDesignForVersion(version);
  const { footprint, walls: wallFootprints, furniture: furnishingFootprints } = designModel;
  const width = version?.width ?? designModel.width, depth = version?.depth ?? designModel.depth;
  const rooms = version?.rooms ?? designModel.rooms;
  return <div className="vr-map-wrap">
    <svg className="vr-map" viewBox={`-.3 -.3 ${width + .6} ${depth + .6}`} role="img" aria-label="户型导航">
      {builtin ? <>
        <polygon points={footprint.map(point => point.join(',')).join(' ')} className="map-floor" strokeWidth=".07" />
        {wallFootprints.map(wall => <rect key={wall.id} x={wall.minX} y={wall.minZ} width={wall.maxX - wall.minX} height={wall.maxZ - wall.minZ} className="map-wall-fill" />)}
        {furnishingFootprints.map(item => item.outline
          ? <polygon key={item.id} points={item.outline.map(point => point.join(',')).join(' ')} className="map-furniture" strokeWidth=".025" />
          : <rect key={item.id} x={item.minX} y={item.minZ} width={item.maxX - item.minX} height={item.maxZ - item.minZ} rx=".04" className="map-furniture" strokeWidth=".025" />)}
      </> : version?.plan ? <>
        <polygon points={version.plan.footprint.map(point => point.join(',')).join(' ')} className="map-floor" strokeWidth=".04" />
        {version.plan.walls.flatMap(wall => {
          const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
          const holes = [...wall.openings].sort((a, b) => a.offset - b.offset);
          let start = 0;
          return [...holes.map(hole => { const segment = [start, hole.offset]; start = hole.offset + hole.width; return segment; }), [start, length]].filter(([a, b]) => b > a).map(([a, b], index) => <line key={wall.id + index} x1={wall.from[0] + (wall.to[0] - wall.from[0]) * a / length} y1={wall.from[1] + (wall.to[1] - wall.from[1]) * a / length} x2={wall.from[0] + (wall.to[0] - wall.from[0]) * b / length} y2={wall.from[1] + (wall.to[1] - wall.from[1]) * b / length} stroke="var(--muted)" strokeWidth={wall.thickness} />);
        })}
        {version.plan.furniture.map(item => <rect key={item.id} x={item.x - item.width / 2} y={item.z - item.depth / 2} width={item.width} height={item.depth} transform={`rotate(${-item.rotation} ${item.x} ${item.z})`} className="map-furniture" strokeWidth=".02" />)}
      </> : rooms.filter(value => value.bounds).map(value => {
        const [x0, z0, x1, z1] = value.bounds!;
        return <rect key={value.id} x={x0} y={z0} width={x1 - x0} height={z1 - z0} className="map-floor" strokeWidth=".04" />;
      })}
    </svg>
    {rooms.filter(value => value.bounds).map(point => {
      const [x0, z0, x1, z1] = point.bounds!;
      return <button key={point.id} className="vr-map-room" style={{ left: `${((x0 + x1) / 2 + .3) / (width + .6) * 100}%`, top: `${((z0 + z1) / 2 + .3) / (depth + .6) * 100}%` }} aria-pressed={selectedId === point.id} onClick={() => onSelect(version ? point.id : point.name)}>{point.name}</button>;
    })}
  </div>;
}
