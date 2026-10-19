# Word Wow

A crossword word-swipe game built as a **Snapchat Web Lens**.

Swipe across the letters in the wheel to spell words. Every word you find
flies into the crossword. Fill the whole grid to clear the level. There is no
start button or menu: the Lens opens straight into the current level.

## How to play

| Action | Control |
|---|---|
| Make a word | Swipe across the letters in the wheel, then let go |
| Undo a letter | Slide back to the letter before it |
| Shuffle the wheel | Button left of the wheel (or **Space**) |
| Hint | Bulb button right of the wheel: reveals one letter for 25 coins |
| Bonus words | Star button: shows the extra words you found this level |
| Sound | Speaker button in the top bar |
| Leaderboard | Trophy button in the top bar (only when supported) |

On a desktop you can also type letters and press **Enter**.

- Level 1 shows a hand that swipes the first word for you.
- Real words that aren't in the grid are **bonus words**. Each one fills the
  bonus jar by one; 10 fill it for +50 coins.
- Clearing a level gives +10 coins and moves on by itself after a short
  celebration (tap to skip it).
- 300 generated levels, from 3-letter wheels up to 7 letters and 10 words. The
  scene changes every 8 levels (7 scenes). After level 300 the puzzles repeat
  with the wheel reshuffled, and the level number keeps counting.

## Web Lens requirements covered

- `index.html` at the root of the zip, and every path is relative
- Self-contained: no network requests. All art is drawn on a canvas, sounds
  are synthesised with Web Audio, and the font (Fredoka, SIL OFL) ships in
  `fonts/`. The zip is about 90 KB.
- No camera, microphone or motion sensors
- The Web Lens API (`@snap/web-lens-api` v0.1.2, `snap-api.js`) ships inside
  the zip and loads before `game.js`. The game calls `snapchat.init()` once,
  checks every capability with `isSupported()`, and still works without them.
- **Storage**: level, coins, found words, hints, bonus words, the bonus jar
  and the sound setting are saved through `snapchat.storage` (key `save`)
  after every word and when the Lens is hidden. Nothing is written before the
  first read answers, and writes are chained so only one is in flight.
- **Leaderboards**: the number of levels cleared is submitted as the score
  (an integer, higher is better) after each level. The trophy button opens
  Snapchat's panel and only appears when the capability is supported.
- **Safe zone**: all UI stays inside `CFG.SAFE_TOP` / `CFG.SAFE_BOTTOM` (10%
  of the screen height each, or the device's safe-area insets if larger), set
  at the top of `game.js`. The scenery still fills the whole screen. Add
  `#safe` to the URL to draw the zone while testing.
- Portrait layout that stretches to tall phones and centres on wide screens.
  Touch, mouse and keyboard all work. Audio starts on the first touch.

## Upload to Snapchat

| File | What it is |
|---|---|
| `release/wordwow.zip` | The Lens. `index.html` is at the zip root. Upload this. |
| `marketing/icon.png` | Lens icon, 1024×1024 (`icon-512.png` is 512×512) |

1. In **My Lenses**, create a Web Lens and upload `release/wordwow.zip`.
2. Add `marketing/icon.png` as the Lens icon.
3. Turn on the leaderboard for the Lens if you want the trophy button. Without
   it the game hides the button and plays normally.

## Build

```sh
./scripts/build-zip.sh        # rebuilds release/wordwow.zip
```

Levels are generated ahead of time into `levels.js`:

```sh
pip install wordfreq
npm pack word-list@4.1.0 && tar xzf word-list-4.1.0.tgz
python3 scripts/gen_levels.py package/words.txt > levels.js
```

Answer words come from the ~9,000 most common English words (with names,
abbreviations, slang and rude words filtered out by the lists at the top of
the script). Bonus words come from a much wider list. The script is seeded,
so it gives the same levels every run.

`scripts/icon.html` draws the icon (serve the folder and screenshot it at
1024×1024).

For local testing, serve the folder with any static server and open
`index.html`. Outside Snapchat the API uses its desktop stub, so saves only
last until you reload. `#debug` exposes a `window.__ww` test hook
(`solve()`, `play('WORD')`, `go(n)`).
