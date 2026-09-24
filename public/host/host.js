// public/host/host.js - Big Screen Phaser 3 Host Display
const socket = io();

let serverInfo = {
  playUrl: 'Loading...',
  qrCodeDataUrl: ''
};

let currentGameState = {
  state: 'LOBBY',
  players: [],
  playerCount: 0,
  canStart: false
};

// Fetch server info (LAN IP, QR Code)
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
    this.bgGraphics = null;
    this.uiContainer = null;
    this.qrImage = null;
    this.playerObjects = [];
  }

  async preload() {
    await fetchServerInfo();
  }

  create() {
    this.cameras.main.setBackgroundColor('#070714');
    this.bgGraphics = this.add.graphics();
    this.uiContainer = this.add.container(0, 0);

    // If QR code is available, load texture into Phaser
    if (serverInfo.qrCodeDataUrl) {
      this.textures.once('addtexture-qrcode', () => {
        this.renderUI();
      });
      this.textures.addBase64('qrcode', serverInfo.qrCodeDataUrl);
    }

    // Spacebar to start match
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.spaceKey.on('down', () => {
      this.triggerStartMatch();
    });

    // Listen to window resizing
    this.scale.on('resize', this.handleResize, this);

    // Listen for socket updates
    socket.on('game_state_update', (state) => {
      currentGameState = state;
      this.renderUI();
    });

    this.drawBackground();
    this.renderUI();
  }

  triggerStartMatch() {
    if (currentGameState.state === 'LOBBY' && currentGameState.canStart) {
      socket.emit('start_match');
    }
  }

  handleResize() {
    this.drawBackground();
    this.renderUI();
  }

  drawBackground() {
    const { width, height } = this.scale;
    this.bgGraphics.clear();

    // Dark cyber grid lines
    this.bgGraphics.lineStyle(1, 0x181830, 0.4);
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      this.bgGraphics.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y < height; y += gridSize) {
      this.bgGraphics.lineBetween(0, y, width, y);
    }

    // Top accent neon line
    this.bgGraphics.lineStyle(3, 0x00F0FF, 0.8);
    this.bgGraphics.lineBetween(0, 2, width, 2);
  }

  renderUI() {
    const { width, height } = this.scale;
    this.uiContainer.removeAll(true);
    this.playerObjects = [];

    if (currentGameState.state === 'LOBBY') {
      this.renderLobby(width, height);
    } else if (currentGameState.state === 'RUNNING') {
      this.renderRunning(width, height);
    }
  }

  renderLobby(width, height) {
    // 1. Title & Header
    const title = this.add.text(width / 2, 50, 'A N O M A L Y', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '46px',
      color: '#00F0FF',
      letterSpacing: 8
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, 95, 'REAL-TIME MULTIPLAYER TREASURE RACE', {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: '#8888AA',
      letterSpacing: 4
    }).setOrigin(0.5);

    this.uiContainer.add([title, subtitle]);

    // Layout dimensions
    const isWide = width >= 900;
    const contentY = 140;
    const contentHeight = height - contentY - 120;

    // 2. Left Panel: QR Code & Join Info
    const leftPanelWidth = isWide ? Math.min(360, width * 0.38) : width - 40;
    const leftPanelX = isWide ? width * 0.25 : width / 2;
    const leftPanelY = isWide ? contentY + contentHeight / 2 : contentY + 160;

    // QR Box background
    const qrBox = this.add.graphics();
    qrBox.fillStyle(0x0e0e22, 0.8);
    qrBox.fillRoundedRect(leftPanelX - leftPanelWidth / 2, leftPanelY - 170, leftPanelWidth, 340, 16);
    qrBox.lineStyle(2, 0x00F0FF, 0.5);
    qrBox.strokeRoundedRect(leftPanelX - leftPanelWidth / 2, leftPanelY - 170, leftPanelWidth, 340, 16);
    this.uiContainer.add(qrBox);

    const scanText = this.add.text(leftPanelX, leftPanelY - 145, 'SCAN TO JOIN WITH PHONE', {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.uiContainer.add(scanText);

    // QR Code Image
    if (this.textures.exists('qrcode')) {
      const qrSprite = this.add.image(leftPanelX, leftPanelY - 20, 'qrcode');
      qrSprite.setDisplaySize(180, 180);
      this.uiContainer.add(qrSprite);
    }

    // URL Display
    const urlLabel = this.add.text(leftPanelX, leftPanelY + 95, 'OR VISIT ON BROWSER:', {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: '#777799'
    }).setOrigin(0.5);

    const urlText = this.add.text(leftPanelX, leftPanelY + 120, serverInfo.playUrl || 'http://...', {
      fontFamily: 'monospace',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#FFE600'
    }).setOrigin(0.5);
    this.uiContainer.add([urlLabel, urlText]);

    // 3. Right Panel: Player Roster
    const rightPanelX = isWide ? width * 0.65 : width / 2;
    const rightPanelY = isWide ? contentY : contentY + 360;
    const rightPanelWidth = isWide ? width * 0.45 : width - 40;

    const playersHeader = this.add.text(rightPanelX, rightPanelY, `PLAYERS JOINED (${currentGameState.playerCount}/20)`, {
      fontFamily: 'sans-serif',
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 2
    }).setOrigin(0.5, 0);
    this.uiContainer.add(playersHeader);

    // Players list / grid
    if (currentGameState.players.length === 0) {
      const noPlayersText = this.add.text(rightPanelX, rightPanelY + 60, 'Waiting for players to connect...\nScan the QR code on your phone to enter.', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        color: '#555577',
        align: 'center',
        lineSpacing: 8
      }).setOrigin(0.5, 0);
      this.uiContainer.add(noPlayersText);
    } else {
      const startListY = rightPanelY + 40;
      const cols = isWide ? 2 : 2;
      const colWidth = rightPanelWidth / cols;
      const itemHeight = 44;

      currentGameState.players.forEach((p, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const itemX = rightPanelX - rightPanelWidth / 2 + col * colWidth + 10;
        const itemY = startListY + row * itemHeight;

        // Player card background
        const cardBg = this.add.graphics();
        cardBg.fillStyle(0x13132a, 0.7);
        cardBg.fillRoundedRect(itemX, itemY, colWidth - 20, 36, 8);
        cardBg.lineStyle(1, p.color.num, 0.6);
        cardBg.strokeRoundedRect(itemX, itemY, colWidth - 20, 36, 8);
        this.uiContainer.add(cardBg);

        // Player color circle
        const circle = this.add.graphics();
        circle.fillStyle(p.color.num, 1);
        circle.fillCircle(itemX + 22, itemY + 18, 9);
        this.uiContainer.add(circle);

        // Player Name text
        const nameText = this.add.text(itemX + 42, itemY + 18, p.name, {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        }).setOrigin(0, 0.5);
        this.uiContainer.add(nameText);
      });
    }

    // 4. Bottom: START MATCH Button
    const btnY = height - 60;
    const btnWidth = 280;
    const btnHeight = 52;
    const canStart = currentGameState.canStart;

    const btnBg = this.add.graphics();
    btnBg.fillStyle(canStart ? 0x00F0FF : 0x222233, 1);
    btnBg.fillRoundedRect(width / 2 - btnWidth / 2, btnY - btnHeight / 2, btnWidth, btnHeight, 10);
    if (canStart) {
      btnBg.lineStyle(2, 0xFFFFFF, 0.9);
      btnBg.strokeRoundedRect(width / 2 - btnWidth / 2, btnY - btnHeight / 2, btnWidth, btnHeight, 10);
    }
    this.uiContainer.add(btnBg);

    const btnText = this.add.text(width / 2, btnY, canStart ? 'START MATCH' : 'WAITING FOR PLAYERS', {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: canStart ? '#050510' : '#666688',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.uiContainer.add(btnText);

    if (canStart) {
      const hintText = this.add.text(width / 2, btnY + 36, '[ Click or Press SPACE to Launch ]', {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: '#00F0FF'
      }).setOrigin(0.5);
      this.uiContainer.add(hintText);

      // Make button interactive
      const hitArea = this.add.zone(width / 2, btnY, btnWidth, btnHeight).setOrigin(0.5).setInteractive({ useHandCursor: true });
      hitArea.on('pointerdown', () => this.triggerStartMatch());
      this.uiContainer.add(hitArea);
    }
  }

  renderRunning(width, height) {
    // Header
    const banner = this.add.text(width / 2, height * 0.2, '⚡ MATCH RUNNING ⚡', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '52px',
      color: '#39FF14',
      letterSpacing: 6
    }).setOrigin(0.5);

    const sub = this.add.text(width / 2, height * 0.28, 'TREASURE RACE IN PROGRESS - PLAYERS COMPETING', {
      fontFamily: 'sans-serif',
      fontSize: '16px',
      color: '#AAAAFF',
      letterSpacing: 3
    }).setOrigin(0.5);

    this.uiContainer.add([banner, sub]);

    // Player Grid
    const activeCountText = this.add.text(width / 2, height * 0.4, `ACTIVE RACERS (${currentGameState.playerCount})`, {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.uiContainer.add(activeCountText);

    const startY = height * 0.48;
    const cardWidth = 200;
    const cardHeight = 44;
    const cols = Math.min(4, Math.max(1, Math.floor((width - 40) / (cardWidth + 20))));
    const spacingX = (width - 60) / cols;

    currentGameState.players.forEach((p, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = width / 2 - ((cols - 1) * spacingX) / 2 + col * spacingX;
      const y = startY + row * (cardHeight + 16);

      const card = this.add.graphics();
      card.fillStyle(0x111126, 0.85);
      card.fillRoundedRect(x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight, 8);
      card.lineStyle(2, p.color.num, 0.8);
      card.strokeRoundedRect(x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight, 8);
      this.uiContainer.add(card);

      const dot = this.add.graphics();
      dot.fillStyle(p.color.num, 1);
      dot.fillCircle(x - cardWidth / 2 + 22, y, 10);
      this.uiContainer.add(dot);

      const name = this.add.text(x - cardWidth / 2 + 42, y, p.name, {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      }).setOrigin(0, 0.5);
      this.uiContainer.add(name);
    });
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [HostScene]
};

new Phaser.Game(config);
