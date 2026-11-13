import * as T from 'three';
import { CEILING_HEIGHT as H, type Obstacle } from './plan';

export function buildHome() {
  const root = new T.Group();
  const ceilings = new T.Group();
  const obstacles: Obstacle[] = [];
  const lamps: T.PointLight[] = [];
  const luminous: T.MeshStandardMaterial[] = [];
  const textures: T.Texture[] = [];
  root.add(ceilings);
  function texture(kind: 'wood' | 'floor' | 'fabric' | 'tile') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    let seed = 1247;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    ctx.fillStyle = kind === 'wood' || kind === 'floor' ? '#ab8865' : kind === 'tile' ? '#b7c4b4' : '#e5ddcc'; ctx.fillRect(0, 0, 512, 512);
    if (kind === 'floor') {
      ctx.translate(256, 256); ctx.rotate(Math.PI / 4); ctx.translate(-400, -400);
      for (let row = 0; row < 20; row++) for (let col = 0; col < 8; col++) {
        const x = col * 128 + (row % 2) * 64, y = row * 40;
        ctx.fillStyle = `hsl(32, ${25 + random() * 10}%, ${57 + random() * 12}%)`; ctx.fillRect(x, y, 127, 39);
        ctx.strokeStyle = '#715e4933'; ctx.strokeRect(x, y, 127, 39);
        for (let i = 0; i < 10; i++) { ctx.fillStyle = '#ffffff0d'; ctx.fillRect(x + random() * 20, y + random() * 38, 100, .6); }
      }
    } else if (kind === 'tile') {
      ctx.strokeStyle = '#f7f3e0'; ctx.lineWidth = 3;
      for (let n = 0; n <= 512; n += 128) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, 512); ctx.moveTo(0, n); ctx.lineTo(512, n); ctx.stroke(); }
    } else {
      for (let i = 0; i < 5000; i++) { ctx.fillStyle = random() > .5 ? '#ffffff12' : '#3a271716'; ctx.fillRect(random() * 512, random() * 512, kind === 'wood' ? .7 : 1.5, kind === 'wood' ? 30 + random() * 160 : 1.5); }
    }
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping;
    map.repeat.set(kind === 'floor' ? 4 : 1, kind === 'floor' ? 4 : 1); map.anisotropy = 4; textures.push(map); return map;
  }
  const mat = (color: string, extra: T.MeshStandardMaterialParameters = {}) => new T.MeshStandardMaterial({ color, roughness: .78, ...extra });
  const wood = mat('#d5bb9b', { map: texture('wood') });
  const oak = mat('#ffffff', { map: texture('floor') });
  const cream = mat('#eee7d7'); const wallMat = mat('#eee9dc'); const black = mat('#373b3b'); const stone = mat('#e5ddcb');
  const fabric = mat('#fff8e7', { map: texture('fabric') }); const grey = mat('#555958'); const sage = mat('#8a9b8b');
  const glass = mat('#bed9d6', { transparent: true, opacity: .23, roughness: .15, metalness: .1, depthWrite: false });
  const tile = mat('#e2e7d6', { map: texture('tile') });
  function box(x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material, solid = false, parent: T.Group = root) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    if (solid) obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return mesh;
  }
  function sphere(x: number, y: number, z: number, r: number, material: T.Material, sx = 1, sy = 1, sz = 1) {
    const mesh = new T.Mesh(new T.SphereGeometry(r, 20, 12), material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; root.add(mesh); return mesh;
  }
  function cylinder(x: number, y: number, z: number, r: number, h: number, material: T.Material) {
    const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 24), material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  function wall(x: number, z: number, w: number, d: number, material = wallMat) {
    box(x, H / 2, z, w, H, d, material, true); box(x, .045, z, w + .015, .09, d + .015, black);
  }
  function floor(x: number, z: number, w: number, d: number, material = oak) { box(x, -.055, z, w, .1, d, material); box(x, H + .04, z, w, .08, d, cream, false, ceilings); }
  function light(x: number, z: number, length = 1) {
    const material = mat('#fff2c9', { emissive: '#ffdf9e', emissiveIntensity: 1.5 }); luminous.push(material);
    box(x, H - .08, z, length, .035, .045, material);
    const lamp = new T.PointLight('#ffe6b5', 12, 6, 2); lamp.position.set(x, H - .23, z); root.add(lamp); lamps.push(lamp);
  }
  function cabinet(x: number, z: number, w: number, h: number, d: number, front: 'north' | 'south' = 'south', material = cream) {
    box(x, h / 2, z, w, h, d, wood, true);
    const count = Math.max(1, Math.round(w / .52));
    for (let i = 0; i < count; i++) {
      const px = x - w / 2 + (i + .5) * w / count;
      box(px, h / 2, z + (front === 'south' ? 1 : -1) * (d / 2 + .012), w / count - .014, h - .04, .025, material);
    }
  }
  function window(x: number, z: number, w: number, direction: 'x' | 'z' = 'x') {
    const group = new T.Group(); root.add(group); group.position.set(x, 1.55, z); if (direction === 'z') group.rotation.y = Math.PI / 2;
    box(0, 0, 0, w, 1.95, .055, glass, false, group);
    for (const px of [-w / 2, 0, w / 2]) box(px, 0, 0, .045, 2.03, .075, black, false, group);
    for (const py of [-1, 1]) box(0, py, 0, w, .045, .075, black, false, group);
    // Sheer curtains, kept light so the room stays readable.
    for (const sign of [-1, 1]) for (let i = 0; i < 6; i++) {
      box(sign * (w / 2 - .25) + i * .025, -.05, .08 + Math.sin(i) * .025, .055, 2.1, .025, mat('#fff9eb', { transparent: true, opacity: .45 }), false, group);
    }
  }
  function plant(x: number, z: number, size = 1) {
    cylinder(x, .22 * size, z, .17 * size, .44 * size, cream);
    cylinder(x, .7 * size, z, .018, size, wood);
    for (let i = 0; i < 9; i++) { const a = i * 2.4; const leaf = sphere(x + Math.cos(a) * .18 * size, (.75 + i * .055) * size, z + Math.sin(a) * .18 * size, .16 * size, sage, .45, 1.9, .65); leaf.rotation.z = Math.cos(a) * .7; }
  }
  function books(x: number, y: number, z: number, count = 6) {
    for (let i = 0; i < count; i++) box(x + i * .06, y + .12, z, .045, .2 + (i % 3) * .035, .16, [cream, grey, sage, wood][i % 4]);
  }
  function flowers(x: number, y: number, z: number) {
    cylinder(x, y + .12, z, .085, .24, stone);
    for (let i = 0; i < 9; i++) { const a = i * 2.4; sphere(x + Math.cos(a) * .13, y + .32 + (i % 3) * .055, z + Math.sin(a) * .13, .055, cream); }
  }
  function chair(x: number, z: number) {
    box(x, .45, z, .46, .09, .43, fabric, true); box(x, .78, z + .17, .46, .55, .07, wood);
    for (const dx of [-.17, .17]) for (const dz of [-.15, .15]) box(x + dx, .22, z + dz, .035, .44, .035, black);
  }
  // Footprint from the supplied plan; each rectangle meets an adjacent room.
  floor(2.97, 1.76, 5.94, 3.52); floor(2.85, 5.525, 5.7, 4.01); floor(9.305, 3.515, 7.21, 5.25);
  // Exterior walls leave wide glazing openings.
  wall(2.97, .1, 5.94, .2); wall(.1, .3, .2, .6); wall(.1, 3.05, .2, 1.0); wall(.1, 7.16, .2, .74);
  box(.1, .23, 3.765, .2, .46, 7.53, wallMat, true); box(.1, 2.6, 3.765, .2, .2, 7.53, wallMat);
  wall(5.84, .5, .2, .8); wall(6.04, .99, .2, .2); wall(9.8, .99, .5, .2); wall(12.7, .99, .22, .2);
  box(9.375, .23, .99, 7.07, .46, .2, wallMat, true); box(9.375, 2.6, .99, 7.07, .2, .2, wallMat);
  wall(12.81, 3.515, .2, 5.25); wall(.5, 7.43, 1, .2); wall(5.25, 7.43, .9, .2);
  box(2.85, .23, 7.43, 5.7, .46, .2, wallMat, true); box(2.85, 2.6, 7.43, 5.7, .2, .2, wallMat);
  wall(5.6, 6.88, .2, 1.3); wall(6.8, 6.04, 2.4, .2); wall(11.4, 6.04, 3.02, .2);
  // Room dividers and real openings; no invisible full-height wall across a doorway.
  wall(1.65, 3.52, 3.1, .12); wall(4.66, 3.52, 1.0, .12);
  cabinet(4.75, 3.18, 1.02, 2.55, .55, 'north');
  wall(3.95, 1.15, .12, 2.1); wall(3.95, 3.05, .12, .7);
  wall(5.84, 1.85, .2, 1.7); wall(5.84, 3.39, .2, .32);
  wall(9.91, 1.4, .12, .8); wall(9.91, 3.35, .12, 1.2);
  wall(11.42, 4.17, 2.98, .12); wall(9.91, 5.8, .12, .46);
  // Windows sit just in front of exterior walls as daylight portals.
  window(.22, 1.6, 2.5, 'z'); window(.22, 5.35, 2.5, 'z'); window(2.9, 7.3, 3.7);
  window(7.8, 1.12, 2.9); window(11.35, 1.12, 2.4);
  // Living room: dark sofa, neutral rug, organic tables, freestanding display and bookcase.
  box(2.6, .015, 5.52, 3.7, .025, 2.5, fabric);
  for (const dx of [-1.8, 1.8]) box(2.6 + dx, .032, 5.52, .04, .015, 2.35, black);
  box(2.1, .35, 4.15, 2.75, .52, .82, grey, true); box(2.1, .77, 3.92, 2.75, .65, .22, grey);
  for (const x of [.75, 3.45]) box(x, .57, 4.18, .18, .55, .88, grey);
  for (let i = 0; i < 4; i++) { const cushion = box(1.2 + i * .58, .82, 4.2, .46, .43, .16, i % 2 ? fabric : mat('#b79b8f')); cushion.rotation.x = -.18; }
  sphere(2.75, .43, 5.35, .6, stone, 1.4, .07, .9); cylinder(2.75, .2, 5.35, .19, .4, wood);
  cylinder(1.75, .5, 5.65, .35, .05, wood); cylinder(1.75, .25, 5.65, .08, .5, wood); flowers(2.8, .48, 5.32);
  cabinet(5.06, 4.12, .8, 2.55, .35); cabinet(5.06, 5.3, .8, .85, .35);
  for (const y of [1.1, 1.6, 2.1]) { box(5.05, y, 5.3, .8, .035, .35, wood); books(4.76, y, 5.3, 6); }
  const tv = box(4.3, 1.1, 6.6, 1.45, .85, .055, black); tv.rotation.y = -.25;
  for (const dx of [-.5, .5]) box(4.3 + dx, .37, 6.6, .045, .74, .045, cream);
  plant(.65, 6.9, 1.3); plant(5.15, 6.8, .8);
  // Framed art above the sofa.
  for (let i = 0; i < 3; i++) { box(1.5 + i * .55, 1.8, 3.61, .43, .55, .04, wood); box(1.5 + i * .55, 1.8, 3.64, .35, .47, .015, i % 2 ? sage : fabric); }
  // Kitchen counters, cream panelled doors, backsplash and wood surfaces.
  cabinet(7.55, 1.52, 2.9, .85, .6); box(7.55, .88, 1.52, 2.96, .06, .65, wood);
  cabinet(6.35, 2.52, .6, .85, 1.4); box(6.35, .88, 2.52, .65, .06, 1.45, wood);
  box(6.05, 1.38, 2.5, .025, 1.0, 1.4, tile);
  box(6.35, 2.05, 2.45, .6, .66, 1.4, cream);
  box(6.68, 2.05, 2.45, .025, .62, 1.36, cream);
  box(6.35, .93, 2.5, .5, .035, .7, black);
  for (const z of [2.3, 2.7]) cylinder(6.35, .96, z, .115, .018, grey);
  box(7.8, .92, 1.52, .8, .025, .4, grey); box(7.8, .94, 1.52, .64, .01, .3, black);
  cylinder(8.14, 1.1, 1.45, .025, .35, cream);
  cabinet(9.32, 1.55, .8, 2.35, .65); box(9.32, 1.2, 1.9, .018, 2.1, .025, black);
  // Marble island with two seats and long pendant.
  box(7.9, .44, 3.07, .75, .88, .6, wood, true); box(8.02, .92, 3.07, 1.6, .06, .65, stone, true);
  chair(8.25, 3.72); chair(8.25, 2.45); flowers(7.62, .96, 3.07);
  box(8.0, 2.15, 3.05, 1.35, .065, .12, cream); for (const x of [7.5, 8.5]) box(x, 2.45, 3.05, .008, .55, .008, black);
  // Kitchen/living divider: warm wood niches and appliance column.
  cabinet(5.45, 4.95, .55, 2.55, 1.0, 'south', wood); box(5.45, 1.45, 5.46, .45, .38, .04, black); box(5.45, 1.46, 5.49, .32, .24, .02, grey);
  plant(9.3, 4.0, 1.2);
  // Study: desk, dual screens, pegboard, books and chair.
  box(11.5, .75, 1.95, 1.75, .06, .65, wood, true); for (const x of [10.78, 12.22]) box(x, .37, 1.95, .045, .74, .42, grey);
  box(11.5, 1.23, 1.45, 1.8, .83, .035, cream);
  for (let i = 0; i < 21; i++) for (let j = 0; j < 7; j++) sphere(10.7 + i * .08, .94 + j * .095, 1.48, .009, black);
  for (const x of [11.2, 11.87]) { box(x, 1.17, 1.78, .58, .38, .04, black); box(x, .91, 1.8, .04, .2, .04, grey); }
  box(11.5, .8, 2.1, .5, .025, .17, grey); chair(11.5, 2.75);
  for (const y of [1.85, 2.25]) { box(11.5, y, 1.4, 1.8, .035, .23, wood); books(10.75, y, 1.4, 8); }
  cabinet(12.3, 3.75, .8, .85, .5); plant(10.3, 1.5, .8);
  // Guest bathroom: sage tiles, floating vanity, mirror, shower screen and toilet.
  box(11.4, .006, 5.15, 2.7, .025, 1.7, stone);
  box(12.68, 1.4, 5.15, .025, 2.5, 1.7, tile);
  cabinet(10.5, 5.67, .75, .8, .5, 'north'); box(10.5, .85, 5.67, .8, .06, .55, stone);
  box(10.5, .89, 5.65, .45, .025, .3, cream); box(10.5, 1.65, 5.88, .62, .85, .025, mat('#a9c1c1', { metalness: .6, roughness: .12 }));
  sphere(11.35, .43, 5.65, .25, cream, .85, .85, 1.25); box(11.35, .64, 5.9, .42, .65, .18, cream, true);
  box(12.0, 1.1, 5.22, .025, 2.2, 1.5, glass, true); box(12.0, 2.23, 5.22, .035, .035, 1.5, black);
  cylinder(12.55, 1.35, 5.6, .017, 1.4, grey); box(12.42, 2.08, 5.6, .3, .025, .3, grey);
  // Main bedroom: upholstered bed, wood headboard, bay seating, vanity and wardrobe.
  box(1.95, .25, 1.1, 1.8, .4, 2.1, wood, true); box(1.95, .49, 1.1, 1.83, .18, 2.13, fabric);
  box(1.95, .84, .24, 1.9, .9, .15, grey);
  for (const x of [1.48, 2.42]) box(x, .66, .55, .72, .18, .43, fabric);
  box(1.95, .61, 1.67, 1.84, .035, .4, mat('#9c917e', { map: texture('fabric') }));
  for (const x of [.7, 3.2]) { cabinet(x, .55, .5, .53, .48); cylinder(x, 1.9, .55, .1, .08, cream); box(x, 2.3, .55, .008, .7, .008, black); }
  cabinet(.49, 1.8, .55, .48, 2.0); box(.5, .53, 1.8, .57, .07, 2.0, fabric);
  cabinet(3.5, 1.2, .6, 2.5, 1.8); box(2.5, .75, 2.86, 1.1, .06, .4, wood, true); cylinder(2.5, .4, 2.5, .24, .45, fabric);
  sphere(2.5, 1.1, 2.99, .23, mat('#aec5c3', { metalness: .7 }), 1, 1, .05);
  // Ensuite with shower and washbasin.
  floor(4.9, 1.75, 1.6, 3.1, stone); box(4.85, 1.15, .95, 1.5, 2.3, .02, glass, true);
  cabinet(4.35, 2.7, .5, .8, .55); box(4.35, 1.5, 2.99, .5, .7, .025, glass);
  // Warm lighting and ceiling fixtures throughout.
  for (const [x, z, length] of [[2.3, 4, 2.9], [7.7, 1.3, 2.8], [11.4, 1.3, 2], [1.9, .4, 2.1], [4.9, 1.8, .5], [11.4, 5.2, .5], [7.8, 5.7, 1.8]]) light(x, z, length);
  for (const [x, z] of [[2.5, 5.5], [8, 2.8], [2, 1.4], [11.4, 2.4]]) cylinder(x, H - .15, z, .25, .06, cream);
  function setLights(on: boolean) { lamps.forEach(lamp => { lamp.intensity = on ? 12 : 0; }); luminous.forEach(material => { material.emissiveIntensity = on ? 1.5 : 0; }); }
  return { root, ceilings, obstacles, textures, setLights };
}

export function disposeObject(root: T.Object3D) {
  const materials = new Set<T.Material>(); const geometries = new Set<T.BufferGeometry>(); const textures = new Set<T.Texture>();
  root.traverse(object => { if (object instanceof T.Mesh) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
  for (const material of materials) { for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value); material.dispose(); }
  geometries.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}
