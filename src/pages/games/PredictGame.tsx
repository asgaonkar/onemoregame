import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'predict'
const ROUNDS = 5
// Fixed prediction horizon: how far past the visible window the dot
// keeps travelling (invisibly) before the target moment we score against.
const HORIZON_SECONDS = 1.1

// All positions/velocities live in percentage-space (0-100), so a round
// can be generated before the board exists (e.g. on the intro screen)
// without measuring any DOM node. Only the click handler needs the
// board's real pixel rect, and the board always exists by then.
type Point = { x: number; y: number }
type Velocity = { vx: number; vy: number }

type Round = {
  start: Point
  velocity: Velocity
  visibleDuration: number
  lastVisible: Point
  truePoint: Point
  guess: Point | null
  distance: number
  score: number
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function randomPoint(margin: number): Point {
  return {
    x: margin + Math.random() * (100 - margin * 2),
    y: margin + Math.random() * (100 - margin * 2),
  }
}

// A straight line between two points inside a convex region (our square
// board) never leaves that region, so picking both the start and the
// eventual true point at random inside a margin guarantees the whole
// trajectory — visible and hidden portions alike — stays on-board.
// Distance between them (and therefore speed, since duration is fixed
// per round) grows with round index for a light difficulty ramp.
function makeRound(roundIndex: number): Round {
  const margin = 12
  const visibleDuration = 1.5 + Math.random() * 0.5
  const totalTime = visibleDuration + HORIZON_SECONDS

  const start = randomPoint(margin)
  const minDist = 35 + roundIndex * 6
  let truePoint = randomPoint(margin)
  let attempts = 0
  while (dist(start, truePoint) < minDist && attempts < 20) {
    truePoint = randomPoint(margin)
    attempts++
  }

  const velocity: Velocity = {
    vx: (truePoint.x - start.x) / totalTime,
    vy: (truePoint.y - start.y) / totalTime,
  }
  const lastVisible: Point = {
    x: start.x + velocity.vx * visibleDuration,
    y: start.y + velocity.vy * visibleDuration,
  }

  return {
    start,
    velocity,
    visibleDuration,
    lastVisible,
    truePoint,
    guess: null,
    distance: 0,
    score: 0,
  }
}

export function PredictGame() {
  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [runs, setRuns] = useState(() => getRuns(GAME_ID))
  const [pos, setPos] = useState<Point>({ x: 50, y: 50 })
  const [dotVisible, setDotVisible] = useState(false)
  const [canGuess, setCanGuess] = useState(false)
  const rafRef = useRef<number | null>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  // Drives the visible portion of the dot's motion. Runs only while
  // playing a round; cancels cleanly on round change/unmount.
  useEffect(() => {
    if (phase !== 'playing' || !current) return

    setPos(current.start)
    setDotVisible(true)
    setCanGuess(false)

    const startTime = performance.now()

    function frame(now: number) {
      const elapsed = (now - startTime) / 1000
      if (elapsed >= current.visibleDuration) {
        setPos(current.lastVisible)
        setDotVisible(false)
        setCanGuess(true)
        rafRef.current = null
        return
      }
      setPos({
        x: current.start.x + current.velocity.vx * elapsed,
        y: current.start.y + current.velocity.vy * elapsed,
      })
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // current is derived from rounds/currentIndex; re-running on either
    // covers every new round while keeping the same round's identity stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex])

  function startGame() {
    setRounds([makeRound(0)])
    setPhase('playing')
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing' || !canGuess || !current || current.guess) return
    const rect = e.currentTarget.getBoundingClientRect()
    const guess: Point = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
    const distPx = Math.hypot(
      ((guess.x - current.truePoint.x) / 100) * rect.width,
      ((guess.y - current.truePoint.y) / 100) * rect.height,
    )
    const maxDist = Math.hypot(rect.width, rect.height) * 0.3
    const score = Math.max(0, 100 * (1 - distPx / maxDist))

    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, guess, distance: distPx, score } : r,
      ),
    )
    setCanGuess(false)
    setPhase('roundResult')
  }

  function nextRound() {
    if (rounds.length >= ROUNDS) {
      const total = rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length
      const updated = addRun(GAME_ID, total)
      setRuns(updated)
      setPhase('done')
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length)])
    setPhase('playing')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Timing" title="Predict">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Watch the dot move, then click where it would be a moment after it
            vanishes. {ROUNDS} rounds, scored by how close you land.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          <RoundProgress index={currentIndex} total={ROUNDS} />
          <div
            onClick={handleStageClick}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: canGuess ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {phase === 'playing' && dotVisible && (
              <Dot xPct={pos.x} yPct={pos.y} color="var(--accent)" />
            )}

            {phase === 'roundResult' && current.guess && (
              <>
                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                  }}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <line
                    x1={current.lastVisible.x}
                    y1={current.lastVisible.y}
                    x2={current.truePoint.x}
                    y2={current.truePoint.y}
                    stroke="var(--text-faint)"
                    strokeWidth={0.5}
                    strokeDasharray="2,2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={current.guess.x}
                    y1={current.guess.y}
                    x2={current.truePoint.x}
                    y2={current.truePoint.y}
                    stroke={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                    strokeWidth={0.6}
                    strokeDasharray="3,3"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <Dot
                  xPct={current.truePoint.x}
                  yPct={current.truePoint.y}
                  color="var(--accent)"
                />
                <Dot
                  xPct={current.guess.x}
                  yPct={current.guess.y}
                  color={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                />
              </>
            )}
          </div>

          {phase === 'roundResult' && current.guess && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.distance.toFixed(0)}px off
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
                <span>{r.distance.toFixed(0)}px off</span>
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

function Dot({
  xPct,
  yPct,
  color,
}: {
  xPct: number
  yPct: number
  color: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: 12,
        height: 12,
        marginLeft: -6,
        marginTop: -6,
        borderRadius: '50%',
        background: color,
        boxShadow: '0 0 0 3px var(--bg-card)',
      }}
    />
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
