'use strict';

// ─── Audio Router ─────────────────────────────────────────────────────────────
// Chain: source → inputGain → inputAnalyser → gateGain → HPF → compressor
//        → outputGain → outputAnalyser → destination

class AudioRouter {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.sourceNode = null;
    this.inputGainNode = null;
    this.inputAnalyserNode = null;
    this.gateGainNode = null;
    this.hpfNode = null;
    this.compressorNode = null;
    this.outputGainNode = null;
    this.outputAnalyserNode = null;
    this.streamDest = null;
    this.outputAudioEl = null;
    this.outputMethod = null;

    this._gateEnabled = true;
    this._gateThreshold = -40;
    this._gateOpen = true;
  }

  async start({ inputDeviceId, outputDeviceId, inputGain, outputGain, unlockAudio }) {
    this._unlockAudio = unlockAudio || null;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: 0,
        channelCount: 1,
      },
      video: false,
    });

    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    // Auto-resume if the browser suspends the context (e.g. tab backgrounded)
    this._shouldRun = true;
    this.ctx.addEventListener('statechange', () => {
      if (this._shouldRun && this.ctx?.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    });

    this.sourceNode = this.ctx.createMediaStreamSource(this.stream);

    this.inputGainNode = this.ctx.createGain();
    this.inputGainNode.gain.value = inputGain;

    this.inputAnalyserNode = this.ctx.createAnalyser();
    this.inputAnalyserNode.fftSize = 512;
    this.inputAnalyserNode.smoothingTimeConstant = 0.3;

    this.gateGainNode = this.ctx.createGain();
    this.gateGainNode.gain.value = 1.0;

    this.hpfNode = this.ctx.createBiquadFilter();
    this.hpfNode.type = 'highpass';
    this.hpfNode.frequency.value = 80;
    this.hpfNode.Q.value = 0.7;

    this.compressorNode = this.ctx.createDynamicsCompressor();
    this.compressorNode.threshold.value = -24;
    this.compressorNode.knee.value = 12;
    this.compressorNode.ratio.value = 4;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.25;

    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = outputGain;

    this.outputAnalyserNode = this.ctx.createAnalyser();
    this.outputAnalyserNode.fftSize = 512;
    this.outputAnalyserNode.smoothingTimeConstant = 0.3;

    this.sourceNode.connect(this.inputGainNode);
    this.inputGainNode.connect(this.inputAnalyserNode);
    this.inputAnalyserNode.connect(this.gateGainNode);
    this.gateGainNode.connect(this.hpfNode);
    this.hpfNode.connect(this.compressorNode);
    this.compressorNode.connect(this.outputGainNode);
    this.outputGainNode.connect(this.outputAnalyserNode);

    this.outputMethod = await this._routeOutput(outputDeviceId);

    if (this.ctx.state === 'suspended') await this.ctx.resume();

    return {
      sampleRate: this.ctx.sampleRate,
      baseLatency: this.ctx.baseLatency,
      outputMethod: this.outputMethod,
    };
  }

  async _routeOutput(outputDeviceId) {
    // Try AudioContext.setSinkId (Chrome 110+) for a named output device
    if (outputDeviceId && typeof this.ctx.setSinkId === 'function') {
      try {
        await this.ctx.setSinkId(outputDeviceId);
        this.outputAnalyserNode.connect(this.ctx.destination);
        return 'sinkId-context';
      } catch (_) {}
    }

    // Route via <audio> element so we can call setSinkId on it, and because
    // an audio element properly activates the iOS standalone PWA audio session.
    // We use the pre-unlocked element created synchronously in the button click
    // (before any awaits) — this satisfies iOS gesture policy for play().
    this.streamDest = this.ctx.createMediaStreamDestination();
    this.outputAnalyserNode.connect(this.streamDest);

    this.outputAudioEl = this._unlockAudio || new Audio();
    this._unlockAudio = null;
    this.outputAudioEl.srcObject = this.streamDest.stream;

    if (outputDeviceId && 'setSinkId' in HTMLAudioElement.prototype) {
      try { await this.outputAudioEl.setSinkId(outputDeviceId); } catch (_) {}
    }

    try {
      await this.outputAudioEl.play();
      return outputDeviceId ? 'sinkId-element' : 'default';
    } catch {
      // play() still blocked (e.g. iOS browser strict policy) —
      // fall back to ctx.destination which works in iOS Safari browser
      this.outputAudioEl = null;
      this.outputAnalyserNode.disconnect(this.streamDest);
      this.streamDest = null;
      this.outputAnalyserNode.connect(this.ctx.destination);
      return 'default-fallback';
    }
  }

  stop() {
    this._shouldRun = false;
    if (this.outputAudioEl) {
      this.outputAudioEl.pause();
      this.outputAudioEl.srcObject = null;
      this.outputAudioEl = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.sourceNode = this.inputGainNode = this.inputAnalyserNode = null;
    this.gateGainNode = this.hpfNode = this.compressorNode = null;
    this.outputGainNode = this.outputAnalyserNode = this.streamDest = null;
    this._gateOpen = true;
  }

  setInputGain(v)  { if (this.inputGainNode)  this.inputGainNode.gain.value = v; }
  setOutputGain(v) { if (this.outputGainNode) this.outputGainNode.gain.value = v; }

  setHPF(enabled) {
    if (!this.hpfNode) return;
    // 10 Hz is below audible range — effectively a transparent bypass
    this.hpfNode.frequency.setTargetAtTime(enabled ? 80 : 10, this.ctx.currentTime, 0.01);
  }

  setCompressor(enabled) {
    if (!this.compressorNode) return;
    if (enabled) {
      this.compressorNode.threshold.setTargetAtTime(-24, this.ctx.currentTime, 0.05);
      this.compressorNode.ratio.setTargetAtTime(4, this.ctx.currentTime, 0.05);
    } else {
      this.compressorNode.threshold.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.compressorNode.ratio.setTargetAtTime(1, this.ctx.currentTime, 0.05);
    }
  }

  setGate(enabled, threshold) {
    this._gateEnabled = enabled;
    this._gateThreshold = threshold;
    if (!enabled && this.gateGainNode) {
      this.gateGainNode.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.01);
      this._gateOpen = true;
    }
  }

  // Called every animation frame; returns whether gate is currently open.
  processGate(inputDb) {
    if (!this.gateGainNode || !this.ctx) return true;
    if (!this._gateEnabled) return true;

    const shouldOpen = inputDb > this._gateThreshold;
    if (shouldOpen !== this._gateOpen) {
      this._gateOpen = shouldOpen;
      // Fast attack (5 ms), slower release (150 ms) to avoid click artifacts
      this.gateGainNode.gain.setTargetAtTime(
        shouldOpen ? 1.0 : 0.0,
        this.ctx.currentTime,
        shouldOpen ? 0.005 : 0.15,
      );
    }
    return this._gateOpen;
  }

  getInputAnalyser()  { return this.inputAnalyserNode; }
  getOutputAnalyser() { return this.outputAnalyserNode; }
  get isActive() { return this.ctx !== null && this.ctx.state === 'running'; }
}

// ─── Wake Lock ────────────────────────────────────────────────────────────────

class WakeLockManager {
  constructor() {
    this.lock = null;
    this.supported = 'wakeLock' in navigator;
  }

  async acquire() {
    if (!this.supported) return false;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => { this.lock = null; });
      return true;
    } catch {
      return false;
    }
  }

  release() {
    if (this.lock) { this.lock.release(); this.lock = null; }
  }

  get isActive() { return this.lock !== null; }
}

// ─── Device Manager ───────────────────────────────────────────────────────────

class DeviceManager {
  constructor() { this.hasPermission = false; }

  async requestPermission() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    this.hasPermission = true;
  }

  async getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs:  devices.filter(d => d.kind === 'audioinput'),
      outputs: devices.filter(d => d.kind === 'audiooutput'),
    };
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────

class iSpeakerApp {
  constructor() {
    this.router   = new AudioRouter();
    this.devices  = new DeviceManager();
    this.wakeLock = new WakeLockManager();
    this.running  = false;
    this.animFrame = null;
    this._timeBuf  = null;

    this._cacheDom();
    this._bindEvents();
    this._checkBrowserSupport();
  }

  _cacheDom() {
    const $ = id => document.getElementById(id);
    this.dom = {
      browserAlert:     $('browserAlert'),
      browserAlertTxt:  $('browserAlertText'),
      permAlert:        $('permissionAlert'),
      grantBtn:         $('grantPermBtn'),
      refreshBtn:       $('refreshBtn'),
      inputSelect:      $('inputSelect'),
      outputSelect:     $('outputSelect'),
      inputGainSlider:  $('inputGain'),
      outputGainSlider: $('outputGain'),
      inputGainVal:     $('inputGainVal'),
      outputGainVal:    $('outputGainVal'),
      hpfToggle:        $('hpfToggle'),
      compToggle:       $('compToggle'),
      gateToggle:       $('gateToggle'),
      gateThreshRow:    $('gateThresholdRow'),
      gateThreshold:    $('gateThreshold'),
      gateThreshVal:    $('gateThresholdVal'),
      gateStatusDot:    $('gateStatusDot'),
      gateStatusText:   $('gateStatusText'),
      inputMeterBar:    $('inputMeterBar'),
      outputMeterBar:   $('outputMeterBar'),
      inputDbVal:       $('inputDbVal'),
      outputDbVal:      $('outputDbVal'),
      startBtn:         $('startBtn'),
      startBtnText:     $('startBtnText'),
      startIcon:        $('startIcon'),
      statusDot:        $('statusDot'),
      statusText:       $('statusText'),
      wakeLockBadge:    $('wakeLockBadge'),
    };
  }

  _bindEvents() {
    this.dom.grantBtn.addEventListener('click', () => this._requestPermission());
    this.dom.refreshBtn.addEventListener('click', () => this._loadDevices());
    this.dom.startBtn.addEventListener('click', () => this._toggleRouting());

    this.dom.inputGainSlider.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      this.dom.inputGainVal.textContent = `${Math.round(v * 100)}%`;
      this.router.setInputGain(v);
    });

    this.dom.outputGainSlider.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      this.dom.outputGainVal.textContent = `${Math.round(v * 100)}%`;
      this.router.setOutputGain(v);
    });

    this.dom.hpfToggle.addEventListener('change', e => {
      this.router.setHPF(e.target.checked);
    });

    this.dom.compToggle.addEventListener('change', e => {
      this.router.setCompressor(e.target.checked);
    });

    this.dom.gateToggle.addEventListener('change', e => {
      const on = e.target.checked;
      this.dom.gateThreshRow.hidden = !on;
      this.router.setGate(on, parseFloat(this.dom.gateThreshold.value));
      if (!on) this._updateGateStatus(true);
    });

    this.dom.gateThreshold.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      this.dom.gateThreshVal.textContent = `${v} dB`;
      this.router.setGate(this.dom.gateToggle.checked, v);
    });

    navigator.mediaDevices?.addEventListener('devicechange', () => this._loadDevices());

    // Re-acquire wake lock after tab returns to foreground (OS releases it on hide)
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && this.running) {
        await this.wakeLock.acquire();
        this._updateWakeLockBadge();
      }
    });
  }

  _checkBrowserSupport() {
    const issues = [];
    if (!window.AudioContext) issues.push('Web Audio API not supported');
    if (!navigator.mediaDevices?.getUserMedia) issues.push('getUserMedia not supported');
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      issues.push('HTTPS is required for microphone access');
    }

    if (issues.length) {
      this.dom.browserAlert.hidden = false;
      this.dom.browserAlertTxt.textContent =
        issues.join('. ') + '. Please use Chrome or Edge on HTTPS.';
      return;
    }

    const hasOutputRouting =
      (typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype) ||
      (typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype);

    if (!hasOutputRouting) {
      this.dom.permAlert.hidden = false;
      this.dom.permAlert.querySelector('#permissionAlertText').textContent =
        'This browser cannot route to a specific output device. Use Chrome or Edge for full device selection.';
    }

    this._requestPermission();
  }

  async _requestPermission() {
    this._setStatus('Requesting microphone permission…', 'idle');
    try {
      await this.devices.requestPermission();
      this.dom.permAlert.hidden = true;
      await this._loadDevices();
      this._setStatus('Ready — select devices and press Start', 'ready');
      this.dom.startBtn.disabled = false;
    } catch {
      this.dom.permAlert.hidden = false;
      this._setStatus('Microphone permission denied', 'error');
    }
  }

  async _loadDevices() {
    if (!this.devices.hasPermission) return;
    const { inputs, outputs } = await this.devices.getDevices();
    this._populateSelect(this.dom.inputSelect,  inputs,  'Default Microphone');
    this._populateSelect(this.dom.outputSelect, outputs, 'Default Speaker');
    this.dom.inputSelect.disabled = false;
    this.dom.outputSelect.disabled = false;
  }

  _populateSelect(select, devices, defaultLabel) {
    const prev = select.value;
    select.innerHTML = `<option value="">— ${defaultLabel} —</option>`;
    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Device (${d.deviceId.slice(0, 8)}…)`;
      select.appendChild(opt);
    });
    if (prev && select.querySelector(`option[value="${prev}"]`)) select.value = prev;
  }

  async _toggleRouting() {
    if (this.running) this._stopRouting();
    else await this._startRouting();
  }

  async _startRouting() {
    this.dom.startBtn.disabled = true;
    this._setStatus('Starting audio pipeline…', 'idle');

    // Create and "touch" an audio element here, synchronously within the
    // button-click gesture. iOS requires audio.play() to be initiated within
    // a user gesture — after any await the gesture context is lost.
    // play() will reject (no source yet) but the element becomes unlocked,
    // so the real play() call inside the router will succeed.
    const unlockAudio = new Audio();
    unlockAudio.play().catch(() => {});

    try {
      const stats = await this.router.start({
        inputDeviceId:  this.dom.inputSelect.value,
        outputDeviceId: this.dom.outputSelect.value,
        inputGain:      parseFloat(this.dom.inputGainSlider.value),
        outputGain:     parseFloat(this.dom.outputGainSlider.value),
        unlockAudio,
      });

      this.router.setHPF(this.dom.hpfToggle.checked);
      this.router.setCompressor(this.dom.compToggle.checked);
      this.router.setGate(this.dom.gateToggle.checked, parseFloat(this.dom.gateThreshold.value));

      this.running = true;
      this._setRunningState(true, stats);
      this._startMeterLoop();
      this._registerMediaSession();

      await this.wakeLock.acquire();
      this._updateWakeLockBadge();

    } catch (err) {
      this._setStatus(`Error: ${err.message}`, 'error');
      this.dom.startBtn.disabled = false;
    }
  }

  _stopRouting() {
    this.router.stop();
    this.running = false;
    cancelAnimationFrame(this.animFrame);
    this.wakeLock.release();
    this._clearMediaSession();
    this._setRunningState(false, null);
    this._resetMeters();
    this._updateWakeLockBadge();
  }

  _registerMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'iSpeaker',
      artist: 'Live Audio Routing Active',
      album: 'iSpeaker — Bluetooth Audio Router',
      artwork: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
    navigator.mediaSession.playbackState = 'playing';
    // Stop button on the lock screen / notification shade maps to stopping the routing
    navigator.mediaSession.setActionHandler('stop',  () => this._stopRouting());
    navigator.mediaSession.setActionHandler('pause', () => this._stopRouting());
  }

  _clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = 'none';
    for (const action of ['stop', 'pause', 'play']) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch {}
    }
  }

  _setRunningState(isRunning, stats) {
    this.dom.startBtn.disabled = false;
    this.dom.startBtn.classList.toggle('running', isRunning);
    this.dom.startBtnText.textContent = isRunning ? 'Stop Routing' : 'Start Routing';
    this.dom.startIcon.innerHTML = isRunning
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';

    if (isRunning) {
      this._setStatus('Routing live audio', 'active');
    } else {
      this._setStatus('Stopped', 'ready');
    }
  }

  // ── Metering & Gate ───────────────────────────────────

  _startMeterLoop() {
    const inA  = this.router.getInputAnalyser();
    const outA = this.router.getOutputAnalyser();
    if (!inA || !outA) return;

    this._timeBuf = new Float32Array(inA.fftSize);

    const tick = () => {
      if (!this.running) return;
      this.animFrame = requestAnimationFrame(tick);

      // Input level (pre-gate, used also for gate decisions)
      inA.getFloatTimeDomainData(this._timeBuf);
      const inputDb = this._toDb(this._rms(this._timeBuf));

      const gateOpen = this.router.processGate(inputDb);
      if (this.dom.gateToggle.checked) this._updateGateStatus(gateOpen);

      this.dom.inputMeterBar.style.width = `${this._dbToPct(inputDb)}%`;
      this.dom.inputDbVal.textContent    = isFinite(inputDb) ? `${inputDb.toFixed(0)} dB` : '—';

      // Output level (post all processing)
      outA.getFloatTimeDomainData(this._timeBuf);
      const outputDb = this._toDb(this._rms(this._timeBuf));

      this.dom.outputMeterBar.style.width = `${this._dbToPct(outputDb)}%`;
      this.dom.outputDbVal.textContent    = isFinite(outputDb) ? `${outputDb.toFixed(0)} dB` : '—';
    };

    tick();
  }

  _resetMeters() {
    this.dom.inputMeterBar.style.width  = '0%';
    this.dom.outputMeterBar.style.width = '0%';
    this.dom.inputDbVal.textContent     = '—';
    this.dom.outputDbVal.textContent    = '—';
    this._updateGateStatus(true);
  }

  _updateGateStatus(open) {
    this.dom.gateStatusDot.className    = `gate-dot ${open ? 'gate-open' : 'gate-closed'}`;
    this.dom.gateStatusText.textContent = open ? 'Open' : 'Muted';
  }

  _updateWakeLockBadge() {
    this.dom.wakeLockBadge.hidden = !this.wakeLock.isActive;
  }

  // ── Math Helpers ──────────────────────────────────────

  _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  _toDb(rms) { return rms > 0 ? 20 * Math.log10(rms) : -Infinity; }

  _dbToPct(db) { return ((Math.max(-60, Math.min(0, db)) + 60) / 60) * 100; }

  _setStatus(msg, type) {
    this.dom.statusText.textContent = msg;
    this.dom.statusDot.className    = 'status-dot dot-' + type;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new iSpeakerApp());
} else {
  new iSpeakerApp();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
