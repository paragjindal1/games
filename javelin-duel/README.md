# Javelin Duel

A tower-to-tower javelin fight built as a **Snapchat Web Lens**.

Black stickman silhouettes duel across glowing sunset skies. Drag back to aim,
release to throw, and knock your rival off their tower before they knock you
off yours. The title screen runs a live AI duel behind the menu, so the first
thing people see is the action.

## How to play

| Action | Control |
|---|---|
| Aim and throw | **Drag back** anywhere on the screen and release. The farther you pull, the harder you throw. |
| Power-ups | Hit a floating **orb** with a javelin |
| Pause | Pause button (under the score), `Esc` or `P` |
| Start / retry | Tap, or `Space` / `Enter` |
| Change skin | Arrows on the title screen (or ←/→) |

- A power meter and a short dotted arc show your throw while you aim.
- **Head** hits do 70 damage, **body** 38 and **legs** 24. Everyone has 100 health.
- **Headshots heal** the thrower +15 HP (enemies too).
- Javelins that meet in mid-air **clash** and fall.
- Every K.O. plays in **slow motion**; the next rival rises on a new tower and
  you get 15 HP back.

### ULTRA javelin

Every hit fills the gold **ULTRA** bar under your health (headshots fill it
faster, and getting hit adds a little). When it is full, your next throw is
an ULTRA: a huge glowing javelin with half the gravity and double damage that
smashes through shields and through enemy javelins. **Enemies charge ULTRA
too**; you get an "ULTRA INCOMING!" warning before they throw it.

### Power-up orbs (both sides can grab them)

| Orb | Effect |
|---|---|
| **Heal** | +35 HP |
| **Fire** | Next 2 throws do 1.5× damage and set the target on fire |
| **Ice** | Next throw freezes the target for 2.4 s (a frozen player can't throw) |
| **Triple** | Next throw fires 3 javelins in a spread |
| **Shield** | A bubble blocks the next javelin, bomb or lightning |
| **Lightning** | After a short warning, a bolt hits the other fighter for 22 |
| **Bomb** | Next javelin explodes on impact and splashes nearby damage |
| **Gold** | +25 score (if the enemy hits it, it's stolen) |

The enemy AI shoots at orbs on purpose, and its power-ups show under its
health bar and above its head.

### Rounds

| Twist | When |
|---|---|
| **Wind** | From round 3. Pushes every javelin; streaks and a HUD chip show its direction. |
| **Moving tower** | From round 4. The rival's tower rides up and down. |
| **Boss** | Every 5th round: a horned Warlord with 150 HP who hits harder |
| **New arena** | Every 5 rounds: Sunset Keep → Neon Night → Blood Moon → Frost Peak |

### Score, combos and skins

- Body/leg hit +1, headshot +3, lightning/bomb +2, K.O. +10 (+5 for a
  headshot K.O.), Gold orb +25.
- Hits in a row build a **combo**; from the 3rd hit points are multiplied
  (×2, ×3 … up to ×5). A throw that misses everything resets it.
- Rivals throw faster and more accurately each round.
- Reaching later rounds unlocks skins: **Crimson** (round 3), **Frost** (6),
  **Gold** (10) and **Inferno** (15). The game-over card shows your score,
  stats (round, headshots, best combo, power-ups) and how close the next skin is.
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
