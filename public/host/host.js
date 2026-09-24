// public/host/host.js - Big Screen Phaser 3 Host Arena, Countdown, Timeline & Podium
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
  countdown: 5,
  timeRemaining: 600,
  phaseIndex: 0,
  phase: { name: 'PHASE 1: DISCOVERY', colorHex: '#00F0FF' },
  map: null
};

// Snapshot interpolation & UI state
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

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

class HostScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HostScene' });
    this.playerMap = new Map();
    this.interactablesGraphics = null;
    this.hudContainer = null;
    this.countdownContainer = null;
    this.endedContainer = null;
    this.leaderboardContainer = null;
    this.debugContainer = null;
    this.poiDebugContainer = null;
    this.lastRenderedState = '';
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
    this.interactablesGraphics = this.add.graphics();
    this.labelsContainer = this.add.container(0, 0);
    this.fxContainer = this.add.container(0, 0);
    this.hudContainer = this.add.container(0, 0);
    this.countdownContainer = this.add.container(0, 0);
    this.endedContainer = this.add.container(0, 0);
    this.leaderboardContainer = this.add.container(0, 0);
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

    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escKey.on('down', () => this.triggerStopMatch());

    this.rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.rKey.on('down', () => this.triggerResetMatch());

    this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.dKey.on('down', () => {
      showDebugOverlay = !showDebugOverlay;
      this.debugContainer.setVisible(showDebugOverlay);
    });

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

      if (state.state === 'RUNNING' || state.state === 'COUNTDOWN') {
        this.drawFullMap();
        this.renderPoiMarkers();
        this.renderRunningHUD();
      } else if (state.state === 'ENDED') {
        this.renderEndedScreen();
      }
    });

    // Socket Event: Countdown Tick
    socket.on('countdown_tick', (data) => {
      currentGameState.countdown = data.count;
      this.renderCountdown(data.count);
    });

    // Socket Event: Phase Change Banner
    socket.on('phase_change', (data) => {
      this.showPhaseChangeBanner(data.phase);
    });

    // Socket Event: Score popup
    socket.on('score_popup', (event) => {
      if (currentGameState.state === 'RUNNING') {
        this.spawnScorePopup(event);
      }
    });

    // Socket Event: Match Ended
    socket.on('match_ended', (data) => {
      this.renderEndedScreen(data.leaderboard, data.podium);
    });

    // Socket Event: 20Hz compact tick snapshot
    socket.on('tick_snapshot', (snapshot) => {
      latestSnapshot = snapshot;
      lastSnapshotTime = performance.now();
      serverTickTimeMs = snapshot.tickTime || 0;
      snapshotBytes = new Blob([JSON.stringify(snapshot)]).size;

      if (snapshot.timeRemaining !== undefined) {
        currentGameState.timeRemaining = snapshot.timeRemaining;
      }
      if (snapshot.phase) {
        currentGameState.phase = snapshot.phase;
      }

      if (currentGameState.state === 'RUNNING') {
        this.applySnapshot(snapshot);
        this.renderRunningHUD();
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

  triggerStopMatch() {
    if (currentGameState.state === 'RUNNING' || currentGameState.state === 'COUNTDOWN') {
      socket.emit('stop_match');
    }
  }

  triggerResetMatch() {
    socket.emit('reset_match');
  }

  onStateChanged(newState) {
    if (newState === 'COUNTDOWN') {
      this.lobbyContainer.setVisible(false);
      this.endedContainer.setVisible(false);
      this.arenaContainer.setVisible(true);
      this.countdownContainer.setVisible(true);
      this.drawFullMap();
      this.renderPoiMarkers();
    } else if (newState === 'RUNNING') {
      this.lobbyContainer.setVisible(false);
      this.countdownContainer.setVisible(false);
      this.endedContainer.setVisible(false);
      this.arenaContainer.setVisible(true);
      this.drawFullMap();
      this.renderPoiMarkers();
      this.renderRunningHUD();
    } else if (newState === 'ENDED') {
      this.countdownContainer.setVisible(false);
      this.endedContainer.setVisible(true);
      this.renderEndedScreen();
    } else {
      // LOBBY
      this.lobbyContainer.setVisible(true);
      this.arenaContainer.setVisible(false);
      this.countdownContainer.setVisible(false);
      this.endedContainer.setVisible(false);
      this.hudContainer.removeAll(true);
      this.clearAllPlayerEntities();
      this.mapGraphics.clear();
      this.wallsGraphics.clear();
      this.interactablesGraphics.clear();
      this.labelsContainer.removeAll(true);
      this.leaderboardContainer.removeAll(true);
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

  drawFullMap() {
    this.mapGraphics.clear();
    this.wallsGraphics.clear();
    this.labelsContainer.removeAll(true);

    const mapData = currentGameState.map;
    if (!mapData) return;

    // 1. Draw Region Zone Backgrounds & Neon Outlines
    for (const region of mapData.regions) {
      const b = region.bounds;
      this.mapGraphics.fillStyle(region.colorNum, 0.05);
      this.mapGraphics.fillRect(b.x, b.y, b.width, b.height);

      this.mapGraphics.lineStyle(2, region.colorNum, 0.35);
      this.mapGraphics.strokeRect(b.x, b.y, b.width, b.height);

      if (region.id !== 'plaza' && region.id !== 'river') {
        const label = this.add.text(region.labelPos.x, region.labelPos.y, region.name, {
          fontFamily: '"Impact", "Arial Black", sans-serif',
          fontSize: '20px',
          color: region.colorHex,
          letterSpacing: 3
        }).setOrigin(0.5).setAlpha(0.7);
        this.labelsContainer.add(label);
      }
    }

    // 2. Draw River
    this.mapGraphics.fillStyle(0x0088cc, 0.2);
    this.mapGraphics.fillRect(40, 470, 1520, 120);

    this.mapGraphics.lineStyle(2, 0x00ccff, 0.7);
    this.mapGraphics.lineBetween(40, 470, 1560, 470);
    this.mapGraphics.lineBetween(40, 590, 1560, 590);

    const riverLabel = this.add.text(200, 530, '🌊 CYBER RIVER', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#00CCFF',
      letterSpacing: 2
    }).setOrigin(0.5).setAlpha(0.85);
    this.labelsContainer.add(riverLabel);

    // 3. Draw 3 Bridges
    for (const bridge of mapData.bridges) {
      this.mapGraphics.fillStyle(0x161633, 0.95);
      this.mapGraphics.fillRoundedRect(bridge.x, bridge.y, bridge.width, bridge.height, 6);

      this.mapGraphics.lineStyle(3, bridge.colorNum, 0.9);
      this.mapGraphics.strokeRoundedRect(bridge.x, bridge.y, bridge.width, bridge.height, 6);

      this.mapGraphics.lineStyle(1, 0xffffff, 0.25);
      for (let py = bridge.y + 16; py < bridge.y + bridge.height - 10; py += 18) {
        this.mapGraphics.lineBetween(bridge.x + 4, py, bridge.x + bridge.width - 4, py);
      }

      const bridgeText = this.add.text(bridge.x + bridge.width / 2, bridge.y + 18, 'BRIDGE', {
        fontFamily: 'monospace',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      }).setOrigin(0.5);
      this.labelsContainer.add(bridgeText);
    }

    // 4. Draw Start Plaza Center Circle
    this.mapGraphics.lineStyle(2, 0x00F0FF, 0.6);
    this.mapGraphics.strokeCircle(800, 530, 85);
    this.mapGraphics.strokeCircle(800, 530, 20);
    this.mapGraphics.fillStyle(0x00F0FF, 0.08);
    this.mapGraphics.fillCircle(800, 530, 85);

    const plazaLabel = this.add.text(800, 630, 'START PLAZA', {
      fontFamily: 'sans-serif',
      fontSize: '11px',
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
        this.wallsGraphics.fillStyle(0x1e1528, 0.9);
        this.wallsGraphics.fillRoundedRect(wall.x, wall.y, wall.width, wall.height, 4);
        this.wallsGraphics.lineStyle(2, color, 0.8);
        this.wallsGraphics.strokeRoundedRect(wall.x, wall.y, wall.width, wall.height, 4);
      }
    }

    // 6. Top Left Controls Hint
    const exitBtn = this.add.graphics();
    exitBtn.fillStyle(0x1a1a2e, 0.8);
    exitBtn.fillRoundedRect(30, 30, 200, 34, 6);
    exitBtn.lineStyle(1.5, 0xFF0055, 0.8);
    exitBtn.strokeRoundedRect(30, 30, 200, 34, 6);
    this.labelsContainer.add(exitBtn);

    const exitText = this.add.text(130, 47, 'ESC: LOBBY | R: RESET', {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#FF0055'
    }).setOrigin(0.5);
    this.labelsContainer.add(exitText);

    const exitZone = this.add.zone(130, 47, 200, 34).setOrigin(0.5).setInteractive({ useHandCursor: true });
    exitZone.on('pointerdown', () => this.triggerStopMatch());
    this.labelsContainer.add(exitZone);

    // 7. Match Seed Badge (Bottom Right)
    const seedText = this.add.text(WORLD_WIDTH - 30, WORLD_HEIGHT - 24, `SEED: #${currentGameState.seed || '000000'} | [M] POI Markers | [R] Reset`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#00F0FF'
    }).setOrigin(1, 0.5);
    this.labelsContainer.add(seedText);
  }

  // Render Big Center Pre-Match Countdown (5s)
  renderCountdown(count) {
    this.countdownContainer.removeAll(true);
    if (currentGameState.state !== 'COUNTDOWN') return;

    const bg = this.add.graphics();
    bg.fillStyle(0x050512, 0.7);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.countdownContainer.add(bg);

    const countText = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 20, count > 0 ? `${count}` : 'RACE!', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: count > 0 ? '140px' : '100px',
      color: count > 0 ? '#00F0FF' : '#39FF14',
      stroke: '#FFFFFF',
      strokeThickness: 4
    }).setOrigin(0.5);

    const sub = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 80, 'GET READY RACERS - PREPARE YOUR PHONES', {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 4
    }).setOrigin(0.5);

    this.countdownContainer.add([countText, sub]);

    this.tweens.add({
      targets: countText,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 350,
      yoyo: true,
      ease: 'Quad.easeInOut'
    });
  }

  // Render Top Center Running HUD (Digital Timer & Phase Badge)
  renderRunningHUD() {
    this.hudContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const timeFormatted = formatTime(currentGameState.timeRemaining || 0);
    const phase = currentGameState.phase || { name: 'PHASE 1: DISCOVERY', colorHex: '#00F0FF' };
    const isUrgent = currentGameState.timeRemaining <= 60;

    // HUD Header Box
    const hudBox = this.add.graphics();
    hudBox.fillStyle(0x0a0a1e, 0.9);
    hudBox.fillRoundedRect(WORLD_WIDTH / 2 - 190, 24, 380, 52, 12);
    hudBox.lineStyle(2, isUrgent ? 0xFF0055 : (currentGameState.phase ? Phaser.Display.Color.HexStringToColor(phase.colorHex).color : 0x00F0FF), 0.85);
    hudBox.strokeRoundedRect(WORLD_WIDTH / 2 - 190, 24, 380, 52, 12);
    this.hudContainer.add(hudBox);

    // Large Clock Timer
    const timerText = this.add.text(WORLD_WIDTH / 2 - 85, 50, `⏱️ ${timeFormatted}`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '28px',
      color: isUrgent ? '#FF0055' : '#FFFFFF',
      letterSpacing: 2
    }).setOrigin(0.5);

    // Current Phase Badge
    const phaseBadge = this.add.text(WORLD_WIDTH / 2 + 75, 50, phase.name, {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: phase.colorHex,
      letterSpacing: 1
    }).setOrigin(0.5);

    this.hudContainer.add([timerText, phaseBadge]);
  }

  // Animated Glowing Banner on Phase Transition
  showPhaseChangeBanner(phase) {
    const bannerContainer = this.add.container(WORLD_WIDTH / 2, -100);

    const bannerBg = this.add.graphics();
    const colorNum = Phaser.Display.Color.HexStringToColor(phase.colorHex).color;
    bannerBg.fillStyle(0x050515, 0.95);
    bannerBg.fillRoundedRect(-320, -35, 640, 70, 14);
    bannerBg.lineStyle(3, colorNum, 1);
    bannerBg.strokeRoundedRect(-320, -35, 640, 70, 14);

    const title = this.add.text(0, -10, phase.name, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '26px',
      color: phase.colorHex,
      letterSpacing: 3
    }).setOrigin(0.5);

    const sub = this.add.text(0, 16, phase.subtitle, {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 1
    }).setOrigin(0.5);

    bannerContainer.add([bannerBg, title, sub]);
    bannerContainer.setDepth(150);

    // Slide down from top, wait 3.5s, slide up
    this.tweens.add({
      targets: bannerContainer,
      y: 130,
      duration: 500,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(3200, () => {
          this.tweens.add({
            targets: bannerContainer,
            y: -120,
            duration: 400,
            ease: 'Cubic.easeIn',
            onComplete: () => bannerContainer.destroy()
          });
        });
      }
    });
  }

  // Draw Live Interactables on Arena
  drawActiveInteractables(entities) {
    this.interactablesGraphics.clear();
    if (!entities) return;

    for (const ent of entities) {
      if (ent.state !== 'active') continue;

      if (ent.type === 'treasure') {
        this.interactablesGraphics.fillStyle(ent.colorNum, 0.9);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 9);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 9);
        this.interactablesGraphics.fillStyle(0xFFFFFF, 0.9);
        this.interactablesGraphics.fillCircle(ent.x - 2, ent.y - 2, 2.5);
      } else if (ent.type === 'chest') {
        this.interactablesGraphics.fillStyle(0xFFAA00, 0.95);
        this.interactablesGraphics.fillRoundedRect(ent.x - 14, ent.y - 12, 28, 24, 4);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeRoundedRect(ent.x - 14, ent.y - 12, 28, 24, 4);
      } else if (ent.type === 'vault') {
        this.interactablesGraphics.fillStyle(0xFF8800, 0.9);
        this.interactablesGraphics.fillRoundedRect(ent.x - 18, ent.y - 18, 36, 36, 6);
        this.interactablesGraphics.lineStyle(2.5, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeRoundedRect(ent.x - 18, ent.y - 18, 36, 36, 6);
        this.interactablesGraphics.fillStyle(0x050510, 1);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 6);
      } else if (ent.type === 'key') {
        this.interactablesGraphics.fillStyle(0xFFDD00, 1);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 7);
        this.interactablesGraphics.fillRect(ent.x, ent.y - 2, 10, 4);
        this.interactablesGraphics.lineStyle(1.5, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 7);
      } else if (ent.type === 'portal') {
        this.interactablesGraphics.lineStyle(3, 0x00F0FF, 0.85);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 16);
        this.interactablesGraphics.fillStyle(0x00F0FF, 0.25);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 16);
      } else if (ent.type === 'merchant') {
        this.interactablesGraphics.fillStyle(0x39FF14, 0.9);
        this.interactablesGraphics.fillRoundedRect(ent.x - 16, ent.y - 16, 32, 32, 6);
        this.interactablesGraphics.lineStyle(2, 0x050510, 1);
        this.interactablesGraphics.strokeRoundedRect(ent.x - 16, ent.y - 16, 32, 32, 6);
      } else if (ent.type === 'switch') {
        this.interactablesGraphics.fillStyle(0xFF0055, 0.9);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 12);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 12);
      }
    }
  }

  // Draw Top 5 Leaderboard on Right Side
  drawHostLeaderboard(leaderboard = []) {
    this.leaderboardContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const startX = WORLD_WIDTH - 210;
    const startY = 30;
    const width = 180;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.85);
    bg.fillRoundedRect(startX - 10, startY, width + 20, 36 + leaderboard.length * 40, 10);
    bg.lineStyle(1.5, 0x00F0FF, 0.7);
    bg.strokeRoundedRect(startX - 10, startY, width + 20, 36 + leaderboard.length * 40, 10);
    this.leaderboardContainer.add(bg);

    const title = this.add.text(startX + width / 2, startY + 18, '👑 LEADERBOARD', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '14px',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.leaderboardContainer.add(title);

    leaderboard.forEach((player, idx) => {
      const itemY = startY + 44 + idx * 38;
      const rankColor = idx === 0 ? '#FFE600' : (idx === 1 ? '#CCCCCC' : (idx === 2 ? '#CD7F32' : '#FFFFFF'));

      const pip = this.add.graphics();
      pip.fillStyle(player.color.num, 1);
      pip.fillCircle(startX + 8, itemY + 8, 6);
      this.leaderboardContainer.add(pip);

      const nameText = this.add.text(startX + 22, itemY + 8, `${idx + 1}. ${player.name}`, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: rankColor
      }).setOrigin(0, 0.5);

      const scoreText = this.add.text(startX + width - 4, itemY + 8, `${player.score}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#39FF14'
      }).setOrigin(1, 0.5);

      this.leaderboardContainer.add([nameText, scoreText]);
    });
  }

  // Floating Score Popup
  spawnScorePopup(event) {
    const burst = this.add.graphics();
    burst.lineStyle(3, event.colorNum || 0x39ff14, 0.9);
    burst.strokeCircle(event.x, event.y, 10);
    this.fxContainer.add(burst);

    this.tweens.add({
      targets: burst,
      scaleX: 3.5,
      scaleY: 3.5,
      alpha: 0,
      duration: 600,
      ease: 'Power2',
      onComplete: () => burst.destroy()
    });

    const popupText = this.add.text(event.x, event.y - 10, `+${event.amount}`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#39FF14',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    this.fxContainer.add(popupText);

    this.tweens.add({
      targets: popupText,
      y: event.y - 55,
      alpha: 0,
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => popupText.destroy()
    });
  }

  // Render Final Match Results / Podium Screen
  renderEndedScreen(leaderboard = [], podium = []) {
    this.endedContainer.removeAll(true);
    if (currentGameState.state !== 'ENDED') return;

    const bg = this.add.graphics();
    bg.fillStyle(0x050512, 0.92);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.endedContainer.add(bg);

    const title = this.add.text(WORLD_WIDTH / 2, 80, '🏆 MATCH COMPLETED 🏆', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '56px',
      color: '#FFE600',
      letterSpacing: 6,
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);
    this.endedContainer.add(title);

    // 1. Draw Podium Pillars for Top 3
    const podiumX = [WORLD_WIDTH / 2, WORLD_WIDTH / 2 - 220, WORLD_WIDTH / 2 + 220]; // 1st (center), 2nd (left), 3rd (right)
    const podiumH = [200, 150, 120];
    const podiumColors = [0xFFD700, 0xC0C0C0, 0xCD7F32];
    const ranks = ['1ST PLACE 👑', '2ND PLACE 🥈', '3RD PLACE 🥉'];

    const sortedTop3 = podium.length > 0 ? podium : currentGameState.players.slice(0, 3);

    sortedTop3.forEach((p, idx) => {
      const x = idx === 0 ? podiumX[0] : (idx === 1 ? podiumX[1] : podiumX[2]);
      const h = idx === 0 ? podiumH[0] : (idx === 1 ? podiumH[1] : podiumH[2]);
      const baseY = 540;

      // Pillar Box
      const pillar = this.add.graphics();
      pillar.fillStyle(0x14142e, 0.9);
      pillar.fillRoundedRect(x - 90, baseY - h, 180, h, 8);
      pillar.lineStyle(3, podiumColors[idx] || 0xFFFFFF, 1);
      pillar.strokeRoundedRect(x - 90, baseY - h, 180, h, 8);
      this.endedContainer.add(pillar);

      // Player Color Pip
      const pip = this.add.graphics();
      pip.fillStyle(p.color.num, 1);
      pip.fillCircle(x, baseY - h - 35, 18);
      this.endedContainer.add(pip);

      // Rank Label
      const rankLabel = this.add.text(x, baseY - h + 24, ranks[idx], {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      }).setOrigin(0.5);

      // Player Name
      const nameText = this.add.text(x, baseY - h + 55, p.name, {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '22px',
        color: '#FFFFFF',
        letterSpacing: 1
      }).setOrigin(0.5);

      // Score
      const scoreText = this.add.text(x, baseY - h + 90, `${p.score} PTS`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#39FF14'
      }).setOrigin(0.5);

      this.endedContainer.add([rankLabel, nameText, scoreText]);
    });

    // 2. Reset Button & Shortcut Hint
    const btnY = WORLD_HEIGHT - 120;
    const btnW = 320;
    const btnH = 58;

    const resetBtn = this.add.graphics();
    resetBtn.fillStyle(0x00F0FF, 1);
    resetBtn.fillRoundedRect(WORLD_WIDTH / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 12);
    resetBtn.lineStyle(2, 0xFFFFFF, 1);
    resetBtn.strokeRoundedRect(WORLD_WIDTH / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 12);
    this.endedContainer.add(resetBtn);

    const resetText = this.add.text(WORLD_WIDTH / 2, btnY, 'RETURN TO LOBBY', {
      fontFamily: 'sans-serif',
      fontSize: '20px',
      fontStyle: 'bold',
      color: '#050510',
      letterSpacing: 2
    }).setOrigin(0.5);

    const keyHint = this.add.text(WORLD_WIDTH / 2, btnY + 44, '[ Press R on keyboard to reset ]', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#00F0FF'
    }).setOrigin(0.5);

    this.endedContainer.add([resetText, keyHint]);

    const zone = this.add.zone(WORLD_WIDTH / 2, btnY, btnW, btnH).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this.triggerResetMatch());
    this.endedContainer.add(zone);

    this.endedContainer.setDepth(200);
  }

  renderPoiMarkers() {
    this.poiDebugContainer.removeAll(true);
    const mapData = currentGameState.map;
    if (!mapData || !mapData.pois) return;

    const pois = mapData.pois;
    const g = this.add.graphics();

    for (const t of (pois.treasures || [])) {
      g.fillStyle(0xFFD700, 0.9);
      g.fillCircle(t.x, t.y, 8);
      g.lineStyle(1.5, 0xFFFFFF, 1);
      g.strokeCircle(t.x, t.y, 8);
      const label = this.add.text(t.x, t.y, 'T', { fontFamily: 'sans-serif', fontSize: '9px', fontStyle: 'bold', color: '#000000' }).setOrigin(0.5);
      this.poiDebugContainer.add(label);
    }

    for (const v of (pois.vaults || [])) {
      g.fillStyle(0xFF8800, 0.95);
      g.fillRect(v.x - 14, v.y - 14, 28, 28);
      g.lineStyle(2, 0xFFFFFF, 1);
      g.strokeRect(v.x - 14, v.y - 14, 28, 28);
      const label = this.add.text(v.x, v.y, 'VAULT', { fontFamily: 'monospace', fontSize: '7px', fontStyle: 'bold', color: '#FFFFFF' }).setOrigin(0.5);
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

    const keyIcon = this.add.text(0, -radius - 30, '🔑', { fontSize: '14px' }).setOrigin(0.5).setVisible(false);

    const nameTag = this.add.text(0, -radius - 14, p.name, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      backgroundColor: 'rgba(5, 5, 15, 0.75)',
      padding: { x: 6, y: 2 }
    }).setOrigin(0.5);

    container.add([glow, ring, circle, core, keyIcon, nameTag]);
    container.setDepth(10);

    this.playerMap.set(p.id, {
      container,
      circle,
      glow,
      ring,
      keyIcon,
      labelText: nameTag,
      targetX: p.x || 800,
      targetY: p.y || 530,
      currentX: p.x || 800,
      currentY: p.y || 530,
      score: 0,
      hasKey: false,
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
    if (!snapshot) return;

    if (snapshot.p) {
      for (const snap of snapshot.p) {
        const entity = this.playerMap.get(snap.id);
        if (entity) {
          entity.targetX = snap.x;
          entity.targetY = snap.y;
          entity.action = Boolean(snap.a);
          entity.score = snap.s || 0;
          entity.hasKey = Boolean(snap.k);
          if (entity.keyIcon) {
            entity.keyIcon.setVisible(entity.hasKey);
          }
        }
      }
    }

    if (snapshot.ent) {
      this.drawActiveInteractables(snapshot.ent);
    }

    if (snapshot.lb) {
      this.drawHostLeaderboard(snapshot.lb);
    }
  }

  setupDebugOverlay() {
    this.debugBg = this.add.graphics();
    this.debugBg.fillStyle(0x050515, 0.85);
    this.debugBg.fillRoundedRect(0, 0, 280, 160, 8);
    this.debugBg.lineStyle(1, 0x00F0FF, 0.8);
    this.debugBg.strokeRoundedRect(0, 0, 280, 160, 8);

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
      const phaseName = (currentGameState.phase && currentGameState.phase.name) || 'DISCOVERY';
      this.debugText.setText(
        `[DEBUG OVERLAY] (Press D)\n` +
        `FPS          : ${fps}\n` +
        `Racers       : ${currentGameState.playerCount}/20\n` +
        `Server Tick  : ${serverTickTimeMs} ms\n` +
        `Time Left    : ${formatTime(currentGameState.timeRemaining || 0)}\n` +
        `Phase        : ${phaseName}\n` +
        `Match Seed   : #${currentGameState.seed || 0}`
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
