#!/usr/bin/env python3
"""Builds levels.js: one crossword + letter wheel per level.

Inputs (not shipped in the Lens):
  - a word list, one word per line (npm `word-list` v4.1.0, MIT), path in argv[1]
  - `wordfreq` (pip) to rank words by how common they are

Answer words come from the most common words, bonus words from a much wider
set, so obscure-but-real words still count as bonus finds.

  python3 scripts/gen_levels.py /path/to/words.txt > levels.js
"""
import json
import random
import sys
from collections import Counter

from wordfreq import top_n_list

LEVELS = 300
MAX_COLS = 10
MAX_ROWS = 9

# Words never used as answers or bonus words.
BLOCK = set("""
anal anus arse ass asses bitch bitchy bong boob boobs booty butt butts cock cocks coon crap cum cunt damn dick dicks
dildo dong dyke fag fags fart farts fuck gay gays gook homo horny hump jap jew jism jizz kike kinky lust nazi nazis negro
nude nudes nudity orgy pee peed penis pervert pimp piss poop porn porno prick pube pubes queer rape raped rapes rapist
sex sexy sexes shit slut sluts smut spic spunk stud suck sucks teat tit tits titty turd twat urine vagina whore wank
weed wench wop crack crotch drug drugs gun guns kill kills killed dead die died dies death bomb bombs heroin coke
meth opium slave slaves negroes lynch hang hanged suicide murder abort sperm semen hooker pussy bum bums
john jean jon don rob ken ted tim tom sam ben dan pat ron jan ann anne sue kim kay ray roy ian lee guy jay joe
mike bob ted rex ali amy eve ida ira mao alan amazon anna boston collins cole eric gilbert james louis maria
mona morris ruth sally yale ana dell peter mae ming orleans les las los san sri lin han che chi sur del vin nas mas
mal mar mon mos torture assault lesbian imam ava lou luna mary madison mel ned paul saul tony sal
cocaine grenade bullets weapons abusing scum screwed condoms condom racism virgin barry carr carter congo donna
germans gus oscar otto patrick spencer soho toby fascist shotgun weapon jordan khan michael spain roman german
alma lama lima mali martin paris vanessa yankees kat lars timothy slavery alcohol fleming johns johnson lana mara milo neal lux baba
fascism killers killer maya griffin colin jess jesse madonna troy tyler sucking carl dodgers freeman holland raj scots
murders stabbed chile kara laura manila stevens trump bomber bombers missile terror emmy pam tina yang oxford
""".split())

# Common, but abbreviations or slang: fine as bonus words, never as answers.
NOT_ANSWER = set("""
abs ads alt ama app apps auto blah bro bros cant col con cos demo doc docs dos eds eng est eco gen geo gif gon iso
ing ios info mac med mid mil mod nah nam nana pic pics pre pro pros ref rep reps res rev rom sec sim sis stat stats
sub subs thru ugh umm ups wan wanna wat yah yea aye ufo tat dee tho ima lol omg pls bout cuz gotta gonna til tis
emo hai mags mins mom vid vids hon int lat def ave fam bae dat hrs ain als dis gal gee git hah heh hes
hoc ids ins lib ling mis nat ness ole rec reg sen sic sims sol tex ting uni var yin din dow
ala cis dom eff ems faa jin jun lam lea lex ser tai tel bio bon dev div hoo hun moe nan pol ren sos vol ooh
josh rory hong vega para dope dang noel semi blog bis boi cha doo goa mag nos ons sac tor vis yep jong kang mina
sean sept prof temp babe anon das ish refs obi sox cad sans aka dui ops pas spec bel yup lang comp woo
""".split())


def load(path):
    with open(path) as f:
        words = {w.strip().lower() for w in f}
    return {w for w in words if w.isalpha() and w.isascii() and 3 <= len(w) <= 7 and w not in BLOCK}


def fits(word, pool):
    c = Counter(word)
    return all(pool[k] >= v for k, v in c.items())


class Grid:
    def __init__(self):
        self.cells = {}
        self.words = []

    def can_place(self, w, x, y, d):
        dx, dy = (1, 0) if d == 0 else (0, 1)
        if self.cells.get((x - dx, y - dy)) or self.cells.get((x + dx * len(w), y + dy * len(w))):
            return -1
        cross = 0
        for i, ch in enumerate(w):
            cx, cy = x + dx * i, y + dy * i
            cur = self.cells.get((cx, cy))
            if cur:
                if cur[0] != ch or cur[1] & (1 << d):
                    return -1
                cross += 1
            else:
                # side neighbours must be empty, or a parallel word would touch
                if self.cells.get((cx + dy, cy + dx)) or self.cells.get((cx - dy, cy - dx)):
                    return -1
        return cross

    def place(self, w, x, y, d):
        dx, dy = (1, 0) if d == 0 else (0, 1)
        for i, ch in enumerate(w):
            p = (x + dx * i, y + dy * i)
            cur = self.cells.get(p)
            self.cells[p] = (ch, (cur[1] if cur else 0) | (1 << d))
        self.words.append((w, x, y, d))

    def bounds(self, extra=()):
        xs = [p[0] for p in self.cells] + [p[0] for p in extra]
        ys = [p[1] for p in self.cells] + [p[1] for p in extra]
        return min(xs), min(ys), max(xs), max(ys)


def try_layout(words, rng):
    g = Grid()
    first = words[0]
    g.place(first, 0, 0, rng.choice((0, 1)) if len(first) <= MAX_ROWS else 0)
    left = words[1:]
    for w in left:
        best = None
        for (px, py), (ch, dirs) in list(g.cells.items()):
            for i, wc in enumerate(w):
                if wc != ch:
                    continue
                for d in (0, 1):
                    if dirs & (1 << d):
                        continue
                    x = px - i if d == 0 else px
                    y = py if d == 0 else py - i
                    cross = g.can_place(w, x, y, d)
                    if cross < 1:
                        continue
                    dx, dy = (1, 0) if d == 0 else (0, 1)
                    pts = [(x + dx * k, y + dy * k) for k in range(len(w))]
                    x0, y0, x1, y1 = g.bounds(pts)
                    cw, chh = x1 - x0 + 1, y1 - y0 + 1
                    if cw > MAX_COLS or chh > MAX_ROWS:
                        continue
                    score = cw * chh + abs(cw - chh * 1.3) * 2 - cross * 6 + rng.random() * 3
                    if best is None or score < best[0]:
                        best = (score, x, y, d)
        if best:
            g.place(w, best[1], best[2], best[3])
    return g


def layout(words, rng, need):
    best = None
    for _ in range(60):
        order = [words[0]] + rng.sample(words[1:], len(words) - 1)
        order = sorted(order, key=lambda w: -len(w) + rng.random() * 1.5)
        g = try_layout(order, rng)
        x0, y0, x1, y1 = g.bounds()
        key = (len(g.words), -((x1 - x0 + 1) * (y1 - y0 + 1)))
        if best is None or key > best[0]:
            best = (key, g)
        if len(g.words) >= len(words):
            break
    g = best[1]
    if len(g.words) < need:
        return None
    x0, y0, _, _ = g.bounds()
    return [(w, x - x0, y - y0, d) for (w, x, y, d) in g.words]


def plan(i):
    """letters in the wheel, words wanted in the grid, minimum accepted"""
    if i < 3:
        return 3, 3, 2
    if i < 12:
        return 4, 4, 3
    if i < 40:
        return 5, 5, 4
    if i < 110:
        return 6, 6 + min(2, (i - 40) // 25), 5
    return 7, 7 + min(3, (i - 110) // 40), 6


def main():
    valid = load(sys.argv[1])
    ranked = [w for w in top_n_list('en', 80000) if w in valid]
    rank = {w: r for r, w in enumerate(ranked)}
    common = set(ranked[:9000]) - NOT_ANSWER
    bonus_ok = set(ranked)
    rng = random.Random(20261019)

    bases = {}
    for w in ranked[:14000]:
        if w in NOT_ANSWER:
            continue
        bases.setdefault(len(w), []).append(w)

    used = set()
    levels = []
    for i in range(LEVELS):
        n, want, need = plan(i)
        # easier, more common base words first
        cands = [w for w in bases[n] if ''.join(sorted(w)) not in used]
        span = min(len(cands), 120 + i * 6)
        level = None
        for _ in range(400):
            base = cands[rng.randrange(span)]
            pool = Counter(base)
            subs = sorted((w for w in common if fits(w, pool)), key=lambda w: rank[w])
            if len(subs) < need:
                continue
            chosen = [base] + [w for w in subs if w != base][: want - 1]
            chosen.sort(key=lambda w: (-len(w), rank[w]))
            grid = layout(chosen, rng, need)
            if not grid:
                continue
            placed = {g[0] for g in grid}
            extra = sorted(w for w in bonus_ok if fits(w, pool) and w not in placed)
            letters = list(base)
            while True:
                rng.shuffle(letters)
                if ''.join(letters) != base or n < 3:
                    break
            level = {
                'l': ''.join(letters).upper(),
                'w': [[w.upper(), x, y, d] for (w, x, y, d) in grid],
                'b': ' '.join(extra).upper(),
            }
            used.add(''.join(sorted(base)))
            break
        if not level:
            raise SystemExit(f'no level {i + 1}')
        levels.append(level)

    sys.stdout.write('// Generated by scripts/gen_levels.py. Do not edit by hand.\n')
    sys.stdout.write('window.LEVELS = ')
    sys.stdout.write(json.dumps(levels, separators=(',', ':')))
    sys.stdout.write(';\n')


if __name__ == '__main__':
    main()
