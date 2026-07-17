import * as THREE from 'three';
import { buildCharacter, animateCharacter, type CharacterRig } from './character';
import { buildWorld, type World, type ShakeTarget, PLAZA } from './world';
import { createVillagers, updateVillagers, dampAngle, type Villager } from './villagers';
import { sfx } from './audio';

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  clock: $('clock'), bells: $('bells'), apples: $('apples'), efill: $('efill'),
  tasksList: $('tasks-list'), prompt: $('prompt'), promptText: $('prompt-text'),
  toasts: $('toasts'), dialog: $('dialog'), dialogName: $('dialog-name'),
  dialogText: $('dialog-text'), banner: $('banner'), villagerBar: $('villager-bar'),
  bagPanel: $('bag-panel'), bagItems: $('bag-items'), helpPanel: $('help-panel'),
  stick: $('stick'), stickNub: $('stick-nub'), touchE: $('touch-e'),
};

// ---------- types ----------
interface Task { id: string; label: string; done: boolean; li?: HTMLLIElement }
type FishState = 'idle' | 'casting' | 'waiting' | 'bite' | 'caught';
interface Drop {
  mesh: THREE.Mesh;
  kind: 'apple' | 'branch';
  vel: THREE.Vector3;
  state: 'fall' | 'ground' | 'magnet';
  t: number;
}
const FISH_TABLE = [
  { id: 'seabass', name: '鲈鱼', emoji: '🐟', bells: 30, w: 0.3 },
  { id: 'carp', name: '鲤鱼', emoji: '🐠', bells: 18, w: 0.3 },
  { id: 'koi', name: '锦鲤', emoji: '🎏', bells: 24, w: 0.2 },
  { id: 'goldfish', name: '金鱼', emoji: '✨', bells: 40, w: 0.12 },
  { id: 'boot', name: '旧靴子', emoji: '🥾', bells: 1, w: 0.08 },
];

export class Game {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;

  player: CharacterRig;
  playerPos = new THREE.Vector3(0, 0, 27);
  playerVel = new THREE.Vector3();
  playerSpeed = 0;

  villagers: Villager[];

  // camera rig
  camYaw = 0; // camera south of player, looking north toward the village
  camPitch = 0.52;
  camDist = 9;
  camPos = new THREE.Vector3();

  // input
  keys = new Set<string>();
  joy = new THREE.Vector2();
  dragging = false;

  // state
  bells = 65;
  apples = 0;
  branches = 0;
  fishLog: string[] = [];
  energy = 100;
  clockMin = 8 * 60;
  t = 0;
  started = false;

  tasks: Task[] = [
    { id: 'fish', label: '钓一条鱼 🎣', done: false },
    { id: 'shake', label: '摇树捡一个掉落物 🌳', done: false },
    { id: 'talk', label: '和村民聊聊天 💬', done: false },
  ];
  partyTaskAdded = false;
  partyDone = false;

  // interaction
  promptAction: (() => void) | null = null;

  // dialogue
  dialogVillager: Villager | null = null;
  dialogLinesLeft = 0;

  // fishing
  fishState: FishState = 'idle';
  fishTimer = 0;
  bobber: THREE.Group;
  rod: THREE.Group;
  line: THREE.Line;
  fishMesh: THREE.Group | null = null;
  biteTimeout = 0;
  castFrom = new THREE.Vector3();
  castTo = new THREE.Vector3();
  ripple: THREE.Mesh;
  fishShadow: THREE.Mesh;

  drops: Drop[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 800);
    this.world = buildWorld(this.scene);

    // player — the little brown pup explorer
    this.player = buildCharacter('dog', {
      fur: 0x9a6a42, furLight: 0xe8d3ae, outfit: 0xc9b489, accent: 0x6fbf5a,
    });
    this.player.group.rotation.y = Math.PI; // face the village at spawn
    this.scene.add(this.player.group);

    this.villagers = createVillagers(this.scene, this.world);

    // fishing gear (hidden until casting)
    this.bobber = this.buildBobber();
    this.bobber.visible = false;
    this.scene.add(this.bobber);
    this.rod = this.buildRod();
    this.rod.visible = false;
    this.scene.add(this.rod);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xfffdf0, transparent: true, opacity: 0.85 }));
    this.line.visible = false;
    this.scene.add(this.line);
    this.ripple = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.045, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    );
    this.ripple.rotation.x = Math.PI / 2;
    this.scene.add(this.ripple);
    // dark fish silhouette under the bobber, like the reference clip
    this.fishShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 12),
      new THREE.MeshBasicMaterial({ color: 0x155a78, transparent: true, opacity: 0 })
    );
    this.fishShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.fishShadow);

    this.buildVillagerBar();
    this.renderTasks();
    this.bindInput(canvas);
    this.syncHud();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // ================= setup =================
  buildBobber() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    top.scale.y = 0.8; top.position.y = 0.06;
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8403a, roughness: 0.5 }));
    bot.scale.y = 0.8; bot.position.y = -0.04;
    g.add(top, bot);
    return g;
  }

  buildRod() {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x7a4f2a, roughness: 0.8 }));
    rod.position.y = 1.3;
    g.add(rod);
    return g;
  }

  buildVillagerBar() {
    for (const v of this.villagers) {
      const chip = document.createElement('div');
      chip.className = 'vchip';
      chip.id = `vchip-${v.def.name}`;
      chip.innerHTML = `<div class="vface" style="--ring:${v.def.ring}">${v.def.emoji}</div><div class="vname">${v.def.name}</div>`;
      ui.villagerBar.appendChild(chip);
    }
  }

  bindInput(canvas: HTMLCanvasElement) {
    const unlock = () => sfx.unlock();
    addEventListener('keydown', (e) => {
      unlock();
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'e') this.interact();
      if (k === 'f') this.eatApple();
      if (k === 'escape') this.closePanels();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    // orbit camera
    let lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      unlock();
      this.dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      this.camYaw -= dx * 0.006;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.15, 1.05);
    });
    canvas.addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('wheel', (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.01, 5.5, 15);
    }, { passive: true });

    // buttons
    $('btn-bag').onclick = () => { this.togglePanel(ui.bagPanel); this.renderBag(); };
    $('btn-help').onclick = () => this.togglePanel(ui.helpPanel);
    $('btn-map').onclick = () => { this.toast('小岛不大——肯定不会迷路！🗺️'); };
    $('btn-reset').onclick = () => {
      this.playerPos.set(0, 0, 27);
      this.camYaw = 0;
      this.player.group.rotation.y = Math.PI;
      this.toast('回到广场 🏕️');
    };
    ui.dialog.onclick = () => this.advanceDialog();

    // touch controls
    if ('ontouchstart' in window) {
      ui.touchE.classList.remove('hidden');
      ui.touchE.addEventListener('touchstart', (e) => { e.preventDefault(); unlock(); this.interact(); });
      const stickZone = ui.stick;
      let stickId: number | null = null;
      const center = { x: 0, y: 0 };
      addEventListener('touchstart', (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.4 && stickId === null) {
            stickId = t.identifier;
            center.x = t.clientX; center.y = t.clientY;
            stickZone.classList.remove('hidden');
            stickZone.style.left = `${center.x - 55}px`;
            stickZone.style.top = `${center.y - 55}px`;
            stickZone.style.bottom = 'auto';
          }
        }
      });
      addEventListener('touchmove', (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === stickId) {
            const dx = THREE.MathUtils.clamp((t.clientX - center.x) / 45, -1, 1);
            const dy = THREE.MathUtils.clamp((t.clientY - center.y) / 45, -1, 1);
            this.joy.set(dx, dy);
            ui.stickNub.style.transform = `translate(calc(-50% + ${dx * 28}px), calc(-50% + ${dy * 28}px))`;
          }
        }
      }, { passive: true });
      const endTouch = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === stickId) {
            stickId = null;
            this.joy.set(0, 0);
            stickZone.classList.add('hidden');
            ui.stickNub.style.transform = 'translate(-50%, -50%)';
          }
        }
      };
      addEventListener('touchend', endTouch);
      addEventListener('touchcancel', endTouch);
    }
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ================= HUD =================
  syncHud() {
    ui.bells.textContent = String(this.bells);
    ui.apples.textContent = String(this.apples);
    ui.efill.style.width = `${this.energy}%`;
    const h = Math.floor(this.clockMin / 60) % 24;
    const m = Math.floor(this.clockMin % 60);
    ui.clock.textContent = `${h}:${m.toString().padStart(2, '0')}`;
  }

  toast(text: string, gold = false, life = 2.4) {
    const el = document.createElement('div');
    el.className = gold ? 'toast gold' : 'toast';
    el.style.setProperty('--life', `${life}s`);
    el.textContent = text;
    ui.toasts.appendChild(el);
    setTimeout(() => el.remove(), (life + 0.4) * 1000);
  }

  renderTasks() {
    ui.tasksList.innerHTML = '';
    for (const task of this.tasks) {
      const li = document.createElement('li');
      li.className = task.done ? 'done' : '';
      li.innerHTML = `<span class="box">${task.done ? '✔' : ''}</span><span class="label">${task.label}</span>`;
      task.li = li;
      ui.tasksList.appendChild(li);
    }
  }

  completeTask(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || task.done) return;
    task.done = true;
    this.bells += 25;
    this.renderTasks();
    task.li?.classList.add('flash');
    this.toast('✔ 任务完成！+🔔25', true);
    sfx.taskDone();
    sfx.bell();
    this.syncHud();
    if (!this.partyTaskAdded && this.tasks.every((t) => t.done)) {
      this.partyTaskAdded = true;
      setTimeout(() => {
        this.tasks.push({ id: 'party', label: '回中央广场参加庆祝 🎉', done: false });
        this.renderTasks();
        this.toast('🎉 任务全部完成！去广场集合！', true, 3.2);
        sfx.fanfare();
      }, 900);
    }
  }

  togglePanel(p: HTMLElement) {
    const wasHidden = p.classList.contains('hidden');
    this.closePanels();
    if (wasHidden) p.classList.remove('hidden');
  }
  closePanels() {
    ui.bagPanel.classList.add('hidden');
    ui.helpPanel.classList.add('hidden');
  }

  renderBag() {
    const fishCounts = new Map<string, number>();
    for (const f of this.fishLog) fishCounts.set(f, (fishCounts.get(f) ?? 0) + 1);
    const rows: string[] = [];
    rows.push(`<div class="row"><span>🔔 铃钱</span><span>${this.bells}</span></div>`);
    rows.push(`<div class="row"><span>🍎 苹果</span><span>${this.apples}</span></div>`);
    rows.push(`<div class="row"><span>🌿 树枝</span><span>${this.branches}</span></div>`);
    if (fishCounts.size === 0) rows.push(`<div class="row"><span>🎣 鱼获</span><span>—</span></div>`);
    for (const [name, n] of fishCounts) rows.push(`<div class="row"><span>🐟 ${name}</span><span>×${n}</span></div>`);
    ui.bagItems.innerHTML = rows.join('');
  }

  eatApple() {
    if (this.apples <= 0) { this.toast('没有苹果啦！去摇苹果树 🍎'); return; }
    if (this.energy >= 100) { this.toast('体力已满 💛'); return; }
    this.apples--;
    this.energy = Math.min(100, this.energy + 30);
    sfx.eat();
    this.toast('好吃！体力 +30 🍎');
    this.syncHud();
  }

  // ================= dialogue =================
  openDialog(v: Villager) {
    this.dialogVillager = v;
    v.chatting = true;
    // face each other
    const dirTo = new THREE.Vector3().subVectors(this.playerPos, v.pos);
    v.rig.group.rotation.y = Math.atan2(dirTo.x, dirTo.z);
    this.player.group.rotation.y = Math.atan2(-dirTo.x, -dirTo.z);
    this.dialogLinesLeft = 1 + Math.floor(Math.random() * 2);
    this.showDialogLine(v);
    if (!v.metToday) {
      v.metToday = true;
      document.getElementById(`vchip-${v.def.name}`)?.classList.add('met');
      this.bells += 2;
      this.completeTask('talk');
    } else {
      this.bells += 2;
      this.syncHud();
    }
  }

  showDialogLine(v: Villager) {
    ui.dialogName.textContent = v.def.name;
    ui.dialogText.textContent = v.def.lines[Math.floor(Math.random() * v.def.lines.length)];
    ui.dialog.classList.remove('hidden');
    sfx.talk();
  }

  advanceDialog() {
    if (!this.dialogVillager) return;
    if (this.dialogLinesLeft > 0) {
      this.dialogLinesLeft--;
      this.showDialogLine(this.dialogVillager);
    } else {
      this.dialogVillager.chatting = false;
      this.dialogVillager = null;
      ui.dialog.classList.add('hidden');
    }
  }

  // ================= interactions =================
  interact() {
    if (this.dialogVillager) { this.advanceDialog(); return; }
    // fishing has priority for E
    if (this.fishState === 'bite') { this.reelIn(true); return; }
    if (this.fishState === 'waiting' || this.fishState === 'casting') { this.reelIn(false); return; }
    if (this.fishState === 'caught') return;
    this.promptAction?.();
  }

  updatePrompt() {
    if (this.dialogVillager || this.fishState !== 'idle') {
      ui.prompt.classList.add('hidden');
      this.promptAction = null;
      return;
    }
    const p = this.playerPos;
    // nearest villager
    let bestV: Villager | null = null;
    let bestD = 2.6;
    for (const v of this.villagers) {
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bestD) { bestD = d; bestV = v; }
    }
    if (bestV) {
      ui.promptText.textContent = `和 ${bestV.def.name} 聊天 💬`;
      ui.prompt.classList.remove('hidden');
      this.promptAction = () => this.openDialog(bestV);
      return;
    }
    // nearest shakable tree
    let bestT: ShakeTarget | null = null;
    bestD = 2.8;
    for (const s of this.world.shakables) {
      if (s.cooldownUntil > this.t) continue;
      const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
      if (d < bestD) { bestD = d; bestT = s; }
    }
    if (bestT) {
      ui.promptText.textContent = '摇树 🌳';
      ui.prompt.classList.remove('hidden');
      this.promptAction = () => this.shakeTree(bestT);
      return;
    }
    // water
    if (this.world.nearWater(p.x, p.z)) {
      ui.promptText.textContent = '抛竿 🎣';
      ui.prompt.classList.remove('hidden');
      this.promptAction = () => this.startFishing();
      return;
    }
    ui.prompt.classList.add('hidden');
    this.promptAction = null;
  }

  // ================= shaking =================
  shakeTree(s: ShakeTarget) {
    s.shakeT = 0.7;
    s.cooldownUntil = this.t + 24;
    sfx.rustle();
    this.energy = Math.max(0, this.energy - 4);
    // face the tree
    const dir = new THREE.Vector3().subVectors(s.pos, this.playerPos);
    this.player.group.rotation.y = Math.atan2(dir.x, dir.z);

    if (s.kind === 'apple') {
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 7, 6),
          new THREE.MeshStandardMaterial({ color: 0xe8403a, flatShading: true })
        );
        mesh.castShadow = true;
        mesh.position.copy(s.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 3 + Math.random(), (Math.random() - 0.5) * 1.6));
        this.scene.add(mesh);
        this.drops.push({
          mesh, kind: 'apple',
          vel: new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random(), (Math.random() - 0.5) * 2.4),
          state: 'fall', t: 0,
        });
      }
      s.fruits.forEach((f) => (f.visible = false));
      setTimeout(() => s.fruits.forEach((f) => (f.visible = true)), 24000);
    } else {
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.09, 0.5, 3, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a5a33, flatShading: true })
      );
      mesh.castShadow = true;
      mesh.rotation.z = Math.PI / 2;
      mesh.position.copy(s.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 3.2, (Math.random() - 0.5) * 1.4));
      this.scene.add(mesh);
      this.drops.push({
        mesh, kind: 'branch',
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2),
        state: 'fall', t: 0,
      });
    }
    this.completeTask('shake');
    this.syncHud();
  }

  updateDrops(dt: number) {
    for (const d of this.drops) {
      if (d.state === 'fall') {
        d.vel.y -= 12 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += dt * 4;
        if (d.mesh.position.y <= 0.15) {
          d.mesh.position.y = 0.15;
          if (Math.abs(d.vel.y) > 2) { d.vel.y = -d.vel.y * 0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; sfx.thud(); }
          else { d.state = 'ground'; d.t = this.t; }
        }
      } else if (d.state === 'ground') {
        if (this.t - d.t > 0.7) d.state = 'magnet';
      } else {
        const target = this.playerPos.clone().add(new THREE.Vector3(0, 0.9, 0));
        d.mesh.position.lerp(target, 1 - Math.exp(-8 * dt));
        d.mesh.scale.multiplyScalar(1 - dt * 2);
        if (d.mesh.position.distanceTo(target) < 0.35) {
          d.state = 'fall'; // mark for removal below
          d.t = -999;
          this.scene.remove(d.mesh);
          if (d.kind === 'apple') {
            this.apples++;
            this.bells += 6;
            this.toast('+1 🍎  +🔔6');
          } else {
            this.branches++;
            this.toast(`🌿 捡到树枝（${this.branches}）`);
          }
          sfx.pop();
          this.syncHud();
        }
      }
    }
    this.drops = this.drops.filter((d) => d.t !== -999);
  }

  // ================= fishing =================
  startFishing() {
    this.fishState = 'casting';
    this.fishTimer = 0;
    this.castFrom.copy(this.playerPos);
    this.castTo.copy(this.world.castTarget(this.playerPos.x, this.playerPos.z));
    // face the water
    const dir = new THREE.Vector3().subVectors(this.castTo, this.playerPos);
    this.player.group.rotation.y = Math.atan2(dir.x, dir.z);
    this.rod.visible = true;
    this.line.visible = true;
    this.bobber.visible = true;
    sfx.reel();
  }

  updateFishing(dt: number) {
    if (this.fishState === 'idle') return;
    this.fishTimer += dt;
    const rodBase = this.playerPos.clone().add(new THREE.Vector3(0, 1.15, 0));
    // rod follows player facing
    const yaw = this.player.group.rotation.y;
    this.rod.position.copy(rodBase);
    this.rod.rotation.set(0.9, yaw, 0, 'YXZ');
    const rodTip = rodBase.clone().add(new THREE.Vector3(Math.sin(yaw) * 1.9, 1.35, Math.cos(yaw) * 1.9));

    if (this.fishState === 'casting') {
      const k = Math.min(1, this.fishTimer / 0.55);
      const arc = Math.sin(k * Math.PI) * 1.6;
      this.bobber.position.lerpVectors(this.castFrom.clone().add(new THREE.Vector3(0, 1.2, 0)), this.castTo, k);
      this.bobber.position.y += arc;
      if (k >= 1) {
        this.fishState = 'waiting';
        this.fishTimer = 0;
        this.biteTimeout = 1.4 + Math.random() * 2.4;
        sfx.splash();
      }
    } else if (this.fishState === 'waiting') {
      this.bobber.position.y = this.castTo.y + Math.sin(this.t * 2.4) * 0.05;
      // fish silhouette cruises in toward the bobber
      const sm = this.fishShadow.material as THREE.MeshBasicMaterial;
      sm.opacity = Math.min(0.42, sm.opacity + dt * 0.5);
      this.fishShadow.position.set(
        this.bobber.position.x + Math.sin(this.t * 1.7) * 0.5,
        this.castTo.y + 0.03,
        this.bobber.position.z + Math.cos(this.t * 1.3) * 0.4
      );
      this.fishShadow.scale.setScalar(1 + Math.sin(this.t * 2.1) * 0.15);
      if (this.fishTimer > this.biteTimeout) {
        this.fishState = 'bite';
        this.fishTimer = 0;
        this.toast('❗ 有鱼咬钩！按 E', true, 1.2);
        sfx.bite();
      }
    } else if (this.fishState === 'bite') {
      this.bobber.position.y = this.castTo.y - 0.18 + Math.sin(this.t * 30) * 0.06;
      // ripple
      const rm = this.ripple.material as THREE.MeshBasicMaterial;
      rm.opacity = 0.8;
      this.ripple.position.copy(this.bobber.position).y = this.castTo.y + 0.05;
      this.ripple.scale.setScalar(1 + Math.sin(this.t * 12) * 0.4);
      if (this.fishTimer > 1.15) {
        this.escapedFish();
      }
    } else if (this.fishState === 'caught') {
      const rm = this.ripple.material as THREE.MeshBasicMaterial;
      rm.opacity = Math.max(0, rm.opacity - dt * 2);
      if (this.fishMesh) {
        // flop around on the ground
        this.fishMesh.rotation.z = Math.sin(this.t * 22) * 0.7;
        this.fishMesh.position.y = 0.25 + Math.abs(Math.sin(this.t * 11)) * 0.25;
      }
      if (this.fishTimer > 1.25) {
        this.finishCatch();
      }
    }
    // fishing line
    const pts = [rodTip, this.bobber.position.clone()];
    this.line.geometry.setFromPoints(pts);
    // fade the silhouette out when not waiting for a bite
    if (this.fishState !== 'waiting') {
      const sm = this.fishShadow.material as THREE.MeshBasicMaterial;
      sm.opacity = Math.max(0, sm.opacity - dt * 1.5);
    }
  }

  reelIn(hit: boolean) {
    if (!hit) {
      // reeled in too early
      this.endFishing();
      this.toast('收竿太早了… 🎣');
      return;
    }
    // success!
    const roll = Math.random();
    let acc = 0;
    let species = FISH_TABLE[0];
    for (const f of FISH_TABLE) { acc += f.w; if (roll <= acc) { species = f; break; } }
    this.fishState = 'caught';
    this.fishTimer = 0;
    this.fishLog.push(species.name);
    this.bells += species.bells;
    this.energy = Math.max(0, this.energy - 3);
    sfx.splash();
    sfx.taskDone();
    // spawn flopping fish next to player
    this.fishMesh = this.buildFishMesh();
    const side = new THREE.Vector3(Math.sin(this.player.group.rotation.y + 1.2), 0, Math.cos(this.player.group.rotation.y + 1.2));
    this.fishMesh.position.copy(this.playerPos).addScaledVector(side, 1.1);
    this.fishMesh.position.y = 0.25;
    this.scene.add(this.fishMesh);
    (this.ripple.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.ripple.position.copy(this.bobber.position);
    if (species.id === 'boot') this.toast('🥾 钓到一只旧靴子…总比空军强！+🔔1', false, 3);
    else this.toast(`${species.emoji} 钓到了${species.name}！+🔔${species.bells}`, true, 3);
    this.completeTask('fish');
    this.syncHud();
  }

  escapedFish() {
    this.endFishing();
    this.toast('鱼跑掉了… 🐟');
  }

  finishCatch() {
    if (this.fishMesh) {
      this.scene.remove(this.fishMesh);
      this.fishMesh = null;
    }
    this.endFishing();
  }

  endFishing() {
    this.fishState = 'idle';
    this.bobber.visible = false;
    this.rod.visible = false;
    this.line.visible = false;
    (this.ripple.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.fishShadow.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  buildFishMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9a6b42, flatShading: true, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), bodyMat);
    body.scale.set(1.5, 0.75, 0.55);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 4), bodyMat);
    tail.position.x = -0.55;
    tail.rotation.z = -Math.PI / 2;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    eye.position.set(0.3, 0.08, 0.16);
    const eye2 = eye.clone(); eye2.position.z = -0.16;
    g.add(body, tail, eye, eye2);
    g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    return g;
  }

  // ================= party =================
  checkParty() {
    if (!this.partyTaskAdded || this.partyDone) return;
    if (Math.hypot(this.playerPos.x - PLAZA.x, this.playerPos.z - PLAZA.z) < 4.2) {
      this.partyDone = true;
      const task = this.tasks.find((t) => t.id === 'party');
      if (task) { task.done = true; this.renderTasks(); }
      this.bells += 50;
      this.world.setCampfireLit(true); // light the campfire for the celebration
      sfx.fanfare();
      this.confetti();
      ui.banner.innerHTML = `完美的小岛日！☀️<small>任务全部完成 · +🔔50 · 村民们都聚到了篝火旁</small>`;
      ui.banner.classList.remove('hidden');
      setTimeout(() => ui.banner.classList.add('hidden'), 5200);
      this.toast('🎉 +🔔50 庆祝奖励！', true, 3);
      // villagers gather around the campfire
      this.villagers.forEach((v, i) => {
        const a = (i / this.villagers.length) * Math.PI * 2;
        v.target.set(PLAZA.x + Math.cos(a) * 3.4, 0, PLAZA.z + Math.sin(a) * 3.4);
      });
      this.syncHud();
    }
  }

  confetti() {
    const colors = ['#f2a65a', '#6fbf5a', '#5b7ec9', '#f27ba0', '#ffd23e', '#8fd0f2'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--t', `${2.2 + Math.random() * 2.4}s`);
      c.style.animationDelay = `${Math.random() * 0.9}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 6000);
    }
  }

  // ================= main loop =================
  update(dt: number) {
    this.t += dt;
    this.clockMin += dt / 1.2; // 1 game-minute every ~1.2s
    if (!this.started && this.t > 0.9) {
      this.started = true;
      this.toast('欢迎来到悠然小岛！🌱 去完成今日任务吧', true, 3.5);
    }

    // ----- movement -----
    const input = new THREE.Vector2(
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0),
      (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0)
    );
    if (this.joy.lengthSq() > 0.01) input.set(this.joy.x, this.joy.y);
    const busy = this.dialogVillager !== null || this.fishState !== 'idle';
    let speedTarget = 0;
    if (!busy && input.lengthSq() > 0.001) {
      input.normalize();
      speedTarget = this.energy <= 0 ? 3.2 : 5.4;
      this.energy = Math.max(0, this.energy - dt * 0.55);
    }
    this.playerSpeed = THREE.MathUtils.damp(this.playerSpeed, speedTarget, 8, dt);

    if (input.lengthSq() > 0.001 && !busy) {
      // camera-relative movement
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      const mx = input.x * cos - input.y * sin;
      const mz = input.x * sin + input.y * cos;
      const step = this.playerSpeed * dt;
      const nx = this.playerPos.x + mx * step;
      const nz = this.playerPos.z + mz * step;
      // slide along obstacles
      if (this.world.isWalkable(nx, nz)) {
        this.playerPos.x = nx; this.playerPos.z = nz;
      } else if (this.world.isWalkable(nx, this.playerPos.z)) {
        this.playerPos.x = nx;
      } else if (this.world.isWalkable(this.playerPos.x, nz)) {
        this.playerPos.z = nz;
      }
      const desired = Math.atan2(mx, mz);
      this.player.group.rotation.y = dampAngle(this.player.group.rotation.y, desired, 12, dt);
    }

    const gy = this.world.groundY(this.playerPos.x, this.playerPos.z);
    this.playerPos.y = THREE.MathUtils.damp(this.playerPos.y, gy, 14, dt);
    this.player.group.position.copy(this.playerPos);
    animateCharacter(this.player, dt, this.playerSpeed / 5.4, this.t);

    // ----- world & npcs -----
    this.world.tick(dt, this.t);
    updateVillagers(this.villagers, this.world, dt, this.t);
    this.updateDrops(dt);
    this.updateFishing(dt);
    this.updatePrompt();
    this.checkParty();

    // ----- camera -----
    const co = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch)
    ).multiplyScalar(this.camDist);
    const targetCam = this.playerPos.clone().add(co).add(new THREE.Vector3(0, 1.2, 0));
    this.camPos.x = THREE.MathUtils.damp(this.camPos.x, targetCam.x, 7, dt);
    this.camPos.y = THREE.MathUtils.damp(this.camPos.y, targetCam.y, 7, dt);
    this.camPos.z = THREE.MathUtils.damp(this.camPos.z, targetCam.z, 7, dt);
    if (this.camPos.lengthSq() < 1) this.camPos.copy(targetCam);
    this.camera.position.copy(this.camPos);
    const lookAt = this.playerPos.clone().add(new THREE.Vector3(0, 1.35, 0));
    this.camera.lookAt(lookAt);

    // hud clock tick (cheap enough every frame)
    this.syncHud();
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, this.renderer.info.render.frame === 0 ? 0.016 : clockDelta());
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }
}

// simple delta clock
let lastNow = performance.now();
function clockDelta() {
  const now = performance.now();
  const d = (now - lastNow) / 1000;
  lastNow = now;
  return d;
}
