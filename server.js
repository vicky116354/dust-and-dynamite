'use strict';
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { Server } = require('socket.io');
const S = require('./client/shared');
const ROUND_SECONDS = 180, MAX_ROOMS = 100;
const BOT_NAMES = ['Black Jack', 'Red Mae', 'Doc Holler', 'Calamity June', 'El Coyote', 'Billy Bones', 'Dusty Rose'];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function createGameServer(options = {}) {
  const app = express(), server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 8192 });
  const rooms = new Map();
  // Serve the installed Three.js ES modules locally; no CDN is needed by players.
  app.use('/vendor', express.static(path.join(__dirname, 'node_modules/three/build')));
  app.use(express.static(path.join(__dirname, 'client')));
  app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
  const emit = (r, type, data) => io.to(r.code).emit(type, data);
  function event(r, type, data = {}) { emit(r, 'effect', { type, ...data }); }
  function settings(data, mode) {
    let maxPlayers = Number.isInteger(data.maxPlayers) ? S.clamp(data.maxPlayers, 2, 8) : 8;
    if (mode === 'posse') maxPlayers -= maxPlayers % 2;
    return { maxPlayers, fillBots: data.fillBots !== false };
  }
  function newRoom(mode, config, hostId) {
    let code;
    do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); } while (rooms.has(code));
    const r = { code, mode, ...config, hostId, phase: 'lobby', players: [], time: 0, countdown: 3, round: 0, pickups: [], dynamites: [], barrels: [], history: [], nextId: 0, storm: 1400, winner: '', feed: [], stampede: null };
    rooms.set(code, r); return r;
  }
  function makePlayer(id, data, bot = false) {
    return { id, name: String(data.name || 'The Stranger').replace(/[<>\x00-\x1f]/g, '').slice(0, 18), horse: S.HORSES[data.horse] ? data.horse : 'Mustang', outfit: ['poncho', 'bandana', 'duster'].includes(data.outfit) ? data.outfit : 'poncho', hat: ['wide', 'flat', 'tall'].includes(data.hat) ? data.hat : 'wide', bot, ready: bot, input: {}, queue: [], seq: 0, kills: 0, score: 0, alive: true, x: 0, y: 0 };
  }
  function snapshot(r) {
    return { code: r.code, mode: r.mode, maxPlayers: r.maxPlayers, fillBots: r.fillBots, hostId: r.hostId, phase: r.phase, round: r.round, countdown: r.countdown, time: r.time, storm: r.storm, winner: r.winner, bounty: r.bounty, pickups: r.pickups, dynamites: r.dynamites, barrels: r.barrels, stampede: r.stampede, feed: r.feed, players: r.players.map(({ input, queue, ...p }) => p) };
  }
  function publish(r) { emit(r, 'state', { ...snapshot(r), serverTime: Date.now() }); }
  function headline(r, message) { r.feed.unshift(message); r.feed = r.feed.slice(0, 5); }
  function maybeStart(r) {
    const humans = r.players.filter(p => !p.bot);
    if (r.phase !== 'lobby' || !humans.length || !humans.every(p => p.ready)) return;
    // Friends-only matches need two opponents; posses also need equal teams.
    if (!r.fillBots && (humans.length < 2 || (r.mode === 'posse' && humans.length % 2))) return;
    const humanCount = humans.length;
    r.players = humans;
    while (r.fillBots && r.players.length < r.maxPlayers) r.players.push(makePlayer('bot-' + r.players.length, { name: BOT_NAMES[(r.players.length - humanCount) % 7], horse: Object.keys(S.HORSES)[r.players.length % 4], outfit: ['poncho', 'bandana', 'duster'][r.players.length % 3] }, true));
    r.players.forEach((p, i) => {
      const a = i * Math.PI * 2 / r.players.length;
      Object.assign(p, { x: 1100 + Math.cos(a) * 760, y: 800 + Math.sin(a) * 540, vx: 0, vy: 0, angle: a + Math.PI, aim: a + Math.PI, hp: 100, horseHp: 100, stamina: 100, alive: true, weapon: 'revolver', ammo: 6, reserve: 48, dynamite: 2, lasso: 0, reload: 0, cooldown: 0, jump: 0, jumpCd: 0, boost: 0, stun: 0, foot: 0, kills: 0, team: i % 2, input: {}, queue: [], seq: 0 });
    });
    r.round++; r.time = 0; r.phase = 'countdown'; r.countdown = 3; r.storm = 1400; r.winner = ''; r.bounty = null; r.feed = []; r.history = []; r.dynamites = []; r.stampede = null;
    r.barrels = [{ x: 100, y: 560, dir: 1 }, { x: 2100, y: 1250, dir: -1 }];
    r.pickups = [];
    for (let i = 0; i < 24; i++) spawnPickup(r, i);
    publish(r);
  }
  function spawnPickup(r, i) {
    let x, y;
    do { x = 180 + Math.random() * 1840; y = 430 + Math.random() * 990; } while (S.blocked(x, y, false, 45));
    const types = ['rifle', 'shotgun', 'whiskey', 'ammo', 'lasso', 'horseshoe'];
    r.pickups.push({ id: ++r.nextId, x, y, type: types[i % types.length] });
  }
  function enemy(r, a, b) { return a.id !== b.id && b.alive && (r.mode !== 'posse' || a.team !== b.team); }
  function kill(r, p, source) {
    if (!p.alive) return;
    p.alive = false; p.hp = 0;
    const attacker = r.players.find(q => q.id === source);
    if (attacker && attacker !== p) { attacker.kills++; attacker.score += r.mode === 'bounty' && r.bounty === p.id ? 300 : 100; }
    headline(r, attacker && attacker !== p ? `${attacker.name} gunned down ${p.name}!` : `${p.name} rode into the great beyond.`);
    event(r, 'death', { x: p.x, y: p.y });
  }
  function damage(r, p, amount, source, horse = false) {
    if (!p.alive) return;
    p.lastHit = source;
    if (horse && p.horseHp > 0) {
      p.horseHp = Math.max(0, p.horseHp - amount);
      if (!p.horseHp) { p.foot = 10; p.weapon = 'revolver'; p.ammo = 6; p.reload = 0; event(r, 'neigh', { x: p.x, y: p.y }); headline(r, `${p.name} is down to their last ten seconds!`); }
    } else { p.hp = Math.max(0, p.hp - amount); if (!p.hp) kill(r, p, source); }
  }
  // Hitscan uses a short server-owned position history, capped at 180 ms rewind.
  // Static cover remains authoritative, including for rewound targets.
  function rayBox(x, y, dx, dy, o, limit) {
    let lo = 0, hi = limit;
    for (const [v, d, min, max] of [[x, dx, o.x, o.x + o.w], [y, dy, o.y, o.y + o.h]]) {
      if (Math.abs(d) < 1e-8) { if (v < min || v > max) return limit; }
      else { let a = (min - v) / d, b = (max - v) / d; if (a > b) [a, b] = [b, a]; lo = Math.max(lo, a); hi = Math.min(hi, b); if (hi < lo) return limit; }
    }
    return lo;
  }
  function shoot(r, p) {
    if (p.cooldown || p.reload || !p.ammo || p.stun) return;
    const w = S.WEAPONS[p.weapon]; p.ammo--; p.cooldown = w.interval;
    const rewind = Math.min(.18, (p.latency || 0) / 2000);
    const frame = [...r.history].reverse().find(h => h.time <= r.time - rewind);
    for (let k = 0; k < w.pellets; k++) {
      const a = p.aim + (Math.random() - .5) * w.spread * 2, dx = Math.cos(a), dy = Math.sin(a);
      let length = w.range, hit;
      for (const o of S.MAP) length = Math.min(length, rayBox(p.x, p.y, dx, dy, o, length));
      for (const q of r.players.filter(q => enemy(r, p, q))) {
        const pos = frame?.positions[q.id] || q, x = pos.x - p.x, y = pos.y - p.y, along = x * dx + y * dy;
        const perpendicular = Math.abs(x * dy - y * dx), radius = q.horseHp > 0 ? 25 : 16;
        if (along > 0 && perpendicular < radius && along < length) { length = along; hit = q; }
      }
      event(r, 'shot', { x: p.x, y: p.y, ex: p.x + dx * length, ey: p.y + dy * length, weapon: p.weapon, id: p.id, pellet: k });
      if (hit) damage(r, hit, w.damage, p.id, hit.horseHp > 0 && Math.random() < .55);
    }
  }
  function actions(r, p, i, previous) {
    if (i.reload && !p.reload && p.ammo < S.WEAPONS[p.weapon].mag && p.reserve) p.reload = S.WEAPONS[p.weapon].reload;
    if (i.fire) shoot(r, p);
    if (i.dynamite && !previous.dynamite && p.dynamite && !p.stun) {
      p.dynamite--; r.dynamites.push({ id: ++r.nextId, x: p.x, y: p.y, vx: Math.cos(p.aim) * 310, vy: Math.sin(p.aim) * 310, fuse: 1.7, owner: p.id });
    }
    if (i.lasso && !previous.lasso && p.lasso && !p.stun) {
      p.lasso--;
      const target = r.players.filter(q => enemy(r, p, q) && dist(p, q) < 320 && Math.abs(S.angle(Math.atan2(q.y - p.y, q.x - p.x) - p.aim)) < .4).sort((a, b) => dist(p, a) - dist(p, b)).find(q => S.MAP.every(o => rayBox(p.x, p.y, Math.cos(p.aim), Math.sin(p.aim), o, dist(p, q)) >= dist(p, q)));
      if (target) { target.stun = 1.6; const x = target.x + (p.x - target.x) * .5, y = target.y + (p.y - target.y) * .5; if (!S.blocked(x, y, false)) { target.x = x; target.y = y; } event(r, 'lasso', { x: p.x, y: p.y, ex: target.x, ey: target.y }); }
    }
  }
  function botInput(r, p) {
    const targets = r.players.filter(q => enemy(r, p, q)).sort((a, b) => dist(p, a) - dist(p, b));
    const q = targets.find(q => q.id === r.bounty) || targets[0];
    if (!q) return {};
    const aim = Math.atan2(q.y - p.y, q.x - p.x), d = dist(p, q);
    let a = aim + (d < 310 ? Math.PI / 2 : Math.sin(r.time * .6 + p.team) * .4);
    if (S.blocked(p.x + Math.cos(a) * 100, p.y + Math.sin(a) * 100, false)) a += 1.5;
    if (dist(p, { x: 1100, y: 800 }) > r.storm - 90) a = Math.atan2(800 - p.y, 1100 - p.x);
    return { up: Math.sin(a) < -.25, down: Math.sin(a) > .25, left: Math.cos(a) < -.25, right: Math.cos(a) > .25, aim: aim + Math.sin(r.time * 3 + p.x) * .08, fire: d < S.WEAPONS[p.weapon].range, reload: p.ammo === 0, sprint: d > 650, jump: p.vx * p.vx + p.vy * p.vy < 100, dynamite: d < 290 && Math.random() < .008, lasso: d < 280 && Math.random() < .01 };
  }
  function updatePlayer(r, p) {
    if (!p.alive) return;
    const dt = S.DT;
    p.cooldown = Math.max(0, p.cooldown - dt); p.boost = Math.max(0, p.boost - dt);
    if (p.reload > 0) { p.reload = Math.max(0, p.reload - dt); if (!p.reload) { const n = Math.min(S.WEAPONS[p.weapon].mag - p.ammo, p.reserve); p.ammo += n; p.reserve -= n; } }
    let i = p.bot ? botInput(r, p) : p.queue.shift();
    // One input command per tick prevents speed cheats; no movement when packets go stale.
    if (!i) i = Date.now() - (p.lastInput || 0) > 250 ? {} : p.input;
    const previous = p.input; p.input = i; p.aim = Number.isFinite(i.aim) ? i.aim : p.aim;
    S.move(p, i); if (i.seq) p.seq = i.seq;
    actions(r, p, i, previous);
    if (!p.horseHp) { p.foot -= dt; if (p.foot <= 0) kill(r, p, p.lastHit); }
    if (dist(p, { x: 1100, y: 800 }) > r.storm) damage(r, p, 18 * dt, null);
    for (let n = r.pickups.length - 1; n >= 0; n--) {
      const item = r.pickups[n]; if (dist(p, item) > 40) continue;
      if (S.WEAPONS[item.type] && p.horseHp > 0) { p.weapon = item.type; p.ammo = S.WEAPONS[p.weapon].mag; p.reload = 0; }
      else if (item.type === 'whiskey') p.hp = Math.min(100, p.hp + 40);
      else if (item.type === 'ammo') { p.reserve = Math.min(120, p.reserve + 24); p.dynamite = Math.min(4, p.dynamite + 1); }
      else if (item.type === 'lasso') p.lasso = Math.min(3, p.lasso + 1);
      else if (item.type === 'horseshoe') p.boost = 8;
      r.pickups.splice(n, 1); event(r, 'pickup', { x: p.x, y: p.y });
    }
  }
  function updateHazards(r) {
    for (const b of r.barrels) {
      b.x += b.dir * 150 * S.DT; if (b.x > S.W + 80) b.x = -80; if (b.x < -80) b.x = S.W + 80;
      for (const p of r.players) if (p.alive && !p.jump && dist(p, b) < 42) { damage(r, p, 25 * S.DT, null, true); p.stun = .15; }
    }
    const cycle = r.time % 60;
    r.stampede = r.time >= 60 && cycle < 10 ? { x: -300 + cycle * 300, y: 850, warning: false } : cycle > 55 ? { warning: true, x: -300, y: 850 } : null;
    if (r.stampede && !r.stampede.warning) for (const p of r.players) if (p.alive && Math.abs(p.x - r.stampede.x) < 160 && Math.abs(p.y - 850) < 210) damage(r, p, 70 * S.DT, null, p.horseHp > 0);
    for (let n = r.dynamites.length - 1; n >= 0; n--) {
      const d = r.dynamites[n]; d.fuse -= S.DT;
      const nx = S.clamp(d.x + d.vx * S.DT, 25, S.W - 25), ny = S.clamp(d.y + d.vy * S.DT, 25, S.H - 25);
      if (S.blocked(nx, ny, false, 5)) { d.vx *= -.4; d.vy *= -.4; } else { d.x = nx; d.y = ny; }
      d.vx *= .97; d.vy *= .97;
      if (d.fuse <= 0) {
        event(r, 'explosion', { x: d.x, y: d.y });
        const owner = r.players.find(p => p.id === d.owner);
        for (const p of r.players) if (p.alive && dist(d, p) < 150 && (p.id === d.owner || !owner || enemy(r, owner, p))) { const amount = 100 * (1 - dist(d, p) / 180); damage(r, p, amount, d.owner); damage(r, p, amount, d.owner, true); }
        r.dynamites.splice(n, 1);
      }
    }
  }
  function finish(r) {
    const alive = r.players.filter(p => p.alive), teams = new Set(alive.map(p => p.team));
    if ((r.mode === 'posse' ? teams.size <= 1 : alive.length <= 1) || r.time >= ROUND_SECONDS) {
      r.phase = 'results';
      r.winner = r.mode === 'posse' ? (teams.size === 1 ? ['Copper Posse', 'Sage Posse'][alive[0].team] : 'Draw — both posses endured') : alive.length === 1 ? alive[0].name : alive.length === 0 ? 'No survivors' : 'Draw — the storm spared no winner';
      for (const p of alive) p.score += 500;
      event(r, 'bell'); publish(r);
    }
  }
  let tickNumber = 0;
  const timer = setInterval(() => {
    for (const r of rooms.values()) {
      if (r.phase === 'countdown') { r.countdown -= S.DT; if (r.countdown <= 0) { r.phase = 'round'; r.time = 0; event(r, 'start'); } }
      else if (r.phase === 'round') {
        r.time += S.DT; r.storm = r.time < 120 ? 1400 : Math.max(65, 1400 * (180 - r.time) / 60);
        r.history.push({ time: r.time, positions: Object.fromEntries(r.players.map(p => [p.id, { x: p.x, y: p.y }])) }); if (r.history.length > 12) r.history.shift();
        for (const p of r.players) updatePlayer(r, p);
        if (r.mode === 'bounty') r.bounty = [...r.players].filter(p => p.alive && p.kills > 0).sort((a, b) => b.kills - a.kills)[0]?.id || null;
        updateHazards(r); if (tickNumber % 300 === 0 && r.pickups.length < 24) spawnPickup(r, randomInt(6)); finish(r);
      }
      if (tickNumber % 2 === 0) publish(r);
    }
    tickNumber++;
  }, S.DT * 1000);

  io.on('connection', socket => {
    let room, lastJoin = 0, lastSeq = 0;
    function leave() {
      if (!room) return;
      socket.leave(room.code); room.players = room.players.filter(p => p.id !== socket.id);
      const humans = room.players.filter(p => !p.bot);
      if (!humans.length) rooms.delete(room.code); else { if (room.hostId === socket.id) room.hostId = humans[0].id; maybeStart(room); publish(room); }
      room = null;
    }
    socket.on('join', (data, ack = () => {}) => {
      if (typeof ack !== 'function') return;
      if (!data || typeof data !== 'object' || Date.now() - lastJoin < 500) return ack({ error: 'Please wait a moment.' });
      lastJoin = Date.now();
      const mode = ['ffa', 'posse', 'bounty'].includes(data.mode) ? data.mode : 'ffa';
      const config = settings(data, mode);
      let r;
      if (data.code) r = rooms.get(String(data.code).trim().toUpperCase());
      else if (data.quick) r = [...rooms.values()].find(r => r.quick && r.phase === 'lobby' && r.mode === mode && r.maxPlayers === config.maxPlayers && r.fillBots === config.fillBots && r.players.length < r.maxPlayers);
      if (data.code && !r) return ack({ error: 'That room code was not found.' });
      if (r && (r.phase !== 'lobby' || r.players.length >= r.maxPlayers)) return ack({ error: 'That room is full or already riding.' });
      if (!r && rooms.size >= MAX_ROOMS) return ack({ error: 'The town is full. Try again later.' });
      leave(); room = r || newRoom(mode, config, socket.id); if (!r) room.quick = !!data.quick; lastSeq = 0;
      room.players.push(makePlayer(socket.id, data)); socket.join(room.code);
      ack({ code: room.code, id: socket.id }); publish(room);
    });
    socket.on('ready', () => { if (!room || room.phase !== 'lobby') return; const p = room.players.find(p => p.id === socket.id); p.ready = !p.ready; maybeStart(room); publish(room); });
    socket.on('roomSettings', (data, ack = () => {}) => {
      if (typeof ack !== 'function') return;
      if (!room || room.phase !== 'lobby') return ack({ error: 'Room settings can be changed between rounds.' });
      if (room.hostId !== socket.id) return ack({ error: 'Only the room host can change these settings.' });
      if (!data || !Number.isInteger(data.maxPlayers) || data.maxPlayers < 2 || data.maxPlayers > 8 || typeof data.fillBots !== 'boolean') return ack({ error: 'Choose 2–8 slots and a bot setting.' });
      if (room.mode === 'posse' && data.maxPlayers % 2) return ack({ error: 'Posse matches need an even room size.' });
      if (room.players.length > data.maxPlayers) return ack({ error: 'That size is smaller than the number of riders already here.' });
      Object.assign(room, settings(data, room.mode));
      room.players.forEach(p => { p.ready = false; });
      ack({ ok: true }); publish(room);
    });
    socket.on('rematch', () => { if (!room || room.phase !== 'results') return; room.phase = 'lobby'; room.players = room.players.filter(p => !p.bot); room.players.forEach(p => { p.ready = false; }); publish(room); });
    socket.on('leave', leave);
    socket.on('input', data => {
      if (!room || room.phase !== 'round' || !data || typeof data !== 'object') return;
      const p = room.players.find(p => p.id === socket.id);
      if (!p || !p.alive || !Number.isSafeInteger(data.seq) || data.seq <= lastSeq || !Number.isFinite(data.aim)) return;
      lastSeq = data.seq;
      if (p.queue.length >= 5) return;
      const i = { seq: data.seq, aim: S.angle(data.aim) };
      if (Number.isFinite(data.moveAngle)) i.moveAngle = S.angle(data.moveAngle);
      for (const key of ['up', 'down', 'left', 'right', 'sprint', 'jump', 'reload', 'fire', 'dynamite', 'lasso']) i[key] = data[key] === true;
      p.queue.push(i); p.lastInput = Date.now();
    });
    socket.on('pingCheck', (_, ack) => { if (typeof ack === 'function') ack(); });
    socket.on('latency', n => { const p = room?.players.find(p => p.id === socket.id); if (p && Number.isFinite(n)) p.latency = S.clamp(n, 0, 360); });
    socket.on('disconnect', leave);
  });
  return { app, server, io, rooms, close: () => { clearInterval(timer); return new Promise(resolve => io.close(resolve)); } };
}
if (require.main === module) {
  const game = createGameServer();
  game.server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Dust & Dynamite rides at http://localhost:${process.env.PORT || 3000}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await game.close(); process.exit(0); });
}
module.exports = { createGameServer };
