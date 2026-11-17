# Bridge War

A 3D squad runner-shooter built as a **Snapchat Web Lens**, starring the
player's own **3D Bitmoji**.

Your squad charges down a suspension bridge and fires on its own. Shoot down
the red horde guarding each gate, then shoot the gate itself to raise its
number before you run through, or gamble on a bulletproof ×2, ÷2 or mystery
gate. Rolling tires flatten whoever they roll over, and an armed boss waits at
the end of every bridge. Coins buy gun upgrades between levels, and
you need them: each boss is much tougher than the last.

## How to play

| Action | Control |
|---|---|
| Start a level | Drag (or tap) on the bridge, or press an arrow key |
| Move the squad | **Drag left / right** anywhere, or ← → / A D |
| Buy an upgrade | Tap a card on the level screen |
| Pause | Pause button, `Esc` or `P` |

- **Shooting is automatic.** Every bullet leaves a real barrel: each shot
  flashes at the muzzle, kicks that soldier back and flicks out a spent
  casing. Bullets fly straight up your lane until enemies charge; then the
  whole squad turns to face them and aims. A bullet that kills a soldier with
  damage to spare carries the rest into the next one.
- **Gates** change the squad when you run through them. Every bullet that
  touches a gate **stops there**.
  - **Number gates** (`-9`, `+3`) go up with every bullet you put into them,
    more slowly the higher they get, up to a cap shown as `MAX`.
  - **Bulletproof gates** can't be changed by shooting: green **×2 / ×3**
    multiply the squad, purple **÷2 / ÷3** divide it, and gold **?** is a
    mystery (×2, ÷2, a bonus or a loss), revealed only when you pass. They
    sit next to number gates, so you keep choosing between raising a gate
    yourself and taking the gamble.
- **The horde** stands guard in front of each gate, then charges and homes in
  on the squad. Every red soldier that reaches you takes one of yours.
- **Elites** (big, dark red, with a health number) soak up bullets and take
  five soldiers with them.
- **Tires** roll down a lane and flatten **every soldier in their path**:
  step the squad out of the way, or shoot them first. The rest of the squad
  closes ranks afterwards.
- **Boss**: at the end of the bridge the squad stops and a horned giant with a
  gun walks at it. He fires three-round bursts at where the squad is standing
  (move to dodge them), calls in minions, rolls tires down your lane, and
  stomps soldiers once he reaches you. Kill him to clear the level. Lose every
  soldier and the run ends; you keep the coins you collected.

### Upgrades

| Card | Effect per level |
|---|---|
| **Fire Rate** | +12% shots per soldier |
| **Damage** | +17% bullet damage, compounding |
| **Revenue** | +25% coins |
| **Squad** | +1 soldier at the start of every run |

Levels are built from their number, so a level plays the same on every retry.
Each one is longer, with bigger hordes, more elites and tires, and a boss with
far more health (about 9K on level 1, 33K on level 3, 115K on level 5).
Simulated with perfect steering (but never dodging the boss's bullets):
level 1 can be won with no upgrades, level 2 needs one level of Fire Rate and
Damage, level 5 about four, level 7 about nine.

### 3D Bitmoji

Inside Snapchat the game asks `snapchat.bitmoji.getAvatarInfo()` and, if the
player has a Bitmoji, loads it with `snapchat.bitmoji.get3DAvatar()`. The front
of the squad becomes a crowd of animated copies of the player's Bitmoji, each
carrying a rifle:

- **Arms**: the upper arm, forearm and hand bones are found by name and posed
  every frame so the right hand is on the grip and the left on the fore-end,
  whatever the rig's bone axes are (the bones are aimed in world space).
  The rifle is placed from the arm length, so it sits within reach.
- **Legs**: if the model includes animation clips, its run clip plays (one
  named run/sprint/jog, else walk, else the first), cross-fading to an idle
  clip on the level screen if there is one. If it has a skeleton but no
  clips, the upper and lower leg bones are swung about the body's sideways
  axis for a running stride with knee bend.
- **Shooting**: each shot fires from that Bitmoji's own rifle with a muzzle
  flash, kicks the rifle (and the arms holding it) back, and ejects a casing.
  The Bitmoji turn with the squad to face what they're shooting.
- A plain mesh with no skeleton hops along with the rifle at its side.

Each Bitmoji is a separate animated copy, so they're capped by a triangle
budget (`CFG.AVATAR_TRIS`, at most `CFG.AVATAR_MAX` = 12); soldiers past the cap
use the built-in model. With no Bitmoji (or outside Snapchat) every soldier
uses the built-in model. If the model faces the wrong way on some devices, set
`CFG.AVATAR_YAW`. All of this was tested with stand-in rigged models; the real
Bitmoji (and its bone names) can only be checked inside Snapchat.

## Web Lens requirements covered

- `index.html` at the root of the zip, and every path is relative
- Self-contained: the world is rendered with **three.js r170** (MIT, bundled
  as `three.bundle.js` with its licence), the HUD is drawn on a 2D canvas on
  top, all sounds are synthesised with Web Audio, and the one font (Russo One,
  SIL OFL) ships in `fonts/`. The only thing fetched at runtime is the
  player's Bitmoji, from the URL Snapchat's API hands back.
- No camera, microphone or motion sensors
- The Web Lens API (`@snap/web-lens-api` v0.1.2, `snap-api.js`) ships inside
  the zip and loads before `game.js`. The game calls `snapchat.init()` once
  behind the loading screen and checks every capability with
  `isSupported()`, so it still works without them.
- **Storage**: level, coins, upgrades and the sound setting are saved through
  `snapchat.storage` (key `save`).
- **Leaderboards**: ranks **career coins** (every coin ever collected),
  submitted as an integer at the end of each run. The trophy button opens
  Snapchat's panel and only appears when the capability is supported.
- **Safe zone**: the HUD, upgrade cards and the squad stay inside
  `CFG.SAFE_TOP` / `CFG.SAFE_BOTTOM` (12% of the screen height at the top and
  16% at the bottom, or the device's safe-area insets if larger), set at the
  top of `game.js`. Only sky, sea and bridge reach under Snapchat's controls.
  The 3D camera is shifted so the squad sits above the bottom bar.
  Add `#safe` to the URL to see the zone.
- Portrait layout that scales to tall phones and centres on wide screens.
  Touch, mouse and keyboard all work. Audio starts on the first tap, and the
  game pauses when the app goes to the background.

## Upload to Snapchat

| File | What it is |
|---|---|
| `release/bridge-war.zip` | The Lens. `index.html` is at the zip root. Upload this. |
| `marketing/icon.png` | Lens icon, 1024×1024 (`icon-512.png` is 512×512) |
| `marketing/preview.mp4` | Preview video: 8 s, 1080×1920, 30 fps, H.264 + AAC sound. The squad shoots through a horde and takes a ×2 gate, then the armed boss fight, "BOSS DOWN!" and the level-clear card. |
| `release/bridge-war-upload-kit.zip` | Everything above in one zip: the Lens zip, both icons and the preview video. |

1. In **My Lenses**, create a Web Lens and upload `release/bridge-war.zip`.
2. Add `marketing/icon.png` as the Lens icon and `marketing/preview.mp4` as the
   preview video.
3. Turn on the leaderboard for the Lens, or the trophy button stays hidden.

## Build and test

```sh
./scripts/build-zip.sh        # rebuilds release/bridge-war.zip
```

Serve the folder with any static server (the font needs `http://`). Outside
Snapchat the API uses its desktop stub, so saves only last until you reload.
`#debug` exposes a `window.__bw` test hook. `scripts/capture-preview.js`
re-records the preview video (see the comment at its top).
