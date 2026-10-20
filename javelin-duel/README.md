# Javelin Duel

A tower-to-tower javelin fight built as a **Snapchat Web Lens**.

You stand on a castle tower and a rival stands on another. Drag back to aim,
release to throw, and knock them off before they knock you off. Every win
brings a new, sharper rival on a new tower.

## How to play

| Action | Control |
|---|---|
| Aim and throw | **Drag back** anywhere on the screen and release. The farther you pull, the harder you throw. |
| Power-ups | Hit a floating **orb** with a javelin |
| Pause | Pause button, `Esc` or `P` |
| Start / retry | Tap, or `Space` / `Enter` |
| Change skin | Arrows on the title screen (or ←/→) |

- A power meter (green → red) and a short dotted arc show your throw while you aim.
- **Head** hits do 70 damage, **body** 38 and **legs** 24. Everyone has 100 health.
- Javelins that meet in mid-air **clash** and fall harmlessly.
- Every K.O. plays in **slow motion**, and the next rival rises on a new tower.
  You get 15 health back between rounds.

### Twists

| Twist | What it does |
|---|---|
| **Heal orb** | +35 health. The enemy can grab it too. |
| **Fire orb** | Next 2 throws do 1.5× damage and set the rival on fire |
| **Ice orb** | Next throw freezes the rival for 2.6 s, so they can't throw |
| **Triple orb** | Next throw fires 3 javelins in a spread |
| **Shield orb** | A bubble blocks the next javelin that would hit you |
| **Wind** (round 3+) | Pushes every javelin sideways. Streaks and a HUD chip show its direction. |
| **Moving tower** (round 4+) | The rival's tower rides up and down |
| **Champion** (every 5th round) | Horned Warlord with 150 health who hits harder |

If the enemy hits a power-up orb, it is destroyed.

### Score, combos and skins

- Body/leg hit +1, headshot +3, K.O. +10 (+5 more for a headshot K.O.).
- Hits in a row build a **combo**. From the 3rd hit, points are multiplied
  (×2, ×3 … up to ×5). A throw that misses everything resets it.
- Rivals throw faster and more accurately each round (about 35% of throws hit
  at the start, up to about 80% later).
- Reaching later rounds unlocks skins: **Crimson** (round 3), **Frost** (6),
  **Gold** (10) and **Inferno** (15). The game-over card shows how close the
  next one is.
- The first game has a short hands-on tutorial, and the enemy waits until you
  have thrown once.

## Web Lens requirements covered

- `index.html` at the root of the zip, and every path is relative
- Self-contained, with no network requests: everything is drawn on a canvas,
  all sounds are synthesised with Web Audio, and the one font (Russo One,
  SIL OFL) ships in `fonts/`
- No camera, microphone or motion sensors
- The Web Lens API (`@snap/web-lens-api` v0.1.2, `snap-api.js`) ships inside
  the zip and loads before `game.js`. The game calls `snapchat.init()` once
  behind the loading screen and checks every capability with
  `isSupported()`, so it still works without them.
- **Storage**: best score, best round, unlocked/selected skin, sound setting
  and tutorial state are saved through `snapchat.storage` (key `save`).
- **Leaderboards**: each run's score is submitted as an integer with
  `leaderboards.submitScore({ score })`. The trophy buttons open Snapchat's
  panel and only appear when the capability is supported.
- **Safe zone**: the HUD, buttons, towers and fighters all stay inside
  `CFG.SAFE_TOP` / `CFG.SAFE_BOTTOM` (12% of the screen height at the top and
  16% at the bottom, or the device's safe-area insets if larger), set at the
  top of `game.js`. Only the sky and the ground wall reach under Snapchat's
  controls. Add `#safe` to the URL to see the zone.
- Portrait layout that scales to tall phones (towers get taller) and centres
  on wide screens. Touch, mouse and keyboard all work. Audio starts on the
  first tap, and the game pauses when the app goes to the background.

## Upload to Snapchat

| File | What it is |
|---|---|
| `release/javelin-duel.zip` | The Lens. `index.html` is at the zip root. Upload this. |
| `marketing/icon.png` | Lens icon, 1024×1024 (`icon-512.png` is 512×512) |

1. In **My Lenses**, create a Web Lens and upload `release/javelin-duel.zip`.
2. Add `marketing/icon.png` as the Lens icon.
3. Turn on the leaderboard for the Lens, or the trophy buttons stay hidden.

## Build and test

```sh
./scripts/build-zip.sh        # rebuilds release/javelin-duel.zip
```

Serve the folder with any static server (the font needs `http://`). Outside
Snapchat the API uses its desktop stub, so saves only last until you reload.
`#debug` exposes a `window.__jd` test hook.
