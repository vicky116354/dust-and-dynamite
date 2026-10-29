'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createGameServer } = require('../server');
const S = require('../client/shared');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 2500) {
  const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw Error('Condition timed out'); await sleep(20); }
}
async function fixture(t) {
  const game = createGameServer(); await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await game.close(); });
  async function connect() { const c = io(url, { forceNew: true }); clients.push(c); await new Promise(resolve => c.once('connect', resolve)); return c; }
  const join = (c, data = {}) => new Promise(resolve => c.emit('join', { name: 'Tester', mode: 'ffa', ...data }, resolve));
  return { game, url, connect, join };
}
test('shared movement collides with cover, jumps low cover, and spends stamina', () => {
  const base = { x: 270, y: 740, vx: 220, vy: 0, angle: 0, horse: 'Mustang', horseHp: 100, alive: true, stamina: 100 };
  const p = { ...base }; for (let i = 0; i < 10; i++) S.move(p, { right: true, sprint: true }); assert.ok(p.x <= 281); assert.ok(p.stamina < 100);
  const q = { ...base }; for (let i = 0; i < 10; i++) S.move(q, { right: true, jump: true }); assert.ok(q.x > 300);
  assert.equal(S.blocked(400, 300, true), true, 'jump cannot cross buildings');
});
test('HTTP serves complete client and health endpoint', async t => {
  const f = await fixture(t);
  for (const route of ['/', '/game.js', '/shared.js', '/style.css', '/socket.io/socket.io.js', '/health']) assert.equal((await fetch(f.url + route)).status, 200);
});
test('room codes, ready-up, unique bot fill, all modes and rematch', async t => {
  const f = await fixture(t);
  for (const mode of ['ffa', 'posse', 'bounty']) {
    const a = await f.connect(), b = await f.connect();
    const reply = await f.join(a, { mode, name: '<Red Mae>' }); assert.match(reply.code, /^[A-Z2-9]{5}$/);
    assert.equal((await f.join(b, { code: reply.code })).code, reply.code);
    const r = f.game.rooms.get(reply.code); assert.equal(r.players[0].name, 'Red Mae');
    a.emit('ready'); await sleep(70); assert.equal(r.phase, 'lobby');
    b.emit('ready'); await until(() => r.phase === 'countdown'); assert.equal(r.players.length, 8); assert.equal(new Set(r.players.filter(p => p.bot).map(p => p.name)).size, 6);
    assert.equal(r.players.filter(p => p.team === 0).length, 4);
    r.countdown = .01; await until(() => r.phase === 'round');
    r.players.slice(1).forEach(p => { p.alive = false; });
    await until(() => r.phase === 'results'); assert.ok(r.winner);
    a.emit('rematch'); await until(() => r.phase === 'lobby'); assert.equal(r.players.length, 2); assert.ok(r.players.every(p => !p.ready));
    a.disconnect(); b.disconnect(); await until(() => !f.game.rooms.has(reply.code));
  }
});
test('quick match joins compatible lobby; full and active rooms reject entry', async t => {
  const f = await fixture(t), a = await f.connect();
  const { code } = await f.join(a, { quick: true });
  for (let i = 0; i < 7; i++) { const c = await f.connect(); assert.equal((await f.join(c, { quick: true })).code, code); }
  const extra = await f.connect(); assert.match((await f.join(extra, { code })).error, /full/);
  const r = f.game.rooms.get(code); r.phase = 'round';
  const extra2 = await f.connect(); assert.match((await f.join(extra2, { code })).error, /already/);
});
test('authoritative fire, horse death, foot timer, pickups, reload and storm', async t => {
  const f = await fixture(t), a = await f.connect(); const { code } = await f.join(a); const r = f.game.rooms.get(code);
  a.emit('ready'); await until(() => r.phase === 'countdown'); r.countdown = .01; await until(() => r.phase === 'round');
  // Freeze bots and remove random crates for deterministic combat assertions.
  r.pickups = [];
  r.players.forEach(p => { p.bot = false; p.x = 1900; p.y = 1400; p.horseHp = 0; p.foot = 1000; });
  const p = r.players[0], q = r.players[1]; Object.assign(p, { x: 900, y: 900, horseHp: 100 }); Object.assign(q, { x: 1050, y: 900, hp: 23 });
  let n = 0;
  a.emit('input', { seq: ++n, aim: 0, fire: true }); await until(() => !q.alive); assert.equal(p.kills, 1); assert.equal(p.ammo, 5);
  p.ammo = 0; a.emit('input', { seq: ++n, aim: 0, reload: true }); await until(() => p.reload > 0); p.reload = .01; await until(() => p.ammo === 6); assert.equal(p.reserve, 42);
  p.hp = 30; r.pickups = [{ id: 1, type: 'whiskey', x: p.x, y: p.y }]; await until(() => p.hp === 70);
  r.pickups = [{ id: 2, type: 'rifle', x: p.x, y: p.y }]; await until(() => p.weapon === 'rifle'); assert.equal(p.ammo, 8);
  // A dynamite explosion must independently affect horse and rider.
  p.horseHp = 1; p.hp = 100; r.dynamites.push({ x: p.x + 50, y: p.y, vx: 0, vy: 0, fuse: .01, owner: p.id });
  await until(() => p.horseHp === 0); assert.ok(p.foot <= 10 && p.foot > 9); assert.equal(p.weapon, 'revolver');
  p.foot = .01; await until(() => !p.alive);
  const survivor = r.players[2]; survivor.x = 2100; survivor.y = 1500; survivor.hp = 100;
  r.time = 170; await until(() => survivor.hp < 100); assert.ok(r.storm < 240);
});
test('malformed inputs and packet flood cannot teleport or accelerate a rider', async t => {
  const f = await fixture(t), a = await f.connect(); const { code } = await f.join(a); const r = f.game.rooms.get(code);
  a.emit('ready'); await until(() => r.phase === 'countdown'); r.countdown = .01; await until(() => r.phase === 'round');
  const p = r.players[0]; p.x = 1100; p.y = 900;
  a.emit('input', { seq: 1, aim: null, x: 999999, hp: 999 }); await sleep(70); assert.equal(p.seq, 0); assert.equal(p.hp, 100);
  const x = p.x;
  for (let i = 2; i < 300; i++) a.emit('input', { seq: i, aim: 0, right: true, x: 999999 });
  await sleep(180); assert.ok(p.x - x < 60); assert.ok(p.queue.length <= 5); assert.ok(p.x < 2000);
});
