# Bloom Guard

A grow, merge and defend game built as a **Snapchat Web Lens**.

Night pests (glow slugs, iron beetles, night wasps and the Mole King) crawl
across the moonlit meadow toward your hedge. Grow seeds, merge matching plants
into stronger species, and let the plants in the front-row pots shoot the pests
down.

## How to play

| Action | Control |
|---|---|
| Grow a seed | **Hold** left mouse button, a finger, or **Space** (on the seed pod or anywhere empty) |
| Merge | Drag a plant onto another plant of the same tier |
| Move / swap | Drag a plant to another pot or seed tray slot |
| Sell | Drag a plant onto **SELL** |
| Start the next wave early | **GO** button during the countdown |
| Pause | Pause button, `Esc` or `P` |

Only the five pots right behind the hedge attack; the seed tray is storage.
New seeds go into empty pots first, then the tray.

### Plants (9 tiers)

Sprout → Clover → Bluebell → Thorn Rose → Star Cactus (splash) → Sunflower →
Frost Lily (freezes) → Venus Snapper → Moon Bloom (big splash)

### Shop

- **Buy a plant**: two tiers below your best discovered plant
- **Quick Roots**: seeds grow faster
- **Rich Soil**: chance that a seed grows as a tier-2 plant
- **Wild Sap**: more damage for every plant
- **Bramble Wall**: more hedge health

Every 5th wave brings the Mole King. If the hedge breaks you drop back one wave
and keep your plants.

## Web Lens requirements covered

- `index.html` at the root of the zip, and every path is relative (`./game.js`, ...)
- Self-contained: no network requests, CDNs, web fonts or images. All art is
  drawn on a canvas and all sound is synthesised with Web Audio, so the zip is
  about 21 KB
- No camera, microphone or motion sensors
- The Web Lens API (`@snap/web-lens-api` v0.1.2, `snap-api.js`) ships **inside**
  the zip and loads before `game.js`, because the Lens CSP blocks scripts loaded
  from a URL
- `snapchat.init()` runs once behind the loading screen, and every feature is
  checked with `isSupported()` first, so the game stays playable without it
- **Storage**: progress is saved through `snapchat.storage` (key `save`),
  because browser storage starts empty on every launch. Nothing is written
  until the first read answers. Writes are chained so only one is in flight,
  are batched rather than written every frame, and also go out when the page
  is hidden.
- **Leaderboards**: the best wave is submitted as an integer score
  (higher is better). The **LEADERBOARD** button on the title and pause
  screens opens Snapchat's panel. It only appears when the capability is
  supported.
- Portrait 9:16 layout, scaled to fit any phone. Touch, mouse and keyboard
  all work. Audio starts on the first tap, there is a mute button, and the
  game pauses when the app goes to the background.

## Build and upload

```sh
./scripts/build-zip.sh        # -> dist/bloom-guard.zip
```

Upload `dist/bloom-guard.zip` to **My Lenses** with a Lens icon and a preview
video.

For local testing, open `index.html` in a browser, or serve the folder with
any static server. Outside Snapchat the API uses its built-in stub
(`snapchat.isStub === true`), so saves only last until you reload.

To update the API: `npm pack @snap/web-lens-api` and copy `dist/snap-api.js` over
`snap-api.js`.
