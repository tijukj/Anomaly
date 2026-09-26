// server/game/anomalyManager.js - Authoritative Anomaly System (Phase 8)
import { CONFIG } from '../config.js';
import { createRng } from './seededRng.js';

export const ANOMALY_TYPES = [
  {
    id: 'TREASURE_RAIN',
    name: 'TREASURE RAIN',
    subtitle: 'EXTRA TREASURES BURST ACROSS THE ARENA',
    colorHex: '#00F0FF',
    durationSec: CONFIG.ANOMALIES.TREASURE_RAIN_DURATION_SEC || 20
  },
  {
    id: 'SPEED_SURGE',
    name: 'SPEED SURGE',
    subtitle: 'ALL RACERS OVERCLOCKED (1.5X SPEED)',
    colorHex: '#39FF14',
    durationSec: CONFIG.ANOMALIES.SPEED_SURGE_DURATION_SEC || 18
  },
  {
    id: 'TELEPORT_STORM',
    name: 'TELEPORT STORM',
    subtitle: 'REALITY GLITCH: ALL RACERS WARPED',
    colorHex: '#FF00FF',
    durationSec: CONFIG.ANOMALIES.TELEPORT_STORM_DURATION_SEC || 15
  },
  {
    id: 'FOG',
    name: 'CYBER FOG',
    subtitle: 'ARENA VISIBILITY REDUCED TO RACER RADAR',
    colorHex: '#8888AA',
    durationSec: CONFIG.ANOMALIES.CYBER_FOG_DURATION_SEC || 22
  },
  {
    id: 'DOUBLE_POINTS',
    name: 'DOUBLE OVERDRIVE',
    subtitle: 'ALL SCORE REWARDS MULTIPLIED (2X)',
    colorHex: '#FFE600',
    durationSec: CONFIG.ANOMALIES.DOUBLE_OVERDRIVE_DURATION_SEC || 20
  },
  {
    id: 'VAULT_ACTIVATION',
    name: 'VAULT ACTIVATION',
    subtitle: 'ALL ANCIENT VAULTS ACCESSIBLE WITHOUT KEYS',
    colorHex: '#FF8800',
    durationSec: CONFIG.ANOMALIES.VAULT_ACTIVATION_DURATION_SEC || 20
  },
  {
    id: 'REVERSE_CONTROLS',
    name: 'CONTROL INVERSION',
    subtitle: 'STEERING SENSORS INVERTED (6 SECONDS)',
    colorHex: '#FF0055',
    durationSec: CONFIG.ANOMALIES.CONTROL_INVERSION_DURATION_SEC || 6
  },
  {
    id: 'GOLDEN_CROWN',
    name: 'GOLDEN CROWN',
    subtitle: 'HOLD THE CROWN FOR PASSIVE OVERTIME POINTS',
    colorHex: '#FFE600',
    durationSec: CONFIG.ANOMALIES.GOLDEN_CROWN_DURATION_SEC || 25
  }
];

export class AnomalyManager {
  constructor(gameManager, scoring) {
    this.gameManager = gameManager;
    this.scoring = scoring;
    this.rng = createRng(13579);
    this.activeAnomalies = [];
    this.lastAnomalyType = null;
    this.nextAnomalyTime = 0;
    this.rainTreasures = [];

    // Crown state
    this.crownState = {
      active: false,
      holderId: null,
      holderName: null,
      x: 800,
      y: 530,
      stealProtectionUntil: 0,
      lastTickAwardTime: 0
    };

    // Anomaly stats tracking for match recap
    this.stats = {
      anomaliesTriggered: 0,
      pointsUnderDouble: 0,
      crownHoldTimes: new Map(), // playerId -> total seconds
      rainTreasuresCollected: 0
    };
  }

  initForMatch(seed) {
    this.rng = createRng(seed + 999);
    this.activeAnomalies = [];
    this.lastAnomalyType = null;
    this.nextAnomalyTime = Date.now() + 45000; // First anomaly 45s after match start
    this.rainTreasures = [];
    this.crownState = {
      active: false,
      holderId: null,
      holderName: null,
      x: 800,
      y: 530,
      stealProtectionUntil: 0,
      lastTickAwardTime: 0
    };
    this.stats = {
      anomaliesTriggered: 0,
      pointsUnderDouble: 0,
      crownHoldTimes: new Map(),
      rainTreasuresCollected: 0
    };
    console.log('[AnomalyManager] Initialized for match.');
  }

  // 20Hz Tick
  tick(now, activePlayers, elapsedFraction, currentPhase) {
    // 1. Check expiration of active anomalies
    for (let i = this.activeAnomalies.length - 1; i >= 0; i--) {
      const anomaly = this.activeAnomalies[i];
      if (now >= anomaly.expiresAt) {
        this.endAnomaly(anomaly);
        this.activeAnomalies.splice(i, 1);
      }
    }

    // 2. Schedule regular anomaly trigger (every 60s)
    const maxConcurrent = (currentPhase && currentPhase.id === 'chaos') ? 2 : 1;
    if (this.activeAnomalies.length < maxConcurrent && now >= this.nextAnomalyTime) {
      this.triggerRandomAnomaly(currentPhase);
      this.nextAnomalyTime = now + 60000;
    }

    // 3. Process Crown logic if active
    if (this.crownState.active) {
      this.processCrown(now, activePlayers);
    }
  }

  // Pool filtering by phase
  getEligibleAnomalyTypes(currentPhase) {
    const phaseId = (currentPhase && currentPhase.id) || 'discovery';
    if (phaseId === 'discovery') {
      // Phase 1: Only mild events (Treasure Rain & Speed Surge)
      return ANOMALY_TYPES.filter(a => a.id === 'TREASURE_RAIN' || a.id === 'SPEED_SURGE');
    }
    // Phase 2, 3, 4: All 8 anomalies eligible
    return ANOMALY_TYPES;
  }

  triggerRandomAnomaly(currentPhase) {
    const eligible = this.getEligibleAnomalyTypes(currentPhase);
    const candidates = eligible.filter(a => a.id !== this.lastAnomalyType && !this.activeAnomalies.some(cur => cur.id === a.id));
    const pool = candidates.length > 0 ? candidates : eligible;

    const chosenDef = this.rng.pick(pool, 1)[0];
    if (chosenDef) {
      this.activateAnomaly(chosenDef.id);
    }
  }

  // Activate a specific anomaly (used by timeline or debug keys 1-8)
  activateAnomaly(anomalyId) {
    const def = ANOMALY_TYPES.find(a => a.id === anomalyId) || ANOMALY_TYPES[0];
    const now = Date.now();
    const durationMs = def.durationSec * 1000;

    const anomaly = {
      id: def.id,
      name: def.name,
      subtitle: def.subtitle,
      colorHex: def.colorHex,
      startedAt: now,
      expiresAt: now + durationMs,
      durationSec: def.durationSec
    };

    // Remove if already active to refresh duration
    const existingIdx = this.activeAnomalies.findIndex(a => a.id === def.id);
    if (existingIdx !== -1) {
      this.activeAnomalies.splice(existingIdx, 1);
    }

    this.activeAnomalies.push(anomaly);
    this.lastAnomalyType = def.id;
    this.stats.anomaliesTriggered++;

    console.log(`[Anomaly] ⚡ ACTIVATED: ${def.name} (${def.durationSec}s)`);

    // Apply immediate effect
    this.onAnomalyStart(def.id, now);

    // Broadcast event to host & players
    this.gameManager.io.emit('anomaly_start', {
      anomaly: anomaly,
      activeAnomalies: this.activeAnomalies
    });

    this.gameManager.io.emit('host_event', {
      id: Math.random().toString(36).substring(2, 9),
      type: 'anomaly',
      text: `🌀 ANOMALY: ${def.name} (${def.durationSec}s) - ${def.subtitle}`,
      colorHex: def.colorHex,
      timestamp: now
    });
  }

  onAnomalyStart(anomalyId, now) {
    switch (anomalyId) {
      case 'TREASURE_RAIN':
        this.spawnTreasureRain();
        break;

      case 'TELEPORT_STORM':
        this.performTeleportStorm();
        break;

      case 'GOLDEN_CROWN':
        this.spawnGoldenCrown(now);
        break;
    }
  }

  endAnomaly(anomaly) {
    console.log(`[Anomaly] ⏱️ ENDED: ${anomaly.name}`);

    if (anomaly.id === 'TREASURE_RAIN') {
      // Remove uncollected burst treasures
      for (const t of this.rainTreasures) {
        this.gameManager.interactables.entities.delete(t.id);
      }
      this.rainTreasures = [];
    } else if (anomaly.id === 'GOLDEN_CROWN') {
      this.crownState.active = false;
      this.crownState.holderId = null;
      this.crownState.holderName = null;
    }

    this.gameManager.io.emit('anomaly_end', {
      anomalyId: anomaly.id,
      activeAnomalies: this.activeAnomalies.filter(a => a.id !== anomaly.id)
    });
  }

  // 1. Treasure Rain
  spawnTreasureRain() {
    const rainSpots = [
      { x: 220, y: 200, region: 'forest' },
      { x: 400, y: 320, region: 'forest' },
      { x: 260, y: 720, region: 'forest' },
      { x: 740, y: 200, region: 'ruins' },
      { x: 880, y: 320, region: 'ruins' },
      { x: 1200, y: 220, region: 'castle' },
      { x: 1420, y: 320, region: 'castle' },
      { x: 1240, y: 880, region: 'cave' },
      { x: 1420, y: 840, region: 'cave' },
      { x: 800, y: 720, region: 'plaza' }
    ];

    const chosenSpots = this.rng.pick(rainSpots, 8);
    for (let i = 0; i < chosenSpots.length; i++) {
      const spot = chosenSpots[i];
      const id = `rain_t_${Date.now()}_${i}`;
      const entity = {
        id: id,
        type: 'treasure',
        tier: 'rare',
        isRain: true,
        points: 20,
        x: spot.x,
        y: spot.y,
        radius: CONFIG.INTERACT_RADIUS.TREASURE,
        colorHex: '#00F0FF',
        colorNum: 0x00f0ff,
        state: 'active',
        respawnAt: 0
      };

      this.rainTreasures.push(entity);
      this.gameManager.interactables.entities.set(id, entity);
    }
  }

  // 3. Teleport Storm
  performTeleportStorm() {
    const safeSpawnPositions = [
      { x: 800, y: 530 }, // Plaza
      { x: 250, y: 200 }, // Forest North
      { x: 250, y: 740 }, // Forest South
      { x: 780, y: 220 }, // Ruins
      { x: 1300, y: 340 }, // Castle
      { x: 1280, y: 700 }  // Cave
    ];

    const players = Array.from(this.gameManager.players.values()).filter(p => p.connected);
    players.forEach((p, idx) => {
      const target = safeSpawnPositions[idx % safeSpawnPositions.length];
      const jitterX = (Math.random() - 0.5) * 60;
      const jitterY = (Math.random() - 0.5) * 60;
      p.x = target.x + jitterX;
      p.y = target.y + jitterY;
      p.vx = 0;
      p.vy = 0;
    });

    console.log(`[Anomaly] ⚡ Teleport Storm shifted ${players.length} racers.`);
  }

  // 8. Golden Crown
  spawnGoldenCrown(now) {
    this.crownState = {
      active: true,
      holderId: null,
      holderName: null,
      x: 800,
      y: 530,
      stealProtectionUntil: 0,
      lastTickAwardTime: now
    };
  }

  processCrown(now, activePlayers) {
    if (!this.crownState.holderId) {
      // Grounded crown at (800, 530) - check pickup
      for (const p of activePlayers) {
        const dist = Math.hypot(p.x - this.crownState.x, p.y - this.crownState.y);
        if (dist <= 36) {
          this.crownState.holderId = p.id;
          this.crownState.holderName = p.name;
          this.crownState.stealProtectionUntil = now + (CONFIG.ANOMALIES.CROWN_STEAL_PROTECTION_SEC * 1000);
          this.crownState.lastTickAwardTime = now;

          this.scoring.awardPoints(p, 10, 'CLAIMED GOLDEN CROWN', { x: p.x, y: p.y });
          this.gameManager.io.emit('host_event', {
            id: Math.random().toString(36).substring(2, 9),
            type: 'crown_claimed',
            text: `👑 ${p.name} seized the GOLDEN CROWN! (+5 pts / 2s)`,
            colorHex: '#FFE600',
            timestamp: now
          });
          break;
        }
      }
    } else {
      // Crown is held by player
      const holder = activePlayers.find(p => p.id === this.crownState.holderId);
      if (!holder) {
        // Holder disconnected -> drop crown at plaza
        this.crownState.holderId = null;
        this.crownState.holderName = null;
        this.crownState.x = 800;
        this.crownState.y = 530;
        return;
      }

      // Update crown coordinates to follow holder
      this.crownState.x = holder.x;
      this.crownState.y = holder.y;

      // Award +5 points every 2 seconds
      if (now - this.crownState.lastTickAwardTime >= 2000) {
        this.crownState.lastTickAwardTime = now;
        this.scoring.awardPoints(holder, CONFIG.ANOMALIES.CROWN_POINTS_PER_TICK, 'CROWN REIGN (+5)', { x: holder.x, y: holder.y });

        // Update stats
        const currentSeconds = this.stats.crownHoldTimes.get(holder.id) || 0;
        this.stats.crownHoldTimes.set(holder.id, currentSeconds + 2);

        if (this.gameManager && this.gameManager.statsTracker) {
          this.gameManager.statsTracker.recordCrownHold(holder, 2);
        }
      }

      // Check for tag / steal by another player
      if (now >= this.crownState.stealProtectionUntil) {
        for (const p of activePlayers) {
          if (p.id === holder.id) continue;
          const dist = Math.hypot(p.x - holder.x, p.y - holder.y);
          if (dist <= 48) {
            // Steal crown!
            this.crownState.holderId = p.id;
            this.crownState.holderName = p.name;
            this.crownState.stealProtectionUntil = now + (CONFIG.ANOMALIES.CROWN_STEAL_PROTECTION_SEC * 1000);

            this.scoring.awardPoints(p, 15, 'STOLE THE CROWN!', { x: p.x, y: p.y });
            if (this.gameManager && this.gameManager.statsTracker) {
              this.gameManager.statsTracker.recordAnomalyAction(p, 5);
            }
            if (this.gameManager && typeof this.gameManager.recordCrownSteal === 'function') {
              this.gameManager.recordCrownSteal(p, holder, now);
            }
            this.gameManager.io.emit('host_event', {
              id: Math.random().toString(36).substring(2, 9),
              type: 'crown_stolen',
              text: `👑 ${p.name} STOLE the Crown from ${holder.name}!`,
              colorHex: p.color.hex,
              timestamp: now
            });
            break;
          }
        }
      }
    }
  }

  // Active state queries for physics & scoring
  isDoublePointsActive() {
    return this.activeAnomalies.some(a => a.id === 'DOUBLE_POINTS');
  }

  isSpeedSurgeActive() {
    return this.activeAnomalies.some(a => a.id === 'SPEED_SURGE');
  }

  isReverseControlsActive() {
    return this.activeAnomalies.some(a => a.id === 'REVERSE_CONTROLS');
  }

  isFogActive() {
    return this.activeAnomalies.some(a => a.id === 'FOG');
  }

  isVaultActivationActive() {
    return this.activeAnomalies.some(a => a.id === 'VAULT_ACTIVATION');
  }

  getActiveState() {
    return {
      activeAnomalies: this.activeAnomalies,
      crown: this.crownState.active ? {
        active: true,
        holderId: this.crownState.holderId,
        holderName: this.crownState.holderName,
        x: Math.round(this.crownState.x),
        y: Math.round(this.crownState.y)
      } : null,
      fog: this.isFogActive(),
      speedMultiplier: this.isSpeedSurgeActive() ? CONFIG.ANOMALIES.SPEED_MULTIPLIER : 1.0,
      reverseControls: this.isReverseControlsActive(),
      doublePoints: this.isDoublePointsActive()
    };
  }
}
