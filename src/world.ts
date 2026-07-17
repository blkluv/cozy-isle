import * as THREE from 'three';

// ---------- helpers ----------
function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...opts });
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Circle { x: number; z: number; r: number }
export type ShakeKind = 'apple' | 'palm';
export interface ShakeTarget {
  kind: ShakeKind;
  pos: THREE.Vector3;
  tree: THREE.Group;
  canopy: THREE.Group;
  ring: THREE.Mesh;
  fruits: THREE.Mesh[];
  cooldownUntil: number;
  shakeT: number; // >0 while shaking animation plays
}

export const RIVER = { zMin: 7, zMax: 13, halfWidth: 58 };
export const BRIDGE = { x: 0, halfW: 2.4, zMin: 4.2, zMax: 15.8, peak: 1.15 };
export const PLAZA = { x: 0, z: 22, r: 9.5 };
export const ISLAND_R = 62;

export interface World {
  obstacles: Circle[];
  shakables: ShakeTarget[];
  tick: (dt: number, t: number) => void;
  isWalkable: (x: number, z: number) => boolean;
  groundY: (x: number, z: number) => number;
  nearWater: (x: number, z: number) => boolean;
  castTarget: (x: number, z: number) => THREE.Vector3;
  setCampfireLit: (lit: boolean) => void;
}

export function buildWorld(scene: THREE.Scene): World {
  const rand = mulberry32(20260717);
  const obstacles: Circle[] = [];
  const shakables: ShakeTarget[] = [];
  const animated: ((dt: number, t: number) => void)[] = [];

  const add = (o: THREE.Object3D) => scene.add(o);
  const shadow = (o: THREE.Object3D) => o.traverse((m) => { if (m instanceof THREE.Mesh) { m.castShadow = true; m.receiveShadow = true; } });

  // ---------- sky, light, fog ----------
  scene.background = new THREE.Color(0xa5dcf0);
  scene.fog = new THREE.Fog(0xa5dcf0, 90, 240);
  const hemi = new THREE.HemisphereLight(0xdff4ff, 0x8fc46a, 0.95);
  add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
  sun.position.set(40, 60, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0006;
  add(sun);

  // ---------- ocean ----------
  const ocean = new THREE.Mesh(new THREE.CircleGeometry(320, 48), mat(0x35a8e0, { roughness: 0.6, flatShading: false }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -1.05;
  add(ocean);
  const oceanDeep = new THREE.Mesh(new THREE.CircleGeometry(700, 32), mat(0x2a8fc9, { roughness: 0.7, flatShading: false }));
  oceanDeep.rotation.x = -Math.PI / 2;
  oceanDeep.position.y = -1.35;
  add(oceanDeep);

  // ---------- island ----------
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(67, 71, 1.5, 56), mat(0xeed9a4));
  beach.position.y = -0.9;
  beach.receiveShadow = true;
  add(beach);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, 66, 1.7, 56), mat(0x82c95b));
  grass.position.y = -0.85;
  grass.receiveShadow = true;
  add(grass);

  // grass patches for variety
  for (let i = 0; i < 14; i++) {
    const r = 4 + rand() * 9;
    const a = rand() * Math.PI * 2;
    const d = rand() * 50;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(r, 18), mat(rand() > 0.5 ? 0x8ad163 : 0x79bd52));
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(Math.cos(a) * d, 0.012 + i * 0.0004, Math.sin(a) * d);
    patch.receiveShadow = true;
    add(patch);
  }

  // ---------- river ----------
  const riverBed = new THREE.Mesh(new THREE.BoxGeometry(RIVER.halfWidth * 2 + 14, 0.5, RIVER.zMax - RIVER.zMin + 2.4), mat(0xe8d49c));
  riverBed.position.set(0, -0.18, (RIVER.zMin + RIVER.zMax) / 2);
  add(riverBed);
  const river = new THREE.Mesh(new THREE.BoxGeometry(RIVER.halfWidth * 2 + 14, 0.3, RIVER.zMax - RIVER.zMin), mat(0x49c2ec, { roughness: 0.35, flatShading: false }));
  river.position.set(0, -0.02, (RIVER.zMin + RIVER.zMax) / 2);
  river.receiveShadow = true;
  add(river);
  // sand banks
  for (const zEdge of [RIVER.zMin - 0.7, RIVER.zMax + 0.7]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(RIVER.halfWidth * 2 + 10, 0.1, 1.6), mat(0xf0dcaa));
    bank.position.set(0, 0.05, zEdge);
    bank.receiveShadow = true;
    add(bank);
  }

  // ---------- paths ----------
  const pathMat = mat(0xecdcb0);
  function pathBox(x1: number, z1: number, x2: number, z2: number, w: number) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, len + w * 0.5), pathMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = -Math.atan2(dx, dz);
    p.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
    p.receiveShadow = true;
    add(p);
  }
  pathBox(0, PLAZA.z, 0, BRIDGE.zMax, 3.4);            // plaza -> bridge
  pathBox(0, BRIDGE.zMin, 0, -30, 3.2);                 // bridge -> lighthouse
  pathBox(0, 2, -15, -4, 2.6);                          // fork west house
  pathBox(0, 2, 15, -4, 2.6);                           // fork east house

  // ---------- plaza ----------
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA.r, 36), mat(0xf2e2b2));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(PLAZA.x, 0.025, PLAZA.z);
  plaza.receiveShadow = true;
  add(plaza);

  // campfire: stone ring + logs + flame
  const fire = new THREE.Group();
  fire.position.set(PLAZA.x, 0, PLAZA.z);
  const stoneGeo = new THREE.DodecahedronGeometry(0.28, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(stoneGeo, mat(0xbfc7cd));
    s.position.set(Math.cos(a) * 1.15, 0.12, Math.sin(a) * 1.15);
    s.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    fire.add(s);
  }
  const logGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    const log = new THREE.Mesh(logGeo, mat(0x8a5a33));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = a;
    log.position.y = 0.14;
    fire.add(log);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 7), mat(0xff9a3c, { emissive: 0xff7722, emissiveIntensity: 0.9 }));
  flame.position.y = 0.65;
  fire.add(flame);
  const flameIn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 6), mat(0xffe08a, { emissive: 0xffcc44, emissiveIntensity: 1.2 }));
  flameIn.position.y = 0.6;
  fire.add(flameIn);
  const fireLight = new THREE.PointLight(0xffa54d, 12, 12, 1.8);
  fireLight.position.set(0, 1.2, 0);
  fire.add(fireLight);
  shadow(fire);
  add(fire);
  obstacles.push({ x: PLAZA.x, z: PLAZA.z, r: 1.7 });
  // original clip: the campfire is an unlit stone ring until the celebration
  let fireLit = false;
  let fireLevel = 0;
  flame.visible = false;
  flameIn.visible = false;
  fireLight.intensity = 0;
  const setCampfireLit = (lit: boolean) => {
    fireLit = lit;
    flame.visible = lit;
    flameIn.visible = lit;
  };
  animated.push((dt, t) => {
    fireLevel = THREE.MathUtils.damp(fireLevel, fireLit ? 1 : 0, 3, dt);
    if (fireLevel < 0.01) { fireLight.intensity = 0; return; }
    const f = 1 + Math.sin(t * 9) * 0.12 + Math.sin(t * 23.7) * 0.06;
    flame.scale.set(f * fireLevel, fireLevel * (1 + Math.sin(t * 13) * 0.15), f * fireLevel);
    flameIn.scale.set(f * fireLevel, fireLevel * (1 + Math.cos(t * 17) * 0.12), f * fireLevel);
    fireLight.intensity = fireLevel * (10 + Math.sin(t * 11) * 2.5);
  });

  // ---------- bridge ----------
  const bridge = new THREE.Group();
  const plankMat = mat(0xc08a4e);
  const railMat = mat(0x9a6733);
  const span = BRIDGE.zMax - BRIDGE.zMin;
  const nPlanks = 14;
  for (let i = 0; i < nPlanks; i++) {
    const t = i / (nPlanks - 1);
    const z = BRIDGE.zMin + span * t;
    const y = BRIDGE.peak * Math.sin(Math.PI * t);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, span / nPlanks + 0.12), plankMat);
    plank.position.set(0, y + 0.1, z);
    plank.rotation.x = -Math.cos(Math.PI * t) * Math.PI * BRIDGE.peak / span;
    bridge.add(plank);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const z = BRIDGE.zMin + span * t;
      const y = BRIDGE.peak * Math.sin(Math.PI * t);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, 0.16), railMat);
      post.position.set(side * 2.05, y + 0.55, z);
      bridge.add(post);
    }
    // curved rail from segments
    for (let i = 0; i < 12; i++) {
      const t0 = i / 12, t1 = (i + 1) / 12;
      const z0 = BRIDGE.zMin + span * t0, z1 = BRIDGE.zMin + span * t1;
      const y0 = BRIDGE.peak * Math.sin(Math.PI * t0), y1 = BRIDGE.peak * Math.sin(Math.PI * t1);
      const segLen = Math.hypot(z1 - z0, y1 - y0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, segLen + 0.05), railMat);
      rail.position.set(side * 2.05, (y0 + y1) / 2 + 0.95, (z0 + z1) / 2);
      rail.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
      bridge.add(rail);
    }
  }
  // lanterns at bridge ends
  for (const side of [-1, 1]) {
    for (const zend of [BRIDGE.zMin - 0.4, BRIDGE.zMax + 0.4]) {
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6), mat(0x5a4a42));
      lp.position.set(side * 2.2, 0.65, zend);
      const lampBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.34), mat(0x4a3c35));
      lampBox.position.set(side * 2.2, 1.45, zend);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), mat(0xffe6a3, { emissive: 0xffd977, emissiveIntensity: 1 }));
      glow.position.set(side * 2.2, 1.43, zend);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 4), mat(0x4a3c35));
      cap.position.set(side * 2.2, 1.76, zend);
      cap.rotation.y = Math.PI / 4;
      bridge.add(lp, lampBox, glow, cap);
    }
  }
  shadow(bridge);
  add(bridge);

  // ---------- houses ----------
  function house(x: number, z: number, wallColor: number, roofColor: number, ry: number) {
    const h = new THREE.Group();
    h.position.set(x, 0, z);
    h.rotation.y = ry;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.3, 3.4, 14), mat(wallColor));
    wall.position.y = 1.7;
    const roof = new THREE.Mesh(new THREE.SphereGeometry(4.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(roofColor));
    roof.position.y = 3.3;
    roof.scale.y = 0.85;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(4.35, 0.28, 8, 18), mat(roofColor));
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 3.35;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.3), mat(0x7a4f2a));
    door.position.set(0, 0.95, 4.05);
    const doorTop = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.3, 12, 1, false, 0, Math.PI), mat(0x7a4f2a));
    doorTop.rotation.x = Math.PI / 2; doorTop.rotation.z = Math.PI / 2;
    doorTop.position.set(0, 1.9, 4.05);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(0xf6c453));
    knob.position.set(0.4, 0.95, 4.25);
    h.add(wall, roof, brim, door, doorTop, knob);
    // round windows
    for (const wx of [-2.2, 2.2]) {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 6, 14), mat(0xffffff));
      frame.position.set(wx, 2.1, 3.6);
      frame.rotation.x = -0.35;
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), mat(0xbfe8ff, { emissive: 0x9fd4f0, emissiveIntensity: 0.25, flatShading: false }));
      glass.position.set(wx, 2.1, 3.58);
      glass.rotation.x = -0.35;
      h.add(frame, glass);
      // flower box
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.35), mat(0x8a5a33));
      box.position.set(wx, 1.35, 3.85);
      h.add(box);
      for (let f = 0; f < 3; f++) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat(f % 2 ? 0xff7b9c : 0xffd23e));
        fl.position.set(wx - 0.3 + f * 0.3, 1.55, 3.9);
        h.add(fl);
      }
    }
    // doorstep lantern
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 6), mat(0x5a4a42));
    lp.position.set(1.6, 0.55, 4.6);
    const lg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), mat(0xffe6a3, { emissive: 0xffd977, emissiveIntensity: 1 }));
    lg.position.set(1.6, 1.2, 4.6);
    h.add(lp, lg);
    shadow(h);
    add(h);
    obstacles.push({ x, z, r: 5.1 });
  }
  house(-16, -4, 0xf3e6c8, 0xdfae54, 0.5);   // thatched cottage (west)
  house(16, -4, 0xd95f4e, 0x5b7ec9, -0.5);   // red house, blue roof (east)

  // ---------- lighthouse ----------
  const lh = new THREE.Group();
  lh.position.set(0, 0, -34);
  const bands = [0xffffff, 0xe64545, 0xffffff, 0xe64545];
  bands.forEach((c, i) => {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.7 - i * 0.18, 1.85 - i * 0.18, 2.1, 12), mat(c));
    seg.position.y = 1.05 + i * 2.1;
    lh.add(seg);
  });
  const lightRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 10), mat(0x33404d));
  lightRoom.position.y = 9.0;
  const lightGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.7, 10), mat(0xfff3b0, { emissive: 0xffe066, emissiveIntensity: 1.6 }));
  lightGlow.position.y = 9.0;
  const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.1, 10), mat(0xe64545));
  lhRoof.position.y = 10.15;
  lh.add(lightRoom, lightGlow, lhRoof);
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.8, 12), mat(0xbfc7cd));
  lhBase.position.y = 0.4;
  lh.add(lhBase);
  shadow(lh);
  add(lh);
  obstacles.push({ x: 0, z: -34, r: 3.4 });
  animated.push((_dt, t) => { lightGlow.rotation.y = t * 1.5; });

  // ---------- notice board ----------
  const board = new THREE.Group();
  board.position.set(-8.5, 0, 15.2);
  board.rotation.y = 0.35;
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2, 6);
  for (const px of [-0.9, 0.9]) {
    const post = new THREE.Mesh(postGeo, mat(0x8a5a33));
    post.position.set(px, 1, 0);
    board.add(post);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.5, 0.12), mat(0xb5793d));
  panel.position.y = 1.7;
  board.add(panel);
  const boardRoof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.5, 4), mat(0x9a6733));
  boardRoof.rotation.y = Math.PI / 4;
  boardRoof.scale.z = 0.4;
  boardRoof.position.y = 2.65;
  board.add(boardRoof);
  const noteColors = [0xffe08a, 0xff9fb0, 0x9fd4f0, 0xc8ecd2, 0xffc9a3];
  noteColors.forEach((c, i) => {
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.45), mat(c, { flatShading: false }));
    note.position.set(-0.75 + (i % 3) * 0.7, 1.75 - Math.floor(i / 3) * 0.6, 0.08);
    note.rotation.z = (rand() - 0.5) * 0.3;
    board.add(note);
  });
  shadow(board);
  add(board);
  obstacles.push({ x: -8.5, z: 15.2, r: 1.0 });

  // ---------- lamp posts ----------
  function lampPost(x: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.2, 7), mat(0x55463f));
    pole.position.y = 1.6;
    const lampB = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.5, 6), mat(0x463a34));
    lampB.position.y = 3.3;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.34, 6), mat(0xffe6a3, { emissive: 0xffd977, emissiveIntensity: 1.1 }));
    glow.position.y = 3.28;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.35, 6), mat(0x463a34));
    cap.position.y = 3.72;
    g.add(pole, lampB, glow, cap);
    shadow(g);
    add(g);
    obstacles.push({ x, z, r: 0.4 });
  }
  lampPost(-5.2, 14.8); lampPost(5.2, 14.8);
  lampPost(-5.2, 5.2); lampPost(5.2, 5.2);
  lampPost(-9.5, 26); lampPost(9.5, 26);

  // ---------- benches ----------
  function bench(x: number, z: number, ry: number) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = ry;
    const legMat = mat(0x4a4440);
    for (const lx of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.5), legMat);
      leg.position.set(lx, 0.22, 0);
      b.add(leg);
    }
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.16), mat(0x7d8288));
      slat.position.set(0, 0.47, -0.18 + i * 0.18);
      b.add(slat);
    }
    for (let i = 0; i < 2; i++) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.05), mat(0x7d8288));
      back.position.set(0, 0.72 + i * 0.22, -0.32);
      back.rotation.x = -0.15;
      b.add(back);
    }
    shadow(b);
    add(b);
    obstacles.push({ x, z, r: 1.1 });
  }
  bench(8.5, 27, -0.6);
  bench(-11, 28.5, 0.9);

  // ---------- planter boxes with bushes (plaza edges, like the reference) ----------
  function planter(x: number, z: number, ry: number) {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.75), mat(0x9a6733));
    box.position.y = 0.21;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.08, 0.64), mat(0x6b4a33));
    soil.position.y = 0.44;
    p.add(box, soil);
    for (let i = 0; i < 3; i++) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), mat(i % 2 ? 0x4cae57 : 0x6fbf4e));
      bush.position.set(-0.52 + i * 0.52, 0.66, 0);
      bush.scale.y = 0.85;
      p.add(bush);
    }
    shadow(p);
    add(p);
    obstacles.push({ x, z, r: 0.95 });
  }
  planter(-8, 20.5, 0.15); planter(8, 20.5, -0.15);
  planter(-13, 24.5, 0.9); planter(13, 23.5, -0.7);

  // ---------- trees ----------
  function appleTree(x: number, z: number, shakable: boolean) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 2.4, 7), mat(0xb96a3e));
    trunk.position.y = 1.2;
    t.add(trunk);
    const canopy = new THREE.Group();
    canopy.position.y = 3.1;
    const c1 = new THREE.Mesh(new THREE.SphereGeometry(1.9, 8, 7), mat(0x3f9e4d));
    const c2 = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 7), mat(0x35853f));
    c2.position.set(1.1, -0.3, 0.4);
    const c3 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 7), mat(0x4cae57));
    c3.position.set(-1, -0.2, -0.5);
    canopy.add(c1, c2, c3);
    const fruits: THREE.Mesh[] = [];
    if (shakable) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rand() * 0.5;
        const r = 1.75 + rand() * 0.35;
        const ap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 6), mat(0xe8403a));
        ap.position.set(Math.cos(a) * r, -0.9 + rand() * 1.1, Math.sin(a) * r);
        canopy.add(ap);
        fruits.push(ap);
      }
    }
    t.add(canopy);
    shadow(t);
    add(t);
    obstacles.push({ x, z, r: 0.8 });
    if (shakable) {
      const ring = highlightRing(x, z);
      shakables.push({ kind: 'apple', pos: new THREE.Vector3(x, 0, z), tree: t, canopy, ring, fruits, cooldownUntil: 0, shakeT: 0 });
    }
  }

  function palmTree(x: number, z: number, shakable: boolean) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    const lean = (rand() - 0.5) * 0.35;
    let px = 0, py = 0;
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.015, 0.26 - i * 0.015, 1.1, 7), mat(0xa8713f));
      seg.position.set(px, py + 0.55, 0);
      seg.rotation.z = lean * (i / segs);
      px -= Math.sin(lean * (i / segs)) * 1.05;
      py += Math.cos(lean * (i / segs)) * 1.05;
      t.add(seg);
    }
    const canopy = new THREE.Group();
    canopy.position.set(px, py + 0.2, 0);
    const leafMat = mat(0x4cae57);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.9, 4), leafMat);
      leaf.scale.set(0.5, 1.12, 1.2);
      leaf.position.set(Math.cos(a) * 1.3, -0.35, Math.sin(a) * 1.3);
      leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15 + Math.PI);
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = -a;
      canopy.add(leaf);
    }
    // coconuts
    for (let i = 0; i < 3; i++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), mat(0x8a5a33));
      const a = rand() * Math.PI * 2;
      nut.position.set(Math.cos(a) * 0.45, -0.25, Math.sin(a) * 0.45);
      canopy.add(nut);
    }
    t.add(canopy);
    shadow(t);
    add(t);
    obstacles.push({ x, z, r: 0.7 });
    if (shakable) {
      const ring = highlightRing(x, z);
      shakables.push({ kind: 'palm', pos: new THREE.Vector3(x, 0, z), tree: t, canopy, ring, fruits: [], cooldownUntil: 0, shakeT: 0 });
    }
  }

  function pineTree(x: number, z: number) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.2, 6), mat(0x8a5a33));
    trunk.position.y = 0.6;
    t.add(trunk);
    const sizes = [1.6, 1.25, 0.85];
    sizes.forEach((r, i) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.7, 8), mat(i % 2 ? 0x2f7d44 : 0x359050));
      cone.position.y = 1.6 + i * 1.15;
      t.add(cone);
    });
    shadow(t);
    add(t);
    obstacles.push({ x, z, r: 0.6 });
  }

  function highlightRing(x: number, z: number) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.07, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.06, z);
    add(ring);
    return ring;
  }

  // apple orchard (southeast) + two across the river
  appleTree(18, 20, true); appleTree(24.5, 27, true); appleTree(30.5, 21, true);
  appleTree(21.5, 34, true); appleTree(31.5, 31, true);
  appleTree(-20, -12, true); appleTree(24, -14, true);
  // palms (west & south + north shore)
  palmTree(-14, 21, true); palmTree(-21, 28, true); palmTree(-28, 19.5, true);
  palmTree(-11, 33, false); palmTree(-26, -3, true); palmTree(31, 5, false);
  palmTree(9, -22, false); palmTree(-9, -22, false);
  // pines (north wilds)
  pineTree(-27, -18); pineTree(-34, -9); pineTree(28, -21); pineTree(35, -8);
  pineTree(19, -27); pineTree(-17, -26); pineTree(40, 12); pineTree(-40, 8);

  // ---------- rocks ----------
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const d = 20 + rand() * 36;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > RIVER.zMin - 2 && z < RIVER.zMax + 2) continue;
    const r = 0.35 + rand() * 0.7;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(0xb9c2c9));
    rock.position.set(x, r * 0.55, z);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.scale.y = 0.7;
    rock.castShadow = true;
    add(rock);
  }

  // ---------- grass tufts ----------
  const tuftGeo = new THREE.ConeGeometry(0.16, 0.55, 4);
  const tuftMats = [mat(0x6fbf4e), mat(0x8ad163), mat(0x5da843)];
  for (let i = 0; i < 110; i++) {
    const a = rand() * Math.PI * 2;
    const d = 6 + rand() * 53;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > RIVER.zMin - 1.6 && z < RIVER.zMax + 1.6) continue;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1) continue;
    if (Math.abs(x) < 2.6 && z < PLAZA.z + 2 && z > -32) continue; // main path
    const tuft = new THREE.Group();
    const n = 2 + Math.floor(rand() * 2);
    for (let j = 0; j < n; j++) {
      const blade = new THREE.Mesh(tuftGeo, tuftMats[Math.floor(rand() * 3)]);
      blade.position.set((rand() - 0.5) * 0.3, 0.24, (rand() - 0.5) * 0.3);
      blade.rotation.set((rand() - 0.5) * 0.5, rand() * 3, (rand() - 0.5) * 0.5);
      blade.scale.setScalar(0.7 + rand() * 0.8);
      tuft.add(blade);
    }
    tuft.position.set(x, 0, z);
    add(tuft);
  }

  // ---------- tulips ----------
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const d = 8 + rand() * 40;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > RIVER.zMin - 1.6 && z < RIVER.zMax + 1.6) continue;
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5), mat(0x4cae57));
    stem.position.y = 0.3;
    const bud = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 6), mat(rand() > 0.4 ? 0xe8403a : 0xff7b9c));
    bud.position.y = 0.72;
    bud.rotation.x = Math.PI;
    g.add(stem, bud);
    g.position.set(x, 0, z);
    g.castShadow = true;
    add(g);
  }

  // ---------- mushrooms ----------
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const d = 15 + rand() * 38;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > RIVER.zMin - 2 && z < RIVER.zMax + 2) continue;
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.3, 6), mat(0xf3e6c8));
    stem.position.y = 0.15;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe8403a));
    cap.position.y = 0.3;
    g.add(stem, cap);
    g.position.set(x, 0, z);
    g.castShadow = true;
    add(g);
  }

  // ---------- reeds along river ----------
  for (let i = 0; i < 22; i++) {
    const x = -55 + rand() * 110;
    const zEdge = rand() > 0.5 ? RIVER.zMin - 0.9 : RIVER.zMax + 0.9;
    const g = new THREE.Group();
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const h = 0.9 + rand() * 0.7;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h, 5), mat(0x5da843));
      reed.position.set((rand() - 0.5) * 0.5, h / 2, (rand() - 0.5) * 0.4);
      g.add(reed);
      if (rand() > 0.45) {
        const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.25, 3, 5), mat(0x8a5a33));
        tip.position.copy(reed.position).y = h + 0.1;
        g.add(tip);
      }
    }
    g.position.set(x, 0, zEdge);
    add(g);
  }

  // ---------- clouds ----------
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Group();
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2.2 + rand() * 2, 8, 6), mat(0xffffff, { flatShading: false, roughness: 1 }));
      puff.position.set(j * 2.6 - n, rand() * 0.8, (rand() - 0.5) * 2);
      puff.scale.y = 0.55;
      c.add(puff);
    }
    c.position.set(-120 + rand() * 240, 26 + rand() * 10, -90 + rand() * 120);
    add(c);
    clouds.push(c);
  }
  animated.push((dt) => {
    for (const c of clouds) {
      c.position.x += dt * 1.1;
      if (c.position.x > 150) c.position.x = -150;
    }
  });

  // ---------- birds ----------
  const birds: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Group();
    const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.22), mat(0xffffff));
    w1.position.x = -0.42; w1.rotation.z = 0.4;
    const w2 = w1.clone(); w2.position.x = 0.42; w2.rotation.z = -0.4;
    b.add(w1, w2);
    add(b);
    birds.push(b);
  }
  animated.push((_dt, t) => {
    birds.forEach((b, i) => {
      const ph = t * 0.25 + i * 2.1;
      b.position.set(Math.cos(ph) * 45, 20 + Math.sin(t * 0.8 + i) * 2, Math.sin(ph) * 45 - 10);
      b.rotation.y = -ph;
      const flap = Math.sin(t * 8 + i * 2) * 0.35;
      (b.children[0] as THREE.Mesh).rotation.z = 0.4 + flap;
      (b.children[1] as THREE.Mesh).rotation.z = -0.4 - flap;
    });
  });

  // ---------- butterflies ----------
  const butterflies: THREE.Group[] = [];
  const bColors = [0xff9fb0, 0xffd23e, 0x9fd4f0];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    const wingGeo = new THREE.CircleGeometry(0.16, 6);
    const wm = new THREE.MeshBasicMaterial({ color: bColors[i % 3], side: THREE.DoubleSide });
    const w1 = new THREE.Mesh(wingGeo, wm); w1.position.x = -0.12;
    const w2 = new THREE.Mesh(wingGeo, wm); w2.position.x = 0.12;
    b.add(w1, w2);
    const a = rand() * Math.PI * 2;
    b.userData.home = new THREE.Vector3(Math.cos(a) * 25, 1.4, Math.sin(a) * 25 + 10);
    add(b);
    butterflies.push(b);
  }
  animated.push((_dt, t) => {
    butterflies.forEach((b, i) => {
      const home = b.userData.home as THREE.Vector3;
      b.position.set(
        home.x + Math.sin(t * 0.9 + i * 2) * 2.4,
        home.y + Math.sin(t * 1.7 + i) * 0.5,
        home.z + Math.cos(t * 0.7 + i * 3) * 2.4
      );
      const flap = Math.sin(t * 18 + i * 5) * 0.9;
      (b.children[0] as THREE.Mesh).rotation.y = flap;
      (b.children[1] as THREE.Mesh).rotation.y = -flap;
    });
  });

  // ---------- shakable ring pulse ----------
  animated.push((_dt, t) => {
    for (const s of shakables) {
      const ready = s.cooldownUntil <= t;
      s.ring.visible = ready;
      if (ready) {
        const p = 1 + Math.sin(t * 3) * 0.06;
        s.ring.scale.set(p, p, 1);
      }
    }
  });

  // ---------- walkability ----------
  function onBridge(x: number, z: number) {
    return Math.abs(x - BRIDGE.x) < BRIDGE.halfW && z > BRIDGE.zMin && z < BRIDGE.zMax;
  }
  function isWalkable(x: number, z: number) {
    if (Math.hypot(x, z) > ISLAND_R - 1.5) return false;           // ocean rim
    if (z > RIVER.zMin && z < RIVER.zMax && Math.abs(x) < RIVER.halfWidth && !onBridge(x, z)) return false; // river
    for (const o of obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
    }
    return true;
  }
  function groundY(x: number, z: number) {
    if (onBridge(x, z)) {
      const t = (z - BRIDGE.zMin) / (BRIDGE.zMax - BRIDGE.zMin);
      return BRIDGE.peak * Math.sin(Math.PI * t) + 0.18;
    }
    return 0;
  }
  function nearWater(x: number, z: number) {
    const d = Math.hypot(x, z);
    if (d > ISLAND_R - 7) return true;                                     // shore
    if (Math.abs(x) < RIVER.halfWidth) {
      if (z > RIVER.zMax && z < RIVER.zMax + 3.2) return true;             // south bank
      if (z < RIVER.zMin && z > RIVER.zMin - 3.2 && !onBridge(x, z)) return true; // north bank
    }
    return false;
  }
  function castTarget(x: number, z: number) {
    const d = Math.hypot(x, z);
    if (d > ISLAND_R - 7) {
      const k = (ISLAND_R + 4) / d;
      return new THREE.Vector3(x * k, -0.8, z * k);
    }
    return new THREE.Vector3(THREE.MathUtils.clamp(x, -RIVER.halfWidth + 3, RIVER.halfWidth - 3), -0.05, (RIVER.zMin + RIVER.zMax) / 2);
  }

  return {
    obstacles,
    shakables,
    isWalkable,
    groundY,
    nearWater,
    castTarget,
    setCampfireLit,
    tick: (dt, t) => {
      for (const s of shakables) {
        if (s.shakeT > 0) {
          s.shakeT = Math.max(0, s.shakeT - dt);
          const k = s.shakeT;
          s.canopy.rotation.z = Math.sin(k * 40) * 0.14 * k;
          s.canopy.rotation.x = Math.cos(k * 34) * 0.1 * k;
        }
      }
      for (const fn of animated) fn(dt, t);
    },
  };
}
