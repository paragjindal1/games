/* Bridge War: a 3D squad runner-shooter built as a Snapchat Web Lens.
 * Your squad charges down a bridge and fires on its own. Drag left and right
 * to pick a lane: bullets raise the gate in front of you, and once the red
 * horde pours through, the squad auto-aims at it. Dodge the rolling tires,
 * beat the boss at the end of the bridge, and spend coins on upgrades.
 * Inside Snapchat the soldiers are the player's own 3D Bitmoji.
 * The world is rendered with three.js; the HUD is a 2D canvas on top. */
(() => {
  'use strict';

  // ================================================================ config
  const CFG = {
    // Snapchat draws its own controls over the top and bottom of a Lens.
    // All UI and the squad stay inside these fractions of the screen height
    // (or the device's safe-area insets, whichever is larger). Add #safe to
    // the URL to see the zone.
    SAFE_TOP: 0.12,
    SAFE_BOTTOM: 0.16,
    // Turn the Bitmoji if Snapchat's model faces the other way (radians).
    AVATAR_YAW: 0,
    // Triangle budget for Bitmoji soldiers; the rest of the squad uses the built-in model.
    AVATAR_TRIS: 260000,
    AVATAR_MAX: 12,
  };
  const LW = 540;               // logical HUD width
  const MIN_CONTENT_H = 760;    // logical height the HUD needs inside the safe zone
  const XS = 3;                 // world units per logic x (the road is x = -1..1)
  const RUN_SPEED = 9.5;        // world units per second
  const BULLET_SPEED = 52;
  const RANGE = 72;
  const MAX_SQUAD = 150;
  const MAX_DRAWN = 46;         // soldiers drawn; the rest only count
  const MAX_SHOTS = 32;         // bullets per second on screen (damage scales up past it)
  const MAX_FOES = 230;
  const BOSS_HP = 9000;         // level 1; grows steeply each level
  const BOSS_STOP = 30;         // the squad halts this far from the boss
  const WAKE = 40;              // a horde charges once the squad is this close

  const UP = {
    rate: { name: 'FIRE RATE', col: '#62c23a', dark: '#3c8a1e', base: 120 },
    dmg: { name: 'DAMAGE', col: '#3b8fe8', dark: '#1e5fb0', base: 150 },
    rev: { name: 'REVENUE', col: '#f0b41e', dark: '#b07c06', base: 200 },
    squad: { name: 'SQUAD', col: '#a05ae0', dark: '#6c2fae', base: 400 },
  };
  const UP_KEYS = ['rate', 'dmg', 'rev', 'squad'];

  const canvas = document.getElementById('game');
  const glCanvas = document.getElementById('gl');
  const ctx = canvas.getContext('2d');
  const T = window.THREE;
  const snap = window.snapchat || null;
  const SHOW_SAFE = /safe/.test(location.hash);
  const DEBUG = /debug/.test(location.hash);
  // #debug-capture steps frames by hand and renders sound offline, for the preview video
  const CAPTURE = /capture/.test(location.hash);
  const FD = '"Russo One", "Arial Black", Impact, system-ui, sans-serif';

  let dpr = 1, scale = 1, offX = 0, VW = LW, LH = 960, ST = 0, SB = 0;
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
    resize3D(cw, ch, topPx, botPx);
  }

  // ================================================================ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const backOut = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  function mulberry(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rr(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

  // ================================================================ save / Snap API
  const freshSave = () => ({ v: 1, level: 1, coins: 0, earned: 0, up: { rate: 0, dmg: 0, rev: 0, squad: 0 }, muted: false, tut: true });
  let S = freshSave();
  let saveLoaded = false, lbSupported = false;
  let savePending = Promise.resolve();

  async function boot() {
    init3D();
    resize();
    const fontsReady = (document.fonts && document.fonts.load)
      ? document.fonts.load(`20px ${FD}`).catch(() => {})
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
      // The Bitmoji arrives in the background; the built-in soldier is used until then.
      if (snap.isSupported('bitmoji')) fetchBitmoji();
    }
    await fontsReady;
    if (saved && saved.v === 1) { S = Object.assign(freshSave(), saved); S.up = Object.assign(freshSave().up, saved.up || {}); }
    toMenu();
  }

  async function fetchBitmoji() {
    try {
      const info = await snap.bitmoji.getAvatarInfo();
      if (!info || !info.hasAvatar) return;
      const res = await snap.bitmoji.get3DAvatar();
      if (res && res.url) await loadAvatar(res.url);
    } catch (e) { console.warn('Bitmoji unavailable:', e && e.message); }
  }

  function writeSave() {
    if (!saveLoaded || !snap) return;
    const state = JSON.parse(JSON.stringify(S));
    savePending = savePending
      .then(() => snap.storage.set('save', state))
      .then(() => true, (e) => { console.warn('Save failed:', e && e.message); return false; });
  }
  // The leaderboard ranks career coins: every coin ever collected.
  function submitScore() {
    if (!lbSupported || S.earned <= 0) return Promise.resolve();
    return snap.leaderboards.submitScore({ score: Math.round(S.earned) })
      .catch((e) => console.warn('Leaderboard submit failed:', e && e.message));
  }
  async function showLeaderboard() {
    if (!lbSupported) { toast('Leaderboard is not available here'); return; }
    try {
      await submitScore();
      await snap.leaderboards.show();
      // The desktop stub accepts the call but has no panel to open.
      if (snap.isStub) toast('Score sent · the leaderboard opens inside Snapchat');
    } catch (e) {
      console.warn('Leaderboard unavailable:', e && e.message);
      toast('Leaderboard unavailable right now');
    }
  }

  // upgrade maths
  const upCost = (k) => Math.round(UP[k].base * Math.pow(1.42, S.up[k]) / 10) * 10;
  const fireRate = () => 2.4 * (1 + 0.12 * S.up.rate);     // shots per soldier per second
  const bulletDmg = () => 10 * Math.pow(1.17, S.up.dmg);      // compounds, to keep up with the bosses
  const revenue = () => 1 + 0.25 * S.up.rev;
  const startSquad = () => 1 + S.up.squad;

  // ================================================================ audio
  let audio = null, master = null, noiseBuf = null;
  let clock = 0;               // extra audio time while capturing offline
  const now = () => audio.currentTime + clock;
  function initAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = S.muted ? 0 : 0.8;
    master.connect(audio.destination);
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function setMuted(m) {
    S.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, audio.currentTime, 0.02);
    writeSave();
  }
  function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
    if (!audio || S.muted) return;
    const t = now() + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.3, f0 = 1200, f1 = 0, q = 1, type = 'bandpass', delay = 0) {
    if (!audio || S.muted) return;
    const t = now() + delay;
    const s = audio.createBufferSource(); s.buffer = noiseBuf;
    const f = audio.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  // Frequent sounds are rate-limited so a big squad doesn't turn into noise.
  const lastPlay = {};
  function limited(key, gap, fn) {
    if (!audio) return;
    const t = now();
    if (lastPlay[key] !== undefined && t - lastPlay[key] < gap && t >= lastPlay[key]) return;
    lastPlay[key] = t; fn();
  }
  const SFX = {
    shot() { limited('shot', 0.07, () => { noise(0.05, 0.12, 2600, 900, 1.2); tone(520, 0.05, 'square', 0.03, 0.5); }); },
    pop() { limited('pop', 0.05, () => { tone(rand(240, 320), 0.09, 'triangle', 0.16, 0.5); noise(0.05, 0.1, 1400, 500, 1); }); },
    coin() { limited('coin', 0.06, () => tone(rand(1180, 1320), 0.09, 'square', 0.045, 1.2)); },
    gateUp() { limited('gate', 0.06, () => tone(700, 0.04, 'triangle', 0.05, 1.3)); },
    plus() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.13, 'triangle', 0.13, 1, i * 0.05)); },
    minus() { tone(220, 0.3, 'sawtooth', 0.1, 0.5); noise(0.2, 0.2, 500, 150, 0.8, 'lowpass'); },
    lost() { limited('lost', 0.05, () => { tone(180, 0.12, 'square', 0.07, 0.6); }); },
    tire() { noise(0.4, 0.45, 300, 70, 0.7, 'lowpass'); tone(70, 0.3, 'sine', 0.4, 0.5); },
    boom() { noise(0.6, 0.5, 700, 60, 0.6, 'lowpass'); tone(55, 0.5, 'sine', 0.45, 0.4); },
    elite() { tone(110, 0.3, 'sawtooth', 0.1, 0.6); },
    alarm() { tone(90, 0.5, 'sawtooth', 0.14, 0.7); tone(60, 0.7, 'sine', 0.3, 0.8, 0.1); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'triangle', 0.14, 1, i * 0.09)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'triangle', 0.14, 1, i * 0.15)); },
    buy() { tone(660, 0.08, 'square', 0.07); tone(990, 0.16, 'square', 0.07, 1, 0.07); },
    deny() { tone(160, 0.14, 'square', 0.07); },
    click() { tone(880, 0.05, 'square', 0.06); },
    go() { tone(440, 0.1, 'triangle', 0.12, 2); },
  };

  // ================================================================ level
  // Each level is built from its number, so it plays the same on every retry.
  function buildLevel(L) {
    const rnd = mulberry(1000 + L * 77);
    const ents = [];
    const hpMul = 1 + 0.22 * (L - 1);
    const steps = 6 + Math.min(L, 8);
    const foeHp = Math.round(20 * hpMul);
    let z = 70;
    for (let i = 0; i < steps; i++) {
      // a row of gates with the horde standing guard in front of it
      const n = i === 0 ? 1 : 1 + (rnd() < 0.7 ? 1 : 0) + (L >= 2 && rnd() < 0.4 ? 1 : 0);
      const good = Math.floor(rnd() * n);
      const segs = [];
      for (let k = 0; k < n; k++) {
        const v = i === 0 ? -Math.round(1 + rnd() * 2)
          : k === good
          ? -Math.round(3 + rnd() * 6 + i * 1.6 + L * 0.8)
          : -Math.round(10 + rnd() * 12 + i * 3 + L * 2);
        segs.push({ x1: -1 + (2 / n) * k, x2: -1 + (2 / n) * (k + 1), v, pulse: 0, acc: 0 });
      }
      if (n > 1 && rnd() < 0.25) segs[good].v = Math.round(1 + rnd() * 3);
      // shooting a gate raises it, more slowly the higher it gets, up to its cap
      ents.push({ kind: 'gate', z, segs, used: false, cap: Math.round(7 + i * 1.8 + L) });
      // the horde grows faster than the squad can, so the back half is a real fight
      const count = i === 0 ? 1 + Math.floor(L / 2) : Math.min(120, Math.round(2 + L * 2 + 2.6 * Math.pow(i, 1.5)));
      const depth = Math.min(22, 6 + count * 0.2);
      for (let k = 0; k < count; k++) {
        ents.push({
          kind: 'foe', z: z - 3 - rnd() * depth, x: (rnd() - 0.5) * 1.84,
          hp: Math.round(foeHp * (1 + i * 0.08)), max: foeHp, ph: rnd() * 6, flash: 0, awake: false, sp: 4.6 + rnd() * 1.6 + L * 0.15,
        });
      }
      // elites: big, slow, and they take five soldiers with them
      const elites = i < 2 ? 0 : Math.min(4, Math.floor((i - 1) / 2 + (L - 1) / 3));
      for (let k = 0; k < elites; k++) {
        const hp = foeHp * (8 + i * 3);
        ents.push({ kind: 'foe', elite: true, z: z - 3 - rnd() * depth * 0.6, x: (rnd() - 0.5) * 1.5, hp, max: hp, ph: rnd() * 6, flash: 0, awake: false, sp: 3.6 });
      }
      // tire pairs roll in on the back half of the bridge (anywhere from level 2)
      if (i >= steps - 3 || (L >= 2 && i >= 1 && rnd() < 0.45)) {
        const lanes = [[-0.55, 0.55], [-0.6, 0], [0, 0.6]][Math.floor(rnd() * 3)];
        for (const x of lanes) {
          const hp = Math.round(120 * hpMul * (1 + i * 0.15));
          ents.push({ kind: 'tire', z: z + 34 + rnd() * 5, x, hp, max: hp, rot: 0, flash: 0, awake: false });
        }
      }
      z += 48;
    }
    // the boss waits at the end of the bridge; his health is what the upgrades are for
    const bz = z + 22;
    const bhp = Math.round(BOSS_HP * Math.pow(1.68, L - 1) * (1 + 0.15 * (L - 1)));
    ents.push({ kind: 'boss', z: bz, x: 0, hp: bhp, max: bhp, flash: 0, ph: 0, awake: false, bite: 0, throwT: 3, stomp: 0 });
    ents.sort((a, b) => a.z - b.z);
    return { ents, length: bz - BOSS_STOP, bossZ: bz, foeHp };
  }

  // ================================================================ state
  let screen = 'loading';      // menu | play | win | lose
  let G = null;
  let paused = false;
  let toastMsg = null;
  let shake = 0;
  let uiT = 0;
  function toast(msg) { toastMsg = { msg, t: 2.6 }; }

  function freshRun() {
    const lv = buildLevel(S.level);
    return {
      t: 0, dist: 0, ents: lv.ents, length: lv.length, bossZ: lv.bossZ, foeHp: lv.foeHp, boss: lv.ents[lv.ents.length - 1],
      n: startSquad(), x: 0, tx: 0, face: Math.PI,
      bullets: [], parts: [], floats: [], coins: [], shotAcc: 0, earned: 0, kills: 0, peak: startSquad(),
      active: [], targets: [], lossBy: {}, gateZ: 1e9, wall: false, wallDone: 0, spawnT: 0, over: 0, running: false, panel: 0,
      pop: 0, hurt: 0, bump: 0,
    };
  }
  function toMenu() { G = freshRun(); screen = 'menu'; paused = false; }
  function startRun() {
    if (screen !== 'menu') return;
    G.running = true; screen = 'play';
    if (S.tut) { S.tut = false; writeSave(); }
    SFX.go();
  }

  // Soldiers stand in a tight spiral around the squad's centre (world units).
  const SPOTS = [];
  for (let i = 0; i < MAX_DRAWN; i++) {
    const r = 0.3 * Math.sqrt(i), a = i * 2.39996;
    SPOTS.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  const squadR = (n) => (0.3 * Math.sqrt(Math.min(n, MAX_DRAWN)) + 0.25) / XS;   // in logic x

  function addCoins(n, x, z) {
    const v = Math.round(n * revenue());
    G.earned += v; S.coins += v; S.earned += v;
    if (x !== undefined) {
      G.coins.push({ x, z, t: 0, v });
      if (G.coins.length > 50) G.coins.shift();
    }
    SFX.coin();
  }
  function puff(x, z, col, n, big = 1, y = 0.5) {
    for (let i = 0; i < n; i++) {
      G.parts.push({ x: x * XS + rand(-0.2, 0.2) * big, y: y + rand(-0.2, 0.3) * big, z: z + rand(-0.3, 0.3) * big, vx: rand(-2, 2) * big, vy: rand(1, 4) * big, vz: rand(-2, 2) * big, life: rand(0.3, 0.6), max: 0.6, r: rand(0.08, 0.17) * big, col });
    }
    if (G.parts.length > 300) G.parts.splice(0, G.parts.length - 300);
  }
  function floatText(x, z, txt, col, size = 26, y = 1.6) { G.floats.push({ x, z, y, txt, col, size, t: 0 }); }

  function loseSoldiers(k, show, src) {
    if (k <= 0 || G.n <= 0) return;
    k = Math.min(k, G.n);
    if (src) G.lossBy[src] = (G.lossBy[src] || 0) + k;
    G.n -= k; G.hurt = 0.25;
    puff(G.x, 0, 0x7fc4ff, Math.min(18, 4 + k * 2));
    SFX.lost();
    if (show) floatText(G.x, 0.5, '-' + k, '#ff4040', 30);
    if (G.n <= 0) { G.over = 0.001; G.running = false; shake = 0.5; SFX.lose(); }
  }

  // ================================================================ update
  function updateSquad(dt) {
    if (keys.left) G.tx -= 1.7 * dt;
    if (keys.right) G.tx += 1.7 * dt;
    const lim = 1 - Math.min(0.5, squadR(G.n) * 0.8);
    G.tx = clamp(G.tx, -lim, lim);
    G.x = lerp(G.x, G.tx, Math.min(1, dt * 16));
    G.peak = Math.max(G.peak, G.n);
  }

  // Bullets fly straight up the squad's lane (raising the gate there) until
  // something charges; then the squad auto-aims at whatever is coming.
  // Gates block every bullet, so a horde behind a gate is safe until it comes through.
  function fire(dt) {
    const tg = G.targets;
    const ahead = G.gateZ < RANGE || tg.length > 0;
    if (!ahead) return;
    const shots = G.n * fireRate();
    const shown = Math.min(shots, MAX_SHOTS);
    const dmg = bulletDmg() * (shots / shown);
    G.shotAcc += shown * dt;
    while (G.shotAcc >= 1) {
      G.shotAcc -= 1;
      const sp = SPOTS[Math.floor(Math.random() * Math.min(G.n, MAX_DRAWN))];
      const x = clamp(G.x + sp.x / XS, -0.98, 0.98), z = 0.6 + sp.z;
      let vx = 0, vz = BULLET_SPEED;
      if (tg.length) {
        const t = tg[Math.floor(Math.random() * Math.min(tg.length, 7))];
        const dx = (t.x - x) * XS, dz = Math.max(1, t.z - G.dist - z), d = Math.hypot(dx, dz);
        vx = dx / d * BULLET_SPEED / XS; vz = dz / d * BULLET_SPEED;
      }
      G.bullets.push({ x, z, vx, vz, dmg, life: RANGE / BULLET_SPEED });
      SFX.shot();
    }
  }

  function killFoe(e, z) {
    e.dead = true; G.kills++;
    puff(e.x, z, 0xff5a4a, e.elite ? 22 : 7, e.elite ? 2 : 1);
    if (e.elite) { for (let k = 0; k < 5; k++) addCoins(20, e.x + rand(-0.15, 0.15), z + rand(-0.5, 0.5)); SFX.elite(); }
    else addCoins(20, e.x, z);
    SFX.pop();
  }

  function hitEnt(e, b, z) {
    e.hp -= b.dmg; e.flash = 0.09;
    if (e.hp > 0) return;
    if (e.kind === 'foe') killFoe(e, z);
    else if (e.kind === 'tire') { e.dead = true; puff(e.x, z, 0x3a3a3a, 18, 2); addCoins(60, e.x, z); SFX.tire(); }
    else if (e.kind === 'boss') {
      e.dead = true; G.wallDone = 0.001;
      puff(e.x, z, 0xff3030, 40, 4, 2); puff(e.x, z, 0xffd23a, 30, 3, 2.5); shake = 0.7; SFX.boom();
      for (let k = 0; k < 16; k++) addCoins(40, e.x + rand(-0.3, 0.3), z + rand(-1.5, 1.5));
      for (const f of G.ents) if (f.kind !== 'boss' && !f.dead && f.kind !== 'gate') { f.dead = true; puff(f.x, f.z - G.dist, 0xff5a4a, 5); }
      floatText(0, z, 'BOSS DOWN!', '#ffe14a', 56, 3);
    }
  }

  function updateBullets(dt) {
    const act = G.active;
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      const z0 = b.z;
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      let hit = false;
      for (const e of act) {
        const z = e.z - G.dist;
        if (z < z0 - 0.6 || z > b.z + 0.6) continue;
        if (e.kind === 'gate') {
          // a bullet that touches a gate raises it and stops there
          if (e.used) continue;
          const seg = e.segs.find((s) => b.x >= s.x1 && b.x < s.x2);
          if (seg) {
            hit = true;
            if (seg.v < e.cap) {
              seg.acc += 1;
              const need = seg.v < 0 ? 1 : 1.2 + seg.v * 0.6;
              if (seg.acc >= need) { seg.acc -= need; seg.v += 1; seg.pulse = 0.18; SFX.gateUp(); }
            }
          }
        } else if (!e.dead) {
          const half = e.kind === 'boss' ? 0.36 : e.kind === 'tire' ? 0.27 : e.elite ? 0.19 : 0.095;
          if (Math.abs(b.x - e.x) > half) continue;
          // a bullet carries its leftover damage on into the next soldier (never past a gate)
          const before = e.hp;
          hitEnt(e, b, z);
          if (e.kind === 'foe' && e.dead && b.dmg > before + 0.5) { b.dmg -= before; continue; }
          hit = true;
        }
        if (hit) { if (Math.random() < 0.5) G.parts.push({ x: b.x * XS, y: 0.8, z, vx: rand(-1, 1), vy: rand(0, 2), vz: -2, life: 0.15, max: 0.15, r: 0.1, col: 0xfff3a8 }); break; }
      }
      if (hit || b.life <= 0 || Math.abs(b.x) > 1.1) G.bullets.splice(i, 1);
    }
  }

  function updateEnts(dt) {
    const r = squadR(G.n);
    const act = [], targets = [];
    let gateZ = 1e9;
    for (const e of G.ents) {
      if (e.dead) continue;
      let z = e.z - G.dist;
      if (z > 210) break;
      if (z < -8) { e.dead = true; continue; }
      act.push(e);
      if (e.flash > 0) e.flash -= dt;
      if (e.kind === 'gate') {
        for (const s of e.segs) s.pulse = Math.max(0, s.pulse - dt);
        if (!e.used && z > 0.15) gateZ = Math.min(gateZ, z);
        if (!e.used && z <= 0.15 && G.n > 0) {
          e.used = true;
          const seg = e.segs.find((s) => G.x >= s.x1 && G.x < s.x2) || e.segs[e.segs.length - 1];
          seg.taken = true;
          if (seg.v >= 0) {
            const add = Math.min(seg.v, MAX_SQUAD - G.n);
            G.n += add; G.bump = 0.3;
            if (seg.v > 0) { floatText(G.x, 0.6, '+' + seg.v, '#7fe0ff', 36); puff(G.x, 0, 0x9fe6ff, 14); SFX.plus(); }
          } else { SFX.minus(); loseSoldiers(-seg.v, true, 'gate'); }
        }
      } else if (e.kind === 'foe') {
        // the horde holds behind its gate, then charges
        if (!e.awake && z < (e.elite ? WAKE + 6 : WAKE)) e.awake = true;
        if (e.awake && G.n > 0) {
          e.z -= e.sp * dt; e.ph += dt * (e.elite ? 7 : 12);
          e.x += clamp((G.x - e.x) * 3, -1, 1) * (e.elite ? 0.8 : 1.3) * dt;
        }
        z = e.z - G.dist;
        const reach = r + (e.elite ? 0.16 : 0.08);
        if (z <= 0.5 && z > -1 && Math.abs(e.x - G.x) < reach && G.n > 0) {
          e.dead = true; puff(e.x, z, 0xff5a4a, 6);
          loseSoldiers(e.elite ? 5 : 1, e.elite, e.elite ? 'elite' : 'foe');
        }
      } else if (e.kind === 'tire') {
        if (!e.awake && z < 75) e.awake = true;
        if (e.awake) { e.z -= 12 * dt; e.rot += dt * 9; }
        z = e.z - G.dist;
        if (z <= 0.6 && z > -1.2 && Math.abs(e.x - G.x) < r + 0.24 && G.n > 0) {
          e.dead = true; shake = 0.45; SFX.tire(); puff(e.x, z, 0x3a3a3a, 16, 2);
          loseSoldiers(Math.max(2, Math.ceil(G.n * 0.25)), true, 'tire');
        }
      }
      // what the squad may auto-aim at (sorted by distance below)
      if (e.kind !== 'gate' && !e.dead && z > 0.8 && z < RANGE) targets.push(e);
    }
    targets.sort((a, b) => a.z - b.z);
    G.active = act; G.gateZ = gateZ;
    G.targets = targets.filter((e) => e.awake);
  }

  // At the end of the bridge the squad digs in and the boss walks at it,
  // calling in minions and hurling tires down the squad's lane.
  function updateBoss(dt) {
    const B = G.boss;
    if (!B || B.dead) return;
    const bz = B.z - G.dist;
    if (!G.wall && bz <= BOSS_STOP + 0.5) {
      G.wall = true; B.awake = true; SFX.alarm();
      floatText(0, 12, 'BOSS FIGHT!', '#ff4040', 60, 3);
    }
    if (!G.wall || G.wallDone || G.n <= 0) return;
    B.ph += dt * 4;
    B.x = lerp(B.x, clamp(G.x, -0.55, 0.55), Math.min(1, dt * 0.6));
    if (bz > 2.6) B.z -= (1.5 + S.level * 0.08) * dt;
    else {
      // in reach: he stomps the squad flat a few soldiers at a time
      B.bite += dt * (5 + S.level);
      while (B.bite >= 1 && G.n > 0) { B.bite -= 1; loseSoldiers(1, false, 'boss'); shake = Math.max(shake, 0.25); }
    }
    G.spawnT -= dt;
    if (G.spawnT <= 0) {
      G.spawnT = Math.max(0.18, 0.55 - S.level * 0.03);
      G.ents.push({ kind: 'foe', z: B.z + rand(-1, 3), x: clamp(B.x + rand(-0.7, 0.7), -0.92, 0.92), hp: G.foeHp, max: G.foeHp, ph: rand(0, 6), flash: 0, awake: true, sp: 5.5 + S.level * 0.2 });
    }
    B.throwT -= dt;
    if (B.throwT <= 0 && bz > 6) {
      B.throwT = Math.max(2.2, 4.2 - S.level * 0.2);
      const hp = G.foeHp * 9;
      G.ents.push({ kind: 'tire', z: B.z - 1.5, x: clamp(G.x + rand(-0.1, 0.1), -0.62, 0.62), hp, max: hp, rot: 0, flash: 0, awake: true });
      B.stomp = 0.4; SFX.tire();
    }
    B.stomp = Math.max(0, B.stomp - dt);
  }

  function updateFx(dt) {
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i];
      p.life -= dt; if (p.life <= 0) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 9 * dt;
    }
    for (let i = G.floats.length - 1; i >= 0; i--) { G.floats[i].t += dt; if (G.floats[i].t > 1) G.floats.splice(i, 1); }
    for (let i = G.coins.length - 1; i >= 0; i--) { G.coins[i].t += dt; if (G.coins[i].t > 0.8) G.coins.splice(i, 1); }
    G.hurt = Math.max(0, G.hurt - dt); G.bump = Math.max(0, G.bump - dt);
  }

  function update(dt) {
    uiT += dt;
    if (toastMsg) { toastMsg.t -= dt; if (toastMsg.t <= 0) toastMsg = null; }
    if (screen === 'loading' || !G) return;
    if (paused) return;
    G.t += dt;
    shake = Math.max(0, shake - dt * 1.6);
    // the squad looks at you on the level screen and turns to run
    G.face = lerp(G.face, screen === 'menu' ? Math.PI : 0, Math.min(1, dt * 9));
    if (screen === 'menu') { updateSquad(dt); updateEnts(0); updateFx(dt); return; }
    if (G.running) {
      const speed = G.wall && !G.wallDone ? 0 : RUN_SPEED;
      G.dist += speed * dt;
      updateSquad(dt);
      fire(dt);
    }
    updateEnts(G.running ? dt : dt * 0.4);
    updateBoss(dt);
    updateBullets(dt);
    updateFx(dt);
    if (G.wallDone) {
      G.wallDone += dt;
      if (G.wallDone > 1.6 && screen === 'play') {
        screen = 'win'; G.running = false; G.panel = 0;
        const bonus = Math.round(200 * S.level * revenue());
        G.bonus = bonus; S.coins += bonus; S.earned += bonus; G.earned += bonus;
        G.cleared = S.level; S.level++;
        writeSave(); submitScore(); SFX.win();
      }
    }
    if (G.over) {
      G.over += dt;
      if (G.over > 1 && screen === 'play') { screen = 'lose'; G.panel = 0; writeSave(); submitScore(); }
    }
    if (screen === 'win' || screen === 'lose') G.panel += dt;
  }

  // ================================================================ 3D world
  let renderer, scene, camera;
  const dummy = new T.Object3D();
  const tmpC = new T.Color();
  const W = {};                // world meshes
  let avatar = null;           // animated Bitmoji copies, once loaded
  let frameDt = 1 / 60;
  let camFov = 60;

  function inst(geo, mat, n, colors) {
    const m = new T.InstancedMesh(geo, mat, n);
    m.frustumCulled = false; m.count = 0;
    if (colors) m.setColorAt(0, tmpC.set(0xffffff));
    scene.add(m);
    return m;
  }
  function tint(geo, hex) {
    const c = new T.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  }
  const part = (geo, hex, x, y, z, rx = 0, rz = 0) => { geo.rotateX(rx); geo.rotateZ(rz); geo.translate(x, y, z); return tint(geo, hex); };

  // A chunky 1-unit-tall cartoon figure: one merged body plus two swinging legs.
  function manGeo(o) {
    const bits = [
      part(new T.CapsuleGeometry(0.19, 0.16, 4, 12), o.body, 0, 0.63, 0),
      part(new T.CapsuleGeometry(0.06, 0.2, 3, 8), o.body, -0.26, 0.6, 0.02, 0.25, -0.12),
      part(new T.CapsuleGeometry(0.06, 0.2, 3, 8), o.body, 0.26, 0.6, 0.02, 0.25, 0.12),
      part(new T.SphereGeometry(0.16, 14, 10), o.skin, 0, 0.99, 0),
      part(new T.SphereGeometry(0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), o.hat, 0, 1.0, -0.005),
    ];
    if (o.gun) {
      bits.push(part(new T.BoxGeometry(0.07, 0.09, 0.55), 0x33383e, 0.2, 0.7, 0.26));
      bits.push(part(new T.BoxGeometry(0.08, 0.14, 0.14), 0x6b4a2a, 0.2, 0.64, 0.06));
    } else {
      bits.push(part(new T.BoxGeometry(0.04, 0.045, 0.03), 0x22140f, -0.065, 0.99, 0.15));
      bits.push(part(new T.BoxGeometry(0.04, 0.045, 0.03), 0x22140f, 0.065, 0.99, 0.15));
    }
    return {
      body: T.mergeGeometries(bits.map((g) => g.toNonIndexed())),
      leg: part(new T.CapsuleGeometry(0.078, 0.25, 3, 8), o.leg, 0, -0.2, 0),
    };
  }

  function stripeTexture(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  function init3D() {
    renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    scene = new T.Scene();
    scene.background = new T.Color(0x8fd0ff);
    scene.fog = new T.Fog(0x8fd0ff, 95, 215);
    camera = new T.PerspectiveCamera(60, 1, 0.5, 400);
    scene.add(new T.HemisphereLight(0xffffff, 0x8aa4c0, 1.25));
    const sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(6, 12, -6); scene.add(sun);

    const lam = (c, extra) => new T.MeshLambertMaterial(Object.assign({ color: c }, extra || {}));
    const add = (m) => { scene.add(m); return m; };
    // sea
    W.seaTex = stripeTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#1f6fd0'; c.fillRect(0, 0, w, h);
      const r = mulberry(3);
      for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.16})`; c.fillRect(r() * w, r() * h, 14 + r() * 40, 2 + r() * 2); }
    });
    W.seaTex.repeat.set(26, 26);
    const sea = add(new T.Mesh(new T.PlaneGeometry(700, 700), new T.MeshBasicMaterial({ map: W.seaTex })));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, -14, 150);
    // road with bands that scroll as the squad runs
    W.roadTex = stripeTexture(64, 256, (c, w, h) => {
      c.fillStyle = '#ddd7cc'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#d2cbbe'; c.fillRect(0, 0, w, h / 2);
      c.fillStyle = 'rgba(0,0,0,0.05)'; for (let y = 0; y < h; y += 8) c.fillRect(0, y, w, 1);
    });
    W.roadTex.repeat.set(1, 40);
    const road = add(new T.Mesh(new T.PlaneGeometry(XS * 2 + 0.3, 320), new T.MeshLambertMaterial({ map: W.roadTex })));
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0, 140);
    const box = (w, h, d, c, x, y, z) => { const m = add(new T.Mesh(new T.BoxGeometry(w, h, d), lam(c))); m.position.set(x, y, z); return m; };
    for (const s of [-1, 1]) {
      box(0.5, 0.4, 320, 0x8c949b, s * (XS + 0.4), 0.2, 140);     // kerb
      box(1.3, 0.2, 320, 0xaab2b9, s * (XS + 1.3), 0.1, 140);     // walkway
      box(0.5, 1.1, 320, 0x7f8790, s * (XS + 2.2), 0.3, 140);     // outer girder
      box(0.12, 0.12, 320, 0xc5ccd2, s * (XS + 1.9), 1.25, 140);  // hand rail
    }
    box(XS * 2 + 5.4, 1.2, 320, 0x6f7780, 0, -0.62, 140);          // deck underside
    W.posts = inst(new T.BoxGeometry(0.14, 1.2, 0.14), lam(0x7a828a), 80);
    // suspension towers, recycled as they pass
    W.towers = [];
    for (let i = 0; i < 3; i++) {
      const g = new T.Group(), m = lam(0x77808a);
      for (const s of [-1, 1]) {
        const p = new T.Mesh(new T.BoxGeometry(1.3, 26, 1.6), m); p.position.set(s * (XS + 3.2), 11, 0); g.add(p);
        for (const dz of [-40, 40]) {
          // main cables sweep from the tower top down to the deck
          const a = new T.Vector3(s * (XS + 3.2), 24, 0), b = new T.Vector3(s * (XS + 2.2), 1.3, dz);
          const len = a.distanceTo(b), cable = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, len, 5), m);
          cable.position.copy(a).add(b).multiplyScalar(0.5); cable.lookAt(b); cable.rotateX(Math.PI / 2); g.add(cable);
        }
      }
      const b1 = new T.Mesh(new T.BoxGeometry(XS * 2 + 7.7, 1.4, 1.6), m); b1.position.y = 23.3; g.add(b1);
      const b2 = new T.Mesh(new T.BoxGeometry(XS * 2 + 7.7, 0.9, 1.4), m); b2.position.y = 14.5; g.add(b2);
      scene.add(g); W.towers.push(g);
    }
    // characters
    const sold = manGeo({ body: 0xa9b8c2, leg: 0x1e7fd6, skin: 0xf0b9a0, hat: 0x2196f3, gun: true });
    const foe = manGeo({ body: 0xe8262e, leg: 0xb3151f, skin: 0xf0b9a0, hat: 0xd81e26 });
    const vc = () => lam(0xffffff, { vertexColors: true });
    W.soldBody = inst(sold.body, vc(), MAX_DRAWN); W.soldLeg = inst(sold.leg, vc(), MAX_DRAWN * 2);
    W.foeBody = inst(foe.body, vc(), MAX_FOES, true); W.foeLeg = inst(foe.leg, vc(), MAX_FOES * 2, true);
    const blob = new T.CircleGeometry(0.3, 14); blob.rotateX(-Math.PI / 2);
    W.shadow = inst(blob, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }), MAX_FOES + MAX_DRAWN + 12);
    // bullets, coins, particles
    W.bullets = inst(new T.BoxGeometry(0.09, 0.09, 1.3), new T.MeshBasicMaterial({ color: 0xfff2a0 }), 160);
    const coin = new T.CylinderGeometry(0.26, 0.26, 0.07, 14); coin.rotateX(Math.PI / 2);
    W.coins = inst(coin, lam(0xffd23a, { emissive: 0x7a5a00 }), 80);
    W.parts = inst(new T.IcosahedronGeometry(1, 0), new T.MeshBasicMaterial({ color: 0xffffff }), 320, true);
    // gates: a pool of glass panels and posts
    W.panels = []; W.gposts = inst(new T.BoxGeometry(0.16, 2.3, 0.16), lam(0xffffff), 40, true);
    for (let i = 0; i < 12; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide }));
      m.visible = false; m.renderOrder = 2; scene.add(m); W.panels.push(m);
    }
    // tires and barrels
    W.tires = [];
    for (let i = 0; i < 8; i++) {
      const g = new T.Group(), spin = new T.Group();
      const tyre = new T.Mesh(new T.TorusGeometry(0.62, 0.3, 10, 22), lam(0x1c1c1e));
      const hub = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.3, 12), lam(0x8a9099)); hub.rotation.x = Math.PI / 2;
      for (let k = 0; k < 12; k++) {
        const tread = new T.Mesh(new T.BoxGeometry(0.16, 0.08, 0.62), lam(0x34343a)), a = k * Math.PI / 6;
        tread.position.set(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0); tread.rotation.z = a + Math.PI / 2; spin.add(tread);
      }
      spin.add(tyre, hub); spin.rotation.y = Math.PI / 2; g.add(spin); g.userData.spin = spin;
      g.visible = false; scene.add(g); W.tires.push(g);
    }
    // the boss: a giant in dark red with horns and spiked shoulders
    const bossGeo = manGeo({ body: 0x8e0f19, leg: 0x5a070d, skin: 0xd9907a, hat: 0x2a0a0e });
    const bossMat = lam(0xffffff, { vertexColors: true });
    const boss = new T.Group(), bodyM = new T.Mesh(bossGeo.body, bossMat);
    boss.add(bodyM);
    const legs = [-1, 1].map((sd) => { const l = new T.Mesh(bossGeo.leg, bossMat); l.position.set(sd * 0.1, 0.44, 0); boss.add(l); return l; });
    const horn = lam(0xf2e3c4), spike = lam(0x2a2a2e);
    for (const sd of [-1, 1]) {
      const h = new T.Mesh(new T.ConeGeometry(0.05, 0.22, 8), horn); h.position.set(sd * 0.12, 1.16, 0); h.rotation.z = -sd * 0.5; boss.add(h);
      const pad = new T.Mesh(new T.SphereGeometry(0.11, 10, 8), spike); pad.position.set(sd * 0.24, 0.8, 0); boss.add(pad);
      const sp = new T.Mesh(new T.ConeGeometry(0.04, 0.14, 6), spike); sp.position.set(sd * 0.27, 0.92, 0); boss.add(sp);
    }
    for (const sd of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.028, 8, 6), new T.MeshBasicMaterial({ color: 0xffd23a })); eye.position.set(sd * 0.065, 1.0, 0.155); boss.add(eye);
    }
    boss.userData = { legs, mat: bossMat };
    boss.visible = false; scene.add(boss); W.boss = boss;
  }

  function resize3D(cw, ch, topPx, botPx) {
    if (!renderer) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(cw, ch, false);
    const aspect = cw / ch;
    // keep the whole road in view on narrow phones
    const hfov = 50 * Math.PI / 180;
    camFov = clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180 / Math.PI, 42, 82);
    camera.fov = camFov; camera.aspect = aspect;
    // shift the picture so the squad sits clear of Snapchat's bottom bar
    const shift = (botPx - topPx) * 0.5 + ch * 0.04;
    camera.setViewOffset(cw, ch, 0, shift, cw, ch);
    camera.updateProjectionMatrix();
  }

  // Loads the Bitmoji GLB and makes one animated copy per Bitmoji soldier.
  // If the model ships animations, its run (and idle) clips play; if not,
  // its own leg and arm bones are swung by hand.
  function loadAvatar(url) {
    return new Promise((resolve, reject) => {
      const loader = new T.GLTFLoader();
      if (T.MeshoptDecoder) loader.setMeshoptDecoder(T.MeshoptDecoder);
      loader.load(url, (gltf) => {
        try {
          const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          root.updateMatrixWorld(true);
          let tris = 0;
          root.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            o.frustumCulled = false;
            const g = o.geometry;
            tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
          });
          const box = new T.Box3().setFromObject(root, true), size = box.getSize(new T.Vector3());
          if (!tris || !(size.y > 1e-4)) throw new Error('empty avatar');
          // stand it on the ground, centred, 1.15 units tall
          const k = 1.15 / size.y, c = box.getCenter(new T.Vector3());
          const clips = gltf.animations || [];
          const find = (re) => clips.find((a) => re.test(a.name));
          const runClip = find(/run|sprint|jog/i) || find(/walk/i) || clips[0] || null;
          const idleClip = find(/idle|stand|breath/i) || null;
          const max = clamp(Math.floor(CFG.AVATAR_TRIS / tris), 1, CFG.AVATAR_MAX);
          if (avatar) for (const a of avatar.clones) scene.remove(a.holder);
          const clones = [];
          for (let i = 0; i < max; i++) {
            const model = T.cloneSkinned(root);
            const fit = new T.Group(), holder = new T.Group();
            fit.scale.setScalar(k); fit.position.set(-c.x * k, -box.min.y * k, -c.z * k);
            fit.add(model); holder.add(fit); holder.visible = false; scene.add(holder);
            const a = { holder, mixer: null, run: null, idle: null, bones: null, ph: Math.random() * 6 };
            if (runClip) {
              a.mixer = new T.AnimationMixer(model);
              a.run = a.mixer.clipAction(runClip); a.run.play();
              a.run.time = Math.random() * runClip.duration;
              if (idleClip) { a.idle = a.mixer.clipAction(idleClip); a.idle.play(); a.idle.time = Math.random() * idleClip.duration; }
            } else a.bones = limbBones(model);
            clones.push(a);
          }
          avatar = { max, tris, clones, animated: !!runClip, rigged: !!(clones[0].bones && clones[0].bones.length) };
          resolve(avatar);
        } catch (e) { reject(e); }
      }, undefined, reject);
    });
  }

  // Finds the upper leg and upper arm bones on each side by name, for rigs without clips.
  function limbBones(model) {
    const all = [];
    model.traverse((o) => { if (o.isBone) all.push(o); });
    const side = (n) => (/left/i.test(n) || /(^|[_.\s-])l([_.\s-]|$)/i.test(n) || /^l[A-Z]/.test(n) ? -1
      : /right/i.test(n) || /(^|[_.\s-])r([_.\s-]|$)/i.test(n) || /^r[A-Z]/.test(n) ? 1 : 0);
    const pick = (good, fallback, bad) => {
      const out = [];
      for (const s of [-1, 1]) {
        const ok = (b) => side(b.name) === s && !bad.test(b.name);
        const b = all.find((x) => ok(x) && good.test(x.name)) || all.find((x) => ok(x) && fallback.test(x.name));
        if (b) out.push(b);
      }
      return out;
    };
    const legs = pick(/up(per)?_?leg|thigh/i, /leg/i, /low|fore|calf|shin|foot|toe/i);
    const arms = pick(/up(per)?_?arm/i, /arm|shoulder/i, /low|fore|hand|finger/i);
    return legs.map((bone, i) => ({ bone, rest: bone.quaternion.clone(), kind: 'leg', s: i ? 1 : -1 }))
      .concat(arms.map((bone, i) => ({ bone, rest: bone.quaternion.clone(), kind: 'arm', s: i ? 1 : -1 })));
  }

  const swingQ = new T.Quaternion(), XAXIS = new T.Vector3(1, 0, 0);
  function animateAvatar(a, run, ph, dt) {
    if (a.mixer) {
      // crossfade between run and idle
      const w = run ? 1 : 0;
      a.runW = lerp(a.runW === undefined ? w : a.runW, w, Math.min(1, dt * 8));
      if (a.idle) { a.run.setEffectiveWeight(a.runW); a.idle.setEffectiveWeight(1 - a.runW); a.run.timeScale = 1.25; }
      else a.run.timeScale = run ? 1.25 : 0.15;
      a.mixer.update(dt);
    } else if (a.bones) {
      for (const b of a.bones) {
        const ang = run ? Math.sin(ph) * (b.kind === 'leg' ? 0.75 : -0.55) * b.s : Math.sin(uiT * 2 + b.s) * 0.04;
        b.bone.quaternion.copy(b.rest).multiply(swingQ.setFromAxisAngle(XAXIS, ang));
      }
    }
  }

  let nShadow = 0;
  function putShadow(X, Z, s) {
    if (nShadow >= W.shadow.instanceMatrix.count) return;
    dummy.position.set(X, 0.02, Z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
    W.shadow.setMatrixAt(nShadow++, dummy.matrix);
  }
  // Places one figure: body plus two legs that swing while running.
  function putMan(body, leg, i, X, Z, yaw, s, ph, run, col) {
    const bob = run ? Math.abs(Math.cos(ph)) * 0.07 * s : 0;
    dummy.position.set(X, bob, Z); dummy.rotation.set(run ? 0.12 : 0, yaw, 0, 'YXZ'); dummy.scale.set(s, s, s); dummy.updateMatrix();
    body.setMatrixAt(i, dummy.matrix);
    const sw = run ? Math.sin(ph) * 0.9 : 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let k = 0; k < 2; k++) {
      const side = (k ? 1 : -1) * 0.1 * s;
      dummy.position.set(X + cy * side, 0.44 * s + bob, Z - sy * side);
      dummy.rotation.set(k ? sw : -sw, yaw, 0, 'YXZ'); dummy.updateMatrix();
      leg.setMatrixAt(i * 2 + k, dummy.matrix);
    }
    if (col) { body.setColorAt(i, col); leg.setColorAt(i * 2, col); leg.setColorAt(i * 2 + 1, col); }
    putShadow(X, Z, s);
  }

  const WHITE = new T.Color(0xffffff), ELITE = new T.Color(0.62, 0.5, 0.5), HIT = new T.Color(1.6, 1.6, 1.6);
  const labels = [];           // text to draw on the HUD canvas at projected points

  function render3D() {
    const sx = shake ? rand(-shake, shake) : 0, sy = shake ? rand(-shake, shake) * 0.6 : 0;
    const cx = G.x * XS * 0.45;
    camera.position.set(cx + sx, 6.4 + sy, -8.8);
    camera.lookAt(cx, 1.0, 13);
    W.roadTex.offset.y = (G.dist / 8) % 1;
    W.seaTex.offset.y = (G.dist / 27 + uiT * 0.02) % 1;
    // rail posts and towers slide past
    let n = 0;
    const p0 = -((G.dist) % 7);
    for (let z = p0 - 7; z < 250 && n < 80; z += 7) for (const s of [-1, 1]) {
      dummy.position.set(s * (XS + 1.9), 0.75, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      W.posts.setMatrixAt(n++, dummy.matrix);
    }
    W.posts.count = n; W.posts.instanceMatrix.needsUpdate = true;
    const tFirst = Math.ceil((G.dist - 30 - 70) / 150) * 150 + 70;
    frameDt = Math.max(0, uiT - (render3D.last || uiT)); render3D.last = uiT;
    W.towers.forEach((g, i) => { g.position.z = tFirst + i * 150 - G.dist; });

    nShadow = 0; labels.length = 0;
    // the squad
    const drawn = Math.min(G.n, MAX_DRAWN);
    const bm = avatar ? Math.min(drawn, avatar.max) : 0;
    const run = G.running && !(G.wall && !G.wallDone);
    const grow = 1 + G.bump * 0.6;
    let nb = 0;
    for (let i = 0; i < drawn; i++) {
      const sp = SPOTS[i], X = G.x * XS + sp.x, Z = sp.z, ph = G.t * 13 + i * 1.7;
      if (i < bm) {
        const a = avatar.clones[i];
        // animated Bitmoji only bob a little; a static model hops along
        const moving = avatar.animated || avatar.rigged;
        const hop = run ? Math.abs(Math.sin(ph * 0.5)) * (moving ? 0.05 : 0.22) : 0;
        a.holder.visible = true;
        a.holder.position.set(X, hop, Z);
        a.holder.rotation.set(run ? 0.08 : 0, G.face + CFG.AVATAR_YAW, run && !moving ? Math.sin(ph * 0.5) * 0.1 : 0, 'YXZ');
        a.holder.scale.setScalar(grow);
        animateAvatar(a, run, ph * 0.8, frameDt);
        putShadow(X, Z, 1);
      } else putMan(W.soldBody, W.soldLeg, nb++, X, Z, G.face, grow, ph, run);
    }
    if (avatar) for (let i = bm; i < avatar.clones.length; i++) avatar.clones[i].holder.visible = false;
    W.soldBody.count = nb; W.soldLeg.count = nb * 2;
    W.soldBody.instanceMatrix.needsUpdate = W.soldLeg.instanceMatrix.needsUpdate = true;

    // everything on the bridge
    let nf = 0, np = 0, nt = 0, ngp = 0, bossShown = false;
    for (const e of G.active) {
      const z = e.z - G.dist, X = (e.x || 0) * XS;
      if (e.kind === 'foe') {
        if (e.dead || nf >= MAX_FOES || z > 200) continue;
        const s = (e.elite ? 2.3 : 1) * (e.flash > 0 ? 1.12 : 1);
        putMan(W.foeBody, W.foeLeg, nf++, X, z, Math.PI, s, e.ph, e.awake, e.flash > 0 ? HIT : e.elite ? ELITE : WHITE);
        if (e.elite && z < 120) labels.push({ X, Y: 2.75, Z: z, txt: fmt(Math.ceil(e.hp)), size: 0.62, col: '#fff' });
      } else if (e.kind === 'gate') {
        for (const seg of e.segs) {
          if (np >= W.panels.length) break;
          const m = W.panels[np++], w = (seg.x2 - seg.x1) * XS, good = seg.v >= 0;
          m.visible = true; m.position.set((seg.x1 + seg.x2) / 2 * XS, 1.05, z); m.scale.set(w - 0.12, 2.1, 1);
          m.material.color.set(good ? 0x38bdf8 : 0xef2b36);
          m.material.opacity = e.used ? (seg.taken ? 0.22 : 0.1) : 0.52 + seg.pulse * 1.6;
          const pc = tmpC.set(good ? 0x1fa8e0 : 0xc81e28);
          for (const px of [seg.x1, seg.x2]) {
            if (ngp >= 40) break;
            dummy.position.set(px * XS, 1.15, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
            W.gposts.setMatrixAt(ngp, dummy.matrix); W.gposts.setColorAt(ngp++, pc);
          }
          if (!e.used && z < 190) labels.push({ X: m.position.x, Y: 1.1, Z: z, txt: seg.v >= e.cap ? 'MAX +' + seg.v : (seg.v >= 0 ? '+' : '') + seg.v, size: Math.min(1.25, w * 0.34) * (1 + seg.pulse * 1.5), col: '#fff', max: w });
        }
      } else if (e.kind === 'tire') {
        if (e.dead || nt >= W.tires.length) continue;
        const g = W.tires[nt++], s = 1.45 * (e.flash > 0 ? 1.08 : 1);
        g.visible = true; g.position.set(X, 0.92 * s + Math.abs(Math.sin(e.rot * 0.6)) * 0.12, z); g.scale.set(s, s, s);
        g.userData.spin.rotation.x = -e.rot;
        putShadow(X, z, 3.6);
        if (z < 130) labels.push({ X, Y: 0.25, Z: z - 1.2, txt: fmt(Math.ceil(e.hp)), size: 0.8, col: '#ff5a4a', stroke: '#fff' });
      } else if (e.kind === 'boss') {
        if (e.dead) continue;
        const g = W.boss, s = 5.6 * (e.flash > 0 ? 1.03 : 1), walk = e.awake && z > 2.6;
        g.visible = true; bossShown = true;
        g.position.set(X, walk ? Math.abs(Math.cos(e.ph * 1.6)) * 0.2 : 0, z);
        g.rotation.set(e.stomp > 0 ? 0.18 : 0, Math.PI, 0, 'YXZ'); g.scale.setScalar(s);
        const sw = walk ? Math.sin(e.ph * 1.6) * 0.6 : 0;
        g.userData.legs[0].rotation.x = sw; g.userData.legs[1].rotation.x = -sw;
        g.userData.mat.emissive.setHex(e.flash > 0 ? 0x664444 : 0x000000);
        putShadow(X, z, 5.8);
        if (z < 180) labels.push({ X, Y: 7.2, Z: z, txt: fmt(Math.ceil(e.hp)), size: 1.3, col: '#fff' });
      }
    }
    W.foeBody.count = nf; W.foeLeg.count = nf * 2;
    W.foeBody.instanceMatrix.needsUpdate = W.foeLeg.instanceMatrix.needsUpdate = true;
    if (W.foeBody.instanceColor) W.foeBody.instanceColor.needsUpdate = true;
    if (W.foeLeg.instanceColor) W.foeLeg.instanceColor.needsUpdate = true;
    for (let i = np; i < W.panels.length; i++) W.panels[i].visible = false;
    for (let i = nt; i < W.tires.length; i++) W.tires[i].visible = false;
    if (!bossShown) W.boss.visible = false;
    W.gposts.count = ngp; W.gposts.instanceMatrix.needsUpdate = true; if (W.gposts.instanceColor) W.gposts.instanceColor.needsUpdate = true;
    W.shadow.count = nShadow; W.shadow.instanceMatrix.needsUpdate = true;

    // bullets
    n = 0;
    for (const b of G.bullets) {
      if (n >= 160) break;
      dummy.position.set(b.x * XS, 0.78, b.z); dummy.rotation.set(0, Math.atan2(b.vx * XS, b.vz), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      W.bullets.setMatrixAt(n++, dummy.matrix);
    }
    W.bullets.count = n; W.bullets.instanceMatrix.needsUpdate = true;
    // coins pop up and spin
    n = 0;
    for (const c of G.coins) {
      if (n >= 80) break;
      const k = c.t / 0.8, s = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
      dummy.position.set(c.x * XS, 0.6 + Math.sin(Math.min(1, k * 1.3) * Math.PI) * 1.5, c.z); dummy.rotation.set(0, c.t * 12, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
      W.coins.setMatrixAt(n++, dummy.matrix);
    }
    W.coins.count = n; W.coins.instanceMatrix.needsUpdate = true;
    // particles
    n = 0;
    for (const p of G.parts) {
      if (n >= 320) break;
      const s = p.r * clamp(p.life / p.max * 1.6, 0, 1);
      dummy.position.set(p.x, Math.max(0.05, p.y), p.z); dummy.rotation.set(p.life * 9, p.life * 7, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
      W.parts.setMatrixAt(n, dummy.matrix); W.parts.setColorAt(n++, tmpC.set(p.col));
    }
    W.parts.count = n; W.parts.instanceMatrix.needsUpdate = true; if (W.parts.instanceColor) W.parts.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);
  }

  // Projects a world point onto the HUD canvas; k is HUD px per world unit there.
  const pv = new T.Vector3();
  function project(X, Y, Z) {
    pv.set(X, Y, Z).applyMatrix4(camera.matrixWorldInverse);
    const depth = -pv.z;
    if (depth < 1) return null;
    pv.applyMatrix4(camera.projectionMatrix);
    return { x: (pv.x * 0.5 + 0.5) * VW - offX, y: (-pv.y * 0.5 + 0.5) * LH, k: LH / (2 * Math.tan(camFov * Math.PI / 360) * depth) };
  }

  // ================================================================ input
  let buttons = [];
  let pressed = null;
  let drag = null;
  const keys = { left: false, right: false };
  function toLogical(e) { return { x: e.clientX / scale - offX, y: e.clientY / scale }; }
  function hitButton(p) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i];
      if (p.x >= b.x - 5 && p.x <= b.x + b.w + 5 && p.y >= b.y - 5 && p.y <= b.y + b.h + 5) return b;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    const p = toLogical(e);
    const b = hitButton(p);
    if (b) { pressed = { id: b.id, pid: e.pointerId }; return; }
    if ((screen === 'menu' || screen === 'play') && !paused && !drag) {
      drag = { id: e.pointerId, lx: p.x };
      if (screen === 'menu') startRun();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toLogical(e);
    if (G && G.running) G.tx += (p.x - drag.lx) / 200 * 1.15;
    drag.lx = p.x;
  });
  function pointerEnd(e, cancel) {
    if (pressed && e.pointerId === pressed.pid) {
      const b = hitButton(toLogical(e));
      if (!cancel && b && b.id === pressed.id) uiAction(b.id);
      pressed = null;
    }
    if (drag && e.pointerId === drag.id) drag = null;
  }
  canvas.addEventListener('pointerup', (e) => pointerEnd(e, false));
  canvas.addEventListener('pointercancel', (e) => pointerEnd(e, true));
  window.addEventListener('blur', () => { drag = null; pressed = null; keys.left = keys.right = false; });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; initAudio(); if (screen === 'menu') startRun(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; initAudio(); if (screen === 'menu') startRun(); }
    else if (e.code === 'Space' || e.code === 'Enter') {
      initAudio();
      if (screen === 'menu') startRun();
      else if ((screen === 'win' || screen === 'lose') && G.panel > 0.6) uiAction('next');
      else if (paused) uiAction('resume');
    } else if ((e.code === 'Escape' || e.code === 'KeyP') && screen === 'play') paused = !paused;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (screen === 'play') paused = true;
      drag = null; pressed = null; keys.left = keys.right = false;
      writeSave();
      if (audio) audio.suspend().catch(() => {});
    } else if (audio) audio.resume().catch(() => {});
  });

  function uiAction(id) {
    if (id.indexOf('up:') === 0) {
      const k = id.slice(3), cost = upCost(k);
      if (S.coins < cost) { SFX.deny(); toast('Not enough coins'); return; }
      S.coins -= cost; S.up[k]++;
      if (k === 'squad') G.n = startSquad();
      G.pop = 0.3; G.popKey = k;
      writeSave(); SFX.buy();
      return;
    }
    SFX.click();
    if (id === 'next' || id === 'home') toMenu();
    else if (id === 'pause') paused = true;
    else if (id === 'resume') paused = false;
    else if (id === 'sound') setMuted(!S.muted);
    else if (id === 'lb') showLeaderboard();
  }

  // ================================================================ HUD
  function text(str, x, y, size, col, align = 'center', stroke = null, sw = 0) {
    ctx.font = `${size}px ${FD}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(str, x, y); }
    ctx.fillStyle = col; ctx.fillText(str, x, y);
  }
  // Cartoon lettering with a dark outline, used all over the game.
  const label = (str, x, y, size, col = '#fff', align = 'center', stroke = '#17222e') => text(str, x, y, size, col, align, stroke, Math.max(3, size * 0.22));

  function drawWorldLabels() {
    for (const l of labels) {
      const p = project(l.X, l.Y, l.Z);
      if (!p) continue;
      const size = l.size * p.k;
      if (size < 7) continue;
      label(l.txt, p.x, p.y, Math.min(size, 120), l.col, 'center', l.stroke || '#17222e');
    }
    for (const f of G.floats) {
      const p = project(f.x * XS, f.y + f.t * 1.4, f.z);
      if (!p) continue;
      ctx.globalAlpha = clamp(2 - f.t * 2, 0, 1);
      const k = f.t < 0.15 ? backOut(f.t / 0.15) : 1;
      label(f.txt, clamp(p.x, 70, LW - 70), p.y, f.size * k, f.col);
    }
    ctx.globalAlpha = 1;
  }

  function button(id, x, y, w, h, lbl, top, bottom, edge, size = 24) {
    buttons.push({ id, x, y, w, h });
    const down = pressed && pressed.id === id;
    const lift = down ? 1 : 6;
    ctx.fillStyle = edge; rr(x, y, w, h, 16); ctx.fill();
    const fy = y + 6 - lift;
    const g = ctx.createLinearGradient(0, fy, 0, fy + h - 6);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; rr(x, fy, w, h - 6, 16); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(x + 5, fy + 4, w - 10, (h - 6) * 0.38, 11); ctx.fill();
    ctx.strokeStyle = '#17222e'; ctx.lineWidth = 3; rr(x, y, w, h, 16); ctx.stroke();
    if (lbl) label(lbl, x + w / 2, fy + (h - 6) / 2 + 1, size);
    return fy;
  }
  function iconButton(id, x, y, kind, blue) {
    const fy = blue ? button(id, x, y, 46, 46, null, '#5db4ff', '#2a86e8', '#17509a') : button(id, x, y, 46, 46, null, '#f5f8fb', '#cfd8e0', '#8795a3');
    ctx.save(); ctx.translate(x + 23, fy + 20);
    const ink = blue ? '#fff' : '#17222e';
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'pause') { rr(-8, -9, 6, 18, 2); ctx.fill(); rr(2, -9, 6, 18, 2); ctx.fill(); }
    else if (kind === 'trophy') {
      ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(7, 0); ctx.quadraticCurveTo(0, 6, -7, 0); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(-8, -5, 4.5, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(8, -5, 4.5, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
      ctx.fillRect(-2, 2, 4, 6); ctx.fillRect(-7, 8, 14, 3);
    } else {
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-5, -4); ctx.lineTo(2, -10); ctx.lineTo(2, 10); ctx.lineTo(-5, 4); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
      if (kind === 'mute') { ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(13, 5); ctx.moveTo(13, -5); ctx.lineTo(6, 5); ctx.stroke(); }
      else { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(3, 0, 6, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(3, 0, 11, -0.8, 0.8); ctx.stroke(); }
    }
    ctx.restore();
  }
  function coinIcon(x, y, r) {
    ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(x, y + r * 0.12, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe98a'; ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  function coinCounter() {
    const txt = fmt(S.coins);
    ctx.font = `22px ${FD}`;
    const w = ctx.measureText(txt).width + 58, x = LW - 12 - w, y = ST + 10;
    ctx.fillStyle = '#17222e'; rr(x - 3, y - 3, w + 6, 44, 10); ctx.fill();
    ctx.fillStyle = '#1e7fd6'; rr(x, y, w, 38, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; rr(x + 4, y + 3, w - 8, 14, 5); ctx.fill();
    label(txt, x + 12, y + 20, 22, '#fff', 'left');
    coinIcon(x + w - 16, y + 18, 20);
    return x;
  }
  function soldierIcon(x, y, k) {
    ctx.fillStyle = '#1e7fd6'; rr(x - k * 0.17, y - k * 0.42, k * 0.15, k * 0.42, k * 0.06); ctx.fill(); rr(x + k * 0.02, y - k * 0.42, k * 0.15, k * 0.42, k * 0.06); ctx.fill();
    ctx.fillStyle = '#a9b8c2'; rr(x - k * 0.22, y - k * 0.8, k * 0.44, k * 0.44, k * 0.14); ctx.fill();
    ctx.fillStyle = '#2196f3'; ctx.beginPath(); ctx.arc(x, y - k * 0.9, k * 0.18, 0, Math.PI * 2); ctx.fill();
  }

  function upIcon(k, x, y) {
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (k === 'rate') {
      for (let i = 0; i < 3; i++) {
        const oy = -14 + i * 14, ox = 8 - i * 6;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox - 30, oy + 14); ctx.lineTo(ox - 6, oy + 2); ctx.stroke();
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(-0.45);
        ctx.fillStyle = '#c8872a'; rr(-7, -4, 14, 8, 2); ctx.fill();
        ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.moveTo(7, -4); ctx.lineTo(15, 0); ctx.lineTo(7, 4); ctx.fill();
        ctx.restore();
      }
    } else if (k === 'dmg') {
      ctx.fillStyle = '#d9e2ea'; rr(-22, -12, 40, 13, 3); ctx.fill();
      ctx.fillStyle = '#aab6c2'; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-6, 0); ctx.lineTo(-10, 20); ctx.lineTo(-22, 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 5 : 11; ctx.lineTo(24 + Math.cos(a) * r, -6 + Math.sin(a) * r); } ctx.fill();
    } else if (k === 'rev') {
      coinIcon(-10, 8, 13); coinIcon(10, 8, 13); coinIcon(0, -8, 13);
    } else {
      soldierIcon(-14, 16, 30); soldierIcon(14, 16, 30); soldierIcon(0, 24, 36);
    }
    ctx.restore();
  }

  function drawMenu() {
    coinCounter();
    iconButton('sound', 12, ST + 8, S.muted ? 'mute' : 'sound');
    if (lbSupported) iconButton('lb', 66, ST + 8, 'trophy');
    text('Level ' + S.level, LW / 2, ST + 88, 44, '#17222e', 'center', '#ffffff', 8);
    // how to play, like the original's hint bar
    const hy = ST + 142;
    ctx.fillStyle = 'rgba(23,34,46,0.72)'; rr(LW / 2 - 168, hy - 24, 336, 48, 12); ctx.fill();
    label('DRAG', LW / 2 - 112, hy + 1, 20);
    const sw = Math.sin(uiT * 3.4) * 4;
    for (const d of [-1, 1]) {
      const ax = LW / 2 - 34 + d * 24 + d * Math.max(0, d * sw);
      ctx.fillStyle = '#fff'; rr(ax - 19, hy - 17, 38, 34, 7); ctx.fill();
      ctx.strokeStyle = '#17222e'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(ax - d * 9, hy); ctx.lineTo(ax + d * 9, hy); ctx.moveTo(ax + d * 2, hy - 7); ctx.lineTo(ax + d * 9, hy); ctx.lineTo(ax + d * 2, hy + 7); ctx.stroke();
    }
    label('TO START', LW / 2 + 92, hy + 1, 20);
    // upgrade cards, just above Snapchat's bottom bar
    const cw = 122, gap = 8, total = cw * 4 + gap * 3, x0 = LW / 2 - total / 2, y = LH - SB - 176;
    UP_KEYS.forEach((k, i) => {
      const u = UP[k], x = x0 + i * (cw + gap), cost = upCost(k), can = S.coins >= cost;
      const popK = G.pop > 0 && G.popKey === k ? 1 + G.pop * 0.25 : 1;
      buttons.push({ id: 'up:' + k, x, y, w: cw, h: 168 });
      const down = pressed && pressed.id === 'up:' + k;
      ctx.save(); ctx.translate(x + cw / 2, y + 84 + (down ? 3 : 0)); ctx.scale(popK, popK); ctx.translate(-cw / 2, -84);
      ctx.fillStyle = '#17222e'; rr(-3, -3, cw + 6, 174, 14); ctx.fill();
      ctx.fillStyle = can ? u.dark : '#55606b'; rr(0, 0, cw, 168, 12); ctx.fill();
      ctx.fillStyle = can ? u.col : '#7c8792'; rr(0, 0, cw, 30, 12); ctx.fill(); ctx.fillRect(0, 16, cw, 14);
      label(u.name, cw / 2, 16, 14);
      const g = ctx.createLinearGradient(0, 34, 0, 100);
      g.addColorStop(0, can ? u.col : '#8a949e'); g.addColorStop(1, can ? u.dark : '#55606b');
      ctx.fillStyle = g; rr(5, 34, cw - 10, 64, 8); ctx.fill();
      upIcon(k, cw / 2, 66);
      // five pips fill up, then the badge number climbs
      for (let p = 0; p < 5; p++) {
        ctx.fillStyle = p < S.up[k] % 5 ? (can ? '#eaffd0' : '#d0d6dc') : 'rgba(0,0,0,0.3)';
        rr(7 + p * ((cw - 14) / 5), 102, (cw - 14) / 5 - 3, 9, 3); ctx.fill();
      }
      ctx.fillStyle = '#17222e'; ctx.beginPath(); ctx.arc(cw - 6, 2, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cw - 6, 2, 12, 0, Math.PI * 2); ctx.fill();
      text(String(S.up[k] + 1), cw - 6, 3, 13, '#17222e');
      ctx.fillStyle = can ? '#8a3fe0' : '#3f4852'; rr(5, 116, cw - 10, 46, 9); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; rr(8, 119, cw - 16, 16, 6); ctx.fill();
      label('UPGRADE', cw / 2, 129, 13);
      ctx.font = `15px ${FD}`;
      const pw = ctx.measureText(fmt(cost)).width;
      coinIcon(cw / 2 - pw / 2 - 6, 149, 7);
      label(fmt(cost), cw / 2 + 8, 150, 15, can ? '#ffe14a' : '#aeb6be');
      ctx.restore();
    });
    G.pop = Math.max(0, G.pop - 1 / 60);
  }

  function drawHUD() {
    const cx = coinCounter();
    iconButton('pause', 12, ST + 8, 'pause', true);
    if (G.earned > 0) label('+' + fmt(G.earned), LW - 16, ST + 66, 18, '#ffe14a', 'right');
    // progress bar between the pause button and the coins
    const x = 78, w = Math.max(80, cx - 20 - x), y = ST + 22;
    const p = clamp(G.dist / G.length, 0, 1);
    ctx.fillStyle = '#17222e'; rr(x - 3, y - 3, w + 6, 22, 6); ctx.fill();
    ctx.fillStyle = '#dfe7ee'; rr(x, y, w, 16, 4); ctx.fill();
    ctx.fillStyle = '#2f8fe6'; rr(x, y, Math.max(8, w * p), 16, 4); ctx.fill();
    text(Math.round(p * 100) + '%', x + w / 2, y + 9, 11, '#17222e');
    // boss health
    const B = G.boss;
    if (G.wall && B && !B.dead) {
      const bw = 300, bx = LW / 2 - bw / 2, by = y + 66;
      ctx.fillStyle = '#17222e'; rr(bx - 4, by - 4, bw + 8, 30, 8); ctx.fill();
      ctx.fillStyle = '#4a1418'; rr(bx, by, bw, 22, 6); ctx.fill();
      const q = clamp(B.hp / B.max, 0, 1);
      ctx.fillStyle = B.flash > 0 ? '#ff8a8a' : '#ff3b3b'; rr(bx, by, Math.max(10, bw * q), 22, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(bx + 3, by + 2, Math.max(4, bw * q - 6), 7, 3); ctx.fill();
      label('BOSS  ' + fmt(Math.max(0, Math.ceil(B.hp))), LW / 2, by + 12, 15);
    }
    // squad size
    soldierIcon(x + w / 2 - 26, y + 50, 26);
    label(String(G.n), x + w / 2 - 6, y + 39, 22, G.hurt > 0 ? '#ff6a6a' : '#fff', 'left');
  }

  function panel(x, y, w, h, top) {
    ctx.fillStyle = '#17222e'; rr(x - 4, y - 4, w + 8, h + 10, 24); ctx.fill();
    ctx.fillStyle = '#eaf3fb'; rr(x, y, w, h, 20); ctx.fill();
    ctx.fillStyle = top; rr(x, y, w, 70, 20); ctx.fill(); ctx.fillRect(x, y + 40, w, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; rr(x + 6, y + 5, w - 12, 22, 12); ctx.fill();
  }

  function drawEnd(win) {
    const t = clamp(G.panel / 0.3, 0, 1);
    ctx.fillStyle = `rgba(10,20,34,${0.5 * t})`; ctx.fillRect(-offX, 0, VW, LH);
    const w = 380, h = 380, x = LW / 2 - w / 2;
    const y = ST + Math.max(20, (LH - SB - ST - h) * 0.4) + (1 - backOut(t)) * 70;
    ctx.globalAlpha = t;
    panel(x, y, w, h, win ? '#1e9fe6' : '#e0353f');
    label(win ? 'LEVEL ' + G.cleared + ' CLEAR!' : 'SQUAD LOST', LW / 2, y + 36, 30);
    const shown = Math.round(G.earned * ease(clamp((G.panel - 0.3) / 0.8, 0, 1)));
    coinIcon(LW / 2 - 74, y + 124, 24);
    text(fmt(shown), LW / 2 - 40, y + 126, 48, '#17222e', 'left');
    text('COINS THIS RUN', LW / 2, y + 168, 13, '#5a6b7c');
    const stats = [['KILLS', G.kills], ['BIGGEST SQUAD', G.peak], [win ? 'BONUS' : 'REACHED', win ? '+' + fmt(G.bonus) : Math.round(clamp(G.dist / G.length, 0, 1) * 100) + '%']];
    const sw = (w - 48 - 16) / 3;
    stats.forEach((s, i) => {
      const sx = x + 24 + i * (sw + 8);
      ctx.fillStyle = '#d3e2ef'; rr(sx, y + 190, sw, 58, 12); ctx.fill();
      text(s[0], sx + sw / 2, y + 206, 10, '#5a6b7c');
      text(String(s[1]), sx + sw / 2, y + 230, 20, '#17222e');
    });
    if (t >= 1) {
      const pulse = 1 + Math.sin(uiT * 5) * 0.02;
      ctx.save(); ctx.translate(LW / 2, y + 304); ctx.scale(pulse, pulse); ctx.translate(-LW / 2, -(y + 304));
      if (win) button('next', x + 24, y + 268, w - 48, 74, 'NEXT', '#5fd0ff', '#1e9fe6', '#1466a0', 32);
      else button('next', x + 24, y + 268, w - 48, 74, 'UPGRADE & RETRY', '#ffd84a', '#ff9a1a', '#b05a0a', 24);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(10,20,34,0.55)'; ctx.fillRect(-offX, 0, VW, LH);
    const w = 320, h = 300, x = LW / 2 - w / 2, y = ST + (LH - SB - ST - h) * 0.4;
    panel(x, y, w, h, '#1e9fe6');
    label('PAUSED', LW / 2, y + 36, 30);
    button('resume', x + 24, y + 88, w - 48, 64, 'RESUME', '#5fe07a', '#28b04a', '#167a30');
    button('sound', x + 24, y + 162, w - 48, 54, S.muted ? 'SOUND OFF' : 'SOUND ON', '#6fb6ff', '#2a7fe0', '#1a4f9a', 20);
    button('home', x + 24, y + 226, w - 48, 54, 'QUIT RUN', '#b8c4cf', '#8795a3', '#5a6672', 20);
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * scale * dpr, 0);
    buttons = [];
    if (screen === 'loading' || !G) {
      label('LOADING…', LW / 2, LH / 2, 28);
    } else {
      render3D();
      drawWorldLabels();
      if (G.hurt > 0) { ctx.fillStyle = `rgba(255,40,40,${G.hurt * 0.6})`; ctx.fillRect(-offX, 0, VW, LH); }
      if (screen === 'menu') drawMenu();
      else if (screen === 'play') { drawHUD(); if (paused) { buttons = []; drawPause(); } }
      else { drawHUD(); buttons = []; drawEnd(screen === 'win'); }
    }
    if (toastMsg) {
      ctx.globalAlpha = clamp(toastMsg.t * 2, 0, 1);
      ctx.font = `15px ${FD}`;
      const w = ctx.measureText(toastMsg.msg).width + 40;
      ctx.fillStyle = 'rgba(23,34,46,0.9)'; rr(LW / 2 - w / 2, LH - SB - 230, w, 38, 19); ctx.fill();
      text(toastMsg.msg, LW / 2, LH - SB - 210, 15, '#fff');
      ctx.globalAlpha = 1;
    }
    if (SHOW_SAFE) {
      ctx.fillStyle = 'rgba(255,0,0,0.25)';
      ctx.fillRect(-offX, 0, VW, ST); ctx.fillRect(-offX, LH - SB, VW, SB);
    }
  }

  // ================================================================ loop
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  if (DEBUG) {
    window.__bw = {
      get G() { return G; }, get screen() { return screen; }, S: () => S, get buttons() { return buttons; }, get avatar() { return avatar; },
      startRun, toMenu, uiAction, squadR, buildLevel, loadAvatar, step: (dt) => update(dt),
    };
  }
  if (DEBUG && CAPTURE) {
    Object.assign(window.__bw, {
      frame(dt) { clock += dt; update(dt); draw(); },
      offlineAudio(sec) {
        audio = new OfflineAudioContext(2, Math.ceil(48000 * sec), 48000);
        master = audio.createGain(); master.gain.value = 0.8; master.connect(audio.destination);
        noiseBuf = audio.createBuffer(1, 48000, 48000);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      },
      async renderWav() {
        const buf = await audio.startRendering();
        const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
        const out = new DataView(new ArrayBuffer(44 + n * 4));
        const str = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
        str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
        out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
        out.setUint32(24, 48000, true); out.setUint32(28, 48000 * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
        str(36, 'data'); out.setUint32(40, n * 4, true);
        for (let i = 0; i < n; i++) {
          out.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true);
          out.setInt16(46 + i * 4, clamp(R[i], -1, 1) * 32767, true);
        }
        const bytes = new Uint8Array(out.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
    });
  }
  boot();
  if (!CAPTURE) requestAnimationFrame(frame);
})();
