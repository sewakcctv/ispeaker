'use strict';

// ─── iSpeaker: Real-time Bluetooth Audio Router ───────────────────────────────

class AudioRouter {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.sourceNode = null;
    this.inputGainNode = null;
    this.outputGainNode = null;
    this.analyserNode = null;
    this.streamDest = null;
    this.outputAudioEl = null;
    this.outputMethod = null; // 'sinkId-context' | 'sinkId-element' | 'default'
  }

  async start({ inputDeviceId, outputDeviceId, inputGain, outputGain }) {
    // Capture from selected mic with lowest possible latency settings
    const constraints = {
      audio: {
        deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: 0,
        channelCount: 1,
      },
      video: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    // Nodes
    this.sourceNode = this.ctx.createMediaStreamSource(this.stream);
    this.inputGainNode = this.ctx.createGain();
    this.inputGainNode.gain.value = inputGain;
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 512;
    this.analyserNode.smoothingTimeConstant = 0.6;
    this.outputGainNode = this.ctx.createGain();
    this.outputGainNode.gain.value = outputGain;

    // source → inputGain → analyser → outputGain → [ output ]
    this.sourceNode.connect(this.inputGainNode);
    this.inputGainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.outputGainNode);

    this.outputMethod = await this._routeOutput(outputDeviceId);

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return {
      sampleRate: this.ctx.sampleRate,
      baseLatency: this.ctx.baseLatency,
      outputMethod: this.outputMethod,
    };
  }

  async _routeOutput(outputDeviceId) {
    if (!outputDeviceId) {
      // Default system output
      this.outputGainNode.connect(this.ctx.destination);
      return 'default';
    }

    // Method 1: AudioContext.setSinkId() — Chrome 110+, most efficient
    if (typeof this.ctx.setSinkId === 'function') {
      try {
        await this.ctx.setSinkId(outputDeviceId);
        this.outputGainNode.connect(this.ctx.destination);
        return 'sinkId-context';
      } catch (_) {
        // fall through
      }
    }

    // Method 2: HTMLAudioElement.setSinkId() — broader support
    if (typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype) {
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.outputGainNode.connect(this.streamDest);

      this.outputAudioEl = new Audio();
      this.outputAudioEl.srcObject = this.streamDest.stream;
      await this.outputAudioEl.setSinkId(outputDeviceId);
      await this.outputAudioEl.play();
      return 'sinkId-element';
    }

    // Fallback: default output, warn caller
    this.outputGainNode.connect(this.ctx.destination);
    return 'default-fallback';
  }

  stop() {
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
    this.sourceNode = this.inputGainNode = this.outputGainNode = null;
    this.analyserNode = this.streamDest = null;
  }

  setInputGain(value) {
    if (this.inputGainNode) this.inputGainNode.gain.value = value;
  }

  setOutputGain(value) {
    if (this.outputGainNode) this.outputGainNode.gain.value = value;
  }

  getAnalyser() {
    return this.analyserNode;
  }

  get isActive() {
    return this.ctx !== null && this.ctx.state === 'running';
  }
}

// ─── Device Manager ───────────────────────────────────────────────────────────

class DeviceManager {
  constructor() {
    this.hasPermission = false;
  }

  async requestPermission() {
    // getUserMedia triggers the browser permission prompt and labels devices
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
    this.router = new AudioRouter();
    this.devices = new DeviceManager();
    this.running = false;
    this.animFrame = null;

    this._cacheDom();
    this._bindEvents();
    this._checkBrowserSupport();
  }

  _cacheDom() {
    this.dom = {
      browserAlert:    document.getElementById('browserAlert'),
      browserAlertTxt: document.getElementById('browserAlertText'),
      permAlert:       document.getElementById('permissionAlert'),
      grantBtn:        document.getElementById('grantPermBtn'),
      refreshBtn:      document.getElementById('refreshBtn'),
      inputSelect:     document.getElementById('inputSelect'),
      outputSelect:    document.getElementById('outputSelect'),
      inputGainSlider: document.getElementById('inputGain'),
      outputGainSlider:document.getElementById('outputGain'),
      inputGainVal:    document.getElementById('inputGainVal'),
      outputGainVal:   document.getElementById('outputGainVal'),
      inputMeterBar:   document.getElementById('inputMeterBar'),
      outputMeterBar:  document.getElementById('outputMeterBar'),
      inputDbVal:      document.getElementById('inputDbVal'),
      outputDbVal:     document.getElementById('outputDbVal'),
      statsSection:    document.getElementById('statsSection'),
      statLatency:     document.getElementById('statLatency'),
      statSampleRate:  document.getElementById('statSampleRate'),
      statOutputMethod:document.getElementById('statOutputMethod'),
      statState:       document.getElementById('statState'),
      startBtn:        document.getElementById('startBtn'),
      startBtnText:    document.getElementById('startBtnText'),
      startIcon:       document.getElementById('startIcon'),
      statusDot:       document.getElementById('statusDot'),
      statusText:      document.getElementById('statusText'),
    };
  }

  _bindEvents() {
    this.dom.grantBtn.addEventListener('click', () => this._requestPermission());
    this.dom.refreshBtn.addEventListener('click', () => this._loadDevices());
    this.dom.startBtn.addEventListener('click', () => this._toggleRouting());

    this.dom.inputGainSlider.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      this.dom.inputGainVal.textContent = `${val.toFixed(2)}×`;
      this.router.setInputGain(val);
    });

    this.dom.outputGainSlider.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      this.dom.outputGainVal.textContent = `${Math.round(val * 100)}%`;
      this.router.setOutputGain(val);
    });

    navigator.mediaDevices?.addEventListener('devicechange', () => this._loadDevices());
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
      this.dom.browserAlertTxt.textContent = issues.join('. ') + '. Please use Chrome or Edge on HTTPS.';
      return;
    }

    const hasOutputRouting = (
      typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
    ) || (
      typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype
    );

    if (!hasOutputRouting) {
      this.dom.permAlert.hidden = false;
      this.dom.permAlert.querySelector('#permissionAlertText').textContent =
        'This browser cannot route audio to a specific output device. Output will use system default. Use Chrome or Edge for full device selection.';
      this.dom.grantBtn.textContent = 'Got it';
      this.dom.grantBtn.addEventListener('click', () => { this.dom.permAlert.hidden = true; }, { once: true });
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
    } catch (err) {
      this.dom.permAlert.hidden = false;
      this._setStatus('Microphone permission denied', 'error');
    }
  }

  async _loadDevices() {
    if (!this.devices.hasPermission) return;

    const { inputs, outputs } = await this.devices.getDevices();

    this._populateSelect(this.dom.inputSelect, inputs, 'Default Microphone', false);
    this._populateSelect(this.dom.outputSelect, outputs, 'Default Speaker', false);

    this.dom.inputSelect.disabled = false;
    this.dom.outputSelect.disabled = false;
  }

  _populateSelect(select, devices, defaultLabel, disabled) {
    const prevVal = select.value;
    select.innerHTML = `<option value="">— ${defaultLabel} —</option>`;
    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Device (${d.deviceId.slice(0, 8)}…)`;
      select.appendChild(opt);
    });
    // Restore previous selection if still available
    if (prevVal && select.querySelector(`option[value="${prevVal}"]`)) {
      select.value = prevVal;
    }
    select.disabled = disabled;
  }

  async _toggleRouting() {
    if (this.running) {
      this._stopRouting();
    } else {
      await this._startRouting();
    }
  }

  async _startRouting() {
    this.dom.startBtn.disabled = true;
    this._setStatus('Starting audio pipeline…', 'idle');

    try {
      const stats = await this.router.start({
        inputDeviceId:  this.dom.inputSelect.value,
        outputDeviceId: this.dom.outputSelect.value,
        inputGain:      parseFloat(this.dom.inputGainSlider.value),
        outputGain:     parseFloat(this.dom.outputGainSlider.value),
      });

      this.running = true;
      this._setRunningState(true, stats);
      this._startMeterLoop();

    } catch (err) {
      this._setStatus(`Error: ${err.message}`, 'error');
      this.dom.startBtn.disabled = false;
    }
  }

  _stopRouting() {
    this.router.stop();
    this.running = false;
    cancelAnimationFrame(this.animFrame);
    this._setRunningState(false, null);
    this._resetMeters();
  }

  _setRunningState(isRunning, stats) {
    this.dom.startBtn.disabled = false;
    this.dom.startBtn.classList.toggle('running', isRunning);
    this.dom.startBtnText.textContent = isRunning ? 'Stop Routing' : 'Start Routing';

    // Swap play/stop icon
    this.dom.startIcon.innerHTML = isRunning
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';

    if (isRunning && stats) {
      const latencyMs = stats.baseLatency != null
        ? `${(stats.baseLatency * 1000).toFixed(1)} ms (Web Audio only; add BT latency)`
        : 'Unknown';

      const methodLabel = {
        'sinkId-context':  'AudioContext.setSinkId ✓',
        'sinkId-element':  'HTMLAudio.setSinkId ✓',
        'default':         'System default',
        'default-fallback':'System default (setSinkId unsupported)',
      }[stats.outputMethod] ?? stats.outputMethod;

      this.dom.statLatency.textContent = latencyMs;
      this.dom.statSampleRate.textContent = `${stats.sampleRate.toLocaleString()} Hz`;
      this.dom.statOutputMethod.textContent = methodLabel;
      this.dom.statState.textContent = 'Routing ▶';
      this.dom.statsSection.hidden = false;

      this._setStatus('Routing live audio', 'active');
    } else {
      this.dom.statsSection.hidden = true;
      this._setStatus('Stopped', 'ready');
    }
  }

  // ─── Level Metering ──────────────────────────────────────

  _startMeterLoop() {
    const analyser = this.router.getAnalyser();
    if (!analyser) return;

    const bufLen = analyser.frequencyBinCount;
    const timeBuf = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!this.running) return;
      this.animFrame = requestAnimationFrame(tick);

      analyser.getFloatTimeDomainData(timeBuf);
      const inputRms = this._rms(timeBuf);
      const inputDb  = this._toDb(inputRms);
      const pct      = this._dbToPct(inputDb);

      this.dom.inputMeterBar.style.width = `${pct}%`;
      this.dom.inputDbVal.textContent = isFinite(inputDb) ? `${inputDb.toFixed(0)} dB` : '—';

      // Output mirrors input after gain
      const outGain = parseFloat(this.dom.outputGainSlider.value);
      const outRms  = inputRms * outGain;
      const outDb   = this._toDb(outRms);
      const outPct  = this._dbToPct(outDb);

      this.dom.outputMeterBar.style.width = `${outPct}%`;
      this.dom.outputDbVal.textContent = isFinite(outDb) ? `${outDb.toFixed(0)} dB` : '—';
    };

    tick();
  }

  _resetMeters() {
    this.dom.inputMeterBar.style.width = '0%';
    this.dom.outputMeterBar.style.width = '0%';
    this.dom.inputDbVal.textContent = '—';
    this.dom.outputDbVal.textContent = '—';
  }

  _rms(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  _toDb(rms) {
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  _dbToPct(db) {
    // Map -60dB → 0%, 0dB → 100%
    const clamped = Math.max(-60, Math.min(0, db));
    return ((clamped + 60) / 60) * 100;
  }

  // ─── Status ──────────────────────────────────────────────

  _setStatus(msg, type) {
    this.dom.statusText.textContent = msg;
    this.dom.statusDot.className = 'status-dot dot-' + type;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new iSpeakerApp());
} else {
  new iSpeakerApp();
}

// ─── Service Worker Registration ──────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
