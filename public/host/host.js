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

// Widescreen 2200x1000 Canvas: Left Sidebar (0-280), Center Arena (300-1900), Right Sidebar (1920-2200)
const WORLD_WIDTH = 2200;
const WORLD_HEIGHT = 1000;
const ARENA_OFFSET_X = 300;

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
  pendingRequests: [],
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
function drawStarPolygon(gfx, cx, cy, spikes, outerRadius, innerRadius, fillColor, strokeColor, strokeWidth = 2) {
  let rot = (Math.PI / 2) * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  if (fillColor !== null && fillColor !== undefined) {
    gfx.fillStyle(fillColor, 1);
  }
  if (strokeColor !== null && strokeColor !== undefined) {
    gfx.lineStyle(strokeWidth, strokeColor, 1);
  }

  gfx.beginPath();
  gfx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    gfx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    gfx.lineTo(x, y);
    rot += step;
  }
  gfx.lineTo(cx, cy - outerRadius);
  gfx.closePath();
  if (fillColor !== null && fillColor !== undefined) gfx.fillPath();
  if (strokeColor !== null && strokeColor !== undefined) gfx.strokePath();
}

function drawPolygon(gfx, cx, cy, sides, radius, fillColor, strokeColor, strokeWidth = 2, rotation = 0) {
  if (fillColor !== null && fillColor !== undefined) {
    gfx.fillStyle(fillColor, 1);
  }
  if (strokeColor !== null && strokeColor !== undefined) {
    gfx.lineStyle(strokeWidth, strokeColor, 1);
  }

  const angleStep = (Math.PI * 2) / sides;
  gfx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = i * angleStep + rotation;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) {
      gfx.moveTo(px, py);
    } else {
      gfx.lineTo(px, py);
    }
  }
  gfx.closePath();
  if (fillColor !== null && fillColor !== undefined) gfx.fillPath();
  if (strokeColor !== null && strokeColor !== undefined) gfx.strokePath();
}

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

  playHazardHit() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(80, t + 0.25);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
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

  playFinalCountdownBeep(count = 10) {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = count === 1 ? 'sine' : 'triangle';
      const baseFreq = 480 + (10 - count) * 60;
      const dur = count <= 3 ? 0.28 : 0.16;

      osc.frequency.setValueAtTime(baseFreq, t);
      if (count <= 3) {
        osc.frequency.linearRampToValueAtTime(baseFreq * 1.3, t + dur);
      }

      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (e) {}
  }

  playHighlightChime() {
    if (this.muted || !this.ctx) return;
    this.resume();
    try {
      const freqs = [587.33, 739.99, 880, 1174.66];
      freqs.forEach((freq, idx) => {
        const t = this.ctx.currentTime + idx * 0.06;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.28);
      });
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

// Procedural 16x16 Pixel Art Generator (scaled 2x with zero external assets)
function generatePixelCanvas(pixelGrid, palette, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = 16 * scale;
  canvas.height = 16 * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const char = pixelGrid[y] ? pixelGrid[y][x] : '.';
      if (char && char !== '.' && palette[char]) {
        ctx.fillStyle = palette[char];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  return canvas;
}

function initPixelArtTextures(scene) {
  // 10 Animal Avatars
  const animals = {
    fox: {
      grid: [
        '..OO........OO..',
        '.OXXO......OXXO.',
        '.OXXXO....OXXXO.',
        '.OXXXXOOOOXXXXO.',
        '..OXXXXXXXXXXO..',
        '.OXXXXXXXXXXXXO.',
        '.OXXXXXXXXXXXXO.',
        '.OXXWWXXXXWWXXO.',
        '.OXWBBWXXWBBWXO.',
        '.OXXWWXXXXWWXXO.',
        '..OXXXWWWWXXXO..',
        '...OXXWWWWXXO...',
        '....OXWKKWXO....',
        '.....OXXXXO.....',
        '......OXXO......',
        '.......OO.......'
      ],
      palette: { O: '#8B3A00', X: '#FF7A00', W: '#FFFFFF', B: '#00F0FF', K: '#111111' }
    },
    owl: {
      grid: [
        '...O........O...',
        '..OOO......OOO..',
        '.OXXXOOOOOOXXXO.',
        '.OXXXXXXXXXXXXO.',
        'OXXXXXXXXXXXXXXO',
        'OXXXWWXXXXWWXXXO',
        'OXXWYYWXXWYYWXXO',
        'OXXWYKWXXWYKWXXO',
        'OXXXWWXXXXWWXXXO',
        'OXXXXXXOOXXXXXXO',
        '.OXXXXOXXOXXXXO.',
        '.OXXXXOOOOXXXXO.',
        '..OXXXXXXXXXXO..',
        '..OXXYYYYYYXXO..',
        '...OXXXXXXXXO...',
        '....OOOOOOOO....'
      ],
      palette: { O: '#4A2A0C', X: '#8B5A2B', W: '#FFFFFF', Y: '#FFE600', K: '#111111' }
    },
    cat: {
      grid: [
        '.OO..........OO.',
        '.OPPO......OPPO.',
        '.OXXPO....OPXXO.',
        '.OXXXXOOOOXXXXO.',
        'OXXXXXXXXXXXXXXO',
        'OXXXXXXXXXXXXXXO',
        'OXXXGGXXXXGGXXXO',
        'OXXGKKGXXGKKGXXO',
        'OXXXGGXXXXGGXXXO',
        'OXXXXXXXXXXXXXXO',
        'OXXWXXPPPPXXWXXO',
        'OXXXWXXKKXXWXXXO',
        '.OXXXXXWWXXXXXO.',
        '..OXXXXXXXXXXO..',
        '...OXXXXXXXXO...',
        '....OOOOOOOO....'
      ],
      palette: { O: '#8B5000', X: '#FFB800', P: '#FF88AA', G: '#39FF14', K: '#111111', W: '#FFFFFF' }
    },
    frog: {
      grid: [
        '..OOOO....OOOO..',
        '.OWWWWO..OWWWWO.',
        '.OWKKWO..OWKKWO.',
        'OOWWWWOOOOWWWWOO',
        'OXXXXXXXXXXXXXXO',
        'OXXXXXXXXXXXXXXO',
        'OXXXXXXXXXXXXXXO',
        'OXXXXXXXXXXXXXXO',
        'OLLXXXXXXXXXXLLO',
        'OLLLLLLLLLLLLLLO',
        '.OLLLLLLLLLLLLO.',
        '.OXXXXXXXXXXXXO.',
        '..OLLLLLLLLLLO..',
        '...OXXXXXXXXO...',
        '....OXXXXXXO....',
        '.....OOOOOO.....'
      ],
      palette: { O: '#1E6B05', X: '#39FF14', L: '#8DFF66', W: '#FFFFFF', K: '#111111' }
    },
    bear: {
      grid: [
        '.OOOO......OOOO.',
        'OLLLLOO..OOLLLLO',
        'OLLLLLOOOOLLLLLO',
        'OLLXXXXXXXXXXLLO',
        '.OXXXXXXXXXXXXO.',
        'OXXXXXXXXXXXXXXO',
        'OXXKKXXXXXXKKXXO',
        'OXXKKXXXXXXKKXXO',
        'OXXXXXMMMMXXXXXO',
        'OXXXXMMMMMMXXXXO',
        'OXXXXMKKKKMXXXXO',
        'OXXXXMMKKMMXXXXO',
        '.OXXXXMMMMXXXXO.',
        '..OXXXXXXXXXXO..',
        '...OXXXXXXXXO...',
        '....OOOOOOOO....'
      ],
      palette: { O: '#3D1C02', X: '#6A3805', L: '#9C5B18', M: '#E5B887', K: '#111111' }
    },
    wolf: {
      grid: [
        '.OO..........OO.',
        '.OXXO......OXXO.',
        '.OLLXO....OXLXO.',
        '.OLLXXOOOOXXLLO.',
        '..OXXXXXXXXXXO..',
        '.OXXXXXXXXXXXXO.',
        'OXXXXXLLLLXXXXXO',
        'OXXXWWXXXXWWXXXO',
        'OXXWYYWXXWYYWXXO',
        'OXXXWWXXXXWWXXXO',
        'OXXXXXWWWWXXXXXO',
        '.OXXXWWKKWWXXXO.',
        '..OXXXWWWWXXXO..',
        '...OXXXXXXXXO...',
        '....OXXXXXXO....',
        '.....OOOOOO.....'
      ],
      palette: { O: '#354350', X: '#7A8C9E', L: '#A0B2C6', W: '#FFFFFF', Y: '#00F0FF', K: '#111111' }
    },
    bee: {
      grid: [
        '....O......O....',
        '...OK......KO...',
        '....OK....KO....',
        '..CCCCOOOOCCCC..',
        '.CCWCCYYYYCCWCC.',
        '.CCWCCYYYYCCWCC.',
        '.CCCCCKKKKCCCCC.',
        '.....CKKKKC.....',
        '.....CYYYYC.....',
        '.....CYYYYC.....',
        '.....CKKKKC.....',
        '.....CKKKKC.....',
        '......CYYC......',
        '......CYYC......',
        '.......CK.......',
        '........K.......'
      ],
      palette: { O: '#111111', K: '#111111', Y: '#FFE600', C: '#00F0FF', W: '#FFFFFF' }
    },
    crab: {
      grid: [
        '..OO........OO..',
        '.OXXO......OXXO.',
        'OXXXXO....OXXXXO',
        'OXX..O....O..XXO',
        '.O..OOOOOOOO..O.',
        '...OWWW..WWWO...',
        '...OWKK..KKWO...',
        '..OXXXXXXXXXXO..',
        '.OXXXXXXXXXXXXO.',
        'OXXXXXXXXXXXXXXO',
        'OXXXXXXXXXXXXXXO',
        '.OXXXXXXXXXXXXO.',
        'O.O.O.OOOO.O.O.O',
        'O.O.O......O.O.O',
        '.O.O........O.O.',
        '................'
      ],
      palette: { O: '#800020', X: '#FF0055', W: '#FFFFFF', K: '#111111' }
    },
    panda: {
      grid: [
        '.KKKK......KKKK.',
        'KKKKKKO..OKKKKKK',
        'KKKKKKKOOKKKKKKK',
        '.KKKKKWWWWKKKKK.',
        '..OWWWWWWWWWWO..',
        '.OWWWWWWWWWWWWO.',
        '.OWKKKWWWWKKKWO.',
        'OWKKKKKWWKKKKKWO',
        'OWKKKKKWWKKKKKWO',
        '.OWKKKWWWWKKKWO.',
        '.OWWWWWKKWWWWWO.',
        '..OWWWKKKKWWWO..',
        '...OWWKKKKWWO...',
        '....OWWWWWWO....',
        '.....OWWWWO.....',
        '......OOOO......'
      ],
      palette: { O: '#222233', K: '#111111', W: '#FFFFFF' }
    },
    penguin: {
      grid: [
        '......OOOO......',
        '.....OKKKKO.....',
        '....OKKKKKKO....',
        '...OKWKKKKWKO...',
        '...OKBKKKKBKO...',
        '...OKWKKKKWKO...',
        '....OKYYYYKO....',
        '....OKYYYYKO....',
        '...OKKWWWWKKO...',
        '..OKKKWWWWKKKO..',
        '.OKKKKWWWWKKKKO.',
        '.OKKKKWWWWKKKKO.',
        '..OKKKWWWWKKKO..',
        '...OKKKKKKKKO...',
        '....OYY..YYO....',
        '.....YY..YY.....'
      ],
      palette: { O: '#050510', K: '#1E2538', W: '#FFFFFF', B: '#00F0FF', Y: '#FFAA00' }
    }
  };

  for (const [id, data] of Object.entries(animals)) {
    const key = `animal_${id}`;
    if (!scene.textures.exists(key)) {
      const canvas = generatePixelCanvas(data.grid, data.palette, 2);
      scene.textures.addCanvas(key, canvas);
    }
  }

  // 5 Treasure Tier Textures
  const treasures = {
    common: {
      grid: [
        '......OOOO......',
        '....OOYYYYOO....',
        '...OYYYYYYYYO...',
        '..OYYWYYYYYYYO..',
        '.OYYWWYYGGYYYYO.',
        '.OYYWYYYGGYYYYO.',
        'OYYYYYYGGGGYYYYO',
        'OYYYYYGGGGYYYYYO',
        'OYYYYYYGGGGYYYYO',
        'OYYYYYYYGGYYYYYO',
        '.OYYYYYYGGYYYYO.',
        '.OYYYYYYYYYYYYO.',
        '..OYYYYYYYYYYO..',
        '...OYYYYYYYYO...',
        '....OOYYYYOO....',
        '......OOOO......'
      ],
      palette: { O: '#8B7500', Y: '#FFE600', W: '#FFFFFF', G: '#D4AF37' }
    },
    rare: {
      grid: [
        '......OOOO......',
        '....OOCCCCWW....',
        '...OCCCCCCWWCO..',
        '..OCCCCCCCCCCWCO',
        '.OCCCCCCCCCCCCCO',
        'OCCCCCCCCCCCCCCW',
        'OWWWWWWWWWWWWWWO',
        '.OWCCCCCCCCCCCCO',
        '..OWCCCCCCCCCO..',
        '...OWCCCCCCCO...',
        '....OWCCCCCO....',
        '.....OWCCCO.....',
        '......OWCO......',
        '.......OW.......',
        '........O.......',
        '................'
      ],
      palette: { O: '#005577', C: '#00F0FF', W: '#FFFFFF' }
    },
    epic: {
      grid: [
        '.......WW.......',
        '......OPPO......',
        '.....OPPPPO.....',
        '....OPPPPPPPO...',
        '..OOPPPPPPPPOO..',
        '.OPPPPPPPPPPPPO.',
        'WPPPPPWWWWPWWPPW',
        'OPPPPPWWWWPPPPPO',
        'OPPPPPWWWWPPPPPO',
        'WPPPPPWWWWWPPPWW',
        '.OPPPPPPPPPPPPO.',
        '..OOPPPPPPPPOO..',
        '....OPPPPPPPO...',
        '.....OPPPPO.....',
        '......OPPO......',
        '.......WW.......'
      ],
      palette: { O: '#880044', P: '#FF0055', W: '#FFFFFF' }
    },
    legendary: {
      grid: [
        '.WW...WWWW...WW.',
        '.GG...GGGG...GG.',
        'OGGO.OGGGGO.OGGO',
        'OGGO.OGGGGO.OGGO',
        '.OGGOOGGGGOOGGO.',
        '.OGGGGGGGGGGGGO.',
        '..OGGGGGGGGGGO..',
        '..OGGRRGGBBGGO..',
        '..OGGGGGGGGGGO..',
        '..OGGGGGGGGGGO..',
        '...OGGGGGGGGO...',
        '...OGGGGGGGGO...',
        '....OGGGGGGO....',
        '....OGGGGGGO....',
        '..OOGGGGGGGGOO..',
        '..OOOOOOOOOOOO..'
      ],
      palette: { O: '#664400', G: '#FFE600', W: '#FFFFFF', R: '#FF0055', B: '#00F0FF' }
    },
    glitch: {
      grid: [
        '........WW......',
        '.......OPPO.....',
        '......OPPPPO....',
        '.....OPPCCCO....',
        '....OPPCCCCO....',
        '...OPCCCCCO.....',
        '..OPCCCCCCPO....',
        '..OPPCCCCCCCC...',
        '....CCCCCCOPPO..',
        '....OCCCCOPPPO..',
        '.....OCCCCOPPO..',
        '......OCCOPPPO..',
        '.......OCOPPPO..',
        '........OOPPPO..',
        '.........OPPO...',
        '..........WW....'
      ],
      palette: { O: '#440044', P: '#FF00FF', C: '#00F0FF', W: '#FFFFFF' }
    }
  };

  for (const [tier, data] of Object.entries(treasures)) {
    const key = `treasure_${tier}`;
    if (!scene.textures.exists(key)) {
      const canvas = generatePixelCanvas(data.grid, data.palette, 2);
      scene.textures.addCanvas(key, canvas);
    }
  }
}

class HostScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HostScene' });
    this.playerMap = new Map();
    this.interactablesGraphics = null;
    this.interactableSpriteMap = new Map();
    this.leaderboardRowMap = new Map();
    this.borderFlashGraphics = null;
    this.sentinelsGraphics = null;
    this.hudContainer = null;
    this.effectsTrayContainer = null;
    this.countdownContainer = null;
    this.endedContainer = null;
    this.leaderboardContainer = null;
    this.whoToBeatContainer = null;
    this.cluesPanelContainer = null;
    this.huntChecklistContainer = null;
    this.eventFeedContainer = null;
    this.joinRequestContainer = null;
    this.celebrationContainer = null;
    this.debugContainer = null;
    this.poiDebugContainer = null;
    this.soundStatusText = null;
    this.hostEvents = [];
    this.pendingRequests = [];
    this.lastRenderedState = '';
    this.lastCluesCount = 0;
    this.focusedPlayerId = null;
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
    initPixelArtTextures(this);
    this.cameras.main.setBackgroundColor('#070714');
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.bgGraphics = this.add.graphics();
    this.mapGraphics = this.add.graphics();
    this.wallsGraphics = this.add.graphics();
    this.interactablesGraphics = this.add.graphics();
    this.sentinelsGraphics = this.add.graphics();
    this.labelsContainer = this.add.container(0, 0);
    this.fxContainer = this.add.container(0, 0);

    // Left Column: Top Checklist (0-220) & Live Commentary Feed (245-980)
    this.huntChecklistContainer = this.add.container(25, 25);
    this.eventFeedContainer = this.add.container(25, 245);

    // Center Top: Digital Clock, Active Effects Tray & Anomaly Banner
    this.hudContainer = this.add.container(1100, 20);
    this.effectsTrayContainer = this.add.container(1100, 78);
    this.anomalyContainer = this.add.container(1100, 135);
    this.joinRequestContainer = this.add.container(1100, 185);
    this.countdownContainer = this.add.container(0, 0);
    this.endedContainer = this.add.container(0, 0);

    // Right Column: Leaderboard (25-255), Who to Beat (275-435), Known Clues (450-625) & Controls (640-800)
    this.leaderboardContainer = this.add.container(1930, 25);
    this.whoToBeatContainer = this.add.container(1930, 275);
    this.cluesPanelContainer = this.add.container(1930, 445);
    this.controlsContainer = this.add.container(1930, 640);

    this.crownContainer = this.add.container(0, 0);
    this.fogGraphics = this.add.graphics();
    this.celebrationContainer = this.add.container(0, 0);
    this.poiDebugContainer = this.add.container(0, 0);
    this.lobbyContainer = this.add.container(0, 0);
    this.arenaContainer = this.add.container(0, 0);
    this.debugContainer = this.add.container(20, 20);

    // Set depths
    this.sentinelsGraphics.setDepth(25);
    this.fogGraphics.setDepth(48);
    this.crownContainer.setDepth(52);
    this.huntChecklistContainer.setDepth(60);
    this.eventFeedContainer.setDepth(60);
    this.leaderboardContainer.setDepth(60);
    this.whoToBeatContainer.setDepth(60);
    this.cluesPanelContainer.setDepth(60);
    this.controlsContainer.setDepth(60);
    this.hudContainer.setDepth(110);
    this.effectsTrayContainer.setDepth(115);
    this.anomalyContainer.setDepth(120);
    this.joinRequestContainer.setDepth(140);
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
    this.spaceKey.on('down', () => {
      if (this.pendingRequests.length > 0) {
        this.approveAllJoinRequests();
      }
      this.triggerStartMatch();
    });

    this.aKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.aKey.on('down', () => this.approveAllJoinRequests());

    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escKey.on('down', () => {
      if (this.pendingRequests.length > 0) {
        this.rejectNextJoinRequest();
      } else {
        this.triggerStopMatch();
      }
    });

    this.rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.rKey.on('down', () => this.triggerResetMatch());

    this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.sKey.on('down', () => {
      sounds.init();
      const isMuted = sounds.toggleMute();
      this.updateSoundStatusBadge(isMuted);
    });

    this.pKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.pKey.on('down', () => {
      this.cycleFocusedPlayer();
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
      if (state.pendingRequests) {
        this.pendingRequests = state.pendingRequests;
        this.renderJoinRequests(state.pendingRequests);
      }
      this.renderLobbyUI();
      this.updatePlayerRoster(state.players);

      if (state.state === 'RUNNING' || state.state === 'COUNTDOWN') {
        this.drawFullMap();
        this.renderPoiMarkers();
        this.renderRunningHUD();
        this.renderControlsPanel();
        if (state.clueState) {
          this.drawKnownCluesPanel(state.clueState.knownClues, state.clueState.chainTitle, state.clueState);
        }
      } else if (state.state === 'ENDED') {
        this.renderEndedScreen();
      }
    });

    // Socket Event: Pending join requests list update
    socket.on('pending_join_requests', (data) => {
      this.pendingRequests = data.requests || [];
      this.renderJoinRequests(this.pendingRequests);
      if (currentGameState.state === 'LOBBY') {
        this.renderLobbyUI();
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
        if (event.amount < 0) {
          sounds.playHazardHit();
        } else {
          const rarity = event.amount >= 50 ? 'epic' : (event.amount >= 20 ? 'rare' : 'common');
          sounds.playCollect(rarity);
        }
      }
    });

    // Socket Event: Host Event Feed (Missions, Glitch treasures, Keys, Vaults, Hazards)
    socket.on('host_event', (event) => {
      this.addHostEvent(event);
      if (event.type === 'mission_complete') {
        sounds.playMissionComplete();
      } else if (event.type === 'crown_stolen') {
        sounds.playCrownSteal();
      } else if (event.type === 'hazard_hit') {
        sounds.playHazardHit();
      }
    });

    // Socket Event: Near-Miss Toast (Racer narrowly missed claimed treasure)
    socket.on('near_miss_toast', (data) => {
      if (currentGameState.state === 'RUNNING') {
        this.showNearMissToast(data);
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

    // Socket Event: Final 10-Second Countdown Tick
    socket.on('final_countdown_tick', (data) => {
      sounds.playFinalCountdownBeep(data.count);
      this.showFinalCountdownOverlay(data.count);
    });

    // Socket Event: Match Ended
    socket.on('match_ended', (data) => {
      currentGameState.state = 'ENDED';
      this.renderEndedScreen(data);
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
  }

  updateSoundStatusBadge(isMuted) {
    if (this.soundStatusText) {
      this.soundStatusText.setText(isMuted ? '[ SOUND: MUTED (Press S) ]' : '[ SOUND: ON (Press S) ]');
      this.soundStatusText.setColor(isMuted ? '#FF0055' : '#39FF14');
    }
  }

  approveNextJoinRequest() {
    if (this.pendingRequests.length > 0) {
      const first = this.pendingRequests[0];
      socket.emit('approve_join', { requestId: first.requestId });
    }
  }

  rejectNextJoinRequest() {
    if (this.pendingRequests.length > 0) {
      const first = this.pendingRequests[0];
      socket.emit('reject_join', { requestId: first.requestId });
    }
  }

  approveAllJoinRequests() {
    socket.emit('approve_all_joins');
  }

  // Render Join Approval Prompt on Host Screen
  renderJoinRequests(requests = []) {
    this.joinRequestContainer.removeAll(true);
    if (!requests || requests.length === 0) return;

    const count = requests.length;
    const first = requests[0];
    const boxW = 560;
    const boxH = 68;

    const bg = this.add.graphics();
    bg.fillStyle(0x050518, 0.98);
    bg.fillRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, 12);
    bg.lineStyle(2.5, 0x39FF14, 1);
    bg.strokeRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, 12);
    this.joinRequestContainer.add(bg);

    const title = this.add.text(-boxW / 2 + 20, -12, `⚡ JOIN REQUEST (${count}): "${first.name}"`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '17px',
      color: '#39FF14',
      letterSpacing: 1.5
    }).setOrigin(0, 0.5);

    const sub = this.add.text(-boxW / 2 + 20, 14, first.isRejoin ? 'Rejoining racer' : 'New racer requesting admission', {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: '#AAAAFF'
    }).setOrigin(0, 0.5);

    // Approve Button
    const btnApprove = this.add.graphics();
    btnApprove.fillStyle(0x39FF14, 1);
    btnApprove.fillRoundedRect(boxW / 2 - 200, -22, 90, 44, 8);
    this.joinRequestContainer.add(btnApprove);

    const appText = this.add.text(boxW / 2 - 155, 0, 'ADMIT (A)', {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#050510'
    }).setOrigin(0.5);

    const appZone = this.add.zone(boxW / 2 - 155, 0, 90, 44).setOrigin(0.5).setInteractive({ useHandCursor: true });
    appZone.on('pointerdown', () => this.approveNextJoinRequest());

    // Admit All Button (if multiple)
    if (count > 1) {
      const btnAll = this.add.graphics();
      btnAll.fillStyle(0x00F0FF, 1);
      btnAll.fillRoundedRect(boxW / 2 - 100, -22, 90, 44, 8);
      this.joinRequestContainer.add(btnAll);

      const allText = this.add.text(boxW / 2 - 55, 0, `ALL (${count})`, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#050510'
      }).setOrigin(0.5);

      const allZone = this.add.zone(boxW / 2 - 55, 0, 90, 44).setOrigin(0.5).setInteractive({ useHandCursor: true });
      allZone.on('pointerdown', () => this.approveAllJoinRequests());
      this.joinRequestContainer.add([allText, allZone]);
    }

    this.joinRequestContainer.add([title, sub, appText, appZone]);
  }

  triggerScreenBorderFlash(colorHex = '#FFE600', durationMs = 1000) {
    if (!this.borderFlashGraphics) {
      this.borderFlashGraphics = this.add.graphics();
      this.borderFlashGraphics.setDepth(999);
    }
    const colorNum = Phaser.Display.Color.HexStringToColor(colorHex).color;
    this.borderFlashGraphics.clear();
    this.borderFlashGraphics.lineStyle(14, colorNum, 0.95);
    this.borderFlashGraphics.strokeRect(7, 7, WORLD_WIDTH - 14, WORLD_HEIGHT - 14);
    this.borderFlashGraphics.setAlpha(1);

    this.tweens.killTweensOf(this.borderFlashGraphics);
    this.tweens.add({
      targets: this.borderFlashGraphics,
      alpha: 0,
      duration: durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (this.borderFlashGraphics) this.borderFlashGraphics.clear();
      }
    });
  }

  addHostEvent(event) {
    // Determine geometric glyph badge
    let glyph = '[⚡ RACE]';
    let glyphColor = '#FFFFFF';
    const type = (event.type || '').toLowerCase();
    const text = (event.text || '').toLowerCase();

    if (type.includes('clue') || text.includes('clue')) {
      glyph = '[📜 CLUE]';
      glyphColor = '#00F0FF';
    } else if (type.includes('vault') || type.includes('key') || text.includes('vault') || text.includes('key')) {
      glyph = '[🗝️ VAULT]';
      glyphColor = '#FF8800';
    } else if (type.includes('glitch') || text.includes('glitch') || type.includes('anomaly') || text.includes('anomaly')) {
      glyph = '[⚡ ANOMALY]';
      glyphColor = '#FFE600';
    } else if (type.includes('crown') || text.includes('crown')) {
      glyph = '[👑 CROWN]';
      glyphColor = '#FFE600';
    } else if (type.includes('mission') || text.includes('mission')) {
      glyph = '[🎯 MISSION]';
      glyphColor = '#39FF14';
    } else if (type.includes('hazard') || text.includes('hazard') || text.includes('sentinel')) {
      glyph = '[💥 HAZARD]';
      glyphColor = '#FF0055';
    } else if (type.includes('contested') || type.includes('rivalry') || text.includes('contested') || text.includes('rivalry') || text.includes('so close')) {
      glyph = '[⚔️ BATTLE]';
      glyphColor = '#FF0055';
    } else if (type.includes('discover') || text.includes('explored') || text.includes('discovery')) {
      glyph = '[🧭 EXPLORE]';
      glyphColor = '#00B4D8';
    }

    let cleanText = (event.text || '').trim();
    // Strip leading raw emoji if text already has one
    cleanText = cleanText.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]+\s*/u, '');

    const enrichedEvent = {
      ...event,
      glyph,
      glyphColor,
      text: cleanText,
      createdAt: Date.now()
    };

    // Keep last 8 events with newest on top
    this.hostEvents.unshift(enrichedEvent);
    if (this.hostEvents.length > 8) {
      this.hostEvents.pop();
    }
    this.renderEventFeed();
  }

  // Left Column: 4-Step Legendary Hunt Checklist (Top-Left 25, 25)
  drawHuntChecklist(clueState) {
    this.huntChecklistContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const width = 250;
    const boxH = 205;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.94);
    bg.fillRoundedRect(0, 0, width, boxH, 10);
    bg.lineStyle(1.5, 0x00F0FF, 0.75);
    bg.strokeRoundedRect(0, 0, width, boxH, 10);
    this.huntChecklistContainer.add(bg);

    const title = this.add.text(12, 14, '👑 LEGENDARY HUNT', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '14px',
      color: '#FFE600',
      letterSpacing: 2
    });

    const sub = this.add.text(12, 32, '4-STEP RACE TO CITADEL VAULT', {
      fontFamily: 'sans-serif',
      fontSize: '9px',
      fontStyle: 'bold',
      color: '#8888AA',
      letterSpacing: 1
    });
    this.huntChecklistContainer.add([title, sub]);

    const activeStep = (clueState && clueState.activeStep) || 0;
    const knownClues = (clueState && clueState.knownClues) || [];
    const isVaultClaimed = clueState && (clueState.vaultState === 'claimed' || activeStep >= 5);

    const steps = [
      {
        num: 1,
        title: 'Clue #1 Discovered',
        isDone: knownClues.length >= 1,
        isActive: activeStep === 1 && knownClues.length === 0,
        finder: knownClues[0] ? knownClues[0].discoverer : ''
      },
      {
        num: 2,
        title: 'Clue #2 Discovered',
        isDone: knownClues.length >= 2,
        isActive: activeStep === 2 && knownClues.length === 1,
        finder: knownClues[1] ? knownClues[1].discoverer : ''
      },
      {
        num: 3,
        title: 'Clue #3 Discovered',
        isDone: knownClues.length >= 3,
        isActive: activeStep === 3 && knownClues.length === 2,
        finder: knownClues[2] ? knownClues[2].discoverer : ''
      },
      {
        num: 4,
        title: 'Legendary Claimed (+150)',
        isDone: isVaultClaimed,
        isActive: activeStep === 4 && !isVaultClaimed,
        finder: isVaultClaimed ? (clueState.claimedBy || 'CLAIMED') : ''
      }
    ];

    steps.forEach((step, idx) => {
      const stepY = 52 + idx * 36;
      const stepBox = this.add.graphics();

      let boxColor = 0x141430;
      let borderColor = 0x333355;
      let checkChar = '○';
      let checkColor = '#666688';
      let textColor = '#8888AA';

      if (step.isDone) {
        boxColor = 0x052518;
        borderColor = 0x39FF14;
        checkChar = '✓';
        checkColor = '#39FF14';
        textColor = '#FFFFFF';
      } else if (step.isActive) {
        boxColor = 0x181840;
        borderColor = 0x00F0FF;
        checkChar = '◆';
        checkColor = '#00F0FF';
        textColor = '#00F0FF';
      }

      stepBox.fillStyle(boxColor, 0.9);
      stepBox.fillRoundedRect(8, stepY, width - 16, 30, 6);
      stepBox.lineStyle(1.2, borderColor, 0.85);
      stepBox.strokeRoundedRect(8, stepY, width - 16, 30, 6);
      this.huntChecklistContainer.add(stepBox);

      const checkText = this.add.text(16, stepY + 15, `[ ${checkChar} ]`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: checkColor
      }).setOrigin(0, 0.5);

      let labelStr = step.title;
      if (step.isDone && step.finder) {
        labelStr = `${step.title.slice(0, 12)} (${step.finder})`;
      } else if (step.isActive) {
        labelStr = `${step.title} [ACTIVE]`;
      }

      const text = this.add.text(56, stepY + 15, labelStr, {
        fontFamily: 'sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: textColor
      }).setOrigin(0, 0.5);

      this.huntChecklistContainer.add([checkText, text]);
    });
  }

  // Left Column: Live Commentary Feed (Positioned at 25, 245)
  renderEventFeed() {
    this.eventFeedContainer.removeAll(true);
    if (this.hostEvents.length === 0 || currentGameState.state !== 'RUNNING') return;

    const width = 250;
    const count = this.hostEvents.length;
    const boxH = 40 + count * 48;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.92);
    bg.fillRoundedRect(0, 0, width, boxH, 10);
    bg.lineStyle(1.5, 0x00F0FF, 0.7);
    bg.strokeRoundedRect(0, 0, width, boxH, 10);
    this.eventFeedContainer.add(bg);

    const title = this.add.text(12, 14, '[ LIVE MATCH FEED ]', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '13px',
      color: '#00F0FF',
      letterSpacing: 1.5
    });
    this.eventFeedContainer.add(title);

    const now = Date.now();
    this.hostEvents.forEach((ev, idx) => {
      const lineY = 42 + idx * 48;
      const isRecent = (now - ev.createdAt) < 1000;

      if (isRecent) {
        const flash = this.add.graphics();
        flash.fillStyle(0x00F0FF, 0.28);
        flash.fillRoundedRect(6, lineY - 4, width - 12, 42, 6);
        this.eventFeedContainer.add(flash);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 900,
          ease: 'Cubic.easeOut',
          onComplete: () => flash.destroy()
        });
      }

      // Glyph Chip
      const glyphText = this.add.text(12, lineY, ev.glyph || '[⚡]', {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '10px',
        color: ev.glyphColor || '#00F0FF',
        letterSpacing: 0.5
      });

      // Event Details Line
      const text = this.add.text(12, lineY + 14, ev.text || '', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: ev.colorHex || '#FFFFFF',
        wordWrap: { width: width - 24 },
        lineSpacing: 1
      });
      this.eventFeedContainer.add([glyphText, text]);
    });
  }

  // Right Column: Who To Beat / Closest Rival Gap Panel (1930, 275)
  drawWhoToBeatPanel(leaderboard = []) {
    this.whoToBeatContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING' || !leaderboard || leaderboard.length === 0) return;

    const width = 240;
    const boxH = 155;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.92);
    bg.fillRoundedRect(0, 0, width, boxH, 10);
    bg.lineStyle(1.5, 0x9D00FF, 0.8);
    bg.strokeRoundedRect(0, 0, width, boxH, 10);
    this.whoToBeatContainer.add(bg);

    // If host has pinned a player with 'P' key
    if (this.focusedPlayerId) {
      const allPlayers = currentGameState.players || leaderboard;
      const focusedIndex = leaderboard.findIndex(p => p.id === this.focusedPlayerId);
      const player = leaderboard[focusedIndex] || allPlayers.find(p => p.id === this.focusedPlayerId);

      if (player) {
        const title = this.add.text(12, 14, '⚡ TARGET TRACKER [P]', {
          fontFamily: '"Impact", "Arial Black", sans-serif',
          fontSize: '13px',
          color: '#00F0FF',
          letterSpacing: 1.5
        });
        this.whoToBeatContainer.add(title);

        const currentRank = focusedIndex >= 0 ? focusedIndex + 1 : '—';
        const pInfo = this.add.text(12, 38, `FOCUS: ${player.name} (#${currentRank})`, {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        });
        const pScore = this.add.text(width - 12, 38, `${player.score || 0} pts`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#39FF14'
        }).setOrigin(1, 0);

        this.whoToBeatContainer.add([pInfo, pScore]);

        if (focusedIndex === 0) {
          // Rank 1 Leader
          const leadBadge = this.add.text(width / 2, 85, '👑 CURRENT MATCH LEADER!', {
            fontFamily: '"Impact", "Arial Black", sans-serif',
            fontSize: '14px',
            color: '#FFE600',
            letterSpacing: 1
          }).setOrigin(0.5);

          const leadSub = this.add.text(width / 2, 112, `Lead: +${leaderboard.length > 1 ? player.score - leaderboard[1].score : 0} pts over #2`, {
            fontFamily: 'sans-serif',
            fontSize: '11px',
            color: '#8888AA'
          }).setOrigin(0.5);
          this.whoToBeatContainer.add([leadBadge, leadSub]);
        } else if (focusedIndex > 0) {
          // Has someone to beat directly above
          const rival = leaderboard[focusedIndex - 1];
          const gap = rival.score - player.score;

          const toBeatCard = this.add.graphics();
          toBeatCard.fillStyle(0x181030, 0.9);
          toBeatCard.fillRoundedRect(8, 62, width - 16, 60, 6);
          toBeatCard.lineStyle(1, 0xFF0055, 0.6);
          toBeatCard.strokeRoundedRect(8, 62, width - 16, 60, 6);
          this.whoToBeatContainer.add(toBeatCard);

          const targetLabel = this.add.text(14, 70, `TARGET: #${focusedIndex} ${rival.name}`, {
            fontFamily: 'sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#FFE600'
          });
          const targetScore = this.add.text(width - 14, 70, `${rival.score} pts`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#FFFFFF'
          }).setOrigin(1, 0);

          const gapText = this.add.text(width / 2, 100, `🔥 NEED +${gap + 1} PTS TO PASS`, {
            fontFamily: '"Impact", "Arial Black", sans-serif',
            fontSize: '13px',
            color: '#FF0055',
            letterSpacing: 1
          }).setOrigin(0.5);
          this.whoToBeatContainer.add([targetLabel, targetScore, gapText]);
        }

        const footer = this.add.text(width / 2, 138, '[ Press P to Cycle Target ]', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#666688'
        }).setOrigin(0.5);
        this.whoToBeatContainer.add(footer);
        return;
      }
    }

    // Default Spectator Mode: Closest Podium Battles
    const title = this.add.text(12, 14, '⚡ WHO TO BEAT (CHASE)', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '13px',
      color: '#00F0FF',
      letterSpacing: 1.5
    });
    this.whoToBeatContainer.add(title);

    if (leaderboard.length >= 2) {
      const p1 = leaderboard[0];
      const p2 = leaderboard[1];
      const gap1 = p1.score - p2.score;

      const card1 = this.add.graphics();
      card1.fillStyle(0x141432, 0.85);
      card1.fillRoundedRect(8, 36, width - 16, 44, 6);
      card1.lineStyle(1, 0xFFE600, 0.5);
      card1.strokeRoundedRect(8, 36, width - 16, 44, 6);
      this.whoToBeatContainer.add(card1);

      const b1Title = this.add.text(14, 42, `👑 #1 RACE: ${p2.name} ➔ ${p1.name}`, {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#FFE600'
      });
      const b1Gap = this.add.text(14, 60, `GAP: ${gap1 === 0 ? 'TIED FOR 1ST!' : `Need +${gap1 + 1} pts to lead`}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#39FF14'
      });
      this.whoToBeatContainer.add([b1Title, b1Gap]);
    }

    if (leaderboard.length >= 4) {
      const p3 = leaderboard[2];
      const p4 = leaderboard[3];
      const gap2 = p3.score - p4.score;

      const card2 = this.add.graphics();
      card2.fillStyle(0x141432, 0.85);
      card2.fillRoundedRect(8, 86, width - 16, 44, 6);
      card2.lineStyle(1, 0xCD7F32, 0.5);
      card2.strokeRoundedRect(8, 86, width - 16, 44, 6);
      this.whoToBeatContainer.add(card2);

      const b2Title = this.add.text(14, 92, `🥉 PODIUM: ${p4.name} ➔ ${p3.name}`, {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#CD7F32'
      });
      const b2Gap = this.add.text(14, 110, `GAP: ${gap2 === 0 ? 'TIED FOR 3RD!' : `Need +${gap2 + 1} pts for podium`}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#00F0FF'
      });
      this.whoToBeatContainer.add([b2Title, b2Gap]);
    } else if (leaderboard.length === 1) {
      const loneText = this.add.text(width / 2, 85, 'Waiting for more racers...', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#666688'
      }).setOrigin(0.5);
      this.whoToBeatContainer.add(loneText);
    }

    const tip = this.add.text(width / 2, 140, '[ Press P to Focus Racer ]', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#555577'
    }).setOrigin(0.5);
    this.whoToBeatContainer.add(tip);
  }

  cycleFocusedPlayer() {
    const players = Array.from(this.playerMap.keys());
    if (players.length === 0) {
      this.focusedPlayerId = null;
      return;
    }
    if (!this.focusedPlayerId) {
      this.focusedPlayerId = players[0];
    } else {
      const idx = players.indexOf(this.focusedPlayerId);
      if (idx === -1 || idx === players.length - 1) {
        this.focusedPlayerId = null; // Return to general mode
      } else {
        this.focusedPlayerId = players[idx + 1];
      }
    }
    if (latestSnapshot && latestSnapshot.lb) {
      this.drawWhoToBeatPanel(latestSnapshot.lb);
    }
  }

  // Right Column: Public "Known Clues" Panel (3 Fixed Slots)
  drawKnownCluesPanel(knownClues = [], chainTitle = '', clueState = null) {
    this.cluesPanelContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const width = 240;
    const cluesList = knownClues || [];
    const totalSlots = 3;
    const boxH = 46 + totalSlots * 46;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.92);
    bg.fillRoundedRect(0, 0, width, boxH, 10);
    bg.lineStyle(1.5, 0xFFE600, 0.75);
    bg.strokeRoundedRect(0, 0, width, boxH, 10);
    this.cluesPanelContainer.add(bg);

    const header = this.add.text(12, 14, `KNOWN CLUES (${cluesList.length}/3)`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '13px',
      color: '#FFE600',
      letterSpacing: 1
    });
    this.cluesPanelContainer.add(header);

    for (let i = 0; i < totalSlots; i++) {
      const itemY = 40 + i * 44;
      const clue = cluesList[i];

      if (clue) {
        const slotContainer = this.add.container(0, 0);

        const slotBg = this.add.graphics();
        slotBg.fillStyle(0x00F0FF, 0.12);
        slotBg.fillRoundedRect(8, itemY, width - 16, 38, 6);
        slotBg.lineStyle(1, 0x00F0FF, 0.6);
        slotBg.strokeRoundedRect(8, itemY, width - 16, 38, 6);
        slotContainer.add(slotBg);

        const clueBadge = this.add.text(14, itemY + 4, `📜 #${clue.step || i + 1}: ${(clue.shortHint || clue.region || 'REVEALED').toUpperCase()}`, {
          fontFamily: 'sans-serif',
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#00F0FF'
        });

        const finder = this.add.text(14, itemY + 20, `Found by: ${clue.discoverer || 'Unknown'}`, {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          color: clue.colorHex || '#FFE600'
        });

        slotContainer.add([clueBadge, finder]);
        this.cluesPanelContainer.add(slotContainer);

        // Animate new discovery
        if (i === cluesList.length - 1 && cluesList.length > this.lastCluesCount) {
          slotContainer.setAlpha(0);
          slotContainer.setX(20);
          this.tweens.add({
            targets: slotContainer,
            alpha: 1,
            x: 0,
            duration: 400,
            ease: 'Cubic.easeOut'
          });
        }
      } else {
        // Locked Slot Placeholder
        const lockBg = this.add.graphics();
        lockBg.fillStyle(0x070718, 0.6);
        lockBg.fillRoundedRect(8, itemY, width - 16, 38, 6);
        lockBg.lineStyle(1, 0x333355, 0.6);
        lockBg.strokeRoundedRect(8, itemY, width - 16, 38, 6);

        const lockText = this.add.text(width / 2, itemY + 19, `[ 🔒 CLUE #${i + 1}: LOCKED ]`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#555577',
          letterSpacing: 1
        }).setOrigin(0.5);

        this.cluesPanelContainer.add([lockBg, lockText]);
      }
    }

    this.lastCluesCount = cluesList.length;
  }

  // Right Column: Controls & Actions Panel
  renderControlsPanel() {
    this.controlsContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const width = 240;
    const boxH = 150;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a1e, 0.92);
    bg.fillRoundedRect(0, 0, width, boxH, 10);
    bg.lineStyle(1.5, 0xFF0055, 0.7);
    bg.strokeRoundedRect(0, 0, width, boxH, 10);
    this.controlsContainer.add(bg);

    const title = this.add.text(12, 12, 'MATCH CONTROLS', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '12px',
      color: '#FF0055',
      letterSpacing: 1.5
    });

    const shortcuts = [
      '[ A ] Approve Racers',
      '[ P ] Target Racer Focus',
      '[ S ] Toggle Sound FX',
      '[ R ] Reset Match to Lobby',
      '[ ESC ] Return to Lobby'
    ];

    shortcuts.forEach((sc, idx) => {
      const text = this.add.text(12, 32 + idx * 22, sc, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#FFFFFF'
      });
      this.controlsContainer.add(text);
    });

    this.controlsContainer.add(title);
  }

  // Large 6-Second Public Clue Discovery Banner
  showPublicClueBanner(data) {
    const banner = this.add.container(1100, -140);

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
    this.triggerScreenBorderFlash('#FFE600', 1200);
    const banner = this.add.container(1100, -140);

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

  // Grand Celebration on Legendary Treasure Claim (+150 pts)
  showLegendaryFoundCelebration(data) {
    this.triggerScreenBorderFlash('#FFE600', 1500);
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

  // Floating Animated Near-Miss Toast ("⚡ SO CLOSE, <NAME>!")
  showNearMissToast(data) {
    const ox = ARENA_OFFSET_X;
    const tx = (data.x || 800) + ox;
    const ty = (data.y || 530) - 34;

    const toast = this.add.container(tx, ty);
    const textStr = `⚡ SO CLOSE, ${(data.runnerUpName || 'RACER').toUpperCase()}! ⚡`;
    const toastW = Math.max(180, textStr.length * 9.5);

    const bg = this.add.graphics();
    bg.fillStyle(0x1a0528, 0.95);
    bg.fillRoundedRect(-toastW / 2, -15, toastW, 30, 8);
    bg.lineStyle(2, 0xFFE600, 1);
    bg.strokeRoundedRect(-toastW / 2, -15, toastW, 30, 8);

    const txt = this.add.text(0, 0, textStr, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '13px',
      color: '#FFE600',
      letterSpacing: 1
    }).setOrigin(0.5);

    toast.add([bg, txt]);
    toast.setDepth(180);
    toast.setScale(0.7);
    toast.setAlpha(0);

    this.tweens.add({
      targets: toast,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      y: ty - 14,
      duration: 250,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(data.durationMs || 2000, () => {
          this.tweens.add({
            targets: toast,
            alpha: 0,
            y: ty - 34,
            duration: 300,
            ease: 'Cubic.easeIn',
            onComplete: () => toast.destroy()
          });
        });
      }
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
      this.renderControlsPanel();
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
      this.effectsTrayContainer.removeAll(true);
      this.huntChecklistContainer.removeAll(true);
      this.whoToBeatContainer.removeAll(true);
      this.eventFeedContainer.removeAll(true);
      this.cluesPanelContainer.removeAll(true);
      this.controlsContainer.removeAll(true);
      this.celebrationContainer.removeAll(true);
      this.hostEvents = [];
      this.clearAllPlayerEntities();
      this.mapGraphics.clear();
      this.wallsGraphics.clear();
      this.interactablesGraphics.clear();
      this.sentinelsGraphics.clear();
      this.labelsContainer.removeAll(true);
      this.drawBackgroundGrid();
      this.renderLobbyUI();
    }
  }

  drawBackgroundGrid() {
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x070714, 1);
    this.bgGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Subtle neon grid lines across entire widescreen canvas
    this.bgGraphics.lineStyle(1, 0x141432, 0.4);
    const gridSize = 40;
    for (let x = 0; x < WORLD_WIDTH; x += gridSize) {
      this.bgGraphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 0; y < WORLD_HEIGHT; y += gridSize) {
      this.bgGraphics.lineBetween(0, y, WORLD_WIDTH, y);
    }
  }

  // Draw Center Arena Map with 300px horizontal offset
  drawFullMap() {
    this.mapGraphics.clear();
    this.wallsGraphics.clear();
    this.labelsContainer.removeAll(true);

    const ox = ARENA_OFFSET_X;

    // 1. Draw 4 Themed Neon Regions
    // Forest (Large West)
    this.mapGraphics.fillStyle(0x002211, 0.6);
    this.mapGraphics.fillRoundedRect(ox + 40, 40, 480, 920, 16);
    this.mapGraphics.lineStyle(2, 0x00FF66, 0.5);
    this.mapGraphics.strokeRoundedRect(ox + 40, 40, 480, 920, 16);

    const forestLabel = this.add.text(ox + 280, 75, 'NEON FOREST', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#00FF66',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(forestLabel);

    // Ruins (Center-North)
    this.mapGraphics.fillStyle(0x221100, 0.6);
    this.mapGraphics.fillRoundedRect(ox + 560, 40, 480, 400, 16);
    this.mapGraphics.lineStyle(2, 0xFF9900, 0.5);
    this.mapGraphics.strokeRoundedRect(ox + 560, 40, 480, 400, 16);

    const ruinsLabel = this.add.text(ox + 800, 95, 'ANCIENT RUINS', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#FF9900',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(ruinsLabel);

    // Castle (North-East, Walled)
    this.mapGraphics.fillStyle(0x051133, 0.6);
    this.mapGraphics.fillRoundedRect(ox + 1080, 40, 480, 420, 16);
    this.mapGraphics.lineStyle(2, 0x3377FF, 0.5);
    this.mapGraphics.strokeRoundedRect(ox + 1080, 40, 480, 420, 16);

    const castleLabel = this.add.text(ox + 1300, 105, 'CITADEL CASTLE', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#3377FF',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(castleLabel);

    // Cave (South-East, Narrow/Risky)
    this.mapGraphics.fillStyle(0x220022, 0.6);
    this.mapGraphics.fillRoundedRect(ox + 1060, 580, 500, 380, 16);
    this.mapGraphics.lineStyle(2, 0xCC00FF, 0.5);
    this.mapGraphics.strokeRoundedRect(ox + 1060, 580, 500, 380, 16);

    const caveLabel = this.add.text(ox + 1310, 925, 'OBSIDIAN CAVE', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '22px',
      color: '#CC00FF',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.labelsContainer.add(caveLabel);

    // 2. Cyber River (Winding band across middle)
    this.mapGraphics.fillStyle(0x002233, 0.85);
    this.mapGraphics.fillRect(ox + 40, 470, 1520, 120);
    this.mapGraphics.lineStyle(2, 0x00CCFF, 0.6);
    this.mapGraphics.lineBetween(ox + 40, 470, ox + 1560, 470);
    this.mapGraphics.lineBetween(ox + 40, 590, ox + 1560, 590);

    const riverLabel = this.add.text(ox + 210, 530, 'CYBER RIVER [SLOWS MOVEMENT]', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#00CCFF',
      letterSpacing: 2
    }).setOrigin(0.5);
    this.labelsContainer.add(riverLabel);

    // 3. Bridges (Safe shortcuts across river)
    const bridges = [
      { x: ox + 380, name: 'WEST BRIDGE' },
      { x: ox + 740, name: 'PLAZA BRIDGE' },
      { x: ox + 1220, name: 'EAST BRIDGE' }
    ];

    bridges.forEach(b => {
      this.mapGraphics.fillStyle(0x141432, 1);
      this.mapGraphics.fillRoundedRect(b.x, 460, b.x === ox + 740 ? 120 : 80, 140, 6);
      this.mapGraphics.lineStyle(2, 0x00F0FF, 0.9);
      this.mapGraphics.strokeRoundedRect(b.x, 460, b.x === ox + 740 ? 120 : 80, 140, 6);
    });

    // 4. Start Plaza (Central Hub)
    this.mapGraphics.fillStyle(0x0c0c24, 0.9);
    this.mapGraphics.fillCircle(ox + 800, 530, 85);
    this.mapGraphics.lineStyle(3, 0x00F0FF, 0.8);
    this.mapGraphics.strokeCircle(ox + 800, 530, 85);

    const plazaLabel = this.add.text(ox + 800, 530, 'START PLAZA', {
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

    // Outer Map Boundary Box
    this.wallsGraphics.strokeRect(ox + 20, 20, 1560, 960);

    // Castle Fortress Walls
    this.wallsGraphics.fillStyle(0x101030, 1);
    this.wallsGraphics.lineStyle(2, 0x3377FF, 0.85);

    // North wall
    this.wallsGraphics.fillRect(ox + 1120, 80, 400, 24);
    this.wallsGraphics.strokeRect(ox + 1120, 80, 400, 24);
    // East wall
    this.wallsGraphics.fillRect(ox + 1496, 80, 24, 340);
    this.wallsGraphics.strokeRect(ox + 1496, 80, 24, 340);
    // South wall segments
    this.wallsGraphics.fillRect(ox + 1120, 400, 160, 24);
    this.wallsGraphics.strokeRect(ox + 1120, 400, 160, 24);
    this.wallsGraphics.fillRect(ox + 1360, 400, 160, 24);
    this.wallsGraphics.strokeRect(ox + 1360, 400, 160, 24);
    // West wall segments
    this.wallsGraphics.fillRect(ox + 1120, 80, 24, 120);
    this.wallsGraphics.strokeRect(ox + 1120, 80, 24, 120);
    this.wallsGraphics.fillRect(ox + 1120, 280, 24, 144);
    this.wallsGraphics.strokeRect(ox + 1120, 280, 24, 144);
    // Keep chamber walls
    this.wallsGraphics.fillRect(ox + 1250, 170, 120, 18);
    this.wallsGraphics.strokeRect(ox + 1250, 170, 120, 18);
    this.wallsGraphics.fillRect(ox + 1250, 170, 18, 120);
    this.wallsGraphics.strokeRect(ox + 1250, 170, 18, 120);
    this.wallsGraphics.fillRect(ox + 1352, 170, 18, 120);
    this.wallsGraphics.strokeRect(ox + 1352, 170, 18, 120);
    this.wallsGraphics.fillRect(ox + 1250, 272, 40, 18);
    this.wallsGraphics.strokeRect(ox + 1250, 272, 40, 18);
    this.wallsGraphics.fillRect(ox + 1330, 272, 40, 18);
    this.wallsGraphics.strokeRect(ox + 1330, 272, 40, 18);

    // Cave Labyrinth Walls
    this.wallsGraphics.lineStyle(2, 0xCC00FF, 0.75);
    this.wallsGraphics.fillRect(ox + 1120, 640, 28, 220);
    this.wallsGraphics.strokeRect(ox + 1120, 640, 28, 220);
    this.wallsGraphics.fillRect(ox + 1120, 640, 180, 28);
    this.wallsGraphics.strokeRect(ox + 1120, 640, 180, 28);
    this.wallsGraphics.fillRect(ox + 1380, 640, 140, 28);
    this.wallsGraphics.strokeRect(ox + 1380, 640, 140, 28);
    this.wallsGraphics.fillRect(ox + 1240, 740, 180, 28);
    this.wallsGraphics.strokeRect(ox + 1240, 740, 180, 28);
    this.wallsGraphics.fillRect(ox + 1400, 740, 28, 160);
    this.wallsGraphics.strokeRect(ox + 1400, 740, 28, 160);
    this.wallsGraphics.fillRect(ox + 1180, 840, 160, 28);
    this.wallsGraphics.strokeRect(ox + 1180, 840, 160, 28);

    // Ruins Pillars
    this.wallsGraphics.lineStyle(2, 0xFF9900, 0.75);
    this.wallsGraphics.fillRect(ox + 600, 120, 30, 160);
    this.wallsGraphics.strokeRect(ox + 600, 120, 30, 160);
    this.wallsGraphics.fillRect(ox + 700, 120, 180, 26);
    this.wallsGraphics.strokeRect(ox + 700, 120, 180, 26);
    this.wallsGraphics.fillRect(ox + 940, 120, 30, 160);
    this.wallsGraphics.strokeRect(ox + 940, 120, 30, 160);
    this.wallsGraphics.fillRect(ox + 680, 240, 30, 120);
    this.wallsGraphics.strokeRect(ox + 680, 240, 30, 120);
    this.wallsGraphics.fillRect(ox + 860, 240, 30, 120);
    this.wallsGraphics.strokeRect(ox + 860, 240, 30, 120);
    this.wallsGraphics.fillRect(ox + 740, 320, 90, 30);
    this.wallsGraphics.strokeRect(ox + 740, 320, 90, 30);

    // Forest Tree Stands
    this.wallsGraphics.lineStyle(2, 0x00FF66, 0.7);
    this.wallsGraphics.fillRect(ox + 140, 160, 90, 90);
    this.wallsGraphics.strokeRect(ox + 140, 160, 90, 90);
    this.wallsGraphics.fillRect(ox + 320, 220, 110, 70);
    this.wallsGraphics.strokeRect(ox + 320, 220, 110, 70);
    this.wallsGraphics.fillRect(ox + 120, 340, 80, 100);
    this.wallsGraphics.strokeRect(ox + 120, 340, 80, 100);
    this.wallsGraphics.fillRect(ox + 260, 380, 90, 60);
    this.wallsGraphics.strokeRect(ox + 260, 380, 90, 60);
    this.wallsGraphics.fillRect(ox + 100, 640, 110, 90);
    this.wallsGraphics.strokeRect(ox + 100, 640, 110, 90);
    this.wallsGraphics.fillRect(ox + 300, 660, 80, 110);
    this.wallsGraphics.strokeRect(ox + 300, 660, 80, 110);
    this.wallsGraphics.fillRect(ox + 180, 800, 130, 80);
    this.wallsGraphics.strokeRect(ox + 180, 800, 130, 80);
    this.wallsGraphics.fillRect(ox + 380, 780, 90, 90);
    this.wallsGraphics.strokeRect(ox + 380, 780, 90, 90);

    // Bottom Left Status & Sound Badge
    this.soundStatusText = this.add.text(25, WORLD_HEIGHT - 38, sounds.muted ? '[ SOUND: MUTED (Press S) ]' : '[ SOUND: ON (Press S) ]', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: sounds.muted ? '#FF0055' : '#39FF14'
    });
    this.labelsContainer.add(this.soundStatusText);

    const seedText = this.add.text(25, WORLD_HEIGHT - 20, `MATCH SEED: #${currentGameState.seed || '000000'}`, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#00F0FF'
    });
    this.labelsContainer.add(seedText);
  }

  // Render Center Top Running HUD (Digital Timer & Phase Badge)
  renderRunningHUD() {
    this.hudContainer.removeAll(true);
    if (currentGameState.state !== 'RUNNING') return;

    const timeRemaining = currentGameState.timeRemaining || 0;
    const timeFormatted = formatTime(timeRemaining);
    const phase = currentGameState.phase || { name: 'PHASE 1: DISCOVERY', colorHex: '#00F0FF' };
    const isUrgent = timeRemaining <= 60;
    const isWarning = timeRemaining <= 30;

    const hudBox = this.add.graphics();
    hudBox.fillStyle(0x0a0a1e, 0.95);
    hudBox.fillRoundedRect(-200, 0, 400, 52, 12);
    hudBox.lineStyle(2, isUrgent ? 0xFF0055 : Phaser.Display.Color.HexStringToColor(phase.colorHex || '#00F0FF').color, 0.85);
    hudBox.strokeRoundedRect(-200, 0, 400, 52, 12);
    this.hudContainer.add(hudBox);

    let timerColor = isUrgent ? '#FF0055' : '#FFFFFF';
    if (isWarning) {
      const pulseRatio = (Math.sin(this.time.now / 150) + 1) / 2;
      timerColor = pulseRatio > 0.5 ? '#FF0055' : '#FFAA00';
    }

    const timerText = this.add.text(-90, 26, `TIME ${timeFormatted}`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '28px',
      color: timerColor,
      letterSpacing: 2
    }).setOrigin(0.5);

    if (isWarning) {
      timerText.setScale(1 + Math.sin(this.time.now / 150) * 0.08);
    }

    const phaseBadge = this.add.text(80, 26, phase.name, {
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
    const bannerContainer = this.add.container(1100, -100);

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

  // Draw Live Interactables on Arena (Shifted by ARENA_OFFSET_X = 300)
  drawActiveInteractables(entities) {
    this.interactablesGraphics.clear();
    if (!entities) return;

    if (!this.contestedTagMap) {
      this.contestedTagMap = new Map();
    }

    const ox = ARENA_OFFSET_X;
    const activeIds = new Set();
    const activeContestedIds = new Set();

    for (const ent of entities) {
      if (ent.state !== 'active' && ent.state !== 'revealed') continue;
      activeIds.add(ent.id);

      const ex = ent.x + ox;
      const ey = ent.y;

      // Render Contested Indicator if 2+ racers are near high-value loot
      if (ent.contested && ent.contested.names && ent.contested.names.length >= 2) {
        activeContestedIds.add(ent.id);
        const t = this.time ? this.time.now : Date.now();
        const pulse = 1 + Math.sin(t / 110) * 0.22;

        this.interactablesGraphics.lineStyle(3.5, 0xFF0055, 0.95);
        this.interactablesGraphics.strokeCircle(ex, ey, 24 * pulse);
        this.interactablesGraphics.lineStyle(2, 0xFFE600, 0.9);
        this.interactablesGraphics.strokeCircle(ex, ey, 31 * pulse);

        const racersText = `❗ ${ent.contested.names.slice(0, 2).join(' vs ')}`;
        let tag = this.contestedTagMap.get(ent.id);
        if (!tag) {
          tag = this.add.text(ex, ey - 32, racersText, {
            fontFamily: 'sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#FFE600',
            backgroundColor: 'rgba(25, 5, 20, 0.94)',
            padding: { x: 7, y: 3 }
          }).setOrigin(0.5).setDepth(45);
          this.contestedTagMap.set(ent.id, tag);
        } else {
          tag.setPosition(ex, ey - 32);
          tag.setText(racersText);
          tag.setVisible(true);
        }
      }

      if (ent.type === 'treasure') {
        const tier = ent.tier || 'common';
        if (tier === 'epic') {
          // Epic: Star ★ with magenta glow
          this.interactablesGraphics.fillStyle(0xFF0055, 0.3);
          this.interactablesGraphics.fillCircle(ex, ey, 20);
          drawStarPolygon(this.interactablesGraphics, ex, ey, 5, 15, 7, 0xFF0055, 0xFFFFFF, 2);
        } else if (tier === 'rare') {
          // Rare: Diamond ◆ with gold glow
          this.interactablesGraphics.fillStyle(0xFFE600, 0.3);
          this.interactablesGraphics.fillCircle(ex, ey, 16);
          drawPolygon(this.interactablesGraphics, ex, ey, 4, 13, 0xFFE600, 0xFFFFFF, 2, 0);
        } else {
          // Common: Circle ● with cyan glow
          this.interactablesGraphics.fillStyle(0x00F0FF, 0.3);
          this.interactablesGraphics.fillCircle(ex, ey, 14);
          this.interactablesGraphics.fillStyle(0x00F0FF, 0.95);
          this.interactablesGraphics.fillCircle(ex, ey, 9);
          this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
          this.interactablesGraphics.strokeCircle(ex, ey, 9);
        }
      } else if (ent.type === 'glitch') {
        // Glitch: Octagon ✦ with countdown arc & magenta glow
        const now = Date.now();
        const remFraction = ent.expiresAt ? Math.max(0, (ent.expiresAt - now) / ((ent.durationSec || 10) * 1000)) : 1.0;
        
        this.interactablesGraphics.lineStyle(3, 0xFF00FF, 0.9);
        this.interactablesGraphics.beginPath();
        this.interactablesGraphics.arc(ex, ey, 22, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * remFraction), false);
        this.interactablesGraphics.strokePath();

        this.interactablesGraphics.fillStyle(0xFF00FF, 0.35);
        this.interactablesGraphics.fillCircle(ex, ey, 16);
        drawPolygon(this.interactablesGraphics, ex, ey, 8, 13, 0xFF00FF, 0xFFFFFF, 2, Math.PI / 8);
      } else if (ent.type === 'legendary_vault') {
        // Legendary Vault: Hexagon ⬡ in gold aura
        this.interactablesGraphics.fillStyle(0xFFE600, 0.25);
        this.interactablesGraphics.fillCircle(ex, ey, 28);
        drawPolygon(this.interactablesGraphics, ex, ey, 6, 22, 0x141438, 0xFFE600, 3.5, Math.PI / 6);
        drawStarPolygon(this.interactablesGraphics, ex, ey, 5, 11, 5, 0xFFE600, 0xFFFFFF, 1.5);
      } else if (ent.type === 'clue') {
        this.interactablesGraphics.fillStyle(0x00F0FF, 0.95);
        this.interactablesGraphics.fillCircle(ex, ey, 14);
        this.interactablesGraphics.lineStyle(2.5, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeCircle(ex, ey, 14);
        this.interactablesGraphics.fillStyle(0x050518, 1);
        this.interactablesGraphics.fillRect(ex - 6, ey - 6, 12, 12);
      } else if (ent.type === 'side_clue') {
        this.interactablesGraphics.fillStyle(0x00FFCC, 0.9);
        this.interactablesGraphics.fillCircle(ex, ey, 11);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeCircle(ex, ey, 11);
      } else if (ent.type === 'chest') {
        // Chamfered box ■
        this.interactablesGraphics.fillStyle(0xFFAA00, 0.95);
        this.interactablesGraphics.fillRoundedRect(ex - 14, ey - 12, 28, 24, 4);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeRoundedRect(ex - 14, ey - 12, 28, 24, 4);
        this.interactablesGraphics.fillStyle(0x050518, 1);
        this.interactablesGraphics.fillRect(ex - 3, ey - 2, 6, 6);
      } else if (ent.type === 'vault') {
        this.interactablesGraphics.fillStyle(0xFF8800, 0.9);
        this.interactablesGraphics.fillRoundedRect(ex - 18, ey - 18, 36, 36, 6);
        this.interactablesGraphics.lineStyle(2.5, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeRoundedRect(ex - 18, ey - 18, 36, 36, 6);
        this.interactablesGraphics.fillStyle(0x050510, 1);
        this.interactablesGraphics.fillCircle(ex, ey, 6);
      } else if (ent.type === 'key') {
        this.interactablesGraphics.fillStyle(0xFFDD00, 1);
        this.interactablesGraphics.fillCircle(ex - 4, ey, 7);
        this.interactablesGraphics.fillRect(ex - 4, ey - 2, 14, 4);
        this.interactablesGraphics.fillRect(ex + 6, ey + 2, 4, 5);
        this.interactablesGraphics.lineStyle(1.5, 0xFFFFFF, 1);
        this.interactablesGraphics.strokeCircle(ex - 4, ey, 7);
      } else if (ent.type === 'portal') {
        this.interactablesGraphics.lineStyle(3, 0x00F0FF, 0.85);
        this.interactablesGraphics.strokeCircle(ex, ey, 16);
        this.interactablesGraphics.lineStyle(1.5, 0xFFFFFF, 0.7);
        this.interactablesGraphics.strokeCircle(ex, ey, 10);
        this.interactablesGraphics.fillStyle(0x00F0FF, 0.25);
        this.interactablesGraphics.fillCircle(ex, ey, 16);
      } else if (ent.type === 'merchant') {
        this.interactablesGraphics.fillStyle(0x39FF14, 0.9);
        this.interactablesGraphics.fillRoundedRect(ex - 16, ey - 16, 32, 32, 6);
        this.interactablesGraphics.lineStyle(2, 0x050510, 1);
        this.interactablesGraphics.strokeRoundedRect(ex - 16, ey - 16, 32, 32, 6);
      } else if (ent.type === 'switch') {
        this.interactablesGraphics.fillStyle(0xFF0055, 0.9);
        this.interactablesGraphics.fillCircle(ex, ey, 12);
        this.interactablesGraphics.lineStyle(2, 0xFFFFFF, 0.9);
        this.interactablesGraphics.strokeCircle(ex, ey, 12);
      }
    }

    // Clean up inactive interactable sprites
    for (const [id, sprite] of this.interactableSpriteMap.entries()) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.interactableSpriteMap.delete(id);
      }
    }

    // Clean up inactive contested tags
    if (this.contestedTagMap) {
      for (const [id, tag] of this.contestedTagMap.entries()) {
        if (!activeContestedIds.has(id)) {
          tag.destroy();
          this.contestedTagMap.delete(id);
        }
      }
    }
  }

  // Draw Roaming Hazard Sentinels (Deduct points on touch)
  drawHazardSentinels(sentinels) {
    this.sentinelsGraphics.clear();
    if (!sentinels || sentinels.length === 0 || currentGameState.state !== 'RUNNING') return;

    const ox = ARENA_OFFSET_X;
    const time = this.time.now;

    for (const s of sentinels) {
      const sx = s.x + ox;
      const sy = s.y;
      const pulse = 1 + Math.sin(time / 140) * 0.15;

      // Outer Hazard Aura
      this.sentinelsGraphics.lineStyle(2.5, 0xFF0055, 0.9);
      this.sentinelsGraphics.strokeCircle(sx, sy, (s.radius || 22) * pulse);

      // Spiky Diamond Core
      this.sentinelsGraphics.fillStyle(0xFF0055, 0.95);
      this.sentinelsGraphics.fillCircle(sx, sy, 14);
      this.sentinelsGraphics.fillStyle(0xFFFFFF, 1);
      this.sentinelsGraphics.fillCircle(sx, sy, 5);
    }
  }

  // Right Column: Top 5 Leaderboard with Smooth 300ms Sliding & Flash & Delta Arrows
  drawHostLeaderboard(leaderboard = []) {
    if (currentGameState.state !== 'RUNNING') {
      this.leaderboardContainer.removeAll(true);
      this.leaderboardRowMap.clear();
      this.leaderboardBg = null;
      return;
    }

    const width = 240;
    const rankColors = ['#FFE600', '#CCCCCC', '#CD7F32', '#FFFFFF', '#FFFFFF'];

    if (!this.leaderboardBg) {
      this.leaderboardBg = this.add.graphics();
      this.leaderboardTitle = this.add.text(width / 2, 18, 'TOP 5 LEADERBOARD', {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '13px',
        color: '#00F0FF',
        letterSpacing: 2
      }).setOrigin(0.5);
      this.leaderboardContainer.add([this.leaderboardBg, this.leaderboardTitle]);
    }

    const boxH = 36 + Math.max(1, leaderboard.length) * 40;
    this.leaderboardBg.clear();
    this.leaderboardBg.fillStyle(0x0a0a1e, 0.92);
    this.leaderboardBg.fillRoundedRect(0, 0, width, boxH, 10);
    this.leaderboardBg.lineStyle(1.5, 0x00F0FF, 0.7);
    this.leaderboardBg.strokeRoundedRect(0, 0, width, boxH, 10);

    const activeLeaderboardIds = new Set(leaderboard.map(p => p.id));

    // Remove rows no longer in top 5
    for (const [id, row] of this.leaderboardRowMap.entries()) {
      if (!activeLeaderboardIds.has(id)) {
        this.tweens.add({
          targets: row.container,
          alpha: 0,
          duration: 200,
          onComplete: () => {
            row.container.destroy();
            this.leaderboardRowMap.delete(id);
          }
        });
      }
    }

    // Update or add rows with sliding tween & delta arrows
    leaderboard.forEach((player, idx) => {
      const targetY = 44 + idx * 38;
      const rankColor = rankColors[idx] || '#FFFFFF';
      const pColorNum = player.color ? player.color.num : (player.colorNum || 0x00f0ff);

      let row = this.leaderboardRowMap.get(player.id);
      if (!row) {
        const rowContainer = this.add.container(0, targetY);
        rowContainer.setAlpha(0);

        const flashGfx = this.add.graphics();
        rowContainer.add(flashGfx);

        const pip = this.add.graphics();
        pip.fillStyle(pColorNum, 1);
        pip.fillCircle(14, 8, 6);
        rowContainer.add(pip);

        const rivalSuffix = player.isRival ? ' ⚔️' : '';
        const nameText = this.add.text(28, 8, `${idx + 1}. ${player.name}${rivalSuffix}`, {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: rankColor
        }).setOrigin(0, 0.5);
        rowContainer.add(nameText);

        const deltaText = this.add.text(width - 55, 8, '', {
          fontFamily: 'sans-serif',
          fontSize: '10px',
          fontStyle: 'bold'
        }).setOrigin(1, 0.5);
        rowContainer.add(deltaText);

        const scoreText = this.add.text(width - 10, 8, `${player.score}`, {
          fontFamily: 'monospace',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#39FF14'
        }).setOrigin(1, 0.5);
        rowContainer.add(scoreText);

        this.leaderboardContainer.add(rowContainer);
        this.tweens.add({
          targets: rowContainer,
          alpha: 1,
          duration: 250
        });

        row = {
          container: rowContainer,
          pip,
          nameText,
          deltaText,
          deltaTween: null,
          scoreText,
          flashGfx,
          rankIndex: idx
        };
        this.leaderboardRowMap.set(player.id, row);
      } else {
        // Row exists: check if rank changed
        if (row.rankIndex !== idx) {
          const rankDiff = row.rankIndex - idx; // Positive = gained positions (e.g. 2 -> 0 is +2)
          row.rankIndex = idx;
          this.tweens.add({
            targets: row.container,
            y: targetY,
            duration: 300,
            ease: 'Cubic.easeOut'
          });

          // Flash highlight
          row.flashGfx.clear();
          row.flashGfx.fillStyle(0x00F0FF, 0.35);
          row.flashGfx.fillRoundedRect(4, -4, width - 8, 24, 4);
          this.tweens.add({
            targets: row.flashGfx,
            alpha: 0,
            duration: 400,
            onComplete: () => {
              row.flashGfx.clear();
              row.flashGfx.setAlpha(1);
            }
          });

          // Delta Arrow (▲+N or ▼-N) fading after 3 seconds
          if (rankDiff !== 0 && row.deltaText) {
            const isUp = rankDiff > 0;
            row.deltaText.setText(isUp ? `▲+${rankDiff}` : `▼${rankDiff}`);
            row.deltaText.setColor(isUp ? '#39FF14' : '#FF0055');
            row.deltaText.setAlpha(1);
            if (row.deltaTween) {
              row.deltaTween.stop();
            }
            row.deltaTween = this.tweens.add({
              targets: row.deltaText,
              alpha: 0,
              duration: 3000,
              ease: 'Power1'
            });
          }
        }

        const rivalSuffix = player.isRival ? ' ⚔️' : '';
        row.nameText.setText(`${idx + 1}. ${player.name}${rivalSuffix}`);
        row.nameText.setColor(rankColor);
        row.scoreText.setText(`${player.score}`);
      }

      // Update player entity rank & aura & top crown
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
        if (entity.topCrown) {
          entity.topCrown.setVisible(idx === 0);
        }
      }
    });
  }

  // Active Effects Tray under running HUD timer
  renderActiveEffectsTray(anomaliesState) {
    this.effectsTrayContainer.removeAll(true);
    if (!anomaliesState || currentGameState.state !== 'RUNNING') return;

    const activeList = [];
    if (anomaliesState.activeAnomalies && anomaliesState.activeAnomalies.length > 0) {
      anomaliesState.activeAnomalies.forEach(a => {
        const dur = a.remainingDurationSec || a.durationSec || 0;
        activeList.push({
          icon: a.id === 'SPEED_SURGE' ? '⚡' : (a.id === 'DOUBLE_OVERDRIVE' ? '💎' : (a.id === 'FOG_OF_WAR' ? '🌫️' : '🌀')),
          label: a.name || a.id,
          timeText: dur > 0 ? `${Math.ceil(dur)}s` : '',
          colorHex: a.colorHex || '#00F0FF'
        });
      });
    }

    if (anomaliesState.crown && anomaliesState.crown.active) {
      activeList.push({
        icon: '👑',
        label: 'CROWN ACTIVE',
        timeText: '+2/s',
        colorHex: '#FFE600'
      });
    }

    if (activeList.length === 0) return;

    const pillW = 160;
    const pillH = 26;
    const spacing = 10;
    const totalW = activeList.length * pillW + (activeList.length - 1) * spacing;
    const startX = -totalW / 2;

    activeList.forEach((effect, idx) => {
      const px = startX + idx * (pillW + spacing) + pillW / 2;
      const colorNum = Phaser.Display.Color.HexStringToColor(effect.colorHex).color;

      const pillBg = this.add.graphics();
      pillBg.fillStyle(0x0a0a24, 0.94);
      pillBg.fillRoundedRect(px - pillW / 2, 0, pillW, pillH, 13);
      pillBg.lineStyle(1.5, colorNum, 0.9);
      pillBg.strokeRoundedRect(px - pillW / 2, 0, pillW, pillH, 13);
      this.effectsTrayContainer.add(pillBg);

      const label = `${effect.icon} ${effect.label} ${effect.timeText ? `[${effect.timeText}]` : ''}`.trim();
      const txt = this.add.text(px, pillH / 2, label, {
        fontFamily: 'sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: effect.colorHex
      }).setOrigin(0.5);
      this.effectsTrayContainer.add(txt);
    });
  }

  // Floating Score Popup (+Points or -Points on Hazard Hit)
  spawnScorePopup(event) {
    const ox = ARENA_OFFSET_X;
    const px = event.x + ox;
    const py = event.y;
    const isNegative = event.amount < 0;

    const burst = this.add.graphics();
    burst.lineStyle(3, isNegative ? 0xFF0055 : (event.colorNum || 0x39ff14), 0.9);
    burst.strokeCircle(px, py, 10);
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

    const popupText = this.add.text(px, py - 10, isNegative ? `${event.amount}` : `+${event.amount}`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '24px',
      color: isNegative ? '#FF0055' : '#39FF14',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);
    this.fxContainer.add(popupText);

    this.tweens.add({
      targets: popupText,
      y: py - 50,
      alpha: 0,
      duration: 1000,
      ease: 'Cubic.easeOut',
      onComplete: () => popupText.destroy()
    });
  }

  // Render Big Center Pre-Match Countdown (5s)
  renderCountdown(count) {
    this.countdownContainer.removeAll(true);
    if (currentGameState.state !== 'COUNTDOWN') return;

    const bg = this.add.graphics();
    bg.fillStyle(0x050512, 0.75);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.countdownContainer.add(bg);

    const countText = this.add.text(1100, WORLD_HEIGHT / 2 - 20, count > 0 ? `${count}` : 'RACE!', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: count > 0 ? '140px' : '100px',
      color: count > 0 ? '#00F0FF' : '#39FF14',
      stroke: '#FFFFFF',
      strokeThickness: 4
    }).setOrigin(0.5);

    const sub = this.add.text(1100, WORLD_HEIGHT / 2 + 80, 'GET READY RACERS - PREPARE YOUR PHONES', {
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

  // Show Final 10-Second Countdown Overlay (Large Numbers & Ticks)
  showFinalCountdownOverlay(count) {
    if (currentGameState.state !== 'RUNNING') return;
    this.countdownContainer.removeAll(true);

    const cx = 1100;
    const cy = 280;

    const bg = this.add.graphics();
    bg.fillStyle(0x050512, 0.82);
    bg.fillCircle(cx, cy, 95);
    const borderColor = count <= 3 ? 0xFF0055 : (count <= 5 ? 0xFFAA00 : 0x00F0FF);
    bg.lineStyle(4, borderColor, 0.95);
    bg.strokeCircle(cx, cy, 95);

    const countText = this.add.text(cx, cy - 8, `${count}`, {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '84px',
      color: count <= 3 ? '#FF0055' : (count <= 5 ? '#FFAA00' : '#00F0FF'),
      stroke: '#FFFFFF',
      strokeThickness: 3
    }).setOrigin(0.5);

    const subText = this.add.text(cx, cy + 50, 'FINAL SECONDS', {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      letterSpacing: 2
    }).setOrigin(0.5);

    this.countdownContainer.add([bg, countText, subText]);
    this.countdownContainer.setDepth(150);

    this.tweens.add({
      targets: [bg, countText],
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 320,
      yoyo: true,
      ease: 'Cubic.easeInOut'
    });
  }

  // Phase 10: Match Ended Screen Entry Point
  renderEndedScreen(resultsData = {}) {
    this.endedContainer.removeAll(true);
    this.countdownContainer.removeAll(true);
    if (currentGameState.state !== 'ENDED') return;

    this.matchResults = resultsData;
    this.hasSkippedHighlights = false;

    const cards = resultsData.highlightCards || [];
    if (cards.length > 0) {
      this.startHighlightReel(resultsData);
    } else {
      this.renderPodiumAndAwards(resultsData);
    }
  }

  // 1. Highlight Reel Carousel: 4-6 Stat Cards (~3 seconds each)
  startHighlightReel(resultsData) {
    if (this.highlightTimer) {
      this.highlightTimer.remove();
      this.highlightTimer = null;
    }

    this.endedContainer.removeAll(true);
    this.endedContainer.setDepth(200);

    const bg = this.add.graphics();
    bg.fillStyle(0x050512, 0.96);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.endedContainer.add(bg);

    const cards = resultsData.highlightCards || [];
    let currentIndex = 0;

    const reelCardContainer = this.add.container(0, 0);
    this.endedContainer.add(reelCardContainer);

    const renderCard = (index) => {
      reelCardContainer.removeAll(true);
      const card = cards[index];
      if (!card) return;

      sounds.playHighlightChime();

      const cx = 1100;
      const cy = 460;
      const cardW = 860;
      const cardH = 460;
      const accentNum = Phaser.Display.Color.HexStringToColor(card.accentColor || '#00F0FF').color;

      // Card Background with Glowing Cyber Border
      const cardGfx = this.add.graphics();
      cardGfx.fillStyle(0x0d0d26, 0.95);
      cardGfx.fillRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 20);
      cardGfx.lineStyle(3, accentNum, 0.9);
      cardGfx.strokeRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 20);
      reelCardContainer.add(cardGfx);

      // Category Badge Pill
      const badgePill = this.add.graphics();
      badgePill.fillStyle(accentNum, 0.2);
      badgePill.fillRoundedRect(cx - 160, cy - cardH / 2 + 30, 320, 36, 18);
      badgePill.lineStyle(2, accentNum, 0.8);
      badgePill.strokeRoundedRect(cx - 160, cy - cardH / 2 + 30, 320, 36, 18);
      reelCardContainer.add(badgePill);

      const badgeText = this.add.text(cx, cy - cardH / 2 + 48, (card.badge || 'MATCH HIGHLIGHT').toUpperCase(), {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '16px',
        color: card.accentColor || '#00F0FF',
        letterSpacing: 3
      }).setOrigin(0.5);
      reelCardContainer.add(badgeText);

      // Big Icon Orb
      const iconOrb = this.add.graphics();
      iconOrb.fillStyle(0x18183c, 1);
      iconOrb.fillCircle(cx, cy - 65, 50);
      iconOrb.lineStyle(3, accentNum, 1);
      iconOrb.strokeCircle(cx, cy - 65, 50);
      reelCardContainer.add(iconOrb);

      const iconText = this.add.text(cx, cy - 65, card.icon || '⭐', {
        fontSize: '48px'
      }).setOrigin(0.5);
      reelCardContainer.add(iconText);

      // Headline Text
      const headline = this.add.text(cx, cy + 40, card.title || 'INCREDIBLE FEAT', {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '34px',
        color: '#FFFFFF',
        letterSpacing: 2,
        align: 'center',
        wordWrap: { width: cardW - 80 }
      }).setOrigin(0.5);
      reelCardContainer.add(headline);

      // Subtitle Text
      const sub = this.add.text(cx, cy + 95, card.subtitle || '', {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        color: '#8888CC',
        letterSpacing: 1,
        align: 'center',
        wordWrap: { width: cardW - 100 }
      }).setOrigin(0.5);
      reelCardContainer.add(sub);

      // Player Pill
      if (card.playerName) {
        const pCol = card.colorHex || '#00F0FF';
        const pColNum = Phaser.Display.Color.HexStringToColor(pCol).color;
        const playerBadge = this.add.graphics();
        playerBadge.fillStyle(0x050515, 0.9);
        playerBadge.fillRoundedRect(cx - 130, cy + 140, 260, 40, 20);
        playerBadge.lineStyle(2, pColNum, 0.9);
        playerBadge.strokeRoundedRect(cx - 130, cy + 140, 260, 40, 20);
        playerBadge.fillStyle(pColNum, 1);
        playerBadge.fillCircle(cx - 95, cy + 160, 10);
        reelCardContainer.add(playerBadge);

        const pName = this.add.text(cx - 75, cy + 160, card.playerName, {
          fontFamily: 'sans-serif',
          fontSize: '16px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        }).setOrigin(0, 0.5);
        reelCardContainer.add(pName);
      }

      // Progress Line Indicator
      const lineY = cy + cardH / 2 - 16;
      const lineW = cardW - 80;
      const progressBg = this.add.graphics();
      progressBg.fillStyle(0x222244, 0.6);
      progressBg.fillRoundedRect(cx - lineW / 2, lineY, lineW, 6, 3);
      reelCardContainer.add(progressBg);

      const progressBar = this.add.graphics();
      progressBar.fillStyle(accentNum, 1);
      progressBar.fillRoundedRect(cx - lineW / 2, lineY, 0, 6, 3);
      reelCardContainer.add(progressBar);

      this.tweens.add({
        targets: { w: 0 },
        w: lineW,
        duration: 3200,
        ease: 'Linear',
        onUpdate: (tween) => {
          const val = tween.getValue();
          progressBar.clear();
          progressBar.fillStyle(accentNum, 1);
          progressBar.fillRoundedRect(cx - lineW / 2, lineY, val, 6, 3);
        }
      });

      // Card Dots & Counter (e.g. Highlight 1 of 5)
      const dotStartX = cx - ((cards.length - 1) * 24) / 2;
      for (let i = 0; i < cards.length; i++) {
        const dot = this.add.graphics();
        dot.fillStyle(i === index ? accentNum : 0x444466, 1);
        dot.fillCircle(dotStartX + i * 24, cy + cardH / 2 + 30, i === index ? 6 : 4);
        reelCardContainer.add(dot);
      }

      const counterText = this.add.text(cx, cy + cardH / 2 + 55, `HIGHLIGHT ${index + 1} OF ${cards.length}`, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#666699',
        letterSpacing: 2
      }).setOrigin(0.5);
      reelCardContainer.add(counterText);

      // Intro Animation
      reelCardContainer.setAlpha(0);
      reelCardContainer.setScale(0.92);
      this.tweens.add({
        targets: reelCardContainer,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 350,
        ease: 'Back.easeOut'
      });
    };

    // Header Title
    const headerTitle = this.add.text(1100, 95, '⚡ MATCH HIGHLIGHTS ⚡', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '48px',
      color: '#00F0FF',
      letterSpacing: 8,
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    const headerSub = this.add.text(1100, 145, 'RELIVING EPIC MOMENTS ACROSS THE ARENA', {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      color: '#8888AA',
      letterSpacing: 4
    }).setOrigin(0.5);
    this.endedContainer.add([headerTitle, headerSub]);

    // Skip to Podium Button
    const skipY = WORLD_HEIGHT - 65;
    const skipBtn = this.add.text(1100, skipY, '[ SKIP TO FINAL PODIUM (CLICK / PRESS SPACE) ]', {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#39FF14',
      backgroundColor: 'rgba(5, 5, 20, 0.8)',
      padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    skipBtn.on('pointerdown', () => {
      this.hasSkippedHighlights = true;
      if (this.highlightTimer) this.highlightTimer.remove();
      this.renderPodiumAndAwards(resultsData);
    });
    this.endedContainer.add(skipBtn);

    renderCard(0);

    // Schedule next cards
    const scheduleNext = () => {
      this.highlightTimer = this.time.delayedCall(3200, () => {
        currentIndex++;
        if (currentIndex < cards.length) {
          renderCard(currentIndex);
          scheduleNext();
        } else {
          this.renderPodiumAndAwards(resultsData);
        }
      });
    };
    scheduleNext();
  }

  // 2. Final Podium (Top 3) + Special Awards + Full Ranking Screen
  renderPodiumAndAwards(resultsData) {
    if (this.highlightTimer) {
      this.highlightTimer.remove();
      this.highlightTimer = null;
    }

    this.endedContainer.removeAll(true);
    this.endedContainer.setDepth(200);

    const bg = this.add.graphics();
    bg.fillStyle(0x050512, 0.96);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.endedContainer.add(bg);

    // Top Ceremony Header
    const title = this.add.text(1100, 55, '🏆 FINAL PODIUM CEREMONY 🏆', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '46px',
      color: '#FFE600',
      letterSpacing: 6,
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    const sub = this.add.text(1100, 95, 'OFFICIAL MATCH RANKINGS & SPECIAL MERIT AWARDS', {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#8888BB',
      letterSpacing: 3
    }).setOrigin(0.5);
    this.endedContainer.add([title, sub]);

    const leaderboard = resultsData.leaderboard || [];
    const podium = resultsData.podium || leaderboard.slice(0, 3);
    const awards = resultsData.awards || {};

    // --- PODIUM PILLARS (Top 3) ---
    const podiumConfig = [
      { rank: 1, x: 1100, h: 190, color: 0xFFD700, hex: '#FFD700', label: '1ST PLACE 👑', badge: 'GOLD' },
      { rank: 2, x: 800, h: 145, color: 0xC0C0C0, hex: '#C0C0C0', label: '2ND PLACE 🥈', badge: 'SILVER' },
      { rank: 3, x: 1400, h: 115, color: 0xCD7F32, hex: '#CD7F32', label: '3RD PLACE 🥉', badge: 'BRONZE' }
    ];

    const podiumOrder = [
      podium[0] ? { p: podium[0], conf: podiumConfig[0] } : null,
      podium[1] ? { p: podium[1], conf: podiumConfig[1] } : null,
      podium[2] ? { p: podium[2], conf: podiumConfig[2] } : null
    ].filter(Boolean);

    const baseY = 420;

    podiumOrder.forEach(({ p, conf }, idx) => {
      const x = conf.x;
      const h = conf.h;
      const col = p.color ? p.color.num : (p.colorNum || 0x00f0ff);

      // Pillar Box
      const pillar = this.add.graphics();
      pillar.fillStyle(0x12122c, 0.95);
      pillar.fillRoundedRect(x - 110, baseY - h, 220, h, 12);
      pillar.lineStyle(3, conf.color, 1);
      pillar.strokeRoundedRect(x - 110, baseY - h, 220, h, 12);
      this.endedContainer.add(pillar);

      // Pulsing Neon Glow Aura behind player avatar
      const aura = this.add.graphics();
      aura.lineStyle(3, conf.color, 0.8);
      aura.strokeCircle(x, baseY - h - 38, 28);
      this.endedContainer.add(aura);

      // Player Avatar Pip
      const pip = this.add.graphics();
      pip.fillStyle(col, 1);
      pip.fillCircle(x, baseY - h - 38, 20);
      pip.lineStyle(2, 0xFFFFFF, 0.9);
      pip.strokeCircle(x, baseY - h - 38, 20);
      this.endedContainer.add(pip);

      // Rank Label
      const rankLabel = this.add.text(x, baseY - h + 22, conf.label, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: conf.hex
      }).setOrigin(0.5);

      // Name Text
      const nameText = this.add.text(x, baseY - h + 50, p.name, {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '22px',
        color: '#FFFFFF',
        letterSpacing: 1
      }).setOrigin(0.5);

      // Score Text
      const scoreText = this.add.text(x, baseY - h + 80, `${p.score} PTS`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#39FF14'
      }).setOrigin(0.5);

      // Tie-Break Detail Badge
      let tieText = '';
      if (p.epicLegendaryCount && p.epicLegendaryCount > 0) {
        tieText = `💎 ${p.epicLegendaryCount} Epic/Leg`;
      } else if (p.stats && p.stats.distanceMeters) {
        tieText = `🏃 ${p.stats.distanceMeters}m moved`;
      }

      const tieDetail = this.add.text(x, baseY - h + 104, tieText, {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#8888BB'
      }).setOrigin(0.5);

      this.endedContainer.add([rankLabel, nameText, scoreText, tieDetail]);
    });

    // --- 3. SPECIAL AWARDS SECTION (5 Awards) ---
    const awardsHeader = this.add.text(1100, 455, '⭐ SPECIAL RECOGNITION AWARDS ⭐', {
      fontFamily: '"Impact", "Arial Black", sans-serif',
      fontSize: '20px',
      color: '#00F0FF',
      letterSpacing: 3
    }).setOrigin(0.5);
    this.endedContainer.add(awardsHeader);

    const awardKeys = ['explorer', 'chaosAgent', 'treasureHunter', 'speedDemon', 'vaultMaster'];
    const awardLabels = [
      { key: 'explorer', icon: '🧭', title: 'EXPLORER', color: '#00F0FF', def: 'Uncharted mapping' },
      { key: 'chaosAgent', icon: '🌀', title: 'CHAOS AGENT', color: '#FF00FF', def: 'Anomaly master' },
      { key: 'treasureHunter', icon: '💎', title: 'TREASURE HUNTER', color: '#FFE600', def: 'Loot hoarder' },
      { key: 'speedDemon', icon: '⚡', title: 'SPEED DEMON', color: '#39FF14', def: 'Top sprinter' },
      { key: 'vaultMaster', icon: '🗝️', title: 'VAULT MASTER', color: '#FFAA00', def: 'Citadel breaker' }
    ];

    const cardW = 280;
    const cardH = 100;
    const startX = 1100 - (2 * 300);

    awardLabels.forEach((al, i) => {
      const award = awards[al.key];
      const ax = startX + i * 300;
      const ay = 535;
      const accentColorNum = Phaser.Display.Color.HexStringToColor(al.color).color;

      const acard = this.add.graphics();
      acard.fillStyle(0x0c0c22, 0.95);
      acard.fillRoundedRect(ax - cardW / 2, ay - cardH / 2, cardW, cardH, 10);
      acard.lineStyle(1.5, accentColorNum, award ? 0.9 : 0.4);
      acard.strokeRoundedRect(ax - cardW / 2, ay - cardH / 2, cardW, cardH, 10);
      this.endedContainer.add(acard);

      const aIcon = this.add.text(ax - cardW / 2 + 32, ay, al.icon, { fontSize: '26px' }).setOrigin(0.5);
      const aTitle = this.add.text(ax - cardW / 2 + 60, ay - 24, al.title, {
        fontFamily: '"Impact", "Arial Black", sans-serif',
        fontSize: '14px',
        color: al.color,
        letterSpacing: 1.5
      }).setOrigin(0, 0.5);

      const winnerName = award ? award.recipientName : 'UNCLAIMED';
      const winnerCol = award ? (award.colorHex || '#FFFFFF') : '#666688';

      const aWinner = this.add.text(ax - cardW / 2 + 60, ay + 2, winnerName, {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: winnerCol
      }).setOrigin(0, 0.5);

      const aStat = this.add.text(ax - cardW / 2 + 60, ay + 24, award ? award.statValue : al.def, {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#8888AA'
      }).setOrigin(0, 0.5);

      this.endedContainer.add([aIcon, aTitle, aWinner, aStat]);
    });

    // --- 4. FULL LEADERBOARD TABLE (Ranks 4-20) ---
    if (leaderboard.length > 3) {
      const rest = leaderboard.slice(3, 10);
      const restHeader = this.add.text(1100, 615, 'RANKINGS 4-10', {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#8888AA',
        letterSpacing: 2
      }).setOrigin(0.5);
      this.endedContainer.add(restHeader);

      const chipW = 200;
      const chipH = 34;
      const startChipX = 1100 - ((rest.length - 1) * (chipW + 12)) / 2;

      rest.forEach((p, idx) => {
        const cx = startChipX + idx * (chipW + 12);
        const cy = 645;

        const chip = this.add.graphics();
        chip.fillStyle(0x0a0a1f, 0.9);
        chip.fillRoundedRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH, 6);
        chip.lineStyle(1, 0x333366, 0.8);
        chip.strokeRoundedRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH, 6);

        const col = p.color ? p.color.num : 0x00f0ff;
        chip.fillStyle(col, 1);
        chip.fillCircle(cx - chipW / 2 + 16, cy, 6);
        this.endedContainer.add(chip);

        const rankText = this.add.text(cx - chipW / 2 + 28, cy, `#${p.rank} ${p.name}`, {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        }).setOrigin(0, 0.5);

        const scText = this.add.text(cx + chipW / 2 - 12, cy, `${p.score}p`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#39FF14'
        }).setOrigin(1, 0.5);

        this.endedContainer.add([rankText, scText]);
      });
    }

    // --- 5. RESET / NEW MATCH BUTTON ---
    const btnY = WORLD_HEIGHT - 70;
    const btnW = 360;
    const btnH = 56;

    const resetBtn = this.add.graphics();
    resetBtn.fillStyle(0x00F0FF, 1);
    resetBtn.fillRoundedRect(1100 - btnW / 2, btnY - btnH / 2, btnW, btnH, 14);
    resetBtn.lineStyle(2, 0xFFFFFF, 1);
    resetBtn.strokeRoundedRect(1100 - btnW / 2, btnY - btnH / 2, btnW, btnH, 14);
    this.endedContainer.add(resetBtn);

    const resetText = this.add.text(1100, btnY, 'START NEW MATCH [R]', {
      fontFamily: 'sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#050510',
      letterSpacing: 2
    }).setOrigin(0.5);

    const keyHint = this.add.text(1100, btnY + 40, '[ Press R on keyboard to reset match in same lobby ]', {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      color: '#00F0FF'
    }).setOrigin(0.5);

    this.endedContainer.add([resetText, keyHint]);

    const zone = this.add.zone(1100, btnY, btnW, btnH).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this.triggerResetMatch());
    this.endedContainer.add(zone);
  }

  renderPoiMarkers() {
    this.poiDebugContainer.removeAll(true);
    const mapData = currentGameState.map;
    if (!mapData || !mapData.pois) return;

    const ox = ARENA_OFFSET_X;
    const pois = mapData.pois;
    const g = this.add.graphics();

    for (const t of (pois.treasures || [])) {
      g.fillStyle(0xFFD700, 0.9);
      g.fillCircle(t.x + ox, t.y, 8);
      g.lineStyle(1.5, 0xFFFFFF, 1);
      g.strokeCircle(t.x + ox, t.y, 8);
      const label = this.add.text(t.x + ox, t.y, 'T', { fontFamily: 'sans-serif', fontSize: '9px', fontStyle: 'bold', color: '#000000' }).setOrigin(0.5);
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

    const leftX = w * 0.32;
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

    const rightX = w * 0.68;
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
    const ox = ARENA_OFFSET_X;
    const container = this.add.container((p.x || 800) + ox, p.y || 530);
    const radius = 24;
    const pColorNum = p.color ? p.color.num : (p.colorNum || 0x00f0ff);
    const animalId = (p.animal && p.animal.id) || p.animalId || 'fox';
    const textureKey = this.textures.exists(`animal_${animalId}`) ? `animal_${animalId}` : 'animal_fox';

    // Glowing Top 3 pulsing aura
    const aura = this.add.graphics();
    aura.lineStyle(3, 0xFFE600, 0.9);
    aura.strokeCircle(0, 0, radius + 12);
    aura.setVisible(false);

    // Player-color ambient glow
    const glow = this.add.graphics();
    glow.fillStyle(pColorNum, 0.35);
    glow.fillCircle(0, 0, radius + 6);

    // Player-color outline ring
    const ring = this.add.graphics();
    ring.lineStyle(3, pColorNum, 1);
    ring.strokeCircle(0, 0, radius + 3);

    // Retro 8-bit Pixel-Art Animal Avatar Sprite
    const avatar = this.add.image(0, 0, textureKey).setDisplaySize(38, 38);

    // #1 Player Top Crown Marker
    const topCrown = this.add.text(0, -radius - 38, '👑', {
      fontSize: '22px'
    }).setOrigin(0.5).setVisible(false);

    // Key holder badge
    const keyIcon = this.add.text(0, -radius - 30, '🔑', { fontSize: '14px' }).setOrigin(0.5).setVisible(false);

    // Rivalry indicator badge
    const rivalTag = this.add.text(0, -radius - 28, '⚔️ RIVALRY', {
      fontFamily: 'sans-serif',
      fontSize: '9px',
      fontStyle: 'bold',
      color: '#FF0055',
      backgroundColor: 'rgba(5, 5, 20, 0.94)',
      padding: { x: 5, y: 1 }
    }).setOrigin(0.5).setVisible(Boolean(p.isRival));

    // Name tag with dark backing chip
    const nameTag = this.add.text(0, -radius - 14, p.name, {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#FFFFFF',
      backgroundColor: 'rgba(5, 5, 18, 0.92)',
      padding: { x: 8, y: 3 }
    }).setOrigin(0.5);

    container.add([aura, glow, ring, avatar, topCrown, keyIcon, rivalTag, nameTag]);
    container.setDepth(10);

    this.playerMap.set(p.id, {
      container,
      avatar,
      glow,
      ring,
      aura,
      topCrown,
      auraColor: 0xFFE600,
      rank: 99,
      keyIcon,
      rivalTag,
      labelText: nameTag,
      targetX: p.x || 800,
      targetY: p.y || 530,
      currentX: p.x || 800,
      currentY: p.y || 530,
      score: 0,
      hasKey: false,
      isRival: Boolean(p.isRival),
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
          entity.isRival = Boolean(snap.isRival);
          if (entity.keyIcon) {
            entity.keyIcon.setVisible(entity.hasKey);
          }
          if (entity.rivalTag) {
            entity.rivalTag.setVisible(entity.isRival && !entity.hasKey);
          }
          if (snap.animalId && entity.avatar) {
            const tKey = `animal_${snap.animalId}`;
            if (this.textures.exists(tKey) && entity.avatar.texture.key !== tKey) {
              entity.avatar.setTexture(tKey);
            }
          }
        }
      }
    }

    const entities = snapshot.e || snapshot.ent || [];
    this.drawActiveInteractables(entities);

    // Hazard Sentinels
    if (snapshot.sentinels) {
      this.drawHazardSentinels(snapshot.sentinels);
    }

    if (snapshot.lb) {
      this.drawHostLeaderboard(snapshot.lb);
      this.drawWhoToBeatPanel(snapshot.lb);
    }

    if (snapshot.clues) {
      this.drawKnownCluesPanel(snapshot.clues.knownClues, snapshot.clues.chainTitle, snapshot.clues);
      this.drawHuntChecklist(snapshot.clues);
    }

    // Phase 8 Anomalies, Fog & Crown
    if (snapshot.anomalies) {
      this.renderAnomalyOverlay(snapshot.anomalies);
      this.renderActiveEffectsTray(snapshot.anomalies);
      this.renderFogOfWar(snapshot.anomalies.fog);
      this.renderGoldenCrown(snapshot.anomalies.crown);
    } else {
      this.anomalyContainer.removeAll(true);
      this.effectsTrayContainer.removeAll(true);
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
    this.fogGraphics.fillRect(ARENA_OFFSET_X, 0, 1600, WORLD_HEIGHT);
  }

  renderGoldenCrown(crownState) {
    this.crownContainer.removeAll(true);
    if (!crownState || !crownState.active || currentGameState.state !== 'RUNNING') return;

    const ox = ARENA_OFFSET_X;
    const cx = crownState.x + ox;
    const cy = crownState.y - 28;

    const crown = this.add.text(cx, cy, '👑', {
      fontSize: '22px'
    }).setOrigin(0.5);

    const aura = this.add.graphics();
    aura.lineStyle(2, 0xFFE600, 0.9);
    aura.strokeCircle(cx, cy, 16);

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
    const ox = ARENA_OFFSET_X;

    for (const entity of this.playerMap.values()) {
      if (isRunning) {
        const dx = entity.targetX - entity.currentX;
        const dy = entity.targetY - entity.currentY;
        const dist = Math.hypot(dx, dy);

        if (dist > 250) {
          entity.currentX = entity.targetX;
          entity.currentY = entity.targetY;
        } else {
          entity.currentX += dx * lerpFactor;
          entity.currentY += dy * lerpFactor;
        }

        entity.container.setPosition(entity.currentX + ox, entity.currentY);

        // Particle trail during SPEED_SURGE
        if (isSpeedSurge && (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4)) {
          if (Math.random() < 0.3) {
            const trail = this.add.graphics();
            const pCol = entity.color ? entity.color.num : 0x00f0ff;
            trail.fillStyle(pCol, 0.65);
            trail.fillCircle(entity.currentX + ox + (Math.random() - 0.5) * 8, entity.currentY + (Math.random() - 0.5) * 8, 4.5);
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

        // Bob top crown
        if (entity.topCrown && entity.topCrown.visible) {
          entity.topCrown.setY(-38 + Math.sin(time / 200) * 3);
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
