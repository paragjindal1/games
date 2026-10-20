/* Javelin Duel: a tower-to-tower javelin fight, built as a Snapchat Web Lens.
 * Drag back and release to throw. Knock rivals off their towers, chain hits
 * into combos, shoot orbs for power-ups, and unlock new skins by reaching
 * later rounds. Everything is drawn in code; the only bundled asset is one font. */
(() => {
  'use strict';

  // ================================================================ config
  const CFG = {
    // Snapchat draws its own controls over the top and bottom of a Lens.
    // All UI and gameplay stay inside these fractions of the screen height
    // (or the device's safe-area insets, whichever is larger). Add #safe to
    // the URL to see the zone.
    SAFE_TOP: 0.12,
    SAFE_BOTTOM: 0.16,
  };
  const LW = 540;               // logical width
  const MIN_CONTENT_H = 780;    // logical height the game needs inside the safe zone
  const HUD_H = 170;            // space the HUD keeps clear at the top of the safe zone
  const GRAV = 980;             // javelin gravity, units/s²
  const WIND_A = 150;           // sideways acceleration at full wind
  const JAV = 78;               // javelin length
  const FS = 1.3;               // fighter size
  const TW = 32;                // tower half width
  const V_MIN = 220, V_MAX = 880;
  const PULL_FULL = 170;        // drag distance for full power
  const RELOAD = 0.55;
  const DMG = { head: 70, body: 38, legs: 24 };
  const PLAYER_X = 74;

  const SKINS = [
    { id: 'shadow', name: 'SHADOW', round: 0, band: '#1a1a1a', jav: '#1b1b1b', tip: '#6d6d6d' },
    { id: 'crimson', name: 'CRIMSON', round: 3, band: '#d42a2a', jav: '#2b1515', tip: '#ff4a4a' },
    { id: 'frost', name: 'FROST', round: 6, band: '#38b4f0', jav: '#15303e', tip: '#a8e8ff', trail: '#9fe0ff' },
    { id: 'gold', name: 'GOLD', round: 10, band: '#f2b632', jav: '#3a2c0c', tip: '#ffd75e', trail: '#ffd75e' },
    { id: 'inferno', name: 'INFERNO', round: 15, band: '#ff6a1a', jav: '#2a1208', tip: '#ffb03a', trail: '#ff8a2a' },
  ];
  const ENEMY_SKIN = { band: '#2b2b2b', jav: '#1b1b1b', tip: '#6d6d6d' };
  const CHAMP_SKIN = { band: '#b3121a', jav: '#1b1b1b', tip: '#c4161c' };
  const NAMES = ['RONIN', 'VIPER', 'GHOST', 'TALON', 'RAVEN', 'BLADE', 'FANG', 'SHADE', 'HAWK', 'ONYX', 'KESTREL', 'WRAITH'];
  const PICKUPS = {
    heart: { col: '#ff4a52', label: 'HEAL' },
    fire: { col: '#ff8a1f', label: 'FIRE' },
    ice: { col: '#5cc8ff', label: 'ICE' },
    triple: { col: '#f4f4f2', label: 'TRIPLE' },
    shield: { col: '#7cf0c8', label: 'SHIELD' },
  };

  // UI palette
  const C = {
    panel: 'rgba(16,18,20,0.84)', panelHi: 'rgba(255,255,255,0.07)',
    white: '#f4f4f2', mute: '#9aa0a6', red: '#e23b3b', redD: '#9e1f1f',
    gold: '#ffc83d', green: '#41d35a', dark: '#2a2e32', darkD: '#16191b',
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const snap = window.snapchat || null;
  const SHOW_SAFE = /safe/.test(location.hash);
  const DEBUG = /debug/.test(location.hash);
  const FD = '"Russo One", "Arial Black", Impact, system-ui, sans-serif';

  let dpr = 1, scale = 1, offX = 0, VW = LW, LH = 960, ST = 0, SB = 0, groundY = 800;
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
    groundY = LH - SB - 12;
    buildBackground();
  }

  // ================================================================ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const backOut = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;
  function mulberry(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function segSegDist(a, b, c, d) {
    return Math.min(
      segDist(a.x, a.y, c.x, c.y, d.x, d.y), segDist(b.x, b.y, c.x, c.y, d.x, d.y),
      segDist(c.x, c.y, a.x, a.y, b.x, b.y), segDist(d.x, d.y, a.x, a.y, b.x, b.y));
  }
  function powColor(p) {
    const g = [65, 211, 90], y = [255, 200, 61], r = [226, 59, 59];
    const [a, b, t] = p < 0.5 ? [g, y, p * 2] : [y, r, (p - 0.5) * 2];
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
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

  // ================================================================ save / Snap API
  const freshSave = () => ({ v: 2, best: 0, bestRound: 1, muted: false, tut: true, skin: 'shadow', seenOrb: false });
  let S = freshSave();
  let saveLoaded = false, lbSupported = false;
  let savePending = Promise.resolve();

  async function boot() {
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
    }
    await fontsReady;
    if (saved && saved.v === 2) S = Object.assign(freshSave(), saved);
    else if (saved && saved.v === 1) S = Object.assign(freshSave(), { muted: !!saved.muted, tut: saved.tut !== false });
    if (!skinUnlocked(skinById(S.skin))) S.skin = 'shadow';
    setupScene();
    screen = 'title';
  }

  function writeSave() {
    if (!saveLoaded || !snap) return;
    const state = JSON.parse(JSON.stringify(S));
    savePending = savePending
      .then(() => snap.storage.set('save', state))
      .then(() => true, (e) => { console.warn('Save failed:', e && e.message); return false; });
  }
  function submitScore(score) {
    if (!lbSupported || score <= 0) return Promise.resolve();
    return snap.leaderboards.submitScore({ score: Math.round(score) })
      .catch((e) => console.warn('Leaderboard submit failed:', e && e.message));
  }
  async function showLeaderboard() {
    if (!lbSupported) { toast('Leaderboard is not available here'); return; }
    try {
      if (S.best > 0) await snap.leaderboards.submitScore({ score: Math.round(S.best) });
      await snap.leaderboards.show();
      // The desktop stub accepts the call but has no panel to open.
      if (snap.isStub) toast('Score sent · the leaderboard opens inside Snapchat');
    } catch (e) {
      console.warn('Leaderboard unavailable:', e && e.message);
      toast('Leaderboard unavailable right now');
    }
  }

  const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];
  const skinUnlocked = (s) => S.bestRound >= s.round;
  const nextUnlock = () => SKINS.find((s) => !skinUnlocked(s)) || null;

  // ================================================================ audio
  let audio = null, master = null, noiseBuf = null;
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
    const t = audio.currentTime + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.3, f0 = 1200, f1 = 0, q = 1, type = 'bandpass', delay = 0) {
    if (!audio || S.muted) return;
    const t = audio.currentTime + delay;
    const s = audio.createBufferSource(); s.buffer = noiseBuf;
    const f = audio.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  const SFX = {
    throw(p) { noise(0.32, 0.22 + p * 0.15, 600, 2600, 2.2); tone(180, 0.12, 'triangle', 0.08, 0.6); },
    thunk() { tone(140, 0.12, 'sine', 0.35, 0.45); noise(0.06, 0.25, 2200, 600, 1.4); },
    hit() { noise(0.18, 0.45, 900, 200, 0.8, 'lowpass'); tone(95, 0.2, 'sine', 0.4, 0.5); },
    head() { SFX.hit(); tone(1320, 0.18, 'square', 0.06, 0.8, 0.02); tone(1760, 0.22, 'sine', 0.1, 1, 0.05); },
    clash() { tone(1250, 0.35, 'square', 0.07, 0.95); tone(1870, 0.3, 'sine', 0.12, 0.98); noise(0.08, 0.3, 5000, 0, 1, 'highpass'); },
    power() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.13, 1, i * 0.06)); },
    heal() { [660, 880, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, 1, i * 0.07)); },
    steal() { tone(300, 0.25, 'sawtooth', 0.06, 0.5); },
    freeze() { tone(2400, 0.4, 'sine', 0.08, 0.5); noise(0.3, 0.2, 6000, 2000, 2, 'bandpass'); },
    burn() { noise(0.5, 0.25, 400, 1600, 0.8, 'bandpass'); },
    block() { tone(520, 0.3, 'sine', 0.2, 1.6); noise(0.12, 0.2, 3000, 0, 1, 'highpass'); },
    combo(n) { tone(440 * Math.pow(1.12, Math.min(n, 12)), 0.1, 'square', 0.05); },
    ko() { tone(60, 0.6, 'sine', 0.5, 0.5); noise(0.5, 0.35, 200, 60, 0.7, 'lowpass'); },
    kill() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.12, 1, 0.12 + i * 0.07)); },
    fall() { noise(0.25, 0.3, 300, 80, 0.7, 'lowpass', 0); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.14, 1, i * 0.16)); },
    best() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'triangle', 0.13, 1, i * 0.08)); },
    click() { tone(880, 0.05, 'square', 0.06); },
    rise() { noise(0.6, 0.12, 120, 400, 0.6, 'lowpass'); },
  };

  // ================================================================ background
  const bg = document.createElement('canvas');
  const bctx = bg.getContext('2d');
  function buildBackground() {
    bg.width = canvas.width; bg.height = canvas.height;
    const c = bctx;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    const X1 = VW;
    const sky = c.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#bfc1c2');
    sky.addColorStop(0.6, '#e2e3e3');
    sky.addColorStop(1, '#d3d4d4');
    c.fillStyle = sky; c.fillRect(0, 0, X1, LH);
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath(); c.arc(offX + 400, groundY - 470, 46, 0, Math.PI * 2); c.fill();

    const rnd = mulberry(7);
    c.fillStyle = '#c4c5c5';
    const keepX = offX + 150;
    c.fillRect(keepX - 26, groundY - 330, 52, 330);
    c.beginPath(); c.moveTo(keepX - 32, groundY - 330); c.lineTo(keepX, groundY - 400); c.lineTo(keepX + 32, groundY - 330); c.fill();
    for (let x = -20; x < X1 + 20; x += 18 + rnd() * 14) {
      const h = 60 + rnd() * 70, w = 16 + rnd() * 12, b = groundY - 200;
      c.beginPath(); c.moveTo(x - w, b); c.lineTo(x, b - h); c.lineTo(x + w, b); c.fill();
      c.fillRect(x - w, b, w * 2, 210);
    }
    c.fillStyle = '#aaabab';
    let x = -40;
    while (x < X1) {
      const w = 90 + rnd() * 120, h = 110 + rnd() * 130;
      battlement(c, x, groundY - h, w, h + 10);
      if (rnd() < 0.45) {
        const tw = 40 + rnd() * 20, th = h + 50 + rnd() * 40, tx = x + rnd() * (w - tw);
        battlement(c, tx, groundY - th, tw, th + 10);
        c.fillStyle = '#bdbebe';
        c.beginPath(); c.arc(tx + tw / 2, groundY - th + 30, 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#aaabab';
      }
      x += w + rnd() * 50;
    }
    c.fillStyle = '#141414';
    c.fillRect(0, groundY, X1, LH - groundY + 2);
    for (let mx = -((offX % 28) + 28); mx < X1; mx += 28) c.fillRect(mx, groundY - 10, 18, 11);
    c.strokeStyle = '#262626'; c.lineWidth = 2;
    for (let row = 0, y = groundY + 10; y < LH; y += 17, row++) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(X1, y); c.stroke();
      for (let bx = -(row % 2 ? 22 : 0); bx < X1; bx += 44) {
        c.beginPath(); c.moveTo(bx, y); c.lineTo(bx, y + 17); c.stroke();
      }
    }
  }
  function battlement(c, x, y, w, h) {
    c.fillRect(x, y, w, h);
    const n = Math.max(2, Math.round(w / 16));
    const mw = w / (n * 2 - 1);
    for (let i = 0; i < n; i++) c.fillRect(x + i * mw * 2, y - 9, mw, 10);
  }

  const clouds = [];
  for (let i = 0; i < 6; i++) clouds.push({ x: rand(-100, 640), y: rand(0, 1), w: rand(120, 260), v: rand(4, 10) });

  // ================================================================ fighters
  function makeFighter(side, tx, th, opts = {}) {
    return {
      side, f: side === 'p' ? 1 : -1, tx, th, off: opts.off || 0, by: 0, bob: opts.bob || null,
      hp: opts.hp || 100, maxHp: opts.hp || 100, hpLag: opts.hp || 100, s: opts.s || FS,
      skin: opts.skin || ENEMY_SKIN, champ: !!opts.champ, name: opts.name || 'YOU',
      state: 'idle', aimAng: 0.35, aimPow: 0, reload: 0, throwT: 0, hitT: 0, flash: 0,
      stuck: [], dead: false, fall: null, alpha: 1, cool: 1.5, aimT: 0, aimDur: 0.8, plan: null,
      breath: Math.random() * 6, frozen: 0, burn: 0, shield: 0, power: null,
    };
  }
  const feetY = (F) => groundY - F.th + F.off + F.by;

  // Joint positions in local space (feet at 0,0, facing applied, unscaled).
  function pose(F) {
    const f = F.f;
    let lean = 0;
    if (F.state === 'aim') lean = -f * (3 + F.aimPow * 4);
    else if (F.state === 'throw') lean = f * 6;
    if (F.hitT > 0) lean = -f * 9 * (F.hitT / 0.3);
    const bob = Math.sin(F.breath * 2.2) * 0.8;
    const hip = { x: lean * 0.3, y: -30 + bob * 0.3 };
    const neck = { x: lean, y: -57 + bob };
    const head = { x: lean * 1.15, y: -69 + bob };
    const sh = { x: neck.x, y: neck.y + 3 };
    const legs = [
      { k: { x: -f * 7 + lean * 0.2, y: -15 }, ft: { x: -f * 13, y: 0 } },
      { k: { x: f * 10 + lean * 0.2, y: -16 }, ft: { x: f * 13, y: 0 } },
    ];
    const a = F.aimAng;
    const d = { x: f * Math.cos(a), y: -Math.sin(a) };
    let back, front, jav = null;
    if (F.state === 'aim') {
      const pull = 14 + F.aimPow * 10;
      const hand = { x: sh.x - d.x * pull, y: sh.y - d.y * pull + 2 };
      back = { e: { x: sh.x - d.x * pull * 0.5, y: sh.y - d.y * pull * 0.5 + 7 }, h: hand };
      front = { e: { x: sh.x + d.x * 11, y: sh.y + d.y * 11 + 2 }, h: { x: sh.x + d.x * 21, y: sh.y + d.y * 21 } };
      jav = { gx: hand.x, gy: hand.y, dx: d.x, dy: d.y };
    } else if (F.state === 'throw') {
      back = { e: { x: sh.x + d.x * 10, y: sh.y + d.y * 10 - 2 }, h: { x: sh.x + d.x * 21, y: sh.y + d.y * 21 + 3 } };
      front = { e: { x: sh.x - f * 8, y: sh.y + 8 }, h: { x: sh.x - f * 14, y: sh.y + 14 } };
    } else {
      const hand = { x: sh.x - f * 3, y: sh.y - 12 };
      back = { e: { x: sh.x - f * 11, y: sh.y - 1 }, h: hand };
      front = { e: { x: sh.x + f * 8, y: sh.y + 9 }, h: { x: sh.x + f * 15, y: sh.y + 15 } };
      if (F.reload <= 0) {
        const ia = 0.22;
        jav = { gx: hand.x, gy: hand.y, dx: f * Math.cos(ia), dy: -Math.sin(ia) };
      }
    }
    return { hip, neck, head, sh, legs, back, front, jav };
  }

  function drawJavelin(c, tipX, tipY, dx, dy, len, alpha = 1, skin = ENEMY_SKIN, fx = null) {
    c.globalAlpha = alpha;
    c.lineCap = 'round';
    if (fx) {
      c.strokeStyle = fx === 'fire' ? 'rgba(255,138,31,0.55)' : 'rgba(92,200,255,0.55)';
      c.lineWidth = 7;
      c.beginPath(); c.moveTo(tipX - dx * len * 0.7, tipY - dy * len * 0.7); c.lineTo(tipX, tipY); c.stroke();
    }
    c.strokeStyle = skin.jav; c.lineWidth = 2.6;
    c.beginPath(); c.moveTo(tipX - dx * len, tipY - dy * len); c.lineTo(tipX - dx * 9, tipY - dy * 9); c.stroke();
    c.strokeStyle = fx === 'fire' ? '#ffb03a' : fx === 'ice' ? '#bdeeff' : skin.tip; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(tipX - dx * 11, tipY - dy * 11); c.lineTo(tipX, tipY); c.stroke();
    c.globalAlpha = 1;
  }

  function drawFighter(F) {
    if (F.alpha <= 0) return;
    const P = pose(F);
    let x = F.tx, y = feetY(F), rot = 0;
    if (F.fall) { x = F.fall.x; y = F.fall.y; rot = F.fall.rot; }
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(F.s, F.s);
    ctx.globalAlpha = F.alpha;
    for (const j of F.stuck) {
      drawJavelin(ctx, j.lx, j.ly, Math.cos(j.ang), Math.sin(j.ang), JAV / F.s, F.alpha, j.skin);
      ctx.globalAlpha = F.alpha;
    }
    const col = F.flash > 0 ? '#8a0f14' : F.frozen > 0 ? '#3d86b0' : '#111';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const t = F.breath;
    ctx.strokeStyle = F.skin.band; ctx.lineWidth = 2.6;
    const hb = { x: P.head.x - F.f * 8, y: P.head.y - 3 };
    const flap = F.frozen > 0 ? 0 : 1;
    ctx.beginPath(); ctx.moveTo(hb.x, hb.y);
    ctx.quadraticCurveTo(hb.x - F.f * 8, hb.y + Math.sin(t * 7) * 3 * flap, hb.x - F.f * 16, hb.y + 4 + Math.sin(t * 7 + 1) * 4 * flap);
    ctx.moveTo(hb.x, hb.y + 1);
    ctx.quadraticCurveTo(hb.x - F.f * 7, hb.y + 5 + Math.sin(t * 6) * 2 * flap, hb.x - F.f * 13, hb.y + 10 + Math.sin(t * 6 + 2) * 3 * flap);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (const L of P.legs) { ctx.moveTo(P.hip.x, P.hip.y); ctx.lineTo(L.k.x, L.k.y); ctx.lineTo(L.ft.x, L.ft.y); }
    ctx.stroke();
    if (P.jav) {
      const fx = F.power && (F.power.type === 'fire' || F.power.type === 'ice') ? F.power.type : null;
      drawJavelin(ctx, P.jav.gx + P.jav.dx * JAV * 0.6 / F.s, P.jav.gy + P.jav.dy * JAV * 0.6 / F.s, P.jav.dx, P.jav.dy, JAV / F.s, F.alpha, F.skin, fx);
    }
    ctx.globalAlpha = F.alpha;
    ctx.strokeStyle = col; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(P.sh.x, P.sh.y); ctx.lineTo(P.back.e.x, P.back.e.y); ctx.lineTo(P.back.h.x, P.back.h.y); ctx.stroke();
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(P.hip.x, P.hip.y); ctx.lineTo(P.neck.x, P.neck.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(P.head.x, P.head.y, 10.5, 0, Math.PI * 2); ctx.fill();
    if (F.champ) {
      ctx.beginPath(); ctx.arc(P.head.x, P.head.y - 1, 12, Math.PI, 0); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(P.head.x - 10, P.head.y - 6); ctx.quadraticCurveTo(P.head.x - 20, P.head.y - 14, P.head.x - 16, P.head.y - 24);
      ctx.quadraticCurveTo(P.head.x - 12, P.head.y - 14, P.head.x - 4, P.head.y - 10);
      ctx.moveTo(P.head.x + 10, P.head.y - 6); ctx.quadraticCurveTo(P.head.x + 20, P.head.y - 14, P.head.x + 16, P.head.y - 24);
      ctx.quadraticCurveTo(P.head.x + 12, P.head.y - 14, P.head.x + 4, P.head.y - 10);
      ctx.fill();
    }
    ctx.strokeStyle = F.skin.band; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(P.head.x - 10, P.head.y - 3); ctx.lineTo(P.head.x + 10, P.head.y - 4); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(P.sh.x, P.sh.y); ctx.lineTo(P.front.e.x, P.front.e.y); ctx.lineTo(P.front.h.x, P.front.h.y); ctx.stroke();
    if (F.frozen > 0 && !F.fall) {
      ctx.globalAlpha = F.alpha * Math.min(1, F.frozen * 3) * 0.5;
      ctx.fillStyle = '#bfeaff'; rr(-26, -88, 52, 90, 8); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-16, -78); ctx.lineTo(-6, -60); ctx.moveTo(12, -40); ctx.lineTo(18, -26); ctx.stroke();
    }
    ctx.restore();
    if (F.shield > 0 && !F.fall) {
      const c = { x: F.tx, y: feetY(F) - 42 * F.s }, r = 62 + Math.sin(F.breath * 4) * 2;
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.6, c.x, c.y, r);
      g.addColorStop(0, 'rgba(124,240,200,0)'); g.addColorStop(1, 'rgba(124,240,200,0.35)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(124,240,200,0.9)'; ctx.lineWidth = 2.5; ctx.stroke();
    }
  }

  function zones(F) {
    const P = pose(F), x = F.tx, y = feetY(F), s = F.s;
    const w = (p) => ({ x: x + p.x * s, y: y + p.y * s });
    return {
      head: w(P.head), headR: (F.champ ? 13 : 11.5) * s,
      neck: w(P.neck), hip: w(P.hip), bodyR: 8 * s,
      legs: P.legs.map((L) => [w(L.k), w(L.ft)]), legR: 5 * s,
    };
  }
  function handWorld(F) {
    const P = pose(F);
    return { x: F.tx + P.sh.x * F.s, y: feetY(F) + P.sh.y * F.s };
  }

  // ================================================================ towers
  function drawTower(F) {
    const top = feetY(F), x = F.tx;
    if (top > LH) return;
    ctx.fillStyle = '#262a28';
    ctx.fillRect(x - TW, top + 16, TW * 2, groundY - top - 14);
    ctx.strokeStyle = '#323735'; ctx.lineWidth = 1.5;
    for (let y = top + 30, r = 0; y < groundY; y += 16, r++) {
      ctx.beginPath(); ctx.moveTo(x - TW, y); ctx.lineTo(x + TW, y); ctx.stroke();
      for (let bx = x - TW + (r % 2 ? 11 : 0); bx < x + TW; bx += 22) {
        ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx, y + 16); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + TW * 0.5, top + 16, TW * 0.5, groundY - top - 14);
    ctx.fillStyle = '#1f2321';
    ctx.fillRect(x - TW - 10, top, TW * 2 + 20, 20);
    ctx.fillRect(x - TW - 4, top + 20, TW * 2 + 8, 5);
    if (F.bob) {
      // chains for a moving platform
      ctx.strokeStyle = '#4a504c'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x - TW + 6, top + 25); ctx.lineTo(x - TW + 6, groundY); ctx.moveTo(x + TW - 6, top + 25); ctx.lineTo(x + TW - 6, groundY); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function drawMerlons(F) {
    const top = feetY(F), x = F.tx;
    ctx.fillStyle = '#1f2321';
    for (let i = 0; i < 5; i++) ctx.fillRect(x - TW - 10 + i * (TW * 2 + 8) / 4, top - 10, 12, 11);
    const w = TW * 2 - 6, p = clamp(F.hp / F.maxHp, 0, 1);
    ctx.fillStyle = '#0b0c0b'; rr(x - w / 2 - 2, top + 5, w + 4, 8, 3); ctx.fill();
    if (p > 0) {
      const col = p > 0.5 ? '#46f05d' : p > 0.25 ? '#ffd23a' : '#ff4040';
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.fillStyle = col; rr(x - w / 2, top + 7, w * p, 4, 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  function towerHit(F, x, y) {
    const top = feetY(F);
    if (y >= top + 16 && Math.abs(x - F.tx) <= TW) return true;
    return y >= top - 3 && y < top + 25 && Math.abs(x - F.tx) <= TW + 10;
  }

  // ================================================================ game state
  let screen = 'loading';
  let G = null;
  let paused = false;
  let toastMsg = null;
  const parts = [], floaters = [];
  let shake = 0;
  let viewSkin = 0;             // skin shown in the title-screen picker
  function toast(msg) { toastMsg = { msg, t: 2.6 }; }

  // Tall towers would push heads into the HUD, so cap them.
  function towerH() {
    const avail = groundY - ST;
    const max = avail - HUD_H - 110;
    return clamp(rand(0.24, 0.5) * avail, 140, Math.max(150, max));
  }

  function roundMods(round) {
    const mods = { wind: 0, moving: false, champ: round % 5 === 0 };
    if (round >= 3 && Math.random() < 0.3 + Math.min(0.3, round * 0.02)) mods.wind = (Math.random() < 0.5 ? -1 : 1) * rand(0.45, 1);
    if (round >= 4 && Math.random() < 0.3 + Math.min(0.3, round * 0.02)) mods.moving = true;
    return mods;
  }

  function enemyFor(round, mods, off) {
    const champ = mods.champ;
    let th = towerH();
    let bob = null;
    if (mods.moving) {
      const amp = rand(30, 46);
      th = clamp(th, 140 + amp, Math.max(150 + amp, groundY - ST - HUD_H - 110 - amp));
      bob = { amp, sp: rand(1.1, 1.7), ph: rand(0, 6) };
    }
    const F = makeFighter('e', rand(375, 470), th, {
      off, hp: champ ? 150 : 100, s: champ ? FS * 1.12 : FS, champ, bob,
      skin: champ ? CHAMP_SKIN : ENEMY_SKIN, name: champ ? 'WARLORD' : pick(NAMES),
    });
    F.cool = 1.3 + (round === 1 ? 1 : 0);
    return F;
  }

  function freshRun(demo) {
    return {
      score: 0, kills: 0, round: 1, t: 0, javs: [], orb: null, orbT: 5, trans: null, over: 0,
      combo: 0, comboT: 0, throwRec: {}, throwId: 0, wind: 0, windParts: [], slow: 0, flash: 0,
      banner: null, throws: 0, demo, tut: !demo && S.tut, hint: null, newBest: false, unlocked: null,
      player: null, enemy: null,
    };
  }

  function setupScene() {
    G = freshRun(true);
    viewSkin = SKINS.findIndex((s) => s.id === S.skin);
    G.player = makeFighter('p', PLAYER_X, (groundY - ST) * 0.3, { skin: skinById(S.skin) });
    G.enemy = makeFighter('e', 450, (groundY - ST) * 0.4, { name: 'RONIN' });
  }

  function newGame() {
    parts.length = 0; floaters.length = 0;
    G = freshRun(false);
    G.player = makeFighter('p', PLAYER_X, towerH(), { skin: skinById(S.skin) });
    G.enemy = enemyFor(1, { wind: 0, moving: false, champ: false }, 0);
    G.banner = { t: 0, title: 'ROUND 1', sub: 'VS ' + G.enemy.name };
    screen = 'play';
    paused = false;
  }

  // ================================================================ pickups
  function spawnOrb() {
    const p = G.player, e = G.enemy;
    const x = rand(p.tx + 100, e.tx - 100);
    const hi = Math.min(feetY(p), feetY(e));
    const y = clamp(rand(hi - 180, Math.max(feetY(p), feetY(e)) - 40), ST + HUD_H + 20, groundY - 80);
    const lowHp = p.hp < 55;
    const table = [['heart', lowHp ? 40 : 18], ['fire', 22], ['ice', 20], ['triple', 22], ['shield', 18]];
    let r = Math.random() * table.reduce((a, b) => a + b[1], 0), type = 'heart';
    for (const [k, w] of table) { r -= w; if (r <= 0) { type = k; break; } }
    G.orb = { type, x, y, t: 0, pop: 0 };
    if (!S.seenOrb && !G.demo) {
      S.seenOrb = true; writeSave();
      G.hint = { msg: 'HIT ORBS FOR POWER-UPS', t: 4 };
    }
  }

  function claimOrb(O, owner) {
    O.pop = 0.001;
    const def = PICKUPS[O.type];
    const F = owner === 'p' ? G.player : G.enemy;
    if (F.dead) return;
    burstRing(O.x, O.y, def.col);
    if (O.type === 'heart') {
      F.hp = Math.min(F.maxHp, F.hp + 35);
      float(O.x, O.y - 30, '+35 HP', 22, '#e0242c');
      SFX.heal();
      return;
    }
    if (owner !== 'p') { float(O.x, O.y - 30, 'DESTROYED', 18, '#555'); SFX.steal(); return; }
    if (O.type === 'shield') F.shield = 1;
    else F.power = { type: O.type, shots: O.type === 'fire' ? 2 : 1 };
    float(O.x, O.y - 30, def.label + '!', 24, O.type === 'triple' ? '#222' : def.col);
    SFX.power();
  }

  // ================================================================ throwing
  function throwJavelin(F, vx, vy, opts = {}) {
    const h = handWorld(F);
    const sp = Math.hypot(vx, vy);
    const dx = vx / sp, dy = vy / sp;
    const j = {
      x: h.x + dx * JAV * 0.55, y: h.y + dy * JAV * 0.55, vx, vy, owner: F.side,
      state: 'fly', ang: Math.atan2(vy, vx), life: 0, spin: 0, alpha: 1, age: 0,
      skin: F.skin, fx: opts.fx || null, id: opts.id || 0, tower: null,
    };
    G.javs.push(j);
    return j;
  }

  function playerThrow(ang, pow) {
    const P = G.player;
    const sp = lerp(V_MIN, V_MAX, pow);
    const id = ++G.throwId;
    const pw = P.power;
    const fx = pw && (pw.type === 'fire' || pw.type === 'ice') ? pw.type : null;
    const angs = pw && pw.type === 'triple' ? [ang - 0.075, ang, ang + 0.075] : [ang];
    for (const a of angs) throwJavelin(P, Math.cos(a) * sp, -Math.sin(a) * sp, { fx, id });
    G.throwRec[id] = { live: angs.length, hit: false, keep: false };
    if (pw) { pw.shots--; if (pw.shots <= 0) P.power = null; }
    P.state = 'throw'; P.throwT = 0.28; P.reload = RELOAD; P.aimPow = 0;
    SFX.throw(pow);
    G.throws++;
    if (G.tut && G.throws >= 2) { G.tut = false; S.tut = false; writeSave(); }
  }

  // Tracks whether each throw landed, for the combo.
  function resolveThrow(j, outcome) {
    if (j.owner !== 'p' || !j.id) return;
    const id = j.id, r = G.throwRec[id];
    j.id = 0;
    if (!r) return;
    r.live--;
    if (outcome === 'hit' && !r.hit) {
      r.hit = true;
      G.combo++; G.comboT = 0.5;
      if (G.combo >= 2) SFX.combo(G.combo);
    }
    if (outcome === 'keep') r.keep = true;
    if (r.live <= 0) {
      if (!r.hit && !r.keep && G.combo > 0) {
        if (G.combo >= 3) float(G.player.tx + 70, feetY(G.player) - 130, 'COMBO LOST', 16, '#555');
        G.combo = 0;
      }
      delete G.throwRec[id];
    }
  }
  const comboMult = () => Math.min(5, 1 + Math.floor(Math.max(0, G.combo - 1) / 2));

  // Simulates a throw and returns its height when it reaches targetX (or null).
  function heightAt(x, y, vx, vy, targetX) {
    const dir = Math.sign(vx), dt = 1 / 120;
    for (let i = 0; i < 600; i++) {
      vx += G.wind * WIND_A * dt; vy += GRAV * dt;
      const nx = x + vx * dt, ny = y + vy * dt;
      if ((nx - targetX) * dir >= 0) {
        const t = (targetX - x) / (nx - x || 1);
        return y + (ny - y) * t;
      }
      x = nx; y = ny;
      if (y > groundY + 50) return null;
    }
    return null;
  }

  function enemyPlan(E) {
    const P = G.player;
    const Z = zones(P);
    const head = Math.random() < 0.12 + Math.min(0.25, G.kills * 0.02);
    const tgt = head ? Object.assign({}, Z.head) : { x: lerp(Z.hip.x, Z.neck.x, 0.5), y: lerp(Z.hip.y, Z.neck.y, 0.5) };
    // Early rivals mostly miss; each kill makes the next one sharper.
    const pHit = Math.min(0.72, 0.3 + G.kills * 0.03) + (E.champ ? 0.08 : 0);
    if (Math.random() > pHit) tgt.x += (Math.random() < 0.45 ? -1 : 1) * rand(95, 170);
    const h = handWorld(E);
    let ang = rand(0.3, 0.85), v = null;
    for (let i = 0; i < 10 && v === null; i++) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const lx = h.x - c * JAV * 0.55, ly = h.y - s * JAV * 0.55;
      const yAt = (sp) => { const y = heightAt(lx, ly, -c * sp, -s * sp, tgt.x); return y === null ? 1e9 : y; };
      if (yAt(V_MAX) > tgt.y) { ang += 0.1; continue; }
      let lo = V_MIN, hi = V_MAX;
      for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (yAt(mid) > tgt.y) lo = mid; else hi = mid; }
      v = (lo + hi) / 2;
    }
    if (v === null) { ang = 0.6; v = 650; }
    v *= 1 + gauss() * 0.025;
    ang += gauss() * 0.015;
    return { ang, v, pow: clamp((v - V_MIN) / (V_MAX - V_MIN), 0, 1) };
  }

  function updateEnemy(E, dt) {
    if (E.dead || G.over || G.trans || G.player.dead) { if (E.state === 'aim') E.state = 'idle'; return; }
    if (G.tut && G.throws === 0) return;
    if (E.frozen > 0) return;
    if (E.state === 'idle' && E.reload <= 0) {
      E.cool -= dt;
      if (E.cool <= 0) {
        E.plan = enemyPlan(E);
        E.state = 'aim'; E.aimT = 0;
        E.aimDur = Math.max(0.45, 0.85 - G.kills * 0.03);
      }
    } else if (E.state === 'aim') {
      E.aimT += dt;
      const k = clamp(E.aimT / E.aimDur, 0, 1);
      E.aimAng = lerp(E.aimAng, E.plan.ang, Math.min(1, dt * 10));
      E.aimPow = E.plan.pow * ease(k);
      if (k >= 1) {
        throwJavelin(E, -Math.cos(E.plan.ang) * E.plan.v, -Math.sin(E.plan.ang) * E.plan.v);
        E.state = 'throw'; E.throwT = 0.28; E.reload = RELOAD; E.aimPow = 0;
        SFX.throw(E.plan.pow);
        E.cool = Math.max(1.0, 2.9 - G.kills * 0.13) + rand(0, 0.9) - (E.champ ? 0.4 : 0);
      }
    }
  }

  function updateFighter(F, dt) {
    F.breath += F.frozen > 0 ? 0 : dt;
    F.hitT = Math.max(0, F.hitT - dt);
    F.flash = Math.max(0, F.flash - dt);
    F.hpLag = F.hpLag > F.hp ? Math.max(F.hp, F.hpLag - dt * 60) : F.hp;
    if (F.frozen > 0) F.frozen = Math.max(0, F.frozen - dt);
    if (F.bob && !F.dead) F.by = Math.sin(G.t * F.bob.sp + F.bob.ph) * F.bob.amp;
    if (F.burn > 0 && !F.dead) {
      F.burn -= dt;
      F.hp -= 5 * dt;
      if (Math.random() < dt * 30) {
        const Z = zones(F);
        parts.push({ x: Z.neck.x + rand(-10, 10), y: lerp(Z.hip.y, Z.neck.y, Math.random()), vx: rand(-20, 20), vy: rand(-90, -40), life: rand(0.3, 0.5), max: 0.5, r: rand(2.5, 4.5), col: Math.random() < 0.5 ? '#ff8a1f' : '#ffd23a', g: -0.05 });
      }
      if (F.hp <= 0) die(F, -F.f, false);
    }
    if (F.state === 'throw') { F.throwT -= dt; if (F.throwT <= 0) F.state = 'idle'; }
    if (F.state !== 'aim') F.aimAng = lerp(F.aimAng, 0.35, Math.min(1, dt * 6));
    F.reload = Math.max(0, F.reload - dt);
    if (F.fall && !F.fall.landed) {
      const fl = F.fall;
      fl.vy += GRAV * dt; fl.x += fl.vx * dt; fl.y += fl.vy * dt; fl.rot += fl.vr * dt;
      if (fl.y >= groundY - 7) {
        fl.y = groundY - 7; fl.landed = true;
        fl.rot = fl.vr > 0 ? Math.PI / 2 : -Math.PI / 2;
        dust(fl.x, groundY, 14); SFX.fall(); shake = Math.max(shake, 5);
      }
    }
  }

  function hurt(F, zone, j) {
    let dmg = DMG[zone];
    if (j.owner === 'e' && G.enemy.champ) dmg *= 1.2;
    if (j.fx === 'fire') dmg *= 1.5;
    F.hp -= dmg; F.hitT = 0.3; F.flash = 0.12;
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    blood(j.x, j.y, dx, dy, zone === 'head' ? 26 : 16);
    if (zone === 'head') SFX.head(); else SFX.hit();
    F.stuck.push({ lx: (j.x + dx * 7 - F.tx) / F.s, ly: (j.y + dy * 7 - feetY(F)) / F.s, ang: j.ang, skin: j.skin });
    if (F.stuck.length > 6) F.stuck.shift();
    if (j.fx === 'fire') { F.burn = 3; SFX.burn(); }
    if (j.fx === 'ice') {
      F.frozen = 2.6; F.state = 'idle'; F.aimPow = 0;
      SFX.freeze(); float(F.tx, feetY(F) - 120, 'FROZEN', 22, '#3d9ad0');
    }
    if (j.owner === 'p') {
      resolveThrow(j, 'hit');
      const pts = (zone === 'head' ? 3 : 1) * comboMult();
      G.score += pts;
      if (zone === 'head') float(j.x, j.y - 34, 'HEADSHOT +' + pts, 22, '#c4161c');
      else float(j.x, j.y - 22, '+' + pts, 20, '#1a1a1a');
    } else {
      shake = Math.max(shake, zone === 'head' ? 12 : 8);
      if (zone === 'head') float(j.x, j.y - 34, 'HEADSHOT', 20, '#c4161c');
      else float(j.x, j.y - 22, '-' + Math.round(dmg), 18, '#1a1a1a');
    }
    if (F.hp <= 0) die(F, dx, zone === 'head');
  }

  function die(F, dir, headshot) {
    if (F.dead) return;
    F.hp = 0; F.dead = true; F.state = 'idle'; F.frozen = 0; F.burn = 0; F.shield = 0;
    const y = feetY(F);
    // topple forward off the tower so the body lands in view
    F.fall = { x: F.tx, y, vx: F.f * rand(70, 110), vy: -220, rot: 0, vr: Math.sign(dir || F.f) * 3.2, landed: false };
    G.slow = 0.75; G.flash = 0.5;
    SFX.ko();
    if (F.side === 'e') {
      G.kills++;
      const pts = (10 + (headshot ? 5 : 0)) * comboMult();
      G.score += pts;
      SFX.kill();
      float(F.tx - 20, y - 150, 'K.O. +' + pts, 34, C.red);
      G.trans = { t: 0, next: null, pFrom: G.player.th, pTo: towerH() };
    } else {
      G.over = 0.001;
      setTimeout(() => SFX.over(), 400);
      endRun();
    }
  }

  function endRun() {
    const before = S.bestRound;
    G.newBest = G.score > S.best && G.score > 0;
    if (G.score > S.best) S.best = G.score;
    if (G.round > S.bestRound) S.bestRound = G.round;
    const fresh = SKINS.filter((s) => s.round > before && s.round <= S.bestRound);
    G.unlocked = fresh.length ? fresh[fresh.length - 1] : null;
    writeSave();
    submitScore(G.score);
  }

  function updateTransition(dt) {
    const T = G.trans;
    if (!T) return;
    T.t += dt;
    const E = G.enemy;
    if (T.t > 0.9) for (const j of G.javs) if (j.state !== 'fly') j.life = Math.min(j.life, 0.35);
    if (T.t > 1.0 && !T.next) {
      const k = clamp((T.t - 1.0) / 0.55, 0, 1);
      E.off = ease(k) * (E.th + 80);
      E.alpha = 1 - k;
      if (k >= 1) {
        G.round++;
        const mods = roundMods(G.round);
        G.wind = mods.wind;
        T.next = enemyFor(G.round, mods, 0);
        T.next.off = T.next.th + 80;
        G.enemy = T.next;
        const subs = [];
        if (mods.champ) subs.push('CHAMPION');
        if (mods.wind) subs.push('WIND');
        if (mods.moving) subs.push('MOVING TOWER');
        G.banner = { t: 0, title: 'ROUND ' + G.round, sub: subs.length ? subs.join(' + ') : 'VS ' + T.next.name, warn: subs.length > 0 };
        // the player gets a breather between rounds
        G.player.hp = Math.min(G.player.maxHp, G.player.hp + 15);
        SFX.rise();
      }
    }
    if (T.t > 1.0) {
      const k = clamp((T.t - 1.0) / 1.2, 0, 1);
      G.player.th = lerp(T.pFrom, T.pTo, ease(k));
    }
    if (T.next) {
      const k = clamp((T.t - 1.55) / 0.65, 0, 1);
      T.next.off = (1 - ease(k)) * (T.next.th + 80);
      if (k >= 1) { T.next.off = 0; G.trans = null; }
    }
  }

  function updateJavelins(dt) {
    const sub = 4, h = dt / sub;
    for (let i = G.javs.length - 1; i >= 0; i--) {
      const j = G.javs[i];
      j.age += dt;
      if (j.state === 'stuck') {
        if (j.life < 99) { j.life -= dt; j.alpha = clamp(j.life / 0.35, 0, 1); if (j.life <= 0) G.javs.splice(i, 1); }
        continue;
      }
      let removed = false;
      for (let s = 0; s < sub; s++) {
        if (j.state === 'fly') j.vx += G.wind * WIND_A * h;
        j.vy += GRAV * h; j.x += j.vx * h; j.y += j.vy * h;
        if (j.state === 'fly') j.ang = Math.atan2(j.vy, j.vx);
        else j.ang += j.spin * h;
        if (j.state === 'fly' && collideJavelin(j)) { G.javs.splice(i, 1); removed = true; break; }
        if (j.state === 'fall' && j.y >= groundY - 4) { j.y = groundY - 4; stick(j, 2, null); }
        if (j.state === 'stuck') break;
      }
      if (removed) continue;
      if (j.state === 'fly' && (j.fx || (j.owner === 'p' && j.skin.trail)) && Math.random() < 0.8) {
        const col = j.fx === 'fire' ? (Math.random() < 0.5 ? '#ff8a1f' : '#ffd23a') : j.fx === 'ice' ? '#bdeeff' : j.skin.trail;
        parts.push({ x: j.x - Math.cos(j.ang) * rand(10, 40), y: j.y - Math.sin(j.ang) * rand(10, 40), vx: 0, vy: 0, life: 0.3, max: 0.3, r: rand(1.5, 3), col, g: 0 });
      }
      if (j.state !== 'stuck' && (j.x < -offX - 150 || j.x > VW - offX + 150 || j.y > LH + 100)) {
        resolveThrow(j, 'miss');
        G.javs.splice(i, 1);
      }
    }
    // mid-air clashes
    for (let a = 0; a < G.javs.length; a++) {
      const A = G.javs[a];
      if (A.state !== 'fly') continue;
      for (let b = a + 1; b < G.javs.length; b++) {
        const B = G.javs[b];
        if (B.state !== 'fly' || B.owner === A.owner) continue;
        const ta = tipTail(A), tb = tipTail(B);
        if (segSegDist(ta[0], ta[1], tb[0], tb[1]) < 4.5) {
          const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
          for (const J of [A, B]) {
            resolveThrow(J, 'keep');
            J.state = 'fall'; J.vx *= -0.25; J.vy = -rand(120, 260); J.spin = rand(-14, 14);
          }
          sparks(mx, my, 18); SFX.clash();
          float(mx, my - 24, 'CLASH!', 18, '#3a3a3a');
        }
      }
    }
  }
  function tipTail(j) {
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    return [{ x: j.x, y: j.y }, { x: j.x - dx * JAV * 0.8, y: j.y - dy * JAV * 0.8 }];
  }

  // Returns true when the javelin should be removed (it stuck into a fighter).
  function collideJavelin(j) {
    const tgt = j.owner === 'p' ? G.enemy : G.player;
    const own = j.owner === 'p' ? G.player : G.enemy;
    if (!tgt.dead && tgt.off === 0) {
      if (tgt.shield > 0) {
        const cx = tgt.tx, cy = feetY(tgt) - 42 * tgt.s;
        if (Math.hypot(j.x - cx, j.y - cy) < 62) {
          tgt.shield = 0;
          j.state = 'fall'; j.vx *= -0.3; j.vy = -rand(150, 250); j.spin = rand(-14, 14);
          sparks(j.x, j.y, 16); burstRing(cx, cy, '#7cf0c8'); SFX.block();
          float(cx, cy - 80, 'BLOCKED', 20, '#1f9c78');
          return false;
        }
      }
      const Z = zones(tgt);
      let zone = null;
      if (Math.hypot(j.x - Z.head.x, j.y - Z.head.y) < Z.headR) zone = 'head';
      else if (segDist(j.x, j.y, Z.neck.x, Z.neck.y, Z.hip.x, Z.hip.y) < Z.bodyR) zone = 'body';
      else if (Z.legs.some(([k, f]) => segDist(j.x, j.y, Z.hip.x, Z.hip.y, k.x, k.y) < Z.legR || segDist(j.x, j.y, k.x, k.y, f.x, f.y) < Z.legR)) zone = 'legs';
      if (zone) { hurt(tgt, zone, j); return true; }
    }
    const O = G.orb;
    if (O && !O.pop && Math.hypot(j.x - O.x, j.y - (O.y + Math.sin(O.t * 2.2) * 6)) < 28) {
      claimOrb(O, j.owner);
      if (j.owner === 'p' && j.id && G.throwRec[j.id]) G.throwRec[j.id].keep = true;
    }
    for (const T of [tgt, own]) {
      if (T.off < T.th && towerHit(T, j.x, j.y)) { stick(j, T === own && j.age < 0.15 ? 3 : 7, T); return false; }
    }
    if (j.y >= groundY - 4) { j.y = groundY - 4; stick(j, 8, null); }
    return false;
  }
  function stick(j, depth, tower) {
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    if (j.state === 'fly') resolveThrow(j, 'miss');
    if (j.state === 'fall') j.ang = Math.atan2(Math.abs(dy) < 0.4 ? 0.4 : dy, dx);
    j.x += dx * depth; j.y += dy * depth;
    j.state = 'stuck'; j.life = 5; j.vx = j.vy = 0;
    // javelins in a moving tower ride along with it
    j.tower = tower && tower.bob ? tower : null;
    j.ty0 = tower ? feetY(tower) : 0;
    dust(j.x, j.y, 6);
    SFX.thunk();
  }

  // ================================================================ particles
  function float(x, y, txt, size, col) { floaters.push({ x, y, txt, life: 1.1, max: 1.1, size, col }); }
  function blood(x, y, dx, dy, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dy, dx) + gauss() * 0.7, sp = rand(60, 260);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.4, 0.8), max: 0.8, r: rand(1.5, 3.5), col: Math.random() < 0.5 ? '#9a0d14' : '#c4161c', g: 1 });
    }
  }
  function dust(x, y, n) {
    for (let i = 0; i < n; i++) parts.push({ x, y, vx: rand(-60, 60), vy: rand(-90, -10), life: rand(0.3, 0.6), max: 0.6, r: rand(2, 4), col: '#6a6a6a', g: 0.3 });
  }
  function sparks(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 320);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.45), max: 0.45, r: rand(1.2, 2.4), col: Math.random() < 0.5 ? '#fff6c0' : '#ffd23a', g: 0.4 });
    }
  }
  function burstRing(x, y, col) {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2, sp = rand(120, 200);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5, r: rand(2.5, 4), col, g: 0 });
    }
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += GRAV * p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > groundY && p.g >= 1) { p.y = groundY; p.vx *= 0.3; p.vy = 0; }
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt; f.y -= 34 * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    if (G.wind && Math.random() < dt * 14 * Math.abs(G.wind)) {
      const x = G.wind > 0 ? -offX - 40 : VW - offX + 40;
      G.windParts.push({ x, y: rand(ST + HUD_H, groundY - 40), len: rand(30, 70), life: 3 });
    }
    for (let i = G.windParts.length - 1; i >= 0; i--) {
      const w = G.windParts[i];
      w.x += G.wind * 420 * dt; w.life -= dt;
      if (w.life <= 0 || !G.wind) G.windParts.splice(i, 1);
    }
  }

  // ================================================================ input
  let aim = null;
  let buttons = [];
  let pressed = null;
  function toLogical(e) {
    return { x: e.clientX / scale - offX, y: e.clientY / scale };
  }
  function hitButton(p) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i];
      if (p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6) return b;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    const p = toLogical(e);
    const b = hitButton(p);
    if (b) { pressed = { id: b.id, pid: e.pointerId }; return; }
    if (screen === 'title') { uiAction('play'); return; }
    if (screen === 'play' && !paused && !G.player.dead && !aim) {
      aim = { sx: p.x, sy: p.y, x: p.x, y: p.y, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (aim && e.pointerId === aim.id) { const p = toLogical(e); aim.x = p.x; aim.y = p.y; }
  });
  function pointerEnd(e, cancel) {
    if (pressed && e.pointerId === pressed.pid) {
      const b = hitButton(toLogical(e));
      if (!cancel && b && b.id === pressed.id) uiAction(b.id);
      pressed = null;
    }
    if (aim && e.pointerId === aim.id) {
      if (cancel) aim = null; else aim.release = true;
    }
  }
  canvas.addEventListener('pointerup', (e) => pointerEnd(e, false));
  canvas.addEventListener('pointercancel', (e) => pointerEnd(e, true));
  window.addEventListener('blur', () => { aim = null; pressed = null; });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      initAudio();
      if (screen === 'title') uiAction('play');
      else if (screen === 'over' && G.over > 1.4) uiAction('retry');
      else if (paused) uiAction('resume');
    } else if ((e.code === 'Escape' || e.code === 'KeyP') && screen === 'play' && !G.over) paused = !paused;
    else if (screen === 'title' && e.code === 'ArrowLeft') uiAction('skinPrev');
    else if (screen === 'title' && e.code === 'ArrowRight') uiAction('skinNext');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (screen === 'play' && !G.over) paused = true;
      aim = null; pressed = null;
      writeSave();
      if (audio) audio.suspend().catch(() => {});
    } else if (audio) audio.resume().catch(() => {});
  });

  function aimVector() {
    const dx = aim.sx - aim.x, dy = aim.sy - aim.y;
    const len = Math.hypot(dx, dy);
    let ang = Math.atan2(-dy, Math.max(dx, 0.001));
    if (dx < 0) ang = dy > 0 ? -1.2 : 1.53;
    ang = clamp(ang, -1.2, 1.53);
    return { ang, pow: clamp(len / PULL_FULL, 0, 1), len };
  }

  function updatePlayer() {
    const P = G.player;
    if (P.dead) { aim = null; return; }
    if (aim) {
      const v = aimVector();
      if ((v.len > 8 || P.state === 'aim') && P.reload <= 0 && P.state !== 'throw') {
        P.state = 'aim'; P.aimAng = v.ang; P.aimPow = v.pow;
      }
      if (aim.release) {
        if (P.state === 'aim' && v.len > 14) { playerThrow(v.ang, v.pow); aim = null; }
        else if (P.state === 'aim' || v.len <= 14) { if (P.state === 'aim') P.state = 'idle'; aim = null; }
        // released during the reload: throw as soon as the javelin is back
      }
    } else if (P.state === 'aim') P.state = 'idle';
  }

  // Browsing shows every skin; only unlocked ones get equipped.
  function cycleSkin(d) {
    viewSkin = (viewSkin + d + SKINS.length) % SKINS.length;
    const sk = SKINS[viewSkin];
    if (skinUnlocked(sk)) { S.skin = sk.id; writeSave(); }
    G.player.skin = skinUnlocked(sk) ? sk : skinById(S.skin);
  }

  function uiAction(id) {
    SFX.click();
    if (id === 'play' || id === 'retry') newGame();
    else if (id === 'home') { setupScene(); screen = 'title'; paused = false; }
    else if (id === 'pause') paused = true;
    else if (id === 'resume') paused = false;
    else if (id === 'sound') setMuted(!S.muted);
    else if (id === 'lb') showLeaderboard();
    else if (id === 'skinPrev') cycleSkin(-1);
    else if (id === 'skinNext') cycleSkin(1);
  }

  // ================================================================ update
  function update(rdt) {
    const wind = G ? G.wind : 0;
    for (const c of clouds) {
      c.x += (c.v + wind * 40) * rdt;
      if (c.x - c.w > VW - offX + 40) { c.x = -offX - c.w - 20; c.y = Math.random(); }
      else if (c.x + c.w < -offX - 60) { c.x = VW - offX + c.w; c.y = Math.random(); }
    }
    if (toastMsg) { toastMsg.t -= rdt; if (toastMsg.t <= 0) toastMsg = null; }
    if (screen === 'loading' || !G) return;
    if (screen === 'title') {
      G.t += rdt;
      updateFighter(G.player, rdt); updateFighter(G.enemy, rdt);
      return;
    }
    if (paused) return;
    // slow motion on every K.O.
    const dt = G.slow > 0 ? rdt * 0.28 : rdt;
    G.slow = Math.max(0, G.slow - rdt);
    G.flash = Math.max(0, G.flash - rdt * 2);
    G.t += dt;
    shake = Math.max(0, shake - rdt * 30);
    if (G.banner) { G.banner.t += rdt; if (G.banner.t > 1.8) G.banner = null; }
    if (G.hint) { G.hint.t -= rdt; if (G.hint.t <= 0) G.hint = null; }
    G.comboT = Math.max(0, G.comboT - rdt);
    updatePlayer();
    updateEnemy(G.enemy, dt);
    updateFighter(G.player, dt);
    updateFighter(G.enemy, dt);
    updateJavelins(dt);
    updateTransition(dt);
    updateParts(dt);
    for (const j of G.javs) if (j.tower) { const ny = feetY(j.tower); j.y += ny - j.ty0; j.ty0 = ny; }
    if (G.orb) {
      const O = G.orb;
      O.t += dt;
      if (O.pop) { O.pop += dt; if (O.pop > 0.3) { G.orb = null; G.orbT = rand(6, 10); } }
      else if (O.t > 14) { G.orb = null; G.orbT = rand(3, 6); }
    } else if (!G.trans && !G.over && !(G.tut && G.throws === 0)) {
      G.orbT -= dt;
      if (G.orbT <= 0) spawnOrb();
    }
    if (G.over) {
      G.over += rdt;
      if (G.over > 1.1 && screen === 'play') {
        screen = 'over';
        if (G.newBest || G.unlocked) setTimeout(() => SFX.best(), 300);
      }
    }
  }

  // ================================================================ draw: world
  function drawHeartShape(x, y, s, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.bezierCurveTo(-14, -2, -14, -14, -6.5, -14);
    ctx.bezierCurveTo(-2.5, -14, 0, -10, 0, -8);
    ctx.bezierCurveTo(0, -10, 2.5, -14, 6.5, -14);
    ctx.bezierCurveTo(14, -14, 14, -2, 0, 7);
    const g = ctx.createLinearGradient(0, -14, 0, 7);
    g.addColorStop(0, '#ff5a5f'); g.addColorStop(1, '#b8121a');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }

  // Small pickup glyphs, drawn around (0,0) at roughly 24 units across.
  function glyph(type, x, y, s) {
    if (type === 'heart') { drawHeartShape(x, y + 3 * s, 0.85 * s); return; }
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (type === 'fire') {
      ctx.fillStyle = '#ff8a1f';
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.bezierCurveTo(9, -4, 11, 3, 8, 8); ctx.bezierCurveTo(5, 13, -5, 13, -8, 8); ctx.bezierCurveTo(-11, 2, -6, -2, -4, -6); ctx.bezierCurveTo(-3, -2, -1, 0, 1, 0); ctx.bezierCurveTo(2, -4, 1, -9, 0, -13); ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.bezierCurveTo(5, 4, 5, 10, 0, 10); ctx.bezierCurveTo(-5, 10, -5, 5, 0, -1); ctx.fill();
    } else if (type === 'ice') {
      ctx.strokeStyle = '#5cc8ff'; ctx.lineWidth = 2.6;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 12);
        ctx.moveTo(-4, -9); ctx.lineTo(0, -6); ctx.lineTo(4, -9);
        ctx.moveTo(-4, 9); ctx.lineTo(0, 6); ctx.lineTo(4, 9);
        ctx.stroke(); ctx.restore();
      }
    } else if (type === 'triple') {
      ctx.strokeStyle = '#f4f4f2'; ctx.lineWidth = 2.6;
      for (const a of [-0.45, 0, 0.45]) {
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(0, -13); ctx.lineTo(3, -7); ctx.stroke();
        ctx.restore();
      }
    } else if (type === 'shield') {
      ctx.fillStyle = '#7cf0c8';
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(11, -8); ctx.quadraticCurveTo(11, 7, 0, 13); ctx.quadraticCurveTo(-11, 7, -11, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(16,18,20,0.5)';
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, -5); ctx.quadraticCurveTo(6, 4, 0, 8); ctx.closePath(); ctx.fill();
    } else if (type === 'windR' || type === 'windL') {
      const d = type === 'windR' ? 1 : -1;
      ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(-10 * d, -5); ctx.lineTo(6 * d, -5); ctx.moveTo(-10 * d, 3); ctx.lineTo(10 * d, 3);
      ctx.moveTo(4 * d, -2); ctx.lineTo(10 * d, 3); ctx.lineTo(4 * d, 8); ctx.stroke();
    }
    ctx.restore();
  }

  function drawOrb(O) {
    const def = PICKUPS[O.type];
    const by = Math.sin(O.t * 2.2) * 6;
    const appear = Math.min(1, O.t * 4);
    const s = O.pop ? 1 + O.pop * 3 : backOut(appear);
    const a = O.pop ? 1 - O.pop / 0.3 : (O.t > 12 ? 0.5 + 0.5 * Math.sin(O.t * 20) : 1);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(O.x, O.y + by); ctx.scale(s, s);
    ctx.shadowColor = def.col; ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(16,18,20,0.88)';
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = def.col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 30 + Math.sin(O.t * 4) * 2, O.t * 2, O.t * 2 + 1.6); ctx.stroke();
    ctx.restore();
    if (!O.pop) { ctx.globalAlpha = clamp(a, 0, 1); glyph(O.type, O.x, O.y + by, s); ctx.globalAlpha = 1; }
  }

  function text(str, x, y, size, col, align = 'center', stroke = null, sw = 0) {
    ctx.font = `${size}px ${FD}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(str, x, y); }
    ctx.fillStyle = col; ctx.fillText(str, x, y);
  }
  function spaced(str, x, y, size, col, spacing, align = 'center') {
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = spacing + 'px';
      text(str, x + (align === 'center' ? spacing / 2 : 0), y, size, col, align);
      ctx.letterSpacing = '0px';
    } else text(str, x, y, size, col, align);
  }

  function drawAimUI() {
    const P = G.player;
    if (P.state !== 'aim' || P.dead) return;
    const h = handWorld(P);
    const dx = Math.cos(P.aimAng), dy = -Math.sin(P.aimAng);
    const len = 18 + P.aimPow * 62;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = powColor(P.aimPow); ctx.lineWidth = 9; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(h.x - dx * 14, h.y - dy * 14); ctx.lineTo(h.x - dx * (14 + len), h.y - dy * (14 + len)); ctx.stroke();
    ctx.restore();
    const sp = lerp(V_MIN, V_MAX, P.aimPow);
    let x = h.x + dx * JAV * 0.55, y = h.y + dy * JAV * 0.55, vx = dx * sp, vy = dy * sp;
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    for (let i = 1; i <= 6; i++) {
      const t = 0.045 / 3;
      for (let k = 0; k < 3; k++) { vx += G.wind * WIND_A * t; vy += GRAV * t; x += vx * t; y += vy * t; }
      ctx.beginPath(); ctx.arc(x, y, 3.4 - i * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    meter(P, P.aimPow);
  }
  function meter(F, pow) {
    const x = F.tx - F.f * 40, y1 = feetY(F) - 72 * F.s, hgt = 64;
    ctx.fillStyle = '#111'; rr(x - 5, y1 - 2, 10, hgt + 4, 3); ctx.fill();
    const g = ctx.createLinearGradient(0, y1 + hgt, 0, y1);
    g.addColorStop(0, '#41d35a'); g.addColorStop(0.5, '#ffc83d'); g.addColorStop(1, '#e23b3b');
    ctx.fillStyle = g;
    const fh = hgt * pow;
    ctx.fillRect(x - 3, y1 + hgt - fh, 6, fh);
  }

  function drawScene() {
    ctx.fillStyle = 'rgba(248,248,248,0.75)';
    for (const c of clouds) {
      const y = ST + 30 + c.y * Math.max(60, groundY - 520 - ST);
      ctx.beginPath(); ctx.ellipse(c.x, y, c.w / 2, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c.x + c.w * 0.15, y - 6, c.w / 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (!G) return;
    if (G.windParts.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const w of G.windParts) { ctx.moveTo(w.x, w.y); ctx.lineTo(w.x - Math.sign(G.wind) * w.len, w.y); }
      ctx.stroke();
    }
    if (G.orb) drawOrb(G.orb);
    const P = G.player, E = G.enemy;
    ctx.save();
    ctx.beginPath(); ctx.rect(-offX, -100, VW, groundY + 100); ctx.clip();
    drawTower(E); drawTower(P);
    for (const j of G.javs) if (j.state === 'stuck') drawJavelin(ctx, j.x, j.y, Math.cos(j.ang), Math.sin(j.ang), JAV, j.alpha, j.skin);
    for (const F of [P, E]) if (!F.fall) drawFighter(F);
    drawMerlons(E); drawMerlons(P);
    ctx.restore();
    for (const F of [P, E]) if (F.fall) drawFighter(F);
    if (E.state === 'aim' && !E.dead) meter(E, E.aimPow);
    // active power-up above the player's head
    if (P.power && !P.dead && screen === 'play') {
      const bx = P.tx, byy = feetY(P) - 128 + Math.sin(G.t * 3) * 3;
      ctx.fillStyle = 'rgba(16,18,20,0.85)'; ctx.beginPath(); ctx.arc(bx, byy, 15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = PICKUPS[P.power.type].col; ctx.lineWidth = 2; ctx.stroke();
      glyph(P.power.type, bx, byy, 0.62);
    }
    for (const j of G.javs) if (j.state !== 'stuck') drawJavelin(ctx, j.x, j.y, Math.cos(j.ang), Math.sin(j.ang), JAV, 1, j.skin, j.state === 'fly' ? j.fx : null);
    for (const j of G.javs) if (j.state === 'fly' && j.y < ST - 6) {
      ctx.fillStyle = 'rgba(20,20,20,0.6)';
      ctx.beginPath(); ctx.moveTo(j.x, ST + 2); ctx.lineTo(j.x - 6, ST + 12); ctx.lineTo(j.x + 6, ST + 12); ctx.fill();
    }
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (screen === 'play') drawAimUI();
    for (const f of floaters) {
      const k = 1 - f.life / f.max;
      ctx.globalAlpha = clamp(f.life / f.max * 2, 0, 1);
      const s = k < 0.15 ? backOut(k / 0.15) : 1;
      ctx.save(); ctx.translate(f.x, f.y); ctx.scale(s, s);
      text(f.txt, 0, 0, f.size, f.col, 'center', 'rgba(255,255,255,0.85)', 5);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================ draw: UI
  function button(id, x, y, w, h, label, kind = 'primary', icon = null) {
    buttons.push({ id, x, y, w, h });
    const down = pressed && pressed.id === id;
    const [face, edge, ink] = kind === 'primary' ? [C.red, C.redD, C.white] : [C.dark, C.darkD, C.white];
    const lift = down ? 1 : 5;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; rr(x, y + 6, w, h, 14); ctx.fill();
    ctx.fillStyle = edge; rr(x, y, w, h, 14); ctx.fill();
    const fy = y + (5 - lift);
    ctx.fillStyle = face; rr(x, fy, w, h - 5, 14); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.13)'; rr(x + 4, fy + 3, w - 8, (h - 5) * 0.42, 10); ctx.fill();
    const cy = fy + (h - 5) / 2;
    if (icon && !label) iconGlyph(icon, x + w / 2, cy, ink);
    else if (icon) {
      const size = h > 60 ? 28 : 18;
      ctx.font = `${size}px ${FD}`;
      const tw = ctx.measureText(label).width, total = tw + 34;
      const sx = x + w / 2 - total / 2;
      iconGlyph(icon, sx + 11, cy, ink);
      text(label, sx + 34, cy + 1, size, ink, 'left');
    } else text(label, x + w / 2, cy + 1, h > 60 ? 28 : 18, ink);
  }
  function iconGlyph(kind, x, y, col) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'pause') { rr(-7, -9, 5, 18, 1.5); ctx.fill(); rr(2, -9, 5, 18, 1.5); ctx.fill(); }
    else if (kind === 'play') { ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(10, 0); ctx.lineTo(-6, 10); ctx.closePath(); ctx.fill(); }
    else if (kind === 'retry') {
      ctx.beginPath(); ctx.arc(0, 0, 9, -0.4, Math.PI * 1.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, -15); ctx.lineTo(11, -8); ctx.lineTo(2, -4); ctx.closePath(); ctx.fill();
    } else if (kind === 'home') {
      ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(0, -11); ctx.lineTo(11, -1); ctx.lineTo(8, -1); ctx.lineTo(8, 10); ctx.lineTo(-8, 10); ctx.lineTo(-8, -1); ctx.closePath(); ctx.fill();
    } else if (kind === 'trophy') {
      ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(7, 0); ctx.quadraticCurveTo(0, 6, -7, 0); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(-8, -5, 4.5, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(8, -5, 4.5, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
      ctx.fillRect(-2, 2, 4, 6); ctx.fillRect(-7, 8, 14, 3);
    } else if (kind === 'sound' || kind === 'mute') {
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-5, -4); ctx.lineTo(2, -10); ctx.lineTo(2, 10); ctx.lineTo(-5, 4); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
      if (kind === 'mute') { ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(13, 5); ctx.moveTo(13, -5); ctx.lineTo(6, 5); ctx.stroke(); }
      else { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(3, 0, 6, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(3, 0, 11, -0.8, 0.8); ctx.stroke(); }
    } else if (kind === 'left' || kind === 'right') {
      const d = kind === 'left' ? -1 : 1;
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-d * 4, -9); ctx.lineTo(d * 5, 0); ctx.lineTo(-d * 4, 9); ctx.stroke();
    } else if (kind === 'lock') {
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -4, 6, Math.PI, 0); ctx.stroke();
      rr(-9, -4, 18, 14, 3); ctx.fill();
    }
    ctx.restore();
  }

  function panel(x, y, w, h, r = 16) {
    ctx.fillStyle = C.panel; rr(x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = C.panelHi; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function hpPanel(x, y, w, F, name, right) {
    const h = 48;
    panel(x, y, w, h, 14);
    const px = right ? x + w - 24 : x + 24, py = y + h / 2;
    ctx.fillStyle = F.champ ? C.red : '#3a3f44'; ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0d0f10'; ctx.beginPath(); ctx.arc(px, py + 1, 9, 0, Math.PI * 2); ctx.fill();
    const band = F.skin.band === SKINS[0].band || F.skin.band === ENEMY_SKIN.band ? '#6a6f74' : F.skin.band;
    ctx.strokeStyle = band; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(px - 9, py - 1); ctx.lineTo(px + 9, py - 2); ctx.stroke();
    const bx = right ? x + 12 : x + 48, bw = w - 60;
    text(name, right ? bx + bw : bx, y + 15, 13, C.white, right ? 'right' : 'left');
    text(String(Math.max(0, Math.ceil(F.hp))), right ? bx : bx + bw, y + 15, 13, C.mute, right ? 'left' : 'right');
    const p = clamp(F.hp / F.maxHp, 0, 1), pl = clamp(F.hpLag / F.maxHp, 0, 1);
    ctx.fillStyle = '#2a2e32'; rr(bx, y + 27, bw, 11, 5); ctx.fill();
    const fill = (q, col) => {
      if (q <= 0.01) return;
      ctx.fillStyle = col;
      if (right) rr(bx + bw * (1 - q), y + 27, bw * q, 11, 5); else rr(bx, y + 27, bw * q, 11, 5);
      ctx.fill();
    };
    fill(pl, '#f4f4f2');
    fill(p, p > 0.5 ? C.green : p > 0.25 ? C.gold : C.red);
  }

  function chipW(c) {
    ctx.font = `13px ${FD}`;
    return ctx.measureText(c.label).width + (c.icon ? 46 : 26);
  }
  function chip(x, y, c) {
    const w = chipW(c);
    panel(x, y, w, 28, 14);
    if (c.icon) { glyph(c.icon, x + 18, y + 14, 0.55); text(c.label, x + 32, y + 15, 13, c.col, 'left'); }
    else text(c.label, x + w / 2, y + 15, 13, c.col);
  }

  function drawHUD() {
    const y = ST + 8;
    hpPanel(12, y, 196, G.player, 'YOU', false);
    hpPanel(LW - 208, y, 196, G.enemy, G.enemy.name, true);
    const pulse = G.comboT > 0 ? 1 + G.comboT * 0.3 : 1;
    ctx.save(); ctx.translate(LW / 2, y + 22); ctx.scale(pulse, pulse);
    text(String(G.score), 0, 0, 40, C.white, 'center', 'rgba(16,18,20,0.88)', 8);
    ctx.restore();
    ctx.save(); ctx.translate(LW / 2, y + 52);
    panel(-38, -10, 76, 20, 10);
    spaced('ROUND ' + G.round, 0, 1, 11, C.white, 1);
    ctx.restore();
    button('pause', 12, y + 60, 44, 44, null, 'dark', 'pause');
    const chips = [];
    if (G.wind) chips.push({ label: 'WIND', col: '#bfe6ff', icon: G.wind > 0 ? 'windR' : 'windL' });
    if (G.enemy.bob) chips.push({ label: 'MOVING', col: C.gold });
    if (G.enemy.champ) chips.push({ label: 'CHAMPION', col: '#ff8a8a' });
    const pw = G.player.power;
    if (pw) chips.push({ label: PICKUPS[pw.type].label + (pw.shots > 1 ? ' ×' + pw.shots : ''), col: PICKUPS[pw.type].col, icon: pw.type });
    if (G.player.shield) chips.push({ label: 'SHIELD', col: PICKUPS.shield.col, icon: 'shield' });
    if (chips.length) {
      const ws = chips.map(chipW);
      const total = ws.reduce((a, b) => a + b, 0) + (chips.length - 1) * 8;
      let cx = Math.max(68, LW / 2 - total / 2);
      chips.forEach((c, i) => { chip(cx, y + 68, c); cx += ws[i] + 8; });
    }
    if (G.combo >= 2) {
      const k = G.comboT > 0 ? 1 + G.comboT * 0.6 : 1;
      ctx.save(); ctx.translate(LW / 2, y + 118); ctx.scale(k, k);
      text('COMBO ' + G.combo + (comboMult() > 1 ? '  ×' + comboMult() : ''), 0, 0, 20, C.gold, 'center', 'rgba(16,18,20,0.88)', 6);
      ctx.restore();
    }
    if (G.tut && G.throws < 2 && !G.player.dead) drawTutorial();
    else if (G.hint) hintPill(G.hint.msg, Math.min(1, G.hint.t * 2));
    if (G.banner) drawBanner();
  }

  function hintPill(msg, a = 1) {
    ctx.globalAlpha = a;
    ctx.font = `16px ${FD}`;
    const w = ctx.measureText(msg).width + 44;
    panel(LW / 2 - w / 2, ST + 140, w, 40, 20);
    text(msg, LW / 2, ST + 161, 16, C.white);
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    const B = G.banner, t = B.t;
    const a = t < 0.2 ? t / 0.2 : t > 1.5 ? (1.8 - t) / 0.3 : 1;
    const cy = ST + HUD_H + 70;
    ctx.globalAlpha = clamp(a, 0, 1);
    const slide = t < 0.25 ? (1 - ease(t / 0.25)) * 80 : 0;
    ctx.fillStyle = 'rgba(16,18,20,0.84)';
    ctx.beginPath(); ctx.moveTo(-offX, cy - 34); ctx.lineTo(VW - offX, cy - 42); ctx.lineTo(VW - offX, cy + 34); ctx.lineTo(-offX, cy + 42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(-offX, cy + 39); ctx.lineTo(VW - offX, cy + 31); ctx.lineTo(VW - offX, cy + 35); ctx.lineTo(-offX, cy + 43); ctx.fill();
    text(B.title, LW / 2 - slide, cy - 8, 34, C.white);
    spaced(B.sub, LW / 2 + slide, cy + 22, 14, B.warn ? C.gold : C.mute, 2);
    ctx.globalAlpha = 1;
  }

  function drawTutorial() {
    const P = G.player;
    const t = (G.t % 2.2) / 2.2;
    const hx = P.tx + 170, hy = feetY(P) - 70;
    const k = t < 0.15 ? 0 : t < 0.75 ? ease((t - 0.15) / 0.6) : 1;
    const px = hx - k * 95, py = hy + k * 70;
    ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
    if (k > 0) {
      ctx.strokeStyle = 'rgba(20,20,20,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    }
    hand(px, py, t > 0.12 && t < 0.78);
    ctx.globalAlpha = 1;
    hintPill(G.throws === 0 ? 'DRAG BACK & RELEASE TO THROW' : 'PULL HARDER TO THROW FARTHER');
  }
  function hand(x, y, down) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35); ctx.scale(down ? 0.92 : 1, down ? 0.92 : 1);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5;
    rr(-5, -2, 10, 22, 5); ctx.fill(); ctx.stroke();
    rr(-12, 12, 26, 24, 9); ctx.fill(); ctx.stroke();
    ctx.fillRect(-3, 10, 6, 6);
    ctx.restore();
    if (down) { ctx.strokeStyle = 'rgba(20,20,20,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); }
  }

  function logo(cx, cy, s) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.save(); ctx.rotate(-0.1);
    drawJavelin(ctx, 240, -2, 1, 0, 480, 1, { jav: '#16191b', tip: C.red });
    ctx.restore();
    text('JAVELIN', 0, -30, 72, '#16191b', 'center', '#eeeeee', 10);
    ctx.save(); ctx.rotate(-0.04);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.moveTo(-114, 12); ctx.lineTo(130, 8); ctx.lineTo(122, 70); ctx.lineTo(-122, 74); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.red;
    ctx.beginPath(); ctx.moveTo(-118, 6); ctx.lineTo(126, 2); ctx.lineTo(118, 64); ctx.lineTo(-126, 68); ctx.closePath(); ctx.fill();
    text('DUEL', 0, 36, 60, C.white);
    ctx.restore();
    ctx.restore();
  }

  function drawTitle() {
    const top = ST + 10;
    const space = Math.max(0, feetY(G.player) - 140 - top);
    const s = clamp(space / 420, 0.75, 1);
    logo(LW / 2, top + 70 * s, s);
    let y = top + 166 * s;
    button('play', LW / 2 - 130, y, 260, 72, 'PLAY', 'primary', 'play');
    y += 92;
    const sk = SKINS[viewSkin], ok = skinUnlocked(sk);
    panel(LW / 2 - 130, y, 260, 56, 16);
    button('skinPrev', LW / 2 - 124, y + 6, 44, 44, null, 'dark', 'left');
    button('skinNext', LW / 2 + 80, y + 6, 44, 44, null, 'dark', 'right');
    spaced('SKIN ' + (viewSkin + 1) + '/' + SKINS.length, LW / 2, y + 17, 10, C.mute, 2);
    if (ok) text(sk.name, LW / 2, y + 38, 18, sk.id === 'shadow' ? C.white : sk.band);
    else {
      iconGlyph('lock', LW / 2 - 58, y + 38, C.mute);
      text('REACH ROUND ' + sk.round, LW / 2 + 8, y + 38, 13, C.mute);
    }
    y += 76;
    spaced('BEST ' + S.best + '   ·   ROUND ' + S.bestRound, LW / 2, y, 13, '#2a2e32', 1);
    button('sound', LW - 56, ST + 8, 44, 44, null, 'dark', S.muted ? 'mute' : 'sound');
    if (lbSupported) button('lb', 12, ST + 8, 44, 44, null, 'dark', 'trophy');
  }

  function drawOver() {
    const t = clamp((G.over - 1.1) / 0.3, 0, 1);
    ctx.fillStyle = `rgba(10,11,12,${0.45 * t})`;
    ctx.fillRect(-offX, 0, VW, LH);
    const w = 380, h = 400;
    const x = LW / 2 - w / 2;
    const y = ST + Math.max(10, (LH - SB - ST - h) * 0.42) + (1 - backOut(t)) * 60;
    ctx.globalAlpha = t;
    panel(x, y, w, h, 22);
    ctx.fillStyle = C.red; rr(x + 24, y, w - 48, 5, 2); ctx.fill();
    spaced('DEFEATED IN ROUND ' + G.round, LW / 2, y + 34, 12, C.mute, 2);
    text(String(G.score), LW / 2, y + 88, 66, C.white);
    if (G.newBest) {
      const k = 1 + Math.sin(G.over * 6) * 0.05;
      ctx.save(); ctx.translate(LW / 2, y + 140); ctx.scale(k, k);
      ctx.fillStyle = C.gold; rr(-72, -14, 144, 28, 14); ctx.fill();
      text('NEW BEST!', 0, 1, 16, '#16191b');
      ctx.restore();
    } else spaced('BEST ' + S.best, LW / 2, y + 140, 14, C.mute, 2);
    const nu = nextUnlock();
    const py = y + 172;
    if (G.unlocked) {
      text('NEW SKIN UNLOCKED: ' + G.unlocked.name, LW / 2, py + 14, 15, G.unlocked.band);
    } else if (nu) {
      text('NEXT SKIN: ' + nu.name, x + 30, py + 6, 13, C.white, 'left');
      text('ROUND ' + S.bestRound + ' / ' + nu.round, x + w - 30, py + 6, 13, C.mute, 'right');
      const prev = SKINS.filter((s) => s.round <= S.bestRound).pop().round;
      const p = clamp((S.bestRound - prev) / (nu.round - prev), 0, 1);
      ctx.fillStyle = '#2a2e32'; rr(x + 30, py + 18, w - 60, 10, 5); ctx.fill();
      ctx.fillStyle = nu.band; rr(x + 30, py + 18, Math.max(10, (w - 60) * p), 10, 5); ctx.fill();
    } else text('ALL SKINS UNLOCKED', LW / 2, py + 14, 15, C.gold);
    if (t >= 1) {
      button('retry', x + 30, y + 222, w - 60, 76, 'PLAY AGAIN', 'primary', 'retry');
      const n = lbSupported ? 2 : 1, bw = (w - 60 - (n - 1) * 12) / n;
      button('home', x + 30, y + 316, bw, 56, 'HOME', 'dark', 'home');
      if (lbSupported) button('lb', x + 30 + bw + 12, y + 316, bw, 56, 'RANKS', 'dark', 'trophy');
    }
    ctx.globalAlpha = 1;
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(10,11,12,0.5)';
    ctx.fillRect(-offX, 0, VW, LH);
    const w = 320, h = 300, x = LW / 2 - w / 2, y = ST + (LH - SB - ST - h) * 0.4;
    panel(x, y, w, h, 22);
    ctx.fillStyle = C.red; rr(x + 24, y, w - 48, 5, 2); ctx.fill();
    text('PAUSED', LW / 2, y + 46, 30, C.white);
    button('resume', x + 26, y + 84, w - 52, 64, 'RESUME', 'primary', 'play');
    button('sound', x + 26, y + 162, w - 52, 50, S.muted ? 'SOUND OFF' : 'SOUND ON', 'dark', S.muted ? 'mute' : 'sound');
    button('home', x + 26, y + 226, w - 52, 50, 'QUIT', 'dark', 'home');
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    const sx = shake ? rand(-shake, shake) * 0.5 : 0, sy = shake ? rand(-shake, shake) * 0.5 : 0;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx) * scale * dpr, sy * scale * dpr);
    buttons = [];
    if (screen === 'loading') {
      text('LOADING…', LW / 2, LH / 2, 28, '#333');
    } else {
      drawScene();
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * scale * dpr, 0);
      if (G.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.6})`; ctx.fillRect(-offX, 0, VW, LH); }
      if (screen === 'title') drawTitle();
      else if (screen === 'play') { drawHUD(); if (paused) { buttons = []; drawPause(); } }
      else if (screen === 'over') drawOver();
    }
    if (toastMsg) {
      ctx.globalAlpha = clamp(toastMsg.t * 2, 0, 1);
      ctx.font = `15px ${FD}`;
      const w = ctx.measureText(toastMsg.msg).width + 40;
      panel(LW / 2 - w / 2, LH - SB - 60, w, 40, 20);
      text(toastMsg.msg, LW / 2, LH - SB - 39, 15, C.white);
      ctx.globalAlpha = 1;
    }
    if (SHOW_SAFE) {
      ctx.fillStyle = 'rgba(255,0,0,0.18)';
      ctx.fillRect(-offX, 0, VW, ST); ctx.fillRect(-offX, LH - SB, VW, SB);
    }
  }

  // ================================================================ loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  if (DEBUG) {
    window.__jd = {
      get G() { return G; }, get screen() { return screen; }, S: () => S, get buttons() { return buttons; },
      newGame, throwAt(angDeg, pow) { G.player.reload = 0; playerThrow(angDeg * Math.PI / 180, pow); },
      handWorld, zones, feetY, uiAction, spawnOrb, roundMods, heightAt, step: (dt) => update(dt),
    };
  }
  boot();
  requestAnimationFrame(frame);
})();
