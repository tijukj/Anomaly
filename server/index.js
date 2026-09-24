// server/index.js - Express and Socket.IO Server entry point
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { CONFIG } from './config.js';
import { GameManager } from './game/gameManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Helper to detect all available LAN IPv4 addresses
export function getAllLanIps() {
  const interfaces = os.networkInterfaces();
  const list = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const isVirtual = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Tailscale|ZeroTier|TAP|VPN|Loopback/i.test(name);
        const isWifi = /wi-?fi|wlan|wireless/i.test(name);
        const isEthernet = /eth|ethernet|en[0-9]/i.test(name);
        const priority = isWifi ? 1 : (isEthernet ? 2 : (isVirtual ? 4 : 3));

        list.push({
          address: net.address,
          name: name,
          isVirtual,
          isWifi,
          isEthernet,
          priority
        });
      }
    }
  }

  list.sort((a, b) => a.priority - b.priority);
  return list.length > 0 ? list : [{ address: '127.0.0.1', name: 'localhost', priority: 9 }];
}

const ALL_LAN_IPS = getAllLanIps();
const PRIMARY_IP = ALL_LAN_IPS[0].address;

// In-memory cache of generated QR code PNG buffers by IP
const qrCache = new Map();

async function getOrCreateQrBuffer(ip) {
  const targetIp = ip || PRIMARY_IP;
  if (qrCache.has(targetIp)) {
    return qrCache.get(targetIp);
  }
  const playUrl = `http://${targetIp}:${CONFIG.PORT}/play`;
  const buf = await QRCode.toBuffer(playUrl, {
    type: 'png',
    margin: 1,
    width: 320,
    color: {
      dark: '#00F0FF',
      light: '#080816'
    }
  });
  qrCache.set(targetIp, buf);
  return buf;
}

// Pre-cache primary IP
await getOrCreateQrBuffer(PRIMARY_IP);

// Serve Phaser library from node_modules
app.use('/vendor/phaser', express.static(path.join(ROOT_DIR, 'node_modules/phaser/dist')));

// Serve Static client directories
app.use('/host', express.static(path.join(ROOT_DIR, 'public/host')));
app.use('/play', express.static(path.join(ROOT_DIR, 'public/play')));
app.use('/shared', express.static(path.join(ROOT_DIR, 'public/shared')));

// Redirect root to /host
app.get('/', (req, res) => {
  res.redirect('/host');
});

// Diagnostic /ping page to test phone connectivity from a mobile browser
app.get('/ping', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ANOMALY // Server Reachable</title>
  <style>
    body {
      background-color: #070714;
      color: #00F0FF;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      text-align: center;
      box-sizing: border-box;
    }
    .badge { font-size: 50px; margin-bottom: 12px; }
    h1 { color: #39FF14; font-size: 26px; margin: 0 0 12px 0; letter-spacing: 1px; }
    p { color: #9999BB; font-size: 16px; max-width: 340px; line-height: 1.5; margin: 0 0 24px 0; }
    .join-btn {
      display: inline-block;
      padding: 16px 36px;
      background: #00F0FF;
      color: #050510;
      text-decoration: none;
      font-weight: 800;
      font-size: 18px;
      letter-spacing: 2px;
      border-radius: 12px;
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.5);
    }
  </style>
</head>
<body>
  <div class="badge">⚡</div>
  <h1>ANOMALY server reachable</h1>
  <p>Your phone is successfully connected to the laptop game server over Wi-Fi!</p>
  <a href="/play" class="join-btn">JOIN GAME</a>
</body>
</html>`);
});

// Dynamic QR Code PNG endpoint with optional ?ip= query
app.get('/api/qr.png', async (req, res) => {
  try {
    const requestedIp = (req.query.ip || PRIMARY_IP).toString();
    const buf = await getOrCreateQrBuffer(requestedIp);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Failed to generate QR');
  }
});

// API route for host info
app.get('/api/server-info', (req, res) => {
  res.json({
    addresses: getAllLanIps(),
    primaryIp: PRIMARY_IP,
    port: CONFIG.PORT,
    playUrl: `http://${PRIMARY_IP}:${CONFIG.PORT}/play`,
    world: CONFIG.WORLD
  });
});

// Initialize Authoritative Game Manager
const gameManager = new GameManager(io);

// Socket.IO event handling
io.on('connection', (socket) => {
  socket.emit('game_state_update', gameManager.getPublicState());

  socket.on('join_game', (payload) => {
    gameManager.registerOrReconnectPlayer(socket, payload || {});
  });

  socket.on('player_input', (inputData) => {
    gameManager.handlePlayerInput(socket.id, inputData || {});
  });

  socket.on('start_match', () => {
    gameManager.startMatch();
  });

  socket.on('disconnect', () => {
    gameManager.handleDisconnect(socket.id);
  });
});

// Start Server listening on 0.0.0.0
server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log('\n' + '='.repeat(62));
  console.log('  ⚡ ANOMALY SERVER RUNNING ⚡');
  console.log('='.repeat(62));
  console.log(`  🖥️  Host Screen (Big Canvas) : http://localhost:${CONFIG.PORT}/host`);
  console.log(`  📱  Primary Player Join URL  : http://${PRIMARY_IP}:${CONFIG.PORT}/play`);
  console.log(`  🔌  Diagnostic Ping Test     : http://${PRIMARY_IP}:${CONFIG.PORT}/ping`);
  console.log('-'.repeat(62));
  console.log('  🌐 ALL DETECTED LOCAL NETWORK ADDRESSES:');
  ALL_LAN_IPS.forEach((iface, idx) => {
    const tag = iface.isWifi ? '(Wi-Fi ⭐)' : (iface.isEthernet ? '(Ethernet)' : '(Virtual/VPN)');
    console.log(`    [${idx + 1}] http://${iface.address}:${CONFIG.PORT}/play  ${tag}`);
  });
  console.log('-'.repeat(62));
  console.log(`  ⏱️  Authoritative Tick Rate  : ${CONFIG.TICK_RATE} ticks/sec`);
  console.log('='.repeat(62) + '\n');
});
