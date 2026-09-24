// server/index.js - Express and Socket.IO Server entry point
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
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

// Socket.IO with WebSocket first and polling fallback
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static vendor and client directories
app.use('/vendor', express.static(path.join(ROOT_DIR, 'public/vendor')));
app.use('/host', express.static(path.join(ROOT_DIR, 'public/host')));
app.use('/play', express.static(path.join(ROOT_DIR, 'public/play')));
app.use('/shared', express.static(path.join(ROOT_DIR, 'public/shared')));

// Redirect root to /host
app.get('/', (req, res) => {
  res.redirect('/host');
});

// Health check / ping endpoint
app.get('/ping', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ANOMALY // Status</title>
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
      text-align: center;
    }
    h1 { color: #39FF14; font-size: 26px; margin-bottom: 8px; }
    p { color: #8888AA; font-size: 16px; margin-bottom: 20px; }
    a {
      padding: 12px 24px;
      background: #00F0FF;
      color: #050510;
      text-decoration: none;
      font-weight: bold;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <h1>ANOMALY server reachable</h1>
  <p>Online and accepting connections.</p>
  <a href="/play">JOIN GAME</a>
</body>
</html>`);
});

// Dynamic QR Code generation with high camera-scanning contrast
const qrCache = new Map();
app.get('/api/qr.png', async (req, res) => {
  try {
    const rawUrl = req.query.url;
    let targetUrl = rawUrl;

    if (!targetUrl) {
      if (CONFIG.PUBLIC_URL) {
        targetUrl = `${CONFIG.PUBLIC_URL.replace(/\/+$/, '')}/play`;
      } else {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.get('host') || `localhost:${CONFIG.PORT}`;
        targetUrl = `${protocol}://${host}/play`;
      }
    }

    if (qrCache.has(targetUrl)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(qrCache.get(targetUrl));
    }

    // High-contrast QR code for instant camera recognition
    const buf = await QRCode.toBuffer(targetUrl, {
      type: 'png',
      margin: 2,
      width: 360,
      color: {
        dark: '#050515',
        light: '#FFFFFF'
      }
    });

    qrCache.set(targetUrl, buf);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (err) {
    console.error('[Server] QR generation error:', err);
    res.status(500).send('Failed to generate QR');
  }
});

// API route for client configuration
app.get('/api/server-info', (req, res) => {
  res.json({
    publicUrl: CONFIG.PUBLIC_URL,
    port: CONFIG.PORT,
    world: CONFIG.WORLD
  });
});

// Authoritative Game Manager
const gameManager = new GameManager(io);

// Socket.IO event listeners
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

  socket.on('stop_match', () => {
    gameManager.stopMatch();
  });

  socket.on('reset_match', () => {
    gameManager.resetToLobby();
  });

  socket.on('disconnect', () => {
    gameManager.handleDisconnect(socket.id);
  });
});

// Start listening on 0.0.0.0
server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  const localHostUrl = `http://localhost:${CONFIG.PORT}/host`;
  const localPlayUrl = `http://localhost:${CONFIG.PORT}/play`;
  const liveUrl = CONFIG.PUBLIC_URL ? `${CONFIG.PUBLIC_URL.replace(/\/+$/, '')}/play` : localPlayUrl;

  console.log('\n' + '='.repeat(54));
  console.log('  ⚡ ANOMALY SERVER ONLINE ⚡');
  console.log('='.repeat(54));
  console.log(`  🖥️  Host Screen (Big Canvas) : ${localHostUrl}`);
  console.log(`  📱  Player Join URL          : ${liveUrl}`);
  console.log(`  🔌  Health Check / Ping      : http://localhost:${CONFIG.PORT}/ping`);
  console.log(`  ⏱️  Authoritative Tick Rate  : ${CONFIG.TICK_RATE} ticks/sec`);
  console.log('='.repeat(54) + '\n');
});
