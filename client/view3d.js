/* Procedural third-person renderer. World X/Z correspond to server X/Y.
 * Three.js is served by our own Node server from the installed dependency.
 * Network authority, collision, and damage remain in server.js/shared.js. */
import * as THREE from '/vendor/three.module.js';

export function createView(canvas, S, onUnlock) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d5b98c');
  scene.fog = new THREE.Fog('#d5b98c', 1000, 4400);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 2, 10000);
  const materials = new Map(), riders = new Map(), crates = new Map(), projectiles = new Map();
  const colliders = [], windmills = [], tumbleweeds = [], particles = [], temporary = [];
  let yaw = Math.PI, pitch = -.16, active = false, wasActive = false, rightMouse = false;
  let mode = 0, shoulder = 1, lastFocus = '', clock = 0, currentPlayers = [], currentId = '', freeLook = false;
  const ray = new THREE.Raycaster(), center = new THREE.Vector2(), point = new THREE.Vector3();
  const follow = new THREE.Vector3(), direction = new THREE.Vector3(), desiredEye = new THREE.Vector3();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -53);

  function material(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .94, flatShading: true }));
    return materials.get(color);
  }
  function mesh(parent, geometry, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, typeof color === 'string' ? material(color) : color);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  function box(parent, w, h, d, color, x = 0, y = h / 2, z = 0) { return mesh(parent, new THREE.BoxGeometry(w, h, d), color, x, y, z); }
  function cylinder(parent, top, bottom, h, color, x = 0, y = h / 2, z = 0, segments = 12) { return mesh(parent, new THREE.CylinderGeometry(top, bottom, h, segments), color, x, y, z); }
  const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
  function oval(parent, color, x, y, z, sx, sy, sz) { const m = mesh(parent, sphereGeometry, color, x, y, z); m.scale.set(sx, sy, sz); return m; }
  function group(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
  function beam(parent, from, to, thickness, color) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), v = b.clone().sub(a);
    const m = box(parent, thickness, v.length(), thickness, color); m.position.copy(a.add(b).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); return m;
  }
  function label(parent, title, x, y, z, width = 100, color = '#e3c793', background = '#483124') {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const cx = c.getContext('2d'); cx.fillStyle = background; cx.fillRect(0, 0, 512, 128); cx.strokeStyle = '#b18d56'; cx.lineWidth = 10; cx.strokeRect(8, 8, 496, 112);
    cx.fillStyle = color; cx.font = 'bold 48px Georgia'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(title, 256, 67, 475);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const m = mesh(parent, new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }), x, y, z);
    m.castShadow = false; return m;
  }
  function seeded(seed) { let n = seed; return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; }; }
  const random = seeded(1899);

  // Warm sky, distant mesas and sunset illumination.
  scene.add(new THREE.HemisphereLight('#ffe3ad', '#6b4933', 2.1));
  const sun = new THREE.DirectionalLight('#ffd5a0', 3.2); sun.position.set(-900, 1600, -1400); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -1350; sun.shadow.camera.right = 1350; sun.shadow.camera.top = 1050; sun.shadow.camera.bottom = -1050; sun.shadow.camera.far = 6000; sun.shadow.normalBias = 1.8;
  sun.target.position.set(1100, 0, 800); scene.add(sun, sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(7500, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#786950') }, horizon: { value: new THREE.Color('#edc591') } },
    vertexShader: 'varying vec3 v; void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 top;uniform vec3 horizon;varying vec3 v;void main(){float h=pow(max(normalize(v).y,0.0),0.6);gl_FragColor=vec4(mix(horizon,top,h),1.0);}'
  })); scene.add(sky);
  oval(scene, '#ffe4ab', -2400, 1300, -3900, 180, 180, 180).material = new THREE.MeshBasicMaterial({ color: '#ffe1a0', fog: false });

  function buildGround() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const cx = c.getContext('2d');
    cx.fillStyle = '#aa8754'; cx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 18000; i++) { const n = random(); cx.fillStyle = n > .5 ? '#d4b57833' : '#5c422b22'; cx.fillRect(random() * 512, random() * 512, random() * 3 + 1, 1); }
    for (let i = 0; i < 30; i++) { cx.strokeStyle = '#6d4c2d0d'; cx.beginPath(); cx.ellipse(256, 300, 50 + i * 7, 100 + i * 2, .4, 0, 6.28); cx.stroke(); }
    const texture = new THREE.CanvasTexture(c); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(24, 24); texture.colorSpace = THREE.SRGBColorSpace;
    const ground = mesh(scene, new THREE.PlaneGeometry(14000, 14000), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }), 1100, -.5, 800); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
    // Road tracks are large, soft strips on the dirt, not modern road markings.
    for (const z of [540, 561, 1010, 1031]) { const track = mesh(scene, new THREE.PlaneGeometry(2190, 3), new THREE.MeshBasicMaterial({ color: '#795a38', transparent: true, opacity: .15, depthWrite: false }), 1100, .1, z); track.rotation.x = -Math.PI / 2; track.castShadow = false; }
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), material('#8d7351'), 180);
    const matrix = new THREE.Object3D();
    for (let i = 0; i < 180; i++) { matrix.position.set(random() * 2400 - 100, 1, random() * 1800 - 100); matrix.scale.set(2 + random() * 6, 1 + random() * 3, 2 + random() * 5); matrix.rotation.y = random() * 6.28; matrix.updateMatrix(); rocks.setMatrixAt(i, matrix.matrix); } rocks.receiveShadow = true; scene.add(rocks);
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2, radius = 2600 + random() * 1300;
      const g = group(scene, 1100 + Math.cos(a) * radius, 0, 800 + Math.sin(a) * radius);
      const h = 160 + random() * 430; const mesa = cylinder(g, 140 + random() * 170, 260 + random() * 300, h, i % 2 ? '#a47e58' : '#977354', 0, h / 2, 0, 5); mesa.rotation.y = random() * 3;
      cylinder(g, 120, 170, 22, '#c49a69', 0, h + 8, 0, 5);
    }
  }
  function buildFence() {
    const posts = [], rails = [];
    for (let x = 35; x <= S.W - 35; x += 90) for (const z of [35, S.H - 35]) { posts.push([x, 17, z]); for (const y of [13, 28]) rails.push([x + 42, y, z, 0]); }
    for (let z = 35; z <= S.H - 35; z += 90) for (const x of [35, S.W - 35]) { posts.push([x, 17, z]); for (const y of [13, 28]) rails.push([x, y, z + 42, Math.PI / 2]); }
    function instance(geometry, color, values) { const m = new THREE.InstancedMesh(geometry, material(color), values.length), temp = new THREE.Object3D(); values.forEach((p, i) => { temp.position.set(p[0], p[1], p[2]); temp.rotation.y = p[3] || 0; temp.updateMatrix(); m.setMatrixAt(i, temp.matrix); }); m.castShadow = m.receiveShadow = true; scene.add(m); }
    instance(new THREE.BoxGeometry(5, 35, 5), '#655039', posts); instance(new THREE.BoxGeometry(87, 4, 3), '#91704a', rails);
  }
  function barrel(parent, x, z, y = 0) {
    const g = group(parent, x, y, z); cylinder(g, 13, 13, 29, '#82603b', 0, 14.5, 0);
    for (const h of [6, 23]) cylinder(g, 13.7, 13.7, 3, '#4d4938', 0, h, 0);
    cylinder(g, 11.8, 11.8, 1, '#a07c4a', 0, 29.5, 0); return g;
  }
  function buildObstacle(o) {
    const g = group(scene, o.x, 0, o.y), { w, h } = o;
    // Invisible obstacle volumes support camera collision and aiming through the scene.
    const height = o.low ? 33 : o.type === 'saloon' ? 130 : 175;
    const volume = box(g, w, height, h, new THREE.MeshBasicMaterial({ visible: false }), w / 2, height / 2, h / 2); colliders.push(volume);
    if (o.type === 'saloon') {
      box(g, w, 100, h, '#876444', w / 2, 50, h / 2);
      for (let x = 4; x < w; x += 24) box(g, 2, 99, 2, '#5d4632', x, 50, h + 1);
      box(g, w + 16, 8, h + 18, '#5f4633', w / 2, 104, h / 2);
      box(g, w + 12, 33, 6, '#795437', w / 2, 120, h + 3);
      label(g, 'LAST CHANCE SALOON', w / 2, 122, h + 7, w - 12);
      box(g, 65, 69, 3, '#33291f', w / 2, 34.5, h + 2);
      for (const x of [w / 2 - 17, w / 2 + 17]) box(g, 30, 36, 4, '#a5804f', x, 40, h + 5);
      for (const x of [50, w - 50]) { box(g, 48, 40, 3, '#3f3b2b', x, 62, h + 2); for (const z of [-1, 1]) box(g, 52, 3, 5, '#bd9b61', x, 62 + z * 21, h + 5); box(g, 3, 43, 5, '#b18d59', x, 62, h + 5); }
      box(g, w + 26, 9, 52, '#a58151', w / 2, 4.5, h + 17);
      for (const x of [8, w - 8]) { box(g, 6, 83, 6, '#5f4430', x, 43, h + 34); }
      box(g, w + 24, 5, 54, '#956c43', w / 2, 86, h + 18);
      barrel(g, 32, h + 20);
    } else if (o.type === 'tower') {
      for (const x of [16, w - 16]) for (const z of [13, h - 13]) box(g, 8, 117, 8, '#5f5239', x, 58, z);
      beam(g, [16, 10, h - 13], [w - 16, 108, h - 13], 5, '#796344'); beam(g, [w - 16, 10, h - 13], [16, 108, h - 13], 5, '#796344');
      cylinder(g, w / 2, w / 2, 79, '#926346', w / 2, 148, h / 2, 18);
      for (const y of [116, 178]) cylinder(g, w / 2 + 2, w / 2 + 2, 5, '#5c5140', w / 2, y, h / 2, 18);
      mesh(g, new THREE.ConeGeometry(w / 2 + 8, 24, 18), '#9e7a50', w / 2, 199, h / 2);
      label(g, 'REDWATER', w / 2, 148, h / 2 + w / 2 + 1, 102);
    } else if (o.type === 'windmill') {
      for (const x of [8, w - 8]) for (const z of [8, h - 8]) beam(g, [x, 0, z], [w / 2, 150, h / 2], 5, '#776447');
      beam(g, [10, 30, h - 8], [w - 10, 100, h / 2], 4, '#927855');
      const blades = group(g, w / 2, 157, h / 2 + 10);
      for (let i = 0; i < 10; i++) { const arm = group(blades); arm.rotation.z = i * Math.PI / 5; box(arm, 2, 64, 2, '#635a47', 0, 32, 0); box(arm, 16, 25, 3, '#ada17d', 7, 52, 0); }
      cylinder(blades, 8, 8, 10, '#5b513e').rotation.x = Math.PI / 2; windmills.push(blades);
    } else if (o.type === 'hay') {
      box(g, w, 29, h, '#b49752', w / 2, 14.5, h / 2);
      for (const x of [w * .2, w * .8]) box(g, 4, 31, h + 1, '#6c6340', x, 15.5, h / 2);
      for (let y = 5; y < 30; y += 7) box(g, w, 1.5, 1, '#d3b56b', w / 2, y, h + .8);
    } else if (o.type === 'barrels') { barrel(g, 19, 18); barrel(g, 61, 39); barrel(g, 61, 7); }
    else if (o.type === 'wagon') {
      box(g, w, 8, h, '#8b633d', w / 2, 23, h / 2);
      for (const z of [4, h - 4]) for (let y = 30; y < 52; y += 9) box(g, w, 6, 4, '#a07b49', w / 2, y, z);
      for (const x of [18, w - 18]) for (const z of [-4, h + 4]) { const wheel = mesh(g, new THREE.TorusGeometry(19, 3, 6, 12), '#503b28', x, 19, z); for (let a = 0; a < 4; a++) beam(g, [x - Math.cos(a * .78) * 18, 19 - Math.sin(a * .78) * 18, z], [x + Math.cos(a * .78) * 18, 19 + Math.sin(a * .78) * 18, z], 2, '#a5814c'); }
    } else {
      const horizontal = w > h, count = Math.max(w, h) / 42;
      for (let i = 0; i <= count; i++) box(g, 7, 36, 7, '#604631', horizontal ? i * 40 : w / 2, 18, horizontal ? h / 2 : i * 40);
      for (const y of [13, 28]) box(g, horizontal ? w : 5, 6, horizontal ? 5 : h, '#9d794a', w / 2, y, h / 2);
    }
  }
  function cactus(x, z, height) {
    const g = group(scene, x, 0, z); cylinder(g, 5, 7, height, '#65704a', 0, height / 2, 0, 7);
    for (const side of [-1, 1]) { beam(g, [0, height * .45, 0], [side * 18, height * .45, 0], 7, '#65704a'); cylinder(g, 4, 5, height * .3, '#747b50', side * 18, height * .6, 0, 7); }
    cylinder(g, 1, 3, 3, '#9b925b', 0, height + 1, 0, 6);
  }
  buildGround(); buildFence(); S.MAP.forEach(buildObstacle);
  for (const [x, z] of [[180,310],[1940,300],[1970,1320],[220,1390],[1280,190],[1420,1350],[80,1100],[2070,690]]) cactus(x, z, 55 + random() * 30);
  for (let i = 0; i < 32; i++) {
    const a = random() * Math.PI * 2, r = 1400 + random() * 600; cactus(1100 + Math.cos(a) * r, 800 + Math.sin(a) * r, 40 + random() * 60);
  }
  // Wind-blown, open wire tumbleweeds.
  const weedMat = new THREE.MeshBasicMaterial({ color: '#837345', wireframe: true, transparent: true, opacity: .6 });
  for (let i = 0; i < 8; i++) { const m = mesh(scene, new THREE.IcosahedronGeometry(12, 1), weedMat, random() * S.W, 12, 300 + random() * 1100); m.castShadow = false; tumbleweeds.push(m); }

  function makeHorse(p, wild = false) {
    const root = group(scene), horse = group(root), legs = [];
    const coat = S.HORSES[p.horse]?.color || '#9c5937';
    oval(horse, coat, 0, 31, 0, 26, 12, 11);
    const neck = oval(horse, coat, 20, 41, 0, 9, 17, 8); neck.rotation.z = -.35;
    oval(horse, coat, 27, 51, 0, 11, 8, 7); box(horse, 14, 9, 11, '#75513a', 36, 47, 0);
    for (const z of [-5, 5]) { mesh(horse, new THREE.ConeGeometry(3.3, 10, 4), coat, 24, 62, z); oval(horse, '#241c17', 31, 53, z * 1.35, 1.5, 1.5, 1); }
    for (let i = 0; i < 5; i++) box(horse, 5, 7, 3, '#3a2c23', 14 + i * 2, 36 + i * 4, 0);
    const tail = group(horse, -25, 35, 0); const tailMesh = mesh(tail, new THREE.ConeGeometry(5, 27, 6), '#3b2c23', -7, -8, 0); tailMesh.rotation.z = -1;
    for (const x of [-17, 16]) for (const z of [-8, 8]) {
      const leg = group(horse, x, 28, z); cylinder(leg, 3.3, 2.6, 14, coat, 0, -7, 0, 6);
      const knee = group(leg, 0, -14, 0); cylinder(knee, 2.4, 2.1, 13, '#5c4130', 0, -6.5, 0, 6); box(knee, 6, 4, 5, '#30281f', 1, -12, 0); legs.push({ leg, knee, phase: (x < 0 ? Math.PI : 0) + (z < 0 ? Math.PI : 0) });
    }
    if (p.horse === 'Appaloosa') for (let i = 0; i < 9; i++) oval(horse, '#65503c', -20 + (i % 4) * 10, 34 + i % 3, (i % 2 ? 1 : -1) * 10, 3, 3, 1);
    box(horse, 24, 3, 24, '#824a32', -2, 43, 0); oval(horse, '#493224', -1, 46, 0, 12, 4, 11);
    // Reins and bridle follow the head; they are actual world-space geometry.
    for (const z of [-7.5, 7.5]) beam(horse, [34, 48, z], [1, 55, z * .7], .7, '#c1a26a');
    const rider = group(root, 0, 44, 0), torso = group(rider);
    const outfit = { poncho: '#9e4931', bandana: '#697346', duster: '#443c31' }[p.outfit] || '#9e4931';
    box(torso, 13, 19, 15, outfit, 0, 13, 0);
    if (p.outfit === 'poncho') { const poncho = cylinder(torso, 7, 15, 17, outfit, 0, 14, 0, 4); poncho.rotation.y = Math.PI / 4; }
    oval(torso, '#bd9164', 0, 29, 0, 6, 7, 5.5); box(torso, 9, 4, 11, '#a88a50', 2, 24, 0);
    cylinder(torso, 13, 13, 2, '#5f4630', 0, 36, 0, 16); cylinder(torso, 7, 8, p.hat === 'tall' ? 12 : 7, '#b18b51', 0, p.hat === 'tall' ? 42 : 40, 0, 10);
    cylinder(torso, 8.1, 8.1, 2, '#453127', 0, 38, 0, 10);
    const gunArm = group(torso, 3, 18, -5);
    beam(gunArm, [0, 0, 0], [19, -1, 0], 4, '#bd9164'); const gun = box(gunArm, p.weapon === 'rifle' ? 30 : 17, 3, 3, '#393731', 25, 0, 0); box(gunArm, 3, 8, 3, '#65462c', 17, -3, 0);
    beam(torso, [0, 17, 6], [10, 7, 6], 4, outfit);
    const boots = [];
    for (const z of [-10, 10]) { const b = group(rider, -2, 1, z); beam(b, [0, 0, 0], [3, -14, 2 * Math.sign(z)], 5, '#453a2d'); box(b, 10, 6, 5, '#302a23', 5, -16, 2 * Math.sign(z)); boots.push(b); }
    rider.visible = !wild;
    const nameCanvas = document.createElement('canvas'); nameCanvas.width = 512; nameCanvas.height = 96;
    const nameTexture = new THREE.CanvasTexture(nameCanvas); nameTexture.colorSpace = THREE.SRGBColorSpace;
    const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture, depthTest: true, transparent: true })); nameSprite.position.y = 100; nameSprite.scale.set(100, 19, 1); root.add(nameSprite);
    return { root, horse, rider, torso, gunArm, gun, boots, legs, tail, nameCanvas, nameTexture, nameSprite, labelKey: '', wild };
  }
  const demo = Array.from({ length: 5 }, (_, i) => {
    const p = { id: 'demo' + i, horse: Object.keys(S.HORSES)[i % 4], outfit: ['poncho','bandana','duster'][i % 3], hat: 'wide', weapon: 'revolver', x: 850 + i * 140, y: 800 + Math.sin(i) * 120, angle: -.6 + i * .4, aim: -.4, horseHp: 100, alive: true, vx: 0, vy: 0, hp: 100, name: '' };
    return { p, model: makeHorse(p) };
  });
  const wildHorses = Array.from({ length: 14 }, (_, i) => makeHorse({ horse: Object.keys(S.HORSES)[i % 4] }, true));
  const rolling = [barrel(scene, 100, 560), barrel(scene, 2100, 1250)];
  const storm = mesh(scene, new THREE.CylinderGeometry(1, 1, 310, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#b99560', side: THREE.DoubleSide, transparent: true, opacity: .24, depthWrite: false }), 1100, 155, 800); storm.castShadow = false;
  const stormEdge = mesh(scene, new THREE.TorusGeometry(1, .0025, 4, 128), new THREE.MeshBasicMaterial({ color: '#d8b16b' }), 1100, 1, 800); stormEdge.rotation.x = Math.PI / 2; stormEdge.castShadow = false;
  const dustGeometry = new THREE.BufferGeometry(), dustPositions = new Float32Array(420 * 3);
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustCanvas = document.createElement('canvas'); dustCanvas.width = dustCanvas.height = 32;
  const dustContext = dustCanvas.getContext('2d'), fade = dustContext.createRadialGradient(16,16,0,16,16,16); fade.addColorStop(0,'#ffffff'); fade.addColorStop(1,'#ffffff00'); dustContext.fillStyle = fade; dustContext.fillRect(0,0,32,32);
  const dustPoints = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dustCanvas), color: '#dec191', size: 7, transparent: true, opacity: .35, depthWrite: false, sizeAttenuation: true })); scene.add(dustPoints);

  function updateRider(model, p, dt, t, isLocal = false, bounty = false, ally = false) {
    const m = model, mounted = p.horseHp > 0, speed = Math.hypot(p.vx || 0, p.vy || 0), walk = Math.min(1, speed / 200);
    m.root.visible = true;
    const lift = p.jump > 0 ? Math.sin(p.jump / .65 * Math.PI) * 37 : 0;
    if (m.root.position.lengthSq() === 0 || m.root.position.distanceToSquared(new THREE.Vector3(p.x, lift, p.y)) > 250000) m.root.position.set(p.x, lift, p.y);
    else m.root.position.lerp(new THREE.Vector3(p.x, lift, p.y), 1 - Math.exp(-dt * (isLocal ? 22 : 18)));
    m.root.rotation.y += S.angle(-p.angle - m.root.rotation.y) * Math.min(1, dt * 18);
    if (!p.alive) { m.root.rotation.z = -Math.PI / 2; m.root.position.y = 10; m.nameSprite.visible = false; return; }
    m.root.rotation.z = 0; m.horse.visible = mounted;
    m.rider.position.y = mounted ? 44 + Math.sin(t * 16) * walk * 1.2 : 18 + Math.sin(t * 12) * walk;
    m.torso.rotation.y = -S.angle((p.aim || 0) - p.angle);
    m.gun.scale.x = p.weapon === 'rifle' ? 1.5 : p.weapon === 'shotgun' ? 1.3 : 1;
    m.legs.forEach(({leg,knee,phase}) => { leg.rotation.z = Math.sin(t * 16 + phase) * walk * .65; knee.rotation.z = Math.max(0, Math.sin(t * 16 + phase + 1)) * walk * .7; });
    m.boots.forEach((b, i) => { b.rotation.z = mounted ? 0 : Math.sin(t * 12 + i * Math.PI) * walk * .6; });
    m.tail.rotation.x = Math.sin(t * 4) * .15;
    const key = `${p.name}|${Math.ceil(p.hp)}|${bounty}|${ally}`;
    if (key !== m.labelKey) {
      m.labelKey = key; const c = m.nameCanvas.getContext('2d'); c.clearRect(0, 0, 512, 96); c.textAlign = 'center'; c.font = 'bold 31px Georgia'; c.shadowColor = '#291d13'; c.shadowBlur = 8; c.fillStyle = ally ? '#d6d8a0' : '#f4dfb3'; c.fillText((p.name || '') + (bounty ? ' ★ BOUNTY' : ''), 256, 40, 500); c.shadowBlur = 0;
      c.fillStyle = '#30251bbb'; c.fillRect(140, 57, 232, 9); c.fillStyle = ally ? '#929e61' : '#b76d46'; c.fillRect(140, 57, 232 * p.hp / 100, 9); m.nameTexture.needsUpdate = true;
    }
    m.nameSprite.visible = !isLocal && !!p.name && !m.wild; m.nameSprite.position.y = mounted ? 102 : 75;
  }
  function makeCrate(item) {
    const g = group(scene, item.x, 14, item.y);
    box(g, 25, 23, 25, '#825a35', 0, 0, 0);
    for (const x of [-10, 10]) box(g, 3, 25, 27, '#c1a26b', x, 0, 0);
    const icons = { rifle: 'RIFLE', shotgun: 'SHOTGUN', whiskey: '+ HEALTH', ammo: 'AMMO', lasso: 'LASSO', horseshoe: 'SPEED' };
    const sign = label(g, icons[item.type] || 'SUPPLY', 0, 28, 0, 54); sign.material.transparent = true;
    return { g, sign };
  }
  function updateItems(state, dt, t) {
    const ids = new Set(state.pickups.map(p => p.id));
    for (const [id, c] of crates) if (!ids.has(id)) { disposeGroup(c.g); crates.delete(id); }
    for (const item of state.pickups) { if (!crates.has(item.id)) crates.set(item.id, makeCrate(item)); const c = crates.get(item.id); c.g.position.y = 14 + Math.sin(t * 2 + item.id) * 2; c.sign.quaternion.copy(camera.quaternion); c.sign.visible = follow.distanceToSquared(c.g.position) < 90000; }
    const grenadeIds = new Set(state.dynamites.map(p => p.id));
    for (const [id, g] of projectiles) if (!grenadeIds.has(id)) { disposeGroup(g); projectiles.delete(id); }
    for (const item of state.dynamites) { let g = projectiles.get(item.id); if (!g) { g = group(scene); cylinder(g, 3, 3, 14, '#a4432a'); oval(g, '#ffcb71', 0, 17, 0, 2, 2, 2); projectiles.set(item.id, g); } g.position.set(item.x, 10 + Math.sin(Math.max(0, 1.7 - item.fuse) / 1.7 * Math.PI) * 45, item.y); g.rotation.z += dt * 5; }
  }
  // Shared cached material/geometries survive per-entity deletion.
  function disposeGroup(g) { scene.remove(g); g.traverse(o => { if (o.isMesh) { if (o.geometry !== sphereGeometry) o.geometry.dispose(); if (o.material.map) { o.material.map.dispose(); o.material.dispose(); } } }); }
  function effect(e) {
    if (e.type === 'shot') {
      const shooter = currentPlayers.find(p => p.id === e.id), y = shooter?.horseHp > 0 ? 61 : 35;
      const points = [new THREE.Vector3(e.x, y, e.y), new THREE.Vector3(e.ex, y, e.ey)];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#ffe6a5', transparent: true, opacity: .85 })); scene.add(line); temporary.push({ mesh: line, life: .12, max: .12 });
      ovalEffect(e.x, y, e.y, '#ffe0a1', 5, .09);
      for (let i = 0; i < 5; i++) particles.push({ x: e.x, y, z: e.y, vx: (random() - .5) * 15, vy: 13, vz: (random() - .5) * 15, life: .7 });
    } else if (e.type === 'explosion') { ovalEffect(e.x, 20, e.y, '#c48138', 110, .65); for (let i = 0; i < 60; i++) particles.push({ x: e.x, y: 10, z: e.y, vx: (random() - .5) * 200, vy: random() * 90, vz: (random() - .5) * 200, life: 1.5 }); }
    else if (e.type === 'lasso') { const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.x, 55, e.y),new THREE.Vector3(e.ex, 50, e.ey)]),new THREE.LineBasicMaterial({color:'#d7ba7a'})); scene.add(rope); temporary.push({mesh:rope,life:.4,max:.4}); }
  }
  function ovalEffect(x, y, z, color, size, life) { const m = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, depthWrite: false })); m.position.set(x, y, z); m.scale.setScalar(size); scene.add(m); temporary.push({ mesh: m, life, max: life, expand: size > 10 }); }
  function updateParticles(dt, players, t) {
    for (const p of players) if (p.alive && !p.jump && Math.hypot(p.vx,p.vy) > 40 && random() < .65) particles.push({ x: p.x - Math.cos(p.angle) * 24, y: 3, z: p.y - Math.sin(p.angle) * 24, vx: -7, vy: 12, vz: 2, life: .9 });
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.life <= 0) particles.splice(i, 1); }
    if (particles.length > 330) particles.splice(0, particles.length - 330);
    for (let i = 0; i < 420; i++) { const p = particles[i]; dustPositions[i * 3] = p ? p.x : (i * 191 + t * 14) % S.W; dustPositions[i * 3 + 1] = p ? p.y : 14 + Math.sin(t + i) * 10; dustPositions[i * 3 + 2] = p ? p.z : (i * 127) % S.H; } dustGeometry.attributes.position.needsUpdate = true;
    for (let i = temporary.length - 1; i >= 0; i--) { const e = temporary[i]; e.life -= dt; if (e.life <= 0) { scene.remove(e.mesh); if (e.mesh.geometry !== sphereGeometry) e.mesh.geometry.dispose(); e.mesh.material.dispose(); temporary.splice(i, 1); } else { e.mesh.material.opacity = e.life / e.max; if (e.expand) e.mesh.scale.multiplyScalar(1 + dt * 2); } }
  }

  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  function lock() { if (!active) return; freeLook = true; const promise = canvas.requestPointerLock?.(); promise?.catch?.(() => {}); }
  canvas.addEventListener('pointerdown', e => { if (!active) return; if (e.button === 2) rightMouse = true; if (e.button === 0 && document.pointerLockElement !== canvas) lock(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerup', e => { if (e.button === 2) rightMouse = false; });
  document.addEventListener('mousemove', e => {
    if (!active || (document.pointerLockElement !== canvas && !rightMouse && !(freeLook && e.target === canvas))) return;
    yaw += e.movementX * .0024; pitch = S.clamp(pitch - e.movementY * .002, -.67, .25);
  });
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) { rightMouse = false; freeLook = false; onUnlock(); } });
  document.addEventListener('keydown', e => { if (e.code === 'Escape') { freeLook = false; rightMouse = false; onUnlock(); } });
  addEventListener('blur', () => { rightMouse = false; freeLook = false; });
  function cycleCamera() { mode = (mode + 1) % 2; }
  function switchShoulder() { shoulder *= -1; }
  function movementAngle(forward, strafe) { return Math.atan2(Math.sin(yaw) * forward + Math.cos(yaw) * strafe, Math.cos(yaw) * forward - Math.sin(yaw) * strafe); }
  function aimAngle(p) {
    camera.updateMatrixWorld(); ray.setFromCamera(center, camera);
    const models = [...riders.entries()].filter(([id, m]) => id !== currentId && m.root.visible && currentPlayers.find(p => p.id === id)?.alive).map(([, m]) => m.root);
    const hits = ray.intersectObjects([...colliders, ...models], true);
    if (hits.length) point.copy(hits[0].point);
    else { aimPlane.constant = p.horseHp > 0 ? -56 : -32; if (!ray.ray.intersectPlane(aimPlane, point)) point.copy(ray.ray.origin).addScaledVector(ray.ray.direction, 800); }
    return Math.atan2(point.z - p.y, point.x - p.x);
  }
  function render(players, state, local, id, dt, t) {
    clock += dt; currentPlayers = players; currentId = id;
    active = !!state && ['round', 'countdown'].includes(state.phase);
    const focus = local?.alive ? local : players.find(p => p.alive);
    if (active && focus && (!wasActive || lastFocus !== focus.id)) { yaw = focus.angle; pitch = -.16; follow.set(focus.x, 0, focus.y); camera.position.set(focus.x - Math.cos(yaw) * 145, 100, focus.y - Math.sin(yaw) * 145); lastFocus = focus.id; }
    if (!active && wasActive && document.pointerLockElement === canvas) document.exitPointerLock();
    if (!active) freeLook = false;
    wasActive = active;
    const own = players.find(p => p.id === id);
    for (const demoRider of demo) { demoRider.model.root.visible = !active; if (!active) updateRider(demoRider.model, demoRider.p, dt, t); }
    const present = new Set(players.map(p => p.id));
    for (const [key, m] of riders) if (!present.has(key)) { disposeGroup(m.root); m.nameTexture.dispose(); m.nameSprite.material.dispose(); riders.delete(key); }
    for (const p of players) { if (!riders.has(p.id)) riders.set(p.id, makeHorse(p)); updateRider(riders.get(p.id), p, dt, t, p.id === id, state?.bounty === p.id, state?.mode === 'posse' && own?.team === p.team); }
    if (active && focus) {
      const model = riders.get(focus.id); follow.lerp(model?.root.position || new THREE.Vector3(focus.x, 0, focus.y), 1 - Math.exp(-dt * 12));
      const zoom = rightMouse, back = zoom ? 85 : mode ? 235 : 145, eye = focus.horseHp > 0 ? mode ? 145 : 103 : mode ? 110 : 70;
      const side = (zoom ? 23 : 33) * shoulder;
      desiredEye.set(follow.x - Math.cos(yaw) * back - Math.sin(yaw) * side, follow.y + eye, follow.z - Math.sin(yaw) * back + Math.cos(yaw) * side);
      // Shorten the camera boom when a wall would be between rider and camera.
      const anchor = new THREE.Vector3(follow.x, follow.y + (focus.horseHp > 0 ? 64 : 38), follow.z), delta = desiredEye.clone().sub(anchor), distance = delta.length();
      ray.set(anchor, delta.normalize()); const hit = ray.intersectObjects(colliders, false)[0];
      if (hit && hit.distance < distance) desiredEye.copy(anchor).addScaledVector(delta, Math.max(20, hit.distance - 13));
      camera.position.lerp(desiredEye, 1 - Math.exp(-dt * 13));
      direction.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)); camera.lookAt(camera.position.clone().addScaledVector(direction, 500));
      const fov = zoom ? 48 : 66; if (Math.abs(camera.fov - fov) > .05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 9); camera.updateProjectionMatrix(); }
      updateItems(state, dt, t);
      rolling.forEach((g, i) => { const b = state.barrels[i]; if (b) { g.position.set(b.x, 0, b.y); g.rotation.z = t * b.dir * 3; } g.visible = !!b; });
      wildHorses.forEach((m, i) => { const s = state.stampede; m.root.visible = !!s && !s.warning; if (m.root.visible) updateRider(m, { id: 'wild' + i, x: s.x + Math.sin(i * 4) * 110, y: 690 + i * 25, angle: 0, horseHp: 100, alive: true, vx: 300, vy: 0, hp: 100 }, dt, t + i); });
      storm.visible = stormEdge.visible = state.storm < 1400; storm.scale.set(state.storm, 1, state.storm); stormEdge.scale.setScalar(state.storm);
    } else {
      const a = -.55 + Math.sin(t * .025) * .12; camera.position.set(1100 + Math.cos(a) * 460, 170, 820 + Math.sin(a) * 460); camera.lookAt(1000, 45, 650);
      storm.visible = stormEdge.visible = false; wildHorses.forEach(m => { m.root.visible = false; }); crates.forEach(c => { c.g.visible = false; }); rolling.forEach(g => { g.visible = false; }); projectiles.forEach(g => { g.visible = false; });
    }
    // Restore entities hidden by a menu between rounds.
    if (active) { crates.forEach(c => { c.g.visible = true; }); projectiles.forEach(g => { g.visible = true; }); }
    windmills.forEach(m => { m.rotation.z = t * .5; });
    tumbleweeds.forEach((m, i) => { m.position.x = ((t * (23 + i) + i * 343) % (S.W + 200)) - 100; m.rotation.z = -t * 2; });
    updateParticles(dt, players, t); renderer.render(scene, camera);
    return { active, locked: document.pointerLockElement === canvas, looking: freeLook || document.pointerLockElement === canvas, aiming: rightMouse, mode: mode ? 'CHASE' : 'THIRD PERSON', yaw };
  }
  return { render, effect, aimAngle, movementAngle, lock, cycleCamera, switchShoulder };
}
