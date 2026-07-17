import * as THREE from 'three';
import { buildCharacter, animateCharacter, type CharacterRig, type AnimalKind } from './character';
import type { World } from './world';

export interface VillagerDef {
  name: string;
  kind: AnimalKind;
  fur: number;
  furLight: number;
  outfit: number;
  accent: number;
  emoji: string;
  ring: string;
  lines: string[];
}

export interface Villager {
  def: VillagerDef;
  rig: CharacterRig;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  waitUntil: number;
  chatting: boolean;
  metToday: boolean;
}

export const VILLAGER_DEFS: VillagerDef[] = [
  {
    name: '皮皮', kind: 'deer', emoji: '🦌', ring: '#f2b04e',
    fur: 0xb5763e, furLight: 0xe8d3ae, outfit: 0x7a9c59, accent: 0xe88a3c,
    lines: [
      '今天的灯塔看起来特别亮，对吧？',
      '我在河边找到一片四叶草，今天运气真好！',
      '总有一天我要把整个小岛画下来，等着瞧！',
      '比赛跑到那棵大棕榈树！……好吧，下次吧。',
    ],
  },
  {
    name: '饼干', kind: 'dog', emoji: '🐶', ring: '#8fd0f2',
    fur: 0xf0e6d2, furLight: 0xffffff, outfit: 0xd98f4e, accent: 0x5b7ec9,
    lines: [
      '我正打算打扫卫生——要来帮忙吗？',
      '你总能让小岛变得亮堂堂的！',
      '我在果园附近埋了个宝贝……但忘了埋哪儿了。',
      '嗅嗅……你也闻到新鲜苹果的香味了吗？',
    ],
  },
  {
    name: '朵朵', kind: 'sheep', emoji: '🐑', ring: '#f29ec4',
    fur: 0xd9c8a8, furLight: 0xf7f2e4, outfit: 0x9ec9e8, accent: 0xf27ba0,
    lines: [
      '郁金香今早开了，我惊喜得叫了两声。',
      '软软的云、软软的草、软软的毛，完美。',
      '我烤了苹果派！好吧……是看着它烤的。',
      '现在在河边打个盹，一定很舒服。',
    ],
  },
  {
    name: '可可', kind: 'bear', emoji: '🐻', ring: '#a8d88a',
    fur: 0x8a5a33, furLight: 0xd9b48a, outfit: 0xc96a5b, accent: 0x6fbf5a,
    lines: [
      '我今天举起了一块大石头。下面啥也没有，但还是好爽。',
      '钓鱼秘诀：等鱼的时候动动脚趾头，信我。',
      '天黑之后，篝火边是我最喜欢的地方。',
      '摇树捡到了好东西要分我哦，分享才是好朋友。',
    ],
  },
];

export function createVillagers(scene: THREE.Scene, world: World): Villager[] {
  const spawn = [
    new THREE.Vector3(-6, 0, 30),
    new THREE.Vector3(7, 0, 31),
    new THREE.Vector3(-14, 0, 22),
    new THREE.Vector3(14, 0, 24),
  ];
  return VILLAGER_DEFS.map((def, i) => {
    const rig = buildCharacter(def.kind, {
      fur: def.fur, furLight: def.furLight, outfit: def.outfit, accent: def.accent,
    });
    rig.group.scale.setScalar(0.92);
    scene.add(rig.group);
    const pos = spawn[i].clone();
    const v: Villager = {
      def, rig, pos,
      target: pos.clone(),
      waitUntil: Math.random() * 3,
      chatting: false,
      metToday: false,
    };
    pickTarget(v, world);
    return v;
  });
}

function pickTarget(v: Villager, world: World) {
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * 12;
    const x = THREE.MathUtils.clamp(v.pos.x + Math.cos(a) * d, -30, 30);
    const z = THREE.MathUtils.clamp(v.pos.z + Math.sin(a) * d, 15.5, 42);
    if (world.isWalkable(x, z)) {
      v.target.set(x, 0, z);
      return;
    }
  }
  v.target.copy(v.pos);
}

export function updateVillagers(villagers: Villager[], world: World, dt: number, t: number) {
  for (const v of villagers) {
    const rig = v.rig;
    if (v.chatting) {
      animateCharacter(rig, dt, 0, t);
      rig.group.position.copy(v.pos);
      continue;
    }
    const to = new THREE.Vector3().subVectors(v.target, v.pos);
    to.y = 0;
    const dist = to.length();
    let speed = 0;
    if (dist > 0.3) {
      speed = 0.32;
      const step = to.normalize().multiplyScalar(1.7 * dt);
      const nx = v.pos.x + step.x;
      const nz = v.pos.z + step.z;
      if (world.isWalkable(nx, nz)) {
        v.pos.set(nx, 0, nz);
      } else {
        pickTarget(v, world);
      }
      const desired = Math.atan2(step.x, step.z);
      rig.group.rotation.y = dampAngle(rig.group.rotation.y, desired, 8, dt);
    } else if (t > v.waitUntil) {
      v.waitUntil = t + 2 + Math.random() * 5;
      pickTarget(v, world);
    }
    rig.group.position.copy(v.pos);
    rig.group.position.y = world.groundY(v.pos.x, v.pos.z);
    animateCharacter(rig, dt, speed, t + v.pos.x);
  }
}

export function dampAngle(cur: number, target: number, lambda: number, dt: number) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}
