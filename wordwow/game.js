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
  const FONT = 'Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
  const INK = '#1d2b5a';

  // ================================================================ utils
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const inRect = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
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
  // A new scene every 8 levels, like travelling between places.
  const THEMES = [
    { name: 'Green Valley', sky: ['#2f66b8', '#7fb4e6', '#d9ecf6'], hills: ['#9cc98a', '#5f9e4f', '#3f7d3a', '#2c5e2b'], mist: '#eef6f8', accent: '#2f6fd6', sun: '#fff6cf' },
    { name: 'Sunset Bay', sky: ['#3a2d6e', '#c4587a', '#f7b46a'], hills: ['#c98a8f', '#8f5a7f', '#5c3a63', '#36244a'], mist: '#ffd9c2', accent: '#e0584d', sun: '#ffe2a8' },
    { name: 'Golden Dunes', sky: ['#2a83c2', '#7cc2e8', '#f5e6bd'], hills: ['#f0cf8a', '#dba35a', '#c27c3b', '#9c5a2b'], mist: '#fbf0d6', accent: '#d9772b', sun: '#fffbe6' },
    { name: 'Ice Fjord', sky: ['#456fb0', '#a4c9e8', '#f0f7fc'], hills: ['#e6f1f8', '#c3dbee', '#94b8d8', '#6a92bd'], mist: '#f4f9fc', accent: '#2a86c8', sun: '#ffffff' },
    { name: 'Starry Lake', sky: ['#0b1238', '#1f3474', '#4a64a3'], hills: ['#2c4f6b', '#1d3a4a', '#142c3a', '#0b1c26'], mist: '#6f87b8', accent: '#7a5cff', sun: '#f3f1ff', night: true },
    { name: 'Misty Forest', sky: ['#2a6a76', '#79bdb1', '#e3f1db'], hills: ['#8fbf8c', '#4f8f5c', '#2f6a42', '#1c4a2c'], mist: '#eaf4e6', accent: '#2e9d6a', sun: '#fbffe8' },
    { name: 'Cherry Hills', sky: ['#5a6fc2', '#c7a8e0', '#fbe1ea'], hills: ['#f2b8c9', '#d68aa5', '#a6627f', '#6f3f5c'], mist: '#fdeef3', accent: '#d2487c', sun: '#fff5f8' },
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
  let lbSupported = false;

  function writeSave() {
    if (!saveLoaded || !snap) return;
    const state = JSON.parse(JSON.stringify(S));
    savePending = savePending
      .then(() => snap.storage.set('save', state))
      .then(() => true, (e) => { console.warn('Save failed:', e && e.message); return false; });
  }
  function submitScore() {
    const done = S.level - 1;
    if (!lbSupported || done <= 0) return Promise.resolve();
    return snap.leaderboards.submitScore({ score: done })
      .catch((e) => console.warn('Leaderboard submit failed:', e && e.message));
  }
  async function showLeaderboard() {
    if (!lbSupported) return;
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
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
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
    win() { [0, 2, 4, 5, 7].forEach((k, i) => tone(SCALE[k] / 2 * 2, 0.4, 'triangle', 0.15, i * 0.1)); tone(SCALE[7], 0.8, 'sine', 0.12, 0.55); },
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
    const cols = ['#ff5a7a', '#ffd23f', '#4dd6ff', '#7cff8a', '#b78cff', '#ffffff'];
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
    if (lbSupported && inCircle(p, L.board, 8)) { SFX.tap(); showLeaderboard(); return; }
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
  function setFont(size) { ctx.font = `700 ${size}px ${FONT}`; }
  function text(str, x, y, size, col = '#fff', align = 'center', o = {}) {
    setFont(size);
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (o.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.sw || Math.max(3, size / 5);
      ctx.strokeStyle = o.stroke;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = col;
    ctx.fillText(str, x, y + (o.dy || 0));
  }
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

  // ================================================================ background
  let bgCanvas = null, bgKey = '';
  function buildBackground(theme) {
    const key = theme.name + canvas.width + 'x' + canvas.height;
    if (key === bgKey) return;
    bgKey = key;
    const W = canvas.width, H = canvas.height;
    bgCanvas = bgCanvas || document.createElement('canvas');
    bgCanvas.width = W; bgCanvas.height = H;
    const g = bgCanvas.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H * 0.72);
    sky.addColorStop(0, theme.sky[0]); sky.addColorStop(0.55, theme.sky[1]); sky.addColorStop(1, theme.sky[2]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const rnd = seeded(theme.name.length * 977 + 13);
    const u = H / 1000;
    if (theme.night) {
      for (let i = 0; i < 160; i++) {
        g.globalAlpha = 0.3 + rnd() * 0.7;
        g.fillStyle = '#ffffff';
        g.fillRect(rnd() * W, rnd() * H * 0.55, 1 + rnd() * 2 * dpr, 1 + rnd() * 2 * dpr);
      }
      g.globalAlpha = 1;
    }
    // sun / moon glow
    const sx = W * 0.72, sy = H * 0.36;
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.35);
    glow.addColorStop(0, rgba(theme.sun, 0.85));
    glow.addColorStop(0.15, rgba(theme.sun, 0.45));
    glow.addColorStop(1, rgba(theme.sun, 0));
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.fillStyle = theme.sun; g.beginPath(); g.arc(sx, sy, 34 * u, 0, Math.PI * 2); g.fill();
    // clouds
    if (!theme.night) {
      for (let i = 0; i < 6; i++) {
        const cx = rnd() * W, cy = H * (0.08 + rnd() * 0.3), s = (40 + rnd() * 60) * u;
        g.fillStyle = 'rgba(255,255,255,' + (0.35 + rnd() * 0.35) + ')';
        for (let j = 0; j < 5; j++) {
          g.beginPath();
          g.ellipse(cx + (j - 2) * s * 0.7, cy + Math.sin(j * 1.7) * s * 0.18, s * (0.6 + rnd() * 0.4), s * 0.42, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // rolling hills, far to near
    const bases = [0.5, 0.58, 0.68, 0.8];
    theme.hills.forEach((col, li) => {
      const base = H * bases[li], amp = H * (0.035 + li * 0.012);
      const f1 = 1.5 + rnd() * 2, f2 = 3 + rnd() * 3, p1 = rnd() * 6, p2 = rnd() * 6;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 4) {
        const t = x / W;
        g.lineTo(x, base - Math.sin(t * f1 + p1) * amp - Math.sin(t * f2 + p2) * amp * 0.45);
      }
      g.lineTo(W, H); g.closePath();
      const hg = g.createLinearGradient(0, base - amp * 2, 0, H);
      hg.addColorStop(0, shade(col, 0.12)); hg.addColorStop(1, shade(col, -0.25));
      g.fillStyle = hg; g.fill();
      // mist between layers
      const mg = g.createLinearGradient(0, base - amp, 0, base + amp * 2.5);
      mg.addColorStop(0, rgba(theme.mist, 0));
      mg.addColorStop(1, rgba(theme.mist, 0.28 - li * 0.05));
      g.fillStyle = mg; g.fillRect(0, base - amp, W, amp * 3.5);
    });
    // soft shade behind the wheel so it reads on any scene
    const vg = g.createLinearGradient(0, H * 0.55, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = vg; g.fillRect(0, H * 0.55, W, H * 0.45);
  }

  // ================================================================ draw: HUD
  function drawCoinIcon(x, y, r) {
    circle(x, y, r); ctx.fillStyle = '#e8a317'; ctx.fill();
    circle(x, y, r * 0.78); ctx.fillStyle = '#ffd23f'; ctx.fill();
    text('$', x, y + 1, r * 1.1, '#e8a317');
  }
  function drawHud() {
    const t = level.theme;
    // coins
    const c = L.coins, bump = 1 + coinBump * 0.12;
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2); ctx.scale(bump, bump); ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
    rrect(c.x, c.y, c.w, c.h, c.h / 2); ctx.fillStyle = 'rgba(20,30,70,0.45)'; ctx.fill();
    drawCoinIcon(c.x + 23, c.y + c.h / 2, 16);
    text(String(S.coins), c.x + 46, c.y + c.h / 2 + 1, 24, '#fff', 'left');
    ctx.restore();
    // level label
    text('LEVEL ' + S.level, L.title.x, L.title.y - 6, 26, '#fff', 'center', { stroke: 'rgba(29,43,90,0.55)', sw: 6 });
    text(t.name.toUpperCase(), L.title.x, L.title.y + 19, 13, 'rgba(255,255,255,0.9)', 'center', { stroke: 'rgba(29,43,90,0.45)', sw: 4 });
    // sound
    roundButton(L.sound, null);
    drawSpeaker(L.sound.x, L.sound.y, S.muted);
    if (lbSupported) { roundButton(L.board, null); drawTrophy(L.board.x, L.board.y); }
  }
  function roundButton(b, fill, scaleK = 1) {
    ctx.save();
    ctx.translate(b.x, b.y); ctx.scale(scaleK, scaleK);
    circle(0, 3, b.r); ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill();
    circle(0, 0, b.r); ctx.fillStyle = fill || 'rgba(20,30,70,0.45)'; ctx.fill();
    ctx.restore();
  }
  function drawSpeaker(x, y, muted) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(-11, -5); ctx.lineTo(-5, -5); ctx.lineTo(2, -11); ctx.lineTo(2, 11); ctx.lineTo(-5, 5); ctx.lineTo(-11, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
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
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(9, -10); ctx.lineTo(7, 0); ctx.quadraticCurveTo(0, 6, -7, 0); ctx.closePath(); ctx.fill();
    ctx.fillRect(-2, 2, 4, 6); ctx.fillRect(-7, 8, 14, 3);
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(-9, -5, 4, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(9, -5, 4, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.restore();
  }

  // ================================================================ draw: grid
  function drawGrid() {
    const s = level.tile, pad = Math.max(2, s * 0.06), r = s * 0.16;
    const accent = level.theme.accent;
    const emptyTile = hexMix('#ffffff', accent, 0.2);
    for (const c of level.cells.values()) {
      const x = level.gx + c.x * s + pad, y = level.gy + c.y * s + pad, w = s - pad * 2;
      const k = 1 + (c.pop > 0 ? Math.sin(c.pop * Math.PI) * 0.18 : 0) + c.flash * 0.08 * Math.sin(time * 30);
      ctx.save();
      ctx.translate(x + w / 2, y + w / 2); ctx.scale(k, k); ctx.translate(-(x + w / 2), -(y + w / 2));
      rrect(x, y + 3, w, w, r); ctx.fillStyle = 'rgba(20,30,70,0.22)'; ctx.fill();
      if (c.shown) {
        rrect(x, y, w, w, r);
        ctx.fillStyle = c.glow > 0 ? mixHex('#ffffff', accent, c.glow * 0.6) : '#ffffff';
        ctx.fill();
        if (c.flash > 0) { rrect(x, y, w, w, r); ctx.fillStyle = rgba(accent, c.flash * 0.45); ctx.fill(); }
        text(c.ch, x + w / 2, y + w / 2 + s * 0.03, s * 0.62, INK);
      } else {
        rrect(x, y, w, w, r); ctx.fillStyle = rgba(emptyTile, 0.8); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; rrect(x + 1, y + 1, w - 2, w - 2, r); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function hexMix(a, b, t) {
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(lerp((na >> sh) & 255, (nb >> sh) & 255, t)).toString(16).padStart(2, '0');
    return '#' + ch(16) + ch(8) + ch(0);
  }
  function mixHex(a, b, t) {
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const r = lerp(na >> 16, nb >> 16, t), g = lerp((na >> 8) & 255, (nb >> 8) & 255, t), bl = lerp(na & 255, nb & 255, t);
    return `rgb(${r | 0},${g | 0},${bl | 0})`;
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
    const col = { build: accent, good: '#2fb36a', bonus: '#f0a91a', same: '#8f9bb8', bad: '#e0485a' }[preview.mode] || accent;
    const size = 30, w = Math.max(56, preview.text.length * size * 0.78 + 30), h = 50;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(L.preview.x + dx, L.preview.y); ctx.scale(k, k);
    rrect(-w / 2, -h / 2 + 3, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
    rrect(-w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = col; ctx.fill();
    text(preview.text, 0, 2, size, '#fff');
    ctx.restore();
  }

  function drawWheel() {
    const w = L.wheel, accent = level.theme.accent;
    // plate
    circle(w.x, w.y + 5, w.r); ctx.fillStyle = 'rgba(10,20,60,0.18)'; ctx.fill();
    circle(w.x, w.y, w.r); ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    // connecting line
    if (sel.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(9, level.bubble * 0.36);
      ctx.strokeStyle = rgba(accent, 0.9);
      ctx.beginPath();
      sel.forEach((i, n) => { const p = level.spots[i]; if (n) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      if (dragging) ctx.lineTo(pointer.x, pointer.y);
      ctx.stroke();
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
      const r = level.bubble * (on ? 1.06 : 1);
      if (on) { circle(x, y, r); ctx.fillStyle = accent; ctx.fill(); }
      text(ch, x, y + r * 0.06, r * 1.25, on ? '#fff' : INK);
    });
  }

  function drawSideButtons() {
    const accent = level.theme.accent;
    // shuffle
    roundButton(L.shuffle, 'rgba(255,255,255,0.88)');
    drawShuffleIcon(L.shuffle.x, L.shuffle.y, accent);
    // hint (lightbulb + cost)
    const hp = 1 + Math.max(0, Math.sin(hintPulse * Math.PI * 4)) * 0.08 * (hintPulse > 0 ? 1 : 0);
    roundButton(L.hint, 'rgba(255,255,255,0.88)', hp);
    drawBulb(L.hint.x, L.hint.y - 4, accent);
    rrect(L.hint.x - 24, L.hint.y + 18, 48, 22, 11); ctx.fillStyle = '#ffd23f'; ctx.fill();
    text(String(CFG.HINT_COST), L.hint.x, L.hint.y + 30, 15, '#7a4a00');
    // bonus jar with progress ring
    const jb = 1 + jarBump * 0.15;
    roundButton(L.jar, 'rgba(255,255,255,0.88)', jb);
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(L.jar.x, L.jar.y, L.jar.r - 3, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(29,43,90,0.12)'; ctx.stroke();
    if (S.jar > 0) {
      ctx.beginPath(); ctx.arc(L.jar.x, L.jar.y, L.jar.r - 3, -Math.PI / 2, -Math.PI / 2 + (S.jar / CFG.JAR_SIZE) * Math.PI * 2);
      ctx.strokeStyle = '#f0a91a'; ctx.stroke();
    }
    drawStar(L.jar.x, L.jar.y, 13 * jb, '#f0a91a');
  }
  function drawShuffleIcon(x, y, col) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      ctx.beginPath(); ctx.arc(0, 0, 13, s > 0 ? -2.6 : 0.55, s > 0 ? -0.2 : 2.95); ctx.stroke();
      const a = s > 0 ? -0.2 : 2.95, ex = Math.cos(a) * 13, ey = Math.sin(a) * 13;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(ex + 6 * s, ey - 1 * s); ctx.lineTo(ex - 5 * s, ey - 4 * s); ctx.lineTo(ex - 1 * s, ey + 7 * s); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawBulb(x, y, col) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#ffd23f';
    circle(0, -2, 10); ctx.fill();
    ctx.fillRect(-5, 5, 10, 5);
    ctx.fillStyle = col; ctx.fillRect(-5, 10, 10, 3);
    ctx.restore();
  }
  function drawStar(x, y, r, col) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
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
    ctx.globalAlpha = 0.5 * fade;
    ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = level.theme.accent;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i <= seg; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.lineTo(hx, hy); ctx.stroke();
    ctx.globalAlpha = fade;
    drawHand(hx + 6, hy + 10);
    ctx.restore();
    const pulse = 0.85 + Math.sin(time * 4) * 0.15;
    ctx.globalAlpha = pulse;
    text('Swipe the letters to make words!', LW / 2, L.preview.y, 22, '#fff', 'center', { stroke: 'rgba(29,43,90,0.6)', sw: 6 });
    ctx.globalAlpha = 1;
  }
  function drawHand(x, y) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath();
    rrect(-7, -6, 14, 30, 7); ctx.fill(); ctx.stroke();
    rrect(-8, 14, 30, 30, 10); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawWin() {
    if (winT < 0.35) return;
    const t = clamp((winT - 0.35) / 0.4, 0, 1);
    const k = easeOutBack(t);
    ctx.save();
    ctx.globalAlpha = clamp(t * 2, 0, 1);
    ctx.fillStyle = 'rgba(10,20,60,0.25)';
    ctx.fillRect(-offX, 0, VW, LH);
    const cy = (L.grid.y + L.grid.y + L.grid.h) / 2;
    ctx.translate(LW / 2, cy); ctx.scale(k, k);
    const words = ['GREAT!', 'AWESOME!', 'BRILLIANT!', 'SPLENDID!', 'FANTASTIC!', 'WOW!', 'AMAZING!'];
    const msg = words[(S.level - 1) % words.length];
    rrect(-200, -74, 400, 148, 30); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
    text(msg, 0, -22, 50, level.theme.accent);
    text('Level ' + S.level + ' complete', 0, 26, 22, INK);
    drawCoinIcon(-44, 54, 11);
    text('+' + CFG.LEVEL_COINS, -26, 55, 18, '#c68400', 'left');
    if (winT > 1.1) text('tap to continue', 40, 55, 14, 'rgba(29,43,90,0.55)');
    ctx.restore();
  }

  function drawFx() {
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = p.col;
      if (p.conf) {
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
      const size = lerp(30, level.tile * 0.62, e);
      text(f.ch, x, y, size, '#fff', 'center', { stroke: level.theme.accent, sw: 6 });
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
      const w = Math.min(LW - 40, ctx.measureText(t.msg).width + 36);
      const y = L.preview.y - 52;
      rrect(LW / 2 - w / 2, y - 18, w, 36, 18); ctx.fillStyle = 'rgba(20,30,70,0.78)'; ctx.fill();
      text(fitText(t.msg, w - 30, 18), LW / 2, y + 1, 18, '#fff');
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
    ctx.fillStyle = 'rgba(255,40,90,0.18)';
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
        burst(cellX(f.cell.x), cellY(f.cell.y), '#ffffff', 6);
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
      ? document.fonts.load(`700 20px ${FONT}`).catch(() => {})
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
    await fontReady;
    if (saved && saved.v === 1) S = Object.assign(freshSave(), saved);
    loadLevel(Math.max(1, S.level | 0));
    layout();
    screen = 'play';
    if (DEBUG) {
      window.__ww = {
        get S() { return S; }, get level() { return level; }, L,
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
