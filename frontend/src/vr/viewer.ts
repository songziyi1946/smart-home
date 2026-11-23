import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHome, disposeObject, type ModelLoadState } from './scene';
import { CEILING_HEIGHT, designModel, HOME_DEPTH, HOME_WIDTH } from './plan';
import { isRoomClick, modelRoomAt, type RoomSummary } from './room-state';

export type ViewerStatus = { roomId?: string; modelState: ModelLoadState };
export function createViewer(host: HTMLElement, onStatus: (value: ViewerStatus) => void, onRoomSelect?: (id: string) => void) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '三维户型，选择房间查看设备');
  host.append(canvas);
  const labels = document.createElement('div'); labels.className = 'vr-model-labels';
  labels.setAttribute('role', 'group'); labels.setAttribute('aria-label', '模型房间'); host.append(labels);
  const scene = new T.Scene();
  const studio = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, .08);
  scene.environment = environment.texture; scene.environmentIntensity = .23; studio.dispose(); pmrem.dispose();
  const ambient = new T.HemisphereLight('#fff4e2', '#bdb7aa', .95); scene.add(ambient);
  const sun = new T.DirectionalLight('#fff1da', 1.3); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: .5, far: 30 });
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .025; sun.shadow.radius = 3; scene.add(sun, sun.target);
  let needsRender = true, disposed = false, active = true, frame = 0, importVersion = 0;
  let modelState: ModelLoadState = 'loading', roomId: string | undefined;
  let imported: T.Group | undefined, importedBounds: T.Box3 | undefined;
  const invalidate = () => { needsRender = true; };
  const report = () => onStatus({ roomId, modelState });
  const home = buildHome(invalidate, state => { modelState = state; renderer.shadowMap.needsUpdate = true; invalidate(); report(); }); scene.add(home.root);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 120);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true; orbit.enablePan = false; orbit.minZoom = .6; orbit.maxZoom = 3;
  orbit.minPolarAngle = .2; orbit.maxPolarAngle = Math.PI / 2 - .3;
  orbit.addEventListener('change', invalidate);
  const bounds = new T.Box3(new T.Vector3(0, -.19, 0), new T.Vector3(HOME_WIDTH, CEILING_HEIGHT, HOME_DEPTH));
  const raycaster = new T.Raycaster(), floor = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let halfHeight = 1;
  let transition: { start: number; from: T.Vector3; to: T.Vector3; fromTarget: T.Vector3; toTarget: T.Vector3; fromHeight: number; toHeight: number } | undefined;
  let pointer: { id: number; x: number; y: number; moved: boolean } | undefined;
  let touchCount = 0;
  const markers = designModel.rooms.map(room => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'vr-model-room';
    const title = document.createElement('strong'); title.textContent = room.name;
    const detail = document.createElement('small'); detail.textContent = '暂无设备'; button.append(title, detail);
    button.addEventListener('click', () => selectRoom(room.id)); labels.append(button);
    return { room, button, detail, position: new T.Vector3((room.bounds[0] + room.bounds[2]) / 2, 1.25, (room.bounds[1] + room.bounds[3]) / 2) };
  });
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.left = -halfHeight * width / height; camera.right = -camera.left;
    camera.bottom = -halfHeight; camera.top = halfHeight; camera.updateProjectionMatrix(); invalidate();
  }
  function fitHeight(box: T.Box3, position: T.Vector3, target: T.Vector3) {
    const fitting = camera.clone(); fitting.position.copy(position); fitting.lookAt(target); fitting.updateMatrixWorld();
    const size = box.clone().applyMatrix4(fitting.matrixWorldInverse).getSize(new T.Vector3());
    return Math.max(size.y, size.x / Math.max(host.clientWidth / Math.max(host.clientHeight, 1), .1)) * .65;
  }
  function framingBounds(id?: string) {
    const room = !imported && designModel.rooms.find(value => value.id === id);
    return room ? new T.Box3(new T.Vector3(room.bounds[0] - .25, 0, room.bounds[1] - .25), new T.Vector3(room.bounds[2] + .25, CEILING_HEIGHT, room.bounds[3] + .25)) : importedBounds ?? bounds;
  }
  function showRoom(id?: string, animate = true) {
    const room = !imported && designModel.rooms.find(value => value.id === id);
    roomId = room ? room.id : undefined;
    const box = framingBounds(roomId);
    const target = box.getCenter(new T.Vector3());
    const direction = room ? new T.Vector3(target.x - HOME_WIDTH / 2, 0, target.z - HOME_DEPTH / 2).normalize() : new T.Vector3(.15, 0, 1).normalize();
    direction.y = 1.55; direction.normalize();
    const distance = (importedBounds ?? bounds).getSize(new T.Vector3()).length() * 1.5;
    const to = target.clone().addScaledVector(direction, distance);
    camera.far = Math.max(120, distance * 3);
    const toHeight = fitHeight(box, to, target);
    const fromHeight = halfHeight / camera.zoom;
    camera.zoom = 1;
    if (animate && !reducedMotion.matches) {
      transition = { start: performance.now(), from: camera.position.clone(), to, fromTarget: orbit.target.clone(), toTarget: target, fromHeight, toHeight };
      orbit.enabled = false;
    } else {
      transition = undefined; camera.position.copy(to); orbit.target.copy(target); halfHeight = toHeight;
      camera.lookAt(target); orbit.enabled = active; orbit.update(); resize();
    }
    home.selectRoom(roomId);
    sun.target.position.copy((importedBounds ?? bounds).getCenter(new T.Vector3()));
    sun.position.copy(sun.target.position).add(new T.Vector3(-5.45, 9, 6.25));
    renderer.shadowMap.needsUpdate = true;
    for (const marker of markers) marker.button.setAttribute('aria-pressed', String(marker.room.id === roomId));
    report(); invalidate();
  }
  function selectRoom(id: string) {
    if (imported) return;
    if (onRoomSelect) onRoomSelect(id); else showRoom(id);
  }
  function stopTransition() {
    if (!transition) return;
    transition = undefined; orbit.enabled = active; orbit.update(); invalidate();
  }
  function down(event: PointerEvent) {
    if (event.pointerType === 'touch') touchCount++;
    if (pointer || touchCount > 1) { if (pointer) pointer.moved = true; return; }
    if (event.button !== 0) return;
    stopTransition(); pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }
  function move(event: PointerEvent) {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.moved = true;
  }
  function up(event: PointerEvent) {
    if (event.pointerType === 'touch') touchCount = Math.max(0, touchCount - 1);
    const start = pointer; if (start?.id !== event.pointerId) return; pointer = undefined;
    if (imported || modelState !== 'ready' || !isRoomClick(start, { x: event.clientX, y: event.clientY })) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObject(home.root, true).find(value => value.object.visible && value.point.y <= 1.25);
    const point = hit?.point ?? raycaster.ray.intersectPlane(floor, new T.Vector3());
    const room = point && modelRoomAt(point.x, point.z); if (room) selectRoom(room.id);
  }
  function clear() { pointer = undefined; touchCount = 0; }
  function cancel() { if (pointer) pointer.moved = true; clear(); }
  function keyboard(event: KeyboardEvent) { if (event.key === 'Escape' || event.key === 'Home') { event.preventDefault(); if (onRoomSelect) onRoomSelect(''); else showRoom(); } }
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', clear);
  canvas.addEventListener('keydown', keyboard); canvas.addEventListener('wheel', stopTransition, { passive: true });
  const observer = new ResizeObserver(() => {
    if (transition) { transition.toHeight = fitHeight(framingBounds(roomId), transition.to, transition.toTarget); resize(); }
    else showRoom(roomId, false);
  });
  observer.observe(host);
  function tick(time: number) {
    if (disposed || !active) return;
    if (transition) {
      const t = Math.min(1, (time - transition.start) / 650), eased = t * t * (3 - 2 * t);
      camera.position.lerpVectors(transition.from, transition.to, eased); orbit.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
      halfHeight = T.MathUtils.lerp(transition.fromHeight, transition.toHeight, eased); camera.lookAt(orbit.target); resize();
      if (t === 1) { transition = undefined; orbit.enabled = true; orbit.update(); }
    } else orbit.update();
    if (needsRender) {
      needsRender = false; camera.updateMatrixWorld();
      for (const marker of markers) {
        const point = marker.position.clone().project(camera);
        marker.button.hidden = !!imported || modelState !== 'ready' || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
        marker.button.style.left = `${(point.x + 1) * 50}%`; marker.button.style.top = `${(1 - point.y) * 50}%`;
        marker.button.classList.toggle('is-muted', !!roomId && marker.room.id !== roomId);
      }
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(tick);
  }
  showRoom(undefined, false); frame = requestAnimationFrame(tick);
  return {
    view: (id: string) => showRoom(id),
    overview: () => showRoom(),
    reloadModel() { home.reload(); report(); },
    setRoomStates(summaries: RoomSummary[], live = true) {
      home.setRoomStates(summaries);
      for (const marker of markers) {
        const summary = summaries.find(value => value.id === marker.room.id);
        marker.detail.textContent = !summary?.total ? '暂无设备' : `${summary.running} 运行 · ${summary.offline ? summary.offline + ' 离线' : summary.total + ' 设备'}${summary.simulated ? ' · 模拟' : ''}${!live ? ' · 缓存' : ''}`;
        marker.button.classList.toggle('has-warning', !!summary?.offline);
        marker.button.setAttribute('aria-label', `${marker.room.name}，${marker.detail.textContent}，查看房间设备`);
      }
      renderer.shadowMap.needsUpdate = true; invalidate();
    },
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value; clear(); cancelAnimationFrame(frame); orbit.enabled = active && !transition;
      if (active) { if (transition) showRoom(roomId, false); resize(); invalidate(); frame = requestAnimationFrame(tick); }
    },
    setNight(night: boolean) {
      ambient.color.set(night ? '#adc8ff' : '#fff4e2'); ambient.intensity = night ? .7 : .95;
      sun.color.set(night ? '#b0c8ed' : '#fff1da'); sun.intensity = night ? .7 : 1.3; scene.environmentIntensity = night ? .15 : .23;
      renderer.shadowMap.needsUpdate = true; invalidate();
    },
    async importModel(file: File) {
      if (file.size > 100 * 1024 * 1024) throw new Error('模型超过 100 MB，请先压缩或简化。');
      const version = ++importVersion, buffer = await file.arrayBuffer();
      if (buffer.byteLength < 12 || new DataView(buffer).getUint32(0, true) !== 0x46546c67) throw new Error('请选择包含贴图的 GLB 三维模型。');
      const manager = new T.LoadingManager(); manager.setURLModifier(url => { if (url.startsWith('blob:') || url.startsWith('data:')) return url; throw new Error('模型含外部资源，请导出为贴图内嵌的 GLB。'); });
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, '');
      if (disposed || version !== importVersion) { disposeObject(gltf.scene); return; }
      const box = new T.Box3().setFromObject(gltf.scene);
      if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) { disposeObject(gltf.scene); throw new Error('模型没有可显示的三维几何。'); }
      const size = box.getSize(new T.Vector3()); gltf.scene.scale.multiplyScalar(Math.max(HOME_WIDTH, HOME_DEPTH) / Math.max(size.x, size.z, .01));
      box.setFromObject(gltf.scene); gltf.scene.position.sub(box.min);
      if (imported) { scene.remove(imported); disposeObject(imported); }
      imported = gltf.scene; imported.traverse(object => { if (object instanceof T.Mesh) object.castShadow = object.receiveShadow = true; });
      scene.add(imported); home.root.visible = false; importedBounds = new T.Box3().setFromObject(imported); showRoom();
    },
    resetModel() { importVersion++; if (imported) { scene.remove(imported); disposeObject(imported); imported = undefined; } importedBounds = undefined; home.root.visible = true; showRoom(); },
    dispose() {
      disposed = true; importVersion++; home.dispose(); cancelAnimationFrame(frame); observer.disconnect(); orbit.removeEventListener('change', invalidate); orbit.dispose();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', clear); canvas.removeEventListener('keydown', keyboard); canvas.removeEventListener('wheel', stopTransition);
      disposeObject(scene); environment.dispose(); renderer.dispose(); canvas.remove(); labels.remove();
    },
  };
}
export type Viewer = ReturnType<typeof createViewer>;
