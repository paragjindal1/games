# Bow Bots

An endless ragdoll archery game built as a **Snapchat Web Lens**.

You are a hooded archer on a stone castle tower. Enemy archers keep flying
in on floating sky islands and shooting back. Pull back, aim, and drop as many as you can before you
fall. Every kill adds to your lifetime **total kills**, and that total is
what the Snapchat leaderboard ranks.

## How to play

| Action | Control |
|---|---|
| Aim and shoot | Touch anywhere, **drag back** like a slingshot, release. Drag further for more power |
| Dodge | **JUMP** on the tower (or `Space` / `↑` / `W`) |
| Pause | Pause button, `Esc` or `P` |

- Shooting costs 10 stamina and jumping costs 20. Stamina refills on its own.
- **Headshots** do 2.5× damage (1.6× against helmets), body shots 1×, and
  limbs 0.6×. Every headshot also heals you **+5 HP**.
- Hitting a bot while it draws its bow spoils its shot.
- Shoot an incoming arrow out of the air to **block** it (+1 coin).
- **Kill combos**: kills within 3 seconds of each other chain into DOUBLE
  KILL, TRIPLE KILL, QUAD KILL, RAMPAGE… with bonus coins.
- **Power-up balloons** float up through the sky. Shoot one to pop it:

  | Balloon | Effect |
  |---|---|
  | Fire Arrows | 12 s: arrows set bots on fire (damage over time) |
  | Triple Shot | 12 s: two extra arrows per shot |
  | Bomb Arrows | 10 s: arrows explode on impact and hit every bot nearby |
  | Freeze | Freezes every bot for 4 s; frozen bots take 25% more damage |
  | Heal | +40 HP (shows up more often when you are low) |
  | Coins | +15 coins |

- **Birds** fly across the top now and then. Snipe one for +5 coins.
- **Gold thieves** (from 5 kills) never shoot but escape after 7 seconds.
  Drop one in time for a 25-coin jackpot.
- **Levels**: each boss you beat is a level up, and the sky changes: Sky
  Meadow → Sunset Peaks → Moonlit Wilds → Ember Ridge, then around again.
- Bots aim at where you stand on the tower, so a well-timed jump dodges them.
- The first run is the tutorial: a hand pointer shows the drag, and bots hold
  their fire until you take your first shot.

### Enemies (unlimited)

Enemies never stop coming. They get more health, hit harder, reload faster and
aim better as your kill count rises. One bot is on screen at first, then two
from 3 kills, then three from 12. From 15 kills some platforms move.

| Bot | From kill | Trait |
|---|---|---|
| Archer (red bandana) | 0 | Basic |
| Scout (teal hood) | 4 | Fast reload, weaker |
| Knight (steel helmet, orange plume) | 10 | Tough, helmet blunts headshots |
| Sniper (purple hood and mask) | 18 | Very accurate and hard-hitting. Its red laser sight shows the shot before it fires, so jump |
| King (crown and beard) | every 10th kill | Boss: big, tough, fires a 3-arrow volley |

Kills drop coins that fly up to your counter (more for headshots, combos,
bosses and deep runs). Knocked-out archers see stars and ragdoll off their
island.

### Upgrades

Upgrades are bought with coins and **kept between runs**: Health, Armor,
Damage, Stamina, Stamina Refill, Bow Power (faster, flatter arrows), Life
Steal and Arrow Slots (up to 3 arrows per shot).

## Leaderboard

The leaderboard ranks **lifetime total kills**: the sum of kills from every
run, which only ever goes up.

- The total is updated and saved after every kill.
- It is submitted with `leaderboards.submitScore({ score })` (an integer,
  higher is better) when a run ends, when you quit, when the Lens is hidden,
  and right before the panel opens.
- **LEADERBOARD** (title) and **RANKS** (game over) open Snapchat's panel
  with `leaderboards.show()`. These buttons only appear when
  `isSupported('leaderboards')` is true.

Tested in a browser against the API's desktop stub: `submitScore` resolves
(`{"bestScore":42}`), `show()` resolves, and storage round-trips the save.
The stub has no panel, so the game shows "Kills sent · the leaderboard opens
inside Snapchat". The real panel can only be tested on a phone after upload.

## Web Lens requirements covered

- `index.html` at the root of the zip, and every path is relative
- Self-contained: no network requests. All art is drawn on a canvas, all
  sound is synthesised with Web Audio, and the two fonts (Russo One and
  Rajdhani, SIL OFL) ship in `fonts/`. The zip is about 65 KB.
- No camera, microphone or motion sensors
- The Web Lens API (`@snap/web-lens-api` v0.1.2, `snap-api.js`) ships inside
  the zip and loads before `game.js`. The game calls `snapchat.init()` once
  behind the loading screen and checks every capability with
  `isSupported()`, so it still works without them.
- **Storage**: coins, upgrades, best run, total kills, sound setting and the
  tutorial flag are saved through `snapchat.storage` (key `save`). Nothing
  is written before the first read answers, and only one write is in flight
  at a time.
- **Safe zone**: everything the player reads or touches (HUD, tower bars,
  JUMP, enemies, balloons, panels) stays inside `CFG.SAFE_TOP` /
  `CFG.SAFE_BOTTOM`: the top 10% and bottom 10% of the screen (or the
  device's safe-area insets if larger) are left plain black for Snapchat's
  controls. Add `#safe` to the URL to draw the zone edges while testing.
- Portrait layout that stretches to tall phones and centres on wide screens.
  Touch, mouse and keyboard all work. Audio starts on the first tap, and the
  game pauses when the app goes to the background.

## Upload to Snapchat

| File | What it is |
|---|---|
| `release/bowbots.zip` | The Lens. `index.html` is at the zip root. Upload this. |
| `marketing/icon.png` | Lens icon, 1024×1024 (`icon-512.png` is 512×512) |
| `marketing/preview.mp4` | Preview video: 8 s, 1080×1920, 30 fps, H.264, no sound, ends on the logo |

1. In **My Lenses**, create a Web Lens and upload `release/bowbots.zip`.
2. Add `marketing/icon.png` as the Lens icon and `marketing/preview.mp4` as
   the preview video.
3. **Turn on the leaderboard for the Lens.** The Web Lens API only reports
   `leaderboards` to Lenses configured with the leaderboard module. Without
   it, the game hides its leaderboard buttons and still plays normally.

## Build

```sh
./scripts/build-zip.sh        # rebuilds release/bowbots.zip
```

For local testing, serve the folder with any static server (fonts need
`http://`), or open `index.html` directly. Outside Snapchat the API uses its
desktop stub, so saves only last until you reload. `#debug` exposes a
`window.__bb` test hook.
