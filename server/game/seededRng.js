// server/game/seededRng.js - Fast deterministic pseudo-random number generator

export function createRng(seed) {
  let s = (typeof seed === 'number' ? seed : 123456) >>> 0;

  // Mulberry32 deterministic generator
  function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed: s,
    random: next,
    range: (min, max) => min + next() * (max - min),
    rangeInt: (min, max) => Math.floor(min + next() * (max - min + 1)),
    shuffle: (arr) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    pick: (arr, count = 1) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count);
    }
  };
}
