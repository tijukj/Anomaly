// server/game/scoring.js - Central scoring engine for ANOMALY
import { CONFIG } from '../config.js';

export class ScoringSystem {
  constructor(io) {
    this.io = io;
    this.scoreEvents = [];
    this.gameManager = null;
    this.previousRanks = new Map();
    this.currentLeaderId = null;
  }

  setGameManager(gm) {
    this.gameManager = gm;
  }

  resetRanks() {
    this.previousRanks.clear();
    this.currentLeaderId = null;
  }

  // Award points to a player and broadcast score popup event
  awardPoints(player, amount, reason, pos = null) {
    if (!player || amount <= 0) return 0;

    let finalAmount = amount;
    let finalReason = reason || 'POINTS';

    if (this.gameManager && this.gameManager.anomalies && this.gameManager.anomalies.isDoublePointsActive()) {
      finalAmount = amount * 2;
      finalReason = `${reason || 'POINTS'} (2X DOUBLE)`;
      if (this.gameManager.anomalies.stats) {
        this.gameManager.anomalies.stats.pointsUnderDouble += amount;
      }
    }

    player.score = (player.score || 0) + finalAmount;

    const event = {
      id: Math.random().toString(36).substring(2, 9),
      playerId: player.id,
      playerName: player.name,
      amount: finalAmount,
      reason: finalReason,
      color: player.color.hex,
      colorNum: player.color.num,
      x: pos ? pos.x : player.x,
      y: pos ? pos.y : player.y,
      timestamp: Date.now()
    };

    this.scoreEvents.push(event);
    if (this.scoreEvents.length > 50) this.scoreEvents.shift();

    // Broadcast floating score effect to host screen
    this.io.emit('score_popup', event);

    console.log(`[Score] +${finalAmount} to ${player.name} (${finalReason}) -> Total: ${player.score}`);
    return player.score;
  }

  // Calculate live leaderboard rankings and emit rank-shift commentary
  getLeaderboard(playersMap) {
    const active = Array.from(playersMap.values())
      .filter(p => p.connected)
      .map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score || 0,
        hasKey: Boolean(p.hasKey)
      }));

    // Sort descending by score
    active.sort((a, b) => b.score - a.score);

    // Assign rank 1..N
    const leaderboard = active.map((p, idx) => ({
      ...p,
      rank: idx + 1
    }));

    // Detect Top 3 & Leader changes
    if (this.gameManager && this.gameManager.state === CONFIG.STATES.RUNNING) {
      leaderboard.forEach(entry => {
        const prevRank = this.previousRanks.get(entry.id);
        if (prevRank !== undefined) {
          if (entry.rank === 1 && prevRank > 1 && entry.id !== this.currentLeaderId) {
            this.currentLeaderId = entry.id;
            this.io.emit('host_event', {
              id: Math.random().toString(36).substring(2, 9),
              type: 'leader_change',
              text: `👑 ${entry.name.toUpperCase()} takes 1st place with ${entry.score} pts!`,
              colorHex: '#FFE600',
              timestamp: Date.now()
            });
          } else if (entry.rank <= 3 && prevRank > 3) {
            this.io.emit('host_event', {
              id: Math.random().toString(36).substring(2, 9),
              type: 'top3_surge',
              text: `⚡ ${entry.name.toUpperCase()} surges into the Top 3 (Rank #${entry.rank})!`,
              colorHex: '#00F0FF',
              timestamp: Date.now()
            });
          }
        }
        this.previousRanks.set(entry.id, entry.rank);
      });
    }

    return leaderboard;
  }
}
