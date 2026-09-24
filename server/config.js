// server/config.js - Central tunable configuration for ANOMALY

export const CONFIG = {
  // Network & Server
  PORT: process.env.PORT || 3000,
  HOST: '0.0.0.0',
  PUBLIC_URL: process.env.PUBLIC_URL || '', // Optional explicit domain (e.g. https://anomaly.onrender.com)
  TICK_RATE: 20, // 20 ticks per second
  TICK_INTERVAL_MS: 1000 / 20, // 50ms per tick
  INPUT_HEARTBEAT_MS: 250, // 250ms heartbeat for controller inputs

  // World Map Dimensions (Host canvas maps to this resolution)
  WORLD: {
    WIDTH: 1600,
    HEIGHT: 1000
  },

  // Authoritative Physics & Movement
  PHYSICS: {
    MAX_SPEED: 420, // Maximum pixels per second
    ACCELERATION: 1600, // Pixels per second squared
    FRICTION: 0.85, // Velocity damping factor per tick (0 = full stop, 1 = ice)
    PLAYER_RADIUS: 24 // Collision & render radius
  },

  // Player Settings
  MAX_PLAYERS: 20,
  MIN_PLAYERS_TO_START: 1,
  MAX_NAME_LENGTH: 12,

  // Player Neon Palette (Hex strings and numerical values for Phaser)
  PLAYER_COLORS: [
    { hex: '#00F0FF', num: 0x00f0ff, name: 'Cyber Cyan' },
    { hex: '#39FF14', num: 0x39ff14, name: 'Neon Lime' },
    { hex: '#FF0055', num: 0xff0055, name: 'Hot Pink' },
    { hex: '#FFE600', num: 0xffe600, name: 'Electric Yellow' },
    { hex: '#9D00FF', num: 0x9d00ff, name: 'Neon Purple' },
    { hex: '#FF5400', num: 0xff5400, name: 'Blaze Orange' },
    { hex: '#00FF9F', num: 0x00ff9f, name: 'Spring Green' },
    { hex: '#FF00A0', num: 0xff00a0, name: 'Deep Magenta' },
    { hex: '#00B4D8', num: 0x00b4d8, name: 'Sky Blue' },
    { hex: '#FF3333', num: 0xff3333, name: 'Laser Red' },
    { hex: '#7000FF', num: 0x7000ff, name: 'Ultra Violet' },
    { hex: '#CCFF00', num: 0xccff00, name: 'Volt Lime' },
    { hex: '#FF66CC', num: 0xff66cc, name: 'Neon Rose' },
    { hex: '#00FFFF', num: 0x00ffff, name: 'Aqua Glow' },
    { hex: '#FFAA00', num: 0xffaa00, name: 'Amber Glow' },
    { hex: '#A600FF', num: 0xa600ff, name: 'Neon Indigo' },
    { hex: '#14FFEC', num: 0x14ffec, name: 'Turquoise Neon' },
    { hex: '#FF0038', num: 0xff0038, name: 'Crimson Pulse' },
    { hex: '#DFFF00', num: 0xdfff00, name: 'Chartreuse Flare' },
    { hex: '#0077FE', num: 0x0077fe, name: 'Cobalt Neon' }
  ],

  // Game States
  STATES: {
    LOBBY: 'LOBBY',
    RUNNING: 'RUNNING',
    ENDED: 'ENDED'
  }
};
