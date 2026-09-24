# ⚡ ANOMALY - Multiplayer Real-Time Treasure Race

ANOMALY is a local-network multiplayer party game for 10–20 players. 
- **Laptop / Projector**: Runs the authoritative Node.js game server and displays the shared arena (Phaser 3).
- **Phones**: Connect over local Wi-Fi to act as low-latency analog touch controllers.

---

## 🚀 Quick Start Guide

### Step 1: Start the Game Server
In your terminal, run:

```bash
npm start
```

### Step 2: Open the Host (Big Screen)
On your laptop (or connected projector/TV), open Google Chrome to:
👉 **`http://localhost:3000/host`**

You will see the **ANOMALY** lobby screen with the glowing QR code and join URL.

### Step 3: Join on Phones (or Spawn Bots!)

#### Option A: Join with Phones
1. Connect your phone to the **same Wi-Fi** as your laptop.
2. Scan the QR code on the big screen (or visit `http://<YOUR-IP>:3000/play`).
3. Enter a racer handle and tap **ENTER MATCH**.
4. Use the **floating thumb joystick** on the left to steer and the **ACTION button** on the right.

#### Option B: Spawn Test Bots
Open a second terminal window and run:

```bash
npm run bots -- 15
```

### Step 4: Start the Match
- Click **START MATCH** on the host screen or press **SPACEBAR** on your laptop.

---

## 📱 Phone Won't Connect? (Troubleshooting Steps)

Follow these steps in order to resolve any phone connection issues:

### 1. Run the Network Doctor
In your project terminal, run:
```bash
npm run doctor
```
This inspects your network adapters, verifies port 3000, checks Windows Firewall, and identifies your Wi-Fi IP address.

### 2. Configure Windows Defender Firewall
Windows Defender blocks incoming phone traffic on Public and Private Wi-Fi profiles by default.
1. Press the **Windows Key**, type `PowerShell`, right-click **Windows PowerShell**, and select **Run as administrator**.
2. Navigate to this project folder:
   ```powershell
   cd e:\Projects\Anomaly
   ```
3. Run the automated firewall setup script:
   ```powershell
   npm run firewall
   ```
*(To remove the rule later if ever needed, run `npm run unfirewall`).*

### 3. Turn OFF Mobile / Cellular Data on Your Phone
Ensure your phone is using Wi-Fi only (some smartphones silently route local LAN IP requests over 4G/5G mobile data if they think the Wi-Fi has no direct internet).

### 4. Turn OFF VPNs
Disable VPNs on both the laptop and phone (VPNs route traffic into virtual tunnels).

### 5. Test the Ping URL on Your Phone Browser
Open Safari or Chrome on your phone and go directly to:
👉 **`http://<YOUR-LAPTOP-IP>:3000/ping`**

If working, it will say **"⚡ ANOMALY server reachable"** with a direct button to join.

### 6. Press `L` on Host Screen to Cycle IP Addresses
If your laptop has multiple network adapters (e.g. Ethernet + Wi-Fi), press the **`L`** key on your laptop while on the host lobby screen to cycle through all detected IP addresses. The QR code and URL text will update automatically.

### 7. Campus / Office / Hotel Wi-Fi (AP Isolation)
Some college, hotel, or corporate Wi-Fi networks block devices on the same Wi-Fi from talking to each other (Client / AP Isolation).
👉 **Instant Fix**: Enable **Personal Hotspot** on your phone, connect your laptop to your phone's hotspot, and rerun `npm start`.

---

## ⌨️ Host Shortcuts

- **`SPACEBAR`**: Start match from lobby.
- **`L`**: Cycle through detected LAN IP addresses and regenerate QR code.
- **`D`**: Toggle host debug overlay (FPS, tick compute time, packet size).

---

## 🛠️ Project Structure

```
ANOMALY/
├── scripts/
│   ├── doctor.js         # npm run doctor (Network & firewall diagnostic)
│   ├── firewall-setup.ps1# npm run firewall (Adds Windows Defender rule)
│   └── firewall-remove.ps1# npm run unfirewall (Removes firewall rule)
├── server/
│   ├── config.js         # Central tunable settings
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
├── package.json
└── README.md
```
