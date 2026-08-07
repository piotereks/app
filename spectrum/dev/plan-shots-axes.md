# Plan: Axis visibility + dB scales + spectrum colors + screenshot overhaul + test harness

Agreed scope. Repo: `WebAudioSpectrum` (vanilla JS, no build/test infra). All implementation happens in `audioSpectrum.js` + `index.html`; a dev-only Playwright harness is isolated in `dev/test/`.

## A. Axis visibility (req 1) — files: `audioSpectrum.js`, `index.html`

Problem: axis tick labels are `rgba(255,255,255,0.7)` @ 10px drawn directly over the black chart with no backing strip, so they wash out against the colored spectrum/spectrogram.

- `drawFrequencyAxis` (X) and `drawYAxis` (Y): raise label opacity 0.7 → 0.95, font 10px → 11px, weight 500.
- Draw a small semi-opaque dark pill/rounded-rect behind each X and Y tick label so they stay legible regardless of the data behind them.
- Reserve a narrow left gutter (~34px) on the spectrum and spectrogram plots so Y labels don't overlap the drawn curve/columns.
- Match the surrounding indentation style of the edited blocks.

## B. dB Y-axis — frequency spectrum (req 2) — file: `audioSpectrum.js`

The byte values are already dB-linear: `v = (db − DB_FLOOR) / (0 − DB_FLOOR) · 255`.

- In `drawYAxis` (`type === 'amplitude'`), **replace** the `AMPLITUDE_TICKS [0,64,128,192,255]` labels with dBFS values computed at the equivalent byte positions.
- New major ticks every 30 dB: `-90, -60, -30, 0` at byte positions `0, 85, 170, 255`.
- Remove `AMPLITUDE_TICKS` const; add `AMPLITUDE_DB_TICKS` (pairs of byte position → dB label, or compute position from dB).
- The 0..255 → dB mapping already matches what `computeSpectrumBytes`/the built-in path emit, so no data changes needed.

## C. dB Y-axis — oscilloscope (req 4) — file: `audioSpectrum.js`

- In `drawScopeTrace`, add a left vertical dBFS reference grid: symmetric ticks computed from amplitude via `10 · log10(|a| / FS)`, e.g. `0 / -3 / -6 / -10 / -20 / -40 dB`, labeled in a small left gutter.
- Applied in both the normal (analyser byte trace) and standing-wave (locked) draw paths — `drawScopeTrace` already runs for both.
- Keep the waveform centered; axis is decorative/readout only (does not alter the trace).

## D. Spectrum spectrogram-colored fill (req 3) — files: `audioSpectrum.js`, `index.html`

Per decision: reuse the existing **Colors** button (shared Rainbow/Teal 256-color table from `getSpectrogramColorTable()`).

- Add a top-level const predicate `spectrumFillColors` that follows `spectrogramColorMode`.
- New standalone toggle button `toggleSpecFill` (add to controls; icon + label), persisted as localStorage `waSpectrumSpecFill`, restored on load and mirrored.
- In `drawSpectrum`, when enabled, draw the area between the curve and the x-axis as per-bin filled columns using `colors[bin]` (from the shared table) instead of the single flat `rgba(...)` polygon; keep a bright outline on top.
- When disabled, keep the existing flat-polygon look (current default).
- If colors are enabled for the spectrum, switching `Colors` updates both charts and rebuilds the table once (reuse existing `spectrogramColorTable` lifecycle).

## E. Screenshot — memory-buffer route with padding (req 5) — file: `audioSpectrum.js`

Problem: on-mobile (Samsung) screenshots clip edge labels.

- Add `captureToBuffer(sourceCanvas, pad, scale)` → returns an offscreen canvas holding an exact copy of the canvas content plus a `pad` margin (dark background), rendered at `scale = min(2, window.devicePixelRatio || 1)` so edge labels are not clipped and remain crisp.
- Rewrite `captureChart` to build the offscreen buffer with X/Y padding around the chart + the label overlay (reuse existing CW-rotation logic for landscape) before `toDataURL`.
- Route the page-level `Shot` (`captureElement`/html2canvas) output through the same padded-buffer step before download so it avoids the label clipping too.
- Note: home DPR handling for screenshots only (keeps the wheel/normal-canvas DPR gap as-is in `dev/roadmap.md`).

## F. Download filename scheme (reqs 6–8) — file: `audioSpectrum.js`

Centralize base names and update call sites:

- freq-spec chart (`data-fs-key="spec"`) → `freq_spec_<stamp>.png`
- spectrogram chart (`data-fs-key="specgram"`) → `spectrum_<stamp>.png`
- oscilloscope chart (`data-fs-key="osc"`) → `osc_<stamp>.png` (kept consistent; not explicitly requested)
- recording WAV/MP3 → `spectrum_rec_<stamp>.<wav|mp3>`
- page-level Shot → `screenshot_<stamp>.png` (kept)

Implementation:
- Add `FSCAP_KEY_TO_BASENAME` map keyed by `data-fs-key`; use it when the per-container `captureChart` buttons fire (currently `captureChart(container, 'chart-' + key)`).
- Change `downloadBlob` to use basename `spectrum_rec_` (currently `recording-`).
- `fileStamp()`/`downloadCanvas()` reused unchanged.

## G. Test harness — desktop + mobile screenshots (req 9) — new `dev/test/`, `audioSpectrum.js`

Per user decision: dev-only Playwright harness (repo otherwise stays build-free).

Synthetic mode (in `audioSpectrum.js`):
- `?synthetic=1` URL param → on load, create the `AudioContext`/`analyser`/sizes, **skip** `getUserMedia` (`startAudio`), and feed `drawSpectrum` `liveData` + the scope ring/time samples from a deterministic built-in waveform (e.g. sum of a few sines) so all charts render repeatably without a mic.
- Guarded and fully self-contained; any preview/visible route.

Harness (isolated so the runtime page + gh-pages build stay clean):
- `dev/test/package.json` with a `shot` script; dev dep `@playwright/test` (or `playwright`).
- `dev/test/capture.mjs` (Node ES module): serve repo root at `http://localhost:8000` (Playwright static or `python3 -m http.server`), open `/?synthetic=1`.
  - Desktop viewport ~1440×900, dpr 1, desktop Chrome UA.
  - Mobile viewport ~412×915, Samsung Galaxy UA, dpr 2.625.
  - Capture the full page and the two charts; save to `dev/test/shots/`.
- Example output files delivered for req 9: `freq_spec_desktop.png`, `spectrum_desktop.png`, `freq_spec_mobile.png`, `spectrum_mobile.png`, plus a full-page `overview_*`.
- `.gitignore` `dev/test/node_modules/`.
- Install browsers on first run via `npx playwright install chromium` (or the harness prints the command).

## Files touched

- `audioSpectrum.js` — axis labels/backdrops, dB axes (spec + scope), spectrum columnar fill + toggle, capture-buffer helper + basenames, synthetic route.
- `index.html` — spectrum-fill toggle button, gutter/label CSS.
- `dev/test/package.json`, `dev/test/capture.mjs`, `.gitignore`.
- `SNAPSHOT.md` (state change record), `dev/roadmap.md` (tick relevant boxes), `AGENTS.md` (running notes: `?synthetic=1`, harness command).
- New: `dev/plan-shots-axes.md` (this file).

## Verify

- Manual: serve over `http://localhost:8000`, Start Sampling, toggle charts/colors; confirm legible axis labels, correct dB labels, spectrum rainbow/teal fill, no clipped screenshot edges, new filenames.
- Automated (req 9): `cd dev/test && npm i && npm run shot` → desktop + mobile PNGs; eyeball against manual captures.
- No test framework beyond the Playwright harness; nothing else to run.

## Notes
- This plan is the agreed spec; implementation is split into the steps above. Ask before running anything (installing Playwright, starting servers, committing). No commits unless requested.