/* Bow Bots: an endless ragdoll archery Snapchat Web Lens.
 * Drag back and release to shoot. Robot archers keep flying in on floating
 * islands; every kill counts toward your lifetime total on the leaderboard.
 * Everything is drawn in code; the only bundled assets are two fonts. */
(() => {
  'use strict';

  // ================================================================ config
  const CFG = {
    // Snapchat draws its own controls over the top and bottom of a Lens.
    // Everything the player reads or touches stays inside these fractions of
    // the screen height (or the device's safe-area insets, whichever is
    // larger); only scenery is drawn outside. Add #safe to the URL to see it.
    SAFE_TOP: 0.11,
    SAFE_BOTTOM: 0.14,
  };
  const LW = 540;               // logical width
  const MIN_CONTENT_H = 860;    // logical height the UI needs inside the safe zone
  const STEP = 1 / 120;         // fixed physics step
  const GRAV = 1150;            // arrow gravity
  const RAG_G = 1500;           // ragdoll gravity
  const ARROW_LEN = 46;
  const SHOT_COST = 10;
  const JUMP_COST = 20;
  const OUT = '#1b1d2a';        // outline ink

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
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.41;
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const fmt = (n) => {
    n = Math.floor(n);
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
  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(hex, f) {
    let [r, g, b] = hexRgb(hex);
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  // Closest points between segments p1-q1 and p2-q2 (Ericson). Returns squared distance and params.
  function segSeg(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
    const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y;
    const rx = p1x - p2x, ry = p1y - p2y;
    const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
    let s, t;
    if (a < 1e-9 && e < 1e-9) { s = 0; t = 0; }
    else if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
    else {
      const c = d1x * rx + d1y * ry;
      if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
      else {
        const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
        s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    const cx = p1x + d1x * s, cy = p1y + d1y * s, kx = p2x + d2x * t, ky = p2y + d2y * t;
    return { d2: (cx - kx) * (cx - kx) + (cy - ky) * (cy - ky), s, t, cx, cy };
  }

  // ================================================================ game data
  const UPG = [
    { id: 'hp',    name: 'HEALTH',         info: '+15 max health',         max: 10, base: 12,  col: '#ff5a64', icon: 'heal' },
    { id: 'armor', name: 'ARMOR',          info: '-5% damage taken',       max: 8,  base: 15,  col: '#ff9a5a', icon: 'shield' },
    { id: 'dmg',   name: 'DAMAGE',         info: '+12% arrow damage',      max: 10, base: 15,  col: '#ffc531', icon: 'sword' },
    { id: 'sta',   name: 'STAMINA',        info: '+15 max stamina',        max: 10, base: 10,  col: '#4f9dff', icon: 'bolt' },
    { id: 'regen', name: 'STAMINA REFILL', info: '+15% refill speed',      max: 10, base: 10,  col: '#5ad0ff', icon: 'bolt' },
    { id: 'power', name: 'BOW POWER',      info: 'Faster, flatter arrows', max: 5,  base: 20,  col: '#b6f04a', icon: 'bow' },
    { id: 'vamp',  name: 'LIFE STEAL',     info: '+4 health per kill',     max: 5,  base: 30,  col: '#ff5ad8', icon: 'heal' },
    { id: 'multi', name: 'ARROW SLOTS',    info: '+1 arrow per shot',      max: 2,  base: 120, col: '#ffffff', icon: 'triple' },
  ];
  const upCost = (u, lvl) => Math.round(u.base * Math.pow(1.55, lvl));
  const lvlOf = (id) => S.up[id] || 0;

  const ETYPE = {
    archer: { name: 'ARCHER', col: '#ff4d5e', hp: 1,   dmg: 1,   reload: 1,   acc: 1,    draw: 0.9, coins: 3 },
    scout:  { name: 'SCOUT',  col: '#3ddc84', hp: 0.7, dmg: 0.7, reload: 0.6, acc: 1.2,  draw: 0.6, coins: 3 },
    heavy:  { name: 'HEAVY',  col: '#ff9f1c', hp: 1.7, dmg: 1.2, reload: 1.3, acc: 1,    draw: 1.1, coins: 5, helmet: true },
    sniper: { name: 'SNIPER', col: '#b46cff', hp: 0.9, dmg: 1.7, reload: 1.5, acc: 0.35, draw: 1.6, coins: 5, laser: true },
    boss:   { name: 'BOSS',   col: '#ff3355', hp: 3.5, dmg: 1.3, reload: 1.2, acc: 0.8,  draw: 1.2, coins: 20, volley: 3, s: 1.6, crown: true },
    golden: { name: 'GOLDEN', col: '#ffd23f', hp: 0.8, dmg: 0,   reload: 1,   acc: 1,    draw: 1,   coins: 25, golden: true },
  };

  // Power-up balloons that drift up through the sky.
  const PW = {
    fire:   { col: '#ff7a1a', label: 'FIRE ARROWS', dur: 12, w: 2 },
    triple: { col: '#3fa9ff', label: 'TRIPLE SHOT', dur: 12, w: 2 },
    bomb:   { col: '#ff4d5e', label: 'BOMB ARROWS', dur: 10, w: 1.5 },
    freeze: { col: '#7fe8ff', label: 'FREEZE!',     dur: 0,  w: 1.2 },
    heal:   { col: '#3ddc84', label: '+40 HP',      dur: 0,  w: 1.5 },
    coins:  { col: '#ffc531', label: '+15 COINS',   dur: 0,  w: 1.5 },
  };
  const COMBO = ['', '', 'DOUBLE KILL!', 'TRIPLE KILL!', 'QUAD KILL!', 'RAMPAGE!', 'UNSTOPPABLE!', 'GODLIKE!'];

  // Sky themes; the scene moves to the next one each time a boss falls.
  const THEMES = [
    { name: 'SKY MEADOW', sky: ['#4fa8e8', '#bfe7ff'], body: 'sun', bodyCol: '#fff6c4', far: '#9cc8e6', mid: '#7cc47a', near: '#4f9e58', cloud: '#ffffff', grass: '#63c74d', rock: '#8a7a6a', stars: 0 },
    { name: 'SUNSET PEAKS', sky: ['#4a3a8c', '#ff9b6a'], body: 'sun', bodyCol: '#ffe08a', far: '#c46a8a', mid: '#8a4a7a', near: '#55305e', cloud: '#ffd2c2', grass: '#7ac74d', rock: '#7a5f6e', stars: 0.25 },
    { name: 'MOONLIT WILDS', sky: ['#0c1233', '#33408a'], body: 'moon', bodyCol: '#f2f4ff', far: '#2c3672', mid: '#212a5a', near: '#161c40', cloud: '#8f9ad6', grass: '#3f9a6a', rock: '#5a5f7a', stars: 1 },
    { name: 'EMBER RIDGE', sky: ['#1e0a10', '#b5462a'], body: 'sun', bodyCol: '#ff8a4a', far: '#6a2a2a', mid: '#45181d', near: '#2a0d12', cloud: '#e09a7a', grass: '#c9a24d', rock: '#5a3a36', stars: 0.5, embers: true },
  ];

  // Skeleton: 0 head, 1 neck, 2 pelvis, 3 bow elbow, 4 bow hand, 5 string elbow,
  // 6 string hand, 7 front knee, 8 front foot, 9 back knee, 10 back foot.
  const CAPS = [
    [1, 0, 11, 'head'], [1, 2, 9, 'body'],
    [1, 3, 5.5, 'limb'], [3, 4, 5.5, 'limb'], [1, 5, 5.5, 'limb'], [5, 6, 5.5, 'limb'],
    [2, 7, 6, 'limb'], [7, 8, 6, 'limb'], [2, 9, 6, 'limb'], [9, 10, 6, 'limb'],
  ];
  const RAG_CONS = [[0, 1], [1, 2], [1, 3], [3, 4], [1, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10], [0, 2], [1, 7], [1, 9]];
  const BODY_SEGS = [[1, 5, 9], [5, 6, 8], [2, 9, 10], [9, 10, 9], [1, 2, 17], [0, 1, 7], [2, 7, 10], [7, 8, 9], [1, 3, 9], [3, 4, 8]];

  // ================================================================ view
  let dpr = 1, scale = 1, VW = LW, LH = 960, offX = 0, ST = 0, SB = 0;
  const L = {};
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
    bgCache.length = 0;
    towerCanvas = null;
    initClouds();
  }

  function layout() {
    const T = ST, B = LH - SB;
    L.T = T; L.B = B;
    L.kills = { x: 12, y: T + 6, w: 150, h: 54 };
    L.coins = { x: LW / 2 - 64, y: T + 6, w: 128, h: 54 };
    L.pause = { x: LW - 66, y: T + 6, w: 54, h: 54 };
    L.tower = { x: 26, w: 140, top: B - 236 };
    L.px = L.tower.x + L.tower.w / 2;
    L.py = L.tower.top;
    L.hp = { x: L.tower.x + 14, y: L.tower.top + 34, w: L.tower.w - 28, h: 22 };
    L.st = { x: L.hp.x, y: L.hp.y + 28, w: L.hp.w, h: 18 };
    L.jump = { x: L.tower.x + 18, y: L.st.y + 30, w: L.tower.w - 36, h: 60 };
    L.zone = { x0: 295, x1: 480, y0: T + 230, y1: B - 40 };
  }

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale - offX, y: (e.clientY - r.top) / scale };
  }

  // ================================================================ background
  const bgCache = [];
  let themeCur = 0, themePrev = -1, themeFade = 1;
  const clouds = [];
  function initClouds() {
    clouds.length = 0;
    for (let i = 0; i < 6; i++) clouds.push({ x: rand(-offX, LW + offX), y: rand(L.T + 20, LH * 0.5), s: rand(0.6, 1.3), v: rand(6, 16) });
  }
  function themeBg(i) {
    if (bgCache[i]) return bgCache[i];
    const th = THEMES[i];
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    const k = dpr * scale;
    g.setTransform(k, 0, 0, k, offX * k, 0);
    const x0 = -offX - 2, x1 = LW + offX + 2;
    const gr = g.createLinearGradient(0, 0, 0, LH);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.75, th.sky[1]); gr.addColorStop(1, th.sky[1]);
    g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, LH);
    const rnd = seeded(31 + i);
    if (th.stars) {
      g.fillStyle = '#ffffff';
      for (let n = 0; n < 160 * th.stars; n++) {
        g.globalAlpha = 0.25 + rnd() * 0.7;
        const r = 0.6 + rnd() * 1.4;
        g.beginPath(); g.arc(x0 + rnd() * (x1 - x0), rnd() * LH * 0.6, r, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
    }
    // sun or moon
    const bx = LW * 0.74, by = L.T + 200, br = 46;
    const glow = g.createRadialGradient(bx, by, br * 0.6, bx, by, br * 3.2);
    glow.addColorStop(0, rgba(th.bodyCol, 0.55)); glow.addColorStop(1, rgba(th.bodyCol, 0));
    g.fillStyle = glow; g.beginPath(); g.arc(bx, by, br * 3.2, 0, 6.283); g.fill();
    g.fillStyle = th.bodyCol; g.beginPath(); g.arc(bx, by, br, 0, 6.283); g.fill();
    if (th.body === 'moon') {
      g.fillStyle = 'rgba(160,170,210,0.45)';
      for (const [dx, dy, r] of [[-14, -10, 9], [12, 8, 12], [-6, 20, 6], [18, -18, 5]]) { g.beginPath(); g.arc(bx + dx, by + dy, r, 0, 6.283); g.fill(); }
    }
    // mountain ranges, far to near
    const ridge = (base, amp, col, jag, seed) => {
      const r2 = seeded(seed);
      g.fillStyle = col; g.beginPath(); g.moveTo(x0, LH); g.lineTo(x0, base);
      let x = x0;
      while (x < x1) {
        const w = jag ? 40 + r2() * 70 : 60 + r2() * 90;
        const peak = base - amp * (0.35 + r2() * 0.65);
        if (jag) { g.lineTo(x + w * 0.5, peak); g.lineTo(x + w, base - amp * r2() * 0.3); }
        else g.quadraticCurveTo(x + w * 0.5, peak - amp * 0.3, x + w, base - amp * r2() * 0.2);
        x += w;
      }
      g.lineTo(x1, LH); g.closePath(); g.fill();
    };
    ridge(LH * 0.6, LH * 0.2, th.far, true, 5 + i);
    ridge(LH * 0.72, LH * 0.12, th.mid, false, 9 + i);
    ridge(LH * 0.82, LH * 0.08, th.near, false, 13 + i);
    // pine treeline
    g.fillStyle = th.near;
    const r3 = seeded(17 + i);
    for (let x = x0; x < x1; x += 14 + r3() * 18) {
      const h = 26 + r3() * 40, w = 14 + r3() * 10, yb = LH * 0.86 - r3() * 10;
      g.beginPath(); g.moveTo(x, yb); g.lineTo(x + w / 2, yb - h); g.lineTo(x + w, yb); g.closePath(); g.fill();
    }
    g.fillRect(x0, LH * 0.86 - 4, x1 - x0, LH);
    bgCache[i] = c;
    return c;
  }
  function drawCloud(x, y, s, col, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, 6.283); ctx.arc(x + 26 * s, y - 12 * s, 28 * s, 0, 6.283);
    ctx.arc(x + 56 * s, y - 2 * s, 22 * s, 0, 6.283); ctx.arc(x + 30 * s, y + 6 * s, 20 * s, 0, 6.283);
    ctx.ellipse(x + 28 * s, y + 8 * s, 44 * s, 14 * s, 0, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = a * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x + 20 * s, y - 16 * s, 10 * s, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawBackground(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (themeFade < 1 && themePrev >= 0) {
      ctx.drawImage(themeBg(themePrev), 0, 0);
      ctx.globalAlpha = themeFade;
      ctx.drawImage(themeBg(themeCur), 0, 0);
      ctx.globalAlpha = 1;
      themeFade = Math.min(1, themeFade + dt / 1.5);
    } else ctx.drawImage(themeBg(themeCur), 0, 0);
    const k = dpr * scale;
    ctx.setTransform(k, 0, 0, k, offX * k, 0);
    const th = THEMES[themeCur];
    for (const c of clouds) {
      c.x -= c.v * dt;
      if (c.x < -offX - 120 * c.s) { c.x = LW + offX + 20; c.y = rand(L.T + 20, LH * 0.5); }
      drawCloud(c.x, c.y, c.s, th.cloud, th.stars >= 1 ? 0.35 : 0.8);
    }
  }
  // A soft sea of clouds fills Snapchat's bottom bar; bodies fall into it.
  function drawCloudSea() {
    const th = THEMES[themeCur], B = L.B;
    const x0 = -offX - 60, x1 = LW + offX + 60;
    for (let row = 0; row < 2; row++) {
      const col = row ? th.cloud : shade(th.cloud, -0.15);
      const y = B + 6 + row * 26, sp = row ? 10 : 5;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0, x = x0 - ((clock * sp) % 52); x < x1 + 52; i++, x += 52) {
        const r = 30 + ((i * 37) % 17), cy = y + Math.sin(i * 1.7 + clock * 0.6) * 4;
        ctx.moveTo(x + r, cy); ctx.arc(x, cy, r, 0, 6.283);
      }
      ctx.fill();
      ctx.fillRect(x0, y, x1 - x0, LH - y + 10);
    }
    const gr = ctx.createLinearGradient(0, B + 40, 0, LH);
    gr.addColorStop(0, rgba(th.cloud, 0)); gr.addColorStop(1, rgba(th.sky[0], 0.35));
    ctx.fillStyle = gr; ctx.fillRect(x0, B + 40, x1 - x0, LH - B);
  }

  // ================================================================ save data
  const freshSave = () => ({ v: 1, coins: 0, total: 0, best: 0, up: {}, muted: false, tut: 0 });
  let S = freshSave();
  let saveLoaded = false, saving = false, saveDirty = false;
  let lbSupported = false;

  async function boot() {
    resize();
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
    if (saved && saved.v === 1) S = Object.assign(freshSave(), saved, { up: Object.assign({}, saved.up) });
    shownCoins = S.coins;
    player = makePlayer();
    screen = 'title';
  }

  // One write in flight at a time; a write requested meanwhile runs once afterwards.
  function writeSave() {
    if (!saveLoaded || !snap) return;
    if (saving) { saveDirty = true; return; }
    saving = true;
    const state = JSON.parse(JSON.stringify(S));
    snap.storage.set('save', state)
      .catch((e) => console.warn('Save failed:', e && e.message))
      .then(() => { saving = false; if (saveDirty) { saveDirty = false; writeSave(); } });
  }
  // The leaderboard ranks lifetime total kills.
  function submitTotal() {
    if (!lbSupported || S.total <= 0) return Promise.resolve();
    return snap.leaderboards.submitScore({ score: Math.round(S.total) })
      .catch((e) => console.warn('Leaderboard submit failed:', e && e.message));
  }
  async function showLeaderboard() {
    if (!lbSupported) { toast('Leaderboard is not available here', '#ff8a8a'); return; }
    try {
      if (S.total > 0) await snap.leaderboards.submitScore({ score: Math.round(S.total) });
      await snap.leaderboards.show();
      // The desktop stub accepts the call but has no panel to open.
      if (snap.isStub) toast('Kills sent · the leaderboard opens inside Snapchat', '#9fc6ff');
    } catch (e) {
      console.warn('Leaderboard unavailable:', e && e.message);
      toast('Leaderboard unavailable right now', '#ff8a8a');
    }
  }

  // ================================================================ audio
  let audio = null, master = null, noiseBuf = null;
  function initAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain(); master.gain.value = S.muted ? 0 : 0.7; master.connect(audio.destination);
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.6, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function setMuted(m) {
    S.muted = m;
    if (master) master.gain.value = m ? 0 : 0.7;
    writeSave();
  }
  function tone(type, f0, f1, dur, vol, delay = 0) {
    if (!audio || S.muted) return;
    const t = audio.currentTime + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, ftype, freq, delay = 0) {
    if (!audio || S.muted) return;
    const t = audio.currentTime + delay;
    const s = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    s.buffer = noiseBuf; f.type = ftype; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  const SFX = {
    shoot() { tone('triangle', 220, 70, 0.16, 0.35); noise(0.12, 0.25, 'highpass', 2500); },
    enemyShoot() { tone('triangle', 170, 60, 0.14, 0.18); noise(0.1, 0.12, 'highpass', 2200); },
    hit() { tone('square', 300, 120, 0.08, 0.12); noise(0.08, 0.3, 'bandpass', 1800); },
    head() { tone('sine', 880, 870, 0.25, 0.25); tone('sine', 1320, 1300, 0.3, 0.18, 0.04); noise(0.08, 0.3, 'highpass', 3000); },
    wood() { tone('sine', 520, 260, 0.08, 0.3); noise(0.05, 0.2, 'bandpass', 1500); },
    tick() { tone('square', 1700, 1700, 0.03, 0.04); },
    hurt() { tone('sawtooth', 240, 90, 0.25, 0.22); noise(0.15, 0.3, 'lowpass', 500); },
    jump() { tone('sine', 300, 700, 0.15, 0.18); },
    block() { tone('square', 1800, 900, 0.08, 0.1); noise(0.06, 0.25, 'highpass', 4000); },
    pop() { noise(0.12, 0.5, 'highpass', 1200); tone('sine', 700, 1400, 0.12, 0.2); },
    power() { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.1, 0.08, i * 0.06)); },
    boom() { noise(0.6, 0.6, 'lowpass', 400); tone('sine', 120, 30, 0.5, 0.5); },
    freeze() { tone('sine', 1800, 600, 0.5, 0.15); noise(0.4, 0.2, 'highpass', 5000); },
    bird() { tone('triangle', 1500, 2400, 0.08, 0.12); tone('triangle', 1700, 2600, 0.08, 0.1, 0.09); },
    combo(n) { for (let i = 0; i < Math.min(n, 5); i++) tone('square', 440 * Math.pow(1.26, i), 440 * Math.pow(1.26, i), 0.09, 0.08, i * 0.05); },
    level() { [392, 523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, 0.15, i * 0.09)); },
    die() { tone('sawtooth', 300, 40, 0.8, 0.25); },
    botDie() { tone('square', 600, 80, 0.35, 0.12); noise(0.25, 0.3, 'bandpass', 2400); },
    boss() { tone('sawtooth', 110, 110, 0.5, 0.2); tone('sawtooth', 165, 165, 0.6, 0.15, 0.15); },
    buy() { tone('square', 660, 660, 0.06, 0.1); tone('square', 990, 990, 0.1, 0.1, 0.07); tone('square', 1320, 1320, 0.14, 0.1, 0.14); },
    no() { tone('square', 160, 120, 0.15, 0.15); },
    click() { tone('sine', 700, 500, 0.05, 0.15); },
  };

  // ================================================================ state
  let screen = 'load';          // load | title | play | over | shop
  let overlay = null;           // null | pause
  let shopFrom = 'title';
  let run = null, player = null;
  const enemies = [], arrows = [], plats = [], parts = [], texts = [], picks = [], coinFx = [];
  let aim = null;               // { id, ax, ay, x, y }
  let slowT = 0, shakeT = 0, shakeMag = 0, flashT = 0, banner = null, toastMsg = null;
  let buttons = [], pressed = null;
  let clock = 0, shownCoins = 0, coinPulse = 0;
  let hideHud = false;          // debug: clean frames for marketing renders

  function makeFig(o) {
    return Object.assign({
      x: 0, y: 0, face: 1, s: 1.2, aim: -0.25, draw: 0, flinch: 0, t: rand(0, 6), flash: 0,
      hp: 100, maxHp: 100, alive: true, rag: null, kneel: false, col: '#3ddc84',
      frozen: 0, burn: 0, burnDps: 0,
      pts: Array.from({ length: 11 }, () => ({ x: 0, y: 0 })),
    }, o);
  }
  function makePlayer() {
    const p = makeFig({ isPlayer: true, jy: 0, jv: 0 });
    p.x = L.px; p.y = L.py; pose(p);
    return p;
  }
  function stats() {
    return {
      maxHp: 100 + 15 * lvlOf('hp'),
      armor: 0.05 * lvlOf('armor'),
      dmg: 34 * (1 + 0.12 * lvlOf('dmg')),
      maxSt: 60 + 15 * lvlOf('sta'),
      regen: 16 * (1 + 0.15 * lvlOf('regen')),
      power: 1 + 0.06 * lvlOf('power'),
      vamp: 4 * lvlOf('vamp'),
      arrows: 1 + lvlOf('multi'),
    };
  }
  function setTheme(i) {
    if (i === themeCur) return;
    themePrev = themeCur; themeCur = i; themeFade = 0;
  }

  function clearScene() {
    enemies.length = 0; arrows.length = 0; plats.length = 0; parts.length = 0; texts.length = 0;
    picks.length = 0; coinFx.length = 0;
    aim = null; slowT = 0; banner = null; overlay = null; flashT = 0;
    shownCoins = S.coins;
  }
  function startRun() {
    clearScene();
    const st = stats();
    run = {
      st, hp: st.maxHp, sta: st.maxSt, staWait: 0, kills: 0, coins: 0, heads: 0, shots: 0,
      spawnT: 0.6, nextBoss: 10, pickT: rand(5, 8), overT: 0, time: 0, tut: S.tut === 0, staFlash: 0,
      pw: { fire: 0, triple: 0, bomb: 0 }, combo: 0, comboT: 0, bestCombo: 0, level: 1,
    };
    setTheme(0);
    player = makePlayer();
    player.hp = player.maxHp = st.maxHp;
    screen = 'play';
  }

  function endRun() {
    if (!run) return;
    S.best = Math.max(S.best, run.kills);
    writeSave();
    submitTotal();
  }

  // ================================================================ figures
  function setP(p, x, y) { p.x = x; p.y = y; }
  function pose(f) {
    const s = f.s, d = f.face, P = f.pts;
    const br = Math.sin(f.t * 2.4) * s;
    let px, py;
    if (f.kneel) {
      px = f.x - d * 4 * s; py = f.y - 22 * s;
      setP(P[7], f.x + d * 12 * s, f.y - 20 * s);
      setP(P[8], f.x + d * 14 * s, f.y);
      setP(P[9], f.x - d * 6 * s, f.y - 2 * s);
      setP(P[10], f.x - d * 24 * s, f.y - s);
    } else {
      px = f.x; py = f.y - 34 * s;
      setP(P[7], f.x + d * 7 * s, f.y - 17 * s);
      setP(P[8], f.x + d * 11 * s, f.y);
      setP(P[9], f.x - d * 4 * s, f.y - 17 * s);
      setP(P[10], f.x - d * 10 * s, f.y);
    }
    setP(P[2], px, py + br * 0.3);
    const lean = -d * f.flinch * 9 * s;
    setP(P[1], px + lean, py - 31 * s + br);
    setP(P[0], P[1].x + lean * 0.6, P[1].y - 15 * s);
    const ux = Math.cos(f.aim), uy = Math.sin(f.aim);
    let nx = -uy, ny = ux;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const shx = P[1].x, shy = P[1].y + 4 * s;
    setP(P[4], shx + ux * 30 * s, shy + uy * 30 * s);
    setP(P[3], shx + ux * 15 * s + nx * 2 * s, shy + uy * 15 * s + ny * 2 * s);
    const pull = (9 + 26 * f.draw) * s;
    setP(P[6], P[4].x - ux * pull, P[4].y - uy * pull);
    const eb = (6 - 14 * f.draw) * s;
    setP(P[5], shx + ux * eb + nx * 9 * s, shy + uy * eb + ny * 9 * s);
  }
  const ptsOf = (f) => (f.rag ? f.rag.p : f.pts);
  // Where a shot leaves the bow when drawn to `draw` at angle a.
  function shotOrigin(f, a, draw) {
    const sv = { aim: f.aim, draw: f.draw };
    f.aim = a; f.draw = draw; pose(f);
    const P = f.pts, pull = (9 + 26 * draw) * f.s;
    const o = { x: P[4].x + Math.cos(a) * (ARROW_LEN - pull), y: P[4].y + Math.sin(a) * (ARROW_LEN - pull) };
    f.aim = sv.aim; f.draw = sv.draw; pose(f);
    return o;
  }

  function makeRag(f, ix, iy, hitI) {
    const P = f.pts;
    const p = P.map((q, i) => {
      const w = i === hitI ? 1 : 0.45;
      return { x: q.x, y: q.y, px: q.x - ix * w * STEP, py: q.y - (iy * w + (f.jv || 0)) * STEP };
    });
    const cons = RAG_CONS.map(([a, b]) => [a, b, dist(P[a].x, P[a].y, P[b].x, P[b].y)]);
    f.rag = { p, cons, t: 0 };
  }
  function solids() {
    const out = [{ x: L.tower.x, y: L.tower.top, w: L.tower.w, h: LH * 2 }];
    for (const pl of plats) out.push(platRect(pl));
    return out;
  }
  function stepRag(f, h, rects) {
    const R = f.rag; R.t += h;
    for (const q of R.p) {
      const vx = (q.x - q.px) * 0.998, vy = (q.y - q.py) * 0.998;
      q.px = q.x; q.py = q.y; q.x += vx; q.y += vy + RAG_G * h * h;
    }
    const pr = 5 * f.s;
    for (let it = 0; it < 5; it++) {
      for (const c of R.cons) {
        const A = R.p[c[0]], B = R.p[c[1]];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6;
        const k = (d - c[2]) / d * 0.5;
        A.x += dx * k; A.y += dy * k; B.x -= dx * k; B.y -= dy * k;
      }
      for (const q of R.p) {
        for (const r of rects) {
          const x0 = r.x - pr, x1 = r.x + r.w + pr, y0 = r.y - pr, y1 = r.y + r.h + pr;
          if (q.x <= x0 || q.x >= x1 || q.y <= y0 || q.y >= y1) continue;
          const l = q.x - x0, rt = x1 - q.x, t = q.y - y0, b = y1 - q.y, m = Math.min(l, rt, t, b);
          if (m === t) { q.y = y0; q.px = q.x - (q.x - q.px) * 0.5; if (r.vy) q.py = q.y - r.vy * h; }
          else if (m === l) q.x = x0;
          else if (m === rt) q.x = x1;
          else q.y = y1;
        }
      }
    }
  }

  // ================================================================ enemies
  function platRect(pl) { return { x: pl.cx - pl.w / 2, y: pl.y, w: pl.w, h: pl.h, vy: pl.vy }; }
  function pickType(k) {
    const pool = [['archer', 5]];
    if (k >= 4) pool.push(['scout', 3]);
    if (k >= 10) pool.push(['heavy', 2 + Math.min(3, (k - 10) / 10)]);
    if (k >= 18) pool.push(['sniper', 2 + Math.min(3, (k - 18) / 10)]);
    let tot = 0; for (const p of pool) tot += p[1];
    let r = Math.random() * tot;
    for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
    return 'archer';
  }
  function spawnEnemy(type) {
    const k = run.kills;
    const T = ETYPE[type], s = T.s || 1.2;
    const Z = L.zone;
    let x = 0, y = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = type === 'boss' ? rand(Z.x0 + 50, Z.x1 - 30) : rand(Z.x0, Z.x1);
      y = rand(Z.y0, Z.y1);
      let ok = true;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.plat.tx - x) < 110 && Math.abs(e.plat.baseY - y) < 150) { ok = false; break; }
      }
      if (ok) break;
    }
    const moving = type !== 'golden' && k >= 15 && Math.random() < Math.min(0.6, 0.25 + k * 0.005);
    const pl = {
      tx: x, cx: LW + 90, y, baseY: y, w: type === 'boss' ? 112 : 84, h: 24, enter: 0, vy: 0, falling: false,
      move: moving ? { amp: rand(25, 55), sp: rand(0.7, 1.3), ph: rand(0, 6.28) } : null, t: 0, seed: randInt(1e6),
    };
    plats.push(pl);
    const hp = Math.round((45 + 5 * k) * T.hp);
    const e = makeFig({
      type, T, s, face: -1, kneel: type !== 'boss', col: T.col, hp, maxHp: hp, plat: pl,
      state: 'enter', timer: rand(0.5, 1.3), aim: Math.PI + 0.2, life: 0,
      dmg: Math.min(32, 9 + 0.3 * k) * T.dmg,
      reload: Math.max(1.0, 2.8 - 0.05 * k) * T.reload,
      sigma: Math.max(0.025, 0.11 - 0.0025 * k) * T.acc,
      speed: Math.min(1150, 900 + 6 * k),
    });
    e.x = pl.cx; e.y = pl.y; pose(e);
    enemies.push(e);
    if (type === 'boss') { setBanner('BOSS INCOMING', 'Shoot it before it shoots you', '#ff3355', 2.2); SFX.boss(); }
    if (type === 'golden') { setBanner('GOLDEN BOT!', 'Hit it before it escapes', '#ffd23f', 2); SFX.power(); }
    return e;
  }

  // Low-arc launch angle for speed v from o to target, or 45 degrees when out of range.
  function solveShot(ox, oy, tx, ty, v) {
    const dx = tx - ox, X = Math.abs(dx), Y = oy - ty, v2 = v * v;
    const disc = v2 * v2 - GRAV * (GRAV * X * X + 2 * Y * v2);
    const th = disc < 0 ? Math.PI / 4 : Math.atan2(v2 - Math.sqrt(disc), GRAV * X);
    const sx = dx < 0 ? -1 : 1;
    return Math.atan2(-Math.sin(th), sx * Math.cos(th));
  }
  function botAim(e) {
    // Aim at the player standing on the tower, so a jump can dodge the shot.
    const tx = L.px, ty = L.py - 52;
    let a = solveShot(e.pts[1].x, e.pts[1].y, tx, ty, e.speed);
    const o = shotOrigin(e, a, 1);
    a = solveShot(o.x, o.y, tx, ty, e.speed);
    return { a, o };
  }

  function updateEnemy(e, h) {
    e.t += h; e.flash = Math.max(0, e.flash - h * 4); e.flinch = Math.max(0, e.flinch - h * 3);
    if (!e.alive) return;
    const pl = e.plat;
    e.x = pl.cx; e.y = pl.y;
    e.life += h;
    if (e.burn > 0) {
      e.burn -= h;
      damageEnemy(e, e.burnDps * h, 'body', 0, -60, true);
      if (Math.random() < h * 30) {
        const q = e.pts[randInt(11)];
        parts.push({ kind: 'fire', x: q.x + rand(-4, 4), y: q.y, vx: rand(-10, 10), vy: rand(-90, -50), life: rand(0.3, 0.5), max: 0.5, r: rand(4, 7), g: -40 });
      }
      if (!e.alive) return;
    }
    if (e.frozen > 0) { e.frozen -= h; pose(e); return; }
    if (e.T.golden) {
      if (e.life > 7 && e.state !== 'flee') { e.state = 'flee'; floatText(e.pts[0].x, e.pts[0].y - 40, 'ESCAPED!', '#ffd23f', 22); }
      if (e.state === 'flee') { pl.cx += 260 * h; pl.tx = pl.cx; }
      else if (pl.enter >= 1) e.state = 'wait';
      e.aim = Math.PI - 0.4 + Math.sin(e.t * 3) * 0.3; e.draw = 0;
      pose(e);
      return;
    }
    const canShoot = player.alive && screen === 'play' && !(run.tut && run.shots === 0);
    if (e.state === 'enter') {
      if (pl.enter >= 1) e.state = 'wait';
      e.aim = Math.PI + 0.2;
    } else if (e.state === 'wait') {
      e.draw = Math.max(0, e.draw - h * 4);
      if (canShoot) e.timer -= h;
      if (e.timer <= 0 && canShoot) { e.state = 'draw'; e.shot = botAim(e); }
      else e.aim += angDiff(e.aim, Math.PI + 0.2) * (1 - Math.exp(-4 * h));
    } else if (e.state === 'draw') {
      e.draw = Math.min(1, e.draw + h / e.T.draw);
      e.aim += angDiff(e.aim, e.shot.a) * (1 - Math.exp(-10 * h));
      if (e.draw >= 1 && Math.abs(angDiff(e.aim, e.shot.a)) < 0.03) {
        if (canShoot) enemyFire(e);
        e.state = 'wait'; e.timer = e.reload * rand(0.8, 1.2);
      }
    }
    pose(e);
  }
  function enemyFire(e) {
    const { a } = botAim(e);
    const n = e.T.volley || 1;
    for (let i = 0; i < n; i++) {
      const aa = a + (i - (n - 1) / 2) * 0.07 + gauss() * e.sigma;
      const v = e.speed * (1 + gauss() * e.sigma * 0.6);
      const o = shotOrigin(e, aa, 1);
      arrows.push(makeArrow(o.x, o.y, Math.cos(aa) * v, Math.sin(aa) * v, 'e', e.dmg));
    }
    e.draw = 0;
    SFX.enemyShoot();
  }

  // ================================================================ arrows
  function makeArrow(x, y, vx, vy, owner, dmg) {
    return { x, y, vx, vy, ang: Math.atan2(vy, vx), owner, dmg, stuck: null, life: 0, spent: false, tr: [], fire: false, bomb: false };
  }
  function playerFire(a, power) {
    const st = run.st;
    if (run.sta < SHOT_COST) {
      run.staFlash = 0.6; SFX.no();
      floatText(player.pts[0].x, player.pts[0].y - 30, 'NO STAMINA', '#6fb2ff', 20);
      return;
    }
    run.sta -= SHOT_COST; run.staWait = 0.45;
    run.shots++;
    const v = (420 + 760 * power) * st.power;
    const n = st.arrows + (run.pw.triple > 0 ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const aa = a + (i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.05);
      const o = shotOrigin(player, aa, power);
      const ar = makeArrow(o.x, o.y, Math.cos(aa) * v, Math.sin(aa) * v, 'p', st.dmg);
      ar.fire = run.pw.fire > 0; ar.bomb = run.pw.bomb > 0;
      arrows.push(ar);
    }
    player.draw = 0;
    SFX.shoot();
  }

  function figHit(f, ox, oy, nx, ny) {
    const P = ptsOf(f);
    let best = null;
    for (const c of CAPS) {
      const A = P[c[0]], B = P[c[1]];
      const r = c[2] * f.s;
      const res = c[3] === 'head' ? segSeg(ox, oy, nx, ny, B.x, B.y, B.x, B.y) : segSeg(ox, oy, nx, ny, A.x, A.y, B.x, B.y);
      if (res.d2 <= r * r && (!best || res.s < best.s)) best = { s: res.s, cx: res.cx, cy: res.cy, part: c[3], i: c[0], j: c[1] };
    }
    return best;
  }
  function stickToFig(a, f, hit) {
    const P = ptsOf(f), A = P[hit.i], B = P[hit.j];
    const ux = Math.cos(a.ang), uy = Math.sin(a.ang);
    const hx = hit.cx + ux * 7, hy = hit.cy + uy * 7;
    let ex = B.x - A.x, ey = B.y - A.y; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const rx = hx - A.x, ry = hy - A.y;
    a.stuck = { kind: 'fig', f, i: hit.i, j: hit.j, along: rx * ex + ry * ey, perp: rx * -ey + ry * ex, rel: a.ang - Math.atan2(ey, ex) };
    a.vx = a.vy = 0; a.life = 0; a.tr.length = 0;
  }
  function arrowPose(a) {
    const s = a.stuck;
    if (!s) return { x: a.x, y: a.y, ang: a.ang };
    if (s.kind === 'fig') {
      const P = ptsOf(s.f), A = P[s.i], B = P[s.j];
      let ex = B.x - A.x, ey = B.y - A.y; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
      return { x: A.x + ex * s.along - ey * s.perp, y: A.y + ey * s.along + ex * s.perp, ang: Math.atan2(ey, ex) + s.rel };
    }
    if (s.kind === 'plat') return { x: s.pl.cx + s.dx, y: s.pl.y + s.dy, ang: a.ang };
    return { x: a.x, y: a.y, ang: a.ang };
  }

  function updateArrows(h) {
    for (let k = arrows.length - 1; k >= 0; k--) {
      const a = arrows[k];
      if (!a) continue;
      a.life += h;
      if (a.stuck) {
        const s = a.stuck;
        const gone = (s.kind === 'fig' && !enemies.includes(s.f) && s.f !== player) ||
          (s.kind === 'plat' && !plats.includes(s.pl)) || (s.kind === 'tower' && a.life > 8);
        if (gone) arrows.splice(k, 1);
        continue;
      }
      const ox = a.x, oy = a.y;
      a.vy += GRAV * h; a.x += a.vx * h; a.y += a.vy * h;
      a.ang = Math.atan2(a.vy, a.vx);
      a.tr.push(a.x, a.y); if (a.tr.length > 20) a.tr.splice(0, 2);
      if (a.fire && Math.random() < h * 40) parts.push({ kind: 'fire', x: a.x, y: a.y, vx: rand(-20, 20), vy: rand(-40, 0), life: 0.3, max: 0.3, r: rand(3, 5), g: -30 });
      if (a.spent) {
        a.spin = (a.spin || 0) + h * 14;
        if (a.y > LH + 80) arrows.splice(k, 1);
        continue;
      }
      if (a.x < -offX - 300 || a.x > LW + offX + 300 || a.y > LH + 80) { arrows.splice(k, 1); continue; }
      if (a.owner === 'p') {
        // shoot down incoming arrows
        let blocked = false;
        for (const b of arrows) {
          if (b.owner !== 'e' || b.stuck || b.spent) continue;
          const bt = ARROW_LEN * 0.8;
          const r = segSeg(ox, oy, a.x, a.y, b.x, b.y, b.x - Math.cos(b.ang) * bt, b.y - Math.sin(b.ang) * bt);
          if (r.d2 < 64) {
            for (const z of [a, b]) { z.spent = true; z.vx *= -0.25; z.vy = -260; }
            burst(r.cx, r.cy, 12, '#ffe27a', 240);
            floatText(r.cx, r.cy - 20, 'BLOCKED! +1', '#ffe27a', 20);
            gainCoins(1, r.cx, r.cy); SFX.block();
            blocked = true; break;
          }
        }
        if (blocked) continue;
        for (const pk of picks) {
          if (pk.hit) continue;
          const r = segSeg(ox, oy, a.x, a.y, pk.x, pk.y, pk.x, pk.y);
          if (r.d2 < pk.r * pk.r) hitPick(pk, a);
        }
      }
      // figures
      let best = null, bf = null;
      const targets = a.owner === 'p' ? enemies : [player];
      for (const f of targets) {
        if (!f || (a.owner === 'e' && !f.alive)) continue;
        const hit = figHit(f, ox, oy, a.x, a.y);
        if (hit && (!best || hit.s < best.s)) { best = hit; bf = f; }
      }
      if (best) { arrowHitsFig(a, bf, best); if (a.bomb) explode(best.cx, best.cy, a.dmg); continue; }
      // blocks
      const tw = { x: L.tower.x, y: L.tower.top, w: L.tower.w, h: LH * 2 };
      if (inRect(a, tw)) {
        if (a.bomb) { arrows.splice(k, 1); explode(a.x, a.y, a.dmg); continue; }
        a.x = clamp(a.x, tw.x - 2, tw.x + tw.w + 2);
        a.stuck = { kind: 'tower' }; a.life = 0; a.tr.length = 0; SFX.wood(); dust(a.x, a.y);
        continue;
      }
      for (const pl of plats) {
        if (!inRect(a, platRect(pl))) continue;
        if (a.bomb) { arrows.splice(k, 1); explode(a.x, a.y, a.dmg); break; }
        a.stuck = { kind: 'plat', pl, dx: a.x - pl.cx, dy: a.y - pl.y }; a.life = 0; a.tr.length = 0;
        SFX.wood(); dust(a.x, a.y);
        break;
      }
    }
    // keep the scene light: drop the oldest arrows stuck in blocks
    if (arrows.length > 140) {
      const i = arrows.findIndex((a) => a.stuck && a.stuck.kind !== 'fig');
      if (i >= 0) arrows.splice(i, 1);
    }
  }

  function arrowHitsFig(a, f, hit) {
    const ux = Math.cos(a.ang), uy = Math.sin(a.ang);
    const sp = Math.hypot(a.vx, a.vy);
    stickToFig(a, f, hit);
    if (!f.alive) {
      // Wrecks take the hit and get knocked about.
      const P = f.rag.p;
      for (const idx of [hit.i, hit.j]) { P[idx].px -= ux * sp * 0.25 * STEP; P[idx].py -= uy * sp * 0.25 * STEP; }
      SFX.hit();
      return;
    }
    f.flash = 1; f.flinch = 1;
    if (f.isPlayer) {
      burst(hit.cx, hit.cy, 8, '#ff6b6b', 200);
      const mult = hit.part === 'head' ? 1.5 : hit.part === 'body' ? 1 : 0.7;
      const dmg = a.dmg * mult * (1 - run.st.armor);
      run.hp = Math.max(0, run.hp - dmg);
      shake(10, 0.3); SFX.hurt();
      floatText(hit.cx, hit.cy - 16, '-' + Math.round(dmg), '#ff6b6b', 22);
      if (run.hp <= 0) {
        player.alive = false;
        makeRag(player, ux * sp * 0.5, uy * sp * 0.5 - 150, hit.part === 'head' ? 0 : 2);
        run.overT = 1.8; aim = null; SFX.die();
        slowT = 0.5;
      }
      return;
    }
    const head = hit.part === 'head';
    const mult = head ? (f.T.helmet ? 1.6 : 2.5) : hit.part === 'body' ? 1 : 0.6;
    const dmg = a.dmg * mult * (f.frozen > 0 ? 1.25 : 1);
    sparks(hit.cx, hit.cy, head ? 16 : 9, head);
    if (head) { SFX.head(); floatText(hit.cx, hit.cy - 28, f.T.helmet ? 'HELMET!' : 'HEADSHOT!', '#ffd23f', 24); }
    else SFX.hit();
    if (a.fire) { f.burn = 3; f.burnDps = a.dmg * 0.3; }
    damageEnemy(f, dmg, hit.part, ux * sp, uy * sp);
  }

  // Applies damage to a bot and handles its death. `quiet` skips the number (burn ticks).
  function damageEnemy(e, dmg, part, vx, vy, quiet) {
    if (!e.alive) return;
    e.hp -= dmg;
    if (!quiet) {
      const P = e.pts;
      floatText(P[1].x + rand(-8, 8), P[1].y - 4, '-' + Math.round(dmg), '#ffffff', 18);
      e.flash = 1; e.flinch = 1;
      // A hit spoils the bot's aim.
      if (e.state === 'draw' && e.hp > 0) { e.state = 'wait'; e.timer = 0.5 + e.reload * 0.3; e.draw = 0; }
    }
    if (e.hp <= 0) killEnemy(e, part, vx, vy);
  }

  function killEnemy(e, part, vx, vy) {
    e.alive = false; e.hp = 0; e.frozen = 0; e.burn = 0;
    const head = part === 'head';
    const ci = head ? 0 : part === 'body' ? 2 : 7;
    makeRag(e, vx * 0.45, vy * 0.45 - 120, ci);
    e.dead = 0;
    e.plat.fallT = 0.7;
    run.kills++; S.total++;
    if (head) run.heads++;
    run.combo = run.comboT > 0 ? run.combo + 1 : 1;
    run.comboT = 3;
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    const P = e.pts;
    let c = e.T.coins + (head ? 2 : 0) + Math.floor(run.kills / 15);
    if (run.combo >= 2) {
      c += run.combo * 2;
      setBanner(COMBO[Math.min(run.combo, COMBO.length - 1)], 'x' + run.combo + ' COMBO  +' + run.combo * 2 + ' coins', '#ff5ad8', 1.4);
      SFX.combo(run.combo);
    }
    gainCoins(c, P[1].x, P[1].y);
    floatText(P[0].x, P[0].y - 50, '+' + c, '#ffc531', 26, true);
    // robot debris
    sparks(P[1].x, P[1].y, 18, true);
    for (let i = 0; i < 7; i++) {
      parts.push({ kind: 'bolt', x: P[1].x, y: P[1].y, vx: rand(-220, 220), vy: rand(-380, -120), life: rand(0.8, 1.3), max: 1.3, r: rand(3, 6), rot: rand(0, 6), vr: rand(-12, 12), g: 900, col: pick([e.col, '#cfd6e0', '#7f8aa0']) });
    }
    for (let i = 0; i < 5; i++) parts.push({ kind: 'smoke', x: P[1].x + rand(-10, 10), y: P[1].y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-50, -20), life: rand(0.6, 1), max: 1, r: rand(8, 14), g: -10 });
    if (run.st.vamp) { run.hp = Math.min(run.st.maxHp, run.hp + run.st.vamp); floatText(player.pts[0].x, player.pts[0].y - 40, '+' + run.st.vamp + ' HP', '#7dff9a', 18); }
    slowT = e.type === 'boss' ? 0.9 : head ? 0.45 : 0.2;
    if (head) flashT = 0.12;
    SFX.botDie();
    if (e.type === 'boss') {
      shake(14, 0.4);
      run.level++;
      setTheme((themeCur + 1) % THEMES.length);
      setBanner('LEVEL ' + run.level, THEMES[themeCur].name, '#7dff9a', 2.4);
      SFX.level();
    } else if (e.type === 'golden') setBanner('JACKPOT!', '+' + c + ' coins', '#ffd23f', 1.6);
    run.spawnT = Math.max(run.spawnT, 0.9);
    if (run.tut) { run.tut = false; S.tut = 1; }
    writeSave();
  }
  // Coins count at once; the HUD counter catches up as the flying coins land.
  function gainCoins(c, x, y) {
    S.coins += c; if (run) run.coins += c;
    const n = Math.min(8, c);
    for (let i = 0; i < n; i++) coinFx.push({ x0: x + rand(-14, 14), y0: y + rand(-14, 14), t: -i * 0.05, val: c / n });
  }

  function explode(x, y, dmg) {
    for (const e of enemies) {
      const P = ptsOf(e), cx = (P[1].x + P[2].x) / 2, cy = (P[1].y + P[2].y) / 2;
      const d = dist(x, y, cx, cy);
      if (d > 110) continue;
      const k = 1 - d / 110, dx = (cx - x) / (d || 1), dy = (cy - y) / (d || 1);
      if (e.alive) damageEnemy(e, dmg * 1.3 * k + 8, 'body', dx * 600 * k, dy * 600 * k - 200);
      else for (const q of e.rag.p) { q.px -= dx * 500 * k * STEP; q.py -= (dy * 500 * k + 200) * STEP; }
    }
    parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, r: 110, g: 0 });
    for (let i = 0; i < 14; i++) parts.push({ kind: 'smoke', x: x + rand(-20, 20), y: y + rand(-20, 20), vx: rand(-60, 60), vy: rand(-90, -20), life: rand(0.6, 1.1), max: 1.1, r: rand(12, 22), g: -20 });
    for (let i = 0; i < 18; i++) {
      const a = rand(0, 6.28), v = rand(120, 380);
      parts.push({ kind: 'fire', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.6), max: 0.6, r: rand(5, 9), g: 200 });
    }
    shake(12, 0.35); SFX.boom();
  }

  // ================================================================ sky targets
  function spawnPick() {
    if (Math.random() < 0.3) {
      picks.push({ kind: 'bird', x: LW + 40, y: rand(L.T + 140, L.T + 320), vx: -rand(100, 140), vy: 0, r: 18, t: 0, hit: false, rot: 0 });
      return;
    }
    const lowHp = run.hp < run.st.maxHp * 0.5;
    const pool = Object.keys(PW).map((k) => [k, PW[k].w * (k === 'heal' && lowHp ? 3 : 1)]);
    let tot = 0; for (const p of pool) tot += p[1];
    let r = Math.random() * tot, kind = 'coins';
    for (const p of pool) { r -= p[1]; if (r <= 0) { kind = p[0]; break; } }
    picks.push({ kind: 'balloon', pw: kind, x: rand(220, 480), y: L.B + 30, vx: 0, vy: -rand(42, 58), r: 24, t: rand(0, 6), hit: false });
  }
  function hitPick(pk, a) {
    pk.hit = true;
    if (pk.kind === 'bird') {
      pk.vy = -120; pk.vx = a.vx * 0.15;
      gainCoins(5, pk.x, pk.y);
      floatText(pk.x, pk.y - 24, 'BIRDIE! +5', '#ffc531', 22);
      for (let i = 0; i < 10; i++) parts.push({ kind: 'feather', x: pk.x, y: pk.y, vx: rand(-90, 90), vy: rand(-120, 20), life: rand(0.8, 1.4), max: 1.4, r: 5, rot: rand(0, 6), vr: rand(-6, 6), g: 120, col: '#ffffff' });
      SFX.bird();
      return;
    }
    const k = pk.pw, P = PW[k];
    for (let i = 0; i < 14; i++) { const an = rand(0, 6.28), v = rand(80, 260); parts.push({ kind: 'spark', x: pk.x, y: pk.y, vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: rand(0.3, 0.6), max: 0.6, r: rand(3, 5), g: 300, col: P.col }); }
    floatText(pk.x, pk.y - 30, P.label, P.col, 24, true);
    SFX.pop();
    if (P.dur) { run.pw[k] = P.dur; SFX.power(); }
    else if (k === 'heal') run.hp = Math.min(run.st.maxHp, run.hp + 40);
    else if (k === 'coins') gainCoins(15, pk.x, pk.y);
    else if (k === 'freeze') {
      SFX.freeze(); flashT = 0.15;
      for (const e of enemies) if (e.alive) e.frozen = 4;
    }
  }
  function updatePicks(h) {
    run.pickT -= h;
    if (run.pickT <= 0 && player.alive) { spawnPick(); run.pickT = rand(7, 12); }
    for (let i = picks.length - 1; i >= 0; i--) {
      const pk = picks[i];
      pk.t += h;
      if (pk.kind === 'balloon') {
        if (pk.hit) { picks.splice(i, 1); continue; }
        pk.y += pk.vy * h; pk.x += Math.sin(pk.t * 1.6) * 16 * h;
        if (pk.y < L.T + 60) picks.splice(i, 1);
      } else {
        if (pk.hit) { pk.vy += 900 * h; pk.rot += h * 10; }
        pk.x += pk.vx * h; pk.y += pk.vy * h + (pk.hit ? 0 : Math.sin(pk.t * 3) * 20 * h);
        if (pk.x < -offX - 40 || pk.y > LH + 40) picks.splice(i, 1);
      }
    }
  }

  // ================================================================ fx
  function burst(x, y, n, col, sp) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), v = rand(0.3, 1) * sp;
      parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rand(0.35, 0.7), max: 0.7, col, r: rand(2, 4), g: 600 });
    }
  }
  function sparks(x, y, n, hot) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), v = rand(120, hot ? 420 : 260);
      parts.push({ kind: 'line', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rand(0.2, 0.45), max: 0.45, col: pick(['#fff3a8', '#ffd23f', '#ff9f1c']), r: 2, g: 700 });
    }
  }
  function dust(x, y) {
    for (let i = 0; i < 5; i++) parts.push({ kind: 'smoke', x, y, vx: rand(-40, 40), vy: rand(-50, -10), life: rand(0.3, 0.5), max: 0.5, r: rand(4, 7), g: 0, col: '#d8cfc4' });
  }
  function floatText(x, y, txt, col, size, big) {
    texts.push({ x, y, txt, col, size, life: big ? 1.3 : 0.9, max: big ? 1.3 : 0.9 });
  }
  function setBanner(txt, sub, col, t) { banner = { txt, sub, col, t, max: t }; }
  function shake(m, t) { shakeMag = Math.max(shakeMag, m); shakeT = Math.max(shakeT, t); }
  function toast(msg, col) { toastMsg = { msg, col: col || '#ffffff', t: 2.6 }; }

  // ================================================================ update
  function update(h) {
    clock += h;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= h; p.vy += (p.g === undefined ? 600 : p.g) * h; p.x += p.vx * h; p.y += p.vy * h;
      if (p.vr) p.rot += p.vr * h;
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]; t.life -= h; t.y -= 40 * h;
      if (t.life <= 0) texts.splice(i, 1);
    }
    for (let i = coinFx.length - 1; i >= 0; i--) {
      const c = coinFx[i]; c.t += h / 0.65;
      if (c.t >= 1) { coinFx.splice(i, 1); shownCoins = Math.min(S.coins, shownCoins + c.val); coinPulse = 0.18; SFX.tick(); }
    }
    if (!coinFx.length) shownCoins = S.coins;
    coinPulse = Math.max(0, coinPulse - h);
    if (THEMES[themeCur].embers && Math.random() < h * 8) {
      parts.push({ kind: 'ember', x: rand(-offX, LW + offX), y: L.B + 20, vx: rand(-15, 15), vy: rand(-70, -40), life: rand(3, 5), max: 5, r: rand(1.5, 3), g: 0 });
    }
    if (screen === 'title' || screen === 'shop' || screen === 'load') {
      if (player && player.alive) {
        player.t += h; player.x = L.px; player.y = L.py;
        player.aim = -0.35 + Math.sin(clock * 0.7) * 0.15; player.draw = 0.25 + Math.sin(clock * 1.3) * 0.2;
        pose(player);
      }
      return;
    }
    if (overlay) return;
    run.time += h;
    for (const k in run.pw) run.pw[k] = Math.max(0, run.pw[k] - h);
    run.comboT = Math.max(0, run.comboT - h);
    updatePlayer(h);
    for (const pl of plats) {
      pl.t += h;
      if (pl.enter < 1) { pl.enter = Math.min(1, pl.enter + h / 0.9); pl.cx = lerp(LW + 90, pl.tx, easeOutBack(pl.enter)); }
      if (pl.fallT !== undefined) {
        pl.fallT -= h;
        if (pl.fallT <= 0) pl.falling = true;
      }
      const oy = pl.y;
      if (pl.falling) { pl.vy += 1400 * h; pl.y += pl.vy * h; }
      else if (pl.move) { pl.y = pl.baseY + Math.sin(pl.t * pl.move.sp + pl.move.ph) * pl.move.amp; pl.vy = (pl.y - oy) / h; }
    }
    const rects = solids();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      updateEnemy(e, h);
      if (e.alive && e.T.golden && e.plat.cx > LW + offX + 80) {
        enemies.splice(i, 1); plats.splice(plats.indexOf(e.plat), 1);
        continue;
      }
      if (!e.alive) {
        stepRag(e, h, rects);
        e.dead += h;
        if (e.dead > 6 || e.rag.p.every((q) => q.y > LH + 60)) enemies.splice(i, 1);
      }
    }
    for (let i = plats.length - 1; i >= 0; i--) if (plats[i].y > LH + 160) plats.splice(i, 1);
    if (!player.alive) stepRag(player, h, rects);
    updateArrows(h);
    updatePicks(h);
    // spawning
    if (player.alive) {
      const k = run.kills;
      const alive = enemies.filter((e) => e.alive);
      const normal = alive.filter((e) => e.type !== 'boss' && e.type !== 'golden').length;
      const bossAlive = alive.some((e) => e.type === 'boss');
      const target = k < 3 ? 1 : k < 12 ? 2 : 3;
      run.spawnT -= h;
      if (run.spawnT <= 0) {
        if (k >= run.nextBoss && !bossAlive) { spawnEnemy('boss'); run.nextBoss += 10; run.spawnT = 1.5; }
        else if (normal < target - (bossAlive ? 1 : 0) || alive.length === 0) {
          const gold = k >= 5 && !alive.some((e) => e.T.golden) && Math.random() < 0.1;
          spawnEnemy(gold ? 'golden' : pickType(k)); run.spawnT = 1.2;
        }
      }
    }
    if (run.overT > 0) {
      run.overT -= h;
      if (run.overT <= 0) { screen = 'over'; endRun(); }
    }
    if (banner) { banner.t -= h; if (banner.t <= 0) banner = null; }
  }

  function updatePlayer(h) {
    const p = player;
    p.t += h; p.flash = Math.max(0, p.flash - h * 4); p.flinch = Math.max(0, p.flinch - h * 3);
    run.staFlash = Math.max(0, run.staFlash - h);
    if (!p.alive) return;
    if (p.jv !== 0 || p.jy < 0) {
      p.jy += p.jv * h; p.jv += 1700 * h;
      if (p.jy >= 0) { p.jy = 0; p.jv = 0; dust(p.x - 10, L.py); dust(p.x + 10, L.py); }
    }
    p.x = L.px; p.y = L.py + p.jy;
    run.staWait -= h;
    if (run.staWait <= 0) run.sta = Math.min(run.st.maxSt, run.sta + run.st.regen * h);
    if (aim) {
      const v = aimVector();
      if (v.len > 12) { p.aim = v.a; p.draw = v.power; }
    } else {
      p.draw = Math.max(0, p.draw - h * 6);
    }
    pose(p);
  }
  function aimVector() {
    const dx = aim.ax - aim.x, dy = aim.ay - aim.y, len = Math.hypot(dx, dy);
    return { a: clamp(Math.atan2(dy, dx), -1.55, 1.25), power: clamp(len / 150, 0, 1), len };
  }
  function doJump() {
    if (!run || overlay || screen !== 'play' || !player.alive || player.jy < 0) return;
    if (run.sta < JUMP_COST) { run.staFlash = 0.6; SFX.no(); return; }
    run.sta -= JUMP_COST; run.staWait = 0.3;
    player.jv = -640;
    SFX.jump();
  }

  // ================================================================ input
  function uiHit(p) {
    for (let i = buttons.length - 1; i >= 0; i--) if (inRect(p, buttons[i].r)) return buttons[i].id;
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    const p = toLogical(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const btn = uiHit(p);
    if (btn) { pressed = { id: btn, pid: e.pointerId }; return; }
    if (screen === 'play' && !overlay && player.alive && !aim) aim = { id: e.pointerId, ax: p.x, ay: p.y, x: p.x, y: p.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (aim && aim.id === e.pointerId) { const p = toLogical(e); aim.x = p.x; aim.y = p.y; }
  });
  function endPointer(e, cancelled) {
    const p = toLogical(e);
    if (pressed && pressed.pid === e.pointerId) {
      const id = pressed.id; pressed = null;
      if (!cancelled && uiHit(p) === id) uiAction(id);
      return;
    }
    if (aim && aim.id === e.pointerId) {
      aim.x = p.x; aim.y = p.y;
      const v = aimVector();
      aim = null;
      if (cancelled || screen !== 'play' || overlay || !player.alive) return;
      if (v.power >= 0.12) { player.aim = v.a; playerFire(v.a, v.power); }
    }
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    initAudio();
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (screen === 'play' && !overlay) doJump();
      else if (screen === 'title' || screen === 'over') uiAction('play');
    } else if (e.code === 'Enter') {
      if (screen === 'title' || screen === 'over') uiAction('play');
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (screen === 'play' && player.alive) overlay = overlay ? null : 'pause';
      else if (screen === 'shop') uiAction('back');
    }
  });
  window.addEventListener('blur', () => { aim = null; pressed = null; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (screen === 'play' && player.alive && !overlay) overlay = 'pause';
      aim = null; pressed = null;
      writeSave(); submitTotal();
      if (audio) audio.suspend().catch(() => {});
    } else if (audio) audio.resume().catch(() => {});
  });

  function uiAction(id) {
    SFX.click();
    if (id.startsWith('buy:')) { buy(id.slice(4)); return; }
    switch (id) {
      case 'play': startRun(); break;
      case 'shop': shopFrom = screen === 'shop' ? shopFrom : screen; screen = 'shop'; break;
      case 'back': screen = shopFrom; break;
      case 'lb': showLeaderboard(); break;
      case 'sound': setMuted(!S.muted); break;
      case 'pause': overlay = 'pause'; break;
      case 'resume': overlay = null; break;
      case 'jump': doJump(); break;
      case 'home':
        if (screen === 'play' && run && player.alive) endRun();
        clearScene();
        screen = 'title';
        setTheme(0);
        player = makePlayer();
        break;
    }
  }
  function buy(id) {
    const u = UPG.find((x) => x.id === id);
    const lvl = lvlOf(id);
    if (lvl >= u.max) return;
    const c = upCost(u, lvl);
    if (S.coins < c) { SFX.no(); toast('Not enough coins', '#ff8a8a'); return; }
    S.coins -= c; S.up[id] = lvl + 1; shownCoins = S.coins;
    SFX.buy();
    writeSave();
  }

  // ================================================================ drawing helpers
  function rr(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(t, x, y, size, col, align = 'center', font = FD, base = 'middle') {
    ctx.font = `${font === FU ? '700 ' : ''}${size}px ${font}`;
    ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = col;
    ctx.fillText(t, x, y);
  }
  function outlined(t, x, y, size, col, stroke = OUT, lw = 5, align = 'center', font = FD) {
    ctx.font = `${font === FU ? '700 ' : ''}${size}px ${font}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(t, x, y);
    ctx.fillStyle = col; ctx.fillText(t, x, y);
  }
  // [top, bottom, lip, text]
  const STY = {
    green: ['#7cf27c', '#2fb84a', '#1d7a30', '#ffffff'],
    gold:  ['#ffe066', '#ffb000', '#b36b00', '#ffffff'],
    blue:  ['#6cc4ff', '#2f86e8', '#1c56a3', '#ffffff'],
    red:   ['#ff8a94', '#e8414b', '#99222b', '#ffffff'],
    light: ['#ffffff', '#dfe3ee', '#9aa1b5', OUT],
    dark:  ['rgba(40,44,70,0.85)', 'rgba(25,28,48,0.85)', 'rgba(10,12,24,0.8)', '#ffffff'],
    off:   ['#9aa0b0', '#747a8c', '#4d5262', '#e6e8ef'],
  };
  function button(id, r, label, style = 'light', size = 24, sub) {
    buttons.push({ id, r });
    const [top, bot, lip, fg] = STY[style];
    const down = pressed && pressed.id === id ? 4 : 0;
    const rad = Math.min(16, r.h / 2.6);
    ctx.fillStyle = OUT; rr(r.x - 2.5, r.y - 2.5 + down, r.w + 5, r.h + 11 - down, rad + 2); ctx.fill();
    ctx.fillStyle = lip; rr(r.x, r.y + 6, r.w, r.h, rad); ctx.fill();
    const gr = ctx.createLinearGradient(0, r.y + down, 0, r.y + r.h + down);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    ctx.fillStyle = gr; rr(r.x, r.y + down, r.w, r.h, rad); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; rr(r.x + 6, r.y + down + 4, r.w - 12, r.h * 0.34, rad * 0.7); ctx.fill();
    const cy = r.y + r.h / 2 + down;
    const colored = fg === '#ffffff';
    if (sub) {
      if (colored) outlined(label, r.x + r.w / 2, cy - 8, size, fg, OUT, 5);
      else text(label, r.x + r.w / 2, cy - 8, size, fg);
      text(sub, r.x + r.w / 2, cy + 15, 15, colored ? '#ffffff' : '#2f86e8', 'center', FU);
    } else if (label) {
      if (colored) outlined(label, r.x + r.w / 2, cy + 2, size, fg, OUT, Math.max(4, size / 5));
      else text(label, r.x + r.w / 2, cy + 2, size, fg);
    }
  }
  function hudBox(r) {
    ctx.fillStyle = 'rgba(16,18,40,0.6)'; rr(r.x, r.y, r.w, r.h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; rr(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 13); ctx.stroke();
  }
  function coinIcon(x, y, r) {
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x, y + 1, r + 2, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#c58a00'; ctx.beginPath(); ctx.arc(x, y + 1.5, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffc531'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#e09e00'; ctx.lineWidth = r * 0.22; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, 6.283); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.2, 0, 6.283); ctx.fill();
  }
  // Robot head: what the kill counter counts.
  function botIcon(x, y, r) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 1.55); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, y - r * 1.65, r * 0.28, 0, 6.283); ctx.fill();
    ctx.fillStyle = OUT; rr(x - r - 2, y - r - 2, 2 * r + 4, 1.8 * r + 4, r * 0.5); ctx.fill();
    ctx.fillStyle = '#e6eaf2'; rr(x - r, y - r, 2 * r, 1.8 * r, r * 0.45); ctx.fill();
    ctx.fillStyle = OUT; rr(x - r * 0.75, y - r * 0.45, r * 1.5, r * 0.7, r * 0.3); ctx.fill();
    ctx.fillStyle = '#ff4d5e'; rr(x - r * 0.6, y - r * 0.32, r * 1.2, r * 0.44, r * 0.2); ctx.fill();
  }
  function soundIcon(x, y, on) {
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 12, y - 5); ctx.lineTo(x - 6, y - 5); ctx.lineTo(x + 2, y - 12); ctx.lineTo(x + 2, y + 12);
    ctx.lineTo(x - 6, y + 5); ctx.lineTo(x - 12, y + 5); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (on) { ctx.beginPath(); ctx.arc(x + 4, y, 8, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 4, y, 14, -0.8, 0.8); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(x + 7, y - 6); ctx.lineTo(x + 17, y + 6); ctx.moveTo(x + 17, y - 6); ctx.lineTo(x + 7, y + 6); ctx.stroke(); }
  }
  // Small pictograms for power-ups and upgrades.
  function icon(kind, x, y, r) {
    ctx.save(); ctx.translate(x, y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'fire') {
      ctx.fillStyle = '#ff5a1a'; ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.9, -r * 0.1, r * 0.6, r * 0.5);
      ctx.quadraticCurveTo(0, r * 1.05, -r * 0.6, r * 0.5); ctx.quadraticCurveTo(-r * 0.9, -r * 0.1, 0, -r); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(0, -r * 0.2); ctx.quadraticCurveTo(r * 0.45, r * 0.25, r * 0.3, r * 0.55);
      ctx.quadraticCurveTo(0, r * 0.8, -r * 0.3, r * 0.55); ctx.quadraticCurveTo(-r * 0.45, r * 0.25, 0, -r * 0.2); ctx.fill();
    } else if (kind === 'triple') {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.18;
      for (const a of [-0.45, 0, 0.45]) {
        ctx.save(); ctx.rotate(a - 0.78);
        ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); ctx.moveTo(r * 0.8, 0); ctx.lineTo(r * 0.45, -r * 0.3); ctx.moveTo(r * 0.8, 0); ctx.lineTo(r * 0.45, r * 0.3); ctx.stroke();
        ctx.restore();
      }
    } else if (kind === 'bomb') {
      ctx.fillStyle = '#2a2d3e'; ctx.beginPath(); ctx.arc(0, r * 0.15, r * 0.75, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, r * 0.2, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#c8a46a'; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.moveTo(r * 0.35, -r * 0.4); ctx.quadraticCurveTo(r * 0.6, -r * 0.9, r * 0.9, -r * 0.7); ctx.stroke();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(r * 0.9, -r * 0.75, r * 0.2, 0, 6.283); ctx.fill();
    } else if (kind === 'freeze') {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.16;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.9);
        ctx.moveTo(-r * 0.3, -r * 0.6); ctx.lineTo(0, -r * 0.35); ctx.lineTo(r * 0.3, -r * 0.6);
        ctx.moveTo(-r * 0.3, r * 0.6); ctx.lineTo(0, r * 0.35); ctx.lineTo(r * 0.3, r * 0.6); ctx.stroke();
        ctx.restore();
      }
    } else if (kind === 'heal') {
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath(); ctx.moveTo(0, r * 0.8);
      ctx.bezierCurveTo(-r * 1.2, -r * 0.1, -r * 0.6, -r * 1, 0, -r * 0.4);
      ctx.bezierCurveTo(r * 0.6, -r * 1, r * 1.2, -r * 0.1, 0, r * 0.8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-r * 0.4, -r * 0.35, r * 0.17, 0, 6.283); ctx.fill();
    } else if (kind === 'coins') {
      coinIcon(0, 0, r * 0.8);
    } else if (kind === 'shield') {
      ctx.fillStyle = '#ff9a5a'; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.85, -r * 0.6); ctx.quadraticCurveTo(r * 0.8, r * 0.5, 0, r);
      ctx.quadraticCurveTo(-r * 0.8, r * 0.5, -r * 0.85, -r * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-r * 0.1, -r * 0.75, r * 0.2, r * 1.5);
    } else if (kind === 'sword') {
      ctx.rotate(0.78);
      ctx.fillStyle = '#e6eaf2'; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.2, -r * 0.7); ctx.lineTo(r * 0.2, r * 0.4); ctx.lineTo(-r * 0.2, r * 0.4); ctx.lineTo(-r * 0.2, -r * 0.7); ctx.fill();
      ctx.fillStyle = '#ffc531'; ctx.fillRect(-r * 0.5, r * 0.35, r, r * 0.18); ctx.fillRect(-r * 0.1, r * 0.5, r * 0.2, r * 0.45);
    } else if (kind === 'bolt') {
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(r * 0.2, -r); ctx.lineTo(-r * 0.55, r * 0.15); ctx.lineTo(-r * 0.05, r * 0.15);
      ctx.lineTo(-r * 0.25, r); ctx.lineTo(r * 0.55, -r * 0.2); ctx.lineTo(r * 0.05, -r * 0.2); ctx.closePath(); ctx.fill();
    } else if (kind === 'bow') {
      ctx.strokeStyle = '#ffbf2e'; ctx.lineWidth = r * 0.22; ctx.beginPath(); ctx.arc(-r * 0.6, 0, r * 1.1, -1, 1); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.1; ctx.beginPath();
      ctx.moveTo(-r * 0.6 + Math.cos(-1) * r * 1.1, Math.sin(-1) * r * 1.1); ctx.lineTo(-r * 0.6 + Math.cos(1) * r * 1.1, Math.sin(1) * r * 1.1); ctx.stroke();
    }
    ctx.restore();
  }

  // ================================================================ scene drawing
  let towerCanvas = null;
  function buildTower() {
    const t = L.tower, k = dpr * scale;
    const w = t.w + 24, h = LH - t.top + 30;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
    const g = c.getContext('2d');
    g.scale(k, k);
    const x0 = 12, y0 = 18;
    const rnd = seeded(77);
    g.fillStyle = OUT; g.fillRect(x0 - 3, y0 - 3, t.w + 6, h);
    const bh = 22;
    for (let row = 0, y = y0; y < h; row++, y += bh) {
      const off = row % 2 ? -18 : 0;
      for (let x = x0 + off; x < x0 + t.w; x += 36) {
        const v = rnd();
        g.fillStyle = v < 0.33 ? '#a5a3b3' : v < 0.66 ? '#9896a8' : '#b0aebd';
        const bx = Math.max(x0, x), bw = Math.min(x + 36, x0 + t.w) - bx;
        g.fillRect(bx, y, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(bx, y, bw, 3);
        g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(bx, y + bh - 3, bw, 3);
        g.fillStyle = 'rgba(30,30,50,0.45)'; g.fillRect(bx, y, 2, bh);
      }
    }
    // side shading for roundness
    const sg = g.createLinearGradient(x0, 0, x0 + t.w, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0.12)'); sg.addColorStop(0.3, 'rgba(255,255,255,0)');
    sg.addColorStop(0.75, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = sg; g.fillRect(x0, y0, t.w, h);
    // ivy
    for (let i = 0; i < 30; i++) {
      const yy = y0 + 200 + rnd() * 180, xx = x0 + rnd() * 30;
      g.fillStyle = rnd() < 0.5 ? '#3f9a4a' : '#57b85a';
      g.beginPath(); g.arc(xx, yy, 3 + rnd() * 4, 0, 6.283); g.fill();
    }
    // battlements
    for (let i = 0; i < 4; i++) {
      const bx = x0 - 8 + i * ((t.w + 16 - 26) / 3);
      g.fillStyle = OUT; g.fillRect(bx - 2, 0, 30, y0 + 2);
      g.fillStyle = '#b8b6c6'; g.fillRect(bx, 2, 26, y0 - 2);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bx, 2, 26, 3);
    }
    g.fillStyle = OUT; g.fillRect(x0 - 10, y0 - 4, t.w + 20, 10);
    g.fillStyle = '#c4c2d0'; g.fillRect(x0 - 8, y0 - 2, t.w + 16, 6);
    towerCanvas = { c, x: t.x - 12, y: t.top - 18, w, h };
  }
  function drawTower() {
    if (!towerCanvas) buildTower();
    const t = L.tower, tc = towerCanvas;
    // flag
    const fx = t.x + 4, fy = t.top - 72;
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUT; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(fx, t.top - 14); ctx.lineTo(fx, fy - 6); ctx.stroke();
    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(fx, t.top - 14); ctx.lineTo(fx, fy - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx, fy);
    for (let i = 0; i <= 8; i++) ctx.lineTo(fx + i * 5, fy + Math.sin(clock * 6 - i * 0.7) * 3 * (i / 8));
    for (let i = 8; i >= 0; i--) ctx.lineTo(fx + i * 5, fy + 24 + Math.sin(clock * 6 - i * 0.7) * 3 * (i / 8));
    ctx.closePath(); ctx.fillStyle = '#2fb84a'; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(fx, fy - 8, 4, 0, 6.283); ctx.fill();
    ctx.drawImage(tc.c, tc.x, tc.y, tc.w, tc.h);
  }
  function drawIsland(pl) {
    const r = platRect(pl), th = THEMES[themeCur];
    const rnd = seeded(pl.seed);
    const x = r.x, y = r.y, w = r.w;
    const depth = 26 + w * 0.42;
    // rock underside
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 8);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      ctx.lineTo(x - 4 + (w + 8) * t, y + 14 + depth * Math.sin(t * Math.PI) * (0.75 + rnd() * 0.35));
    }
    ctx.lineTo(x + w + 4, y + 8);
    ctx.closePath();
    ctx.fillStyle = th.rock; ctx.fill();
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + w * 0.55, y, w, depth + 30);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + rnd() * w, y + 18 + rnd() * depth * 0.6, 3 + rnd() * 4, 0, 6.283); ctx.fill(); }
    ctx.restore();
    // grass cap
    ctx.fillStyle = OUT; rr(x - 7, y - 3, w + 14, 17, 8); ctx.fill();
    ctx.fillStyle = shade(th.grass, -0.25); rr(x - 5, y - 1, w + 10, 13, 6); ctx.fill();
    ctx.fillStyle = th.grass; rr(x - 5, y - 1, w + 10, 8, 5); ctx.fill();
    ctx.fillStyle = shade(th.grass, -0.25);
    for (let i = 0; i < 5; i++) { const gx = x + rnd() * w; ctx.beginPath(); ctx.moveTo(gx, y + 11); ctx.lineTo(gx + 3, y + 18 + rnd() * 6); ctx.lineTo(gx + 6, y + 11); ctx.fill(); }
    // glowing crystal keeps it afloat
    const cy = y + 14 + depth * 0.95;
    ctx.fillStyle = rgba('#7fe8ff', 0.25 + 0.15 * Math.sin(clock * 5 + pl.seed));
    ctx.beginPath(); ctx.arc(x + w / 2, cy, 10, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#bff6ff'; ctx.beginPath(); ctx.moveTo(x + w / 2, cy - 7); ctx.lineTo(x + w / 2 + 4, cy); ctx.lineTo(x + w / 2, cy + 7); ctx.lineTo(x + w / 2 - 4, cy); ctx.closePath(); ctx.fill();
  }

  function limb(P, a, b, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke();
  }
  function seg(P, a, b, t0, t1, w, col) {
    const A = P[a], B = P[b];
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(lerp(A.x, B.x, t0), lerp(A.y, B.y, t0)); ctx.lineTo(lerp(A.x, B.x, t1), lerp(A.y, B.y, t1)); ctx.stroke();
  }
  // Colour sets: hero archer, metal robot, golden robot.
  function palette(f) {
    if (f.isPlayer) return { skin: '#ffd3a8', arm: '#ffd3a8', sleeve: '#2fb84a', sleeveB: '#24903a', torso: '#36c456', torsoB: '#24903a', leg: '#7a5534', legB: '#5f4128', boot: '#4a3222', joint: null };
    if (f.T.golden) return { skin: '#ffe066', arm: '#ffd23f', sleeve: '#ffcc33', sleeveB: '#d9a520', torso: '#ffe066', torsoB: '#c99410', leg: '#ffcc33', legB: '#d9a520', boot: '#a06d00', joint: '#a06d00' };
    return { skin: '#dfe4ee', arm: '#d0d7e3', sleeve: '#c3cad8', sleeveB: '#98a1b5', torso: f.col, torsoB: shade(f.col, -0.35), leg: '#c3cad8', legB: '#98a1b5', boot: '#4a5066', joint: '#6b7388' };
  }
  function drawFig(f) {
    const P = ptsOf(f), s = f.s;
    let alpha = 1;
    if (f.rag && !f.isPlayer && f.dead > 4.5) alpha = Math.max(0, 1 - (f.dead - 4.5) / 1.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const hr = 11 * s, C = palette(f);
    // outline pass
    for (const [a, b, w] of BODY_SEGS) limb(P, a, b, w * s + 4, OUT);
    // back arm and leg
    limb(P, 1, 5, 9 * s, C.sleeveB); limb(P, 5, 6, 8 * s, shade(C.arm, -0.15));
    limb(P, 2, 9, 10 * s, C.legB); limb(P, 9, 10, 9 * s, C.legB);
    seg(P, 9, 10, 0.62, 1, 10 * s, C.boot);
    // torso
    limb(P, 1, 2, 17 * s, C.torsoB);
    seg(P, 1, 2, 0, 0.9, 11 * s, C.torso);
    if (f.isPlayer) seg(P, 1, 2, 0.78, 0.88, 17 * s, '#6b4423');
    else seg(P, 1, 2, 0.25, 0.5, 5 * s, 'rgba(255,255,255,0.5)');
    limb(P, 0, 1, 7 * s, C.joint || C.skin);
    // front leg
    limb(P, 2, 7, 10 * s, C.leg); limb(P, 7, 8, 9 * s, C.leg);
    seg(P, 7, 8, 0.62, 1, 10 * s, C.boot);
    if (C.joint) { ctx.fillStyle = C.joint; for (const j of [7, 9]) { ctx.beginPath(); ctx.arc(P[j].x, P[j].y, 3.2 * s, 0, 6.283); ctx.fill(); } }
    drawHead(f, P, hr, C);
    // bow arm
    limb(P, 1, 3, 9 * s, C.sleeve); limb(P, 3, 4, 8 * s, C.arm);
    if (C.joint) { ctx.fillStyle = C.joint; ctx.beginPath(); ctx.arc(P[3].x, P[3].y, 3 * s, 0, 6.283); ctx.fill(); }
    if (f.frozen > 0 || f.flash > 0) {
      const col = f.frozen > 0 ? 'rgba(150,235,255,0.6)' : `rgba(255,70,70,${f.flash * 0.7})`;
      for (const [a, b, w] of BODY_SEGS) limb(P, a, b, w * s, col);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(P[0].x, P[0].y, hr, 0, 6.283); ctx.fill();
    }
    drawBow(f, P);
    if (f.frozen > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      const c = P[1];
      for (let i = 0; i < 4; i++) { const a = clock * 0.6 + i * 1.57; ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * 22, c.y + Math.sin(a) * 22); ctx.lineTo(c.x + Math.cos(a) * 30, c.y + Math.sin(a) * 30); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawHead(f, P, hr, C) {
    const up = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x);
    const d = f.face;
    ctx.save(); ctx.translate(P[0].x, P[0].y); ctx.rotate(up + Math.PI / 2);
    if (f.isPlayer) {
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(0, 0, hr + 2, 0, 6.283); ctx.fill();
      // hood tail
      ctx.fillStyle = '#24903a'; ctx.strokeStyle = OUT; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-d * hr * 0.4, -hr * 0.8); ctx.quadraticCurveTo(-d * hr * 2, -hr * 0.6 + Math.sin(f.t * 4) * 2, -d * hr * 1.7, hr * 0.7);
      ctx.lineTo(-d * hr * 0.6, hr * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.skin; ctx.beginPath(); ctx.arc(0, 0, hr, 0, 6.283); ctx.fill();
      // hood over the back of the head
      ctx.fillStyle = '#2fb84a';
      const h0 = d > 0 ? Math.PI * 0.6 : -Math.PI * 0.9, h1 = d > 0 ? Math.PI * 1.9 : Math.PI * 0.4;
      ctx.beginPath(); ctx.arc(0, 0, hr + 0.5, h0, h1); ctx.closePath(); ctx.fill();
      // feather
      ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-d * hr * 0.2, -hr * 0.9); ctx.quadraticCurveTo(-d * hr * 0.8, -hr * 2, -d * hr * 1.6, -hr * 1.7); ctx.stroke();
      // face
      const ex = d * hr * 0.5, ey = hr * 0.02;
      if (!f.alive) {
        ctx.strokeStyle = OUT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3); ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3); ctx.stroke();
      } else {
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(ex, ey, 2.2, 3.2, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = OUT; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(ex - d * 4, ey - 6); ctx.lineTo(ex + d * 3, ey - 5); ctx.stroke();
        ctx.fillStyle = 'rgba(255,110,110,0.45)'; ctx.beginPath(); ctx.arc(d * hr * 0.2, hr * 0.45, 2.6, 0, 6.283); ctx.fill();
      }
    } else {
      // antenna
      ctx.strokeStyle = OUT; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-d * hr * 0.3, -hr); ctx.lineTo(-d * hr * 0.45, -hr * 1.6); ctx.stroke();
      ctx.fillStyle = f.alive && Math.sin(clock * 8 + f.t) > 0 ? f.col : shade(f.col, -0.4);
      ctx.beginPath(); ctx.arc(-d * hr * 0.45, -hr * 1.65, 3.2, 0, 6.283); ctx.fill();
      // robot head
      ctx.fillStyle = OUT; rr(-hr - 2, -hr - 2, hr * 2 + 4, hr * 1.9 + 4, hr * 0.55); ctx.fill();
      ctx.fillStyle = C.skin; rr(-hr, -hr, hr * 2, hr * 1.9, hr * 0.5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; rr(-hr, hr * 0.35, hr * 2, hr * 0.55, hr * 0.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; rr(-hr * 0.7, -hr * 0.85, hr * 0.8, hr * 0.22, hr * 0.1); ctx.fill();
      // visor
      const lit = f.alive ? 1 : 0.25;
      ctx.fillStyle = OUT; rr(d > 0 ? -hr * 0.1 : -hr * 1.05, -hr * 0.45, hr * 1.15, hr * 0.62, hr * 0.3); ctx.fill();
      ctx.fillStyle = rgba(f.T.golden ? '#ff7a1a' : f.T.laser ? '#ff3b3b' : '#7fe8ff', lit);
      const vx = d > 0 ? hr * 0.25 : -hr * 0.85;
      rr(vx, -hr * 0.32, hr * 0.6, hr * 0.36, hr * 0.18); ctx.fill();
      if (f.alive) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(vx + hr * 0.1, -hr * 0.26, hr * 0.12, hr * 0.12); }
      if (f.T.helmet) {
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(0, -hr * 0.15, hr + 3, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.arc(0, -hr * 0.15, hr + 1, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-hr * 0.5, -hr * 1.05, hr * 0.3, hr * 0.5);
      } else if (f.T.crown) {
        ctx.fillStyle = OUT;
        ctx.beginPath(); ctx.moveTo(-hr - 2, -hr * 0.6); ctx.lineTo(-hr - 2, -hr * 1.5); ctx.lineTo(-hr * 0.5, -hr * 1.05); ctx.lineTo(0, -hr * 1.7);
        ctx.lineTo(hr * 0.5, -hr * 1.05); ctx.lineTo(hr + 2, -hr * 1.5); ctx.lineTo(hr + 2, -hr * 0.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffc531';
        ctx.beginPath(); ctx.moveTo(-hr, -hr * 0.7); ctx.lineTo(-hr, -hr * 1.35); ctx.lineTo(-hr * 0.5, -hr * 0.95); ctx.lineTo(0, -hr * 1.52);
        ctx.lineTo(hr * 0.5, -hr * 0.95); ctx.lineTo(hr, -hr * 1.35); ctx.lineTo(hr, -hr * 0.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff3355'; ctx.beginPath(); ctx.arc(0, -hr * 0.95, 2.5, 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawBow(f, P) {
    const s = f.s;
    const a = f.rag ? Math.atan2(P[4].y - P[3].y, P[4].x - P[3].x) : f.aim;
    const R = 26 * s, ux = Math.cos(a), uy = Math.sin(a);
    const cx = P[4].x - ux * R, cy = P[4].y - uy * R;
    const t1 = a - 0.95, t2 = a + 0.95;
    const ax = cx + Math.cos(t1) * R, ay = cy + Math.sin(t1) * R, bx = cx + Math.cos(t2) * R, by = cy + Math.sin(t2) * R;
    const pulled = !f.rag && f.draw > 0.03;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(ax, ay);
    if (pulled) ctx.lineTo(P[6].x, P[6].y);
    ctx.lineTo(bx, by); ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUT; ctx.lineWidth = 7.5 * s; ctx.beginPath(); ctx.arc(cx, cy, R, t1, t2); ctx.stroke();
    ctx.strokeStyle = f.isPlayer ? '#b8742a' : '#5a6178'; ctx.lineWidth = 4.5 * s; ctx.beginPath(); ctx.arc(cx, cy, R, t1, t2); ctx.stroke();
    ctx.strokeStyle = f.isPlayer ? '#f0b553' : f.col; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.arc(cx, cy, R - 1, t1 + 0.1, t2 - 0.1); ctx.stroke();
    if (pulled) {
      const look = f.isPlayer ? arrowLook(run && run.pw) : { fletch: '#ff4d5e' };
      drawArrowShape(P[6].x + ux * ARROW_LEN * s * 0.95, P[6].y + uy * ARROW_LEN * s * 0.95, a, look, s * 0.95);
    }
    if (!f.rag) {
      const C = palette(f);
      for (const q of [P[6], P[4]]) {
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(q.x, q.y, 5.5 * s, 0, 6.283); ctx.fill();
        ctx.fillStyle = C.arm; ctx.beginPath(); ctx.arc(q.x, q.y, 3.8 * s, 0, 6.283); ctx.fill();
      }
    }
  }
  function arrowLook(pw) {
    if (pw && pw.bomb > 0) return { fletch: '#ff4d5e', bomb: true };
    if (pw && pw.fire > 0) return { fletch: '#ff7a1a', fire: true };
    return { fletch: '#2fb84a' };
  }
  function drawArrowShape(x, y, ang, look, k = 1) {
    const L2 = ARROW_LEN * k, ux = Math.cos(ang), uy = Math.sin(ang);
    const tx = x - ux * L2, ty = y - uy * L2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUT; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x - ux * 6, y - uy * 6); ctx.stroke();
    ctx.strokeStyle = look.fire ? '#ffb15a' : '#e9d3a3'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x - ux * 6, y - uy * 6); ctx.stroke();
    // fletching
    ctx.fillStyle = look.fletch; ctx.strokeStyle = OUT; ctx.lineWidth = 1.5;
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(tx + ux * 14, ty + uy * 14);
      ctx.lineTo(tx + ux * 2 - uy * 6 * sgn, ty + uy * 2 + ux * 6 * sgn); ctx.lineTo(tx - ux * 2, ty - uy * 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // head
    if (look.bomb) {
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x - ux * 5, y - uy * 5, 6.5, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2a2d3e'; ctx.beginPath(); ctx.arc(x - ux * 5, y - uy * 5, 5, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ff4d5e'; ctx.beginPath(); ctx.arc(x - ux * 5, y - uy * 5, 1.8, 0, 6.283); ctx.fill();
    } else {
      ctx.fillStyle = look.fire ? '#ff7a1a' : '#dfe6f2';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * 11 - uy * 5, y - uy * 11 + ux * 5); ctx.lineTo(x - ux * 11 + uy * 5, y - uy * 11 - ux * 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  function drawArrows() {
    for (const a of arrows) {
      if (!a.stuck && !a.spent && a.tr.length >= 4) {
        ctx.lineCap = 'round';
        for (let i = 2; i < a.tr.length; i += 2) {
          const t = i / a.tr.length;
          ctx.strokeStyle = a.fire ? `rgba(255,140,40,${0.55 * t})` : `rgba(255,255,255,${0.4 * t})`;
          ctx.lineWidth = 3.5 * t;
          ctx.beginPath(); ctx.moveTo(a.tr[i - 2], a.tr[i - 1]); ctx.lineTo(a.tr[i], a.tr[i + 1]); ctx.stroke();
        }
      }
      const p = arrowPose(a);
      let alpha = 1;
      if (a.stuck && a.stuck.kind === 'tower' && a.life > 7) alpha = Math.max(0, 8 - a.life);
      if (a.stuck && a.stuck.kind === 'fig' && a.stuck.f.dead > 4.5) alpha = Math.max(0, 1 - (a.stuck.f.dead - 4.5) / 1.5);
      ctx.globalAlpha = alpha;
      const ang = a.spent ? a.ang + a.spin : p.ang;
      const look = a.owner === 'p' ? { fletch: a.bomb ? '#ff4d5e' : a.fire ? '#ff7a1a' : '#2fb84a', fire: a.fire, bomb: a.bomb } : { fletch: '#ff4d5e' };
      drawArrowShape(p.x, p.y, ang, look);
      ctx.globalAlpha = 1;
      if (!a.stuck && !a.spent && a.y < L.T - 10) {
        ctx.fillStyle = a.owner === 'p' ? '#ffffff' : '#ff4d5e';
        const x = clamp(a.x, 10, LW - 10), y = L.T + 4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 12); ctx.lineTo(x + 7, y + 12); ctx.closePath(); ctx.fill();
      }
    }
  }
  function drawPicks() {
    for (const pk of picks) {
      if (pk.kind === 'balloon') {
        const P = PW[pk.pw], x = pk.x, y = pk.y;
        ctx.globalAlpha = clamp((L.B + 30 - y) / 40, 0, 1) * clamp((y - L.T - 60) / 50, 0, 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y + 28); ctx.quadraticCurveTo(x + Math.sin(pk.t * 3) * 6, y + 40, x, y + 52); ctx.stroke();
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(x, y, 25, 28, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 6, y + 32); ctx.lineTo(x + 6, y + 32); ctx.lineTo(x, y + 24); ctx.fill();
        ctx.fillStyle = P.col; ctx.beginPath(); ctx.ellipse(x, y, 22.5, 25.5, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(x + 6, y + 6, 14, 17, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(x - 9, y - 11, 5, 8, -0.5, 0, 6.283); ctx.fill();
        icon(pk.pw, x, y + 1, 12);
        ctx.globalAlpha = 1;
      } else {
        ctx.save(); ctx.translate(pk.x, pk.y); if (pk.hit) ctx.rotate(pk.rot);
        const flap = Math.sin(pk.t * 14) * 9;
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.moveTo(-12, -1); ctx.lineTo(-19, 1); ctx.lineTo(-12, 3); ctx.fill();
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(-7, -2, 1.6, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#dfe6f2'; ctx.strokeStyle = OUT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(6, -12 - flap); ctx.lineTo(10, -2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        if (!pk.hit) { ctx.globalAlpha = 0.6 + 0.3 * Math.sin(clock * 6); outlined('+5', pk.x, pk.y - 22, 13, '#ffc531', OUT, 3); ctx.globalAlpha = 1; }
      }
    }
  }
  function drawEnemyBars() {
    for (const e of enemies) {
      if (!e.alive || e.state === 'enter' && e.plat.enter < 0.6) continue;
      const P = e.pts, w = 44 * e.s, x = P[0].x - w / 2, y = P[0].y - 34 * e.s - (e.T.crown ? 8 : 0);
      const f = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = OUT; rr(x - 2, y - 2, w + 4, 11, 5); ctx.fill();
      ctx.fillStyle = '#4a1d24'; rr(x, y, w, 7, 3.5); ctx.fill();
      ctx.fillStyle = e.T.golden ? '#ffd23f' : '#ff4d5e'; rr(x, y, Math.max(3, w * f), 7, 3.5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 2, y + 1, Math.max(0, w * f - 4), 2);
      if (e.T.golden && e.state !== 'flee') outlined(Math.max(0, 7 - e.life).toFixed(1) + 's', P[0].x, y - 12, 13, '#ffd23f', OUT, 3);
      if (e.T.laser && e.state === 'draw' && player.alive && !(e.frozen > 0)) {
        // sniper sight: shows the exact path it is about to fire
        const o = shotOrigin(e, e.aim, 1);
        ctx.strokeStyle = `rgba(255,59,59,${0.2 + 0.6 * e.draw})`; ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(o.x, o.y);
        const v = e.speed;
        for (let t = 0.02; t < 0.9; t += 0.02) {
          const px = o.x + Math.cos(e.aim) * v * t, py = o.y + Math.sin(e.aim) * v * t + 0.5 * GRAV * t * t;
          ctx.lineTo(px, py);
          if (px < L.tower.x + L.tower.w) break;
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }
  function drawAim() {
    if (!aim || !player.alive) return;
    const v = aimVector();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(aim.ax, aim.ay, 18, 0, 6.283); ctx.stroke();
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(aim.ax, aim.ay); ctx.lineTo(aim.x, aim.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(aim.x, aim.y, 7, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    if (v.len <= 12) return;
    // trajectory preview: the first part of the flight only
    const sp = (420 + 760 * v.power) * run.st.power;
    const o = shotOrigin(player, v.a, v.power);
    const ok = run.sta >= SHOT_COST;
    for (let i = 1; i <= 16; i++) {
      const t = i * 0.028;
      const x = o.x + Math.cos(v.a) * sp * t, y = o.y + Math.sin(v.a) * sp * t + 0.5 * GRAV * t * t;
      const a = 0.9 * (1 - i / 17), r = 4 - i * 0.15;
      ctx.fillStyle = `rgba(27,29,42,${a * 0.7})`; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, 6.283); ctx.fill();
      ctx.fillStyle = ok ? `rgba(255,255,255,${a})` : `rgba(111,178,255,${a})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
    // power meter near the finger
    ctx.fillStyle = OUT; rr(aim.x - 30, aim.y + 16, 60, 12, 6); ctx.fill();
    ctx.fillStyle = v.power > 0.95 ? '#ffc531' : '#7cf27c'; rr(aim.x - 28, aim.y + 18, 56 * v.power, 8, 4); ctx.fill();
  }
  function drawFx() {
    for (const p of parts) {
      const a = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'line':
          ctx.strokeStyle = p.col; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
          break;
        case 'fire': {
          const t = p.life / p.max;
          ctx.fillStyle = t > 0.6 ? '#fff0a0' : t > 0.3 ? '#ffa53a' : '#e8412a';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + t * 0.6), 0, 6.283); ctx.fill();
          break;
        }
        case 'smoke':
          ctx.globalAlpha = a * 0.45;
          ctx.fillStyle = p.col || '#6b6f80'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - p.life / p.max * 0.6), 0, 6.283); ctx.fill();
          break;
        case 'ring': {
          const t = 1 - p.life / p.max;
          ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 8 * (1 - t);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * t, 0, 6.283); ctx.stroke();
          break;
        }
        case 'bolt':
        case 'feather':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = OUT; ctx.fillRect(-p.r - 1, -p.r * 0.5 - 1, p.r * 2 + 2, p.r + 2);
          ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
          ctx.restore();
          break;
        case 'ember':
          ctx.fillStyle = '#ffb15a'; ctx.beginPath(); ctx.arc(p.x + Math.sin(p.life * 3) * 6, p.y, p.r, 0, 6.283); ctx.fill();
          break;
        default:
          ctx.fillStyle = p.col; ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      }
    }
    ctx.globalAlpha = 1;
    for (const t of texts) {
      ctx.globalAlpha = clamp(t.life / t.max * 2, 0, 1);
      const pop = 1 + Math.max(0, (t.life - t.max + 0.12) / 0.12) * 0.5;
      outlined(t.txt, t.x, t.y, Math.round(t.size * pop), t.col, OUT, 5);
    }
    ctx.globalAlpha = 1;
  }

  function drawScene() {
    for (const pl of plats) drawIsland(pl);
    drawTower();
    drawPicks();
    for (const e of enemies) if (!e.alive) drawFig(e);
    for (const e of enemies) if (e.alive) drawFig(e);
    if (player) drawFig(player);
    drawArrows();
    drawFx();
    drawCloudSea();
    if (screen === 'play') { drawEnemyBars(); drawAim(); }
  }

  // ================================================================ HUD and screens
  function bar(r, v, max, col, label, flash) {
    ctx.fillStyle = OUT; rr(r.x - 3, r.y - 3, r.w + 6, r.h + 6, 8); ctx.fill();
    ctx.fillStyle = flash && Math.floor(clock * 12) % 2 ? '#ffffff' : shade(col, -0.55);
    rr(r.x, r.y, r.w, r.h, 6); ctx.fill();
    const w = Math.max(0, r.w * clamp(v / max, 0, 1));
    if (w > 2) {
      const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      gr.addColorStop(0, shade(col, 0.3)); gr.addColorStop(1, col);
      ctx.fillStyle = gr; rr(r.x, r.y, w, r.h, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(r.x + 3, r.y + 2, Math.max(0, w - 6), r.h * 0.3, 3); ctx.fill();
    }
    outlined(label, r.x + r.w / 2, r.y + r.h / 2 + 1, r.h - 4, '#ffffff', OUT, 4);
  }
  function drawTowerHUD() {
    if (!run) return;
    bar(L.hp, run.hp, run.st.maxHp, '#ff4d5e', String(Math.ceil(run.hp)));
    bar(L.st, run.sta, run.st.maxSt, '#3fa9ff', String(Math.floor(run.sta)), run.staFlash > 0);
    if (player.alive) button('jump', L.jump, 'JUMP', run.sta >= JUMP_COST ? 'light' : 'off', 22, JUMP_COST + ' STAMINA');
  }
  function drawHUD() {
    const k = L.kills;
    hudBox(k);
    botIcon(k.x + 25, k.y + k.h / 2 + 4, 11);
    outlined(String(run.kills), k.x + 46, k.y + 21, 26, '#ffffff', OUT, 5, 'left');
    text('LV ' + run.level + ' · BEST ' + Math.max(S.best, run.kills), k.x + 47, k.y + 42, 14, '#d6daf0', 'left', FU);
    const c = L.coins;
    hudBox(c);
    coinIcon(c.x + 26, c.y + c.h / 2, 12 * (1 + coinPulse * 1.5));
    outlined(fmt(shownCoins), c.x + 46, c.y + c.h / 2 + 2, 24, '#ffc531', OUT, 5, 'left');
    if (player.alive) {
      button('pause', L.pause, '', 'dark');
      const d = pressed && pressed.id === 'pause' ? 4 : 0;
      ctx.fillStyle = '#ffffff';
      rr(L.pause.x + 18, L.pause.y + 15 + d, 7, 24, 2); ctx.fill(); rr(L.pause.x + 30, L.pause.y + 15 + d, 7, 24, 2); ctx.fill();
    }
    // active power-ups with a ring timer
    let px = 14;
    for (const key of ['fire', 'triple', 'bomb']) {
      const left = run.pw[key];
      if (left <= 0) continue;
      const cx = px + 22, cy = L.T + 88, P = PW[key];
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(cx, cy, 21, 0, 6.283); ctx.fill();
      ctx.fillStyle = shade(P.col, -0.35); ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 6.283); ctx.fill();
      ctx.strokeStyle = P.col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + 6.283 * left / P.dur); ctx.stroke();
      if (left > 2 || Math.floor(clock * 8) % 2) icon(key, cx, cy, 10);
      px += 50;
    }
    if (run.combo >= 2 && run.comboT > 0) {
      const x = LW - 40, y = L.T + 90;
      ctx.globalAlpha = clamp(run.comboT, 0, 1);
      outlined('x' + run.combo, x, y, 30, '#ff5ad8', OUT, 6);
      outlined('COMBO', x, y + 22, 13, '#ffffff', OUT, 3, 'center', FU);
      ctx.globalAlpha = 1;
    }
    drawTowerHUD();
    if (banner) {
      const t = banner.max - banner.t;
      const pop = t < 0.18 ? 0.6 + easeOutBack(t / 0.18) * 0.4 : 1;
      ctx.globalAlpha = clamp(banner.t * 3, 0, 1);
      ctx.save(); ctx.translate(LW / 2, L.T + 162); ctx.scale(pop, pop);
      outlined(banner.txt, 0, 0, 42, banner.col, OUT, 9);
      if (banner.sub) outlined(banner.sub, 0, 36, 20, '#ffffff', OUT, 5, 'center', FU);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (run.tut && run.shots === 0 && !aim) drawTutorial();
  }
  function drawCoinFx() {
    const tx = L.coins.x + 26, ty = L.coins.y + L.coins.h / 2;
    for (const c of coinFx) {
      if (c.t < 0) continue;
      const t = c.t;
      const mx = (c.x0 + tx) / 2, my = Math.min(c.y0, ty) - 80;
      const x = (1 - t) * (1 - t) * c.x0 + 2 * (1 - t) * t * mx + t * t * tx;
      const y = (1 - t) * (1 - t) * c.y0 + 2 * (1 - t) * t * my + t * t * ty;
      coinIcon(x, y, 9);
    }
  }
  function drawTutorial() {
    const t = (clock % 1.8) / 1.8;
    const ax = 330, ay = L.tower.top - 120;
    const mv = clamp((t - 0.15) / 0.55, 0, 1);
    const x = ax - 110 * mv, y = ay + 80 * mv;
    outlined('DRAG BACK & RELEASE', LW / 2, L.T + 150, 30, '#ffffff', OUT, 7);
    outlined('to shoot. Aim for the head!', LW / 2, L.T + 184, 20, '#ffc531', OUT, 5, 'center', FU);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ax, ay, 18, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = t < 0.85 ? 1 : (1 - t) / 0.15;
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(x, y, 17, 0, 6.283); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function panel(x, y, w, h, title, col = '#3fa9ff') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(x, y + 8, w, h, 22); ctx.fill();
    ctx.fillStyle = OUT; rr(x - 3, y - 3, w + 6, h + 6, 24); ctx.fill();
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#3a4280'); gr.addColorStop(1, '#262b55');
    ctx.fillStyle = gr; rr(x, y, w, h, 21); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2; rr(x + 5, y + 5, w - 10, h - 10, 17); ctx.stroke();
    if (title) {
      const rw = Math.min(w - 40, 300), rx = x + (w - rw) / 2, ry = y - 22;
      ctx.fillStyle = OUT; rr(rx - 3, ry - 3, rw + 6, 52, 16); ctx.fill();
      const g2 = ctx.createLinearGradient(0, ry, 0, ry + 46);
      g2.addColorStop(0, shade(col, 0.25)); g2.addColorStop(1, col);
      ctx.fillStyle = g2; rr(rx, ry, rw, 46, 14); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(rx + 6, ry + 4, rw - 12, 14, 7); ctx.fill();
      outlined(title, x + w / 2, ry + 25, 28, '#ffffff', OUT, 6);
    }
  }
  function dim(a) { ctx.fillStyle = `rgba(10,12,30,${a})`; ctx.fillRect(-offX, 0, VW, LH); }

  function drawLogo(cx, cy, k = 1) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate(-0.04);
    // a drawn bow behind the word
    ctx.lineCap = 'round';
    const bx = -150, R = 120;
    ctx.strokeStyle = OUT; ctx.lineWidth = 16; ctx.beginPath(); ctx.arc(bx, 4, R, -0.8, 0.8); ctx.stroke();
    ctx.strokeStyle = '#b8742a'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(bx, 4, R, -0.8, 0.8); ctx.stroke();
    ctx.strokeStyle = '#f0b553'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bx, 4, R - 2, -0.72, 0.72); ctx.stroke();
    const sx = bx + Math.cos(0.8) * R, sy = Math.sin(0.8) * R;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, 4 - sy); ctx.lineTo(sx - 26, 4); ctx.lineTo(sx, 4 + sy); ctx.stroke();
    drawArrowShape(170, 4, 0, { fletch: '#2fb84a' }, 7.4);
    outlined('BOW', 0, -42, 88, '#ffc531', OUT, 16);
    outlined('BOTS', 14, 46, 88, '#ffffff', OUT, 16);
    ctx.restore();
  }
  function drawTitle() {
    const T = L.T;
    const top = T + 14, room = L.tower.top - 30 - top;
    drawLogo(LW / 2 + 10, top + 98 + Math.sin(clock * 2) * 4, 0.92);
    outlined('ENDLESS ROBOT ARCHERY', LW / 2, top + 200, 20, '#ffffff', OUT, 5, 'center', FU);
    const sy = top + 222;
    const cards = [['BEST RUN', fmt(S.best), '#ffffff'], ['TOTAL KILLS', fmt(S.total), '#ff6b7a'], ['COINS', fmt(S.coins), '#ffc531']];
    cards.forEach(([lab, val, col], i) => {
      const r = { x: 26 + i * 166, y: sy, w: 156, h: 70 };
      hudBox(r);
      text(lab, r.x + r.w / 2, r.y + 20, 15, '#d6daf0', 'center', FU);
      outlined(val, r.x + r.w / 2, r.y + 47, 28, col, OUT, 5);
    });
    const by = Math.min(sy + 100, top + room - 240);
    button('play', { x: 186, y: by, w: 326, h: 84 }, 'PLAY', 'green', 42);
    button('shop', { x: 186, y: by + 102, w: 326, h: 62 }, 'UPGRADES', 'blue', 26);
    if (lbSupported) button('lb', { x: 186, y: by + 182, w: 258, h: 62 }, 'LEADERBOARD', 'gold', 23);
    const sx = lbSupported ? 456 : 186;
    button('sound', { x: sx, y: by + 182, w: 56, h: 62 }, '', 'dark');
    soundIcon(sx + 28, by + 182 + 31, !S.muted);
  }

  function drawShop() {
    dim(0.5);
    const T = L.T, B = L.B;
    const x = 16, w = LW - 32, y = T + 30, h = B - T - 36;
    panel(x, y, w, h, 'UPGRADES', '#2f86e8');
    const cb = { x: LW / 2 - 70, y: y + 38, w: 140, h: 40 };
    ctx.fillStyle = 'rgba(10,12,30,0.5)'; rr(cb.x, cb.y, cb.w, cb.h, 12); ctx.fill();
    coinIcon(cb.x + 24, cb.y + 20, 11);
    outlined(fmt(S.coins), cb.x + 44, cb.y + 21, 22, '#ffc531', OUT, 5, 'left');
    const rowsTop = y + 90, rowsH = h - 90 - 88;
    const rowH = Math.min(78, rowsH / UPG.length);
    UPG.forEach((u, i) => {
      const ry = rowsTop + i * rowH, lvl = lvlOf(u.id), rh = rowH - 6;
      ctx.fillStyle = 'rgba(10,12,30,0.35)'; rr(x + 12, ry, w - 24, rh, 12); ctx.fill();
      const mid = ry + rh / 2;
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x + 40, mid, 19, 0, 6.283); ctx.fill();
      ctx.fillStyle = shade(u.col, -0.45); ctx.beginPath(); ctx.arc(x + 40, mid, 16, 0, 6.283); ctx.fill();
      icon(u.icon, x + 40, mid, 10);
      outlined(u.name, x + 68, mid - 13, 18, '#ffffff', OUT, 4, 'left');
      text(u.info, x + 68, mid + 7, 15, '#c9cdea', 'left', FU);
      const pw = Math.min(14, 150 / u.max);
      for (let k = 0; k < u.max; k++) {
        ctx.fillStyle = k < lvl ? u.col : 'rgba(255,255,255,0.15)';
        rr(x + 68 + k * (pw + 3), mid + 20, pw, 5, 2); ctx.fill();
      }
      const br = { x: x + w - 136, y: mid - 23, w: 114, h: 44 };
      if (lvl >= u.max) {
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; rr(br.x, br.y, br.w, br.h, 12); ctx.fill();
        outlined('MAX', br.x + br.w / 2, br.y + br.h / 2 + 2, 20, '#7cf27c', OUT, 4);
      } else {
        const c = upCost(u, lvl);
        button('buy:' + u.id, br, '', S.coins >= c ? 'gold' : 'off');
        const d = pressed && pressed.id === 'buy:' + u.id ? 4 : 0;
        coinIcon(br.x + 24, br.y + br.h / 2 + d, 10);
        outlined(fmt(c), br.x + 40, br.y + br.h / 2 + 2 + d, 20, '#ffffff', OUT, 4, 'left');
      }
    });
    button('back', { x: LW / 2 - 110, y: y + h - 76, w: 220, h: 56 }, 'BACK', 'light', 24);
  }

  function drawPause() {
    dim(0.55);
    const w = 360, h = 300, x = (LW - w) / 2, y = Math.max(L.T + 100, (L.T + L.B) / 2 - h / 2 - 40);
    panel(x, y, w, h, 'PAUSED', '#7b5cff');
    button('resume', { x: x + 40, y: y + 50, w: w - 80, h: 70 }, 'RESUME', 'green', 30);
    button('home', { x: x + 40, y: y + 142, w: w - 156, h: 60 }, 'QUIT', 'red', 24);
    button('sound', { x: x + w - 104, y: y + 142, w: 64, h: 60 }, '', 'dark');
    soundIcon(x + w - 72, y + 172, !S.muted);
    text('Kills so far count toward your total', LW / 2, y + 252, 16, '#c9cdea', 'center', FU);
  }
  function drawGameOver() {
    dim(0.5);
    const w = 450, h = 520, x = (LW - w) / 2, y = Math.max(L.T + 40, (L.T + L.B) / 2 - h / 2 - 50);
    panel(x, y, w, h, 'YOU FELL!', '#e8414b');
    botIcon(LW / 2 - 64, y + 84, 20);
    outlined(String(run.kills), LW / 2 - 30, y + 86, 64, '#ffffff', OUT, 8, 'left');
    const newBest = run.kills >= S.best && run.kills > 0;
    outlined(newBest ? 'NEW BEST RUN!' : 'BEST RUN ' + S.best, LW / 2, y + 140, 22, newBest ? '#ffc531' : '#c9cdea', OUT, 5, 'center', FU);
    const rows = [['HEADSHOTS', String(run.heads), '#ffd23f'], ['BEST COMBO', 'x' + run.bestCombo, '#ff5ad8'], ['COINS EARNED', '+' + fmt(run.coins), '#ffc531'], ['TOTAL KILLS', fmt(S.total), '#ff6b7a']];
    rows.forEach(([a, b, col], i) => {
      const ry = y + 164 + i * 38;
      ctx.fillStyle = 'rgba(10,12,30,0.35)'; rr(x + 30, ry, w - 60, 32, 9); ctx.fill();
      text(a, x + 46, ry + 17, 18, '#d6daf0', 'left', FU);
      outlined(b, x + w - 46, ry + 17, 20, col, OUT, 4, 'right');
    });
    button('play', { x: x + 30, y: y + 330, w: w - 60, h: 74 }, 'PLAY AGAIN', 'green', 32);
    const bw = lbSupported ? (w - 60 - 24) / 3 : (w - 60 - 12) / 2;
    button('shop', { x: x + 30, y: y + 424, w: bw, h: 58 }, 'UPGRADE', 'blue', 17);
    if (lbSupported) button('lb', { x: x + 30 + bw + 12, y: y + 424, w: bw, h: 58 }, 'RANKS', 'gold', 17);
    button('home', { x: x + w - 30 - bw, y: y + 424, w: bw, h: 58 }, 'HOME', 'light', 17);
  }
  function drawToast(dt) {
    if (!toastMsg) return;
    toastMsg.t -= dt;
    if (toastMsg.t <= 0) { toastMsg = null; return; }
    ctx.globalAlpha = clamp(toastMsg.t * 3, 0, 1);
    ctx.font = `700 19px ${FU}`;
    const w = Math.min(LW - 40, ctx.measureText(toastMsg.msg).width + 40);
    const y = L.B - 52;
    ctx.fillStyle = OUT; rr(LW / 2 - w / 2 - 2, y - 2, w + 4, 44, 14); ctx.fill();
    ctx.fillStyle = '#2b3060'; rr(LW / 2 - w / 2, y, w, 40, 12); ctx.fill();
    text(toastMsg.msg, LW / 2, y + 21, 19, toastMsg.col, 'center', FU);
    ctx.globalAlpha = 1;
  }
  function drawSafeZone() {
    ctx.fillStyle = 'rgba(255,0,0,0.25)';
    ctx.fillRect(-offX, 0, VW, L.T); ctx.fillRect(-offX, L.B, VW, LH - L.B);
  }

  function render(dt) {
    buttons = [];
    drawBackground(dt);
    const k = dpr * scale;
    let sx = 0, sy = 0;
    if (shakeT > 0) { shakeT -= dt; sx = rand(-1, 1) * shakeMag * shakeT; sy = rand(-1, 1) * shakeMag * shakeT; }
    ctx.setTransform(k, 0, 0, k, (offX + sx) * k, sy * k);
    if (screen === 'load') {
      outlined('LOADING', LW / 2, LH / 2, 28, '#ffffff', OUT, 5);
      return;
    }
    drawScene();
    ctx.setTransform(k, 0, 0, k, offX * k, 0);
    if (flashT > 0) { flashT -= dt; ctx.fillStyle = `rgba(255,255,255,${clamp(flashT * 3, 0, 0.5)})`; ctx.fillRect(-offX, 0, VW, LH); }
    if (hideHud) { /* marketing render */ } else if (screen === 'play' || screen === 'over') {
      drawHUD();
      drawCoinFx();
      if (overlay === 'pause') drawPause();
      if (screen === 'over') drawGameOver();
    } else if (screen === 'title') drawTitle();
    else if (screen === 'shop') drawShop();
    drawToast(dt);
    if (SHOW_SAFE) drawSafeZone();
  }

  // ================================================================ loop
  let last = performance.now(), acc = 0, manual = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    requestAnimationFrame(frame);
    if (manual) return;
    try {
      let sim = dt;
      if (slowT > 0) { slowT -= dt; sim *= 0.3; }
      acc += sim;
      let n = 0;
      while (acc >= STEP && n < 12) { update(STEP); acc -= STEP; n++; }
      if (n >= 12) acc = 0;
      render(dt);
    } catch (e) { console.error(e); }
  }
  window.addEventListener('resize', resize);
  if (DEBUG) {
    window.__bb = {
      get run() { return run; }, get screen() { return screen; }, get enemies() { return enemies; }, get arrows() { return arrows; },
      get player() { return player; }, get S() { return S; }, L, ETYPE, picks,
      start: startRun, spawn: (t) => spawnEnemy(t || 'archer'), fire: (a, p) => playerFire(a, p), jump: doJump,
      set manual(v) { manual = v; }, step(n = 1) { for (let i = 0; i < n; i++) update(STEP); render(STEP); },
      set aim(v) { aim = v; }, action: uiAction, spawnPick, hitPick, explode,
      theme(i) { themeCur = i; themeFade = 1; },
      set banner(v) { banner = v; }, solveShot, shotOrigin, submitTotal, showLeaderboard, writeSave,
      set hud(v) { hideHud = !v; }, get clock() { return clock; },
      get lbSupported() { return lbSupported; }, get saveLoaded() { return saveLoaded; },
    };
  }
  resize();
  requestAnimationFrame(frame);
  boot();
})();
