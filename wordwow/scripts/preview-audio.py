#!/usr/bin/env python3
"""Rebuilds the preview video's sound from the tones the game logged.

  python3 scripts/preview-audio.py <work dir>   # reads tones.json, writes audio.wav

Each tone is synthesised the way game.js plays it (oscillator, 10 ms attack,
exponential decay), over a soft pad, with a chime on the end card.
"""
import json
import sys
import wave

import numpy as np

SR = 44100


def osc(kind, phase):
    if kind == 'sine':
        return np.sin(phase)
    frac = (phase / (2 * np.pi)) % 1.0
    if kind == 'square':
        return np.where(frac < 0.5, 1.0, -1.0)
    if kind == 'sawtooth':
        return 2 * frac - 1
    return 4 * np.abs(frac - 0.5) - 1  # triangle


def tone(out, t, freq, dur, kind='sine', vol=0.2, slide=0):
    n = int((dur + 0.05) * SR)
    i0 = int(t * SR)
    if i0 >= len(out):
        return
    tt = np.arange(n) / SR
    f = freq * (slide / freq) ** np.clip(tt / dur, 0, 1) if slide else np.full(n, freq)
    phase = 2 * np.pi * np.cumsum(f) / SR
    env = np.where(tt < 0.01, 0.0001 * (vol / 0.0001) ** (tt / 0.01),
                   vol * (0.0001 / vol) ** np.clip((tt - 0.01) / max(dur - 0.01, 1e-3), 0, 1))
    seg = osc(kind, phase) * env
    end = min(len(out), i0 + n)
    out[i0:end] += seg[: end - i0]


def main():
    work = sys.argv[1]
    data = json.load(open(f'{work}/tones.json'))
    total = data['seconds']
    out = np.zeros(int(total * SR))
    for t, freq, dur, kind, vol, slide in data['tones']:
        tone(out, t, freq, dur, kind, vol, slide)
    out *= 0.6  # game master gain
    # soft pad: two chords, faded in and out
    pad = np.zeros_like(out)
    tt = np.arange(len(out)) / SR
    for start, notes in ((0, (261.63, 329.63, 392.0)), (total / 2, (220.0, 293.66, 349.23))):
        m = (tt >= start) & (tt < start + total / 2 + 0.5)
        for nf in notes:
            pad[m] += np.sin(2 * np.pi * nf * tt[m]) * 0.03
    pad *= np.clip(tt / 0.6, 0, 1) * np.clip((total - tt) / 0.8, 0, 1)
    out += pad
    # end card chime
    card = data['card']
    for i, nf in enumerate((1046.5, 1318.5, 1568.0, 2093.0)):
        tone(out, card + i * 0.09, nf, 0.9, 'sine', 0.12)
    out = np.tanh(out * 2.8) / np.tanh(2.8)
    out *= np.clip((total - tt) / 0.3, 0, 1)
    pcm = (np.clip(out, -1, 1) * 32000).astype('<i2')
    with wave.open(f'{work}/audio.wav', 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    main()
