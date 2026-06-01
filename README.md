# iSpeaker

**Real-time Bluetooth audio router — use any Bluetooth mic as input and any Bluetooth speaker as output, live.**

🔗 **[Try it → sewakcctv.github.io/ispeaker](https://sewakcctv.github.io/ispeaker/)**

---

## What it does

iSpeaker connects two Bluetooth devices and routes audio between them in real-time:

```
Bluetooth Microphone  ──►  iSpeaker  ──►  Bluetooth Speaker
```

Use cases:
- PA / public address: speak into a BT mic, hear it on a BT speaker in another room
- Audio monitoring: route any BT mic source to a BT speaker
- Wireless intercom: use two phones with BT devices on each end
- Karaoke / practice: route your voice to a speaker wirelessly

---

## Features

- **Live audio routing** — real-time passthrough with minimal software latency
- **Device picker** — lists only connected Bluetooth (and wired) audio devices; virtual/duplicate OS entries are filtered out automatically
- **Speaker Volume & Mic Boost** — independent controls up to 4× each
- **Live level meters** — visual IN/OUT meters with dB readout
- **Audio enhancement** (Advanced Settings) — High-pass filter, dynamics compressor, and noise gate with adjustable threshold
- **Background audio** — routing continues even when the screen is locked or you switch apps (Android & desktop)
- **Screen Wake Lock** — keeps the display on while routing so the session isn't interrupted
- **Installable PWA** — works offline, add to home screen on Android and iOS
- **No app install, no account, no backend** — runs entirely in your browser

---

## How to use

### Step 1 — Pair your devices
Pair your Bluetooth microphone and Bluetooth speaker to your phone or computer through the **OS Bluetooth settings** (not in the app). The app works with any devices your OS already recognizes.

### Step 2 — Open the app
Open **[sewakcctv.github.io/ispeaker](https://sewakcctv.github.io/ispeaker/)** in Chrome or Edge.

### Step 3 — Grant microphone permission
The browser will ask for microphone access — tap **Allow**. This is required to see and select audio devices.

### Step 4 — Select your devices
- **MIC IN** — choose your Bluetooth microphone
- **SPK OUT** — choose your Bluetooth speaker

### Step 5 — Start routing
Hit **Start Routing**. Audio flows live from mic to speaker. Adjust gain and volume as needed.

---

## Browser support

| Browser | Mic input | Output routing |
|---|---|---|
| Chrome 110+ | ✅ | ✅ |
| Edge 110+ | ✅ | ✅ |
| Chrome for Android | ✅ | ✅ |
| Firefox | ✅ | ⚠️ Default output only |
| Safari / iOS | ⚠️ Limited | ❌ |

**Chrome or Edge is strongly recommended** for full input + output device selection.

---

## A note on Bluetooth latency

Bluetooth audio has inherent latency built into the protocol — this is a hardware/codec limitation, not something any app can remove:

| Codec | Typical latency |
|---|---|
| SBC (most common) | 150 – 300 ms |
| AAC | 100 – 200 ms |
| aptX | 70 – 150 ms |
| aptX Low Latency | ~40 ms |
| LC3 / LE Audio | ~30 – 50 ms |

For a PA system where the speaker is in the same room as the mic, you will hear yourself with a delay. This is normal. For best results:
- Use devices that support **aptX Low Latency** or **LE Audio**
- Place the speaker in a separate area from the microphone
- Keep output volume low if both devices are in the same room to avoid feedback

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

### File structure

```
ispeaker/
├── index.html           # App shell and UI
├── css/style.css        # Styles (dark theme)
├── js/app.js            # Audio routing logic (Web Audio API)
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
