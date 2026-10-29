/* Shared deterministic movement: server simulation and client prediction use the same step. */
(function (root) {
  'use strict';
  const W = 2200, H = 1600, DT = 1 / 30;
  const HORSES = {
    Mustang: { color: '#9c5937', speed: 235, turn: 3.8 },
    Appaloosa: { color: '#c6b392', speed: 225, turn: 4.2 },
    'Black Stallion': { color: '#352d29', speed: 250, turn: 3.3 },
    Palomino: { color: '#c39650', speed: 230, turn: 4.0 }
  };
  const WEAPONS = {
    revolver: { name: 'Revolver', mag: 6, interval: .30, reload: 1.5, damage: 23, range: 650, spread: .035, pellets: 1 },
    rifle: { name: 'Repeater Rifle', mag: 8, interval: .75, reload: 2.1, damage: 42, range: 1100, spread: .012, pellets: 1 },
    shotgun: { name: 'Shotgun', mag: 2, interval: .9, reload: 1.9, damage: 13, range: 310, spread: .30, pellets: 6 }
  };
  // Low cover can be jumped. Buildings remain solid during jumps.
  const MAP = [
    { x: 370, y: 265, w: 320, h: 130, type: 'saloon', low: false },
    { x: 1560, y: 270, w: 155, h: 115, type: 'tower', low: false },
    { x: 1000, y: 260, w: 100, h: 80, type: 'windmill', low: false },
    { x: 300, y: 720, w: 135, h: 45, type: 'hay', low: true },
    { x: 760, y: 650, w: 45, h: 170, type: 'fence', low: true },
    { x: 1420, y: 730, w: 170, h: 45, type: 'fence', low: true },
    { x: 1130, y: 1030, w: 150, h: 50, type: 'hay', low: true },
    { x: 540, y: 1150, w: 90, h: 65, type: 'barrels', low: true },
    { x: 1720, y: 1120, w: 95, h: 65, type: 'barrels', low: true },
    { x: 1030, y: 700, w: 115, h: 65, type: 'wagon', low: true }
  ];
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
  function blocked(x, y, jump, radius = 19) {
    return MAP.some(o => !(jump && o.low) && x > o.x - radius && x < o.x + o.w + radius && y > o.y - radius && y < o.y + o.h + radius);
  }
  function move(p, i, dt = DT) {
    if (!p.alive) return;
    p.jump = Math.max(0, (p.jump || 0) - dt);
    p.jumpCd = Math.max(0, (p.jumpCd || 0) - dt);
    p.stun = Math.max(0, (p.stun || 0) - dt);
    if (i.jump && !p.jumpCd && p.horseHp > 0) { p.jump = .65; p.jumpCd = 1.5; }
    const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0), dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const moving = !!(dx || dy), mounted = p.horseHp > 0;
    const sprint = moving && i.sprint && p.stamina > 2 && mounted && !p.stun;
    p.stamina = clamp(p.stamina + (sprint ? -29 : 17) * dt, 0, 100);
    const heading = Number.isFinite(i.moveAngle) ? i.moveAngle : Math.atan2(dy, dx);
    if (moving && !p.stun) p.angle += clamp(angle(heading - p.angle), -(mounted ? HORSES[p.horse].turn : 9) * dt, (mounted ? HORSES[p.horse].turn : 9) * dt);
    const speed = moving && !p.stun ? (mounted ? HORSES[p.horse].speed : 120) * (sprint ? 1.55 : 1) * (p.boost > 0 ? 1.3 : 1) : 0;
    p.vx += (Math.cos(p.angle) * speed - p.vx) * Math.min(1, dt * 5);
    p.vy += (Math.sin(p.angle) * speed - p.vy) * Math.min(1, dt * 5);
    const nx = clamp(p.x + p.vx * dt, 35, W - 35), ny = clamp(p.y + p.vy * dt, 35, H - 35);
    if (!blocked(nx, p.y, p.jump > 0)) p.x = nx; else p.vx = 0;
    if (!blocked(p.x, ny, p.jump > 0)) p.y = ny; else p.vy = 0;
  }
  const api = { W, H, DT, HORSES, WEAPONS, MAP, clamp, angle, blocked, move };
  if (typeof module !== 'undefined') module.exports = api; else root.GameShared = api;
})(typeof window !== 'undefined' ? window : globalThis);
