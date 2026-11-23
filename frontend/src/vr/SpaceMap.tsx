import { designModel, footprint, furnishingFootprints, HOME_DEPTH, HOME_WIDTH, viewpointForRoom, wallFootprints } from './plan';
import type { ViewerStatus } from './viewer';

export default function SpaceMap({ room, onSelect, status }: { room: string; onSelect: (room: string) => void; status?: ViewerStatus }) {
  const selected = viewpointForRoom(room);
  return <div className="vr-map-wrap">
    <svg className="vr-map" viewBox={`-.3 -.3 ${HOME_WIDTH + .6} ${HOME_DEPTH + .6}`} role="img" aria-label="户型导航">
      <polygon points={footprint.map(point => point.join(',')).join(' ')} className="map-floor" strokeWidth=".07" />
      {wallFootprints.map(wall => <rect key={wall.id} x={wall.minX} y={wall.minZ} width={wall.maxX - wall.minX} height={wall.maxZ - wall.minZ} className="map-wall-fill" />)}
      {furnishingFootprints.map(item => <rect key={item.id} x={item.minX} y={item.minZ} width={item.maxX - item.minX} height={item.maxZ - item.minZ} rx=".04" className="map-furniture" strokeWidth=".025" />)}
      {status?.mode === 'walk' && <g transform={`translate(${status.position[0]} ${status.position[1]}) rotate(${-status.heading * 180 / Math.PI})`}><path d="M0 -.8L-.4 .12L.4 .12Z" fill="var(--accent)" opacity=".3" /><circle r=".15" fill="var(--accent)" stroke="white" strokeWidth=".04" /></g>}
    </svg>
    {designModel.rooms.map(point => {
      const [x0, z0, x1, z1] = point.bounds;
      return <button key={point.id} className="vr-map-room" style={{ left: `${((x0 + x1) / 2 + .3) / (HOME_WIDTH + .6) * 100}%`, top: `${((z0 + z1) / 2 + .3) / (HOME_DEPTH + .6) * 100}%` }} aria-pressed={selected?.id === point.id} onClick={() => onSelect(point.name)}>{point.name}</button>;
    })}
  </div>;
}
