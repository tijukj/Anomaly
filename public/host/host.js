// public/host/host.js - Big Screen Phaser 3 Host Arena & Lobby
const socket = io();

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1000;

let serverInfo = {
  addresses: [{ address: '127.0.0.1', name: 'localhost' }],
  primaryIp: '127.0.0.1',
  port: 3000
};

let currentAddressIndex = 0;

let currentGameState = {
  state: 'LOBBY',
  players: [],
  playerCount: 0,
  canStart: false
};

// Snapshot interpolation state
let latestSnapshot = null;
let lastSnapshotTime = 0;
let snapshotBytes = 0;
let serverTickTimeMs = 0;
let showDebugOverlay = false;

// Fetch server info
async function fetchServerInfo() {
  try {
    const res = await fetch('/api/server-info');
    serverInfo = await res.json();
  } catch (err) {
    console.error('Failed to fetch server info:', err);
  }
}

class HostScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HostScene' });
    this.playerMap = new Map();
    this.debugContainer = null;
  }

  preload() {
    // Initial QR code load
    this.load.image('qrcode', '/api/qr.png');
  }

  async create() {
    await fetchServerInfo();

    this.cameras.main.setBackgroundColor('#070714');
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.bgGraphics = this.add.graphics();
    this.lobbyContainer = this.add.container(0, 0);
    this.arenaContainer = this.add.container(0, 0);
    this.debugContainer = this.add.container(20, 20);

    // Keyboard controls
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.spaceKey.on('down', () => this.triggerStartMatch());

    this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.dKey.on('down', () => {
      showDebugOverlay = !showDebugOverlay;
      this.debugContainer.setVisible(showDebugOverlay);
    });

    // Press 'L' to cycle through detected network IP addresses
    this.lKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L);
    this.lKey.on('down', () => this.cycleNetworkAddress());

    // Socket Event: Full state update
    socket.on('game_state_update', (state) => {
      const prevState = currentGameState.state;
      currentGameState = state;
      if (prevState !== state.state) {
        this.onStateChanged(state.state);
      }
      this.renderLobbyUI();
      this.updatePlayerRoster(state.players);
    });

    // Socket Event: 20Hz compact tick snapshot
    socket.on('tick_snapshot', (snapshot) => {
      latestSnapshot = snapshot;
      lastSnapshotTime = performance.now();
      serverTickTimeMs = snapshot.tickTime || 0;
      snapshotBytes = new Blob([JSON.stringify(snapshot)]).size;

      if (currentGameState.state === 'RUNNING') {
        this.applySnapshot(snapshot);
      }
    });

    this.drawBackground();
    this.renderLobbyUI();
    this.setupDebugOverlay();
    this.debugContainer.setVisible(showDebugOverlay);
  }

  getCurrentPlayUrl() {
    const list = serverInfo.addresses || [];
    const iface = list[currentAddressIndex] || { address: serverInfo.primaryIp || '127.0.0.1' };
    return `http://${iface.address}:${serverInfo.port || 3000}/play`;
  }

  cycleNetworkAddress() {
    if (currentGameState.state !== 'LOBBY') return;
    const list = serverInfo.addresses || [];
    if (list.length <= 1) return;

    currentAddressIndex = (currentAddressIndex + 1) % list.length;
    const currentIface = list[currentAddressIndex];

    console.log(`[Host] Cycled to IP: ${currentIface.address} (${currentIface.name})`);

    // Reload QR code texture dynamically
    if (this.textures.exists('qrcode')) {
      this.textures.remove('qrcode');
    }

    const qrUrl = `/api/qr.png?ip=${encodeURIComponent(currentIface.address)}&t=${Date.now()}`;
    this.load.image('qrcode', qrUrl);
    this.load.once('complete', () => {
      this.renderLobbyUI();
    });
    this.load.start();
  }

  triggerStartMatch() {
    if (currentGameState.state === 'LOBBY' && currentGameState.canStart) {
      socket.emit('start_match');
    }
  }

  onStateChanged(newState) {
    if (newState === 'RUNNING') {
      this.lobbyContainer.setVisible(false);
      this.arenaContainer.setVisible(true);
      this.drawArenaBoundary();
    } else {
      this.lobbyContainer.setVisible(true);
      this.arenaContainer.setVisible(false);
      this.clearAllPlayerEntities();
      this.renderLobbyUI();
    }
  }

  drawBackground() {
    this.bgGraphics.clear();
    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;

    this.bgGraphics.lineStyle(1, 0x14142b, 0.5);
    const gridSize = 50;
    for (let x = 0; x <= w; x += gridSize) {
      this.bgGraphics.lineBetween(x, 0, x, h);
    }
    for (let y = 0; y <= h; y += gridSize) {
      this.bgGraphics.lineBetween(0, y, w, y);
    }
  }

  drawArenaBoundary() {
    this.arenaContainer.removeAll(true);
    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;
    const pad = 24;

    const bounds = this.add.graphics();
    bounds.lineStyle(4, 0x00F0FF, 0.9);
    bounds.strokeRoundedRect(pad, pad, w - pad * 2, h - pad * 2, 16);

    bounds.lineStyle(2, 0xFF0055, 0.8);
    const cornerSize = 40;
    bounds.lineBetween(pad, pad + cornerSize, pad, pad);
    bounds.lineBetween(pad, pad, pad + cornerSize, pad);

    bounds.lineBetween(w - pad, pad + cornerSize, w - pad, pad);
    bounds.lineBetween(w - pad, pad, w - pad - cornerSize, pad);

    bounds.lineBetween(pad, h - pad - cornerSize, pad, h - pad);
    bounds.lineBetween(pad, h - pad, pad + cornerSize, h - pad);

    bounds.lineBetween(w - pad, h - pad - cornerSize, w - pad, h - pad);
    bounds.lineBetween(w - pad, h - pad, w - pad - cornerSize, h - pad);

    bounds.lineStyle(2, 0x202048, 0.6);
    bounds.strokeCircle(w / 2, h / 2, 180);
    bounds.strokeCircle(w / 2, h / 2, 40);

    this.arenaContainer.add(bounds);
  }

  renderLobbyUI() {
    if (currentGameState.state !== 'LOBBY') return;
    this.lobbyContainer.removeAll(true);

    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;

    // 1. Header Title
    const title = this.add.text(w / 2, 65, 'A N O M A L Y', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '64px',
      color: '#00F0FF',
      letterSpacing: 12
    }).setOrigin(0.5);

    const subtitle = this.add.text(w / 2, 120, 'REAL-TIME MULTIPLAYER TREASURE RACE', {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      color: '#8888AA',
      letterSpacing: 6
    }).setOrigin(0.5);

    this.lobbyContainer.add([title, subtitle]);

    // 2. Left Panel: QR Code & Join Info Box
    const leftX = w * 0.28;
    const leftY = 515;
    const boxW = 460;
    const boxH = 510;

    const qrBox = this.add.graphics();
    qrBox.fillStyle(0x0c0c20, 0.85);
    qrBox.fillRoundedRect(leftX - boxW / 2, leftY - boxH / 2, boxW, boxH, 20);
    qrBox.lineStyle(2, 0x00F0FF, 0.6);
    qrBox.strokeRoundedRect(leftX - boxW / 2, leftY - boxH / 2, boxW, boxH, 20);
    this.lobbyContainer.add(qrBox);

    const scanHeader = this.add.text(leftX, leftY - 200, 'SCAN WITH PHONE CAMERA', {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.lobbyContainer.add(scanHeader);

    // QR Image sprite
    if (this.textures.exists('qrcode')) {
      const qrSprite = this.add.image(leftX, leftY - 45, 'qrcode');
      qrSprite.setDisplaySize(230, 230);
      this.lobbyContainer.add(qrSprite);
    }

    const orLabel = this.add.text(leftX, leftY + 105, 'OR BROWSER ADDRESS:', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#777799',
      letterSpacing: 1
    }).setOrigin(0.5);

    const currentUrl = this.getCurrentPlayUrl();
    const urlDisplay = this.add.text(leftX, leftY + 135, currentUrl, {
      fontFamily: 'monospace',
      fontSize: '19px',
      fontStyle: 'bold',
      color: '#FFE600'
    }).setOrigin(0.5);

    const list = serverInfo.addresses || [];
    const ifaceName = list[currentAddressIndex] ? list[currentAddressIndex].name : 'Wi-Fi';
    const cycleHint = this.add.text(leftX, leftY + 175, `[ Adapter: ${ifaceName} | Press L to Switch IP (${currentAddressIndex + 1}/${list.length}) ]`, {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      color: '#00F0FF'
    }).setOrigin(0.5);

    this.lobbyContainer.add([orLabel, urlDisplay, cycleHint]);

    // 3. Right Panel: Player Roster & Live Counter
    const rightX = w * 0.72;
    const rightY = 270;
    const rightW = 560;

    const rosterHeader = this.add.text(rightX, rightY, `RACERS CONNECTED: ${currentGameState.playerCount}/20`, {
      fontFamily: 'sans-serif',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 3
    }).setOrigin(0.5, 0);

    const phoneCountSub = this.add.text(rightX, rightY + 32, `Phones Connected: ${currentGameState.playerCount}`, {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#39FF14',
      letterSpacing: 1
    }).setOrigin(0.5, 0);

    this.lobbyContainer.add([rosterHeader, phoneCountSub]);

    if (currentGameState.players.length === 0) {
      const emptyMsg = this.add.text(rightX, rightY + 100, 'Waiting for racers to connect...\nScan the QR code on your phone to enter.', {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        color: '#555577',
        align: 'center',
        lineSpacing: 10
      }).setOrigin(0.5, 0);
      this.lobbyContainer.add(emptyMsg);
    } else {
      const cols = 2;
      const colW = rightW / cols;
      const itemH = 54;
      const startListY = rightY + 70;

      currentGameState.players.forEach((p, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cardX = rightX - rightW / 2 + col * colW + 10;
        const cardY = startListY + row * itemH;

        const card = this.add.graphics();
        card.fillStyle(0x111128, 0.85);
        card.fillRoundedRect(cardX, cardY, colW - 20, 44, 10);
        card.lineStyle(1.5, p.color.num, 0.7);
        card.strokeRoundedRect(cardX, cardY, colW - 20, 44, 10);
        this.lobbyContainer.add(card);

        const circle = this.add.graphics();
        circle.fillStyle(p.color.num, 1);
        circle.fillCircle(cardX + 24, cardY + 22, 11);
        this.lobbyContainer.add(circle);

        const name = this.add.text(cardX + 46, cardY + 22, p.name, {
          fontFamily: 'sans-serif',
          fontSize: '16px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        }).setOrigin(0, 0.5);
        this.lobbyContainer.add(name);
      });
    }

    // 4. Bottom Start Button
    const btnY = h - 90;
    const btnW = 340;
    const btnH = 64;
    const canStart = currentGameState.canStart;

    const btn = this.add.graphics();
    btn.fillStyle(canStart ? 0x00F0FF : 0x222238, 1);
    btn.fillRoundedRect(w / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 14);
    if (canStart) {
      btn.lineStyle(3, 0xFFFFFF, 0.9);
      btn.strokeRoundedRect(w / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 14);
    }
    this.lobbyContainer.add(btn);

    const btnText = this.add.text(w / 2, btnY, canStart ? 'START MATCH' : 'WAITING FOR PLAYERS', {
      fontFamily: 'sans-serif',
      fontSize: '22px',
      fontStyle: 'bold',
      color: canStart ? '#050510' : '#666688',
      letterSpacing: 3
    }).setOrigin(0.5);
    this.lobbyContainer.add(btnText);

    if (canStart) {
      const hint = this.add.text(w / 2, btnY + 46, '[ Click or Press SPACE to Launch ]', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        color: '#00F0FF'
      }).setOrigin(0.5);
      this.lobbyContainer.add(hint);

      const zone = this.add.zone(w / 2, btnY, btnW, btnH).setOrigin(0.5).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.triggerStartMatch());
      this.lobbyContainer.add(zone);
    }
  }

  updatePlayerRoster(playerList) {
    if (!playerList) return;
    const activeIds = new Set(playerList.map(p => p.id));

    for (const [id, entity] of this.playerMap.entries()) {
      if (!activeIds.has(id)) {
        entity.container.destroy();
        this.playerMap.delete(id);
      }
    }

    for (const p of playerList) {
      if (!this.playerMap.has(p.id)) {
        this.createPlayerEntity(p);
      }
    }
  }

  createPlayerEntity(p) {
    const container = this.add.container(p.x || WORLD_WIDTH / 2, p.y || WORLD_HEIGHT / 2);
    const radius = 24;

    const glow = this.add.graphics();
    glow.fillStyle(p.color.num, 0.25);
    glow.fillCircle(0, 0, radius + 8);

    const ring = this.add.graphics();
    ring.lineStyle(3, p.color.num, 0.9);
    ring.strokeCircle(0, 0, radius + 14);
    ring.setVisible(false);

    const circle = this.add.graphics();
    circle.fillStyle(p.color.num, 1);
    circle.fillCircle(0, 0, radius);
    circle.lineStyle(2, 0xFFFFFF, 0.8);
    circle.strokeCircle(0, 0, radius);

    const core = this.add.graphics();
    core.fillStyle(0xFFFFFF, 0.9);
    core.fillCircle(0, 0, 6);

    const nameTag = this.add.text(0, -radius - 14, p.name, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      backgroundColor: 'rgba(5, 5, 15, 0.75)',
      padding: { x: 6, y: 2 }
    }).setOrigin(0.5);

    container.add([glow, ring, circle, core, nameTag]);
    container.setDepth(10);

    this.playerMap.set(p.id, {
      container,
      circle,
      glow,
      ring,
      labelText: nameTag,
      targetX: p.x || WORLD_WIDTH / 2,
      targetY: p.y || WORLD_HEIGHT / 2,
      currentX: p.x || WORLD_WIDTH / 2,
      currentY: p.y || WORLD_HEIGHT / 2,
      action: false,
      color: p.color
    });
  }

  clearAllPlayerEntities() {
    for (const entity of this.playerMap.values()) {
      entity.container.destroy();
    }
    this.playerMap.clear();
  }

  applySnapshot(snapshot) {
    if (!snapshot || !snapshot.p) return;

    for (const snap of snapshot.p) {
      const entity = this.playerMap.get(snap.id);
      if (entity) {
        entity.targetX = snap.x;
        entity.targetY = snap.y;
        entity.action = Boolean(snap.a);
      }
    }
  }

  setupDebugOverlay() {
    this.debugBg = this.add.graphics();
    this.debugBg.fillStyle(0x050515, 0.85);
    this.debugBg.fillRoundedRect(0, 0, 280, 130, 8);
    this.debugBg.lineStyle(1, 0x00F0FF, 0.8);
    this.debugBg.strokeRoundedRect(0, 0, 280, 130, 8);

    this.debugText = this.add.text(14, 14, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#00F0FF',
      lineSpacing: 4
    });

    this.debugContainer.add([this.debugBg, this.debugText]);
    this.debugContainer.setDepth(100);
  }

  update(time, delta) {
    const isRunning = currentGameState.state === 'RUNNING';
    const lerpFactor = Math.min(1, (delta / 1000) * 18);

    for (const entity of this.playerMap.values()) {
      if (isRunning) {
        entity.currentX += (entity.targetX - entity.currentX) * lerpFactor;
        entity.currentY += (entity.targetY - entity.currentY) * lerpFactor;
        entity.container.setPosition(entity.currentX, entity.currentY);

        entity.ring.setVisible(entity.action);
        if (entity.action) {
          entity.ring.setScale(1 + Math.sin(time / 50) * 0.15);
        }
      }
    }

    if (showDebugOverlay) {
      const fps = Math.round(this.game.loop.actualFps);
      this.debugText.setText(
        `[DEBUG OVERLAY] (Press D)\n` +
        `FPS          : ${fps}\n` +
        `Racers       : ${currentGameState.playerCount}/20\n` +
        `Server Tick  : ${serverTickTimeMs} ms\n` +
        `Snapshot Size: ${snapshotBytes} bytes\n` +
        `State        : ${currentGameState.state}`
      );
    }
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [HostScene]
};

new Phaser.Game(config);
