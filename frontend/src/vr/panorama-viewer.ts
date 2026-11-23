import * as T from 'three';
import { panoramaFaces, type PanoramaScene } from './panoramas';

export type PanoramaStatus = 'loading' | 'ready' | 'error';

// Own the pending/visible textures together so a late room load cannot replace a newer room.
export function createPanoramaTextures(
  apply: (texture: T.CubeTexture | null) => void,
  onStatus: (status: PanoramaStatus) => void,
  loader = new T.CubeTextureLoader(),
) {
  let generation = 0;
  let disposed = false;
  let current: T.CubeTexture | undefined;
  let pending: T.CubeTexture | undefined;
  return {
    load(scene: PanoramaScene) {
      if (disposed) return;
      const version = ++generation;
      apply(null);
      current?.dispose(); pending?.dispose(); current = undefined; pending = undefined;
      onStatus('loading');
      const texture = loader.load(panoramaFaces(scene), loaded => {
        if (disposed || version !== generation) { loaded.dispose(); return; }
        pending = undefined; current = loaded;
        apply(loaded); onStatus('ready');
      }, undefined, () => {
        texture.dispose();
        if (disposed || version !== generation) return;
        generation++; pending = undefined; onStatus('error');
      });
      texture.colorSpace = T.SRGBColorSpace;
      pending = texture;
    },
    dispose() {
      disposed = true; generation++;
      apply(null); current?.dispose(); pending?.dispose(); current = pending = undefined;
    },
  };
}

export function createPanoramaViewer(host: HTMLElement, onStatus: (status: PanoramaStatus) => void) {
  const renderer = new T.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = T.SRGBColorSpace;
  // These are finished renders, so do not apply the model viewer's lights or tone mapping.
  renderer.toneMapping = T.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '设计全景，拖动或方向键环顾，滚轮或加减键缩放');
  host.append(canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(75, 1, .1, 10);
  let yaw = 0, pitch = 0, frame = 0, disposed = false;
  let pointer: { id: number; x: number; y: number } | undefined;
  function render() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed) renderer.render(scene, camera);
    });
  }
  function orient() {
    pitch = T.MathUtils.clamp(pitch, -Math.PI / 2 + .01, Math.PI / 2 - .01);
    camera.lookAt(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    render();
  }
  function zoom(delta: number) {
    camera.fov = T.MathUtils.clamp(camera.fov + delta, 40, 100);
    camera.updateProjectionMatrix(); render();
  }
  function reset() { yaw = pitch = 0; camera.fov = 75; camera.updateProjectionMatrix(); orient(); }
  function down(event: PointerEvent) {
    if (event.button !== 0 || pointer) return;
    canvas.focus(); pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const bounds = canvas.getBoundingClientRect();
    yaw -= (event.clientX - pointer.x) / Math.max(bounds.width, 1) * 3.2;
    pitch += (event.clientY - pointer.y) / Math.max(bounds.height, 1) * 2;
    pointer.x = event.clientX; pointer.y = event.clientY; orient();
  }
  function up(event: PointerEvent) { if (pointer?.id === event.pointerId) pointer = undefined; }
  function wheel(event: WheelEvent) { event.preventDefault(); zoom(event.deltaY * .025); }
  function keydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { reset(); return; }
    if (['+', '=', '-'].includes(event.key)) { zoom(event.key === '-' ? 5 : -5); return; }
    yaw += event.key === 'ArrowRight' ? .1 : event.key === 'ArrowLeft' ? -.1 : 0;
    pitch += event.key === 'ArrowUp' ? .1 : event.key === 'ArrowDown' ? -.1 : 0;
    orient();
  }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
  }
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', keydown);
  const observer = new ResizeObserver(resize); observer.observe(host);
  const textures = createPanoramaTextures(texture => { scene.background = texture; render(); }, onStatus);
  resize(); reset();
  return {
    load(value: PanoramaScene) { pointer = undefined; reset(); textures.load(value); },
    reset,
    zoom,
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); textures.dispose();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', keydown);
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
