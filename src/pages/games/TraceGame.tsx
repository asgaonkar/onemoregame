import { useEffect, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'trace'
const ROUNDS = 5
const SHOW_DURATION_MS = 2500
const RESAMPLE_COUNT = 40
// Calibrated in percentage-space (board is 0-100 on each axis): a careful
// retrace lands well under this, a careless scribble lands at or above it.
const MAX_REASONABLE_DIST = 50

// Waypoints/points live in percentage space (0-100), just like CenterGame's
// boxes — no DOM measurement is needed to generate a round. The board only
// gets measured (getBoundingClientRect) inside pointer handlers, where it
// already exists on screen.
type Point = { x: number; y: number }

type Round = {
  path: Point[]
  drawn: Point[]
  avgDist: number
  score: number
}

function randomPath(): Point[] {
  const count = 4 + Math.floor(Math.random() * 3) // 4-6 waypoints
  const margin = 12
  const points: Point[] = []
  for (let i = 0; i < count; i++) {
    points.push({
      x: margin + Math.random() * (100 - margin * 2),
      y: margin + Math.random() * (100 - margin * 2),
    })
  }
  return points
}

function emptyRound(): Round {
  return { path: randomPath(), drawn: [], avgDist: 0, score: 0 }
}

function pathLength(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

// Walks the polyline at evenly-spaced arc-length intervals so two paths with
// different point densities (a 5-waypoint original vs. a dense drawn stroke)
// can be compared point-for-point.
function resample(points: Point[], count: number): Point[] {
  if (points.length === 0) return []
  if (points.length === 1) return Array.from({ length: count }, () => points[0])
  const total = pathLength(points)
  if (total === 0) return Array.from({ length: count }, () => points[0])

  const step = total / (count - 1)
  const result: Point[] = []
  let segIndex = 0
  let segStart = points[0]
  let segEnd = points[1]
  let segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y)
  let accumulated = 0

  for (let i = 0; i < count; i++) {
    const targetDist = step * i
    while (accumulated + segLen < targetDist && segIndex < points.length - 2) {
      accumulated += segLen
      segIndex++
      segStart = points[segIndex]
      segEnd = points[segIndex + 1]
      segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y)
    }
    const distIntoSeg = targetDist - accumulated
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, distIntoSeg / segLen))
    result.push({
      x: segStart.x + (segEnd.x - segStart.x) * t,
      y: segStart.y + (segEnd.y - segStart.y) * t,
    })
  }
  return result
}

function scorePaths(original: Point[], drawn: Point[]): { avgDist: number; score: number } {
  if (drawn.length < 2) return { avgDist: MAX_REASONABLE_DIST, score: 0 }
  const a = resample(original, RESAMPLE_COUNT)
  const b = resample(drawn, RESAMPLE_COUNT)
  let sum = 0
  for (let i = 0; i < RESAMPLE_COUNT; i++) {
    sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
  }
  const avgDist = sum / RESAMPLE_COUNT
  const score = Math.max(0, Math.min(100, 100 * (1 - avgDist / MAX_REASONABLE_DIST)))
  return { avgDist, score }
}

function toPointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function pointFromEvent(e: React.PointerEvent<HTMLDivElement>): Point {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * 100
  const y = ((e.clientY - rect.top) / rect.height) * 100
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
}

type Phase = 'intro' | 'memorize' | 'draw' | 'roundResult' | 'done'

export function TraceGame() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [drawing, setDrawing] = useState<Point[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  // Show the path for a fixed window, then hide it and let the player draw.
  useEffect(() => {
    if (phase !== 'memorize') return
    const t = setTimeout(() => setPhase('draw'), SHOW_DURATION_MS)
    return () => clearTimeout(t)
  }, [phase])

  function startGame() {
    setRounds([emptyRound()])
    setDrawing([])
    setPhase('memorize')
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'draw') return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrawing([pointFromEvent(e)])
    setIsDrawing(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'draw' || !isDrawing) return
    // Compute the point synchronously — React (in StrictMode) can invoke a
    // functional setState updater more than once, and by a second
    // invocation the SyntheticEvent's currentTarget has been nulled out.
    const pt = pointFromEvent(e)
    setDrawing((pts) => [...pts, pt])
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'draw' || !isDrawing || !current) return
    setIsDrawing(false)
    const finalPoints =
      drawing.length > 0 ? [...drawing, pointFromEvent(e)] : [pointFromEvent(e)]
    const { avgDist, score } = scorePaths(current.path, finalPoints)
    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, drawn: finalPoints, avgDist, score } : r,
      ),
    )
    setPhase('roundResult')
  }

  function nextRound() {
    if (rounds.length >= ROUNDS) {
      const total = rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length
      const updated = addRun(GAME_ID, 'daily', total)
      setRuns(updated)
      setPhase('done')
      return
    }
    setRounds((rs) => [...rs, emptyRound()])
    setDrawing([])
    setPhase('memorize')
  }

  function playAgain() {
    setRounds([])
    setDrawing([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Memory" title="Trace">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Watch the path, then redraw it from memory. {ROUNDS} rounds, scored
            by how closely you retrace it.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'memorize' ||
        phase === 'draw' ||
        phase === 'roundResult') &&
        current && (
          <div>
            <RoundProgress index={currentIndex} total={ROUNDS} />
            <div
              style={{
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.4,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                marginBottom: 10,
                minHeight: 18,
              }}
            >
              {phase === 'memorize' && 'Memorize the path'}
              {phase === 'draw' && 'Draw it from memory'}
              {phase === 'roundResult' &&
                (current.score >= 70 ? 'Nice trace' : 'Here’s how it compared')}
            </div>
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
                cursor: phase === 'draw' ? 'crosshair' : 'default',
                touchAction: 'none',
              }}
            >
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              >
                {(phase === 'memorize' || phase === 'roundResult') && (
                  <polyline
                    points={toPointsAttr(current.path)}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {phase === 'memorize' && (
                  <circle
                    cx={current.path[0].x}
                    cy={current.path[0].y}
                    r={3}
                    fill="var(--accent)"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {(phase === 'draw' || phase === 'roundResult') &&
                  (phase === 'draw' ? drawing : current.drawn).length > 1 && (
                    <polyline
                      points={toPointsAttr(phase === 'draw' ? drawing : current.drawn)}
                      fill="none"
                      stroke={
                        phase === 'roundResult'
                          ? current.score >= 70
                            ? 'var(--success)'
                            : 'var(--danger)'
                          : 'var(--text)'
                      }
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
              </svg>
            </div>

            {phase === 'roundResult' && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  {current.avgDist.toFixed(1)} avg gap
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                  {current.score.toFixed(1)}
                  <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>/100</span>
                </div>
                <PlayButton
                  onClick={nextRound}
                  label={rounds.length >= ROUNDS ? 'See results' : 'Next round'}
                />
              </div>
            )}
          </div>
        )}

      {phase === 'done' && (
        <div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 20,
            }}
          >
            {rounds.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  color: 'var(--text-dim)',
                }}
              >
                <span>Round {i + 1}</span>
                <span>{r.avgDist.toFixed(1)} avg gap</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {r.score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              AVERAGE SCORE
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {(rounds.reduce((s, r) => s + r.score, 0) / rounds.length).toFixed(1)}
            </div>
            <PlayButton onClick={playAgain} label="Play again" />
          </div>
          <LocalLeaderboard runs={runs} />
        </div>
      )}
    </GameShell>
  )
}

function RoundProgress({ index, total }: { index: number; total: number }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        justifyContent: 'center',
        marginBottom: 16,
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 24,
            height: 3,
            borderRadius: 2,
            background: i <= index ? 'var(--accent)' : 'var(--border)',
          }}
        />
      ))}
    </div>
  )
}

function PlayButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--accent)',
        color: 'var(--accent-text)',
        border: 'none',
        borderRadius: 999,
        padding: '14px 32px',
        fontSize: 16,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
