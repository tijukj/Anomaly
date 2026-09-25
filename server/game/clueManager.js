// server/game/clueManager.js - Authoritative Public Clue Chains and Legendary Treasure Manager
import { CONFIG } from '../config.js';
import { LEGENDARY_CLUE_CHAINS, SIDE_CLUES } from './clueData.js';
import { createRng } from './seededRng.js';

export class ClueManager {
  constructor(gameManager, scoring) {
    this.gameManager = gameManager;
    this.scoring = scoring;
    this.rng = createRng(54321);
    this.selectedChain = null;
    this.activeStep = 0; // 0: Hidden (pre-6:00), 1..3: Clues 1-3, 4: Vault Active, 5: Claimed
    this.knownClues = [];
    this.sideClues = [];
    this.legendaryVault = null;
    this.finalRevelationAnnounced = false;
    this.awakenedAnnounced = false;
  }

  initForMatch(seed) {
    this.rng = createRng(seed);
    this.selectedChain = this.rng.pick(LEGENDARY_CLUE_CHAINS, 1)[0];
    this.activeStep = 0;
    this.knownClues = [];
    this.finalRevelationAnnounced = false;
    this.awakenedAnnounced = false;

    // Reset Side Clues
    this.sideClues = SIDE_CLUES.map(sc => ({
      ...sc,
      discovered: false,
      discoveredBy: null
    }));

    // Setup Legendary Vault
    this.legendaryVault = {
      id: this.selectedChain.finalVault.id,
      name: this.selectedChain.finalVault.name,
      x: this.selectedChain.finalVault.pos.x,
      y: this.selectedChain.finalVault.pos.y,
      region: this.selectedChain.finalVault.region,
      points: CONFIG.LEGENDARY.POINTS,
      state: 'hidden', // 'hidden', 'active', 'revealed', 'claimed'
      claimedBy: null
    };

    console.log(`[ClueManager] Initialized Clue Chain "${this.selectedChain.title}" (Vault in ${this.legendaryVault.name} at (${this.legendaryVault.x}, ${this.legendaryVault.y}))`);
  }

  // 20Hz Tick: Process timeline triggers (6:00 Awakening & 8:00 Final Revelation)
  tick(now, elapsedFraction) {
    // 1. Timeline Trigger: 6:00 (Phase 3: The Hunt) -> Clue Chain Awakens
    if (elapsedFraction >= CONFIG.LEGENDARY.START_REVEAL_FRACTION && this.activeStep === 0) {
      this.activeStep = 1;
      if (!this.awakenedAnnounced) {
        this.awakenedAnnounced = true;
        console.log(`[ClueManager] 📜 LEGENDARY CHAIN AWAKENED: Clue 1 is now active in ${this.selectedChain.clues[0].region.toUpperCase()}!`);
        this.gameManager.io.emit('host_event', {
          id: Math.random().toString(36).substring(2, 9),
          type: 'clue_awakened',
          text: `📜 LEGENDARY CLUE CHAIN AWAKENED! Clue 1 has appeared in the ${this.selectedChain.clues[0].region.toUpperCase()}!`,
          colorHex: CONFIG.LEGENDARY.CLUE_COLOR_HEX,
          timestamp: now
        });
      }
    }

    // 2. Timeline Trigger: 8:00 (Phase 4: Chaos Finale) -> Final Revelation
    if (elapsedFraction >= CONFIG.LEGENDARY.FINAL_REVELATION_FRACTION) {
      if (this.activeStep < 4 && this.legendaryVault.state !== 'claimed') {
        this.activeStep = 4;
        this.legendaryVault.state = 'revealed';

        if (!this.finalRevelationAnnounced) {
          this.finalRevelationAnnounced = true;
          console.log(`[ClueManager] 👑 FINAL REVELATION: Legendary Vault location exposed in Citadel Castle!`);
          this.gameManager.io.emit('final_revelation', {
            vaultName: this.legendaryVault.name,
            x: this.legendaryVault.x,
            y: this.legendaryVault.y,
            text: `👑 FINAL REVELATION: The Legendary Vault (${this.legendaryVault.name}) is now fully exposed in Citadel Castle!`
          });

          this.gameManager.io.emit('host_event', {
            id: Math.random().toString(36).substring(2, 9),
            type: 'final_revelation',
            text: `👑 FINAL REVELATION: The Legendary Vault is exposed in Citadel Castle! (+150 pts)`,
            colorHex: CONFIG.LEGENDARY.VAULT_COLOR_HEX,
            timestamp: now
          });
        }
      }
    }
  }

  // Get active clue & vault entities to be drawn and collided
  getActiveEntities() {
    const entities = [];

    // 1. Current Active Legendary Clue
    if (this.activeStep >= 1 && this.activeStep <= 3) {
      const clue = this.selectedChain.clues[this.activeStep - 1];
      if (clue) {
        entities.push({
          id: `legendary_clue_${this.activeStep}`,
          type: 'clue',
          isLegendary: true,
          step: this.activeStep,
          x: clue.pos.x,
          y: clue.pos.y,
          radius: CONFIG.INTERACT_RADIUS.CLUE,
          colorHex: CONFIG.LEGENDARY.CLUE_COLOR_HEX,
          colorNum: CONFIG.LEGENDARY.CLUE_COLOR_NUM,
          state: 'active'
        });
      }
    }

    // 2. Minor Side Clues (Bonus early clues)
    for (const sc of this.sideClues) {
      if (!sc.discovered) {
        entities.push({
          id: sc.id,
          type: 'side_clue',
          x: sc.pos.x,
          y: sc.pos.y,
          radius: CONFIG.INTERACT_RADIUS.CLUE,
          colorHex: '#00FFCC',
          colorNum: 0x00ffcc,
          state: 'active'
        });
      }
    }

    // 3. Legendary Vault (Visible when unlocked by Clue 3 or Final Revelation)
    if (this.activeStep >= 4 || this.legendaryVault.state === 'revealed' || this.legendaryVault.state === 'active') {
      entities.push({
        id: 'legendary_vault',
        type: 'legendary_vault',
        name: this.legendaryVault.name,
        x: this.legendaryVault.x,
        y: this.legendaryVault.y,
        radius: CONFIG.INTERACT_RADIUS.LEGENDARY_VAULT,
        points: CONFIG.LEGENDARY.POINTS,
        colorHex: CONFIG.LEGENDARY.VAULT_COLOR_HEX,
        colorNum: CONFIG.LEGENDARY.VAULT_COLOR_NUM,
        state: this.legendaryVault.state
      });
    }

    return entities;
  }

  // Handle player pressing ACTION on a clue or the Legendary Vault
  handleAction(player, ent, now) {
    if (!player || !ent) return;

    // A. Legendary Clue Interaction
    if (ent.type === 'clue' && ent.isLegendary) {
      const step = ent.step;
      if (step === this.activeStep) {
        const clue = this.selectedChain.clues[step - 1];
        
        // Award points to discoverer
        this.scoring.awardPoints(player, CONFIG.SCORING.CLUE_DISCOVERY, `DISCOVERED CLUE #${step}`, { x: ent.x, y: ent.y });

        if (this.gameManager.statsTracker) {
          this.gameManager.statsTracker.recordClue(player, step);
        }

        // Record in public known clues
        const clueRecord = {
          step,
          text: clue.text,
          shortHint: clue.shortHint,
          region: clue.region,
          discoverer: player.name,
          colorHex: player.color.hex,
          timestamp: now
        };
        this.knownClues.push(clueRecord);

        // Advance chain step
        this.activeStep++;
        if (this.activeStep === 4) {
          this.legendaryVault.state = 'active';
        }

        console.log(`[ClueManager] 📜 Public Clue #${step} Discovered by ${player.name}: "${clue.text}"`);

        // Broadcast PUBLIC CLUE to all players and host screen
        this.gameManager.io.emit('public_clue_found', {
          step,
          totalSteps: 3,
          text: clue.text,
          shortHint: clue.shortHint,
          discoverer: player.name,
          colorHex: player.color.hex,
          chainTitle: this.selectedChain.title,
          isFinalClue: step === 3,
          vaultName: this.selectedChain.finalVault.name,
          knownClues: this.knownClues
        });

        this.gameManager.io.emit('host_event', {
          id: Math.random().toString(36).substring(2, 9),
          type: 'clue_found',
          text: `📜 [CLUE #${step}/3] ${player.name}: "${clue.text}"`,
          colorHex: player.color.hex,
          timestamp: now
        });
      }
    }

    // B. Minor Side Clue Interaction
    else if (ent.type === 'side_clue') {
      const sc = this.sideClues.find(c => c.id === ent.id);
      if (sc && !sc.discovered) {
        sc.discovered = true;
        sc.discoveredBy = player.name;
        this.scoring.awardPoints(player, sc.reward || CONFIG.SCORING.SIDE_CLUE_BONUS, `SIDE CLUE: ${sc.title}`, { x: ent.x, y: ent.y });

        if (this.gameManager.statsTracker) {
          this.gameManager.statsTracker.recordSideClue(player);
        }

        this.gameManager.io.emit('host_event', {
          id: Math.random().toString(36).substring(2, 9),
          type: 'side_clue',
          text: `📜 ${player.name} found ${sc.title}! (+${sc.reward} pts)`,
          colorHex: player.color.hex,
          timestamp: now
        });
      }
    }

    // C. Legendary Vault Interaction
    else if (ent.type === 'legendary_vault') {
      if (this.legendaryVault.state !== 'claimed') {
        this.legendaryVault.state = 'claimed';
        this.legendaryVault.claimedBy = player.name;
        this.activeStep = 5;

        // Award Massive +150 Points
        this.scoring.awardPoints(
          player,
          CONFIG.LEGENDARY.POINTS,
          'LEGENDARY TREASURE FOUND',
          { x: ent.x, y: ent.y }
        );

        if (this.gameManager.statsTracker) {
          this.gameManager.statsTracker.recordLegendaryTreasure(player);
        }

        console.log(`[ClueManager] 👑👑 LEGENDARY TREASURE FOUND BY ${player.name}! (+${CONFIG.LEGENDARY.POINTS} PTS)`);

        // Broadcast Full Screen Celebration
        this.gameManager.io.emit('legendary_found', {
          playerName: player.name,
          playerColorHex: player.color.hex,
          vaultName: this.legendaryVault.name,
          points: CONFIG.LEGENDARY.POINTS
        });

        this.gameManager.io.emit('host_event', {
          id: Math.random().toString(36).substring(2, 9),
          type: 'legendary_found',
          text: `👑 LEGENDARY TREASURE: ${player.name} discovered ${this.legendaryVault.name}! (+${CONFIG.LEGENDARY.POINTS} pts)`,
          colorHex: '#FFE600',
          timestamp: now
        });
      }
    }
  }

  // Get prompt text for mobile smart action button
  getPrompt(player, ent) {
    if (ent.type === 'clue') {
      return {
        available: true,
        label: `READ CLUE #${ent.step} 📜`,
        color: CONFIG.LEGENDARY.CLUE_COLOR_HEX,
        progress: 0
      };
    }
    if (ent.type === 'side_clue') {
      return {
        available: true,
        label: 'READ GLYPH 📜',
        color: '#00FFCC',
        progress: 0
      };
    }
    if (ent.type === 'legendary_vault') {
      if (this.legendaryVault.state === 'claimed') {
        return {
          available: false,
          label: 'VAULT CLAIMED 🔒',
          color: '#666688',
          progress: 0
        };
      }
      return {
        available: true,
        label: 'CLAIM LEGENDARY 👑 (+150)',
        color: '#FFE600',
        progress: 0
      };
    }
    return null;
  }

  // Current active target position for bots or directional clues
  getCurrentTarget() {
    if (this.activeStep >= 1 && this.activeStep <= 3) {
      const clue = this.selectedChain.clues[this.activeStep - 1];
      return clue ? clue.pos : null;
    }
    if (this.activeStep >= 4 && this.legendaryVault.state !== 'claimed') {
      return { x: this.legendaryVault.x, y: this.legendaryVault.y };
    }
    return null;
  }

  // Public state for Host "Known Clues" panel & synchronization
  getPublicClueState() {
    return {
      activeStep: this.activeStep,
      chainTitle: this.selectedChain ? this.selectedChain.title : 'THE LEGENDARY TREASURE',
      knownClues: this.knownClues,
      vaultState: this.legendaryVault ? this.legendaryVault.state : 'hidden',
      vaultName: this.legendaryVault ? this.legendaryVault.name : 'Citadel Vault'
    };
  }
}
