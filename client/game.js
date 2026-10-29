/* Dust & Dynamite — all art and audio is generated locally. No asset downloads. */
'use strict';
const S = GameShared, $ = id => document.getElementById(id);
const canvas = $('arena'), ctx = canvas.getContext('2d'), mini = $('minimap').getContext('2d');
const socket = io(), keys = new Set();
let state = null, myId = '', predicted = null, pending = [], seq = 0, previousPhase = '', muted = true;
let width = innerWidth, height = innerHeight, mouse = { x: width / 2, y: height / 2, fire: false };
let camera = { x: 1100, y: 800 }, scale = 1, lastFrame = performance.now(), worldTime = 0, latency = 0;
let snapshots = [], effects = [], dust = [], lastDust = 0, ledgerOpen = false, posterSignature = '';
const horseKeys = Object.keys(S.HORSES);
function resize() { width = innerWidth; height = innerHeight; const dpr = Math.min(devicePixelRatio, 2); canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
addEventListener('resize', resize); resize();

// Seeded scenery stays fixed across frames and across browsers.
function random(seed) { let n = seed >>> 0; return () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; }; }
const rand = random(1899), stones = Array.from({ length: 1800 }, () => ({ x: rand() * S.W, y: rand() * S.H, r: rand() * 2 + .4, a: rand() * .22 }));
const shrubs = Array.from({ length: 60 }, () => ({ x: rand() * S.W, y: rand() * S.H, r: 10 + rand() * 18 }));
const cactus = [{ x: 180, y: 310 }, { x: 1940, y: 300 }, { x: 1970, y: 1320 }, { x: 220, y: 1390 }, { x: 1280, y: 190 }, { x: 1420, y: 1350 }];
const modes = { ffa: 'Free-for-All', posse: 'Posse vs Posse', bounty: 'Bounty Hunt' };
function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
function text(id, value) { $(id).textContent = value; }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function join(quick, privateRoom = false) {
  text('error', '');
  if (!socket.connected) return text('error', 'The telegraph is disconnected. Is the server running?');
  const code = privateRoom ? '' : quick ? '' : $('code').value.trim();
  if (!quick && !privateRoom && !code) return text('error', 'Enter your five-character room code.');
  socket.emit('join', { name: $('name').value, horse: $('horse').value, outfit: $('outfit').value, hat: $('hat').value, mode: $('mode').value, quick, code }, reply => {
    if (reply.error) return text('error', reply.error);
    myId = reply.id; pending = []; snapshots = []; predicted = null; seq = 0; previousPhase = '';
    localStorage.setItem('redwater-name', $('name').value);
    audio.start();
  });
}
$('name').value = localStorage.getItem('redwater-name') || 'The Stranger';
$('quick').onclick = () => join(true);
$('create').onclick = () => join(false, true);
$('join').onclick = () => join(false);
$('ready').onclick = () => socket.emit('ready');
$('rematch').onclick = () => socket.emit('rematch');
document.querySelectorAll('.leave').forEach(b => b.onclick = () => { socket.emit('leave'); state = null; predicted = null; snapshots = []; previousPhase = ''; updateScreens(); });
socket.on('connect', () => { text('connection', '● TELEGRAPH CONNECTED · READY TO RIDE'); text('error', ''); });
socket.on('disconnect', () => { state = null; predicted = null; snapshots = []; updateScreens(); text('connection', '○ TELEGRAPH DISCONNECTED'); text('error', 'Connection lost. Rejoin a room when the telegraph returns.'); });
socket.on('connect_error', () => text('error', 'Cannot reach the server. Start it with npm start.'));
socket.on('state', next => {
  if (!myId) return;
  state = next; snapshots.push({ received: performance.now(), state: next }); if (snapshots.length > 8) snapshots.shift();
  const me = next.players.find(p => p.id === myId);
  if (me) {
    pending = pending.filter(i => i.seq > me.seq);
    predicted = { ...me };
    if (next.phase === 'round') for (const input of pending) S.move(predicted, input);
  }
  if (next.phase !== previousPhase) { pending = []; snapshots = [{ received: performance.now(), state: next }]; updateScreens(); previousPhase = next.phase; }
  if (next.phase === 'lobby') renderPosters();
  if (next.phase === 'results') { text('winner', next.winner); $('resultTable').innerHTML = ledgerMarkup(); }
  if (ledgerOpen) $('ledgerTable').innerHTML = ledgerMarkup();
  updateHUD();
});
socket.on('effect', e => {
  effects.push({ ...e, life: e.type === 'explosion' ? .7 : e.type === 'lasso' ? .5 : .17, max: e.type === 'explosion' ? .7 : .17 });
  if (effects.length > 200) effects.shift();
  if (e.type === 'shot' && e.pellet === 0) audio.shot(e.weapon);
  if (e.type === 'explosion') audio.noise(.7, .5, 180);
  if (e.type === 'bell') audio.bell();
  if (e.type === 'neigh') audio.neigh();
  if (e.type === 'pickup') audio.tone(660, .09, 'sine', .035);
});
setInterval(() => { if (socket.connected) { const t = performance.now(); socket.timeout(2000).emit('pingCheck', null, err => { if (!err) { latency = Math.round(performance.now() - t); socket.emit('latency', latency); } }); } }, 2000);

function updateScreens() {
  const phase = state?.phase;
  show('menu', !phase); show('lobby', phase === 'lobby'); show('hud', phase === 'round' || phase === 'countdown'); show('results', phase === 'results');
  document.body.classList.toggle('playing', phase === 'round' || phase === 'countdown');
  if (!phase || phase === 'lobby' || phase === 'results') { ledgerOpen = false; show('ledger', false); }
}
function renderPosters() {
  const signature = JSON.stringify([state.code, state.players.map(p => [p.id, p.name, p.ready, p.horse, p.outfit, p.hat])]);
  if (signature === posterSignature) return;
  posterSignature = signature;
  text('roomCode', state.code); text('lobbyMode', modes[state.mode]);
  $('posters').innerHTML = Array.from({ length: 8 }, (_, i) => {
    const p = state.players[i];
    return `<article class="paper poster ${p ? '' : 'waiting'}"><h3>WANTED</h3><canvas class="portrait" width="200" height="75" data-poster="${i}"></canvas><p>${p ? escapeHTML(p.name) : 'EMPTY SADDLE'}</p><small class="${p?.ready ? 'status-ready' : ''}">${p ? (p.ready ? '✦ READY TO RIDE' : 'WAITING ON THIS OUTLAW') : 'AI OUTLAW WILL JOIN'}</small></article>`;
  }).join('');
  document.querySelectorAll('[data-poster]').forEach(c => {
    const p = state.players[+c.dataset.poster] || { horse: horseKeys[+c.dataset.poster % 4], outfit: 'poncho', hat: 'wide' };
    const cctx = c.getContext('2d'); cctx.save(); cctx.translate(100, 40); cctx.scale(1.5, 1.5); drawRider(cctx, { ...p, angle: -.3, aim: -.3, horseHp: 100, alive: true, vx: 0, vy: 0 }, 0); cctx.restore();
  });
  text('ready', state.players.find(p => p.id === myId)?.ready ? 'UNREADY' : 'READY TO RIDE');
}
function ledgerMarkup() {
  return '<div class="ledger-row"><span>OUTLAW</span><span>KILLS</span><span>BOUNTY</span></div>' + [...state.players].sort((a, b) => b.score - a.score || b.kills - a.kills).map(p => `<div class="ledger-row ${p.alive ? '' : 'dead'}"><span>${p.id === myId ? '★ ' : ''}${escapeHTML(p.name)}${p.bot ? ' · AI' : ''}${state.mode === 'posse' ? ' · ' + (p.team ? 'SAGE' : 'COPPER') : ''}</span><span>${p.kills}</span><span>$${p.score}</span></div>`).join('');
}
function updateHUD() {
  if (!state || state.phase === 'lobby') return;
  const p = state.players.find(p => p.id === myId); if (!p) return;
  text('matchMode', modes[state.mode].toUpperCase()); text('riderName', p.name);
  const remaining = Math.max(0, Math.ceil(180 - state.time)); text('timer', `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
  text('alive', `${state.players.filter(p => p.alive).length} RIDERS REMAIN · ${latency} ms`);
  for (const name of ['hp', 'horseHp', 'stamina']) $(name).value = p[name];
  text('weaponName', p.reload ? 'RELOADING…' : S.WEAPONS[p.weapon]?.name.toUpperCase() || 'REVOLVER');
  $('ammo').innerHTML = `${p.ammo} <small>/ ${p.reserve}</small>`;
  text('gear', `Q · ${p.dynamite} DYNAMITE   E · ${p.lasso} LASSO`);
  $('feed').replaceChildren(...state.feed.map(message => { const div = document.createElement('div'); div.textContent = message; return div; }));
  text('announcement', state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdown))) : state.time < 1.5 ? 'DRAW!' : !p.horseHp && p.alive ? `ON FOOT · ${Math.ceil(p.foot)}s` : state.stampede?.warning ? 'STAMPEDE INCOMING' : state.time > 120 && state.time < 125 ? 'THE DUST IS CLOSING IN' : '');
  show('spectator', !p.alive && state.phase === 'round');
}
function toggleLedger() { if (!state) return; ledgerOpen = !ledgerOpen; show('ledger', ledgerOpen); if (ledgerOpen) $('ledgerTable').innerHTML = ledgerMarkup(); }
$('ledgerBtn').onclick = toggleLedger;
addEventListener('keydown', e => {
  if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Tab' && !e.repeat) toggleLedger();
  keys.add(e.code); audio.start();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.fire = false; });
canvas.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('pointerdown', e => { if (e.button === 0) mouse.fire = true; audio.start(); });
addEventListener('pointerup', () => { mouse.fire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function inputCommand() {
  const p = predicted;
  const wx = (mouse.x - width / 2) / scale + camera.x, wy = (mouse.y - height / 2) / scale + camera.y;
  return { seq: ++seq, up: keys.has('KeyW') || keys.has('ArrowUp'), down: keys.has('KeyS') || keys.has('ArrowDown'), left: keys.has('KeyA') || keys.has('ArrowLeft'), right: keys.has('KeyD') || keys.has('ArrowRight'), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), jump: keys.has('Space'), reload: keys.has('KeyR'), dynamite: keys.has('KeyQ'), lasso: keys.has('KeyE'), fire: mouse.fire, aim: Math.atan2(wy - p.y, wx - p.x) };
}
setInterval(() => {
  if (state?.phase !== 'round' || !predicted?.alive || !socket.connected) return;
  const i = inputCommand(); socket.emit('input', i); pending.push(i); if (pending.length > 30) pending.shift(); S.move(predicted, i); predicted.aim = i.aim;
}, 1000 / 30);

// --- Procedural 3/4 arena rendering ---
function ellipse(c, x, y, rx, ry, color) { c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
function line(c, x, y, ex, ey, color, size = 2) { c.strokeStyle = color; c.lineWidth = size; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke(); }
function rect(c, x, y, w, h, color) { c.fillStyle = color; c.fillRect(x, y, w, h); }
function ground(c) {
  rect(c, -500, -500, S.W + 1000, S.H + 1000, '#a17a48');
  const glow = c.createRadialGradient(1500, 300, 50, 1000, 800, 1700); glow.addColorStop(0, '#cfaa6c'); glow.addColorStop(1, '#93663e'); c.fillStyle = glow; c.fillRect(0, 0, S.W, S.H);
  // Wagon tracks, wind streaks, and trails through the center of town.
  for (let j = 0; j < 7; j++) { c.strokeStyle = '#7553331b'; c.lineWidth = 5; c.beginPath(); c.moveTo(-50, 500 + j * 105); c.bezierCurveTo(650, 400 + j * 130, 1300, 1000 - j * 30, 2300, 750 + j * 100); c.stroke(); }
  for (const s of stones) ellipse(c, s.x, s.y, s.r * 2, s.r, `rgba(67,44,25,${s.a})`);
  for (const s of shrubs) { ellipse(c, s.x + 8, s.y + 6, s.r, s.r * .4, '#533d2822'); for (let i = 0; i < 5; i++) line(c, s.x, s.y, s.x + Math.cos(i * 2) * s.r, s.y - 10 - Math.sin(i * 2) * s.r * .4, '#77704477', 2); }
  // Split-rail perimeter.
  for (let x = 40; x < S.W; x += 100) for (const y of [35, S.H - 35]) { rect(c, x, y - 20, 7, 35, '#655033'); line(c, x, y - 8, x + 100, y - 8, '#836442', 6); }
  for (let y = 40; y < S.H; y += 100) for (const x of [35, S.W - 35]) { rect(c, x, y - 15, 7, 28, '#655033'); line(c, x + 4, y - 5, x + 4, y + 95, '#836442', 5); }
  c.save(); c.globalAlpha = .12; c.fillStyle = '#513421'; c.textAlign = 'center'; c.font = 'bold 70px Georgia'; c.fillText('REDWATER', 1100, 550); c.font = '20px Georgia'; c.fillText('G U L C H   •   1 8 9 9', 1100, 583); c.restore();
}
const terrain = document.createElement('canvas'); terrain.width = S.W; terrain.height = S.H; ground(terrain.getContext('2d'));
function barrel(c, x, y, rotation = 0) {
  c.save(); c.translate(x, y); c.rotate(rotation); ellipse(c, 12, 9, 24, 12, '#39261e44');
  rect(c, -17, -14, 34, 28, '#765033'); ellipse(c, 0, 13, 17, 8, '#543d2a'); ellipse(c, 0, -13, 17, 8, '#987047');
  for (const v of [-9, 9]) { line(c, -16, v, 16, v, '#453b2b', 3); } line(c, -6, -12, -6, 13, '#b2894a66'); c.restore();
}
function scenery(c, o) {
  c.save(); c.translate(o.x, o.y); const { w, h } = o;
  rect(c, 16, 18, w + 13, h + 6, '#422c203d');
  if (o.type === 'saloon') {
    rect(c, 0, -55, w, h + 55, '#725039');
    for (let x = 0; x < w; x += 22) { rect(c, x, -55, 19, h + 55, x % 44 ? '#805b3c' : '#89633e'); line(c, x + 5, -45, x + 5, h, '#b28a4b22'); }
    rect(c, 28, 0, 64, 62, '#36291f'); rect(c, 225, 0, 64, 62, '#36291f'); rect(c, 130, 10, 59, 115, '#34261d');
    for (const x of [130, 162]) rect(c, x, 40, 28, 53, '#987747');
    for (const x of [28, 225]) { line(c, x + 32, 0, x + 32, 62, '#b2945a', 4); line(c, x, 30, x + 64, 30, '#b2945a', 4); }
    rect(c, -10, -76, w + 20, 31, '#543d2d'); c.fillStyle = '#d7bd80'; c.textAlign = 'center'; c.font = 'bold 23px Georgia'; c.fillText('THE LAST CHANCE SALOON', w / 2, -53);
    rect(c, -15, h - 7, w + 30, 23, '#a37c4c'); for (const x of [7, w - 17]) rect(c, x, 1, 10, h, '#4f3b2c');
    line(c, 95, -70, 112, -50, '#30251d', 7);
  } else if (o.type === 'tower') {
    for (const x of [15, w - 20]) { rect(c, x, 0, 10, h, '#544936'); }
    line(c, 20, 10, w - 15, h, '#6b573a', 7); line(c, w - 15, 10, 20, h, '#6b573a', 7);
    rect(c, 0, -92, w, 105, '#885e3f'); ellipse(c, w / 2, 12, w / 2, 18, '#604a34'); ellipse(c, w / 2, -92, w / 2, 20, '#a17b50');
    for (const y of [-70, -10]) line(c, 0, y, w, y, '#514735', 7);
    c.fillStyle = '#c1a573'; c.font = '16px Georgia'; c.textAlign = 'center'; c.fillText('REDWATER', w / 2, -40);
  } else if (o.type === 'windmill') {
    line(c, 0, h, w / 2, -100, '#746449', 8); line(c, w, h, w / 2, -100, '#746449', 8); line(c, 10, h - 20, 78, -30, '#675439', 4); line(c, 88, h - 20, 26, -30, '#675439', 4);
    c.save(); c.translate(w / 2, -100); c.rotate(worldTime * .4); for (let i = 0; i < 10; i++) { c.rotate(Math.PI / 5); line(c, 0, 0, 0, -65, '#665b45', 3); rect(c, -2, -65, 20, 28, '#998a69'); } ellipse(c, 0, 0, 9, 9, '#5e503c'); c.restore();
  } else if (o.type === 'hay') {
    rect(c, 0, -12, w, h + 12, '#af8b43'); rect(c, 0, -12, w, 16, '#c5a45c');
    for (let x = 3; x < w; x += 6) line(c, x, -9, x + 3, h - 2, '#d1ae5966');
    for (const x of [w * .22, w * .77]) rect(c, x, -12, 4, h + 12, '#6d5e39');
  } else if (o.type === 'barrels') { barrel(c, 20, 15); barrel(c, 62, 30); barrel(c, 43, -10); }
  else if (o.type === 'wagon') { for (const x of [15, w - 15]) for (const y of [5, h - 5]) { ellipse(c, x, y, 18, 18, '#463629'); ellipse(c, x, y, 13, 13, '#a47d47'); for (let a = 0; a < 6; a++) line(c, x, y, x + Math.cos(a) * 13, y + Math.sin(a) * 13, '#59422b'); } rect(c, 0, -12, w, h, '#88613b'); for (let y = 0; y < h - 10; y += 10) line(c, 0, y, w, y, '#b18b54', 2); }
  else { for (let y = 0; y < h; y += 50) for (let x = 0; x < w; x += 50) rect(c, x, y - 18, 8, 37, '#57432e'); line(c, 0, -10, w, h - 10, '#997342', 9); line(c, 0, 4, w, h + 4, '#6b4f33', 7); }
  c.restore();
}
function drawCactus(c, p) {
  ellipse(c, p.x + 18, p.y + 8, 30, 8, '#46341c33'); c.strokeStyle = '#63653e'; c.lineWidth = 15; c.lineCap = 'round'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - 65); c.moveTo(p.x, p.y - 23); c.lineTo(p.x - 23, p.y - 23); c.lineTo(p.x - 23, p.y - 48); c.moveTo(p.x, p.y - 35); c.lineTo(p.x + 22, p.y - 35); c.lineTo(p.x + 22, p.y - 59); c.stroke(); line(c, p.x - 3, p.y - 5, p.x - 3, p.y - 63, '#939060', 2); c.lineCap = 'butt';
}
function drawRider(c, p, t) {
  const mounted = p.horseHp > 0, speed = Math.hypot(p.vx || 0, p.vy || 0), bob = Math.sin(t * 16) * Math.min(1.8, speed / 90);
  ellipse(c, 13, 16, mounted ? 34 : 15, 12, '#3d291b44');
  c.save(); c.translate(0, -(p.jump > 0 ? Math.sin(p.jump / .65 * Math.PI) * 36 : 0));
  if (mounted) {
    c.save(); c.rotate(p.angle);
    for (const x of [-16, 16]) for (const y of [-9, 9]) { const leg = Math.sin(t * 16 + (x + y) * .2) * Math.min(8, speed / 25); line(c, x, y, x + leg, y + 8, '#493524', 5); }
    ellipse(c, -1, -2 + bob, 29, 12, S.HORSES[p.horse].color);
    if (p.horse === 'Appaloosa') for (let i = 0; i < 6; i++) ellipse(c, -19 + i * 7, (i % 2) * 9 - 6, 3, 2, '#5a4635');
    line(c, -27, -1, -40, -5 + Math.sin(t * 4) * 4, '#3e3027', 6);
    ellipse(c, 24, -6 + bob, 12, 9, S.HORSES[p.horse].color); ellipse(c, 34, -3 + bob, 7, 6, '#5a4030');
    line(c, 24, -10 + bob, 20, -20 + bob, '#4b3629', 4); line(c, 31, -10 + bob, 29, -18 + bob, '#4b3629', 4);
    rect(c, -8, -15 + bob, 19, 23, '#573b28'); line(c, 31, -7, 5, -12, '#d2b580', 1); c.restore();
  } else { line(c, -5, 4, -8 + Math.sin(t * 14) * speed / 35, 13, '#44372d', 5); line(c, 5, 4, 8 - Math.sin(t * 14) * speed / 35, 13, '#44372d', 5); }
  if (p.wild) { c.restore(); return; }
  const colors = { poncho: '#994a32', bandana: '#71704a', duster: '#493d32' };
  ellipse(c, 0, -12 + bob, 12, 11, colors[p.outfit] || colors.poncho);
  c.save(); c.translate(0, -13 + bob); c.rotate(p.aim); line(c, 4, 0, 18, 0, '#c19b6b', 5); line(c, 16, 0, 32, 0, '#3c342c', 4); c.restore();
  ellipse(c, 0, -20 + bob, 7, 7, '#bc9262');
  ellipse(c, 0, -25 + bob, p.hat === 'wide' ? 18 : 14, 6, '#4b3827'); ellipse(c, 0, -29 + bob, 9, p.hat === 'tall' ? 9 : 5, '#9a7949'); line(c, -8, -26 + bob, 8, -26 + bob, '#413226', 2);
  c.restore();
}
function pickup(c, item) {
  c.save(); c.translate(item.x, item.y + Math.sin(worldTime * 2 + item.id) * 3); ellipse(c, 3, 12, 20, 7, '#563b2633');
  const symbols = { whiskey: '✚', ammo: '•••', lasso: '◎', horseshoe: '∩', rifle: 'R', shotgun: 'S' };
  rect(c, -17, -15, 34, 28, '#725131'); rect(c, -16, -17, 32, 7, '#b18c52');
  c.strokeStyle = '#c2a16a'; c.lineWidth = 2; c.strokeRect(-14, -12, 28, 22); c.fillStyle = '#e1c58b'; c.font = 'bold 18px Georgia'; c.textAlign = 'center'; c.fillText(symbols[item.type], 0, 6); c.restore();
}
function interpolatedPlayers(now) {
  const target = now - 100;
  let a = snapshots[0], b = snapshots[snapshots.length - 1];
  for (let i = 1; i < snapshots.length; i++) if (snapshots[i].received >= target) { a = snapshots[i - 1]; b = snapshots[i]; break; }
  if (!b) return [];
  const f = S.clamp((target - a.received) / Math.max(1, b.received - a.received), 0, 1);
  return b.state.players.map(p => { if (p.id === myId && predicted) return predicted; const old = a.state.players.find(q => q.id === p.id) || p; return { ...p, x: old.x + (p.x - old.x) * f, y: old.y + (p.y - old.y) * f, angle: old.angle + S.angle(p.angle - old.angle) * f }; });
}
function drawMinimap(players) {
  mini.clearRect(0, 0, 200, 146); rect(mini, 0, 0, 200, 146, '#baa06e');
  for (const o of S.MAP) rect(mini, o.x / 11, o.y / 11, o.w / 11, o.h / 11, '#705539');
  mini.strokeStyle = '#8c4c30'; mini.lineWidth = 1; mini.beginPath(); mini.arc(100, 800 / 11, state.storm / 11, 0, Math.PI * 2); mini.stroke();
  for (const p of players.filter(p => p.alive)) ellipse(mini, p.x / 11, p.y / 11, p.id === myId ? 3 : 2, p.id === myId ? 3 : 2, p.id === myId ? '#f9e9bc' : state.mode === 'posse' && p.team === predicted?.team ? '#62613b' : '#8e3826');
}
function frame(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now; worldTime += dt;
  const playing = state && ['round', 'countdown'].includes(state.phase);
  const players = playing ? interpolatedPlayers(now) : [];
  const focus = predicted?.alive ? predicted : players.find(p => p.alive);
  const targetX = playing && focus ? focus.x : 1100 + Math.sin(worldTime * .04) * 250, targetY = playing && focus ? focus.y : 770;
  camera.x += (targetX - camera.x) * Math.min(1, dt * 7); camera.y += (targetY - camera.y) * Math.min(1, dt * 7);
  scale = playing ? Math.max(.65, Math.min(1, width / 1400)) : Math.max(width / 2400, height / 1800);
  ctx.clearRect(0, 0, width, height); ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(scale, scale); ctx.translate(-camera.x, -camera.y);
  ctx.drawImage(terrain, 0, 0);
  const drawables = S.MAP.map(o => ({ y: o.y + o.h, draw: () => scenery(ctx, o) })).concat(cactus.map(o => ({ y: o.y, draw: () => drawCactus(ctx, o) })));
  if (!playing) {
    for (let i = 0; i < 5; i++) { const p = { horse: horseKeys[i % 4], outfit: ['poncho', 'bandana', 'duster'][i % 3], hat: 'wide', angle: -.2 + i, aim: i, horseHp: 100, x: 650 + i * 260, y: 800 + Math.sin(i) * 180, vx: 50, vy: 0 }; drawables.push({ y: p.y, draw: () => { ctx.save(); ctx.translate(p.x, p.y); drawRider(ctx, p, worldTime); ctx.restore(); } }); }
  } else {
    for (const item of state.pickups) pickup(ctx, item);
    for (const b of state.barrels) drawables.push({ y: b.y, draw: () => barrel(ctx, b.x, b.y, worldTime * b.dir * 2) });
    if (state.stampede && !state.stampede.warning) for (let i = 0; i < 14; i++) { const x = state.stampede.x + Math.sin(i * 4) * 110, y = 690 + i * 25; drawables.push({ y, draw: () => { ctx.save(); ctx.translate(x, y); drawRider(ctx, { horse: horseKeys[i % 4], horseHp: 100, angle: 0, aim: 0, wild: true, vx: 300, vy: 0 }, worldTime + i); ctx.restore(); } }); }
    for (const p of players) {
      if (!p.alive) { ellipse(ctx, p.x, p.y, 22, 12, '#623d2c77'); continue; }
      drawables.push({ y: p.y, draw: () => {
        ctx.save(); ctx.translate(p.x, p.y);
        if (p.id === myId) { ctx.strokeStyle = '#e9d8aa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 8, 39, 23, 0, 0, Math.PI * 2); ctx.stroke(); }
        drawRider(ctx, p, worldTime);
        ctx.textAlign = 'center'; ctx.font = '11px "Courier New"'; ctx.fillStyle = p.id === myId ? '#fff0cd' : state.mode === 'posse' && p.team === predicted?.team ? '#c9d09a' : '#efcda0'; ctx.shadowColor = '#362619'; ctx.shadowBlur = 3; ctx.fillText(p.name + (state.bounty === p.id ? ' ★ BOUNTY' : ''), 0, -54); ctx.shadowBlur = 0;
        rect(ctx, -21, -47, 42, 3, '#4e3427'); rect(ctx, -21, -47, 42 * p.hp / 100, 3, '#b76942'); ctx.restore();
      } });
      if (now - lastDust > 45 && Math.hypot(p.vx, p.vy) > 30 && !p.jump) dust.push({ x: p.x - Math.cos(p.angle) * 25, y: p.y - Math.sin(p.angle) * 25, life: .7, r: 5 });
    }
  }
  drawables.sort((a, b) => a.y - b.y).forEach(o => o.draw());
  if (now - lastDust > 45) lastDust = now;
  dust = dust.filter(p => (p.life -= dt) > 0).slice(-300);
  for (const p of dust) { p.x -= dt * 16; p.r += dt * 18; ellipse(ctx, p.x, p.y, p.r, p.r * .6, `rgba(220,183,119,${p.life * .35})`); }
  for (let i = 0; i < 8; i++) { const x = ((worldTime * (25 + i) + i * 343) % (S.W + 200)) - 100, y = 420 + (i * 157) % 1100; ctx.save(); ctx.translate(x, y); ctx.rotate(worldTime * 2); ctx.strokeStyle = '#685b3888'; ctx.lineWidth = 1.5; for (let j = 0; j < 3; j++) { ctx.rotate(1); ctx.beginPath(); ctx.ellipse(0, 0, 15, 7, 0, 0, Math.PI * 2); ctx.stroke(); } ctx.restore(); }
  if (playing) {
    for (const d of state.dynamites) { ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(worldTime * 5); rect(ctx, -8, -4, 16, 8, '#8b3427'); line(ctx, 8, 0, 12, -6, '#e7bc66'); ellipse(ctx, 12, -6, 3, 3, '#f0d096'); ctx.restore(); }
    ctx.save(); ctx.fillStyle = '#a4753e77'; ctx.beginPath(); ctx.rect(-3000, -3000, 8000, 8000); ctx.arc(1100, 800, state.storm, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.strokeStyle = '#e0bc7a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(1100, 800, state.storm, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); drawMinimap(players);
  }
  effects = effects.filter(e => (e.life -= dt) > 0);
  for (const e of effects) {
    if (e.type === 'shot') { ctx.globalAlpha = e.life / .17; line(ctx, e.x, e.y - 12, e.ex, e.ey - 12, '#f0d696', 2); ellipse(ctx, e.x, e.y - 12, 12, 7, '#f0ca79'); ellipse(ctx, e.x, e.y - 18, (1 - e.life / .17) * 25, 10, '#d6c29b66'); }
    else if (e.type === 'explosion') { ellipse(ctx, e.x, e.y, (1 - e.life / .7) * 150, (1 - e.life / .7) * 120, `rgba(103,68,39,${e.life})`); ellipse(ctx, e.x, e.y, e.life * 70, e.life * 60, '#ce8f43'); }
    else if (e.type === 'lasso') line(ctx, e.x, e.y, e.ex, e.ey, '#d7ba7a', 3);
    ctx.globalAlpha = 1;
  }
  // Wind-borne dust, with warm shafts of late afternoon light.
  for (let i = 0; i < 30; i++) ellipse(ctx, (i * 193 + worldTime * 27) % S.W, (i * 137 + Math.sin(worldTime + i) * 10) % S.H, 2, 1, '#f0ce8f55');
  ctx.restore();
  if (playing && predicted?.alive) { ctx.strokeStyle = '#ecd5a9'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 9, 0, Math.PI * 2); ctx.stroke(); line(ctx, mouse.x - 15, mouse.y, mouse.x - 5, mouse.y, '#ecd5a9'); line(ctx, mouse.x + 5, mouse.y, mouse.x + 15, mouse.y, '#ecd5a9'); line(ctx, mouse.x, mouse.y - 15, mouse.x, mouse.y - 5, '#ecd5a9'); }
  audio.tick(dt, playing && predicted?.alive ? Math.hypot(predicted.vx, predicted.vy) : 0);
  requestAnimationFrame(frame);
}

// --- Web Audio placeholders: plucked strings, reed melody, wind and game foley. ---
const audio = {
  context: null, beat: 0, musicClock: 0, hoofClock: 0,
  start() { if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)(); if (this.context.state === 'suspended') this.context.resume(); },
  tone(hz, duration, type = 'triangle', volume = .06, slide = 0) {
    if (muted || !this.context) return;
    const c = this.context, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(hz, c.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), c.currentTime + duration); g.gain.setValueAtTime(.001, c.currentTime); g.gain.linearRampToValueAtTime(volume, c.currentTime + .008); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + duration); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + duration);
  },
  noise(duration, volume, frequency = 1200) {
    if (muted || !this.context) return;
    const c = this.context, b = c.createBuffer(1, c.sampleRate * duration, c.sampleRate), values = b.getChannelData(0); for (let i = 0; i < values.length; i++) values[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / values.length, 2);
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(); source.buffer = b; filter.type = 'lowpass'; filter.frequency.value = frequency; gain.gain.value = volume; source.connect(filter); filter.connect(gain); gain.connect(c.destination); source.start();
  },
  shot(weapon) { this.noise(weapon === 'shotgun' ? .25 : .13, .15, weapon === 'rifle' ? 2000 : 1200); this.tone(120, .12, 'triangle', .07, 35); if (Math.random() < .25) this.tone(1800, .16, 'sine', .025, 550); },
  bell() { for (const n of [523, 1046, 1569]) this.tone(n, 2, 'sine', .07); },
  neigh() { this.tone(680, .7, 'sawtooth', .025, 300); },
  tick(dt, speed) {
    if (!this.context || muted) return;
    this.musicClock += dt; this.hoofClock += dt;
    if (speed > 35 && this.hoofClock > Math.max(.13, .35 - speed / 1400)) { this.hoofClock = 0; this.noise(.045, .06, 450); this.tone(this.beat % 2 ? 90 : 120, .06, 'triangle', .04); }
    if (this.musicClock > .37) {
      this.musicClock = 0; const notes = [146.83, 220, 293.66, 349.23, 220, 293.66, 440, 220, 130.81, 196, 261.63, 329.63, 196, 261.63, 392, 196];
      this.tone(notes[this.beat % 16], .65, 'triangle', .032);
      if (this.beat % 4 === 0) { this.tone(notes[(this.beat + 3) % 16] * 2, .9, 'sine', .018); this.tone(notes[(this.beat + 3) % 16] * 2.005, .9, 'triangle', .009); }
      if (this.beat % 8 === 0) this.noise(2, .035, 280);
      this.beat++;
    }
  }
};
$('sound').onclick = () => { muted = !muted; audio.start(); text('sound', muted ? 'SOUND OFF ♫' : 'SOUND ON ♫'); };
requestAnimationFrame(frame);
