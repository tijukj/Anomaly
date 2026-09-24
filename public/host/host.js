// public/host/host.js - Big Screen Phaser 3 Host Arena, Public Clue Chains, Legendary Treasure & Live Event Feed
const socket = io({
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 10,
  timeout: 8000
});

// 8-second connection timeout guard
let socketConnected = false;
const socketTimeoutTimer = setTimeout(() => {
  if (!socket.connected) {
    if (typeof window.showHostError === 'function') {
      window.showHostError(
        'Socket.IO Connection Timeout (8s)',
        `Could not establish connection to ${window.location.origin} within 8 seconds.\n\nSocket ID: ${socket.id || 'none'}\nState: ${socket.connected ? 'connected' : 'disconnected'}`,
        [
          'Verify that the ANOMALY node server is running and accessible.',
          'If deployed on Render free tier, the instance might be waking from cold sleep. Please wait 10 seconds and reload.',
          'Test the server health endpoint at ' + window.location.origin + '/ping.',
          'Check browser developer console (F12) for WebSocket connection errors.'
        ]
      );
    }
  }
}, 8000);

socket.on('connect', () => {
  socketConnected = true;
  clearTimeout(socketTimeoutTimer);
  if (typeof window.updateConnectionStatus === 'function') {
    window.updateConnectionStatus(true);
  }
  console.log('[Host] Connected to server with Socket ID:', socket.id);
});

socket.on('disconnect', (reason) => {
  if (typeof window.updateConnectionStatus === 'function') {
    window.updateConnectionStatus(false);
  }
  console.warn('[Host] Disconnected from server:', reason);
});

socket.on('connect_error', (err) => {
  if (typeof window.updateConnectionStatus === 'function') {
    window.updateConnectionStatus(false);
  }
  console.warn('[Host] Connection error:', err);
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
  clueState: null,
  map: null
};

// Snapshot interpolation & UI state
let latestSnapshot = null;
let lastSnapshotTime = 0;
let snapshotBytes = 0;
let serverTickTimeMs = 0;
let showDebugOverlay = false;
let showPoiDebugMarkers = false;

// Fetch server info and update URL dynamically
fetch('/api/server-info')
  .then(res => res.json())
  .then(info => {
    serverInfo = info;
    if (serverInfo.publicUrl) {
      playUrl = `${serverInfo.publicUrl.replace(/\/+$/, '')}/play`;
    }
  })
  .catch(err => {
    console.warn('Using default playUrl:', err);
  });

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Web Audio API Synthetic Sound Engine (Zero external audio files)
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.initialized = false;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.initialized = true;
      }
    } catch (e) {
      console.warn('[SoundEngine] Failed to init AudioContext:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playCollect(rarity = 'common') {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      let baseFreq = 520;
      let endFreq = 880;
      let dur = 0.12;

      if (rarity === 'rare') {
        baseFreq = 660;
        endFreq = 1320;
        dur = 0.18;
      } else if (rarity === 'epic' || rarity === 'vault') {
        baseFreq = 880;
        endFreq = 1760;
        dur = 0.25;
      }

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (e) {}
  }

  playTick(isFinal = false) {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      const freq = isFinal ? 880 : 440;
      const dur = isFinal ? 0.35 : 0.09;

      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (e) {}
  }

  playClue() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const t = this.ctx.currentTime + idx * 0.08;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.22);
      });
    } catch (e) {}
  }

  playMissionComplete() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        const t = this.ctx.currentTime + idx * 0.07;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch (e) {}
  }

  playAnomaly() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.linearRampToValueAtTime(660, t + 0.15);
      osc.frequency.linearRampToValueAtTime(330, t + 0.35);

      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    } catch (e) {}
  }

  playLegendaryFanfare() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const chords = [
        { t: 0, f: [523.25, 659.25, 783.99], dur: 0.25 },
        { t: 0.28, f: [587.33, 739.99, 880], dur: 0.25 },
        { t: 0.56, f: [659.25, 830.61, 987.77], dur: 0.3 },
        { t: 0.90, f: [783.99, 987.77, 1318.51], dur: 0.8 }
      ];
      chords.forEach(chord => {
        chord.f.forEach(freq => {
          const t = this.ctx.currentTime + chord.t;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.12, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + chord.dur);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + chord.dur + 0.05);
        });
      });
    } catch (e) {}
  }

  playCrownSteal() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.setValueAtTime(1200, t + 0.08);
      osc.frequency.setValueAtTime(600, t + 0.16);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    } catch (e) {}
  }
}

const sounds = new SoundEngine();

// Auto-unlock Web Audio on first user interaction
window.addEventListener('click', () => sounds.init(), { once: true });
window.addEventListener('keydown', () => sounds.init(), { once: true });

class HostScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HostScene' });
    this.playerMap = new Map();
    this.interactablesGraphics = null;
    this.hudContainer = null;
    this.countdownContainer = null;
    this.endedContainer = null;
    this.leaderboardContainer = null;
    this.cluesPanelContainer = null;
    this.eventFeedContainer = null;
    this.celebrationContainer = null;
    this.debugContainer = null;
    this.poiDebugContainer = null;
    this.soundStatusText = null;
    this.hostEvents = [];
    this.lastRenderedState = '';
  }

  preload() {
    this.load.on('loaderror', (fileObj) => {
      console.warn('[HostScene] Texture load warning:', fileObj && fileObj.key);
    });

    const qrEndpoint = `/api/qr.png?url=${encodeURIComponent(playUrl)}`;
    this.load.image('qrcode', qrEndpoint);
  }

  create() {
    sounds.init();
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
    this.cluesPanelContainer = this.add.container(1350, 310);
    this.eventFeedContainer = this.add.container(45, WORLD_HEIGHT - 210);
    this.anomalyContainer = this.add.container(680, 85);
    this.crownContainer = this.add.container(0, 0);
    this.fogGraphics = this.add.graphics();
    this.celebrationContainer = this.add.container(0, 0);
    this.poiDebugContainer = this.add.container(0, 0);
    this.lobbyContainer = this.add.container(0, 0);
    this.arenaContainer = this.add.container(0, 0);
    this.debugContainer = this.add.container(20, 20);

    // Set depths
    this.fogGraphics.setDepth(48);
    this.crownContainer.setDepth(52);
    this.eventFeedContainer.setDepth(60);
    this.cluesPanelContainer.setDepth(55);
    this.anomalyContainer.setDepth(120);
    this.celebrationContainer.setDepth(300);

    // Fallback Image loader to guarantee QR image is loaded and added to textures
    const qrEndpoint = `/api/qr.png?url=${encodeURIComponent(playUrl)}`;
    if (!this.textures.exists('qrcode')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!this.textures.exists('qrcode')) {
          this.textures.addImage('qrcode', img);
        }
        if (currentGameState.state === 'LOBBY') {
          this.renderLobbyUI();
        }
      };
      img.src = qrEndpoint;
    }

    // Keyboard controls
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.spaceKey.on('down', () => this.triggerStartMatch());

    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escKey.on('down', () => this.triggerStopMatch());

    this.rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.rKey.on('down', () => this.triggerResetMatch());

    this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.sKey.on('down', () => {
      sounds.init();
      const isMuted = sounds.toggleMute();
      this.updateSoundStatusBadge(isMuted);
    });

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

    // Debug Keys 1-8: Trigger specific anomalies manually
    this.input.keyboard.on('keydown', (event) => {
      if (event.key >= '1' && event.key <= '8') {
        const num = parseInt(event.key, 10);
        socket.emit('trigger_anomaly', { index: num });
      }
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
        if (state.clueState) {
          this.drawKnownCluesPanel(state.clueState.knownClues, state.clueState.chainTitle, state.clueState);
        }
      } else if (state.state === 'ENDED') {
        this.renderEndedScreen();
      }
    });

    // Socket Event: Countdown Tick
    socket.on('countdown_tick', (data) => {
      currentGameState.countdown = data.count;
      this.renderCountdown(data.count);
      sounds.playTick(data.count === 0);
    });

    // Socket Event: Phase Change Banner
    socket.on('phase_change', (data) => {
      this.showPhaseChangeBanner(data.phase);
      sounds.playAnomaly();
    });

    // Socket Event: Score popup
    socket.on('score_popup', (event) => {
      if (currentGameState.state === 'RUNNING') {
        this.spawnScorePopup(event);
        const rarity = event.amount >= 50 ? 'epic' : (event.amount >= 20 ? 'rare' : 'common');
        sounds.playCollect(rarity);
      }
    });

    // Socket Event: Host Event Feed (Missions, Glitch treasures, Keys, Vaults)
    socket.on('host_event', (event) => {
      this.addHostEvent(event);
      if (event.type === 'mission_complete') {
        sounds.playMissionComplete();
      } else if (event.type === 'crown_stolen') {
        sounds.playCrownSteal();
      }
    });

    // Socket Event: Public Clue Discovered (Large 6-second host banner)
    socket.on('public_clue_found', (data) => {
      this.showPublicClueBanner(data);
      sounds.playClue();
      if (data.knownClues) {
        this.drawKnownCluesPanel(data.knownClues, data.chainTitle);
      }
    });

    // Socket Event: Final Revelation (8:00 Chaos finale trigger)
    socket.on('final_revelation', (data) => {
      this.showFinalRevelationBanner(data);
      sounds.playLegendaryFanfare();
    });

    // Socket Event: Legendary Treasure Claimed (+150 pts celebration)
    socket.on('legendary_found', (data) => {
      this.showLegendaryFoundCelebration(data);
      sounds.playLegendaryFanfare();
    });

    // Socket Event: Anomaly Started
    socket.on('anomaly_start', (data) => {
      sounds.playAnomaly();
    });

    // Socket Event: Match Ended
    socket.on('match_ended', (data) => {
      this.renderEndedScreen(data.leaderboard, data.podium);
      sounds.playLegendaryFanfare();
    });

    // Socket Event: 20Hz compact tick snapshot
    const handleSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
      lastSnapshotTime = performance.now();
      serverTickTimeMs = snapshot.st || snapshot.tickTime || 0;
      snapshotBytes = new Blob([JSON.stringify(snapshot)]).size;

      if (snapshot.tr !== undefined) {
        currentGameState.timeRemaining = snapshot.tr;
      } else if (snapshot.timeRemaining !== undefined) {
        currentGameState.timeRemaining = snapshot.timeRemaining;
      }

      if (snapshot.phase) {
        currentGameState.phase = snapshot.phase;
      }

      if (currentGameState.state === 'RUNNING') {
        this.applySnapshot(snapshot);
        this.renderRunningHUD();
      }
    };

    socket.on('snapshot', handleSnapshot);
    socket.on('tick_snapshot', handleSnapshot);

    this.drawBackgroundGrid();
    this.renderLobbyUI();
    this.setupDebugOverlay();
    this.debugContainer.setVisible(showDebugOverlay);
    this.poiDebugContainer.setVisible(showPoiDebugMarkers);
    this.eventFeedContainer.setDepth(60);
    this.cluesPanelContainer.setDepth(55);
    this.celebrationContainer.setDepth(300);
  }

  updateSoundStatusBadge(isMuted) {
    if (this.soundStatusText) {
      this.soundStatusText.setText(isMuted ? '[ SOUND: MUTED (Press S) ]' : '[ SOUND: ON (Press S) ]');
      this.soundStatusText.setColor(isMuted ? '#FF0055' : '#39FF14');
    }
  }

  addHostEvent(event) {
    // Keep last 6 events with newest on top
    this.hostEvents.unshift(event);
    if (this.hostEvents.length > 6) {
      this.hostEvents.pop();
    }
    this.renderEventFeed();
  }

  renderEventFeed() {
    this.eventFeedContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING' || this.hostEvents.length === 0) return;

    const bg = this.add.graphics();
    const count = this.hostEvents.length;
    const boxH = 34 + count * 26;
    const boxW = 420;

    bg.fillStyle(0x0a0a1e, 0.9);
    bg.fillRoundedRect(0, 0, boxW, boxH, 8);
    bg.lineStyle(1.5, 0x00F0FF, 0.6);
    bg.strokeRoundedRect(0, 0, boxW, boxH, 8);
    this.eventFeedContainer.add(bg);

    const title = this.add.text(12, 9, '[ LIVE COMMENTARY FEED ]', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '12px',
      color: '#00F0FF',
      letterSpacing: 1.5
    });
    this.eventFeedContainer.add(title);

    this.hostEvents.forEach((ev, idx) => {
      const lineY = 32 + idx * 26;
      const text = this.add.text(14, lineY, ev.text || '', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: ev.colorHex || '#FFFFFF',
        wordWrap: { width: boxW - 28 }
      });
      this.eventFeedContainer.add(text);
    });
  }

  // Draw Public "Known Clues" Panel on Host Screen (Right Sidebar)
  drawKnownCluesPanel(knownClues = [], chainTitle = '', clueState = null) {
    this.cluesPanelContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const width = 210;
    const cluesList = knownClues || [];
    const boxH = 50 + Math.max(1, cluesList.length) * 44;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.9);
    bg.fillRoundedRect(0, 0, width, boxH, 8);
    bg.lineStyle(1.5, 0xFFE600, 0.7);
    bg.strokeRoundedRect(0, 0, width, boxH, 8);
    this.cluesPanelContainer.add(bg);

    const header = this.add.text(10, 12, `KNOWN CLUES (${cluesList.length}/3)`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '12px',
      color: '#FFE600',
      letterSpacing: 1
    });
    this.cluesPanelContainer.add(header);

    if (cluesList.length === 0) {
      const hint = this.add.text(10, 36, 'Awakens at 6:00 (Hunt)...', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'italic',
        color: '#777799'
      });
      this.cluesPanelContainer.add(hint);
    } else {
      cluesList.forEach((clue, idx) => {
        const itemY = 34 + idx * 42;
        const clueBadge = this.add.text(10, itemY, `✓ CLUE #${clue.step}: ${clue.shortHint || clue.region.toUpperCase()}`, {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#00F0FF'
        });

        const finder = this.add.text(10, itemY + 16, `Found by: ${clue.discoverer}`, {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          color: clue.colorHex || '#FFFFFF'
        });

        this.cluesPanelContainer.add([clueBadge, finder]);
      });
    }
  }

  // Large 6-Second Public Clue Discovery Banner
  showPublicClueBanner(data) {
    const banner = this.add.container(WORLD_WIDTH / 2, -140);

    const bg = this.add.graphics();
    bg.fillStyle(0x050518, 0.96);
    bg.fillRoundedRect(-360, -50, 720, 100, 16);
    bg.lineStyle(3, 0x00F0FF, 1);
    bg.strokeRoundedRect(-360, -50, 720, 100, 16);

    const title = this.add.text(0, -26, `📜 PUBLIC CLUE #${data.step}/3 DISCOVERED!`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '24px',
      color: '#00F0FF',
      letterSpacing: 3
    }).setOrigin(0.5);

    const clueText = this.add.text(0, 4, `"${data.text}"`, {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#FFE600',
      letterSpacing: 0.5
    }).setOrigin(0.5);

    const sub = this.add.text(0, 30, `FOUND BY ${data.discoverer.toUpperCase()} | TARGET: ${(data.shortHint || '').toUpperCase()}`, {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 1.5
    }).setOrigin(0.5);

    banner.add([bg, title, clueText, sub]);
    banner.setDepth(250);

    // Slide down, stay for 6 seconds, slide up
    this.tweens.add({
      targets: banner,
      y: 150,
      duration: 600,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(5200, () => {
          this.tweens.add({
            targets: banner,
            y: -160,
            duration: 500,
            ease: 'Cubic.easeIn',
            onComplete: () => banner.destroy()
          });
        });
      }
    });
  }

  // Final Revelation Banner (8:00 Mark)
  showFinalRevelationBanner(data) {
    const banner = this.add.container(WORLD_WIDTH / 2, -140);

    const bg = this.add.graphics();
    bg.fillStyle(0x180028, 0.96);
    bg.fillRoundedRect(-380, -50, 760, 100, 16);
    bg.lineStyle(3, 0xFFE600, 1);
    bg.strokeRoundedRect(-380, -50, 760, 100, 16);

    const title = this.add.text(0, -24, '👑 FINAL REVELATION 👑', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '28px',
      color: '#FFE600',
      letterSpacing: 4
    }).setOrigin(0.5);

    const desc = this.add.text(0, 12, `The Legendary Vault (${data.vaultName}) is exposed in CITADEL CASTLE!`, {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 1
    }).setOrigin(0.5);

    banner.add([bg, title, desc]);
    banner.setDepth(260);

    this.tweens.add({
      targets: banner,
      y: 150,
      duration: 600,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(5200, () => {
          this.tweens.add({
            targets: banner,
            y: -160,
            duration: 500,
            ease: 'Cubic.easeIn',
            onComplete: () => banner.destroy()
          });
        });
      }
    });
  }

  // Grand Full-Screen Celebration on Legendary Treasure Claim (+150 pts)
  showLegendaryFoundCelebration(data) {
    this.celebrationContainer.removeAll(true);

    const overlay = this.add.graphics();
    overlay.fillStyle(0x050515, 0.88);
    overlay.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.celebrationContainer.add(overlay);

    const card = this.add.graphics();
    card.fillStyle(0x141432, 0.98);
    card.fillRoundedRect(WORLD_WIDTH / 2 - 420, WORLD_HEIGHT / 2 - 160, 840, 320, 24);
    card.lineStyle(4, 0xFFE600, 1);
    card.strokeRoundedRect(WORLD_WIDTH / 2 - 420, WORLD_HEIGHT / 2 - 160, 840, 320, 24);
    this.celebrationContainer.add(card);

    const trophy = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 90, '👑 🏆 👑', {
      fontSize: '44px'
    }).setOrigin(0.5);

    const title = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 25, 'LEGENDARY TREASURE FOUND!', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '38px',
      color: '#FFE600',
      letterSpacing: 4
    }).setOrigin(0.5);

    const winner = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 35, `${data.playerName.toUpperCase()} DISCOVERED ${data.vaultName.toUpperCase()}`, {
      fontFamily: 'sans-serif',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 2
    }).setOrigin(0.5);

    const pts = this.add.text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 85, `+${data.points || 150} POINTS AWARDED`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '28px',
      color: '#39FF14',
      letterSpacing: 3
    }).setOrigin(0.5);

    this.celebrationContainer.add([trophy, title, winner, pts]);

    // Auto dismiss celebration after 6.5s
    this.time.delayedCall(6500, () => {
      this.tweens.add({
        targets: this.celebrationContainer,
        alpha: 0,
        duration: 800,
        onComplete: () => {
          this.celebrationContainer.removeAll(true);
          this.celebrationContainer.setAlpha(1);
        }
      });
    });
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
      this.eventFeedContainer.removeAll(true);
      this.cluesPanelContainer.removeAll(true);
      this.celebrationContainer.removeAll(true);
      this.hostEvents = [];
      this.clearAllPlayerEntities();
      this.mapGraphics.clear();
      this.wallsGraphics.clear();
      this.interactablesGraphics.clear();
      this.labelsContainer.removeAll(true);
      this.drawBackgroundGrid();
      this.renderLobbyUI();
    }
  }

  drawBackgroundGrid() {
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x070714, 1);
    this.bgGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Subtle neon grid lines
    this.bgGraphics.lineStyle(1, 0x141432, 0.4);
    const gridSize = 40;
    for (let x = 0; x < WORLD_WIDTH; x += gridSize) {
      this.bgGraphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 0; y < WORLD_HEIGHT; y += gridSize) {
      this.bgGraphics.lineBetween(0, y, WORLD_WIDTH, y);
    }
  }

  drawFullMap() {
    this.mapGraphics.clear();
    this.wallsGraphics.clear();
    this.labelsContainer.removeAll(true);

    // 1. Draw 4 Themed Neon Regions
    // Forest (Large West)
    this.mapGraphics.fillStyle(0x002211, 0.6);
    this.mapGraphics.fillRoundedRect(40, 40, 480, 920, 16);
    this.mapGraphics.lineStyle(2, 0x00FF66, 0.5);
    this.mapGraphics.strokeRoundedRect(40, 40, 480, 920, 16);

    const forestLabel = this.add.text(280, 75, 'NEON FOREST', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#00FF66',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(forestLabel);

    // Ruins (Center-North)
    this.mapGraphics.fillStyle(0x221100, 0.6);
    this.mapGraphics.fillRoundedRect(560, 40, 480, 400, 16);
    this.mapGraphics.lineStyle(2, 0xFF9900, 0.5);
    this.mapGraphics.strokeRoundedRect(560, 40, 480, 400, 16);

    const ruinsLabel = this.add.text(800, 95, 'ANCIENT RUINS', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#FF9900',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(ruinsLabel);

    // Castle (North-East, Walled)
    this.mapGraphics.fillStyle(0x051133, 0.6);
    this.mapGraphics.fillRoundedRect(1080, 40, 480, 420, 16);
    this.mapGraphics.lineStyle(2, 0x3377FF, 0.5);
    this.mapGraphics.strokeRoundedRect(1080, 40, 480, 420, 16);

    const castleLabel = this.add.text(1300, 105, 'CITADEL CASTLE', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#3377FF',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(castleLabel);

    // Cave (South-East, Narrow/Risky)
    this.mapGraphics.fillStyle(0x220022, 0.6);
    this.mapGraphics.fillRoundedRect(1060, 580, 500, 380, 16);
    this.mapGraphics.lineStyle(2, 0xCC00FF, 0.5);
    this.mapGraphics.strokeRoundedRect(1060, 580, 500, 380, 16);

    const caveLabel = this.add.text(1310, 925, 'OBSIDIAN CAVE', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#CC00FF',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(caveLabel);

    // 2. Cyber River (Winding band across middle)
    this.mapGraphics.fillStyle(0x002233, 0.85);
    this.mapGraphics.fillRect(40, 470, 1520, 120);
    this.mapGraphics.lineStyle(2, 0x00CCFF, 0.6);
    this.mapGraphics.lineBetween(40, 470, 1560, 470);
    this.mapGraphics.lineBetween(40, 590, 1560, 590);

    const riverLabel = this.add.text(210, 530, 'CYBER RIVER [SLOWS MOVEMENT]', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#00CCFF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.labelsContainer.add(riverLabel);

    // 3. Bridges (Safe shortcuts across river)
    const bridges = [
      { x: 380, name: 'WEST BRIDGE' },
      { x: 740, name: 'PLAZA BRIDGE' },
      { x: 1220, name: 'EAST BRIDGE' }
    ];

    bridges.forEach(b => {
      this.mapGraphics.fillStyle(0x141432, 1);
      this.mapGraphics.fillRoundedRect(b.x, 460, b.x === 740 ? 120 : 80, 140, 6);
      this.mapGraphics.lineStyle(2, 0x00F0FF, 0.9);
      this.mapGraphics.strokeRoundedRect(b.x, 460, b.x === 740 ? 120 : 80, 140, 6);
    });

    // 4. Start Plaza (Central Hub)
    this.mapGraphics.fillStyle(0x0c0c24, 0.9);
    this.mapGraphics.fillCircle(800, 530, 85);
    this.mapGraphics.lineStyle(3, 0x00F0FF, 0.8);
    this.mapGraphics.strokeCircle(800, 530, 85);

    const plazaLabel = this.add.text(800, 530, 'START PLAZA', {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.labelsContainer.add(plazaLabel);

    // 5. Draw Walls and Fortress Obstacles
    this.wallsGraphics.fillStyle(0x141432, 1);
    this.wallsGraphics.lineStyle(2, 0x00F0FF, 0.7);

    // Outer Map Boundary
    this.wallsGraphics.strokeRect(20, 20, 1560, 960);

    // Castle Fortress Walls
    this.wallsGraphics.fillStyle(0x101030, 1);
    this.wallsGraphics.lineStyle(2, 0x3377FF, 0.85);

    // North wall
    this.wallsGraphics.fillRect(1120, 80, 400, 24);
    this.wallsGraphics.strokeRect(1120, 80, 400, 24);
    // East wall
    this.wallsGraphics.fillRect(1496, 80, 24, 340);
    this.wallsGraphics.strokeRect(1496, 80, 24, 340);
    // South wall segments (Gate gap in middle)
    this.wallsGraphics.fillRect(1120, 400, 160, 24);
    this.wallsGraphics.strokeRect(1120, 400, 160, 24);
    this.wallsGraphics.fillRect(1360, 400, 160, 24);
    this.wallsGraphics.strokeRect(1360, 400, 160, 24);
    // West wall segments (Gate gap in middle)
    this.wallsGraphics.fillRect(1120, 80, 24, 120);
    this.wallsGraphics.strokeRect(1120, 80, 24, 120);
    this.wallsGraphics.fillRect(1120, 280, 24, 144);
    this.wallsGraphics.strokeRect(1120, 280, 24, 144);
    // Keep chamber walls with open doorway on south
    this.wallsGraphics.fillRect(1250, 170, 120, 18);
    this.wallsGraphics.strokeRect(1250, 170, 120, 18);
    this.wallsGraphics.fillRect(1250, 170, 18, 120);
    this.wallsGraphics.strokeRect(1250, 170, 18, 120);
    this.wallsGraphics.fillRect(1352, 170, 18, 120);
    this.wallsGraphics.strokeRect(1352, 170, 18, 120);
    this.wallsGraphics.fillRect(1250, 272, 40, 18);
    this.wallsGraphics.strokeRect(1250, 272, 40, 18);
    this.wallsGraphics.fillRect(1330, 272, 40, 18);
    this.wallsGraphics.strokeRect(1330, 272, 40, 18);

    // Cave Labyrinth Walls
    this.wallsGraphics.lineStyle(2, 0xCC00FF, 0.75);
    this.wallsGraphics.fillRect(1120, 640, 28, 220);
    this.wallsGraphics.strokeRect(1120, 640, 28, 220);
    this.wallsGraphics.fillRect(1120, 640, 180, 28);
    this.wallsGraphics.strokeRect(1120, 640, 180, 28);
    this.wallsGraphics.fillRect(1380, 640, 140, 28);
    this.wallsGraphics.strokeRect(1380, 640, 140, 28);
    this.wallsGraphics.fillRect(1240, 740, 180, 28);
    this.wallsGraphics.strokeRect(1240, 740, 180, 28);
    this.wallsGraphics.fillRect(1400, 740, 28, 160);
    this.wallsGraphics.strokeRect(1400, 740, 28, 160);
    this.wallsGraphics.fillRect(1180, 840, 160, 28);
    this.wallsGraphics.strokeRect(1180, 840, 160, 28);

    // Ruins Pillars
    this.wallsGraphics.lineStyle(2, 0xFF9900, 0.75);
    this.wallsGraphics.fillRect(600, 120, 30, 160);
    this.wallsGraphics.strokeRect(600, 120, 30, 160);
    this.wallsGraphics.fillRect(700, 120, 180, 26);
    this.wallsGraphics.strokeRect(700, 120, 180, 26);
    this.wallsGraphics.fillRect(940, 120, 30, 160);
    this.wallsGraphics.strokeRect(940, 120, 30, 160);
    this.wallsGraphics.fillRect(680, 240, 30, 120);
    this.wallsGraphics.strokeRect(680, 240, 30, 120);
    this.wallsGraphics.fillRect(860, 240, 30, 120);
    this.wallsGraphics.strokeRect(860, 240, 30, 120);
    this.wallsGraphics.fillRect(740, 320, 90, 30);
    this.wallsGraphics.strokeRect(740, 320, 90, 30);

    // Forest Tree Stands
    this.wallsGraphics.lineStyle(2, 0x00FF66, 0.7);
    this.wallsGraphics.fillRect(140, 160, 90, 90);
    this.wallsGraphics.strokeRect(140, 160, 90, 90);
    this.wallsGraphics.fillRect(320, 220, 110, 70);
    this.wallsGraphics.strokeRect(320, 220, 110, 70);
    this.wallsGraphics.fillRect(120, 340, 80, 100);
    this.wallsGraphics.strokeRect(120, 340, 80, 100);
    this.wallsGraphics.fillRect(260, 380, 90, 60);
    this.wallsGraphics.strokeRect(260, 380, 90, 60);
    this.wallsGraphics.fillRect(100, 640, 110, 90);
    this.wallsGraphics.strokeRect(100, 640, 110, 90);
    this.wallsGraphics.fillRect(300, 660, 80, 110);
    this.wallsGraphics.strokeRect(300, 660, 80, 110);
    this.wallsGraphics.fillRect(180, 800, 130, 80);
    this.wallsGraphics.strokeRect(180, 800, 130, 80);
    this.wallsGraphics.fillRect(380, 780, 90, 90);
    this.wallsGraphics.strokeRect(380, 780, 90, 90);

    // 6. Top Left Controls Hint
    const exitBtn = this.add.graphics();
    exitBtn.fillStyle(0x141432, 0.85);
    exitBtn.fillRoundedRect(30, 30, 200, 34, 8);
    exitBtn.lineStyle(1.5, 0xFF0055, 0.8);
    exitBtn.strokeRoundedRect(30, 30, 200, 34, 8);
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

    // 7. Match Seed & Sound Badge (Bottom Right)
    this.soundStatusText = this.add.text(WORLD_WIDTH - 30, WORLD_HEIGHT - 44, sounds.muted ? '[ SOUND: MUTED (Press S) ]' : '[ SOUND: ON (Press S) ]', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: sounds.muted ? '#FF0055' : '#39FF14'
    }).setOrigin(1, 0.5);
    this.labelsContainer.add(this.soundStatusText);

    const seedText = this.add.text(WORLD_WIDTH - 30, WORLD_HEIGHT - 24, `SEED: #${currentGameState.seed || '000000'} | [1-8] Anomalies | [M] POIs | [R] Reset | [S] Sound`, {
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
    const timerText = this.add.text(WORLD_WIDTH / 2 - 85, 50, `TIME ${timeFormatted}`, {
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

  // Draw Live Interactables on Arena (Treasures, Chests, Portals, Keys, Glitch Items, Clues & Legendary Vault)
  drawActiveInteractables(entities) {
    this.interactablesGraphics.clear();
    if (!entities) return;

    for (const ent of entities) {
      if (ent.state !== 'active' && ent.state !== 'revealed') continue;

      if (ent.type === 'treasure') {
        this.interactablesGraphics.fillStyle(ent.colorNum || 0x00f0ff, 0.9);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 9);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 9);
        this.interactablesGraphics.fillStyle(0xFFFFFF, 0.9);
        this.interactablesGraphics.fillCircle(ent.x - 2, ent.y - 2, 2.5);
      } else if (ent.type === 'glitch') {
        const now = Date.now();
        const remFraction = ent.expiresAt ? Math.max(0, (ent.expiresAt - now) / ((ent.durationSec || 10) * 1000)) : 1.0;
        
        // Outer pulsing countdown arc
        this.interactablesGraphics.lineStyle(3, 0xFF00FF, 0.9);
        this.interactablesGraphics.beginPath();
        this.interactablesGraphics.arc(ent.x, ent.y, 22, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * remFraction), false);
        this.interactablesGraphics.strokePath();

        // Glowing center diamond / orb
        this.interactablesGraphics.fillStyle(0xFF00FF, 0.95);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 12);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 12);
        this.interactablesGraphics.fillStyle(0xFFFFFF, 0.9);
        this.interactablesGraphics.fillCircle(ent.x - 3, ent.y - 3, 3);
      } else if (ent.type === 'clue') {
        // Active Legendary Clue Beacon (Pulsing Cyan Scroll)
        this.interactablesGraphics.fillStyle(0x00F0FF, 0.95);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 14);
        this.interactablesGraphics.lineStyle(2.5, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 14);
        this.interactablesGraphics.fillStyle(0x050518, 1);
        this.interactablesGraphics.fillRect(ent.x - 6, ent.y - 6, 12, 12);
      } else if (ent.type === 'side_clue') {
        // Minor Side Clue Glyph
        this.interactablesGraphics.fillStyle(0x00FFCC, 0.9);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 11);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeCircle(ent.x, ent.y, 11);
      } else if (ent.type === 'legendary_vault') {
        // Glorious Golden Legendary Vault
        this.interactablesGraphics.fillStyle(0xFFE600, 1);
        this.interactablesGraphics.fillRoundedRect(ent.x - 22, ent.y - 22, 44, 44, 8);
        this.interactablesGraphics.lineStyle(3, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeRoundedRect(ent.x - 22, ent.y - 22, 44, 44, 8);
        
        // Inner crown star
        this.interactablesGraphics.fillStyle(0x050518, 1);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 10);
        this.interactablesGraphics.fillStyle(0xFFE600, 1);
        this.interactablesGraphics.fillCircle(ent.x, ent.y, 5);
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

  // Draw Top 5 Leaderboard on Right Side (Dedicated Right Sidebar Outside Map)
  drawHostLeaderboard(leaderboard = []) {
    this.leaderboardContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const startX = 1350;
    const startY = 30;
    const width = 210;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.9);
    bg.fillRoundedRect(startX, startY, width, 36 + leaderboard.length * 40, 10);
    bg.lineStyle(1.5, 0x00F0FF, 0.7);
    bg.strokeRoundedRect(startX, startY, width, 36 + leaderboard.length * 40, 10);
    this.leaderboardContainer.add(bg);

    const title = this.add.text(startX + width / 2, startY + 18, 'TOP 5 LEADERBOARD', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '13px',
      color: '#00F0FF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.leaderboardContainer.add(title);

    const rankColors = ['#FFE600', '#CCCCCC', '#CD7F32', '#FFFFFF', '#FFFFFF'];

    leaderboard.forEach((player, idx) => {
      const itemY = startY + 44 + idx * 38;
      const rankColor = rankColors[idx] || '#FFFFFF';

      const pip = this.add.graphics();
      const pColorNum = player.color ? player.color.num : (player.colorNum || 0x00f0ff);
      pip.fillStyle(pColorNum, 1);
      pip.fillCircle(startX + 14, itemY + 8, 6);
      this.leaderboardContainer.add(pip);

      const nameText = this.add.text(startX + 28, itemY + 8, `${idx + 1}. ${player.name}`, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: rankColor
      }).setOrigin(0, 0.5);

      const scoreText = this.add.text(startX + width - 10, itemY + 8, `${player.score}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#39FF14'
      }).setOrigin(1, 0.5);

      this.leaderboardContainer.add([nameText, scoreText]);

      // Apply rank color & aura to player entity in world arena
      const entity = this.playerMap.get(player.id);
      if (entity) {
        entity.rank = idx + 1;
        if (entity.labelText) {
          entity.labelText.setColor(rankColor);
        }
        if (entity.aura) {
          entity.aura.setVisible(idx < 3);
          const auraColors = [0xFFE600, 0xCCCCCC, 0xCD7F32];
          entity.auraColor = auraColors[idx] || 0xFFFFFF;
        }
      }
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
      const col = p.color ? p.color.num : (p.colorNum || 0x00f0ff);
      pip.fillStyle(col, 1);
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
    if (!this.lobbyContainer || currentGameState.state !== 'LOBBY') return;
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

    const leftBg = this.add.graphics();
    leftBg.fillStyle(0x0f0f26, 0.85);
    leftBg.fillRoundedRect(leftX - boxW / 2, leftY - boxH / 2, boxW, boxH, 16);
    leftBg.lineStyle(2, 0x00F0FF, 0.6);
    leftBg.strokeRoundedRect(leftX - boxW / 2, leftY - boxH / 2, boxW, boxH, 16);
    this.lobbyContainer.add(leftBg);

    const scanHeader = this.add.text(leftX, leftY - boxH / 2 + 36, 'SCAN TO JOIN', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '26px',
      color: '#00F0FF',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.lobbyContainer.add(scanHeader);

    // QR White Backing Frame
    const qrFrame = this.add.graphics();
    qrFrame.fillStyle(0xFFFFFF, 1);
    qrFrame.fillRoundedRect(leftX - 110, leftY - 70, 220, 220, 10);
    qrFrame.lineStyle(4, 0x00F0FF, 1);
    qrFrame.strokeRoundedRect(leftX - 110, leftY - 70, 220, 220, 10);
    this.lobbyContainer.add(qrFrame);

    if (this.textures.exists('qrcode')) {
      const qrSprite = this.add.image(leftX, leftY + 40, 'qrcode');
      qrSprite.setDisplaySize(200, 200);
      this.lobbyContainer.add(qrSprite);
    } else {
      const loadingQr = this.add.text(leftX, leftY + 40, 'GENERATING\nQR CODE...', {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#050515',
        align: 'center'
      }).setOrigin(0.5);
      this.lobbyContainer.add(loadingQr);

      // Retry render in 300ms if not ready yet
      this.time.delayedCall(300, () => {
        if (currentGameState.state === 'LOBBY' && this.textures.exists('qrcode')) {
          this.renderLobbyUI();
        }
      });
    }

    const orText = this.add.text(leftX, leftY + 165, 'OR VISIT IN BROWSER', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#8888AA',
      letterSpacing: 2
    }).setOrigin(0.5);

    const urlBg = this.add.graphics();
    urlBg.fillStyle(0x050512, 0.9);
    urlBg.fillRoundedRect(leftX - 180, leftY + 185, 360, 42, 8);
    urlBg.lineStyle(1.5, 0x39FF14, 0.8);
    urlBg.strokeRoundedRect(leftX - 180, leftY + 185, 360, 42, 8);

    const urlText = this.add.text(leftX, leftY + 206, playUrl, {
      fontFamily: 'monospace',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#39FF14'
    }).setOrigin(0.5);

    this.lobbyContainer.add([orText, urlBg, urlText]);

    const rightX = w * 0.72;
    const rightY = 515;

    const rightBg = this.add.graphics();
    rightBg.fillStyle(0x0f0f26, 0.85);
    rightBg.fillRoundedRect(rightX - boxW / 2, rightY - boxH / 2, boxW, boxH, 16);
    rightBg.lineStyle(2, 0x39FF14, 0.6);
    rightBg.strokeRoundedRect(rightX - boxW / 2, rightY - boxH / 2, boxW, boxH, 16);
    this.lobbyContainer.add(rightBg);

    const count = currentGameState.playerCount || 0;
    const rosterHeader = this.add.text(rightX, rightY - boxH / 2 + 36, `RACERS CONNECTED (${count}/20)`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '26px',
      color: '#39FF14',
      letterSpacing: 3
    }).setOrigin(0.5);
    this.lobbyContainer.add(rosterHeader);

    if (count === 0) {
      const waitingText = this.add.text(rightX, rightY, 'Waiting for racers to scan & join...', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        color: '#666688',
        letterSpacing: 1
      }).setOrigin(0.5);
      this.lobbyContainer.add(waitingText);
    } else {
      const players = currentGameState.players || [];
      const cols = 2;
      const startCardX = rightX - boxW / 2 + 25;
      const startCardY = rightY - boxH / 2 + 75;
      const cardW = 195;
      const cardH = 44;

      players.forEach((p, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cardX = startCardX + col * (cardW + 16);
        const cardY = startCardY + row * (cardH + 12);

        const card = this.add.graphics();
        card.fillStyle(0x181838, 0.9);
        card.fillRoundedRect(cardX, cardY, cardW, cardH, 8);
        const pColor = p.color ? p.color.num : (p.colorNum || 0x00f0ff);
        card.lineStyle(1.5, pColor, 0.8);
        card.strokeRoundedRect(cardX, cardY, cardW, cardH, 8);

        card.fillStyle(pColor, 1);
        card.fillCircle(cardX + 22, cardY + 22, 10);
        this.lobbyContainer.add(card);

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
    const pColorNum = p.color ? p.color.num : (p.colorNum || 0x00f0ff);

    // Glowing Top 3 pulsing aura
    const aura = this.add.graphics();
    aura.lineStyle(3, 0xFFE600, 0.9);
    aura.strokeCircle(0, 0, radius + 10);
    aura.setVisible(false);

    const glow = this.add.graphics();
    glow.fillStyle(pColorNum, 0.25);
    glow.fillCircle(0, 0, radius + 8);

    const ring = this.add.graphics();
    ring.lineStyle(3, pColorNum, 0.9);
    ring.strokeCircle(0, 0, radius + 14);
    ring.setVisible(false);

    const circle = this.add.graphics();
    circle.fillStyle(pColorNum, 1);
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

    container.add([aura, glow, ring, circle, core, keyIcon, nameTag]);
    container.setDepth(10);

    this.playerMap.set(p.id, {
      container,
      circle,
      glow,
      ring,
      aura,
      auraColor: 0xFFE600,
      rank: 99,
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
          entity.score = snap.score !== undefined ? snap.score : (snap.s || 0);
          entity.hasKey = Boolean(snap.hasKey !== undefined ? snap.hasKey : snap.k);
          if (entity.keyIcon) {
            entity.keyIcon.setVisible(entity.hasKey);
          }
        }
      }
    }

    const entities = snapshot.e || snapshot.ent || [];
    this.drawActiveInteractables(entities);

    if (snapshot.lb) {
      this.drawHostLeaderboard(snapshot.lb);
    }

    if (snapshot.clues) {
      this.drawKnownCluesPanel(snapshot.clues.knownClues, snapshot.clues.chainTitle, snapshot.clues);
    }

    // Phase 8 Anomalies, Fog & Crown
    if (snapshot.anomalies) {
      this.renderAnomalyOverlay(snapshot.anomalies);
      this.renderFogOfWar(snapshot.anomalies.fog);
      this.renderGoldenCrown(snapshot.anomalies.crown);
    } else {
      this.anomalyContainer.removeAll(true);
      this.fogGraphics.clear();
      this.crownContainer.removeAll(true);
    }
  }

  renderAnomalyOverlay(anomalyState) {
    this.anomalyContainer.removeAll(true);
    if (!anomalyState || !anomalyState.activeAnomalies || anomalyState.activeAnomalies.length === 0) return;

    anomalyState.activeAnomalies.forEach((a, idx) => {
      const bannerW = 420;
      const bannerH = 44;
      const bannerY = idx * 48;

      const bg = this.add.graphics();
      bg.fillStyle(0x0a0a22, 0.95);
      bg.fillRoundedRect(-bannerW / 2, bannerY, bannerW, bannerH, 8);
      const colorNum = Phaser.Display.Color.HexStringToColor(a.colorHex || '#00F0FF').color;
      bg.lineStyle(2, colorNum, 0.9);
      bg.strokeRoundedRect(-bannerW / 2, bannerY, bannerW, bannerH, 8);

      const title = this.add.text(0, bannerY + 13, `ANOMALY: ${a.name}`, {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '14px',
        color: a.colorHex || '#00F0FF',
        letterSpacing: 2
      }).setOrigin(0.5);

      const sub = this.add.text(0, bannerY + 28, a.subtitle, {
        fontFamily: 'sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#FFFFFF',
        letterSpacing: 1
      }).setOrigin(0.5);

      this.anomalyContainer.add([bg, title, sub]);
    });
  }

  renderFogOfWar(fogActive) {
    this.fogGraphics.clear();
    if (!fogActive || currentGameState.state !== 'RUNNING') return;

    this.fogGraphics.fillStyle(0x050512, 0.85);
    this.fogGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  renderGoldenCrown(crownState) {
    this.crownContainer.removeAll(true);
    if (!crownState || !crownState.active || currentGameState.state !== 'RUNNING') return;

    const crown = this.add.text(crownState.x, crownState.y - 28, '👑', {
      fontSize: '22px'
    }).setOrigin(0.5);

    const aura = this.add.graphics();
    aura.lineStyle(2, 0xFFE600, 0.9);
    aura.strokeCircle(crownState.x, crownState.y - 28, 16);

    this.crownContainer.add([aura, crown]);
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
    const lerpFactor = Math.min(1, (delta / 1000) * 25);
    const isSpeedSurge = latestSnapshot && latestSnapshot.anomalies && latestSnapshot.anomalies.activeAnomalies && latestSnapshot.anomalies.activeAnomalies.some(a => a.id === 'SPEED_SURGE');

    for (const entity of this.playerMap.values()) {
      if (isRunning) {
        const dx = entity.targetX - entity.currentX;
        const dy = entity.targetY - entity.currentY;
        const dist = Math.hypot(dx, dy);

        // Snap instantly if teleported or distance too large
        if (dist > 250) {
          entity.currentX = entity.targetX;
          entity.currentY = entity.targetY;
        } else {
          entity.currentX += dx * lerpFactor;
          entity.currentY += dy * lerpFactor;
        }

        entity.container.setPosition(entity.currentX, entity.currentY);

        // Particle trail during SPEED_SURGE
        if (isSpeedSurge && (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4)) {
          if (Math.random() < 0.3) {
            const trail = this.add.graphics();
            const pCol = entity.color ? entity.color.num : 0x00f0ff;
            trail.fillStyle(pCol, 0.65);
            trail.fillCircle(entity.currentX + (Math.random() - 0.5) * 8, entity.currentY + (Math.random() - 0.5) * 8, 4.5);
            this.fxContainer.add(trail);
            this.tweens.add({
              targets: trail,
              alpha: 0,
              scaleX: 0.2,
              scaleY: 0.2,
              duration: 350,
              onComplete: () => trail.destroy()
            });
          }
        }

        // Top 3 Pulsing Glow Aura
        if (entity.aura && entity.aura.visible) {
          const pulse = 1 + Math.sin(time / 160) * 0.16;
          entity.aura.setScale(pulse);
          entity.aura.clear();
          entity.aura.lineStyle(3, entity.auraColor || 0xFFE600, 0.75 + Math.sin(time / 160) * 0.25);
          entity.aura.strokeCircle(0, 0, 34);
        }

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

function launchGame() {
  if (document.getElementById('game-container')) {
    new Phaser.Game(config);
  } else {
    window.addEventListener('DOMContentLoaded', () => new Phaser.Game(config));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', launchGame);
} else {
  launchGame();
}
