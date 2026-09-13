export type Rng = () => number // returns a float in [0, 1), like Math.random()

// mulberry32 — small, fast, deterministic PRNG. Same seed always produces
// the same sequence, which is what makes Daily/VS challenges fair.
export function mulberry32(seed: number): Rng {
  let a = seed
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashStringToSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return (h ^ (h >>> 16)) >>> 0
}

export function createRng(seedStr: string): Rng {
  return mulberry32(hashStringToSeed(seedStr))
}

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC
}

export function dailySeed(gameId: string): string {
  return `daily:${gameId}:${todayDateString()}`
}

export function randomSeedString(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
