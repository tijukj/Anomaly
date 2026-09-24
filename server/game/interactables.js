// server/game/interactables.js - Server-authoritative interactable entity manager
import { CONFIG } from '../config.js';
import { POI_POOLS } from './mapData.js';
import { createRng } from './seededRng.js';

export class InteractableManager {
  constructor(gameManager, scoring) {
    this.gameManager = gameManager;
    this.scoring = scoring;
    this.entities = new Map(); // id -> Entity
    this.rng = createRng(12345);
  }

  // Initialize all interactive entities for the match from seeded layout
  initForMatch(seed, seededPois) {
    this.entities.clear();
    this.rng = createRng(seed);

    // 1. Treasures (Common, Rare, Epic)
    for (const t of (seededPois.treasures || [])) {
      const tier = t.tier || (this.rng.random() < 0.5 ? 'common' : (this.rng.random() < 0.8 ? 'rare' : 'epic'));
      const points = tier === 'epic' ? CONFIG.SCORING.TREASURE_EPIC : (tier === 'rare' ? CONFIG.SCORING.TREASURE_RARE : CONFIG.SCORING.TREASURE_COMMON);
      const colorHex = tier === 'epic' ? '#FF0055' : (tier === 'rare' ? '#FFE600' : '#00F0FF');
      const colorNum = tier === 'epic' ? 0xff0055 : (tier === 'rare' ? 0xffe600 : 0x00f0ff);

      this.entities.set(t.id, {
        id: t.id,
        type: 'treasure',
        tier: tier,
        x: t.x,
        y: t.y,
        radius: CONFIG.INTERACT_RADIUS.TREASURE,
        points: points,
        colorHex: colorHex,
        colorNum: colorNum,
        state: 'active',
        respawnAt: 0
      });
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
        holdingPlayers: new Map(), // playerId -> startTimestamp
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

    // 4. Keys (Pickups to unlock vaults)
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

    // 7. Merchants (Gamble)
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

  // 20Hz Tick: Process respawns and update player interaction prompts
  tick(activePlayers) {
    const now = Date.now();

    // 1. Process Respawns
    for (const ent of this.entities.values()) {
      if (ent.state === 'collected' || ent.state === 'opened') {
        if (ent.respawnAt && now >= ent.respawnAt) {
          ent.state = 'active';
          ent.respawnAt = 0;
        }
      }
    }

    // 2. Compute Smart Action Button & Process Interactions per player
    for (const player of activePlayers) {
      this.processPlayerInteractions(player, now);
    }
  }

  processPlayerInteractions(player, now) {
    let nearest = null;
    let nearestDist = Infinity;

    // Find nearest active interactable within its interaction radius
    for (const ent of this.entities.values()) {
      if (ent.state !== 'active') continue;

      const dist = Math.hypot(player.x - ent.x, player.y - ent.y);
      if (dist <= ent.radius && dist < nearestDist) {
        nearestDist = dist;
        nearest = ent;
      }
    }

    // Initialize player interaction context
    let actionState = {
      available: false,
      label: 'ACTION',
      color: '#333344',
      progress: 0
    };

    if (nearest) {
      actionState = this.getInteractablePrompt(player, nearest, now);

      // If player is pressing the action button, handle the action!
      if (player.input && player.input.action) {
        this.handleActionPress(player, nearest, now);
      } else if (nearest.type === 'chest' && nearest.holdingPlayers) {
        // Reset chest hold if player releases button
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
        break;

      case 'chest':
        if (!ent.holdingPlayers.has(player.id)) {
          ent.holdingPlayers.set(player.id, now);
        } else {
          const holdStart = ent.holdingPlayers.get(player.id);
          if (now - holdStart >= CONFIG.SCORING.CHEST_HOLD_MS) {
            ent.state = 'opened';
            ent.respawnAt = now + 16000;
            ent.holdingPlayers.clear();
            const reward = this.rng.rangeInt(CONFIG.SCORING.CHEST_MIN, CONFIG.SCORING.CHEST_MAX);
            this.scoring.awardPoints(player, reward, 'SECRET CHEST', { x: ent.x, y: ent.y });
          }
        }
        break;

      case 'key':
        ent.state = 'collected';
        player.hasKey = true;
        this.scoring.awardPoints(player, 5, 'VAULT KEY FOUND', { x: ent.x, y: ent.y });
        console.log(`[Item] 🔑 Racer ${player.name} picked up a VAULT KEY!`);
        break;

      case 'vault':
        if (player.hasKey) {
          ent.state = 'opened';
          player.hasKey = false;
          this.scoring.awardPoints(player, CONFIG.SCORING.VAULT, 'VAULT UNLOCKED', { x: ent.x, y: ent.y });
        }
        break;

      case 'portal':
        if (!player.portalCooldownUntil || now >= player.portalCooldownUntil) {
          player.x = ent.targetPos.x;
          player.y = ent.targetPos.y;
          player.vx = 0;
          player.vy = 0;
          player.portalCooldownUntil = now + (CONFIG.SCORING.PORTAL_COOLDOWN_SEC * 1000);
          this.scoring.awardPoints(player, 5, 'PORTAL WARP', { x: player.x, y: player.y });
        }
        break;

      case 'merchant':
        if (!player.merchantCooldownUntil || now >= player.merchantCooldownUntil) {
          player.merchantCooldownUntil = now + (CONFIG.SCORING.MERCHANT_COOLDOWN_SEC * 1000);
          const payout = this.rng.rangeInt(CONFIG.SCORING.MERCHANT_MIN, CONFIG.SCORING.MERCHANT_MAX);
          this.scoring.awardPoints(player, payout, 'MERCHANT DEAL', { x: ent.x, y: ent.y });
        }
        break;

      case 'switch':
        if (!this.gameManager.secretDoorOpen) {
          this.gameManager.secretDoorOpen = true;
          this.gameManager.activeWalls = this.gameManager.activeWalls.filter(w => w.id !== 'secret_door');
          this.scoring.awardPoints(player, 25, 'SECRET PASSAGE UNLOCKED', { x: ent.x, y: ent.y });
          console.log(`[Map] ⚡ SECRET PASSAGE UNLOCKED by ${player.name}!`);
        }
        break;
    }
  }

  // Active state for host rendering
  getVisibleEntities() {
    return Array.from(this.entities.values()).map(e => ({
      id: e.id,
      type: e.type,
      tier: e.tier,
      x: e.x,
      y: e.y,
      radius: e.radius,
      colorHex: e.colorHex,
      colorNum: e.colorNum,
      state: e.state
    }));
  }
}
