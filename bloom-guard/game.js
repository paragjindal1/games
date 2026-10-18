/* Bloom Guard — a grow, merge & defend Snapchat Web Lens.
 * Hold (mouse / touch / Space) to grow seeds, drag matching plants together to
 * evolve them, and keep the night pests from breaking through the hedge.
 * Everything is drawn in code: no images, fonts or network requests. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- setup
  const W = 540, H = 960;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const snap = window.snapchat || null;

  let dpr = 1, scale = 1, offX = 0, offY = 0;
  let bg = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const fmt = (n) => {
    n = Math.floor(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };

  // ---------------------------------------------------------------- data
  const MAX_TIER = 9;
  const PLANTS = [null,
    { name: 'Sprout',        color: '#8ef07a', shot: '#d4ff9a' },
    { name: 'Clover',        color: '#3fd17a', shot: '#8dffbe' },
    { name: 'Bluebell',      color: '#62a8ff', shot: '#b5d8ff' },
    { name: 'Thorn Rose',    color: '#ff4f7a', shot: '#ffa3ba' },
    { name: 'Star Cactus',   color: '#2fbf8f', shot: '#b6ffd9' },
    { name: 'Sunflower',     color: '#ffc93c', shot: '#fff1a0' },
    { name: 'Frost Lily',    color: '#9ff3ff', shot: '#e9fdff' },
    { name: 'Venus Snapper', color: '#c04fff', shot: '#e9b8ff' },
    { name: 'Moon Bloom',    color: '#e8e2ff', shot: '#ffffff' },
  ];
  const PERKS = { 5: 'Splash', 7: 'Freeze', 9: 'Big splash' };

  const ENEMIES = {
    slug:   { hp: 20,  speed: 30, r: 20, dps: 4,  coin: 1,   name: 'Glow Slug' },
    beetle: { hp: 48,  speed: 21, r: 22, dps: 7,  coin: 2,   name: 'Iron Beetle' },
    wasp:   { hp: 13,  speed: 58, r: 17, dps: 3,  coin: 1,   name: 'Night Wasp' },
    mole:   { hp: 420, speed: 13, r: 44, dps: 25, coin: 25,  name: 'Mole King' },
  };

  // Layout (logical 540x960 portrait).
  const HEDGE_Y = 604;
  const FIELD_TOP = 110;
  const SLOTS = [];
  for (let i = 0; i < 5; i++) SLOTS.push({ x: 54 + i * 108, y: 672, s: 94, pot: true });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) SLOTS.push({ x: 230 + c * 88, y: 774 + r * 90, s: 82, pot: false });
  const POD = { x: 92, y: 818, r: 64 };
  const UI = {
    wave:    { x: 16,  y: 34,  w: 214, h: 60 },
    skip:    { x: 242, y: 44,  w: 96,  h: 42 },
    mute:    { x: 414, y: 40,  w: 50,  h: 50 },
    pause:   { x: 474, y: 40,  w: 50,  h: 50 },
    trash:   { x: 14,  y: 910, w: 100, h: 44 },
    coins:   { x: 126, y: 910, w: 160, h: 44 },
    shop:    { x: 404, y: 910, w: 122, h: 44 },
  };

  // ---------------------------------------------------------------- state
  const freshSave = () => ({
    v: 1, coins: 0, wave: 1, best: 0, found: 1, buys: 0, tut: 0, muted: false,
    slots: new Array(SLOTS.length).fill(0),
    up: { grow: 0, soil: 0, sap: 0, bramble: 0 },
  });
  let S = freshSave();

  let screen = 'loading';        // loading | title | play
  let overlay = null;            // null | 'shop' | 'pause'
  let time = 0;
  let growMeter = 0;
  let hedgeHp = 100;
  let waveState = 'idle';        // idle | countdown | running
  let countdown = 0;
  let toSpawn = [];
  let spawnTimer = 0;
  let waveTotal = 0, waveKilled = 0;
  let enemies = [], shots = [], parts = [], floaters = [], flyCoins = [];
  let cooldowns = new Array(SLOTS.length).fill(0);
  let banner = null;             // { title, sub, t }
  let shake = 0;
  let boosts = { coin: 0 };
  let lbSupported = false;
  let shopScroll = 0;

  // ---------------------------------------------------------------- Snap API + save
  let saveLoaded = false;
  let savePending = Promise.resolve();
  let dirty = false, saveTimer = 0;

  async function boot() {
    resize();
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
    if (saved && saved.v === 1) {
      const base = freshSave();
      S = Object.assign(base, saved, { up: Object.assign(base.up, saved.up || {}) });
      if (!Array.isArray(S.slots) || S.slots.length !== SLOTS.length) S.slots = base.slots;
    }
    hedgeHp = hedgeMax();
    screen = 'title';
  }

  function writeSave() {
    if (!saveLoaded || !snap) return;
    const state = JSON.parse(JSON.stringify(S));
    savePending = savePending
      .then(() => snap.storage.set('save', state))
      .then(() => true, (e) => { console.warn('Save failed:', e && e.message); return false; });
  }
  const markDirty = () => { dirty = true; };

  let lastSubmitted = 0;
  function submitBest() {
    if (!lbSupported || S.best <= lastSubmitted) return;
    lastSubmitted = S.best;
    snap.leaderboards.submitScore({ score: Math.round(S.best) })
      .catch((e) => console.warn('Leaderboard submit failed:', e && e.message));
  }
  async function showLeaderboard() {
    if (!lbSupported) return;
    try {
      if (S.best > 0) await snap.leaderboards.submitScore({ score: Math.round(S.best) });
      await snap.leaderboards.show();
    } catch (e) { console.warn('Leaderboard unavailable:', e && e.message); }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      writeSave();
      if (screen === 'play' && !overlay) overlay = 'pause';
      holdPointers.clear(); spaceHeld = false;
      if (audio) audio.suspend().catch(() => {});
    } else if (audio && !S.muted) audio.resume().catch(() => {});
  });

  // ---------------------------------------------------------------- audio (synthesised)
  let audio = null, master = null;
  function initAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = S.muted ? 0 : 0.5;
    master.connect(audio.destination);
  }
  function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
    if (!audio || S.muted) return;
    const t0 = audio.currentTime + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  let lastShotSfx = 0;
  const SFX = {
    pop:   () => { tone(520, 0.12, 'triangle', 0.35, 380); },
    merge: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.25, 0, i * 0.06)); },
    shot:  () => { if (time - lastShotSfx < 0.09) return; lastShotSfx = time; tone(880, 0.05, 'sine', 0.06, -300); },
    hit:   () => { tone(180, 0.07, 'square', 0.05, -80); },
    coin:  () => { tone(1320, 0.06, 'sine', 0.08, 300); },
    wave:  () => { tone(392, 0.2, 'triangle', 0.25); tone(587, 0.3, 'triangle', 0.25, 0, 0.15); },
    hurt:  () => { tone(110, 0.25, 'sawtooth', 0.12, -40); },
    buy:   () => { tone(660, 0.08, 'square', 0.12); tone(990, 0.12, 'square', 0.12, 0, 0.07); },
    nope:  () => { tone(200, 0.15, 'square', 0.1, -60); },
    grow:  (p) => { tone(300 + p * 500, 0.04, 'sine', 0.05); },
  };
  function setMuted(m) {
    S.muted = m; markDirty();
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  // ---------------------------------------------------------------- economy / formulas
  const hedgeMax = () => 100 + 30 * S.up.bramble;
  const growTime = () => 1.25 * Math.pow(0.88, S.up.grow);
  const plantDmg = (t) => 5 * Math.pow(2.3, t - 1) * (1 + 0.12 * S.up.sap);
  const plantRate = (t) => 0.9 + 0.1 * t;
  const buyTier = () => Math.max(1, S.found - 2);
  const UPGRADES = [
    { id: 'buy',     name: 'Buy a plant',  desc: () => `Get a ${PLANTS[buyTier()].name} (tier ${buyTier()})`,
      cost: () => Math.round(18 * Math.pow(2.25, buyTier() - 1) * Math.pow(1.06, S.buys)), max: Infinity },
    { id: 'grow',    name: 'Quick Roots',  desc: () => `Grow seeds faster (${growTime().toFixed(2)}s)`,
      cost: () => Math.round(45 * Math.pow(1.6, S.up.grow)), max: 12 },
    { id: 'soil',    name: 'Rich Soil',    desc: () => `${S.up.soil * 8}% chance a seed grows a tier higher`,
      cost: () => Math.round(110 * Math.pow(1.85, S.up.soil)), max: 6 },
    { id: 'sap',     name: 'Wild Sap',     desc: () => `All plants +${S.up.sap * 12}% damage`,
      cost: () => Math.round(70 * Math.pow(1.55, S.up.sap)), max: 40 },
    { id: 'bramble', name: 'Bramble Wall', desc: () => `Hedge health ${hedgeMax()}`,
      cost: () => Math.round(55 * Math.pow(1.5, S.up.bramble)), max: 30 },
  ];

  // ---------------------------------------------------------------- slots / merging
  function placeNew(tier) {
    let i = S.slots.findIndex((v, k) => k < 5 && v === 0);
    if (i < 0) i = S.slots.findIndex((v) => v === 0);
    if (i < 0) return false;
    S.slots[i] = tier;
    discover(tier);
    const sl = SLOTS[i];
    burst(sl.x, sl.y, PLANTS[tier].color, 14);
    popAnim[i] = 1;
    markDirty();
    return true;
  }
  const popAnim = new Array(SLOTS.length).fill(0);

  function discover(tier) {
    if (tier > S.found) {
      S.found = tier;
      banner = { title: 'NEW PLANT!', sub: PLANTS[tier].name + (PERKS[tier] ? ' · ' + PERKS[tier] : ''), t: 2.6, tier };
    }
  }

  function growSeed() {
    let tier = 1;
    if (Math.random() < S.up.soil * 0.08) tier = 2;
    if (placeNew(tier)) {
      SFX.pop();
      if (S.tut === 0) { S.tut = 1; startCountdown(); }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- waves
  function startCountdown() {
    waveState = 'countdown';
    countdown = S.wave === 1 && waveKilled === 0 ? 4 : 3;
  }
  function startWave() {
    waveState = 'running';
    const w = S.wave;
    toSpawn = [];
    const n = 6 + Math.floor(w * 1.6);
    for (let i = 0; i < n; i++) {
      let type = 'slug';
      const r = Math.random();
      if (w >= 2 && r < 0.3) type = 'beetle';
      else if (w >= 3 && r < 0.55) type = 'wasp';
      toSpawn.push(type);
    }
    if (w % 5 === 0) { toSpawn.splice(Math.floor(n / 2), 0, 'mole'); toSpawn.length = Math.max(toSpawn.length - 3, 4); }
    waveTotal = toSpawn.length;
    waveKilled = 0;
    spawnTimer = 0.5;
    SFX.wave();
    banner = { title: 'WAVE ' + w, sub: w % 5 === 0 ? 'The Mole King approaches!' : 'Here they come…', t: 1.8 };
  }
  function spawnEnemy(type) {
    const d = ENEMIES[type];
    const hp = d.hp * Math.pow(1.21, S.wave - 1);
    enemies.push({
      type, x: rand(50, W - 50), y: FIELD_TOP - 30, hp, maxHp: hp, speed: d.speed * rand(0.9, 1.1),
      r: d.r, dps: d.dps * (1 + (S.wave - 1) * 0.08), coin: d.coin, slow: 0, flash: 0,
      wob: rand(0, 6.28), atk: false,
    });
  }
  function waveCleared() {
    waveState = 'idle';
    const bonus = 8 + S.wave * 6;
    S.coins += bonus;
    floaters.push({ x: W / 2, y: 380, txt: `Wave cleared  +${bonus}`, color: '#ffe17a', life: 1.6, size: 30 });
    if (S.wave > S.best) { S.best = S.wave; submitBest(); }
    S.wave++;
    hedgeHp = Math.min(hedgeMax(), hedgeHp + hedgeMax() * 0.35);
    markDirty(); writeSave(); dirty = false;
    startCountdown();
  }
  function hedgeFell() {
    SFX.hurt();
    shake = 0.6;
    enemies = []; shots = []; toSpawn = [];
    banner = { title: 'HEDGE BROKEN!', sub: 'Merge stronger plants and try again', t: 2.6 };
    S.wave = Math.max(1, S.wave - 1);
    hedgeHp = hedgeMax();
    waveState = 'idle';
    markDirty();
    startCountdown();
    countdown = 4;
  }

  // ---------------------------------------------------------------- effects
  function burst(x, y, color, n = 10, sp = 160) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), v = rand(sp * 0.3, sp);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.35, 0.8), max: 0.8, color, r: rand(2, 4.5) });
    }
  }

  // ---------------------------------------------------------------- input
  const holdPointers = new Set();
  let spaceHeld = false;
  let drag = null;               // { from, tier, x, y, id, moved }
  let pointerPos = { x: 0, y: 0 };

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - offX) / scale, y: (e.clientY - r.top - offY) / scale };
  }
  function slotAt(p) {
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      if (Math.abs(p.x - s.x) <= s.s / 2 && Math.abs(p.y - s.y) <= s.s / 2) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    const p = toLogical(e);
    pointerPos = p;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (screen === 'title') { handleTitleTap(p); return; }
    if (screen !== 'play') return;
    if (overlay) { handleOverlayTap(p, e.pointerId); return; }

    if (inRect(p, UI.pause)) { overlay = 'pause'; return; }
    if (inRect(p, UI.mute)) { setMuted(!S.muted); return; }
    if (inRect(p, UI.shop)) { overlay = 'shop'; shopScroll = 0; return; }
    if (waveState === 'countdown' && inRect(p, UI.skip)) { countdown = 0; return; }
    if (inRect(p, UI.trash)) { floaters.push({ x: 64, y: 890, txt: 'Drag here to compost', color: '#fff', life: 1.2, size: 16 }); return; }

    const si = slotAt(p);
    if (si >= 0 && S.slots[si] > 0) {
      drag = { from: si, tier: S.slots[si], x: p.x, y: p.y, id: e.pointerId };
      return;
    }
    // Hold anywhere else (the seed pod, the field, empty slots) to grow.
    holdPointers.add(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toLogical(e);
    pointerPos = p;
    if (drag && drag.id === e.pointerId) { drag.x = p.x; drag.y = p.y; }
    if (overlay === 'shop' && shopDrag && shopDrag.id === e.pointerId) {
      shopScroll = clamp(shopDrag.start + (p.y - shopDrag.y), -shopMaxScroll(), 0);
      if (Math.abs(p.y - shopDrag.y) > 8) shopDrag.moved = true;
    }
  });

  function endPointer(e) {
    holdPointers.delete(e.pointerId);
    if (shopDrag && shopDrag.id === e.pointerId) {
      if (!shopDrag.moved) handleShopTap(shopDrag.p);
      shopDrag = null;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const p = toLogical(e);
    const from = drag.from;
    const to = slotAt(p);
    drag = null;
    if (inRect(p, UI.trash)) {
      const t = S.slots[from];
      const refund = Math.round(4 * Math.pow(2, t - 1));
      S.slots[from] = 0;
      S.coins += refund;
      floaters.push({ x: 64, y: 890, txt: '+' + refund, color: '#ffe17a', life: 1, size: 22 });
      burst(64, 930, '#8a5a3a', 12);
      SFX.coin(); markDirty();
      return;
    }
    if (to < 0 || to === from) return;
    const a = S.slots[from], b = S.slots[to];
    if (b === a && a < MAX_TIER) {
      S.slots[to] = a + 1; S.slots[from] = 0;
      discover(a + 1);
      popAnim[to] = 1;
      burst(SLOTS[to].x, SLOTS[to].y, PLANTS[a + 1].color, 24, 220);
      floaters.push({ x: SLOTS[to].x, y: SLOTS[to].y - 50, txt: 'MERGE!', color: PLANTS[a + 1].color, life: 0.9, size: 22 });
      SFX.merge();
      if (S.tut === 1) S.tut = 2;
    } else {
      S.slots[to] = a; S.slots[from] = b;
      popAnim[to] = 0.6;
    }
    markDirty();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      initAudio();
      if (screen === 'title') { startPlay(); return; }
      if (!overlay) spaceHeld = true;
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (screen === 'play') overlay = overlay ? null : 'pause';
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });
  window.addEventListener('blur', () => { spaceHeld = false; holdPointers.clear(); });

  // ---------------------------------------------------------------- title / overlays
  const TITLE_BTNS = {
    play: { x: 140, y: 650, w: 260, h: 70 },
    lb:   { x: 160, y: 740, w: 220, h: 54 },
  };
  function handleTitleTap(p) {
    if (lbSupported && inRect(p, TITLE_BTNS.lb)) { showLeaderboard(); return; }
    startPlay();
  }
  function startPlay() {
    screen = 'play';
    if (S.tut > 0 && waveState === 'idle') startCountdown();
  }

  const PAUSE_BTNS = {
    resume: { x: 150, y: 470, w: 240, h: 62 },
    sound:  { x: 150, y: 548, w: 240, h: 54 },
    lb:     { x: 150, y: 618, w: 240, h: 54 },
  };
  let shopDrag = null;
  const SHOP = { x: 24, y: 120, w: 492, h: 740, close: { x: 456, y: 128, w: 52, h: 52 }, listTop: 290, rowH: 92 };
  const shopMaxScroll = () => Math.max(0, UPGRADES.length * SHOP.rowH + 20 - (SHOP.y + SHOP.h - SHOP.listTop));

  function handleOverlayTap(p, id) {
    if (overlay === 'pause') {
      if (inRect(p, PAUSE_BTNS.resume)) overlay = null;
      else if (inRect(p, PAUSE_BTNS.sound)) setMuted(!S.muted);
      else if (lbSupported && inRect(p, PAUSE_BTNS.lb)) showLeaderboard();
      return;
    }
    if (overlay === 'shop') {
      if (inRect(p, SHOP.close) || !inRect(p, SHOP)) { overlay = null; writeSave(); return; }
      shopDrag = { id, y: p.y, start: shopScroll, p, moved: false };
    }
  }

  function handleShopTap(p) {
    for (let i = 0; i < UPGRADES.length; i++) {
      const y = SHOP.listTop + i * SHOP.rowH + shopScroll;
      const btn = { x: SHOP.x + SHOP.w - 150, y: y + 18, w: 130, h: 54 };
      if (y < SHOP.listTop - 40 || y > SHOP.y + SHOP.h - 40) continue;
      if (!inRect(p, btn)) continue;
      const u = UPGRADES[i];
      const lvl = u.id === 'buy' ? 0 : S.up[u.id];
      const cost = u.cost();
      if (lvl >= u.max || S.coins < cost) { SFX.nope(); return; }
      if (u.id === 'buy') {
        if (!placeNew(buyTier())) { SFX.nope(); floaters.push({ x: W / 2, y: 260, txt: 'Garden is full!', color: '#ff9ab3', life: 1.2, size: 22 }); return; }
        S.buys++;
      } else {
        S.up[u.id]++;
        if (u.id === 'bramble') hedgeHp += 30;
      }
      S.coins -= cost;
      SFX.buy();
      markDirty();
      return;
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    time += dt;
    for (let i = 0; i < popAnim.length; i++) popAnim[i] = Math.max(0, popAnim[i] - dt * 3);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    shake = Math.max(0, shake - dt);

    if (dirty) { saveTimer += dt; if (saveTimer > 4) { saveTimer = 0; dirty = false; writeSave(); } }

    updateParticles(dt);
    if (screen !== 'play' || overlay) return;

    // Grow
    const holding = spaceHeld || holdPointers.size > 0;
    const hasRoom = S.slots.some((v) => v === 0);
    if (holding && hasRoom) {
      const before = growMeter;
      growMeter += dt / growTime();
      if (Math.floor(before * 6) !== Math.floor(growMeter * 6)) SFX.grow(growMeter);
      if (growMeter >= 1) { growMeter = 0; growSeed(); }
    } else if (!holding) {
      growMeter = Math.max(0, growMeter - dt * 0.6);
    }

    // Waves
    if (waveState === 'countdown') {
      countdown -= dt;
      if (countdown <= 0) startWave();
    } else if (waveState === 'running') {
      spawnTimer -= dt;
      if (toSpawn.length && spawnTimer <= 0) {
        spawnEnemy(toSpawn.shift());
        spawnTimer = Math.max(0.35, 1.35 - S.wave * 0.035) * rand(0.6, 1.3);
      }
      if (!toSpawn.length && !enemies.length) waveCleared();
    }

    // Enemies
    for (const en of enemies) {
      en.flash = Math.max(0, en.flash - dt * 6);
      en.slow = Math.max(0, en.slow - dt);
      const sp = en.speed * (en.slow > 0 ? 0.55 : 1);
      const stopY = HEDGE_Y - en.r * 0.55;
      if (en.y < stopY) {
        en.y = Math.min(stopY, en.y + sp * dt);
        if (en.type === 'wasp') en.x = clamp(en.x + Math.sin(time * 4 + en.wob) * 70 * dt, 30, W - 30);
        en.atk = false;
      } else {
        en.atk = true;
        hedgeHp -= en.dps * dt;
        if (Math.random() < dt * 2) { burst(en.x, HEDGE_Y, '#6b8f3a', 3, 90); }
      }
    }
    if (hedgeHp <= 0) { hedgeFell(); return; }

    // Plants fire
    for (let i = 0; i < 5; i++) {
      const t = S.slots[i];
      cooldowns[i] -= dt;
      if (!t || cooldowns[i] > 0 || !enemies.length) continue;
      if (drag && drag.from === i) continue;
      // Plants reach up the meadow; longer for higher tiers.
      const reachY = HEDGE_Y - 300 - t * 18;
      let target = null;
      for (const en of enemies) if (!target || en.y > target.y) target = en;
      if (!target || target.y < reachY) continue;
      cooldowns[i] = 1 / plantRate(t);
      const s = SLOTS[i];
      shots.push({ x: s.x, y: s.y - 44, target, tier: t, dmg: plantDmg(t), vx: 0, vy: -500 });
      SFX.shot();
    }

    // Shots
    for (const sh of shots) {
      if (sh.target && sh.target.hp > 0) {
        const dx = sh.target.x - sh.x, dy = sh.target.y - sh.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 560 + sh.tier * 20;
        sh.vx = dx / d * sp; sh.vy = dy / d * sp;
        if (d < sh.target.r + 6) { hitEnemy(sh.target, sh); sh.dead = true; continue; }
      }
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      if (sh.y < 0 || sh.x < -20 || sh.x > W + 20 || sh.y > H) sh.dead = true;
    }
    shots = shots.filter((s) => !s.dead);

    // Coins flying to the coin counter
    for (const c of flyCoins) {
      c.t += dt * 1.6;
      if (c.t >= 1) { c.dead = true; S.coins += c.v; SFX.coin(); }
    }
    flyCoins = flyCoins.filter((c) => !c.dead);
  }

  function hitEnemy(en, sh) {
    damage(en, sh.dmg, sh.tier);
    burst(sh.x, sh.y, PLANTS[sh.tier].shot, 5, 110);
    if (sh.tier >= 5) {
      const rad = sh.tier >= 9 ? 90 : 55;
      for (const o of enemies) {
        if (o !== en && Math.hypot(o.x - en.x, o.y - en.y) < rad + o.r) damage(o, sh.dmg * 0.5, sh.tier);
      }
      parts.push({ ring: true, x: en.x, y: en.y, r: 4, max: rad, life: 0.3, color: PLANTS[sh.tier].shot });
    }
    if (sh.tier >= 7) en.slow = 1.6;
  }

  function damage(en, dmg, tier) {
    if (en.hp <= 0) return;
    en.hp -= dmg;
    en.flash = 1;
    floaters.push({ x: en.x + rand(-10, 10), y: en.y - en.r - 6, txt: fmt(dmg), color: PLANTS[tier].shot, life: 0.6, size: 18, vy: -50 });
    if (Math.random() < 0.3) SFX.hit();
    if (en.hp <= 0) {
      waveKilled++;
      burst(en.x, en.y, en.type === 'mole' ? '#c38a5a' : '#d8e36a', en.type === 'mole' ? 40 : 14, 200);
      const v = Math.max(1, Math.round(en.coin * 3 * Math.pow(1.14, S.wave - 1)));
      const n = Math.min(6, 1 + Math.floor(v / 4));
      for (let k = 0; k < n; k++) {
        flyCoins.push({ sx: en.x + rand(-14, 14), sy: en.y + rand(-14, 14), t: -k * 0.06, v: Math.floor(v / n) + (k < v % n ? 1 : 0) });
      }
      en.dead = true;
      enemies = enemies.filter((e) => !e.dead);
    }
  }

  function updateParticles(dt) {
    for (const p of parts) {
      p.life -= dt;
      if (p.ring) { p.r += (p.max - p.r) * Math.min(1, dt * 14); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.vy += 120 * dt;
    }
    parts = parts.filter((p) => p.life > 0);
    for (const f of floaters) { f.life -= dt; f.y += (f.vy || -30) * dt; }
    floaters = floaters.filter((f) => f.life > 0);
    for (const ff of fireflies) {
      ff.a += dt * ff.s;
      ff.x += Math.cos(ff.a) * 14 * dt; ff.y += Math.sin(ff.a * 1.3) * 10 * dt;
      if (ff.x < 0) ff.x = W; if (ff.x > W) ff.x = 0;
    }
  }

  // ---------------------------------------------------------------- drawing helpers
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function text(str, x, y, size, color = '#fff', align = 'center', stroke = true) {
    ctx.font = `900 ${size}px "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size / 5);
      ctx.strokeStyle = 'rgba(14,10,40,0.85)';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function panel(x, y, w, h, fill = '#2a2266', edge = '#7d6bff', r = 16) {
    rr(x, y + 4, w, h, r); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    rr(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = edge; ctx.stroke();
  }
  function button(r, label, fill, edge, size = 24, enabled = true) {
    ctx.globalAlpha = enabled ? 1 : 0.45;
    rr(r.x, r.y + 5, r.w, r.h, 14); ctx.fillStyle = edge; ctx.fill();
    rr(r.x, r.y, r.w, r.h, 14); ctx.fillStyle = fill; ctx.fill();
    rr(r.x + 6, r.y + 4, r.w - 12, r.h * 0.38, 10); ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
    text(label, r.x + r.w / 2, r.y + r.h / 2 + 1, size);
    ctx.globalAlpha = 1;
  }
  function leaf(x, y, len, wid, ang, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
    ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- background (pre-rendered)
  const fireflies = Array.from({ length: 18 }, () => ({ x: rand(0, W), y: rand(FIELD_TOP, HEDGE_Y - 20), a: rand(0, 6.28), s: rand(0.4, 1.2), p: rand(0, 6.28) }));
  function buildBackground() {
    const k = scale * dpr;
    bg = document.createElement('canvas');
    bg.width = Math.max(1, Math.round(W * k));
    bg.height = Math.max(1, Math.round(H * k));
    const g = bg.getContext('2d');
    g.scale(k, k);
    // night sky
    let gr = g.createLinearGradient(0, 0, 0, 260);
    gr.addColorStop(0, '#0b1030'); gr.addColorStop(1, '#2b2a6e');
    g.fillStyle = gr; g.fillRect(0, 0, W, 260);
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = rand(0.3, 1);
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(rand(0, W), rand(0, 200), rand(0.6, 1.8), 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // moon
    g.fillStyle = 'rgba(255,248,220,0.12)'; g.beginPath(); g.arc(440, 150, 70, 0, 7); g.fill();
    g.fillStyle = '#fff4cf'; g.beginPath(); g.arc(440, 150, 40, 0, 7); g.fill();
    g.fillStyle = '#e9dcae'; g.beginPath(); g.arc(428, 140, 8, 0, 7); g.arc(452, 162, 5, 0, 7); g.fill();
    // distant hills & trees
    g.fillStyle = '#1d2a5a';
    g.beginPath(); g.moveTo(0, 230);
    for (let x = 0; x <= W; x += 30) g.lineTo(x, 200 + Math.sin(x * 0.018) * 22 + Math.sin(x * 0.05) * 8);
    g.lineTo(W, 260); g.lineTo(0, 260); g.fill();
    g.fillStyle = '#16244a';
    for (let x = 10; x < W; x += rand(28, 50)) {
      const h = rand(30, 60);
      g.beginPath(); g.moveTo(x, 240); g.lineTo(x + 14, 240 - h); g.lineTo(x + 28, 240); g.fill();
    }
    // garden meadow
    gr = g.createLinearGradient(0, 230, 0, HEDGE_Y);
    gr.addColorStop(0, '#1f4a3c'); gr.addColorStop(1, '#2d6b45');
    g.fillStyle = gr; g.fillRect(0, 236, W, HEDGE_Y - 236);
    // path stones & mushrooms
    for (let i = 0; i < 26; i++) {
      const x = rand(10, W - 10), y = rand(260, HEDGE_Y - 30);
      g.fillStyle = 'rgba(10,30,25,0.35)';
      g.beginPath(); g.ellipse(x, y, rand(10, 24), rand(5, 9), 0, 0, 7); g.fill();
    }
    for (let i = 0; i < 90; i++) {
      const x = rand(0, W), y = rand(250, HEDGE_Y - 10);
      g.strokeStyle = `rgba(120,220,140,${rand(0.25, 0.6)})`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y - 8); g.moveTo(x, y); g.lineTo(x + 3, y - 9); g.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const x = rand(20, W - 20), y = rand(280, HEDGE_Y - 40);
      g.fillStyle = '#e8e2ff'; g.fillRect(x - 2, y - 8, 4, 9);
      g.fillStyle = ['#ff6fb5', '#6fd3ff', '#b58cff'][i % 3];
      g.beginPath(); g.arc(x, y - 8, 7, Math.PI, 0); g.fill();
    }
    // lower garden (soil beds)
    gr = g.createLinearGradient(0, HEDGE_Y, 0, H);
    gr.addColorStop(0, '#2a1d3f'); gr.addColorStop(1, '#170f29');
    g.fillStyle = gr; g.fillRect(0, HEDGE_Y + 20, W, H - HEDGE_Y);
    // storage bed
    g.fillStyle = '#3b2a56';
    g.beginPath(); g.roundRect ? g.roundRect(182, 722, 346, 186, 18) : g.rect(182, 722, 346, 186); g.fill();
    g.strokeStyle = '#6d55a8'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#b9a6ff'; g.font = '900 13px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('SEED TRAY', 355, 734);
    // bottom bar
    g.fillStyle = '#120b22'; g.fillRect(0, 900, W, H - 900);
    g.fillStyle = '#4b3a86'; g.fillRect(0, 900, W, 3);
  }

  function drawHedge() {
    const y = HEDGE_Y;
    ctx.fillStyle = '#183d27';
    ctx.fillRect(0, y - 4, W, 28);
    for (let x = -10; x < W + 20; x += 22) {
      const bob = Math.sin(time * 1.5 + x) * 1.5;
      ctx.fillStyle = (x / 22) % 2 ? '#2f7a43' : '#256a3a';
      ctx.beginPath(); ctx.arc(x, y + 2 + bob, 17, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff6fb5';
      if ((x / 22) % 3 === 0) { ctx.beginPath(); ctx.arc(x + 4, y - 6 + bob, 3.5, 0, 7); ctx.fill(); }
    }
    // thorns
    ctx.fillStyle = '#c9f0a0';
    for (let x = 6; x < W; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x + 4, y - 22); ctx.lineTo(x + 8, y - 10); ctx.fill();
    }
    // HP bar
    const f = clamp(hedgeHp / hedgeMax(), 0, 1);
    rr(150, y - 44, 240, 16, 8); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    if (f > 0) { rr(152, y - 42, 236 * f, 12, 6); ctx.fillStyle = f > 0.5 ? '#6dff8a' : f > 0.25 ? '#ffd166' : '#ff5470'; ctx.fill(); }
    text('HEDGE ' + Math.ceil(Math.max(0, hedgeHp)) + ' / ' + hedgeMax(), W / 2, y - 36, 11);
  }

  // ---------------------------------------------------------------- plants
  function drawPlant(t, x, y, s, phase = 0, glow = true) {
    const P = PLANTS[t];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // pot
    ctx.fillStyle = '#7a3f5f';
    ctx.beginPath(); ctx.moveTo(-19, 8); ctx.lineTo(19, 8); ctx.lineTo(14, 30); ctx.lineTo(-14, 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9b5479'; rr(-22, 2, 44, 10, 4); ctx.fill();
    ctx.fillStyle = '#3a2340'; ctx.beginPath(); ctx.ellipse(0, 4, 18, 3.5, 0, 0, 7); ctx.fill();
    ctx.rotate(Math.sin(time * 2 + phase) * 0.05);

    if (glow && t >= 6) {
      ctx.fillStyle = P.color + '33';
      ctx.beginPath(); ctx.arc(0, -36, 34 + Math.sin(time * 3 + phase) * 3, 0, 7); ctx.fill();
    }
    const stem = (h, c = '#3f9a4a') => { ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 4); ctx.quadraticCurveTo(-3, -h / 2, 0, -h); ctx.stroke(); };

    switch (t) {
      case 1:
        stem(22);
        leaf(0, -20, 18, 8, -2.6, P.color);
        leaf(0, -20, 18, 8, -0.5, P.color);
        break;
      case 2:
        stem(26);
        leaf(0, -8, 14, 6, -2.4, '#2f9a55');
        ctx.fillStyle = P.color;
        for (const [dx, dy] of [[0, -38], [-9, -29], [9, -29]]) { ctx.beginPath(); ctx.arc(dx, dy, 8, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#b8ffd0'; ctx.beginPath(); ctx.arc(0, -31, 3, 0, 7); ctx.fill();
        break;
      case 3:
        ctx.strokeStyle = '#3f9a4a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 4); ctx.quadraticCurveTo(-4, -30, 12, -40); ctx.stroke();
        leaf(0, -6, 16, 6, -2.2, '#3f9a4a');
        ctx.fillStyle = P.color;
        for (const [bx, by] of [[12, -30], [-4, -24]]) {
          ctx.beginPath(); ctx.moveTo(bx - 9, by + 10); ctx.quadraticCurveTo(bx - 9, by - 6, bx, by - 6);
          ctx.quadraticCurveTo(bx + 9, by - 6, bx + 9, by + 10); ctx.lineTo(bx + 5, by + 7); ctx.lineTo(bx, by + 11); ctx.lineTo(bx - 5, by + 7); ctx.closePath(); ctx.fill();
        }
        break;
      case 4:
        stem(30, '#2f7a3a');
        ctx.fillStyle = '#d8f0b0';
        for (const ty of [-8, -18]) { ctx.beginPath(); ctx.moveTo(1, ty); ctx.lineTo(7, ty - 3); ctx.lineTo(1, ty - 5); ctx.fill(); }
        leaf(0, -14, 15, 6, -2.5, '#2f7a3a');
        ctx.fillStyle = '#b8224a'; ctx.beginPath(); ctx.arc(0, -38, 14, 0, 7); ctx.fill();
        ctx.fillStyle = P.color; ctx.beginPath(); ctx.arc(0, -39, 11, 0, 7); ctx.fill();
        ctx.strokeStyle = '#9a1a3c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -39, 6, 0.5, 5.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(1, -40, 2.5, 0, 4); ctx.stroke();
        break;
      case 5:
        ctx.fillStyle = P.color; rr(-10, -48, 20, 54, 10); ctx.fill();
        rr(-24, -34, 12, 22, 6); ctx.fill(); rr(-16, -18, 8, 8, 3); ctx.fill();
        rr(12, -40, 12, 20, 6); ctx.fill(); rr(8, -26, 8, 8, 3); ctx.fill();
        ctx.strokeStyle = '#1f8a66'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(0, 4); ctx.stroke();
        ctx.fillStyle = '#ffe8a0';
        for (let i = 0; i < 6; i++) { ctx.fillRect(-12, -40 + i * 8, 3, 1.5); ctx.fillRect(9, -38 + i * 8, 3, 1.5); }
        ctx.fillStyle = '#ffe14d';
        for (let i = 0; i < 5; i++) { const a = i * 1.2566 - 1.57; ctx.beginPath(); ctx.arc(Math.cos(a) * 5, -52 + Math.sin(a) * 5, 3.5, 0, 7); ctx.fill(); }
        break;
      case 6:
        stem(30);
        leaf(0, -12, 16, 7, -2.6, '#3f9a4a'); leaf(0, -16, 16, 7, -0.5, '#3f9a4a');
        ctx.fillStyle = P.color;
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6 + time * 0.3;
          ctx.save(); ctx.translate(0, -40); ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(13, 0, 8, 3.6, 0, 0, 7); ctx.fill(); ctx.restore();
        }
        ctx.fillStyle = '#6b3d1e'; ctx.beginPath(); ctx.arc(0, -40, 9, 0, 7); ctx.fill();
        ctx.fillStyle = '#3d220f';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(Math.cos(i) * 4, -40 + Math.sin(i * 2) * 4, 1.2, 0, 7); ctx.fill(); }
        break;
      case 7:
        stem(28, '#5fb0a0');
        ctx.fillStyle = P.color;
        for (let i = 0; i < 6; i++) {
          ctx.save(); ctx.translate(0, -38); ctx.rotate(i * Math.PI / 3);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, -8); ctx.lineTo(0, -19); ctx.lineTo(-5, -8); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, -38, 5, 0, 7); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) { const a = time + i * 2.1; ctx.beginPath(); ctx.arc(Math.cos(a) * 24, -38 + Math.sin(a) * 18, 1.6, 0, 7); ctx.stroke(); }
        break;
      case 8: {
        stem(24, '#4a8a3a');
        leaf(0, -8, 16, 6, -2.4, '#4a8a3a');
        const open = 0.15 + Math.abs(Math.sin(time * 2.4 + phase)) * 0.35;
        ctx.save(); ctx.translate(0, -24);
        for (const dir of [-1, 1]) {
          ctx.save(); ctx.scale(dir, 1); ctx.rotate(open);
          ctx.fillStyle = P.color;
          ctx.beginPath(); ctx.ellipse(2, -14, 12, 16, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ff7ab8';
          ctx.beginPath(); ctx.ellipse(2, -14, 7, 11, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff';
          for (let k = 0; k < 4; k++) { const ty = -26 + k * 7; ctx.beginPath(); ctx.moveTo(2, ty); ctx.lineTo(-4, ty + 2.5); ctx.lineTo(2, ty + 5); ctx.fill(); }
          ctx.restore();
        }
        ctx.restore();
        break;
      }
      case 9: {
        stem(28, '#7d8bd0');
        ctx.fillStyle = 'rgba(232,226,255,0.35)';
        ctx.beginPath(); ctx.arc(0, -40, 26, 0, 7); ctx.fill();
        for (let i = 0; i < 8; i++) {
          ctx.save(); ctx.translate(0, -40); ctx.rotate(i * Math.PI / 4 + time * 0.5);
          ctx.fillStyle = i % 2 ? '#c9bfff' : P.color;
          ctx.beginPath(); ctx.ellipse(0, -13, 6, 12, 0, 0, 7); ctx.fill(); ctx.restore();
        }
        ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(0, -40, 9, 0, 7); ctx.fill();
        ctx.fillStyle = '#c9bfff'; ctx.beginPath(); ctx.arc(4, -43, 7, 0, 7); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  function drawSlots() {
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      const half = s.s / 2;
      const highlight = drag && slotAt({ x: drag.x, y: drag.y }) === i && drag.from !== i;
      const canMerge = highlight && S.slots[i] === drag.tier && drag.tier < MAX_TIER;
      rr(s.x - half, s.y - half, s.s, s.s, 16);
      ctx.fillStyle = s.pot ? 'rgba(70,40,30,0.75)' : 'rgba(25,15,45,0.7)';
      ctx.fill();
      ctx.lineWidth = highlight ? 4 : 2;
      ctx.strokeStyle = canMerge ? '#7dff9a' : highlight ? '#ffffff' : s.pot ? '#b07a4a' : '#5a4790';
      ctx.stroke();
      if (s.pot && !S.slots[i]) {
        ctx.fillStyle = 'rgba(255,220,180,0.25)';
        ctx.beginPath(); ctx.moveTo(s.x - 10, s.y + 6); ctx.lineTo(s.x, s.y - 8); ctx.lineTo(s.x + 10, s.y + 6); ctx.fill();
      }
      const t = S.slots[i];
      if (!t || (drag && drag.from === i)) continue;
      const pop = popAnim[i];
      const sc = (s.pot ? 1.05 : 0.92) * (1 + pop * 0.35);
      drawPlant(t, s.x, s.y + 4, sc, i);
      // tier badge
      rr(s.x - half + 4, s.y - half + 4, 24, 22, 7); ctx.fillStyle = PLANTS[t].color; ctx.fill();
      text(String(t), s.x - half + 16, s.y - half + 16, 14, '#1a1033', 'center', false);
      if (canMerge) text('+', s.x + half - 14, s.y - half + 14, 22, '#7dff9a');
    }
  }

  // ---------------------------------------------------------------- enemies
  function drawEnemy(en) {
    ctx.save();
    ctx.translate(en.x, en.y);
    const bob = en.atk ? Math.sin(time * 18) * 3 : Math.sin(time * 6 + en.wob) * 2;
    ctx.translate(0, bob);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, en.r * 0.8, en.r * 0.9, en.r * 0.3, 0, 0, 7); ctx.fill();
    const fl = en.flash > 0;
    switch (en.type) {
      case 'slug': {
        ctx.fillStyle = fl ? '#fff' : '#d8e36a';
        ctx.beginPath(); ctx.ellipse(0, 0, en.r * 0.65, en.r, 0, 0, 7); ctx.fill();
        ctx.fillStyle = fl ? '#fff' : '#a8b843';
        for (const [dx, dy] of [[-5, -8], [4, -2], [-3, 6]]) { ctx.beginPath(); ctx.arc(dx, dy, 3, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#d8e36a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-4, en.r - 4); ctx.lineTo(-8, en.r + 8); ctx.moveTo(4, en.r - 4); ctx.lineTo(8, en.r + 8); ctx.stroke();
        ctx.fillStyle = '#1a1033'; ctx.beginPath(); ctx.arc(-8, en.r + 9, 3, 0, 7); ctx.arc(8, en.r + 9, 3, 0, 7); ctx.fill();
        break;
      }
      case 'beetle': {
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
        const lg = Math.sin(time * 14 + en.wob) * 4;
        for (const k of [-1, 1]) for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(k * 10, i * 8); ctx.lineTo(k * 24, i * 10 + (i % 2 ? lg : -lg)); ctx.stroke();
        }
        ctx.fillStyle = fl ? '#fff' : '#3b4bd8';
        ctx.beginPath(); ctx.ellipse(0, -2, en.r * 0.75, en.r * 0.85, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(-6, -8, 4, 8, 0.3, 0, 7); ctx.fill();
        ctx.strokeStyle = '#1d2580'; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, 16); ctx.stroke();
        ctx.fillStyle = '#16163a'; ctx.beginPath(); ctx.arc(0, en.r * 0.8, 9, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff5470'; ctx.beginPath(); ctx.arc(-4, en.r * 0.85, 2, 0, 7); ctx.arc(4, en.r * 0.85, 2, 0, 7); ctx.fill();
        break;
      }
      case 'wasp': {
        const flap = Math.sin(time * 40) * 0.5;
        ctx.fillStyle = 'rgba(220,240,255,0.7)';
        ctx.beginPath(); ctx.ellipse(-12, -6, 12, 6, -0.6 + flap, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(12, -6, 12, 6, 0.6 - flap, 0, 7); ctx.fill();
        ctx.fillStyle = fl ? '#fff' : '#ffb21e';
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 16, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#1a1033';
        ctx.fillRect(-9, -6, 18, 3.5); ctx.fillRect(-9, 1, 18, 3.5);
        ctx.beginPath(); ctx.moveTo(-3, -15); ctx.lineTo(0, -22); ctx.lineTo(3, -15); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 14, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff5470'; ctx.beginPath(); ctx.arc(-2.5, 16, 1.6, 0, 7); ctx.arc(2.5, 16, 1.6, 0, 7); ctx.fill();
        break;
      }
      case 'mole': {
        ctx.fillStyle = fl ? '#fff' : '#7a4a2e';
        ctx.beginPath(); ctx.arc(0, 0, en.r, 0, 7); ctx.fill();
        ctx.fillStyle = '#9b6a48'; ctx.beginPath(); ctx.ellipse(0, 12, en.r * 0.6, en.r * 0.5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff9ab3'; ctx.beginPath(); ctx.arc(0, en.r * 0.62, 9, 0, 7); ctx.fill();
        ctx.fillStyle = '#1a1033'; ctx.beginPath(); ctx.arc(-13, 8, 3.5, 0, 7); ctx.arc(13, 8, 3.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#f2d6b3';
        for (const k of [-1, 1]) for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.ellipse(k * (en.r * 0.8) + k * i * 3, en.r * 0.6 + i * 5, 4, 9, k * 0.4, 0, 7); ctx.fill();
        }
        // crown
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath(); ctx.moveTo(-18, -en.r + 8); ctx.lineTo(-18, -en.r - 10); ctx.lineTo(-9, -en.r - 2); ctx.lineTo(0, -en.r - 14);
        ctx.lineTo(9, -en.r - 2); ctx.lineTo(18, -en.r - 10); ctx.lineTo(18, -en.r + 8); ctx.closePath(); ctx.fill();
        break;
      }
    }
    if (en.slow > 0) { ctx.strokeStyle = 'rgba(160,240,255,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, en.r + 4, 0, 7); ctx.stroke(); }
    ctx.restore();
    // hp bar
    if (en.hp < en.maxHp) {
      const w = en.r * 1.8, f = clamp(en.hp / en.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(en.x - w / 2, en.y - en.r - 14, w, 6);
      ctx.fillStyle = '#ff5470'; ctx.fillRect(en.x - w / 2 + 1, en.y - en.r - 13, (w - 2) * f, 4);
    }
  }

  // ---------------------------------------------------------------- HUD
  function drawPod() {
    const holding = spaceHeld || holdPointers.size > 0;
    const full = !S.slots.some((v) => v === 0);
    const { x, y, r } = POD;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.8, r * 0.9, 12, 0, 0, 7); ctx.fill();
    const gr = ctx.createRadialGradient(x - 15, y - 20, 5, x, y, r);
    gr.addColorStop(0, holding ? '#6a4fd8' : '#4b3a9c'); gr.addColorStop(1, '#211650');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#8f7bff'; ctx.stroke();
    // growth ring
    ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(x, y, r - 9, 0, 7); ctx.stroke();
    if (growMeter > 0) {
      ctx.strokeStyle = '#7dff9a';
      ctx.beginPath(); ctx.arc(x, y, r - 9, -Math.PI / 2, -Math.PI / 2 + growMeter * Math.PI * 2); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // seed sprouting with the meter
    const g = growMeter;
    ctx.fillStyle = '#3a2340'; ctx.beginPath(); ctx.ellipse(x, y + 18, 26, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#c99a5b'; ctx.beginPath(); ctx.ellipse(x, y + 14 - g * 4, 9, 12, 0, 0, 7); ctx.fill();
    if (g > 0.1) {
      const h = g * 34;
      ctx.strokeStyle = '#6fd36f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 6 - h); ctx.stroke();
      leaf(x, y + 6 - h, 8 + g * 10, 3 + g * 4, -2.6, '#8ef07a');
      leaf(x, y + 6 - h, 8 + g * 10, 3 + g * 4, -0.5, '#8ef07a');
    }
    text(full ? 'GARDEN FULL' : holding ? 'GROWING…' : 'HOLD TO GROW', x, y + r + 16, 13, full ? '#ff9ab3' : '#ffffff');
  }

  function drawHUD() {
    // wave panel
    const wp = UI.wave;
    panel(wp.x, wp.y, wp.w, wp.h, '#241c5c', '#8f7bff');
    text('WAVE ' + S.wave, wp.x + wp.w / 2, wp.y + 20, 22);
    let prog = 0;
    if (waveState === 'running') prog = waveTotal ? waveKilled / waveTotal : 0;
    rr(wp.x + 14, wp.y + 38, wp.w - 28, 12, 6); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    if (prog > 0) { rr(wp.x + 15, wp.y + 39, (wp.w - 30) * prog, 10, 5); ctx.fillStyle = '#ffd166'; ctx.fill(); }

    if (waveState === 'countdown') {
      button(UI.skip, 'GO ' + Math.ceil(countdown), '#ff6fb5', '#a8326f', 20);
    }
    button(UI.mute, '', '#3b2f86', '#1e1650', 1);
    drawSpeaker(UI.mute.x + 25, UI.mute.y + 25, S.muted);
    button(UI.pause, '', '#3b2f86', '#1e1650', 1);
    ctx.fillStyle = '#fff'; ctx.fillRect(UI.pause.x + 17, UI.pause.y + 14, 6, 22); ctx.fillRect(UI.pause.x + 28, UI.pause.y + 14, 6, 22);

    // bottom bar
    const tr = UI.trash;
    const overTrash = drag && inRect({ x: drag.x, y: drag.y }, tr);
    button(tr, '', overTrash ? '#b0485f' : '#5a2e3d', '#2c141e', 1);
    drawBin(tr.x + 30, tr.y + 22);
    text('SELL', tr.x + 68, tr.y + 23, 15);

    const cp = UI.coins;
    panel(cp.x, cp.y, cp.w, cp.h, '#1e1640', '#ffd166', 22);
    drawCoin(cp.x + 24, cp.y + 22, 12);
    text(fmt(S.coins), cp.x + 50, cp.y + 23, 22, '#ffe17a', 'left');

    const sp = UI.shop;
    const affordable = UPGRADES.some((u) => (u.id === 'buy' || S.up[u.id] < u.max) && S.coins >= u.cost());
    button(sp, 'SHOP', '#2fbf8f', '#16664c', 22);
    if (affordable) { ctx.fillStyle = '#ff5470'; ctx.beginPath(); ctx.arc(sp.x + sp.w - 6, sp.y + 4, 8, 0, 7); ctx.fill(); }

    text('BEST ' + S.best, 345, 932, 14, '#b9a6ff');
  }

  function drawCoin(x, y, r) {
    ctx.fillStyle = '#c98a1b'; ctx.beginPath(); ctx.arc(x, y + 1.5, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3a8'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, 7); ctx.fill();
  }
  function drawBin(x, y) {
    ctx.fillStyle = '#ffd7e0';
    ctx.fillRect(x - 10, y - 9, 20, 3);
    ctx.fillRect(x - 3, y - 12, 6, 3);
    ctx.beginPath(); ctx.moveTo(x - 8, y - 5); ctx.lineTo(x + 8, y - 5); ctx.lineTo(x + 6, y + 12); ctx.lineTo(x - 6, y + 12); ctx.fill();
  }
  function drawSpeaker(x, y, muted) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(x - 12, y - 5); ctx.lineTo(x - 5, y - 5); ctx.lineTo(x + 3, y - 12); ctx.lineTo(x + 3, y + 12); ctx.lineTo(x - 5, y + 5); ctx.lineTo(x - 12, y + 5); ctx.fill();
    ctx.strokeStyle = muted ? '#ff5470' : '#fff'; ctx.lineWidth = 3;
    ctx.beginPath();
    if (muted) { ctx.moveTo(x + 7, y - 6); ctx.lineTo(x + 15, y + 6); ctx.moveTo(x + 15, y - 6); ctx.lineTo(x + 7, y + 6); }
    else { ctx.arc(x + 4, y, 9, -0.8, 0.8); }
    ctx.stroke();
  }

  function drawTutorial() {
    if (S.tut === 0) {
      const b = Math.sin(time * 5) * 6;
      panel(60, 440, 420, 90, '#241c5c', '#7dff9a', 18);
      text('HOLD mouse, finger or SPACE', W / 2, 470, 22, '#ffffff');
      text('to grow your first seed!', W / 2, 502, 22, '#7dff9a');
      ctx.fillStyle = '#7dff9a';
      ctx.beginPath(); ctx.moveTo(POD.x - 12, POD.y - POD.r - 18 + b); ctx.lineTo(POD.x + 12, POD.y - POD.r - 18 + b); ctx.lineTo(POD.x, POD.y - POD.r - 4 + b); ctx.fill();
    } else if (S.tut === 1) {
      const counts = {};
      for (const v of S.slots) if (v) counts[v] = (counts[v] || 0) + 1;
      if (Object.values(counts).some((c) => c >= 2)) {
        text('Drag a plant onto a matching one to MERGE!', W / 2, 560, 18, '#7dff9a');
      }
    }
  }

  // ---------------------------------------------------------------- screens
  function drawTitle() {
    ctx.fillStyle = 'rgba(8,6,28,0.55)'; ctx.fillRect(-W, -H, W * 3, H * 3);
    const bob = Math.sin(time * 2) * 6;
    text('BLOOM', W / 2, 270 + bob, 78, '#8ef07a');
    text('GUARD', W / 2, 345 + bob, 78, '#ff6fb5');
    text('Grow · Merge · Defend the garden', W / 2, 410, 20, '#e8e2ff');
    for (let i = 1; i <= 5; i++) drawPlant(i * 2 - 1 > 9 ? 9 : i * 2 - 1, 70 + (i - 1) * 100, 520, 0.9 + (i === 3 ? 0.3 : 0), i);
    button(TITLE_BTNS.play, 'PLAY', '#2fbf8f', '#16664c', 34);
    if (lbSupported) button(TITLE_BTNS.lb, 'LEADERBOARD', '#7d6bff', '#3b2f86', 20);
    text('Best wave: ' + S.best, W / 2, 830, 18, '#b9a6ff');
    text('Hold to grow  ·  Drag matching plants to merge', W / 2, 870, 14, '#ffffffaa', 'center', false);
  }

  function drawLoading() {
    ctx.fillStyle = '#0b1030'; ctx.fillRect(-W, -H, W * 3, H * 3);
    text('BLOOM GUARD', W / 2, H / 2 - 30, 44, '#8ef07a');
    const n = Math.floor(time * 3) % 4;
    text('Loading' + '.'.repeat(n), W / 2, H / 2 + 30, 20, '#e8e2ff');
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(8,6,28,0.7)'; ctx.fillRect(-W, -H, W * 3, H * 3);
    panel(110, 330, 320, lbSupported ? 380 : 310, '#241c5c', '#8f7bff', 22);
    text('PAUSED', W / 2, 380, 38);
    text('Wave ' + S.wave + '  ·  Best ' + S.best, W / 2, 425, 18, '#b9a6ff');
    button(PAUSE_BTNS.resume, 'RESUME', '#2fbf8f', '#16664c', 26);
    button(PAUSE_BTNS.sound, S.muted ? 'SOUND: OFF' : 'SOUND: ON', '#3b2f86', '#1e1650', 20);
    if (lbSupported) button(PAUSE_BTNS.lb, 'LEADERBOARD', '#7d6bff', '#3b2f86', 20);
  }

  function drawShop() {
    ctx.fillStyle = 'rgba(8,6,28,0.7)'; ctx.fillRect(-W, -H, W * 3, H * 3);
    panel(SHOP.x, SHOP.y, SHOP.w, SHOP.h, '#241c5c', '#8f7bff', 22);
    text('GARDEN SHOP', W / 2, SHOP.y + 34, 30);
    button(SHOP.close, 'X', '#ff5470', '#9a2038', 24);
    // collection
    for (let t = 1; t <= MAX_TIER; t++) {
      const x = SHOP.x + 34 + (t - 1) * 53, y = SHOP.y + 112;
      rr(x - 24, y - 38, 48, 66, 10); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
      if (t <= S.found) drawPlant(t, x, y - 6, 0.55, t, false);
      else text('?', x, y - 6, 28, '#6d5bb0', 'center', false);
      text(String(t), x, y + 20, 12, t <= S.found ? PLANTS[t].color : '#6d5bb0', 'center', false);
    }
    drawCoin(W / 2 - 50, SHOP.y + 66, 11);
    text(fmt(S.coins), W / 2 - 32, SHOP.y + 67, 20, '#ffe17a', 'left');

    ctx.save();
    ctx.beginPath(); ctx.rect(SHOP.x, SHOP.listTop - 8, SHOP.w, SHOP.y + SHOP.h - SHOP.listTop - 4); ctx.clip();
    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      const y = SHOP.listTop + i * SHOP.rowH + shopScroll;
      rr(SHOP.x + 14, y, SHOP.w - 28, SHOP.rowH - 10, 14); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
      const lvl = u.id === 'buy' ? null : S.up[u.id];
      text(u.name + (lvl !== null ? '  Lv ' + lvl : ''), SHOP.x + 32, y + 28, 20, '#ffffff', 'left');
      text(u.desc(), SHOP.x + 32, y + 56, 13, '#cfc6ff', 'left', false);
      const maxed = lvl !== null && lvl >= u.max;
      const cost = u.cost();
      const btn = { x: SHOP.x + SHOP.w - 150, y: y + 18, w: 130, h: 54 };
      button(btn, maxed ? 'MAX' : fmt(cost), '#ffb21e', '#9a6200', 20, !maxed && S.coins >= cost);
      if (!maxed) drawCoin(btn.x + 18, btn.y + 27, 9);
    }
    ctx.restore();
  }

  function drawBanner() {
    if (!banner) return;
    const a = clamp(banner.t * 3, 0, 1);
    ctx.globalAlpha = a;
    const y = 300;
    panel(70, y - 50, 400, 100, '#2a1f6b', '#ffd166', 20);
    if (banner.tier) drawPlant(banner.tier, 125, y + 10, 0.85, 0);
    const cx = banner.tier ? 300 : W / 2;
    text(banner.title, cx, y - 14, 30, '#ffd166');
    text(banner.sub, cx, y + 22, 18, '#ffffff');
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- render
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const mid = dpr * (offY + scale * H * 0.6);
    ctx.fillStyle = '#0b1030'; ctx.fillRect(0, 0, canvas.width, mid);
    ctx.fillStyle = '#120b22'; ctx.fillRect(0, mid, canvas.width, canvas.height - mid);
    const sx = shake > 0 ? rand(-6, 6) * shake : 0, sy = shake > 0 ? rand(-6, 6) * shake : 0;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offX + sx * scale), dpr * (offY + sy * scale));

    if (screen === 'loading') { drawLoading(); return; }
    if (bg) ctx.drawImage(bg, 0, 0, W, H);

    // fireflies
    for (const ff of fireflies) {
      const a = 0.4 + Math.sin(time * 3 + ff.p) * 0.4;
      ctx.fillStyle = `rgba(220,255,140,${a * 0.25})`; ctx.beginPath(); ctx.arc(ff.x, ff.y, 7, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(240,255,180,${a})`; ctx.beginPath(); ctx.arc(ff.x, ff.y, 2, 0, 7); ctx.fill();
    }

    for (const en of enemies) drawEnemy(en);
    drawHedge();
    drawSlots();
    drawPod();

    for (const sh of shots) {
      const c = PLANTS[sh.tier].shot;
      ctx.fillStyle = c + '55'; ctx.beginPath(); ctx.arc(sh.x, sh.y, 6 + sh.tier * 0.8, 0, 7); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sh.x, sh.y, 3 + sh.tier * 0.4, 0, 7); ctx.fill();
    }
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / (p.ring ? 0.3 : p.max), 0, 1);
      if (p.ring) { ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke(); }
      else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (const c of flyCoins) {
      if (c.t < 0) { drawCoin(c.sx, c.sy, 7); continue; }
      const t = c.t, ex = UI.coins.x + 24, ey = UI.coins.y + 22;
      const mx = (c.sx + ex) / 2 + 80, my = Math.min(c.sy, ey) - 60;
      const x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * mx + t * t * ex;
      const y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * my + t * t * ey;
      drawCoin(x, y, 7);
    }

    drawHUD();
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life * 2, 0, 1);
      text(f.txt, f.x, f.y, f.size || 18, f.color);
    }
    ctx.globalAlpha = 1;

    if (screen === 'play') {
      drawTutorial();
      if (drag) {
        drawPlant(drag.tier, drag.x, drag.y - 10, 1.15, 0);
      }
      drawBanner();
      if (overlay === 'pause') drawPause();
      else if (overlay === 'shop') drawShop();
    } else if (screen === 'title') {
      drawTitle();
    }
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.max(1, Math.round(cw * dpr));
    canvas.height = Math.max(1, Math.round(ch * dpr));
    scale = Math.min(cw / W, ch / H);
    offX = (cw - W * scale) / 2;
    offY = (ch - H * scale) / 2;
    buildBackground();
  }
  window.addEventListener('resize', resize);

  requestAnimationFrame(frame);
  boot();
})();
