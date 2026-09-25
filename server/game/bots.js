// server/game/bots.js - Intelligent bot runner that seeks interactables & triggers actions
import { io } from 'socket.io-client';
import { CONFIG } from '../config.js';

const BOT_NAMES = [
  'CYBER_PULSE', 'NEON_FOX', 'VIPER_99', 'GLITCH', 'SHADOW_X',
  'ZERO_COOL', 'VOLT_RACER', 'TITAN_88', 'APEX_FLOW', 'HYPER_NOVA',
  'CIRCUIT_KID', 'NEXUS_CORE', 'VECTOR_Z', 'BLAZE_RUN', 'DRIFT_BOT',
  'ORBITAL', 'ECHO_PRIME', 'RAZOR_7', 'CHRONO_JET', 'PHANTOM'
];

const args = process.argv.slice(2);
const botCountArg = args.find(a => !isNaN(parseInt(a, 10)));
const BOT_COUNT = Math.min(CONFIG.MAX_PLAYERS, Math.max(1, parseInt(botCountArg, 10) || 8));

const SERVER_URL = `http://localhost:${CONFIG.PORT}`;
console.log(`\n🤖 Launching ${BOT_COUNT} ANOMALY AI bots connecting to ${SERVER_URL}...\n`);

const bots = [];

class SimulatedBot {
  constructor(name, index) {
    this.name = name.slice(0, CONFIG.MAX_NAME_LENGTH);
    this.index = index;
    this.socket = null;
    this.playerId = null;
    this.myPos = { x: 800, y: 530 };
    this.activeInteractables = [];
    this.currentInput = { x: 0, y: 0, action: false };
    this.timer = null;

    // AI steering state
    this.targetAngle = Math.random() * Math.PI * 2;
    this.speedFactor = 0.85 + Math.random() * 0.15;
    this.isPaused = false;
    this.nextWanderTime = Date.now();
    this.actionEndTime = 0;
  }

  start() {
    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log(`[Bot ${this.index + 1}] Connected -> Joining as "${this.name}"`);
      this.socket.emit('join_game', { name: this.name, isBot: true });
    });

    this.socket.on('joined_success', (data) => {
      this.playerId = data.player.id;
      console.log(`[Bot ${this.index + 1}] Joined successfully! Assigned color: ${data.player.color.name}`);
    });

    // Track world state from snapshot
    this.socket.on('tick_snapshot', (snapshot) => {
      if (!snapshot) return;

      // Update my position
      if (snapshot.p && this.playerId) {
        const me = snapshot.p.find(p => p.id === this.playerId);
        if (me) {
          this.myPos.x = me.x;
          this.myPos.y = me.y;
        }
      }

      // Update active interactables list
      if (snapshot.ent) {
        this.activeInteractables = snapshot.ent.filter(e => e.state === 'active');
      }
    });

    // 20Hz Input loop
    this.timer = setInterval(() => {
      this.updateAI();
      if (this.playerId) {
        this.socket.emit('player_input', {
          playerId: this.playerId,
          x: this.currentInput.x,
          y: this.currentInput.y,
          action: this.currentInput.action
        });
      }
    }, CONFIG.TICK_INTERVAL_MS);
  }

  updateAI() {
    const now = Date.now();

    // 1. Find nearest active interactable
    let nearestTarget = null;
    let nearestDist = 450; // Search vision radius

    for (const ent of this.activeInteractables) {
      const dist = Math.hypot(ent.x - this.myPos.x, ent.y - this.myPos.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestTarget = ent;
      }
    }

    if (nearestTarget) {
      // Steer toward interactable target
      const angle = Math.atan2(nearestTarget.y - this.myPos.y, nearestTarget.x - this.myPos.x);
      this.currentInput.x = Math.cos(angle);
      this.currentInput.y = Math.sin(angle);

      // In interaction range? Trigger action!
      if (nearestDist <= (nearestTarget.radius || 40) + 15) {
        this.actionEndTime = now + 250;
      }
    } else {
      // 2. Fallback: Organic wandering
      if (now >= this.nextWanderTime) {
        this.isPaused = Math.random() < 0.15;
        this.targetAngle = Math.random() * Math.PI * 2;
        this.nextWanderTime = now + 1200 + Math.random() * 2000;
      }

      if (this.isPaused) {
        this.currentInput.x = 0;
        this.currentInput.y = 0;
      } else {
        this.targetAngle += (Math.random() - 0.5) * 0.1;
        this.currentInput.x = Math.cos(this.targetAngle) * this.speedFactor;
        this.currentInput.y = Math.sin(this.targetAngle) * this.speedFactor;
      }
    }

    // Set action flag
    this.currentInput.action = now < this.actionEndTime;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.socket) this.socket.disconnect();
  }
}

for (let i = 0; i < BOT_COUNT; i++) {
  const name = BOT_NAMES[i] || `BOT_${i + 1}`;
  const bot = new SimulatedBot(name, i);
  bots.push(bot);

  setTimeout(() => {
    bot.start();
  }, i * 120);
}

process.on('SIGINT', () => {
  console.log('\n[Bots] Disconnecting all bots...');
  bots.forEach(b => b.stop());
  process.exit(0);
});
