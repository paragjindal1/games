# Bridge War

A 3D squad runner-shooter built as a **Snapchat Web Lens**, starring the
player's own **3D Bitmoji**.

Your squad charges down a suspension bridge and fires on its own. Pick a lane:
bullets raise the gate in front of you, the red horde behind it pours through
and charges, rolling tires sweep the lanes, and a wall of barrels guards the
end of the bridge. Coins buy upgrades between levels.

## How to play

| Action | Control |
|---|---|
| Start a level | Drag (or tap) on the bridge, or press an arrow key |
| Move the squad | **Drag left / right** anywhere, or ← → / A D |
| Buy an upgrade | Tap a card on the level screen |
| Pause | Pause button, `Esc` or `P` |

- **Shooting is automatic.** Bullets fly up your lane; once enemies charge,
  the squad auto-aims at the nearest ones.
- **Gates** add or remove soldiers when you run through them. Every bullet
  that flies through a gate raises its number (`-9` → `-4` → `+3` …) and
  carries on to the horde behind it. Each gate has a cap (shown as `MAX`), and
  the higher it gets, the slower it grows.
- **The horde** waits behind each gate, then charges and homes in on the
  squad. Every red soldier that reaches you takes one of yours. Hordes grow
  much faster than your squad can, so the back half of the bridge is a real
  fight.
- **Elites** (big, dark red, with a health number) soak up bullets and take
  five soldiers with them.
- **Tires** roll down the lanes and wipe out 40% of the squad. Shoot them or
  step aside.
- **Barrel wall**: at the end of the bridge the squad stops. Shoot all three
  barrels while the last of the horde keeps spawning. Lose every soldier and
  the run ends; you keep the coins you collected.

### Upgrades

| Card | Effect per level |
|---|---|
| **Fire Rate** | +12% shots per soldier |
| **Damage** | +20% bullet damage |
| **Revenue** | +25% coins |
| **Squad** | +1 soldier at the start of every run |

Levels are built from their number, so a level plays the same on every retry.
Each one is longer, with bigger hordes, more elites and tires, and a tougher
barrel wall. From level 2 on you'll need upgrades.

### 3D Bitmoji

Inside Snapchat the game asks `snapchat.bitmoji.getAvatarInfo()` and, if the
player has a Bitmoji, loads it with `snapchat.bitmoji.get3DAvatar()`. The GLB
is loaded with three.js, posed once and drawn as instanced meshes, so the front
of the squad is a crowd of the player's own Bitmoji hopping down the bridge.
The squad faces the camera on the level screen and turns to run when the level
starts. To keep phones smooth, Bitmoji are capped by a triangle budget
(`CFG.AVATAR_TRIS`); soldiers past the budget use the built-in model. If there's
no Bitmoji (or outside Snapchat), every soldier uses the built-in model.
If the model faces the wrong way on some devices, set `CFG.AVATAR_YAW`.

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

1. In **My Lenses**, create a Web Lens and upload `release/bridge-war.zip`.
2. Add `marketing/icon.png` as the Lens icon.
3. Turn on the leaderboard for the Lens, or the trophy button stays hidden.

## Build and test

```sh
./scripts/build-zip.sh        # rebuilds release/bridge-war.zip
```

Serve the folder with any static server (the font needs `http://`). Outside
Snapchat the API uses its desktop stub, so saves only last until you reload.
`#debug` exposes a `window.__bw` test hook.
