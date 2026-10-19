/* Word Wow: a crossword word-swipe Snapchat Web Lens.
 * Swipe across the letters in the wheel to spell words and fill the
 * crossword. Extra real words count as bonus words and earn coins.
 * The game starts straight into play: no menus, no start button.
 * Everything is drawn in code; the only bundled assets are a font and the
 * generated level file (levels.js). */
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
    START_COINS: 100,
    HINT_COST: 25,
    LEVEL_COINS: 10,
    JAR_SIZE: 10,        // bonus words that fill the jar
    JAR_COINS: 50,       // coins for a full jar
  };
  const LW = 540;               // logical width
  const MIN_CONTENT_H = 820;    // logical height the UI needs inside the safe zone

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const snap = window.snapchat || null;
  const LEVELS = window.LEVELS || [];
  const SHOW_SAFE = /safe/.test(location.hash);
  const DEBUG = /debug/.test(location.hash);
  const HIRES = /hires/.test(location.hash);   // 3x canvas for marketing renders
  const TONE_LOG = DEBUG ? [] : null;           // every sound played, for the preview video's audio
  const FONT = 'Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
  const DISPLAY = 'Creepster, Fredoka, "Arial Black", Impact, system-ui, sans-serif';
  const BONE_HEX = '#f7ead2';
  const BONE = BONE_HEX;                         // bone-white letters on dark glass

  // ================================================================ utils
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const inCircle = (p, c, pad = 0) => c && dist(p.x, p.y, c.x, c.y) <= c.r + pad;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
  function seeded(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // ================================================================ themes
  // A new haunted scene every 8 levels. accent drives the glowing tiles,
  // wheel rim and swipe line; tileInk is the letter colour on a lit tile.
  const THEMES = [
    { name: 'Haunted Hill', scene: 'manor', sky: ['#0b0520', '#2a0f52', '#6a2a72'], moon: '#ffe9b8', glow: '#ff9a3c', far: '#22103a', mid: '#140824', near: '#07030d', fog: '#c49bff', accent: '#ff8a1f', tileInk: '#2b0a12' },
    { name: 'Pumpkin Patch', scene: 'patch', sky: ['#10051a', '#4a1430', '#c2451f'], moon: '#ffd27a', glow: '#ff7a2a', far: '#341020', mid: '#1f0814', near: '#0b0308', fog: '#ffb27a', accent: '#ff7a12', tileInk: '#2b0a08' },
    { name: 'Graveyard Mist', scene: 'graveyard', sky: ['#020c0d', '#0b2f31', '#2b6a5c'], moon: '#eafff3', glow: '#8affc8', far: '#0f2b2a', mid: '#081c1c', near: '#030a0a', fog: '#a6ffd9', accent: '#8cff4a', tileInk: '#0f2a06' },
    { name: "Witch's Wood", scene: 'forest', sky: ['#06061a', '#1d184c', '#4a3a8c'], moon: '#f3ecff', glow: '#b88cff', far: '#1f1840', mid: '#120e2c', near: '#060418', fog: '#c9a8ff', accent: '#c07bff', tileInk: '#1e0838' },
    { name: 'Blood Moon', scene: 'castle', sky: ['#0e0207', '#380812', '#8a1a1a'], moon: '#ff6a4a', glow: '#ff3a2a', far: '#330a12', mid: '#1e050b', near: '#0b0204', fog: '#ff9a8a', accent: '#ff4d3a', tileInk: '#2a0306' },
    { name: 'Ghost Manor', scene: 'manor', sky: ['#050916', '#17243e', '#3d5576'], moon: '#eef6ff', glow: '#9fd0ff', far: '#1a2840', mid: '#0f182a', near: '#050912', fog: '#d2e6ff', accent: '#ffb43a', tileInk: '#2b1504' },
  ];
  const themeFor = (lvl) => THEMES[Math.floor((lvl - 1) / 8) % THEMES.length];

  // ================================================================ layout
  let dpr = 1, scale = 1, offX = 0, VW = LW, LH = 960, ST = 0, SB = 0;
  const L = {};
  const insetEl = document.getElementById('insets');

  function readInsets() {
    if (!insetEl) return { top: 0, bottom: 0 };
    const cs = getComputedStyle(insetEl);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, HIRES ? 3 : 2);
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
    bgKey = '';
  }

  function layout() {
    const T = ST, B = LH - SB;
    const extra = Math.max(0, (B - T) - MIN_CONTENT_H);
    L.top = T; L.bottom = B;
    L.coins = { x: 14, y: T + 8, w: 132, h: 46 };
    L.title = { x: LW / 2, y: T + 31 };
    L.sound = { x: LW - 40, y: T + 31, r: 24 };
    L.board = { x: LW - 96, y: T + 31, r: 24 };
    const wr = 128 + Math.min(22, extra * 0.12);
    L.wheel = { x: LW / 2, y: B - wr - 22, r: wr };
    L.preview = { x: LW / 2, y: L.wheel.y - wr - 34 };
    L.grid = { x: 16, y: T + 72, w: LW - 32, h: (L.preview.y - 30) - (T + 72) };
    const by = L.wheel.y + wr * 0.62;
    L.shuffle = { x: 50, y: by, r: 30 };
    L.hint = { x: LW - 50, y: by, r: 30 };
    L.jar = { x: 50, y: L.wheel.y - wr * 0.55, r: 30 };
    if (level) layoutLevel();
  }

  function layoutLevel() {
    const g = L.grid;
    const s = Math.min(g.w / level.cols, g.h / level.rows, 66);
    level.tile = s;
    level.gx = g.x + (g.w - s * level.cols) / 2;
    level.gy = g.y + (g.h - s * level.rows) / 2;
    const n = level.letters.length, w = L.wheel;
    const ring = w.r * (n <= 3 ? 0.5 : n <= 5 ? 0.58 : 0.63);
    level.bubble = Math.min(w.r * 0.27, (Math.PI * ring / n) * 0.82);
    level.spots = level.letters.map((ch, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: w.x + Math.cos(a) * ring, y: w.y + Math.sin(a) * ring };
    });
  }
  const cellX = (x) => level.gx + (x + 0.5) * level.tile;
  const cellY = (y) => level.gy + (y + 0.5) * level.tile;

  // ================================================================ save data
  const freshSave = () => ({ v: 1, level: 1, coins: CFG.START_COINS, found: [], hints: [], bonus: [], jar: 0, muted: false, bestLevel: 0 });
  let S = freshSave();
  let saveLoaded = false, savePending = Promise.resolve();
  let lbSupported = false, lbWhy = '';   // lbWhy: why the leaderboard is off, shown when the trophy is tapped

  function writeSave() {
    if (!saveLoaded || !snap) return;
    const state = JSON.parse(JSON.stringify(S));
    savePending = savePending
      .then(() => snap.storage.set('save', state))
      .then(() => true, (e) => { console.warn('Save failed:', e && e.message); return false; });
  }
  // Score = levels cleared. A new player sends 0, so the board has data
  // for show() (it rejects when it has none) and the player is listed.
  function submitScore() {
    if (!lbSupported) return Promise.resolve(false);
    const score = Math.max(0, Math.round(S.level - 1));
    return snap.leaderboards.submitScore({ score })
      .then(() => true, (e) => { console.warn('Leaderboard submit failed:', e && e.message); return false; });
  }
  async function showLeaderboard() {
    if (!lbSupported) { toast(lbWhy || 'Leaderboard is not available here'); return; }
    await submitScore();
    try {
      await snap.leaderboards.show();
      // The desktop stub accepts the call but has no panel to open.
      if (snap.isStub) toast('Score sent · the leaderboard opens inside Snapchat');
    } catch (e) {
      const code = (e && e.message) || 'unknown error';
      console.warn('Leaderboard unavailable:', code);
      toast(code === 'ERR_INTERNAL' ? 'Leaderboard is still loading, try again' : 'Leaderboard unavailable (' + code + ')');
    }
  }

  // ================================================================ audio
  let audio = null, master = null;
  function initAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    master = audio.createGain(); master.gain.value = S.muted ? 0 : 0.6;
    const comp = audio.createDynamicsCompressor(); comp.connect(audio.destination);
    master.connect(comp);
  }
  function tone(freq, dur, type = 'sine', vol = 0.2, delay = 0, slideTo = 0) {
    if (TONE_LOG && !S.muted) TONE_LOG.push([time + delay, freq, dur, type, vol, slideTo]);
    if (!audio || S.muted) return;
    const t0 = audio.currentTime + delay;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // A harmonic minor: a little eerie, still sweet
  const SCALE = [440, 493.88, 523.25, 587.33, 659.25, 698.46, 830.61, 880];
  const SFX = {
    letter(i) { tone(SCALE[Math.min(i, SCALE.length - 1)], 0.18, 'triangle', 0.16); },
    correct() { [0, 2, 4].forEach((k, i) => tone(SCALE[k] * 1, 0.3, 'triangle', 0.14, i * 0.07)); },
    pop(i) { tone(880 + i * 60, 0.08, 'sine', 0.08); },
    bonus() { [4, 5, 7].forEach((k, i) => tone(SCALE[k], 0.25, 'sine', 0.12, i * 0.06)); },
    already() { tone(440, 0.12, 'sine', 0.1); tone(440, 0.12, 'sine', 0.1, 0.14); },
    wrong() { tone(220, 0.22, 'sawtooth', 0.06, 0, 140); },
    shuffle() { for (let i = 0; i < 4; i++) tone(600 + i * 90, 0.06, 'sine', 0.06, i * 0.03); },
    hint() { tone(1046, 0.4, 'sine', 0.12, 0, 1568); },
    coin() { tone(1318, 0.08, 'square', 0.04); tone(1760, 0.14, 'square', 0.04, 0.06); },
    win() { [0, 2, 4, 6, 7].forEach((k, i) => tone(SCALE[k], 0.45, 'triangle', 0.15, i * 0.1)); tone(SCALE[7] * 2, 0.9, 'sine', 0.1, 0.55); tone(SCALE[4] * 2, 0.9, 'sine', 0.08, 0.62); },
    tap() { tone(700, 0.05, 'sine', 0.06); },
  };
  function setMuted(m) {
    S.muted = m;
    if (master) master.gain.value = m ? 0 : 0.6;
    writeSave();
  }

  // ================================================================ level state
  let level = null;
  let screen = 'loading';
  let sel = [];               // indexes into level.letters being swiped
  let dragging = false, pointer = { x: 0, y: 0 };
  const preview = { text: '', t: 0, mode: '', shake: 0 };
  const flyers = [], parts = [], coinFly = [], toasts = [];
  let time = 0, winT = -1, wheelSpin = 0, coinBump = 0, jarBump = 0, hintPulse = 0;
  let tutorial = false, lastProgress = 0;

  function loadLevel(n) {
    const src = LEVELS[(n - 1) % LEVELS.length];
    const cells = new Map();
    let cols = 0, rows = 0;
    const words = src.w.map(([w, x, y, d]) => {
      const keys = [];
      for (let i = 0; i < w.length; i++) {
        const cx = x + (d === 0 ? i : 0), cy = y + (d === 1 ? i : 0);
        const k = cx + ',' + cy;
        if (!cells.has(k)) cells.set(k, { x: cx, y: cy, ch: w[i], shown: false, pop: 0, flash: 0, glow: 0 });
        keys.push(k);
        cols = Math.max(cols, cx + 1); rows = Math.max(rows, cy + 1);
      }
      return { w, keys, found: false };
    });
    const letters = src.l.split('');
    // Past the last level the puzzles repeat with the wheel reshuffled.
    if (n > LEVELS.length) shuffle(letters, seeded(n));
    level = {
      n, cols, rows, cells, words, letters,
      bonus: new Set(src.b ? src.b.split(' ') : []),
      theme: themeFor(n),
    };
    for (const w of words) if (S.found.includes(w.w)) { w.found = true; for (const k of w.keys) cells.get(k).shown = true; }
    for (const k of S.hints) if (cells.has(k)) cells.get(k).shown = true;
    for (const w of words) if (!w.found && w.keys.every((k) => cells.get(k).shown)) w.found = true;
    sel = []; dragging = false; winT = -1;
    preview.text = ''; preview.mode = '';
    flyers.length = 0;
    tutorial = n === 1 && !words.some((w) => w.found);
    layoutLevel();
    if (words.every((w) => w.found)) finishLevel();
  }

  function startLevel(n) {
    S.level = n; S.found = []; S.hints = []; S.bonus = [];
    loadLevel(n);
    writeSave();
  }

  // ================================================================ word logic
  function submitWord() {
    const word = sel.map((i) => level.letters[i]).join('');
    sel = [];
    if (word.length < 2) { preview.text = ''; return; }
    preview.text = word; preview.t = 0;
    const target = level.words.find((w) => w.w === word);
    if (target && !target.found) {
      target.found = true;
      S.found.push(word);
      preview.mode = 'good';
      lastProgress = time;
      revealWord(target, word);
      SFX.correct();
      if (tutorial) tutorial = false;
      writeSave();
      if (level.words.every((w) => w.found)) finishLevel();
    } else if (target) {
      preview.mode = 'same';
      for (const k of target.keys) level.cells.get(k).flash = 1;
      SFX.already();
    } else if (word.length >= 3 && level.bonus.has(word)) {
      if (S.bonus.includes(word)) {
        preview.mode = 'same';
        toast('Bonus word already found');
        SFX.already();
      } else {
        S.bonus.push(word);
        preview.mode = 'bonus';
        SFX.bonus();
        addToJar();
        writeSave();
      }
    } else {
      preview.mode = 'bad';
      preview.shake = 1;
      SFX.wrong();
    }
  }

  function revealWord(w, word) {
    // Letters fly from the preview pill into their tiles.
    // same letter spacing as drawPreview: 30px Fredoka is about 23px a letter
    const step = 30 * 0.78, pw = word.length * step;
    w.keys.forEach((k, i) => {
      const c = level.cells.get(k);
      const sx = L.preview.x - pw / 2 + step / 2 + i * step;
      flyers.push({ ch: word[i], sx, sy: L.preview.y, cell: c, t: -i * 0.06, dur: 0.38, idx: i });
    });
  }

  function addToJar() {
    S.jar++;
    jarBump = 1;
    if (S.jar >= CFG.JAR_SIZE) {
      S.jar = 0;
      giveCoins(CFG.JAR_COINS, L.jar.x, L.jar.y);
      toast(`Bonus jar full! +${CFG.JAR_COINS} coins`);
    } else {
      toast(`Bonus word! ${S.jar}/${CFG.JAR_SIZE}`);
    }
  }

  function giveCoins(n, x, y) {
    const k = Math.min(10, Math.max(3, Math.round(n / 5)));
    for (let i = 0; i < k; i++) {
      coinFly.push({ sx: x + rand(-24, 24), sy: y + rand(-24, 24), t: -i * 0.06, dur: 0.6, val: i === k - 1 ? n - Math.floor(n / k) * (k - 1) : Math.floor(n / k) });
    }
  }

  function useHint() {
    if (winT >= 0) return;
    if (S.coins < CFG.HINT_COST) {
      toast(`Hints cost ${CFG.HINT_COST} coins`);
      SFX.wrong();
      jarBump = 1;
      return;
    }
    // First hidden letter of the shortest unfinished word.
    const open = level.words.filter((w) => !w.found).sort((a, b) => a.w.length - b.w.length);
    for (const w of open) {
      const k = w.keys.find((key) => !level.cells.get(key).shown);
      if (!k) continue;
      const c = level.cells.get(k);
      S.coins -= CFG.HINT_COST;
      coinBump = 1;
      c.shown = true; c.pop = 1; c.glow = 1;
      S.hints.push(k);
      burst(cellX(c.x), cellY(c.y), level.theme.accent, 14);
      SFX.hint();
      for (const ww of level.words) {
        if (!ww.found && ww.keys.every((key) => level.cells.get(key).shown)) { ww.found = true; S.found.push(ww.w); }
      }
      writeSave();
      if (level.words.every((ww) => ww.found)) finishLevel();
      return;
    }
  }

  function shuffleWheel() {
    if (dragging) return;
    const old = level.letters.slice();
    for (let i = 0; i < 6; i++) {
      shuffle(level.letters);
      if (level.letters.join('') !== old.join('')) break;
    }
    wheelSpin = 1;
    SFX.shuffle();
  }

  function finishLevel() {
    if (winT >= 0) return;
    winT = 0;
    sel = []; dragging = false;
  }

  function completeLevel() {
    giveCoins(CFG.LEVEL_COINS, LW / 2, L.preview.y);
    S.bestLevel = Math.max(S.bestLevel, S.level);
    startLevel(S.level + 1);
    submitScore();
  }

  // ================================================================ effects
  function burst(x, y, col, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(60, 220);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rand(0.4, 0.8), max: 0.8, col, r: rand(2, 5), g: 300 });
    }
  }
  function confetti() {
    // candy-coloured confetti and a cloud of bats
    const cols = ['#ff8a1f', '#ffd23f', '#9dff5c', '#c07bff', '#f7ead2', '#ff4d3a'];
    for (let i = 0; i < 12; i++) {
      parts.push({ x: LW / 2 + rand(-40, 40), y: L.grid.y + L.grid.h / 2, vx: rand(-260, 260), vy: rand(-260, -60), life: rand(1.6, 2.4), max: 2.4, col: '#07030d', r: rand(14, 24), g: -20, bat: true, rot: rand(0, 6) });
    }
    for (let i = 0; i < 90; i++) {
      parts.push({
        x: rand(0, LW), y: L.top - rand(0, 120), vx: rand(-40, 40), vy: rand(80, 260),
        life: rand(2, 3.2), max: 3.2, col: cols[i % cols.length], r: rand(4, 8), g: 60, conf: true, rot: rand(0, 6), vr: rand(-8, 8),
      });
    }
  }
  function toast(msg) {
    toasts.length = 0;
    toasts.push({ msg, t: 0 });
  }

  // ================================================================ input
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale - offX, y: (e.clientY - r.top) / scale };
  }
  function letterAt(p, pad) {
    if (!level) return -1;
    for (let i = 0; i < level.spots.length; i++) {
      if (dist(p.x, p.y, level.spots[i].x, level.spots[i].y) <= level.bubble + pad) return i;
    }
    return -1;
  }
  function addLetter(i) {
    sel.push(i);
    preview.text = sel.map((k) => level.letters[k]).join('');
    preview.mode = 'build'; preview.t = 0;
    SFX.letter(sel.length - 1);
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    if (screen !== 'play') return;
    const p = toLogical(e);
    pointer = p;
    if (winT >= 0) {
      if (winT > 0.9) winT = Math.max(winT, 2.4);
      return;
    }
    if (inCircle(p, L.sound, 8)) { setMuted(!S.muted); SFX.tap(); return; }
    if (snap && inCircle(p, L.board, 8)) { SFX.tap(); showLeaderboard(); return; }
    if (inCircle(p, L.shuffle, 10)) { shuffleWheel(); return; }
    if (inCircle(p, L.hint, 10)) { useHint(); return; }
    if (inCircle(p, L.jar, 10)) {
      SFX.tap();
      toast(S.bonus.length ? 'Bonus: ' + S.bonus.join(', ') : 'Find extra words to fill the bonus jar');
      return;
    }
    const i = letterAt(p, 10);
    if (i >= 0) {
      dragging = true;
      sel = [];
      addLetter(i);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const p = toLogical(e);
    pointer = p;
    const i = letterAt(p, -level.bubble * 0.15);
    if (i < 0) return;
    if (sel.length >= 2 && sel[sel.length - 2] === i) {
      sel.pop();
      preview.text = sel.map((k) => level.letters[k]).join('');
      SFX.letter(sel.length - 1);
    } else if (!sel.includes(i)) {
      addLetter(i);
    }
  });
  const endDrag = (e) => {
    if (!dragging) return;
    if (e) e.preventDefault();
    dragging = false;
    submitWord();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Keyboard, for testing on a desktop: type letters, Enter to submit.
  window.addEventListener('keydown', (e) => {
    if (screen !== 'play' || winT >= 0) return;
    initAudio();
    const k = e.key.toUpperCase();
    if (k === 'ENTER') { if (sel.length) submitWord(); return; }
    if (k === 'BACKSPACE') { sel.pop(); preview.text = sel.map((i) => level.letters[i]).join(''); return; }
    if (k === ' ') { shuffleWheel(); return; }
    if (k.length === 1 && k >= 'A' && k <= 'Z') {
      const i = level.letters.findIndex((ch, idx) => ch === k && !sel.includes(idx));
      if (i >= 0) addLetter(i);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      writeSave();
      if (audio && audio.state === 'running') audio.suspend().catch(() => {});
    } else if (audio) {
      audio.resume().catch(() => {});
    }
  });
  window.addEventListener('resize', resize);

  // ================================================================ drawing helpers
  function setFont(size, display) { ctx.font = display ? `400 ${size}px ${DISPLAY}` : `700 ${size}px ${FONT}`; }
  function text(str, x, y, size, col = BONE, align = 'center', o = {}) {
    setFont(size, o.display);
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur || size * 0.6; }
    if (o.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.sw || Math.max(3, size / 5);
      ctx.strokeStyle = o.stroke;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = col;
    ctx.fillText(str, x, y + (o.dy || 0));
    if (o.glow) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
  }
  function rrect(x, y, w, h, r, g = ctx) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function circle(x, y, r, g = ctx) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }
  function sprite(w, h, draw) {
    const k = dpr * scale, c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
    const g = c.getContext('2d'); g.scale(k, k);
    draw(g);
    return c;
  }
  // dark glass panel used by every HUD piece
  function glass(x, y, w, h, r, accent, alpha = 0.72) {
    rrect(x, y + 3, w, h, r); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    rrect(x, y, w, h, r);
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, `rgba(44,22,70,${alpha})`); gr.addColorStop(1, `rgba(12,5,24,${alpha + 0.1})`);
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(accent, 0.55); ctx.stroke();
  }

  // ================================================================ background
  let bgCanvas = null, bgKey = '';
  function buildBackground(theme) {
    const key = theme.name + canvas.width + 'x' + canvas.height + (level ? 'L' : '');
    if (key === bgKey) return;
    bgKey = key;
    bgCanvas = bgCanvas || document.createElement('canvas');
    bgCanvas.width = canvas.width; bgCanvas.height = canvas.height;
    const g = bgCanvas.getContext('2d');
    const k = dpr * scale;
    g.setTransform(k, 0, 0, k, 0, 0);
    // logical coordinates across the whole screen; content column starts at offX
    const W = VW, H = LH, X0 = offX;
    const rnd = seeded(theme.name.length * 977 + theme.name.charCodeAt(0));
    const sky = g.createLinearGradient(0, 0, 0, H * 0.78);
    sky.addColorStop(0, theme.sky[0]); sky.addColorStop(0.55, theme.sky[1]); sky.addColorStop(1, theme.sky[2]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // stars
    for (let i = 0; i < 140; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.75;
      g.fillStyle = rnd() < 0.15 ? theme.moon : '#ffffff';
      const s = rnd() < 0.1 ? 2.2 : 1.1;
      g.fillRect(rnd() * W, rnd() * H * 0.6, s, s);
    }
    g.globalAlpha = 1;
    // moon with halo and craters
    const mx = X0 + LW * 0.76, my = ST + 150, mr = 70;
    const halo = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4.2);
    halo.addColorStop(0, rgba(theme.moon, 0.55)); halo.addColorStop(0.35, rgba(theme.glow, 0.16)); halo.addColorStop(1, rgba(theme.glow, 0));
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
    const mg = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    mg.addColorStop(0, shade(theme.moon, 0.5)); mg.addColorStop(1, theme.moon);
    circle(mx, my, mr, g); g.fillStyle = mg; g.fill();
    g.fillStyle = rgba(theme.sky[1], 0.16);
    for (const [cx, cy, cr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.38, 0.12], [0.35, -0.35, 0.09], [-0.42, 0.25, 0.08]]) {
      circle(mx + cx * mr, my + cy * mr, cr * mr, g); g.fill();
    }
    // wisps of cloud across the moon
    for (let i = 0; i < 3; i++) {
      const cy = my - 30 + i * 36 + rnd() * 10, cx = mx - 60 + rnd() * 90, rx = 130 + rnd() * 60;
      g.save(); g.translate(cx, cy); g.scale(1, 0.09);
      const wg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      wg.addColorStop(0, rgba(theme.sky[0], 0.55)); wg.addColorStop(1, rgba(theme.sky[0], 0));
      g.fillStyle = wg; g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
    // horizon sits around the top of the wheel
    const hz = L.wheel ? L.wheel.y - L.wheel.r * 0.55 : H * 0.62;
    const hill = (base, amp, col, f) => {
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, base - Math.sin(x / 140 * f + f) * amp - Math.sin(x / 57 + f * 3) * amp * 0.3);
      g.lineTo(W, H); g.closePath(); g.fillStyle = col; g.fill();
    };
    hill(hz - 40, 26, theme.far, 1.3);
    drawScene(g, theme, rnd, X0, hz - 40, W);
    // low glowing fog over the far hills
    const fogB = g.createLinearGradient(0, hz - 90, 0, hz + 30);
    fogB.addColorStop(0, rgba(theme.fog, 0)); fogB.addColorStop(0.7, rgba(theme.fog, 0.18)); fogB.addColorStop(1, rgba(theme.fog, 0));
    g.fillStyle = fogB; g.fillRect(0, hz - 90, W, 120);
    hill(hz + 10, 18, theme.mid, 2.1);
    // dead trees on the mid hill, at the screen sides
    g.strokeStyle = theme.mid; g.lineCap = 'round';
    deadTree(g, X0 - 10, hz + 18, 120, -Math.PI / 2 + 0.12, 11, 6, rnd);
    deadTree(g, X0 + LW + 6, hz + 20, 105, -Math.PI / 2 - 0.15, 10, 6, rnd);
    for (let x = X0 - 160; x > -40; x -= 120) deadTree(g, x, hz + 18, 70 + rnd() * 50, -Math.PI / 2 + rnd() * 0.3 - 0.15, 7, 5, rnd);
    for (let x = X0 + LW + 140; x < W + 40; x += 120) deadTree(g, x, hz + 18, 70 + rnd() * 50, -Math.PI / 2 + rnd() * 0.3 - 0.15, 7, 5, rnd);
    hill(H - SB * 0.6, 14, theme.near, 3.3);
    // jack-o'-lanterns at the bottom corners, outside the play area
    pumpkin(g, X0 + 34, H - SB * 0.55, 34, theme);
    pumpkin(g, X0 + 82, H - SB * 0.45, 22, theme);
    pumpkin(g, X0 + LW - 40, H - SB * 0.5, 30, theme);
    for (let x = X0 - 90; x > -40; x -= 150) pumpkin(g, x, H - SB * 0.5, 26 + rnd() * 10, theme);
    for (let x = X0 + LW + 90; x < W + 40; x += 150) pumpkin(g, x, H - SB * 0.5, 26 + rnd() * 10, theme);
    // vignette
    const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  function deadTree(g, x, y, len, ang, w, depth, rnd) {
    if (depth <= 0 || len < 4) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(ang + 0.3) * len * 0.5, y + Math.sin(ang + 0.3) * len * 0.5, x2, y2);
    g.stroke();
    const n = depth > 3 ? 2 : 1 + (rnd() < 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      deadTree(g, x2, y2, len * (0.55 + rnd() * 0.2), ang + (rnd() - 0.5) * 1.4 + (i ? 0.45 : -0.45), w * 0.62, depth - 1, rnd);
    }
  }

  function pumpkin(g, x, y, r, theme) {
    g.save();
    const glow = g.createRadialGradient(x, y, r * 0.5, x, y, r * 2.4);
    glow.addColorStop(0, rgba('#ff8a1f', 0.35)); glow.addColorStop(1, rgba('#ff8a1f', 0));
    g.fillStyle = glow; g.fillRect(x - r * 2.5, y - r * 2.5, r * 5, r * 5);
    const body = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r * 1.2);
    body.addColorStop(0, '#ffa63d'); body.addColorStop(0.7, '#e2600f'); body.addColorStop(1, '#8a2c06');
    g.fillStyle = body;
    for (const [dx, sx] of [[-0.45, 0.62], [0.45, 0.62], [0, 0.7]]) {
      g.beginPath(); g.ellipse(x + dx * r, y, sx * r, r * 0.82, 0, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(90,25,0,0.45)'; g.lineWidth = r * 0.05;
    for (const dx of [-0.25, 0.25]) { g.beginPath(); g.ellipse(x + dx * r, y, r * 0.3, r * 0.8, 0, -1.3, 1.3); g.stroke(); }
    g.fillStyle = '#3d5a1c'; rrect(x - r * 0.08, y - r * 1.08, r * 0.18, r * 0.36, r * 0.06, g); g.fill();
    // carved face
    g.fillStyle = '#ffe27a'; g.shadowColor = '#ffcf4a'; g.shadowBlur = r * 0.6;
    const eye = (ex) => { g.beginPath(); g.moveTo(x + ex - r * 0.17, y - r * 0.05); g.lineTo(x + ex, y - r * 0.38); g.lineTo(x + ex + r * 0.17, y - r * 0.05); g.closePath(); g.fill(); };
    eye(-r * 0.32); eye(r * 0.32);
    g.beginPath(); g.moveTo(x - r * 0.5, y + r * 0.15);
    const teeth = 5;
    for (let i = 0; i <= teeth; i++) g.lineTo(x - r * 0.5 + i * r / teeth, y + r * (i % 2 ? 0.28 : 0.15));
    g.quadraticCurveTo(x, y + r * 0.75, x - r * 0.5, y + r * 0.15);
    g.fill();
    g.restore();
  }

  // one landmark per theme on the far hill
  function drawScene(g, theme, rnd, X0, base, W) {
    g.fillStyle = theme.far; g.strokeStyle = theme.far;
    const lit = (x, y, w, h) => {
      g.save(); g.fillStyle = '#ffcf6a'; g.shadowColor = '#ffb43a'; g.shadowBlur = 10;
      g.fillRect(x, y, w, h); g.restore();
    };
    if (theme.scene === 'manor') {
      const x = X0 + 30, y = base + 6;
      g.fillRect(x, y - 70, 120, 72);
      g.beginPath(); g.moveTo(x - 8, y - 70); g.lineTo(x + 60, y - 118); g.lineTo(x + 128, y - 70); g.fill();
      g.fillRect(x + 84, y - 130, 26, 70);
      g.beginPath(); g.moveTo(x + 80, y - 130); g.lineTo(x + 97, y - 172); g.lineTo(x + 114, y - 130); g.fill();
      g.fillRect(x + 16, y - 112, 8, 30);
      lit(x + 18, y - 56, 12, 16); lit(x + 52, y - 56, 12, 16); lit(x + 91, y - 116, 10, 14); lit(x + 52, y - 28, 14, 22);
      g.fillStyle = theme.far;
      g.lineWidth = 3; g.beginPath(); g.moveTo(x + 97, y - 172); g.lineTo(x + 97, y - 186); g.stroke();
    } else if (theme.scene === 'castle') {
      const x = X0 + 22, y = base + 8;
      g.fillRect(x, y - 60, 150, 62);
      for (let i = 0; i < 8; i++) g.fillRect(x + i * 20, y - 70, 10, 12);
      for (const [tx, th] of [[x - 8, 110], [x + 62, 150], [x + 136, 120]]) {
        g.fillRect(tx, y - th, 30, th);
        g.beginPath(); g.moveTo(tx - 6, y - th); g.lineTo(tx + 15, y - th - 46); g.lineTo(tx + 36, y - th); g.fill();
      }
      lit(x + 73, y - 120, 8, 14); lit(x + 4, y - 86, 7, 12); lit(x + 146, y - 96, 7, 12); lit(x + 68, y - 34, 18, 34);
    } else if (theme.scene === 'graveyard') {
      for (let i = 0; i < 9; i++) {
        const x = X0 + 18 + i * 58 + rnd() * 16, h = 26 + rnd() * 20, w = 16 + rnd() * 8, y = base + 14 - Math.sin(i) * 6;
        if (i % 3 === 1) { g.fillRect(x + w / 2 - 3, y - h - 10, 6, h + 10); g.fillRect(x, y - h + 2, w, 6); }
        else { rrect(x, y - h, w, h + 4, w / 2, g); g.fill(); }
      }
      g.lineWidth = 2.5;
      for (let x = 0; x < W; x += 14) { g.beginPath(); g.moveTo(x, base + 26); g.lineTo(x, base + 2); g.stroke(); g.beginPath(); g.moveTo(x - 3, base + 4); g.lineTo(x, base - 3); g.lineTo(x + 3, base + 4); g.fill(); }
      g.fillRect(0, base + 8, W, 3);
    } else if (theme.scene === 'forest') {
      for (let i = 0; i < 7; i++) deadTree(g, X0 - 20 + i * 95 + rnd() * 30, base + 20, 60 + rnd() * 50, -Math.PI / 2 + (rnd() - 0.5) * 0.3, 8, 5, rnd);
      // witch on a broom across the moon
      const wx = X0 + LW * 0.7, wy = ST + 140;
      g.save(); g.translate(wx, wy); g.rotate(-0.12); g.fillStyle = theme.sky[0];
      g.fillRect(-40, 0, 80, 3);
      g.beginPath(); g.moveTo(32, -2); g.lineTo(54, -8); g.lineTo(54, 10); g.closePath(); g.fill();
      circle(-4, -14, 6, g); g.fill();
      g.beginPath(); g.moveTo(-14, -18); g.lineTo(-4, -40); g.lineTo(6, -18); g.fill();
      g.beginPath(); g.moveTo(-10, -8); g.lineTo(10, -8); g.lineTo(14, 2); g.lineTo(-14, 2); g.fill();
      g.restore();
    } else if (theme.scene === 'patch') {
      g.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        const x = X0 - 40 + i * 52 + rnd() * 20;
        g.beginPath(); g.ellipse(x, base + 16, 15 + rnd() * 8, 11, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x, base + 6); g.quadraticCurveTo(x + 8, base - 6, x + 16, base - 2); g.stroke();
      }
      // scarecrow
      const sx = X0 + LW * 0.2;
      g.fillRect(sx - 3, base - 90, 6, 104); g.fillRect(sx - 34, base - 66, 68, 5);
      circle(sx, base - 96, 11, g); g.fill();
      g.beginPath(); g.moveTo(sx - 18, base - 102); g.lineTo(sx, base - 128); g.lineTo(sx + 18, base - 102); g.fill();
      g.beginPath(); g.moveTo(sx - 16, base - 64); g.lineTo(sx + 16, base - 64); g.lineTo(sx + 20, base - 26); g.lineTo(sx - 20, base - 26); g.fill();
    }
  }

  // ================================================================ ambient (bats, fog, embers)
  const bats = [], embers = [];
  let fogSprite = null, fogKey = '', emberSprite = null;
  function batShape(x, y, s, flap) {
    const R = [[0, -0.16], [0.05, -0.34], [0.1, -0.18], [0.3, -0.25 - 0.3 * flap], [0.62, -0.3 - 0.45 * flap], [1, -0.08 - 0.6 * flap],
      [0.84, 0.02 - 0.3 * flap], [0.68, 0.18 - 0.15 * flap], [0.52, 0.06], [0.38, 0.2], [0.24, 0.07], [0.1, 0.18], [0, 0.26]];
    ctx.beginPath();
    R.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * s, y + py * s) : ctx.moveTo(x + px * s, y + py * s)));
    for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(x - R[i][0] * s, y + R[i][1] * s);
    ctx.closePath(); ctx.fill();
  }
  function drawAmbient(dt) {
    const t = level.theme;
    if (!bats.length) {
      for (let i = 0; i < 6; i++) bats.push({ x: rand(-offX, LW + offX), y: ST + rand(10, 260), s: rand(10, 22), v: rand(30, 70) * (i % 2 ? 1 : -1), ph: rand(0, 6), f: rand(9, 14) });
      for (let i = 0; i < 22; i++) embers.push({ x: rand(-offX, LW + offX), y: rand(ST, LH), v: rand(12, 30), ph: rand(0, 6), r: rand(0.6, 1.4) });
    }
    const fk = t.name + dpr * scale;
    if (fk !== fogKey) {
      fogKey = fk;
      fogSprite = sprite(600, 140, (g) => {
        // every puff stays inside the sprite so tiled copies have no hard edges
        for (let i = 0; i < 8; i++) {
          const r = 46 + (i % 3) * 10, cx = 75 + i * 64, cy = 70 + Math.sin(i * 1.7) * (68 - r);
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
          gr.addColorStop(0, rgba(t.fog, 0.22)); gr.addColorStop(1, rgba(t.fog, 0));
          g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      });
      emberSprite = sprite(24, 24, (g) => {
        const gr = g.createRadialGradient(12, 12, 0, 12, 12, 12);
        gr.addColorStop(0, '#fff2c0'); gr.addColorStop(0.25, rgba(t.accent, 0.9)); gr.addColorStop(1, rgba(t.accent, 0));
        g.fillStyle = gr; g.fillRect(0, 0, 24, 24);
      });
    }
    // drifting fog, one band low over the hills and one behind the wheel
    const fw = 600;
    for (const [y, sp, a] of [[L.wheel.y - L.wheel.r * 0.9, 14, 0.9], [L.wheel.y + L.wheel.r * 0.4, -10, 0.75], [L.grid.y + L.grid.h * 0.55, 6, 0.4]]) {
      ctx.globalAlpha = a;
      const off = ((time * sp) % fw + fw) % fw;
      for (let x = -offX - fw + off; x < LW + offX; x += fw) ctx.drawImage(fogSprite, x, y - 70, fw, 140);
    }
    ctx.globalAlpha = 1;
    // embers rising
    for (const e of embers) {
      e.y -= e.v * dt; e.x += Math.sin(time * 1.3 + e.ph) * 8 * dt;
      if (e.y < ST - 20) { e.y = LH + 10; e.x = rand(-offX, LW + offX); }
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 3 + e.ph);
      const s = 10 * e.r;
      ctx.drawImage(emberSprite, e.x - s, e.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    // bats
    ctx.fillStyle = '#07030d';
    for (const b of bats) {
      b.x += b.v * dt;
      const yy = b.y + Math.sin(time * 1.4 + b.ph) * 12;
      if (b.x > LW + offX + 40) b.x = -offX - 40;
      if (b.x < -offX - 40) b.x = LW + offX + 40;
      batShape(b.x, yy, b.s, Math.sin(time * b.f + b.ph));
    }
  }

  // ================================================================ draw: HUD
  function drawCoinIcon(x, y, r) {
    const gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    gr.addColorStop(0, '#fff3a8'); gr.addColorStop(0.6, '#ffc21f'); gr.addColorStop(1, '#c47a06');
    circle(x, y, r); ctx.fillStyle = gr; ctx.fill();
    circle(x, y, r * 0.72); ctx.lineWidth = Math.max(1, r * 0.12); ctx.strokeStyle = 'rgba(140,70,0,0.55)'; ctx.stroke();
    // tiny skull stamped on the coin
    ctx.fillStyle = 'rgba(120,60,0,0.75)';
    circle(x, y - r * 0.08, r * 0.36); ctx.fill();
    ctx.fillRect(x - r * 0.2, y + r * 0.15, r * 0.4, r * 0.22);
    ctx.fillStyle = '#ffd95a';
    circle(x - r * 0.14, y - r * 0.1, r * 0.1); ctx.fill();
    circle(x + r * 0.14, y - r * 0.1, r * 0.1); ctx.fill();
  }
  function drawHud() {
    const t = level.theme;
    const c = L.coins, bump = 1 + coinBump * 0.12;
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2); ctx.scale(bump, bump); ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
    glass(c.x, c.y, c.w, c.h, c.h / 2, t.accent);
    drawCoinIcon(c.x + 23, c.y + c.h / 2, 16);
    text(String(S.coins), c.x + 46, c.y + c.h / 2 + 1, 23, '#ffe7a8', 'left');
    ctx.restore();
    text('LEVEL ' + S.level, L.title.x, L.title.y - 5, 34, t.accent, 'center', { display: true, glow: rgba(t.accent, 0.9), blur: 16, stroke: 'rgba(10,3,18,0.85)', sw: 5 });
    setFont(12);
    text(t.name.toUpperCase().split('').join(' '), L.title.x, L.title.y + 22, 12, rgba(BONE_HEX, 0.85), 'center', { stroke: 'rgba(10,3,18,0.7)', sw: 3 });
    iconButton(L.sound, t.accent);
    drawSpeaker(L.sound.x, L.sound.y, S.muted);
    if (snap) {
      ctx.save(); if (!lbSupported) ctx.globalAlpha = 0.45;
      iconButton(L.board, t.accent); drawTrophy(L.board.x, L.board.y);
      ctx.restore();
    }
  }
  function iconButton(b, accent, k = 1, ring = 0) {
    ctx.save();
    ctx.translate(b.x, b.y); ctx.scale(k, k);
    circle(0, 3, b.r); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
    const gr = ctx.createLinearGradient(0, -b.r, 0, b.r);
    gr.addColorStop(0, 'rgba(58,28,88,0.9)'); gr.addColorStop(1, 'rgba(14,6,26,0.95)');
    circle(0, 0, b.r); ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = rgba(accent, 0.6 + ring * 0.4); ctx.stroke();
    if (ring) { ctx.shadowColor = accent; ctx.shadowBlur = 18 * ring; circle(0, 0, b.r); ctx.stroke(); ctx.shadowBlur = 0; }
    ctx.restore();
  }
  function drawSpeaker(x, y, muted) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = BONE;
    ctx.beginPath(); ctx.moveTo(-11, -5); ctx.lineTo(-5, -5); ctx.lineTo(2, -11); ctx.lineTo(2, 11); ctx.lineTo(-5, 5); ctx.lineTo(-11, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = BONE; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    if (muted) {
      ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(14, 5); ctx.moveTo(14, -5); ctx.lineTo(6, 5); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(3, 0, 7, -0.8, 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(3, 0, 12, -0.8, 0.8); ctx.stroke();
    }
    ctx.restore();
  }
  function drawTrophy(x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#ffc21f';
    ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(9, -10); ctx.lineTo(7, 0); ctx.quadraticCurveTo(0, 6, -7, 0); ctx.closePath(); ctx.fill();
    ctx.fillRect(-2, 2, 4, 6); ctx.fillRect(-7, 8, 14, 3);
    ctx.strokeStyle = '#ffc21f'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(-9, -5, 4, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(9, -5, 4, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.restore();
  }

  // ================================================================ draw: grid
  let tileCache = { key: '' };
  function tileSprites() {
    const s = level.tile, t = level.theme;
    const key = t.name + '|' + s.toFixed(2) + '|' + dpr * scale;
    if (tileCache.key === key) return tileCache;
    const pad = Math.ceil(s * 0.35), size = s + pad * 2;
    const inset = Math.max(2, s * 0.06), w = s - inset * 2, r = s * 0.22, x = pad + inset, y = pad + inset;
    const empty = sprite(size, size, (g) => {
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = s * 0.14; g.shadowOffsetY = s * 0.05;
      rrect(x, y, w, w, r, g); g.fillStyle = 'rgba(16,6,30,0.8)'; g.fill();
      g.shadowColor = 'transparent';
      const gr = g.createLinearGradient(0, y, 0, y + w);
      gr.addColorStop(0, 'rgba(120,70,170,0.28)'); gr.addColorStop(1, 'rgba(20,8,36,0)');
      rrect(x, y, w, w, r, g); g.fillStyle = gr; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = rgba(t.accent, 0.42); rrect(x + 0.75, y + 0.75, w - 1.5, w - 1.5, r, g); g.stroke();
    });
    const full = sprite(size, size, (g) => {
      g.shadowColor = rgba(t.accent, 0.8); g.shadowBlur = s * 0.4;
      const gr = g.createLinearGradient(0, y, 0, y + w);
      gr.addColorStop(0, shade(t.accent, 0.5)); gr.addColorStop(0.45, t.accent); gr.addColorStop(1, shade(t.accent, -0.35));
      rrect(x, y, w, w, r, g); g.fillStyle = gr; g.fill();
      g.shadowColor = 'transparent';
      g.save(); rrect(x, y, w, w * 0.5, r, g); g.clip();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.5)'; rrect(x + 1.5, y + 1.5, w - 3, w - 3, r - 1, g); g.stroke();
      g.restore();
      g.lineWidth = 1; g.strokeStyle = rgba('#000000', 0.35); rrect(x + 0.5, y + 0.5, w - 1, w - 1, r, g); g.stroke();
    });
    tileCache = { key, empty, full, pad };
    return tileCache;
  }
  function drawGrid() {
    const s = level.tile, T = tileSprites(), pad = T.pad, t = level.theme;
    for (const c of level.cells.values()) {
      const x = level.gx + c.x * s, y = level.gy + c.y * s;
      const k = 1 + (c.pop > 0 ? Math.sin(c.pop * Math.PI) * 0.2 : 0) + c.flash * 0.08 * Math.sin(time * 30);
      ctx.save();
      ctx.translate(x + s / 2, y + s / 2); ctx.scale(k, k); ctx.translate(-(x + s / 2), -(y + s / 2));
      ctx.drawImage(c.shown ? T.full : T.empty, x - pad, y - pad, s + pad * 2, s + pad * 2);
      if (c.shown) {
        const inset = Math.max(2, s * 0.06);
        if (c.flash > 0 || c.glow > 0) {
          rrect(x + inset, y + inset, s - inset * 2, s - inset * 2, s * 0.22);
          ctx.fillStyle = `rgba(255,255,255,${Math.max(c.flash * 0.5, c.glow * 0.45)})`; ctx.fill();
        }
        text(c.ch, x + s / 2, y + s / 2 + s * 0.03, s * 0.6, t.tileInk);
      }
      ctx.restore();
    }
  }

  // ================================================================ draw: preview + wheel
  function drawPreview() {
    if (!preview.text) return;
    const accent = level.theme.accent;
    let alpha = 1, dx = 0, k = 1;
    if (preview.mode !== 'build') {
      alpha = clamp(1 - (preview.t - 0.35) / 0.3, 0, 1);
      if (preview.mode === 'good') k = 1 + Math.sin(Math.min(1, preview.t / 0.25) * Math.PI) * 0.12;
    }
    if (preview.shake > 0) dx = Math.sin(time * 60) * 10 * preview.shake;
    if (alpha <= 0) return;
    const col = { build: accent, good: '#9dff5c', bonus: '#ffd23f', same: '#c9b8ff', bad: '#ff4a5a' }[preview.mode] || accent;
    const size = 30, w = Math.max(60, preview.text.length * size * 0.78 + 34), h = 50;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(L.preview.x + dx, L.preview.y); ctx.scale(k, k);
    ctx.shadowColor = col; ctx.shadowBlur = 18;
    rrect(-w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = 'rgba(14,6,26,0.88)'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
    text(preview.text, 0, 2, size, col === accent ? shade(accent, 0.55) : col, 'center', { glow: rgba(col, 0.8), blur: 10 });
    ctx.restore();
  }

  let wheelCache = { key: '' };
  function wheelSprite() {
    const w = L.wheel, t = level.theme;
    const key = t.name + '|' + w.r + '|' + dpr * scale;
    if (wheelCache.key === key) return wheelCache;
    const pad = 40, size = w.r * 2 + pad * 2, c = w.r + pad;
    const img = sprite(size, size, (g) => {
      const halo = g.createRadialGradient(c, c, w.r * 0.9, c, c, w.r + pad);
      halo.addColorStop(0, rgba(t.accent, 0.45)); halo.addColorStop(1, rgba(t.accent, 0));
      g.fillStyle = halo; g.fillRect(0, 0, size, size);
      const disc = g.createRadialGradient(c, c - w.r * 0.4, w.r * 0.1, c, c, w.r);
      disc.addColorStop(0, 'rgba(70,32,104,0.94)'); disc.addColorStop(0.7, 'rgba(26,10,46,0.95)'); disc.addColorStop(1, 'rgba(10,4,20,0.97)');
      circle(c, c, w.r, g); g.fillStyle = disc; g.fill();
      g.lineWidth = 3; g.strokeStyle = rgba(t.accent, 0.95); g.stroke();
      circle(c, c, w.r - 7, g); g.lineWidth = 1; g.strokeStyle = rgba(t.accent, 0.35); g.stroke();
      // sheen across the top
      g.save(); circle(c, c, w.r - 2, g); g.clip();
      const sh = g.createLinearGradient(0, c - w.r, 0, c);
      sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(0, c - w.r, size, w.r);
      g.restore();
    });
    wheelCache = { key, img, pad };
    return wheelCache;
  }

  function drawWheel() {
    const w = L.wheel, t = level.theme, accent = t.accent;
    const WS = wheelSprite();
    ctx.drawImage(WS.img, w.x - w.r - WS.pad, w.y - w.r - WS.pad, (w.r + WS.pad) * 2, (w.r + WS.pad) * 2);
    // slowly turning ring of rune marks
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(time * 0.08);
    ctx.fillStyle = rgba(accent, 0.45);
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, rr = w.r - 15;
      ctx.save(); ctx.rotate(a); ctx.translate(rr, 0);
      if (i % 3 === 0) { ctx.beginPath(); ctx.moveTo(0, -3.5); ctx.lineTo(3, 0); ctx.lineTo(0, 3.5); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    ctx.restore();
    // connecting line: soft glow under a bright core
    if (sel.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const path = () => {
        ctx.beginPath();
        sel.forEach((i, n) => { const p = level.spots[i]; if (n) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        if (dragging) ctx.lineTo(pointer.x, pointer.y);
      };
      const lw = Math.max(9, level.bubble * 0.34);
      path(); ctx.lineWidth = lw * 2.4; ctx.strokeStyle = rgba(accent, 0.22); ctx.stroke();
      path(); ctx.lineWidth = lw; ctx.strokeStyle = accent; ctx.stroke();
      path(); ctx.lineWidth = lw * 0.3; ctx.strokeStyle = rgba('#ffffff', 0.55); ctx.stroke();
    }
    const spin = wheelSpin > 0 ? easeInOut(wheelSpin) : 0;
    level.letters.forEach((ch, i) => {
      const p = level.spots[i];
      const on = sel.includes(i);
      let x = p.x, y = p.y;
      if (spin) { // letters swirl through the centre after a shuffle
        x = lerp(p.x, w.x, Math.sin(spin * Math.PI) * 0.6);
        y = lerp(p.y, w.y, Math.sin(spin * Math.PI) * 0.6);
      }
      const r = level.bubble * (on ? 1.08 : 1);
      if (on) {
        ctx.shadowColor = accent; ctx.shadowBlur = 22;
        const og = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        og.addColorStop(0, shade(accent, 0.55)); og.addColorStop(0.6, accent); og.addColorStop(1, shade(accent, -0.3));
        circle(x, y, r); ctx.fillStyle = og; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        text(ch, x, y + r * 0.06, r * 1.2, t.tileInk);
      } else {
        text(ch, x, y + r * 0.06, r * 1.2, BONE, 'center', { glow: rgba(accent, 0.55), blur: 12 });
      }
    });
  }

  function drawSideButtons() {
    const t = level.theme, accent = t.accent;
    iconButton(L.shuffle, accent);
    drawShuffleIcon(L.shuffle.x, L.shuffle.y, BONE);
    const hp = hintPulse > 0 ? Math.max(0, Math.sin(hintPulse * Math.PI * 4)) : 0;
    iconButton(L.hint, accent, 1 + hp * 0.08, hp);
    drawBulb(L.hint.x, L.hint.y - 3);
    rrect(L.hint.x - 22, L.hint.y + 19, 44, 21, 10.5);
    ctx.fillStyle = '#ffc21f'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#7a3c00'; ctx.stroke();
    text(String(CFG.HINT_COST), L.hint.x, L.hint.y + 30, 14, '#4a2000');
    // bonus jar: a little jack-o'-lantern that fills up
    const jb = 1 + jarBump * 0.15;
    iconButton(L.jar, accent, jb);
    ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(L.jar.x, L.jar.y, L.jar.r - 4, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke();
    if (S.jar > 0) {
      ctx.beginPath(); ctx.arc(L.jar.x, L.jar.y, L.jar.r - 4, -Math.PI / 2, -Math.PI / 2 + (S.jar / CFG.JAR_SIZE) * Math.PI * 2);
      ctx.strokeStyle = '#ffc21f'; ctx.stroke();
    }
    ctx.save(); ctx.translate(L.jar.x, L.jar.y + 2); ctx.scale(jb, jb);
    pumpkin(ctx, 0, 0, 12, t);
    ctx.restore();
  }
  function drawShuffleIcon(x, y, col) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      ctx.beginPath(); ctx.arc(0, 0, 12, s > 0 ? -2.6 : 0.55, s > 0 ? -0.2 : 2.95); ctx.stroke();
      const a = s > 0 ? -0.2 : 2.95, ex = Math.cos(a) * 12, ey = Math.sin(a) * 12;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(ex + 6 * s, ey - 1 * s); ctx.lineTo(ex - 5 * s, ey - 4 * s); ctx.lineTo(ex - 1 * s, ey + 7 * s); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawBulb(x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffe27a';
    circle(0, -3, 10); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillRect(-5, 4, 10, 5);
    ctx.fillStyle = BONE; ctx.fillRect(-5, 9, 10, 3);
    ctx.restore();
  }

  // ================================================================ draw: tutorial / win / fx
  function drawTutorial() {
    if (!tutorial || dragging || winT >= 0) return;
    const target = level.words.find((w) => !w.found);
    if (!target) return;
    // follow the letters of the first word around the wheel
    const path = [];
    const used = [];
    for (const ch of target.w) {
      const i = level.letters.findIndex((c, k) => c === ch && !used.includes(k));
      if (i < 0) return;
      used.push(i); path.push(level.spots[i]);
    }
    const cyc = 0.6 * path.length + 1;
    const t = (time % cyc);
    const seg = Math.min(path.length - 1, Math.floor(t / 0.6));
    const f = easeInOut(clamp((t - seg * 0.6) / 0.6, 0, 1));
    const a = path[seg], b = path[Math.min(seg + 1, path.length - 1)];
    const hx = lerp(a.x, b.x, f), hy = lerp(a.y, b.y, f);
    const fade = t > cyc - 0.6 ? clamp((cyc - t) / 0.4, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = level.theme.accent;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i <= seg; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.lineTo(hx, hy); ctx.stroke();
    ctx.globalAlpha = fade;
    drawHand(hx + 6, hy + 10);
    ctx.restore();
    ctx.globalAlpha = 0.85 + Math.sin(time * 4) * 0.15;
    text('Swipe the letters to make words!', LW / 2, L.preview.y, 22, BONE, 'center', { stroke: 'rgba(10,3,18,0.85)', sw: 6 });
    ctx.globalAlpha = 1;
  }
  function drawHand(x, y) {
    // a skeleton finger pointing the way
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35);
    ctx.fillStyle = BONE; ctx.strokeStyle = '#2a0b1c'; ctx.lineWidth = 3;
    rrect(-7, -6, 14, 30, 7); ctx.fill(); ctx.stroke();
    rrect(-8, 14, 30, 30, 10); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  const CHEERS = ['SPOOKTACULAR!', 'BOO-TIFUL!', 'WICKED!', 'FANG-TASTIC!', 'GHOULISH!', 'BEWITCHING!', 'FRIGHTFUL!'];
  function drawWin() {
    if (winT < 0.35) return;
    const t = clamp((winT - 0.35) / 0.4, 0, 1);
    const k = easeOutBack(t), accent = level.theme.accent;
    ctx.save();
    ctx.globalAlpha = clamp(t * 2, 0, 1);
    ctx.fillStyle = 'rgba(6,2,12,0.45)';
    ctx.fillRect(-offX, 0, VW, LH);
    const cy = (L.grid.y + L.grid.y + L.grid.h) / 2;
    ctx.translate(LW / 2, cy); ctx.scale(k, k);
    const msg = CHEERS[(S.level - 1) % CHEERS.length];
    ctx.shadowColor = accent; ctx.shadowBlur = 40;
    rrect(-210, -92, 420, 190, 30); ctx.fillStyle = 'rgba(20,8,36,0.94)'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5; ctx.strokeStyle = accent; ctx.stroke();
    rrect(-200, -82, 400, 170, 24); ctx.lineWidth = 1; ctx.strokeStyle = rgba(accent, 0.35); ctx.stroke();
    ctx.fillStyle = '#07030d';
    batShape(-150, -70, 26, Math.sin(time * 12));
    batShape(150, -70, 26, Math.sin(time * 12 + 1));
    text(msg, 0, -32, msg.length > 11 ? 46 : 54, accent, 'center', { display: true, glow: rgba(accent, 0.9), blur: 22 });
    text('Level ' + S.level + ' complete', 0, 16, 22, BONE);
    drawCoinIcon(-20, 48, 13);
    text('+' + CFG.LEVEL_COINS, -2, 49, 21, '#ffd95a', 'left');
    if (winT > 1.1) text('tap to continue', 0, 76, 14, rgba(BONE_HEX, 0.55));
    ctx.restore();
  }

  function drawFx() {
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = p.col;
      if (p.bat) {
        batShape(p.x, p.y, p.r, Math.sin(time * 16 + p.rot));
      } else if (p.conf) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
        ctx.restore();
      } else {
        circle(p.x, p.y, p.r); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const f of flyers) {
      if (f.t < 0) continue;
      const e = easeOut(clamp(f.t / f.dur, 0, 1));
      const tx = cellX(f.cell.x), ty = cellY(f.cell.y);
      const x = lerp(f.sx, tx, e), y = lerp(f.sy, ty, e) - Math.sin(e * Math.PI) * 40;
      const size = lerp(30, level.tile * 0.6, e);
      text(f.ch, x, y, size, BONE, 'center', { stroke: level.theme.accent, sw: 6, glow: level.theme.accent, blur: 14 });
    }
    for (const c of coinFly) {
      if (c.t < 0) continue;
      const e = easeInOut(clamp(c.t / c.dur, 0, 1));
      const tx = L.coins.x + 23, ty = L.coins.y + L.coins.h / 2;
      drawCoinIcon(lerp(c.sx, tx, e), lerp(c.sy, ty, e) - Math.sin(e * Math.PI) * 60, 12);
    }
    for (const t of toasts) {
      const a = clamp(Math.min(t.t / 0.15, (2.2 - t.t) / 0.3), 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      setFont(18);
      const w = Math.min(LW - 40, ctx.measureText(t.msg).width + 40);
      const y = L.preview.y - 54;
      glass(LW / 2 - w / 2, y - 19, w, 38, 19, level.theme.accent, 0.85);
      text(fitText(t.msg, w - 30, 18), LW / 2, y + 1, 18, BONE);
      ctx.globalAlpha = 1;
    }
  }
  function fitText(s, maxW, size) {
    setFont(size);
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function drawSafeZone() {
    ctx.fillStyle = 'rgba(255,40,90,0.22)';
    ctx.fillRect(-offX, 0, VW, ST);
    ctx.fillRect(-offX, LH - SB, VW, SB);
    text('SNAP SAFE ZONE', LW / 2, ST - 14, 14, '#ff8aa8');
  }

  // ================================================================ update
  function update(dt) {
    time += dt;
    coinBump = Math.max(0, coinBump - dt * 4);
    jarBump = Math.max(0, jarBump - dt * 3);
    wheelSpin = Math.max(0, wheelSpin - dt * 2.2);
    hintPulse = Math.max(0, hintPulse - dt * 0.5);
    preview.t += dt;
    preview.shake = Math.max(0, preview.shake - dt * 2.5);
    if (preview.mode !== 'build' && preview.t > 0.7 && !dragging) preview.text = '';

    for (const c of level.cells.values()) {
      c.pop = Math.max(0, c.pop - dt * 3);
      c.flash = Math.max(0, c.flash - dt * 1.5);
      c.glow = Math.max(0, c.glow - dt * 0.8);
    }
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      f.t += dt;
      if (f.t >= f.dur) {
        f.cell.shown = true; f.cell.pop = 1;
        burst(cellX(f.cell.x), cellY(f.cell.y), level.theme.accent, 7);
        SFX.pop(f.idx);
        flyers.splice(i, 1);
      }
    }
    for (let i = coinFly.length - 1; i >= 0; i--) {
      const c = coinFly[i];
      c.t += dt;
      if (c.t >= c.dur) { S.coins += c.val; coinBump = 1; SFX.coin(); coinFly.splice(i, 1); if (!coinFly.length) writeSave(); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.conf) { p.rot += p.vr * dt; p.vx += Math.sin(time * 3 + p.y * 0.02) * 20 * dt; }
      if (p.life <= 0) parts.splice(i, 1);
    }
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].t += dt; if (toasts[i].t > 2.2) toasts.splice(i, 1); }

    // nudge toward the hint after a while with no progress
    if (winT < 0 && !dragging && level.n > 1 && time - lastProgress > 40 && hintPulse <= 0) { hintPulse = 1; lastProgress = time; }

    if (winT >= 0 && !flyers.length) {
      const before = winT;
      winT += dt;
      if (before < 0.35 && winT >= 0.35) { confetti(); SFX.win(); }
      if (winT >= 2.6) completeLevel();
    }
  }

  // ================================================================ frame
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const theme = level ? level.theme : THEMES[0];
    buildBackground(theme);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgCanvas, 0, 0);
    if (screen === 'play' && level) {
      update(dt);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offX * dpr * scale, 0);
      drawAmbient(dt);
      drawHud();
      drawGrid();
      drawWheel();
      drawSideButtons();
      drawPreview();
      drawTutorial();
      drawFx();
      drawWin();
      if (SHOW_SAFE) drawSafeZone();
    }
    requestAnimationFrame(frame);
  }

  // ================================================================ boot
  async function boot() {
    resize();
    const fontReady = (document.fonts && document.fonts.load)
      ? Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.load(`400 20px ${DISPLAY}`)]).catch(() => {})
      : Promise.resolve();
    let saved = null;
    if (snap) {
      let initErr = '';
      try { await snap.init(); } catch (e) { initErr = (e && e.message) || 'error'; console.warn('snapchat.init failed:', initErr); }
      lbSupported = snap.isSupported('leaderboards');
      // init() only reports leaderboards to Lenses set up with the leaderboard module in My Lenses
      if (!lbSupported) lbWhy = initErr === 'ERR_UNSUPPORTED_HOST' ? 'Update Snapchat to use the leaderboard' : 'Leaderboard is not turned on for this Lens';
      if (snap.isSupported('storage')) {
        try {
          const res = await snap.storage.get('save');
          saveLoaded = true;
          if (res.found) saved = res.value;
        } catch (e) { console.warn('No save:', e && e.message); }
      }
    }
    await fontReady;
    if (saved && saved.v === 1) S = Object.assign(freshSave(), saved);
    loadLevel(Math.max(1, S.level | 0));
    layout();
    screen = 'play';
    submitScore();   // puts the player on the board with their current progress
    if (DEBUG) {
      window.__ww = {
        get S() { return S; }, get level() { return level; }, get time() { return time; }, L, tones: TONE_LOG,
        solve() {
          for (const w of level.words) {
            if (w.found) continue;
            sel = [];
            for (const ch of w.w) sel.push(level.letters.findIndex((c, i) => c === ch && !sel.includes(i)));
            submitWord();
          }
        },
        play(word) {
          sel = [];
          for (const ch of word) sel.push(level.letters.findIndex((c, i) => c === ch && !sel.includes(i)));
          submitWord();
        },
        go(n) { startLevel(n); },
      };
    }
  }

  requestAnimationFrame(frame);
  boot();
})();
