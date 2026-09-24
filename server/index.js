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

// Helper to determine the best local LAN IPv4 address
function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 and non-internal only
      if (net.family === 'IPv4' && !net.internal) {
        // Prioritize Wi-Fi or Ethernet
        const isWifi = /wi-?fi|wlan|wireless/i.test(name);
        const isEthernet = /eth|ethernet|en[0-9]/i.test(name);
        candidates.push({ address: net.address, name, priority: isWifi ? 1 : isEthernet ? 2 : 3 });
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.length > 0 ? candidates[0].address : 'localhost';
}

const LAN_IP = getLanIp();
const PLAY_URL = `http://${LAN_IP}:${CONFIG.PORT}/play`;
const HOST_URL = `http://${LAN_IP}:${CONFIG.PORT}/host`;

// Pre-generate QR Code Data URL for host screen
let qrCodeDataUrl = '';
try {
  qrCodeDataUrl = await QRCode.toDataURL(PLAY_URL, {
    margin: 1,
    width: 320,
    color: {
      dark: '#00F0FF',
      light: '#0A0A14'
    }
  });
} catch (err) {
  console.error('[Server] Failed to generate QR Code:', err);
}

// Serve Phaser library directly from node_modules
app.use('/vendor/phaser', express.static(path.join(ROOT_DIR, 'node_modules/phaser/dist')));

// Serve Static directories
app.use('/host', express.static(path.join(ROOT_DIR, 'public/host')));
app.use('/play', express.static(path.join(ROOT_DIR, 'public/play')));
app.use('/shared', express.static(path.join(ROOT_DIR, 'public/shared')));

// Redirect root to /host
app.get('/', (req, res) => {
  res.redirect('/host');
});

// API route for host to fetch server LAN info and QR code
app.get('/api/server-info', (req, res) => {
  res.json({
    lanIp: LAN_IP,
    port: CONFIG.PORT,
    playUrl: PLAY_URL,
    hostUrl: HOST_URL,
    qrCodeDataUrl
  });
});

// Initialize Authoritative Game Manager
const gameManager = new GameManager(io);

// Socket.IO event handling
io.on('connection', (socket) => {
  console.log(`[Socket] New connection: ${socket.id}`);

  // Send initial state immediately
  socket.emit('game_state_update', gameManager.getPublicState());

  // Phone player joining or reconnecting
  socket.on('join_game', (payload) => {
    gameManager.registerOrReconnectPlayer(socket, payload || {});
  });

  // Host requesting to start match
  socket.on('start_match', () => {
    gameManager.startMatch();
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    gameManager.handleDisconnect(socket.id);
  });
});

// Start Server listening on 0.0.0.0
server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log('\n' + '='.repeat(54));
  console.log('  ⚡ ANOMALY SERVER RUNNING ⚡');
  console.log('='.repeat(54));
  console.log(`  🖥️  Host Screen (Big Canvas) : http://localhost:${CONFIG.PORT}/host`);
  console.log(`  📱  Player Controller URL    : ${PLAY_URL}`);
  console.log(`  🌐  Network Interface        : ${LAN_IP}`);
  console.log(`  ⏱️  Authoritative Tick Rate  : ${CONFIG.TICK_RATE} ticks/sec`);
  console.log('='.repeat(54) + '\n');
});
