import { bedroomDoorFront, bedroomDoorLeft, bedroomDoorRight, furnishingFootprints, millworkFootprints, viewpoints } from './plan';
import type { ViewerStatus } from './viewer';

const positions: Record<string, [number, number]> = {
  entry: [8.6, 5.65], living: [2.7, 5.7], kitchen: [7.8, 2.6], study: [11.4, 2.6],
  bedroom: [2, 1.7], ensuite: [4.6, 1.75], bath: [11.4, 5.25],
};
export default function SpaceMap({ room, onSelect, status }: { room: string; onSelect: (room: string) => void; status?: ViewerStatus }) {
  return <div className="vr-map-wrap">
    <svg className="vr-map" viewBox="-.3 -.4 13.6 8.4" role="img" aria-label="户型图，使用房间按钮选择空间">
      <path d="M0 0H5.94V.89H12.91V6.14H5.7V7.53H0Z" className="map-floor" strokeWidth=".07" />
      <path d="M0 3.635H1.46M3.96 0V2.14M4.84 2.08H5.7M5.82 .89V3.74M9.91 .89V1.8M9.91 2.8V4.17H12.91M9.91 5.55V6.14" className="map-wall" strokeWidth=".06" />
      <path d={`M${bedroomDoorLeft} ${bedroomDoorFront}H${bedroomDoorRight}`} className="map-wall" strokeDasharray=".09 .07" strokeWidth=".04" />
      {millworkFootprints.map(({ minX, minZ, maxX, maxZ }) => <rect key={minX + ':' + minZ} x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} className="map-cabinet" strokeWidth=".035" />)}
      {furnishingFootprints.map(({ minX, minZ, maxX, maxZ }) => <rect key={minX + ':' + minZ} x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} rx=".04" className="map-furniture" strokeWidth=".025" />)}
      {status?.mode === 'walk' && <g transform={`translate(${status.position[0]} ${status.position[1]}) rotate(${-status.heading * 180 / Math.PI})`}><path d="M0 -.8L-.4 .12L.4 .12Z" fill="var(--accent)" opacity=".3" /><circle r=".15" fill="var(--accent)" stroke="white" strokeWidth=".04" /></g>}
    </svg>
    {viewpoints.map(point => { const [x, y] = positions[point.id]; return <button key={point.id} className="vr-map-room" style={{ left: `${(x + .3) / 13.6 * 100}%`, top: `${(y + .4) / 8.4 * 100}%` }} aria-pressed={room === point.name} onClick={() => onSelect(point.name)}>{point.name}</button>; })}
  </div>;
}
