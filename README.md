# iSpeaker

**Real-time Bluetooth audio router — use any Bluetooth mic as input and any Bluetooth speaker as output, live.**

🔗 **[Try it → sewakcctv.github.io/ispeaker](https://sewakcctv.github.io/ispeaker/)**

---

## What it does

iSpeaker connects two Bluetooth devices and routes audio between them in real-time:

```
Bluetooth Microphone  ──►  iSpeaker  ──►  Bluetooth Speaker
```

You can also broadcast that live audio to remote listeners anywhere in the world:

```
Bluetooth Microphone  ──►  iSpeaker  ──►  Bluetooth Speaker
                                  └──►  Remote Listener 1
                                  └──►  Remote Listener 2
```

Use cases:
- PA / public address: speak into a BT mic, hear it on a BT speaker
- Live broadcast: share audio with remote listeners via a room code
- Audio monitoring: route any BT mic source to a BT speaker
- Karaoke / practice: route your voice to a speaker wirelessly

---

## Features

- **Live audio routing** — real-time passthrough with minimal software latency
- **Live broadcast** — share a room code or link; listeners join from any browser worldwide, audio streams peer-to-peer (no server in the middle)
- **Device picker** — lists only connected Bluetooth (and wired) audio devices; virtual/duplicate OS entries are filtered out automatically
- **Speaker Volume & Mic Boost** — independent controls up to 4× each
- **Live level meters** — visual IN/OUT meters with dB readout
- **Audio enhancement** (Advanced Settings) — High-pass filter, dynamics compressor, and noise gate with adjustable threshold
- **Background audio** — routing continues even when the screen is locked or you switch apps (Android & desktop)
- **Screen Wake Lock** — keeps the display on while routing so the session isn't interrupted
- **Installable PWA** — works offline, add to home screen on Android and iOS
- **No app install, no account** — runs entirely in your browser

---

## How to use

### Local routing (mic → speaker)

1. **Pair your devices** — connect your Bluetooth mic and speaker through OS Bluetooth settings
2. **Open the app** in Chrome or Edge
3. **Grant microphone permission** when prompted
4. **Select MIC IN and SPK OUT** from the dropdowns
5. **Hit Start Routing** — audio flows live. Adjust volume as needed

### Live broadcast (share with remote listeners)

1. Start routing as above
2. Tap **Start** in the **Live Broadcast** panel that appears
3. A 6-character room code is generated — tap **Copy Link** and share it
4. Listeners open the link on any phone or browser, tap **Join & Listen**
5. Audio streams directly peer-to-peer — no server carries the audio
6. Stopping routing automatically ends the broadcast for all listeners

---

## Browser support

| Browser | Routing | Broadcast host | Broadcast listener |
|---|---|---|---|
| Chrome 110+ | ✅ | ✅ | ✅ |
| Edge 110+ | ✅ | ✅ | ✅ |
| Chrome for Android | ✅ | ✅ | ✅ |
| Firefox | ⚠️ Default output only | ✅ | ✅ |
| Safari / iOS | ⚠️ Limited | ✅ | ✅ |

**Chrome or Edge is strongly recommended** for full device selection on the host side. Listeners can join from any modern browser including Safari.

---

## A note on latency

Bluetooth audio has inherent latency — this is a hardware/codec limitation, not something any app can remove:

| Codec | Typical latency |
|---|---|
| SBC (most common) | 150 – 300 ms |
| AAC | 100 – 200 ms |
| aptX | 70 – 150 ms |
| aptX Low Latency | ~40 ms |
| LC3 / LE Audio | ~30 – 50 ms |

For broadcast mode, add ~50–150 ms of internet latency on top of Bluetooth. Total is usually 200–500 ms — fine for monitoring and listening, not for tight real-time performance.

---

## Self-hosting / development

No build step required. It's plain HTML, CSS, and JavaScript.

```bash
git clone https://github.com/sewakcctv/ispeaker.git
cd ispeaker

# Serve locally (any static file server works)
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080` in Chrome. HTTPS is required for mic access on public URLs (GitHub Pages handles this automatically).

The broadcast feature uses Firebase Realtime Database for WebRTC signalling (the SDP/ICE handshake only — audio never touches the server). The Firebase project config is in `js/broadcast.js`. For your own deployment, create a free Firebase project and replace the config.

### File structure

```
ispeaker/
├── index.html           # App shell and UI
├── css/style.css        # Styles (dark theme)
├── js/app.js            # Audio routing logic (Web Audio API)
├── js/broadcast.js      # WebRTC + Firebase signalling for live broadcast
├── manifest.json        # PWA manifest
├── sw.js                # Service worker (offline support)
├── icon.svg             # Source icon (vector)
├── icon-192.png         # Android launcher icon
├── icon-512.png         # Android splash / high-res icon
└── apple-touch-icon.png # iOS home screen icon
```

---

## Contributing

Issues and pull requests are welcome. Keep it simple — this is intentionally a no-framework, no-dependency project.

---

## License

MIT — free to use, modify, and distribute.
