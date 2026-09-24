// server/game/bots.js - Bot simulation runner for ANOMALY
import { io } from 'socket.io-client';
import { CONFIG } from '../config.js';

const BOT_NAMES = [
  'CYBER_PULSE', 'NEON_FOX', 'VIPER_99', 'GLITCH', 'SHADOW_X',
  'ZERO_COOL', 'VOLT_RACER', 'TITAN_88', 'APEX_FLOW', 'HYPER_NOVA',
  'CIRCUIT_KID', 'NEXUS_CORE', 'VECTOR_Z', 'BLAZE_RUN', 'DRIFT_BOT',
  'ORBITAL', 'ECHO_PRIME', 'RAZOR_7', 'CHRONO_JET', 'PHANTOM'
];

// Parse target count from CLI: `npm run bots -- 15` or default to 8
const args = process.argv.slice(2);
const botCountArg = args.find(a => !isNaN(parseInt(a, 10)));
const BOT_COUNT = Math.min(CONFIG.MAX_PLAYERS, Math.max(1, parseInt(botCountArg, 10) || 8));

const SERVER_URL = `http://localhost:${CONFIG.PORT}`;
console.log(`\n🤖 Launching ${BOT_COUNT} ANOMALY test bots connecting to ${SERVER_URL}...\n`);

const bots = [];

class SimulatedBot {
  constructor(name, index) {
    this.name = name.slice(0, CONFIG.MAX_NAME_LENGTH);
    this.index = index;
    this.socket = null;
    this.currentInput = { x: 0, y: 0, action: false };
    this.timer = null;

    // AI steering state
    this.targetAngle = Math.random() * Math.PI * 2;
    this.speedFactor = 0.8 + Math.random() * 0.2;
    this.isPaused = false;
    this.nextDecisionTime = Date.now();
    this.actionEndTime = 0;
  }

  start() {
    this.socket = io(SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log(`[Bot ${this.index + 1}] Connected -> Joining as "${this.name}"`);
      this.socket.emit('join_game', {
        name: this.name
      });
    });

    this.socket.on('joined_success', (data) => {
      console.log(`[Bot ${this.index + 1}] Joined successfully! Assigned color: ${data.player.color.name}`);
    });

    // 20Hz input loop
    this.timer = setInterval(() => {
      this.updateAI();
      this.socket.emit('player_input', this.currentInput);
    }, CONFIG.TICK_INTERVAL_MS);
  }

  updateAI() {
    const now = Date.now();

    // Re-evaluate steering decision
    if (now >= this.nextDecisionTime) {
      // 20% chance to pause/idle, 80% chance to steer in a direction
      this.isPaused = Math.random() < 0.2;
      this.targetAngle = Math.random() * Math.PI * 2;
      this.speedFactor = 0.6 + Math.random() * 0.4;

      // Schedule next steering decision in 1.0 - 3.0 seconds
      this.nextDecisionTime = now + 1000 + Math.random() * 2000;

      // 25% chance to trigger an action burst
      if (!this.isPaused && Math.random() < 0.25) {
        this.actionEndTime = now + 300 + Math.random() * 400;
      }
    }

    // Determine current direction vector
    if (this.isPaused) {
      this.currentInput.x = 0;
      this.currentInput.y = 0;
    } else {
      // Small continuous angle wiggle
      this.targetAngle += (Math.random() - 0.5) * 0.15;
      this.currentInput.x = Math.cos(this.targetAngle) * this.speedFactor;
      this.currentInput.y = Math.sin(this.targetAngle) * this.speedFactor;
    }

    // Action state
    this.currentInput.action = now < this.actionEndTime;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.socket) this.socket.disconnect();
  }
}

// Spawn bots with slight staggered delay
for (let i = 0; i < BOT_COUNT; i++) {
  const name = BOT_NAMES[i] || `BOT_${i + 1}`;
  const bot = new SimulatedBot(name, i);
  bots.push(bot);

  setTimeout(() => {
    bot.start();
  }, i * 120);
}

// Clean shutdown on CTRL+C
process.on('SIGINT', () => {
  console.log('\n[Bots] Disconnecting all bots...');
  bots.forEach(b => b.stop());
  process.exit(0);
});
