// Records marketing/preview.mp4 frames: a scripted 8 s run plus the win card.
// Usage (from bridge-war/, with `python3 -m http.server 8766` running):
//   node scripts/capture-preview.js <frames-dir> [seed]
//   ffmpeg -framerate 30 -i <frames-dir>/f%03d.jpg -i <frames-dir>/audio.wav \
//     -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k \
//     -af afade=t=out:st=7.6:d=0.4 -t 8 -movflags +faststart marketing/preview.mp4
// Frames are stepped by hand (#debug-capture) and the sound effects are rendered
// with an OfflineAudioContext, so picture and sound stay in sync. Stretches the
// video skips over are simulated silently.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2], seed = +(process.argv[3] || 7);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((seed) => {
    let s = seed;
    Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, seed);
  await p.goto('http://localhost:8766/index.html#debug-capture');
  await p.waitForFunction(() => window.__bw && __bw.screen === 'menu');
  await p.evaluate(() => {
    __bw.offlineAudio(8.2);
    const S = __bw.S(); S.level = 3; S.up = { rate: 3, dmg: 3, rev: 1, squad: 3 }; S.coins = 0; __bw.toMenu(); __bw.startRun();
    // autopilot: dodge tires, take the best gate, and head for a wanted gate when told
    window.pilot = (want) => {
      const G = __bw.G; let tx = G.tx;
      const act = G.active.filter((e) => !e.dead && e.z - G.dist > 0.2);
      const R = __bw.squadR(G.n) * 3;
      const tire = act.find((e) => e.kind === 'tire' && !e.hitSquad && e.z - G.dist < 26 && Math.abs(e.x * 3 - G.x * 3) < R + 0.75);
      const gate = act.find((e) => e.kind === 'gate' && !e.used);
      const val = (s) => { const g = s.op === '?' ? { op: 'add', v: 0 } : s; return g.op === 'add' ? G.n + g.v : g.op === 'mul' ? Math.min(150, G.n * g.v) : Math.ceil(G.n / g.v); };
      if (tire) tx = tire.x > 0.1 ? tire.x - 0.75 : tire.x < -0.1 ? tire.x + 0.75 : 0.75;
      else if (gate) {
        const best = want && gate === want.gate ? want.seg : gate.segs.reduce((a, s) => (val(s) > val(a) ? s : a));
        tx = (best.x1 + best.x2) / 2;
      }
      G.tx += Math.max(-0.06, Math.min(0.06, tx - G.tx));
    };
    // silent fast-forward
    window.skip = (until) => { const S = __bw.S(), m = S.muted; S.muted = true; for (let i = 0; i < 9000 && !until(); i++) { pilot(window.want); __bw.step(1 / 30); } S.muted = m; };
  });
  // 1) fast-forward to 2.6 s before a x2 gate with the squad built up
  await p.evaluate(() => {
    const G = __bw.G;
    const gate = G.ents.find((e) => e.kind === 'gate' && e.z > 140 && e.segs.some((s) => s.op === 'mul'));
    window.want = gate ? { gate, seg: gate.segs.find((s) => s.op === 'mul') } : null;
    const target = gate ? gate.z - 9.5 * 2.6 : 180;
    skip(() => G.dist >= target);
  });
  const N = 240, dt = 1 / 30;
  for (let f = 0; f < N; f++) {
    const st = await p.evaluate(([f]) => {
      const G = __bw.G;
      // 2) at 4 s cut to the boss fight, already underway
      if (f === 120) {
        // the boss can't die during the fast-forward
        G.boss.hp = 1e12;
        skip(() => G.wall && G.boss.z - G.dist < 22);
        G.boss.hp = G.boss.max * 0.3;
        if (G.n < 60) G.n = 90;
      }
      // 3) make sure he goes down around 5.2 s, leaving time for the win card
      if (f === 156 && !G.boss.dead) G.boss.hp = 1;
      pilot(window.want);
      __bw.frame(1 / 30);
      return { scr: __bw.screen, n: G.n, boss: Math.round(G.boss.hp), wall: G.wall };
    }, [f]);
    if (f % 30 === 0) console.log(f, JSON.stringify(st));
    await p.screenshot({ path: `${out}/f${String(f).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
  const wav = await p.evaluate(() => __bw.renderWav());
  fs.writeFileSync(out + '/audio.wav', Buffer.from(wav, 'base64'));
  console.log('errors', errs);
  await b.close();
})();
