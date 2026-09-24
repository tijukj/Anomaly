// server/game/mapData.js - Static map topology, regions, walls, and candidate POI pools

export const MAP_REGIONS = [
  {
    id: 'forest',
    name: 'NEON FOREST',
    colorHex: '#00FF66',
    colorNum: 0x00ff66,
    bounds: { x: 40, y: 40, width: 480, height: 920 },
    labelPos: { x: 280, y: 80 }
  },
  {
    id: 'ruins',
    name: 'ANCIENT RUINS',
    colorHex: '#FF9900',
    colorNum: 0xff9900,
    bounds: { x: 560, y: 40, width: 480, height: 400 },
    labelPos: { x: 800, y: 75 }
  },
  {
    id: 'castle',
    name: 'CITADEL CASTLE',
    colorHex: '#3377FF',
    colorNum: 0x3377ff,
    bounds: { x: 1080, y: 40, width: 480, height: 420 },
    labelPos: { x: 1320, y: 75 }
  },
  {
    id: 'river',
    name: 'CYBER RIVER',
    colorHex: '#00CCFF',
    colorNum: 0x00ccff,
    bounds: { x: 40, y: 470, width: 1520, height: 120 },
    labelPos: { x: 190, y: 530 }
  },
  {
    id: 'cave',
    name: 'OBSIDIAN CAVE',
    colorHex: '#CC00FF',
    colorNum: 0xcc00ff,
    bounds: { x: 1060, y: 580, width: 500, height: 380 },
    labelPos: { x: 1310, y: 920 }
  },
  {
    id: 'plaza',
    name: 'START PLAZA',
    colorHex: '#00F0FF',
    colorNum: 0x00f0ff,
    bounds: { x: 680, y: 460, width: 240, height: 140 },
    labelPos: { x: 800, y: 640 }
  }
];

// River Water Slowdown Zones (Rectangles)
export const RIVER_ZONES = [
  { x: 40, y: 470, width: 340, height: 120 },
  { x: 460, y: 470, width: 280, height: 120 },
  { x: 860, y: 470, width: 360, height: 120 },
  { x: 1300, y: 470, width: 260, height: 120 }
];

// 3 Safe Bridges crossing the river (Exempt from water speed penalty)
export const BRIDGES = [
  { id: 'bridge_west', name: 'West Bridge', x: 380, y: 460, width: 80, height: 140, colorNum: 0x00f0ff },
  { id: 'bridge_center', name: 'Plaza Bridge', x: 740, y: 460, width: 120, height: 140, colorNum: 0x39ff14 },
  { id: 'bridge_east', name: 'East Bridge', x: 1220, y: 460, width: 80, height: 140, colorNum: 0x00f0ff }
];

// Static Walls & Obstacles (AABB collision rectangles)
export const STATIC_WALLS = [
  // Outer perimeter boundary
  { x: 20, y: 20, width: 1560, height: 16, type: 'boundary' },
  { x: 20, y: 964, width: 1560, height: 16, type: 'boundary' },
  { x: 20, y: 20, width: 16, height: 960, type: 'boundary' },
  { x: 1564, y: 20, width: 16, height: 960, type: 'boundary' },

  // --- FOREST OBSTACLES (Clusters & Tree Stands) ---
  { x: 140, y: 160, width: 90, height: 90, type: 'forest', colorNum: 0x00bb44 },
  { x: 320, y: 220, width: 110, height: 70, type: 'forest', colorNum: 0x00bb44 },
  { x: 120, y: 340, width: 80, height: 100, type: 'forest', colorNum: 0x00bb44 },
  { x: 260, y: 380, width: 90, height: 60, type: 'forest', colorNum: 0x00bb44 },
  { x: 100, y: 640, width: 110, height: 90, type: 'forest', colorNum: 0x00bb44 },
  { x: 300, y: 660, width: 80, height: 110, type: 'forest', colorNum: 0x00bb44 },
  { x: 180, y: 800, width: 130, height: 80, type: 'forest', colorNum: 0x00bb44 },
  { x: 380, y: 780, width: 90, height: 90, type: 'forest', colorNum: 0x00bb44 },

  // --- ANCIENT RUINS (Pillars & Crumbling Corridors) ---
  { x: 600, y: 120, width: 30, height: 160, type: 'ruins', colorNum: 0xcc7700 },
  { x: 700, y: 120, width: 180, height: 26, type: 'ruins', colorNum: 0xcc7700 },
  { x: 940, y: 120, width: 30, height: 160, type: 'ruins', colorNum: 0xcc7700 },
  { x: 680, y: 240, width: 30, height: 120, type: 'ruins', colorNum: 0xcc7700 },
  { x: 860, y: 240, width: 30, height: 120, type: 'ruins', colorNum: 0xcc7700 },
  { x: 740, y: 320, width: 90, height: 30, type: 'ruins', colorNum: 0xcc7700 },

  // --- CITADEL CASTLE (Fortress Walls with 2 Gates) ---
  { x: 1120, y: 80, width: 400, height: 24, type: 'castle', colorNum: 0x3366cc },
  { x: 1496, y: 80, width: 24, height: 340, type: 'castle', colorNum: 0x3366cc },
  // South wall with South Gate gap (Gate at x: 1280-1360)
  { x: 1120, y: 400, width: 160, height: 24, type: 'castle', colorNum: 0x3366cc },
  { x: 1360, y: 400, width: 160, height: 24, type: 'castle', colorNum: 0x3366cc },
  // West wall with West Gate gap (Gate at y: 200-280)
  { x: 1120, y: 80, width: 24, height: 120, type: 'castle', colorNum: 0x3366cc },
  { x: 1120, y: 280, width: 24, height: 144, type: 'castle', colorNum: 0x3366cc },
  // Castle Keep inner structure
  { x: 1250, y: 170, width: 120, height: 120, type: 'castle', colorNum: 0x4488ff },

  // --- OBSIDIAN CAVE (Labyrinth Walls & Choke Points) ---
  { x: 1120, y: 640, width: 28, height: 220, type: 'cave', colorNum: 0x9900cc },
  { x: 1120, y: 640, width: 180, height: 28, type: 'cave', colorNum: 0x9900cc },
  { x: 1380, y: 640, width: 140, height: 28, type: 'cave', colorNum: 0x9900cc },
  { x: 1240, y: 740, width: 180, height: 28, type: 'cave', colorNum: 0x9900cc },
  { x: 1400, y: 740, width: 28, height: 160, type: 'cave', colorNum: 0x9900cc },
  { x: 1180, y: 840, width: 160, height: 28, type: 'cave', colorNum: 0x9900cc },

  // --- SOUTH CENTRAL / PLAZA SURROUNDS ---
  { x: 620, y: 680, width: 28, height: 140, type: 'plaza', colorNum: 0x0099cc },
  { x: 950, y: 680, width: 28, height: 140, type: 'plaza', colorNum: 0x0099cc },
  { x: 720, y: 800, width: 160, height: 28, type: 'plaza', colorNum: 0x0099cc }
];

// Secret Passage Wall (Opens when secret switch is activated)
export const SECRET_PASSAGE_WALL = {
  id: 'secret_door',
  x: 1496,
  y: 200,
  width: 24,
  height: 80,
  type: 'secret_door',
  colorNum: 0xff0055
};

// Candidate POI Pools for Seeded Match Placement
export const POI_POOLS = {
  treasures: [
    { id: 't1', region: 'forest', x: 190, y: 270, tier: 'common' },
    { id: 't2', region: 'forest', x: 260, y: 150, tier: 'common' },
    { id: 't3', region: 'forest', x: 100, y: 470, tier: 'rare' },
    { id: 't4', region: 'forest', x: 380, y: 350, tier: 'common' },
    { id: 't5', region: 'forest', x: 180, y: 720, tier: 'rare' },
    { id: 't6', region: 'forest', x: 340, y: 900, tier: 'epic' },
    { id: 't7', region: 'ruins', x: 650, y: 200, tier: 'common' },
    { id: 't8', region: 'ruins', x: 890, y: 200, tier: 'rare' },
    { id: 't9', region: 'ruins', x: 790, y: 280, tier: 'common' },
    { id: 't10', region: 'ruins', x: 920, y: 380, tier: 'rare' },
    { id: 't11', region: 'castle', x: 1180, y: 140, tier: 'rare' },
    { id: 't12', region: 'castle', x: 1440, y: 140, tier: 'epic' },
    { id: 't13', region: 'castle', x: 1310, y: 230, tier: 'epic' },
    { id: 't14', region: 'castle', x: 1440, y: 350, tier: 'rare' },
    { id: 't15', region: 'cave', x: 1200, y: 700, tier: 'rare' },
    { id: 't16', region: 'cave', x: 1340, y: 690, tier: 'rare' },
    { id: 't17', region: 'cave', x: 1280, y: 800, tier: 'epic' },
    { id: 't18', region: 'cave', x: 1470, y: 880, tier: 'epic' },
    { id: 't19', region: 'plaza', x: 790, y: 740, tier: 'common' },
    { id: 't20', region: 'plaza', x: 670, y: 860, tier: 'common' }
  ],
  chests: [
    { id: 'ch1', region: 'forest', x: 440, y: 290 },
    { id: 'ch2', region: 'ruins', x: 790, y: 360 },
    { id: 'ch3', region: 'castle', x: 1210, y: 230 },
    { id: 'ch4', region: 'cave', x: 1330, y: 790 },
    { id: 'ch5', region: 'plaza', x: 890, y: 740 }
  ],
  vaults: [
    { id: 'v1', region: 'ruins', x: 790, y: 180, name: 'Sunken Vault' },
    { id: 'v2', region: 'castle', x: 1310, y: 340, name: 'Citadel Vault' },
    { id: 'v3', region: 'cave', x: 1460, y: 800, name: 'Obsidian Vault' }
  ],
  keys: [
    { id: 'k1', region: 'forest', x: 280, y: 860 },
    { id: 'k2', region: 'ruins', x: 630, y: 160 },
    { id: 'k3', region: 'cave', x: 1150, y: 710 }
  ],
  clues: [
    { id: 'c1', region: 'forest', x: 300, y: 310 },
    { id: 'c2', region: 'forest', x: 120, y: 760 },
    { id: 'c3', region: 'ruins', x: 710, y: 270 },
    { id: 'c4', region: 'ruins', x: 870, y: 270 },
    { id: 'c5', region: 'castle', x: 1200, y: 330 },
    { id: 'c6', region: 'cave', x: 1190, y: 780 }
  ],
  missions: [
    { id: 'm1', region: 'forest', label: 'Explore the Neon Forest' },
    { id: 'm2', region: 'ruins', label: 'Uncover the Ancient Ruins' },
    { id: 'm3', region: 'castle', label: 'Infiltrate Citadel Castle' },
    { id: 'm4', region: 'cave', label: 'Survive the Obsidian Cave' }
  ],
  secretSwitches: [
    { id: 'sw1', region: 'cave', x: 1150, y: 890, target: 'secret_door' },
    { id: 'sw2', region: 'ruins', x: 630, y: 290, target: 'secret_door' },
    { id: 'sw3', region: 'forest', x: 440, y: 840, target: 'secret_door' }
  ],
  portalPairs: [
    {
      id: 'portal_pair_1',
      a: { region: 'forest', x: 440, y: 120, colorNum: 0x00f0ff },
      b: { region: 'cave', x: 1100, y: 920, colorNum: 0x00f0ff }
    },
    {
      id: 'portal_pair_2',
      a: { region: 'ruins', x: 590, y: 380, colorNum: 0xff00cc },
      b: { region: 'castle', x: 1460, y: 120, colorNum: 0xff00cc }
    }
  ],
  merchants: [
    { id: 'merc_1', region: 'plaza', x: 740, y: 640, name: 'CYBER-MERCHANT' },
    { id: 'merc_2', region: 'forest', x: 430, y: 410, name: 'FOREST-BROKER' },
    { id: 'merc_3', region: 'castle', x: 1180, y: 380, name: 'CITADEL-ARMS' }
  ]
};
