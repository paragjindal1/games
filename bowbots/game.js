/* Bow Bots: an endless ragdoll archery Snapchat Web Lens.
 * Drag back and release to shoot. Bot archers keep coming on floating
 * blocks; every kill counts toward your lifetime total on the leaderboard.
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
  const STEP = 1 / 120;         // fixed physics step
  const GRAV = 1150;            // arrow gravity
  const RAG_G = 1500;           // ragdoll gravity
  const ARROW_LEN = 46;
  const SHOT_COST = 10;
  const JUMP_COST = 20;

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
    { id: 'hp',    name: 'HEALTH',         info: '+15 max health',        max: 10, base: 12,  col: '#ff5a64' },
    { id: 'armor', name: 'ARMOR',          info: '-5% damage taken',      max: 8,  base: 15,  col: '#ff9a5a' },
    { id: 'dmg',   name: 'DAMAGE',         info: '+12% arrow damage',     max: 10, base: 15,  col: '#ffc531' },
    { id: 'sta',   name: 'STAMINA',        info: '+15 max stamina',       max: 10, base: 10,  col: '#4f9dff' },
    { id: 'regen', name: 'STAMINA REFILL', info: '+15% refill speed',     max: 10, base: 10,  col: '#5ad0ff' },
    { id: 'power', name: 'BOW POWER',      info: 'Faster, flatter arrows', max: 5, base: 20,  col: '#b6f04a' },
    { id: 'vamp',  name: 'LIFE STEAL',     info: '+4 health per kill',    max: 5,  base: 30,  col: '#ff5ad8' },
    { id: 'multi', name: 'ARROW SLOTS',    info: '+1 arrow per shot',     max: 2,  base: 120, col: '#ffffff' },
  ];
  const upCost = (u, lvl) => Math.round(u.base * Math.pow(1.55, lvl));
  const lvlOf = (id) => S.up[id] || 0;

  const ETYPE = {
    archer: { name: 'ARCHER', col: '#e8414b', hp: 1,   dmg: 1,   reload: 1,   acc: 1,    draw: 0.9, coins: 3 },
    scout:  { name: 'SCOUT',  col: '#36c46a', hp: 0.7, dmg: 0.7, reload: 0.6, acc: 1.2,  draw: 0.6, coins: 3 },
    heavy:  { name: 'HEAVY',  col: '#7d8aa6', hp: 1.7, dmg: 1.2, reload: 1.3, acc: 1,    draw: 1.1, coins: 5, helmet: true },
    sniper: { name: 'SNIPER', col: '#9b5cff', hp: 0.9, dmg: 1.7, reload: 1.5, acc: 0.35, draw: 1.6, coins: 5, laser: true },
    boss:   { name: 'BOSS',   col: '#ffb400', hp: 3.5, dmg: 1.3, reload: 1.2, acc: 0.8,  draw: 1.2, coins: 20, volley: 3, s: 1.6, crown: true },
  };

  // Skeleton: 0 head, 1 neck, 2 pelvis, 3 bow elbow, 4 bow hand, 5 string elbow,
  // 6 string hand, 7 front knee, 8 front foot, 9 back knee, 10 back foot.
  const CAPS = [
    [1, 0, 11, 'head'], [1, 2, 9, 'body'],
    [1, 3, 5.5, 'limb'], [3, 4, 5.5, 'limb'], [1, 5, 5.5, 'limb'], [5, 6, 5.5, 'limb'],
    [2, 7, 6, 'limb'], [7, 8, 6, 'limb'], [2, 9, 6, 'limb'], [9, 10, 6, 'limb'],
  ];
  const RAG_CONS = [[0, 1], [1, 2], [1, 3], [3, 4], [1, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10], [0, 2], [1, 7], [1, 9]];

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
    buildBackground();
  }

  function layout() {
    const T = ST, B = LH - SB;
    L.T = T; L.B = B;
    L.kills = { x: 14, y: T + 8, w: 156, h: 52 };
    L.coins = { x: LW / 2 - 66, y: T + 8, w: 132, h: 52 };
    L.pause = { x: LW - 66, y: T + 8, w: 52, h: 52 };
    L.tower = { x: 26, w: 140, top: B - 250 };
    L.px = L.tower.x + L.tower.w / 2;
    L.py = L.tower.top;
    L.hp = { x: L.tower.x + 16, y: L.tower.top + 40, w: L.tower.w - 32, h: 22 };
    L.st = { x: L.hp.x, y: L.hp.y + 28, w: L.hp.w, h: 18 };
    L.jump = { x: L.tower.x + 20, y: L.st.y + 32, w: L.tower.w - 40, h: 58 };
    L.zone = { x0: 290, x1: 485, y0: T + 220, y1: B - 50 };
  }

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale - offX, y: (e.clientY - r.top) / scale };
  }

  // ================================================================ background
  let bgCanvas = null;
  const squares = [];
  function buildBackground() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width; bgCanvas.height = canvas.height;
    const g = bgCanvas.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, bgCanvas.height);
    gr.addColorStop(0, '#26272c'); gr.addColorStop(1, '#3b3c42');
    g.fillStyle = gr; g.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    const rnd = seeded(11);
    const n = Math.round(bgCanvas.width * bgCanvas.height / (7000 * dpr * dpr));
    for (let i = 0; i < n; i++) {
      g.globalAlpha = 0.2 + rnd() * 0.6;
      g.fillStyle = '#ffffff';
      const r = (0.6 + rnd() * 1.1) * dpr;
      g.beginPath(); g.arc(rnd() * bgCanvas.width, rnd() * bgCanvas.height, r, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    squares.length = 0;
    for (let i = 0; i < 6; i++) {
      squares.push({ x: rand(-offX, LW + offX), y: rand(0, LH), s: rand(60, 150), r: rand(0, 6.28), vr: rand(-0.08, 0.08), vx: rand(-6, 6), vy: rand(-4, 4) });
    }
  }
  function drawBackground(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
    const k = dpr * scale;
    ctx.setTransform(k, 0, 0, k, offX * k, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (const q of squares) {
      q.r += q.vr * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.x < -offX - 200) q.x = LW + offX + 150; if (q.x > LW + offX + 200) q.x = -offX - 150;
      if (q.y < -200) q.y = LH + 150; if (q.y > LH + 200) q.y = -150;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r);
      ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s);
      ctx.restore();
    }
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
    noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.5, audio.sampleRate);
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
    hit() { tone('sine', 160, 50, 0.14, 0.5); noise(0.08, 0.3, 'lowpass', 700); },
    head() { tone('sine', 880, 870, 0.25, 0.25); tone('sine', 1320, 1300, 0.3, 0.18, 0.04); noise(0.08, 0.3, 'lowpass', 900); },
    wood() { tone('sine', 520, 260, 0.08, 0.3); noise(0.05, 0.2, 'bandpass', 1500); },
    coin() { tone('square', 990, 990, 0.06, 0.08); tone('square', 1480, 1480, 0.12, 0.08, 0.06); },
    hurt() { tone('sawtooth', 240, 90, 0.25, 0.22); noise(0.15, 0.3, 'lowpass', 500); },
    jump() { tone('sine', 300, 700, 0.15, 0.18); },
    block() { tone('square', 1800, 900, 0.08, 0.1); noise(0.06, 0.25, 'highpass', 4000); },
    apple() { tone('sine', 600, 1200, 0.15, 0.25); tone('sine', 900, 1800, 0.2, 0.15, 0.08); },
    die() { tone('sawtooth', 300, 40, 0.8, 0.25); },
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
  const enemies = [], arrows = [], plats = [], parts = [], texts = [];
  let apple = null;
  let aim = null;               // { id, ax, ay, x, y }
  let slowT = 0, shakeT = 0, shakeMag = 0, banner = null, toastMsg = null;
  let buttons = [], pressed = null;
  let clock = 0;
  let hideHud = false;          // debug: clean frames for marketing renders

  function makeFig(o) {
    return Object.assign({
      x: 0, y: 0, face: 1, s: 1.2, aim: -0.25, draw: 0, flinch: 0, t: rand(0, 6), flash: 0,
      hp: 100, maxHp: 100, alive: true, rag: null, kneel: false, col: '#3a8bff',
      pts: Array.from({ length: 11 }, () => ({ x: 0, y: 0 })),
    }, o);
  }
  function makePlayer() {
    const p = makeFig({ isPlayer: true, jy: 0, jv: 0, col: '#3a8bff' });
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

  function startRun() {
    enemies.length = 0; arrows.length = 0; plats.length = 0; parts.length = 0; texts.length = 0;
    apple = null; aim = null; slowT = 0; banner = null; overlay = null;
    const st = stats();
    run = {
      st, hp: st.maxHp, sta: st.maxSt, staWait: 0, kills: 0, coins: 0, heads: 0, shots: 0,
      spawnT: 0.6, nextBoss: 10, appleT: rand(12, 18), overT: 0, time: 0, tut: S.tut === 0, staFlash: 0,
    };
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
  // Where a shot leaves the bow when fully drawn at angle a.
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
          const l = q.x - x0, rr = x1 - q.x, t = q.y - y0, b = y1 - q.y, m = Math.min(l, rr, t, b);
          if (m === t) { q.y = y0; q.px = q.x - (q.x - q.px) * 0.5; if (r.vy) q.py = q.y - r.vy * h; }
          else if (m === l) q.x = x0;
          else if (m === rr) q.x = x1;
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
    const moving = k >= 15 && Math.random() < Math.min(0.6, 0.25 + k * 0.005);
    const pl = {
      tx: x, cx: LW + 90, y, baseY: y, w: type === 'boss' ? 112 : 82, h: 24, enter: 0, vy: 0, falling: false,
      move: moving ? { amp: rand(25, 55), sp: rand(0.7, 1.3), ph: rand(0, 6.28) } : null, t: 0,
    };
    plats.push(pl);
    const hp = Math.round((45 + 5 * k) * T.hp);
    const e = makeFig({
      type, T, s, face: -1, kneel: type !== 'boss', col: T.col, hp, maxHp: hp, plat: pl,
      state: 'enter', timer: rand(0.5, 1.3), aim: Math.PI + 0.2,
      dmg: Math.min(32, 9 + 0.3 * k) * T.dmg,
      reload: Math.max(1.0, 2.8 - 0.05 * k) * T.reload,
      sigma: Math.max(0.025, 0.11 - 0.0025 * k) * T.acc,
      speed: Math.min(1150, 900 + 6 * k),
    });
    e.x = pl.cx; e.y = pl.y; pose(e);
    enemies.push(e);
    if (type === 'boss') { banner = { txt: 'BOSS INCOMING', sub: 'Shoot it before it shoots you', t: 2.2, col: '#ffb400' }; SFX.boss(); }
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
    return { x, y, vx, vy, ang: Math.atan2(vy, vx), owner, dmg, stuck: null, life: 0, spent: false, apple: null };
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
    for (let i = 0; i < st.arrows; i++) {
      const aa = a + (i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.05);
      const o = shotOrigin(player, aa, power);
      arrows.push(makeArrow(o.x, o.y, Math.cos(aa) * v, Math.sin(aa) * v, 'p', st.dmg));
    }
    player.draw = 0;
    SFX.shoot();
  }

  function figHit(f, ox, oy, nx, ny) {
    const P = ptsOf(f);
    let best = null;
    for (const c of CAPS) {
      const A = P[c[0]], B = P[c[1]];
      const r = c[3] === 'head' ? c[2] * f.s : c[2] * f.s;
      let res;
      if (c[3] === 'head') res = segSeg(ox, oy, nx, ny, B.x, B.y, B.x, B.y);
      else res = segSeg(ox, oy, nx, ny, A.x, A.y, B.x, B.y);
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
    a.vx = a.vy = 0; a.life = 0;
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
      if (a.spent) {
        a.spin = (a.spin || 0) + h * 14;
        if (a.y > LH + 80) arrows.splice(k, 1);
        continue;
      }
      if (a.x < -offX - 300 || a.x > LW + offX + 300 || a.y > LH + 80) { arrows.splice(k, 1); continue; }
      // shoot down incoming arrows
      if (a.owner === 'p') {
        let blocked = false;
        for (const b of arrows) {
          if (b.owner !== 'e' || b.stuck || b.spent) continue;
          const bt = ARROW_LEN * 0.8;
          const r = segSeg(ox, oy, a.x, a.y, b.x, b.y, b.x - Math.cos(b.ang) * bt, b.y - Math.sin(b.ang) * bt);
          if (r.d2 < 49) {
            for (const z of [a, b]) { z.spent = true; z.vx *= -0.25; z.vy = -260; }
            burst(r.cx, r.cy, 10, '#ffe27a', 220);
            floatText(r.cx, r.cy - 20, 'BLOCKED! +1', '#ffe27a', 20);
            gainCoins(1); SFX.block();
            blocked = true; break;
          }
        }
        if (blocked) continue;
        if (apple && !apple.hit) {
          const r = segSeg(ox, oy, a.x, a.y, apple.x, apple.y, apple.x, apple.y);
          if (r.d2 < 20 * 20) hitApple(a);
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
      if (best) { arrowHitsFig(a, bf, best); continue; }
      // blocks
      const tw = { x: L.tower.x, y: L.tower.top, w: L.tower.w, h: LH * 2 };
      if (inRect(a, tw)) {
        a.x = clamp(a.x, tw.x - 2, tw.x + tw.w + 2);
        a.stuck = { kind: 'tower' }; a.life = 0; SFX.wood(); burst(a.x, a.y, 4, '#9a9aa2', 120);
        continue;
      }
      for (const pl of plats) {
        const r = platRect(pl);
        if (inRect(a, r)) {
          a.stuck = { kind: 'plat', pl, dx: a.x - pl.cx, dy: a.y - pl.y }; a.life = 0;
          SFX.wood(); burst(a.x, a.y, 4, '#9a9aa2', 120);
          break;
        }
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
      // Corpses take the hit and get knocked about.
      const P = f.rag.p;
      for (const idx of [hit.i, hit.j]) { P[idx].px -= ux * sp * 0.25 * STEP; P[idx].py -= uy * sp * 0.25 * STEP; }
      SFX.hit();
      return;
    }
    f.flash = 1; f.flinch = 1;
    burst(hit.cx, hit.cy, hit.part === 'head' ? 14 : 8, hit.part === 'head' ? '#ffd23f' : '#ff9a3c', 200);
    if (f.isPlayer) {
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
    const dmg = a.dmg * mult;
    f.hp -= dmg;
    if (head) { SFX.head(); floatText(hit.cx, hit.cy - 28, f.T.helmet ? 'HELMET!' : 'HEADSHOT!', '#ffd23f', 24); }
    else SFX.hit();
    floatText(hit.cx + rand(-6, 6), hit.cy - 8, '-' + Math.round(dmg), '#ffffff', 18);
    // A hit spoils the bot's aim.
    if (f.state === 'draw' && f.hp > 0) { f.state = 'wait'; f.timer = 0.5 + f.reload * 0.3; f.draw = 0; }
    if (f.hp <= 0) killEnemy(f, a, hit, ux * sp, uy * sp);
  }

  function killEnemy(e, a, hit, vx, vy) {
    e.alive = false; e.hp = 0;
    const head = hit.part === 'head';
    const ci = head ? 0 : hit.part === 'body' ? 2 : hit.j;
    makeRag(e, vx * 0.45, vy * 0.45 - 120, ci);
    e.dead = 0;
    e.plat.fallT = 0.7;
    run.kills++; S.total++;
    if (head) run.heads++;
    const c = e.T.coins + (head ? 2 : 0) + Math.floor(run.kills / 15);
    gainCoins(c);
    floatText(e.pts[0].x, e.pts[0].y - 50, '+' + c, '#ffc531', 26, true);
    if (run.st.vamp) { run.hp = Math.min(run.st.maxHp, run.hp + run.st.vamp); floatText(player.pts[0].x, player.pts[0].y - 40, '+' + run.st.vamp + ' HP', '#7dff9a', 18); }
    slowT = e.type === 'boss' ? 0.9 : head ? 0.45 : 0.2;
    SFX.coin();
    if (e.type === 'boss') { banner = { txt: 'BOSS DOWN!', sub: '+' + c + ' coins', t: 1.8, col: '#ffc531' }; shake(14, 0.4); }
    run.spawnT = Math.max(run.spawnT, 0.9);
    if (run.tut) { run.tut = false; S.tut = 1; }
    writeSave();
  }
  function gainCoins(c) { S.coins += c; if (run) run.coins += c; }

  function hitApple(a) {
    apple.hit = true;
    a.apple = apple;
    const heal = 25;
    run.hp = Math.min(run.st.maxHp, run.hp + heal);
    gainCoins(3);
    floatText(apple.x, apple.y - 24, '+25 HP  +3', '#7dff9a', 22);
    burst(apple.x, apple.y, 12, '#ff4d4d', 180);
    SFX.apple();
  }
  function updateApple(h) {
    if (!apple) {
      run.appleT -= h;
      if (run.appleT <= 0 && player.alive) {
        apple = { x: LW + 30, y: rand(L.T + 180, L.tower.top - 140), vx: -rand(45, 70), t: 0, hit: false };
        run.appleT = rand(14, 22);
      }
      return;
    }
    apple.t += h;
    if (apple.hit) {
      const host = arrows.find((a) => a.apple === apple);
      if (!host) { apple = null; return; }
      const ap = arrowPose(host);
      apple.x = ap.x - Math.cos(ap.ang) * 12; apple.y = ap.y - Math.sin(ap.ang) * 12;
      if (host.stuck && host.life > 3) { host.apple = null; apple = null; }
      return;
    }
    apple.x += apple.vx * h;
    apple.y += Math.sin(apple.t * 2) * 18 * h;
    if (apple.x < L.tower.x + L.tower.w + 20) apple = null;
  }

  // ================================================================ fx
  function burst(x, y, n, col, sp) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), v = rand(0.3, 1) * sp;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rand(0.35, 0.7), max: 0.7, col, r: rand(1.8, 3.6) });
    }
  }
  function floatText(x, y, txt, col, size, big) {
    texts.push({ x, y, txt, col, size, life: big ? 1.3 : 0.9, max: big ? 1.3 : 0.9 });
  }
  function shake(m, t) { shakeMag = Math.max(shakeMag, m); shakeT = Math.max(shakeT, t); }
  function toast(msg, col) { toastMsg = { msg, col: col || '#ffffff', t: 2.6 }; }

  // ================================================================ update
  function update(h) {
    clock += h;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= h; p.vy += 600 * h; p.x += p.vx * h; p.y += p.vy * h;
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]; t.life -= h; t.y -= 40 * h;
      if (t.life <= 0) texts.splice(i, 1);
    }
    if (screen === 'title' || screen === 'shop' || screen === 'load') {
      if (player) {
        player.t += h; player.x = L.px; player.y = L.py;
        player.aim = -0.35 + Math.sin(clock * 0.7) * 0.15; player.draw = 0.25 + Math.sin(clock * 1.3) * 0.2;
        pose(player);
      }
      return;
    }
    if (overlay) return;
    run.time += h;
    updatePlayer(h);
    for (const pl of plats) {
      pl.t += h;
      if (pl.enter < 1) { pl.enter = Math.min(1, pl.enter + h / 0.9); pl.cx = lerp(LW + 90, pl.tx, easeOutBack(pl.enter)); }
      if (pl.fallT !== undefined) {
        pl.fallT -= h;
        if (pl.fallT <= 0) { pl.falling = true; }
      }
      const oy = pl.y;
      if (pl.falling) { pl.vy += 1400 * h; pl.y += pl.vy * h; }
      else if (pl.move) { pl.y = pl.baseY + Math.sin(pl.t * pl.move.sp + pl.move.ph) * pl.move.amp; pl.vy = (pl.y - oy) / h; }
    }
    for (let i = plats.length - 1; i >= 0; i--) if (plats[i].y > LH + 120) plats.splice(i, 1);
    const rects = solids();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      updateEnemy(e, h);
      if (!e.alive) {
        stepRag(e, h, rects);
        e.dead += h;
        if (e.dead > 6 || e.rag.p.every((q) => q.y > LH + 60)) enemies.splice(i, 1);
      }
    }
    if (!player.alive) stepRag(player, h, rects);
    updateArrows(h);
    updateApple(h);
    // spawning
    if (player.alive) {
      const k = run.kills;
      const alive = enemies.filter((e) => e.alive);
      const normal = alive.filter((e) => e.type !== 'boss').length;
      const bossAlive = alive.some((e) => e.type === 'boss');
      const target = k < 3 ? 1 : k < 12 ? 2 : 3;
      run.spawnT -= h;
      if (run.spawnT <= 0) {
        if (k >= run.nextBoss && !bossAlive) { spawnEnemy('boss'); run.nextBoss += 10; run.spawnT = 1.5; }
        else if (normal < target - (bossAlive ? 1 : 0) || (alive.length === 0)) { spawnEnemy(pickType(k)); run.spawnT = 1.2; }
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
      if (p.jy >= 0) { p.jy = 0; p.jv = 0; }
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
      case 'shop': shopFrom = screen === 'shop' ? shopFrom : screen; screen = 'shop'; shopScroll = 0; break;
      case 'back': screen = shopFrom; break;
      case 'lb': showLeaderboard(); break;
      case 'sound': setMuted(!S.muted); break;
      case 'pause': overlay = 'pause'; break;
      case 'resume': overlay = null; break;
      case 'jump': doJump(); break;
      case 'home':
        if (screen === 'play' && run && player.alive) endRun();
        overlay = null; screen = 'title';
        enemies.length = 0; arrows.length = 0; plats.length = 0; apple = null; banner = null;
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
    S.coins -= c; S.up[id] = lvl + 1;
    SFX.buy();
    writeSave();
  }

  // ================================================================ drawing helpers
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(t, x, y, size, col, align = 'center', font = FD, base = 'middle') {
    ctx.font = `${font === FU ? '700 ' : ''}${size}px ${font}`;
    ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = col;
    ctx.fillText(t, x, y);
  }
  function outlined(t, x, y, size, col, stroke = 'rgba(20,20,26,0.85)', lw = 5, align = 'center') {
    ctx.font = `${size}px ${FD}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(t, x, y);
    ctx.fillStyle = col; ctx.fillText(t, x, y);
  }
  const STY = {
    gold: ['#ffc531', '#c58a00', '#2a1d00'],
    light: ['#ececf1', '#a9a9b3', '#2b2c33'],
    dark: ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.35)', '#ffffff'],
    red: ['#ff5a64', '#b52a33', '#ffffff'],
    off: ['#5a5b63', '#3c3d44', '#a9a9b3'],
  };
  function button(id, r, label, style = 'light', size = 24, sub) {
    buttons.push({ id, r });
    const [bg, sh, fg] = STY[style];
    const down = pressed && pressed.id === id ? 4 : 0;
    ctx.fillStyle = sh; rr(r.x, r.y + 5, r.w, r.h, 12); ctx.fill();
    ctx.fillStyle = bg; rr(r.x, r.y + down, r.w, r.h, 12); ctx.fill();
    if (sub) {
      text(label, r.x + r.w / 2, r.y + r.h / 2 - 8 + down, size, fg);
      text(sub, r.x + r.w / 2, r.y + r.h / 2 + 14 + down, 15, style === 'light' ? '#3a8bff' : fg, 'center', FU);
    } else text(label, r.x + r.w / 2, r.y + r.h / 2 + 2 + down, size, fg);
  }
  function coinIcon(x, y, r) {
    ctx.fillStyle = '#c58a00'; ctx.beginPath(); ctx.arc(x, y + 1.5, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffc531'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#e09e00'; ctx.lineWidth = r * 0.22; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, 6.283); ctx.stroke();
  }
  function skullIcon(x, y, r) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y - r * 0.15, r, 0, 6.283); ctx.fill();
    ctx.fillRect(x - r * 0.55, y + r * 0.4, r * 1.1, r * 0.6);
    ctx.fillStyle = '#2b2c33';
    ctx.beginPath(); ctx.arc(x - r * 0.38, y - r * 0.1, r * 0.27, 0, 6.283); ctx.arc(x + r * 0.38, y - r * 0.1, r * 0.27, 0, 6.283); ctx.fill();
    ctx.fillRect(x - r * 0.08, y + r * 0.55, r * 0.16, r * 0.45);
  }
  function soundIcon(x, y, on) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(x - 12, y - 5); ctx.lineTo(x - 6, y - 5); ctx.lineTo(x + 2, y - 12); ctx.lineTo(x + 2, y + 12);
    ctx.lineTo(x - 6, y + 5); ctx.lineTo(x - 12, y + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (on) { ctx.beginPath(); ctx.arc(x + 4, y, 8, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 4, y, 14, -0.8, 0.8); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(x + 7, y - 6); ctx.lineTo(x + 17, y + 6); ctx.moveTo(x + 17, y - 6); ctx.lineTo(x + 7, y + 6); ctx.stroke(); }
  }

  // ================================================================ scene drawing
  function drawBlock(x, y, w, h, cell, top) {
    ctx.fillStyle = top ? '#8e8f96' : '#808188';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let cx = x + cell; cx < x + w - 1; cx += cell) { ctx.moveTo(cx, y); ctx.lineTo(cx, y + h); }
    for (let cy = y + cell; cy < y + h - 1; cy += cell) { ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, 3);
  }
  function drawTower() {
    const t = L.tower;
    // battlements
    const m = 22;
    drawBlock(t.x - 6, t.top - 4, m, 10, 11, true);
    drawBlock(t.x + t.w - m + 6, t.top - 4, m, 10, 11, true);
    drawBlock(t.x - 6, t.top + 6, t.w + 12, LH - t.top, 34);
  }
  function drawPlat(pl) {
    const r = platRect(pl);
    drawBlock(r.x, r.y, r.w, r.h, r.w / 3, true);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(r.x, r.y + r.h - 4, r.w, 4);
  }

  function limb(P, a, b, w) { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke(); }
  function drawFig(f) {
    const P = ptsOf(f), s = f.s;
    let alpha = 1;
    if (f.rag && !f.isPlayer && f.dead > 4.5) alpha = Math.max(0, 1 - (f.dead - 4.5) / 1.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const hr = 11 * s;
    const paint = (front, back, accent, headCol, ow) => {
      // back limbs
      ctx.strokeStyle = back;
      limb(P, 1, 5, 9 * s + ow); limb(P, 5, 6, 8 * s + ow);
      ctx.strokeStyle = accent || back; limb(P, 2, 9, 10 * s + ow);
      ctx.strokeStyle = back; limb(P, 9, 10, 9 * s + ow);
      // torso and front leg
      ctx.strokeStyle = front; limb(P, 1, 2, 16 * s + ow); limb(P, 0, 1, 7 * s + ow);
      ctx.strokeStyle = accent || front; limb(P, 2, 7, 10 * s + ow);
      ctx.strokeStyle = front; limb(P, 7, 8, 9 * s + ow);
      ctx.fillStyle = headCol; ctx.beginPath(); ctx.arc(P[0].x, P[0].y, hr + ow / 2, 0, 6.283); ctx.fill();
      // bow arm
      ctx.strokeStyle = front; limb(P, 1, 3, 9 * s + ow); limb(P, 3, 4, 8 * s + ow);
    };
    const oc = 'rgba(20,20,26,0.55)';
    paint(oc, oc, null, oc, 4);
    const acc = f.isPlayer ? null : f.col;
    paint('#f4f4f6', '#cfd0d7', acc ? shadeCol(acc) : null, '#f4f4f6', 0);
    if (acc) { ctx.strokeStyle = acc; limb(P, 2, 7, 10 * s); }
    if (f.flash > 0) {
      ctx.globalAlpha = alpha * f.flash * 0.75;
      paint('#ff4a4a', '#ff4a4a', '#ff4a4a', '#ff4a4a', 0);
      ctx.globalAlpha = alpha;
    }
    drawHeadGear(f, P, hr);
    drawBow(f, P);
    ctx.restore();
  }
  function shadeCol(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) * 0.75 | 0},${((n >> 8) & 255) * 0.75 | 0},${(n & 255) * 0.75 | 0})`;
  }
  function drawHeadGear(f, P, hr) {
    const hx = P[0].x, hy = P[0].y;
    const up = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x);
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(up + Math.PI / 2);
    if (f.isPlayer) {
      ctx.strokeStyle = '#3a8bff'; ctx.lineWidth = 4 * f.s;
      ctx.beginPath(); ctx.arc(0, 0, hr - 1, Math.PI + 0.5, -0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-f.face * hr * 0.8, -hr * 0.45); ctx.lineTo(-f.face * hr * 1.8, -hr * 0.1 + Math.sin(f.t * 6) * 2); ctx.stroke();
    } else if (f.T.helmet) {
      ctx.fillStyle = '#6d7891'; ctx.beginPath(); ctx.arc(0, 0, hr + 2, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillRect(-hr - 4, -2, 2 * hr + 8, 4);
    } else if (f.T.crown) {
      ctx.fillStyle = '#ffc531';
      ctx.beginPath(); ctx.moveTo(-hr, -hr * 0.55); ctx.lineTo(-hr, -hr * 1.35); ctx.lineTo(-hr * 0.5, -hr * 0.95); ctx.lineTo(0, -hr * 1.55);
      ctx.lineTo(hr * 0.5, -hr * 0.95); ctx.lineTo(hr, -hr * 1.35); ctx.lineTo(hr, -hr * 0.55); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = f.col; ctx.lineWidth = 4 * f.s;
      ctx.beginPath(); ctx.arc(0, 0, hr - 1, Math.PI + 0.45, -0.45); ctx.stroke();
      if (f.T.laser) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(-f.face * hr * 0.45 * -1, -hr * 0.05, 2.4, 0, 6.283); ctx.fill(); }
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
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(ax, ay);
    if (pulled) ctx.lineTo(P[6].x, P[6].y);
    ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = '#9a6a00'; ctx.lineWidth = 5.5 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, R, t1, t2); ctx.stroke();
    ctx.strokeStyle = '#ffbf2e'; ctx.lineWidth = 3.5 * s;
    ctx.beginPath(); ctx.arc(cx, cy, R, t1, t2); ctx.stroke();
    if (pulled) drawArrowShape(P[6].x + ux * ARROW_LEN * s * 0.95, P[6].y + uy * ARROW_LEN * s * 0.95, a, f.isPlayer ? '#3a8bff' : f.col, s * 0.95);
    // string hand on top
    if (!f.rag) {
      ctx.fillStyle = '#f4f4f6'; ctx.beginPath(); ctx.arc(P[6].x, P[6].y, 4.5 * s, 0, 6.283); ctx.fill();
    }
  }
  function drawArrowShape(x, y, ang, fcol, k = 1) {
    const L2 = ARROW_LEN * k, ux = Math.cos(ang), uy = Math.sin(ang);
    const tx = x - ux * L2, ty = y - uy * L2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,20,26,0.45)'; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x - ux * 6, y - uy * 6); ctx.stroke();
    ctx.strokeStyle = '#f6f6f8'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x - ux * 6, y - uy * 6); ctx.stroke();
    // head
    ctx.fillStyle = '#e4e4ea';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * 10 - uy * 4.5, y - uy * 10 + ux * 4.5); ctx.lineTo(x - ux * 10 + uy * 4.5, y - uy * 10 - ux * 4.5); ctx.closePath(); ctx.fill();
    // fletching
    ctx.strokeStyle = fcol; ctx.lineWidth = 2.6;
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(tx + ux * 10, ty + uy * 10);
      ctx.lineTo(tx - ux * 1 - uy * 6 * sgn, ty - uy * 1 + ux * 6 * sgn); ctx.stroke();
    }
  }
  function drawArrows() {
    for (const a of arrows) {
      const p = arrowPose(a);
      let alpha = 1;
      if (a.stuck && a.stuck.kind === 'tower' && a.life > 7) alpha = Math.max(0, 8 - a.life);
      if (a.stuck && a.stuck.kind === 'fig' && a.stuck.f.dead > 4.5) alpha = Math.max(0, 1 - (a.stuck.f.dead - 4.5) / 1.5);
      ctx.globalAlpha = alpha;
      const ang = a.spent ? a.ang + a.spin : p.ang;
      drawArrowShape(p.x, p.y, ang, a.owner === 'p' ? '#3a8bff' : '#ff5a5a');
      ctx.globalAlpha = 1;
      if (!a.stuck && !a.spent && a.y < L.T - 10) {
        ctx.fillStyle = a.owner === 'p' ? '#6fb2ff' : '#ff5a5a';
        const x = clamp(a.x, 10, LW - 10), y = L.T + 4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 12); ctx.lineTo(x + 7, y + 12); ctx.closePath(); ctx.fill();
      }
    }
  }
  function drawApple() {
    if (!apple) return;
    const { x, y } = apple;
    ctx.fillStyle = 'rgba(20,20,26,0.45)'; ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#e8303a'; ctx.beginPath(); ctx.arc(x - 4, y, 10, 0, 6.283); ctx.arc(x + 4, y, 10, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(x - 6, y - 4, 3, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#6b3b12'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 2, y - 15); ctx.stroke();
    ctx.fillStyle = '#4fc65a'; ctx.beginPath(); ctx.ellipse(x + 7, y - 13, 6, 3, -0.5, 0, 6.283); ctx.fill();
    if (!apple.hit) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(clock * 6);
      text('+HP', x, y - 30, 14, '#7dff9a', 'center', FD);
      ctx.globalAlpha = 1;
    }
  }
  function drawEnemyBars() {
    for (const e of enemies) {
      if (!e.alive || e.state === 'enter' && e.plat.enter < 0.6) continue;
      const P = e.pts, w = 40 * e.s, x = P[0].x - w / 2, y = P[0].y - 26 * e.s - (e.T.crown ? 10 : 0);
      ctx.fillStyle = 'rgba(20,20,26,0.6)'; rr(x - 2, y - 2, w + 4, 10, 4); ctx.fill();
      ctx.fillStyle = '#e8414b'; rr(x, y, Math.max(2, w * e.hp / e.maxHp), 6, 3); ctx.fill();
      if (e.T.laser && e.state === 'draw' && player.alive) {
        // sniper sight: shows the exact path it is about to fire
        const o = shotOrigin(e, e.aim, 1);
        ctx.strokeStyle = `rgba(255,59,59,${0.15 + 0.5 * e.draw})`; ctx.lineWidth = 1.5;
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
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(aim.ax, aim.ay, 16, 0, 6.283); ctx.stroke();
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(aim.ax, aim.ay); ctx.lineTo(aim.x, aim.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(aim.x, aim.y, 6, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    if (v.len <= 12) return;
    // trajectory preview: the first part of the flight only
    const sp = (420 + 760 * v.power) * run.st.power;
    const o = shotOrigin(player, v.a, v.power);
    const col = run.sta >= SHOT_COST ? '255,255,255' : '111,178,255';
    for (let i = 1; i <= 16; i++) {
      const t = i * 0.028;
      const x = o.x + Math.cos(v.a) * sp * t, y = o.y + Math.sin(v.a) * sp * t + 0.5 * GRAV * t * t;
      ctx.fillStyle = `rgba(${col},${0.85 * (1 - i / 17)})`;
      ctx.beginPath(); ctx.arc(x, y, 3.2 - i * 0.12, 0, 6.283); ctx.fill();
    }
    // power readout near the finger
    ctx.fillStyle = 'rgba(20,20,26,0.6)'; rr(aim.x - 26, aim.y + 16, 52, 8, 4); ctx.fill();
    ctx.fillStyle = v.power > 0.95 ? '#ffc531' : '#ffffff'; rr(aim.x - 26, aim.y + 16, 52 * v.power, 8, 4); ctx.fill();
  }
  function drawFx() {
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = p.col; ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    ctx.globalAlpha = 1;
    for (const t of texts) {
      ctx.globalAlpha = clamp(t.life / t.max * 2, 0, 1);
      const pop = 1 + Math.max(0, (t.life - t.max + 0.12) / 0.12) * 0.4;
      outlined(t.txt, t.x, t.y, Math.round(t.size * pop), t.col, 'rgba(20,20,26,0.8)', 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawScene() {
    for (const pl of plats) drawPlat(pl);
    drawTower();
    drawApple();
    for (const e of enemies) if (!e.alive) drawFig(e);
    for (const e of enemies) if (e.alive) drawFig(e);
    if (player) drawFig(player);
    drawArrows();
    if (screen === 'play') { drawEnemyBars(); drawAim(); }
    drawFx();
  }

  // ================================================================ HUD and screens
  function bar(r, v, max, col, label, flash) {
    ctx.fillStyle = 'rgba(20,20,26,0.55)'; rr(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 6); ctx.fill();
    ctx.fillStyle = flash ? (Math.floor(clock * 12) % 2 ? '#ffffff' : col) : shadeCol(col);
    rr(r.x, r.y, r.w, r.h, 5); ctx.fill();
    ctx.fillStyle = col; rr(r.x, r.y, Math.max(0, r.w * clamp(v / max, 0, 1)), r.h, 5); ctx.fill();
    if (flash) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; rr(r.x, r.y, r.w, r.h, 5); ctx.fill(); }
    text(label, r.x + r.w / 2, r.y + r.h / 2 + 1, r.h - 5, '#ffffff');
  }
  function drawTowerHUD() {
    if (!run) return;
    bar(L.hp, run.hp, run.st.maxHp, '#e8414b', String(Math.ceil(run.hp)));
    bar(L.st, run.sta, run.st.maxSt, '#3a8bff', String(Math.floor(run.sta)), run.staFlash > 0);
    if (player.alive) button('jump', L.jump, 'JUMP', run.sta >= JUMP_COST ? 'light' : 'off', 22, JUMP_COST + ' STAMINA');
  }
  function drawHUD() {
    const k = L.kills;
    ctx.fillStyle = 'rgba(20,20,26,0.45)'; rr(k.x, k.y, k.w, k.h, 12); ctx.fill();
    skullIcon(k.x + 26, k.y + k.h / 2, 12);
    text(String(run.kills), k.x + 48, k.y + 22, 26, '#ffffff', 'left');
    text('BEST ' + Math.max(S.best, run.kills), k.x + 49, k.y + 42, 14, '#b9bac4', 'left', FU);
    const c = L.coins;
    ctx.fillStyle = 'rgba(20,20,26,0.45)'; rr(c.x, c.y, c.w, c.h, 12); ctx.fill();
    coinIcon(c.x + 26, c.y + c.h / 2, 12);
    text(fmt(S.coins), c.x + 46, c.y + c.h / 2 + 2, 24, '#ffc531', 'left');
    if (player.alive) {
      button('pause', L.pause, '', 'dark');
      const d = pressed && pressed.id === 'pause' ? 4 : 0;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(L.pause.x + 18, L.pause.y + 15 + d, 6, 22); ctx.fillRect(L.pause.x + 29, L.pause.y + 15 + d, 6, 22);
    }
    drawTowerHUD();
    if (banner) {
      const a = clamp(banner.t * 3, 0, 1);
      ctx.globalAlpha = a;
      const y = L.T + 120;
      outlined(banner.txt, LW / 2, y, 42, banner.col, 'rgba(20,20,26,0.9)', 8);
      if (banner.sub) outlined(banner.sub, LW / 2, y + 38, 18, '#ffffff', 'rgba(20,20,26,0.9)', 5);
      ctx.globalAlpha = 1;
    }
    if (run.tut && run.shots === 0 && !aim) drawTutorial();
  }
  function drawTutorial() {
    const t = (clock % 1.8) / 1.8;
    const ax = 330, ay = L.tower.top - 120;
    const mv = clamp((t - 0.15) / 0.55, 0, 1);
    const x = ax - 110 * mv, y = ay + 80 * mv;
    outlined('DRAG BACK & RELEASE', LW / 2, L.T + 120, 28, '#ffffff', 'rgba(20,20,26,0.9)', 7);
    outlined('to shoot. Aim for the head!', LW / 2, L.T + 154, 18, '#ffc531', 'rgba(20,20,26,0.9)', 5);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ax, ay, 16, 0, 6.283); ctx.stroke();
    ctx.globalAlpha = t < 0.85 ? 1 : (1 - t) / 0.15;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,26,0.6)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(x, y + 6, w, h, 18); ctx.fill();
    ctx.fillStyle = '#34353c'; rr(x, y, w, h, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; rr(x, y, w, h, 18); ctx.stroke();
  }
  function dim(a) { ctx.fillStyle = `rgba(16,16,20,${a})`; ctx.fillRect(-offX, 0, VW, LH); }

  function drawLogo(cx, cy, k = 1) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate(-0.04);
    outlined('BOW', 0, -40, 84, '#ffc531', '#2b1d00', 14);
    outlined('BOTS', 0, 44, 84, '#ffffff', '#1d1e24', 14);
    ctx.restore();
  }
  function drawTitle() {
    const T = L.T;
    const top = T + 30, room = L.tower.top - 30 - top;
    drawLogo(LW / 2, top + 100, 1);
    text('ENDLESS RAGDOLL ARCHERY', LW / 2, top + 196, 20, '#b9bac4', 'center', FU);
    // stats
    const sy = top + 226;
    const cards = [['BEST RUN', fmt(S.best), '#ffffff'], ['TOTAL KILLS', fmt(S.total), '#ff6b6b'], ['COINS', fmt(S.coins), '#ffc531']];
    cards.forEach(([lab, val, col], i) => {
      const x = 30 + i * 164;
      ctx.fillStyle = 'rgba(20,20,26,0.45)'; rr(x, sy, 152, 70, 12); ctx.fill();
      text(lab, x + 76, sy + 20, 15, '#b9bac4', 'center', FU);
      text(val, x + 76, sy + 47, 28, col);
    });
    const by = Math.min(sy + 100, top + room - 250);
    button('play', { x: 190, y: by, w: 320, h: 86 }, 'PLAY', 'gold', 40);
    button('shop', { x: 190, y: by + 104, w: 320, h: 64 }, 'UPGRADES', 'light', 26);
    if (lbSupported) button('lb', { x: 190, y: by + 186, w: 252, h: 64 }, 'LEADERBOARD', 'light', 24);
    button('sound', { x: lbSupported ? 454 : 190, y: by + 186, w: 56, h: 64 }, '', 'dark');
    soundIcon((lbSupported ? 454 : 190) + 28, by + 186 + 32, !S.muted);
    text('Leaderboard ranks your total kills', 350, by + 270, 15, '#8f909a', 'center', FU);
  }

  let shopScroll = 0;
  function drawShop() {
    dim(0.55);
    const T = L.T, B = L.B;
    const x = 18, w = LW - 36, y = T + 6, h = B - T - 12;
    panel(x, y, w, h);
    text('UPGRADES', LW / 2, y + 40, 32, '#ffffff');
    ctx.fillStyle = 'rgba(20,20,26,0.5)'; rr(LW / 2 - 70, y + 66, 140, 38, 10); ctx.fill();
    coinIcon(LW / 2 - 46, y + 85, 11);
    text(fmt(S.coins), LW / 2 - 28, y + 87, 22, '#ffc531', 'left');
    const rowsTop = y + 118, rowsH = h - 118 - 86;
    const rowH = Math.min(78, rowsH / UPG.length);
    UPG.forEach((u, i) => {
      const ry = rowsTop + i * rowH, lvl = lvlOf(u.id);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
      rr(x + 12, ry, w - 24, rowH - 6, 10); ctx.fill();
      ctx.fillStyle = u.col; rr(x + 22, ry + 10, 8, rowH - 26, 4); ctx.fill();
      const mid = ry + (rowH - 6) / 2;
      text(u.name, x + 42, mid - 12, 20, '#ffffff', 'left');
      text(u.info, x + 42, mid + 10, 16, '#b9bac4', 'left', FU);
      // level pips
      const pw = Math.min(14, 150 / u.max);
      for (let k = 0; k < u.max; k++) {
        ctx.fillStyle = k < lvl ? u.col : 'rgba(255,255,255,0.15)';
        ctx.fillRect(x + 42 + k * (pw + 3), mid + 22, pw, 4);
      }
      const br = { x: x + w - 140, y: ry + (rowH - 6) / 2 - 24, w: 118, h: 46 };
      if (lvl >= u.max) {
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; rr(br.x, br.y, br.w, br.h, 12); ctx.fill();
        text('MAX', br.x + br.w / 2, br.y + br.h / 2 + 2, 20, '#8f909a');
      } else {
        const c = upCost(u, lvl);
        button('buy:' + u.id, br, '', S.coins >= c ? 'gold' : 'off');
        const d = pressed && pressed.id === 'buy:' + u.id ? 4 : 0;
        coinIcon(br.x + 26, br.y + br.h / 2 + d, 10);
        text(fmt(c), br.x + 42, br.y + br.h / 2 + 2 + d, 20, S.coins >= c ? '#2a1d00' : '#c9c9d0', 'left');
      }
    });
    button('back', { x: LW / 2 - 110, y: y + h - 76, w: 220, h: 58 }, 'BACK', 'light', 24);
  }

  function drawPause() {
    dim(0.6);
    const w = 360, h = 330, x = (LW - w) / 2, y = Math.max(L.T + 80, (L.T + L.B) / 2 - h / 2 - 40);
    panel(x, y, w, h);
    text('PAUSED', LW / 2, y + 48, 34, '#ffffff');
    button('resume', { x: x + 40, y: y + 92, w: w - 80, h: 68 }, 'RESUME', 'gold', 28);
    button('home', { x: x + 40, y: y + 180, w: w - 156, h: 60 }, 'QUIT', 'light', 22);
    button('sound', { x: x + w - 104, y: y + 180, w: 64, h: 60 }, '', 'dark');
    soundIcon(x + w - 72, y + 210, !S.muted);
    text('Kills so far count toward your total', LW / 2, y + 290, 15, '#8f909a', 'center', FU);
  }
  function drawGameOver() {
    dim(0.55);
    const w = 440, h = 520, x = (LW - w) / 2, y = Math.max(L.T + 20, (L.T + L.B) / 2 - h / 2 - 60);
    panel(x, y, w, h);
    outlined('YOU FELL!', LW / 2, y + 50, 40, '#ff6b6b', 'rgba(20,20,26,0.9)', 7);
    skullIcon(LW / 2 - 70, y + 122, 22);
    text(String(run.kills), LW / 2 - 36, y + 124, 64, '#ffffff', 'left');
    const newBest = run.kills >= S.best && run.kills > 0;
    text(newBest ? 'NEW BEST RUN!' : 'BEST RUN ' + S.best, LW / 2, y + 178, 20, newBest ? '#ffc531' : '#b9bac4', 'center', FU);
    const rows = [['HEADSHOTS', String(run.heads), '#ffd23f'], ['COINS EARNED', '+' + fmt(run.coins), '#ffc531'], ['TOTAL KILLS', fmt(S.total), '#ff6b6b']];
    rows.forEach(([a, b, col], i) => {
      const ry = y + 206 + i * 38;
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; rr(x + 30, ry, w - 60, 32, 8); ctx.fill();
      text(a, x + 46, ry + 17, 18, '#d0d1d8', 'left', FU);
      text(b, x + w - 46, ry + 17, 20, col, 'right');
    });
    button('play', { x: x + 30, y: y + 330, w: w - 60, h: 72 }, 'PLAY AGAIN', 'gold', 30);
    const hasLb = lbSupported;
    const bw = hasLb ? (w - 60 - 24) / 3 : (w - 60 - 12) / 2;
    button('shop', { x: x + 30, y: y + 420, w: bw, h: 58 }, 'UPGRADE', 'light', 17);
    if (hasLb) button('lb', { x: x + 30 + bw + 12, y: y + 420, w: bw, h: 58 }, 'RANKS', 'light', 17);
    button('home', { x: x + w - 30 - bw, y: y + 420, w: bw, h: 58 }, 'HOME', 'light', 17);
  }
  function drawToast(dt) {
    if (!toastMsg) return;
    toastMsg.t -= dt;
    if (toastMsg.t <= 0) { toastMsg = null; return; }
    ctx.globalAlpha = clamp(toastMsg.t * 3, 0, 1);
    ctx.font = `700 19px ${FU}`;
    const w = Math.min(LW - 40, ctx.measureText(toastMsg.msg).width + 40);
    const y = L.B - 50;
    ctx.fillStyle = 'rgba(20,20,26,0.88)'; rr(LW / 2 - w / 2, y, w, 40, 12); ctx.fill();
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
      text('LOADING', LW / 2, LH / 2, 28, '#ffffff');
      return;
    }
    drawScene();
    ctx.setTransform(k, 0, 0, k, offX * k, 0);
    if (hideHud) { /* marketing render */ } else if (screen === 'play' || screen === 'over') {
      drawHUD();
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
      get player() { return player; }, get S() { return S; }, L, ETYPE,
      start: startRun, spawn: (t) => spawnEnemy(t || 'archer'), fire: (a, p) => playerFire(a, p), jump: doJump,
      set manual(v) { manual = v; }, step(n = 1) { for (let i = 0; i < n; i++) update(STEP); render(STEP); },
      set aim(v) { aim = v; }, action: uiAction, setApple: (v) => { apple = v; }, botAim,
      set banner(v) { banner = v; }, solveShot, shotOrigin, submitTotal, showLeaderboard, writeSave,
      set hud(v) { hideHud = !v; }, get clock() { return clock; },
      get lbSupported() { return lbSupported; }, get saveLoaded() { return saveLoaded; },
    };
  }
  resize();
  requestAnimationFrame(frame);
  boot();
})();
