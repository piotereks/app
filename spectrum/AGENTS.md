# AGENTS.md

Vanilla-JS Web Audio spectrum analyzer. No package.json, no build step, no tests, no lint config — do not invent npm commands. Bootstrap CSS is loaded from CDN; no assets are vendored.

Repo state at a point in time is recorded in `SNAPSHOT.md` (git HEAD, file inventory, known gaps); update it whenever the state changes materially.

Never create commits in this repo unless explicitly asked; leave the working tree to the user.

## Running / testing

- Mic access (`getUserMedia`) requires a secure context: serve over `http://localhost` or HTTPS. Opening `index.html` via `file://` will fail.
- `python3 -m http.server 8000` in the repo root is sufficient.
- No test framework exists; verify changes manually in a browser (Start Sampling → toggle buttons). The demo URL in README (`deftio.github.io`) predates the current origin fork (`piotereks/WebAudioSpectrum`); don't treat it as canonical.

## File map

- `index.html` — main app; loads `audioSpectrum.js` at end of body.
- `audioSpectrum.js` — all logic; lives entirely inside a `DOMContentLoaded` closure, all state in closures.
- `singlepage.html` — legacy self-contained implementation (AudioWorklet-based), superseded by `index.html`. Do not port features from it unless intentional.
- `dev/original-web-audio-spectrum.html` — early prototype, historical.
- `dev/roadmap.md` — tracked todo list; unchecked boxes are open work. Check before implementing anything that looks like an existing plan.

## audioSpectrum.js architecture

- Animation loop: `updateSpectrum()` re-queues `requestAnimationFrame` only while `audioContext.state === 'running'`; the loop is started by the Start/Stop button. `drawSpectrum()` calls `drawSpectrogram()` itself — spectrogram updates are coupled to spectrum drawing.
- Two spectrum paths (chosen by Window button):
  - Default: `analyser.getByteFrequencyData()` — relies on built-in `smoothingTimeConstant = 0.85` (always set).
  - Hamming: `computeSpectrumBytes()` — custom radix-2 FFT (`fftRadix2InPlace`) over `getFloatTimeDomainData` with gain-compensated Hamming window. Note this path ALWAYS applies EMA smoothing (`CUSTOM_SMOOTH_ALPHA = 0.8`) regardless of the Smooth button; the Smooth button only toggles the moving-average filter in `drawSpectrum()`.
- All tunable settings are named consts at the top of the closure: `ANALYSER_FFT_SIZE = 2048`, `ANALYSER_MAX_FFT_SIZE = 32768`, `ANALYSER_SMOOTHING = 0.85`, `BASE_SPECTROGRAM_FRAMES = 100` (spectrogram history base, scales with canvas height up to `MAX_SPECTROGRAM_FRAMES = 1000` so a maximized spectrogram shows proportionally more seconds), `OSCILLOSCOPE_SAMPLES = 4096`, `DB_FLOOR = -90`, plus `MONITOR_GAIN`, `REC_CHUNK_SIZE`, `DISPLAY_BINS`, `RING_SIZE`, `HIGH_RES_MAX`, `MAX_HR_FFT_SIZE`, `HR_THROTTLE`, `MAX_INPUT_GAIN`, `GAIN_STEP`, and axis/timing consts (`AXIS_TICK_TARGET_PX`, `AXIS_TIME_TICKS`, `AMPLITUDE_TICKS`, `AVERAGE_UPDATE_MS`, `AVG_HISTORY_MARGIN`, `SMOOTH_WINDOW_LOG/LINEAR`, `MIN_SPECTROGRAM_FRAMES`, `REC_TIMER_MS`, `FULLSCREEN_SETTLE_MS`, `URL_REVOKE_MS`).
- Known intentional gaps (in roadmap): no `devicePixelRatio` handling, canvases sized in CSS pixels, no debounce on resize.
- Every toggle/select setting (Window, Smooth, Colors, High-Res, Osc + scope scale, Scale/Avg, Max-Freq, Rec-Format) persists to localStorage under `waSpectrum*` keys and is restored with UI mirrored on load; the session-only Rec/Monitor/Start buttons are excluded. Full key list in `SNAPSHOT.md`.
- Oscilloscope standing-wave mode: when a stable dominant frequency is detected (FFT argmax over the last `OSCILLOSCOPE_SAMPLES` ring-buffer samples with parabolic interpolation, 5% drift gate held ~0.2s), the trace reads the ring buffer one period behind the newest sample (fractional positions interpolated) so a steady tone renders phase-frozen instead of scrolling; it falls back to the plain analyser trace when the frequency is unstable or the signal too quiet. Lock tunables: `SCOPE_LOCK_MIN_FREQ`, `SCOPE_LOCK_MAX_FREQ`, `SCOPE_MIN_RMS`, `SCOPE_FREQ_EMA_ALPHA`, `SCOPE_FREQ_STABLE_RATIO`, `SCOPE_LOCK_FRAMES`, `SCOPE_LOCK_RELEASE_FRAMES`. The rec graph (`ensureRecGraph()`) is now connected unconditionally at `startAudio` so the ring buffer is always fed (the standing-wave read and the HR FFT both depend on it).

## Style

- Mixed tabs/spaces exist in `audioSpectrum.js` (mostly 4-space, newer additions use tabs) — match the indentation of the surrounding block, not a global rule. No comments unless the codebase style calls for it (JS is sparingly commented).
- 2-space indent in HTML files.
