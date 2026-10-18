/* Starforge: a merge-and-defend Snapchat Web Lens.
 * Hold the Fabricator (or Space) to build turrets, drag matching turrets
 * together to evolve them, tap aliens to zap them, and keep the shield up.
 * Everything is drawn in code; the only bundled assets are two fonts. */
(() => {
  'use strict';

  // ================================================================ config
  const CFG = {
    // Snapchat draws its own controls over the top and bottom of a Lens.
    // All UI stays inside these fractions of the screen height (or the
    // device's safe-area insets, whichever is larger). Add #safe to the URL
    // to see the zone.
    SAFE_TOP: 0.10,
    SAFE_BOTTOM: 0.10,
  };
  const LW = 540;               // logical width
  const MIN_CONTENT_H = 860;    // logical height the UI needs inside the safe zone
  const LANES = 5;
  const MAX_TIER = 10;
  const SPR = /hires/.test(location.hash) ? 8 : 2.5;   // sprite cache resolution (#hires for marketing renders)

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const snap = window.snapchat || null;
  const SHOW_SAFE = /safe/.test(location.hash);
  const DEBUG = /debug/.test(location.hash);
  const FD = '"Russo One", "Arial Black", Impact, system-ui, sans-serif';
  const FU = 'Rajdhani, "Arial Narrow", system-ui, sans-serif';

  // ================================================================ utils
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[randInt(arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const inRect = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
  const fmt = (n) => {
    n = Math.floor(n);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };
  function seeded(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ================================================================ game data
  const TUR = [null,
    { name: 'Blaster',       col: '#45d8ff', kind: 'bolt',    rate: 1.7, short: 'BLASTER', info: 'Single laser' },
    { name: 'Twin Blaster',  col: '#4dffa6', kind: 'twin',    rate: 3.0, short: 'TWIN', info: 'Rapid twin lasers' },
    { name: 'Pulse Cannon',  col: '#ffd23f', kind: 'pulse',   rate: 1.3, short: 'PULSE', info: 'Heavy pulse orbs' },
    { name: 'Rail Gun',      col: '#ff9a3c', kind: 'rail',    rate: 0.75, short: 'RAIL', info: 'Pierces its whole lane' },
    { name: 'Missile Pod',   col: '#ff5a5a', kind: 'missile', rate: 1.1, short: 'MISSILE', info: 'Homing missiles, splash' },
    { name: 'Plasma Cannon', col: '#ff4fd8', kind: 'plasma',  rate: 0.9, short: 'PLASMA', info: 'Big plasma splash' },
    { name: 'Cryo Ray',      col: '#9ef0ff', kind: 'cryo',    rate: 1.8, short: 'CRYO', info: 'Freezes and slows' },
    { name: 'Tesla Coil',    col: '#b78cff', kind: 'tesla',   rate: 1.2, short: 'TESLA', info: 'Chain lightning x5' },
    { name: 'Ion Laser',     col: '#7dfcff', kind: 'ion',     rate: 0,   info: 'Continuous beam' },
    { name: 'Nova Cannon',   col: '#ffe066', kind: 'nova',    rate: 0.55, short: 'NOVA', info: 'Massive blast' },
  ];
  // Lanes a turret can reach from its own pad: tiers 1-3 own lane, 4-6 +-1, 7+ any.
  const reachOf = (t) => (t >= 7 ? 4 : t >= 4 ? 1 : 0);

  const ENEMY = {
    scout:    { hp: 24,   spd: 46, r: 19, dmg: 9,  cr: 2,  pts: 10,  col: '#7cff4f', name: 'Scout' },
    speeder:  { hp: 14,   spd: 92, r: 16, dmg: 7,  cr: 2,  pts: 14,  col: '#ffde3f', name: 'Speeder' },
    tank:     { hp: 90,   spd: 24, r: 26, dmg: 20, cr: 6,  pts: 35,  col: '#ff7a2f', name: 'Juggernaut' },
    splitter: { hp: 48,   spd: 36, r: 22, dmg: 10, cr: 4,  pts: 25,  col: '#ff4fa8', name: 'Splitter' },
    shielder: { hp: 42,   spd: 33, r: 21, dmg: 10, cr: 5,  pts: 30,  col: '#4fa3ff', name: 'Warden' },
    gunship:  { hp: 64,   spd: 34, r: 24, dmg: 12, cr: 7,  pts: 40,  col: '#b06bff', name: 'Gunship' },
    mini:     { hp: 12,   spd: 62, r: 12, dmg: 4,  cr: 1,  pts: 4,   col: '#ff8fc8', name: 'Shard' },
    boss:     { hp: 1300, spd: 11, r: 64, dmg: 70, cr: 80, pts: 600, col: '#ff3d6e', name: 'Mothership' },
  };

  // ================================================================ screen / layout
  let dpr = 1, scale = 1, offX = 0, VW = LW, LH = 960, ST = 0, SB = 0;
  const L = {};
  const SLOTS = [];
  const insetEl = document.getElementById('insets');

  function readInsets() {
    if (!insetEl) return { top: 0, bottom: 0 };
    const cs = getComputedStyle(insetEl);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ins = readInsets();
    const topPx = Math.max(ins.top, ch * CFG.SAFE_TOP);
    const botPx = Math.max(ins.bottom, ch * CFG.SAFE_BOTTOM);
    scale = Math.min(cw / LW, (ch - topPx - botPx) / MIN_CONTENT_H);
    VW = cw / scale;
    LH = ch / scale;
    offX = (VW - LW) / 2;
    ST = topPx / scale;
    SB = botPx / scale;
    layout();
    buildBackground();
  }

  function layout() {
    const T = ST, B = LH - SB;
    L.top = T; L.bottom = B;
    L.wave = { x: 14, y: T + 6, w: 190, h: 60 };
    L.score = { x: 214, y: T + 6, w: 176, h: 60 };
    L.speed = { x: 404, y: T + 10, w: 52, h: 52 };
    L.pause = { x: 468, y: T + 10, w: 52, h: 52 };
    L.shieldBar = { x: 14, y: T + 74, w: 512, h: 18 };
    L.fieldTop = T + 104;
    L.bar = { y: B - 52 };
    L.sell = { x: 14, y: B - 52, w: 106, h: 48 };
    L.credits = { x: 130, y: B - 52, w: 176, h: 48 };
    L.shop = { x: 396, y: B - 52, w: 130, h: 48 };
    const row2 = B - 108, row1 = row2 - 90;
    L.hangar = { x: 180, y: row1 - 54, w: 350, h: 202 };
    L.forge = { x: 90, y: (row1 + row2) / 2 + 2, r: 60 };
    L.turretY = row1 - 104;
    L.shieldY = L.turretY - 64;
    L.field = L.shieldY - L.fieldTop;
    L.speedK = clamp(L.field / 400, 0.8, 1.6);
    L.go = { x: LW / 2 - 90, y: L.fieldTop + L.field * 0.5 + 20, w: 180, h: 60 };
    SLOTS.length = 0;
    for (let i = 0; i < LANES; i++) SLOTS.push({ x: 54 + i * 108, y: L.turretY, s: 96, pad: true });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) SLOTS.push({ x: 228 + c * 88, y: r ? row2 : row1, s: 82, pad: false });
    const cy = (T + B) / 2;
    L.center = cy;
  }
  const laneX = (i) => 54 + i * 108;

  // ================================================================ sprites
  function sprite(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * SPR); c.height = Math.ceil(h * SPR);
    const g = c.getContext('2d');
    g.scale(SPR, SPR); g.translate(w / 2, h / 2);
    fn(g);
    c.w = w; c.h = h;
    return c;
  }
  function whiteOf(s) {
    const c = document.createElement('canvas');
    c.width = s.width; c.height = s.height;
    const g = c.getContext('2d');
    g.drawImage(s, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    c.w = s.w; c.h = s.h;
    return c;
  }
  function blit(s, x, y, rot = 0, sc = 1) {
    if (!rot && sc === 1) { ctx.drawImage(s, x - s.w / 2, y - s.h / 2, s.w, s.h); return; }
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (sc !== 1) ctx.scale(sc, sc);
    ctx.drawImage(s, -s.w / 2, -s.h / 2, s.w, s.h);
    ctx.restore();
  }
  const glowCache = {};
  function glow(col) {
    if (glowCache[col]) return glowCache[col];
    const s = sprite(64, 64, (g) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, rgba(col, 0.95));
      gr.addColorStop(0.5, rgba(col, 0.3));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(-32, -32, 64, 64);
    });
    glowCache[col] = s;
    return s;
  }
  function glowAt(col, x, y, r, a = 1) {
    const s = glow(col);
    ctx.globalAlpha = a;
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  const OUT = 'rgba(4,6,16,0.95)';
  function metalH(g, x0, x1) {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, '#1b2131'); gr.addColorStop(0.28, '#d4dcee');
    gr.addColorStop(0.5, '#8692ae'); gr.addColorStop(1, '#1b2131');
    return gr;
  }
  function rrp(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function polyp(g, n, r, rot = 0) {
    g.beginPath();
    for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath();
  }
  function dome(g, r, tint) {
    const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    gr.addColorStop(0, '#f2f6ff'); gr.addColorStop(0.4, tint || '#8995b2'); gr.addColorStop(1, '#1d2335');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
  }
  function coreGlow(g, col, r, x = 0, y = 0) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, col); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  function barrel(g, x, w, len, col) {
    g.fillStyle = metalH(g, x - w / 2, x + w / 2);
    rrp(g, x - w / 2, -len, w, len, Math.min(3, w * 0.3)); g.fill();
    g.lineWidth = 1.5; g.strokeStyle = OUT; g.stroke();
    if (col) { g.fillStyle = col; g.fillRect(x - w / 2 + 1, -len + 1, w - 2, 3.5); }
  }

  const TS = { base: [], head: [], icon: [] };
  function buildTurretSprites() {
    for (let t = 1; t <= MAX_TIER; t++) {
      const c = TUR[t].col;
      TS.base[t] = sprite(88, 88, (g) => {
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(0, 6, 36, 30, 0, 0, 7); g.fill();
        polyp(g, 8, 36, Math.PI / 8);
        const gr = g.createLinearGradient(0, -36, 0, 36);
        gr.addColorStop(0, '#59647f'); gr.addColorStop(0.5, '#2c3448'); gr.addColorStop(1, '#151a28');
        g.fillStyle = gr; g.fill(); g.lineWidth = 2.5; g.strokeStyle = OUT; g.stroke();
        polyp(g, 8, 31, Math.PI / 8); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();
        g.lineWidth = 7; g.strokeStyle = rgba(c, 0.25); g.beginPath(); g.arc(0, 0, 25, 0, 7); g.stroke();
        g.lineWidth = 2.5; g.strokeStyle = c; g.beginPath(); g.arc(0, 0, 25, 0, 7); g.stroke();
        g.fillStyle = '#9aa5c2';
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.arc(Math.cos(a) * 31.5, Math.sin(a) * 31.5, 1.7, 0, 7); g.fill(); }
        // tier pips
        for (let i = 0; i < Math.min(t, 5); i++) { g.fillStyle = c; g.fillRect(-11 + i * 5, 30, 3, 3); }
      });
      TS.head[t] = sprite(84, 110, (g) => headDraw(g, t, c));
      TS.icon[t] = sprite(88, 110, (g) => { g.translate(0, 8); g.drawImage(TS.base[t], -44, -44, 88, 88); g.drawImage(TS.head[t], -42, -55, 84, 110); });
    }
  }

  function headDraw(g, t, c) {
    switch (t) {
      case 1:
        barrel(g, 0, 9, 36, c); dome(g, 15); coreGlow(g, c, 6); break;
      case 2:
        barrel(g, -7, 7, 38, c); barrel(g, 7, 7, 38, c);
        rrp(g, -15, -12, 30, 24, 8); g.fillStyle = metalH(g, -15, 15); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        coreGlow(g, c, 7); break;
      case 3:
        barrel(g, 0, 15, 34, c);
        g.fillStyle = c; for (const y of [-15, -21, -27]) g.fillRect(-9.5, y, 19, 2.5);
        dome(g, 18, '#9a8a5a'); coreGlow(g, c, 8); break;
      case 4:
        barrel(g, -7, 6, 46, null); barrel(g, 7, 6, 46, null);
        g.fillStyle = rgba(c, 0.5); g.fillRect(-4, -44, 8, 38);
        g.fillStyle = '#fff'; g.fillRect(-1, -44, 2, 38);
        polyp(g, 6, 19, Math.PI / 6); g.fillStyle = metalH(g, -19, 19); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        g.fillStyle = c; rrp(g, -8, -6, 16, 12, 3); g.fill(); break;
      case 5:
        rrp(g, -21, -26, 42, 44, 7); g.fillStyle = metalH(g, -21, 21); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        for (const [x, y] of [[-10, -15], [10, -15], [-10, 3], [10, 3]]) {
          g.fillStyle = '#0d1018'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
          g.fillStyle = c; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 1.2, y - 1.2, 1.3, 0, 7); g.fill();
        }
        g.fillStyle = '#ffcc33'; g.fillRect(-21, 12, 42, 4); break;
      case 6:
        barrel(g, 0, 12, 30, null);
        g.fillStyle = c; g.beginPath(); g.ellipse(0, -30, 9, 4, 0, 0, 7); g.fill();
        dome(g, 22, '#8a5a8a');
        coreGlow(g, c, 15);
        g.strokeStyle = rgba(c, 0.9); g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.stroke(); break;
      case 7:
        barrel(g, 0, 10, 30, null);
        g.fillStyle = c;
        g.beginPath(); g.moveTo(0, -48); g.lineTo(7, -32); g.lineTo(0, -26); g.lineTo(-7, -32); g.closePath(); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
        dome(g, 18, '#6aa8c0');
        for (let i = 0; i < 6; i++) {
          g.save(); g.rotate(i * Math.PI / 3);
          g.fillStyle = rgba(c, 0.9); g.beginPath(); g.moveTo(0, -6); g.lineTo(3, -14); g.lineTo(0, -19); g.lineTo(-3, -14); g.closePath(); g.fill();
          g.restore();
        }
        coreGlow(g, '#ffffff', 6); break;
      case 8:
        for (const r of [22, 17, 12]) {
          g.fillStyle = r === 22 ? '#2a2f45' : metalH(g, -r, r);
          g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
          g.strokeStyle = rgba(c, 0.85); g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r - 3, 0, 7); g.stroke();
        }
        barrel(g, 0, 6, 34, null);
        coreGlow(g, c, 12, 0, -34); coreGlow(g, c, 9); break;
      case 9:
        barrel(g, 0, 11, 52, null);
        g.fillStyle = c; for (const y of [-20, -30, -40]) g.fillRect(-5.5, y, 11, 2);
        g.fillStyle = '#e8ffff'; g.beginPath(); g.arc(0, -52, 5, 0, 7); g.fill();
        rrp(g, -18, -16, 36, 32, 10); g.fillStyle = metalH(g, -18, 18); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        coreGlow(g, c, 9); break;
      case 10:
        barrel(g, -12, 9, 40, c); barrel(g, 12, 9, 40, c); barrel(g, 0, 13, 50, c);
        polyp(g, 8, 24, Math.PI / 8);
        { const gr = g.createLinearGradient(-24, 0, 24, 0); gr.addColorStop(0, '#5a4210'); gr.addColorStop(0.3, '#fff0a0'); gr.addColorStop(0.55, '#d9a520'); gr.addColorStop(1, '#4a3408'); g.fillStyle = gr; }
        g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        coreGlow(g, '#ffffff', 13); coreGlow(g, c, 10); break;
    }
  }

  const ES = {}, ESW = {};
  const ESCALE = 1.25;   // enemy sprites are drawn larger than their design size
  const ENGINES = {
    scout: [[0, -12]], speeder: [[-5, -16], [5, -16]], tank: [[-12, -24], [12, -24]],
    splitter: [[-10, -12], [10, -12]], shielder: [[0, -18]], gunship: [[-15, -16], [15, -16]],
    mini: [[0, -9]], boss: [[-40, -50], [0, -58], [40, -50]],
  };
  function hullGrad(g, col, h) {
    const gr = g.createLinearGradient(0, -h, 0, h);
    gr.addColorStop(0, shade(col, -0.55)); gr.addColorStop(0.45, col); gr.addColorStop(0.75, shade(col, 0.35)); gr.addColorStop(1, shade(col, -0.3));
    return gr;
  }
  function cockpit(g, x, y, rx, ry) {
    const gr = g.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 0, x, y, Math.max(rx, ry));
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, '#8ff7ff'); gr.addColorStop(1, '#0a5a8a');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
    g.strokeStyle = OUT; g.lineWidth = 1.5; g.stroke();
  }
  function buildEnemySprites() {
    const mk = (type, w, h, fn) => { ES[type] = sprite(w, h, fn); ESW[type] = whiteOf(ES[type]); };
    mk('scout', 48, 52, (g) => {
      const c = ENEMY.scout.col;
      g.beginPath(); g.moveTo(0, 23); g.lineTo(19, -4); g.lineTo(13, -14); g.lineTo(0, -9); g.lineTo(-13, -14); g.lineTo(-19, -4); g.closePath();
      g.fillStyle = hullGrad(g, c, 22); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
      g.strokeStyle = shade(c, -0.5); g.lineWidth = 1.5; g.beginPath(); g.moveTo(-14, -5); g.lineTo(0, 12); g.lineTo(14, -5); g.stroke();
      cockpit(g, 0, 2, 5, 8);
    });
    mk('speeder', 44, 56, (g) => {
      const c = ENEMY.speeder.col;
      g.beginPath(); g.moveTo(0, 26); g.lineTo(5, 0); g.lineTo(18, -18); g.lineTo(6, -12); g.lineTo(0, -20); g.lineTo(-6, -12); g.lineTo(-18, -18); g.lineTo(-5, 0); g.closePath();
      g.fillStyle = hullGrad(g, c, 24); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#1a1a2a'; g.fillRect(-1, -12, 2, 30);
      cockpit(g, 0, 4, 3.5, 7);
    });
    mk('tank', 64, 64, (g) => {
      const c = ENEMY.tank.col;
      polyp(g, 6, 27, Math.PI / 6); g.fillStyle = hullGrad(g, '#7a5038', 27); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2.5; g.stroke();
      polyp(g, 6, 19, Math.PI / 6); g.fillStyle = hullGrad(g, c, 19); g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#c9cfdd';
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.beginPath(); g.arc(Math.cos(a) * 23, Math.sin(a) * 23, 1.8, 0, 7); g.fill(); }
      g.fillStyle = '#2a2f40'; rrp(g, -5, 14, 10, 16, 2); g.fill(); g.stroke();
      cockpit(g, 0, -2, 7, 6);
    });
    mk('splitter', 60, 48, (g) => {
      const c = ENEMY.splitter.col;
      g.fillStyle = shade(c, -0.5); g.fillRect(-10, -4, 20, 8);
      for (const x of [-12, 12]) {
        g.beginPath(); g.arc(x, 0, 13, 0, 7); g.fillStyle = hullGrad(g, c, 13); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
        cockpit(g, x, 3, 4.5, 5);
      }
      g.strokeStyle = '#ffffff88'; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, -12); g.lineTo(0, 12); g.stroke(); g.setLineDash([]);
    });
    mk('shielder', 56, 56, (g) => {
      const c = ENEMY.shielder.col;
      g.beginPath(); g.ellipse(0, 0, 23, 17, 0, 0, 7); g.fillStyle = hullGrad(g, c, 17); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.ellipse(0, 0, 15, 10, 0, 0, 7); g.strokeStyle = shade(c, 0.5); g.lineWidth = 2; g.stroke();
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.arc(Math.cos(a) * 19, Math.sin(a) * 13.5, 1.6, 0, 7); g.fill(); }
      cockpit(g, 0, 0, 7, 6);
    });
    mk('gunship', 64, 56, (g) => {
      const c = ENEMY.gunship.col;
      g.beginPath(); g.moveTo(0, 18); g.lineTo(28, 2); g.lineTo(26, -10); g.lineTo(8, -16); g.lineTo(0, -22); g.lineTo(-8, -16); g.lineTo(-26, -10); g.lineTo(-28, 2); g.closePath();
      g.fillStyle = hullGrad(g, c, 22); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
      for (const x of [-18, 18]) { g.fillStyle = metalH(g, x - 3.5, x + 3.5); g.fillRect(x - 3.5, 0, 7, 20); g.strokeStyle = OUT; g.strokeRect(x - 3.5, 0, 7, 20); g.fillStyle = '#ff3d6e'; g.fillRect(x - 2.5, 17, 5, 3); }
      cockpit(g, 0, 0, 6, 9);
    });
    mk('mini', 28, 30, (g) => {
      const c = ENEMY.mini.col;
      g.beginPath(); g.moveTo(0, 13); g.lineTo(11, -2); g.lineTo(0, -11); g.lineTo(-11, -2); g.closePath();
      g.fillStyle = hullGrad(g, c, 12); g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.5; g.stroke();
      cockpit(g, 0, 1, 3, 4);
    });
    mk('boss', 168, 140, (g) => {
      const c = ENEMY.boss.col;
      // wings
      g.beginPath(); g.moveTo(-80, -10); g.lineTo(-56, -40); g.lineTo(-30, -20); g.lineTo(-40, 30); g.closePath();
      g.moveTo(80, -10); g.lineTo(56, -40); g.lineTo(30, -20); g.lineTo(40, 30); g.closePath();
      g.fillStyle = hullGrad(g, '#7a2a5a', 40); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2.5; g.stroke();
      // hull
      g.beginPath(); g.ellipse(0, 0, 58, 50, 0, 0, 7); g.fillStyle = hullGrad(g, c, 50); g.fill(); g.strokeStyle = OUT; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.ellipse(0, 4, 44, 36, 0, 0, 7); g.fillStyle = hullGrad(g, '#5a1430', 36); g.fill();
      // spikes / prow
      g.fillStyle = '#c9cfdd';
      g.beginPath(); g.moveTo(-12, 44); g.lineTo(0, 66); g.lineTo(12, 44); g.closePath(); g.fill(); g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
      // cannons
      for (const x of [-34, 34]) { g.fillStyle = metalH(g, x - 6, x + 6); rrp(g, x - 6, 20, 12, 30, 3); g.fill(); g.stroke(); g.fillStyle = '#ff3d6e'; g.fillRect(x - 4, 46, 8, 4); }
      // windows
      g.fillStyle = '#ffd34d';
      for (let i = 0; i < 9; i++) { const a = Math.PI * 1.15 + i * 0.09; g.fillRect(Math.cos(a) * 50 - 1.5 + 0, Math.sin(a) * 42 - 1.5, 3, 3); g.fillRect(-Math.cos(a) * 50 - 1.5, Math.sin(a) * 42 - 1.5, 3, 3); }
      // core
      coreGlow(g, '#ff3d6e', 26, 0, 6);
      cockpit(g, 0, 6, 12, 10);
    });
  }

  let SPR_FORGE = null, SPR_HEX = null;
  function buildMiscSprites() {
    const R = seeded(3);
    SPR_ROCK = [0, 1, 2].map(() => sprite(56, 56, (g) => {
      g.beginPath();
      const n = 9;
      for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n, r = 18 + R() * 8; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath();
      const gr = g.createRadialGradient(-8, -8, 2, 0, 0, 26);
      gr.addColorStop(0, '#6b6488'); gr.addColorStop(0.6, '#3a3452'); gr.addColorStop(1, '#1a1628');
      g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(R() * 20 - 10, R() * 20 - 10, 2 + R() * 4, 0, 7); g.fill(); }
    }));
    SPR_FORGE = sprite(140, 140, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.ellipse(0, 8, 64, 58, 0, 0, 7); g.fill();
      polyp(g, 12, 62, 0);
      const gr = g.createLinearGradient(0, -62, 0, 62);
      gr.addColorStop(0, '#5d6a8c'); gr.addColorStop(0.5, '#2a3150'); gr.addColorStop(1, '#121628');
      g.fillStyle = gr; g.fill(); g.strokeStyle = OUT; g.lineWidth = 3; g.stroke();
      polyp(g, 12, 54, 0); g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#0a0d1a'; g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill();
      g.strokeStyle = '#3d4a73'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#9aa5c2';
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 + Math.PI / 12; g.beginPath(); g.arc(Math.cos(a) * 49, Math.sin(a) * 49, 2, 0, 7); g.fill(); }
      // hazard notches
      for (let i = 0; i < 4; i++) {
        g.save(); g.rotate(i * Math.PI / 2 + Math.PI / 4);
        g.fillStyle = '#ffcc33'; g.fillRect(-6, -60, 12, 5);
        g.restore();
      }
    });
    SPR_HEX = sprite(60, 52, (g) => {
      g.strokeStyle = 'rgba(120,220,255,1)'; g.lineWidth = 1.2;
      for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
        g.save(); g.translate(col * 30 + (row % 2 ? 15 : 0), row * 26);
        polyp(g, 6, 15, Math.PI / 6); g.stroke(); g.restore();
      }
    });
  }

  // ================================================================ background
  let bg = null;
  const stars = [];
  const rocks = [];
  let SPR_ROCK = [];
  function buildBackground() {
    const k = scale * dpr;
    bg = document.createElement('canvas');
    bg.width = Math.max(1, Math.round(VW * k));
    bg.height = Math.max(1, Math.round(LH * k));
    const g = bg.getContext('2d');
    g.scale(k, k);
    g.translate(offX, 0);
    const R = seeded(7);
    const x0 = -offX, x1 = LW + offX;
    // deep space
    let gr = g.createLinearGradient(0, 0, 0, L.shieldY);
    gr.addColorStop(0, '#04051a'); gr.addColorStop(0.55, '#0c0a2e'); gr.addColorStop(1, '#170b38');
    g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, L.shieldY + 40);
    // nebula
    g.globalCompositeOperation = 'lighter';
    const neb = [[140, 60, 220], [40, 130, 230], [220, 50, 150], [90, 40, 200]];
    for (let i = 0; i < 16; i++) {
      const [r, gg, b] = neb[i % neb.length];
      const x = x0 + R() * (x1 - x0), y = R() * L.shieldY, rad = 80 + R() * 200;
      const ng = g.createRadialGradient(x, y, 0, x, y, rad);
      ng.addColorStop(0, `rgba(${r},${gg},${b},${0.10 + R() * 0.08})`);
      ng.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = ng; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.globalCompositeOperation = 'source-over';
    // static stars
    for (let i = 0; i < 260; i++) {
      const x = x0 + R() * (x1 - x0), y = R() * L.shieldY, s = R();
      g.fillStyle = `rgba(255,255,255,${0.25 + s * 0.7})`;
      g.fillRect(x, y, s > 0.9 ? 2 : 1, s > 0.9 ? 2 : 1);
      if (s > 0.985) {
        g.fillStyle = 'rgba(180,220,255,0.6)'; g.fillRect(x - 4, y + 0.5, 9, 1); g.fillRect(x + 0.5, y - 4, 1, 9);
      }
    }
    // planet
    const px = LW - 30, py = L.fieldTop + 70, pr = 78;
    g.save();
    const atm = g.createRadialGradient(px, py, pr * 0.9, px, py, pr * 1.35);
    atm.addColorStop(0, 'rgba(90,160,255,0.35)'); atm.addColorStop(1, 'rgba(90,160,255,0)');
    g.fillStyle = atm; g.beginPath(); g.arc(px, py, pr * 1.35, 0, 7); g.fill();
    const pg = g.createRadialGradient(px - pr * 0.45, py - pr * 0.45, pr * 0.1, px, py, pr);
    pg.addColorStop(0, '#9fd0ff'); pg.addColorStop(0.35, '#3a6bd8'); pg.addColorStop(0.8, '#1a2a78'); pg.addColorStop(1, '#0a0f30');
    g.fillStyle = pg; g.beginPath(); g.arc(px, py, pr, 0, 7); g.fill();
    g.beginPath(); g.arc(px, py, pr, 0, 7); g.clip();
    g.globalAlpha = 0.25; g.strokeStyle = '#cfe8ff'; g.lineWidth = 6;
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.ellipse(px, py + i * 18, pr * 1.2, 8, -0.2, 0, 7); g.stroke(); }
    g.restore();
    g.strokeStyle = 'rgba(200,220,255,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(px, py, pr * 1.6, pr * 0.32, -0.25, 0.15, Math.PI - 0.15, false); g.stroke();
    // small moon
    const mg = g.createRadialGradient(70, L.fieldTop + 200, 2, 76, L.fieldTop + 206, 18);
    mg.addColorStop(0, '#d8c8ff'); mg.addColorStop(1, '#3a2a6a');
    g.fillStyle = mg; g.beginPath(); g.arc(76, L.fieldTop + 206, 16, 0, 7); g.fill();

    // ---- base deck
    const dy = L.shieldY + 8;
    gr = g.createLinearGradient(0, dy, 0, LH);
    gr.addColorStop(0, '#2a3350'); gr.addColorStop(0.15, '#1a2036'); gr.addColorStop(1, '#0a0d18');
    g.fillStyle = gr; g.fillRect(x0, dy, x1 - x0, LH - dy);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
    for (let x = Math.floor(x0 / 60) * 60; x < x1; x += 60) { g.beginPath(); g.moveTo(x, dy + 14); g.lineTo(x, LH); g.stroke(); }
    for (let y = dy + 70; y < LH; y += 70) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
    for (let x = Math.floor(x0 / 60) * 60 + 2; x < x1; x += 60) { g.beginPath(); g.moveTo(x, dy + 14); g.lineTo(x, LH); g.stroke(); }
    // hazard stripe
    g.save(); g.beginPath(); g.rect(x0, dy, x1 - x0, 10); g.clip();
    g.fillStyle = '#ffcc33'; g.fillRect(x0, dy, x1 - x0, 10);
    g.fillStyle = '#1a1a1a';
    for (let x = Math.floor(x0 / 20) * 20 - 20; x < x1 + 20; x += 20) { g.beginPath(); g.moveTo(x, dy + 10); g.lineTo(x + 10, dy); g.lineTo(x + 20, dy); g.lineTo(x + 10, dy + 10); g.fill(); }
    g.restore();
    // lane pads (sockets)
    for (let i = 0; i < LANES; i++) {
      const x = laneX(i), y = L.turretY;
      g.fillStyle = 'rgba(0,0,0,0.5)'; polyp(g, 8, 47, Math.PI / 8); g.save(); g.translate(x, y); polyp(g, 8, 47, Math.PI / 8); g.fill(); g.restore();
    }
    // conduits
    g.strokeStyle = 'rgba(70,200,255,0.35)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0, L.turretY + 56); g.lineTo(x1, L.turretY + 56); g.stroke();
    g.strokeStyle = 'rgba(70,200,255,0.9)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, L.turretY + 56); g.lineTo(x1, L.turretY + 56); g.stroke();
    // hangar bay
    const h = L.hangar;
    g.fillStyle = 'rgba(0,0,0,0.5)'; rrp(g, h.x - 2, h.y + 3, h.w + 4, h.h + 2, 16); g.fill();
    gr = g.createLinearGradient(0, h.y, 0, h.y + h.h);
    gr.addColorStop(0, '#11162a'); gr.addColorStop(1, '#0b0f1e');
    g.fillStyle = gr; rrp(g, h.x, h.y, h.w, h.h, 14); g.fill();
    g.strokeStyle = '#3d4a73'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#7f8cc0'; g.font = `700 13px ${FU}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('HANGAR', h.x + 12, h.y + 12);
    // bottom bar strip
    g.fillStyle = 'rgba(4,6,14,0.75)'; g.fillRect(x0, L.bar.y - 6, x1 - x0, LH - L.bar.y + 6);
    g.fillStyle = '#2b3558'; g.fillRect(x0, L.bar.y - 6, x1 - x0, 2);

    rocks.length = 0;
    for (let i = 0; i < 5; i++) rocks.push({ x: rand(x0, x1), y: rand(L.fieldTop, L.shieldY - 40), v: rand(4, 12), vx: rand(-6, 6), rot: rand(0, 6.28), vr: rand(-0.4, 0.4), k: i % 3, s: rand(0.5, 1.1) });
    stars.length = 0;
    for (let i = 0; i < 70; i++) stars.push({ x: rand(x0, x1), y: rand(0, L.shieldY), v: rand(10, 45), s: Math.random() < 0.3 ? 2 : 1 });
  }

  // ================================================================ save data
  // tut: 0 build, 1 build again, 2 merge, 3 zap, 4 shop, 5 done
  const freshSave = () => ({ v: 2, best: 0, bestWave: 0, muted: false, music: true, tut: 0, speed: 1, run: null });
  let S = freshSave();
  let saveLoaded = false, savePending = Promise.resolve();
  let lbSupported = false;

  async function boot() {
    resize();
    buildTurretSprites(); buildEnemySprites(); buildMiscSprites();
    const fontsReady = (document.fonts && document.fonts.load)
      ? Promise.all([document.fonts.load(`20px ${FD}`), document.fonts.load(`700 20px ${FU}`)]).catch(() => {})
      : Promise.resolve();
    let saved = null;
    if (snap) {
      try { await snap.init(); } catch (e) { console.warn('snapchat.init failed:', e && e.message); }
      lbSupported = snap.isSupported('leaderboards');
      if (snap.isSupported('storage')) {
        try {
          const res = await snap.storage.get('save');
          saveLoaded = true;
          if (res.found) saved = res.value;
        } catch (e) { console.warn('No save:', e && e.message); }
      }
    }
    await fontsReady;
    if (saved && saved.v === 2) S = Object.assign(freshSave(), saved);
    buildBackground();
    screen = 'title';
  }

  function writeSave() {
    if (!saveLoaded || !snap) return;
    const state = JSON.parse(JSON.stringify(S));
    savePending = savePending
      .then(() => snap.storage.set('save', state))
      .then(() => true, (e) => { console.warn('Save failed:', e && e.message); return false; });
  }
  function snapshotRun() {
    if (!run) { S.run = null; return; }
    S.run = {
      wave: run.wave, credits: Math.floor(run.credits), score: Math.floor(run.score), shield: Math.ceil(run.shield),
      slots: run.slots.slice(), up: Object.assign({}, run.up), repairs: run.repairs, buys: run.buys,
      found: run.found, built: run.built, kills: run.kills,
    };
  }
  function submitScore(score) {
    if (!lbSupported || score <= 0) return Promise.resolve();
    return snap.leaderboards.submitScore({ score: Math.round(score) })
      .catch((e) => console.warn('Leaderboard submit failed:', e && e.message));
  }
  async function showLeaderboard() {
    if (!lbSupported) { toast('Leaderboard is not available here', '#ff8a8a'); return; }
    try {
      if (S.best > 0) await snap.leaderboards.submitScore({ score: Math.round(S.best) });
      await snap.leaderboards.show();
      // The desktop stub accepts the call but has no panel to open.
      if (snap.isStub) toast('Score sent · the leaderboard opens inside Snapchat', '#9fc6ff');
    } catch (e) {
      console.warn('Leaderboard unavailable:', e && e.message);
      toast('Leaderboard unavailable right now', '#ff8a8a');
    }
  }

  // ================================================================ audio
  let audio = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  function initAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain(); master.gain.value = S.muted ? 0 : 0.7; master.connect(audio.destination);
    const comp = audio.createDynamicsCompressor(); comp.connect(master);
    sfxBus = audio.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(comp);
    musicBus = audio.createGain(); musicBus.gain.value = S.music ? 0.32 : 0; musicBus.connect(comp);
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  }
  function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = 0, delay = 0, bus = sfxBus) {
    if (!audio || S.muted) return;
    const t0 = audio.currentTime + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, f0, f1, type = 'lowpass', delay = 0) {
    if (!audio || S.muted) return;
    const t0 = audio.currentTime + delay;
    const s = audio.createBufferSource(); s.buffer = noiseBuf;
    const f = audio.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = audio.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
  }
  const sfxLast = {};
  const throttle = (k, gap) => { if (time - (sfxLast[k] || -1) < gap) return false; sfxLast[k] = time; return true; };
  const SFX = {
    shot(kind) {
      if (!throttle('shot' + kind, 0.06)) return;
      switch (kind) {
        case 'bolt': case 'twin': tone(1400, 0.07, 'square', 0.03, 500); break;
        case 'pulse': tone(520, 0.12, 'triangle', 0.08, 160); break;
        case 'rail': noise(0.18, 0.15, 6000, 800, 'highpass'); tone(1800, 0.15, 'sawtooth', 0.04, 200); break;
        case 'missile': noise(0.3, 0.1, 800, 3000, 'bandpass'); break;
        case 'plasma': tone(300, 0.25, 'sine', 0.14, 70); break;
        case 'cryo': tone(2200, 0.1, 'sine', 0.04, 2800); break;
        case 'tesla': noise(0.14, 0.14, 3000, 1500, 'bandpass'); tone(90, 0.12, 'sawtooth', 0.05); break;
        case 'nova': tone(120, 0.5, 'sawtooth', 0.12, 40); noise(0.5, 0.2, 1500, 80); break;
        case 'zap': tone(2400, 0.08, 'square', 0.04, 900); noise(0.06, 0.06, 5000, 2000, 'highpass'); break;
      }
    },
    boom(big) { if (!throttle('boom', 0.05)) return; noise(big ? 0.9 : 0.35, big ? 0.5 : 0.22, big ? 1800 : 2400, 60); if (big) tone(70, 0.8, 'sine', 0.35, 30); },
    hit() { if (!throttle('hit', 0.05)) return; tone(220, 0.04, 'square', 0.025, 120); },
    build() { tone(440, 0.1, 'triangle', 0.15, 880); tone(880, 0.12, 'triangle', 0.1, 1320, 0.07); },
    merge() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.18, 'square', 0.06, 0, i * 0.05)); },
    coin() { if (!throttle('coin', 0.04)) return; tone(1600 + Math.random() * 300, 0.05, 'sine', 0.05, 2400); },
    shield() { noise(0.4, 0.35, 900, 60); tone(90, 0.35, 'sawtooth', 0.15, 40); },
    alarm() { for (let i = 0; i < 3; i++) { tone(660, 0.18, 'square', 0.08, 0, i * 0.4); tone(440, 0.18, 'square', 0.08, 0, i * 0.4 + 0.2); } },
    wave() { tone(392, 0.15, 'square', 0.07); tone(523, 0.15, 'square', 0.07, 0, 0.12); tone(784, 0.3, 'square', 0.07, 0, 0.24); },
    buy() { tone(880, 0.06, 'square', 0.07); tone(1320, 0.1, 'square', 0.07, 0, 0.06); },
    nope() { tone(160, 0.18, 'square', 0.07, 110); },
    charge(p) { if (!throttle('charge', 0.08)) return; tone(200 + p * 700, 0.07, 'sine', 0.035); },
    click() { tone(1000, 0.03, 'square', 0.04); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, 'triangle', 0.15, 0, i * 0.25)); },
  };

  // Tiny looping synthwave track: bass + arpeggio, scheduled ahead.
  let musicTimer = null, musicStep = 0, musicNext = 0;
  const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function startMusic() {
    if (musicTimer || !audio) return;
    musicNext = audio.currentTime + 0.1;
    musicTimer = setInterval(() => {
      if (!audio || audio.state !== 'running') return;
      const stepDur = 60 / 112 / 2;
      while (musicNext < audio.currentTime + 0.25) {
        const bar = Math.floor(musicStep / 8) % PROG.length, chord = PROG[bar], st = musicStep % 8;
        const dly = Math.max(0, musicNext - audio.currentTime);
        if (!S.muted && S.music) {
          tone(midi(chord[0] - 24), stepDur * 0.9, 'sawtooth', st % 2 ? 0.05 : 0.08, 0, dly, musicBus);
          const arp = chord[[0, 1, 2, 1, 0, 2, 1, 2][st]] + 12;
          tone(midi(arp), stepDur * 0.7, 'square', 0.03, 0, dly, musicBus);
          if (st === 0 || st === 4) noiseMusic(dly);
        }
        musicNext += stepDur; musicStep++;
      }
    }, 60);
  }
  function noiseMusic(delay) {
    const t0 = audio.currentTime + delay;
    const s = audio.createBufferSource(); s.buffer = noiseBuf;
    const f = audio.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = audio.createGain(); g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    s.connect(f); f.connect(g); g.connect(musicBus); s.start(t0); s.stop(t0 + 0.06);
  }
  function setMuted(m) { S.muted = m; if (master) master.gain.value = m ? 0 : 0.7; writeSave(); }
  function setMusic(m) { S.music = m; if (musicBus) musicBus.gain.value = m ? 0.32 : 0; writeSave(); }

  // ================================================================ run state
  let screen = 'loading';     // loading | title | play | over
  let overlay = null;         // null | pause | shop
  let time = 0;
  let run = null;
  let waveState = 'countdown', countdown = 0, waveClock = 0, queue = [], waveTotal = 0, waveSpawned = 0;
  let enemies = [], shots = [], ebullets = [], parts = [], rings = [], beams = [], floaters = [], chips = [];
  let tstate = [];
  let buildMeter = 0, shake = 0, redFlash = 0, banner = null, tooltip = null;
  let zapCd = 0, tutZaps = 0;
  let toastMsg = null;
  let hand = null;            // debug: scripted pointer for recordings
  const toast = (txt, col = '#ffffff') => { toastMsg = { txt, col, t: 2.4 }; };
  let overStats = null;
  const popAnim = new Array(13).fill(0);
  let newBest = false;

  const newRun = () => ({
    wave: 1, credits: 15, score: 0, shield: 100, slots: new Array(13).fill(0),
    up: { fab: 0, luck: 0, over: 0, cap: 0 }, repairs: 0, buys: 0, found: 1, built: 0, kills: 0,
  });
  const shieldMax = () => 100 + 35 * run.up.cap;
  const buildTime = () => 1.35 * Math.pow(0.87, run.up.fab) * Math.min(2.2, 1 + run.built * 0.025);
  const dps = (t) => 10 * Math.pow(2.2, t - 1) * (1 + 0.15 * run.up.over);
  const buyTier = () => Math.max(1, run.found - 2);
  const zapDamage = () => Math.max(8, dps(Math.max(1, run.found - 1)) * 0.3);

  const UPG = [
    { id: 'buy', name: 'Deploy Turret', icon: 'T', desc: () => `${TUR[buyTier()].name} (Tier ${buyTier()})`,
      cost: () => Math.round(30 * Math.pow(2.15, buyTier() - 1) * Math.pow(1.1, run.buys)), max: Infinity },
    { id: 'repair', name: 'Repair Shield', icon: '+', desc: () => `Restore 40% shield (${Math.ceil(run.shield)}/${shieldMax()})`,
      cost: () => Math.round(40 * Math.pow(1.45, run.repairs)), max: Infinity },
    { id: 'fab', name: 'Fast Fabricator', icon: 'F', desc: () => `Build time ${buildTime().toFixed(2)}s`,
      cost: () => Math.round(45 * Math.pow(1.65, run.up.fab)), max: 10 },
    { id: 'over', name: 'Overcharge', icon: 'O', desc: () => `All turrets +${run.up.over * 15}% damage`,
      cost: () => Math.round(70 * Math.pow(1.6, run.up.over)), max: 30 },
    { id: 'luck', name: 'Quantum Forge', icon: 'Q', desc: () => `${run.up.luck * 7}% chance to build Tier 2`,
      cost: () => Math.round(120 * Math.pow(1.9, run.up.luck)), max: 6 },
    { id: 'cap', name: 'Shield Capacity', icon: 'S', desc: () => `Max shield ${shieldMax()} (+35)`,
      cost: () => Math.round(90 * Math.pow(1.6, run.up.cap)), max: 20 },
  ];

  function startRun(fromSave) {
    run = newRun();
    if (fromSave && S.run) Object.assign(run, JSON.parse(JSON.stringify(S.run)));
    enemies = []; shots = []; ebullets = []; parts = []; rings = []; beams = []; floaters = []; chips = [];
    tstate = SLOTS.map(() => ({ ang: 0, cd: rand(0, 0.5), flash: 0, recoil: 0, beam: null, side: 1 }));
    buildMeter = 0; banner = null; tooltip = null; newBest = false;
    screen = 'play'; overlay = null;
    beginCountdown(fromSave ? 4 : (S.tut === 0 ? 6 : 4));
  }

  // ================================================================ waves
  function poolFor(w) {
    const p = ['scout', 'scout', 'scout'];
    if (w >= 2) p.push('speeder', 'speeder');
    if (w >= 3) p.push('tank');
    if (w >= 4) p.push('splitter', 'splitter');
    if (w >= 6) p.push('shielder', 'shielder');
    if (w >= 7) p.push('gunship', 'gunship');
    if (w >= 9) p.push('tank', 'shielder', 'speeder');
    return p;
  }
  function buildWave(w) {
    const q = [];
    const pool = poolFor(w);
    let n = Math.min(90, 10 + Math.floor(w * 3));
    const gap = Math.max(0.22, 1.0 - w * 0.045);
    let t = 0.8;
    while (n > 0) {
      const r = Math.random();
      if (w >= 3 && r < 0.16) {
        const lane = randInt(LANES), type = pick(pool);
        for (let k = 0; k < 3; k++) q.push({ t: t + k * 0.45, type, lane });
        n -= 3; t += gap * 2.5;
      } else if (w >= 2 && r < 0.3) {
        const lanes = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, 2 + randInt(Math.min(4, 1 + Math.floor(w / 3))));
        const type = Math.random() < 0.5 ? 'scout' : pick(pool);
        lanes.forEach((lane) => q.push({ t, type, lane }));
        n -= lanes.length; t += gap * 3;
      } else {
        q.push({ t, type: pick(pool), lane: randInt(LANES) });
        n--; t += gap * rand(0.6, 1.3);
      }
    }
    if (w % 5 === 0) q.push({ t: t * 0.35, type: 'boss', lane: 2 });
    return q.sort((a, b) => a.t - b.t);
  }
  function beginCountdown(sec) {
    waveState = 'countdown';
    countdown = sec;
  }
  function startWave() {
    waveState = 'running';
    queue = buildWave(run.wave);
    waveTotal = queue.length; waveSpawned = 0; waveClock = 0;
    const boss = run.wave % 5 === 0;
    banner = { title: 'WAVE ' + run.wave, sub: boss ? 'MOTHERSHIP INCOMING' : pickFlavor(), t: 2.2, max: 2.2, danger: boss };
    if (boss) SFX.alarm(); else SFX.wave();
  }
  function pickFlavor() {
    const w = run.wave;
    if (w === 2) return 'Speeders weave between lanes';
    if (w === 3) return 'Juggernauts shrug off weak hits';
    if (w === 4) return 'Splitters break into shards';
    if (w === 6) return 'Wardens carry energy shields';
    if (w === 7) return 'Gunships fire on your shield';
    return pick(['Hold the line', 'Incoming hostiles', 'They are getting stronger', 'Defend the base']);
  }
  function spawnEnemy(type, lane, x, y) {
    const d = ENEMY[type];
    const w = run.wave;
    let hp = d.hp * Math.pow(1.27, w - 1);
    const elite = w >= 10 && type !== 'boss' && type !== 'mini' && Math.random() < Math.min(0.35, (w - 9) * 0.04);
    if (elite) hp *= 2.2;
    const en = {
      type, d, lane, elite,
      x: x !== undefined ? x : laneX(lane) + rand(-14, 14),
      y: y !== undefined ? y : L.fieldTop - 8,
      hp, maxHp: hp,
      spd: d.spd * L.speedK * Math.min(1.7, 1.08 + (w - 1) * 0.025) * rand(0.92, 1.08),
      r: d.r * 1.2, dmg: Math.round(d.dmg * (1 + (w - 1) * 0.05)), cr: d.cr, pts: d.pts,
      flash: 0, slow: 0, warp: y !== undefined ? 1 : 0, wob: rand(0, 6.28),
      armor: type === 'tank' ? 5 * Math.pow(1.2, w - 1) : 0,
      bubble: 0, bubbleMax: 0, bubbleHit: 0,
      gunCd: rand(1.5, 2.5), stopY: 0, laneCd: rand(0.8, 1.6), tx: 0, spawnCd: 4, numAcc: 0, numT: 0,
    };
    en.tx = en.x;
    if (type === 'shielder') { en.bubbleMax = en.bubble = hp * 0.9; }
    if (type === 'gunship') en.stopY = L.fieldTop + L.field * rand(0.3, 0.5);
    if (type === 'boss') { en.x = LW / 2; en.stopY = L.fieldTop + L.field * 0.28; }
    enemies.push(en);
    return en;
  }
  function waveCleared() {
    waveState = 'countdown';
    const bonus = 15 + run.wave * 8;
    run.credits += bonus;
    run.score += run.wave * 50;
    floaters.push({ x: LW / 2, y: L.fieldTop + L.field * 0.35, txt: `WAVE CLEAR  +${bonus}`, col: '#ffd23f', life: 1.8, max: 1.8, size: 30, vy: -20 });
    run.wave++;
    run.shield = Math.min(shieldMax(), run.shield + shieldMax() * 0.05);
    if (S.tut === 3) S.tut = 4;
    snapshotRun(); writeSave();
    countdown = 5;
  }

  function gameOver() {
    screen = 'over'; overlay = null;
    SFX.over();
    shake = 0.8;
    for (let i = 0; i < 6; i++) explode(rand(0, LW), L.shieldY + rand(-10, 30), 40, '#ff5a5a');
    const score = Math.floor(run.score);
    newBest = score > S.best;
    S.best = Math.max(S.best, score);
    S.bestWave = Math.max(S.bestWave, run.wave);
    S.run = null;
    overStats = { score, wave: run.wave, kills: run.kills, shown: 0 };
    writeSave();
    submitScore(score);
  }

  // ================================================================ building & merging
  function placeTurret(tier, fromForge) {
    let i = run.slots.findIndex((v, k) => k < LANES && v === 0);
    if (i < 0) i = run.slots.findIndex((v) => v === 0);
    if (i < 0) return false;
    run.slots[i] = tier;
    discover(tier);
    popAnim[i] = 1;
    const s = SLOTS[i];
    burst(s.x, s.y, TUR[tier].col, 16, 200);
    if (fromForge) beams.push({ x1: L.forge.x, y1: L.forge.y, x2: s.x, y2: s.y, col: TUR[tier].col, life: 0.25, max: 0.25, w: 6 });
    return true;
  }
  function discover(t) {
    if (t > run.found) {
      run.found = t;
      banner = { title: 'NEW TURRET', sub: `${TUR[t].name} · ${TUR[t].info}`, t: 2.6, max: 2.6, tier: t };
    }
  }
  function forgeBuild() {
    let tier = Math.random() < run.up.luck * 0.07 ? 2 : 1;
    if (placeTurret(tier, true)) {
      run.built++;
      SFX.build();
      if (S.tut === 0) S.tut = 1;
      return true;
    }
    return false;
  }
  function hasPair() {
    const seen = {};
    for (const v of run.slots) if (v) { if (seen[v]) return true; seen[v] = 1; }
    return false;
  }
  function tryMerge(from, to) {
    const a = run.slots[from], b = run.slots[to];
    if (to === from) return;
    if (a === b && a < MAX_TIER) {
      run.slots[to] = a + 1; run.slots[from] = 0;
      discover(a + 1);
      popAnim[to] = 1;
      const s = SLOTS[to];
      burst(s.x, s.y, TUR[a + 1].col, 30, 260);
      rings.push({ x: s.x, y: s.y, r: 10, max: 70, life: 0.4, maxLife: 0.4, col: TUR[a + 1].col, w: 4 });
      floaters.push({ x: s.x, y: s.y - 60, txt: 'MERGE!', col: TUR[a + 1].col, life: 0.9, max: 0.9, size: 24, vy: -40 });
      SFX.merge();
      if (S.tut < 3) { S.tut = 3; countdown = 4; writeSave(); }
    } else {
      run.slots[to] = a; run.slots[from] = b;
      popAnim[to] = 0.5;
      const tmp = tstate[from]; tstate[from] = tstate[to]; tstate[to] = tmp;
      SFX.click();
    }
  }

  // ================================================================ effects
  function burst(x, y, col, n = 10, sp = 160, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.283), v = rand(sp * 0.25, sp);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(life * 0.5, life), max: life, col, r: rand(2, 4.5), g: 0, drag: 0.9 });
    }
  }
  function explode(x, y, r, col) {
    rings.push({ x, y, r: r * 0.3, max: r * 2.2, life: 0.35, maxLife: 0.35, col, w: 3 });
    parts.push({ x, y, vx: 0, vy: 0, life: 0.18, max: 0.18, col: '#ffffff', r: r * 1.6, flash: true });
    burst(x, y, col, Math.round(8 + r * 0.6), 120 + r * 5, 0.7);
    burst(x, y, '#ffcf6a', Math.round(4 + r * 0.3), 80 + r * 3, 0.5);
    for (let i = 0; i < Math.round(3 + r / 8); i++) {
      parts.push({ x: x + rand(-r / 2, r / 2), y: y + rand(-r / 2, r / 2), vx: rand(-20, 20), vy: rand(-30, 0), life: rand(0.6, 1.1), max: 1.1, col: '#3a3550', r: rand(r * 0.25, r * 0.5), smoke: true });
    }
  }
  function floatNum(x, y, v, col, crit) {
    floaters.push({ x: x + rand(-8, 8), y, txt: fmt(v), col: crit ? '#ffe066' : col, life: 0.7, max: 0.7, size: crit ? 24 : 17, vy: -60, pop: crit ? 1 : 0.5 });
  }

  // ================================================================ combat
  function hurt(en, dmg, col, quiet) {
    if (en.dead) return 0;
    let crit = false;
    if (!quiet && Math.random() < 0.1) { dmg *= 2; crit = true; }
    if (en.armor) dmg = Math.max(dmg * 0.25, dmg - en.armor);
    if (en.bubble > 0) {
      const a = Math.min(en.bubble, dmg);
      en.bubble -= a; dmg -= a; en.bubbleHit = 1;
      if (en.bubble <= 0) { rings.push({ x: en.x, y: en.y, r: en.r, max: en.r * 2.4, life: 0.3, maxLife: 0.3, col: '#4fa3ff', w: 3 }); }
      if (!quiet) floatNum(en.x, en.y - en.r - 8, a, '#7ab8ff', false);
    }
    if (dmg > 0) {
      en.hp -= dmg; en.flash = quiet ? Math.max(en.flash, 0.3) : 1;
      if (quiet) {
        en.numAcc += dmg;
        if (time - en.numT > 0.3) { floatNum(en.x, en.y - en.r - 8, en.numAcc, col, false); en.numAcc = 0; en.numT = time; }
      } else floatNum(en.x, en.y - en.r - 8, dmg, col, crit);
    }
    SFX.hit();
    if (en.hp <= 0) kill(en);
    return dmg;
  }
  function kill(en) {
    en.dead = true;
    run.kills++;
    const big = en.type === 'boss';
    explode(en.x, en.y, en.r, en.d.col);
    if (big) { for (let i = 0; i < 8; i++) setTimeout(() => explode(en.x + rand(-60, 60), en.y + rand(-40, 40), 30, '#ffcf6a'), i * 90); shake = Math.max(shake, 0.9); }
    shake = Math.max(shake, big ? 0.9 : en.r > 22 ? 0.18 : 0.06);
    SFX.boom(big || en.r > 22);
    run.score += en.pts * (1 + run.wave * 0.25) * (en.elite ? 2 : 1);
    const v = Math.max(1, Math.round(en.cr * Math.pow(1.13, run.wave - 1) * (en.elite ? 2 : 1)));
    const n = Math.min(big ? 14 : 5, 1 + Math.floor(v / 3));
    for (let k = 0; k < n; k++) chips.push({ sx: en.x + rand(-16, 16), sy: en.y + rand(-16, 16), t: -k * 0.05 - 0.15, v: Math.floor(v / n) + (k < v % n ? 1 : 0) });
    if (en.type === 'splitter') {
      for (const dx of [-14, 14]) {
        const m = spawnEnemy('mini', en.lane, en.x + dx, en.y);
        m.lane = clamp(Math.round((m.x - 54) / 108), 0, 4);
      }
    }
  }
  function enemyInLane(en, lane) {
    return Math.abs(en.x - laneX(lane)) < 54 + (en.type === 'boss' ? en.r * 0.8 : 0);
  }
  function findTarget(i, t) {
    const reach = reachOf(t);
    let best = null, bestScore = -1e9;
    for (const en of enemies) {
      if (en.dead || en.warp < 0.6 || en.y < L.fieldTop - 4) continue;
      let lanePen = -1;
      for (let d = 0; d <= reach; d++) {
        if ((i - d >= 0 && enemyInLane(en, i - d)) || (i + d < LANES && enemyInLane(en, i + d))) { lanePen = d; break; }
      }
      if (lanePen < 0) continue;
      const sc = en.y - lanePen * 1000;
      if (sc > bestScore) { bestScore = sc; best = en; }
    }
    return best;
  }

  function fire(i, t, target) {
    const s = SLOTS[i], st = tstate[i];
    const T = TUR[t];
    const len = t === 9 ? 50 : t === 4 ? 44 : 36;
    const mx = s.x + Math.sin(st.ang) * len, my = s.y - Math.cos(st.ang) * len;
    const dmg = dps(t) / T.rate;
    st.flash = 1; st.recoil = 1;
    SFX.shot(T.kind);
    switch (T.kind) {
      case 'bolt':
        shots.push({ kind: 'bolt', x: mx, y: my, target, dmg, t, spd: 900, r: 4 });
        break;
      case 'twin': {
        st.side = -st.side;
        const ox = Math.cos(st.ang) * 7 * st.side, oy = Math.sin(st.ang) * 7 * st.side;
        shots.push({ kind: 'bolt', x: mx + ox, y: my + oy, target, dmg, t, spd: 950, r: 4 });
        break;
      }
      case 'pulse':
        shots.push({ kind: 'orb', x: mx, y: my, target, dmg, t, spd: 650, r: 8 });
        break;
      case 'rail': {
        const x2 = mx + Math.sin(st.ang) * 2000, y2 = my - Math.cos(st.ang) * 2000;
        beams.push({ x1: mx, y1: my, x2, y2, col: T.col, life: 0.18, max: 0.18, w: 7 });
        for (const en of enemies) {
          if (en.dead) continue;
          // distance from enemy to the ray
          const dx = x2 - mx, dy = y2 - my, l2 = dx * dx + dy * dy;
          const u = clamp(((en.x - mx) * dx + (en.y - my) * dy) / l2, 0, 1);
          if (dist(en.x, en.y, mx + u * dx, my + u * dy) < en.r + 6) { hurt(en, dmg, T.col); burst(en.x, en.y, T.col, 5, 120); }
        }
        break;
      }
      case 'missile':
        shots.push({ kind: 'missile', x: mx, y: my, target, dmg, t, spd: 260, vx: Math.sin(st.ang) * 260 + rand(-120, 120), vy: -Math.cos(st.ang) * 260, r: 5, splash: 60, trail: 0 });
        break;
      case 'plasma':
        shots.push({ kind: 'orb', x: mx, y: my, target, dmg, t, spd: 520, r: 12, splash: 65 });
        break;
      case 'cryo':
        shots.push({ kind: 'bolt', x: mx, y: my, target, dmg, t, spd: 1000, r: 5, slow: 1.8 });
        break;
      case 'tesla': {
        let cur = target, px = mx, py = my;
        const hit = new Set();
        for (let k = 0; k < 5 && cur; k++) {
          beams.push({ x1: px, y1: py, x2: cur.x, y2: cur.y, col: T.col, life: 0.15, max: 0.15, w: 3, bolt: true });
          hurt(cur, dmg * Math.pow(0.85, k), T.col);
          hit.add(cur); px = cur.x; py = cur.y;
          let nxt = null, nd = 150;
          for (const en of enemies) { if (!en.dead && !hit.has(en)) { const d = dist(en.x, en.y, px, py); if (d < nd) { nd = d; nxt = en; } } }
          cur = nxt;
        }
        break;
      }
      case 'nova':
        shots.push({ kind: 'orb', x: mx, y: my, target, dmg, t, spd: 420, r: 16, splash: 120 });
        break;
    }
  }

  function zapAt(p, force) {
    if (zapCd > 0 && !force) return false;
    let best = null, bd = 80;
    for (const en of enemies) {
      if (en.dead || en.warp < 0.6) continue;
      const d = dist(en.x, en.y, p.x, p.y) - en.r;
      if (d < bd) { bd = d; best = en; }
    }
    if (!best) return false;
    zapCd = 0.16;
    if (S.tut === 3 && ++tutZaps >= 3) { S.tut = 4; writeSave(); }
    beams.push({ x1: best.x + rand(-30, 30), y1: best.y - 140, x2: best.x, y2: best.y, col: '#9ff6ff', life: 0.12, max: 0.12, w: 3, bolt: true });
    burst(best.x, best.y, '#9ff6ff', 6, 140);
    SFX.shot('zap');
    hurt(best, zapDamage(), '#9ff6ff');
    return true;
  }

  // ================================================================ input
  const pointers = new Map(); // id -> {role, x, y, start}
  let spaceHeld = false;
  let drag = null;            // {id, from, tier, x, y, moved}
  let pressed = null;         // ui button id being pressed

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale - offX, y: (e.clientY - r.top) / scale };
  }
  function slotAt(p, pad = 0) {
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i], h = s.s / 2 + pad;
      if (Math.abs(p.x - s.x) <= h && Math.abs(p.y - s.y) <= h) return i;
    }
    return -1;
  }
  const inForge = (p) => dist(p.x, p.y, L.forge.x, L.forge.y) <= L.forge.r + 12;

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    const p = toLogical(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const btn = uiHit(p);
    if (btn) { pressed = btn; pointers.set(e.pointerId, { role: 'btn', btn }); return; }
    if (screen !== 'play' || overlay) return;
    if (inForge(p)) { pointers.set(e.pointerId, { role: 'build' }); return; }
    const si = slotAt(p);
    if (si >= 0 && run.slots[si] > 0) {
      drag = { id: e.pointerId, from: si, tier: run.slots[si], x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false };
      pointers.set(e.pointerId, { role: 'drag' });
      return;
    }
    if (p.y < L.shieldY + 10) {
      pointers.set(e.pointerId, { role: 'zap', x: p.x, y: p.y });
      zapAt(p, true);
      return;
    }
    if (si < 0 && p.y > L.hangar.y && p.x < L.hangar.x) pointers.set(e.pointerId, { role: 'build' });
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toLogical(e);
    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    if (ptr.role === 'zap') { ptr.x = p.x; ptr.y = p.y; }
    if (ptr.role === 'drag' && drag && drag.id === e.pointerId) {
      drag.x = p.x; drag.y = p.y;
      if (dist(p.x, p.y, drag.sx, drag.sy) > 10) drag.moved = true;
    }
  });

  function endPointer(e, cancelled) {
    const ptr = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!ptr) return;
    const p = toLogical(e);
    if (ptr.role === 'btn') {
      if (!cancelled && uiHit(p) === ptr.btn) uiAction(ptr.btn);
      pressed = null;
      return;
    }
    if (ptr.role === 'drag' && drag && drag.id === e.pointerId) {
      const d = drag; drag = null;
      if (cancelled || screen !== 'play') return;
      if (!d.moved) {
        tooltip = { slot: d.from, t: 2.2 };
        return;
      }
      if (inRect(p, L.sell)) { sellTurret(d.from); return; }
      const to = slotAt(p, 6);
      if (to >= 0) tryMerge(d.from, to);
    }
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      initAudio();
      if (screen === 'title') { uiAction(S.run ? 'continue' : 'newgame'); return; }
      if (screen === 'over') { uiAction('retry'); return; }
      if (!overlay) spaceHeld = true;
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (screen === 'play') overlay = overlay ? null : 'pause';
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });
  window.addEventListener('blur', () => { spaceHeld = false; pointers.clear(); drag = null; });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (screen === 'play') { snapshotRunMidWave(); if (!overlay) overlay = 'pause'; }
      writeSave();
      pointers.clear(); spaceHeld = false; drag = null;
      if (audio) audio.suspend().catch(() => {});
    } else if (audio) audio.resume().catch(() => {});
  });
  // A Lens can be swiped away mid-wave; keep the run, rewound to the start of this wave.
  function snapshotRunMidWave() {
    if (!run || screen !== 'play') return;
    if (S.run && S.run.wave === run.wave) {
      S.run.slots = run.slots.slice(); S.run.up = Object.assign({}, run.up);
    } else snapshotRun();
  }

  function sellTurret(i) {
    const t = run.slots[i];
    const refund = Math.round(6 * Math.pow(2, t - 1));
    run.slots[i] = 0;
    run.credits += refund;
    floaters.push({ x: L.sell.x + 53, y: L.sell.y - 14, txt: '+' + refund, col: '#ffd23f', life: 1, max: 1, size: 22, vy: -40 });
    burst(SLOTS[i].x, SLOTS[i].y, '#8892b0', 14, 160);
    SFX.coin();
  }

  // ---- UI hit-testing (screens and overlays)
  function overlayRects() {
    const cy = L.center;
    const R = {};
    if (screen === 'title') {
      const by = cy + 120;
      if (S.run) {
        R.continue = { x: LW / 2 - 140, y: by, w: 280, h: 70 };
        R.newgame = { x: LW / 2 - 110, y: by + 86, w: 220, h: 54 };
        if (lbSupported) R.lb = { x: LW / 2 - 110, y: by + 152, w: 220, h: 54 };
      } else {
        R.newgame = { x: LW / 2 - 140, y: by, w: 280, h: 70 };
        if (lbSupported) R.lb = { x: LW / 2 - 110, y: by + 86, w: 220, h: 54 };
      }
    } else if (screen === 'over') {
      R.retry = { x: LW / 2 - 130, y: cy + 110, w: 260, h: 66 };
      if (lbSupported) R.lb = { x: LW / 2 - 110, y: cy + 192, w: 220, h: 52 };
      R.menu = { x: LW / 2 - 80, y: cy + (lbSupported ? 258 : 192), w: 160, h: 46 };
    } else if (overlay === 'pause') {
      R.resume = { x: LW / 2 - 130, y: cy - 90, w: 260, h: 64 };
      R.music = { x: LW / 2 - 130, y: cy - 10, w: 125, h: 52 };
      R.sound = { x: LW / 2 + 5, y: cy - 10, w: 125, h: 52 };
      R.quit = { x: LW / 2 - 130, y: cy + 58, w: 260, h: 52 };
      if (lbSupported) R.lb = { x: LW / 2 - 130, y: cy + 126, w: 260, h: 52 };
    } else if (overlay === 'shop') {
      const P = shopPanel();
      R.close = { x: P.x + P.w - 58, y: P.y + 10, w: 48, h: 48 };
      R.backdrop = { x: -offX, y: 0, w: VW, h: LH, under: true };
      UPG.forEach((u, i) => { R['upg_' + i] = { x: P.x + P.w - 146, y: P.rowsY + i * 82 + 14, w: 132, h: 54 }; });
    } else if (screen === 'play') {
      R.pause = L.pause; R.speed = L.speed; R.shop = L.shop;
      if (waveState === 'countdown' && S.tut >= 3) R.go = L.go;
      if (S.tut < 5) R.tutskip = tutSkipRect();
    }
    return R;
  }
  function uiHit(p) {
    if (screen === 'over' && overStats && overStats.shown < 0.6) return 'none';
    const R = overlayRects();
    let under = null;
    for (const k in R) {
      if (!inRect(p, R[k])) continue;
      if (R[k].under) { under = k; continue; }
      return k;
    }
    if (under) {
      const P = shopPanel();
      if (!inRect(p, P)) return 'close';
      return 'shopbody';
    }
    if (screen === 'title') return 'title';
    return null;
  }
  function uiAction(id) {
    if (id === 'none' || id === 'shopbody' || id === 'title') return;
    SFX.click();
    switch (id) {
      case 'continue': startRun(true); break;
      case 'newgame': S.run = null; startRun(false); break;
      case 'speed':
        S.speed = S.speed === 2 ? 1 : 2; writeSave();
        toast(S.speed === 2 ? 'SPEED 2X' : 'SPEED 1X', '#ffe680');
        break;
      case 'tutskip':
        S.tut = 5; writeSave();
        if (waveState === 'countdown') countdown = Math.min(countdown, 4);
        toast('Tutorial skipped', '#9fc6ff');
        break;
      case 'lb': showLeaderboard(); break;
      case 'retry': startRun(false); break;
      case 'menu': screen = 'title'; break;
      case 'resume': overlay = null; break;
      case 'music': setMusic(!S.music); break;
      case 'sound': setMuted(!S.muted); break;
      case 'quit': snapshotRunMidWave(); writeSave(); overlay = null; screen = 'title'; break;
      case 'close': overlay = null; break;
      case 'pause': overlay = 'pause'; break;
      case 'mute': setMuted(!S.muted); break;
      case 'shop':
        overlay = 'shop';
        if (S.tut === 4) { S.tut = 5; writeSave(); }
        break;
      case 'go': countdown = 0; run.credits += 5; floaters.push({ x: LW / 2, y: L.go.y - 16, txt: 'EARLY +5', col: '#ffd23f', life: 0.8, max: 0.8, size: 18, vy: -40 }); break;
      default:
        if (id.startsWith('upg_')) buyUpgrade(UPG[+id.slice(4)]);
    }
  }
  function tutSkipRect() {
    const y = tutPanelY();
    return { x: LW / 2 + 120, y: y - 58, w: 84, h: 30 };
  }
  const tutPanelY = () => L.shieldY - 96;

  function buyUpgrade(u) {
    const lvl = run.up[u.id];
    const cost = u.cost();
    if ((lvl !== undefined && lvl >= u.max) || run.credits < cost) { SFX.nope(); return; }
    if (u.id === 'buy') {
      if (!placeTurret(buyTier(), false)) { SFX.nope(); floaters.push({ x: LW / 2, y: L.center - 260, txt: 'NO FREE SLOT', col: '#ff5a5a', life: 1, max: 1, size: 20, vy: -20 }); return; }
      run.buys++;
    } else if (u.id === 'repair') {
      if (run.shield >= shieldMax()) { SFX.nope(); return; }
      run.shield = Math.min(shieldMax(), run.shield + shieldMax() * 0.4); run.repairs++;
    } else {
      run.up[u.id]++;
      if (u.id === 'cap') run.shield += 35;
    }
    run.credits -= cost;
    SFX.buy();
  }

  // ================================================================ update
  function update(dt) {
    time += dt;
    for (let i = 0; i < popAnim.length; i++) popAnim[i] = Math.max(0, popAnim[i] - dt * 2.5);
    shake = Math.max(0, shake - dt * 1.5);
    redFlash = Math.max(0, redFlash - dt * 2);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (tooltip) { tooltip.t -= dt; if (tooltip.t <= 0) tooltip = null; }
    if (toastMsg) { toastMsg.t -= dt; if (toastMsg.t <= 0) toastMsg = null; }
    for (const s of stars) { s.y += s.v * dt; if (s.y > L.shieldY) { s.y = 0; s.x = rand(-offX, LW + offX); } }
    for (const r of rocks) {
      r.y += r.v * dt; r.x += r.vx * dt; r.rot += r.vr * dt;
      if (r.y > L.shieldY - 20) { r.y = L.fieldTop - 30; r.x = rand(-offX, LW + offX); }
    }
    updateFx(dt);
    if (screen === 'over' && overStats) overStats.shown = Math.min(1, overStats.shown + dt * 0.8);
    if (screen !== 'play' || overlay) return;

    // ---- build
    let building = spaceHeld;
    for (const ptr of pointers.values()) if (ptr.role === 'build') building = true;
    const room = run.slots.some((v) => v === 0);
    if (building && room) {
      buildMeter += dt / buildTime();
      SFX.charge(buildMeter);
      if (buildMeter >= 1) { buildMeter = 0; forgeBuild(); }
    } else if (!building) buildMeter = Math.max(0, buildMeter - dt * 0.8);

    // ---- manual zap (hold on field)
    zapCd -= dt;
    for (const ptr of pointers.values()) if (ptr.role === 'zap') zapAt(ptr);

    // ---- waves
    if (waveState === 'countdown') {
      if (S.tut === 1 && hasPair()) S.tut = 2;
      if (S.tut < 3) { /* the guided tutorial starts the first wave after a merge */ } else {
        countdown -= dt;
        if (countdown <= 0) startWave();
      }
    } else {
      waveClock += dt;
      while (queue.length && queue[0].t <= waveClock) { const q = queue.shift(); spawnEnemy(q.type, q.lane); waveSpawned++; }
      if (!queue.length && !enemies.length) waveCleared();
    }

    // ---- enemies
    for (const en of enemies) {
      en.flash = Math.max(0, en.flash - dt * 7);
      en.bubbleHit = Math.max(0, en.bubbleHit - dt * 4);
      en.warp = Math.min(1, en.warp + dt * 2.5);
      en.slow = Math.max(0, en.slow - dt);
      const sp = en.spd * (en.slow > 0 ? 0.45 : 1);
      if (en.type === 'speeder') {
        en.laneCd -= dt;
        if (en.laneCd <= 0) {
          en.laneCd = rand(0.9, 1.7);
          en.lane = clamp(en.lane + (Math.random() < 0.5 ? -1 : 1), 0, 4);
          en.tx = laneX(en.lane);
        }
        en.x += clamp(en.tx - en.x, -160 * dt, 160 * dt);
      } else if (en.type === 'boss') {
        en.x = LW / 2 + Math.sin(time * 0.45 + en.wob) * 150;
      }
      // Gunships park mid-field and shoot; everything else keeps coming.
      if (!(en.type === 'gunship' && en.y >= en.stopY)) en.y += sp * dt;
      if (en.type === 'gunship' && en.y >= en.stopY) {
        en.gunCd -= dt;
        if (en.gunCd <= 0) {
          en.gunCd = 2.6;
          for (const dx of [-18, 18]) ebullets.push({ x: en.x + dx, y: en.y + 20, vy: 260, dmg: Math.max(3, Math.round(en.dmg * 0.35)) });
          SFX.shot('pulse');
        }
      }
      if (en.type === 'boss') {
        en.gunCd -= dt; en.spawnCd -= dt;
        if (en.gunCd <= 0) {
          en.gunCd = 2.2;
          for (const dx of [-34, 34]) ebullets.push({ x: en.x + dx, y: en.y + 50, vy: 240, dmg: 6 + run.wave });
        }
        if (en.spawnCd <= 0) {
          en.spawnCd = 4.5;
          for (const dx of [-50, 50]) { const m = spawnEnemy('scout', 0, en.x + dx, en.y + 20); m.lane = clamp(Math.round((m.x - 54) / 108), 0, 4); }
        }
      }
      if (en.y >= L.shieldY - en.r * 0.3) {
        en.dead = true; en.leaked = true;
        damageShield(en.dmg, en.x);
        explode(en.x, L.shieldY, en.r, en.d.col);
      }
    }
    enemies = enemies.filter((e) => !e.dead);
    if (run.shield <= 0) { gameOver(); return; }

    // ---- enemy bullets
    for (const b of ebullets) {
      b.y += b.vy * dt;
      if (b.y >= L.shieldY) { b.dead = true; damageShield(b.dmg, b.x, true); }
    }
    ebullets = ebullets.filter((b) => !b.dead);

    // ---- turrets
    for (let i = 0; i < LANES; i++) {
      const t = run.slots[i], st = tstate[i];
      st.flash = Math.max(0, st.flash - dt * 12);
      st.recoil = Math.max(0, st.recoil - dt * 8);
      st.beam = null;
      if (!t || (drag && drag.from === i)) continue;
      const target = findTarget(i, t);
      const s = SLOTS[i];
      const want = target ? Math.atan2(target.x - s.x, -(target.y - s.y)) : Math.sin(time * 0.8 + i) * 0.25;
      let d = want - st.ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      st.ang += d * Math.min(1, dt * 14);
      if (!target) continue;
      if (TUR[t].kind === 'ion') {
        st.beam = target;
        hurt(target, dps(t) * dt, TUR[t].col, true);
        if (Math.random() < dt * 20) burst(target.x, target.y, TUR[t].col, 1, 120, 0.3);
        if (throttle('ion', 0.12)) tone(160 + Math.random() * 30, 0.1, 'sawtooth', 0.02);
        continue;
      }
      st.cd -= dt;
      if (st.cd <= 0 && Math.abs(d) < 0.5) { st.cd = 1 / TUR[t].rate; fire(i, t, target); }
    }

    // ---- projectiles
    for (const sh of shots) {
      const tg = sh.target && !sh.target.dead ? sh.target : null;
      if (sh.kind === 'missile') {
        if (tg) {
          const want = Math.atan2(tg.y - sh.y, tg.x - sh.x), cur = Math.atan2(sh.vy, sh.vx);
          let d = want - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          const na = cur + clamp(d, -dt * 7, dt * 7);
          sh.spd = Math.min(700, sh.spd + dt * 900);
          sh.vx = Math.cos(na) * sh.spd; sh.vy = Math.sin(na) * sh.spd;
        }
        sh.trail -= dt;
        if (sh.trail <= 0) { sh.trail = 0.02; parts.push({ x: sh.x, y: sh.y, vx: rand(-10, 10), vy: rand(-10, 10), life: 0.45, max: 0.45, col: '#c8c0d8', r: rand(3, 5), smoke: true }); }
      } else if (tg) {
        const dx = tg.x - sh.x, dy = tg.y - sh.y, d = Math.hypot(dx, dy) || 1;
        sh.vx = dx / d * sh.spd; sh.vy = dy / d * sh.spd;
      } else if (sh.vx === undefined) { sh.vx = 0; sh.vy = -sh.spd; }
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      let hitEn = null;
      if (tg && dist(sh.x, sh.y, tg.x, tg.y) < tg.r + sh.r) hitEn = tg;
      else if (!tg) for (const en of enemies) if (!en.dead && dist(sh.x, sh.y, en.x, en.y) < en.r + sh.r) { hitEn = en; break; }
      if (hitEn) {
        sh.dead = true;
        const col = TUR[sh.t].col;
        hurt(hitEn, sh.dmg, col);
        if (sh.slow) { hitEn.slow = sh.slow; burst(hitEn.x, hitEn.y, '#dffbff', 6, 90); }
        if (sh.splash) {
          for (const o of enemies) if (o !== hitEn && !o.dead && dist(o.x, o.y, hitEn.x, hitEn.y) < sh.splash + o.r) hurt(o, sh.dmg * 0.6, col, false);
          explode(hitEn.x, hitEn.y, sh.splash * 0.4, col);
          if (sh.splash > 100) shake = Math.max(shake, 0.25);
        } else burst(sh.x, sh.y, col, 5, 120, 0.35);
      }
      if (sh.y < -40 || sh.y > LH || sh.x < -offX - 40 || sh.x > LW + offX + 40) sh.dead = true;
    }
    shots = shots.filter((s) => !s.dead);

    // ---- credit chips
    for (const c of chips) {
      c.t += dt * 1.7;
      if (c.t >= 1) { c.dead = true; run.credits += c.v; SFX.coin(); }
    }
    chips = chips.filter((c) => !c.dead);
  }

  function damageShield(dmg, x, small) {
    run.shield = Math.max(0, run.shield - dmg);
    rings.push({ x, y: L.shieldY, r: 8, max: small ? 40 : 90, life: 0.45, maxLife: 0.45, col: '#5ad8ff', w: 3, flat: true });
    redFlash = Math.max(redFlash, small ? 0.25 : 0.6);
    shake = Math.max(shake, small ? 0.1 : 0.35);
    floaters.push({ x, y: L.shieldY - 20, txt: '-' + dmg, col: '#ff5a5a', life: 0.8, max: 0.8, size: small ? 16 : 22, vy: -50 });
    if (small) SFX.hit(); else SFX.shield();
  }

  function updateFx(dt) {
    for (const p of parts) {
      p.life -= dt;
      if (p.flash) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = Math.pow(p.drag || 0.92, dt * 60);
      p.vx *= k; p.vy *= k;
      if (p.smoke) p.r += dt * 8;
    }
    parts = parts.filter((p) => p.life > 0);
    if (parts.length > 700) parts.splice(0, parts.length - 700);
    for (const r of rings) { r.life -= dt; r.r = lerp(r.r, r.max, Math.min(1, dt * 10)); }
    rings = rings.filter((r) => r.life > 0);
    for (const b of beams) b.life -= dt;
    beams = beams.filter((b) => b.life > 0);
    for (const f of floaters) { f.life -= dt; f.y += (f.vy || -30) * dt; }
    floaters = floaters.filter((f) => f.life > 0);
  }

  // ================================================================ drawing: UI kit
  function setFont(size, ui) { ctx.font = ui ? `700 ${size}px ${FU}` : `${size}px ${FD}`; }
  function text(str, x, y, size, col = '#fff', align = 'center', o = {}) {
    setFont(size, o.ui);
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (o.stroke !== false) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.sw || Math.max(3, size / 4.5);
      ctx.strokeStyle = o.strokeCol || 'rgba(3,4,14,0.9)';
      ctx.strokeText(str, x, y + (o.drop ? 2 : 0));
    }
    ctx.fillStyle = col;
    ctx.fillText(str, x, y);
  }
  function chamfer(x, y, w, h, c) {
    ctx.beginPath();
    ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath();
  }
  function panel(x, y, w, h, o = {}) {
    const c = o.c || 12, edge = o.edge || '#3fb8ff';
    chamfer(x, y + 4, w, h, c); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    chamfer(x, y, w, h, c);
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, o.top || 'rgba(26,36,74,0.94)'); gr.addColorStop(1, o.bot || 'rgba(10,14,34,0.94)');
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke();
    ctx.save(); chamfer(x, y, w, h, c); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, w, Math.min(h * 0.45, 26));
    ctx.restore();
    // corner accents
    ctx.fillStyle = edge;
    ctx.fillRect(x + c + 4, y - 1, 18, 3); ctx.fillRect(x + w - c - 22, y + h - 2, 18, 3);
  }
  const BTN = {
    green: ['#5dffb0', '#13b06a', '#0a5a38'],
    blue: ['#6fd8ff', '#1f7fe0', '#0f3d80'],
    gold: ['#ffe680', '#f0a818', '#8a5300'],
    red: ['#ff8a8a', '#e0304a', '#7a1020'],
    dark: ['#56638c', '#2a3354', '#141a30'],
    purple: ['#d6a8ff', '#8a4ff0', '#40207a'],
  };
  function button(r, label, theme = 'blue', o = {}) {
    const [hi, mid, lo] = BTN[theme];
    const down = pressed && o.id && pressed === o.id ? 3 : 0;
    const en = o.enabled !== false;
    ctx.globalAlpha = en ? 1 : 0.5;
    const c = Math.min(12, r.h * 0.25);
    chamfer(r.x, r.y + 5, r.w, r.h, c); ctx.fillStyle = lo; ctx.fill();
    chamfer(r.x, r.y + down, r.w, r.h, c);
    const gr = ctx.createLinearGradient(0, r.y + down, 0, r.y + down + r.h);
    gr.addColorStop(0, hi); gr.addColorStop(0.5, mid); gr.addColorStop(1, lo);
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
    ctx.save(); chamfer(r.x, r.y + down, r.w, r.h, c); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(r.x, r.y + down, r.w, r.h * 0.4);
    ctx.restore();
    if (label) text(label, r.x + r.w / 2 + (o.dx || 0), r.y + r.h / 2 + down + 1, o.size || 22, '#ffffff', 'center', { sw: 4 });
    ctx.globalAlpha = 1;
  }
  function creditIcon(x, y, r) {
    ctx.save(); ctx.translate(x, y);
    polyp(ctx, 6, r, Math.PI / 6);
    const gr = ctx.createLinearGradient(0, -r, 0, r); gr.addColorStop(0, '#fff2a0'); gr.addColorStop(0.5, '#ffc21a'); gr.addColorStop(1, '#b07000');
    ctx.fillStyle = gr; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#5a3800'; ctx.stroke();
    polyp(ctx, 6, r * 0.5, Math.PI / 6); ctx.fillStyle = '#fff6c8'; ctx.fill();
    ctx.restore();
  }
  function bar(x, y, w, h, f, c1, c2) {
    chamfer(x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    if (f > 0) {
      const fw = Math.max(h, (w - 4) * clamp(f, 0, 1));
      chamfer(x + 2, y + 2, fw, h - 4, (h - 4) / 2);
      const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
      ctx.fillStyle = gr; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x + 4, y + 3, fw - 4, Math.max(1, (h - 6) * 0.35));
    }
  }

  // ================================================================ drawing: world
  function drawWorld() {
    ctx.drawImage(bg, -offX, 0, VW, LH);
    // parallax stars
    ctx.fillStyle = 'rgba(200,225,255,0.8)';
    for (const s of stars) ctx.fillRect(s.x, s.y, s.s, s.s * 3);
    ctx.globalAlpha = 0.55;
    for (const r of rocks) blit(SPR_ROCK[r.k], r.x, r.y, r.rot, r.s);
    ctx.globalAlpha = 1;
    // lane guides
    for (let i = 0; i < LANES; i++) {
      const x = laneX(i);
      const gr = ctx.createLinearGradient(0, L.fieldTop, 0, L.shieldY);
      gr.addColorStop(0, 'rgba(80,180,255,0)'); gr.addColorStop(1, 'rgba(80,180,255,0.16)');
      ctx.fillStyle = gr; ctx.fillRect(x - 1, L.fieldTop, 2, L.field);
      for (let k = 0; k < 3; k++) {
        const y = L.shieldY - 30 - ((time * 40 + k * 26) % 78);
        ctx.strokeStyle = `rgba(90,200,255,${0.1 + (1 - (L.shieldY - y) / 110) * 0.25})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 8, y - 5); ctx.lineTo(x, y + 2); ctx.lineTo(x + 8, y - 5); ctx.stroke();
      }
    }
    if (!run || screen === 'title') return;
    // enemy bullets
    ctx.globalCompositeOperation = 'lighter';
    for (const b of ebullets) { glowAt('#ff3d6e', b.x, b.y, 14); glowAt('#ffffff', b.x, b.y, 5); }
    ctx.globalCompositeOperation = 'source-over';
    for (const en of enemies) drawEnemy(en);
    drawShield();
    drawShots();
  }

  function drawEnemy(en) {
    const s = ES[en.type];
    const bob = Math.sin(time * 5 + en.wob) * 2;
    const x = en.x, y = en.y + bob;
    // engine flames
    ctx.globalCompositeOperation = 'lighter';
    for (const [ex, ey] of ENGINES[en.type]) {
      const f = 0.75 + Math.random() * 0.4;
      const sz = (en.type === 'boss' ? 16 : 8) * f;
      ctx.save(); ctx.translate(x + ex * ESCALE, y + ey * ESCALE); ctx.scale(0.7, 1.6);
      glowAt(en.elite ? '#ffd23f' : '#ff8a3c', 0, -sz * 0.4, sz * 1.4, 0.9);
      ctx.restore();
    }
    if (en.elite) glowAt('#ffd23f', x, y, en.r * 2, 0.35);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = en.warp;
    const sc = (0.5 + en.warp * 0.5) * ESCALE;
    blit(s, x, y, 0, sc);
    if (en.flash > 0) { ctx.globalAlpha = en.warp * en.flash * 0.75; blit(ESW[en.type], x, y, 0, sc); }
    ctx.globalAlpha = 1;
    if (en.warp < 1) { ctx.globalCompositeOperation = 'lighter'; glowAt('#9ff6ff', x, y, en.r * 2.5 * (1 - en.warp), 1 - en.warp); ctx.globalCompositeOperation = 'source-over'; }
    if (en.bubble > 0) {
      const a = 0.25 + en.bubbleHit * 0.5 + (en.bubble / en.bubbleMax) * 0.2;
      ctx.strokeStyle = `rgba(110,190,255,${a + 0.2})`; ctx.lineWidth = 2.5;
      ctx.fillStyle = `rgba(80,160,255,${a * 0.35})`;
      ctx.beginPath(); ctx.arc(x, y, en.r + 9, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (en.slow > 0) {
      ctx.strokeStyle = 'rgba(190,250,255,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + time; ctx.moveTo(x + Math.cos(a) * (en.r + 2), y + Math.sin(a) * (en.r + 2)); ctx.lineTo(x + Math.cos(a) * (en.r + 8), y + Math.sin(a) * (en.r + 8)); } ctx.stroke();
    }
    if (en.hp < en.maxHp || en.type === 'boss') {
      const w = en.type === 'boss' ? 150 : en.r * 2, f = clamp(en.hp / en.maxHp, 0, 1);
      const by = y - en.r - (en.type === 'boss' ? 22 : 12);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, by - 1, w + 2, en.type === 'boss' ? 9 : 6);
      ctx.fillStyle = f > 0.5 ? '#5dff8a' : f > 0.25 ? '#ffd23f' : '#ff4a5a'; ctx.fillRect(x - w / 2, by, w * f, en.type === 'boss' ? 7 : 4);
      if (en.type === 'boss') text('MOTHERSHIP', x, by - 10, 13, '#ff8aa8', 'center', { ui: true });
    }
  }

  function drawShield() {
    const y = L.shieldY;
    const f = clamp(run.shield / shieldMax(), 0, 1);
    const col = f > 0.5 ? '#5ad8ff' : f > 0.25 ? '#ffd23f' : '#ff4a5a';
    const pulse = 0.6 + Math.sin(time * 3) * 0.15 + redFlash * 0.4;
    const x0 = -offX, w = VW;
    const gr = ctx.createLinearGradient(0, y - 30, 0, y + 6);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, 0.32 * pulse));
    ctx.fillStyle = gr; ctx.fillRect(x0, y - 30, w, 36);
    ctx.globalAlpha = 0.12 * pulse + redFlash * 0.2;
    for (let x = x0 - ((time * 10) % 30); x < x0 + w; x += 60) ctx.drawImage(SPR_HEX, x, y - 28, 60, 26);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col, 0.9); ctx.fillRect(x0, y - 1.5, w, 3);
    ctx.fillStyle = rgba(col, 0.25); ctx.fillRect(x0, y - 5, w, 10);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawShots() {
    ctx.globalCompositeOperation = 'lighter';
    for (const sh of shots) {
      const col = TUR[sh.t].col;
      if (sh.kind === 'bolt') {
        const l = Math.hypot(sh.vx || 0, sh.vy || 1) || 1;
        const tx = sh.x - (sh.vx || 0) / l * 18, ty = sh.y - (sh.vy || -1) / l * 18;
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sh.x, sh.y); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sh.x, sh.y); ctx.stroke();
      } else if (sh.kind === 'orb') {
        glowAt(col, sh.x, sh.y, sh.r * 2.6);
        glowAt('#ffffff', sh.x, sh.y, sh.r * 0.9);
      } else if (sh.kind === 'missile') {
        glowAt('#ffb04a', sh.x - sh.vx * 0.02, sh.y - sh.vy * 0.02, 12);
        ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(Math.atan2(sh.vy, sh.vx));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#e8ecf5'; ctx.fillRect(-7, -2.5, 12, 5);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(5, -2.5); ctx.lineTo(10, 0); ctx.lineTo(5, 2.5); ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      }
    }
    // beams (rail, tesla, zap, build)
    for (const b of beams) {
      const a = b.life / b.max;
      ctx.lineCap = 'round';
      if (b.bolt) {
        const pts = [[b.x1, b.y1]];
        const n = 7;
        for (let k = 1; k < n; k++) {
          const t = k / n;
          pts.push([lerp(b.x1, b.x2, t) + rand(-10, 10), lerp(b.y1, b.y2, t) + rand(-10, 10)]);
        }
        pts.push([b.x2, b.y2]);
        for (const [w, c] of [[b.w * 3, rgba(b.col, 0.35 * a)], [b.w, `rgba(255,255,255,${a})`]]) {
          ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
          pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = rgba(b.col, 0.45 * a); ctx.lineWidth = b.w * 2.2; ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = b.w * 0.5; ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      }
    }
    // ion beams
    for (let i = 0; i < LANES; i++) {
      const st = tstate[i];
      if (!st || !st.beam || st.beam.dead) continue;
      const s = SLOTS[i], mx = s.x + Math.sin(st.ang) * 50, my = s.y - Math.cos(st.ang) * 50;
      const w = 5 + Math.sin(time * 40) * 1.5;
      ctx.strokeStyle = 'rgba(125,252,255,0.35)'; ctx.lineWidth = w * 3; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(st.beam.x, st.beam.y); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w * 0.6; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(st.beam.x, st.beam.y); ctx.stroke();
      glowAt('#7dfcff', st.beam.x, st.beam.y, 22);
      glowAt('#7dfcff', mx, my, 14);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawSlots() {
    const dragTarget = drag && drag.moved ? slotAt({ x: drag.x, y: drag.y }, 6) : -1;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i], h = s.s / 2;
      const t = run.slots[i];
      const isTarget = dragTarget === i && drag.from !== i;
      const canMerge = isTarget && t === drag.tier && t < MAX_TIER;
      if (s.pad) {
        ctx.save(); ctx.translate(s.x, s.y);
        polyp(ctx, 8, 44, Math.PI / 8);
        const gr = ctx.createLinearGradient(0, -44, 0, 44); gr.addColorStop(0, '#2f3a5c'); gr.addColorStop(1, '#151b2e');
        ctx.fillStyle = gr; ctx.fill();
        ctx.lineWidth = isTarget ? 3.5 : 2; ctx.strokeStyle = canMerge ? '#5dffb0' : isTarget ? '#ffffff' : '#46557f'; ctx.stroke();
        if (!t) {
          ctx.strokeStyle = `rgba(90,200,255,${0.25 + Math.sin(time * 3 + i) * 0.15})`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.stroke(); ctx.setLineDash([]);
          text('EMPTY', 0, 0, 11, 'rgba(140,190,255,0.6)', 'center', { ui: true, stroke: false });
        }
        ctx.restore();
      } else {
        chamfer(s.x - h, s.y - h, s.s, s.s, 10);
        ctx.fillStyle = 'rgba(24,30,56,0.85)'; ctx.fill();
        ctx.lineWidth = isTarget ? 3 : 1.5; ctx.strokeStyle = canMerge ? '#5dffb0' : isTarget ? '#ffffff' : '#2e3a62'; ctx.stroke();
      }
      if (!t || (drag && drag.from === i && drag.moved)) continue;
      const pop = popAnim[i] > 0 ? easeOutBack(1 - popAnim[i]) : 1;
      const sc = (s.pad ? 1 : 0.82) * pop;
      const st = tstate[i] || { ang: 0, recoil: 0, flash: 0 };
      blit(TS.base[t], s.x, s.y, 0, sc);
      const rec = st.recoil * 4;
      const ang = s.pad ? st.ang : 0;
      blit(TS.head[t], s.x - Math.sin(ang) * rec, s.y + Math.cos(ang) * rec, ang, sc);
      if (s.pad && st.flash > 0) {
        const len = (t === 9 ? 52 : t === 4 ? 46 : 38) * sc;
        ctx.globalCompositeOperation = 'lighter';
        glowAt(TUR[t].col, s.x + Math.sin(ang) * len, s.y - Math.cos(ang) * len, 16 * st.flash);
        ctx.globalCompositeOperation = 'source-over';
      }
      // tier badge
      const bx = s.x - h + 4, by = s.y - h + 2;
      chamfer(bx, by, 26, 20, 5); ctx.fillStyle = TUR[t].col; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      text(String(t), bx + 13, by + 11, 13, '#0a0d1a', 'center', { stroke: false });
      if (canMerge) text('+1', s.x + h - 16, s.y - h + 12, 18, '#5dffb0');
    }
  }

  function drawForge() {
    const { x, y, r } = L.forge;
    let building = spaceHeld;
    for (const ptr of pointers.values()) if (ptr.role === 'build') building = true;
    const full = run && !run.slots.some((v) => v === 0);
    blit(SPR_FORGE, x, y, 0, r / 62);
    // spinning rings
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(time * (building ? 6 : 0.8));
    ctx.strokeStyle = full ? '#ff5a5a' : '#45d8ff'; ctx.lineWidth = 3;
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(0, 0, 34, k * Math.PI / 3, k * Math.PI / 3 + 0.6); ctx.stroke(); }
    ctx.rotate(-time * (building ? 10 : 1.2) * 2);
    ctx.strokeStyle = 'rgba(160,230,255,0.6)'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, 26, k * 2.09, k * 2.09 + 1.2); ctx.stroke(); }
    ctx.restore();
    // core
    ctx.globalCompositeOperation = 'lighter';
    glowAt(full ? '#ff5a5a' : '#45d8ff', x, y, 18 + buildMeter * 26 + (building ? Math.sin(time * 30) * 3 : 0), 0.6 + buildMeter * 0.4);
    ctx.globalCompositeOperation = 'source-over';
    // progress
    ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x, y, r - 4, 0, 7); ctx.stroke();
    if (buildMeter > 0) {
      ctx.strokeStyle = '#5dffb0';
      ctx.beginPath(); ctx.arc(x, y, r - 4, -Math.PI / 2, -Math.PI / 2 + buildMeter * Math.PI * 2); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    const label = full ? 'HANGAR FULL' : building ? 'BUILDING' : 'HOLD TO BUILD';
    text(label, x, y + r + 12, 14, full ? '#ff7a7a' : building ? '#5dffb0' : '#cfe6ff', 'center', { ui: true });
    if (!building && !full && run && S.tut === 0) {
      const b = Math.sin(time * 6) * 6;
      ctx.fillStyle = '#5dffb0';
      ctx.beginPath(); ctx.moveTo(x - 14, y - r - 26 + b); ctx.lineTo(x + 14, y - r - 26 + b); ctx.lineTo(x, y - r - 8 + b); ctx.fill();
    }
  }

  function drawFx() {
    // smoke first (normal blend), then glowing sparks (additive)
    for (const p of parts) {
      if (!p.smoke) continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.5;
      ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (p.smoke) continue;
      const a = clamp(p.life / p.max, 0, 1);
      if (p.flash) glowAt('#ffffff', p.x, p.y, p.r * (0.6 + a * 0.6), a);
      else glowAt(p.col, p.x, p.y, p.r * 2.4, a);
    }
    for (const r of rings) {
      const a = clamp(r.life / r.maxLife, 0, 1);
      ctx.strokeStyle = rgba(r.col.startsWith('#') ? r.col : '#ffffff', a * 0.9); ctx.lineWidth = r.w * a + 1;
      ctx.beginPath();
      if (r.flat) ctx.ellipse(r.x, r.y, r.r, r.r * 0.25, 0, 0, 7); else ctx.arc(r.x, r.y, r.r, 0, 7);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // credit chips
    for (const c of chips) {
      if (c.t < 0) { creditIcon(c.sx, c.sy, 7); continue; }
      const t = c.t, ex = L.credits.x + 26, ey = L.credits.y + 24;
      const mx = (c.sx + ex) / 2 + 90, my = Math.min(c.sy, ey) - 80;
      const x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * mx + t * t * ex;
      const y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * my + t * t * ey;
      creditIcon(x, y, 7);
    }
    for (const f of floaters) {
      const a = clamp(f.life / f.max * 2.5, 0, 1);
      const age = f.max - f.life;
      const pop = f.pop ? 1 + Math.max(0, 0.15 - age) * 4 * f.pop : 1;
      ctx.globalAlpha = a;
      text(f.txt, f.x, f.y, (f.size || 18) * pop, f.col);
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================ drawing: HUD
  function drawHUD() {
    const w = L.wave;
    panel(w.x, w.y, w.w, w.h);
    text('WAVE', w.x + 14, w.y + 18, 13, '#7fb8ff', 'left', { ui: true, stroke: false });
    text(String(run.wave), w.x + 14, w.y + 42, 28, '#ffffff', 'left');
    let prog = 0;
    if (waveState === 'running') prog = waveTotal ? (waveSpawned - enemies.filter((e) => e.type !== 'mini').length) / waveTotal : 0;
    const left = waveState === 'running' ? queue.length + enemies.length : 0;
    text(waveState === 'running' ? `${left} HOSTILES` : 'NEXT WAVE', w.x + w.w - 12, w.y + 18, 13, '#7fb8ff', 'right', { ui: true, stroke: false });
    bar(w.x + 66, w.y + 32, w.w - 80, 16, waveState === 'running' ? prog : 1 - countdown / 5, '#ffe680', '#f0a818');

    const sc = L.score;
    panel(sc.x, sc.y, sc.w, sc.h);
    text('SCORE', sc.x + sc.w / 2, sc.y + 18, 13, '#7fb8ff', 'center', { ui: true, stroke: false });
    text(fmt(run.score), sc.x + sc.w / 2, sc.y + 42, 26, '#ffffff');

    const fast = S.speed === 2;
    button(L.speed, '', fast ? 'gold' : 'dark', { id: 'speed' });
    const sd = pressed === 'speed' ? 3 : 0;
    ctx.fillStyle = '#fff';
    for (const dx of [-9, 2]) {
      ctx.beginPath(); ctx.moveTo(L.speed.x + 19 + dx, L.speed.y + 11 + sd); ctx.lineTo(L.speed.x + 29 + dx, L.speed.y + 18 + sd); ctx.lineTo(L.speed.x + 19 + dx, L.speed.y + 25 + sd); ctx.fill();
    }
    text(fast ? '2X' : '1X', L.speed.x + 26, L.speed.y + 37 + sd, 15, '#ffffff', 'center', { sw: 3 });
    button(L.pause, '', 'dark', { id: 'pause' });
    ctx.fillStyle = '#fff';
    const pd = pressed === 'pause' ? 3 : 0;
    ctx.fillRect(L.pause.x + 18, L.pause.y + 15 + pd, 6, 22); ctx.fillRect(L.pause.x + 29, L.pause.y + 15 + pd, 6, 22);

    const sb = L.shieldBar;
    const f = run.shield / shieldMax();
    bar(sb.x, sb.y, sb.w, sb.h, f, f > 0.5 ? '#8ff0ff' : f > 0.25 ? '#ffe680' : '#ff8a8a', f > 0.5 ? '#1f8fe0' : f > 0.25 ? '#f0a818' : '#c0203a');
    text(`SHIELD  ${Math.ceil(run.shield)} / ${shieldMax()}`, sb.x + sb.w / 2, sb.y + sb.h / 2 + 1, 13, '#ffffff', 'center', { ui: true, sw: 3 });

    // bottom bar
    const overSell = drag && drag.moved && inRect({ x: drag.x, y: drag.y }, L.sell);
    button(L.sell, 'SELL', overSell ? 'red' : 'dark', { size: 18, dx: 10 });
    drawBin(L.sell.x + 22, L.sell.y + 24);
    const c = L.credits;
    panel(c.x, c.y, c.w, c.h, { edge: '#ffc21a', c: 10 });
    creditIcon(c.x + 26, c.y + 24, 13);
    text(fmt(run.credits), c.x + 48, c.y + 25, 24, '#ffe680', 'left');
    const affordable = UPG.some((u) => (run.up[u.id] === undefined || run.up[u.id] < u.max) && run.credits >= u.cost() && !(u.id === 'repair' && run.shield >= shieldMax()));
    button(L.shop, 'SHOP', 'gold', { id: 'shop', size: 22 });
    if (affordable) {
      const b = 1 + Math.sin(time * 8) * 0.12;
      ctx.fillStyle = '#ff3d6e'; ctx.beginPath(); ctx.arc(L.shop.x + L.shop.w - 4, L.shop.y + 2, 9 * b, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      text('!', L.shop.x + L.shop.w - 4, L.shop.y + 3, 12, '#fff', 'center', { stroke: false });
    }

    if (waveState === 'countdown' && S.tut >= 3) {
      const cy = L.go.y - 44;
      text(`WAVE ${run.wave} IN ${Math.ceil(countdown)}`, LW / 2, cy, 26, '#ffffff');
      button(L.go, 'GO NOW', 'green', { id: 'go', size: 22 });
    }
  }
  function drawSpeaker(x, y, muted) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(x - 12, y - 5); ctx.lineTo(x - 5, y - 5); ctx.lineTo(x + 3, y - 12); ctx.lineTo(x + 3, y + 12); ctx.lineTo(x - 5, y + 5); ctx.lineTo(x - 12, y + 5); ctx.fill();
    ctx.strokeStyle = muted ? '#ff5a5a' : '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    if (muted) { ctx.moveTo(x + 8, y - 6); ctx.lineTo(x + 16, y + 6); ctx.moveTo(x + 16, y - 6); ctx.lineTo(x + 8, y + 6); }
    else { ctx.arc(x + 4, y, 8, -0.8, 0.8); ctx.moveTo(x + 4 + Math.cos(-0.8) * 13, y + Math.sin(-0.8) * 13); ctx.arc(x + 4, y, 13, -0.8, 0.8); }
    ctx.stroke(); ctx.lineCap = 'butt';
  }
  function drawBin(x, y) {
    ctx.fillStyle = '#ffd7e0';
    ctx.fillRect(x - 9, y - 10, 18, 3); ctx.fillRect(x - 3, y - 13, 6, 3);
    ctx.beginPath(); ctx.moveTo(x - 7, y - 5); ctx.lineTo(x + 7, y - 5); ctx.lineTo(x + 5, y + 11); ctx.lineTo(x - 5, y + 11); ctx.fill();
  }

  function drawHand(x, y, down) {
    const p = down ? 4 : 0;
    ctx.save(); ctx.translate(x, y + p); ctx.rotate(-0.35);
    if (down) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 16 + (time * 40) % 14, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0a0d1a'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, 4); ctx.arcTo(-6, -4, 0, -4, 6); ctx.arcTo(6, -4, 6, 4, 6);
    ctx.lineTo(6, 22); ctx.lineTo(13, 20); ctx.arcTo(19, 19, 19, 25, 5); ctx.lineTo(23, 24); ctx.arcTo(29, 24, 29, 30, 5);
    ctx.lineTo(29, 50); ctx.arcTo(29, 60, 19, 60, 9); ctx.lineTo(-4, 60); ctx.arcTo(-14, 60, -14, 50, 8);
    ctx.lineTo(-14, 34); ctx.lineTo(-22, 26); ctx.arcTo(-26, 20, -18, 18, 5); ctx.lineTo(-6, 26); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function spotlight(x, y, r) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-offX, 0, VW, LH); ctx.arc(x, y, r, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(2,3,12,0.55)'; ctx.fill('evenodd');
    ctx.strokeStyle = `rgba(93,255,176,${0.6 + Math.sin(time * 6) * 0.3})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    ctx.restore();
  }
  function tutPanel(title, sub) {
    const y = tutPanelY();
    panel(LW / 2 - 210, y - 64, 420, 84, { edge: '#5dffb0' });
    text(title, LW / 2, y - 34, 24, '#5dffb0');
    text(sub, LW / 2, y - 6, 17, '#ffffff', 'center', { ui: true });
    const r = tutSkipRect();
    chamfer(r.x, r.y, r.w, r.h, 6); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    text('SKIP', r.x + r.w / 2, r.y + r.h / 2 + 1, 13, '#cfe6ff', 'center', { ui: true, stroke: false });
  }
  function drawTutorial() {
    if (S.tut >= 5 || overlay) return;
    const press = Math.floor(time * 1.4) % 2 === 0;
    if (S.tut === 0 || S.tut === 1) {
      const { x, y, r } = L.forge;
      spotlight(x, y, r + 14);
      drawHand(x + 10, y + 6, press);
      tutPanel(S.tut === 0 ? 'HOLD TO BUILD' : 'BUILD ONE MORE', 'Hold the Fabricator (or SPACE) until the ring fills');
    } else if (S.tut === 2) {
      let a = -1, b = -1;
      for (let i = 0; i < run.slots.length && b < 0; i++) for (let j = i + 1; j < run.slots.length; j++) if (run.slots[i] && run.slots[i] === run.slots[j]) { a = j; b = i; break; }
      if (a >= 0) {
        const t = (time % 2.2) / 1.6;
        const k = clamp(t, 0, 1), e = k * k * (3 - 2 * k);
        const A = SLOTS[a], B = SLOTS[b];
        for (const s of [A, B]) { ctx.strokeStyle = `rgba(93,255,176,${0.5 + Math.sin(time * 6) * 0.3})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 50, 0, 7); ctx.stroke(); }
        ctx.setLineDash([8, 8]); ctx.strokeStyle = 'rgba(93,255,176,0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
        const hx = lerp(A.x, B.x, e), hy = lerp(A.y, B.y, e);
        if (t > 0.05 && t < 1) { ctx.globalAlpha = 0.6; blit(TS.icon[run.slots[a]], hx, hy - 20, 0, 0.8); ctx.globalAlpha = 1; }
        drawHand(hx + 8, hy + 4, t < 1.05);
      }
      tutPanel('DRAG TO MERGE', 'Drop a turret on a matching one to upgrade it');
    } else if (S.tut === 3) {
      if (waveState === 'running' && enemies.length) {
        let tg = null;
        for (const en of enemies) if (en.warp >= 1 && (!tg || en.y > tg.y)) tg = en;
        if (tg) drawHand(tg.x + 6, tg.y + 8, press);
        tutPanel('TAP ALIENS TO ZAP', 'Turrets fire on their own lane · you can help');
      } else tutPanel('GET READY', 'Aliens come down the 5 lanes toward your shield');
    } else if (S.tut === 4 && waveState === 'countdown') {
      const r = L.shop;
      drawHand(r.x + r.w / 2 + 6, r.y + r.h / 2 + 6, press);
      tutPanel('OPEN THE SHOP', 'Spend credits on turrets, repairs and upgrades');
    }
  }

  function drawToast() {
    if (!toastMsg) return;
    const a = clamp(toastMsg.t * 3, 0, 1);
    const y = screen === 'play' ? L.fieldTop + 24 : L.bottom - 26;
    ctx.globalAlpha = a;
    setFont(18, true);
    const w = Math.min(500, ctx.measureText(toastMsg.txt).width + 40);
    chamfer(LW / 2 - w / 2, y - 18, w, 36, 8); ctx.fillStyle = 'rgba(6,10,30,0.92)'; ctx.fill();
    ctx.strokeStyle = toastMsg.col; ctx.lineWidth = 1.5; ctx.stroke();
    text(toastMsg.txt, LW / 2, y + 1, 18, toastMsg.col, 'center', { ui: true, stroke: false });
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    if (!banner) return;
    const age = banner.max - banner.t;
    const inT = clamp(age / 0.25, 0, 1), outT = clamp(banner.t / 0.3, 0, 1);
    const a = Math.min(inT, outT);
    const y = L.fieldTop + L.field * 0.45;
    const slide = (1 - easeOutBack(inT)) * -300;
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(slide, 0);
    const col = banner.danger ? '#ff3d6e' : banner.tier ? TUR[banner.tier].col : '#45d8ff';
    // full-width ribbon
    const gr = ctx.createLinearGradient(-offX, 0, LW + offX, 0);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.2, 'rgba(6,10,30,0.88)'); gr.addColorStop(0.8, 'rgba(6,10,30,0.88)'); gr.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gr; ctx.fillRect(-offX, y - 48, VW, 96);
    ctx.fillStyle = col; ctx.fillRect(-offX, y - 48, VW, 2); ctx.fillRect(-offX, y + 46, VW, 2);
    if (banner.tier) {
      blit(TS.icon[banner.tier], 90, y + 2, 0, 0.85);
      text(banner.title, 300, y - 16, 30, col);
      text(banner.sub, 300, y + 20, 18, '#ffffff', 'center', { ui: true });
    } else {
      if (banner.danger && Math.floor(time * 4) % 2) { ctx.globalAlpha = a * 0.6; }
      text(banner.title, LW / 2, y - 12, 44, banner.danger ? '#ff6a8a' : '#ffffff');
      ctx.globalAlpha = a;
      text(banner.sub, LW / 2, y + 26, 18, col, 'center', { ui: true });
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawTooltip() {
    if (!tooltip || !run) return;
    const t = run.slots[tooltip.slot];
    if (!t) return;
    const s = SLOTS[tooltip.slot];
    const w = 230, h = 92;
    const x = clamp(s.x - w / 2, 8, LW - w - 8), y = s.y - s.s / 2 - h - 10;
    ctx.globalAlpha = clamp(tooltip.t * 3, 0, 1);
    panel(x, y, w, h, { edge: TUR[t].col });
    text(`${TUR[t].name}`, x + 14, y + 22, 18, TUR[t].col, 'left');
    text(`Tier ${t} · ${TUR[t].info}`, x + 14, y + 46, 15, '#ffffff', 'left', { ui: true, stroke: false });
    const reach = reachOf(t);
    text(`DPS ${fmt(dps(t))} · ${reach === 0 ? 'Own lane' : reach === 1 ? '3 lanes' : 'All lanes'}`, x + 14, y + 70, 15, '#9fc6ff', 'left', { ui: true, stroke: false });
    ctx.globalAlpha = 1;
  }

  // ---- overlays
  function dim(a = 0.7) { ctx.fillStyle = `rgba(2,3,12,${a})`; ctx.fillRect(-offX, 0, VW, LH); }

  function drawTitle() {
    dim(0.45);
    const cy = L.center;
    const bob = Math.sin(time * 1.6) * 5;
    // logo
    ctx.save();
    ctx.shadowColor = '#45d8ff'; ctx.shadowBlur = 30;
    setFont(76); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const gr = ctx.createLinearGradient(0, cy - 300, 0, cy - 200);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#8ff0ff'); gr.addColorStop(1, '#3a7bff');
    ctx.lineWidth = 10; ctx.strokeStyle = '#06102e'; ctx.strokeText('STAR', LW / 2, cy - 290 + bob);
    ctx.fillStyle = gr; ctx.fillText('STAR', LW / 2, cy - 290 + bob);
    const gr2 = ctx.createLinearGradient(0, cy - 230, 0, cy - 160);
    gr2.addColorStop(0, '#ffe680'); gr2.addColorStop(1, '#ff6a3c');
    ctx.shadowColor = '#ff8a3c';
    ctx.strokeText('FORGE', LW / 2, cy - 215 + bob);
    ctx.fillStyle = gr2; ctx.fillText('FORGE', LW / 2, cy - 215 + bob);
    ctx.restore();
    text('MERGE  ·  BUILD  ·  DEFEND', LW / 2, cy - 160, 18, '#cfe6ff', 'center', { ui: true });
    // showcase
    const tier = 1 + Math.floor(time / 1.4) % MAX_TIER;
    const glowCol = TUR[tier].col;
    ctx.globalCompositeOperation = 'lighter'; glowAt(glowCol, LW / 2, cy - 40, 110, 0.35); ctx.globalCompositeOperation = 'source-over';
    blit(TS.base[tier], LW / 2, cy - 40, 0, 1.5);
    blit(TS.head[tier], LW / 2, cy - 40, Math.sin(time * 1.5) * 0.6, 1.5);
    text(`TIER ${tier}  ${TUR[tier].name.toUpperCase()}`, LW / 2, cy + 50, 18, glowCol, 'center');
    text(TUR[tier].info, LW / 2, cy + 76, 16, '#cfe6ff', 'center', { ui: true });
    const R = overlayRects();
    if (R.continue) button(R.continue, `CONTINUE · WAVE ${S.run.wave}`, 'green', { id: 'continue', size: 22 });
    button(R.newgame, S.run ? 'NEW GAME' : 'PLAY', S.run ? 'blue' : 'green', { id: 'newgame', size: S.run ? 20 : 30 });
    if (R.lb) button(R.lb, 'LEADERBOARD', 'purple', { id: 'lb', size: 18 });
    const lastY = (R.lb || R.newgame).y + (R.lb || R.newgame).h;
    text(`BEST SCORE  ${fmt(S.best)}   ·   BEST WAVE  ${S.bestWave}`, LW / 2, lastY + 30, 16, '#ffe680', 'center', { ui: true });
  }

  function drawPause() {
    dim();
    const cy = L.center;
    panel(LW / 2 - 165, cy - 200, 330, lbSupported ? 404 : 340);
    text('PAUSED', LW / 2, cy - 160, 38);
    text(`Wave ${run.wave}  ·  Score ${fmt(run.score)}`, LW / 2, cy - 122, 18, '#9fc6ff', 'center', { ui: true });
    const R = overlayRects();
    button(R.resume, 'RESUME', 'green', { id: 'resume', size: 26 });
    button(R.music, S.music ? 'MUSIC ON' : 'MUSIC OFF', S.music ? 'blue' : 'dark', { id: 'music', size: 16 });
    button(R.sound, S.muted ? 'SFX OFF' : 'SFX ON', S.muted ? 'dark' : 'blue', { id: 'sound', size: 16 });
    button(R.quit, 'SAVE & QUIT', 'dark', { id: 'quit', size: 18 });
    if (R.lb) button(R.lb, 'LEADERBOARD', 'purple', { id: 'lb', size: 18 });
  }

  function shopPanel() {
    const h = 196 + UPG.length * 82;
    const y = clamp(L.center - h / 2, L.top, L.bottom - h);
    return { x: 18, y, w: 504, h, rowsY: y + 182 };
  }
  function drawShop() {
    dim();
    const P = shopPanel();
    panel(P.x, P.y, P.w, P.h, { edge: '#ffc21a' });
    text('ARMORY', P.x + 24, P.y + 34, 30, '#ffe680', 'left');
    creditIcon(P.x + 200, P.y + 34, 12);
    text(fmt(run.credits), P.x + 220, P.y + 35, 22, '#ffe680', 'left');
    const R = overlayRects();
    button(R.close, 'X', 'red', { id: 'close', size: 22 });
    // collection
    for (let t = 1; t <= MAX_TIER; t++) {
      const col = (t - 1) % 5, row = Math.floor((t - 1) / 5);
      const x = P.x + 58 + col * 97, y = P.y + 94 + row * 46;
      chamfer(x - 44, y - 21, 88, 42, 7); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = t <= run.found ? TUR[t].col : '#2e3a62'; ctx.stroke();
      if (t <= run.found) {
        blit(TS.icon[t], x - 24, y + 1, 0, 0.36);
        text(String(t), x + 2, y - 8, 13, TUR[t].col, 'left');
        text(TUR[t].short, x + 2, y + 9, 11, '#cfe6ff', 'left', { ui: true, stroke: false });
      } else text('?', x, y + 1, 22, '#3d4a73', 'center', { stroke: false });
    }
    UPG.forEach((u, i) => {
      const y = P.rowsY + i * 82;
      chamfer(P.x + 14, y, P.w - 28, 74, 10); ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fill();
      ctx.strokeStyle = 'rgba(80,110,180,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      const lvl = run.up[u.id];
      // icon
      chamfer(P.x + 26, y + 13, 48, 48, 8);
      ctx.fillStyle = u.id === 'buy' ? '#1f7fe0' : u.id === 'repair' ? '#13b06a' : '#40207a'; ctx.fill();
      if (u.id === 'buy') blit(TS.icon[buyTier()], P.x + 50, y + 37, 0, 0.4);
      else text(u.icon, P.x + 50, y + 38, 24, '#ffffff');
      text(u.name + (lvl !== undefined ? `  LV ${lvl}` : ''), P.x + 88, y + 26, 18, '#ffffff', 'left');
      text(u.desc(), P.x + 88, y + 52, 16, '#9fc6ff', 'left', { ui: true, stroke: false });
      const maxed = lvl !== undefined && lvl >= u.max;
      const cost = u.cost();
      const full = u.id === 'repair' && run.shield >= shieldMax();
      const can = !maxed && !full && run.credits >= cost;
      const r = R['upg_' + i];
      button(r, maxed ? 'MAX' : full ? 'FULL' : fmt(cost), can ? 'gold' : 'dark', { id: 'upg_' + i, size: 20, dx: maxed || full ? 0 : 12, enabled: can || maxed || full });
      if (!maxed && !full) creditIcon(r.x + 22, r.y + 27 + (pressed === 'upg_' + i ? 3 : 0), 10);
    });
  }

  function drawGameOver() {
    dim(0.75);
    const cy = L.center;
    const a = overStats.shown;
    const P = { x: LW / 2 - 200, y: cy - 250, w: 400, h: lbSupported ? 570 : 510 };
    ctx.globalAlpha = clamp(a * 2, 0, 1);
    panel(P.x, P.y, P.w, P.h, { edge: '#ff3d6e' });
    text('BASE DESTROYED', LW / 2, P.y + 46, 32, '#ff6a8a');
    text('FINAL SCORE', LW / 2, cy - 130, 16, '#9fc6ff', 'center', { ui: true });
    text(fmt(overStats.score * Math.min(1, a * 1.4)), LW / 2, cy - 90, 52, '#ffffff');
    if (newBest && a > 0.7) {
      const s = 1 + Math.sin(time * 6) * 0.06;
      ctx.save(); ctx.translate(LW / 2, cy - 42); ctx.scale(s, s);
      button({ x: -80, y: -16, w: 160, h: 32 }, 'NEW BEST!', 'gold', { size: 16 });
      ctx.restore();
    }
    const rows = [['WAVE REACHED', overStats.wave], ['ALIENS DESTROYED', overStats.kills], ['BEST SCORE', fmt(S.best)]];
    rows.forEach(([k, v], i) => {
      const y = cy + 2 + i * 30;
      text(k, P.x + 40, y, 17, '#9fc6ff', 'left', { ui: true, stroke: false });
      text(String(v), P.x + P.w - 40, y, 20, '#ffffff', 'right');
    });
    const R = overlayRects();
    button(R.retry, 'PLAY AGAIN', 'green', { id: 'retry', size: 26 });
    if (R.lb) button(R.lb, 'LEADERBOARD', 'purple', { id: 'lb', size: 18 });
    button(R.menu, 'MENU', 'dark', { id: 'menu', size: 16 });
    ctx.globalAlpha = 1;
  }

  function drawLoading() {
    ctx.fillStyle = '#05061a'; ctx.fillRect(-offX, 0, VW, LH);
    const cy = LH / 2;
    text('STARFORGE', LW / 2, cy - 30, 40, '#8ff0ff');
    const w = 220, f = (time * 0.6) % 1;
    bar(LW / 2 - w / 2, cy + 14, w, 14, f, '#8ff0ff', '#1f8fe0');
  }

  function drawSafeZone() {
    ctx.fillStyle = 'rgba(255,0,80,0.25)';
    ctx.fillRect(-offX, 0, VW, ST); ctx.fillRect(-offX, LH - SB, VW, SB);
    ctx.strokeStyle = '#ff0050'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-offX, ST); ctx.lineTo(LW + offX, ST); ctx.moveTo(-offX, LH - SB); ctx.lineTo(LW + offX, LH - SB); ctx.stroke();
    text('SNAP SAFE ZONE', LW / 2, ST - 14, 14, '#ff8aa8', 'center', { ui: true });
  }

  // ================================================================ render
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05061a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = dpr * scale;
    const sx = shake > 0 ? rand(-8, 8) * shake : 0, sy = shake > 0 ? rand(-8, 8) * shake : 0;
    ctx.setTransform(k, 0, 0, k, (offX + sx) * k, sy * k);
    if (screen === 'loading' || !bg) { drawLoading(); return; }
    drawWorld();
    if (run && screen !== 'title') {
      drawSlots();
      drawForge();
      drawFx();
      if (redFlash > 0) {
        const gr = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.3, LW / 2, LH / 2, LH * 0.75);
        gr.addColorStop(0, 'rgba(255,0,40,0)'); gr.addColorStop(1, `rgba(255,0,40,${redFlash * 0.45})`);
        ctx.fillStyle = gr; ctx.fillRect(-offX, 0, VW, LH);
      }
      ctx.setTransform(k, 0, 0, k, offX * k, 0);
      drawHUD();
      drawTutorial();
      drawBanner();
      drawTooltip();
      if (drag && drag.moved) {
        blit(TS.base[drag.tier], drag.x, drag.y - 20, 0, 1.1);
        blit(TS.head[drag.tier], drag.x, drag.y - 20, 0, 1.1);
      }
      if (overlay === 'pause') drawPause();
      else if (overlay === 'shop') drawShop();
      if (screen === 'over') drawGameOver();
    } else {
      drawFx();
      ctx.setTransform(k, 0, 0, k, offX * k, 0);
      drawTitle();
    }
    drawToast();
    if (hand) drawHand(hand.x, hand.y, hand.down);
    if (SHOW_SAFE) drawSafeZone();
  }

  // ================================================================ loop
  let last = performance.now();
  let timeScale = 1, manual = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    requestAnimationFrame(frame);
    if (manual) return;
    const k = screen === 'play' && !overlay ? (S.speed || 1) : 1;
    try {
      for (let i = 0; i < timeScale * k; i++) update(dt);
      render();
    } catch (e) { console.error(e); }
  }
  window.addEventListener('resize', resize);
  if (DEBUG) {
    window.__sf = {
      get run() { return run; }, get screen() { return screen; }, get enemies() { return enemies; },
      merge: tryMerge, over: () => gameOver(),
      set manual(v) { manual = v; }, step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) update(dt); render(); },
      set hand(v) { hand = v; }, set banner(v) { banner = v; },
      setDrag(from, x, y) { drag = from < 0 ? null : { id: -1, from, tier: run.slots[from], x, y, sx: 0, sy: 0, moved: true }; },
      spawn: (type, x, y) => { const e = spawnEnemy(type, clamp(Math.round((x - 54) / 108), 0, 4), x, y); return e; },
      kill: (e) => kill(e), sprites: () => ({ TS, ES, SPR_FORGE, glow }),
      rects: () => overlayRects(), screenOf: (x, y) => [(x + offX) * scale, y * scale],
      get S() { return S; }, get overlay() { return overlay; }, build: forgeBuild, buy: (i) => buyUpgrade(UPG[i]), go: () => { countdown = 0; },
      L, SLOTS, start: () => startRun(false), setTut: (v) => { S.tut = v; },
      set speed(v) { timeScale = v; }, hold(v) { spaceHeld = v; }, zap: (x, y) => zapAt({ x, y }, true),
    };
  }
  resize();
  requestAnimationFrame(frame);
  boot();
})();
