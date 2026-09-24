# ⚡ ANOMALY - Multiplayer Real-Time Treasure Race

ANOMALY is a real-time multiplayer party game for 10–20 players. 
- **Big Screen (TV / Laptop / Projector)**: Displays the shared arena (`/host`) using Phaser 3.
- **Phones**: Connect from anywhere over Wi-Fi or Mobile Data (4G/5G) to act as low-latency analog touch controllers (`/play`).

---

## 🚀 Quick Start (Local Play)

### 1. Start the Server
```bash
npm start
```

### 2. Open the Big Screen (Host)
Open your browser to:
👉 **`http://localhost:3000/host`**

### 3. Join with Phones (or Spawn Test Bots)
- **Phones**: Scan the QR code or visit `http://<YOUR-IP>:3000/play`.
- **Test Bots**: Open a second terminal window and run `npm run bots -- 15`.

### 4. Start the Match
Click **START MATCH** on the host screen or press **SPACEBAR** on your keyboard!

---

## 🌐 Deploy Online to Play with Anyone (Free)

Want to play over the internet with friends on mobile data or Wi-Fi from anywhere?
Read the beginner-friendly guide:
👉 **[DEPLOY.md](file:///e:/Projects/Anomaly/DEPLOY.md)**

---

## ⌨️ Host Shortcuts

- **`SPACEBAR`**: Start match from lobby.
- **`D`**: Toggle host debug overlay (FPS, tick compute time, packet size).
- **`F11`**: Fullscreen mode in browser.

---

## 🛠️ Project Structure

```
ANOMALY/
├── server/
│   ├── config.js         # Central tunable settings & PUBLIC_URL
│   ├── index.js          # Express & Socket.IO server + /ping + /api/qr.png
│   └── game/
│       ├── gameManager.js# Authoritative 20Hz physics & state loop
│       └── bots.js       # Test bot simulator (npm run bots -- N)
├── public/
│   ├── host/             # Big screen arena & lobby (Phaser 3)
│   │   ├── index.html
│   │   └── host.js
│   ├── play/             # Mobile touch controller
│   │   ├── index.html
│   │   ├── style.css
│   │   └── play.js
│   └── shared/
├── render.yaml           # One-click Render cloud deployment blueprint
├── DEPLOY.md             # Beginner deployment instructions
├── package.json
└── README.md
```
