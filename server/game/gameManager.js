// server/game/gameManager.js - Authoritative game physics, collision, map regions & seeded POIs
import { CONFIG } from '../config.js';
import { MAP_REGIONS, RIVER_ZONES, BRIDGES, STATIC_WALLS, SECRET_PASSAGE_WALL, POI_POOLS } from './mapData.js';
import { createRng } from './seededRng.js';
import crypto from 'crypto';

export class GameManager {
  constructor(io) {
    this.io = io;
    this.state = CONFIG.STATES.LOBBY;
    this.players = new Map(); // playerId -> Player Object
    this.socketToPlayerId = new Map(); // socketId -> playerId
    this.colorIndex = 0;
    this.tickInterval = null;
    this.lastTickComputationMs = 0;

    // Match Seed & Seeded POIs
    this.matchSeed = Math.floor(Math.random() * 900000) + 100000;
    this.seededPois = null;
    this.secretDoorOpen = false;
    this.activeWalls = [...STATIC_WALLS, SECRET_PASSAGE_WALL];

    // Discovery Tracking per region (First player to enter)
    this.discoveredRegions = new Map();

    this.initSeededMap();
    this.startTickLoop();
  }

  // Initialize seeded POIs and map state using deterministic PRNG
  initSeededMap() {
    this.matchSeed = Math.floor(Math.random() * 900000) + 100000;
    const rng = createRng(this.matchSeed);

    this.secretDoorOpen = false;
    this.activeWalls = [...STATIC_WALLS, SECRET_PASSAGE_WALL];
    this.discoveredRegions.clear();

    const selectedTreasures = rng.pick(POI_POOLS.treasures, CONFIG.POI_COUNTS.TREASURES);
    const selectedVaults = rng.pick(POI_POOLS.vaults, CONFIG.POI_COUNTS.VAULTS);
    const selectedClues = rng.pick(POI_POOLS.clues, CONFIG.POI_COUNTS.CLUES);
    const selectedMissions = rng.pick(POI_POOLS.missions, CONFIG.POI_COUNTS.MISSIONS);
    const selectedSwitch = rng.pick(POI_POOLS.secretSwitches, 1)[0];
    const selectedPortals = rng.pick(POI_POOLS.portalPairs, CONFIG.POI_COUNTS.PORTAL_PAIRS);
    const selectedMerchants = rng.pick(POI_POOLS.merchants, CONFIG.POI_COUNTS.MERCHANTS);

    this.seededPois = {
      seed: this.matchSeed,
      treasures: selectedTreasures,
      vaults: selectedVaults,
      clues: selectedClues,
      missions: selectedMissions,
      secretSwitch: selectedSwitch,
      portals: selectedPortals,
      merchants: selectedMerchants
    };

    console.log(`[Map] Initialized Seeded Match Layout [Seed: #${this.matchSeed}]`);
  }

  startTickLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      this.tick();
    }, CONFIG.TICK_INTERVAL_MS);
  }

  tick() {
    const startTime = performance.now();
    const dt = CONFIG.TICK_INTERVAL_MS / 1000; // 0.05s

    if (this.state === CONFIG.STATES.RUNNING) {
      const activePlayerList = Array.from(this.players.values()).filter(p => p.connected);

      // 1. Authoritative movement and physics
      for (const player of activePlayerList) {
        this.updatePlayerMovement(player, dt);
      }

      // 2. Wall collisions with smooth sliding response
      for (const player of activePlayerList) {
        this.resolveWallCollisions(player);
      }

      // 3. Soft Player-vs-Player body-blocking (pushing)
      this.resolvePlayerCollisions(activePlayerList);

      // 4. Region Entry & First Discovery tracking
      this.checkRegionDiscoveries(activePlayerList);

      // 5. Broadcast compact 20Hz snapshot
      this.broadcastSnapshot();
    }

    this.lastTickComputationMs = performance.now() - startTime;
  }

  updatePlayerMovement(player, dt) {
    const inputX = player.input.x || 0;
    const inputY = player.input.y || 0;
    const inputMag = Math.hypot(inputX, inputY);

    // Check if player is wading in water without being on a bridge
    const inRiver = this.isInRiver(player.x, player.y);
    const onBridge = this.isOnBridge(player.x, player.y);
    const speedMult = (inRiver && !onBridge) ? CONFIG.PHYSICS.RIVER_SPEED_MULTIPLIER : 1.0;

    const maxSpeed = CONFIG.PHYSICS.MAX_SPEED * speedMult;
    const acceleration = CONFIG.PHYSICS.ACCELERATION * speedMult;

    if (inputMag > 0.01) {
      const normX = inputX / (inputMag > 1 ? inputMag : 1);
      const normY = inputY / (inputMag > 1 ? inputMag : 1);

      player.vx += normX * acceleration * dt;
      player.vy += normY * acceleration * dt;

      const speed = Math.hypot(player.vx, player.vy);
      if (speed > maxSpeed) {
        player.vx = (player.vx / speed) * maxSpeed;
        player.vy = (player.vy / speed) * maxSpeed;
      }
    }

    // Friction damping
    player.vx *= CONFIG.PHYSICS.FRICTION;
    player.vy *= CONFIG.PHYSICS.FRICTION;

    if (Math.abs(player.vx) < 0.1) player.vx = 0;
    if (Math.abs(player.vy) < 0.1) player.vy = 0;

    // Position integration
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // World boundary clamping
    const r = CONFIG.PHYSICS.PLAYER_RADIUS;
    player.x = Math.max(r, Math.min(CONFIG.WORLD.WIDTH - r, player.x));
    player.y = Math.max(r, Math.min(CONFIG.WORLD.HEIGHT - r, player.y));
  }

  // Circle vs AABB Rectangle Collision with Smooth Normal Sliding
  resolveWallCollisions(player) {
    const r = CONFIG.PHYSICS.PLAYER_RADIUS;

    for (const wall of this.activeWalls) {
      // Find closest point on rectangle to player circle center
      const closestX = Math.max(wall.x, Math.min(player.x, wall.x + wall.width));
      const closestY = Math.max(wall.y, Math.min(player.y, wall.y + wall.height));

      const deltaX = player.x - closestX;
      const deltaY = player.y - closestY;
      const distSq = deltaX * deltaX + deltaY * deltaY;

      if (distSq < r * r) {
        // Overlap detected
        if (distSq < 0.0001) {
          // Player center is inside rectangle: push out along shallowest axis
          const leftDist = player.x - wall.x;
          const rightDist = (wall.x + wall.width) - player.x;
          const topDist = player.y - wall.y;
          const bottomDist = (wall.y + wall.height) - player.y;
          const minDist = Math.min(leftDist, rightDist, topDist, bottomDist);

          if (minDist === leftDist) { player.x = wall.x - r; player.vx = 0; }
          else if (minDist === rightDist) { player.x = wall.x + wall.width + r; player.vx = 0; }
          else if (minDist === topDist) { player.y = wall.y - r; player.vy = 0; }
          else { player.y = wall.y + wall.height + r; player.vy = 0; }
        } else {
          const dist = Math.sqrt(distSq);
          const nx = deltaX / dist;
          const ny = deltaY / dist;
          const penetration = r - dist;

          // Push player out along contact normal
          player.x += nx * penetration;
          player.y += ny * penetration;

          // Project velocity along wall surface for smooth sliding
          const velAlongNormal = player.vx * nx + player.vy * ny;
          if (velAlongNormal < 0) {
            player.vx -= velAlongNormal * nx;
            player.vy -= velAlongNormal * ny;
          }
        }
      }
    }
  }

  // Soft Player-vs-Player Body-Blocking (Pushing)
  resolvePlayerCollisions(playerList) {
    const r = CONFIG.PHYSICS.PLAYER_RADIUS;
    const minDist = r * 2;
    const pushFactor = CONFIG.PHYSICS.PLAYER_PUSH_FORCE;

    for (let i = 0; i < playerList.length; i++) {
      for (let j = i + 1; j < playerList.length; j++) {
        const p1 = playerList[i];
        const p2 = playerList[j];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDist * minDist && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * pushFactor * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;

          p1.x -= nx * overlap;
          p1.y -= ny * overlap;
          p2.x += nx * overlap;
          p2.y += ny * overlap;
        }
      }
    }
  }

  isInRiver(x, y) {
    for (const r of RIVER_ZONES) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return true;
      }
    }
    return false;
  }

  isOnBridge(x, y) {
    for (const b of BRIDGES) {
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        return true;
      }
    }
    return false;
  }

  checkRegionDiscoveries(playerList) {
    for (const player of playerList) {
      for (const region of MAP_REGIONS) {
        const b = region.bounds;
        if (player.x >= b.x && player.x <= b.x + b.width && player.y >= b.y && player.y <= b.y + b.height) {
          if (!this.discoveredRegions.has(region.id)) {
            this.discoveredRegions.set(region.id, {
              playerId: player.id,
              playerName: player.name,
              color: player.color.hex,
              timestamp: Date.now()
            });
            console.log(`[Discovery] 🌟 Racer "${player.name}" was FIRST to discover "${region.name}"!`);
          }
        }
      }
    }
  }

  handlePlayerInput(socketId, inputData) {
    const playerId = this.socketToPlayerId.get(socketId);
    if (!playerId) return;

    const player = this.players.get(playerId);
    if (!player) return;

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
      Array.from(this.players.values()).filter(p => p.connected).map(p => p.color.hex)
    );
    const available = CONFIG.PLAYER_COLORS.find(c => !usedColorHexes.has(c.hex));
    if (available) return available;

    const color = CONFIG.PLAYER_COLORS[this.colorIndex % CONFIG.PLAYER_COLORS.length];
    this.colorIndex++;
    return color;
  }

  // Calculate circular spawn positions around the central Start Plaza
  getPlazaSpawnPosition(index, total) {
    const count = Math.max(1, total);
    const angle = (index / count) * Math.PI * 2;
    const radius = CONFIG.SPAWN_PLAZA.RADIUS;
    return {
      x: Math.round(CONFIG.SPAWN_PLAZA.X + Math.cos(angle) * radius),
      y: Math.round(CONFIG.SPAWN_PLAZA.Y + Math.sin(angle) * radius)
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
      const spawn = this.getPlazaSpawnPosition(connectedCount, CONFIG.MAX_PLAYERS);

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
      console.log(`[GameManager] New racer joined: ${player.name} (${newPlayerId}) [Color: ${color.name}]`);
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

    // Fresh seeded layout for new match
    this.initSeededMap();

    // Spread players around central Start Plaza
    activePlayers.forEach((player, idx) => {
      const spawn = this.getPlazaSpawnPosition(idx, activePlayers.length);
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.input = { x: 0, y: 0, action: false };
    });

    this.state = CONFIG.STATES.RUNNING;
    console.log(`[GameManager] Match Started! Active racers: ${activePlayers.length} [Seed: #${this.matchSeed}]`);
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
      world: CONFIG.WORLD,
      seed: this.matchSeed,
      map: {
        regions: MAP_REGIONS,
        walls: this.activeWalls,
        bridges: BRIDGES,
        riverZones: RIVER_ZONES,
        pois: this.seededPois,
        secretDoorOpen: this.secretDoorOpen
      }
    };
  }

  broadcastFullState() {
    this.io.emit('game_state_update', this.getPublicState());
  }

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
