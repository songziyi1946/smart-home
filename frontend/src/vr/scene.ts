import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from './models/panorama-home.glb?url';
import { CEILING_HEIGHT, designModel, footprint, obstacles, wallFootprints } from './plan';

export type ModelLoadState = 'loading' | 'ready' | 'error';

export function buildHome(invalidate: () => void, onLoadState: (state: ModelLoadState) => void) {
  const root = new T.Group();
  const fallback = new T.Group();
  const wallTops = new T.Group();
  root.add(fallback, wallTops);
  const cutHeight = 1.22;
  const cutPlane = new T.Plane(new T.Vector3(0, -1, 0), cutHeight);
  const placeholder = new T.MeshStandardMaterial({ color: '#e1dcd1', roughness: .85, clippingPlanes: [cutPlane] });
  const capMaterial = new T.MeshStandardMaterial({ color: '#b8afa0', roughness: .9 });
  const shape = new T.Shape(footprint.map(([x, z]) => new T.Vector2(x, -z)));
  const slab = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: .15, bevelEnabled: false }), new T.MeshStandardMaterial({ color: '#d9d4c9' }));
  slab.rotation.x = -Math.PI / 2; slab.position.y = -.15; fallback.add(slab);
  for (const wall of wallFootprints) {
    const width = wall.maxX - wall.minX, depth = wall.maxZ - wall.minZ;
    const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2;
    const mesh = new T.Mesh(new T.BoxGeometry(width, CEILING_HEIGHT, depth), placeholder);
    mesh.position.set(x, CEILING_HEIGHT / 2, z); fallback.add(mesh);
    const cap = new T.Mesh(new T.BoxGeometry(width, .015, depth), capMaterial);
    cap.position.set(x, cutHeight, z); wallTops.add(cap);
  }
  const lamps: T.SpotLight[] = [];
  for (const room of designModel.rooms) {
    const [x0, z0, x1, z1] = room.bounds;
    const light = new T.SpotLight('#ffecd0', 25, 7, 1.1, .6, 1.4);
    light.position.set((x0 + x1) / 2, CEILING_HEIGHT - .15, (z0 + z1) / 2);
    light.target.position.set(light.position.x, 0, light.position.z);
    root.add(light, light.target); lamps.push(light);
  }
  let model: T.Group | undefined;
  let disposed = false, generation = 0, cutaway = true, roof = true, lights = true;
  const glowMaterials = new Map<T.MeshStandardMaterial, number>();
  function presentation() {
    cutPlane.constant = cutaway ? cutHeight : CEILING_HEIGHT + 1;
    wallTops.visible = cutaway;
    model?.traverse(object => {
      if (object.userData.presentation === 'ceiling') object.visible = !cutaway && roof;
      if (object.userData.presentation === 'overhead') object.visible = !cutaway;
    });
    for (const lamp of lamps) lamp.visible = lights;
    for (const [material, intensity] of glowMaterials) material.emissiveIntensity = lights ? intensity : 0;
    invalidate();
  }
  function load() {
    if (disposed) return;
    const version = ++generation;
    onLoadState('loading');
    new GLTFLoader().load(modelUrl, ({ scene: loaded }) => {
      if (disposed || generation !== version) { disposeObject(loaded); return; }
      if (model) { root.remove(model); disposeObject(model); }
      glowMaterials.clear();
      model = loaded;
      model.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        // Shared GLB materials must not clip furniture when a wall uses the same finish.
        if (object.userData.presentation === 'wall') {
          const clip = (material: T.Material) => {
            const copy = material.clone(); copy.clippingPlanes = [cutPlane]; copy.clipShadows = true; return copy;
          };
          object.material = Array.isArray(object.material) ? object.material.map(clip) : clip(object.material);
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        object.castShadow = materials.every(material => !material.transparent);
        object.receiveShadow = true;
        for (const material of materials) {
          if (material.transparent) material.depthWrite = false;
          if (material instanceof T.MeshStandardMaterial && material.name.startsWith('Glow_')) glowMaterials.set(material, material.emissiveIntensity);
        }
      });
      root.add(model); fallback.visible = false; presentation(); onLoadState('ready');
    }, undefined, () => {
      if (!disposed && generation === version) { onLoadState('error'); invalidate(); }
    });
  }
  load();
  return {
    root, obstacles, reload: load,
    setLights(value: boolean) { lights = value; presentation(); },
    setCutaway(value: boolean, showCeiling: boolean) { cutaway = value; roof = showCeiling; presentation(); },
    dispose() { disposed = true; generation++; glowMaterials.clear(); },
  };
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
