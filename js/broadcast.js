'use strict';

// Firebase config for WebRTC signalling — audio never touches this server,
// only the tiny SDP offer/answer and ICE candidate messages.
const _FB_CFG = {
  apiKey:            'AIzaSyCgPfN0jEk6Hsc6FKePryjIOZjsIoWM5aQ',
  authDomain:        'ispeaker-signal.firebaseapp.com',
  databaseURL:       'https://ispeaker-signal-default-rtdb.firebaseio.com',
  projectId:         'ispeaker-signal',
  storageBucket:     'ispeaker-signal.firebasestorage.app',
  messagingSenderId: '103140856943',
  appId:             '1:103140856943:web:9a4d01363d8fb4ab0f699a',
};

const _ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function _db() {
  if (!window._fbDbInstance) {
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(_FB_CFG);
    window._fbDbInstance = firebase.database(app);
  }
  return window._fbDbInstance;
}

function _roomCode() {
  const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/I/1 ambiguity
  return Array.from({ length: 6 }, () => C[Math.floor(Math.random() * C.length)]).join('');
}

function _uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── BroadcastManager ─────────────────────────────────────────────────────────

class BroadcastManager {
  constructor() {
    this._peers   = new Map(); // listenerId → RTCPeerConnection
    this._code    = null;
    this._roomRef = null;
    this._stream  = null;

    this.onCount = null; // callback: (connectedCount: number) => void
  }

  // ── HOST: start/stop ──────────────────────────────────

  async startBroadcast(audioStream) {
    this._stream = audioStream;
    this._code   = _roomCode();
    this._roomRef = _db().ref('rooms/' + this._code);

    await this._roomRef.set({ active: true, ts: Date.now() });
    // Remove room from Firebase automatically if the tab closes
    this._roomRef.onDisconnect().remove();

    // React to every new listener that joins
    this._roomRef.child('listeners').on('child_added', snap => {
      this._connectListener(snap.key);
    });

    return this._code;
  }

  async _connectListener(lid) {
    if (this._peers.has(lid)) return;

    const pc   = new RTCPeerConnection(_ICE);
    const lRef = this._roomRef.child('listeners/' + lid);
    this._peers.set(lid, pc);

    // Send our processed audio to this listener
    this._stream.getTracks().forEach(t => pc.addTrack(t, this._stream));

    // Trickle our ICE candidates to Firebase
    pc.onicecandidate = ({ candidate: c }) => {
      if (c) lRef.child('hc').push({ c: c.candidate, m: c.sdpMid, i: c.sdpMLineIndex });
    };

    // Create and store offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await lRef.child('offer').set({ type: offer.type, sdp: offer.sdp });

    // When listener answers, set remote description
    lRef.child('answer').on('value', snap => {
      const v = snap.val();
      if (v && !pc.currentRemoteDescription)
        pc.setRemoteDescription(new RTCSessionDescription(v)).catch(() => {});
    });

    // Add listener's ICE candidates as they arrive
    lRef.child('lc').on('child_added', snap => {
      const c = snap.val();
      pc.addIceCandidate(new RTCIceCandidate({
        candidate: c.c, sdpMid: c.m, sdpMLineIndex: c.i,
      })).catch(() => {});
    });

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') {
        pc.close();
        this._peers.delete(lid);
        lRef.remove().catch(() => {});
      }
      this._emitCount();
    };
  }

  _emitCount() {
    if (!this.onCount) return;
    const n = [...this._peers.values()].filter(p => p.connectionState === 'connected').length;
    this.onCount(n);
  }

  async stopBroadcast() {
    if (this._roomRef) {
      this._roomRef.off();
      await this._roomRef.remove().catch(() => {});
      this._roomRef = null;
    }
    for (const pc of this._peers.values()) pc.close();
    this._peers.clear();
    this._code   = null;
    this._stream = null;
    if (this.onCount) this.onCount(0);
  }

  get code()         { return this._code; }
  get broadcasting() { return this._code !== null; }

  // ── LISTENER: join/leave ──────────────────────────────

  async joinRoom(code, onStream, onStatus) {
    const upper   = (code || '').trim().toUpperCase();
    const roomRef = _db().ref('rooms/' + upper);

    const snap = await roomRef.child('active').once('value');
    if (!snap.val()) throw new Error('Room not found — check the code and try again.');

    const lid  = _uid();
    const lRef = roomRef.child('listeners/' + lid);
    const pc   = new RTCPeerConnection(_ICE);
    this._peers.set(lid, pc);

    // When the host's audio track arrives, expose the stream
    pc.ontrack = ({ streams, track }) => {
      onStream(streams[0] || new MediaStream([track]));
    };

    // Trickle our ICE candidates to Firebase
    pc.onicecandidate = ({ candidate: c }) => {
      if (c) lRef.child('lc').push({ c: c.candidate, m: c.sdpMid, i: c.sdpMLineIndex });
    };

    pc.onconnectionstatechange = () => {
      onStatus(pc.connectionState);
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState))
        lRef.remove().catch(() => {});
    };

    // Announce presence — this triggers the host to create an offer for us
    await lRef.child('status').set('waiting');

    // When host posts the offer, answer it
    lRef.child('offer').on('value', async snap => {
      const v = snap.val();
      if (!v || pc.currentRemoteDescription) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(v));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await lRef.child('answer').set({ type: answer.type, sdp: answer.sdp });
      } catch {
        onStatus('failed');
      }
    });

    // Add host's ICE candidates as they arrive
    lRef.child('hc').on('child_added', snap => {
      const c = snap.val();
      pc.addIceCandidate(new RTCIceCandidate({
        candidate: c.c, sdpMid: c.m, sdpMLineIndex: c.i,
      })).catch(() => {});
    });

    // Notify if the host ends the broadcast
    roomRef.child('active').on('value', snap => {
      if (!snap.val()) onStatus('ended');
    });

    return { lid, lRef };
  }

  leaveRoom({ lid, lRef }) {
    const pc = this._peers.get(lid);
    if (pc) { pc.close(); this._peers.delete(lid); }
    lRef?.remove().catch(() => {});
  }
}

window.broadcastManager = new BroadcastManager();
