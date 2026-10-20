/* Javelin Duel: a tower-to-tower javelin fight, built as a Snapchat Web Lens.
 * Drag back and release to throw. Hit the enemy before they hit you, shoot
 * the heart to heal, and see how many rivals you can knock off their towers.
 * Everything is drawn in code; the only bundled asset is one font. */
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
  const MIN_CONTENT_H = 800;    // logical height the scene needs inside the safe zone
  const GRAV = 980;             // javelin gravity, units/s²
  const JAV = 78;               // javelin length
  const FS = 1.3;               // fighter size
  const TW = 32;                // tower half width
  const V_MIN = 220, V_MAX = 860;
  const PULL_FULL = 170;        // drag distance for full power
  const RELOAD = 0.55;
  const DMG = { head: 70, body: 38, legs: 24 };
  const PLAYER_X = 72;

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
    groundY = LH - SB - 34;
    buildBackground();
  }

  // ================================================================ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
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
    // green -> yellow -> red
    const g = [61, 220, 74], y = [255, 210, 58], r = [255, 59, 59];
    const [a, b, t] = p < 0.5 ? [g, y, p * 2] : [y, r, (p - 0.5) * 2];
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ================================================================ save / Snap API
  const freshSave = () => ({ v: 1, best: 0, muted: false, tut: true });
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
    if (saved && saved.v === 1) S = Object.assign(freshSave(), saved);
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
    heal() { [660, 880, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, 1, i * 0.07)); },
    kill() { tone(70, 0.4, 'sine', 0.45, 0.5); [392, 523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.12, 1, 0.12 + i * 0.07)); },
    fall() { noise(0.25, 0.3, 300, 80, 0.7, 'lowpass', 0); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.14, 1, i * 0.16)); },
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
    const X0 = 0, X1 = VW;
    const sky = c.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#c9c9c9');
    sky.addColorStop(0.55, '#e3e3e3');
    sky.addColorStop(1, '#d6d6d6');
    c.fillStyle = sky; c.fillRect(X0, 0, X1, LH);

    const rnd = mulberry(7);
    // far layer: a castle keep with a spire, and a pine forest
    c.fillStyle = '#c3c3c3';
    const keepX = offX + 120;
    c.fillRect(keepX - 26, groundY - 330, 52, 330);
    c.beginPath(); c.moveTo(keepX - 32, groundY - 330); c.lineTo(keepX, groundY - 400); c.lineTo(keepX + 32, groundY - 330); c.fill();
    for (let x = X0 - 20; x < X1 + 20; x += 18 + rnd() * 14) {
      const h = 60 + rnd() * 70, w = 16 + rnd() * 12, b = groundY - 200;
      c.beginPath(); c.moveTo(x - w, b); c.lineTo(x, b - h); c.lineTo(x + w, b); c.fill();
      c.fillRect(x - w, b, w * 2, 210);
    }
    // mid layer: castle walls with battlements
    c.fillStyle = '#a9a9a9';
    let x = X0 - 40;
    while (x < X1) {
      const w = 90 + rnd() * 120, h = 110 + rnd() * 130;
      battlement(c, x, groundY - h, w, h + 10);
      if (rnd() < 0.45) {
        const tw = 40 + rnd() * 20, th = h + 50 + rnd() * 40, tx = x + rnd() * (w - tw);
        battlement(c, tx, groundY - th, tw, th + 10);
        c.fillStyle = '#bcbcbc';
        c.beginPath(); c.arc(tx + tw / 2, groundY - th + 30, 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#a9a9a9';
      }
      x += w + rnd() * 50;
    }
    // ground wall
    c.fillStyle = '#141414';
    c.fillRect(X0, groundY, X1, LH - groundY + 2);
    for (let mx = X0 - ((offX % 28) + 28); mx < X1; mx += 28) c.fillRect(mx, groundY - 10, 18, 11);
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 2;
    for (let row = 0, y = groundY + 10; y < LH; y += 17, row++) {
      c.beginPath(); c.moveTo(X0, y); c.lineTo(X1, y); c.stroke();
      for (let bx = X0 - (row % 2 ? 22 : 0); bx < X1; bx += 44) {
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
      side, f: side === 'p' ? 1 : -1, tx, th, off: opts.off || 0,
      hp: opts.hp || 100, maxHp: opts.hp || 100, s: opts.s || FS,
      band: opts.band || '#151515', champ: !!opts.champ,
      state: 'idle', aimAng: 0.35, aimPow: 0, reload: 0, throwT: 0, hitT: 0, flash: 0,
      stuck: [], dead: false, fall: null, alpha: 1, cool: 1.5, aimT: 0, aimDur: 0.8, plan: null,
      breath: Math.random() * 6,
    };
  }
  const feetY = (F) => groundY - F.th + F.off;

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

  function drawJavelin(c, tipX, tipY, dx, dy, len, alpha = 1) {
    c.globalAlpha = alpha;
    c.strokeStyle = '#1b1b1b'; c.lineWidth = 2.6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(tipX - dx * len, tipY - dy * len); c.lineTo(tipX - dx * 9, tipY - dy * 9); c.stroke();
    c.strokeStyle = '#6d6d6d'; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(tipX - dx * 10, tipY - dy * 10); c.lineTo(tipX, tipY); c.stroke();
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
    // javelins stuck in the body sit behind it
    for (const j of F.stuck) {
      drawJavelin(ctx, j.lx, j.ly, Math.cos(j.ang), Math.sin(j.ang), JAV / F.s, F.alpha);
      ctx.globalAlpha = F.alpha;
    }
    const col = F.flash > 0 ? '#8a0f14' : '#111';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // headband tails
    const t = F.breath;
    ctx.strokeStyle = F.band; ctx.lineWidth = 2.6;
    const hb = { x: P.head.x - F.f * 8, y: P.head.y - 3 };
    ctx.beginPath(); ctx.moveTo(hb.x, hb.y);
    ctx.quadraticCurveTo(hb.x - F.f * 8, hb.y + Math.sin(t * 7) * 3, hb.x - F.f * 16, hb.y + 4 + Math.sin(t * 7 + 1) * 4);
    ctx.moveTo(hb.x, hb.y + 1);
    ctx.quadraticCurveTo(hb.x - F.f * 7, hb.y + 5 + Math.sin(t * 6) * 2, hb.x - F.f * 13, hb.y + 10 + Math.sin(t * 6 + 2) * 3);
    ctx.stroke();
    ctx.strokeStyle = col;
    // legs
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (const L of P.legs) { ctx.moveTo(P.hip.x, P.hip.y); ctx.lineTo(L.k.x, L.k.y); ctx.lineTo(L.ft.x, L.ft.y); }
    ctx.stroke();
    // back arm + held javelin
    if (P.jav) drawJavelin(ctx, P.jav.gx + P.jav.dx * JAV * 0.6 / F.s, P.jav.gy + P.jav.dy * JAV * 0.6 / F.s, P.jav.dx, P.jav.dy, JAV / F.s, F.alpha);
    ctx.globalAlpha = F.alpha;
    ctx.strokeStyle = col; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(P.sh.x, P.sh.y); ctx.lineTo(P.back.e.x, P.back.e.y); ctx.lineTo(P.back.h.x, P.back.h.y); ctx.stroke();
    // torso
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(P.hip.x, P.hip.y); ctx.lineTo(P.neck.x, P.neck.y); ctx.stroke();
    // head
    ctx.beginPath(); ctx.arc(P.head.x, P.head.y, 10.5, 0, Math.PI * 2); ctx.fill();
    if (F.champ) {
      // horned helmet
      ctx.beginPath(); ctx.arc(P.head.x, P.head.y - 1, 12, Math.PI, 0); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(P.head.x - 10, P.head.y - 6); ctx.quadraticCurveTo(P.head.x - 20, P.head.y - 14, P.head.x - 16, P.head.y - 24);
      ctx.quadraticCurveTo(P.head.x - 12, P.head.y - 14, P.head.x - 4, P.head.y - 10);
      ctx.moveTo(P.head.x + 10, P.head.y - 6); ctx.quadraticCurveTo(P.head.x + 20, P.head.y - 14, P.head.x + 16, P.head.y - 24);
      ctx.quadraticCurveTo(P.head.x + 12, P.head.y - 14, P.head.x + 4, P.head.y - 10);
      ctx.fill();
    }
    // headband
    ctx.strokeStyle = F.band; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(P.head.x - 10, P.head.y - 3); ctx.lineTo(P.head.x + 10, P.head.y - 4); ctx.stroke();
    // front arm
    ctx.strokeStyle = col; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(P.sh.x, P.sh.y); ctx.lineTo(P.front.e.x, P.front.e.y); ctx.lineTo(P.front.h.x, P.front.h.y); ctx.stroke();
    ctx.restore();
  }

  // World-space hit zones of a standing fighter.
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
    const sh = P.sh;
    return { x: F.tx + sh.x * F.s, y: feetY(F) + sh.y * F.s };
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
    // cap
    ctx.fillStyle = '#1f2321';
    ctx.fillRect(x - TW - 10, top, TW * 2 + 20, 20);
    ctx.fillRect(x - TW - 4, top + 20, TW * 2 + 8, 5);
  }
  function drawMerlons(F) {
    const top = feetY(F), x = F.tx;
    ctx.fillStyle = '#1f2321';
    for (let i = 0; i < 5; i++) ctx.fillRect(x - TW - 10 + i * (TW * 2 + 8) / 4, top - 10, 12, 11);
    // health bar
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
  let G = null;        // current run, or the idle scene on the title screen
  let paused = false;
  let toastMsg = null;
  const parts = [], floaters = [];
  let shake = 0;
  function toast(msg) { toastMsg = { msg, t: 2.6 }; }

  function enemyFor(kills, off) {
    const champ = kills % 5 === 4;
    const tx = rand(370, 470), th = towerH();
    const F = makeFighter('e', tx, th, { off, hp: champ ? 150 : 100, s: champ ? FS * 1.12 : FS, champ, band: champ ? '#b3121a' : '#151515' });
    F.cool = 1.3 + (kills === 0 ? 1 : 0);
    return F;
  }

  // Towers scale with the space above the ground, so tall phones get taller towers.
  function towerH() {
    const avail = groundY - ST;
    return clamp(rand(0.24, 0.48) * avail, 150, 420);
  }

  function setupScene() {
    G = {
      score: 0, kills: 0, t: 0, javs: [], heart: null, heartT: 4, trans: null, over: 0,
      player: makeFighter('p', PLAYER_X, (groundY - ST) * 0.32),
      enemy: makeFighter('e', 445, (groundY - ST) * 0.42),
      throws: 0, demo: true,
    };
    G.player.reload = 0;
  }

  function newGame() {
    parts.length = 0; floaters.length = 0;
    G = {
      score: 0, kills: 0, t: 0, javs: [], heart: null, heartT: 5, trans: null, over: 0,
      player: makeFighter('p', PLAYER_X, towerH()),
      enemy: enemyFor(0, 0),
      throws: 0, demo: false, tut: S.tut,
    };
    screen = 'play';
    paused = false;
  }

  function spawnHeart() {
    const p = G.player, e = G.enemy;
    const x = rand(p.tx + 90, e.tx - 90);
    const hi = Math.min(feetY(p), feetY(e));
    const y = rand(hi - 170, Math.max(feetY(p), feetY(e)) - 20);
    G.heart = { x, y, t: 0, pop: 0 };
  }

  // ================================================================ throwing
  function throwJavelin(F, vx, vy) {
    const h = handWorld(F);
    const sp = Math.hypot(vx, vy);
    const dx = vx / sp, dy = vy / sp;
    G.javs.push({
      x: h.x + dx * JAV * 0.55, y: h.y + dy * JAV * 0.55, vx, vy, owner: F.side,
      state: 'fly', ang: Math.atan2(vy, vx), life: 0, spin: 0, alpha: 1, age: 0,
    });
    F.state = 'throw'; F.throwT = 0.28; F.reload = RELOAD; F.aimPow = 0;
    SFX.throw(clamp((sp - V_MIN) / (V_MAX - V_MIN), 0, 1));
  }

  // Speed needed to send the tip from launch to target at elevation ang (dx > 0, dy up).
  function solveSpeed(dx, dy, ang) {
    const c = Math.cos(ang), t = Math.tan(ang);
    const den = 2 * c * c * (dx * t - dy);
    if (den <= 0) return null;
    return Math.sqrt(GRAV * dx * dx / den);
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
    for (let i = 0; i < 12 && !v; i++) {
      // launch point sits ahead of the hand along the throw direction
      const lx = h.x - Math.cos(ang) * JAV * 0.55, ly = h.y - Math.sin(ang) * JAV * 0.55;
      v = solveSpeed(lx - tgt.x, ly - tgt.y, ang);
      if (!v || v > V_MAX) { v = null; ang += 0.08; }
    }
    if (!v) { ang = 0.6; v = 600; }
    v *= 1 + gauss() * 0.025;
    ang += gauss() * 0.015;
    return { ang, v, pow: clamp((v - V_MIN) / (V_MAX - V_MIN), 0, 1) };
  }

  function updateEnemy(E, dt) {
    if (E.dead || G.over || G.trans || G.player.dead) { if (E.state === 'aim') E.state = 'idle'; return; }
    if (G.tut && G.throws === 0) return;
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
        E.cool = Math.max(1.0, 2.9 - G.kills * 0.13) + rand(0, 0.9) - (E.champ ? 0.4 : 0);
      }
    }
  }

  function updateFighter(F, dt) {
    F.breath += dt;
    F.hitT = Math.max(0, F.hitT - dt);
    F.flash = Math.max(0, F.flash - dt);
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
    const dmg = DMG[zone] * (F.side === 'p' && G.enemy.champ ? 1.2 : 1);
    F.hp -= dmg; F.hitT = 0.3; F.flash = 0.12;
    const tip = { x: j.x, y: j.y };
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    blood(tip.x, tip.y, dx, dy, zone === 'head' ? 26 : 16);
    if (zone === 'head') SFX.head(); else SFX.hit();
    // stick it in, in the fighter's local (unscaled) space
    F.stuck.push({ lx: (tip.x + dx * 7 - F.tx) / F.s, ly: (tip.y + dy * 7 - feetY(F)) / F.s, ang: j.ang });
    if (F.stuck.length > 6) F.stuck.shift();
    if (F.side === 'p') shake = Math.max(shake, zone === 'head' ? 12 : 8);
    if (zone === 'head') floaters.push({ x: tip.x, y: tip.y - 30, txt: 'HEADSHOT!', life: 1.1, max: 1.1, size: 22, col: '#b3121a' });
    else floaters.push({ x: tip.x, y: tip.y - 20, txt: '-' + Math.round(dmg), life: 0.9, max: 0.9, size: 18, col: '#1a1a1a' });
    if (F.hp <= 0) die(F, dx);
  }

  function die(F, dir) {
    F.hp = 0; F.dead = true; F.state = 'idle';
    const y = feetY(F);
    // topple forward off the tower so the body lands in view
    F.fall = { x: F.tx, y, vx: F.f * rand(70, 110), vy: -220, rot: 0, vr: Math.sign(dir || F.f) * 3.2, landed: false };
    if (F.side === 'e') {
      G.score++; G.kills++;
      SFX.kill();
      floaters.push({ x: F.tx, y: y - 160, txt: '+1', life: 1.2, max: 1.2, size: 34, col: '#1a1a1a' });
      G.trans = { t: 0, next: null, pFrom: G.player.th, pTo: towerH() };
    } else {
      G.over = 0.001;
      SFX.over();
      endRun();
    }
  }

  function endRun() {
    const newBest = G.score > S.best;
    if (newBest) S.best = G.score;
    G.newBest = newBest && G.score > 0;
    writeSave();
    submitScore(G.score);
  }

  function updateTransition(dt) {
    const T = G.trans;
    if (!T) return;
    T.t += dt;
    const E = G.enemy;
    if (T.t > 0.9) {
      for (const j of G.javs) if (j.state !== 'fly') j.life = Math.min(j.life, 0.35);
    }
    // old tower sinks
    if (T.t > 1.0 && !T.next) {
      const k = clamp((T.t - 1.0) / 0.55, 0, 1);
      E.off = ease(k) * (E.th + 40);
      E.alpha = 1 - k;
      if (k >= 1) {
        T.next = enemyFor(G.kills, 0);
        T.next.off = T.next.th + 40;
        G.enemy = T.next;
        SFX.rise();
      }
    }
    // player tower adjusts while the new one rises
    if (T.t > 1.0) {
      const k = clamp((T.t - 1.0) / 1.2, 0, 1);
      G.player.th = lerp(T.pFrom, T.pTo, ease(k));
    }
    if (T.next) {
      const k = clamp((T.t - 1.55) / 0.65, 0, 1);
      T.next.off = (1 - ease(k)) * (T.next.th + 40);
      if (k >= 1) {
        T.next.off = 0;
        G.trans = null;
        if (T.next.champ) floaters.push({ x: T.next.tx - 20, y: feetY(T.next) - 110, txt: 'CHAMPION', life: 1.6, max: 1.6, size: 24, col: '#b3121a' });
      }
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
      for (let s = 0; s < sub && j.state !== 'stuck'; s++) {
        j.vy += GRAV * h; j.x += j.vx * h; j.y += j.vy * h;
        if (j.state === 'fly') j.ang = Math.atan2(j.vy, j.vx);
        else j.ang += j.spin * h;
        if (j.state === 'fly' && collideJavelin(j)) { G.javs.splice(i, 1); break; }
        if (j.state === 'stuck') break;
      }
      if (j.state !== 'stuck' && G.javs[i] === j && (j.x < -offX - 150 || j.x > VW - offX + 150 || j.y > LH + 100)) G.javs.splice(i, 1);
    }
    // mid-air clashes
    for (let a = 0; a < G.javs.length; a++) {
      const A = G.javs[a];
      if (A.state !== 'fly') continue;
      for (let b = a + 1; b < G.javs.length; b++) {
        const B = G.javs[b];
        if (B.state !== 'fly' || B.owner === A.owner) continue;
        if (segSegDist(tipTail(A)[0], tipTail(A)[1], tipTail(B)[0], tipTail(B)[1]) < 4.5) {
          const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
          for (const J of [A, B]) {
            J.state = 'fall'; J.vx *= -0.25; J.vy = -rand(120, 260); J.spin = rand(-14, 14);
          }
          sparks(mx, my, 18); SFX.clash();
          floaters.push({ x: mx, y: my - 24, txt: 'CLASH!', life: 0.8, max: 0.8, size: 18, col: '#3a3a3a' });
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
      const Z = zones(tgt);
      let zone = null;
      if (Math.hypot(j.x - Z.head.x, j.y - Z.head.y) < Z.headR) zone = 'head';
      else if (segDist(j.x, j.y, Z.neck.x, Z.neck.y, Z.hip.x, Z.hip.y) < Z.bodyR) zone = 'body';
      else if (Z.legs.some(([k, f]) => segDist(j.x, j.y, Z.hip.x, Z.hip.y, k.x, k.y) < Z.legR || segDist(j.x, j.y, k.x, k.y, f.x, f.y) < Z.legR)) zone = 'legs';
      if (zone) { hurt(tgt, zone, j); return true; }
    }
    const H = G.heart;
    if (H && !H.pop && Math.hypot(j.x - H.x, j.y - H.y) < 24) {
      H.pop = 0.001;
      const who = j.owner === 'p' ? G.player : G.enemy;
      if (!who.dead) {
        who.hp = Math.min(who.maxHp, who.hp + 35);
        floaters.push({ x: H.x, y: H.y - 26, txt: '+35', life: 1, max: 1, size: 22, col: '#c4161c' });
      }
      SFX.heal();
      hearts(H.x, H.y);
    }
    for (const T of [tgt, own]) {
      if (T.off < T.th && towerHit(T, j.x, j.y)) { stick(j, T === own && j.age < 0.15 ? 3 : 7); return false; }
    }
    if (j.y >= groundY - 4) { j.y = groundY - 4; stick(j, 8); }
    return false;
  }
  function stick(j, depth) {
    const dx = Math.cos(j.ang), dy = Math.sin(j.ang);
    if (j.state === 'fall') { j.ang = Math.atan2(Math.abs(dy) < 0.4 ? 0.4 : dy, dx); }
    j.x += dx * depth; j.y += dy * depth;
    j.state = 'stuck'; j.life = 5; j.vx = j.vy = 0;
    dust(j.x, j.y, 6);
    SFX.thunk();
  }

  // ================================================================ particles
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
  function hearts(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, 160);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: rand(0.5, 0.9), max: 0.9, r: rand(2.5, 4.5), col: '#e0242c', g: 0.2 });
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
  }

  // ================================================================ input
  let aim = null;              // { sx, sy, x, y, id, release }
  let buttons = [];
  let pressed = null;
  function toLogical(e) {
    return { x: e.clientX / scale - offX, y: e.clientY / scale };
  }
  function hitButton(p) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
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
      else if (screen === 'over' && G.over > 1.6) uiAction('retry');
    } else if ((e.code === 'Escape' || e.code === 'KeyP') && screen === 'play' && !G.over) paused = !paused;
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
    let dx = aim.sx - aim.x, dy = aim.sy - aim.y;
    const len = Math.hypot(dx, dy);
    let ang = Math.atan2(-dy, Math.max(dx, 0.001));
    if (dx < 0) ang = dy > 0 ? -1.2 : 1.53;
    ang = clamp(ang, -1.2, 1.53);
    return { ang, pow: clamp(len / PULL_FULL, 0, 1), len };
  }

  function updatePlayer(dt) {
    const P = G.player;
    if (P.dead) { aim = null; return; }
    if (aim) {
      const v = aimVector();
      if (v.len > 8 || P.state === 'aim') {
        if (P.reload <= 0 && P.state !== 'throw') { P.state = 'aim'; P.aimAng = v.ang; P.aimPow = v.pow; }
      }
      if (aim.release) {
        if (P.state === 'aim' && v.len > 14) {
          const sp = lerp(V_MIN, V_MAX, v.pow);
          throwJavelin(P, Math.cos(v.ang) * sp, -Math.sin(v.ang) * sp);
          G.throws++;
          if (G.tut && G.throws >= 2) { G.tut = false; S.tut = false; writeSave(); }
          aim = null;
        } else if (P.state === 'aim' || v.len <= 14) {
          if (P.state === 'aim') P.state = 'idle';
          aim = null;
        }
        // released during the reload: throw as soon as the javelin is back
      }
    } else if (P.state === 'aim') P.state = 'idle';
  }

  function uiAction(id) {
    SFX.click();
    if (id === 'play' || id === 'retry') newGame();
    else if (id === 'home') { setupScene(); screen = 'title'; paused = false; }
    else if (id === 'pause') paused = true;
    else if (id === 'resume') paused = false;
    else if (id === 'sound') setMuted(!S.muted);
    else if (id === 'lb') showLeaderboard();
  }

  // ================================================================ update
  function update(dt) {
    for (const c of clouds) { c.x += c.v * dt; if (c.x - c.w > VW - offX + 40) { c.x = -offX - c.w - 20; c.y = Math.random(); } }
    if (toastMsg) { toastMsg.t -= dt; if (toastMsg.t <= 0) toastMsg = null; }
    if (screen === 'loading' || !G) return;
    if (screen === 'title') {
      G.t += dt;
      updateFighter(G.player, dt); updateFighter(G.enemy, dt);
      return;
    }
    if (paused) return;
    G.t += dt;
    shake = Math.max(0, shake - dt * 30);
    updatePlayer(dt);
    updateEnemy(G.enemy, dt);
    updateFighter(G.player, dt);
    updateFighter(G.enemy, dt);
    updateJavelins(dt);
    updateTransition(dt);
    updateParts(dt);
    if (G.heart) {
      const H = G.heart;
      H.t += dt;
      if (H.pop) { H.pop += dt; if (H.pop > 0.3) { G.heart = null; G.heartT = rand(7, 12); } }
    } else if (!G.trans && !G.over) {
      G.heartT -= dt;
      if (G.heartT <= 0) spawnHeart();
    }
    if (G.over) {
      G.over += dt;
      if (G.over > 1.4 && screen === 'play') screen = 'over';
    }
  }

  // ================================================================ draw
  function drawHeart(x, y, s, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.bezierCurveTo(-14, -2, -14, -14, -6.5, -14);
    ctx.bezierCurveTo(-2.5, -14, 0, -10, 0, -8);
    ctx.bezierCurveTo(0, -10, 2.5, -14, 6.5, -14);
    ctx.bezierCurveTo(14, -14, 14, -2, 0, 7);
    const g = ctx.createLinearGradient(0, -14, 0, 7);
    g.addColorStop(0, '#ff5a5f'); g.addColorStop(1, '#b8121a');
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(-6, -9, 3, 2, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function text(str, x, y, size, col, align = 'center', stroke = null, sw = 0) {
    ctx.font = `${size}px ${FD}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(str, x, y); }
    ctx.fillStyle = col; ctx.fillText(str, x, y);
  }

  function drawAimUI() {
    const P = G.player;
    if (P.state !== 'aim' || P.dead) return;
    const v = { ang: P.aimAng, pow: P.aimPow };
    const h = handWorld(P);
    const dx = Math.cos(v.ang), dy = -Math.sin(v.ang);
    // pull bar, pointing back along the drag
    const len = 18 + v.pow * 62;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = powColor(v.pow); ctx.lineWidth = 9; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(h.x - dx * 14, h.y - dy * 14); ctx.lineTo(h.x - dx * (14 + len), h.y - dy * (14 + len)); ctx.stroke();
    ctx.restore();
    // short trajectory hint
    const sp = lerp(V_MIN, V_MAX, v.pow);
    let x = h.x + dx * JAV * 0.55, y = h.y + dy * JAV * 0.55, vx = dx * sp, vy = dy * sp;
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    for (let i = 1; i <= 6; i++) {
      const t = 0.045;
      for (let k = 0; k < 3; k++) { vy += GRAV * t / 3; x += vx * t / 3; y += vy * t / 3; }
      ctx.beginPath(); ctx.arc(x, y, 3.4 - i * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    meter(P, v.pow);
  }
  function meter(F, pow) {
    const x = F.tx - F.f * 40, y1 = feetY(F) - 72 * F.s, hgt = 64;
    ctx.fillStyle = '#111'; rr(x - 5, y1 - 2, 10, hgt + 4, 3); ctx.fill();
    const g = ctx.createLinearGradient(0, y1 + hgt, 0, y1);
    g.addColorStop(0, '#3ddc4a'); g.addColorStop(0.5, '#ffd23a'); g.addColorStop(1, '#ff3b3b');
    ctx.fillStyle = g;
    const fh = hgt * pow;
    ctx.fillRect(x - 3, y1 + hgt - fh, 6, fh);
  }

  function drawScene() {
    // clouds
    ctx.fillStyle = 'rgba(248,248,248,0.75)';
    for (const c of clouds) {
      const y = ST + 20 + c.y * Math.max(60, groundY - 520 - ST);
      ctx.beginPath(); ctx.ellipse(c.x, y, c.w / 2, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c.x + c.w * 0.15, y - 6, c.w / 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (!G) return;
    const H = G.heart;
    if (H) {
      const s = H.pop ? 1 + H.pop * 3 : Math.min(1, H.t * 4) * (1 + Math.sin(H.t * 4) * 0.06);
      drawHeart(H.x, H.y + Math.sin(H.t * 2) * 5, s * 1.45, H.pop ? 1 - H.pop / 0.3 : 1);
    }
    const P = G.player, E = G.enemy;
    // towers rise out of and sink into the ground wall
    ctx.save();
    ctx.beginPath(); ctx.rect(-offX, -100, VW, groundY + 100); ctx.clip();
    drawTower(E); drawTower(P);
    for (const j of G.javs) if (j.state === 'stuck') drawJavelin(ctx, j.x, j.y, Math.cos(j.ang), Math.sin(j.ang), JAV, j.alpha);
    for (const F of [P, E]) if (!F.fall) drawFighter(F);
    drawMerlons(E); drawMerlons(P);
    ctx.restore();
    // a fighter that fell lies on the ground in front of the towers
    for (const F of [P, E]) if (F.fall) drawFighter(F);
    if (E.state === 'aim' && !E.dead) meter(E, E.aimPow);
    for (const j of G.javs) if (j.state !== 'stuck') drawJavelin(ctx, j.x, j.y, Math.cos(j.ang), Math.sin(j.ang), JAV, 1);
    // off-screen markers for javelins flying above the top
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
      ctx.globalAlpha = clamp(f.life / f.max * 2, 0, 1);
      text(f.txt, f.x, f.y, f.size, f.col, 'center', 'rgba(255,255,255,0.8)', 4);
    }
    ctx.globalAlpha = 1;
  }

  function iconButton(id, x, y, r, kind) {
    buttons.push({ id, x: x - r, y: y - r, w: r * 2, h: r * 2 });
    const down = pressed && pressed.id === id;
    ctx.save(); ctx.translate(x, y + (down ? 2 : 0));
    ctx.fillStyle = 'rgba(20,20,20,0.72)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2f2f2'; ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    if (kind === 'pause') { ctx.fillRect(-7, -9, 5, 18); ctx.fillRect(2, -9, 5, 18); }
    else if (kind === 'sound') {
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-5, -4); ctx.lineTo(2, -10); ctx.lineTo(2, 10); ctx.lineTo(-5, 4); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
      if (S.muted) { ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(13, 5); ctx.moveTo(13, -5); ctx.lineTo(6, 5); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(3, 0, 7, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(3, 0, 12, -0.8, 0.8); ctx.stroke(); }
    }
    ctx.restore();
  }

  function octButton(id, x, y, r, col, dark, icon) {
    buttons.push({ id, x: x - r, y: y - r, w: r * 2, h: r * 2 });
    const down = pressed && pressed.id === id;
    ctx.save(); ctx.translate(x, y + (down ? 3 : 0));
    const oct = (R) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R, Math.sin(a) * R); }
      ctx.closePath();
    };
    if (!down) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.translate(0, 4); oct(r); ctx.fill(); ctx.translate(0, -4); }
    ctx.fillStyle = dark; oct(r); ctx.fill();
    ctx.fillStyle = col; oct(r - 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(0, -r * 0.45, r * 0.55, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
    const k = r / 34;
    ctx.scale(k, k);
    if (icon === 'play') { ctx.beginPath(); ctx.moveTo(-9, -15); ctx.lineTo(16, 0); ctx.lineTo(-9, 15); ctx.closePath(); ctx.fill(); }
    else if (icon === 'home') {
      ctx.beginPath(); ctx.moveTo(-16, -1); ctx.lineTo(0, -16); ctx.lineTo(16, -1); ctx.lineTo(12, -1); ctx.lineTo(12, 15); ctx.lineTo(-12, 15); ctx.lineTo(-12, -1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(-4, 4, 8, 11);
    } else if (icon === 'trophy') {
      ctx.beginPath(); ctx.moveTo(-11, -14); ctx.lineTo(11, -14); ctx.lineTo(9, 0); ctx.quadraticCurveTo(0, 8, -9, 0); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(-11, -7, 6, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(11, -7, 6, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
      ctx.fillRect(-3, 3, 6, 8); ctx.fillRect(-10, 11, 20, 5);
    }
    ctx.restore();
  }

  function drawHUD() {
    const cx = LW / 2;
    text(String(G.score), cx, ST + 46, 54, '#ffffff', 'center', '#2a2a2a', 6);
    iconButton('pause', 36, ST + 34, 24, 'pause');
    iconButton('sound', LW - 36, ST + 34, 24, 'sound');
    if (G.tut && G.throws < 2 && !G.player.dead) drawTutorial();
  }

  function drawTutorial() {
    const P = G.player;
    const t = (G.t % 2.2) / 2.2;
    const hx = P.tx + 150, hy = feetY(P) - 90;
    const k = t < 0.15 ? 0 : t < 0.75 ? ease((t - 0.15) / 0.6) : 1;
    const px = hx - k * 95, py = hy + k * 70;
    ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
    if (k > 0) {
      ctx.strokeStyle = 'rgba(20,20,20,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    }
    hand(px, py, t > 0.12 && t < 0.78);
    ctx.globalAlpha = 1;
    const msg = G.throws === 0 ? 'DRAG BACK & RELEASE TO THROW' : 'PULL HARDER TO THROW FARTHER';
    ctx.fillStyle = 'rgba(20,20,20,0.75)';
    rr(LW / 2 - 200, ST + 100, 400, 44, 22); ctx.fill();
    text(msg, LW / 2, ST + 123, 17, '#fff');
  }
  function hand(x, y, down) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35); ctx.scale(down ? 0.92 : 1, down ? 0.92 : 1);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    rr(-5, -2, 10, 22, 5); ctx.fill(); ctx.stroke();
    rr(-12, 12, 26, 24, 9); ctx.fill(); ctx.stroke();
    ctx.fillRect(-3, 10, 6, 6);
    ctx.restore();
    if (down) { ctx.strokeStyle = 'rgba(20,20,20,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); }
  }

  function drawTitle() {
    const cy = ST + Math.max(110, (feetY(G.player) - 100 - ST) * 0.38);
    ctx.save();
    ctx.translate(LW / 2, cy);
    // crossed javelins behind the title
    for (const s of [-1, 1]) {
      ctx.save(); ctx.rotate(s * 0.32);
      drawJavelin(ctx, s * 190, 0, s, 0, 380, 0.9);
      ctx.restore();
    }
    text('JAVELIN', 0, -34, 66, '#161616', 'center', '#f0f0f0', 10);
    text('DUEL', 0, 32, 74, '#b3121a', 'center', '#f0f0f0', 10);
    ctx.restore();
    const by = cy + 150;
    octButton('play', LW / 2, by, 46, '#4cc04a', '#2b8a2a', 'play');
    if (lbSupported) octButton('lb', LW / 2 + 110, by, 32, '#f0a35e', '#b8692c', 'trophy');
    if (S.best > 0) text('BEST ' + S.best, LW / 2, by + 74, 22, '#2a2a2a', 'center', 'rgba(255,255,255,0.7)', 5);
    iconButton('sound', LW - 36, ST + 34, 24, 'sound');
    const pulse = 0.6 + Math.sin(G.t * 4) * 0.4;
    ctx.globalAlpha = pulse;
    text('TAP TO PLAY', LW / 2, by + (S.best > 0 ? 112 : 80), 20, '#2a2a2a', 'center', 'rgba(255,255,255,0.7)', 5);
    ctx.globalAlpha = 1;
  }

  function scroll(x, y, w, h) {
    // parchment body
    ctx.fillStyle = '#f7efc6'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#d6c58e'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
    for (const yy of [y - 6, y + h - 12]) {
      const g = ctx.createLinearGradient(0, yy, 0, yy + 18);
      g.addColorStop(0, '#fbf3d0'); g.addColorStop(0.5, '#e8d9a2'); g.addColorStop(1, '#c9b67a');
      ctx.fillStyle = g; rr(x - 14, yy, w + 28, 18, 9); ctx.fill();
      ctx.strokeStyle = '#b8a46a'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function drawOver() {
    const t = clamp((G.over - 1.4) / 0.35, 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * t})`;
    ctx.fillRect(-offX, 0, VW, LH);
    const w = 360, h = 300;
    const x = LW / 2 - w / 2;
    const y = ST + Math.max(60, (LH - SB - ST - h) * 0.36) + (1 - ease(t)) * 40;
    ctx.globalAlpha = t;
    scroll(x, y, w, h);
    ctx.fillStyle = '#6b3fa0';
    ctx.beginPath(); ctx.moveTo(x + 50, y + 42); ctx.lineTo(x + w - 46, y + 38); ctx.lineTo(x + w - 50, y + 88); ctx.lineTo(x + 46, y + 90); ctx.closePath(); ctx.fill();
    text('SCORE ' + G.score, LW / 2, y + 64, 32, '#f5e9c9');
    text((G.newBest ? 'NEW BEST ' : 'BEST SCORE ') + S.best, LW / 2, y + 122, 24, G.newBest ? '#b3121a' : '#5b4a2a');
    const by = y + 210;
    if (t >= 1) {
      octButton('home', LW / 2 - (lbSupported ? 105 : 50), by, 40, '#f0a35e', '#b8692c', 'home');
      if (lbSupported) octButton('lb', LW / 2, by, 40, '#f0a35e', '#b8692c', 'trophy');
      octButton('retry', LW / 2 + (lbSupported ? 105 : 50), by, 40, '#4cc04a', '#2b8a2a', 'play');
    }
    ctx.globalAlpha = 1;
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(-offX, 0, VW, LH);
    const w = 320, h = 230, x = LW / 2 - w / 2, y = ST + (LH - SB - ST - h) * 0.4;
    scroll(x, y, w, h);
    text('PAUSED', LW / 2, y + 60, 36, '#5b4a2a');
    octButton('home', LW / 2 - 60, y + 150, 38, '#f0a35e', '#b8692c', 'home');
    octButton('resume', LW / 2 + 60, y + 150, 38, '#4cc04a', '#2b8a2a', 'play');
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
      if (screen === 'title') drawTitle();
      else if (screen === 'play') { drawHUD(); if (paused) { buttons = []; drawPause(); } }
      else if (screen === 'over') drawOver();
    }
    if (toastMsg) {
      ctx.globalAlpha = clamp(toastMsg.t * 2, 0, 1);
      ctx.font = `16px ${FD}`;
      const w = ctx.measureText(toastMsg.msg).width + 40;
      ctx.fillStyle = 'rgba(20,20,20,0.85)'; rr(LW / 2 - w / 2, LH - SB - 70, w, 40, 20); ctx.fill();
      text(toastMsg.msg, LW / 2, LH - SB - 50, 16, '#fff');
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
      get G() { return G; }, get screen() { return screen; }, S: () => S,
      newGame, throwAt(angDeg, pow) {
        const sp = lerp(V_MIN, V_MAX, pow), a = angDeg * Math.PI / 180;
        G.player.reload = 0; throwJavelin(G.player, Math.cos(a) * sp, -Math.sin(a) * sp); G.throws++;
      },
      solveSpeed, handWorld, zones, feetY, uiAction, step: (dt) => update(dt),
    };
  }
  boot();
  requestAnimationFrame(frame);
})();
