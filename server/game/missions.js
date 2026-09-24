// server/game/missions.js - Dynamic authoritative mission system for ANOMALY
import { CONFIG } from '../config.js';
import { MAP_REGIONS } from './mapData.js';
import { createRng } from './seededRng.js';

const TEMPLATE_TYPES = [
  'EXPLORER',
  'COLLECTOR',
  'RUNNER',
  'OPPORTUNIST',
  'COMMON_HOARDER',
  'PORTAL_JUMPER',
  'BRIDGE_CROSSER',
  'MERCHANT_DEAL'
];

export class MissionManager {
  constructor(gameManager, scoring) {
    this.gameManager = gameManager;
    this.scoring = scoring;
    this.playerStates = new Map();
    this.rng = createRng(98765);
    this.missionCounter = 1;
  }

  initForMatch(seed) {
    this.playerStates.clear();
    this.rng = createRng(seed);
    this.missionCounter = 1;
    console.log('[Missions] Initialized dynamic mission manager for match.');
  }

  // Get or initialize player mission state
  getOrCreatePlayerState(player) {
    if (!this.playerStates.has(player.id)) {
      this.playerStates.set(player.id, {
        activeMission: null,
        history: [], // Recent template types
        nextMissionAt: 0,
        lastCompleted: null
      });
    }
    return this.playerStates.get(player.id);
  }

  // 20Hz Tick: Check mission expiry / invalidation & delivery of next mission
  tick(activePlayers, matchTimeRemaining, totalMatchDuration) {
    const now = Date.now();
    const elapsedFraction = 1.0 - (matchTimeRemaining / totalMatchDuration);

    for (const player of activePlayers) {
      const state = this.getOrCreatePlayerState(player);

      // 1. Deliver pending new mission after 3-second celebration
      if (!state.activeMission && now >= state.nextMissionAt) {
        this.assignMission(player, elapsedFraction);
      }

      // 2. Invalidate impossible missions (e.g. Runner past halfway point)
      if (state.activeMission && !state.activeMission.completed) {
        if (state.activeMission.type === 'RUNNER' && elapsedFraction >= CONFIG.MISSIONS.RUNNER_TIME_LIMIT_FRACTION) {
          console.log(`[Missions] ⏱️ Runner mission expired for ${player.name} (silently replacing)...`);
          this.assignMission(player, elapsedFraction);
        }
      }
    }
  }

  // Assign weighted random mission to player
  assignMission(player, elapsedFraction = 0) {
    const state = this.getOrCreatePlayerState(player);
    const validTemplates = this.getEligibleTemplates(state, elapsedFraction);
    const chosenType = this.pickWeightedTemplate(validTemplates, state.history);

    const mission = this.buildMission(chosenType, player);
    state.activeMission = mission;
    state.lastCompleted = null;

    console.log(`[Missions] Assigned [${mission.type}] to ${player.name}: "${mission.title}" (+${mission.reward} pts)`);
    return mission;
  }

  // Determine eligible templates based on game rules
  getEligibleTemplates(state, elapsedFraction) {
    const eligible = [...TEMPLATE_TYPES];

    // Rule: Never give Runner if past halfway point (5:00 in standard 10m match)
    if (elapsedFraction >= CONFIG.MISSIONS.RUNNER_TIME_LIMIT_FRACTION) {
      const idx = eligible.indexOf('RUNNER');
      if (idx !== -1) eligible.splice(idx, 1);
    }

    return eligible;
  }

  // Weighted random pick, penalizing recently completed templates
  pickWeightedTemplate(eligibleTemplates, history) {
    const weights = [];
    const baseWeights = CONFIG.MISSIONS.BASE_WEIGHTS;

    for (const type of eligibleTemplates) {
      let w = baseWeights[type] || 1.0;

      // History penalty for recent missions (decaying)
      if (history.length > 0) {
        if (history[history.length - 1] === type) {
          w *= CONFIG.MISSIONS.RECENT_HISTORY_PENALTY;
        } else if (history.length > 1 && history[history.length - 2] === type) {
          w *= (CONFIG.MISSIONS.RECENT_HISTORY_PENALTY + 0.3);
        }
      }

      weights.push(w);
    }

    const totalWeight = weights.reduce((acc, v) => acc + v, 0);
    let rand = this.rng.random() * totalWeight;

    for (let i = 0; i < eligibleTemplates.length; i++) {
      if (rand < weights[i]) {
        return eligibleTemplates[i];
      }
      rand -= weights[i];
    }

    return eligibleTemplates[0];
  }

  // Build specific mission instance
  buildMission(type, player) {
    const id = `ms_${this.missionCounter++}_${Date.now().toString(36)}`;
    const rewards = CONFIG.MISSIONS.REWARDS;

    switch (type) {
      case 'EXPLORER': {
        // Pick 2 distinct regions from Forest, Ruins, Cave, Castle
        const regionCandidates = MAP_REGIONS.filter(r => r.id !== 'plaza');
        const chosen = this.rng.pick(regionCandidates, 2);
        return {
          id,
          type: 'EXPLORER',
          title: `VISIT ${chosen[0].name.toUpperCase()} & ${chosen[1].name.toUpperCase()}`,
          description: `Reach ${chosen[0].name} and ${chosen[1].name}`,
          reward: rewards.EXPLORER,
          requiredRegions: [chosen[0].id, chosen[1].id],
          visitedRegions: [],
          progress: 0,
          maxProgress: 2,
          completed: false
        };
      }

      case 'COLLECTOR':
        return {
          id,
          type: 'COLLECTOR',
          title: 'OPEN 3 CHESTS',
          description: 'Hold action to unlock 3 secret chests',
          reward: rewards.COLLECTOR,
          progress: 0,
          maxProgress: 3,
          completed: false
        };

      case 'RUNNER':
        return {
          id,
          type: 'RUNNER',
          title: 'RUSH TO CASTLE',
          description: 'Reach the Castle before the 5:00 mark',
          reward: rewards.RUNNER,
          targetRegion: 'castle',
          progress: 0,
          maxProgress: 1,
          completed: false
        };

      case 'OPPORTUNIST':
        return {
          id,
          type: 'OPPORTUNIST',
          title: 'COLLECT GLITCH TREASURE',
          description: 'Reach and grab a transient anomaly beacon',
          reward: rewards.OPPORTUNIST,
          progress: 0,
          maxProgress: 1,
          completed: false
        };

      case 'COMMON_HOARDER':
        return {
          id,
          type: 'COMMON_HOARDER',
          title: 'COLLECT 5 TREASURES',
          description: 'Collect 5 common cyan treasures',
          reward: rewards.COMMON_HOARDER,
          progress: 0,
          maxProgress: 5,
          completed: false
        };

      case 'PORTAL_JUMPER':
        return {
          id,
          type: 'PORTAL_JUMPER',
          title: 'USE PORTAL TWICE',
          description: 'Warp through any teleport portal 2 times',
          reward: rewards.PORTAL_JUMPER,
          progress: 0,
          maxProgress: 2,
          completed: false
        };

      case 'BRIDGE_CROSSER':
        return {
          id,
          type: 'BRIDGE_CROSSER',
          title: 'CROSS RIVER BRIDGE',
          description: 'Cross the river by running over a bridge',
          reward: rewards.BRIDGE_CROSSER,
          progress: 0,
          maxProgress: 1,
          completed: false
        };

      case 'MERCHANT_DEAL':
        return {
          id,
          type: 'MERCHANT_DEAL',
          title: 'TRADE WITH MERCHANT',
          description: 'Visit a wandering merchant and trade',
          reward: rewards.MERCHANT_DEAL,
          progress: 0,
          maxProgress: 1,
          completed: false
        };

      default:
        return {
          id,
          type: 'COMMON_HOARDER',
          title: 'COLLECT 5 TREASURES',
          description: 'Collect 5 common cyan treasures',
          reward: 20,
          progress: 0,
          maxProgress: 5,
          completed: false
        };
    }
  }

  // Handle in-game events emitted by game loop / interactables
  onPlayerEvent(player, eventType, data = {}) {
    if (!player) return;
    const state = this.getOrCreatePlayerState(player);
    const mission = state.activeMission;

    if (!mission || mission.completed) return;

    let progressMade = false;

    switch (mission.type) {
      case 'EXPLORER':
        if (eventType === 'REGION_ENTER' && data.regionId) {
          if (mission.requiredRegions.includes(data.regionId) && !mission.visitedRegions.includes(data.regionId)) {
            mission.visitedRegions.push(data.regionId);
            mission.progress = mission.visitedRegions.length;
            progressMade = true;
          }
        }
        break;

      case 'COLLECTOR':
        if (eventType === 'CHEST_OPEN') {
          mission.progress++;
          progressMade = true;
        }
        break;

      case 'RUNNER':
        if (eventType === 'REGION_ENTER' && data.regionId === mission.targetRegion) {
          mission.progress = 1;
          progressMade = true;
        }
        break;

      case 'OPPORTUNIST':
        if (eventType === 'TREASURE_COLLECT' && data.isGlitch) {
          mission.progress = 1;
          progressMade = true;
        }
        break;

      case 'COMMON_HOARDER':
        if (eventType === 'TREASURE_COLLECT' && data.tier === 'common') {
          mission.progress++;
          progressMade = true;
        }
        break;

      case 'PORTAL_JUMPER':
        if (eventType === 'PORTAL_USE') {
          mission.progress++;
          progressMade = true;
        }
        break;

      case 'BRIDGE_CROSSER':
        if (eventType === 'BRIDGE_CROSS') {
          mission.progress = 1;
          progressMade = true;
        }
        break;

      case 'MERCHANT_DEAL':
        if (eventType === 'MERCHANT_TRADE') {
          mission.progress = 1;
          progressMade = true;
        }
        break;
    }

    if (progressMade) {
      if (mission.progress >= mission.maxProgress) {
        this.completeMission(player, state, mission);
      }
    }
  }

  // Complete mission, award points, emit celebration and queue next mission
  completeMission(player, state, mission) {
    mission.completed = true;
    mission.progress = mission.maxProgress;

    // 1. Award points through authoritative scoring
    this.scoring.awardPoints(
      player,
      mission.reward,
      `MISSION: ${mission.title}`,
      { x: player.x, y: player.y }
    );

    // 2. Update history
    state.history.push(mission.type);
    if (state.history.length > 5) state.history.shift();

    state.lastCompleted = { ...mission };
    state.activeMission = null;
    state.nextMissionAt = Date.now() + (CONFIG.MISSIONS.NEW_MISSION_DELAY_SEC * 1000);

    // 3. Notify Player Controller
    const socket = this.gameManager.io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('mission_completed', {
        title: mission.title,
        reward: mission.reward,
        nextInSec: CONFIG.MISSIONS.NEW_MISSION_DELAY_SEC
      });
    }

    // 4. Notify Host Event Feed
    this.gameManager.io.emit('host_event', {
      id: Math.random().toString(36).substring(2, 9),
      type: 'mission_complete',
      text: `⚡ ${player.name} completed "${mission.title}" (+${mission.reward} pts)`,
      colorHex: player.color.hex,
      timestamp: Date.now()
    });

    console.log(`[Missions] 🎯 RACER ${player.name} COMPLETED MISSION "${mission.title}" (+${mission.reward} pts)`);
  }

  // Format mission info for 20Hz player HUD sync
  getPlayerHudMission(player) {
    const state = this.getOrCreatePlayerState(player);
    if (state.activeMission) {
      const m = state.activeMission;
      return {
        id: m.id,
        type: m.type,
        title: m.title,
        description: m.description,
        reward: m.reward,
        progress: m.progress,
        maxProgress: m.maxProgress,
        completed: false,
        text: `${m.title} (${m.progress}/${m.maxProgress})`
      };
    }

    if (state.lastCompleted) {
      return {
        completed: true,
        title: state.lastCompleted.title,
        reward: state.lastCompleted.reward,
        text: `✓ COMPLETED (+${state.lastCompleted.reward} PTS)`
      };
    }

    return {
      text: 'ACQUIRING NEW MISSION...'
    };
  }
}
