// server/game/statsTracker.js - Authoritative Match Stats, Tie-Breaks, Awards & Highlight Reel
import { CONFIG } from '../config.js';

export class PlayerStatsTracker {
  constructor() {
    this.stats = new Map(); // playerId -> stats object
    this.matchHighlights = [];
  }

  reset() {
    this.stats.clear();
    this.matchHighlights = [];
  }

  registerPlayer(player) {
    if (!this.stats.has(player.id)) {
      this.stats.set(player.id, {
        id: player.id,
        name: player.name,
        color: player.color,
        score: player.score || 0,
        lastScoreTime: Date.now(),
        chestsOpened: 0,
        treasuresByTier: {
          common: 0,
          rare: 0,
          epic: 0,
          glitch: 0
        },
        totalTreasures: 0,
        vaultsOpened: 0,
        cluesFound: 0,
        sideCluesFound: 0,
        foundLegendaryTreasure: false,
        distanceMoved: 0, // total pixels
        crownHoldTimeSec: 0,
        anomalyActions: 0,
        portalsUsed: 0,
        firstDiscoveries: 0,
        lastX: player.x,
        lastY: player.y
      });
    }
  }

  getStats(playerId) {
    return this.stats.get(playerId);
  }

  recordMovement(player, dx, dy) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    const dist = Math.hypot(dx, dy);
    if (dist > 0.1 && dist < 100) {
      s.distanceMoved += dist;
    }
  }

  recordScoreChange(player, amount) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.score = player.score;
    s.lastScoreTime = Date.now();
  }

  recordTreasure(player, tier, isGlitch = false) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.totalTreasures++;
    if (isGlitch) {
      s.treasuresByTier.glitch++;
      s.anomalyActions++;
    } else if (tier === 'epic') {
      s.treasuresByTier.epic++;
    } else if (tier === 'rare') {
      s.treasuresByTier.rare++;
    } else {
      s.treasuresByTier.common++;
    }
  }

  recordChest(player) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.chestsOpened++;
  }

  recordVault(player) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.vaultsOpened++;
  }

  recordPortal(player) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.portalsUsed++;
  }

  recordClue(player, step) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.cluesFound++;
  }

  recordSideClue(player) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.sideCluesFound++;
    s.cluesFound++;
  }

  recordLegendaryTreasure(player) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.foundLegendaryTreasure = true;
  }

  recordFirstDiscovery(player, regionId) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.firstDiscoveries++;
  }

  recordCrownHold(player, seconds) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.crownHoldTimeSec += seconds;
    s.anomalyActions += Math.round(seconds * 2);
  }

  recordAnomalyAction(player, points = 1) {
    let s = this.stats.get(player.id);
    if (!s) {
      this.registerPlayer(player);
      s = this.stats.get(player.id);
    }
    s.anomalyActions += points;
  }

  // Calculate final tie-broken rankings
  // Tie-Break: 1. Total Score (desc) -> 2. More Epic/Legendary treasures (desc) -> 3. Who reached score first (asc)
  computeFinalLeaderboard(playersMap) {
    const list = Array.from(playersMap.values())
      .filter(p => p.connected)
      .map(p => {
        let st = this.stats.get(p.id);
        if (!st) {
          this.registerPlayer(p);
          st = this.stats.get(p.id);
        }
        st.name = p.name;
        st.color = p.color;
        st.score = p.score || 0;

        const epicCount = (st.treasuresByTier.epic || 0) + (st.foundLegendaryTreasure ? 1 : 0);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          score: p.score || 0,
          epicLegendaryCount: epicCount,
          lastScoreTime: st.lastScoreTime || 0,
          stats: {
            ...st,
            distanceMeters: Math.round(st.distanceMoved / 15)
          }
        };
      });

    list.sort((a, b) => {
      // 1. Total Score
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // 2. More Epic / Legendary Treasures
      if (b.epicLegendaryCount !== a.epicLegendaryCount) {
        return b.epicLegendaryCount - a.epicLegendaryCount;
      }
      // 3. Who reached the score first
      return a.lastScoreTime - b.lastScoreTime;
    });

    return list.map((entry, idx) => ({
      ...entry,
      rank: idx + 1
    }));
  }

  // Compute Special Awards
  // Explorer, Chaos Agent, Treasure Hunter, Speed Demon, Vault Master
  computeSpecialAwards(rankedLeaderboard) {
    if (!rankedLeaderboard || rankedLeaderboard.length === 0) return {};

    const awards = {
      explorer: null,
      chaosAgent: null,
      treasureHunter: null,
      speedDemon: null,
      vaultMaster: null
    };

    let maxDiscoveries = -1;
    let maxChaos = -1;
    let maxTreasures = -1;
    let maxDistance = -1;
    let maxVaults = -1;

    for (const p of rankedLeaderboard) {
      const s = p.stats;

      // 1. Explorer: most first-discoveries (+ clues found)
      const discoveryScore = (s.firstDiscoveries * 2) + s.cluesFound;
      if (discoveryScore > maxDiscoveries && discoveryScore > 0) {
        maxDiscoveries = discoveryScore;
        awards.explorer = {
          id: 'explorer',
          title: 'EXPLORER',
          icon: '🧭',
          recipientId: p.id,
          recipientName: p.name,
          colorHex: p.color.hex,
          description: `Discovered ${s.firstDiscoveries} uncharted regions & clues`,
          statValue: `${s.firstDiscoveries} discoveries`
        };
      }

      // 2. Chaos Agent: most anomaly-related actions + crown hold
      const chaosScore = s.anomalyActions + Math.round(s.crownHoldTimeSec * 3);
      if (chaosScore > maxChaos && chaosScore > 0) {
        maxChaos = chaosScore;
        awards.chaosAgent = {
          id: 'chaos_agent',
          title: 'CHAOS AGENT',
          icon: '🌀',
          recipientId: p.id,
          recipientName: p.name,
          colorHex: p.color.hex,
          description: `Thrived in ${chaosScore} anomaly events & crown contests`,
          statValue: `${chaosScore} chaos pts`
        };
      }

      // 3. Treasure Hunter: most total treasures
      if (s.totalTreasures > maxTreasures && s.totalTreasures > 0) {
        maxTreasures = s.totalTreasures;
        awards.treasureHunter = {
          id: 'treasure_hunter',
          title: 'TREASURE HUNTER',
          icon: '💎',
          recipientId: p.id,
          recipientName: p.name,
          colorHex: p.color.hex,
          description: `Hoarded ${s.totalTreasures} treasures across all tiers`,
          statValue: `${s.totalTreasures} treasures`
        };
      }

      // 4. Speed Demon: most distance moved
      if (s.distanceMoved > maxDistance && s.distanceMoved > 500) {
        maxDistance = s.distanceMoved;
        const meters = Math.round(s.distanceMoved / 15);
        awards.speedDemon = {
          id: 'speed_demon',
          title: 'SPEED DEMON',
          icon: '⚡',
          recipientId: p.id,
          recipientName: p.name,
          colorHex: p.color.hex,
          description: `Sprinted ${meters} meters across the arena`,
          statValue: `${meters}m traveled`
        };
      }

      // 5. Vault Master: most vaults + chests opened
      const vaultScore = (s.vaultsOpened * 2) + s.chestsOpened;
      if (vaultScore > maxVaults && vaultScore > 0) {
        maxVaults = vaultScore;
        awards.vaultMaster = {
          id: 'vault_master',
          title: 'VAULT MASTER',
          icon: '🗝️',
          recipientId: p.id,
          recipientName: p.name,
          colorHex: p.color.hex,
          description: `Cracked ${s.vaultsOpened} vaults and ${s.chestsOpened} secret chests`,
          statValue: `${s.vaultsOpened} vaults, ${s.chestsOpened} chests`
        };
      }
    }

    return awards;
  }

  // Generate 4-6 Highlight Cards (~3s each)
  generateHighlightCards(rankedLeaderboard, awards) {
    const cards = [];

    if (!rankedLeaderboard || rankedLeaderboard.length === 0) return cards;

    // Card 1: Match Champion / 1st Place
    const winner = rankedLeaderboard[0];
    if (winner) {
      cards.push({
        id: 'champion',
        icon: '👑',
        badge: 'CHAMPION',
        title: `${winner.name} WINS THE MATCH!`,
        subtitle: `Dominated the arena with ${winner.score} Total Points`,
        playerName: winner.name,
        colorHex: winner.color.hex,
        accentColor: '#FFE600'
      });
    }

    // Card 2: Legendary Treasure Claim (if found)
    const legFinder = rankedLeaderboard.find(p => p.stats.foundLegendaryTreasure);
    if (legFinder) {
      cards.push({
        id: 'legendary',
        icon: '✨',
        badge: 'LEGENDARY REVELATION',
        title: `${legFinder.name} FOUND THE LEGENDARY TREASURE!`,
        subtitle: `Cracked the ancient cipher for +${CONFIG.LEGENDARY.POINTS} PTS`,
        playerName: legFinder.name,
        colorHex: legFinder.color.hex,
        accentColor: '#FFE600'
      });
    }

    // Card 3: Crown Monarch (if crown held)
    const topCrown = [...rankedLeaderboard].sort((a, b) => b.stats.crownHoldTimeSec - a.stats.crownHoldTimeSec)[0];
    if (topCrown && topCrown.stats.crownHoldTimeSec >= 3) {
      cards.push({
        id: 'crown',
        icon: '👑',
        badge: 'CROWN MONARCH',
        title: `${topCrown.name} HELD THE CROWN LONGEST!`,
        subtitle: `Defended the Golden Crown for ${Math.round(topCrown.stats.crownHoldTimeSec)} seconds`,
        playerName: topCrown.name,
        colorHex: topCrown.color.hex,
        accentColor: '#FFAA00'
      });
    }

    // Card 4: Chest & Vault Master
    const topChests = [...rankedLeaderboard].sort((a, b) => (b.stats.chestsOpened + b.stats.vaultsOpened) - (a.stats.chestsOpened + a.stats.vaultsOpened))[0];
    if (topChests && (topChests.stats.chestsOpened > 0 || topChests.stats.vaultsOpened > 0)) {
      cards.push({
        id: 'chests',
        icon: '📦',
        badge: 'MASTER LOCKPICK',
        title: `${topChests.name} OPENED ${topChests.stats.chestsOpened + topChests.stats.vaultsOpened} CHESTS & VAULTS!`,
        subtitle: `Unlocked maximum citadel secrets and hidden loot`,
        playerName: topChests.name,
        colorHex: topChests.color.hex,
        accentColor: '#00F0FF'
      });
    }

    // Card 5: Speed & Exploration
    const topDistance = [...rankedLeaderboard].sort((a, b) => b.stats.distanceMoved - a.stats.distanceMoved)[0];
    if (topDistance && topDistance.stats.distanceMoved > 500) {
      const meters = Math.round(topDistance.stats.distanceMoved / 15);
      cards.push({
        id: 'speed',
        icon: '⚡',
        badge: 'SPEED DEMON',
        title: `${topDistance.name} SPRINTED ${meters} METERS!`,
        subtitle: `Covered the greatest ground across the 4 arena realms`,
        playerName: topDistance.name,
        colorHex: topDistance.color.hex,
        accentColor: '#39FF14'
      });
    }

    // Card 6: Portal Master (if portals used)
    const topPortal = [...rankedLeaderboard].sort((a, b) => b.stats.portalsUsed - a.stats.portalsUsed)[0];
    if (topPortal && topPortal.stats.portalsUsed > 0 && cards.length < 6) {
      cards.push({
        id: 'portals',
        icon: '🌀',
        badge: 'WARP RUNNER',
        title: `${topPortal.name} JUMPED ${topPortal.stats.portalsUsed} PORTALS!`,
        subtitle: `Mastered spatial teleportation across the rivers`,
        playerName: topPortal.name,
        colorHex: topPortal.color.hex,
        accentColor: '#FF00FF'
      });
    }

    // Fallback card if fewer than 4 cards
    if (cards.length < 4 && rankedLeaderboard.length >= 2) {
      const runnerUp = rankedLeaderboard[1];
      cards.push({
        id: 'runner_up',
        icon: '🥈',
        badge: 'PODIUM CONTENDER',
        title: `${runnerUp.name} SECURED 2ND PLACE!`,
        subtitle: `Fought valiantly with ${runnerUp.score} Points`,
        playerName: runnerUp.name,
        colorHex: runnerUp.color.hex,
        accentColor: '#C0C0C0'
      });
    }

    return cards.slice(0, 6);
  }
}
