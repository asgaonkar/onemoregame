import { readJSON, writeJSON } from './storage'
import type { GameMode } from './modes'

export type RunRecord = {
  score: number
  date: string
}

const MAX_RECORDS = 10

// Leaderboards are scoped per (game, mode) — a Practice run shouldn't sit
// next to a Daily best, and Endless scores ("rounds survived") aren't on
// the same scale as a 0-100 accuracy score anyway.
function key(gameId: string, mode: GameMode): string {
  return `runs:${gameId}:${mode}`
}

export function getRuns(gameId: string, mode: GameMode): RunRecord[] {
  return readJSON<RunRecord[]>(key(gameId, mode), [])
}

// Most games are "higher is better" (a 0-100 accuracy score, or rounds
// survived in Endless). A few — anything scored directly in milliseconds,
// like Wait/Reflex — are "lower is better". Pass `ascending: true` for those;
// it only changes sort direction, the storage/trim logic is identical.
export function addRun(
  gameId: string,
  mode: GameMode,
  score: number,
  options?: { ascending?: boolean },
): RunRecord[] {
  const ascending = options?.ascending ?? false
  const runs = getRuns(gameId, mode)
  runs.push({ score, date: new Date().toISOString() })
  runs.sort((a, b) => (ascending ? a.score - b.score : b.score - a.score))
  const trimmed = runs.slice(0, MAX_RECORDS)
  writeJSON(key(gameId, mode), trimmed)
  return trimmed
}
