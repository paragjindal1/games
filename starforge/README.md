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
| Pause | Pause button, `Esc` or `P` |

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

## Build and upload

```sh
./scripts/build-zip.sh        # -> dist/starforge.zip
```

Upload `dist/starforge.zip` to **My Lenses** with a Lens icon and a preview
video.

For local testing, serve the folder with any static server (fonts need
`http://`), or open `index.html` directly. Outside Snapchat the API uses its
desktop stub, so saves only last until you reload. `#debug` exposes a
`window.__sf` test hook.
