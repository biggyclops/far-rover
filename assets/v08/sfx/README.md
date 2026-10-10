# Far Rover v0.8 — SFX

Synthesized entirely in code (Python + numpy/scipy, encoded with ffmpeg). No samples.
Source: `../sfx-src/synth_sfx.py` (synthesis), `../sfx-src/encode_verify.py` (encode + ffprobe checks + loop seam test + preview).
WAV masters: `../sfx-src/wav/`. Preview: `../sfx-src/preview-sfx.png`. Full check results: `../sfx-src/verify-report.json`.

All files: mono, 44.1 kHz, as both `.ogg` (libvorbis q5) and `.mp3` (libmp3lame 128k).
Family: key centre D (D5/F#5/A5/D6, D2 sub), shared soft 2:1 FM-sine timbre, band-limited noise texture, very short early-reflection "plate" at most (vacuum, no reverb tails).

| File | Duration | Peak (master) | Size ogg / mp3 | Use |
|---|---|---|---|---|
| `select.ogg` / `.mp3` | 0.110 s | -3.0 dBFS | 4.9 KB / 3.0 KB | Unit/building selected. Very frequent: keep at default or lower volume. |
| `order.ogg` / `.mp3` | 0.160 s | -3.0 dBFS | 5.5 KB / 3.8 KB | Move/build order acknowledged. Very frequent. |
| `build-complete.ogg` / `.mp3` | 0.850 s | -1.0 dBFS | 8.4 KB / 14.7 KB | Structure finished (habitat, rim solar, printer, storage). |
| `notify.ogg` / `.mp3` | 0.950 s | -1.0 dBFS | 12.7 KB / 16.3 KB | Scout "Notify" ping: long-range beacon / something found. |
| `dig-loop.ogg` / `.mp3` | 2.000 s | -6.0 dBFS | 22.0 KB / 33.1 KB | Tunnel boring in progress. **Play with `loop = true`**; stop (with a short ~50–100 ms gain fade) when boring ends. |

Notes
- **dig-loop must be played with `loop=true`.** It is exactly periodic (2.000 s = 88,200 samples), so its ends are intentionally *not* faded.
  Prefer the `.ogg` for looping (sample-exact length). The `.mp3` decodes to exactly 88,200 samples when the decoder honours the LAME gapless header
  (ffmpeg/Chrome/Firefox do); a decoder that ignores it would play ~25 ms of encoder padding at the loop point. For Web Audio, use an `AudioBufferSourceNode` with `loop = true` rather than an `<audio loop>` element for a gap-free loop.
- The one-shots start within <1 ms (no leading silence) and end with a fade to zero.
- ffprobe reports MP3 container durations ~40–50 ms longer than the content (encoder delay/padding in whole 1152-sample frames); decoded length matches the master.
- Lossy encoding moves peaks slightly (about ±0.5 dB around the targets).
