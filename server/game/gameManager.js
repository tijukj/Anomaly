// server/game/gameManager.js - Authoritative game physics & state manager
import { CONFIG } from '../config.js';
import crypto from 'crypto';

export class GameManager {
  constructor(io) {
    this.io = io;
    this.state = CONFIG.STATES.LOBBY;
    this.players = new Map(); // playerId -> Player Object
    this.socketToPlayerId = new Map(); // socketId -> playerId
    this.colorIndex = 0;
    this.tickInterval = null;
    this.lastTickTime = Date.now();
    this.lastTickComputationMs = 0;

    this.startTickLoop();
  }

  // 20 ticks per second authoritative loop (50ms interval)
  startTickLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      this.tick();
    }, CONFIG.TICK_INTERVAL_MS);
  }

  tick() {
    const startTime = performance.now();
    const dt = CONFIG.TICK_INTERVAL_MS / 1000; // 0.05 seconds

    if (this.state === CONFIG.STATES.RUNNING) {
      // Authoritative physics update for all connected players
      for (const player of this.players.values()) {
        if (!player.connected) continue;

        const inputX = player.input.x || 0;
        const inputY = player.input.y || 0;
        const inputMag = Math.hypot(inputX, inputY);

        // Normalized direction vector if input is active
        if (inputMag > 0.01) {
          const normX = inputX / (inputMag > 1 ? inputMag : 1);
          const normY = inputY / (inputMag > 1 ? inputMag : 1);

          player.vx += normX * CONFIG.PHYSICS.ACCELERATION * dt;
          player.vy += normY * CONFIG.PHYSICS.ACCELERATION * dt;

          // Cap to MAX_SPEED
          const speed = Math.hypot(player.vx, player.vy);
          if (speed > CONFIG.PHYSICS.MAX_SPEED) {
            player.vx = (player.vx / speed) * CONFIG.PHYSICS.MAX_SPEED;
            player.vy = (player.vy / speed) * CONFIG.PHYSICS.MAX_SPEED;
          }
        }

        // Apply friction damping
        player.vx *= CONFIG.PHYSICS.FRICTION;
        player.vy *= CONFIG.PHYSICS.FRICTION;

        // Stop tiny floating velocities
        if (Math.abs(player.vx) < 0.1) player.vx = 0;
        if (Math.abs(player.vy) < 0.1) player.vy = 0;

        // Position integration
        player.x += player.vx * dt;
        player.y += player.vy * dt;

        // World boundary clamping
        const r = CONFIG.PHYSICS.PLAYER_RADIUS;
        if (player.x < r) {
          player.x = r;
          player.vx = 0;
        } else if (player.x > CONFIG.WORLD.WIDTH - r) {
          player.x = CONFIG.WORLD.WIDTH - r;
          player.vx = 0;
        }

        if (player.y < r) {
          player.y = r;
          player.vy = 0;
        } else if (player.y > CONFIG.WORLD.HEIGHT - r) {
          player.y = CONFIG.WORLD.HEIGHT - r;
          player.vy = 0;
        }
      }

      this.broadcastSnapshot();
    }

    this.lastTickComputationMs = performance.now() - startTime;
  }

  handlePlayerInput(socketId, inputData) {
    const playerId = this.socketToPlayerId.get(socketId);
    if (!playerId) return;

    const player = this.players.get(playerId);
    if (!player) return;

    // Validate and clamp input vector
    let rawX = Number(inputData.x) || 0;
    let rawY = Number(inputData.y) || 0;
    const mag = Math.hypot(rawX, rawY);

    if (mag > 1) {
      rawX /= mag;
      rawY /= mag;
    }

    player.input = {
      x: rawX,
      y: rawY,
      action: Boolean(inputData.action)
    };
  }

  getAvailableColor() {
    const usedColorHexes = new Set(
      Array.from(this.players.values())
        .filter(p => p.connected)
        .map(p => p.color.hex)
    );

    const available = CONFIG.PLAYER_COLORS.find(c => !usedColorHexes.has(c.hex));
    if (available) return available;

    const color = CONFIG.PLAYER_COLORS[this.colorIndex % CONFIG.PLAYER_COLORS.length];
    this.colorIndex++;
    return color;
  }

  getRandomSpawnPosition() {
    const margin = 100;
    return {
      x: margin + Math.random() * (CONFIG.WORLD.WIDTH - margin * 2),
      y: margin + Math.random() * (CONFIG.WORLD.HEIGHT - margin * 2)
    };
  }

  registerOrReconnectPlayer(socket, { playerId, name }) {
    const sanitizedName = (name || 'PLAYER').trim().slice(0, CONFIG.MAX_NAME_LENGTH) || 'PLAYER';
    let player = null;

    if (playerId && this.players.has(playerId)) {
      player = this.players.get(playerId);
      player.socketId = socket.id;
      player.connected = true;
      if (name) player.name = sanitizedName;
      console.log(`[GameManager] Player reconnected: ${player.name} (${playerId})`);
    } else {
      const connectedCount = Array.from(this.players.values()).filter(p => p.connected).length;
      if (connectedCount >= CONFIG.MAX_PLAYERS) {
        socket.emit('error_message', { message: 'Lobby is full (maximum 20 players).' });
        return null;
      }

      const newPlayerId = playerId || crypto.randomUUID();
      const color = this.getAvailableColor();
      const spawn = this.getRandomSpawnPosition();

      player = {
        id: newPlayerId,
        socketId: socket.id,
        name: sanitizedName,
        color: color,
        connected: true,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        input: { x: 0, y: 0, action: false },
        joinedAt: Date.now()
      };

      this.players.set(newPlayerId, player);
      console.log(`[GameManager] New player joined: ${player.name} (${newPlayerId}) [Color: ${color.name}]`);
    }

    this.socketToPlayerId.set(socket.id, player.id);

    socket.emit('joined_success', {
      player: {
        id: player.id,
        name: player.name,
        color: player.color
      },
      gameState: this.state
    });

    this.broadcastFullState();
    return player;
  }

  handleDisconnect(socketId) {
    const playerId = this.socketToPlayerId.get(socketId);
    if (!playerId) return;

    this.socketToPlayerId.delete(socketId);
    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      player.input = { x: 0, y: 0, action: false };
      player.vx = 0;
      player.vy = 0;
      console.log(`[GameManager] Player disconnected: ${player.name} (${playerId})`);
      this.broadcastFullState();
    }
  }

  startMatch() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.connected);
    if (this.state !== CONFIG.STATES.LOBBY) return false;
    if (activePlayers.length < CONFIG.MIN_PLAYERS_TO_START) return false;

    // Reset positions randomly across world arena
    for (const player of activePlayers) {
      const spawn = this.getRandomSpawnPosition();
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.input = { x: 0, y: 0, action: false };
    }

    this.state = CONFIG.STATES.RUNNING;
    console.log(`[GameManager] Match Started! Active players: ${activePlayers.length}`);
    this.broadcastFullState();
    return true;
  }

  getPublicState() {
    const activePlayers = Array.from(this.players.values())
      .filter(p => p.connected)
      .map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10
      }));

    return {
      state: this.state,
      players: activePlayers,
      playerCount: activePlayers.length,
      minPlayers: CONFIG.MIN_PLAYERS_TO_START,
      canStart: this.state === CONFIG.STATES.LOBBY && activePlayers.length >= CONFIG.MIN_PLAYERS_TO_START,
      world: CONFIG.WORLD
    };
  }

  broadcastFullState() {
    this.io.emit('game_state_update', this.getPublicState());
  }

  // Compact 20Hz Snapshot Broadcast
  broadcastSnapshot() {
    const activePlayers = [];
    for (const p of this.players.values()) {
      if (p.connected) {
        activePlayers.push({
          id: p.id,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          a: p.input.action ? 1 : 0
        });
      }
    }

    const snapshot = {
      t: Date.now(),
      tickTime: Math.round(this.lastTickComputationMs * 100) / 100,
      p: activePlayers
    };

    this.io.emit('tick_snapshot', snapshot);
  }
}
