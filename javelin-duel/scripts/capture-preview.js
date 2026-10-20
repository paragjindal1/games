// Records marketing/preview.mp4 frames: a scripted 8 s fight plus the title card.
// Usage (from javelin-duel/, with `python3 -m http.server 8765` running):
//   node scripts/capture-preview.js <frames-dir> [seed]
//   ffmpeg -framerate 30 -i <frames-dir>/f%03d.jpg -i <frames-dir>/audio.wav \
//     -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k \
//     -af afade=t=out:st=7.6:d=0.4 -t 8 -movflags +faststart marketing/preview.mp4
// Frames are stepped by hand (#debug-capture) and the sound effects are rendered
// with an OfflineAudioContext, so picture and sound stay in sync.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2], seed = +(process.argv[3] || 7), shots = process.argv[4] === 'all';
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript((seed) => {
    let s = seed;
    Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, seed);
  await p.goto('http://localhost:8765/index.html#debug-capture');
  await p.waitForFunction(() => window.__jd && __jd.screen === 'title');
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    __jd.offlineAudio(8.2);
    window.shootAt = (tx, ty, ang) => {
      const G = __jd.G, P = G.player; P.reload = 0; P.state = 'idle';
      const h = __jd.handWorld(P), c = Math.cos(ang), s = Math.sin(ang), g = P.rage >= 100 ? 0.55 : 1;
      const lx = h.x + c * 78 * 0.55, ly = h.y - s * 78 * 0.55;
      let lo = 220, hi = 880;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; const y = __jd.heightAt(lx, ly, c * m, -s * m, tx, g); if (y === null || y > ty) lo = m; else hi = m; }
      __jd.playerThrow(ang, Math.min(1, ((lo + hi) / 2 - 220) / 660));
    };
    window.aimPose = (ang, pow) => { const P = __jd.G.player; P.state = 'aim'; P.aimAng = ang; P.aimPow = pow; };
  });
  const N = 240, dt = 1 / 30;
  const log = [];
  for (let f = 0; f < N; f++) {
    const ev = await p.evaluate((f) => {
      const G = __jd.G;
      const Z = () => __jd.zones(G.enemy);
      if (f === 0) {
        __jd.newGame(); const G2 = __jd.G;
        G2.tut = false; G2.throws = 3; G2.kills = 15;
        G2.enemy.hp = G2.enemy.maxHp = G2.enemy.hpLag = 150; G2.enemy.cool = 0.9;
        __jd.spawnOrb(); G2.orb.type = 'fire'; G2.orb.x = 265; G2.orb.y = Math.min(__jd.feetY(G2.player), __jd.feetY(G2.enemy)) - 120;
        G2.orbT = 99; G2.hint = null;
      }
      const g = __jd.G;
      // short visible wind-ups before each throw
      if (f >= 4 && f < 12) aimPose(0.45, (f - 4) / 8 * 0.6);
      if (f === 12) shootAt(g.orb.x, g.orb.y, 0.45);
      if (f >= 32 && f < 40) aimPose(0.6, (f - 32) / 8 * 0.75);
      if (f === 40) { const z = Z(); shootAt((z.neck.x + z.hip.x) / 2, (z.neck.y + z.hip.y) / 2, 0.6); }
      if (f >= 62 && f < 70) aimPose(0.5, (f - 62) / 8 * 0.7);
      if (f === 70) { const z = Z(); shootAt((z.neck.x + z.hip.x) / 2, (z.neck.y + z.hip.y) / 2 + 4, 0.5); }
      if (f === 90) { g.enemy.cool = 99; }
      if (f === 86) { g.player.rage = 99; }
      if (f === 87) { g.player.rage = 100; g.player.rageFlash = 1.2; }
      if (f >= 92 && f < 104) aimPose(0.35, (f - 92) / 12 * 0.9);
      if (f === 104) { const z = Z(); shootAt(z.head.x, z.head.y, 0.35); }
      if (f === 166) { __jd.uiAction('home'); }
      __jd.frame(1 / 30);
      const G3 = __jd.G;
      return { f, scr: __jd.screen, ehp: Math.round(G3.enemy.hp), php: Math.round(G3.player.hp), heads: (G3.heads || []).length, orb: G3.orb && G3.orb.pop ? 'popped' : !!G3.orb, pw: G3.player.power && G3.player.power.type, combo: G3.combo, score: G3.score };
    }, f);
    if (f % 10 === 0 || f === 105) log.push(ev);
    await p.screenshot({ path: `${out}/f${String(f).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 93 });
  }
  console.log(log.map(e => JSON.stringify(e)).join('\n'));
  const wav = await p.evaluate(() => __jd.renderWav());
  fs.writeFileSync(out + '/audio.wav', Buffer.from(wav, 'base64'));
  console.log('errs', errs);
  await b.close();
})();
