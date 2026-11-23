import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHome, disposeObject, type ModelLoadState } from './scene';
import { canWalk, CEILING_HEIGHT, HOME_DEPTH, HOME_WIDTH, viewpoints } from './plan';

export type ViewerMode = 'walk' | 'orbit';
export type ViewerStatus = { mode: ViewerMode; position: [number, number]; heading: number; modelState?: ModelLoadState };
export function createViewer(host: HTMLElement, onStatus: (value: ViewerStatus) => void) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', '可移动三维户型，拖动查看，WASD 或方向键行走');
  host.append(renderer.domElement);
  const scene = new T.Scene();
  const sky = new T.Color();
  const studio = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, .08);
  scene.environment = environment.texture;
  studio.dispose(); pmrem.dispose();
  const ambient = new T.HemisphereLight('#d4e4ff', '#797069', 1); scene.add(ambient);
  const sun = new T.DirectionalLight('#f1f5ff', 1.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: .5, far: 30 });
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .025; sun.shadow.radius = 3; scene.add(sun, sun.target);
  let needsRender = true;
  function invalidate() { needsRender = true; }
  let modelState: ModelLoadState = 'loading';
  const home = buildHome(invalidate, state => { modelState = state; renderer.shadowMap.needsUpdate = true; invalidate(); }); scene.add(home.root);
  const ground = new T.Mesh(new T.PlaneGeometry(100, 100), new T.MeshStandardMaterial({ color: '#9da5a7', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.195; ground.receiveShadow = true; scene.add(ground);
  const camera = new T.PerspectiveCamera(75, 1, .04, 150);
  const overview = new T.OrthographicCamera(-1, 1, 1, -1, .1, 120);
  const orbit = new OrbitControls(overview, renderer.domElement);
  orbit.enableDamping = true; orbit.minZoom = .5; orbit.maxZoom = 3;
  orbit.minPolarAngle = .08; orbit.maxPolarAngle = Math.PI / 2 - .12;
  orbit.addEventListener('change', invalidate);
  const homeBounds = new T.Box3(new T.Vector3(0, -.19, 0), new T.Vector3(HOME_WIDTH, CEILING_HEIGHT, HOME_DEPTH));
  let fitWidth = 1; let fitHeight = 1;
  let mode: ViewerMode = 'orbit'; let yaw = 0; let pitch = 0; let night = false; let roof = true;
  let imported: T.Group | undefined; let importedBounds: T.Box3 | undefined; let disposed = false; let active = true; let importVersion = 0;
  let frame = 0; let lastTime = performance.now(); let reportAt = 0; let pointer: { id: number; x: number; y: number } | undefined;
  const keys = new Set<string>(); const held = new Set<string>(); const direction = new T.Vector3();
  const raycaster = new T.Raycaster();
  function updatePresentation() {
    const cutaway = mode === 'orbit';
    home.setCutaway(cutaway, roof);
    ground.visible = !cutaway;
    sun.target.position.copy((importedBounds ?? homeBounds).getCenter(new T.Vector3()));
    sun.position.copy(sun.target.position).add(new T.Vector3(-5.45, 9, 6.25));
    scene.background = cutaway ? null : sky.set(night ? '#17263a' : '#c6d6e5');
    ambient.color.set(night ? '#8ab7ff' : '#fff4e2');
    ambient.groundColor.set(night ? '#797069' : '#bdb7aa');
    ambient.intensity = night ? .37 : cutaway ? .95 : 1.6;
    sun.color.set(night ? '#7ba8ff' : '#fff1da');
    sun.intensity = night ? .34 : 1.3;
    scene.environmentIntensity = night ? .09 : .23;
    renderer.toneMappingExposure = night ? .95 : 1;
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }
  function fitOverview() {
    const bounds = importedBounds ?? homeBounds;
    const center = bounds.getCenter(new T.Vector3());
    const size = bounds.getSize(new T.Vector3());
    orbit.target.copy(center);
    const distance = size.length() * 1.5;
    overview.position.copy(center).addScaledVector(new T.Vector3(.15, 1.55, 1).normalize(), distance);
    overview.far = Math.max(120, distance * 3);
    overview.zoom = 1;
    overview.lookAt(center);
    overview.updateMatrixWorld();
    // Fit the box in camera space before setting the viewport-dependent frustum.
    const projected = bounds.clone().applyMatrix4(overview.matrixWorldInverse).getSize(new T.Vector3());
    fitWidth = projected.x; fitHeight = projected.y;
    resize();
    orbit.update();
  }
  function orient() { camera.rotation.order = 'YXZ'; camera.rotation.set(pitch, yaw, 0); invalidate(); }
  function walkAt(position: T.Vector3, target: T.Vector3) {
    mode = 'walk'; orbit.enabled = false; camera.position.copy(position); camera.lookAt(target);
    const euler = new T.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); yaw = euler.y; pitch = euler.x; orient();
    updatePresentation(); report();
  }
  let previousStatus: ViewerStatus | undefined;
  function report() {
    if (previousStatus?.modelState === modelState && previousStatus?.mode === mode && (mode === 'orbit' ||
        (previousStatus.position[0] === camera.position.x && previousStatus.position[1] === camera.position.z && previousStatus.heading === yaw))) return;
    previousStatus = { mode, position: [camera.position.x, camera.position.z], heading: yaw, modelState };
    onStatus(previousStatus);
  }
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
      mode = 'orbit'; orbit.enabled = true;
      fitOverview(); updatePresentation(); report();
    }
  }
  function move(dx: number, dz: number) {
    if (!dx && !dz) return;
    const { x: startX, z: startZ } = camera.position;
    if (imported && importedBounds) {
      direction.set(dx, 0, dz); const distance = direction.length(); direction.normalize();
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
    if (camera.position.x !== startX || camera.position.z !== startZ) invalidate();
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
  function wheel(event: WheelEvent) { if (mode === 'walk') { event.preventDefault(); camera.fov = T.MathUtils.clamp(camera.fov + event.deltaY * .025, 40, 85); camera.updateProjectionMatrix(); invalidate(); } }
  const canvas = renderer.domElement;
  canvas.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear); canvas.addEventListener('blur', clear);
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', drag); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', clear); canvas.addEventListener('wheel', wheel, { passive: false });
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    renderer.setSize(width, height);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    const halfHeight = Math.max(fitHeight, fitWidth / aspect) * .59;
    overview.left = -halfHeight * aspect; overview.right = -overview.left;
    overview.bottom = -halfHeight; overview.top = halfHeight;
    overview.updateProjectionMatrix();
    invalidate();
  }
  const observer = new ResizeObserver(resize); observer.observe(host); setMode('orbit');
  function tick(time: number) {
    if (disposed || !active) return;
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
    if (needsRender) {
      needsRender = false;
      renderer.render(scene, mode === 'walk' ? camera : overview);
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  return {
    view, setMode, step,
    reloadModel() { home.reload(); report(); },
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value; clear(); orbit.enabled = active && mode === 'orbit';
      cancelAnimationFrame(frame);
      if (active) { lastTime = performance.now(); resize(); invalidate(); frame = requestAnimationFrame(tick); }
    },
    focus() { canvas.focus(); },
    hold(key: string, active: boolean) { if (active) held.add(key); else held.delete(key); },
    setNight(value: boolean) { night = value; updatePresentation(); },
    setLights(value: boolean) { home.setLights(value); renderer.shadowMap.needsUpdate = true; invalidate(); },
    setRoof(value: boolean) { roof = value; updatePresentation(); },
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
      const size = bounds.getSize(new T.Vector3()); const scale = Math.max(HOME_WIDTH, HOME_DEPTH) / Math.max(size.x, size.z, .01);
      gltf.scene.scale.multiplyScalar(scale);
      bounds.setFromObject(gltf.scene); gltf.scene.position.sub(new T.Vector3(bounds.min.x, bounds.min.y, bounds.min.z));
      if (imported) { scene.remove(imported); disposeObject(imported); }
      imported = gltf.scene; imported.traverse(object => { if (object instanceof T.Mesh) object.castShadow = object.receiveShadow = true; });
      scene.add(imported); home.root.visible = false; importedBounds = new T.Box3().setFromObject(imported); setMode('orbit');
    },
    resetModel() { importVersion++; if (imported) { scene.remove(imported); disposeObject(imported); imported = undefined; } importedBounds = undefined; home.root.visible = true; setMode('orbit'); },
    dispose() {
      disposed = true; importVersion++; home.dispose(); cancelAnimationFrame(frame); observer.disconnect(); orbit.removeEventListener('change', invalidate); orbit.dispose();
      canvas.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); canvas.removeEventListener('blur', clear);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', drag); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', clear); canvas.removeEventListener('wheel', wheel);
      disposeObject(scene); environment.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}
export type Viewer = ReturnType<typeof createViewer>;
