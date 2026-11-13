import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bedroomDoorFront, bedroomDoorLeft, bedroomDoorRight, CEILING_HEIGHT as H, furnishingFootprints, millworkFootprints, type Obstacle } from './plan';
import millwork from './millwork.json';
import woodColor from './textures/wood-diff.webp';
import woodNormal from './textures/wood-nor_gl.webp';
import woodRoughness from './textures/wood-rough.webp';
import tileColor from './textures/tile-diff.webp';
import tileNormal from './textures/tile-nor_gl.webp';
import tileRoughness from './textures/tile-rough.webp';

export function buildHome(onTextureReady: () => void) {
  const root = new T.Group();
  const ceilings = new T.Group();
  const upperDetails = new T.Group();
  const wallTops = new T.Group();
  const livingFallback = new T.Group();
  const millworkFallback = new T.Group();
  const entryFallback = new T.Group();
  const cutHeight = 1.22;
  const cutPlane = new T.Plane(new T.Vector3(0, -1, 0), H + 1);
  const obstacles: Obstacle[] = [...millworkFootprints, ...furnishingFootprints];
  const lamps: T.SpotLight[] = [];
  root.add(ceilings, upperDetails, wallTops, livingFallback, millworkFallback, entryFallback);
  function texture(kind: 'wood' | 'fabric') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    let seed = 1247;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    ctx.fillStyle = kind === 'wood' ? '#ab8865' : '#e5ddcc'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5000; i++) { ctx.fillStyle = random() > .5 ? '#ffffff12' : '#3a271716'; ctx.fillRect(random() * 512, random() * 512, kind === 'wood' ? .7 : 1.5, kind === 'wood' ? 30 + random() * 160 : 1.5); }
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping;
    map.anisotropy = 4; return map;
  }
  const loader = new T.TextureLoader();
  function pbr(color: string, normal: string, roughness: string) {
    const maps = [color, normal, roughness].map((url, index) => {
      const map = loader.load(url, onTextureReady);
      if (index === 0) map.colorSpace = T.SRGBColorSpace;
      map.wrapS = map.wrapT = T.RepeatWrapping;
      map.anisotropy = 4;
      return map;
    });
    return { map: maps[0], normalMap: maps[1], roughnessMap: maps[2], normalScale: new T.Vector2(.6, .6) };
  }
  const mat = (color: string, extra: T.MeshStandardMaterialParameters = {}) => new T.MeshStandardMaterial({ color, roughness: .78, ...extra });
  const cut = { clippingPlanes: [cutPlane], clipShadows: true };
  const wood = mat('#bda486', { map: texture('wood') });
  const oak = mat('#c7b7a6', { ...pbr(woodColor, woodNormal, woodRoughness), roughness: .86 });
  const tile = mat('#c3c3b6', { ...pbr(tileColor, tileNormal, tileRoughness), roughness: .72 });
  const cream = mat('#d8d0c1'); const wallMat = mat('#d5cfc3', cut); const black = mat('#30363a');
  const stone = mat('#d9d3c7', { roughness: .35 });
  const slab = mat('#263446'); const section = mat('#50687f', { emissive: '#3d6c97', emissiveIntensity: .26 });
  const fabric = mat('#fff8e7', { map: texture('fabric') });
  const upholstery = mat('#727779', { map: fabric.map, roughness: .96 });
  const grey = mat('#555958'); const sage = mat('#788966');
  const glass = mat('#a4c0cc', { transparent: true, opacity: .18, roughness: .15, depthWrite: false, ...cut });
  const frame = mat('#353e46', cut);
  const curtain = mat('#f4ebdc', { transparent: true, opacity: .48, depthWrite: false, ...cut });
  const fixture = mat('#e4d9c4', { emissive: '#ffcf89', emissiveIntensity: 2 });
  function box(x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material | T.Material[], solid = false, parent = root, radius = 0) {
    const geometry = radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new T.BoxGeometry(w, h, d);
    const mesh = new T.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    if (solid) obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return mesh;
  }
  function sphere(x: number, y: number, z: number, r: number, material: T.Material, sx = 1, sy = 1, sz = 1) {
    const mesh = new T.Mesh(new T.SphereGeometry(r, 20, 12), material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; root.add(mesh); return mesh;
  }
  function cylinder(x: number, y: number, z: number, r: number, h: number, material: T.Material, parent = root) {
    const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 24), material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function wall(x: number, z: number, w: number, d: number) {
    box(x, H / 2, z, w, H, d, wallMat, true);
    box(x, .045, z, w + .015, .09, d + .015, black);
    box(x, cutHeight - .01, z, w, .02, d, section, false, wallTops);
  }
  function floor(x: number, z: number, w: number, d: number, material = oak) {
    const mesh = box(x, -.095, z, w, .19, d, [slab, slab, material, slab, slab, slab]);
    const { position, uv } = mesh.geometry.attributes;
    const repeatMetres = material === oak ? 1.2 : 1.9;
    const top = mesh.geometry.groups[2].start;
    for (let i = top; i < top + mesh.geometry.groups[2].count; i++) {
      const vertex = mesh.geometry.index!.getX(i);
      uv.setXY(vertex, (position.getX(vertex) + x) / repeatMetres, -(position.getZ(vertex) + z) / repeatMetres);
    }
    box(x, H + .04, z, w, .08, d, cream, false, ceilings);
  }
  function light(x: number, z: number, intensity: number) {
    cylinder(x, H - .06, z, .12, .06, fixture, upperDetails);
    const lamp = new T.SpotLight('#ffdfb7', intensity, 6, .85, .68);
    lamp.position.set(x, H - .12, z);
    lamp.target.position.set(x, 0, z);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(512, 512);
    lamp.shadow.radius = 3.3;
    lamp.shadow.intensity = .8;
    lamp.shadow.camera.near = .15;
    lamp.shadow.normalBias = .025;
    lamp.shadow.bias = -.0004;
    root.add(lamp, lamp.target);
    lamps.push(lamp);
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
    box(0, 0, 0, w, 1.95, .055, glass, false, group).castShadow = false;
    for (const px of [-w / 2, 0, w / 2]) box(px, 0, 0, .045, 2.03, .075, frame, false, group);
    for (const py of [-1, 1]) box(0, py, 0, w, .045, .075, frame, false, group);
    // Sheer curtains, kept light so the room stays readable.
    for (const sign of [-1, 1]) for (let i = 0; i < 6; i++) {
      box(sign * (w / 2 - .25) + i * .025, -.05, .08 + Math.sin(i) * .025, .055, 2.1, .025, curtain, false, group).castShadow = false;
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
  function chair(x: number, z: number, back = .17) {
    box(x, .45, z, .46, .09, .43, fabric, true); box(x, .78, z + back, .46, .55, .07, wood);
    for (const dx of [-.17, .17]) for (const dz of [-.15, .15]) box(x + dx, .22, z + dz, .035, .44, .035, black);
  }
  // Adjacent slabs share world-space UVs so plank seams carry through doorways.
  floor(1.975, 1.76, 3.95, 3.52);
  floor(4.945, 1.07, 1.99, 2.14, tile); floor(4.945, 2.83, 1.99, 1.38);
  floor(2.97, 4.83, 5.94, 2.62); floor(2.85, 6.835, 5.7, 1.39);
  floor(9.425, 2.53, 6.97, 3.28);
  floor(7.925, 5.155, 3.97, 1.97); floor(11.41, 5.155, 3, 1.97, tile);
  // Exterior walls leave wide glazing openings.
  wall(2.97, .1, 5.94, .2); wall(.1, .3, .2, .6); wall(.1, 3.05, .2, 1.0); wall(.1, 7.16, .2, .74);
  box(.1, .23, 3.765, .2, .46, 7.53, wallMat, true); box(.1, 2.6, 3.765, .2, .2, 7.53, wallMat);
  wall(5.84, .5, .2, .8); wall(6.04, .99, .2, .2); wall(9.8, .99, .5, .2); wall(12.7, .99, .22, .2);
  box(9.375, .23, .99, 7.07, .46, .2, wallMat, true); box(9.375, 2.6, .99, 7.07, .2, .2, wallMat);
  wall(12.81, 3.515, .2, 5.25); wall(.5, 7.43, 1, .2); wall(5.25, 7.43, .9, .2);
  box(2.85, .23, 7.43, 5.7, .46, .2, wallMat, true); box(2.85, 2.6, 7.43, 5.7, .2, .2, wallMat);
  wall(5.6, 6.88, .2, 1.3); wall(6.8, 6.04, 2.4, .2); wall(11.4, 6.04, 3.02, .2);
  // Room dividers and real openings; no invisible full-height wall across a doorway.
  wall(.9125, 3.635, 1.345, .27);
  const doorHead = H - millwork.height;
  const doorWidth = bedroomDoorRight - bedroomDoorLeft;
  box((bedroomDoorLeft + bedroomDoorRight) / 2, H - doorHead / 2, bedroomDoorFront - .04, doorWidth, doorHead, .08, wallMat, false, upperDetails);
  box(bedroomDoorLeft - .015, millwork.height / 2, bedroomDoorFront - .04, .03, millwork.height, .08, wood);
  box(bedroomDoorRight + .0315, millwork.height / 2, bedroomDoorFront - .04, .063, millwork.height, .08, wood);
  wall(3.96, 1.19, .12, 1.9);
  wall(5.82, 2.315, .24, 2.85);
  wall(9.91, 1.4, .12, .8); wall(9.91, 3.35, .12, 1.2);
  wall(11.42, 4.17, 2.98, .12); wall(9.91, 5.8, .12, .46);
  // Windows sit just in front of exterior walls as daylight portals.
  window(.22, 1.6, 2.5, 'z'); window(.22, 5.35, 2.5, 'z'); window(2.9, 7.3, 3.7);
  window(7.8, 1.12, 2.9); window(11.35, 1.12, 2.4);
  // Living-room furniture is authored in Blender, facing the cabinet wall.
  // Keep a small local fallback so the room remains usable when the GLB is still loading.
  box(2.65, .015, 5.83, 3.45, .025, 2.55, fabric, false, livingFallback, .01);
  box(2.65, .35, 6.28, 2.75, .52, .82, grey, false, livingFallback, .08);
  box(2.65, .77, 6.04, 2.75, .65, .22, grey, false, livingFallback, .05);
  for (const x of [1.30, 4.00]) box(x, .57, 6.31, .18, .55, .88, grey, false, livingFallback, .04);
  for (let i = 0; i < 4; i++) {
    const cushion = box(1.75 + i * .58, .82, 6.33, .46, .43, .16, i % 2 ? fabric : mat('#b79b8f'), false, livingFallback, .04);
    cushion.rotation.x = -.18;
  }
  box(2.65, .43, 5.15, 1.05, .07, .65, stone, false, livingFallback, .03);
  cylinder(2.65, .20, 5.15, .19, .4, wood, livingFallback);
  plant(.65, 6.9, 1.05); plant(5.13, 6.94, .8);

  // TV wall and low console fallback. The Blender assets take over after loading.
  box(2.40, .34, 4.08, 2.05, .55, .36, wood, true, millworkFallback, .025);
  box(2.40, .66, 4.08, 1.94, .06, .38, stone, false, millworkFallback, .018);
  box(2.40, 1.18, 4.02, 1.36, .80, .055, black, false, millworkFallback, .012);
  box(1.72, .44, 4.08, .06, .38, .50, cream, false, millworkFallback, .012);
  box(3.08, .44, 4.08, .06, .38, .50, cream, false, millworkFallback, .012);
  for (const x of [1.85, 2.18, 2.62, 2.95]) box(x, .74, 3.84, .20, .025, .16, [cream, sage, wood, grey][Math.round(x * 10) % 4], false, millworkFallback, .006);
  // Kitchen counters, cream panelled doors, backsplash and wood surfaces.
  cabinet(7.55, 1.52, 2.9, .85, .6); box(7.55, .88, 1.52, 2.96, .06, .65, wood);
  // More kitchen detail: tiled backsplash, framed shelves, hood, cooktop and small accessories.
  box(7.55, 1.37, 1.18, 2.72, .78, .035, tile);
  box(6.62, 1.82, 1.13, 1.05, .035, .22, wood, false, upperDetails, .018);
  box(6.62, 1.67, 1.13, .96, .025, .025, stone, false, upperDetails, .008);
  for (const x of [6.28, 6.62, 6.96]) cylinder(x, 1.72, 1.13, .035, .12, cream, upperDetails);
  box(7.36, .96, 1.50, .86, .025, .36, black, false, upperDetails, .01);
  for (const [x, z] of [[7.18, 1.43], [7.55, 1.43], [7.18, 1.61], [7.55, 1.61]]) cylinder(x, .985, z, .07, .012, grey, upperDetails);
  box(7.55, 2.05, 1.16, .72, .08, .42, black, false, upperDetails, .02);
  box(7.55, 1.91, 1.16, .48, .05, .25, stone, false, upperDetails, .012);
  box(7.55, 2.28, 1.16, .18, .03, .18, black, false, upperDetails, .01);
  for (const x of [7.05, 7.55, 8.05]) box(x, 1.78, 1.12, .025, .025, .025, fixture, false, upperDetails, .006);
  box(6.24, .425, 2.45, .6, .85, 1.44, wood, true);
  box(6.24, .88, 2.45, .6, .06, 1.44, wood);
  box(5.96, 1.38, 2.45, .025, 1.0, 1.44, tile);
  box(6.24, 2.05, 2.45, .6, .66, 1.44, cream);
  box(6.55, 2.05, 2.45, .02, .62, 1.40, cream);
  box(6.35, .93, 2.5, .5, .035, .7, black);
  for (const z of [2.3, 2.7]) cylinder(6.35, .96, z, .115, .018, grey);
  box(7.8, .92, 1.52, .8, .025, .4, grey); box(7.8, .94, 1.52, .64, .01, .3, black);
  cylinder(8.14, 1.1, 1.45, .025, .35, cream);
  cabinet(9.32, 1.55, .8, 2.35, .65); box(9.32, 1.2, 1.9, .018, 2.1, .025, black);
  // Seats face the island from the dining side, leaving the kitchen work aisle clear.
  chair(7.78, 3.50); chair(8.47, 3.50); flowers(7.62, .92, 2.89);
  box(8.12, 2.15, 2.865, 1.35, .065, .12, fixture, false, upperDetails); for (const x of [7.62, 8.62]) box(x, 2.45, 2.865, .008, .55, .008, black, false, upperDetails);
  // Study: desk and bookcase share the south wall; the opposite wall is a continuous white wardrobe.
  box(10.72, .75, 3.76, 1.45, .06, .58, wood, true, root, .02);
  for (const x of [10.18, 11.26]) box(x, .37, 3.76, .045, .74, .40, grey);
  box(10.72, 1.23, 4.02, 1.42, .83, .035, cream, false, root, .01);
  const hole = new T.SphereGeometry(.009, 6, 4);
  const pegboard = new T.InstancedMesh(hole, black, 16 * 7);
  const offset = new T.Matrix4();
  for (let i = 0; i < 16; i++) for (let j = 0; j < 7; j++) pegboard.setMatrixAt(i * 7 + j, offset.makeTranslation(10.12 + i * .08, .94 + j * .095, 4.00));
  root.add(pegboard);
  for (const x of [10.42, 11.02]) { box(x, 1.17, 3.98, .50, .38, .04, black, false, root, .008); box(x, .91, 3.96, .04, .2, .04, grey); }
  box(10.72, .8, 4.02, .5, .025, .17, grey, false, root, .006);
  // Chair faces the desk; its back reaches the desk edge without entering the tabletop.
  chair(10.72, 3.25, .16);
  // Compact bookcase beside the desk on the same wall.
  box(12.02, 1.12, 3.92, 1.00, 2.18, .38, wood, true, root, .018);
  for (const y of [1.62, 2.08, 2.54]) {
    box(12.02, y, 3.70, .92, .035, .30, wood, false, root, .006);
    books(11.62, y, 3.70, 6);
  }
  // Opposite wall: full-height white wardrobe run.
  box(11.45, 1.08, 1.22, 2.45, 2.16, .40, wood, true, root, .018);
  for (let i = 0; i < 4; i++) {
    const x = 10.55 + i * .60;
    box(x, 1.16, 1.43, .56, 2.02, .035, cream, false, root, .008);
    box(x + .27, 1.16, 1.455, .012, .16, .012, black, false, root, .004);
  }
  box(11.45, 2.23, 1.22, 2.50, .045, .42, stone, false, root, .01);
  plant(12.62, 2.85, .65);
  // Entry storage follows the references: raised light wardrobe opposite the door;
  // wood side, open hanging niche and light doors on the left after entering.
  box(8.84, 1.24, 4.18, 1.20, 1.92, .32, wood, false, entryFallback, .025);
  box(8.50, 1.24, 4.365, .44, 1.84, .035, cream, false, entryFallback, .018);
  box(8.96, 1.24, 4.365, .44, 1.84, .035, cream, false, entryFallback, .018);
  box(8.84, .24, 4.18, 1.28, .07, .36, stone, false, entryFallback, .018);
  box(6.30, 1.10, 5.87, .31, 2.00, .34, wood, false, entryFallback, .025);
  box(6.47, 1.10, 5.87, .34, 2.00, .34, wood, false, entryFallback, .025);
  box(6.63, 1.58, 6.055, .30, 1.55, .03, cream, false, entryFallback, .006);
  box(6.63, 1.72, 6.03, .22, 1.34, .025, black, false, entryFallback, .006);
  box(6.63, .48, 5.87, .34, .64, .36, wood, false, entryFallback, .018);
  box(6.63, .84, 5.87, .42, .07, .38, stone, false, entryFallback, .018);
  box(6.84, 1.15, 5.87, .46, 2.00, .34, wood, false, entryFallback, .025);
  box(7.07, 1.24, 6.055, .40, 1.84, .035, cream, false, entryFallback, .018);
  for (const x of [6.25, 6.52, 6.79]) box(x, .64, 5.87, .025, .025, .025, fixture, false, upperDetails, .006);
  // Light stone surrounds the Blender fixtures without obscuring the cutaway.
  const wallTile = mat('#d0c9b9', { roughness: .62, ...cut });
  box(12.685, 1.3, 5.1, .025, 2.6, 1.72, wallTile);
  box(11.4, 1.3, 4.245, 2.60, 2.6, .025, wallTile);
  box(4.87, 1.3, .225, 1.70, 2.6, .025, wallTile);
  box(5.695, 1.3, 1.15, .025, 2.6, 1.80, wallTile);
  wall(5.27, 2.08, .86, .12);
  // Main bedroom: upholstered bed, wood headboard, bay seating, vanity and wardrobe.
  box(1.95, .25, 1.1, 1.8, .4, 2.1, wood, true); box(1.95, .49, 1.1, 1.83, .18, 2.13, fabric, false, root, .075);
  box(1.95, .84, .24, 1.9, .9, .15, upholstery, false, root, .065);
  for (const x of [1.48, 2.42]) box(x, .66, .55, .72, .18, .43, fabric, false, root, .08);
  box(1.95, .60, 1.43, 1.86, .09, 1.46, mat('#a69787', { map: fabric.map }), false, root, .04);
  for (const x of [.7, 3.2]) { cabinet(x, .55, .5, .53, .48); cylinder(x, 1.9, .55, .1, .08, fixture, upperDetails); box(x, 2.3, .55, .008, .7, .008, black, false, upperDetails); }
  cabinet(.49, 1.8, .55, .48, 2.0); box(.5, .53, 1.8, .57, .07, 2.0, fabric);
  cabinet(3.65, 1.2, .6, 2.5, 1.8);
  // Window-side vanity: keep its front edge clear of the wardrobe and bedroom circulation.
  box(.65, .75, 3.30, 1.05, .06, .40, wood, true, root, .018);
  // The stool follows the same wallward move, but stays just outside the tabletop edge.
  cylinder(.65, .4, 2.84, .24, .45, fabric);
  sphere(.65, 1.1, 3.50, .23, mat('#aec5c3', { metalness: .7 }), 1, 1, .05);
  for (const [x, z, intensity] of [[2.65, 5.65, 44], [7.8, 2.4, 40], [11.4, 2.4, 36], [1.95, 1.6, 37], [4.82, 1.45, 35], [11.45, 5.08, 38], [8.25, 5.35, 28]]) light(x, z, intensity);
  function setLights(on: boolean) {
    for (const lamp of lamps) lamp.visible = on;
    fixture.emissiveIntensity = on ? 2 : 0;
  }
  function setCutaway(active: boolean, showCeiling: boolean) {
    cutPlane.constant = active ? cutHeight : H + 1;
    wallTops.visible = active;
    upperDetails.visible = !active;
    ceilings.visible = !active && showCeiling;
  }
  return { root, obstacles, setCutaway, setLights, livingFallback, millworkFallback, entryFallback };
}

export function disposeObject(root: T.Object3D) {
  const materials = new Set<T.Material>(); const geometries = new Set<T.BufferGeometry>(); const textures = new Set<T.Texture>();
  root.traverse(object => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (object instanceof T.Light && 'shadow' in object) (object as T.SpotLight | T.DirectionalLight).shadow?.dispose();
    if (object instanceof T.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  for (const material of materials) { for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value); material.dispose(); }
  geometries.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}
