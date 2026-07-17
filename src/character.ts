import * as THREE from 'three';

export interface CharacterRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  walkT: number;
}

export type AnimalKind = 'dog' | 'deer' | 'sheep' | 'bear' | 'cat';

interface Palette {
  fur: number;
  furLight: number;
  outfit: number;
  accent: number; // bandana / accessory
}

function mat(color: number) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

function sphere(r: number, color: number, w = 7, h = 6) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat(color));
}

/** Builds a chibi animal villager/player character (~1.5 units tall). */
export function buildCharacter(kind: AnimalKind, p: Palette): CharacterRig {
  const g = new THREE.Group();

  // ---- legs ----
  const legGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.34, 6);
  const legL = new THREE.Group(); const legR = new THREE.Group();
  const legMeshL = new THREE.Mesh(legGeo, mat(p.fur));
  const legMeshR = new THREE.Mesh(legGeo, mat(p.fur));
  legMeshL.position.y = -0.17; legMeshR.position.y = -0.17;
  const footGeo = new THREE.SphereGeometry(0.11, 6, 5);
  const footL = new THREE.Mesh(footGeo, mat(p.furLight)); footL.scale.set(1, 0.6, 1.3); footL.position.set(0, -0.33, 0.04);
  const footR = footL.clone();
  legL.add(legMeshL, footL); legR.add(legMeshR, footR);
  legL.position.set(-0.16, 0.36, 0); legR.position.set(0.16, 0.36, 0);
  g.add(legL, legR);

  // ---- body (outfit) ----
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 7), mat(p.outfit));
  body.scale.set(1, 1.05, 0.9);
  body.position.y = 0.72;
  body.castShadow = true;
  g.add(body);
  // belly patch
  const belly = sphere(0.3, p.furLight);
  belly.scale.set(0.85, 0.95, 0.55);
  belly.position.set(0, 0.68, 0.24);
  g.add(belly);

  // ---- arms ----
  const armGeo = new THREE.CapsuleGeometry(0.085, 0.24, 3, 6);
  const armL = new THREE.Group(); const armR = new THREE.Group();
  const armMeshL = new THREE.Mesh(armGeo, mat(p.outfit));
  const armMeshR = new THREE.Mesh(armGeo, mat(p.outfit));
  armMeshL.position.y = -0.16; armMeshR.position.y = -0.16;
  const pawGeo = new THREE.SphereGeometry(0.09, 6, 5);
  const pawL = new THREE.Mesh(pawGeo, mat(p.fur)); pawL.position.y = -0.34;
  const pawR = pawL.clone();
  armL.add(armMeshL, pawL); armR.add(armMeshR, pawR);
  armL.position.set(-0.44, 0.98, 0); armR.position.set(0.44, 0.98, 0);
  armL.rotation.z = 0.25; armR.rotation.z = -0.25;
  g.add(armL, armR);

  // ---- head ----
  const head = new THREE.Group();
  head.position.y = 1.32;
  const skull = sphere(0.46, p.fur, 9, 8);
  skull.castShadow = true;
  head.add(skull);

  // muzzle
  const muzzle = sphere(0.2, p.furLight, 7, 6);
  muzzle.scale.set(1.25, 0.85, 1);
  muzzle.position.set(0, -0.12, 0.38);
  head.add(muzzle);
  const nose = sphere(0.07, 0x3a2a22, 6, 5);
  nose.position.set(0, -0.05, 0.55);
  head.add(nose);

  // eyes
  const eyeGeo = new THREE.SphereGeometry(0.055, 6, 5);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a1e18, roughness: 0.4 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.18, 0.08, 0.4);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.18;
  const sparkGeo = new THREE.SphereGeometry(0.018, 4, 4);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const spL = new THREE.Mesh(sparkGeo, sparkMat); spL.position.set(-0.165, 0.1, 0.445);
  const spR = spL.clone(); spR.position.x = 0.195;
  head.add(eyeL, eyeR, spL, spR);

  // brows
  const browGeo = new THREE.BoxGeometry(0.11, 0.03, 0.02);
  const browL = new THREE.Mesh(browGeo, mat(0x6b4a33)); browL.position.set(-0.18, 0.2, 0.42); browL.rotation.z = 0.15;
  const browR = browL.clone(); browR.position.x = 0.18; browR.rotation.z = -0.15;
  head.add(browL, browR);

  // ---- per-animal features ----
  if (kind === 'dog') {
    const earGeo = new THREE.CapsuleGeometry(0.1, 0.22, 3, 6);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.32, 0.32, 0); earL.rotation.z = 0.7;
    const earR = earL.clone(); earR.position.x = 0.32; earR.rotation.z = -0.7;
    head.add(earL, earR);
    // cream tuft
    const tuft = sphere(0.16, p.furLight, 6, 5);
    tuft.scale.set(1.2, 0.8, 1.2);
    tuft.position.set(0, 0.42, 0.08);
    head.add(tuft);
  } else if (kind === 'deer') {
    const earGeo = new THREE.ConeGeometry(0.11, 0.28, 5);
    const earL = new THREE.Mesh(earGeo, mat(p.fur));
    earL.position.set(-0.34, 0.3, 0); earL.rotation.z = 0.9;
    const earR = earL.clone(); earR.position.x = 0.34; earR.rotation.z = -0.9;
    head.add(earL, earR);
    const antGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.34, 5);
    const antMat = mat(0xd9c9a8);
    const antL = new THREE.Mesh(antGeo, antMat); antL.position.set(-0.16, 0.5, 0); antL.rotation.z = 0.35;
    const antL2 = new THREE.Mesh(antGeo, antMat); antL2.scale.setScalar(0.7); antL2.position.set(-0.24, 0.58, 0); antL2.rotation.z = 1.1;
    const antR = antL.clone(); antR.position.x = 0.16; antR.rotation.z = -0.35;
    const antR2 = antL2.clone(); antR2.position.x = 0.24; antR2.rotation.z = -1.1;
    head.add(antL, antL2, antR, antR2);
  } else if (kind === 'sheep') {
    const woolMat = mat(0xf7f2e4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), woolMat);
      w.position.set(Math.cos(a) * 0.26, 0.36 + Math.sin(a * 2) * 0.03, Math.sin(a) * 0.2);
      head.add(w);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), woolMat);
    top.position.set(0, 0.44, 0);
    head.add(top);
    const earGeo = new THREE.SphereGeometry(0.1, 6, 5);
    const earL = new THREE.Mesh(earGeo, mat(p.fur)); earL.scale.set(1.4, 0.7, 0.9);
    earL.position.set(-0.4, 0.1, 0);
    const earR = earL.clone(); earR.position.x = 0.4;
    head.add(earL, earR);
  } else if (kind === 'bear') {
    const earGeo = new THREE.SphereGeometry(0.14, 6, 5);
    const earL = new THREE.Mesh(earGeo, mat(p.fur)); earL.position.set(-0.3, 0.34, 0);
    const earR = earL.clone(); earR.position.x = 0.3;
    const inGeo = new THREE.SphereGeometry(0.07, 5, 4);
    const inL = new THREE.Mesh(inGeo, mat(p.furLight)); inL.position.set(-0.3, 0.34, 0.08);
    const inR = inL.clone(); inR.position.x = 0.3;
    head.add(earL, earR, inL, inR);
  } else if (kind === 'cat') {
    const earGeo = new THREE.ConeGeometry(0.13, 0.24, 4);
    const earL = new THREE.Mesh(earGeo, mat(p.fur)); earL.position.set(-0.26, 0.42, 0); earL.rotation.z = 0.2;
    const earR = earL.clone(); earR.position.x = 0.26; earR.rotation.z = -0.2;
    head.add(earL, earR);
  }

  // bandana
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 6, 12), mat(p.accent));
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.06;
  g.add(band);
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 4), mat(p.accent));
  knot.position.set(0.24, 1.0, -0.28);
  knot.rotation.z = -0.5;
  g.add(knot);

  g.add(head);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });

  return { group: g, body, head, armL, armR, legL, legR, walkT: 0 };
}

/** Animate walking / idle. speed 0..1 */
export function animateCharacter(rig: CharacterRig, dt: number, speed: number, t: number) {
  const target = speed > 0.05 ? rig.walkT + dt * (6 + speed * 6) : rig.walkT;
  rig.walkT = target;
  const s = Math.sin(rig.walkT);
  const amp = speed > 0.05 ? 0.55 * Math.min(1, speed) : 0;
  rig.legL.rotation.x = s * amp;
  rig.legR.rotation.x = -s * amp;
  rig.armL.rotation.x = -s * amp * 0.8;
  rig.armR.rotation.x = s * amp * 0.8;
  // bob & idle breath
  const bob = speed > 0.05 ? Math.abs(Math.sin(rig.walkT)) * 0.06 : Math.sin(t * 2.2) * 0.012;
  rig.body.position.y = 0.72 + bob;
  rig.head.position.y = 1.32 + bob * 1.1 + (speed <= 0.05 ? Math.sin(t * 1.6) * 0.008 : 0);
  // subtle head sway
  rig.head.rotation.y = speed <= 0.05 ? Math.sin(t * 0.7) * 0.12 : 0;
}
