// server/game/interactables.js - Server-authoritative interactables, transient glitch treasures & clue triggers
import { CONFIG } from '../config.js';
import { POI_POOLS } from './mapData.js';
import { createRng } from './seededRng.js';

// Candidate spots for transient glitch treasures across regions
const GLITCH_SPOTS = [
  { x: 380, y: 150, region: 'forest' },
  { x: 200, y: 490, region: 'forest' },
  { x: 740, y: 220, region: 'ruins' },
  { x: 880, y: 340, region: 'ruins' },
  { x: 1380, y: 230, region: 'castle' },
  { x: 1220, y: 140, region: 'castle' },
  { x: 1280, y: 880, region: 'cave' },
  { x: 1420, y: 680, region: 'cave' },
  { x: 600, y: 530, region: 'river' },
  { x: 1050, y: 530, region: 'river' }
];

export class InteractableManager {
  constructor(gameManager, scoring) {
    this.gameManager = gameManager;
    this.scoring = scoring;
    this.entities = new Map();
    this.rng = createRng(12345);
    this.activeGlitch = null;
    this.nextGlitchSpawnAt = 0;
    this.recentClaims = new Map(); // claimId -> { winnerId, winnerName, targetName, x, y, claimedAt, notifiedPlayers }
    this.lastContestAlertTime = new Map(); // entityId -> lastAlertTimestamp
  }

  // Pick treasure tier based on current match phase spawn table
  getTierForPhase(phase) {
    const weights = (phase && phase.weights) ? phase.weights : { common: 0.6, rare: 0.3, epic: 0.1 };
    const rand = this.rng.random();

    if (rand < weights.common) return 'common';
    if (rand < weights.common + weights.rare) return 'rare';
    return 'epic';
  }

  applyTreasureTier(entity, tier) {
    entity.tier = tier;
    entity.points = tier === 'epic' ? CONFIG.SCORING.TREASURE_EPIC : (tier === 'rare' ? CONFIG.SCORING.TREASURE_RARE : CONFIG.SCORING.TREASURE_COMMON);
    entity.colorHex = tier === 'epic' ? '#FF0055' : (tier === 'rare' ? '#FFE600' : '#00F0FF');
    entity.colorNum = tier === 'epic' ? 0xff0055 : (tier === 'rare' ? 0xffe600 : 0x00f0ff);
  }

  initForMatch(seed, seededPois, initialPhase) {
    this.entities.clear();
    this.recentClaims.clear();
    this.lastContestAlertTime.clear();
    this.rng = createRng(seed);
    this.activeGlitch = null;
    this.nextGlitchSpawnAt = Date.now() + 15000; // First glitch appears 15s after match start

    // 1. Treasures with Phase 1 initial tiers
    for (const t of (seededPois.treasures || [])) {
      const tier = this.getTierForPhase(initialPhase);
      const entity = {
        id: t.id,
        type: 'treasure',
        x: t.x,
        y: t.y,
        radius: CONFIG.INTERACT_RADIUS.TREASURE,
        state: 'active',
        respawnAt: 0
      };
      this.applyTreasureTier(entity, tier);
      this.entities.set(t.id, entity);
    }

    // 2. Chests (1s Hold to open)
    for (const ch of (seededPois.chests || [])) {
      this.entities.set(ch.id, {
        id: ch.id,
        type: 'chest',
        x: ch.x,
        y: ch.y,
        radius: CONFIG.INTERACT_RADIUS.CHEST,
        colorHex: '#FFAA00',
        colorNum: 0xffaa00,
        state: 'active',
        holdingPlayers: new Map(),
        respawnAt: 0
      });
    }

    // 3. Vaults (Require Key)
    for (const v of (seededPois.vaults || [])) {
      this.entities.set(v.id, {
        id: v.id,
        type: 'vault',
        name: v.name || 'Vault',
        x: v.x,
        y: v.y,
        radius: CONFIG.INTERACT_RADIUS.VAULT,
        points: CONFIG.SCORING.VAULT,
        colorHex: '#FF8800',
        colorNum: 0xff8800,
        state: 'active'
      });
    }

    // 4. Keys
    const keyPositions = this.rng.pick(POI_POOLS.keys, CONFIG.POI_COUNTS.KEYS);
    for (const k of keyPositions) {
      this.entities.set(k.id, {
        id: k.id,
        type: 'key',
        x: k.x,
        y: k.y,
        radius: CONFIG.INTERACT_RADIUS.KEY,
        colorHex: '#FFDD00',
        colorNum: 0xffdd00,
        state: 'active'
      });
    }

    // 5. Secret Switch
    if (seededPois.secretSwitch) {
      const sw = seededPois.secretSwitch;
      this.entities.set(sw.id, {
        id: sw.id,
        type: 'switch',
        x: sw.x,
        y: sw.y,
        radius: CONFIG.INTERACT_RADIUS.SWITCH,
        target: sw.target,
        colorHex: '#FF0055',
        colorNum: 0xff0055,
        state: 'active'
      });
    }

    // 6. Portals
    for (const pair of (seededPois.portals || [])) {
      this.entities.set(pair.id + '_a', {
        id: pair.id + '_a',
        type: 'portal',
        pairId: pair.id + '_b',
        x: pair.a.x,
        y: pair.a.y,
        targetPos: { x: pair.b.x, y: pair.b.y },
        radius: CONFIG.INTERACT_RADIUS.PORTAL,
        colorHex: '#00F0FF',
        colorNum: 0x00f0ff,
        state: 'active'
      });
      this.entities.set(pair.id + '_b', {
        id: pair.id + '_b',
        type: 'portal',
        pairId: pair.id + '_a',
        x: pair.b.x,
        y: pair.b.y,
        targetPos: { x: pair.a.x, y: pair.a.y },
        radius: CONFIG.INTERACT_RADIUS.PORTAL,
        colorHex: '#00F0FF',
        colorNum: 0x00f0ff,
        state: 'active'
      });
    }

    // 7. Merchants
    for (const m of (seededPois.merchants || [])) {
      this.entities.set(m.id, {
        id: m.id,
        type: 'merchant',
        name: m.name,
        x: m.x,
        y: m.y,
        radius: CONFIG.INTERACT_RADIUS.MERCHANT,
        colorHex: '#39FF14',
        colorNum: 0x39ff14,
        state: 'active'
      });
    }

    console.log(`[Interactables] Initialized ${this.entities.size} interactive entities for match.`);
  }

  // 20Hz Tick: Process respawns, glitch treasures, clues and update player prompts
  tick(activePlayers, currentPhase) {
    const now = Date.now();

    // 1. Process Standard Respawns with current phase weights
    for (const ent of this.entities.values()) {
      if (ent.state === 'collected' || ent.state === 'opened') {
        if (ent.respawnAt && now >= ent.respawnAt) {
          ent.state = 'active';
          ent.respawnAt = 0;
          if (ent.type === 'treasure') {
            const newTier = this.getTierForPhase(currentPhase);
            this.applyTreasureTier(ent, newTier);
          }
        }
      }
    }

    // 2. Process Transient Glitch / Anomaly Treasure Lifecycle
    this.tickGlitchTreasure(now);

    // 3. Process Contested High-Value Loot (Rare, Epic, Glitch, Vault, Legendary)
    this.tickContestedLoot(now, activePlayers);

    // 4. Process Near-Misses on Recently Claimed Loot
    this.tickNearMisses(now, activePlayers);

    // 5. Compute Smart Action Button & Process Interactions per player
    for (const player of activePlayers) {
      this.processPlayerInteractions(player, now);
    }
  }

  tickContestedLoot(now, activePlayers) {
    const contestedRadius = CONFIG.COMPETITIVE.CONTESTED_RADIUS || 75;
    const alertCooldown = CONFIG.COMPETITIVE.CONTESTED_COOLDOWN_MS || 3500;

    const allInteractables = [
      ...Array.from(this.entities.values()),
      ...(this.gameManager.clues ? this.gameManager.clues.getActiveEntities() : [])
    ];

    for (const ent of allInteractables) {
      if (ent.state !== 'active' && ent.state !== 'revealed') {
        ent.contested = null;
        continue;
      }

      // Only high-value loot triggers contested tension
      const isHighValue = (ent.type === 'treasure' && (ent.tier === 'rare' || ent.tier === 'epic')) ||
                          ent.type === 'glitch' ||
                          ent.type === 'vault' ||
                          ent.type === 'legendary_vault';

      if (!isHighValue) {
        ent.contested = null;
        continue;
      }

      const nearbyPlayers = [];
      for (const p of activePlayers) {
        const dist = Math.hypot(p.x - ent.x, p.y - ent.y);
        if (dist <= contestedRadius) {
          nearbyPlayers.push(p);
        }
      }

      if (nearbyPlayers.length >= 2) {
        ent.contested = {
          names: nearbyPlayers.map(p => p.name),
          playerIds: nearbyPlayers.map(p => p.id),
          count: nearbyPlayers.length
        };

        const lastAlert = this.lastContestAlertTime.get(ent.id) || 0;
        if (now - lastAlert >= alertCooldown) {
          this.lastContestAlertTime.set(ent.id, now);
          const targetName = ent.name || (ent.tier ? `${ent.tier.toUpperCase()} TREASURE` : ent.type.toUpperCase());
          const racersStr = `${nearbyPlayers[0].name} & ${nearbyPlayers[1].name}${nearbyPlayers.length > 2 ? ` (+${nearbyPlayers.length - 2})` : ''}`;

          this.gameManager.io.emit('host_event', {
            id: Math.random().toString(36).substring(2, 9),
            type: 'contested',
            text: `⚔️ CONTESTED! ${racersStr} racing for ${targetName}!`,
            colorHex: '#FF0055',
            timestamp: now
          });
        }
      } else {
        ent.contested = null;
      }
    }
  }

  tickNearMisses(now, activePlayers) {
    const windowMs = CONFIG.COMPETITIVE.NEAR_MISS_WINDOW_MS || 1000;
    const missRadius = CONFIG.COMPETITIVE.NEAR_MISS_RADIUS || 65;
    const displayMs = CONFIG.COMPETITIVE.NEAR_MISS_DISPLAY_MS || 2000;

    for (const [claimId, claim] of this.recentClaims.entries()) {
      if (now - claim.claimedAt > windowMs) {
        this.recentClaims.delete(claimId);
        continue;
      }

      for (const player of activePlayers) {
        if (player.id === claim.winnerId) continue;
        if (claim.notifiedPlayers.has(player.id)) continue;

        const dist = Math.hypot(player.x - claim.x, player.y - claim.y);
        if (dist <= missRadius) {
          claim.notifiedPlayers.add(player.id);

          // Emit Near-Miss Floating Toast for Host Screen
          this.gameManager.io.emit('near_miss_toast', {
            winnerName: claim.winnerName,
            runnerUpName: player.name,
            runnerUpColorHex: player.color ? player.color.hex : '#00F0FF',
            targetName: claim.targetName,
            x: claim.x,
            y: claim.y,
            durationMs: displayMs
          });

          // Log in Host Live Feed
          this.gameManager.io.emit('host_event', {
            id: Math.random().toString(36).substring(2, 9),
            type: 'near_miss',
            text: `⚡ SO CLOSE! ${player.name} missed the ${claim.targetName} by a fraction of a second!`,
            colorHex: '#FFE600',
            timestamp: now
          });
        }
      }
    }
  }

  recordClaim(entId, claimData) {
    this.recentClaims.set(entId, {
      ...claimData,
      claimedAt: claimData.claimedAt || Date.now(),
      notifiedPlayers: claimData.notifiedPlayers || new Set()
    });
  }

  tickGlitchTreasure(now) {
    // Spawn new glitch treasure if timer reached and none active
    if (!this.activeGlitch && this.nextGlitchSpawnAt && now >= this.nextGlitchSpawnAt) {
      const spot = this.rng.pick(GLITCH_SPOTS, 1)[0];
      this.activeGlitch = {
        id: `glitch_${Date.now().toString(36)}`,
        type: 'glitch',
        regionName: spot.region.toUpperCase(),
        x: spot.x,
        y: spot.y,
        radius: CONFIG.INTERACT_RADIUS.GLITCH,
        points: CONFIG.GLITCH_TREASURE.POINTS,
        colorHex: CONFIG.GLITCH_TREASURE.COLOR_HEX,
        colorNum: CONFIG.GLITCH_TREASURE.COLOR_NUM,
        state: 'active',
        spawnedAt: now,
        expiresAt: now + (CONFIG.GLITCH_TREASURE.DURATION_SEC * 1000),
        durationSec: CONFIG.GLITCH_TREASURE.DURATION_SEC
      };

      this.entities.set(this.activeGlitch.id, this.activeGlitch);

      this.gameManager.io.emit('host_event', {
        id: Math.random().toString(36).substring(2, 9),
        type: 'glitch_spawn',
        text: `⚡ GLITCH TREASURE spawned in ${spot.region.toUpperCase()}! (10s)`,
        colorHex: CONFIG.GLITCH_TREASURE.COLOR_HEX,
        timestamp: now
      });

      console.log(`[Interactables] ⚡ Glitch Treasure spawned at (${spot.x}, ${spot.y}) in ${spot.region}!`);
    }

    // Check if active glitch treasure has expired or was collected
    if (this.activeGlitch) {
      if (this.activeGlitch.state === 'collected' || now >= this.activeGlitch.expiresAt) {
        this.entities.delete(this.activeGlitch.id);
        this.activeGlitch = null;
        this.nextGlitchSpawnAt = now + (CONFIG.GLITCH_TREASURE.SPAWN_INTERVAL_SEC * 1000);
      }
    }
  }

  processPlayerInteractions(player, now) {
    let nearest = null;
    let nearestDist = Infinity;

    // Combine standard entities with active clues & legendary vault
    const allInteractables = [
      ...Array.from(this.entities.values()),
      ...(this.gameManager.clues ? this.gameManager.clues.getActiveEntities() : [])
    ];

    for (const ent of allInteractables) {
      if (ent.state !== 'active' && ent.state !== 'revealed') continue;

      const dist = Math.hypot(player.x - ent.x, player.y - ent.y);
      if (dist <= ent.radius && dist < nearestDist) {
        nearestDist = dist;
        nearest = ent;
      }
    }

    let actionState = {
      available: false,
      label: 'ACTION',
      color: '#333344',
      progress: 0
    };

    if (nearest) {
      if (nearest.type === 'clue' || nearest.type === 'side_clue' || nearest.type === 'legendary_vault') {
        actionState = this.gameManager.clues.getPrompt(player, nearest) || actionState;
      } else {
        actionState = this.getInteractablePrompt(player, nearest, now);
      }

      if (player.input && player.input.action) {
        if (nearest.type === 'clue' || nearest.type === 'side_clue' || nearest.type === 'legendary_vault') {
          this.gameManager.clues.handleAction(player, nearest, now);
        } else {
          this.handleActionPress(player, nearest, now);
        }
      } else if (nearest.type === 'chest' && nearest.holdingPlayers) {
        nearest.holdingPlayers.delete(player.id);
      }
    }

    player.smartAction = actionState;
  }

  getInteractablePrompt(player, ent, now) {
    switch (ent.type) {
      case 'treasure':
        return {
          available: true,
          label: `COLLECT (+${ent.points})`,
          color: ent.colorHex,
          progress: 0
        };

      case 'glitch': {
        const remSec = Math.max(0, Math.ceil((ent.expiresAt - now) / 1000));
        return {
          available: true,
          label: `RUSH (+${ent.points}) [${remSec}s] ⚡`,
          color: ent.colorHex,
          progress: 0
        };
      }

      case 'chest': {
        const holdStart = ent.holdingPlayers ? ent.holdingPlayers.get(player.id) : null;
        const elapsed = holdStart ? (now - holdStart) : 0;
        const progress = Math.min(1.0, elapsed / CONFIG.SCORING.CHEST_HOLD_MS);
        return {
          available: true,
          label: progress > 0 ? `OPENING... ${Math.round(progress * 100)}%` : 'HOLD TO OPEN',
          color: '#FFAA00',
          progress: progress
        };
      }

      case 'key':
        return {
          available: true,
          label: 'TAKE KEY 🔑',
          color: '#FFDD00',
          progress: 0
        };

      case 'vault':
        if (player.hasKey) {
          return {
            available: true,
            label: `UNLOCK (+${ent.points}) 🔓`,
            color: '#39FF14',
            progress: 0
          };
        }
        return {
          available: false,
          label: 'NEEDS KEY 🔒',
          color: '#666688',
          progress: 0
        };

      case 'portal':
        if (player.portalCooldownUntil && now < player.portalCooldownUntil) {
          const rem = Math.ceil((player.portalCooldownUntil - now) / 1000);
          return {
            available: false,
            label: `WARPING (${rem}s)`,
            color: '#666688',
            progress: 0
          };
        }
        return {
          available: true,
          label: 'WARP PORTAL 🌀',
          color: '#00F0FF',
          progress: 0
        };

      case 'merchant':
        if (player.merchantCooldownUntil && now < player.merchantCooldownUntil) {
          const rem = Math.ceil((player.merchantCooldownUntil - now) / 1000);
          return {
            available: false,
            label: `RESTOCK (${rem}s)`,
            color: '#666688',
            progress: 0
          };
        }
        return {
          available: true,
          label: 'TRADE / GAMBLE 🎲',
          color: '#39FF14',
          progress: 0
        };

      case 'switch':
        if (this.gameManager.secretDoorOpen) {
          return {
            available: false,
            label: 'ACTIVATED ✓',
            color: '#666688',
            progress: 0
          };
        }
        return {
          available: true,
          label: 'OPEN PASSAGE ⚡',
          color: '#FF0055',
          progress: 0
        };

      default:
        return { available: false, label: 'ACTION', color: '#333344', progress: 0 };
    }
  }

  handleActionPress(player, ent, now) {
    if (ent.state !== 'active') return;

    switch (ent.type) {
      case 'treasure':
        ent.state = 'collected';
        ent.respawnAt = now + CONFIG.SCORING.TREASURE_RESPAWN_MS;
        this.scoring.awardPoints(player, ent.points, `${ent.tier.toUpperCase()} TREASURE`, { x: ent.x, y: ent.y });
        this.recordClaim(ent.id, {
          winnerId: player.id,
          winnerName: player.name,
          targetName: `${ent.tier.toUpperCase()} TREASURE`,
          x: ent.x,
          y: ent.y
        });
        
        if (this.gameManager.statsTracker) {
          this.gameManager.statsTracker.recordTreasure(player, ent.tier, false);
        }

        // Notify Mission System
        if (this.gameManager.missions) {
          this.gameManager.missions.onPlayerEvent(player, 'TREASURE_COLLECT', { tier: ent.tier, isGlitch: false });
        }
        break;

      case 'glitch':
        ent.state = 'collected';
        this.scoring.awardPoints(player, ent.points, 'GLITCH TREASURE', { x: ent.x, y: ent.y });
        this.recordClaim(ent.id, {
          winnerId: player.id,
          winnerName: player.name,
          targetName: 'GLITCH TREASURE',
          x: ent.x,
          y: ent.y
        });
        
        if (this.gameManager.statsTracker) {
          this.gameManager.statsTracker.recordTreasure(player, 'glitch', true);
        }

        // Notify Mission System (Opportunist)
        if (this.gameManager.missions) {
          this.gameManager.missions.onPlayerEvent(player, 'TREASURE_COLLECT', { tier: 'glitch', isGlitch: true });
        }

        this.gameManager.io.emit('host_event', {
          id: Math.random().toString(36).substring(2, 9),
          type: 'glitch_collected',
          text: `⚡ ${player.name} grabbed the Glitch Treasure! (+${ent.points} pts)`,
          colorHex: player.color.hex,
          timestamp: now
        });
        break;

      case 'chest':
        if (!ent.holdingPlayers.has(player.id)) {
          ent.holdingPlayers.set(player.id, now);
        } else {
          const holdStart = ent.holdingPlayers.get(player.id);
          if (now - holdStart >= CONFIG.SCORING.CHEST_HOLD_MS) {
            ent.state = 'opened';
            ent.respawnAt = now + 15000;
            ent.holdingPlayers.clear();
            const reward = this.rng.rangeInt(CONFIG.SCORING.CHEST_MIN, CONFIG.SCORING.CHEST_MAX);
            this.scoring.awardPoints(player, reward, 'SECRET CHEST', { x: ent.x, y: ent.y });
            this.recordClaim(ent.id, {
              winnerId: player.id,
              winnerName: player.name,
              targetName: 'SECRET CHEST',
              x: ent.x,
              y: ent.y
            });

            if (this.gameManager.statsTracker) {
              this.gameManager.statsTracker.recordChest(player);
            }

            // Notify Mission System (Collector)
            if (this.gameManager.missions) {
              this.gameManager.missions.onPlayerEvent(player, 'CHEST_OPEN', { chestId: ent.id });
            }
          }
        }
        break;

      case 'key':
        ent.state = 'collected';
        player.hasKey = true;
        this.scoring.awardPoints(player, 5, 'VAULT KEY FOUND', { x: ent.x, y: ent.y });
        this.recordClaim(ent.id, {
          winnerId: player.id,
          winnerName: player.name,
          targetName: 'CITADEL KEY',
          x: ent.x,
          y: ent.y
        });
        
        this.gameManager.io.emit('host_event', {
          id: Math.random().toString(36).substring(2, 9),
          type: 'key_found',
          text: `🔑 ${player.name} obtained a Citadel Key!`,
          colorHex: player.color.hex,
          timestamp: now
        });
        break;

      case 'vault':
        if (player.hasKey) {
          ent.state = 'opened';
          player.hasKey = false;
          this.scoring.awardPoints(player, CONFIG.SCORING.VAULT, 'VAULT UNLOCKED', { x: ent.x, y: ent.y });
          this.recordClaim(ent.id, {
            winnerId: player.id,
            winnerName: player.name,
            targetName: ent.name || 'ANCIENT VAULT',
            x: ent.x,
            y: ent.y
          });

          if (this.gameManager.statsTracker) {
            this.gameManager.statsTracker.recordVault(player);
          }

          this.gameManager.io.emit('host_event', {
            id: Math.random().toString(36).substring(2, 9),
            type: 'vault_opened',
            text: `🔓 ${player.name} unlocked the ${ent.name || 'Vault'}! (+${CONFIG.SCORING.VAULT} pts)`,
            colorHex: player.color.hex,
            timestamp: now
          });
        }
        break;

      case 'portal':
        if (!player.portalCooldownUntil || now >= player.portalCooldownUntil) {
          player.x = ent.targetPos.x;
          player.y = ent.targetPos.y;
          player.vx = 0;
          player.vy = 0;
          player.portalCooldownUntil = now + (CONFIG.SCORING.PORTAL_COOLDOWN_SEC * 1000);
          this.scoring.awardPoints(player, CONFIG.SCORING.PORTAL_HOP || 5, 'PORTAL WARP', { x: player.x, y: player.y });

          if (this.gameManager.statsTracker) {
            this.gameManager.statsTracker.recordPortal(player);
          }

          // Notify Mission System (Portal Jumper)
          if (this.gameManager.missions) {
            this.gameManager.missions.onPlayerEvent(player, 'PORTAL_USE', { portalId: ent.id });
          }
        }
        break;

      case 'merchant':
        if (!player.merchantCooldownUntil || now >= player.merchantCooldownUntil) {
          player.merchantCooldownUntil = now + (CONFIG.SCORING.MERCHANT_COOLDOWN_SEC * 1000);
          const payout = this.rng.rangeInt(CONFIG.SCORING.MERCHANT_MIN, CONFIG.SCORING.MERCHANT_MAX);
          this.scoring.awardPoints(player, payout, 'MERCHANT DEAL', { x: ent.x, y: ent.y });

          // Notify Mission System (Merchant Deal)
          if (this.gameManager.missions) {
            this.gameManager.missions.onPlayerEvent(player, 'MERCHANT_TRADE', { merchantId: ent.id });
          }
        }
        break;

      case 'switch':
        if (!this.gameManager.secretDoorOpen) {
          this.gameManager.secretDoorOpen = true;
          this.gameManager.activeWalls = this.gameManager.activeWalls.filter(w => w.id !== 'secret_door');
          this.scoring.awardPoints(player, 25, 'SECRET PASSAGE UNLOCKED', { x: ent.x, y: ent.y });

          this.gameManager.io.emit('host_event', {
            id: Math.random().toString(36).substring(2, 9),
            type: 'secret_passage',
            text: `⚡ ${player.name} opened the Citadel Secret Passage!`,
            colorHex: player.color.hex,
            timestamp: now
          });
        }
        break;
    }
  }

  getVisibleEntities() {
    const standard = Array.from(this.entities.values()).map(e => ({
      id: e.id,
      type: e.type,
      tier: e.tier,
      name: e.name,
      x: e.x,
      y: e.y,
      radius: e.radius,
      points: e.points,
      colorHex: e.colorHex,
      colorNum: e.colorNum,
      state: e.state,
      spawnedAt: e.spawnedAt,
      expiresAt: e.expiresAt,
      durationSec: e.durationSec,
      contested: e.contested || null
    }));

    const clues = (this.gameManager.clues ? this.gameManager.clues.getActiveEntities() : []).map(c => ({
      ...c,
      contested: c.contested || null
    }));
    return [...standard, ...clues];
  }
}
