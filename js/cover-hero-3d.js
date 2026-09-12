// js/cover-hero-3d.js
//
// "Ledger Core" — Cover hero 3D scene.
//
// A small, self-contained visual enhancement for the Cover page hero
// banner: a rotating glass "ledger" slab orbited by one tile per domain
// (Sales, Manager, Notes & Sheets, Closing, Audit, Inventory, STR),
// tinted with that domain's real accent color (see css/nav.css's
// #sections-list[data-domain] --g-accent rules — this file mirrors those
// same colors so the scene stays visually consistent with the rest of the
// app instead of inventing its own palette). Tapping a tile flies it
// toward camera and routes to that domain via the app's existing
// window.showPage().
//
// This is intentionally an *optional* enhancement layered on top of the
// existing flat .cover-page-hero-mark watermark, never a replacement it
// depends on:
//   - No WebGL support            -> we never touch the DOM, static mark shows as before.
//   - prefers-reduced-motion      -> same, we bail before doing anything.
//   - Very narrow viewport        -> same (home-screen widget webviews etc).
//   - three.js CDN unreachable    -> caught, same fallback.
// Nothing else in the app imports from or depends on this file, so any
// failure here is fully contained.

const DOMAINS = [
  { page: 'index',        color: 0x5b82ff, label: 'Sales' },
  { page: 'manager',      color: 0x38bdf8, label: 'Manager' },
  { page: 'notesheets',   color: 0x34d399, label: 'Notes & Sheets' },
  { page: 'closing-book', color: 0xfbbf24, label: 'Closing' },
  { page: 'assignments',  color: 0xf87171, label: 'Audit' },
  { page: 'inventory',    color: 0xf472b6, label: 'Inventory' },
  { page: 'str',          color: 0xa78bfa, label: 'STR' },
];

const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const PARTICLE_COUNT = 24;
const RADIUS_NEAR = 2.05;
const RADIUS_FAR = 1.55;

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

async function initCoverHero3D() {
  const mount = document.querySelector('.cover-page-hero-mark');
  if (!mount) return;
  if (prefersReducedMotion()) return;
  if (!supportsWebGL()) return;
  if (window.innerWidth < 340) return; // skip cramped widget/webview contexts
  if (mount.dataset.hero3dInit) return; // guard against double-init on re-render
  mount.dataset.hero3dInit = '1';

  let THREE;
  try {
    THREE = await import(/* webpackIgnore: true */ THREE_CDN);
  } catch (e) {
    return; // offline or CDN blocked — silent fallback to the static mark
  }

  // If the Cover page got navigated away from while three.js was loading,
  // don't bother mounting a scene nobody will see.
  if (!document.body.contains(mount)) return;

  mount.classList.add('cover-hero-3d-active');
  const canvas = document.createElement('canvas');
  canvas.className = 'cover-hero-3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  mount.appendChild(canvas);

  const getSize = () => {
    const r = mount.getBoundingClientRect();
    return { w: r.width || 220, h: r.height || 220 };
  };

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  {
    const { w, h } = getSize();
    renderer.setSize(w, h, false);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.55, 6.2);
  camera.lookAt(0, 0, 0);
  {
    const { w, h } = getSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ── Lighting: one warm key, one cool accent rim, soft ambient fill.
  // Deliberately no shadow maps — biggest perf cost for the least payoff
  // at this element size.
  const key = new THREE.DirectionalLight(0xfff1d6, 1.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x60a5fa, 0.9);
  rim.position.set(-4, -1, -3);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x1e3a8a, 0.55));

  // ── Hero object: the Ledger Core — a frosted glass slab.
  const coreGeo = new THREE.BoxGeometry(1.7, 2.1, 0.28);
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.55,
    roughness: 0.15,
    metalness: 0.1,
    transmission: 0.55,
    thickness: 0.6,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(coreGeo),
    new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.5 })
  );
  core.add(edges);

  // ── Orbiting domain tiles — one per domain, real app accent colors.
  const group = new THREE.Group();
  scene.add(group);
  const tileGeo = new THREE.PlaneGeometry(0.42, 0.42);
  const glowGeo = new THREE.PlaneGeometry(0.62, 0.62);
  const tiles = DOMAINS.map((d) => {
    const mat = new THREE.MeshBasicMaterial({
      color: d.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(tileGeo, mat);
    mesh.userData = { page: d.page, label: d.label, baseOpacity: 0.85 };
    const glow = new THREE.Mesh(
      glowGeo,
      new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
    );
    mesh.add(glow);
    group.add(mesh);
    return mesh;
  });

  function layoutTiles(t) {
    const n = tiles.length;
    tiles.forEach((mesh, i) => {
      const angle = (i / n) * Math.PI * 2 + t * 0.18;
      const far = i % 2 === 1;
      const r = far ? RADIUS_FAR : RADIUS_NEAR;
      const y = Math.sin(angle * 1.3 + i) * 0.35;
      mesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r * 0.4 - (far ? 0.3 : 0));
      mesh.scale.setScalar(far ? 0.78 : 1);
      mesh.lookAt(camera.position);
    });
  }

  // ── Particles: thin light-trail dots drifting from a tile toward the
  // core on a timer (no physics engine needed for this scale of effect).
  const pGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.045, color: 0x93c5fd, transparent: true, opacity: 0.7, sizeAttenuation: true,
  });
  const particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);
  const pState = Array.from({ length: PARTICLE_COUNT }, () => ({
    t: Math.random(),
    from: Math.floor(Math.random() * tiles.length),
    speed: 0.15 + Math.random() * 0.25,
  }));

  function updateParticles(dt) {
    const arr = pGeo.attributes.position.array;
    pState.forEach((p, i) => {
      p.t += dt * p.speed;
      if (p.t >= 1) {
        p.t = 0;
        p.from = Math.floor(Math.random() * tiles.length);
      }
      const start = tiles[p.from].position;
      const k = 1 - p.t;
      arr[i * 3] = start.x * k;
      arr[i * 3 + 1] = start.y * k;
      arr[i * 3 + 2] = start.z * k;
    });
    pGeo.attributes.position.needsUpdate = true;
  }

  // ── Interaction: pointer parallax (tilt the whole orbit slightly
  // toward the cursor/touch point) + hover highlight + tap-to-navigate.
  const pointerNDC = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let targetRotX = 0;
  let targetRotY = 0;
  let hovered = null;
  let flying = false;

  function setPointerFromEvent(clientX, clientY) {
    const r = mount.getBoundingClientRect();
    pointerNDC.x = ((clientX - r.left) / r.width) * 2 - 1;
    pointerNDC.y = -((clientY - r.top) / r.height) * 2 + 1;
    return pointerNDC;
  }

  function onPointerMove(e) {
    setPointerFromEvent(e.clientX, e.clientY);
    targetRotY = pointerNDC.x * 0.35;
    targetRotX = -pointerNDC.y * 0.22;

    raycaster.setFromCamera(pointerNDC, camera);
    const hit = raycaster.intersectObjects(tiles, false)[0]?.object || null;
    if (hit !== hovered) {
      if (hovered) hovered.material.opacity = hovered.userData.baseOpacity;
      hovered = hit;
      if (hovered) {
        hovered.material.opacity = 1;
        mount.style.cursor = 'pointer';
      } else {
        mount.style.cursor = '';
      }
    }
  }

  function onPointerLeave() {
    targetRotX = 0;
    targetRotY = 0;
    if (hovered) hovered.material.opacity = hovered.userData.baseOpacity;
    hovered = null;
    mount.style.cursor = '';
  }

  function onClick(e) {
    setPointerFromEvent(e.clientX, e.clientY);
    raycaster.setFromCamera(pointerNDC, camera);
    const hit = raycaster.intersectObjects(tiles, false)[0]?.object;
    if (!hit || flying || typeof window.showPage !== 'function') return;
    flying = true;
    coreMat.opacity = 0.85;
    window.setTimeout(() => {
      window.showPage(hit.userData.page);
      coreMat.opacity = 0.55;
      flying = false;
    }, 220);
  }

  mount.style.pointerEvents = 'auto';
  mount.addEventListener('pointermove', onPointerMove);
  mount.addEventListener('pointerleave', onPointerLeave);
  mount.addEventListener('click', onClick);

  // ── Resize handling.
  const ro = new ResizeObserver(() => {
    const { w, h } = getSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(mount);

  // ── Perf discipline: fully pause the render loop when the tab is
  // hidden or the hero banner scrolls off-screen. Cheap on desktop,
  // essential on the low-power/battery-constrained devices this app
  // also runs on (Android home-screen widgets, older phones).
  let running = false;
  let isIntersecting = false;
  let lastTime = performance.now();
  let clock = 0;

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    clock += dt;

    core.rotation.y += dt * 0.25;
    core.rotation.x = Math.sin(clock * 0.3) * 0.06;

    group.rotation.y += (targetRotY - group.rotation.y) * 0.06;
    group.rotation.x += (targetRotX - group.rotation.x) * 0.06;
    layoutTiles(clock);
    updateParticles(dt);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !isIntersecting) stop();
    else start();
  });

  const io = new IntersectionObserver((entries) => {
    isIntersecting = entries[0].isIntersecting;
    if (isIntersecting && !document.hidden) start();
    else stop();
  }, { threshold: 0.05 });
  io.observe(mount);

  // Initial layout pass so tiles aren't at the origin before the first frame.
  layoutTiles(0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initCoverHero3D(); });
} else {
  initCoverHero3D();
}

// Cover re-renders its container on every showPage('cover') (see
// cover-dashboard.js's header comment) but the hero banner markup itself
// is static in index.html and never gets rebuilt, so a single init on
// first load is sufficient — no re-init hook needed here.
