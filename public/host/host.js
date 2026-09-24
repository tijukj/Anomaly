// public/host/host.js - Big Screen Phaser 3 Host Arena & Lobby
const socket = io({
  transports: ['websocket', 'polling']
});

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1000;

let serverInfo = {
  publicUrl: '',
  port: 3000
};

let playUrl = `${window.location.origin}/play`;

let currentGameState = {
  state: 'LOBBY',
  players: [],
  playerCount: 0,
  canStart: false,
  seed: 0,
  map: null
};

// Snapshot interpolation & debug state
let latestSnapshot = null;
let lastSnapshotTime = 0;
let snapshotBytes = 0;
let serverTickTimeMs = 0;
let showDebugOverlay = false;
let showPoiDebugMarkers = false;

// Pre-fetch server config info
async function initServerInfo() {
  try {
    const res = await fetch('/api/server-info');
    serverInfo = await res.json();
    if (serverInfo.publicUrl) {
      playUrl = `${serverInfo.publicUrl.replace(/\/+$/, '')}/play`;
    } else {
      playUrl = `${window.location.origin}/play`;
    }
  } catch (err) {
    console.error('Failed to fetch server info:', err);
    playUrl = `${window.location.origin}/play`;
  }
}

await initServerInfo();

class HostScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HostScene' });
    this.playerMap = new Map();
    this.debugContainer = null;
    this.poiDebugContainer = null;
  }

  preload() {
    const qrEndpoint = `/api/qr.png?url=${encodeURIComponent(playUrl)}`;
    this.load.image('qrcode', qrEndpoint);
  }

  create() {
    this.cameras.main.setBackgroundColor('#070714');
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.bgGraphics = this.add.graphics();
    this.mapGraphics = this.add.graphics();
    this.wallsGraphics = this.add.graphics();
    this.labelsContainer = this.add.container(0, 0);
    this.poiDebugContainer = this.add.container(0, 0);
    this.lobbyContainer = this.add.container(0, 0);
    this.arenaContainer = this.add.container(0, 0);
    this.debugContainer = this.add.container(20, 20);

    // Fallback image loader to guarantee QR visibility
    if (!this.textures.exists('qrcode')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!this.textures.exists('qrcode')) {
          this.textures.addImage('qrcode', img);
          if (currentGameState.state === 'LOBBY') {
            this.renderLobbyUI();
          }
        }
      };
      img.src = `/api/qr.png?url=${encodeURIComponent(playUrl)}`;
    }

    // Keyboard controls
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.spaceKey.on('down', () => this.triggerStartMatch());

    this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.dKey.on('down', () => {
      showDebugOverlay = !showDebugOverlay;
      this.debugContainer.setVisible(showDebugOverlay);
    });

    // Toggle Seeded POI Markers with 'M'
    this.mKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.mKey.on('down', () => {
      showPoiDebugMarkers = !showPoiDebugMarkers;
      this.poiDebugContainer.setVisible(showPoiDebugMarkers);
    });

    // Socket Event: Full state update
    socket.on('game_state_update', (state) => {
      const prevState = currentGameState.state;
      currentGameState = state;
      if (prevState !== state.state) {
        this.onStateChanged(state.state);
      }
      this.renderLobbyUI();
      this.updatePlayerRoster(state.players);
      if (state.state === 'RUNNING') {
        this.drawFullMap();
        this.renderPoiMarkers();
      }
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

    this.drawBackgroundGrid();
    this.renderLobbyUI();
    this.setupDebugOverlay();
    this.debugContainer.setVisible(showDebugOverlay);
    this.poiDebugContainer.setVisible(showPoiDebugMarkers);
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
      this.drawFullMap();
      this.renderPoiMarkers();
    } else {
      this.lobbyContainer.setVisible(true);
      this.arenaContainer.setVisible(false);
      this.clearAllPlayerEntities();
      this.mapGraphics.clear();
      this.wallsGraphics.clear();
      this.labelsContainer.removeAll(true);
      this.poiDebugContainer.removeAll(true);
      this.renderLobbyUI();
    }
  }

  drawBackgroundGrid() {
    this.bgGraphics.clear();
    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;

    this.bgGraphics.lineStyle(1, 0x121226, 0.4);
    const gridSize = 50;
    for (let x = 0; x <= w; x += gridSize) {
      this.bgGraphics.lineBetween(x, 0, x, h);
    }
    for (let y = 0; y <= h; y += gridSize) {
      this.bgGraphics.lineBetween(0, y, w, y);
    }
  }

  // Draw complete neon top-down map: regions, river, bridges, and walls
  drawFullMap() {
    this.mapGraphics.clear();
    this.wallsGraphics.clear();
    this.labelsContainer.removeAll(true);

    const mapData = currentGameState.map;
    if (!mapData) return;

    // 1. Draw Region Zone Backgrounds & Neon Outlines
    for (const region of mapData.regions) {
      const b = region.bounds;
      // Semi-transparent ambient tinted fill
      this.mapGraphics.fillStyle(region.colorNum, 0.05);
      this.mapGraphics.fillRect(b.x, b.y, b.width, b.height);

      // Glowing Region Boundary Box
      this.mapGraphics.lineStyle(2, region.colorNum, 0.4);
      this.mapGraphics.strokeRect(b.x, b.y, b.width, b.height);

      // Floating Region Name Label
      if (region.id !== 'plaza') {
        const label = this.add.text(region.labelPos.x, region.labelPos.y, region.name, {
          fontFamily: '"Impact", "Arial Black", sans-serif',
          fontSize: '22px',
          color: region.colorHex,
          letterSpacing: 4
        }).setOrigin(0.5).setAlpha(0.75);
        this.labelsContainer.add(label);
      }
    }

    // 2. Draw River (Water Band)
    this.mapGraphics.fillStyle(0x0088cc, 0.22);
    this.mapGraphics.fillRect(40, 470, 1520, 120);

    this.mapGraphics.lineStyle(2, 0x00ccff, 0.7);
    this.mapGraphics.lineBetween(40, 470, 1560, 470);
    this.mapGraphics.lineBetween(40, 590, 1560, 590);

    // River Floating Label
    const riverLabel = this.add.text(220, 530, '🌊 CYBER RIVER (SLOW)', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#00CCFF',
      letterSpacing: 2
    }).setOrigin(0.5).setAlpha(0.85);
    this.labelsContainer.add(riverLabel);

    // 3. Draw 3 Bridges Crossing River
    for (const bridge of mapData.bridges) {
      // Bridge Deck Fill
      this.mapGraphics.fillStyle(0x161633, 0.95);
      this.mapGraphics.fillRoundedRect(bridge.x, bridge.y, bridge.width, bridge.height, 6);

      // Bridge Glowing Rails
      this.mapGraphics.lineStyle(3, bridge.colorNum, 0.9);
      this.mapGraphics.strokeRoundedRect(bridge.x, bridge.y, bridge.width, bridge.height, 6);

      // Bridge Plank Lines
      this.mapGraphics.lineStyle(1, 0xffffff, 0.3);
      for (let py = bridge.y + 16; py < bridge.y + bridge.height - 10; py += 18) {
        this.mapGraphics.lineBetween(bridge.x + 4, py, bridge.x + bridge.width - 4, py);
      }

      const bridgeText = this.add.text(bridge.x + bridge.width / 2, bridge.y + bridge.height / 2, 'BRIDGE', {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      }).setOrigin(0.5);
      this.labelsContainer.add(bridgeText);
    }

    // 4. Draw Start Plaza Center Circle & Rings
    this.mapGraphics.lineStyle(2, 0x00F0FF, 0.6);
    this.mapGraphics.strokeCircle(800, 530, 90);
    this.mapGraphics.strokeCircle(800, 530, 24);
    this.mapGraphics.fillStyle(0x00F0FF, 0.08);
    this.mapGraphics.fillCircle(800, 530, 90);

    const plazaLabel = this.add.text(800, 530, 'START PLAZA', {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.labelsContainer.add(plazaLabel);

    // 5. Draw Static Obstacle Walls
    for (const wall of mapData.walls) {
      const color = wall.colorNum || 0x00F0FF;
      if (wall.type === 'boundary') {
        this.wallsGraphics.fillStyle(0x00F0FF, 0.8);
        this.wallsGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
      } else if (wall.type === 'forest') {
        this.wallsGraphics.fillStyle(0x0e2418, 0.85);
        this.wallsGraphics.fillRoundedRect(wall.x, wall.y, wall.width, wall.height, 8);
        this.wallsGraphics.lineStyle(2, color, 0.8);
        this.wallsGraphics.strokeRoundedRect(wall.x, wall.y, wall.width, wall.height, 8);
      } else if (wall.type === 'castle') {
        this.wallsGraphics.fillStyle(0x101830, 0.9);
        this.wallsGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
        this.wallsGraphics.lineStyle(2, color, 0.9);
        this.wallsGraphics.strokeRect(wall.x, wall.y, wall.width, wall.height);
      } else if (wall.type === 'cave') {
        this.wallsGraphics.fillStyle(0x220a30, 0.9);
        this.wallsGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
        this.wallsGraphics.lineStyle(2, color, 0.9);
        this.wallsGraphics.strokeRect(wall.x, wall.y, wall.width, wall.height);
      } else if (wall.type === 'secret_door') {
        if (!mapData.secretDoorOpen) {
          this.wallsGraphics.fillStyle(0xff0055, 0.9);
          this.wallsGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
          this.wallsGraphics.lineStyle(2, 0xffffff, 0.9);
          this.wallsGraphics.strokeRect(wall.x, wall.y, wall.width, wall.height);
        }
      } else {
        // Ruins / Other
        this.wallsGraphics.fillStyle(0x1e1528, 0.9);
        this.wallsGraphics.fillRoundedRect(wall.x, wall.y, wall.width, wall.height, 4);
        this.wallsGraphics.lineStyle(2, color, 0.8);
        this.wallsGraphics.strokeRoundedRect(wall.x, wall.y, wall.width, wall.height, 4);
      }
    }

    // 6. Match Seed Badge (Bottom Right)
    const seedText = this.add.text(WORLD_WIDTH - 30, WORLD_HEIGHT - 24, `MATCH SEED: #${currentGameState.seed || '000000'} | [M] POI Markers`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#00F0FF'
    }).setOrigin(1, 0.5);
    this.labelsContainer.add(seedText);
  }

  // Render Seeded Match POI Debug Markers (Toggleable with 'M')
  renderPoiMarkers() {
    this.poiDebugContainer.removeAll(true);
    const mapData = currentGameState.map;
    if (!mapData || !mapData.pois) return;

    const pois = mapData.pois;
    const g = this.add.graphics();

    // 1. Treasures (Gold Diamonds)
    for (const t of (pois.treasures || [])) {
      g.fillStyle(0xFFD700, 0.9);
      g.fillCircle(t.x, t.y, 8);
      g.lineStyle(1.5, 0xFFFFFF, 1);
      g.strokeCircle(t.x, t.y, 8);

      const label = this.add.text(t.x, t.y, 'T', {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#000000'
      }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    // 2. Vaults (Bronze Squares)
    for (const v of (pois.vaults || [])) {
      g.fillStyle(0xFF8800, 0.95);
      g.fillRect(v.x - 14, v.y - 14, 28, 28);
      g.lineStyle(2, 0xFFFFFF, 1);
      g.strokeRect(v.x - 14, v.y - 14, 28, 28);

      const label = this.add.text(v.x, v.y, 'VAULT', {
        fontFamily: 'monospace',
        fontSize: '7px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    // 3. Clues (Cyan Rings)
    for (const c of (pois.clues || [])) {
      g.lineStyle(2, 0x00FFFF, 0.9);
      g.strokeCircle(c.x, c.y, 10);
      g.fillStyle(0x00FFFF, 0.5);
      g.fillCircle(c.x, c.y, 5);

      const label = this.add.text(c.x, c.y - 16, 'CLUE', {
        fontFamily: 'sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#00FFFF'
      }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    // 4. Mission Zones (Neon Orange Circles)
    for (const m of (pois.missions || [])) {
      g.lineStyle(2, 0xFF5500, 0.8);
      g.strokeCircle(m.x, m.y, 28);
      g.fillStyle(0xFF5500, 0.15);
      g.fillCircle(m.x, m.y, 28);

      const label = this.add.text(m.x, m.y, m.label || 'MISSION', {
        fontFamily: 'sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#FF5500'
      }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    // 5. Secret Switch (Red Button Marker)
    if (pois.secretSwitch) {
      const sw = pois.secretSwitch;
      g.fillStyle(0xFF0055, 1);
      g.fillCircle(sw.x, sw.y, 10);
      g.lineStyle(2, 0xFFFFFF, 1);
      g.strokeCircle(sw.x, sw.y, 10);

      const label = this.add.text(sw.x, sw.y - 16, 'SWITCH', {
        fontFamily: 'monospace',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#FF0055'
      }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    // 6. Portals (Swirling Rings)
    for (const pair of (pois.portals || [])) {
      [pair.a, pair.b].forEach((portal, idx) => {
        g.lineStyle(3, portal.colorNum || 0x00F0FF, 0.9);
        g.strokeCircle(portal.x, portal.y, 14);
        g.fillStyle(portal.colorNum || 0x00F0FF, 0.3);
        g.fillCircle(portal.x, portal.y, 8);

        const label = this.add.text(portal.x, portal.y - 18, `PORTAL ${idx === 0 ? 'A' : 'B'}`, {
          fontFamily: 'sans-serif',
          fontSize: '8px',
          fontStyle: 'bold',
          color: '#00F0FF'
        }).setOrigin(0.5);
        this.poiDebugContainer.add(label);
      });
    }

    // 7. Merchants (Green Kiosks)
    for (const merc of (pois.merchants || [])) {
      g.fillStyle(0x39FF14, 0.9);
      g.fillRoundedRect(merc.x - 12, merc.y - 12, 24, 24, 4);
      g.lineStyle(2, 0x050510, 1);
      g.strokeRoundedRect(merc.x - 12, merc.y - 12, 24, 24, 4);

      const label = this.add.text(merc.x, merc.y - 16, merc.name, {
        fontFamily: 'sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#39FF14'
      }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    this.poiDebugContainer.add(g);
    this.poiDebugContainer.setDepth(5);
  }

  renderLobbyUI() {
    if (currentGameState.state !== 'LOBBY') return;
    this.lobbyContainer.removeAll(true);

    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;

    // 1. Title Header
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

    // 2. Left Panel: QR Code & Join Box
    const leftX = w * 0.28;
    const leftY = 515;
    const boxW = 460;
    const boxH = 520;

    const qrBox = this.add.graphics();
    qrBox.fillStyle(0x0c0c20, 0.85);
    qrBox.fillRoundedRect(leftX - boxW / 2, leftY - boxH / 2, boxW, boxH, 20);
    qrBox.lineStyle(2, 0x00F0FF, 0.6);
    qrBox.strokeRoundedRect(leftX - boxW / 2, leftY - boxH / 2, boxW, boxH, 20);
    this.lobbyContainer.add(qrBox);

    const scanHeader = this.add.text(leftX, leftY - 210, 'SCAN WITH PHONE CAMERA', {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.lobbyContainer.add(scanHeader);

    // High Contrast White Plate
    const qrPlate = this.add.graphics();
    qrPlate.fillStyle(0xFFFFFF, 1);
    qrPlate.fillRoundedRect(leftX - 125, leftY - 170, 250, 250, 12);
    this.lobbyContainer.add(qrPlate);

    if (this.textures.exists('qrcode')) {
      const qrSprite = this.add.image(leftX, leftY - 45, 'qrcode');
      qrSprite.setDisplaySize(240, 240);
      this.lobbyContainer.add(qrSprite);
    }

    const orLabel = this.add.text(leftX, leftY + 115, 'OR BROWSER ADDRESS:', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#777799',
      letterSpacing: 1
    }).setOrigin(0.5);

    const urlDisplay = this.add.text(leftX, leftY + 145, playUrl, {
      fontFamily: 'monospace',
      fontSize: playUrl.length > 32 ? '15px' : '18px',
      fontStyle: 'bold',
      color: '#FFE600'
    }).setOrigin(0.5);

    this.lobbyContainer.add([orLabel, urlDisplay]);

    // 3. Right Panel: Player Roster
    const rightX = w * 0.72;
    const rightY = 270;
    const rightW = 560;

    const rosterHeader = this.add.text(rightX, rightY, `PLAYERS JOINED: ${currentGameState.playerCount}/20`, {
      fontFamily: 'sans-serif',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 3
    }).setOrigin(0.5, 0);

    const readySub = this.add.text(rightX, rightY + 32, `Controllers Connected: ${currentGameState.playerCount}`, {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#39FF14',
      letterSpacing: 1
    }).setOrigin(0.5, 0);

    this.lobbyContainer.add([rosterHeader, readySub]);

    if (currentGameState.players.length === 0) {
      const emptyMsg = this.add.text(rightX, rightY + 100, 'Waiting for racers to join...\nScan the QR code on your phone to enter.', {
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
    const container = this.add.container(p.x || 800, p.y || 530);
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
      targetX: p.x || 800,
      targetY: p.y || 530,
      currentX: p.x || 800,
      currentY: p.y || 530,
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
    this.debugBg.fillRoundedRect(0, 0, 280, 150, 8);
    this.debugBg.lineStyle(1, 0x00F0FF, 0.8);
    this.debugBg.strokeRoundedRect(0, 0, 280, 150, 8);

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
        `Match Seed   : #${currentGameState.seed || 0}\n` +
        `POI Overlay  : [M] ${showPoiDebugMarkers ? 'ON' : 'OFF'}`
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
