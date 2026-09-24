// server/game/clueData.js - Truthful, coordinate-mapped Public Clue Chain templates for ANOMALY

export const LEGENDARY_CLUE_CHAINS = [
  {
    id: 'chain_monarch',
    title: 'THE CROWN OF THE CYBER KING',
    clues: [
      {
        step: 1,
        region: 'forest',
        pos: { x: 190, y: 270 },
        text: 'The monolith sleeps in the western forest grove.',
        shortHint: 'Western Monolith Grove'
      },
      {
        step: 2,
        region: 'ruins',
        pos: { x: 800, y: 140 },
        text: 'Look beneath the arch where ancient stone meets northern sky.',
        shortHint: 'Ruins North Arch'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1340, y: 100 },
        text: 'The king watches from the north tower of Citadel Castle.',
        shortHint: 'Castle North Tower'
      }
    ],
    finalVault: {
      id: 'vault_monarch',
      region: 'castle',
      pos: { x: 1310, y: 230 },
      name: 'The Sovereign Vault',
      clueText: 'The Sovereign Vault in Citadel Keep is now unlocked!'
    }
  },
  {
    id: 'chain_eclipse',
    title: 'THE SHADOW OF THE OBSIDIAN ECLIPSE',
    clues: [
      {
        step: 1,
        region: 'ruins',
        pos: { x: 650, y: 220 },
        text: 'The forgotten stone steps mark the path of the eclipse.',
        shortHint: 'Ruins Stone Steps'
      },
      {
        step: 2,
        region: 'cave',
        pos: { x: 1320, y: 720 },
        text: 'Deep within the dark crystal cavern, a violet beacon glows.',
        shortHint: 'Cave Crystal Cavern'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1420, y: 280 },
        text: 'Seek the eastern bastion courtyard behind castle gates.',
        shortHint: 'Castle East Courtyard'
      }
    ],
    finalVault: {
      id: 'vault_eclipse',
      region: 'castle',
      pos: { x: 1440, y: 350 },
      name: 'The Eclipse Vault',
      clueText: 'The Eclipse Vault in Citadel South Wing is now unlocked!'
    }
  },
  {
    id: 'chain_chronos',
    title: 'THE RELIC OF ANCIENT TIME',
    clues: [
      {
        step: 1,
        region: 'forest',
        pos: { x: 260, y: 150 },
        text: 'Under the high northern canopy of the Neon Forest.',
        shortHint: 'Forest High Canopy'
      },
      {
        step: 2,
        region: 'river',
        pos: { x: 760, y: 530 },
        text: 'Where the Plaza Bridge spans across the rushing river.',
        shortHint: 'Central Bridge Pier'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1250, y: 230 },
        text: 'At the reinforced gateway to the Castle Keep.',
        shortHint: 'Keep Gateway'
      }
    ],
    finalVault: {
      id: 'vault_chronos',
      region: 'castle',
      pos: { x: 1310, y: 340 },
      name: 'The Chronos Vault',
      clueText: 'The Chronos Vault within Citadel Castle is now unlocked!'
    }
  },
  {
    id: 'chain_valkyrie',
    title: 'THE SHIELD OF THE VALKYRIE',
    clues: [
      {
        step: 1,
        region: 'forest',
        pos: { x: 180, y: 720 },
        text: 'Hidden in the deep southern hollow of the Neon Forest.',
        shortHint: 'South Forest Hollow'
      },
      {
        step: 2,
        region: 'cave',
        pos: { x: 1150, y: 680 },
        text: 'At the narrow chasm entrance to the Obsidian Cave.',
        shortHint: 'Cave Chasm Entrance'
      },
      {
        step: 3,
        region: 'ruins',
        pos: { x: 920, y: 260 },
        text: 'By the eastern peristyle pillars of the Ancient Ruins.',
        shortHint: 'Ruins East Pillars'
      }
    ],
    finalVault: {
      id: 'vault_valkyrie',
      region: 'castle',
      pos: { x: 1440, y: 140 },
      name: 'The Valkyrie Vault',
      clueText: 'The Valkyrie Vault in Citadel Northeast Turret is now unlocked!'
    }
  },
  {
    id: 'chain_specter',
    title: 'THE CIPHER OF THE PHANTOM',
    clues: [
      {
        step: 1,
        region: 'ruins',
        pos: { x: 790, y: 320 },
        text: 'The central ruined altar reveals the first cipher rune.',
        shortHint: 'Ruins Central Altar'
      },
      {
        step: 2,
        region: 'river',
        pos: { x: 400, y: 530 },
        text: 'The western riverbanks where cyber currents flow gentle.',
        shortHint: 'West River Bank'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1340, y: 100 },
        text: 'High upon the north observation tower of the Citadel.',
        shortHint: 'Castle North Tower'
      }
    ],
    finalVault: {
      id: 'vault_specter',
      region: 'castle',
      pos: { x: 1310, y: 230 },
      name: 'The Phantom Vault',
      clueText: 'The Phantom Vault inside Citadel Keep is now unlocked!'
    }
  },
  {
    id: 'chain_aegis',
    title: 'THE PROTOCOL OF THE GUARDIAN',
    clues: [
      {
        step: 1,
        region: 'forest',
        pos: { x: 340, y: 880 },
        text: 'By the southern moss grove near the forest border.',
        shortHint: 'South Moss Grove'
      },
      {
        step: 2,
        region: 'cave',
        pos: { x: 1460, y: 840 },
        text: 'At the deep underground obsidian core of the cave.',
        shortHint: 'Obsidian Core'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1420, y: 280 },
        text: 'In the walled eastern courtyard of Citadel Castle.',
        shortHint: 'Castle Courtyard'
      }
    ],
    finalVault: {
      id: 'vault_aegis',
      region: 'castle',
      pos: { x: 1440, y: 350 },
      name: 'The Aegis Vault',
      clueText: 'The Aegis Vault in Citadel Grand Treasury is now unlocked!'
    }
  },
  {
    id: 'chain_phoenix',
    title: 'THE FLAME OF THE REBORN CITADEL',
    clues: [
      {
        step: 1,
        region: 'ruins',
        pos: { x: 890, y: 200 },
        text: 'The east forum column in the Ancient Ruins.',
        shortHint: 'Ruins East Forum'
      },
      {
        step: 2,
        region: 'forest',
        pos: { x: 440, y: 290 },
        text: 'The eastern tree line facing the ancient ruins.',
        shortHint: 'Forest East Tree Line'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1250, y: 230 },
        text: 'The heavy iron portal of the inner Castle Keep.',
        shortHint: 'Castle Keep Portal'
      }
    ],
    finalVault: {
      id: 'vault_phoenix',
      region: 'castle',
      pos: { x: 1310, y: 340 },
      name: 'The Phoenix Vault',
      clueText: 'The Phoenix Vault in Citadel Castle is now unlocked!'
    }
  },
  {
    id: 'chain_cipher',
    title: 'THE LEGEND OF THE OBSIDIAN CITADEL',
    clues: [
      {
        step: 1,
        region: 'cave',
        pos: { x: 1260, y: 860 },
        text: 'The shadowed labyrinth corner deep in obsidian rock.',
        shortHint: 'Cave Shadow Labyrinth'
      },
      {
        step: 2,
        region: 'river',
        pos: { x: 1240, y: 530 },
        text: 'The eastern river crossing below the Citadel walls.',
        shortHint: 'East River Crossing'
      },
      {
        step: 3,
        region: 'castle',
        pos: { x: 1440, y: 140 },
        text: 'The northeast turret overlooking the cyber realm.',
        shortHint: 'Castle Northeast Turret'
      }
    ],
    finalVault: {
      id: 'vault_cipher',
      region: 'castle',
      pos: { x: 1310, y: 230 },
      name: 'The Grand Citadel Vault',
      clueText: 'The Grand Citadel Vault is now open for claiming!'
    }
  }
];

// Minor Side Clues (Active from early game for bonus loot hints)
export const SIDE_CLUES = [
  {
    id: 'side_clue_1',
    pos: { x: 300, y: 310 },
    region: 'forest',
    title: 'ANCIENT WOODLAND GLYPH',
    text: 'A hidden cache is buried near the western bridge shallows (+25 pts).',
    reward: 25
  },
  {
    id: 'side_clue_2',
    pos: { x: 710, y: 270 },
    region: 'ruins',
    title: 'RUINS TABLET OF WEALTH',
    text: 'Locked chests in the ruins hold extra fortune during Phase 2 (+25 pts).',
    reward: 25
  },
  {
    id: 'side_clue_3',
    pos: { x: 1190, y: 780 },
    region: 'cave',
    title: 'OBSIDIAN CAVE INSCRIPTION',
    text: 'Secret passage switch opens shortcut directly into the Citadel (+25 pts).',
    reward: 25
  }
];
