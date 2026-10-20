/* Javelin Duel: a tower-to-tower javelin fight, built as a Snapchat Web Lens.
 * Drag back and release to throw. Headshots heal you, hits charge an ULTRA
 * javelin, and power-up orbs (which the enemy can grab too) add fire, ice,
 * lightning, bombs and more. Every 5 rounds the arena changes.
 * Everything is drawn in code; the only bundled asset is one font. */
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
  const HUD_H = 196;            // space the HUD keeps clear at the top of the safe zone
  const GRAV = 980;             // javelin gravity, units/s²
  const WIND_A = 150;           // sideways acceleration at full wind
  const JAV = 78;               // javelin length
  const FS = 1.3;               // fighter size
  const TW = 32;                // tower half width
  const V_MIN = 220, V_MAX = 880;
  const PULL_FULL = 170;        // drag distance for full power
  const RELOAD = 0.55;
  const DMG = { head: 70, body: 38, legs: 24 };
  const HEADSHOT_HEAL = 15;
  const MEGA_G = 0.55;          // gravity multiplier of the ULTRA javelin
  const PLAYER_X = 74;

  const SKINS = [
    { id: 'shadow', name: 'SHADOW', round: 0, gear: 'hood', band: '#e8e0f0', jav: '#07040c', tip: '#cfc6dc' },
    { id: 'crimson', name: 'CRIMSON', round: 3, gear: 'topknot', band: '#ff3b5c', jav: '#1c0710', tip: '#ff6b84', trail: '#ff3b5c' },
    { id: 'frost', name: 'FROST', round: 6, gear: 'hood', band: '#35d6ff', jav: '#071a24', tip: '#a8eeff', trail: '#7fe6ff' },
    { id: 'gold', name: 'GOLD', round: 10, gear: 'kasa', band: '#ffcc33', jav: '#241a04', tip: '#ffe27a', trail: '#ffd84a' },
    { id: 'inferno', name: 'INFERNO', round: 15, gear: 'bandana', band: '#ff7a1a', jav: '#200a02', tip: '#ffb03a', trail: '#ff8a2a' },
  ];
  const ENEMY_SKIN = { band: '#ff3b5c', jav: '#07040c', tip: '#9a8fa8' };
  const CHAMP_SKIN = { band: '#ffcc33', jav: '#07040c', tip: '#ff3b5c' };
  const NAMES = ['RONIN', 'VIPER', 'GHOST', 'TALON', 'RAVEN', 'BLADE', 'FANG', 'SHADE', 'HAWK', 'ONYX', 'KESTREL', 'WRAITH'];
  const PICKUPS = {
    heart: { col: '#ff4d6d', label: 'HEAL', w: 14 },
    fire: { col: '#ff8a1f', label: 'FIRE', w: 13 },
    ice: { col: '#5cd8ff', label: 'ICE', w: 12 },
    triple: { col: '#f6f0ff', label: 'TRIPLE', w: 13 },
    shield: { col: '#5dffb0', label: 'SHIELD', w: 11 },
    bolt: { col: '#c9a8ff', label: 'LIGHTNING', w: 11 },
    bomb: { col: '#ffcc33', label: 'BOMB', w: 11 },
    gold: { col: '#ffd84a', label: '+25', w: 6 },
  };
  // A new arena every 5 rounds.
  const ARENAS = [
    { name: 'SUNSET KEEP', sky: ['#2b1055', '#7a2a7a', '#e0456a', '#ff9a3c'], body: '#ffd27a', glow: 'rgba(255,170,80,0.55)', far: '#5b2468', mid: '#3a1548', near: '#1f0b2c', ground: '#140818', line: '#2a1232', rim: '#ff9a3c', amb: 'ember', bodyR: 70, bodyY: 0.62 },
    { name: 'NEON NIGHT', sky: ['#04041a', '#10164a', '#2b1f72', '#7a2f9a'], body: '#eef2ff', glow: 'rgba(160,190,255,0.45)', far: '#1e1f5a', mid: '#141546', near: '#0b0b2a', ground: '#07071a', line: '#16163a', rim: '#7f8cff', amb: 'star', bodyR: 44, bodyY: 0.3 },
    { name: 'BLOOD MOON', sky: ['#0f0206', '#3a0614', '#7d0d22', '#d0302a'], body: '#ff5a3c', glow: 'rgba(255,60,40,0.5)', far: '#4a0a18', mid: '#2c0510', near: '#18030a', ground: '#0e0206', line: '#260610', rim: '#ff4a3a', amb: 'ash', bodyR: 86, bodyY: 0.42 },
    { name: 'FROST PEAK', sky: ['#0d2748', '#235f96', '#7cc0e6', '#ffd9b0'], body: '#fff4dc', glow: 'rgba(255,240,210,0.6)', far: '#3f6488', mid: '#29476a', near: '#172b45', ground: '#0e1a2c', line: '#1d3150', rim: '#ffe2b8', amb: 'snow', bodyR: 54, bodyY: 0.55 },
  ];

  // UI palette
  const UI = {
    navy: '#120a22', navy2: '#25153f', edge: 'rgba(255,255,255,0.14)',
    white: '#fff6ec', mute: '#b9a9d0', gold: '#ffcc33', orange: '#ff7a1a', red: '#ff3b5c',
    cyan: '#35d6ff', green: '#4dff88', purple: '#7b5cff', ink: '#07040c',
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const snap = window.snapchat || null;
  const SHOW_SAFE = /safe/.test(location.hash);
  const DEBUG = /debug/.test(location.hash);
  // #debug-capture steps frames by hand and renders sound offline, for the preview video
  const CAPTURE = /capture/.test(location.hash);
  const FD = '"Russo One", "Arial Black", Impact, system-ui, sans-serif';

  let dpr = 1, scale = 1, offX = 0, VW = LW, LH = 960, ST = 0, SB = 0, groundY = 800;
  let arena = 0;
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
    const g = [77, 255, 136], y = [255, 204, 51], r = [255, 59, 92];
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
  // Parallelogram slanted by k units, used for the health bars.
  function slant(x, y, w, h, k) {
    ctx.beginPath();
    ctx.moveTo(x + k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x, y + h); ctx.closePath();
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
  // The title screen's demo duel stays silent.
  const quiet = () => !audio || S.muted || (G && G.demo);
  function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
    if (quiet()) return;
    const t = now() + delay;
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
    if (quiet()) return;
    const t = now() + delay;
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
    mega() { noise(0.6, 0.4, 300, 3000, 1.5); tone(110, 0.5, 'sawtooth', 0.12, 2.5); },
    thunk() { tone(140, 0.12, 'sine', 0.35, 0.45); noise(0.06, 0.25, 2200, 600, 1.4); },
    hit() { noise(0.18, 0.45, 900, 200, 0.8, 'lowpass'); tone(95, 0.2, 'sine', 0.4, 0.5); },
    head() { SFX.hit(); tone(1320, 0.18, 'square', 0.06, 0.8, 0.02); tone(1760, 0.22, 'sine', 0.1, 1, 0.05); },
    clash() { tone(1250, 0.35, 'square', 0.07, 0.95); tone(1870, 0.3, 'sine', 0.12, 0.98); noise(0.08, 0.3, 5000, 0, 1, 'highpass'); },
    power() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.13, 1, i * 0.06)); },
    enemyPower() { [523, 415, 330].forEach((f, i) => tone(f, 0.16, 'sawtooth', 0.07, 1, i * 0.07)); },
    heal() { [660, 880, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, 1, i * 0.07)); },
    coin() { tone(988, 0.08, 'square', 0.08); tone(1319, 0.25, 'square', 0.08, 1, 0.08); },
    freeze() { tone(2400, 0.4, 'sine', 0.08, 0.5); noise(0.3, 0.2, 6000, 2000, 2, 'bandpass'); },
    burn() { noise(0.5, 0.25, 400, 1600, 0.8, 'bandpass'); },
    block() { tone(520, 0.3, 'sine', 0.2, 1.6); noise(0.12, 0.2, 3000, 0, 1, 'highpass'); },
    zap() { noise(0.35, 0.5, 4000, 300, 0.6, 'bandpass'); tone(80, 0.3, 'sawtooth', 0.15, 0.5); },
    warn() { tone(1400, 0.08, 'square', 0.05); tone(1400, 0.08, 'square', 0.05, 1, 0.14); },
    boom() { noise(0.7, 0.6, 600, 60, 0.6, 'lowpass'); tone(55, 0.6, 'sine', 0.5, 0.4); },
    combo(n) { tone(440 * Math.pow(1.12, Math.min(n, 12)), 0.1, 'square', 0.05); },
    ultra() { [392, 523, 784, 1047].forEach((f, i) => tone(f, 0.12, 'sawtooth', 0.06, 1, i * 0.05)); },
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
    const c = bctx, A = ARENAS[arena];
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    const X1 = VW;
    const sky = c.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, A.sky[0]); sky.addColorStop(0.35, A.sky[1]); sky.addColorStop(0.7, A.sky[2]); sky.addColorStop(1, A.sky[3]);
    c.fillStyle = sky; c.fillRect(0, 0, X1, LH);
    const rnd = mulberry(11 + arena);
    if (A.amb === 'star' || A.amb === 'ash') {
      for (let i = 0; i < 120; i++) {
        c.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`;
        c.beginPath(); c.arc(rnd() * X1, rnd() * groundY * 0.6, rnd() * 1.4 + 0.3, 0, Math.PI * 2); c.fill();
      }
    }
    // sun or moon with a glow
    const bx = offX + 360, by = ST + (groundY - ST) * A.bodyY * 0.75;
    const glow = c.createRadialGradient(bx, by, A.bodyR * 0.6, bx, by, A.bodyR * 4);
    glow.addColorStop(0, A.glow); glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow; c.fillRect(0, 0, X1, groundY);
    c.fillStyle = A.body; c.beginPath(); c.arc(bx, by, A.bodyR, 0, Math.PI * 2); c.fill();
    if (A.amb === 'star') { c.fillStyle = 'rgba(0,0,0,0.08)'; c.beginPath(); c.arc(bx - 12, by - 8, 10, 0, 7); c.arc(bx + 14, by + 12, 7, 0, 7); c.fill(); }
    // far mountains
    c.fillStyle = A.far;
    c.beginPath(); c.moveTo(0, groundY);
    for (let x = 0; x <= X1 + 40; x += 40) c.lineTo(x, groundY - 260 - Math.sin(x * 0.011 + arena) * 60 - rnd() * 50);
    c.lineTo(X1, groundY); c.closePath(); c.fill();
    // castle layer with spires
    c.fillStyle = A.mid;
    let x = -30;
    while (x < X1) {
      const w = 70 + rnd() * 110, h = 120 + rnd() * 120;
      battlement(c, x, groundY - h, w, h + 10);
      if (rnd() < 0.5) {
        const tw = 34 + rnd() * 18, th = h + 60 + rnd() * 60, tx = x + rnd() * (w - tw);
        c.fillRect(tx, groundY - th, tw, th);
        c.beginPath(); c.moveTo(tx - 6, groundY - th); c.lineTo(tx + tw / 2, groundY - th - 50 - rnd() * 30); c.lineTo(tx + tw + 6, groundY - th); c.fill();
        c.fillStyle = A.rim; c.globalAlpha = 0.55;
        c.fillRect(tx + tw / 2 - 3, groundY - th + 26, 6, 9);
        c.globalAlpha = 1; c.fillStyle = A.mid;
      }
      x += w + rnd() * 60;
    }
    // near hills
    c.fillStyle = A.near;
    c.beginPath(); c.moveTo(0, groundY);
    for (let x2 = 0; x2 <= X1 + 30; x2 += 30) c.lineTo(x2, groundY - 70 - Math.sin(x2 * 0.02) * 18 - rnd() * 14);
    c.lineTo(X1, groundY); c.closePath(); c.fill();
    // ground wall with a lit edge
    c.fillStyle = A.ground;
    c.fillRect(0, groundY, X1, LH - groundY + 2);
    for (let mx = -((offX % 28) + 28); mx < X1; mx += 28) c.fillRect(mx, groundY - 10, 18, 11);
    c.fillStyle = A.rim; c.globalAlpha = 0.35;
    for (let mx = -((offX % 28) + 28); mx < X1; mx += 28) c.fillRect(mx, groundY - 10, 18, 2);
    c.globalAlpha = 1;
    c.strokeStyle = A.line; c.lineWidth = 2;
    for (let row = 0, y = groundY + 10; y < LH; y += 17, row++) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(X1, y); c.stroke();
      for (let bx2 = -(row % 2 ? 22 : 0); bx2 < X1; bx2 += 44) {
        c.beginPath(); c.moveTo(bx2, y); c.lineTo(bx2, y + 17); c.stroke();
      }
    }
  }
  function battlement(c, x, y, w, h) {
    c.fillRect(x, y, w, h);
    const n = Math.max(2, Math.round(w / 16));
    const mw = w / (n * 2 - 1);
    for (let i = 0; i < n; i++) c.fillRect(x + i * mw * 2, y - 9, mw, 10);
  }
  function setArena(i) {
    if (i === arena) return;
    arena = i;
    amb.length = 0;
    buildBackground();
  }

  // Ambient particles that suit each arena: embers, fireflies, ash or snow.
  const amb = [];
  function updateAmb(dt) {
    const A = ARENAS[arena];
    const want = A.amb === 'snow' ? 60 : 34;
    while (amb.length < want) {
      amb.push({ x: rand(-offX, VW - offX), y: rand(ST, groundY), vx: rand(-10, 10), vy: A.amb === 'snow' ? rand(20, 50) : A.amb === 'ember' ? rand(-30, -10) : rand(-8, 8), r: rand(1, 2.6), t: rand(0, 6) });
    }
    const wind = G ? G.wind : 0;
    for (const p of amb) {
      p.t += dt;
      p.x += (p.vx + wind * 90 + Math.sin(p.t * 1.3) * 8) * dt; p.y += p.vy * dt;
      if (p.y > groundY + 4) p.y = ST - 4;
      if (p.y < ST - 10) p.y = groundY;
      if (p.x > VW - offX + 10) p.x = -offX - 5;
      if (p.x < -offX - 10) p.x = VW - offX + 5;
    }
  }
  function drawAmb() {
    const A = ARENAS[arena];
    const col = A.amb === 'ember' ? '255,170,80' : A.amb === 'star' ? '200,230,140' : A.amb === 'ash' ? '255,120,90' : '255,255,255';
    for (const p of amb) {
      const a = A.amb === 'star' ? 0.3 + 0.7 * Math.abs(Math.sin(p.t * 2)) : 0.65;
      ctx.fillStyle = `rgba(${col},${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ================================================================ fighters
  function makeFighter(side, tx, th, opts = {}) {
    return {
      side, f: side === 'p' ? 1 : -1, tx, th, off: opts.off || 0, by: 0, bob: opts.bob || null,
      hp: opts.hp || 100, maxHp: opts.hp || 100, hpLag: opts.hp || 100, s: opts.s || FS,
      skin: opts.skin || ENEMY_SKIN, champ: !!opts.champ, name: opts.name || 'YOU', gear: opts.gear || null,
      state: 'idle', aimAng: 0.35, aimPow: 0, reload: 0, throwT: 0, hitT: 0, flash: 0,
      stuck: [], dead: false, fall: null, alpha: 1, cool: 1.5, aimT: 0, aimDur: 0.8, plan: null,
      breath: Math.random() * 6, frozen: 0, burn: 0, shield: 0, power: null, rage: 0, rageFlash: 0,
    };
  }
  const feetY = (F) => groundY - F.th + F.off + F.by;
  const foe = (F) => (F.side === 'p' ? G.enemy : G.player);
  const ultraReady = (F) => F.rage >= 100;

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

  const FX_COL = { fire: '255,138,31', ice: '92,216,255', bomb: '255,204,51', mega: '255,216,74' };
  function drawJavelin(c, tipX, tipY, dx, dy, len, alpha = 1, skin = ENEMY_SKIN, fx = null) {
    c.globalAlpha = alpha;
    c.lineCap = 'round';
    const mega = fx === 'mega';
    if (mega) len *= 1.35;
    if (fx) {
      c.strokeStyle = `rgba(${FX_COL[fx]},0.5)`;
      c.lineWidth = mega ? 12 : 7;
      c.beginPath(); c.moveTo(tipX - dx * len * 0.8, tipY - dy * len * 0.8); c.lineTo(tipX, tipY); c.stroke();
    }
    c.strokeStyle = mega ? '#2a1c00' : skin.jav; c.lineWidth = mega ? 4.5 : 2.6;
    c.beginPath(); c.moveTo(tipX - dx * len, tipY - dy * len); c.lineTo(tipX - dx * 9, tipY - dy * 9); c.stroke();
    c.strokeStyle = fx ? `rgb(${FX_COL[fx]})` : skin.tip; c.lineWidth = mega ? 4 : 2.4;
    c.beginPath(); c.moveTo(tipX - dx * (mega ? 16 : 11), tipY - dy * (mega ? 16 : 11)); c.lineTo(tipX, tipY); c.stroke();
    if (fx === 'bomb') { c.fillStyle = '#ffcc33'; c.beginPath(); c.arc(tipX - dx * 14, tipY - dy * 14, 4, 0, 7); c.fill(); }
    c.globalAlpha = 1;
  }

  function heldFx(F) {
    if (ultraReady(F)) return 'mega';
    const t = F.power && F.power.type;
    return t === 'fire' || t === 'ice' || t === 'bomb' ? t : null;
  }

  // Gear sits on the head: hood, kasa (straw hat), topknot, bandana or horns.
  const gearOf = (F) => (F.champ ? 'horns' : F.gear || F.skin.gear || 'bandana');

  // A tapered limb from a (width w1) to b (width w2) with rounded joints.
  function limb(a, b, w1, w2) {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * w1 / 2, a.y + ny * w1 / 2); ctx.lineTo(b.x + nx * w2 / 2, b.y + ny * w2 / 2);
    ctx.lineTo(b.x - nx * w2 / 2, b.y - ny * w2 / 2); ctx.lineTo(a.x - nx * w1 / 2, a.y - ny * w1 / 2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x, a.y, w1 / 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, w2 / 2, 0, Math.PI * 2); ctx.fill();
  }

  // Head with its gear, facing f. Shared by the fighters and the HUD portraits.
  function drawHead(hx, hy, f, gear, band, col, eye, t, flap) {
    ctx.fillStyle = col;
    if (gear === 'hood') {
      ctx.beginPath(); ctx.arc(hx - f, hy - 1, 12.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - f * 6, hy - 10); ctx.quadraticCurveTo(hx - f * 22, hy - 6, hx - f * 24, hy + 6 + Math.sin(t * 5) * 2 * flap); ctx.lineTo(hx - f * 8, hy + 8); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(hx, hy, 10.5, 0, Math.PI * 2); ctx.fill();
    }
    // mask band across the eyes
    ctx.strokeStyle = band; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx - f * 6, hy - 1.5); ctx.lineTo(hx + f * 10, hy - 2.5); ctx.stroke();
    ctx.fillStyle = eye;
    ctx.shadowColor = eye; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.ellipse(hx + f * 5.5, hy - 2.2, 2.6, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col; ctx.strokeStyle = band;
    if (gear === 'kasa') {
      ctx.beginPath(); ctx.moveTo(hx - 20, hy - 6); ctx.quadraticCurveTo(hx, hy - 26, hx + 20, hy - 6); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx - 20, hy - 6); ctx.lineTo(hx + 20, hy - 6); ctx.stroke();
    } else if (gear === 'topknot') {
      ctx.beginPath(); ctx.arc(hx - f * 4, hy - 12, 4.8, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(hx - f * 8, hy - 11); ctx.lineTo(hx, hy - 13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - f * 7, hy - 13); ctx.quadraticCurveTo(hx - f * 14, hy - 14 + Math.sin(t * 6) * 2 * flap, hx - f * 17, hy - 8); ctx.stroke();
    } else if (gear === 'bandana') {
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(hx - f * 9, hy - 5); ctx.lineTo(hx + f * 9, hy - 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - f * 8, hy - 5);
      ctx.quadraticCurveTo(hx - f * 16, hy - 4 + Math.sin(t * 7) * 3 * flap, hx - f * 22, hy + 1 + Math.sin(t * 7 + 1) * 4 * flap);
      ctx.moveTo(hx - f * 8, hy - 4);
      ctx.quadraticCurveTo(hx - f * 14, hy + 2 + Math.sin(t * 6) * 2 * flap, hx - f * 18, hy + 7 + Math.sin(t * 6 + 2) * 3 * flap);
      ctx.stroke();
    } else if (gear === 'horns') {
      ctx.beginPath(); ctx.arc(hx, hy - 1, 12.5, Math.PI, 0); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - 10, hy - 6); ctx.quadraticCurveTo(hx - 22, hy - 14, hx - 17, hy - 27);
      ctx.quadraticCurveTo(hx - 13, hy - 15, hx - 4, hy - 10);
      ctx.moveTo(hx + 10, hy - 6); ctx.quadraticCurveTo(hx + 22, hy - 14, hx + 17, hy - 27);
      ctx.quadraticCurveTo(hx + 13, hy - 15, hx + 4, hy - 10);
      ctx.fill();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy - 1, 12.5, Math.PI, 0); ctx.stroke();
    }
  }

  function drawFighter(F) {
    if (F.alpha <= 0) return;
    const P = pose(F);
    let x = F.tx, y = feetY(F), rot = 0;
    if (F.fall) { x = F.fall.x; y = F.fall.y; rot = F.fall.rot; }
    // ultra aura
    if (ultraReady(F) && !F.fall) {
      const a = 0.35 + Math.sin(F.breath * 8) * 0.15;
      const g = ctx.createRadialGradient(x, y - 45 * F.s, 10, x, y - 45 * F.s, 70);
      g.addColorStop(0, `rgba(255,204,51,${a})`); g.addColorStop(1, 'rgba(255,204,51,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 45 * F.s, 70, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(F.s, F.s);
    ctx.globalAlpha = F.alpha;
    for (const j of F.stuck) {
      drawJavelin(ctx, j.lx, j.ly, Math.cos(j.ang), Math.sin(j.ang), JAV / F.s, F.alpha, j.skin);
      ctx.globalAlpha = F.alpha;
    }
    const f = F.f, t = F.breath, flap = F.frozen > 0 ? 0 : 1;
    const col = F.flash > 0 ? '#ff2a4a' : F.frozen > 0 ? '#1d5f86' : UI.ink;
    const band = F.skin.band, eye = F.side === 'p' ? UI.cyan : UI.red;
    const gear = gearOf(F);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // spine frame
    const sx = P.neck.x - P.hip.x, sy = P.neck.y - P.hip.y, sl = Math.hypot(sx, sy) || 1;
    const nx = -sy / sl, ny = sx / sl;   // perpendicular to the spine
    // champion cape, behind everything
    if (gear === 'horns') {
      ctx.fillStyle = '#5a0a18';
      ctx.beginPath();
      ctx.moveTo(P.neck.x + f * 3, P.neck.y + 2);
      ctx.quadraticCurveTo(P.neck.x - f * 20, P.neck.y + 10, P.hip.x - f * (24 + Math.sin(t * 4) * 3 * flap), P.hip.y + 22);
      ctx.lineTo(P.hip.x - f * 6, P.hip.y + 14);
      ctx.closePath(); ctx.fill();
    }
    // scarf tails
    const anc = { x: P.neck.x - f * 3, y: P.neck.y + 2 };
    ctx.strokeStyle = band;
    for (const off of [0, 1]) {
      let px = anc.x, py = anc.y + off * 2;
      for (let i = 1; i <= 6; i++) {
        const qx = anc.x - f * i * 5.2, qy = anc.y + off * 2 + i * (1.8 + off * 0.8) + Math.sin(t * 8 - i * 0.9 + off) * i * 0.7 * flap;
        ctx.lineWidth = 4.2 - i * 0.55;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
        px = qx; py = qy;
      }
    }
    ctx.fillStyle = col;
    // back leg, back arm
    const [bl, fl] = P.legs;
    limb(P.hip, bl.k, 8, 6); limb(bl.k, bl.ft, 6, 4.2); limb(bl.ft, { x: bl.ft.x + f * 6, y: bl.ft.y }, 4.6, 3);
    if (P.jav) drawJavelin(ctx, P.jav.gx + P.jav.dx * JAV * 0.6 / F.s, P.jav.gy + P.jav.dy * JAV * 0.6 / F.s, P.jav.dx, P.jav.dy, JAV / F.s, F.alpha, F.skin, heldFx(F));
    ctx.globalAlpha = F.alpha; ctx.fillStyle = col;
    limb(P.sh, P.back.e, 5.6, 4.6); limb(P.back.e, P.back.h, 4.6, 3.6);
    ctx.beginPath(); ctx.arc(P.back.h.x, P.back.h.y, 3.4, 0, Math.PI * 2); ctx.fill();
    // torso: broad shoulders, narrow waist
    ctx.beginPath();
    ctx.moveTo(P.neck.x + nx * 9.5, P.neck.y + ny * 9.5 + 2);
    ctx.quadraticCurveTo(P.neck.x + f * 6, P.neck.y - 2, P.neck.x - nx * 9.5, P.neck.y - ny * 9.5 + 2);
    ctx.lineTo(P.hip.x - nx * 5.5, P.hip.y - ny * 5.5);
    ctx.lineTo(P.hip.x + nx * 5.5, P.hip.y + ny * 5.5);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(P.hip.x, P.hip.y, 6, 0, Math.PI * 2); ctx.fill();
    // belt
    const bx = lerp(P.hip.x, P.neck.x, 0.14), by = lerp(P.hip.y, P.neck.y, 0.14);
    ctx.strokeStyle = band; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(bx + nx * 6.4, by + ny * 6.4); ctx.lineTo(bx - nx * 6.4, by - ny * 6.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - f * 2, by); ctx.lineTo(bx - f * 7, by + 7 + Math.sin(t * 7) * flap); ctx.stroke();
    // front leg
    ctx.fillStyle = col;
    limb(P.hip, fl.k, 8, 6); limb(fl.k, fl.ft, 6, 4.2); limb(fl.ft, { x: fl.ft.x + f * 6, y: fl.ft.y }, 4.6, 3);
    // neck + head
    if (F.headless) {
      ctx.fillStyle = '#b3102a';
      ctx.beginPath(); ctx.ellipse(P.neck.x, P.neck.y - 1, 3.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      limb(P.neck, { x: P.head.x, y: P.head.y + 6 }, 5, 5);
      drawHead(P.head.x, P.head.y, f, gear, band, col, eye, t, flap);
    }
    // shoulder pad and front arm
    ctx.fillStyle = col;
    limb(P.sh, P.front.e, 5.6, 4.6); limb(P.front.e, P.front.h, 4.6, 3.6);
    ctx.beginPath(); ctx.arc(P.front.h.x, P.front.h.y, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(P.sh.x + f * 2, P.sh.y + 1, 6.5, 4.5, f * 0.3, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = band; ctx.lineWidth = 1.6; ctx.globalAlpha = F.alpha * 0.85;
    ctx.beginPath(); ctx.ellipse(P.sh.x + f * 2, P.sh.y + 1, 6.5, 4.5, f * 0.3, Math.PI, 0); ctx.stroke();
    ctx.globalAlpha = F.alpha;
    if (F.frozen > 0 && !F.fall) {
      ctx.globalAlpha = F.alpha * Math.min(1, F.frozen * 3) * 0.5;
      ctx.fillStyle = '#bfeeff'; rr(-26, -92, 52, 94, 8); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-16, -82); ctx.lineTo(-6, -64); ctx.moveTo(12, -40); ctx.lineTo(18, -26); ctx.stroke();
    }
    ctx.restore();
    if (F.shield > 0 && !F.fall) {
      const c = { x: F.tx, y: feetY(F) - 42 * F.s }, r = 62 + Math.sin(F.breath * 4) * 2;
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.6, c.x, c.y, r);
      g.addColorStop(0, 'rgba(93,255,176,0)'); g.addColorStop(1, 'rgba(93,255,176,0.35)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(93,255,176,0.9)'; ctx.lineWidth = 2.5; ctx.stroke();
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
  const torso = (F) => ({ x: F.tx, y: feetY(F) - 42 * F.s });
  function handWorld(F) {
    const P = pose(F);
    return { x: F.tx + P.sh.x * F.s, y: feetY(F) + P.sh.y * F.s };
  }

  // ================================================================ towers
  function drawTower(F) {
    const top = feetY(F), x = F.tx, A = ARENAS[arena];
    if (top > LH) return;
    ctx.fillStyle = A.near;
    ctx.fillRect(x - TW, top + 16, TW * 2, groundY - top - 14);
    ctx.strokeStyle = A.line; ctx.lineWidth = 1.5;
    for (let y = top + 30, r = 0; y < groundY; y += 16, r++) {
      ctx.beginPath(); ctx.moveTo(x - TW, y); ctx.lineTo(x + TW, y); ctx.stroke();
      for (let bx = x - TW + (r % 2 ? 11 : 0); bx < x + TW; bx += 22) {
        ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx, y + 16); ctx.stroke();
      }
    }
    // rim light from the sky
    ctx.fillStyle = A.rim; ctx.globalAlpha = 0.28;
    ctx.fillRect(x - TW, top + 16, 3, groundY - top - 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = A.ground;
    ctx.fillRect(x - TW - 10, top, TW * 2 + 20, 20);
    ctx.fillRect(x - TW - 4, top + 20, TW * 2 + 8, 5);
    ctx.fillStyle = A.rim; ctx.globalAlpha = 0.4; ctx.fillRect(x - TW - 10, top, TW * 2 + 20, 2); ctx.globalAlpha = 1;
    if (F.bob) {
      ctx.strokeStyle = A.rim; ctx.globalAlpha = 0.5; ctx.lineWidth = 3; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x - TW + 6, top + 25); ctx.lineTo(x - TW + 6, groundY); ctx.moveTo(x + TW - 6, top + 25); ctx.lineTo(x + TW - 6, groundY); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  function drawMerlons(F) {
    const top = feetY(F), x = F.tx;
    ctx.fillStyle = ARENAS[arena].ground;
    for (let i = 0; i < 5; i++) ctx.fillRect(x - TW - 10 + i * (TW * 2 + 8) / 4, top - 10, 12, 11);
    const w = TW * 2 - 6, p = clamp(F.hp / F.maxHp, 0, 1);
    ctx.fillStyle = '#000'; rr(x - w / 2 - 2, top + 5, w + 4, 8, 3); ctx.fill();
    if (p > 0) {
      const col = F.side === 'p' ? UI.cyan : UI.red;
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
  let viewSkin = 0;
  let titleT = 0;
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
      skin: champ ? CHAMP_SKIN : ENEMY_SKIN, name: champ ? 'WARLORD' : pick(NAMES), gear: pick(['kasa', 'topknot', 'bandana', 'hood']),
    });
    F.cool = 1.3 + (round === 1 ? 1 : 0);
    return F;
  }

  function freshRun(demo) {
    return {
      score: 0, kills: 0, round: 1, t: 0, javs: [], orb: null, orbT: demo ? 2 : 5, trans: null, over: 0,
      combo: 0, comboT: 0, throwRec: {}, throwId: 0, wind: 0, windParts: [], slow: 0, flash: 0, strikes: [], bolts: [], booms: [],
      banner: null, heads: [], throws: 0, demo, tut: !demo && S.tut, hint: null, newBest: false, unlocked: null,
      stats: { heads: 0, bestCombo: 0, hits: 0, throws: 0, powers: 0 },
      player: null, enemy: null,
    };
  }

  function setupScene() {
    setArena(0);
    G = freshRun(true);
    viewSkin = SKINS.findIndex((s) => s.id === S.skin);
    G.player = makeFighter('p', PLAYER_X, (groundY - ST) * 0.27, { skin: skinById(S.skin) });
    G.enemy = makeFighter('e', 450, (groundY - ST) * 0.34, { name: 'RONIN', gear: 'kasa' });
    G.player.cool = 0.6; G.enemy.cool = 1.4;
    parts.length = 0; floaters.length = 0;
  }

  function newGame() {
    parts.length = 0; floaters.length = 0;
    setArena(0);
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
    const table = Object.keys(PICKUPS).map((k) => [k, PICKUPS[k].w * (k === 'heart' && p.hp < 55 ? 2.5 : 1)]);
    let r = Math.random() * table.reduce((a, b) => a + b[1], 0), type = 'heart';
    for (const [k, w] of table) { r -= w; if (r <= 0) { type = k; break; } }
    G.orb = { type, x, y, t: 0, pop: 0 };
    if (!S.seenOrb && !G.demo) {
      S.seenOrb = true; writeSave();
      G.hint = { msg: 'HIT ORBS FOR POWER-UPS · ENEMIES CAN TOO!', t: 4.5 };
    }
  }
  const orbPos = (O, ahead = 0) => ({ x: O.x, y: O.y + Math.sin((O.t + ahead) * 2.2) * 6 });

  function claimOrb(O, owner) {
    O.pop = 0.001;
    const def = PICKUPS[O.type];
    const F = owner === 'p' ? G.player : G.enemy;
    if (F.dead) return;
    burstRing(O.x, O.y, def.col);
    const mine = owner === 'p';
    if (mine) G.stats.powers++;
    if (O.type === 'heart') {
      F.hp = Math.min(F.maxHp, F.hp + 35);
      float(O.x, O.y - 30, '+35 HP', 22, UI.green);
      SFX.heal();
      return;
    }
    if (O.type === 'gold') {
      if (mine) { G.score += 25; float(O.x, O.y - 30, '+25', 26, UI.gold); SFX.coin(); }
      else { float(O.x, O.y - 30, 'STOLEN', 18, UI.red); SFX.enemyPower(); }
      return;
    }
    if (O.type === 'shield') F.shield = 1;
    else if (O.type === 'bolt') {
      G.strikes.push({ tgt: foe(F), t: 0.8, by: owner });
      SFX.warn();
    } else F.power = { type: O.type, shots: O.type === 'fire' ? 2 : 1 };
    float(O.x, O.y - 30, (mine ? '' : 'ENEMY ') + def.label + '!', mine ? 24 : 20, mine ? def.col : UI.red);
    if (mine) SFX.power(); else SFX.enemyPower();
  }

  // ================================================================ throwing
  // Fires F's javelin(s) at elevation ang (radians, toward the foe) and speed sp.
  function launch(F, ang, sp) {
    const ultra = ultraReady(F);
    const pw = F.power;
    const fx = ultra ? 'mega' : heldFx(F);
    const angs = !ultra && pw && pw.type === 'triple' ? [ang - 0.075, ang, ang + 0.075] : [ang];
    const id = ++G.throwId;
    const h = handWorld(F);
    for (const a of angs) {
      const vx = F.f * Math.cos(a) * sp, vy = -Math.sin(a) * sp;
      const dx = vx / sp, dy = vy / sp;
      G.javs.push({
        x: h.x + dx * JAV * 0.55, y: h.y + dy * JAV * 0.55, vx, vy, owner: F.side, g: fx === 'mega' ? MEGA_G : 1,
        state: 'fly', ang: Math.atan2(vy, vx), life: 0, spin: 0, alpha: 1, age: 0,
        skin: F.skin, fx, id, tower: null,
      });
    }
    if (F.side === 'p') { G.throwRec[id] = { live: angs.length, hit: false, keep: false }; G.stats.throws++; }
    if (ultra) { F.rage = 0; SFX.mega(); shake = Math.max(shake, 4); }
    else if (pw) { pw.shots--; if (pw.shots <= 0) F.power = null; }
    F.state = 'throw'; F.throwT = 0.28; F.reload = RELOAD; F.aimPow = 0;
    SFX.throw(clamp((sp - V_MIN) / (V_MAX - V_MIN), 0, 1));
  }

  function playerThrow(ang, pow) {
    launch(G.player, ang, lerp(V_MIN, V_MAX, pow));
    G.throws++;
    if (G.tut && G.throws >= 2) { G.tut = false; S.tut = false; writeSave(); }
  }

  // Tracks whether each player throw landed, for the combo.
  function resolveThrow(j, outcome) {
    if (j.owner !== 'p' || !j.id || G.demo) return;
    const id = j.id, r = G.throwRec[id];
    j.id = 0;
    if (!r) return;
    r.live--;
    if (outcome === 'hit' && !r.hit) {
      r.hit = true;
      G.combo++; G.comboT = 0.5;
      G.stats.bestCombo = Math.max(G.stats.bestCombo, G.combo);
      if (G.combo >= 2) SFX.combo(G.combo);
    }
    if (outcome === 'keep') r.keep = true;
    if (r.live <= 0) {
      if (!r.hit && !r.keep && G.combo > 0) {
        if (G.combo >= 3) float(G.player.tx + 70, feetY(G.player) - 130, 'COMBO LOST', 16, UI.mute);
        G.combo = 0;
      }
      delete G.throwRec[id];
    }
  }
  const comboMult = () => Math.min(5, 1 + Math.floor(Math.max(0, G.combo - 1) / 2));

  // Simulates a throw and returns its height when it reaches targetX (or null).
  function heightAt(x, y, vx, vy, targetX, gMul = 1) {
    const dir = Math.sign(vx), dt = 1 / 120;
    for (let i = 0; i < 700; i++) {
      vx += G.wind * WIND_A * dt; vy += GRAV * gMul * dt;
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

  // AI aim: picks a target (the foe, a near miss, or an orb) and solves for speed.
  function aiPlan(F) {
    const T = foe(F);
    const skill = G.demo ? 3 : G.kills;
    let tgt;
    const O = G.orb;
    if (O && !O.pop && !F.power && Math.random() < (G.demo ? 0.45 : 0.28)) {
      tgt = orbPos(O, 0.9);
    } else {
      const Z = zones(T);
      const head = Math.random() < 0.12 + Math.min(0.25, skill * 0.02);
      tgt = head ? { x: Z.head.x, y: Z.head.y } : { x: lerp(Z.hip.x, Z.neck.x, 0.5), y: lerp(Z.hip.y, Z.neck.y, 0.5) };
      // Early rivals mostly miss; each kill makes the next one sharper.
      const pHit = Math.min(0.72, 0.3 + skill * 0.03) + (F.champ ? 0.08 : 0);
      if (Math.random() > pHit) tgt.x += (Math.random() < 0.45 ? -1 : 1) * rand(95, 170);
    }
    const h = handWorld(F);
    const gMul = ultraReady(F) ? MEGA_G : 1;
    let ang = rand(0.3, 0.85), v = null;
    for (let i = 0; i < 10 && v === null; i++) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const lx = h.x + F.f * c * JAV * 0.55, ly = h.y - s * JAV * 0.55;
      const yAt = (sp) => { const y = heightAt(lx, ly, F.f * c * sp, -s * sp, tgt.x, gMul); return y === null ? 1e9 : y; };
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

  function updateAI(F, dt) {
    const T = foe(F);
    if (F.dead || T.dead || G.over || G.trans) { if (F.state === 'aim') F.state = 'idle'; return; }
    if (G.tut && G.throws === 0) return;
    if (F.frozen > 0) return;
    if (F.state === 'idle' && F.reload <= 0) {
      F.cool -= dt;
      if (F.cool <= 0) {
        F.plan = aiPlan(F);
        F.state = 'aim'; F.aimT = 0;
        const skill = G.demo ? 3 : G.kills;
        F.aimDur = ultraReady(F) ? 1.1 : Math.max(0.45, 0.85 - skill * 0.03);
        if (ultraReady(F) && !G.demo && F.side === 'e') { float(F.tx, feetY(F) - 130, 'ULTRA INCOMING!', 20, UI.gold); SFX.warn(); }
      }
    } else if (F.state === 'aim') {
      F.aimT += dt;
      const k = clamp(F.aimT / F.aimDur, 0, 1);
      F.aimAng = lerp(F.aimAng, F.plan.ang, Math.min(1, dt * 10));
      F.aimPow = F.plan.pow * ease(k);
      if (k >= 1) {
        launch(F, F.plan.ang, F.plan.v);
        const skill = G.demo ? 3 : G.kills;
        F.cool = Math.max(1.0, 2.9 - skill * 0.13) + rand(0, 0.9) - (F.champ ? 0.4 : 0);
      }
    }
  }

  function updateFighter(F, dt) {
    F.breath += F.frozen > 0 ? 0 : dt;
    F.hitT = Math.max(0, F.hitT - dt);
    F.flash = Math.max(0, F.flash - dt);
    F.rageFlash = Math.max(0, F.rageFlash - dt);
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
      if (F.hp <= 0) { if (G.demo) F.hp = 40; else die(F, -F.f, false); }
    }
    if (F.state === 'throw') { F.throwT -= dt; if (F.throwT <= 0) F.state = 'idle'; }
    if (F.state !== 'aim') F.aimAng = lerp(F.aimAng, 0.35, Math.min(1, dt * 6));
    F.reload = Math.max(0, F.reload - dt);
    if (F.headless && F.spurt > 0) {
      F.spurt -= dt;
      const P = pose(F), fl = F.fall, s = F.s;
      const lx = P.neck.x * s, ly = P.neck.y * s, c = Math.cos(fl.rot), sn = Math.sin(fl.rot);
      const nx = fl.x + lx * c - ly * sn, ny = fl.y + lx * sn + ly * c;
      if (Math.random() < dt * 60) {
        const a = fl.rot - Math.PI / 2 + gauss() * 0.35, sp = rand(120, 240) * F.spurt;
        parts.push({ x: nx, y: ny, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.7), max: 0.7, r: rand(1.5, 3.2), col: Math.random() < 0.5 ? '#d1102a' : '#ff3b5c', g: 1 });
      }
    }
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

  function addRage(F, n) {
    if (F.dead) return;
    const was = ultraReady(F);
    F.rage = Math.min(100, F.rage + n);
    if (!was && ultraReady(F)) {
      F.rageFlash = 1.2;
      if (F.side === 'p' && !G.demo) { float(F.tx + 60, feetY(F) - 140, 'ULTRA READY!', 22, UI.gold); SFX.ultra(); }
    }
  }

  // Applies damage from any source. byP: the player caused it.
  function damage(F, dmg, byP, how) {
    if (F.dead) return;
    F.hp -= dmg; F.hitT = 0.3; F.flash = 0.12;
    if (G.demo) { F.hp = Math.max(F.hp, 35); return; }
    if (F.side === 'p') shake = Math.max(shake, how === 'head' ? 12 : 8);
    if (byP && how !== 'burn') {
      const pts = (how === 'head' ? 3 : how === 'body' || how === 'legs' ? 1 : 2) * comboMult();
      G.score += pts;
      G.stats.hits++;
    }
    if (F.hp <= 0) die(F, F.side === 'p' ? -1 : 1, how === 'head');
  }

  function hurt(F, zone, j) {
    const A = j.owner === 'p' ? G.player : G.enemy;
    let dmg = DMG[zone];
    if (j.owner === 'e' && G.enemy.champ) dmg *= 1.2;
    if (j.fx === 'fire') dmg *= 1.5;
    if (j.fx === 'mega') dmg *= 2;
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    blood(j.x, j.y, dx, dy, zone === 'head' ? 26 : 16);
    if (zone === 'head') SFX.head(); else SFX.hit();
    F.stuck.push({ lx: (j.x + dx * 7 - F.tx) / F.s, ly: (j.y + dy * 7 - feetY(F)) / F.s, ang: j.ang, skin: j.skin, zone });
    if (F.stuck.length > 6) F.stuck.shift();
    if (j.fx === 'fire') { F.burn = 3; SFX.burn(); }
    if (j.fx === 'ice') {
      F.frozen = 2.4; F.state = 'idle'; F.aimPow = 0;
      SFX.freeze(); float(F.tx, feetY(F) - 120, 'FROZEN', 22, '#7fe6ff');
      if (F.side === 'p') aim = null;
    }
    if (j.fx === 'bomb') explode(j.x, j.y, j.owner, true);
    const mine = j.owner === 'p';
    if (mine) resolveThrow(j, 'hit');
    // headshots heal the thrower
    if (zone === 'head' && !A.dead) {
      A.hp = Math.min(A.maxHp, A.hp + HEADSHOT_HEAL);
      if (!G.demo) float(A.tx, feetY(A) - 120, '+' + HEADSHOT_HEAL + ' HP', 20, UI.green);
      if (mine) G.stats.heads++;
    }
    addRage(A, zone === 'head' ? 35 : 22);
    addRage(F, 8);
    // a lethal headshot shows BEHEADED! instead
    if (!G.demo && !(zone === 'head' && F.hp - dmg <= 0)) {
      const mult = mine ? comboMult() : 1;
      if (zone === 'head') float(j.x, j.y - 34, mine ? 'HEADSHOT +' + 3 * mult : 'HEADSHOT', 22, UI.gold);
      else float(j.x, j.y - 22, mine ? '+' + mult : '-' + Math.round(dmg), 20, mine ? UI.white : UI.red);
    }
    damage(F, dmg, mine, zone);
  }

  function explode(x, y, owner, direct) {
    const T = owner === 'p' ? G.enemy : G.player;
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 360);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.4, 0.8), max: 0.8, r: rand(2.5, 6), col: pick(['#ffcc33', '#ff7a1a', '#ff3b5c', '#fff3c0']), g: 0.4 });
    }
    G.booms.push({ x, y, t: 0 });
    shake = Math.max(shake, 10);
    SFX.boom();
    if (T.dead || T.off !== 0) return;
    const c = torso(T), d = Math.hypot(x - c.x, y - c.y);
    if (d > 100) return;
    if (T.shield > 0) { breakShield(T); return; }
    const dmg = Math.round((direct ? 20 : 45) * (1 - d / 140));
    if (dmg <= 0) return;
    if (!G.demo) float(c.x, c.y - 70, 'BOOM -' + dmg, 20, UI.orange);
    damage(T, dmg, owner === 'p', 'bomb');
  }

  function breakShield(T) {
    const c = torso(T);
    T.shield = 0;
    burstRing(c.x, c.y, PICKUPS.shield.col); SFX.block();
    if (!G.demo) float(c.x, c.y - 80, 'BLOCKED', 20, PICKUPS.shield.col);
  }

  function updateStrikes(dt) {
    for (let i = G.strikes.length - 1; i >= 0; i--) {
      const s = G.strikes[i];
      s.t -= dt;
      if (s.t > 0) continue;
      G.strikes.splice(i, 1);
      const T = s.tgt;
      if (T.dead || T.off !== 0) continue;
      const c = torso(T);
      G.bolts.push({ x: c.x, y: c.y - 40, t: 0, seed: Math.random() * 1000 });
      G.flash = Math.max(G.flash, 0.35);
      SFX.zap();
      if (T.shield > 0) { breakShield(T); continue; }
      sparks(c.x, c.y - 30, 24);
      if (!G.demo) float(c.x, c.y - 90, 'ZAP -22', 22, PICKUPS.bolt.col);
      damage(T, 22, s.by === 'p', 'bolt');
    }
    for (let i = G.bolts.length - 1; i >= 0; i--) { G.bolts[i].t += dt; if (G.bolts[i].t > 0.35) G.bolts.splice(i, 1); }
    for (let i = G.booms.length - 1; i >= 0; i--) { G.booms[i].t += dt; if (G.booms[i].t > 0.4) G.booms.splice(i, 1); }
  }

  // A headshot K.O. knocks the head clean off; it flies on with the javelin still in it.
  function behead(F) {
    const P = pose(F), s = F.s;
    const hx = F.tx + P.head.x * s, hy = feetY(F) + P.head.y * s;
    const last = F.stuck[F.stuck.length - 1];
    let ang = F.f > 0 ? Math.PI : 0, jav = null;
    if (last && last.zone === 'head') {
      F.stuck.pop();
      ang = last.ang;
      jav = { lx: last.lx - P.head.x, ly: last.ly - P.head.y, ang: last.ang, skin: last.skin };
    }
    const sp = rand(240, 320);
    G.heads.push({
      F, x: hx, y: hy, vx: Math.cos(ang) * sp, vy: Math.min(-260, Math.sin(ang) * sp - 260), rot: 0, vr: Math.cos(ang) * 9,
      jav, landed: false, gear: gearOf(F), band: F.skin.band, f: F.f, s,
    });
    F.headless = true; F.spurt = 1.2;
    const c = { x: F.tx + P.neck.x * s, y: feetY(F) + P.neck.y * s };
    blood(c.x, c.y, 0, -1, 36);
    if (!G.demo) float(hx, hy - 40, F.side === 'e' ? 'BEHEADED!' : 'HEAD OFF!', 26, UI.red);
  }

  function updateHeads(dt) {
    if (G.heads.length && G.heads.some((H) => H.F.alpha <= 0)) G.heads = G.heads.filter((H) => H.F.alpha > 0);
    for (const H of G.heads) {
      if (H.landed) continue;
      H.vy += GRAV * dt; H.x += H.vx * dt; H.y += H.vy * dt; H.rot += H.vr * dt;
      if (Math.random() < dt * 40) parts.push({ x: H.x, y: H.y + 8, vx: rand(-30, 30), vy: rand(-20, 40), life: 0.5, max: 0.5, r: rand(1.5, 3), col: '#d1102a', g: 1 });
      const floor = groundY - 12 * H.s;
      if (H.y >= floor) {
        H.y = floor;
        if (Math.abs(H.vy) > 140) { H.vy *= -0.38; H.vx *= 0.6; H.vr *= 0.6; dust(H.x, groundY, 6); SFX.fall(); }
        else { H.landed = true; H.vy = 0; }
      }
    }
  }

  function drawHeads() {
    for (const H of G.heads) {
      const a = H.F.alpha;
      if (a <= 0) continue;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(H.x, H.y); ctx.rotate(H.rot); ctx.scale(H.s, H.s);
      if (H.jav) drawJavelin(ctx, H.jav.lx, H.jav.ly, Math.cos(H.jav.ang), Math.sin(H.jav.ang), JAV / H.s, a, H.jav.skin);
      ctx.globalAlpha = a;
      drawHead(0, 0, H.f, H.gear, H.band, UI.ink, '#3a3340', 0, 0);
      ctx.fillStyle = '#b3102a';
      ctx.beginPath(); ctx.ellipse(0, 10, 4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function die(F, dir, headshot) {
    if (F.dead) return;
    F.hp = 0; F.dead = true; F.state = 'idle'; F.frozen = 0; F.burn = 0; F.shield = 0;
    const y = feetY(F);
    // topple forward off the tower so the body lands in view
    F.fall = { x: F.tx, y, vx: F.f * rand(70, 110), vy: -220, rot: 0, vr: Math.sign(dir || F.f) * 3.2, landed: false };
    if (headshot) behead(F);
    G.slow = 0.75; G.flash = 0.5;
    G.strikes.length = 0;
    SFX.ko();
    if (F.side === 'e') {
      G.kills++;
      const pts = (10 + (headshot ? 5 : 0)) * comboMult();
      G.score += pts;
      SFX.kill();
      float(F.tx - 30, y - 190, 'K.O. +' + pts, 34, UI.gold);
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
        const newArena = Math.floor((G.round - 1) / 5) % ARENAS.length;
        if (newArena !== arena) { setArena(newArena); subs.push(ARENAS[newArena].name); }
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
        j.vy += GRAV * (j.state === 'fly' ? j.g : 1) * h; j.x += j.vx * h; j.y += j.vy * h;
        if (j.state === 'fly') j.ang = Math.atan2(j.vy, j.vx);
        else j.ang += j.spin * h;
        if (j.state === 'fly' && collideJavelin(j)) { G.javs.splice(i, 1); removed = true; break; }
        if (j.state === 'fall' && j.y >= groundY - 4) { j.y = groundY - 4; stick(j, 2, null); }
        if (j.state === 'stuck') break;
      }
      if (removed) continue;
      const trail = j.fx ? `rgb(${FX_COL[j.fx]})` : j.owner === 'p' ? j.skin.trail : null;
      if (j.state === 'fly' && trail && Math.random() < 0.85) {
        parts.push({ x: j.x - Math.cos(j.ang) * rand(10, 40), y: j.y - Math.sin(j.ang) * rand(10, 40), vx: 0, vy: 0, life: 0.3, max: 0.3, r: rand(1.5, j.fx === 'mega' ? 4.5 : 3), col: trail, g: 0 });
      }
      if (j.state !== 'stuck' && (j.x < -offX - 150 || j.x > VW - offX + 150 || j.y > LH + 100)) {
        resolveThrow(j, 'miss');
        G.javs.splice(i, 1);
      }
    }
    // mid-air clashes (an ULTRA javelin smashes straight through)
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
            if ((J === A ? B : A).fx === 'mega' && J.fx !== 'mega') { knock(J); continue; }
            if (J.fx === 'mega' && (J === A ? B : A).fx !== 'mega') continue;
            knock(J);
          }
          sparks(mx, my, 18); SFX.clash();
          if (!G.demo) float(mx, my - 24, 'CLASH!', 18, UI.white);
        }
      }
    }
  }
  function knock(J) {
    resolveThrow(J, 'keep');
    J.state = 'fall'; J.vx *= -0.25; J.vy = -rand(120, 260); J.spin = rand(-14, 14);
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
        const c = torso(tgt);
        if (Math.hypot(j.x - c.x, j.y - c.y) < 62) {
          breakShield(tgt);
          if (j.fx !== 'mega') {
            resolveThrow(j, 'keep');
            j.state = 'fall'; j.vx *= -0.3; j.vy = -rand(150, 250); j.spin = rand(-14, 14);
            sparks(j.x, j.y, 16);
            return false;
          }
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
    if (O && !O.pop) {
      const op = orbPos(O);
      if (Math.hypot(j.x - op.x, j.y - op.y) < 28) {
        claimOrb(O, j.owner);
        if (j.owner === 'p' && j.id && G.throwRec[j.id]) G.throwRec[j.id].keep = true;
      }
    }
    for (const T of [tgt, own]) {
      if (T.off < T.th && towerHit(T, j.x, j.y)) {
        if (j.fx === 'bomb') { resolveThrow(j, 'miss'); explode(j.x, j.y, j.owner, false); return true; }
        stick(j, T === own && j.age < 0.15 ? 3 : 7, T); return false;
      }
    }
    if (j.y >= groundY - 4) {
      if (j.fx === 'bomb') { resolveThrow(j, 'miss'); explode(j.x, groundY - 6, j.owner, false); return true; }
      j.y = groundY - 4; stick(j, 8, null);
    }
    return false;
  }
  function stick(j, depth, tower) {
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    if (j.state === 'fly') resolveThrow(j, 'miss');
    if (j.state === 'fall') j.ang = Math.atan2(Math.abs(dy) < 0.4 ? 0.4 : dy, dx);
    j.x += dx * depth; j.y += dy * depth;
    j.state = 'stuck'; j.life = 5; j.vx = j.vy = 0; j.fx = j.fx === 'mega' ? 'mega' : null;
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
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.4, 0.8), max: 0.8, r: rand(1.5, 3.5), col: Math.random() < 0.5 ? '#d1102a' : '#ff3b5c', g: 1 });
    }
  }
  function dust(x, y, n) {
    for (let i = 0; i < n; i++) parts.push({ x, y, vx: rand(-60, 60), vy: rand(-90, -10), life: rand(0.3, 0.6), max: 0.6, r: rand(2, 4), col: 'rgba(200,180,220,0.6)', g: 0.3 });
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
  function confetti() {
    for (let i = 0; i < 90; i++) {
      parts.push({ x: rand(0, LW), y: ST - 10, vx: rand(-60, 60), vy: rand(60, 260), life: rand(1.5, 2.6), max: 2.6, r: rand(2.5, 4.5), col: pick([UI.gold, UI.cyan, UI.red, UI.green, '#c9a8ff']), g: 0.15, ui: true });
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
    if (P.dead || P.frozen > 0) { aim = null; if (P.state === 'aim') P.state = 'idle'; return; }
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
  function updateWorld(dt) {
    if (G.demo) { updateAI(G.player, dt); } else updatePlayer();
    updateAI(G.enemy, dt);
    updateFighter(G.player, dt);
    updateFighter(G.enemy, dt);
    updateJavelins(dt);
    updateStrikes(dt);
    updateTransition(dt);
    updateHeads(dt);
    updateParts(dt);
    for (const j of G.javs) if (j.tower) { const ny = feetY(j.tower); j.y += ny - j.ty0; j.ty0 = ny; }
    if (G.orb) {
      const O = G.orb;
      O.t += dt;
      if (O.pop) { O.pop += dt; if (O.pop > 0.3) { G.orb = null; G.orbT = G.demo ? rand(2, 4) : rand(6, 10); } }
      else if (O.t > 14) { G.orb = null; G.orbT = rand(3, 6); }
    } else if (!G.trans && !G.over && !(G.tut && G.throws === 0)) {
      G.orbT -= dt;
      if (G.orbT <= 0) spawnOrb();
    }
  }

  function update(rdt) {
    updateAmb(rdt);
    if (toastMsg) { toastMsg.t -= rdt; if (toastMsg.t <= 0) toastMsg = null; }
    if (screen === 'loading' || !G) return;
    if (screen === 'title') {
      titleT += rdt;
      G.t += rdt;
      updateWorld(rdt);
      G.flash = Math.max(0, G.flash - rdt * 2);
      shake = 0;
      return;
    }
    if (paused) return;
    // slow motion on every K.O.
    const dt = G.slow > 0 ? rdt * 0.28 : rdt;
    G.slow = Math.max(0, G.slow - rdt);
    G.flash = Math.max(0, G.flash - rdt * 2);
    G.t += dt;
    shake = Math.max(0, shake - rdt * 30);
    if (G.banner) { G.banner.t += rdt; if (G.banner.t > 1.9) G.banner = null; }
    if (G.hint) { G.hint.t -= rdt; if (G.hint.t <= 0) G.hint = null; }
    G.comboT = Math.max(0, G.comboT - rdt);
    updateWorld(dt);
    if (G.over) {
      G.over += rdt;
      if (G.over > 1.1 && screen === 'play') {
        screen = 'over';
        if (G.newBest || G.unlocked) { setTimeout(() => SFX.best(), 300); confetti(); }
      }
    }
  }

  // ================================================================ draw: world
  function drawHeartShape(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.bezierCurveTo(-14, -2, -14, -14, -6.5, -14);
    ctx.bezierCurveTo(-2.5, -14, 0, -10, 0, -8);
    ctx.bezierCurveTo(0, -10, 2.5, -14, 6.5, -14);
    ctx.bezierCurveTo(14, -14, 14, -2, 0, 7);
    const g = ctx.createLinearGradient(0, -14, 0, 7);
    g.addColorStop(0, '#ff7a8f'); g.addColorStop(1, '#e0143c');
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
      ctx.strokeStyle = '#5cd8ff'; ctx.lineWidth = 2.6;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 12);
        ctx.moveTo(-4, -9); ctx.lineTo(0, -6); ctx.lineTo(4, -9);
        ctx.moveTo(-4, 9); ctx.lineTo(0, 6); ctx.lineTo(4, 9);
        ctx.stroke(); ctx.restore();
      }
    } else if (type === 'triple') {
      ctx.strokeStyle = '#f6f0ff'; ctx.lineWidth = 2.6;
      for (const a of [-0.45, 0, 0.45]) {
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(0, -13); ctx.lineTo(3, -7); ctx.stroke();
        ctx.restore();
      }
    } else if (type === 'shield') {
      ctx.fillStyle = '#5dffb0';
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(11, -8); ctx.quadraticCurveTo(11, 7, 0, 13); ctx.quadraticCurveTo(-11, 7, -11, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(18,10,34,0.45)';
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, -5); ctx.quadraticCurveTo(6, 4, 0, 8); ctx.closePath(); ctx.fill();
    } else if (type === 'bolt') {
      ctx.fillStyle = '#c9a8ff';
      ctx.beginPath(); ctx.moveTo(3, -14); ctx.lineTo(-8, 2); ctx.lineTo(-1, 2); ctx.lineTo(-4, 14); ctx.lineTo(8, -3); ctx.lineTo(1, -3); ctx.closePath(); ctx.fill();
    } else if (type === 'bomb') {
      ctx.fillStyle = '#ffcc33'; ctx.beginPath(); ctx.arc(-1, 3, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(4, -5); ctx.quadraticCurveTo(8, -12, 12, -11); ctx.stroke();
      ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(12, -12, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-4, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'gold') {
      const g = ctx.createLinearGradient(0, -12, 0, 12); g.addColorStop(0, '#fff1a8'); g.addColorStop(1, '#e09a10');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a86a00'; ctx.font = `13px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1);
    } else if (type === 'mega') {
      ctx.strokeStyle = UI.gold; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-11, 11); ctx.lineTo(9, -9); ctx.stroke();
      ctx.fillStyle = UI.gold; ctx.beginPath(); ctx.moveTo(13, -13); ctx.lineTo(4, -11); ctx.lineTo(11, -4); ctx.closePath(); ctx.fill();
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
    const p = orbPos(O);
    const appear = Math.min(1, O.t * 4);
    const s = O.pop ? 1 + O.pop * 3 : backOut(appear);
    const a = O.pop ? 1 - O.pop / 0.3 : (O.t > 12 ? 0.5 + 0.5 * Math.sin(O.t * 20) : 1);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(p.x, p.y); ctx.scale(s, s);
    const halo = ctx.createRadialGradient(0, 0, 10, 0, 0, 46);
    halo.addColorStop(0, def.col); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = clamp(a, 0, 1) * 0.45; ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = clamp(a, 0, 1);
    const body = ctx.createRadialGradient(-7, -8, 2, 0, 0, 25);
    body.addColorStop(0, '#3a2660'); body.addColorStop(1, UI.navy);
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = def.col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 31 + Math.sin(O.t * 4) * 2, O.t * 2, O.t * 2 + 1.6); ctx.stroke();
    ctx.restore();
    if (!O.pop) { ctx.globalAlpha = clamp(a, 0, 1); glyph(O.type, p.x, p.y, s); ctx.globalAlpha = 1; }
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
  // Big glossy text with a vertical gradient, dark outline and glow.
  function bigText(str, x, y, size, top, bottom, glow) {
    ctx.font = `${size}px ${FD}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = UI.ink; ctx.lineWidth = size * 0.2;
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 24; }
    ctx.strokeText(str, x, y + size * 0.06);
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillText(str, x, y);
  }

  function drawAimUI() {
    const P = G.player;
    if (P.state !== 'aim' || P.dead) return;
    const h = handWorld(P);
    const dx = Math.cos(P.aimAng), dy = -Math.sin(P.aimAng);
    const len = 18 + P.aimPow * 62;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = powColor(P.aimPow); ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.shadowColor = powColor(P.aimPow); ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(h.x - dx * 14, h.y - dy * 14); ctx.lineTo(h.x - dx * (14 + len), h.y - dy * (14 + len)); ctx.stroke();
    ctx.restore();
    const sp = lerp(V_MIN, V_MAX, P.aimPow);
    const gMul = ultraReady(P) ? MEGA_G : 1;
    let x = h.x + dx * JAV * 0.55, y = h.y + dy * JAV * 0.55, vx = dx * sp, vy = dy * sp;
    ctx.fillStyle = ultraReady(P) ? 'rgba(255,204,51,0.9)' : 'rgba(255,246,236,0.85)';
    for (let i = 1; i <= 6; i++) {
      const t = 0.045 / 3;
      for (let k = 0; k < 3; k++) { vx += G.wind * WIND_A * t; vy += GRAV * gMul * t; x += vx * t; y += vy * t; }
      ctx.beginPath(); ctx.arc(x, y, 3.6 - i * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    meter(P, P.aimPow);
  }
  function meter(F, pow) {
    const x = F.tx - F.f * 40, y1 = feetY(F) - 72 * F.s, hgt = 64;
    ctx.fillStyle = UI.ink; rr(x - 6, y1 - 3, 12, hgt + 6, 4); ctx.fill();
    const g = ctx.createLinearGradient(0, y1 + hgt, 0, y1);
    g.addColorStop(0, UI.green); g.addColorStop(0.5, UI.gold); g.addColorStop(1, UI.red);
    ctx.fillStyle = g;
    const fh = hgt * pow;
    rr(x - 3, y1 + hgt - fh, 6, fh, 2); ctx.fill();
  }

  function drawBolt(b) {
    const a = 1 - b.t / 0.35;
    const rnd = mulberry(Math.floor(b.seed + b.t * 30));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#efe4ff'; ctx.lineWidth = 4; ctx.shadowColor = '#c9a8ff'; ctx.shadowBlur = 22; ctx.lineJoin = 'round';
    ctx.beginPath();
    let x = b.x + (rnd() - 0.5) * 60, y = ST - 20;
    ctx.moveTo(x, y);
    while (y < b.y) { y += 26 + rnd() * 20; x = lerp(x, b.x, 0.25) + (rnd() - 0.5) * 36; ctx.lineTo(x, Math.min(y, b.y)); }
    ctx.stroke();
    ctx.restore();
  }

  function drawScene() {
    drawAmb();
    if (!G) return;
    if (G.windParts.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const w of G.windParts) { ctx.moveTo(w.x, w.y); ctx.lineTo(w.x - Math.sign(G.wind) * w.len, w.y); }
      ctx.stroke();
    }
    if (G.orb) drawOrb(G.orb);
    const P = G.player, E = G.enemy;
    ctx.save();
    ctx.beginPath(); ctx.rect(-offX, -100, VW, groundY + 100); ctx.clip();
    drawTower(E); drawTower(P);
    for (const j of G.javs) if (j.state === 'stuck') drawJavelin(ctx, j.x, j.y, Math.cos(j.ang), Math.sin(j.ang), JAV, j.alpha, j.skin, j.fx === 'mega' ? 'mega' : null);
    for (const F of [P, E]) if (!F.fall) drawFighter(F);
    drawMerlons(E); drawMerlons(P);
    ctx.restore();
    for (const F of [P, E]) if (F.fall) drawFighter(F);
    drawHeads();
    for (const F of [P, E]) if (F.state === 'aim' && !F.dead && (F.side === 'e' || G.demo)) meter(F, F.aimPow);
    // lightning warnings
    for (const s of G.strikes) {
      const c = torso(s.tgt), k = Math.sin(s.t * 30) > 0 ? 1 : 0.4;
      ctx.strokeStyle = `rgba(201,168,255,${k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.x, c.y - 10, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x - 60, c.y - 10); ctx.lineTo(c.x - 40, c.y - 10); ctx.moveTo(c.x + 40, c.y - 10); ctx.lineTo(c.x + 60, c.y - 10); ctx.stroke();
    }
    // held power-ups over each fighter's head
    for (const F of [P, E]) {
      if (F.dead || !(F.power || ultraReady(F)) || F.off !== 0) continue;
      const t = ultraReady(F) ? 'mega' : F.power.type;
      const bx = F.tx, byy = feetY(F) - 130 + Math.sin(G.t * 3) * 3;
      ctx.fillStyle = UI.navy; ctx.beginPath(); ctx.arc(bx, byy, 15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = t === 'mega' ? UI.gold : PICKUPS[t].col; ctx.lineWidth = 2; ctx.stroke();
      glyph(t, bx, byy, 0.62);
    }
    for (const j of G.javs) if (j.state !== 'stuck') drawJavelin(ctx, j.x, j.y, Math.cos(j.ang), Math.sin(j.ang), JAV, 1, j.skin, j.state === 'fly' ? j.fx : null);
    for (const j of G.javs) if (j.state === 'fly' && j.y < ST - 6) {
      ctx.fillStyle = 'rgba(255,246,236,0.8)';
      ctx.beginPath(); ctx.moveTo(j.x, ST + 2); ctx.lineTo(j.x - 6, ST + 12); ctx.lineTo(j.x + 6, ST + 12); ctx.fill();
    }
    for (const b of G.booms) {
      const k = b.t / 0.4;
      ctx.strokeStyle = `rgba(255,204,51,${1 - k})`; ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, 20 + k * 90, 0, Math.PI * 2); ctx.stroke();
    }
    for (const b of G.bolts) drawBolt(b);
    for (const p of parts) {
      if (p.ui) continue;
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
      text(f.txt, 0, 0, f.size, f.col, 'center', UI.ink, 6);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================ draw: UI
  const BTN = {
    primary: { top: '#ffd84a', bottom: '#ff7a1a', edge: '#a8400a', ink: '#3a1400', glow: 'rgba(255,170,40,0.55)' },
    blue: { top: '#8a74ff', bottom: '#5a3df0', edge: '#2c1a8a', ink: UI.white, glow: null },
    dark: { top: '#3a2760', bottom: '#241540', edge: '#0e0720', ink: UI.white, glow: null },
  };
  function button(id, x, y, w, h, label, kind = 'primary', icon = null, pulse = false) {
    buttons.push({ id, x, y, w, h });
    const st = BTN[kind];
    const down = pressed && pressed.id === id;
    const k = pulse && !down ? 1 + Math.sin(performance.now() / 260) * 0.03 : 1;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(k, k); ctx.translate(-w / 2, -h / 2);
    const r = Math.min(h / 2, 22);
    const lift = down ? 1 : 6;
    if (st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = 24; }
    ctx.fillStyle = st.edge; rr(0, 0, w, h, r); ctx.fill();
    ctx.shadowBlur = 0;
    const fy = 6 - lift;
    const g = ctx.createLinearGradient(0, fy, 0, fy + h - 6);
    g.addColorStop(0, st.top); g.addColorStop(1, st.bottom);
    ctx.fillStyle = g; rr(0, fy, w, h - 6, r); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(6, fy + 4, w - 12, (h - 6) * 0.4, r * 0.7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; rr(0.75, fy + 0.75, w - 1.5, h - 7.5, r); ctx.stroke();
    const cy = fy + (h - 6) / 2;
    if (icon && !label) iconGlyph(icon, w / 2, cy, st.ink);
    else {
      const size = h > 64 ? 30 : h > 50 ? 22 : 17;
      ctx.font = `${size}px ${FD}`;
      const tw = ctx.measureText(label).width, total = tw + (icon ? 34 : 0);
      const sx = w / 2 - total / 2;
      if (icon) iconGlyph(icon, sx + 11, cy, st.ink);
      text(label, sx + (icon ? 34 : 0), cy + 1, size, st.ink, 'left');
    }
    ctx.restore();
  }
  function iconGlyph(kind, x, y, col) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'pause') { rr(-7, -9, 5, 18, 1.5); ctx.fill(); rr(2, -9, 5, 18, 1.5); ctx.fill(); }
    else if (kind === 'play') { ctx.beginPath(); ctx.moveTo(-6, -11); ctx.lineTo(11, 0); ctx.lineTo(-6, 11); ctx.closePath(); ctx.fill(); }
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

  function panel(x, y, w, h, r = 18, accent = null) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(46,28,80,0.94)'); g.addColorStop(1, 'rgba(18,10,34,0.94)');
    ctx.fillStyle = g; rr(x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = accent || UI.edge; ctx.lineWidth = accent ? 2.5 : 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; rr(x + 3, y + 3, w - 6, Math.min(24, h * 0.3), r - 3); ctx.fill();
  }

  function portrait(x, y, r, F, col) {
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.fillStyle = UI.navy; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createLinearGradient(0, y - r, 0, y + r);
    g.addColorStop(0, F.side === 'p' ? '#1d4a7a' : '#6a1530'); g.addColorStop(1, UI.navy);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // bust with the fighter's own head gear
    const f = F.side === 'p' ? 1 : -1;
    ctx.fillStyle = UI.ink;
    ctx.beginPath(); ctx.moveTo(x - r * 0.75, y + r); ctx.quadraticCurveTo(x, y + r * 0.2, x + r * 0.75, y + r); ctx.fill();
    ctx.save(); ctx.translate(x, y + 2); ctx.scale(r / 26 * 1.1, r / 26 * 1.1);
    drawHead(0, 0, f, gearOf(F), F.skin.band, UI.ink, col, titleT, 0);
    ctx.restore();
    ctx.restore();
  }

  function fighterHud(F, name, right) {
    const col = right ? UI.red : UI.cyan;
    const y = ST + 10;
    const px = right ? LW - 38 : 38;
    // health bar
    const bw = 158, bh = 18, bx = right ? LW - 70 - bw : 70, by = y + 18;
    text(name, right ? bx + bw - 4 : bx + 4, y + 6, 14, UI.white, right ? 'right' : 'left', UI.ink, 4);
    ctx.fillStyle = 'rgba(7,4,12,0.85)'; slant(bx - 3, by - 3, bw + 6, bh + 6, right ? -8 : 8); ctx.fill();
    const p = clamp(F.hp / F.maxHp, 0, 1), pl = clamp(F.hpLag / F.maxHp, 0, 1);
    const seg = (q, fill) => {
      if (q <= 0.005) return;
      ctx.fillStyle = fill;
      if (right) slant(bx + bw * (1 - q), by, bw * q, bh, -6); else slant(bx, by, bw * q, bh, 6);
      ctx.fill();
    };
    seg(pl, '#fff6ec');
    const g = ctx.createLinearGradient(0, by, 0, by + bh);
    if (p > 0.3) { g.addColorStop(0, right ? '#ff7a8f' : '#7ff0ff'); g.addColorStop(1, right ? '#d1102a' : '#1a8fd8'); }
    else { g.addColorStop(0, '#ffd84a'); g.addColorStop(1, '#ff3b5c'); }
    seg(p, g);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    if (p > 0.005) { if (right) slant(bx + bw * (1 - p), by, bw * p, 5, -2); else slant(bx, by, bw * p, 5, 2); ctx.fill(); }
    text(String(Math.max(0, Math.ceil(F.hp))), right ? bx + 10 : bx + bw - 10, by + bh / 2 + 1, 13, UI.white, right ? 'left' : 'right', UI.ink, 3);
    // ultra (rage) bar
    const ry = by + bh + 8, rw = 120, rx = right ? bx + bw - rw - 8 : bx + 8;
    ctx.fillStyle = 'rgba(7,4,12,0.85)'; rr(rx - 2, ry - 2, rw + 4, 10, 5); ctx.fill();
    const rp = F.rage / 100;
    if (rp > 0) {
      const ready = ultraReady(F);
      ctx.fillStyle = ready ? (Math.sin(performance.now() / 90) > 0 ? '#fff1a8' : UI.gold) : UI.gold;
      if (ready) { ctx.shadowColor = UI.gold; ctx.shadowBlur = 12; }
      if (right) rr(rx + rw * (1 - rp), ry, rw * rp, 6, 3); else rr(rx, ry, rw * rp, 6, 3);
      ctx.fill(); ctx.shadowBlur = 0;
    }
    text(ultraReady(F) ? 'ULTRA!' : 'ULTRA', right ? rx - 6 : rx + rw + 6, ry + 3, 10, ultraReady(F) ? UI.gold : UI.mute, right ? 'right' : 'left', UI.ink, 3);
    portrait(px, y + 26, 26, F, col);
    // status chips under each fighter
    const chips = [];
    if (F.power) chips.push({ t: F.power.type, label: PICKUPS[F.power.type].label + (F.power.shots > 1 ? ' ×' + F.power.shots : '') });
    if (F.shield) chips.push({ t: 'shield', label: 'SHIELD' });
    if (F.frozen > 0) chips.push({ t: 'ice', label: 'FROZEN' });
    if (F.burn > 0) chips.push({ t: 'fire', label: 'BURNING' });
    let cy = y + 62;
    for (const c of chips) {
      ctx.font = `12px ${FD}`;
      const w = ctx.measureText(c.label).width + 40;
      const cx = right ? LW - 12 - w : 12;
      panel(cx, cy, w, 24, 12, PICKUPS[c.t].col);
      glyph(c.t, cx + 15, cy + 12, 0.5);
      text(c.label, cx + 28, cy + 13, 12, UI.white, 'left');
      cy += 28;
    }
  }

  function drawHUD() {
    fighterHud(G.player, 'YOU', false);
    fighterHud(G.enemy, G.enemy.name, true);
    // center score badge
    const cx = LW / 2, y = ST + 10;
    const pulse = G.comboT > 0 ? 1 + G.comboT * 0.3 : 1;
    ctx.save(); ctx.translate(cx, y + 28);
    ctx.fillStyle = UI.navy; ctx.strokeStyle = UI.gold; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(30, -6); ctx.lineTo(24, 26); ctx.lineTo(-24, 26); ctx.lineTo(-30, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.scale(pulse, pulse);
    text(String(G.score), 0, 2, G.score > 999 ? 18 : 24, UI.white);
    ctx.restore();
    ctx.save(); ctx.translate(cx, y + 64);
    ctx.fillStyle = UI.gold; rr(-30, -9, 60, 18, 9); ctx.fill();
    text('RND ' + G.round, 0, 1, 11, '#3a1400');
    ctx.restore();
    button('pause', cx - 20, y + 80, 40, 40, null, 'dark', 'pause');
    // modifiers, centered below
    const mods = [];
    if (G.wind) mods.push({ label: 'WIND', col: '#bfe6ff', icon: G.wind > 0 ? 'windR' : 'windL' });
    if (G.enemy.bob) mods.push({ label: 'MOVING', col: UI.gold });
    if (G.enemy.champ) mods.push({ label: 'BOSS', col: UI.red });
    if (mods.length) {
      ctx.font = `12px ${FD}`;
      const ws = mods.map((m) => ctx.measureText(m.label).width + (m.icon ? 40 : 24));
      const total = ws.reduce((a, b) => a + b, 0) + (mods.length - 1) * 6;
      let x = cx - total / 2;
      mods.forEach((m, i) => {
        panel(x, y + 128, ws[i], 24, 12);
        if (m.icon) { glyph(m.icon, x + 15, y + 140, 0.5); text(m.label, x + 28, y + 141, 12, m.col, 'left'); }
        else text(m.label, x + ws[i] / 2, y + 141, 12, m.col);
        x += ws[i] + 6;
      });
    }
    if (G.combo >= 2) {
      const k = G.comboT > 0 ? 1 + G.comboT * 0.6 : 1;
      ctx.save(); ctx.translate(cx, y + 172); ctx.scale(k, k); ctx.rotate(-0.04);
      bigText('COMBO ' + G.combo + (comboMult() > 1 ? ' ×' + comboMult() : ''), 0, 0, 22, '#fff1a8', UI.orange, 'rgba(255,140,40,0.7)');
      ctx.restore();
    }
    if (G.player.frozen > 0 && !G.player.dead) hintPill('FROZEN! WAIT ' + G.player.frozen.toFixed(1) + 's', 1, UI.cyan);
    else if (G.tut && G.throws < 2 && !G.player.dead) drawTutorial();
    else if (G.hint) hintPill(G.hint.msg, Math.min(1, G.hint.t * 2));
    if (G.banner) drawBanner();
  }

  function hintPill(msg, a = 1, accent = null) {
    ctx.globalAlpha = a;
    ctx.font = `15px ${FD}`;
    const w = ctx.measureText(msg).width + 44;
    panel(LW / 2 - w / 2, ST + HUD_H + 2, w, 38, 19, accent);
    text(msg, LW / 2, ST + HUD_H + 22, 15, UI.white);
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    const B = G.banner, t = B.t;
    const a = t < 0.2 ? t / 0.2 : t > 1.6 ? (1.9 - t) / 0.3 : 1;
    const cy = ST + HUD_H + 90;
    ctx.globalAlpha = clamp(a, 0, 1);
    const slide = t < 0.25 ? (1 - ease(t / 0.25)) * 120 : 0;
    const g = ctx.createLinearGradient(-offX, 0, VW - offX, 0);
    g.addColorStop(0, 'rgba(18,10,34,0)'); g.addColorStop(0.2, 'rgba(18,10,34,0.9)'); g.addColorStop(0.8, 'rgba(18,10,34,0.9)'); g.addColorStop(1, 'rgba(18,10,34,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-offX, cy - 38); ctx.lineTo(VW - offX, cy - 46); ctx.lineTo(VW - offX, cy + 36); ctx.lineTo(-offX, cy + 44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = UI.gold;
    ctx.beginPath(); ctx.moveTo(-offX, cy + 41); ctx.lineTo(VW - offX, cy + 33); ctx.lineTo(VW - offX, cy + 37); ctx.lineTo(-offX, cy + 45); ctx.fill();
    bigText(B.title, LW / 2 - slide, cy - 8, 40, '#ffffff', '#ffd27a', 'rgba(255,170,60,0.6)');
    spaced(B.sub, LW / 2 + slide, cy + 24, 14, B.warn ? UI.gold : UI.mute, 2);
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
      ctx.strokeStyle = 'rgba(255,246,236,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    }
    hand(px, py, t > 0.12 && t < 0.78);
    ctx.globalAlpha = 1;
    hintPill(G.throws === 0 ? 'DRAG BACK & RELEASE TO THROW' : 'PULL HARDER TO THROW FARTHER', 1, UI.gold);
  }
  function hand(x, y, down) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35); ctx.scale(down ? 0.92 : 1, down ? 0.92 : 1);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = UI.ink; ctx.lineWidth = 2.5;
    rr(-5, -2, 10, 22, 5); ctx.fill(); ctx.stroke();
    rr(-12, 12, 26, 24, 9); ctx.fill(); ctx.stroke();
    ctx.fillRect(-3, 10, 6, 6);
    ctx.restore();
    if (down) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14 + Math.sin(G.t * 10) * 2, 0, Math.PI * 2); ctx.stroke(); }
  }

  function logo(cx, cy, s) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    // crossed javelins
    for (const d of [-1, 1]) {
      ctx.save(); ctx.rotate(d * 0.38);
      ctx.shadowColor = 'rgba(255,170,60,0.6)'; ctx.shadowBlur = 16;
      drawJavelin(ctx, d * 210, 4, d, 0, 420, 1, { jav: UI.ink, tip: UI.gold });
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    const wob = Math.sin(titleT * 2) * 0.015;
    ctx.save(); ctx.rotate(-0.05 + wob);
    bigText('JAVELIN', 0, -26, 74, '#ffffff', '#ffd27a', 'rgba(255,190,90,0.7)');
    ctx.restore();
    ctx.save(); ctx.rotate(-0.05 - wob);
    bigText('DUEL', 0, 46, 82, '#ff8a6a', '#e0143c', 'rgba(255,60,90,0.7)');
    ctx.restore();
    ctx.restore();
  }

  function drawTitle() {
    const top = ST + 6;
    const heroTop = Math.min(feetY(G.player), feetY(G.enemy)) - 140;
    const space = Math.max(0, heroTop - top);
    const s = clamp(space / 470, 0.72, 1);
    logo(LW / 2, top + 92 * s, s);
    // feature ribbon
    let y = top + 186 * s;
    const feats = ['HEADSHOTS HEAL', 'POWER-UPS', 'BOSSES'];
    ctx.font = `12px ${FD}`;
    const ws = feats.map((f) => ctx.measureText(f).width + 22);
    let fx = LW / 2 - (ws.reduce((a, b) => a + b, 0) + 12) / 2;
    feats.forEach((f, i) => { panel(fx, y, ws[i], 24, 12, i === 0 ? UI.green : i === 1 ? UI.cyan : UI.red); text(f, fx + ws[i] / 2, y + 13, 12, UI.white); fx += ws[i] + 6; });
    y += 40;
    button('play', LW / 2 - 140, y, 280, 78, 'PLAY', 'primary', 'play', true);
    y += 96;
    const sk = SKINS[viewSkin], ok = skinUnlocked(sk);
    panel(LW / 2 - 140, y, 280, 58, 18, ok ? null : 'rgba(255,255,255,0.08)');
    button('skinPrev', LW / 2 - 134, y + 7, 44, 44, null, 'dark', 'left');
    button('skinNext', LW / 2 + 90, y + 7, 44, 44, null, 'dark', 'right');
    spaced('SKIN ' + (viewSkin + 1) + ' / ' + SKINS.length, LW / 2, y + 17, 10, UI.mute, 2);
    if (ok) text(sk.name, LW / 2, y + 39, 19, sk.band, 'center', UI.ink, 4);
    else {
      iconGlyph('lock', LW / 2 - 62, y + 39, UI.mute);
      text('REACH ROUND ' + sk.round, LW / 2 + 8, y + 39, 14, UI.mute);
    }
    y += 74;
    panel(LW / 2 - 140, y, 280, 34, 17);
    text('BEST ' + S.best, LW / 2 - 70, y + 18, 14, UI.gold);
    text('ROUND ' + S.bestRound, LW / 2 + 70, y + 18, 14, UI.cyan);
    ctx.fillStyle = UI.edge; ctx.fillRect(LW / 2 - 1, y + 8, 2, 18);
    button('sound', LW - 54, ST + 6, 42, 42, null, 'dark', S.muted ? 'mute' : 'sound');
    if (lbSupported) button('lb', 12, ST + 6, 42, 42, null, 'dark', 'trophy');
  }

  function statBox(x, y, w, label, value, col) {
    panel(x, y, w, 52, 14);
    spaced(label, x + w / 2, y + 15, 10, UI.mute, 1.5);
    text(String(value), x + w / 2, y + 36, 20, col);
  }

  function drawOver() {
    const t = clamp((G.over - 1.1) / 0.3, 0, 1);
    ctx.fillStyle = `rgba(7,4,12,${0.55 * t})`;
    ctx.fillRect(-offX, 0, VW, LH);
    const w = 400, h = 470;
    const x = LW / 2 - w / 2;
    const y = ST + 40 + Math.max(0, (LH - SB - ST - 40 - h) * 0.4) + (1 - backOut(t)) * 80;
    ctx.globalAlpha = t;
    // K.O. stamp
    ctx.save(); ctx.translate(LW / 2, y - 6); ctx.rotate(-0.06);
    const st = 1 + Math.max(0, 1 - (G.over - 1.1) * 4) * 1.5;
    ctx.scale(st, st);
    bigText('K.O.', 0, 0, 72, '#ff8a6a', '#e0143c', 'rgba(255,40,80,0.8)');
    ctx.restore();
    panel(x, y + 36, w, h - 36, 24, 'rgba(255,204,51,0.5)');
    const by = y + 36;
    spaced('YOUR SCORE', LW / 2, by + 30, 12, UI.mute, 3);
    bigText(String(G.score), LW / 2, by + 74, 60, '#ffffff', '#ffd27a', null);
    if (G.newBest) {
      const k = 1 + Math.sin(G.over * 6) * 0.05;
      ctx.save(); ctx.translate(LW / 2, by + 118); ctx.scale(k, k);
      const g = ctx.createLinearGradient(0, -14, 0, 14); g.addColorStop(0, '#fff1a8'); g.addColorStop(1, UI.gold);
      ctx.fillStyle = g; rr(-76, -14, 152, 28, 14); ctx.fill();
      text('★ NEW BEST ★', 0, 1, 15, '#3a1400');
      ctx.restore();
    } else text('BEST ' + S.best, LW / 2, by + 118, 15, UI.mute);
    const sw = (w - 48 - 18) / 4;
    const stats = [['ROUND', G.round, UI.cyan], ['HEADSHOT', G.stats.heads, UI.gold], ['COMBO', G.stats.bestCombo, UI.orange], ['POWERS', G.stats.powers, '#c9a8ff']];
    stats.forEach((s, i) => statBox(x + 24 + i * (sw + 6), by + 142, sw, s[0], s[1], s[2]));
    const nu = nextUnlock();
    const py = by + 210;
    if (G.unlocked) {
      text('NEW SKIN UNLOCKED: ' + G.unlocked.name, LW / 2, py + 12, 15, G.unlocked.band, 'center', UI.ink, 4);
    } else if (nu) {
      text('NEXT SKIN: ' + nu.name, x + 26, py + 4, 12, UI.white, 'left');
      text('ROUND ' + S.bestRound + ' / ' + nu.round, x + w - 26, py + 4, 12, UI.mute, 'right');
      const prev = SKINS.filter((s) => s.round <= S.bestRound).pop().round;
      const p = clamp((S.bestRound - prev) / (nu.round - prev), 0, 1);
      ctx.fillStyle = 'rgba(7,4,12,0.8)'; rr(x + 26, py + 16, w - 52, 10, 5); ctx.fill();
      ctx.fillStyle = nu.band; rr(x + 26, py + 16, Math.max(10, (w - 52) * p), 10, 5); ctx.fill();
    } else text('ALL SKINS UNLOCKED', LW / 2, py + 12, 14, UI.gold);
    if (t >= 1) {
      button('retry', x + 24, by + 246, w - 48, 78, 'PLAY AGAIN', 'primary', 'retry', true);
      const n = lbSupported ? 2 : 1, bw = (w - 48 - (n - 1) * 10) / n;
      button('home', x + 24, by + 340, bw, 52, 'HOME', 'blue', 'home');
      if (lbSupported) button('lb', x + 24 + bw + 10, by + 340, bw, 52, 'RANKS', 'blue', 'trophy');
    }
    ctx.globalAlpha = 1;
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(7,4,12,0.6)';
    ctx.fillRect(-offX, 0, VW, LH);
    const w = 320, h = 310, x = LW / 2 - w / 2, y = ST + (LH - SB - ST - h) * 0.4;
    panel(x, y, w, h, 24, 'rgba(255,204,51,0.5)');
    bigText('PAUSED', LW / 2, y + 48, 36, '#ffffff', '#ffd27a', null);
    button('resume', x + 26, y + 88, w - 52, 68, 'RESUME', 'primary', 'play');
    button('sound', x + 26, y + 170, w - 52, 52, S.muted ? 'SOUND OFF' : 'SOUND ON', 'blue', S.muted ? 'mute' : 'sound');
    button('home', x + 26, y + 236, w - 52, 52, 'QUIT', 'dark', 'home');
  }

  function drawUIParts() {
    for (const p of parts) {
      if (!p.ui) continue;
      ctx.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1);
      ctx.fillStyle = p.col;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    const sx = shake ? rand(-shake, shake) * 0.5 : 0, sy = shake ? rand(-shake, shake) * 0.5 : 0;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx) * scale * dpr, sy * scale * dpr);
    buttons = [];
    if (screen === 'loading') {
      text('LOADING…', LW / 2, LH / 2, 28, UI.white);
    } else {
      drawScene();
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * scale * dpr, 0);
      if (G.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.6})`; ctx.fillRect(-offX, 0, VW, LH); }
      if (screen === 'title') {
        // darken the top so the menu reads over the live duel
        const g = ctx.createLinearGradient(0, 0, 0, LH * 0.7);
        g.addColorStop(0, 'rgba(7,4,12,0.55)'); g.addColorStop(1, 'rgba(7,4,12,0)');
        ctx.fillStyle = g; ctx.fillRect(-offX, 0, VW, LH);
        drawTitle();
      } else if (screen === 'play') { drawHUD(); if (paused) { buttons = []; drawPause(); } }
      else if (screen === 'over') drawOver();
      drawUIParts();
    }
    if (toastMsg) {
      ctx.globalAlpha = clamp(toastMsg.t * 2, 0, 1);
      ctx.font = `15px ${FD}`;
      const w = ctx.measureText(toastMsg.msg).width + 40;
      panel(LW / 2 - w / 2, LH - SB - 60, w, 40, 20);
      text(toastMsg.msg, LW / 2, LH - SB - 39, 15, UI.white);
      ctx.globalAlpha = 1;
    }
    if (SHOW_SAFE) {
      ctx.fillStyle = 'rgba(255,0,0,0.25)';
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
      get audio() { return audio; }, playerThrow, launch,
      get G() { return G; }, get screen() { return screen; }, S: () => S, get buttons() { return buttons; },
      newGame, throwAt(angDeg, pow) { G.player.reload = 0; playerThrow(angDeg * Math.PI / 180, pow); },
      handWorld, zones, feetY, uiAction, spawnOrb, roundMods, heightAt, setArena, claimOrb, step: (dt) => update(dt),
    };
  }
  if (DEBUG && CAPTURE) {
    Object.assign(window.__jd, {
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
