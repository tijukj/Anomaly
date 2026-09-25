// server/game/gameManager.js - Authoritative game lifecycle, timeline, physics, missions, clues & scoring
import { CONFIG } from '../config.js';
import { MAP_REGIONS, RIVER_ZONES, BRIDGES, STATIC_WALLS, SECRET_PASSAGE_WALL, POI_POOLS } from './mapData.js';
import { createRng } from './seededRng.js';
import { ScoringSystem } from './scoring.js';
import { InteractableManager } from './interactables.js';
import { MissionManager } from './missions.js';
import { ClueManager } from './clueManager.js';
import { AnomalyManager } from './anomalyManager.js';
import { HazardSentinelManager } from './sentinels.js';
import { PlayerStatsTracker } from './statsTracker.js';
import crypto from 'crypto';

export class GameManager {
  constructor(io) {
    this.io = io;
    this.state = CONFIG.STATES.LOBBY;
    this.players = new Map();
    this.socketToPlayerId = new Map();
    this.pendingJoinRequests = new Map();
    this.colorIndex = 0;
    this.tickInterval = null;
    this.lastTickComputationMs = 0;

    // Subsystems
    this.scoring = new ScoringSystem(io);
    this.scoring.setGameManager(this);
    this.statsTracker = new PlayerStatsTracker();
    this.clues = new ClueManager(this, this.scoring);
    this.interactables = new InteractableManager(this, this.scoring);
    this.missions = new MissionManager(this, this.scoring);
    this.anomalies = new AnomalyManager(this, this.scoring);
    this.sentinels = new HazardSentinelManager(this, this.scoring);

    // Lifecycle & Timeline
    this.totalMatchDurationSec = CONFIG.DEBUG_SHORT_MATCH ? CONFIG.SHORT_MATCH_DURATION_SEC : CONFIG.STANDARD_MATCH_DURATION_SEC;
    this.matchTimeRemaining = this.totalMatchDurationSec;
    this.countdownRemaining = CONFIG.COUNTDOWN_DURATION_SEC;
    this.countdownInterval = null;
    this.lastFinalCountdownCount = 0;
    this.finalMatchResults = null;
    this.currentPhaseIndex = 0;
    this.currentPhase = CONFIG.PHASES[0];

    // Map & Seed state
    this.matchSeed = Math.floor(Math.random() * 900000) + 100000;
    this.seededPois = null;
    this.secretDoorOpen = false;
    this.activeWalls = [...STATIC_WALLS, SECRET_PASSAGE_WALL];
    this.discoveredRegions = new Map();

    this.initSeededMap();
    this.startTickLoop();
  }

  initSeededMap() {
    this.matchSeed = Math.floor(Math.random() * 900000) + 100000;
    const rng = createRng(this.matchSeed);

    this.secretDoorOpen = false;
    this.activeWalls = [...STATIC_WALLS, SECRET_PASSAGE_WALL];
    this.discoveredRegions.clear();
    this.currentPhaseIndex = 0;
    this.currentPhase = CONFIG.PHASES[0];
    this.totalMatchDurationSec = CONFIG.DEBUG_SHORT_MATCH ? CONFIG.SHORT_MATCH_DURATION_SEC : CONFIG.STANDARD_MATCH_DURATION_SEC;
    this.matchTimeRemaining = this.totalMatchDurationSec;
    this.lastFinalCountdownCount = 0;
    this.finalMatchResults = null;
    if (this.statsTracker) {
      this.statsTracker.reset();
      for (const p of this.players.values()) {
        this.statsTracker.registerPlayer(p);
      }
    }

    const selectedTreasures = rng.pick(POI_POOLS.treasures, CONFIG.POI_COUNTS.TREASURES);
    const selectedChests = rng.pick(POI_POOLS.chests, CONFIG.POI_COUNTS.CHESTS);
    const selectedVaults = rng.pick(POI_POOLS.vaults, CONFIG.POI_COUNTS.VAULTS);
    const selectedClues = rng.pick(POI_POOLS.clues, CONFIG.POI_COUNTS.CLUES);
    const selectedMissions = rng.pick(POI_POOLS.missions, CONFIG.POI_COUNTS.MISSIONS);
    const selectedSwitch = rng.pick(POI_POOLS.secretSwitches, 1)[0];
    const selectedPortals = rng.pick(POI_POOLS.portalPairs, CONFIG.POI_COUNTS.PORTAL_PAIRS);
    const selectedMerchants = rng.pick(POI_POOLS.merchants, CONFIG.POI_COUNTS.MERCHANTS);

    this.seededPois = {
      seed: this.matchSeed,
      treasures: selectedTreasures,
      chests: selectedChests,
      vaults: selectedVaults,
      clues: selectedClues,
      missions: selectedMissions,
      secretSwitch: selectedSwitch,
      portals: selectedPortals,
      merchants: selectedMerchants
    };

    this.clues.initForMatch(this.matchSeed);
    this.interactables.initForMatch(this.matchSeed, this.seededPois, this.currentPhase);
    this.missions.initForMatch(this.matchSeed);
    this.anomalies.initForMatch(this.matchSeed);
    this.sentinels.initForMatch(this.matchSeed);
    console.log(`[Map] Seeded Match Initialized [Seed: #${this.matchSeed}] [Duration: ${this.totalMatchDurationSec}s]`);
  }

  startTickLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      this.tick();
    }, CONFIG.TICK_INTERVAL_MS);
  }

  tick() {
    const startTime = performance.now();
    const dt = CONFIG.TICK_INTERVAL_MS / 1000;

    if (this.state === CONFIG.STATES.RUNNING) {
      // 1. Update Match Timeline
      this.matchTimeRemaining = Math.max(0, this.matchTimeRemaining - dt);
      const elapsedFraction = 1.0 - (this.matchTimeRemaining / this.totalMatchDurationSec);

      // Check Phase Transition
      this.updateMatchPhase(elapsedFraction);

      // Final 10-Second Countdown (Host & Phone Vibration)
      if (this.matchTimeRemaining <= 10 && this.matchTimeRemaining > 0) {
        const count = Math.ceil(this.matchTimeRemaining);
        if (this.lastFinalCountdownCount !== count) {
          this.lastFinalCountdownCount = count;
          this.io.emit('final_countdown_tick', { count });
        }
      }

      // Check Match End
      if (this.matchTimeRemaining <= 0) {
        this.endMatch();
      }

      const activePlayerList = Array.from(this.players.values()).filter(p => p.connected);

      // 2. Authoritative physics & collisions
      for (const player of activePlayerList) {
        this.updatePlayerMovement(player, dt);
      }

      for (const player of activePlayerList) {
        this.resolveWallCollisions(player);
      }

      this.resolvePlayerCollisions(activePlayerList);
      this.checkRegionDiscoveries(activePlayerList);

      // 3. Clues & Timeline Triggers
      this.clues.tick(Date.now(), elapsedFraction);

      // 4. Interactables & Smart Action Button
      this.interactables.tick(activePlayerList, this.currentPhase);

      // 5. Dynamic Missions Lifecycle
      this.missions.tick(activePlayerList, this.matchTimeRemaining, this.totalMatchDurationSec);

      // 6. Phase 8 Anomalies Lifecycle
      this.anomalies.tick(Date.now(), activePlayerList, elapsedFraction, this.currentPhase);

      // 7. Hazard Sentinels (Roaming point-reducing drones)
      this.sentinels.tick(activePlayerList, dt, Date.now());

      // 8. Compute Live Leaderboard
      const leaderboard = this.scoring.getLeaderboard(this.players);
      const rankMap = new Map(leaderboard.map(item => [item.id, item]));

      // 7. Send Contextual HUD to each Phone Controller
      for (const player of activePlayerList) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          const rankInfo = rankMap.get(player.id) || { rank: 1, score: player.score || 0 };
          const missionData = this.missions.getPlayerHudMission(player);

          socket.emit('player_hud', {
            rank: rankInfo.rank,
            score: player.score || 0,
            hasKey: Boolean(player.hasKey),
            timeRemaining: Math.ceil(this.matchTimeRemaining),
            phaseName: this.currentPhase.name,
            mission: missionData.text,
            missionObj: missionData,
            actionBtn: player.smartAction || { available: false, label: 'ACTION', color: '#333344', progress: 0 }
          });
        }
      }

      // 8. Broadcast 20Hz Snapshot to Host
      this.broadcastSnapshot(leaderboard);
    }

    this.lastTickComputationMs = performance.now() - startTime;
  }

  updateMatchPhase(elapsedFraction) {
    for (let i = CONFIG.PHASES.length - 1; i >= 0; i--) {
      const phase = CONFIG.PHASES[i];
      if (elapsedFraction >= phase.fractionStart) {
        if (this.currentPhaseIndex !== i) {
          this.currentPhaseIndex = i;
          this.currentPhase = phase;
          console.log(`[Timeline] ⚡ Phase Changed -> ${phase.name} (${phase.subtitle})`);
          this.io.emit('phase_change', {
            phaseIndex: i,
            phase: phase
          });
        }
        break;
      }
    }
  }

  // --- Pre-Match Countdown Sequence ---
  startMatch() {
    // Automatically approve and admit all pending players waiting in the lobby
    this.approveAllJoins();

    const activePlayers = Array.from(this.players.values()).filter(p => p.connected);
    if (this.state !== CONFIG.STATES.LOBBY) return false;
    if (activePlayers.length < CONFIG.MIN_PLAYERS_TO_START) return false;

    this.initSeededMap();

    // Spawn players spread around Start Plaza
    activePlayers.forEach((player, idx) => {
      const spawn = this.getPlazaSpawnPosition(idx, activePlayers.length);
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.score = 0;
      player.hasKey = false;
      player.input = { x: 0, y: 0, action: false };
      player.currentRegionId = 'plaza';
      player.wasOnBridge = false;
    });

    this.state = CONFIG.STATES.COUNTDOWN;
    this.countdownRemaining = CONFIG.COUNTDOWN_DURATION_SEC;
    console.log(`[GameManager] Countdown Started (${CONFIG.COUNTDOWN_DURATION_SEC}s)...`);

    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      this.countdownRemaining--;
      this.io.emit('countdown_tick', { count: this.countdownRemaining });

      if (this.countdownRemaining <= 0) {
        clearInterval(this.countdownInterval);
        this.launchRunningMatch();
      }
    }, 1000);

    this.broadcastFullState();
    return true;
  }

  launchRunningMatch() {
    this.state = CONFIG.STATES.RUNNING;
    console.log(`[GameManager] 🏁 MATCH LAUNCHED! Duration: ${this.totalMatchDurationSec}s [Seed: #${this.matchSeed}]`);

    // Assign initial mission to all active players
    const activePlayers = Array.from(this.players.values()).filter(p => p.connected);
    for (const player of activePlayers) {
      this.missions.assignMission(player, 0);
    }

    this.broadcastFullState();
  }

  endMatch() {
    this.state = CONFIG.STATES.ENDED;
    console.log('[GameManager] 🏆 MATCH COMPLETED! Displaying final podium & awards.');

    // Freeze all player movement
    for (const p of this.players.values()) {
      p.vx = 0;
      p.vy = 0;
      p.input = { x: 0, y: 0, action: false };
    }

    const finalLeaderboard = this.statsTracker.computeFinalLeaderboard(this.players);
    const podium = finalLeaderboard.slice(0, 3);
    const awards = this.statsTracker.computeSpecialAwards(finalLeaderboard);
    const highlightCards = this.statsTracker.generateHighlightCards(finalLeaderboard, awards);

    this.finalMatchResults = {
      leaderboard: finalLeaderboard,
      podium,
      awards,
      highlightCards
    };

    this.io.emit('match_ended', this.finalMatchResults);
    this.broadcastFullState();
  }

  resetToLobby() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);

    this.state = CONFIG.STATES.LOBBY;
    this.matchTimeRemaining = this.totalMatchDurationSec;
    this.countdownRemaining = CONFIG.COUNTDOWN_DURATION_SEC;
    this.lastFinalCountdownCount = 0;
    this.finalMatchResults = null;
    this.statsTracker.reset();

    // Reset player scores & positions, keep connections intact
    const activePlayers = Array.from(this.players.values()).filter(p => p.connected);
    activePlayers.forEach((player, idx) => {
      const spawn = this.getPlazaSpawnPosition(idx, activePlayers.length);
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.score = 0;
      player.hasKey = false;
      player.input = { x: 0, y: 0, action: false };
      player.currentRegionId = 'plaza';
      player.wasOnBridge = false;
    });

    console.log('[GameManager] Reset to LOBBY (All players preserved).');
    this.broadcastFullState();
  }

  updatePlayerMovement(player, dt) {
    let inputX = player.input.x || 0;
    let inputY = player.input.y || 0;

    // Anomaly: Reverse Controls (inverts steering direction)
    if (this.anomalies && this.anomalies.isReverseControlsActive()) {
      inputX = -inputX;
      inputY = -inputY;
    }

    const inputMag = Math.hypot(inputX, inputY);

    const inRiver = this.isInRiver(player.x, player.y);
    const onBridge = this.isOnBridge(player.x, player.y);

    // Mission Event: Bridge Crossing
    if (onBridge && !player.wasOnBridge) {
      player.wasOnBridge = true;
      this.missions.onPlayerEvent(player, 'BRIDGE_CROSS', { bridgeId: 'bridge' });
    } else if (!onBridge) {
      player.wasOnBridge = false;
    }

    let currentMaxSpeed = CONFIG.PHYSICS.MAX_SPEED;

    // Anomaly: Speed Surge (1.5x multiplier)
    if (this.anomalies && this.anomalies.isSpeedSurgeActive()) {
      currentMaxSpeed *= CONFIG.ANOMALIES.SPEED_MULTIPLIER;
    }

    if (inRiver && !onBridge) {
      currentMaxSpeed *= CONFIG.PHYSICS.RIVER_SPEED_MULTIPLIER;
    }

    if (inputMag > 0.05) {
      const thrust = Math.min(1.0, inputMag);
      const targetVx = (inputX / inputMag) * currentMaxSpeed * thrust;
      const targetVy = (inputY / inputMag) * currentMaxSpeed * thrust;

      // Snappy responsive acceleration (reaching target velocity in <100ms)
      const blendFactor = Math.min(1.0, dt * 16);
      player.vx += (targetVx - player.vx) * blendFactor;
      player.vy += (targetVy - player.vy) * blendFactor;
    } else {
      // Immediate crisp deceleration when thumb is released (no ice-skating)
      const brakeFactor = Math.min(1.0, dt * 20);
      player.vx += (0 - player.vx) * brakeFactor;
      player.vy += (0 - player.vy) * brakeFactor;
    }

    // Velocity Clamping
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > currentMaxSpeed) {
      player.vx = (player.vx / speed) * currentMaxSpeed;
      player.vy = (player.vy / speed) * currentMaxSpeed;
    }

    if (Math.abs(player.vx) < 0.2) player.vx = 0;
    if (Math.abs(player.vy) < 0.2) player.vy = 0;

    // Apply Position
    const prevX = player.x;
    const prevY = player.y;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (this.statsTracker) {
      this.statsTracker.recordMovement(player, player.x - prevX, player.y - prevY);
    }

    // World Boundary Hard Clamping
    const r = CONFIG.PHYSICS.PLAYER_RADIUS;
    player.x = Math.max(r + 20, Math.min(CONFIG.WORLD.WIDTH - r - 20, player.x));
    player.y = Math.max(r + 20, Math.min(CONFIG.WORLD.HEIGHT - r - 20, player.y));
  }

  resolveWallCollisions(player) {
    const r = CONFIG.PHYSICS.PLAYER_RADIUS;

    for (const wall of this.activeWalls) {
      const closestX = Math.max(wall.x, Math.min(player.x, wall.x + wall.width));
      const closestY = Math.max(wall.y, Math.min(player.y, wall.y + wall.height));

      const deltaX = player.x - closestX;
      const deltaY = player.y - closestY;
      const distSq = deltaX * deltaX + deltaY * deltaY;

      if (distSq < r * r) {
        if (distSq < 0.0001) {
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

          player.x += nx * penetration;
          player.y += ny * penetration;

          const velAlongNormal = player.vx * nx + player.vy * ny;
          if (velAlongNormal < 0) {
            player.vx -= velAlongNormal * nx;
            player.vy -= velAlongNormal * ny;
          }
        }
      }
    }
  }

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
          // Track region entry for missions
          if (player.currentRegionId !== region.id) {
            player.currentRegionId = region.id;
            this.missions.onPlayerEvent(player, 'REGION_ENTER', { regionId: region.id });
          }

          // First-time region discovery point award
          if (!this.discoveredRegions.has(region.id)) {
            this.discoveredRegions.set(region.id, {
              playerId: player.id,
              playerName: player.name,
              color: player.color.hex,
              timestamp: Date.now()
            });
            if (this.statsTracker) {
              this.statsTracker.recordFirstDiscovery(player, region.id);
            }
            this.scoring.awardPoints(player, CONFIG.SCORING.DISCOVERY_BONUS, `EXPLORED ${region.name}`, { x: player.x, y: player.y });
          }
        }
      }
    }
  }

  handlePlayerInput(socketId, inputData) {
    let playerId = (inputData && inputData.playerId) || this.socketToPlayerId.get(socketId);
    if (!playerId) {
      // Fallback: check if any player has this socketId
      const p = Array.from(this.players.values()).find(pl => pl.socketId === socketId);
      if (p) {
        playerId = p.id;
        this.socketToPlayerId.set(socketId, p.id);
      }
    }
    if (!playerId) return;

    const player = this.players.get(playerId);
    if (!player) return;

    // Keep player's socketId and mapping up to date
    if (player.socketId !== socketId) {
      player.socketId = socketId;
      this.socketToPlayerId.set(socketId, player.id);
    }
    player.connected = true;

    // Movement allowed only during RUNNING
    if (this.state !== CONFIG.STATES.RUNNING) {
      player.input = { x: 0, y: 0, action: false };
      return;
    }

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

  getAvailableAnimal(colorHex) {
    const colorIndex = CONFIG.PLAYER_COLORS.findIndex(c => c.hex === colorHex);
    const animalIndex = colorIndex >= 0 ? colorIndex % CONFIG.PLAYER_ANIMALS.length : 0;
    return CONFIG.PLAYER_ANIMALS[animalIndex] || CONFIG.PLAYER_ANIMALS[0];
  }

  getPlazaSpawnPosition(index, total) {
    const count = Math.max(1, total);
    const angle = (index / count) * Math.PI * 2;
    const radius = CONFIG.SPAWN_PLAZA.RADIUS;
    return {
      x: Math.round(CONFIG.SPAWN_PLAZA.X + Math.cos(angle) * radius),
      y: Math.round(CONFIG.SPAWN_PLAZA.Y + Math.sin(angle) * radius)
    };
  }

  // Join Request Gate (Host can approve, bots & rejoins fast-tracked)
  requestPlayerJoin(socket, { playerId, name, isBot }) {
    const sanitizedName = (name || 'RACER').trim().slice(0, CONFIG.MAX_NAME_LENGTH) || 'RACER';
    const isRejoin = Boolean(playerId && this.players.has(playerId));

    // Fast-path: Bots and Rejoining racers immediately connect without blocking
    if (isBot || isRejoin) {
      this.registerOrReconnectPlayer(socket, { playerId, name: sanitizedName });
      return;
    }

    const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
    const pendingEntry = {
      requestId,
      socketId: socket.id,
      playerId,
      name: sanitizedName,
      isRejoin,
      timestamp: Date.now()
    };

    this.pendingJoinRequests.set(requestId, pendingEntry);

    // Notify player controller that they are in the approval queue
    socket.emit('join_pending', {
      requestId,
      name: sanitizedName,
      message: 'Awaiting host approval on big screen...'
    });

    // Notify host screen with join request
    this.broadcastPendingRequests();
    console.log(`[GameManager] Join request created: ${sanitizedName} (req: ${requestId})`);
  }

  approvePlayerJoin(requestId) {
    let req = null;
    if (requestId) {
      req = this.pendingJoinRequests.get(requestId);
    } else if (this.pendingJoinRequests.size > 0) {
      // Pick first request if no ID provided
      req = this.pendingJoinRequests.values().next().value;
    }
    if (!req) return;

    this.pendingJoinRequests.delete(req.requestId);
    const socket = this.io.sockets.sockets.get(req.socketId);
    if (socket) {
      this.registerOrReconnectPlayer(socket, { playerId: req.playerId, name: req.name });
    }
    this.broadcastPendingRequests();
  }

  rejectPlayerJoin(requestId) {
    let req = null;
    if (requestId) {
      req = this.pendingJoinRequests.get(requestId);
    } else if (this.pendingJoinRequests.size > 0) {
      req = this.pendingJoinRequests.values().next().value;
    }
    if (!req) return;

    this.pendingJoinRequests.delete(req.requestId);
    const socket = this.io.sockets.sockets.get(req.socketId);
    if (socket) {
      socket.emit('join_rejected', { message: 'Host declined your join request.' });
    }
    this.broadcastPendingRequests();
  }

  approveAllJoins() {
    const list = Array.from(this.pendingJoinRequests.values());
    this.pendingJoinRequests.clear();
    for (const req of list) {
      const socket = this.io.sockets.sockets.get(req.socketId);
      if (socket) {
        this.registerOrReconnectPlayer(socket, { playerId: req.playerId, name: req.name });
      }
    }
    this.broadcastPendingRequests();
  }

  broadcastPendingRequests() {
    const list = Array.from(this.pendingJoinRequests.values()).map(r => ({
      requestId: r.requestId,
      name: r.name,
      isRejoin: r.isRejoin,
      timestamp: r.timestamp
    }));
    this.io.emit('pending_join_requests', { requests: list, count: list.length });
  }

  registerOrReconnectPlayer(socket, { playerId, name }) {
    const sanitizedName = (name || 'PLAYER').trim().slice(0, CONFIG.MAX_NAME_LENGTH) || 'PLAYER';
    let player = null;

    if (playerId && this.players.has(playerId)) {
      player = this.players.get(playerId);
      player.socketId = socket.id;
      player.connected = true;
      if (name) player.name = sanitizedName;
      console.log(`[GameManager] Player reconnected: ${player.name} (${playerId}) [Score: ${player.score || 0}]`);
    } else {
      const connectedCount = Array.from(this.players.values()).filter(p => p.connected).length;
      if (connectedCount >= CONFIG.MAX_PLAYERS) {
        socket.emit('error_message', { message: 'Lobby is full (maximum 20 players).' });
        return null;
      }

      const newPlayerId = playerId || crypto.randomUUID();
      const color = this.getAvailableColor();
      const animal = this.getAvailableAnimal(color.hex);
      const spawn = this.getPlazaSpawnPosition(connectedCount, CONFIG.MAX_PLAYERS);

      player = {
        id: newPlayerId,
        socketId: socket.id,
        name: sanitizedName,
        color: color,
        animal: animal,
        connected: true,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        score: 0,
        hasKey: false,
        input: { x: 0, y: 0, action: false },
        currentRegionId: 'plaza',
        wasOnBridge: false
      };

      this.players.set(newPlayerId, player);

      // Late Joiner during running match
      if (this.state === CONFIG.STATES.RUNNING) {
        const elapsed = 1.0 - (this.matchTimeRemaining / this.totalMatchDurationSec);
        this.missions.assignMission(player, elapsed);
      }

      console.log(`[GameManager] New player registered: ${player.name} (${newPlayerId}) [Animal: ${animal.name}]`);
    }

    if (this.statsTracker) {
      this.statsTracker.registerPlayer(player);
    }

    this.socketToPlayerId.set(socket.id, player.id);

    socket.emit('joined_success', {
      player: {
        id: player.id,
        name: player.name,
        color: player.color,
        animal: player.animal,
        score: player.score || 0
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
      console.log(`[GameManager] Player disconnected: ${player.name} (${playerId})`);
      this.broadcastFullState();
    }
  }

  getPublicState() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.connected);
    const pendingList = Array.from(this.pendingJoinRequests.values()).map(r => ({
      requestId: r.requestId,
      name: r.name,
      isRejoin: r.isRejoin
    }));

    return {
      state: this.state,
      countdown: this.countdownRemaining,
      timeRemaining: Math.ceil(this.matchTimeRemaining),
      phaseIndex: this.currentPhaseIndex,
      phase: this.currentPhase,
      playerCount: activePlayers.length,
      canStart: activePlayers.length >= CONFIG.MIN_PLAYERS_TO_START,
      seed: this.matchSeed,
      clueState: this.clues ? this.clues.getPublicClueState() : null,
      pendingRequests: pendingList,
      finalResults: this.finalMatchResults || null,
      players: activePlayers.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        animal: p.animal || this.getAvailableAnimal(p.color ? p.color.hex : ''),
        score: p.score || 0,
        hasKey: Boolean(p.hasKey)
      }))
    };
  }

  broadcastFullState() {
    this.io.emit('game_state_update', this.getPublicState());
  }

  broadcastSnapshot(leaderboard) {
    const activePlayers = Array.from(this.players.values())
      .filter(p => p.connected)
      .map(p => ({
        id: p.id,
        name: p.name,
        colorNum: p.color.num,
        colorHex: p.color.hex,
        animalId: p.animal ? p.animal.id : this.getAvailableAnimal(p.color.hex).id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        score: p.score || 0,
        hasKey: Boolean(p.hasKey)
      }));

    const snapshot = {
      t: Date.now(),
      st: Math.round(this.lastTickComputationMs * 100) / 100,
      tr: Math.ceil(this.matchTimeRemaining),
      pi: this.currentPhaseIndex,
      sd: this.secretDoorOpen,
      p: activePlayers,
      e: this.interactables.getVisibleEntities(),
      lb: leaderboard.slice(0, 5), // Top 5 leaderboard for host HUD
      clues: this.clues ? this.clues.getPublicClueState() : null,
      anomalies: this.anomalies ? this.anomalies.getActiveState() : null,
      sentinels: this.sentinels ? this.sentinels.getActiveSentinels() : []
    };

    this.io.emit('snapshot', snapshot);
  }

  triggerDebugAnomaly(anomalyIndex) {
    const anomalyMap = [
      'TREASURE_RAIN',
      'SPEED_SURGE',
      'TELEPORT_STORM',
      'FOG',
      'DOUBLE_POINTS',
      'VAULT_ACTIVATION',
      'REVERSE_CONTROLS',
      'GOLDEN_CROWN'
    ];
    const targetId = anomalyMap[anomalyIndex - 1] || 'TREASURE_RAIN';
    if (this.anomalies && this.state === CONFIG.STATES.RUNNING) {
      this.anomalies.activateAnomaly(targetId);
    }
  }
}
