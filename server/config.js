// server/config.js - Central tunable configuration for ANOMALY

export const CONFIG = {
  // Network & Server
  PORT: process.env.PORT || 3000,
  HOST: '0.0.0.0',
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  TICK_RATE: 20, // 20 ticks per second
  TICK_INTERVAL_MS: 1000 / 20, // 50ms per tick
  INPUT_HEARTBEAT_MS: 250, // 250ms heartbeat for controller inputs

  // Match Timeline & Durations
  COUNTDOWN_DURATION_SEC: 5, // 5s pre-match countdown
  STANDARD_MATCH_DURATION_SEC: 600, // 10 minutes standard
  SHORT_MATCH_DURATION_SEC: 120, // 2 minutes short test mode
  DEBUG_SHORT_MATCH: false, // Set to true for rapid 120s match testing

  // Four Match Phases by Time Fraction (0.0 to 1.0)
  PHASES: [
    {
      id: 'discovery',
      name: 'PHASE 1: DISCOVERY',
      subtitle: 'EXPLORE THE MAP & FIND EASY TREASURES',
      fractionStart: 0.0,
      fractionEnd: 0.2,
      colorHex: '#00F0FF',
      weights: { common: 0.75, rare: 0.25, epic: 0.0 }
    },
    {
      id: 'competition',
      name: 'PHASE 2: COMPETITION',
      subtitle: 'VALUABLE LOOT SPAWNING - OPEN CHESTS',
      fractionStart: 0.2,
      fractionEnd: 0.6,
      colorHex: '#39FF14',
      weights: { common: 0.40, rare: 0.45, epic: 0.15 }
    },
    {
      id: 'hunt',
      name: 'PHASE 3: THE HUNT',
      subtitle: 'LEGENDARY CLUES ACTIVE - UNLOCK CITADEL & CAVES',
      fractionStart: 0.6,
      fractionEnd: 0.8,
      colorHex: '#FFAA00',
      weights: { common: 0.20, rare: 0.50, epic: 0.30 }
    },
    {
      id: 'chaos',
      name: 'PHASE 4: CHAOS FINALE',
      subtitle: 'LEGENDARY REVELATION & HIGH STAKES - RACE TO 1ST',
      fractionStart: 0.8,
      fractionEnd: 1.0,
      colorHex: '#FF0055',
      weights: { common: 0.10, rare: 0.40, epic: 0.50 }
    }
  ],

  // World Map Dimensions (1600x1000)
  WORLD: {
    WIDTH: 1600,
    HEIGHT: 1000
  },

  // Authoritative Physics & Movement
  PHYSICS: {
    MAX_SPEED: 420, // Maximum pixels per second
    ACCELERATION: 1600, // Pixels per second squared
    FRICTION: 0.85, // Velocity damping factor per tick
    PLAYER_RADIUS: 24, // Collision & render radius
    RIVER_SPEED_MULTIPLIER: 0.55, // Speed multiplier when wading in water without bridge
    PLAYER_PUSH_FORCE: 0.5 // Soft body-blocking push factor between players
  },

  // Player Settings
  MAX_PLAYERS: 20,
  MIN_PLAYERS_TO_START: 1,
  MAX_NAME_LENGTH: 12,

  // Start Plaza Spawn (Center of map)
  SPAWN_PLAZA: {
    X: 800,
    Y: 530,
    RADIUS: 85
  },

  // Scoring Values
  SCORING: {
    TREASURE_COMMON: 5,
    TREASURE_RARE: 15,
    TREASURE_EPIC: 30,
    TREASURE_GLITCH: 40,
    CHEST_MIN: 10,
    CHEST_MAX: 35,
    VAULT: 50,
    CLUE_DISCOVERY: 15,
    SIDE_CLUE_BONUS: 25,
    LEGENDARY_TREASURE: 150,
    DISCOVERY_BONUS: 10,
    MERCHANT_MIN: 5,
    MERCHANT_MAX: 25,
    MERCHANT_COOLDOWN_SEC: 20,
    PORTAL_COOLDOWN_SEC: 3,
    CHEST_HOLD_MS: 1000,
    TREASURE_RESPAWN_MS: 7000
  },

  // Dynamic Transient / Glitch Treasures (Random appearance for a few seconds)
  GLITCH_TREASURE: {
    DURATION_SEC: 10, // Stays active for 10 seconds before vanishing
    SPAWN_INTERVAL_SEC: 35, // Spawns a new one every 35 seconds
    RADIUS: 46,
    COLOR_HEX: '#FF00FF',
    COLOR_NUM: 0xff00ff,
    POINTS: 40
  },

  // Phase 7: Public Clue Chains & The Legendary Treasure Configuration
  LEGENDARY: {
    POINTS: 150,
    START_REVEAL_FRACTION: 0.60, // Legendary chain awakens at 6:00 (Phase 3: The Hunt)
    FINAL_REVELATION_FRACTION: 0.80, // Final Vault fully revealed at 8:00 (Phase 4: Chaos Finale)
    BANNER_DISPLAY_MS: 6000, // Show public clue large on host screen for 6 seconds
    SIDE_CLUE_COUNT: 3, // Bonus minor side clues available from match start
    VAULT_COLOR_HEX: '#FFE600',
    VAULT_COLOR_NUM: 0xffe600,
    CLUE_COLOR_HEX: '#00F0FF',
    CLUE_COLOR_NUM: 0x00f0ff
  },

  // Phase 6: Dynamic Mission System Configuration
  MISSIONS: {
    NEW_MISSION_DELAY_SEC: 3, // Delay before assigning next mission after completion
    RUNNER_TIME_LIMIT_FRACTION: 0.5, // Runner mission must be completed in first half of match (e.g. before 5:00)
    REWARDS: {
      EXPLORER: 25,
      COLLECTOR: 35,
      RUNNER: 40,
      OPPORTUNIST: 50,
      COMMON_HOARDER: 20,
      PORTAL_JUMPER: 25,
      BRIDGE_CROSSER: 20,
      MERCHANT_DEAL: 30
    },
    BASE_WEIGHTS: {
      EXPLORER: 1.0,
      COLLECTOR: 1.0,
      RUNNER: 0.8,
      OPPORTUNIST: 1.2,
      COMMON_HOARDER: 1.0,
      PORTAL_JUMPER: 0.9,
      BRIDGE_CROSSER: 1.0,
      MERCHANT_DEAL: 0.9
    },
    RECENT_HISTORY_PENALTY: 0.35 // Multiplier on weight if template was done recently
  },

  // Phase 8: Anomaly Events System Configuration
  ANOMALIES: {
    INTERVAL_SEC: 60, // Anomaly triggers every 60 seconds
    SPEED_MULTIPLIER: 1.5,
    CROWN_POINTS_PER_TICK: 5,
    CROWN_TICK_INTERVAL_SEC: 2,
    CROWN_STEAL_PROTECTION_SEC: 3,
    TREASURE_RAIN_COUNT: 8,
    FOG_RADIUS: 140
  },

  // Interaction Radii (distance in pixels - requires player to be directly on/adjacent to point)
  INTERACT_RADIUS: {
    TREASURE: 26, // Close contact required (player radius is 24)
    CHEST: 34,
    VAULT: 38,
    KEY: 26,
    SWITCH: 34,
    PORTAL: 34,
    MERCHANT: 38,
    GLITCH: 30,
    CLUE: 32,
    LEGENDARY_VAULT: 40,
    CROWN: 36
  },

  // Seeded POI Counts Per Match
  POI_COUNTS: {
    TREASURES: 14,
    CHESTS: 4,
    VAULTS: 2,
    KEYS: 2,
    CLUES: 5,
    MISSIONS: 3,
    PORTAL_PAIRS: 1,
    MERCHANTS: 2
  },

  // Player Neon Palette
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

  // 10 Fixed Animal Avatars for Retro Pixel-Art Characters
  PLAYER_ANIMALS: [
    { id: 'fox', name: 'Fox', icon: '🦊', color: '#FF7A00' },
    { id: 'owl', name: 'Owl', icon: '🦉', color: '#8B5A2B' },
    { id: 'cat', name: 'Cat', icon: '🐱', color: '#FFB800' },
    { id: 'frog', name: 'Frog', icon: '🐸', color: '#39FF14' },
    { id: 'bear', name: 'Bear', icon: '🐻', color: '#6A3805' },
    { id: 'wolf', name: 'Wolf', icon: '🐺', color: '#A0B2C6' },
    { id: 'bee', name: 'Bee', icon: '🐝', color: '#FFE600' },
    { id: 'crab', name: 'Crab', icon: '🦀', color: '#FF0055' },
    { id: 'panda', name: 'Panda', icon: '🐼', color: '#FFFFFF' },
    { id: 'penguin', name: 'Penguin', icon: '🐧', color: '#00F0FF' }
  ],

  // UI Polish & Animation Durations
  UI_POLISH: {
    LEADERBOARD_SLIDE_DURATION_MS: 300,
    EVENT_FEED_FLASH_DURATION_MS: 1000,
    PHASE_TIMER_WARNING_THRESHOLD_SEC: 30,
    SCREEN_FLASH_DURATION_MS: 1000,
    CLUE_SLOT_FADE_DURATION_MS: 400
  },

  // Competitive Tension, Steals, Near-Miss & Rivalry Tunables
  COMPETITIVE: {
    CONTESTED_RADIUS: 75, // Distance (px) within which players contest high-value loot
    CONTESTED_COOLDOWN_MS: 3500, // Debounce time between broadcasting contested events
    NEAR_MISS_WINDOW_MS: 1000, // 1.0 second window for second racer to trigger "SO CLOSE"
    NEAR_MISS_RADIUS: 65, // Proximity to claimed loot to trigger near-miss toast
    NEAR_MISS_DISPLAY_MS: 2000, // Host screen near-miss toast display duration
    RIVALRY_STEAL_THRESHOLD: 2 // Number of cross-steals each required to establish a rivalry
  },

  // Game States
  STATES: {
    LOBBY: 'LOBBY',
    COUNTDOWN: 'COUNTDOWN',
    RUNNING: 'RUNNING',
    ENDED: 'ENDED'
  }
};
