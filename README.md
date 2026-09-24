# ⚡ ANOMALY - Multiplayer Real-Time Treasure Race

ANOMALY is a local-network multiplayer party game where 10–20 players race for treasure. 
- **Laptop / Projector**: Runs the Node.js server and displays the shared big screen (Phaser 3).
- **Phones**: Connect over local Wi-Fi to act as low-latency controllers.

---

## 🚀 Quick Start Guide

### Step 1: Connect to the Same Wi-Fi
Make sure your laptop and all player phones are connected to the **same local Wi-Fi network**.

### Step 2: Start the Game Server
Open your terminal inside this project folder and run:

```bash
npm start
```

Or for development mode with auto-reload:

```bash
npm run dev
```

### Step 3: Open the Host (Big Screen)
On your laptop (or connected projector/TV), open Google Chrome or any modern browser and visit:
👉 **`http://localhost:3000/host`**

You will see the **ANOMALY** lobby screen with a large neon QR code and join URL.

### Step 4: Join on Phones
1. Players open their phone camera and **scan the QR code** on the big screen (or enter `http://<YOUR-IP>:3000/play` in mobile browser).
2. Enter a racer name (up to 12 characters) and tap **ENTER MATCH**.
3. Each player is assigned a unique neon color and their name will appear on the big screen instantly!

### Step 5: Start the Match
Once at least 1 player has joined:
- Click the glowing **START MATCH** button on the host screen, or press **SPACEBAR** on your laptop keyboard.
- Both the host screen and phones will transition into **MATCH RUNNING**.

---

## 🛠️ Project Structure

```
ANOMALY/
├── server/
│   ├── config.js         # Central tunable settings (ports, tick rate, colors)
│   ├── index.js          # Express server, Socket.IO, LAN IP & QR generator
│   └── game/
│       └── gameManager.js# Authoritative state machine & player manager
├── public/
│   ├── host/             # Big screen display (Phaser 3)
│   │   ├── index.html
│   │   └── host.js
│   ├── play/             # Mobile controller (HTML/CSS/JS)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── play.js
│   └── shared/           # Shared client constants & utilities
├── package.json
└── README.md
```

---

## ❓ Troubleshooting

- **Phone cannot load the page?**
  - Verify that your phone is on the **same Wi-Fi** network as your laptop (not on mobile data).
  - Check if Windows Firewall is blocking Node.js incoming connections on port 3000. If prompted by Windows, click **Allow access** on Private networks.
- **Port already in use?**
  - Change the `PORT` number in `server/config.js` (e.g. to `3001` or `8080`).
- **Player disconnected or refreshed?**
  - The phone controller stores the session in `localStorage` and will automatically reconnect with the same racer name and color.
