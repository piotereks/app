// This script is used to create a simple audio spectrum visualizer using the Web Audio API.
// It creates a canvas element and draws the audio spectrum data on it in real-time.
// The script also includes a button to start and stop the audio sampling and toggle the frequency scale.

document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('toggle');
    const scaleSelect = document.getElementById('scaleSelect');
    const avgSecondsSelect = document.getElementById('avgSeconds');
    const windowBtn = document.getElementById('toggleWindow');
    const oscilloscopeBtn = document.getElementById('toggleOscilloscope');
    const oscilloscopeScaleBtn = document.getElementById('toggleOscilloscopeScale');
    const canvas = document.getElementById('spectrumCanvas');
    const ctx = canvas.getContext('2d');
    const spectrogramCanvas = document.getElementById('spectrogramCanvas');
    const spectrogramCtx = spectrogramCanvas.getContext('2d');
    const oscilloscopeCanvas = document.getElementById('oscilloscopeCanvas');
    const oscilloscopeCtx = oscilloscopeCanvas.getContext('2d');
    const oscilloscopeContainer = document.getElementById('oscilloscopeContainer');
    const oscilloscopeLabel = document.getElementById('oscilloscopeLabel');
    const spectrumLabel = document.getElementById('spectrumLabel');
    const spectrogramLabel = document.getElementById('spectrogramLabel');
	const smoothBtn = document.getElementById('toggleSmooth');
	const maxFreqSelect = document.getElementById('maxFreqSelect');
	const algoBtn = document.getElementById('toggleAlgo');
	const recBtn = document.getElementById('recBtn');
	const recFormat = document.getElementById('recFormat');
	recFormat.addEventListener('change', function () {
		savePref('waSpectrumRecFormat', recFormat.value);
	});
	const monitorBtn = document.getElementById('toggleMonitor');
	const inputDeviceSelect = document.getElementById('inputDevice');
	const outputDeviceSelect = document.getElementById('outputDevice');
	const spectrogramColorsBtn = document.getElementById('toggleSpectrogramColors');
	const inputGainRange = document.getElementById('inputGainRange');
	const inputGainLabel = document.getElementById('inputGainLabel');
    
    function resizeCanvases() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        spectrogramCanvas.width = spectrogramCanvas.offsetWidth;
        spectrogramCanvas.height = spectrogramCanvas.offsetHeight;
        oscilloscopeCanvas.width = oscilloscopeCanvas.offsetWidth;
        oscilloscopeCanvas.height = oscilloscopeCanvas.offsetHeight;
    }

    function handleResize() {
        resizeCanvases();
        redrawCharts();
    }
    
    resizeCanvases();

	document.querySelectorAll('.maximize-btn').forEach(function (btn) {
		btn.addEventListener('click', function () {
			const container = btn.closest('.canvas-container');
			if (!container) return;
			// Resize on the promise + a delayed pass: fullscreenchange can fire before the
			// :fullscreen CSS layout settles, which leaves canvases at their old bitmap size
			const settle = function () {
				handleResize();
				setTimeout(handleResize, FULLSCREEN_SETTLE_MS);
			};
			if (document.fullscreenElement === container) {
				document.exitFullscreen().then(settle).catch(function () {});
			} else if (container.requestFullscreen) {
				container.requestFullscreen().then(settle).catch(function () {});
			}
		});
	});

	document.addEventListener('fullscreenchange', function () {
		handleResize();
		document.querySelectorAll('.maximize-btn').forEach(function (btn) {
			const isFullscreen = document.fullscreenElement === btn.closest('.canvas-container');
			btn.title = isFullscreen ? 'Minimize' : 'Maximize';
			btn.setAttribute('aria-label', isFullscreen ? 'Minimize' : 'Maximize');
		});
	});

	// Coalesce resize bursts to one pass per animation frame so charts track the
	// window in real time without rebuilding chart state on every resize event
	window.addEventListener('resize', function () {
		if (resizeRaf) return;
		resizeRaf = requestAnimationFrame(function () {
			resizeRaf = null;
			handleResize();
		});
	});

	// ResizeObserver: sync bitmaps whenever a canvas element's CSS size changes,
	// regardless of which event (or lack of one) caused it
	if (typeof ResizeObserver !== 'undefined') {
		const resizeObserver = new ResizeObserver(function () {
			handleResize();
		});
		resizeObserver.observe(canvas);
		resizeObserver.observe(spectrogramCanvas);
		resizeObserver.observe(oscilloscopeCanvas);
	}

    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let timeDataArray = null;
    let bufferLength = null;
    let spectrogramData = [];
    let scaleMode = 'linear'; // 'linear', 'log', 'average'
    let axisMode = 'linear'; // last Linear/Log selection; used by the spectrogram while Average is active
	let useHammingWindow = false;
    let showOscilloscope = false;
    let oscilloscopeScaleMode = 'linear'; // 'linear', 'log', 'compand'
	let useSmoothing = false;
	let maxFreqHz = maxFreqSelect.value ? parseInt(maxFreqSelect.value, 10) : null;
	let micStream = null;
	let sourceNode = null;
	let inputGain = null;
	let analyserLimiter = null;
	let recProcessor = null;
	let recProcessorConnected = false;
	let monitorGain = null;
	let isRecording = false;
	let recChunks = [];
	let recTotalSamples = 0;
	let recStartTime = null;
	let recTimerId = null;
	let monitorOn = false;
	function loadPref(key) {
		try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
	}
	function savePref(key, val) {
		try { localStorage.setItem(key, val); } catch (e) {}
	}
	let selectedInputId = loadPref('waSpectrumInput');
	let selectedOutputId = loadPref('waSpectrumOutput');
	const MAX_INPUT_GAIN = 4; // Volume slider max (400%)
	const GAIN_STEP = 0.05; // Volume slider step
	const savedGain = loadPref('waSpectrumInputGain');
	if (savedGain !== '') inputGainRange.value = savedGain;
	inputGainRange.max = String(MAX_INPUT_GAIN);
	inputGainRange.step = String(GAIN_STEP);
	inputGainLabel.textContent = Math.round(parseFloat(inputGainRange.value) * 100) + '%';
	inputGainRange.addEventListener('input', function () {
		const v = parseFloat(inputGainRange.value);
		inputGainLabel.textContent = Math.round(v * 100) + '%';
		if (inputGain) inputGain.gain.value = v;
		savePref('waSpectrumInputGain', String(v));
	});
	const MONITOR_GAIN = 0.7; // Monitor passthrough gain
	const REC_CHUNK_SIZE = 4096; // ScriptProcessor chunk size (samples)
	const DISPLAY_BINS = 1024; // Display resolution (buckets per chart). Lower = lighter CPU load; tune this
	const RING_SIZE = 65536; // Ring-buffer size (samples) for the HR FFT path
	const HIGH_RES_MAX = 1000; // Windows at/below this get ring-buffer FFT beyond analyser fftSize cap
	const MAX_HR_FFT_SIZE = 32768; // Cap for the high-res ring-buffer FFT size (points). Lower = lighter CPU load; tune this
	const HR_THROTTLE = 2; // Recompute the HR FFT only every N-th frame
	const ANALYSER_FFT_SIZE = 2048; // Base analyser FFT size
	const ANALYSER_MAX_FFT_SIZE = 32768; // Cap for the analyser FFT size when max-freq is set
	const ANALYSER_SMOOTHING = 0.85; // Built-in spectrum smoothing (time constant)
	const DB_FLOOR = -90; // dB floor for the spectrum/spectrogram scale
	const DB_LOG_EPSILON = 1e-12; // Avoid log10(0) on silent bins
	const DEFAULT_AVG_SECONDS = 10; // Rolling-average window default (matches the Avg dropdown)
	const AVERAGE_UPDATE_MS = 1000; // Recompute the rolling average at most this often
	const AVG_HISTORY_MARGIN = 60; // Extra rolling-average history (frames) beyond avgSeconds * 60
	const SMOOTH_WINDOW_LOG = 5; // Moving-average window for the Smooth button (log axis)
	const SMOOTH_WINDOW_LINEAR = 3; // Moving-average window for the Smooth button (linear axis)
	const MIN_SPECTROGRAM_FRAMES = 30; // Floor for spectrogram history frames
	const AXIS_TICK_TARGET_PX = 90; // Aim this many px between linear axis ticks
	const AXIS_TIME_TICKS = 5; // Horizontal grid/label rows on the spectrogram y-axis
	const AMPLITUDE_TICKS = [0, 64, 128, 192, 255]; // Spectrum y-axis tick positions
	const REC_TIMER_MS = 100; // Record elapsed-time tooltip refresh interval
	const FULLSCREEN_SETTLE_MS = 100; // Delayed resize pass after fullscreenchange
	const URL_REVOKE_MS = 1000; // Delay before revoking the download object URL
	const COMPRESSOR_THRESHOLD_DB = -3; // Limiter: boosted peaks are held at this level
	const COMPRESSOR_RATIO = 20; // High ratio = limiter behavior (caps peaks, leaves the floor alone)
	const COMPRESSOR_KNEE_DB = 6; // Soft knee width (dB)
	const COMPRESSOR_ATTACK_S = 0.003; // Limiter attack (s)
	const COMPRESSOR_RELEASE_S = 0.25; // Limiter release (s)
	let highResActive = false;
	let useLightAlgo = true; // High-res off by default
	let hrFftSize = ANALYSER_FFT_SIZE;
	let hrFrameCount = 0;
	let hrCached = null;
	let ringBuffer = null;
	let ringPos = 0;
	let ringFilled = 0;
	let avgHistory = []; // Uint8Array frames for the rolling average
	let avgHistoryTimes = []; // ms timestamps, parallel to avgHistory
	let avgSpectrum = null;
	let avgSeconds = DEFAULT_AVG_SECONDS;
	let lastAvgUpdate = 0;
    const BASE_SPECTROGRAM_FRAMES = 100; // Spectrogram history (frames) at the base canvas height
    const MAX_SPECTROGRAM_FRAMES = 1000; // Cap on history; scales with canvas height (maximized view)
    let baseSpectrogramHeight = 0; // Canvas height at load; taller canvas = longer visible history
    baseSpectrogramHeight = spectrogramCanvas.height;
    const OSCILLOSCOPE_SAMPLES = 4096; // Double the FFT size for longer time window
	// Standing-wave (phase-locked) oscilloscope: once the dominant frequency is
	// stable, the trace reads the ring buffer one period behind the newest sample,
	// so a steady tone renders as a frozen waveform instead of scrolling
	const SCOPE_LOCK_MIN_FREQ = 30; // Only phase-lock above this frequency (Hz)
	const SCOPE_LOCK_MAX_FREQ = 2000; // Only phase-lock below this frequency (Hz)
	const SCOPE_MIN_RMS = 0.003; // Minimum window RMS to attempt phase-locking
	const SCOPE_FREQ_EMA_ALPHA = 0.1; // Smoothing for the tracked frequency
	const SCOPE_FREQ_STABLE_RATIO = 0.05; // Max relative drift to consider the frequency stable
	const SCOPE_LOCK_FRAMES = 12; // Consecutive stable frames before locking (~0.2s)
	const SCOPE_LOCK_RELEASE_FRAMES = 30; // Unstable frames before releasing the lock (~0.5s)
	let scopeFreqSmooth = 0; // EMA of the tracked dominant frequency
	let scopeStableFrames = 0; // Consecutive frames within the stability ratio
	let scopeReleaseFrames = 0; // Consecutive unstable frames while locked
	let scopeLocked = false; // Standing-wave lock active
	let scopeTargetPhase = 0; // Locked read-phase (0..1) at the window end
	const scopeFftRe = new Float32Array(OSCILLOSCOPE_SAMPLES);
	const scopeFftIm = new Float32Array(OSCILLOSCOPE_SAMPLES);
	let hammingTimeWeights = null; // Precomputed, gain-compensated Hamming window for time-domain samples
	let fftWorkRe = null;
	let fftWorkIm = null;
	const CUSTOM_SMOOTH_ALPHA = 0.8; // For custom FFT path smoothing
	let customSmoothPrev = null; // Uint8Array for EMA smoothing on custom path
	let lastLiveData = null; // Copy of the last live spectrum frame, for redraws while suspended
	let resizeRaf = null;
	const spectrogramCache = document.createElement('canvas');
	const spectrogramCacheCtx = spectrogramCache.getContext('2d');
	let spectrogramCacheVersion = '';
	let spectrogramEpoch = 0; // Bumped when spectrogramData is cleared; forces cache rebuild
	const SPECTROGRAM_TEAL = 'teal';
	const SPECTROGRAM_RAINBOW = 'rainbow';
	let spectrogramColorMode = SPECTROGRAM_RAINBOW;
	let spectrogramColorTable = null;
	// Restore persisted toggle/select settings (rec/monitor/start are session-only)
	function loadTogglePref(key) {
		return loadPref(key) === '1';
	}
	showOscilloscope = loadTogglePref('waSpectrumOscShow');
	const savedScopeScale = loadPref('waSpectrumScopeScale');
	if (savedScopeScale === 'log' || savedScopeScale === 'compand') oscilloscopeScaleMode = savedScopeScale;
	const savedScale = loadPref('waSpectrumScale');
	if (savedScale === 'log' || savedScale === 'average') {
		scaleMode = savedScale;
		if (savedScale !== 'average') axisMode = savedScale;
	}
	const savedAvg = loadPref('waSpectrumAvg');
	if (savedAvg === '1' || savedAvg === '5' || savedAvg === '10' || savedAvg === '20' || savedAvg === '30') avgSeconds = parseInt(savedAvg, 10);
	useHammingWindow = loadTogglePref('waSpectrumWindow');
	useSmoothing = loadTogglePref('waSpectrumSmooth');
	useLightAlgo = loadTogglePref('waSpectrumAlgo');
	const savedColors = loadPref('waSpectrumColors');
	if (savedColors === SPECTROGRAM_TEAL) spectrogramColorMode = SPECTROGRAM_TEAL;
	const savedMaxFreq = loadPref('waSpectrumMaxFreq');
	let savedMaxFreqValid = false;
	for (let i = 0; i < maxFreqSelect.options.length; i++) {
		if (maxFreqSelect.options[i].value === savedMaxFreq) { savedMaxFreqValid = true; break; }
	}
	if (savedMaxFreqValid) {
		maxFreqSelect.value = savedMaxFreq;
		maxFreqHz = savedMaxFreq === '' ? null : parseInt(savedMaxFreq, 10);
	}
	const savedRecFormat = loadPref('waSpectrumRecFormat');
	if (savedRecFormat === 'mp3' || savedRecFormat === 'wav') recFormat.value = savedRecFormat;
	// Mirror restored state onto the UI
	oscilloscopeBtn.classList.toggle('active', showOscilloscope);
	oscilloscopeBtn.title = showOscilloscope ? 'Hide oscilloscope' : 'Show oscilloscope';
	oscilloscopeContainer.classList.toggle('show', showOscilloscope);
	oscilloscopeScaleBtn.style.display = showOscilloscope ? 'inline-block' : 'none';
	oscilloscopeScaleBtn.textContent = oscilloscopeScaleMode === 'log' ? 'Log' : (oscilloscopeScaleMode === 'compand' ? 'Comp' : 'Lin');
	oscilloscopeScaleBtn.title = 'Oscilloscope scale: ' + oscilloscopeScaleMode.charAt(0).toUpperCase() + oscilloscopeScaleMode.slice(1);
	oscilloscopeScaleBtn.classList.toggle('active', oscilloscopeScaleMode !== 'linear');
	scaleSelect.value = scaleMode;
	avgSecondsSelect.value = String(avgSeconds);
	windowBtn.title = useHammingWindow ? 'Window: Hamming' : 'Window: Rectangular';
	windowBtn.classList.toggle('active', useHammingWindow);
	smoothBtn.title = useSmoothing ? 'Smooth: On' : 'Smooth: Off';
	smoothBtn.classList.toggle('active', useSmoothing);
	algoBtn.title = useLightAlgo ? 'High-Res: Off' : 'High-Res: On';
	algoBtn.classList.toggle('active', useLightAlgo);
	spectrogramColorsBtn.title = spectrogramColorMode === SPECTROGRAM_RAINBOW ? 'Colors: Rainbow' : 'Colors: Teal';
	spectrogramColorsBtn.classList.toggle('active', spectrogramColorMode === SPECTROGRAM_RAINBOW);
	updateScaleLabels();
	if (showOscilloscope) {
		const modeText = oscilloscopeScaleMode.charAt(0).toUpperCase() + oscilloscopeScaleMode.slice(1);
		oscilloscopeLabel.textContent = `Oscilloscope (Time Domain) - ${modeText}`;
		resizeCanvases();
	}
	// Classic "jet"/thermal colormap stops (the colors used by many spectrograms)
	const RAINBOW_STOPS = [
		[0, [0, 0, 128]],
		[0.125, [0, 0, 255]],
		[0.375, [0, 255, 255]],
		[0.625, [255, 255, 0]],
		[0.875, [255, 0, 0]],
		[1, [128, 0, 0]]
	];
	function buildSpectrogramColorTable() {
		const table = new Array(256);
		for (let i = 0; i < 256; i++) {
			if (spectrogramColorMode === SPECTROGRAM_TEAL) {
				const v = Math.round(i * 255 / 256);
				table[i] = `rgb(0, ${v}, ${v})`;
			} else {
				const t = i / 255;
				let r = 0, g = 0, b = 0;
				for (let s = 0; s < RAINBOW_STOPS.length - 1; s++) {
					const t0 = RAINBOW_STOPS[s][0];
					const rgb0 = RAINBOW_STOPS[s][1];
					const t1 = RAINBOW_STOPS[s + 1][0];
					const rgb1 = RAINBOW_STOPS[s + 1][1];
					if (t >= t0 && t <= t1) {
						const f = (t - t0) / (t1 - t0);
						r = Math.round(rgb0[0] + (rgb1[0] - rgb0[0]) * f);
						g = Math.round(rgb0[1] + (rgb1[1] - rgb0[1]) * f);
						b = Math.round(rgb0[2] + (rgb1[2] - rgb0[2]) * f);
						break;
					}
				}
				table[i] = `rgb(${r}, ${g}, ${b})`;
			}
		}
		return table;
	}
	function getSpectrogramColorTable() {
		if (!spectrogramColorTable) spectrogramColorTable = buildSpectrogramColorTable();
		return spectrogramColorTable;
	}
	spectrogramColorsBtn.addEventListener('click', function () {
		spectrogramColorMode = spectrogramColorMode === SPECTROGRAM_TEAL ? SPECTROGRAM_RAINBOW : SPECTROGRAM_TEAL;
		spectrogramColorTable = null;
		spectrogramColorsBtn.title = spectrogramColorMode === SPECTROGRAM_RAINBOW ? 'Colors: Rainbow' : 'Colors: Teal';
		spectrogramColorsBtn.classList.toggle('active', spectrogramColorMode === SPECTROGRAM_RAINBOW);
		savePref('waSpectrumColors', spectrogramColorMode);
	});
    scaleSelect.addEventListener('change', function () {
        scaleMode = scaleSelect.value;
        if (scaleMode !== 'average') axisMode = scaleMode;
        updateScaleLabels();
        lastAvgUpdate = 0; // Recompute the average immediately
        savePref('waSpectrumScale', scaleMode);
        console.log("Scale mode is now " + scaleMode);
    });

    avgSecondsSelect.addEventListener('change', function () {
        avgSeconds = parseInt(avgSecondsSelect.value, 10) || 10;
        updateScaleLabels();
        lastAvgUpdate = 0;
        savePref('waSpectrumAvg', String(avgSeconds));
    });

    function updateScaleLabels() {
        const axisText = axisMode === 'log' ? 'Log' : 'Linear';
        spectrumLabel.textContent = scaleMode === 'average'
            ? `Frequency Spectrum - Average (${avgSeconds}s)`
            : `Frequency Spectrum - ${axisText}`;
        spectrogramLabel.textContent = `Spectrogram (Time-Frequency) - ${axisText}`;
    }

    windowBtn.addEventListener('click', function () {
        useHammingWindow = !useHammingWindow;
        windowBtn.title = useHammingWindow ? "Window: Hamming" : "Window: Rectangular";
        windowBtn.classList.toggle('active', useHammingWindow);
        savePref('waSpectrumWindow', useHammingWindow ? '1' : '0');
    });

	smoothBtn.addEventListener('click', function () {
		useSmoothing = !useSmoothing;
		smoothBtn.title = useSmoothing ? 'Smooth: On' : 'Smooth: Off';
		smoothBtn.classList.toggle('active', useSmoothing);
		savePref('waSpectrumSmooth', useSmoothing ? '1' : '0');
	});

	maxFreqSelect.addEventListener('change', function () {
		maxFreqHz = maxFreqSelect.value ? parseInt(maxFreqSelect.value, 10) : null;
		applyMaxFreqResolution();
		savePref('waSpectrumMaxFreq', maxFreqSelect.value);
	});

	algoBtn.addEventListener('click', function () {
		useLightAlgo = !useLightAlgo;
		algoBtn.title = useLightAlgo ? 'High-Res: Off' : 'High-Res: On';
		algoBtn.classList.toggle('active', useLightAlgo);
		applyMaxFreqResolution();
		savePref('waSpectrumAlgo', useLightAlgo ? '1' : '0');
	});

	monitorBtn.addEventListener('click', function () {
		if (!audioContext || !sourceNode) return;
		ensureRecGraph();
		monitorOn = !monitorOn;
		monitorGain.gain.value = monitorOn ? MONITOR_GAIN : 0;
		monitorBtn.title = monitorOn ? 'Monitor: On' : 'Monitor: Off';
		monitorBtn.classList.toggle('active', monitorOn);
	});

	recBtn.addEventListener('click', function () {
		if (!audioContext || !sourceNode) return;
		ensureRecGraph();
		if (!isRecording) {
			isRecording = true;
			recChunks = [];
			recTotalSamples = 0;
			recStartTime = Date.now();
			recBtn.classList.add('active');
			recBtn.title = 'Stop';
			recTimerId = setInterval(function () {
				const secs = ((Date.now() - recStartTime) / 1000).toFixed(1);
				recBtn.title = 'Stop (' + secs + 's)';
			}, REC_TIMER_MS);
		} else {
			stopRecording();
		}
	});

	inputDeviceSelect.addEventListener('change', function () {
		selectedInputId = inputDeviceSelect.value;
		savePref('waSpectrumInput', selectedInputId);
		if (!audioContext || !micStream) return;
		if (isRecording) stopRecording();
		micStream.getTracks().forEach(function (t) { t.stop(); });
		micStream = null;
		sourceNode.disconnect();
		startAudio(selectedInputId).catch(function (err) {
			console.error('Error switching input device:', err);
		});
	});

	outputDeviceSelect.addEventListener('change', function () {
		selectedOutputId = outputDeviceSelect.value;
		savePref('waSpectrumOutput', selectedOutputId);
		if (audioContext && typeof audioContext.setSinkId === 'function') {
			audioContext.setSinkId(selectedOutputId).catch(function (err) {
				console.error('Failed to set output device:', err);
			});
		}
	});

	populateDeviceLists();
	if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
		navigator.mediaDevices.addEventListener('devicechange', populateDeviceLists);
	}

    oscilloscopeBtn.addEventListener('click', function () {
        showOscilloscope = !showOscilloscope;
        oscilloscopeBtn.title = showOscilloscope ? "Hide oscilloscope" : "Show oscilloscope";
        oscilloscopeBtn.classList.toggle('active', showOscilloscope);
        oscilloscopeContainer.classList.toggle('show', showOscilloscope);
        oscilloscopeScaleBtn.style.display = showOscilloscope ? 'inline-block' : 'none';
        // Size the oscilloscope bitmap now that the container is visible (reading
        // offsetWidth/Height forces layout, so the flexed size is current)
        handleResize();
        savePref('waSpectrumOscShow', showOscilloscope ? '1' : '0');
    });
    
    oscilloscopeScaleBtn.addEventListener('click', function () {
        if (oscilloscopeScaleMode === 'linear') {
            oscilloscopeScaleMode = 'log';
            oscilloscopeScaleBtn.textContent = 'Log';
            oscilloscopeScaleBtn.title = 'Oscilloscope scale: Log';
        } else if (oscilloscopeScaleMode === 'log') {
            oscilloscopeScaleMode = 'compand';
            oscilloscopeScaleBtn.textContent = 'Comp';
            oscilloscopeScaleBtn.title = 'Oscilloscope scale: Compand';
        } else {
            oscilloscopeScaleMode = 'linear';
            oscilloscopeScaleBtn.textContent = 'Lin';
            oscilloscopeScaleBtn.title = 'Oscilloscope scale: Linear';
        }
        oscilloscopeScaleBtn.classList.toggle('active', oscilloscopeScaleMode !== 'linear');
        
        // Update oscilloscope label
        const modeText = oscilloscopeScaleMode.charAt(0).toUpperCase() + oscilloscopeScaleMode.slice(1);
        oscilloscopeLabel.textContent = `Oscilloscope (Time Domain) - ${modeText}`;
        savePref('waSpectrumScopeScale', oscilloscopeScaleMode);
    });

	function startAudio(deviceId) {
		const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
		return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
			micStream = stream;
			sourceNode = audioContext.createMediaStreamSource(stream);
			sourceNode.connect(inputGain);
			inputGain.connect(analyserLimiter);
			analyserLimiter.connect(analyser);
			ensureRecGraph(); // Always feed the ring buffer (scope phase-lock + HR path)
			if (recProcessor && !recProcessorConnected) {
				inputGain.connect(recProcessor);
				recProcessorConnected = true;
			}
			btn.textContent = 'Stop';
			btn.classList.add('stop');
			recBtn.disabled = false;
			monitorBtn.disabled = false;
	populateDeviceLists();
			updateSpectrum(); // Start the visualization
		});
	}

    btn.addEventListener('click', function () {
        // Check if the AudioContext has been initialized
        if (!audioContext) {
            // Initialize AudioContext and other related setups
            audioContext = new AudioContext();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = ANALYSER_FFT_SIZE;
            analyser.smoothingTimeConstant = ANALYSER_SMOOTHING; // keep buttery-smooth when using built-in spectrum
			inputGain = audioContext.createGain();
			inputGain.gain.value = parseFloat(inputGainRange.value);
			// Limiter between volume and analyser: lets the >100% volume range stay
			// visible (the analyser itself clamps at 0 dBFS) without adding any
			// offset to the signal — silence stays silence, only boosted peaks are held
			analyserLimiter = audioContext.createDynamicsCompressor();
			analyserLimiter.threshold.value = COMPRESSOR_THRESHOLD_DB;
			analyserLimiter.knee.value = COMPRESSOR_KNEE_DB;
			analyserLimiter.ratio.value = COMPRESSOR_RATIO;
			analyserLimiter.attack.value = COMPRESSOR_ATTACK_S;
			analyserLimiter.release.value = COMPRESSOR_RELEASE_S;
            bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            timeDataArray = new Uint8Array(OSCILLOSCOPE_SAMPLES);

			// Precompute Hamming window for time-domain samples with coherent gain compensation (mean=1)
			precomputeHammingTimeWindow(analyser.fftSize);
			fftWorkRe = new Float32Array(analyser.fftSize);
			fftWorkIm = new Float32Array(analyser.fftSize);
			applyMaxFreqResolution();

			if (selectedOutputId && typeof audioContext.setSinkId === 'function') {
				audioContext.setSinkId(selectedOutputId).catch(function (err) {
					console.error('Failed to set output device:', err);
				});
			}

            // Request access to the microphone
            startAudio(selectedInputId).catch(function (err) {
                console.error('Error accessing media devices:', err);
            });
        } else {
            // Toggle the state based on current state of the AudioContext
            if (audioContext.state === 'running') {
                audioContext.suspend().then(() => {
                    if (isRecording) stopRecording();
                    btn.textContent = 'Start';
                    btn.classList.remove('stop');
                    console.log("AudioContext suspended");
                });
            } else if (audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    btn.textContent = 'Stop';
                    btn.classList.add('stop');
                    console.log("AudioContext resumed");
                    updateSpectrum(); // Ensure that the visual update loop continues
                });
            }
        }
    });

	function getMaxFreq() {
		const nyquist = audioContext.sampleRate / 2;
		return maxFreqHz === null ? nyquist : Math.min(maxFreqHz, nyquist);
	}

	function getAxisMode() {
		return scaleMode === 'average' ? axisMode : scaleMode;
	}

	function recomputeAverage() {
		const n = bufferLength;
		const now = Date.now();
		while (avgHistory.length && now - avgHistoryTimes[0] > avgSeconds * 1000) {
			avgHistory.shift();
			avgHistoryTimes.shift();
		}
		if (!avgSpectrum || avgSpectrum.length !== n) avgSpectrum = new Uint8Array(n);
		avgSpectrum.fill(0);
		const count = avgHistory.length;
		if (count === 0) return;
		const acc = new Float32Array(n);
		for (let i = 0; i < count; i++) {
			const f = avgHistory[i];
			for (let b = 0; b < n; b++) acc[b] += f[b];
		}
		for (let b = 0; b < n; b++) avgSpectrum[b] = Math.round(acc[b] / count);
	}

	function getMaxBin(bufferLength) {
		if (highResActive) return bufferLength;
		const nyquist = audioContext.sampleRate / 2;
		return Math.min(bufferLength, Math.round((getMaxFreq() / nyquist) * bufferLength));
	}

	function applyMaxFreqResolution() {
		if (!analyser) return;
		const nyquist = audioContext.sampleRate / 2;
		const prevHighRes = highResActive;
		highResActive = !useLightAlgo && maxFreqHz !== null && maxFreqHz <= HIGH_RES_MAX;
		if (highResActive) {
			// Ring-buffer FFT beyond the analyser's ANALYSER_MAX_FFT_SIZE-point cap for finer bins
			const target = ANALYSER_FFT_SIZE * nyquist / maxFreqHz;
			hrFftSize = ANALYSER_FFT_SIZE;
			while (hrFftSize < target && hrFftSize < MAX_HR_FFT_SIZE) hrFftSize <<= 1;
			if (!ringBuffer) ringBuffer = new Float32Array(RING_SIZE);
			if (audioContext) ensureRecGraph();
			bufferLength = DISPLAY_BINS;
			dataArray = new Uint8Array(DISPLAY_BINS);
			customSmoothPrev = null;
			hrFrameCount = 0;
			hrCached = null;
			precomputeHammingTimeWindow(hrFftSize);
			spectrogramData = [];
			spectrogramEpoch++;
			avgHistory = [];
			avgHistoryTimes = [];
			return;
		}
		ringBuffer = null;
		ringPos = 0;
		ringFilled = 0;
		const target = maxFreqHz === null ? ANALYSER_FFT_SIZE : ANALYSER_FFT_SIZE * nyquist / maxFreqHz;
		let size = ANALYSER_FFT_SIZE;
		while (size < target && size < ANALYSER_MAX_FFT_SIZE) size <<= 1;
		if (size === analyser.fftSize && !prevHighRes && hammingTimeWeights && hammingTimeWeights.length === size) return;
		analyser.fftSize = size;
		bufferLength = analyser.frequencyBinCount;
		dataArray = new Uint8Array(bufferLength);
		fftWorkRe = new Float32Array(size);
		fftWorkIm = new Float32Array(size);
		customSmoothPrev = null;
		precomputeHammingTimeWindow(size);
		spectrogramData = [];
		spectrogramEpoch++;
		avgHistory = [];
		avgHistoryTimes = [];
	}

	function applyScaling(bufferLength, width, sampleRate, mode, maxFreq, maxBin) {
        const xs = new Array(bufferLength);
        const ws = new Array(bufferLength);
        const nb = Math.max(1, maxBin);
        if (mode === 'log') {
            const fMin = maxFreq / nb; // first displayed bin within the window
            const logMin = Math.log10(fMin);
            const logMax = Math.log10(maxFreq);
            for (let i = 0; i < bufferLength; i++) {
                const fLo = Math.min(Math.max(i, 1) * maxFreq / nb, maxFreq);
                const fHi = Math.min(Math.max(i + 1, 1) * maxFreq / nb, maxFreq);
                const xLo = (Math.log10(fLo) - logMin) / (logMax - logMin) * width;
                const xHi = (Math.log10(fHi) - logMin) / (logMax - logMin) * width;
                xs[i] = xLo;
                ws[i] = Math.max(1, xHi - xLo);
            }
        } else {
            const step = width / nb;
            for (let i = 0; i < bufferLength; i++) {
                xs[i] = i * step;
                ws[i] = step;
            }
        }
        return { xs, ws };
    }

	function smoothArray(input, windowSize) {
		const n = input.length;
		const output = new Float32Array(n);
		const half = Math.floor(windowSize / 2);
		for (let i = 0; i < n; i++) {
			let sum = 0;
			let count = 0;
			const start = Math.max(0, i - half);
			const end = Math.min(n - 1, i + half);
			for (let j = start; j <= end; j++) {
				sum += input[j];
				count++;
			}
			output[i] = count > 0 ? (sum / count) : input[i];
		}
		return output;
	}

	function poolToDisplayBins(data, rawBins, outBins) {
		// Max-pool raw bins into fewer display buckets (perf: fewer draw ops)
		const out = new Uint8Array(outBins);
		for (let b = 0; b < outBins; b++) {
			const lo = Math.floor(b * rawBins / outBins);
			const hi = Math.floor((b + 1) * rawBins / outBins);
			let m = 0;
			for (let j = lo; j < hi; j++) {
				if (data[j] > m) m = data[j];
			}
			out[b] = m;
		}
		return out;
	}

	function precomputeHammingTimeWindow(size) {
		const w = new Float32Array(size);
		let sum = 0;
		for (let n = 0; n < size; n++) {
			const wn = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (size - 1));
			w[n] = wn;
			sum += wn;
		}
		// Coherent gain compensation: normalize by mean value of window
		const mean = sum / size;
		const gain = mean > 0 ? (1 / mean) : 1;
		for (let n = 0; n < size; n++) {
			w[n] *= gain;
		}
		hammingTimeWeights = w;
	}

	function bitReverseIndex(index, bits) {
		let reversed = 0;
		for (let i = 0; i < bits; i++) {
			reversed = (reversed << 1) | (index & 1);
			index >>= 1;
		}
		return reversed;
	}

	function fftRadix2InPlace(real, imag) {
		const n = real.length;
		const levels = Math.floor(Math.log2(n));
		// Bit-reversal permutation
		for (let i = 0; i < n; i++) {
			const j = bitReverseIndex(i, levels);
			if (j > i) {
				const tr = real[i]; real[i] = real[j]; real[j] = tr;
				const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
			}
		}
		// Cooley–Tukey
		for (let size = 2; size <= n; size <<= 1) {
			const halfSize = size >> 1;
			const tableStep = (2 * Math.PI) / size;
			for (let i = 0; i < n; i += size) {
				for (let j = 0; j < halfSize; j++) {
					const angle = j * tableStep;
					const wr = Math.cos(angle);
					const wi = -Math.sin(angle);
					const k = i + j;
					const l = k + halfSize;
					const tr = wr * real[l] - wi * imag[l];
					const ti = wr * imag[l] + wi * real[l];
					real[l] = real[k] - tr;
					imag[l] = imag[k] - ti;
					real[k] = real[k] + tr;
					imag[k] = imag[k] + ti;
				}
			}
		}
	}

	function computeSpectrumBytes(useWindow) {
		const n = analyser.fftSize;
		if (!fftWorkRe || fftWorkRe.length !== n) {
			fftWorkRe = new Float32Array(n);
			fftWorkIm = new Float32Array(n);
		}
		// Grab float time-domain data in [-1,1]
		const time = new Float32Array(n);
		analyser.getFloatTimeDomainData(time);
		// Apply window if requested
		if (useWindow && hammingTimeWeights && hammingTimeWeights.length === n) {
			for (let i = 0; i < n; i++) fftWorkRe[i] = time[i] * hammingTimeWeights[i];
		} else {
			for (let i = 0; i < n; i++) fftWorkRe[i] = time[i];
		}
		for (let i = 0; i < n; i++) fftWorkIm[i] = 0;
		// Run FFT
		fftRadix2InPlace(fftWorkRe, fftWorkIm);
		// Compute magnitudes for first N/2 bins
		const half = n >> 1;
		const mags = new Float32Array(half);
		for (let k = 0; k < half; k++) {
			const re = fftWorkRe[k];
			const im = fftWorkIm[k];
			const mag = Math.hypot(re, im);
			mags[k] = mag;
		}
		// Convert to dBFS-like scale using N/2 normalization so 1.0 sine ≈ 0 dB
		const out = new Uint8Array(half);
		const ref = n / 2;
		const minDb = DB_FLOOR;
		for (let k = 0; k < half; k++) {
			const magNorm = mags[k] / ref;
			let db = 20 * Math.log10(magNorm + DB_LOG_EPSILON);
			if (db < minDb) db = minDb;
			if (db > 0) db = 0;
			const lin = (db - minDb) / (0 - minDb);
			let v = Math.round(lin * 255);
			if (v < 0) v = 0; else if (v > 255) v = 255;
			out[k] = v;
		}
		// Apply simple EMA smoothing to stabilize display
		if (!customSmoothPrev || customSmoothPrev.length !== half) {
			customSmoothPrev = new Uint8Array(half);
		}
		for (let k = 0; k < half; k++) {
			customSmoothPrev[k] = Math.round(CUSTOM_SMOOTH_ALPHA * customSmoothPrev[k] + (1 - CUSTOM_SMOOTH_ALPHA) * out[k]);
			out[k] = customSmoothPrev[k];
		}
		return out;
	}

	function computeSpectrumBytesHR() {
		const n = hrFftSize;
		if (!ringBuffer || n < ANALYSER_FFT_SIZE) return null;
		// Throttle: reuse the last result between recomputations
		hrFrameCount++;
		if (hrCached && hrFrameCount % HR_THROTTLE !== 0) return hrCached;
		if (!fftWorkRe || fftWorkRe.length !== n) {
			fftWorkRe = new Float32Array(n);
			fftWorkIm = new Float32Array(n);
		}
		// Read last n samples from the ring buffer (contiguous)
		let src = ringPos - n;
		if (src < 0) src += RING_SIZE;
		const weights = (useHammingWindow && hammingTimeWeights && hammingTimeWeights.length === n) ? hammingTimeWeights : null;
		for (let i = 0; i < n; i++) {
			const s = ringBuffer[(src + i) % RING_SIZE];
			fftWorkRe[i] = weights ? s * weights[i] : s;
			fftWorkIm[i] = 0;
		}
		fftRadix2InPlace(fftWorkRe, fftWorkIm);
		// Magnitudes to dB, same scale as computeSpectrumBytes
		const half = n >> 1;
		const ref = n / 2;
		const minDb = DB_FLOOR;
		const raw = new Float32Array(half);
		for (let k = 0; k < half; k++) {
			const mag = Math.hypot(fftWorkRe[k], fftWorkIm[k]) / ref;
			let db = 20 * Math.log10(mag + DB_LOG_EPSILON);
			if (db < minDb) db = minDb;
			if (db > 0) db = 0;
			raw[k] = Math.round((db - minDb) / (0 - minDb) * 255);
		}
		// Pool raw bins inside the window into DISPLAY_BINS buckets (max)
		const nyquist = audioContext.sampleRate / 2;
		const rawInWindow = Math.min(half, Math.round((getMaxFreq() / nyquist) * half));
		const out = new Uint8Array(DISPLAY_BINS);
		for (let b = 0; b < DISPLAY_BINS; b++) {
			const lo = Math.floor(b * rawInWindow / DISPLAY_BINS);
			const hi = Math.floor((b + 1) * rawInWindow / DISPLAY_BINS);
			let m = 0;
			for (let j = lo; j < hi && j < half; j++) {
				if (raw[j] > m) m = raw[j];
			}
			out[b] = m;
		}
		// EMA smoothing consistent with the custom FFT path
		if (!customSmoothPrev || customSmoothPrev.length !== DISPLAY_BINS) {
			customSmoothPrev = new Uint8Array(DISPLAY_BINS);
		}
		for (let b = 0; b < DISPLAY_BINS; b++) {
			customSmoothPrev[b] = Math.round(CUSTOM_SMOOTH_ALPHA * customSmoothPrev[b] + (1 - CUSTOM_SMOOTH_ALPHA) * out[b]);
			out[b] = customSmoothPrev[b];
		}
		hrCached = out;
		return out;
	}

	function ensureRecGraph() {
		if (recProcessor) return;
		recProcessor = audioContext.createScriptProcessor(REC_CHUNK_SIZE, 1, 1);
		monitorGain = audioContext.createGain();
		monitorGain.gain.value = 0;
		recProcessor.connect(monitorGain);
		monitorGain.connect(audioContext.destination);
		recProcessor.onaudioprocess = function (event) {
			const input = event.inputBuffer.getChannelData(0);
			if (isRecording) {
				recChunks.push(new Float32Array(input));
				recTotalSamples += input.length;
			}
			if (ringBuffer) {
				for (let i = 0; i < input.length; i++) {
					ringBuffer[ringPos] = input[i];
					ringPos = (ringPos + 1) % RING_SIZE;
				}
				ringFilled = Math.min(RING_SIZE, ringFilled + input.length);
			}
			if (monitorOn) {
				event.outputBuffer.getChannelData(0).set(input);
			}
		};
		if (sourceNode && inputGain && !recProcessorConnected) {
			inputGain.connect(recProcessor);
			recProcessorConnected = true;
		}
	}

	function stopRecording() {
		if (!isRecording) return;
		isRecording = false;
		clearInterval(recTimerId);
		recTimerId = null;
		recBtn.classList.remove('active');
		recBtn.title = 'Record';
		const samples = new Float32Array(recTotalSamples);
		let offset = 0;
		for (let i = 0; i < recChunks.length; i++) {
			samples.set(recChunks[i], offset);
			offset += recChunks[i].length;
		}
		recChunks = [];
		recTotalSamples = 0;
		if (samples.length === 0) return;
		const ext = recFormat.value;
		const blob = ext === 'mp3' ? encodeMp3(samples, audioContext.sampleRate) : encodeWav(samples, audioContext.sampleRate);
		if (blob) downloadBlob(blob, ext);
	}

	function downloadBlob(blob, ext) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const d = new Date();
		const pad = function (n) { return String(n).padStart(2, '0'); };
		const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
		a.download = 'recording-' + stamp + '.' + ext;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(function () { URL.revokeObjectURL(url); }, URL_REVOKE_MS);
	}

	function encodeWav(samples, sampleRate) {
		const numSamples = samples.length;
		const buffer = new ArrayBuffer(44 + numSamples * 2);
		const view = new DataView(buffer);
		function writeString(offset, str) {
			for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
		}
		writeString(0, 'RIFF');
		view.setUint32(4, 36 + numSamples * 2, true);
		writeString(8, 'WAVE');
		writeString(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		writeString(36, 'data');
		view.setUint32(40, numSamples * 2, true);
		let offset = 44;
		for (let i = 0; i < numSamples; i++) {
			const s = Math.max(-1, Math.min(1, samples[i]));
			view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
			offset += 2;
		}
		return new Blob([buffer], { type: 'audio/wav' });
	}

	function encodeMp3(samples, sampleRate) {
		if (!window.lamejs) {
			alert('MP3 encoder (lamejs) failed to load from CDN. Use WAV format instead.');
			return null;
		}
		try {
			const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
			const blockSize = 1152;
			const intSamples = new Int16Array(samples.length);
			for (let i = 0; i < samples.length; i++) {
				const s = Math.max(-1, Math.min(1, samples[i]));
				intSamples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
			}
			const mp3Data = [];
			for (let i = 0; i < intSamples.length; i += blockSize) {
				const encoded = encoder.encodeBuffer(intSamples.subarray(i, i + blockSize));
				if (encoded.length > 0) mp3Data.push(new Uint8Array(encoded));
			}
			const end = encoder.flush();
			if (end.length > 0) mp3Data.push(new Uint8Array(end));
			return new Blob(mp3Data, { type: 'audio/mpeg' });
		} catch (e) {
			console.error('MP3 encoding failed:', e);
			alert('MP3 encoding failed: ' + e.message);
			return null;
		}
	}

	function populateDeviceLists() {
		if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
		navigator.mediaDevices.enumerateDevices().then(function (devices) {
			const inputs = devices.filter(function (d) { return d.kind === 'audioinput'; });
			const outputs = devices.filter(function (d) { return d.kind === 'audiooutput'; });
			inputDeviceSelect.innerHTML = '<option value="">Default</option>';
			inputs.forEach(function (d, i) {
				const opt = document.createElement('option');
				opt.value = d.deviceId;
				opt.textContent = d.label || 'Microphone ' + (i + 1);
				inputDeviceSelect.appendChild(opt);
			});
			outputDeviceSelect.innerHTML = '<option value="">Default</option>';
			outputs.forEach(function (d, i) {
				const opt = document.createElement('option');
				opt.value = d.deviceId;
				opt.textContent = d.label || 'Speaker ' + (i + 1);
				outputDeviceSelect.appendChild(opt);
			});
			inputDeviceSelect.value = selectedInputId;
			outputDeviceSelect.value = selectedOutputId;
		}).catch(function (err) {
			console.error('Error enumerating devices:', err);
		});
	}

	function frequencyToX(f, width, sampleRate, mode, maxFreq, maxBin) {
		if (mode === 'log') {
			const fMin = maxFreq / Math.max(1, maxBin);
			const clamped = Math.max(fMin, Math.min(f, maxFreq));
			const logMin = Math.log10(fMin);
			const logMax = Math.log10(maxFreq);
			return (Math.log10(clamped) - logMin) / (logMax - logMin) * width;
		}
		return Math.max(0, Math.min(width, (f / maxFreq) * width));
	}

	function formatHz(f) {
		if (f >= 1000) {
			const k = f / 1000;
			return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
		}
		return String(Math.round(f));
	}

	function chooseLinearStep(nyquist, width) {
		// Aim ~80-120 px between ticks
		const targetPx = AXIS_TICK_TARGET_PX;
		const hzPerPx = nyquist / width;
		const targetHz = hzPerPx * targetPx;
		const pow10 = Math.pow(10, Math.floor(Math.log10(targetHz)));
		const candidates = [1, 2, 5].map(m => m * pow10);
		let best = candidates[0];
		let bestDiff = Math.abs(candidates[0] - targetHz);
		for (let i = 1; i < candidates.length; i++) {
			const d = Math.abs(candidates[i] - targetHz);
			if (d < bestDiff) { best = candidates[i]; bestDiff = d; }
		}
		return best;
	}

	function drawFrequencyAxis(context, width, height, sampleRate, bufferLength, mode, phase, maxFreq, maxBin) {
		const nyquist = sampleRate / 2;
		context.save();
		context.font = '10px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'bottom';
		const gridColor = 'rgba(255,255,255,0.08)';
		const tickColor = 'rgba(255,255,255,0.25)';
		const labelColor = 'rgba(255,255,255,0.7)';

		let freqs = [];
		let minor = [];
		if (mode === 'log') {
			// Major decades and 2/5 multiples
			const majors = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
			for (let i = 0; i < majors.length; i++) {
				const f = majors[i];
				if (f <= maxFreq) freqs.push(f);
			}
			// Minor ticks: within each decade: 2x, 3x, 5x
			const decades = [10, 100, 1000, 10000];
			for (let d = 0; d < decades.length; d++) {
				const base = decades[d];
				[2, 3, 5].forEach(m => {
					const f = base * m;
					if (f <= maxFreq) minor.push(f);
				});
			}
		} else {
			const step = chooseLinearStep(maxFreq, width);
			for (let f = step; f <= maxFreq; f += step) freqs.push(f);
		}

		// Grid lines
		if (phase === 'grid') {
			context.strokeStyle = gridColor;
			context.lineWidth = 1;
			context.beginPath();
			for (let i = 0; i < freqs.length; i++) {
				const x = Math.round(frequencyToX(freqs[i], width, sampleRate, mode, maxFreq, maxBin)) + 0.5;
				context.moveTo(x, 0);
				context.lineTo(x, height);
			}
			// Minor grid for log only
			if (mode === 'log') {
				for (let i = 0; i < minor.length; i++) {
					const x = Math.round(frequencyToX(minor[i], width, sampleRate, mode, maxFreq, maxBin)) + 0.5;
					context.moveTo(x, 0);
					context.lineTo(x, height);
				}
			}
			context.stroke();
		}

		// Ticks and labels (draw on top)
		if (phase === 'labels') {
			// Ticks
			context.strokeStyle = tickColor;
			context.lineWidth = 1;
			for (let i = 0; i < freqs.length; i++) {
				const x = Math.round(frequencyToX(freqs[i], width, sampleRate, mode, maxFreq, maxBin)) + 0.5;
				context.beginPath();
				context.moveTo(x, height);
				context.lineTo(x, height - 6);
				context.stroke();
			}
			// Labels
			context.fillStyle = labelColor;
			for (let i = 0; i < freqs.length; i++) {
				const x = Math.round(frequencyToX(freqs[i], width, sampleRate, mode, maxFreq, maxBin));
				context.fillText(formatHz(freqs[i]), x, height - 7);
			}
		}

		context.restore();
	}

function drawYAxis(context, width, height, type, phase = 'both', options = {}) {
    // type: 'amplitude' for spectrum, 'time' for spectrogram
		context.save();
		context.font = '10px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
		context.textAlign = 'right';
		context.textBaseline = 'middle';
		const gridColor = 'rgba(255,255,255,0.08)';
		const tickColor = 'rgba(255,255,255,0.25)';
		const labelColor = 'rgba(255,255,255,0.7)';

    if (type === 'amplitude') {
			// 0..255 maps bottom..top visually; place ticks at 0, 64, 128, 192, 255
			const ticks = AMPLITUDE_TICKS;
        if (phase === 'grid' || phase === 'both') {
            context.strokeStyle = gridColor;
            context.lineWidth = 1;
            context.beginPath();
            for (let i = 0; i < ticks.length; i++) {
                const y = Math.round(height - (ticks[i] / 255) * height) + 0.5;
                context.moveTo(0, y);
                context.lineTo(width, y);
            }
            context.stroke();

            // Axis
            context.strokeStyle = tickColor;
            context.beginPath();
            context.moveTo(0.5, 0);
            context.lineTo(0.5, height);
            context.stroke();
        }

        if (phase === 'labels' || phase === 'both') {
            // Labels
            context.fillStyle = labelColor;
            for (let i = 0; i < ticks.length; i++) {
                const y = height - (ticks[i] / 255) * height;
                context.fillText(String(ticks[i]), 28, y);
            }
        }
		} else if (type === 'time') {
        // Show time from top(old) to bottom(new). Use seconds if provided
        const rows = AXIS_TIME_TICKS;
        const totalSpanSec = options.totalSpanSec;
        if (phase === 'grid' || phase === 'both') {
            context.strokeStyle = gridColor;
            context.lineWidth = 1;
            context.beginPath();
            for (let i = 0; i <= rows; i++) {
                const y = Math.round((i / rows) * height) + 0.5;
                context.moveTo(0, y);
                context.lineTo(width, y);
            }
            context.stroke();

            // Axis
            context.strokeStyle = tickColor;
            context.beginPath();
            context.moveTo(0.5, 0);
            context.lineTo(0.5, height);
            context.stroke();
        }

        if (phase === 'labels' || phase === 'both') {
            context.fillStyle = labelColor;
            for (let i = 0; i <= rows; i++) {
                const y = (i / rows) * height;
                let label;
                if (typeof totalSpanSec === 'number') {
                    const t = (1 - i / rows) * totalSpanSec;
                    label = t >= 1 ? (Math.round(t * 10) / 10) + 's' : Math.round(t * 1000) + 'ms';
                } else {
                    const rel = Math.round((1 - i / rows) * 100);
                    label = rel + '%';
                }
                context.fillText(label, 28, y);
            }
        }
		}

		context.restore();
	}

	function drawSpectrum(pushFrame) {
        const WIDTH = canvas.width;
        const HEIGHT = canvas.height;
		const maxFreq = getMaxFreq();
		const maxBin = getMaxBin(bufferLength);
		const dispBins = Math.min(maxBin, DISPLAY_BINS); // Displayed buckets after pooling
		if (scaleMode === 'average' && Date.now() - lastAvgUpdate >= AVERAGE_UPDATE_MS) {
			recomputeAverage();
			lastAvgUpdate = Date.now();
		}
		const isAveraged = scaleMode === 'average';
		let liveData;
		if (pushFrame) {
			// Live frame: acquire from the analyser and cache a copy for later redraws
			if (highResActive) {
				// Ring-buffer FFT: finer bins than the analyser cap, pooled to DISPLAY_BINS
				liveData = computeSpectrumBytesHR() || dataArray;
			} else if (useHammingWindow) {
				// Build spectrum from time-domain with proper windowing and custom smoothing
				liveData = computeSpectrumBytes(true);
			} else {
				// Use analyzer's built-in smoothing path for buttery visuals
				analyser.getByteFrequencyData(dataArray);
				liveData = dataArray;
			}
			if (!lastLiveData || lastLiveData.length !== liveData.length) lastLiveData = new Uint8Array(liveData.length);
			lastLiveData.set(liveData);
		} else {
			// Redraw from the last captured frame (e.g. after a resize while suspended)
			liveData = lastLiveData || dataArray;
		}
		let processedData = isAveraged ? (avgSpectrum || dataArray) : liveData;
		if (maxBin > DISPLAY_BINS) {
			processedData = poolToDisplayBins(processedData, maxBin, DISPLAY_BINS);
		}
		ctx.fillStyle = 'rgb(0, 0, 0)';
		ctx.fillRect(0, 0, WIDTH, HEIGHT);
		// Draw grid underlay and Y axis
		drawFrequencyAxis(ctx, WIDTH, HEIGHT, audioContext.sampleRate, dispBins, getAxisMode(), 'grid', maxFreq, dispBins);
		drawYAxis(ctx, WIDTH, HEIGHT, 'amplitude');

		const { xs, ws } = applyScaling(dispBins, WIDTH, audioContext.sampleRate, getAxisMode(), maxFreq, dispBins);

		// Prepare values array and optionally apply a simple moving average smoothing
		let values = new Float32Array(dispBins);
		for (let i = 0; i < dispBins; i++) {
			values[i] = processedData[i];
		}
		if (useSmoothing) {
			const windowSize = getAxisMode() === 'log' ? SMOOTH_WINDOW_LOG : SMOOTH_WINDOW_LINEAR;
			values = smoothArray(values, windowSize);
		}
		// Normalize the 0..255 amplitude range to the canvas height so the curve
		// scales with the canvas (matches the normalized amplitude axis labels)
		const vScale = HEIGHT / 255;

		if (useSmoothing) {
			// Draw filled area under the smoothed curve
			ctx.fillStyle = 'rgba(0, 200, 255, 0.25)';
			ctx.beginPath();
			ctx.moveTo(xs[0], HEIGHT);
			for (let i = 0; i < dispBins; i++) {
				ctx.lineTo(xs[i], HEIGHT - values[i] * vScale);
			}
			ctx.lineTo(xs[dispBins - 1], HEIGHT);
			ctx.closePath();
			ctx.fill();
			// Outline
			ctx.lineWidth = 2;
			ctx.strokeStyle = 'rgb(0, 200, 255)';
			ctx.beginPath();
			ctx.moveTo(xs[0], HEIGHT - values[0] * vScale);
			for (let i = 1; i < dispBins; i++) {
				ctx.lineTo(xs[i], HEIGHT - values[i] * vScale);
			}
			ctx.stroke();
		} else {
			// One path instead of per-bin bars (perf)
			ctx.fillStyle = 'rgba(255, 80, 80, 0.25)';
			ctx.beginPath();
			ctx.moveTo(xs[0], HEIGHT);
			for (let i = 0; i < dispBins; i++) {
				ctx.lineTo(xs[i], HEIGHT - values[i] * vScale);
			}
			ctx.lineTo(xs[dispBins - 1], HEIGHT);
			ctx.closePath();
			ctx.fill();
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgb(255, 100, 100)';
			ctx.beginPath();
			ctx.moveTo(xs[0], HEIGHT - values[0] * vScale);
			for (let i = 1; i < dispBins; i++) {
				ctx.lineTo(xs[i], HEIGHT - values[i] * vScale);
			}
			ctx.stroke();
		}
		// Draw ticks and labels on top
		drawFrequencyAxis(ctx, WIDTH, HEIGHT, audioContext.sampleRate, dispBins, getAxisMode(), 'labels', maxFreq, dispBins);
		drawSpectrogram(liveData, pushFrame);
    }
    

    function drawSpectrogram(liveData, pushFrame) {
        if (pushFrame) {
            // Push a copy of the live data to maintain original data integrity
            spectrogramData.push(new Uint8Array(liveData));
            // Rolling-average history (always recorded so the average keeps sliding)
            avgHistory.push(new Uint8Array(liveData));
            avgHistoryTimes.push(Date.now());
            if (avgHistory.length > avgSeconds * 60 + AVG_HISTORY_MARGIN) {
                avgHistory.shift();
                avgHistoryTimes.shift();
            }
        }

        const W = spectrogramCanvas.width;
        const H = spectrogramCanvas.height;
        // History scales with canvas height so a maximized (taller) spectrogram shows
        // proportionally more seconds at the same time-per-pixel density
        const frames = Math.min(
            MAX_SPECTROGRAM_FRAMES,
            Math.max(MIN_SPECTROGRAM_FRAMES, Math.round(BASE_SPECTROGRAM_FRAMES * H / Math.max(baseSpectrogramHeight, 1)))
        );
        if (spectrogramData.length > frames) {
            spectrogramData.shift(); // Maintain a fixed number of frames
        }
        const rowHeight = H / frames; // Fixed height for each frame
        const maxFreq = getMaxFreq();
        const maxBin = getMaxBin(bufferLength);
        const dispBins = Math.min(maxBin, DISPLAY_BINS);
        const mode = getAxisMode();
        const { xs, ws } = applyScaling(dispBins, W, audioContext.sampleRate, mode, maxFreq, dispBins);
        // Estimate total visible time span for y labels: frames rows, each roughly fftSize/sampleRate seconds
        const secondsPerFrame = analyser.fftSize / audioContext.sampleRate;
        const totalSpanSec = frames * secondsPerFrame;
        // Scroll-stamp cache: shift previous rows up and stamp one new row instead of
        // redrawing every stored frame each animation frame (perf)
        const version = W + 'x' + H + ':' + bufferLength + ':' + dispBins + ':' + mode + ':' + maxFreq + ':' + spectrogramEpoch + ':' + spectrogramColorMode;
        const colors = getSpectrogramColorTable();
        if (version !== spectrogramCacheVersion || spectrogramCache.width !== W || spectrogramCache.height !== H) {
            spectrogramCache.width = W;
            spectrogramCache.height = H;
            spectrogramCacheCtx.fillStyle = 'rgb(0, 0, 0)';
            spectrogramCacheCtx.fillRect(0, 0, W, H);
            // Underlay grid and Y-axis (time) and X-axis grid for spectrogram
            drawFrequencyAxis(spectrogramCacheCtx, W, H, audioContext.sampleRate, dispBins, mode, 'grid', maxFreq, dispBins);
            drawYAxis(spectrogramCacheCtx, W, H, 'time', 'grid', { totalSpanSec });
            // Draw each frame stored in the spectrogram data
            spectrogramData.forEach((frameData, index) => {
                const y = H - (index + 1) * rowHeight;
                const pooled = maxBin > DISPLAY_BINS ? poolToDisplayBins(frameData, maxBin, DISPLAY_BINS) : frameData;
                for (let bin = 0; bin < dispBins; bin++) {
                    spectrogramCacheCtx.fillStyle = colors[pooled[bin]];
                    spectrogramCacheCtx.fillRect(xs[bin], y, ws[bin], rowHeight);
                }
            });
            spectrogramCacheVersion = version;
        } else if (pushFrame) {
            // Shift the cached history up by one row, then stamp the newest frame
            spectrogramCacheCtx.drawImage(spectrogramCache, 0, -rowHeight);
            const frameData = spectrogramData[spectrogramData.length - 1];
            const y = H - rowHeight;
            const pooled = maxBin > DISPLAY_BINS ? poolToDisplayBins(frameData, maxBin, DISPLAY_BINS) : frameData;
            for (let bin = 0; bin < dispBins; bin++) {
                spectrogramCacheCtx.fillStyle = colors[pooled[bin]];
                spectrogramCacheCtx.fillRect(xs[bin], y, ws[bin], rowHeight);
            }
        }
        // Blit the cached history once, then draw axis overlays
        spectrogramCtx.drawImage(spectrogramCache, 0, 0);
        drawFrequencyAxis(spectrogramCtx, W, H, audioContext.sampleRate, dispBins, mode, 'labels', maxFreq, dispBins);
        drawYAxis(spectrogramCtx, W, H, 'time', 'labels', { totalSpanSec });
    }
    

    function estimateScopeFreq() {
        // Dominant frequency of the last OSCILLOSCOPE_SAMPLES ring samples (Hz);
        // 0 when too quiet or not enough history yet
        if (!ringBuffer || ringFilled < OSCILLOSCOPE_SAMPLES) return 0;
        const n = OSCILLOSCOPE_SAMPLES;
        let rms = 0;
        for (let i = 0; i < n; i++) {
            const s = ringBuffer[(ringPos - n + i + RING_SIZE) % RING_SIZE];
            scopeFftRe[i] = s;
            scopeFftIm[i] = 0;
            rms += s * s;
        }
        rms = Math.sqrt(rms / n);
        if (rms < SCOPE_MIN_RMS) return 0;
        fftRadix2InPlace(scopeFftRe, scopeFftIm);
        const binHz = audioContext.sampleRate / n;
        const binMin = Math.max(2, Math.floor(SCOPE_LOCK_MIN_FREQ / binHz));
        const binMax = Math.min(n / 2 - 1, Math.ceil(SCOPE_LOCK_MAX_FREQ / binHz));
        let best = binMin;
        let bestMag = -1;
        for (let b = binMin; b <= binMax; b++) {
            const m = scopeFftRe[b] * scopeFftRe[b] + scopeFftIm[b] * scopeFftIm[b];
            if (m > bestMag) { bestMag = m; best = b; }
        }
        if (bestMag <= 0) return 0;
        // Parabolic interpolation for sub-bin resolution
        const mag = function (b) {
            const re = scopeFftRe[b], im = scopeFftIm[b];
            return re * re + im * im;
        };
        const m0 = best > binMin ? mag(best - 1) : bestMag;
        const m2 = best < binMax ? mag(best + 1) : bestMag;
        const denom = m0 - 2 * bestMag + m2;
        let delta = denom !== 0 ? 0.5 * (m0 - m2) / denom : 0;
        if (delta > 1) delta = 1; else if (delta < -1) delta = -1;
        return (best + delta) * binHz;
    }

    function drawOscilloscope() {
        if (!showOscilloscope || !audioContext) return;
        const WIDTH = oscilloscopeCanvas.width;
        const HEIGHT = oscilloscopeCanvas.height;

        // Standing-wave mode: track the dominant frequency and, once it is
        // stable, read the ring buffer one period behind the newest sample so
        // a steady tone renders as a frozen waveform instead of scrolling
        const f0 = estimateScopeFreq();
        const period = f0 > 0 ? audioContext.sampleRate / f0 : 0;
        if (f0 > 0 && f0 >= SCOPE_LOCK_MIN_FREQ && f0 <= SCOPE_LOCK_MAX_FREQ) {
            if (scopeFreqSmooth === 0) scopeFreqSmooth = f0;
            else scopeFreqSmooth += SCOPE_FREQ_EMA_ALPHA * (f0 - scopeFreqSmooth);
            if (Math.abs(f0 - scopeFreqSmooth) / scopeFreqSmooth <= SCOPE_FREQ_STABLE_RATIO) {
                scopeStableFrames++;
                scopeReleaseFrames = 0;
            } else {
                scopeStableFrames = 0;
                scopeReleaseFrames++;
            }
        } else {
            scopeStableFrames = 0;
            scopeReleaseFrames++;
        }
        const wasLocked = scopeLocked;
        if (!scopeLocked && scopeStableFrames >= SCOPE_LOCK_FRAMES) {
            scopeLocked = true;
            scopeReleaseFrames = 0;
        } else if (scopeLocked && (f0 <= 0 || scopeReleaseFrames >= SCOPE_LOCK_RELEASE_FRAMES)) {
            scopeLocked = false;
            scopeFreqSmooth = 0;
            scopeStableFrames = 0;
            scopeReleaseFrames = 0;
        }
        if (scopeLocked && f0 > 0 && ringBuffer && ringFilled >= OSCILLOSCOPE_SAMPLES + Math.ceil(period) + 2) {
            // Locked draw: interpolated read of the ring buffer, phase-frozen
            const phaseNewest = (ringPos % period) / period;
            if (!wasLocked) scopeTargetPhase = phaseNewest; // Snap on lock to avoid a visible jump
            let lag = phaseNewest - scopeTargetPhase;
            if (lag < 0) lag += 1;
            const endPos = ringPos - lag * period;
            const startPos = endPos - OSCILLOSCOPE_SAMPLES;
            for (let i = 0; i < OSCILLOSCOPE_SAMPLES; i++) {
                const p = startPos + i;
                const p0 = Math.floor(p);
                const frac = p - p0;
                const i0 = ((p0 % RING_SIZE) + RING_SIZE) % RING_SIZE;
                const s = ringBuffer[i0] + (ringBuffer[(i0 + 1) % RING_SIZE] - ringBuffer[i0]) * frac;
                timeDataArray[i] = (s + 1) * 128; // -1..1 to the 0..255 byte-scope format
            }
            drawScopeTrace(WIDTH, HEIGHT, OSCILLOSCOPE_SAMPLES, WIDTH / OSCILLOSCOPE_SAMPLES);
            return;
        }

        // Normal mode: the most recent analyser time-domain window (byte format)
        const tempData = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(tempData);

        // Copy to our larger array, filling the rest with center value (128)
        for (let i = 0; i < OSCILLOSCOPE_SAMPLES; i++) {
            timeDataArray[i] = i < analyser.fftSize ? tempData[i] : 128; // Center line
        }

        // Clamp to the buffer size: at large fftSize the analyser has more samples
        // than timeDataArray holds, so reading past the end would break the trace
        const samplesToShow = Math.min(analyser.fftSize, OSCILLOSCOPE_SAMPLES); // Show the original FFT size worth of samples
        drawScopeTrace(WIDTH, HEIGHT, samplesToShow, WIDTH / samplesToShow);
    }

    function drawScopeTrace(WIDTH, HEIGHT, samplesToShow, sliceWidth) {
        // Clear the canvas
        oscilloscopeCtx.fillStyle = 'rgb(0, 0, 0)';
        oscilloscopeCtx.fillRect(0, 0, WIDTH, HEIGHT);

        // Set up the line style
        oscilloscopeCtx.lineWidth = 2;
        oscilloscopeCtx.strokeStyle = 'rgb(0, 255, 0)';
        oscilloscopeCtx.beginPath();
        let x = 0;

        // Draw the waveform
        for (let i = 0; i < samplesToShow; i++) {
            let v = timeDataArray[i] / 128.0; // Convert to 0-2 range

            // Apply scaling based on mode
            if (oscilloscopeScaleMode === 'log') {
                // Log scale: amplify small signals
                const normalized = Math.abs(v - 1); // 0 to 1 range
                const scaled = normalized > 0 ? Math.log10(normalized * 9 + 1) : 0; // log10(1) to log10(10)
                v = 1 + (v > 1 ? scaled : -scaled);
            } else if (oscilloscopeScaleMode === 'compand') {
                // Companding: amplify small signals, compress large ones
                const normalized = v - 1; // -1 to 1 range
                const abs = Math.abs(normalized);
                const sign = normalized < 0 ? -1 : 1;
                // Use a sigmoid-like function for companding
                const scaled = sign * (1 - Math.exp(-3 * abs)) / (1 + Math.exp(-3 * (abs - 0.5)));
                v = 1 + scaled;
            }

            const y = (v - 1) * (HEIGHT / 2) + HEIGHT / 2; // Center the waveform

            if (i === 0) {
                oscilloscopeCtx.moveTo(x, y);
            } else {
                oscilloscopeCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        oscilloscopeCtx.stroke();
    }

    function redrawCharts() {
        // Render all charts from the last captured state without touching the
        // analyser or pushing new history (used on resize / fullscreen changes)
        if (!audioContext) return;
        if (showOscilloscope) drawOscilloscope();
        drawSpectrum(false);
    }

    function updateSpectrum() {
        if (audioContext.state === 'running') {
            requestAnimationFrame(updateSpectrum);
            // Self-heal canvas bitmaps: fullscreenchange can fire before layout of the
            // :fullscreen CSS size settles, so realign with the CSS size each frame if needed
            if (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight ||
                spectrogramCanvas.width !== spectrogramCanvas.offsetWidth || spectrogramCanvas.height !== spectrogramCanvas.offsetHeight ||
                oscilloscopeCanvas.width !== oscilloscopeCanvas.offsetWidth || oscilloscopeCanvas.height !== oscilloscopeCanvas.offsetHeight) {
                resizeCanvases();
            }
            drawOscilloscope();
            drawSpectrum(true);
        }
    }
});


