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

    this._gateEnabled = false;
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
    // 1. AudioContext.setSinkId — Chrome 110+, most direct
    if (outputDeviceId && typeof this.ctx.setSinkId === 'function') {
      try {
        await this.ctx.setSinkId(outputDeviceId);
        this.outputAnalyserNode.connect(this.ctx.destination);
        return 'sinkId-context';
      } catch (_) {}
    }

    // 2. HTMLAudioElement.setSinkId — routes to a specific output device
    //    Always use a FRESH element here, not the unlock element
    if (outputDeviceId && 'setSinkId' in HTMLAudioElement.prototype) {
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.outputAnalyserNode.connect(this.streamDest);
      this.outputAudioEl = new Audio();
      this.outputAudioEl.srcObject = this.streamDest.stream;
      try {
        await this.outputAudioEl.setSinkId(outputDeviceId);
        await this.outputAudioEl.play();
        return 'sinkId-element';
      } catch (_) {
        this.outputAnalyserNode.disconnect(this.streamDest);
        this.streamDest = null;
        this.outputAudioEl = null;
      }
    }

    // 3. Default output — use the pre-unlocked element (helps iOS standalone PWA),
    //    fall back to ctx.destination if play() is still blocked (iOS Safari browser)
    this.streamDest = this.ctx.createMediaStreamDestination();
    this.outputAnalyserNode.connect(this.streamDest);
    this.outputAudioEl = this._unlockAudio || new Audio();
    this._unlockAudio = null;
    this.outputAudioEl.srcObject = this.streamDest.stream;
    try {
      await this.outputAudioEl.play();
      return 'default';
    } catch {
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
    this._broadcastDest = null;
    this._recordingDest = null;
    this._gateOpen = true;
  }

  // Returns a MediaStream of the fully-processed output — used by BroadcastManager.
  getBroadcastStream() {
    if (!this.ctx || !this.outputGainNode) return null;
    if (!this._broadcastDest) {
      this._broadcastDest = this.ctx.createMediaStreamDestination();
      this.outputGainNode.connect(this._broadcastDest);
    }
    return this._broadcastDest.stream;
  }

  // Returns a MediaStream tapped off the processed output — used by RecordingManager.
  getRecordingStream() {
    if (!this.ctx || !this.outputGainNode) return null;
    if (!this._recordingDest) {
      this._recordingDest = this.ctx.createMediaStreamDestination();
      this.outputGainNode.connect(this._recordingDest);
    }
    return this._recordingDest.stream;
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

// ─── Recording Manager ────────────────────────────────────────────────────────

class RecordingManager {
  constructor() {
    this._recorder  = null;
    this._chunks    = [];
    this._mimeType  = '';
    this._startTime = null;
  }

  get supported() { return typeof MediaRecorder !== 'undefined'; }
  get isRecording() { return this._recorder?.state === 'recording'; }

  get elapsed() {
    if (!this._startTime) return 0;
    return Math.floor((Date.now() - this._startTime) / 1000);
  }

  start(stream) {
    if (!this.supported) return false;
    this._mimeType = this._bestMime();
    this._chunks   = [];
    try {
      this._recorder = new MediaRecorder(stream, this._mimeType ? { mimeType: this._mimeType } : {});
    } catch {
      this._recorder = new MediaRecorder(stream);
    }
    this._recorder.ondataavailable = e => { if (e.data?.size > 0) this._chunks.push(e.data); };
    this._recorder.start(500);
    this._startTime = Date.now();
    return true;
  }

  stop() {
    return new Promise(resolve => {
      if (!this._recorder || this._recorder.state === 'inactive') { resolve(null); return; }
      this._recorder.onstop = () => {
        const mime = this._recorder.mimeType || this._mimeType || 'audio/webm';
        const blob = new Blob(this._chunks, { type: mime });
        this._chunks    = [];
        this._startTime = null;
        this._recorder  = null;
        resolve(blob);
      };
      this._recorder.stop();
    });
  }

  download(blob) {
    const ext  = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const ts   = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const name = `ispeaker_${ts}.${ext}`;
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  _bestMime() {
    // Prefer mp4/m4a — plays natively on iOS and Android.
    // WebM is only a fallback for desktop Chrome where mp4 encoding isn't supported.
    for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
      if (MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return '';
  }
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
    const inputs  = this._filterDevices(devices.filter(d => d.kind === 'audioinput'));
    const outputs = this._filterDevices(devices.filter(d => d.kind === 'audiooutput'));
    return { inputs, outputs };
  }

  // Remove virtual/low-quality mode duplicates (Headset, Receiver, Speakerphone, HFP).
  _filterDevices(devices) {
    const VIRTUAL_RE = /\s*\((Headset|Receiver|Speakerphone|HFP|Handsfree)\)\s*$/i;
    const list = devices.filter(d => d.deviceId !== 'communications');

    const realBases = new Set();
    for (const d of list) {
      if (!VIRTUAL_RE.test(d.label || '')) realBases.add(this._deviceBase(d.label));
    }

    const filtered = list.filter(d => {
      if (!VIRTUAL_RE.test(d.label || '')) return true;
      return !realBases.has(this._deviceBase(d.label));
    });

    return filtered.length ? filtered : list;
  }

  _deviceBase(label) {
    return (label || '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────

class iSpeakerApp {
  constructor() {
    this.router    = new AudioRouter();
    this.recorder  = new RecordingManager();
    this.devices   = new DeviceManager();
    this.wakeLock  = new WakeLockManager();
    this.running   = false;
    this.animFrame = null;
    this._timeBuf  = null;
    this._recTimer = null;

    this._cacheDom();
    this._bindEvents();
    this._initSliders();
    this._init();
  }

  _cacheDom() {
    const $ = id => document.getElementById(id);
    this.dom = {
      // navigation
      backBtn:          $('backBtn'),
      settingsBtn:      $('settingsBtn'),
      tagline:          $('tagline'),
      // home screen
      homeScreen:       $('homeScreen'),
      openRouterBtn:    $('openRouterBtn'),
      // settings sheet
      settingsOverlay:  $('settingsOverlay'),
      closeSettingsBtn: $('closeSettingsBtn'),
      settingsRoomCode: $('settingsRoomCode'),
      resetCodeBtn:     $('resetCodeBtn'),
      // host UI
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
      hostContent:      $('hostContent'),
      // recording
      recordBtn:        $('recordBtn'),
      recordBtnText:    $('recordBtnText'),
      recordTimer:      $('recordTimer'),
      // broadcast panel (host)
      broadcastPanel:   $('broadcastPanel'),
      broadcastToggle:  $('broadcastToggle'),
      broadcastActive:  $('broadcastActive'),
      broadcastDot:     $('broadcastDot'),
      broadcastStatus:  $('broadcastStatus'),
      roomCodeDisplay:  $('roomCodeDisplay'),
      copyLinkBtn:      $('copyLinkBtn'),
      listenerBadge:    $('listenerBadge'),
      // listener UI
      listenerPanel:    $('listenerPanel'),
      listenDot:        $('listenDot'),
      listenStatusTxt:  $('listenStatusTxt'),
      listenRoomCode:   $('listenRoomCode'),
      listenJoinBtn:    $('listenJoinBtn'),
      listenOutputCard: $('listenOutputCard'),
      listenOutputSel:  $('listenOutputSel'),
      listenVolume:     $('listenVolume'),
      listenVolumeVal:  $('listenVolumeVal'),
    };
  }

  _bindEvents() {
    // navigation
    this.dom.backBtn.addEventListener('click',      () => this._goBack());
    this.dom.openRouterBtn.addEventListener('click', () => this._enterRouter());
    this.dom.settingsBtn.addEventListener('click',   () => this._openSettings());
    this.dom.closeSettingsBtn.addEventListener('click', () => this._closeSettings());
    this.dom.settingsOverlay.addEventListener('click', e => {
      if (e.target === this.dom.settingsOverlay) this._closeSettings();
    });

    // settings actions
    this.dom.resetCodeBtn.addEventListener('click', () => {
      if (window.broadcastManager?.broadcasting) return;
      const code = window.broadcastManager.resetCode();
      this.dom.settingsRoomCode.textContent = code;
    });

    // router controls
    this.dom.grantBtn.addEventListener('click',   () => this._requestPermission());
    this.dom.refreshBtn.addEventListener('click', () => this._loadDevices());
    this.dom.startBtn.addEventListener('click',   () => this._toggleRouting());

    this.dom.inputGainSlider.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      this.dom.inputGainVal.textContent = `${Math.round(v * 100)}%`;
      this._setSliderFill(e.target);
      this.router.setInputGain(v);
    });

    this.dom.outputGainSlider.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      this.dom.outputGainVal.textContent = `${Math.round(v * 100)}%`;
      this._setSliderFill(e.target);
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
      this._setSliderFill(e.target);
      this.router.setGate(this.dom.gateToggle.checked, v);
    });

    navigator.mediaDevices?.addEventListener('devicechange', () => this._loadDevices());

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && this.running) {
        await this.wakeLock.acquire();
        this._updateWakeLockBadge();
      }
    });

    // broadcast
    this.dom.broadcastToggle.addEventListener('click', () => {
      if (window.broadcastManager?.broadcasting) this._stopBroadcast();
      else this._startBroadcast();
    });

    this.dom.copyLinkBtn.addEventListener('click', () => {
      const code = window.broadcastManager?.code;
      if (!code) return;
      const url = `${location.origin}${location.pathname}?join=${code}`;
      navigator.clipboard?.writeText(url).then(() => {
        this.dom.copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => this.dom.copyLinkBtn.textContent = 'Copy Link', 2000);
      });
    });

    // recording
    this.dom.recordBtn.addEventListener('click', () => this._toggleRecording());
  }

  // ── Startup ──────────────────────────────────────────

  _init() {
    const joinCode = new URLSearchParams(location.search).get('join');
    if (joinCode) {
      this._showScreen('listener');
      this._initListenerMode(joinCode);
      return;
    }
    this._showScreen('home');
  }

  _showScreen(name) {
    this.dom.homeScreen.hidden    = name !== 'home';
    this.dom.hostContent.hidden   = name !== 'router';
    this.dom.listenerPanel.hidden = name !== 'listener';
    this.dom.backBtn.hidden       = name === 'home';

    const taglines = { home: 'Audio Tools', router: 'Audio Router', listener: 'Live Listener' };
    this.dom.tagline.textContent = taglines[name] ?? '';
  }

  _goBack() {
    if (this.running) this._stopRouting();
    this._showScreen('home');
  }

  _enterRouter() {
    this._showScreen('router');
    if (!this._checkBrowserSupport()) return;
    if (!this.devices.hasPermission) this._requestPermission();
  }

  // ── Settings ──────────────────────────────────────────

  _openSettings() {
    const code = window.broadcastManager?.persistentCode ?? '——————';
    this.dom.settingsRoomCode.textContent = code;
    this.dom.resetCodeBtn.disabled = window.broadcastManager?.broadcasting ?? false;
    this.dom.settingsOverlay.hidden = false;
    // trigger CSS transition
    requestAnimationFrame(() => this.dom.settingsOverlay.classList.add('open'));
  }

  _closeSettings() {
    this.dom.settingsOverlay.classList.remove('open');
    this.dom.settingsOverlay.addEventListener('transitionend', () => {
      this.dom.settingsOverlay.hidden = true;
    }, { once: true });
  }

  // ── Browser / Permission ──────────────────────────────

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
      return false;
    }

    const hasOutputRouting =
      (typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype) ||
      (typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype);

    if (!hasOutputRouting) {
      this.dom.permAlert.hidden = false;
      this.dom.permAlert.querySelector('#permissionAlertText').textContent =
        'This browser cannot route to a specific output device. Use Chrome or Edge for full device selection.';
    }

    return true;
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

  _setSliderFill(el) {
    const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--sl-fill', `${pct}%`);
  }

  _initSliders() {
    for (const el of [this.dom.inputGainSlider, this.dom.outputGainSlider, this.dom.gateThreshold]) {
      this._setSliderFill(el);
    }
  }

  // ── Routing ──────────────────────────────────────────

  async _toggleRouting() {
    if (this.running) this._stopRouting();
    else await this._startRouting();
  }

  async _startRouting() {
    this.dom.startBtn.disabled = true;
    this._setStatus('Starting audio pipeline…', 'idle');

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
    if (this.recorder.isRecording) this._stopRecording();
    if (window.broadcastManager?.broadcasting) this._stopBroadcast();
    this.router.stop();
    this.running = false;
    cancelAnimationFrame(this.animFrame);
    this.wakeLock.release();
    this._clearMediaSession();
    this._setRunningState(false, null);
    this._resetMeters();
    this._updateWakeLockBadge();
  }

  _setRunningState(isRunning, stats) {
    this.dom.startBtn.disabled = false;
    this.dom.startBtn.classList.toggle('running', isRunning);
    this.dom.startBtnText.textContent = isRunning ? 'Stop Routing' : 'Start Routing';
    this.dom.startIcon.innerHTML = isRunning
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';

    // Show/hide recording button based on routing state
    this.dom.recordBtn.hidden = !isRunning || !this.recorder.supported;

    // Show broadcast panel only while routing is live
    this.dom.broadcastPanel.hidden = !isRunning;
    if (!isRunning) {
      this.dom.broadcastActive.hidden = true;
      this.dom.broadcastToggle.textContent = 'Start';
      this.dom.broadcastDot.className = 'status-dot dot-idle';
      this.dom.broadcastStatus.textContent = 'Not broadcasting';
      // reset recording UI
      this._setRecordingState(false);
    }

    if (isRunning) {
      this._setStatus('Routing live audio', 'active');
    } else {
      this._setStatus('Stopped', 'ready');
    }
  }

  // ── Recording ────────────────────────────────────────

  async _toggleRecording() {
    if (this.recorder.isRecording) {
      await this._stopRecording();
    } else {
      this._startRecording();
    }
  }

  _startRecording() {
    const stream = this.router.getRecordingStream();
    if (!stream) return;
    const started = this.recorder.start(stream);
    if (!started) return;
    this._setRecordingState(true);
    this._recTimer = setInterval(() => this._updateRecordTimer(), 1000);
  }

  async _stopRecording() {
    clearInterval(this._recTimer);
    this._recTimer = null;
    const blob = await this.recorder.stop();
    this._setRecordingState(false);
    if (blob) this.recorder.download(blob);
  }

  _setRecordingState(isRecording) {
    this.dom.recordBtn.classList.toggle('recording', isRecording);
    this.dom.recordBtnText.textContent = isRecording ? 'Stop & Save' : 'Record';
    this.dom.recordTimer.hidden = !isRecording;
    if (!isRecording) this.dom.recordTimer.textContent = '0:00';
  }

  _updateRecordTimer() {
    const s   = this.recorder.elapsed;
    const min = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    this.dom.recordTimer.textContent = `${min}:${sec}`;
  }

  // ── Broadcast (host) ──────────────────────────────────

  async _startBroadcast() {
    if (!window.broadcastManager) return;
    const stream = this.router.getBroadcastStream();
    if (!stream) return;

    this.dom.broadcastToggle.disabled = true;
    try {
      const code = await window.broadcastManager.startBroadcast(stream);
      this.dom.roomCodeDisplay.textContent = code;
      this.dom.broadcastActive.hidden = false;
      this.dom.broadcastToggle.textContent = 'Stop';
      this.dom.broadcastDot.className = 'status-dot dot-active';
      this.dom.broadcastStatus.textContent = 'Broadcasting';
      this.dom.listenerBadge.textContent = '0 listening';

      window.broadcastManager.onCount = n => {
        this.dom.listenerBadge.textContent = `${n} listener${n === 1 ? '' : 's'}`;
      };
    } catch (err) {
      this.dom.broadcastStatus.textContent = `Error: ${err.message}`;
    }
    this.dom.broadcastToggle.disabled = false;
  }

  async _stopBroadcast() {
    if (!window.broadcastManager) return;
    await window.broadcastManager.stopBroadcast();
    this.dom.broadcastActive.hidden = true;
    this.dom.broadcastToggle.textContent = 'Start';
    this.dom.broadcastDot.className = 'status-dot dot-idle';
    this.dom.broadcastStatus.textContent = 'Not broadcasting';
  }

  // ── Listener mode ──────────────────────────────────────

  _initListenerMode(code) {
    this.dom.listenRoomCode.textContent = code.toUpperCase();

    let _session  = null;
    let _audioEl  = null;
    let _listenGain = 1;

    const setStatus = (state, msg) => {
      this.dom.listenDot.className = 'status-dot dot-' + state;
      this.dom.listenStatusTxt.textContent = msg;
    };

    const onStream = stream => {
      if (!_audioEl) return;
      _audioEl.srcObject = stream;
      _audioEl.volume = _listenGain;
      _audioEl.play().catch(() => {});
      this.dom.listenOutputCard.hidden = false;
      setStatus('active', 'Live — audio playing');

      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(devs => {
          const outputs = devs.filter(d => d.kind === 'audiooutput');
          const sel = this.dom.listenOutputSel;
          sel.innerHTML = '<option value="">— Default Speaker —</option>';
          outputs.forEach(d => {
            if (d.deviceId === 'default' || d.deviceId === 'communications') return;
            const o = document.createElement('option');
            o.value = d.deviceId;
            o.textContent = d.label || `Speaker (${d.deviceId.slice(0,8)}…)`;
            sel.appendChild(o);
          });
        });
      }
    };

    const onStatus = state => {
      if (state === 'connected')         setStatus('active', 'Connected — waiting for audio…');
      else if (state === 'ended')        setStatus('idle',  'Broadcast has ended');
      else if (state === 'failed')       setStatus('error', 'Connection failed — try refreshing');
      else if (state === 'disconnected') setStatus('error', 'Disconnected');
    };

    this.dom.listenJoinBtn.addEventListener('click', async () => {
      this.dom.listenJoinBtn.disabled = true;
      setStatus('idle', 'Connecting…');

      _audioEl = new Audio();
      _audioEl.autoplay = true;
      _audioEl.play().catch(() => {});

      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (s) s.getTracks().forEach(t => t.stop());

        _session = await window.broadcastManager.joinRoom(code, onStream, onStatus);
        setStatus('idle', 'Connected — waiting for audio…');
        this.dom.listenJoinBtn.hidden = true;
      } catch (err) {
        setStatus('error', err.message);
        this.dom.listenJoinBtn.disabled = false;
      }
    });

    this.dom.listenVolume.addEventListener('input', e => {
      _listenGain = parseFloat(e.target.value);
      this.dom.listenVolumeVal.textContent = `${Math.round(_listenGain * 100)}%`;
      this._setSliderFill(e.target);
      if (_audioEl) _audioEl.volume = Math.min(1, _listenGain);
    });
    this._setSliderFill(this.dom.listenVolume);

    this.dom.listenOutputSel.addEventListener('change', async e => {
      if (_audioEl && 'setSinkId' in _audioEl) {
        await _audioEl.setSinkId(e.target.value).catch(() => {});
      }
    });
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

      inA.getFloatTimeDomainData(this._timeBuf);
      const inputDb = this._toDb(this._rms(this._timeBuf));

      const gateOpen = this.router.processGate(inputDb);
      if (this.dom.gateToggle.checked) this._updateGateStatus(gateOpen);

      this.dom.inputMeterBar.style.width = `${this._dbToPct(inputDb)}%`;
      this.dom.inputDbVal.textContent    = isFinite(inputDb) ? `${inputDb.toFixed(0)} dB` : '—';

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

  // ── Media Session ──────────────────────────────────────

  _registerMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'iSpeaker',
      artist: 'Live Audio Routing Active',
      album: 'iSpeaker — Bluetooth Audio Router',
      artwork: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
    navigator.mediaSession.playbackState = 'playing';
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
