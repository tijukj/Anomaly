# ⚡ ANOMALY - Multiplayer Real-Time Treasure Race

ANOMALY is a local-network multiplayer party game where 10–20 players race for treasure. 
- **Laptop / Projector**: Runs the authoritative Node.js game server and displays the shared arena (Phaser 3).
- **Phones**: Connect over local Wi-Fi to act as low-latency analog touch controllers.

---

## 🚀 Quick Start Guide

### Step 1: Connect to the Same Wi-Fi
Make sure your laptop and player phones are connected to the **same local Wi-Fi network**.

### Step 2: Start the Game Server
Open your terminal inside this project folder and run:

```bash
npm start
```

### Step 3: Open the Host (Big Screen)
On your laptop (or connected projector/TV), open Google Chrome and visit:
👉 **`http://localhost:3000/host`**

You will see the **ANOMALY** lobby screen with the glowing QR code and join URL.

### Step 4: Join on Phones (or Spawn Bots!)

#### Option A: Join with Phones
1. Players open their phone camera and **scan the QR code** on the big screen (or visit `http://<YOUR-IP>:3000/play`).
2. Enter a racer handle (up to 12 characters) and tap **ENTER MATCH**.
3. Once the match starts, use the **floating thumb joystick** on the left to steer and the **ACTION button** on the right.

#### Option B: Spawn Test Bots
To instantly test full 15-player multiplayer movement without needing 15 physical phones:
Open a second terminal window and run:

```bash
npm run bots -- 15
```

### Step 5: Start the Match
- Click **START MATCH** on the host screen or press the **SPACEBAR** on your laptop.
- The screen will transition to the $1600 \times 1000$ neon arena where all racers glide in real-time.

---

## ⌨️ Host Shortcuts & Controls

- **`SPACEBAR`**: Start Match from the Lobby.
- **`D`**: Toggle the **Host Debug Overlay** (shows live FPS, active players, server tick calculation time, and network snapshot size).

---

## 🛠️ Project Structure

```
ANOMALY/
├── server/
│   ├── config.js         # Central tunable physics (speed, friction, world size)
│   ├── index.js          # Express server, Socket.IO & /api/qr.png stream
│   └── game/
│       ├── gameManager.js# Authoritative 20Hz physics & state loop
│       └── bots.js       # Test bot simulator (npm run bots -- N)
├── public/
│   ├── host/             # Big screen arena & lobby (Phaser 3)
│   │   ├── index.html
│   │   └── host.js
│   ├── play/             # Mobile touch controller (Floating Joystick + Action)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── play.js
│   └── shared/           # Shared client constants
├── package.json
└── README.md
```

---

## ❓ Troubleshooting

- **Phone cannot connect to `http://172.16.x.x:3000`?**
  1. Windows Defender Firewall may block incoming connections to Node.js on port 3000. When prompted by Windows, click **Allow Access on Private Networks**.
  2. If your Wi-Fi router isolates connected devices (AP Isolation), enable your phone's personal hotspot and connect your laptop to it.
- **QR Code is sharp & clear:**
  - The QR code is dynamically rendered from the server endpoint `/api/qr.png`.
