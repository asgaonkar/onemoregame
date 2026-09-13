import { readJSON, writeJSON } from './storage'

export type RunRecord = {
  score: number
  date: string
}

const MAX_RECORDS = 10

export function getRuns(gameId: string): RunRecord[] {
  return readJSON<RunRecord[]>(`runs:${gameId}`, [])
}

export function addRun(gameId: string, score: number): RunRecord[] {
  const runs = getRuns(gameId)
  runs.push({ score, date: new Date().toISOString() })
  runs.sort((a, b) => b.score - a.score)
  const trimmed = runs.slice(0, MAX_RECORDS)
  writeJSON(`runs:${gameId}`, trimmed)
  return trimmed
}
