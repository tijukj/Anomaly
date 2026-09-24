// server/game/scoring.js - Central scoring engine for ANOMALY
import { CONFIG } from '../config.js';

export class ScoringSystem {
  constructor(io) {
    this.io = io;
    this.scoreEvents = [];
  }

  // Award points to a player and broadcast score popup event
  awardPoints(player, amount, reason, pos = null) {
    if (!player || amount <= 0) return 0;

    player.score = (player.score || 0) + amount;

    const event = {
      id: Math.random().toString(36).substring(2, 9),
      playerId: player.id,
      playerName: player.name,
      amount: amount,
      reason: reason || 'POINTS',
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

    console.log(`[Score] +${amount} to ${player.name} (${reason}) -> Total: ${player.score}`);
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
