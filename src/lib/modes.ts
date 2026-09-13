import { createRng, dailySeed, randomSeedString, type Rng } from './rng'
import { readJSON, writeJSON } from './storage'
import { todayDateString } from './rng'

export type GameMode = 'daily' | 'endless' | 'practice' | 'vs'

export const FIXED_ROUNDS = 5
export const ENDLESS_LIVES = 3
export const MISS_THRESHOLD = 40 // round score below this counts as a "miss"

export type VsInfo = {
  playerIndex: number // 0-based
  playerCount: number
}

export type RunConfig = {
  mode: GameMode
  seed: string
  vs?: VsInfo
}

// 0 (easiest) -> 1 (hardest) for a given round number (1-based).
// Games scale their own parameters (size, count, duration, tolerance...)
// using this value so difficulty progression feels consistent site-wide.
export function difficultyForRound(round: number, mode: GameMode): number {
  if (mode === 'practice') return 0.08
  if (mode === 'endless') return Math.min(1, (round - 1) / 11)
  // daily / vs: fixed-length ramp across FIXED_ROUNDS
  return (round - 1) / (FIXED_ROUNDS - 1)
}

export function isMiss(score: number): boolean {
  return score < MISS_THRESHOLD
}

export function createRunConfig(mode: GameMode, gameId: string, vs?: VsInfo): RunConfig {
  const seed = mode === 'daily' ? dailySeed(gameId) : randomSeedString()
  return { mode, seed, vs }
}

export function rngFor(config: RunConfig): Rng {
  return createRng(config.seed)
}

// ---- Daily "already played today" tracking (per game, per device) ----

type DailyRecord = { date: string; score: number }

export function getDailyStatus(gameId: string): DailyRecord | null {
  const rec = readJSON<DailyRecord | null>(`daily:${gameId}`, null)
  if (!rec || rec.date !== todayDateString()) return null
  return rec
}

export function markDailyPlayed(gameId: string, score: number): void {
  writeJSON(`daily:${gameId}`, { date: todayDateString(), score })
}
