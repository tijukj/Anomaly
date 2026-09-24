// server/game/gameManager.js - Authoritative game state manager
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

    this.startTickLoop();
  }

  // 20 ticks per second authoritative loop
  startTickLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      this.tick();
    }, CONFIG.TICK_INTERVAL_MS);
  }

  tick() {
    if (this.state === CONFIG.STATES.RUNNING) {
      // Future game simulation physics/positions will update here
    }
    // Broadcast current state to all clients
    this.broadcastState();
  }

  getAvailableColor() {
    const usedColorHexes = new Set(
      Array.from(this.players.values())
        .filter(p => p.connected)
        .map(p => p.color.hex)
    );

    // Find first unused color
    const available = CONFIG.PLAYER_COLORS.find(c => !usedColorHexes.has(c.hex));
    if (available) return available;

    // Fallback if all 20 colors are in use
    const color = CONFIG.PLAYER_COLORS[this.colorIndex % CONFIG.PLAYER_COLORS.length];
    this.colorIndex++;
    return color;
  }

  registerOrReconnectPlayer(socket, { playerId, name }) {
    const sanitizedName = (name || 'PLAYER').trim().slice(0, CONFIG.MAX_NAME_LENGTH) || 'PLAYER';
    let player = null;

    if (playerId && this.players.has(playerId)) {
      // Reconnection
      player = this.players.get(playerId);
      player.socketId = socket.id;
      player.connected = true;
      if (name) player.name = sanitizedName;
      console.log(`[GameManager] Player reconnected: ${player.name} (${playerId})`);
    } else {
      // New player check max players
      const connectedCount = Array.from(this.players.values()).filter(p => p.connected).length;
      if (connectedCount >= CONFIG.MAX_PLAYERS) {
        socket.emit('error_message', { message: 'Lobby is full (maximum 20 players).' });
        return null;
      }

      const newPlayerId = playerId || crypto.randomUUID();
      const color = this.getAvailableColor();

      player = {
        id: newPlayerId,
        socketId: socket.id,
        name: sanitizedName,
        color: color,
        connected: true,
        joinedAt: Date.now()
      };

      this.players.set(newPlayerId, player);
      console.log(`[GameManager] New player joined: ${player.name} (${newPlayerId}) [Color: ${color.name}]`);
    }

    this.socketToPlayerId.set(socket.id, player.id);

    // Confirm to phone client
    socket.emit('joined_success', {
      player: {
        id: player.id,
        name: player.name,
        color: player.color
      },
      gameState: this.state
    });

    this.broadcastState();
    return player;
  }

  handleDisconnect(socketId) {
    const playerId = this.socketToPlayerId.get(socketId);
    if (!playerId) return;

    this.socketToPlayerId.delete(socketId);
    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      console.log(`[GameManager] Player disconnected: ${player.name} (${playerId})`);
      this.broadcastState();
    }
  }

  startMatch() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.connected);
    if (this.state !== CONFIG.STATES.LOBBY) {
      console.log(`[GameManager] Cannot start match: already in state ${this.state}`);
      return false;
    }
    if (activePlayers.length < CONFIG.MIN_PLAYERS_TO_START) {
      console.log(`[GameManager] Cannot start match: Need at least ${CONFIG.MIN_PLAYERS_TO_START} player`);
      return false;
    }

    this.state = CONFIG.STATES.RUNNING;
    console.log(`[GameManager] Match Started! Active players: ${activePlayers.length}`);
    this.broadcastState();
    return true;
  }

  getPublicState() {
    const activePlayers = Array.from(this.players.values())
      .filter(p => p.connected)
      .map(p => ({
        id: p.id,
        name: p.name,
        color: p.color
      }));

    return {
      state: this.state,
      players: activePlayers,
      playerCount: activePlayers.length,
      minPlayers: CONFIG.MIN_PLAYERS_TO_START,
      canStart: this.state === CONFIG.STATES.LOBBY && activePlayers.length >= CONFIG.MIN_PLAYERS_TO_START
    };
  }

  broadcastState() {
    const publicState = this.getPublicState();
    this.io.emit('game_state_update', publicState);
  }
}
