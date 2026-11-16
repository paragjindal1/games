/* Bridge War: a squad runner-shooter built as a Snapchat Web Lens.
 * Your soldiers charge down a bridge and fire on their own. Drag left and
 * right to aim, shoot gates to raise their number before you run through
 * them, mow down the red crowd, dodge rolling tires and beat the boss.
 * Coins buy Fire Rate, Damage, Revenue and Squad upgrades between levels.
 * Everything is drawn in code; the only bundled asset is one font. */
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
  };
  const LW = 540;               // logical width
  const MIN_CONTENT_H = 760;    // logical height the game needs inside the safe zone
  const RW = 200;               // half road width in px at the squad's row
  const CAM_D = 26;             // perspective depth: scale = D / (D + z)
  const RUN_SPEED = 9;          // world units per second
  const BULLET_SPEED = 46;
  const BULLET_RANGE = 78;
  const MAX_SQUAD = 150;
  const MAX_DRAWN = 46;         // soldiers drawn; the rest only count
  const MAX_SHOTS = 22;         // bullets per second on screen (damage scales up past it)
  const MAN = 0.34;             // soldier height in world units

  const UP = {
    rate: { name: 'FIRE RATE', col: '#62c23a', dark: '#3c8a1e', base: 120 },
    dmg: { name: 'DAMAGE', col: '#3b8fe8', dark: '#1e5fb0', base: 150 },
    rev: { name: 'REVENUE', col: '#f0b41e', dark: '#b07c06', base: 200 },
    squad: { name: 'SQUAD', col: '#a05ae0', dark: '#6c2fae', base: 400 },
  };
  const UP_KEYS = ['rate', 'dmg', 'rev', 'squad'];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const snap = window.snapchat || null;
  const SHOW_SAFE = /safe/.test(location.hash);
  const DEBUG = /debug/.test(location.hash);
  // #debug-capture steps frames by hand and renders sound offline, for the preview video
  const CAPTURE = /capture/.test(location.hash);
  const FD = '"Russo One", "Arial Black", Impact, system-ui, sans-serif';

  let dpr = 1, scale = 1, offX = 0, VW = LW, LH = 960, ST = 0, SB = 0;
  let HY = 200, Y0 = 700;       // horizon and squad row, in logical px
  const CX = LW / 2;
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
    Y0 = LH - SB - 200;
    HY = ST + (Y0 - ST) * 0.2;
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

  // Perspective: z is distance ahead of the squad, x is across the road (-1..1).
  const pScale = (z) => CAM_D / (CAM_D + z);
  const px = (x, s) => CX + x * RW * s;
  const py = (s) => HY + (Y0 - HY) * s;

  // ================================================================ save / Snap API
  const freshSave = () => ({ v: 1, level: 1, coins: 0, earned: 0, up: { rate: 0, dmg: 0, rev: 0, squad: 0 }, muted: false, tut: true });
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
    if (saved && saved.v === 1) { S = Object.assign(freshSave(), saved); S.up = Object.assign(freshSave().up, saved.up || {}); }
    toMenu();
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
  const bulletDmg = () => 10 * (1 + 0.2 * S.up.dmg);
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
    boss() { tone(90, 0.5, 'sawtooth', 0.14, 0.7); tone(60, 0.7, 'sine', 0.3, 0.8, 0.1); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'triangle', 0.14, 1, i * 0.09)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'triangle', 0.14, 1, i * 0.15)); },
    buy() { tone(660, 0.08, 'square', 0.07); tone(990, 0.16, 'square', 0.07, 1, 0.07); },
    deny() { tone(160, 0.14, 'square', 0.07); },
    click() { tone(880, 0.05, 'square', 0.06); },
    go() { tone(440, 0.1, 'triangle', 0.12, 2); },
  };

  // ================================================================ level
  // Each level is built from its number, so it plays the same every time.
  function buildLevel(L) {
    const rnd = mulberry(1000 + L * 77);
    const ents = [];
    const hpMul = 1 + 0.2 * (L - 1);
    const steps = 6 + Math.min(L, 8);
    let z = 62;
    for (let i = 0; i < steps; i++) {
      if (i % 2 === 0) {
        // a row of gates; one lane is always worth fixing
        const n = i === 0 ? 1 : 1 + (rnd() < 0.65 ? 1 : 0) + (L >= 3 && rnd() < 0.35 ? 1 : 0);
        const good = Math.floor(rnd() * n);
        const segs = [];
        for (let k = 0; k < n; k++) {
          const v = k === good
            ? -Math.round(2 + rnd() * 5 + i * 1.2 + L * 0.6)
            : -Math.round(8 + rnd() * 10 + i * 2.5 + L * 1.5);
          segs.push({ x1: -1 + (2 / n) * k, x2: -1 + (2 / n) * (k + 1), v, pulse: 0, acc: 0 });
        }
        if (n > 1 && rnd() < 0.3) segs[good].v = Math.round(1 + rnd() * 3);
        // shooting a gate raises it, more slowly the higher it gets, up to its cap
        ents.push({ kind: 'gate', z, segs, used: false, cap: Math.round(6 + i * 2.5 + L * 1.5) });
      } else {
        const count = Math.min(70, Math.round(2 + i * 3.2 + L * 1.3));
        const cx = (rnd() - 0.5) * 0.9;
        for (let k = 0; k < count; k++) {
          ents.push({
            kind: 'foe', z: z + rnd() * (6 + count * 0.22), x: clamp(cx + (rnd() - 0.5) * 1.3, -0.9, 0.9),
            hp: Math.round(20 * hpMul), max: Math.round(20 * hpMul), ph: rnd() * 6, flash: 0, awake: false,
          });
        }
        if (L >= 2 && rnd() < 0.55) {
          const lanes = [-0.55, 0.55, 0].sort(() => rnd() - 0.5).slice(0, rnd() < 0.5 ? 1 : 2);
          for (const x of lanes) {
            const hp = Math.round(140 * hpMul * (1 + i * 0.12));
            ents.push({ kind: 'tire', z: z + 26 + rnd() * 6, x, hp, max: hp, rot: 0, flash: 0, awake: false });
          }
        }
      }
      z += 44;
    }
    const bossHp = Math.round(3200 * Math.pow(L, 1.2));
    ents.push({ kind: 'boss', z: z + 20, x: 0, hp: bossHp, max: bossHp, ph: 0, flash: 0, awake: false, bite: 0 });
    ents.sort((a, b) => a.z - b.z);
    return { ents, length: z + 20 };
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
      t: 0, dist: 0, ents: lv.ents, length: lv.length, n: startSquad(), x: 0, tx: 0,
      bullets: [], parts: [], floats: [], coins: [], shotAcc: 0, earned: 0, kills: 0, peak: startSquad(),
      active: [], bossOn: false, bossDead: 0, over: 0, running: false, panel: 0, pop: 0, hurt: 0, bump: 0,
    };
  }
  function toMenu() { G = freshRun(); screen = 'menu'; paused = false; }
  function startRun() {
    if (screen !== 'menu') return;
    G.running = true; screen = 'play';
    if (S.tut) { S.tut = false; writeSave(); }
    SFX.go();
  }

  // Soldiers stand in a tight spiral around the squad's centre.
  const SPOTS = [];
  for (let i = 0; i < MAX_DRAWN; i++) {
    const r = 0.078 * Math.sqrt(i), a = i * 2.39996;
    SPOTS.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 2.6 });
  }
  const squadR = (n) => 0.078 * Math.sqrt(Math.min(n, MAX_DRAWN)) + 0.07;

  function addCoins(n, x, z) {
    const v = Math.round(n * revenue());
    G.earned += v; S.coins += v; S.earned += v;
    if (x !== undefined) {
      G.coins.push({ x, z, t: 0, v });
      if (G.coins.length > 40) G.coins.shift();
    }
    SFX.coin();
  }
  function puff(x, z, col, n, big = 1) {
    for (let i = 0; i < n; i++) {
      G.parts.push({ x: x + rand(-0.06, 0.06) * big, z: z + rand(-0.4, 0.4), h: rand(0.05, 0.3) * big, vx: rand(-0.5, 0.5) * big, vh: rand(0.3, 1.1) * big, life: rand(0.3, 0.6), max: 0.6, r: rand(3, 7) * big, col });
    }
    if (G.parts.length > 260) G.parts.splice(0, G.parts.length - 260);
  }
  function floatText(x, z, txt, col, size = 26) { G.floats.push({ x, z, txt, col, size, t: 0 }); }

  function loseSoldiers(k, why) {
    if (k <= 0 || G.n <= 0) return;
    k = Math.min(k, G.n);
    G.n -= k; G.hurt = 0.25;
    puff(G.x, 0, '#7fc4ff', Math.min(18, 4 + k * 2));
    SFX.lost();
    if (why) floatText(G.x, 0.5, '-' + k, '#ff4040', 30);
    if (G.n <= 0) { G.over = 0.001; G.running = false; shake = 10; SFX.lose(); }
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

  function fire(dt) {
    // the squad only opens fire once something is in range
    let target = false;
    for (const e of G.active) {
      const z = e.z - G.dist;
      if (z > 0 && z < BULLET_RANGE && !e.dead && !(e.kind === 'gate' && e.used)) { target = true; break; }
    }
    if (!target) return;
    const shots = G.n * fireRate();
    const shown = Math.min(shots, MAX_SHOTS);
    const dmg = bulletDmg() * (shots / shown);
    G.shotAcc += shown * dt;
    while (G.shotAcc >= 1) {
      G.shotAcc -= 1;
      const sp = SPOTS[Math.floor(Math.random() * Math.min(G.n, MAX_DRAWN))];
      G.bullets.push({ x: clamp(G.x + sp.x + rand(-0.02, 0.02), -0.98, 0.98), z: 0.4 + sp.z, dmg, w: shots / shown });
      SFX.shot();
    }
  }

  function killFoe(e, z) {
    e.dead = true; G.kills++;
    puff(e.x, z, '#ff5a4a', 7);
    addCoins(20, e.x, z);
    SFX.pop();
  }

  function updateBullets(dt) {
    const act = G.active;
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      const z0 = b.z;
      b.z += BULLET_SPEED * dt;
      let hit = false;
      for (const e of act) {
        const z = e.z - G.dist;
        if (z < z0 - 0.5 || z > b.z + 0.5) continue;
        if (e.kind === 'gate') {
          if (e.used) continue;
          const seg = e.segs.find((s) => b.x >= s.x1 && b.x < s.x2);
          if (seg) {
            hit = true;
            if (seg.v < e.cap) {
              seg.acc += 1;
              const need = seg.v < 0 ? 1 : 1 + seg.v * 0.45;
              if (seg.acc >= need) { seg.acc -= need; seg.v += 1; seg.pulse = 0.18; SFX.gateUp(); }
            }
          }
        } else if (!e.dead) {
          const half = e.kind === 'boss' ? 0.3 : e.kind === 'tire' ? 0.2 : 0.085;
          if (Math.abs(b.x - e.x) > half) continue;
          e.hp -= b.dmg; e.flash = 0.08; hit = true;
          if (e.hp <= 0) {
            if (e.kind === 'foe') killFoe(e, z);
            else if (e.kind === 'tire') { e.dead = true; puff(e.x, z, '#3a3a3a', 16, 1.6); addCoins(60, e.x, z); SFX.tire(); }
            else if (e.kind === 'boss') { e.dead = true; G.bossDead = 0.001; puff(e.x, z, '#ff5a4a', 40, 3); for (let k = 0; k < 14; k++) addCoins(40, e.x + rand(-0.4, 0.4), z + rand(-1, 1)); shake = 14; SFX.boom(); }
          }
        }
        if (hit) { if (Math.random() < 0.5) G.parts.push({ x: b.x, z, h: 0.16, vx: rand(-0.3, 0.3), vh: rand(0, 0.6), life: 0.15, max: 0.15, r: 4, col: '#fff3a8' }); break; }
      }
      if (hit || b.z > BULLET_RANGE) G.bullets.splice(i, 1);
    }
  }

  function updateEnts(dt) {
    const r = squadR(G.n);
    const act = [];
    for (const e of G.ents) {
      if (e.dead) continue;
      let z = e.z - G.dist;
      if (z > 200) break;
      if (z < -5) { e.dead = true; continue; }
      act.push(e);
      if (e.flash > 0) e.flash -= dt;
      if (e.kind === 'gate') {
        for (const s of e.segs) s.pulse = Math.max(0, s.pulse - dt);
        if (!e.used && z <= 0.15 && G.n > 0) {
          e.used = true;
          const seg = e.segs.find((s) => G.x >= s.x1 && G.x < s.x2) || e.segs[e.segs.length - 1];
          seg.taken = true;
          if (seg.v >= 0) {
            const add = Math.min(seg.v, MAX_SQUAD - G.n);
            G.n += add; G.bump = 0.3;
            if (seg.v > 0) { floatText(G.x, 0.6, '+' + seg.v, '#7fe0ff', 34); puff(G.x, 0, '#9fe6ff', 12); SFX.plus(); }
          } else { SFX.minus(); loseSoldiers(-seg.v, true); }
        }
      } else if (e.kind === 'foe') {
        if (!e.awake && z < 62) e.awake = true;
        if (e.awake && G.n > 0) {
          e.z -= 4.2 * dt; e.ph += dt * 11;
          e.x += clamp(G.x - e.x, -1, 1) * 0.45 * dt;
        }
        z = e.z - G.dist;
        if (z <= 0.35 && z > -0.8 && Math.abs(e.x - G.x) < r + 0.07 && G.n > 0) { e.dead = true; puff(e.x, z, '#ff5a4a', 5); loseSoldiers(1); }
      } else if (e.kind === 'tire') {
        if (!e.awake && z < 70) { e.awake = true; }
        if (e.awake) { e.z -= 11 * dt; e.rot += dt * 9; }
        z = e.z - G.dist;
        if (z <= 0.4 && z > -0.9 && Math.abs(e.x - G.x) < r + 0.16 && G.n > 0) {
          e.dead = true; shake = 9; SFX.tire(); puff(e.x, z, '#3a3a3a', 14, 1.6);
          loseSoldiers(Math.max(2, Math.ceil(G.n * 0.35)), true);
        }
      } else if (e.kind === 'boss') {
        if (!e.awake && z < 58) { e.awake = true; G.bossOn = true; SFX.boss(); floatText(0, 20, 'BOSS!', '#ff4040', 60); }
        if (e.awake && G.n > 0) {
          e.ph += dt * 5;
          if (z > 0.9) e.z -= 3 * dt;
          else {
            e.bite += dt * 6;
            while (e.bite >= 1 && G.n > 0) { e.bite -= 1; loseSoldiers(1); shake = Math.max(shake, 4); }
          }
          e.x = lerp(e.x, clamp(G.x, -0.6, 0.6), Math.min(1, dt * 0.8));
        }
      }
    }
    G.active = act;
  }

  function updateFx(dt) {
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i];
      p.life -= dt; if (p.life <= 0) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.h += p.vh * dt; p.vh -= 2.2 * dt;
    }
    for (let i = G.floats.length - 1; i >= 0; i--) { G.floats[i].t += dt; if (G.floats[i].t > 1) G.floats.splice(i, 1); }
    for (let i = G.coins.length - 1; i >= 0; i--) { G.coins[i].t += dt; if (G.coins[i].t > 0.7) G.coins.splice(i, 1); }
    G.hurt = Math.max(0, G.hurt - dt); G.bump = Math.max(0, G.bump - dt);
  }

  function update(dt) {
    uiT += dt;
    if (toastMsg) { toastMsg.t -= dt; if (toastMsg.t <= 0) toastMsg = null; }
    if (screen === 'loading' || !G) return;
    if (paused) return;
    G.t += dt;
    shake = Math.max(0, shake - dt * 30);
    if (screen === 'menu') { updateSquad(dt); updateEnts(0); updateFx(dt); return; }
    if (G.running) {
      // the squad halts to fight the boss, then runs on once it's down
      const speed = G.bossOn && !G.bossDead ? 0 : RUN_SPEED;
      G.dist += speed * dt;
      updateSquad(dt);
      fire(dt);
    }
    updateEnts(G.running ? dt : dt * 0.4);
    updateBullets(dt);
    updateFx(dt);
    if (G.bossDead) {
      G.bossDead += dt;
      if (G.bossDead > 1.5 && screen === 'play') {
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
    if (G && G.running) G.tx += (p.x - drag.lx) / RW * 1.15;
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

  // ================================================================ draw: world
  function text(str, x, y, size, col, align = 'center', stroke = null, sw = 0) {
    ctx.font = `${size}px ${FD}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(str, x, y); }
    ctx.fillStyle = col; ctx.fillText(str, x, y);
  }
  // White cartoon lettering with a dark outline, used all over the game.
  const label = (str, x, y, size, col = '#fff', align = 'center') => text(str, x, y, size, col, align, '#17222e', Math.max(3, size * 0.22));

  function drawWorld() {
    const X0 = -offX, X1 = VW - offX;
    // sky
    let g = ctx.createLinearGradient(0, 0, 0, HY);
    g.addColorStop(0, '#2f8fe6'); g.addColorStop(1, '#8fd0ff');
    ctx.fillStyle = g; ctx.fillRect(X0, 0, VW, HY + 1);
    // sea
    g = ctx.createLinearGradient(0, HY, 0, LH);
    g.addColorStop(0, '#2e86de'); g.addColorStop(0.5, '#1f6fd0'); g.addColorStop(1, '#1859b8');
    ctx.fillStyle = g; ctx.fillRect(X0, HY, VW, LH - HY);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(X0, HY, VW, 2);
    // wave streaks drift toward the camera
    const rnd = mulberry(5);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const wx = X0 + rnd() * VW, base = rnd();
      const k = (base + G.dist * 0.006 + uiT * 0.01) % 1;
      const y = HY + 6 + k * k * (LH - HY);
      ctx.lineWidth = 1 + k * 2.5;
      const len = 10 + k * 40 + rnd() * 20;
      ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(wx + len, y); ctx.stroke();
    }
    // deck
    const sB = (LH + 40 - HY) / (Y0 - HY);            // scale at the bottom of the screen
    const yB = py(sB);
    const edge = (x) => { ctx.lineTo(px(x, sB), yB); };
    const quad = (xa, xb, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(CX, HY); edge(xa); edge(xb); ctx.closePath(); ctx.fill(); };
    quad(-1.5, 1.5, '#7f8790');     // outer girders
    quad(-1.32, 1.32, '#aab2b9');   // walkway
    quad(-1.12, 1.12, '#8c949b');   // kerb
    quad(-1.02, 1.02, '#ddd7cc');   // road
    // road texture: bands scroll with the run
    const step = 4;
    for (let Z = Math.floor((G.dist - 7) / step) * step; Z - G.dist < 240; Z += step) {
      const z = Z - G.dist;
      if (z <= -CAM_D * 0.55) continue;
      const s1 = pScale(z), s2 = pScale(z + step * 0.5);
      const band = Math.round(Z / step) % 2 === 0;
      ctx.fillStyle = band ? 'rgba(120,105,90,0.07)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(px(-1.02, s1), py(s1)); ctx.lineTo(px(1.02, s1), py(s1));
      ctx.lineTo(px(1.02, s2), py(s2)); ctx.lineTo(px(-1.02, s2), py(s2)); ctx.fill();
    }
    // side rails (raised lines converge on the vanishing point too)
    for (const side of [-1, 1]) {
      ctx.strokeStyle = '#6d757d'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(CX, HY); ctx.lineTo(px(side * 1.24, sB), yB - 0.2 * RW * sB); ctx.stroke();
      ctx.strokeStyle = '#c5ccd2'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(CX, HY); ctx.lineTo(px(side * 1.24, sB), yB - 0.2 * RW * sB - 3); ctx.stroke();
    }
  }

  // Suspension towers and rail posts, drawn with the entities so they pass by.
  function drawTower(z) {
    const s = pScale(z), y = py(s), h = 4.4 * RW * s, w = 0.24 * RW * s;
    ctx.fillStyle = '#6f7880';
    for (const side of [-1, 1]) {
      const x = px(side * 1.42, s);
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.fillStyle = '#8b949c'; ctx.fillRect(x - w / 2, y - h, w * 0.3, h); ctx.fillStyle = '#6f7880';
    }
    ctx.fillRect(px(-1.42, s), y - h, px(1.42, s) - px(-1.42, s), 0.22 * RW * s);
    ctx.fillRect(px(-1.42, s), y - h * 0.62, px(1.42, s) - px(-1.42, s), 0.14 * RW * s);
    // main cables swoop down to the deck on both sides of the tower
    ctx.strokeStyle = 'rgba(95,105,115,0.9)'; ctx.lineWidth = Math.max(1, 4 * s);
    for (const side of [-1, 1]) for (const dz of [-34, 34]) {
      const z2 = z + dz; if (z2 <= -CAM_D * 0.6) continue;
      const s2 = pScale(z2);
      ctx.beginPath(); ctx.moveTo(px(side * 1.42, s), y - h);
      ctx.quadraticCurveTo(px(side * 1.42, pScale(z + dz * 0.6)), py(pScale(z + dz * 0.6)) - 0.5 * RW * pScale(z + dz * 0.6), px(side * 1.34, s2), py(s2) - 0.2 * RW * s2);
      ctx.stroke();
    }
  }
  function drawPost(z) {
    const s = pScale(z), y = py(s);
    ctx.strokeStyle = '#6d757d'; ctx.lineWidth = Math.max(1, 5 * s);
    for (const side of [-1, 1]) {
      const x = px(side * 1.24, s);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 0.22 * RW * s); ctx.stroke();
    }
  }

  // A chunky cartoon person. k is their height in px. back=true shows a soldier from behind.
  function person(x, y, k, o) {
    const ph = o.ph || 0, run = o.run ? 1 : 0;
    const la = Math.sin(ph) * 0.07 * k * run, lb = -la;
    const bob = Math.abs(Math.cos(ph)) * 0.03 * k * run;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x, y, k * 0.24, k * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    const body = o.flash ? '#ffffff' : o.body, limb = o.flash ? '#ffffff' : o.limb;
    // legs
    ctx.fillStyle = limb;
    const lw = k * 0.15;
    rr(x - k * 0.17, y - k * 0.42, lw, k * 0.42 - Math.max(0, la), lw * 0.45); ctx.fill();
    rr(x + k * 0.02, y - k * 0.42, lw, k * 0.42 - Math.max(0, lb), lw * 0.45); ctx.fill();
    // arms
    const by = y - k * 0.8 - bob;
    ctx.fillStyle = body;
    rr(x - k * 0.31, by + k * 0.05 + lb * 0.6, k * 0.12, k * 0.32, k * 0.06); ctx.fill();
    rr(x + k * 0.19, by + k * 0.05 + la * 0.6, k * 0.12, k * 0.32, k * 0.06); ctx.fill();
    // torso
    rr(x - k * 0.21, by, k * 0.42, k * 0.44, k * 0.14); ctx.fill();
    if (o.back) {
      // rifle over the right shoulder, pointing down the bridge
      ctx.fillStyle = '#3a3f45'; rr(x + k * 0.12, by - k * 0.2, k * 0.07, k * 0.42, k * 0.02); ctx.fill();
      ctx.fillStyle = '#6b4a2a'; rr(x + k * 0.1, by + k * 0.12, k * 0.11, k * 0.16, k * 0.03); ctx.fill();
      ctx.fillStyle = o.flash ? '#fff' : o.head;
      ctx.beginPath(); ctx.arc(x, by - k * 0.1, k * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(x - k * 0.05, by - k * 0.16, k * 0.07, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = o.flash ? '#fff' : '#f0b9a0';
      ctx.beginPath(); ctx.arc(x, by - k * 0.1, k * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = o.flash ? '#fff' : o.head;
      ctx.beginPath(); ctx.arc(x, by - k * 0.13, k * 0.175, Math.PI, 0); ctx.fill();
      if (k > 26) { ctx.fillStyle = '#2a1a16'; ctx.fillRect(x - k * 0.09, by - k * 0.1, k * 0.045, k * 0.045); ctx.fillRect(x + k * 0.045, by - k * 0.1, k * 0.045, k * 0.045); }
    }
  }

  function drawTire(e, x, y, s) {
    const r = 0.2 * RW * s;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.1, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    const cy = y - r - Math.abs(Math.sin(e.rot * 0.7)) * r * 0.12;
    ctx.fillStyle = e.flash > 0 ? '#fff' : '#1c1c1e';
    ctx.beginPath(); ctx.ellipse(x, cy, r * 1.02, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3d3d42'; ctx.lineWidth = Math.max(1, r * 0.13);
    for (let i = 0; i < 10; i++) {
      const a = e.rot + i * Math.PI / 5;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72); ctx.lineTo(x + Math.cos(a + 0.2) * r * 0.98, cy + Math.sin(a + 0.2) * r * 0.98); ctx.stroke();
    }
    ctx.fillStyle = '#8a9099'; ctx.beginPath(); ctx.arc(x, cy, r * 0.48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5c626a'; ctx.beginPath(); ctx.arc(x, cy, r * 0.2, 0, Math.PI * 2); ctx.fill();
    if (s > 0.2) label(String(Math.ceil(e.hp)), x, y + r * 0.42, Math.max(11, 30 * s), '#ffe14a');
  }

  function drawGate(e, s) {
    const y = py(s), h = 0.62 * RW * s;
    for (const seg of e.segs) {
      const xa = px(seg.x1, s), xb = px(seg.x2, s);
      const good = seg.v >= 0;
      const a = e.used ? (seg.taken ? 0.25 : 0.12) : 0.55 + seg.pulse * 2;
      ctx.fillStyle = good ? `rgba(70,200,255,${a})` : `rgba(240,40,50,${a})`;
      ctx.fillRect(xa, y - h, xb - xa, h);
      ctx.fillStyle = good ? `rgba(200,245,255,${a + 0.2})` : `rgba(255,150,150,${a + 0.2})`;
      ctx.fillRect(xa, y - h, xb - xa, Math.max(1, h * 0.09));
      ctx.fillStyle = good ? '#1fa8e0' : '#c81e28';
      const pw = Math.max(2, 0.05 * RW * s);
      ctx.fillRect(xa - pw / 2, y - h * 1.12, pw, h * 1.12); ctx.fillRect(xb - pw / 2, y - h * 1.12, pw, h * 1.12);
      if (!e.used && s > 0.1) {
        const k = 1 + seg.pulse * 1.6;
        label(seg.v >= e.cap ? 'MAX +' + seg.v : (seg.v >= 0 ? '+' : '') + seg.v, (xa + xb) / 2, y - h * 0.48, Math.max(10, Math.min(xb - xa, 190 * s) * 0.42 * k));
      }
    }
  }

  function drawBoss(e, x, y, s) {
    const k = MAN * RW * s * 3.4;
    person(x, y, k, { body: '#b3151f', limb: '#7d0d15', head: '#5a070d', ph: e.ph, run: e.awake, flash: e.flash > 0 });
    // horns
    ctx.fillStyle = '#2a1a16';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + d * k * 0.12, y - k * 1.05); ctx.lineTo(x + d * k * 0.26, y - k * 1.22); ctx.lineTo(x + d * k * 0.2, y - k * 0.98); ctx.fill(); }
    if (s > 0.12) {
      const w = Math.max(40, k * 0.9), bx = x - w / 2, by = y - k * 1.32;
      ctx.fillStyle = '#17222e'; rr(bx - 3, by - 3, w + 6, 16, 6); ctx.fill();
      ctx.fillStyle = '#ff3b3b'; rr(bx, by, w * clamp(e.hp / e.max, 0, 1), 10, 4); ctx.fill();
      label(fmt(Math.max(0, e.hp)), x, by - 14, Math.max(12, 20 * Math.min(1, s * 2)));
    }
  }

  function drawSquad() {
    if (G.n <= 0) return;
    const n = Math.min(G.n, MAX_DRAWN);
    const order = [];
    for (let i = 0; i < n; i++) order.push(SPOTS[i]);
    order.sort((a, b) => b.z - a.z);
    const run = G.running && !(G.bossOn && !G.bossDead);
    const grow = 1 + G.bump * 0.5;
    for (const sp of order) {
      const s = pScale(sp.z);
      person(px(G.x + sp.x, s), py(s), MAN * RW * s * grow, {
        back: true, body: '#9fb0ba', limb: '#1e7fd6', head: '#2196f3',
        ph: G.t * 12 + sp.x * 40, run, flash: G.hurt > 0.17,
      });
    }
    // squad counter
    const top = py(pScale(squadR(G.n) * 2.6)) - MAN * RW - 26;
    const w = 38 + String(G.n).length * 13;
    ctx.fillStyle = '#1e7fd6'; rr(px(G.x, 1) - w / 2, top - 15, w, 30, 15); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    text(String(G.n), px(G.x, 1), top + 1, 19, '#fff');
  }

  function drawScene() {
    drawWorld();
    // collect everything with depth and draw far to near
    const list = [];
    const tStep = 150, tFirst = Math.ceil((G.dist - 10 - 70) / tStep) * tStep + 70;
    for (let Z = tFirst; Z - G.dist < 220; Z += tStep) list.push({ z: Z - G.dist, tower: true });
    const pStep = 7, pFirst = Math.ceil((G.dist - 6) / pStep) * pStep;
    for (let Z = pFirst; Z - G.dist < 160; Z += pStep) list.push({ z: Z - G.dist, post: true });
    for (const e of (G.active || [])) if (!e.dead || e.kind === 'gate') list.push({ z: e.z - G.dist, e });
    list.sort((a, b) => b.z - a.z);
    let squadDone = false;
    const squadZ = 0;
    for (const it of list) {
      if (!squadDone && it.z < squadZ - 0.5) { drawBulletsAndSquad(); squadDone = true; }
      if (it.z <= -CAM_D * 0.6) continue;
      const s = pScale(it.z);
      if (it.tower) drawTower(it.z);
      else if (it.post) drawPost(it.z);
      else {
        const e = it.e, x = px(e.x || 0, s), y = py(s);
        if (e.kind === 'gate') drawGate(e, s);
        else if (e.kind === 'foe') person(x, y, MAN * RW * s, { body: '#e8262e', limb: '#b3151f', head: '#d81e26', ph: e.ph, run: e.awake, flash: e.flash > 0 });
        else if (e.kind === 'tire') drawTire(e, x, y, s);
        else if (e.kind === 'boss') drawBoss(e, x, y, s);
      }
    }
    if (!squadDone) drawBulletsAndSquad();
    // effects on top
    for (const p of G.parts) {
      const s = pScale(p.z);
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(px(p.x, s), py(s) - p.h * RW * s, Math.max(1, p.r * s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const c of G.coins) {
      const s = pScale(c.z), k = c.t / 0.7;
      const x = px(c.x, s), y = py(s) - (0.25 + k * 0.5) * RW * s, r = Math.max(3, 11 * s);
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.15, r * Math.abs(Math.cos(c.t * 14)) + 1, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x, y, r * Math.abs(Math.cos(c.t * 14)) + 1, r, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const f of G.floats) {
      const s = Math.max(0.35, pScale(f.z));
      ctx.globalAlpha = clamp(2 - f.t * 2, 0, 1);
      const k = f.t < 0.15 ? backOut(f.t / 0.15) : 1;
      label(f.txt, px(f.x, s), py(s) - (MAN * 1.6 + f.t * 0.35) * RW * s, f.size * Math.min(1.2, s + 0.3) * k, f.col);
    }
    ctx.globalAlpha = 1;
  }

  function drawBulletsAndSquad() {
    ctx.lineCap = 'round';
    for (const b of G.bullets) {
      const s1 = pScale(b.z), s2 = pScale(Math.max(0, b.z - 1.6));
      const h = 0.19;
      ctx.strokeStyle = '#fff6b0'; ctx.lineWidth = Math.max(1.2, 5 * s1);
      ctx.beginPath(); ctx.moveTo(px(b.x, s1), py(s1) - h * RW * s1); ctx.lineTo(px(b.x, s2), py(s2) - h * RW * s2); ctx.stroke();
    }
    drawSquad();
  }

  // ================================================================ draw: UI
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
  function iconButton(id, x, y, kind) {
    const fy = button(id, x, y, 46, 46, null, '#f5f8fb', '#cfd8e0', '#8795a3');
    ctx.save(); ctx.translate(x + 23, fy + 20);
    ctx.fillStyle = '#17222e'; ctx.strokeStyle = '#17222e'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
    ctx.fillStyle = '#17222e'; rr(x - 3, y - 3, w + 6, 44, 22); ctx.fill();
    ctx.fillStyle = '#1e7fd6'; rr(x, y, w, 38, 19); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; rr(x + 4, y + 3, w - 8, 14, 9); ctx.fill();
    label(txt, x + 14, y + 20, 22, '#fff', 'left');
    coinIcon(x + w - 19, y + 18, 17);
    return x;
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
      for (const [ox, oy, s] of [[-13, 4, 0.9], [13, 4, 0.9], [0, 10, 1.1]]) person(ox, oy + 12, 34 * s, { back: true, body: '#9fb0ba', limb: '#1e7fd6', head: '#2196f3' });
    }
    ctx.restore();
  }

  function drawMenu() {
    coinCounter();
    iconButton('sound', 12, ST + 8, S.muted ? 'mute' : 'sound');
    if (lbSupported) iconButton('lb', 66, ST + 8, 'trophy');
    label('LEVEL ' + S.level, LW / 2, ST + 82, 40);
    // start hint with a swiping hand
    const hy = ST + 128;
    ctx.fillStyle = 'rgba(23,34,46,0.75)'; rr(LW / 2 - 150, hy - 20, 300, 40, 20); ctx.fill();
    label('DRAG TO MOVE & START', LW / 2 - 14, hy + 1, 17);
    const sw = Math.sin(uiT * 3.4) * 16;
    ctx.save(); ctx.translate(LW / 2 + 122 + sw * 0.4, hy + 2); ctx.rotate(-0.3);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#17222e'; ctx.lineWidth = 2;
    rr(-3, -11, 7, 14, 3.5); ctx.fill(); ctx.stroke(); rr(-8, -1, 17, 14, 6); ctx.fill(); ctx.stroke();
    ctx.restore();
    // upgrade cards, just above Snapchat's bottom bar
    const cw = 122, gap = 8, total = cw * 4 + gap * 3, x0 = LW / 2 - total / 2, y = LH - SB - 168;
    UP_KEYS.forEach((k, i) => {
      const u = UP[k], x = x0 + i * (cw + gap), cost = upCost(k), can = S.coins >= cost;
      const popK = G.pop > 0 && G.popKey === k ? 1 + G.pop * 0.25 : 1;
      buttons.push({ id: 'up:' + k, x, y, w: cw, h: 160 });
      const down = pressed && pressed.id === 'up:' + k;
      ctx.save(); ctx.translate(x + cw / 2, y + 80 + (down ? 3 : 0)); ctx.scale(popK, popK); ctx.translate(-cw / 2, -80);
      ctx.globalAlpha = can ? 1 : 0.72;
      ctx.fillStyle = '#17222e'; rr(-3, -3, cw + 6, 166, 14); ctx.fill();
      ctx.fillStyle = u.dark; rr(0, 0, cw, 160, 12); ctx.fill();
      ctx.fillStyle = u.col; rr(0, 0, cw, 30, 12); ctx.fill(); ctx.fillRect(0, 16, cw, 14);
      label(u.name, cw / 2, 16, 14);
      const g = ctx.createLinearGradient(0, 34, 0, 100);
      g.addColorStop(0, u.col); g.addColorStop(1, u.dark);
      ctx.fillStyle = g; rr(5, 34, cw - 10, 68, 8); ctx.fill();
      upIcon(k, cw / 2, 68);
      // level badge
      ctx.fillStyle = '#17222e'; ctx.beginPath(); ctx.arc(cw - 6, 2, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cw - 6, 2, 12, 0, Math.PI * 2); ctx.fill();
      text(String(S.up[k] + 1), cw - 6, 3, 13, '#17222e');
      // price
      ctx.fillStyle = can ? '#7c3fd0' : '#5a6470'; rr(5, 108, cw - 10, 46, 9); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; rr(8, 111, cw - 16, 16, 6); ctx.fill();
      label('UPGRADE', cw / 2, 121, 13);
      ctx.font = `15px ${FD}`;
      const pw = ctx.measureText(fmt(cost)).width;
      coinIcon(cw / 2 - pw / 2 - 6, 141, 7);
      label(fmt(cost), cw / 2 + 8, 142, 15, can ? '#ffe14a' : '#d0d6dc');
      ctx.restore();
    });
    G.pop = Math.max(0, G.pop - 1 / 60);
  }

  function drawHUD() {
    const cx = coinCounter();
    iconButton('pause', 12, ST + 8, 'pause');
    if (G.earned > 0) label('+' + fmt(G.earned), LW - 16, ST + 66, 17, '#ffe14a', 'right');
    // progress bar between the pause button and the coins
    const x = 72, w = Math.max(80, cx - 14 - x), y = ST + 20;
    const p = clamp(G.dist / (G.length - 56), 0, 1);
    ctx.fillStyle = '#17222e'; rr(x - 3, y - 3, w + 6, 24, 12); ctx.fill();
    ctx.fillStyle = '#e8eef3'; rr(x, y, w, 18, 9); ctx.fill();
    ctx.fillStyle = '#1e7fd6'; rr(x, y, Math.max(18, w * p), 18, 9); ctx.fill();
    text(G.bossOn ? 'BOSS' : Math.round(p * 100) + '%', x + w / 2, y + 10, 12, '#17222e');
    label('LEVEL ' + (G.cleared || S.level), x + w / 2, y + 38, 14);
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
    // coins earned
    const shown = Math.round(G.earned * ease(clamp((G.panel - 0.3) / 0.8, 0, 1)));
    coinIcon(LW / 2 - 74, y + 124, 24);
    text(fmt(shown), LW / 2 - 40, y + 126, 48, '#17222e', 'left');
    text('COINS THIS RUN', LW / 2, y + 168, 13, '#5a6b7c');
    const stats = [['KILLS', G.kills], ['BIGGEST SQUAD', G.peak], [win ? 'BONUS' : 'REACHED', win ? '+' + fmt(G.bonus) : Math.round(clamp(G.dist / (G.length - 56), 0, 1) * 100) + '%']];
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
      if (win) button('next', x + 24, y + 268, w - 48, 74, 'NEXT LEVEL', '#5fe07a', '#28b04a', '#167a30', 28);
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
    ctx.fillStyle = '#3f9be6'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = shake ? rand(-shake, shake) * 0.5 : 0, sy = shake ? rand(-shake, shake) * 0.5 : 0;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx) * scale * dpr, sy * scale * dpr);
    buttons = [];
    if (screen === 'loading' || !G) {
      label('LOADING…', LW / 2, LH / 2, 28);
    } else {
      drawScene();
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * scale * dpr, 0);
      if (G.hurt > 0) { ctx.fillStyle = `rgba(255,40,40,${G.hurt * 0.6})`; ctx.fillRect(-offX, 0, VW, LH); }
      if (screen === 'menu') drawMenu();
      else if (screen === 'play') { drawHUD(); if (paused) { buttons = []; drawPause(); } }
      else { drawHUD(); buttons = []; drawEnd(screen === 'win'); }
    }
    if (toastMsg) {
      ctx.globalAlpha = clamp(toastMsg.t * 2, 0, 1);
      ctx.font = `15px ${FD}`;
      const w = ctx.measureText(toastMsg.msg).width + 40;
      ctx.fillStyle = 'rgba(23,34,46,0.9)'; rr(LW / 2 - w / 2, LH - SB - 220, w, 38, 19); ctx.fill();
      text(toastMsg.msg, LW / 2, LH - SB - 200, 15, '#fff');
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
      get G() { return G; }, get screen() { return screen; }, S: () => S, get buttons() { return buttons; },
      startRun, toMenu, uiAction, squadR, buildLevel, step: (dt) => update(dt),
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
