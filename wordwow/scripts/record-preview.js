// Records marketing/preview.mp4: 8 s, 1080x1920, 30 fps, with sound.
// Serve the wordwow folder on :8123 first, then:
//   node scripts/record-preview.js <work dir>
// Time is virtual (requestAnimationFrame and performance.now are stepped by
// hand), so every frame is exact. Sounds are logged by the game's #debug
// hook and rebuilt by scripts/preview-audio.py.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

const FPS = 30, SECONDS = 8, W = 360, H = 640;
const LEVEL = 45;                       // LIGHT / FLIGHT / FIGHT / GIFT
const SETUP_WORDS = ['HIT', 'FIT'];     // already found when the video starts
const SWIPES = [['GIFT', 0.3], ['LIFT', 1.02], ['FIGHT', 1.74], ['LIGHT', 2.58], ['FLIGHT', 3.42]];
const MOVE = 0.12, HOLD = 0.06;         // seconds per letter hop, pause before letting go
const CARD_IN = 6.4;                    // end card fades in here

(async () => {
  const work = path.resolve(process.argv[2] || 'preview-work');
  fs.mkdirSync(path.join(work, 'frames'), { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  await p.addInitScript(() => {
    let T = 0, cbs = [];
    window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
    performance.now = () => T;
    window.__step = (ms) => { T += ms; const run = cbs; cbs = []; run.forEach((f) => f(T)); };
  });
  await p.goto('http://localhost:8123/index.html#debug#hires');
  for (let i = 0; i < 30; i++) { await p.evaluate(() => window.__step(33)); await p.waitForTimeout(20); }
  await p.evaluate(({ n, words }) => { __ww.go(n); __ww.S.coins = 240; words.forEach((w) => __ww.play(w)); }, { n: LEVEL, words: SETUP_WORDS });
  for (let i = 0; i < 60; i++) await p.evaluate(() => window.__step(33));

  // finger dot and end card, drawn as DOM on top of the canvas
  await p.evaluate(() => {
    const dot = document.createElement('div');
    dot.id = 'finger';
    dot.style.cssText = 'position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,0.55);border:3px solid rgba(255,255,255,0.95);box-shadow:0 3px 10px rgba(0,0,0,0.3);pointer-events:none;opacity:0;left:0;top:0';
    document.body.appendChild(dot);
    const card = document.createElement('div');
    card.id = 'card';
    card.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 38%,#6a2a72 0%,#2a0f52 45%,#0b0520 100%);opacity:0;pointer-events:none;font-family:Fredoka,sans-serif;font-weight:700';
    card.innerHTML = '<img src="marketing/icon.png" style="width:210px;height:210px;border-radius:44px;box-shadow:0 0 40px rgba(255,138,31,0.55),0 10px 30px rgba(0,0,0,0.5)">'
      + '<div style="font-family:Creepster,Fredoka,sans-serif;font-weight:400;font-size:66px;color:#ff8a1f;text-shadow:0 0 18px rgba(255,138,31,0.9),0 4px 0 #2b0a12;letter-spacing:2px">WORD WOW</div>'
      + '<div style="font-size:22px;color:#f7ead2;letter-spacing:1px">Swipe. Spell. Spook!</div>';
    document.body.appendChild(card);
  });
  await p.waitForTimeout(300);

  const conv = await p.evaluate(() => {
    const top = innerHeight * 0.1, s = Math.min(innerWidth / 540, (innerHeight - top * 2) / 820);
    return { s, offX: (innerWidth / s - 540) / 2 };
  });
  const spots = await p.evaluate(() => ({ letters: __ww.level.letters, spots: __ww.level.spots }));
  const at = (ch) => {
    const q = spots.spots[spots.letters.indexOf(ch)];
    return { x: (q.x + conv.offX) * conv.s, y: q.y * conv.s };
  };
  // pointer path: [time, x, y, down]
  const keys = [];
  for (const [word, t0] of SWIPES) {
    const pts = [...word].map(at);
    keys.push({ t: t0, ...pts[0], down: true, start: true });
    pts.slice(1).forEach((q, i) => keys.push({ t: t0 + (i + 1) * MOVE, ...q, down: true }));
    keys.push({ t: t0 + (pts.length - 1) * MOVE + HOLD, ...pts[pts.length - 1], down: false, end: true });
  }
  const pointerAt = (t) => {
    if (t <= keys[0].t) return { ...keys[0], vis: Math.min(1, t / 0.2) };
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], c = keys[i + 1];
      if (t >= a.t && t < c.t) {
        const f = (t - a.t) / (c.t - a.t), e = a.down ? f : f * f * (3 - 2 * f);
        return { x: a.x + (c.x - a.x) * e, y: a.y + (c.y - a.y) * e, vis: 1 };
      }
    }
    const last = keys[keys.length - 1];
    return { ...last, vis: Math.max(0, 1 - (t - last.t) / 0.3) };
  };

  const t0 = await p.evaluate(() => __ww.time);
  let isDown = false, next = 0;
  for (let f = 0; f < FPS * SECONDS; f++) {
    const t = f / FPS;
    // fire pointer events for every key passed since the last frame
    while (next < keys.length && keys[next].t <= t) {
      const k = keys[next++];
      await p.mouse.move(k.x, k.y);
      if (k.start) { await p.mouse.down(); isDown = true; }
      if (k.end) { await p.mouse.up(); isDown = false; }
    }
    const ptr = pointerAt(t);
    if (isDown) await p.mouse.move(ptr.x, ptr.y);
    const card = Math.min(1, Math.max(0, (t - CARD_IN) / 0.4));
    await p.evaluate(({ ptr, isDown, card }) => {
      const d = document.getElementById('finger');
      d.style.left = ptr.x + 'px'; d.style.top = ptr.y + 'px';
      d.style.opacity = String(ptr.vis * (1 - card));
      d.style.transform = isDown ? 'scale(0.85)' : 'scale(1)';
      const c = document.getElementById('card');
      c.style.opacity = String(card);
      c.firstChild.style.transform = `scale(${0.8 + 0.2 * Math.min(1, card * 1.2)})`;
      window.__step(1000 / 30);
    }, { ptr, isDown, card });
    await p.screenshot({ path: path.join(work, 'frames', `f${String(f).padStart(4, '0')}.png`) });
  }
  const tones = await p.evaluate((t0) => __ww.tones.filter((x) => x[0] >= t0 - 0.01).map((x) => [x[0] - t0, ...x.slice(1)]), t0);
  fs.writeFileSync(path.join(work, 'tones.json'), JSON.stringify({ tones, card: CARD_IN, seconds: SECONDS }));
  await b.close();
  console.log('frames + tones written to', work, tones.length, 'sounds');
})();
