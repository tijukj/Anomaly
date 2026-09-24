// server/game/scoring.js - Central scoring engine for ANOMALY
import { CONFIG } from '../config.js';

export class ScoringSystem {
  constructor(io) {
    this.io = io;
    this.scoreEvents = [];
    this.gameManager = null;
  }

  setGameManager(gm) {
    this.gameManager = gm;
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

  // Calculate live leaderboard rankings
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
    return active.map((p, idx) => ({
      ...p,
      rank: idx + 1
    }));
  }
}
