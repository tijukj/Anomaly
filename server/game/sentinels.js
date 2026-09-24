// server/game/sentinels.js - Roaming Anomaly Hazard Drones that patrol and deduct points on contact
import { CONFIG } from '../config.js';

export class HazardSentinelManager {
  constructor(gameManager, scoring) {
    this.gameManager = gameManager;
    this.scoring = scoring;
    this.sentinels = [
      {
        id: 'sentinel_forest',
        name: 'FOREST HAZARD DRONE',
        x: 220,
        y: 180,
        radius: 22,
        speed: 130,
        colorHex: '#FF0055',
        colorNum: 0xff0055,
        waypoints: [
          { x: 220, y: 180 },
          { x: 440, y: 180 },
          { x: 440, y: 420 },
          { x: 220, y: 420 }
        ],
        currentWpIndex: 0
      },
      {
        id: 'sentinel_ruins',
        name: 'RUINS HAZARD DRONE',
        x: 720,
        y: 160,
        radius: 22,
        speed: 140,
        colorHex: '#FF0055',
        colorNum: 0xff0055,
        waypoints: [
          { x: 720, y: 160 },
          { x: 980, y: 160 },
          { x: 980, y: 380 },
          { x: 720, y: 380 }
        ],
        currentWpIndex: 0
      },
      {
        id: 'sentinel_cave',
        name: 'CAVE HAZARD DRONE',
        x: 1180,
        y: 660,
        radius: 22,
        speed: 130,
        colorHex: '#FF0055',
        colorNum: 0xff0055,
        waypoints: [
          { x: 1180, y: 660 },
          { x: 1480, y: 660 },
          { x: 1480, y: 900 },
          { x: 1180, y: 900 }
        ],
        currentWpIndex: 0
      }
    ];
  }

  initForMatch(seed) {
    // Reset positions to initial waypoints
    this.sentinels.forEach(s => {
      s.x = s.waypoints[0].x;
      s.y = s.waypoints[0].y;
      s.currentWpIndex = 0;
    });
  }

  tick(activePlayers, dt, now) {
    if (this.gameManager.state !== CONFIG.STATES.RUNNING) return;

    for (const sentinel of this.sentinels) {
      // 1. Move toward current waypoint
      const targetWp = sentinel.waypoints[sentinel.currentWpIndex];
      const dx = targetWp.x - sentinel.x;
      const dy = targetWp.y - sentinel.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 8) {
        sentinel.currentWpIndex = (sentinel.currentWpIndex + 1) % sentinel.waypoints.length;
      } else {
        const moveDist = Math.min(dist, sentinel.speed * dt);
        sentinel.x += (dx / dist) * moveDist;
        sentinel.y += (dy / dist) * moveDist;
      }

      // 2. Check collision with active players
      for (const player of activePlayers) {
        const pDist = Math.hypot(player.x - sentinel.x, player.y - sentinel.y);
        const hitRadius = sentinel.radius + CONFIG.PHYSICS.PLAYER_RADIUS;

        if (pDist <= hitRadius) {
          if (!player.sentinelHitCooldownUntil || now >= player.sentinelHitCooldownUntil) {
            player.sentinelHitCooldownUntil = now + 2000; // 2 seconds invulnerability

            const pointsLost = Math.min(player.score || 0, 10);
            if (pointsLost > 0) {
              player.score = Math.max(0, (player.score || 0) - pointsLost);
            }

            // Emit negative score popup on host and phone
            this.gameManager.io.emit('score_popup', {
              playerId: player.id,
              amount: -10,
              reason: 'HAZARD DRONE',
              x: Math.round(player.x),
              y: Math.round(player.y),
              colorNum: 0xff0055
            });

            // Send hit feedback to player phone
            const socket = this.gameManager.io.sockets.sockets.get(player.socketId);
            if (socket) {
              socket.emit('hazard_hit', {
                pointsLost: 10,
                message: '💥 HIT BY HAZARD DRONE (-10 PTS)!'
              });
            }

            // Host commentary event
            this.gameManager.io.emit('host_event', {
              id: Math.random().toString(36).substring(2, 9),
              type: 'hazard_hit',
              text: `💥 ${player.name} collided with a Glitch Drone! (-10 pts)`,
              colorHex: '#FF0055',
              timestamp: now
            });
          }
        }
      }
    }
  }

  getActiveSentinels() {
    return this.sentinels.map(s => ({
      id: s.id,
      name: s.name,
      x: Math.round(s.x),
      y: Math.round(s.y),
      radius: s.radius,
      colorHex: s.colorHex,
      colorNum: s.colorNum
    }));
  }
}
