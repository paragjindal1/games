# Starforge

A merge-and-defend space game built as a **Snapchat Web Lens**.

Alien fleets dive down five lanes toward your base. Build laser turrets,
merge matching ones into stronger weapons, tap aliens to zap them yourself,
and keep the shield up for as long as you can.

## How to play

| Action | Control |
|---|---|
| Build a turret | **Hold** the Fabricator (bottom left), or hold **Space** |
| Merge | Drag a turret onto another turret of the same tier |
| Move / swap | Drag a turret to another pad or hangar slot |
| Zap an alien | Tap it (hold to keep zapping) |
| Turret info | Tap a turret |
| Sell | Drag a turret onto **SELL** |
| Start the wave early | **GO NOW** during the countdown (+5 credits) |
| Speed up | **2X** button in the top bar (tap again for 1X) |
| Pause | Pause button, `Esc` or `P` |

### Tutorial

The first game is the tutorial: no screens to read, players learn by
playing. A hand pointer and a spotlight show each step:

1. Build a turret
2. Build a second one
3. Drag one onto the other to merge
4. Zap aliens in wave 1
5. Open the shop

The first wave only starts after the first merge. **SKIP** ends the guide at
any point.

Only the five pads behind the shield fire. Turrets of tier 1–3 cover their
own lane, tiers 4–6 also cover the two neighbouring lanes, and tier 7+ can hit
any lane. The hangar is storage.

### Turrets (10 tiers)

Blaster → Twin Blaster → Pulse Cannon → Rail Gun (pierces the lane) →
Missile Pod (homing, splash) → Plasma Cannon (splash) → Cryo Ray (slows) →
Tesla Coil (chains to 5 targets) → Ion Laser (continuous beam) →
Nova Cannon (huge blast)

### Aliens

| Alien | First wave | Trait |
|---|---|---|
| Scout | 1 | Basic |
| Speeder | 2 | Fast, switches lanes |
| Juggernaut | 3 | Armor shrugs off weak hits |
| Splitter | 4 | Breaks into two shards |
| Warden | 6 | Energy shield bubble |
| Gunship | 7 | Parks mid-field and shoots the shield |
| Mothership | every 5th | Boss: launches scouts and fires on the shield |

From wave 10, glowing **elite** aliens have double health.

A run ends when the shield breaks. Your score goes to the Snapchat
leaderboard.

### Armory (shop)

Deploy Turret, Repair Shield, Fast Fabricator, Overcharge (+damage),
Quantum Forge (chance to build tier 2), Shield Capacity. Upgrades last for
the current run.

## Web Lens requirements covered

- `index.html` at the root of the zip, and every path is relative
- Self-contained: no network requests. All art is drawn on a canvas, all
  sound and music are synthesised with Web Audio, and the two fonts (Russo One
  and Rajdhani, SIL OFL) ship in `fonts/`. The zip is about 63 KB.
- No camera, microphone or motion sensors
- The Web Lens API (`@snap/web-lens-api` v0.1.2, `snap-api.js`) ships inside
  the zip and loads before `game.js`. The game calls `snapchat.init()` once
  behind the loading screen and checks every capability with
  `isSupported()`, so it still works without them.
- **Storage**: best score, settings, the tutorial step and the current run
  are saved through `snapchat.storage` (key `save`). Nothing is written before
  the first read answers, and writes are chained so only one is in flight. A
  save happens at each wave clear and when the Lens is hidden. If the Lens is
  swiped away mid-wave, **Continue** resumes from the start of that wave.
- **Leaderboards**: the final score of each run is submitted as an integer.
  The **LEADERBOARD** buttons open Snapchat's panel; they only appear when the
  capability is supported.
- **Safe zone**: all UI stays inside `CFG.SAFE_TOP` / `CFG.SAFE_BOTTOM`
  (10% of the screen height each by default, or the device's safe-area
  insets if larger), set at the top of `game.js`. The background still fills
  the whole screen. Add `#safe` to the URL to draw the zone while testing.
- Portrait layout that stretches to tall phones and centres on wide screens.
  Touch, mouse and keyboard all work. Audio starts on the first tap. Music and
  sound effects can be switched off separately, and the game pauses when the
  app goes to the background.

## Upload to Snapchat

Everything you need is in this folder:

| File | What it is |
|---|---|
| `release/starforge.zip` | The Lens. `index.html` is at the zip root. Upload this. |
| `marketing/icon.png` | Lens icon, 1024×1024 (`icon-512.png` is 512×512) |
| `marketing/preview.mp4` | Preview video: 8 s, 1080×1920, 30 fps, H.264 + AAC sound, ends on the logo |
| `marketing/logo.png` | Transparent wordmark logo, 1600×700 |

1. In **My Lenses**, create a Web Lens and upload `release/starforge.zip`.
2. Add `marketing/icon.png` as the Lens icon and `marketing/preview.mp4` as the
   preview video.
3. **Turn on the leaderboard for the Lens.** The Web Lens API only reports
   `leaderboards` to Lenses configured with the leaderboard module. Without
   it, the game hides its LEADERBOARD buttons and still plays normally.

### Leaderboard check

The game calls `snapchat.init()`, checks `isSupported('leaderboards')`,
submits the final score of each run with `leaderboards.submitScore({ score })`
(an integer, higher is better), and opens Snapchat's panel with
`leaderboards.show()`.

Tested in a browser against the API's desktop stub: `submitScore` resolves
(`{"bestScore":1234}`) and `show()` resolves. The stub has no panel to show,
so the game displays "Score sent · the leaderboard opens inside Snapchat"
there. If `show()` fails inside Snapchat, the game shows "Leaderboard
unavailable right now". The real panel can only be tested on a phone after
upload.

## Build and upload

```sh
./scripts/build-zip.sh        # rebuilds release/starforge.zip
```

For local testing, serve the folder with any static server (fonts need
`http://`), or open `index.html` directly. Outside Snapchat the API uses its
desktop stub, so saves only last until you reload. `#debug` exposes a
`window.__sf` test hook, and `#hires` renders sprites at high resolution
for marketing images.
