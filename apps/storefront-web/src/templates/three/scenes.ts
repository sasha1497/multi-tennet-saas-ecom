/**
 * The three WebGL scenes of the 3D template family.
 *
 * Imported only through `import('./scenes')` from a 3D island, so three.js and
 * everything here live in their own chunk that 2D storefronts never fetch.
 *
 * All three are built from the merchant's own product photographs — no 3D
 * models, no stock assets. Rules every scene follows:
 *
 *   • pixel ratio capped at 2, antialiasing on, alpha so the page shows through
 *   • the render loop stops while the canvas is off screen or the tab is hidden
 *   • textures are loaded cross-origin and size-capped; one that fails becomes
 *     a flat accent-coloured panel rather than failing the scene
 *   • `dispose()` releases every geometry, material, texture and the context
 */
import * as THREE from 'three';
import type { SceneHandle } from './use-three-scene';

export interface ScenePhoto {
  url: string;
  /** Where activating this photo goes. Omitted for the product turntable. */
  href?: string;
}

// ─────────────────────────────────────────────────────────── shared stage ──

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Starts the loop; `tick` gets seconds since the last frame (clamped). */
  run: (tick: (dt: number, t: number) => void) => void;
  track: <T extends { dispose: () => void }>(resource: T) => T;
  dispose: () => void;
}

function createStage(canvas: HTMLCanvasElement, fov = 35): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  const resources: { dispose: () => void }[] = [];

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let frame = 0;
  let visible = true;
  let running = false;
  let tickFn: ((dt: number, t: number) => void) | null = null;
  let last = performance.now();
  let elapsed = 0;

  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    // Clamped so a long pause (tab switch) does not fling everything forward.
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    elapsed += dt;
    tickFn?.(dt, elapsed);
    renderer.render(scene, camera);
  };
  const play = () => {
    if (running || !visible || document.hidden || !tickFn) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(loop);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) play();
    else pause();
  });
  io.observe(canvas);
  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVisibility);

  return {
    renderer,
    scene,
    camera,
    run: (tick) => {
      tickFn = tick;
      play();
    },
    track: (resource) => {
      resources.push(resource);
      return resource;
    },
    dispose: () => {
      pause();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const r of resources) r.dispose();
      scene.clear();
      renderer.dispose();
    },
  };
}

/** Longest texture edge. Product photos are often 3–4k; a plate needs far less. */
const MAX_TEXTURE = 1024;

/**
 * Loads a photo as a texture, downscaled and cropped to `aspect` (w / h) like
 * CSS `object-fit: cover`. Resolves null rather than rejecting.
 */
async function loadPhoto(url: string, aspect: number): Promise<THREE.Texture | null> {
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.src = url;
    await image.decode();

    const srcAspect = image.naturalWidth / image.naturalHeight;
    let sw = image.naturalWidth;
    let sh = image.naturalHeight;
    if (srcAspect > aspect) sw = sh * aspect;
    else sh = sw / aspect;
    const sx = (image.naturalWidth - sw) / 2;
    const sy = (image.naturalHeight - sh) / 2;

    const scale = Math.min(1, MAX_TEXTURE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  } catch {
    // A blocked or broken image: the caller substitutes a flat panel.
    return null;
  }
}

/** A soft radial shadow, drawn once on a 2D canvas. */
function shadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,0.45)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Drag-to-rotate with inertia, shared by the orbit and the turntable. */
function dragRotation(canvas: HTMLCanvasElement, sensitivity: number) {
  let dragging = false;
  let lastX = 0;
  let moved = 0;
  const state = { velocity: 0, interacted: false, pointer: new THREE.Vector2(9, 9) };

  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    state.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };
  const down = (event: PointerEvent) => {
    dragging = true;
    moved = 0;
    lastX = event.clientX;
    state.interacted = true;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const move = (event: PointerEvent) => {
    local(event);
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    moved += Math.abs(dx);
    state.velocity = dx * sensitivity;
  };
  const up = (event: PointerEvent) => {
    dragging = false;
    canvas.style.cursor = '';
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const leave = () => state.pointer.set(9, 9);

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);

  return {
    state,
    get dragging() {
      return dragging;
    },
    /** True when the last pointer-up was a tap rather than a drag. */
    get wasTap() {
      return moved < 6;
    },
    dispose: () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
    },
  };
}

/** Never fewer than `min` plates: a ring of two photographs is not a ring. */
function fillTo<T>(items: T[], min: number, max: number): T[] {
  if (items.length === 0) return [];
  const out = items.slice(0, max);
  for (let i = 0; out.length < min; i++) out.push(items[i % items.length]!);
  return out;
}

// ─────────────────────────────────────────────────────────────── orbit ──

/**
 * Orbit: product photographs on a slowly turning ring around the headline.
 * Drag to spin it; tap a photograph to open that product.
 */
export async function mountOrbit(
  canvas: HTMLCanvasElement,
  options: { photos: ScenePhoto[]; accent: number; onSelect: (href: string) => void },
): Promise<SceneHandle> {
  const stage = createStage(canvas, 32);
  const { scene, camera } = stage;
  // The ring sits in the lower half of the opening, beneath the headline —
  // type is never drawn over a photograph it has to compete with.
  camera.position.set(0, 1.6, 12.5);
  camera.lookAt(0, 0.9, 0);

  const photos = fillTo(options.photos, 6, 10);
  const textures = await Promise.all(photos.map((p) => loadPhoto(p.url, 3 / 4)));

  const ring = new THREE.Group();
  ring.position.y = -1.55;
  scene.add(ring);

  const radius = Math.max(3.4, photos.length * 0.48);
  const plate = stage.track(new THREE.PlaneGeometry(1.5, 2));
  const plates: THREE.Mesh[] = [];

  photos.forEach((photo, i) => {
    const angle = (i / photos.length) * Math.PI * 2;
    const texture = textures[i];
    if (texture) stage.track(texture);
    const material = stage.track(
      new THREE.MeshBasicMaterial({
        map: texture ?? null,
        color: texture ? 0xffffff : options.accent,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    );
    const mesh = new THREE.Mesh(plate, material);
    mesh.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    mesh.rotation.y = angle;
    mesh.userData = { href: photo.href, baseScale: 1 };
    ring.add(mesh);
    plates.push(mesh);

    // A faint mirror image on the "floor", which reads as a polished stage.
    const reflection = new THREE.Mesh(
      plate,
      stage.track(
        new THREE.MeshBasicMaterial({
          map: texture ?? null,
          color: texture ? 0xffffff : options.accent,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    reflection.position.set(mesh.position.x, -2.08, mesh.position.z);
    reflection.rotation.set(Math.PI, angle + Math.PI, 0);
    reflection.scale.x = -1;
    ring.add(reflection);
  });

  const halo = new THREE.Mesh(
    stage.track(new THREE.RingGeometry(radius - 0.02, radius + 0.02, 128)),
    stage.track(
      new THREE.MeshBasicMaterial({ color: options.accent, transparent: true, opacity: 0.55 }),
    ),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -1.05;
  ring.add(halo);

  const drag = dragRotation(canvas, 0.0035);
  const raycaster = new THREE.Raycaster();
  let hovered: THREE.Mesh | null = null;

  const onClick = () => {
    if (!drag.wasTap || !hovered) return;
    const href = hovered.userData.href as string | undefined;
    if (href) options.onSelect(href);
  };
  canvas.addEventListener('click', onClick);

  stage.run((dt) => {
    // Idle spin, overridden by the shopper's drag, then easing back.
    const idle = drag.state.interacted ? 0.05 : 0.12;
    if (!drag.dragging) drag.state.velocity *= Math.pow(0.04, dt);
    ring.rotation.y += drag.state.velocity + idle * dt;

    raycaster.setFromCamera(drag.state.pointer, camera);
    const hit = raycaster.intersectObjects(plates, false)[0]?.object as THREE.Mesh | undefined;
    hovered = hit ?? null;
    canvas.style.cursor = drag.dragging ? 'grabbing' : hovered ? 'pointer' : 'grab';

    for (const mesh of plates) {
      const target = mesh === hovered ? 1.08 : 1;
      mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, target, 1 - Math.pow(0.001, dt)));
    }
  });

  return {
    dispose: () => {
      canvas.removeEventListener('click', onClick);
      drag.dispose();
      stage.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────────── prism ──

/**
 * Prism: product plates suspended at different depths in soft light. The
 * arrangement leans towards the pointer and a highlight follows it, so pieces
 * catch the light the way they would under a display case lamp.
 */
export async function mountPrism(
  canvas: HTMLCanvasElement,
  options: { photos: ScenePhoto[]; accent: number; onSelect: (href: string) => void },
): Promise<SceneHandle> {
  const stage = createStage(canvas, 30);
  const { scene, camera } = stage;
  camera.position.set(0, 0, 11);

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const lamp = new THREE.PointLight(options.accent, 18, 14, 1.6);
  lamp.position.set(0, 0, 4);
  scene.add(lamp);

  const photos = fillTo(options.photos, 5, 7);
  const textures = await Promise.all(photos.map((p) => loadPhoto(p.url, 4 / 5)));

  const group = new THREE.Group();
  scene.add(group);

  // A loose, hand-arranged constellation rather than a grid: x, y, depth, scale.
  const layout: [number, number, number, number][] = [
    [0, 0.1, 0.6, 1.25],
    [-3.1, 0.9, -1.2, 0.95],
    [3.0, 1.1, -0.8, 0.9],
    [-2.4, -1.6, -0.2, 0.85],
    [2.6, -1.5, 0.1, 0.9],
    [-4.6, -0.4, -2.6, 0.75],
    [4.7, -0.1, -2.4, 0.75],
  ];

  const plate = stage.track(new THREE.BoxGeometry(1.6, 2, 0.05));
  const edge = stage.track(
    new THREE.MeshStandardMaterial({ color: options.accent, metalness: 0.85, roughness: 0.25 }),
  );
  const plates: THREE.Mesh[] = [];

  photos.forEach((photo, i) => {
    const [x, y, z, s] = layout[i % layout.length]!;
    const texture = textures[i];
    if (texture) stage.track(texture);
    const face = stage.track(
      new THREE.MeshStandardMaterial({
        map: texture ?? null,
        color: texture ? 0xffffff : options.accent,
        roughness: 0.42,
        metalness: 0.05,
      }),
    );
    // Box faces: +x, -x, +y, -y, +z (front), -z (back).
    const mesh = new THREE.Mesh(plate, [edge, edge, edge, edge, face, edge]);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(s);
    mesh.userData = { href: photo.href, seed: i * 1.7, baseY: y, baseScale: s };
    group.add(mesh);
    plates.push(mesh);
  });

  // A few small facets drifting between the plates: the jeweller's sparkle.
  const facetGeometry = stage.track(new THREE.OctahedronGeometry(0.16, 0));
  const facetMaterial = stage.track(
    new THREE.MeshStandardMaterial({ color: options.accent, metalness: 1, roughness: 0.12 }),
  );
  const facets: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const facet = new THREE.Mesh(facetGeometry, facetMaterial);
    facet.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 5, -3 + Math.random() * 3);
    facet.userData = { seed: Math.random() * 10 };
    group.add(facet);
    facets.push(facet);
  }

  const pointer = new THREE.Vector2(9, 9);
  const onMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };
  const onLeave = () => pointer.set(9, 9);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  const raycaster = new THREE.Raycaster();
  let hovered: THREE.Mesh | null = null;
  const onClick = () => {
    const href = hovered?.userData.href as string | undefined;
    if (href) options.onSelect(href);
  };
  canvas.addEventListener('click', onClick);

  stage.run((dt, t) => {
    const active = pointer.x < 2;
    const tx = active ? pointer.y * 0.18 : 0;
    const ty = active ? pointer.x * 0.32 : Math.sin(t * 0.25) * 0.12;
    const ease = 1 - Math.pow(0.02, dt);
    group.rotation.x += (-tx - group.rotation.x) * ease;
    group.rotation.y += (ty - group.rotation.y) * ease;

    lamp.position.x += ((active ? pointer.x * 5 : Math.sin(t * 0.4) * 3) - lamp.position.x) * ease;
    lamp.position.y += ((active ? pointer.y * 3 : Math.cos(t * 0.3) * 1.5) - lamp.position.y) * ease;

    raycaster.setFromCamera(pointer, camera);
    hovered = (raycaster.intersectObjects(plates, false)[0]?.object as THREE.Mesh) ?? null;
    canvas.style.cursor = hovered ? 'pointer' : '';

    for (const mesh of plates) {
      const { seed, baseY, baseScale } = mesh.userData as { seed: number; baseY: number; baseScale: number };
      mesh.position.y = baseY + Math.sin(t * 0.7 + seed) * 0.12;
      mesh.rotation.y = Math.sin(t * 0.35 + seed) * 0.18;
      const target = mesh === hovered ? baseScale * 1.07 : baseScale;
      mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, target, ease));
    }
    for (const facet of facets) {
      const seed = facet.userData.seed as number;
      facet.rotation.x = t * 0.6 + seed;
      facet.rotation.y = t * 0.8 + seed;
      facet.position.y += Math.sin(t + seed) * 0.002;
    }
  });

  return {
    dispose: () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      stage.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────── turntable ──

export interface TurntableHandle extends SceneHandle {
  /** Shows another photograph on the front face. */
  show: (index: number) => void;
}

/**
 * The product page's turntable: the product's photographs mounted on a thin
 * plate the shopper drags to turn — front face the selected photo, back face
 * the next one — standing over a soft shadow.
 */
export async function mountTurntable(
  canvas: HTMLCanvasElement,
  options: { photos: ScenePhoto[]; accent: number; aspect: number; initial: number },
): Promise<TurntableHandle> {
  const stage = createStage(canvas, 28);
  const { scene, camera } = stage;
  camera.position.set(0, 0.35, 8.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 3, 5);
  scene.add(key);

  const textures = await Promise.all(options.photos.map((p) => loadPhoto(p.url, options.aspect)));
  if (textures.every((t) => t === null)) throw new Error('No product photo could be loaded');
  for (const t of textures) if (t) stage.track(t);

  const height = 3.4;
  const width = height * options.aspect;
  const geometry = stage.track(new THREE.BoxGeometry(width, height, 0.06));
  const edge = stage.track(
    new THREE.MeshStandardMaterial({ color: options.accent, metalness: 0.6, roughness: 0.35 }),
  );
  const front = stage.track(new THREE.MeshStandardMaterial({ roughness: 0.5 }));
  const back = stage.track(new THREE.MeshStandardMaterial({ roughness: 0.5 }));
  const card = new THREE.Mesh(geometry, [edge, edge, edge, edge, front, back]);
  scene.add(card);

  const shadow = new THREE.Mesh(
    stage.track(new THREE.PlaneGeometry(width * 1.6, 1.1)),
    stage.track(
      new THREE.MeshBasicMaterial({ map: stage.track(shadowTexture()), transparent: true, depthWrite: false }),
    ),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -height / 2 - 0.25;
  scene.add(shadow);

  const usable = textures
    .map((texture, index) => ({ texture, index }))
    .filter((t): t is { texture: THREE.Texture; index: number } => t.texture !== null);
  const show = (index: number) => {
    const at = Math.max(0, usable.findIndex((u) => u.index === index));
    front.map = usable[at]!.texture;
    back.map = usable[(at + 1) % usable.length]!.texture;
    front.needsUpdate = back.needsUpdate = true;
    // Turn to face the shopper when they pick a photo.
    target = Math.round(card.rotation.y / (Math.PI * 2)) * Math.PI * 2;
  };

  let target: number | null = null;
  show(options.initial);
  target = null;

  const drag = dragRotation(canvas, 0.012);
  canvas.style.cursor = 'grab';

  stage.run((dt, t) => {
    if (!drag.dragging) drag.state.velocity *= Math.pow(0.03, dt);
    if (drag.state.interacted && Math.abs(drag.state.velocity) > 0.0005) target = null;

    if (target !== null) {
      card.rotation.y += (target - card.rotation.y) * (1 - Math.pow(0.01, dt));
    } else {
      // A slow turn until the shopper takes over, so it reads as 3D at a glance.
      card.rotation.y += drag.state.velocity + (drag.state.interacted ? 0 : 0.35 * dt);
    }
    card.rotation.x = Math.sin(t * 0.6) * 0.03;
    card.position.y = Math.sin(t * 0.9) * 0.05;
    shadow.scale.x = 0.75 + Math.abs(Math.cos(card.rotation.y)) * 0.25;
  });

  return {
    show,
    dispose: () => {
      drag.dispose();
      stage.dispose();
    },
  };
}
