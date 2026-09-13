import { useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'perfect-circle'
const ROUNDS = 5

// The board is a perfect square (aspect-ratio 1 / 1), so a percentage of its
// width and a percentage of its height are the same real-world distance.
// That's what lets us treat these percentage points as a plain 2D coordinate
// system (SVG viewBox "0 0 100 100") without ever measuring pixels.
type Point = { x: number; y: number }

type Round = {
  points: Point[]
  centroid: Point | null
  meanRadius: number
  score: number
}

function emptyRound(): Round {
  return { points: [], centroid: null, meanRadius: 0, score: 0 }
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

// Fits a circle to the stroke (centroid + mean radius) and scores how
// consistent the radius is across all captured points. A perfect circle has
// zero variation; a wobbly stroke has high variation. We use the
// coefficient of variation (stddev / mean) so the score is scale-independent
// — a tiny circle and a huge circle drawn with the same relative wobble
// score the same.
function scoreStroke(points: Point[]): { centroid: Point; meanRadius: number; score: number } {
  const centroid = { x: avg(points.map((p) => p.x)), y: avg(points.map((p) => p.y)) }
  const radii = points.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y))
  const meanRadius = avg(radii)

  if (points.length < 8 || meanRadius < 4) {
    return { centroid, meanRadius, score: 0 }
  }

  const variance = avg(radii.map((r) => (r - meanRadius) ** 2))
  const cv = Math.sqrt(variance) / meanRadius

  // Secondary penalty: how far apart the stroke's start and end points are,
  // relative to the radius — rewards actually closing the loop.
  const first = points[0]
  const last = points[points.length - 1]
  const gapRatio = Math.hypot(last.x - first.x, last.y - first.y) / meanRadius

  const cvPenalty = cv * 320
  const closurePenalty = Math.min(20, gapRatio * 40)
  const score = Math.max(0, Math.min(100, 100 - cvPenalty - closurePenalty))

  return { centroid, meanRadius, score }
}

function pathFrom(points: Point[]): string {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

export function PerfectCircleGame() {
  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [livePoints, setLivePoints] = useState<Point[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))
  const rectRef = useRef<DOMRect | null>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function startGame() {
    setRounds([emptyRound()])
    setLivePoints([])
    setPhase('playing')
  }

  function pctFromEvent(e: React.PointerEvent<HTMLDivElement>): Point | null {
    const rect = rectRef.current
    if (!rect) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'playing' || current?.centroid) return
    rectRef.current = e.currentTarget.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pctFromEvent(e)
    if (!p) return
    setLivePoints([p])
    setIsDrawing(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDrawing) return
    const p = pctFromEvent(e)
    if (!p) return
    setLivePoints((pts) => [...pts, p])
  }

  function handlePointerUp() {
    if (!isDrawing) return
    setIsDrawing(false)
    setLivePoints((pts) => {
      finishStroke(pts)
      return pts
    })
  }

  function finishStroke(points: Point[]) {
    if (points.length < 2) return
    const { centroid, meanRadius, score } = scoreStroke(points)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, points, centroid, meanRadius, score } : r)),
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
    setLivePoints([])
    setPhase('playing')
  }

  function playAgain() {
    setRounds([])
    setLivePoints([])
    setPhase('intro')
  }

  const displayPoints = current?.centroid ? current.points : livePoints
  const strokeColor =
    phase === 'roundResult' && current
      ? current.score >= 70
        ? 'var(--success)'
        : 'var(--danger)'
      : 'var(--text)'

  return (
    <GameShell eyebrow="Precision" title="Perfect Circle">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Draw a circle freehand. {ROUNDS} attempts, scored on how close it
            is to geometrically perfect.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          <RoundProgress index={currentIndex} total={ROUNDS} />
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: phase === 'playing' ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
              style={{ display: 'block' }}
            >
              {phase === 'roundResult' && current.centroid && (
                <circle
                  cx={current.centroid.x}
                  cy={current.centroid.y}
                  r={current.meanRadius}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={0.6}
                  strokeDasharray="3 2.5"
                  opacity={0.85}
                />
              )}
              {displayPoints.length > 1 && (
                <path
                  d={pathFrom(displayPoints)}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {phase === 'roundResult' && current.centroid && (
                <circle
                  cx={current.centroid.x}
                  cy={current.centroid.y}
                  r={0.9}
                  fill="var(--accent)"
                />
              )}
            </svg>
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
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
