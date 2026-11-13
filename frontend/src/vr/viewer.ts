import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHome, disposeObject } from './scene';
import { canWalk, viewpoints } from './plan';

export type ViewerMode = 'walk' | 'orbit';
export type ViewerStatus = { mode: ViewerMode; position: [number, number]; heading: number };
export function createViewer(host: HTMLElement, onStatus: (value: ViewerStatus) => void) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6)); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', '可移动三维户型，拖动查看，WASD 或方向键行走');
  host.append(renderer.domElement);
  const scene = new T.Scene(); scene.background = new T.Color('#d8e2e1');
  const ambient = new T.HemisphereLight('#fff5df', '#8b8174', 2.2); scene.add(ambient);
  const sun = new T.DirectionalLight('#fff3d7', 3.2); sun.position.set(-4, 9, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: .5, far: 40 }); sun.shadow.bias = -.0005; scene.add(sun);
  const home = buildHome(); scene.add(home.root);
  const ground = new T.Mesh(new T.PlaneGeometry(100, 100), new T.MeshStandardMaterial({ color: '#b5b9ae', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.12; ground.receiveShadow = true; scene.add(ground);
  const camera = new T.PerspectiveCamera(65, 1, .04, 150);
  const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true; orbit.enabled = false; orbit.minDistance = 2; orbit.maxDistance = 28; orbit.maxPolarAngle = Math.PI / 2 - .02;
  let mode: ViewerMode = 'walk'; let yaw = 0; let pitch = 0; let night = false; let roof = true;
  let imported: T.Group | undefined; let importedBounds: T.Box3 | undefined; let disposed = false; let importVersion = 0;
  let frame = 0; let lastTime = performance.now(); let reportAt = 0; let pointer: { id: number; x: number; y: number } | undefined;
  const keys = new Set<string>(); const held = new Set<string>(); const direction = new T.Vector3();
  const raycaster = new T.Raycaster();
  function orient() { camera.rotation.order = 'YXZ'; camera.rotation.set(pitch, yaw, 0); }
  function walkAt(position: T.Vector3, target: T.Vector3) {
    mode = 'walk'; orbit.enabled = false; camera.position.copy(position); camera.lookAt(target);
    const euler = new T.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); yaw = euler.y; pitch = euler.x; orient();
    home.ceilings.visible = roof; report();
  }
  function report() { onStatus({ mode, position: [camera.position.x, camera.position.z], heading: yaw }); }
  function view(id: string) {
    if (imported) { setMode('orbit'); return; }
    const point = viewpoints.find(point => point.id === id) ?? viewpoints[0];
    walkAt(new T.Vector3(...point.position), new T.Vector3(...point.target));
  }
  function setMode(value: ViewerMode) {
    keys.clear(); held.clear();
    if (value === 'walk') {
      if (importedBounds) {
        const center = importedBounds.getCenter(new T.Vector3());
        walkAt(new T.Vector3(center.x, 1.62, importedBounds.max.z - .6), new T.Vector3(center.x, 1.4, center.z));
      } else view('entry');
    } else {
      mode = 'orbit'; orbit.enabled = true; home.ceilings.visible = false;
      const center = importedBounds?.getCenter(new T.Vector3()) ?? new T.Vector3(6.4, 0, 3.7);
      orbit.target.set(center.x, .6, center.z); camera.position.set(center.x + 5, 8, center.z + 7); orbit.update(); report();
    }
  }
  function move(dx: number, dz: number) {
    if (imported && importedBounds) {
      direction.set(dx, 0, dz); const distance = direction.length(); if (!distance) return; direction.normalize();
      for (const height of [.45, 1.3]) {
        raycaster.set(new T.Vector3(camera.position.x, height, camera.position.z), direction); raycaster.far = distance + .2;
        if (raycaster.intersectObject(imported, true).length) return;
      }
      const x = camera.position.x + dx, z = camera.position.z + dz;
      if (x > importedBounds.min.x + .2 && x < importedBounds.max.x - .2 && z > importedBounds.min.z + .2 && z < importedBounds.max.z - .2) camera.position.set(x, 1.62, z);
    } else {
      if (canWalk(camera.position.x + dx, camera.position.z, home.obstacles)) camera.position.x += dx;
      if (canWalk(camera.position.x, camera.position.z + dz, home.obstacles)) camera.position.z += dz;
    }
  }
  function step(key: string, distance = .12) {
    if (mode !== 'walk') return;
    const forward = ['KeyW', 'ArrowUp'].includes(key) ? 1 : ['KeyS', 'ArrowDown'].includes(key) ? -1 : 0;
    const sideways = ['KeyD', 'ArrowRight'].includes(key) ? 1 : ['KeyA', 'ArrowLeft'].includes(key) ? -1 : 0;
    move((-Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * distance, (-Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * distance);
    report();
  }
  const handled = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
  function keydown(event: KeyboardEvent) { if (mode !== 'walk' || !handled.includes(event.code)) return; event.preventDefault(); if (!event.repeat) step(event.code); keys.add(event.code); }
  function clear() { keys.clear(); held.clear(); pointer = undefined; }
  function keyup(event: KeyboardEvent) { keys.delete(event.code); }
  function down(event: PointerEvent) { if (mode !== 'walk' || event.button !== 0) return; renderer.domElement.focus(); pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); }
  function drag(event: PointerEvent) {
    if (!pointer || mode !== 'walk' || pointer.id !== event.pointerId) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    // Screen coordinates account for the shared layout's CSS scale.
    yaw -= (event.clientX - pointer.x) / Math.max(bounds.width, 1) * 3.2;
    pitch = T.MathUtils.clamp(pitch - (event.clientY - pointer.y) / Math.max(bounds.height, 1) * 2, -1.2, 1.2);
    pointer.x = event.clientX; pointer.y = event.clientY; orient();
  }
  function up(event: PointerEvent) { if (pointer?.id === event.pointerId) pointer = undefined; }
  function wheel(event: WheelEvent) { if (mode === 'walk') { event.preventDefault(); camera.fov = T.MathUtils.clamp(camera.fov + event.deltaY * .025, 40, 85); camera.updateProjectionMatrix(); } }
  const canvas = renderer.domElement;
  canvas.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear); canvas.addEventListener('blur', clear);
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', drag); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', clear); canvas.addEventListener('wheel', wheel, { passive: false });
  function resize() { const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  const observer = new ResizeObserver(resize); observer.observe(host); resize(); view('entry');
  function tick(time: number) {
    if (disposed) return;
    const dt = Math.min((time - lastTime) / 1000, .05); lastTime = time;
    if (mode === 'walk') {
      const pressed = (name: string) => keys.has(name) || held.has(name);
      const forward = Number(pressed('KeyW') || pressed('ArrowUp')) - Number(pressed('KeyS') || pressed('ArrowDown'));
      const sideways = Number(pressed('KeyD') || pressed('ArrowRight')) - Number(pressed('KeyA') || pressed('ArrowLeft'));
      const length = Math.hypot(forward, sideways) || 1;
      const speed = (pressed('ShiftLeft') || pressed('ShiftRight') ? 2.8 : 1.5) * dt / length;
      move((-Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * speed, (-Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * speed);
    } else orbit.update();
    if (time - reportAt > 140) { report(); reportAt = time; }
    renderer.render(scene, camera); frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  return {
    view, setMode, step,
    focus() { canvas.focus(); },
    hold(key: string, active: boolean) { if (active) held.add(key); else held.delete(key); },
    setNight(value: boolean) { night = value; ambient.intensity = night ? .2 : 2.2; sun.intensity = night ? .15 : 3.2; scene.background = new T.Color(night ? '#18222e' : '#d8e2e1'); renderer.toneMappingExposure = night ? .8 : 1.2; },
    setLights(value: boolean) { home.setLights(value); },
    setRoof(value: boolean) { roof = value; home.ceilings.visible = mode === 'walk' && roof; },
    async importModel(file: File) {
      if (file.size > 100 * 1024 * 1024) throw new Error('模型超过 100 MB，请先压缩或简化。');
      const version = ++importVersion;
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength < 12 || new DataView(buffer).getUint32(0, true) !== 0x46546c67) throw new Error('请选择包含贴图的 GLB 三维模型。');
      const manager = new T.LoadingManager(); manager.setURLModifier(url => { if (url.startsWith('blob:') || url.startsWith('data:')) return url; throw new Error('模型含外部资源，请导出为贴图内嵌的 GLB。'); });
      const loader = new GLTFLoader(manager);
      const gltf = await loader.parseAsync(buffer, '');
      if (disposed || version !== importVersion) { disposeObject(gltf.scene); return; }
      const bounds = new T.Box3().setFromObject(gltf.scene);
      if (bounds.isEmpty() || !Number.isFinite(bounds.max.x)) { disposeObject(gltf.scene); throw new Error('模型没有可显示的三维几何。'); }
      const size = bounds.getSize(new T.Vector3()); const scale = 12.91 / Math.max(size.x, size.z, .01);
      gltf.scene.scale.multiplyScalar(scale);
      bounds.setFromObject(gltf.scene); gltf.scene.position.sub(new T.Vector3(bounds.min.x, bounds.min.y, bounds.min.z));
      if (imported) { scene.remove(imported); disposeObject(imported); }
      imported = gltf.scene; imported.traverse(object => { if (object instanceof T.Mesh) object.castShadow = object.receiveShadow = true; });
      scene.add(imported); home.root.visible = false; importedBounds = new T.Box3().setFromObject(imported); setMode('orbit');
    },
    resetModel() { importVersion++; if (imported) { scene.remove(imported); disposeObject(imported); imported = undefined; } importedBounds = undefined; home.root.visible = true; view('entry'); },
    dispose() {
      disposed = true; importVersion++; cancelAnimationFrame(frame); observer.disconnect(); orbit.dispose();
      canvas.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); canvas.removeEventListener('blur', clear);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', drag); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', clear); canvas.removeEventListener('wheel', wheel);
      disposeObject(scene); renderer.dispose(); canvas.remove();
    },
  };
}
export type Viewer = ReturnType<typeof createViewer>;
