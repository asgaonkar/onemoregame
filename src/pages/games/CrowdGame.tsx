import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'crowd'
const ROUNDS = 5
const BASE_DOTS = 8
const DOTS_INCREMENT = 2
const MAX_DOTS = 16
const HIGHLIGHT_MS = 1000
const MOVE_MS = 3500
const DOT_R = 4 // dot "radius" in board percentage-space, keeps dots off the edges
const MIN_SEPARATION_PCT = 12
// The board keeps a 4/3 aspect ratio, so a dot moving at the same %/s in x
// and y would visually appear slower vertically (less real height than
// width). Scale the y velocity component to compensate.
const ASPECT_Y_COMPENSATION = 4 / 3

// Dot position/velocity live in percentage-space (0-100), matching the
// Center pattern: nothing needs the board's real pixel size until a click
// happens, at which point the board already exists and we can read its rect.
type DotState = { id: number; x: number; y: number; vx: number; vy: number }

type Round = {
  count: number
  targetId: number
  guessId: number | null
  correct: boolean
  score: number
}

type Stage = 'highlight' | 'moving' | 'guessing'

function randomDots(count: number): DotState[] {
  const dots: DotState[] = []
  for (let id = 0; id < count; id++) {
    let x = 0
    let y = 0
    let attempts = 0
    do {
      x = DOT_R + Math.random() * (100 - 2 * DOT_R)
      y = DOT_R + Math.random() * (100 - 2 * DOT_R)
      attempts++
    } while (
      attempts < 40 &&
      dots.some((d) => Math.hypot(d.x - x, d.y - y) < MIN_SEPARATION_PCT)
    )

    const angle = Math.random() * Math.PI * 2
    const speed = 10 + Math.random() * 8 // %/s
    dots.push({
      id,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * ASPECT_Y_COMPENSATION,
    })
  }
  return dots
}

function stepDots(dots: DotState[], dt: number) {
  for (const d of dots) {
    d.x += d.vx * dt
    d.y += d.vy * dt

    if (d.x < DOT_R) {
      d.x = DOT_R + (DOT_R - d.x)
      d.vx = -d.vx
    } else if (d.x > 100 - DOT_R) {
      d.x = 100 - DOT_R - (d.x - (100 - DOT_R))
      d.vx = -d.vx
    }
    if (d.y < DOT_R) {
      d.y = DOT_R + (DOT_R - d.y)
      d.vy = -d.vy
    } else if (d.y > 100 - DOT_R) {
      d.y = 100 - DOT_R - (d.y - (100 - DOT_R))
      d.vy = -d.vy
    }

    // Safety clamp in case of an unusually large dt spike.
    d.x = Math.min(100 - DOT_R, Math.max(DOT_R, d.x))
    d.y = Math.min(100 - DOT_R, Math.max(DOT_R, d.y))
  }
}

export function CrowdGame() {
  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [stage, setStage] = useState<Stage>('highlight')
  const [rounds, setRounds] = useState<Round[]>([])
  const [dots, setDots] = useState<DotState[]>([])
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))

  const dotsRef = useRef<DotState[]>([])
  const rafRef = useRef<number | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function clearTimers() {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
      highlightTimeoutRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  useEffect(() => clearTimers, [])

  function startMoving() {
    const start = performance.now()
    let last = start

    function frame(now: number) {
      const dt = (now - last) / 1000
      last = now
      stepDots(dotsRef.current, dt)
      setDots(dotsRef.current.map((d) => ({ ...d })))

      if (now - start < MOVE_MS) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        rafRef.current = null
        setStage('guessing')
      }
    }

    rafRef.current = requestAnimationFrame(frame)
  }

  function startRound(index: number) {
    clearTimers()
    const count = Math.min(MAX_DOTS, BASE_DOTS + index * DOTS_INCREMENT)
    const newDots = randomDots(count)
    const targetId = newDots[Math.floor(Math.random() * newDots.length)].id

    dotsRef.current = newDots
    setDots(newDots)
    setRounds((rs) => [...rs, { count, targetId, guessId: null, correct: false, score: 0 }])
    setStage('highlight')
    setPhase('playing')

    highlightTimeoutRef.current = setTimeout(() => {
      setStage('moving')
      startMoving()
    }, HIGHLIGHT_MS)
  }

  function startGame() {
    setRounds([])
    startRound(0)
  }

  function handleBoardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing' || stage !== 'guessing' || !current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100

    let nearestId: number | null = null
    let nearestDistPx = Infinity
    for (const d of dotsRef.current) {
      const dxPx = ((d.x - xPct) / 100) * rect.width
      const dyPx = ((d.y - yPct) / 100) * rect.height
      const distPx = Math.hypot(dxPx, dyPx)
      if (distPx < nearestDistPx) {
        nearestDistPx = distPx
        nearestId = d.id
      }
    }

    const hitRadiusPx = Math.max(28, rect.width * (DOT_R / 100) * 2.2)
    const guessId = nearestDistPx <= hitRadiusPx ? nearestId : null
    const correct = guessId !== null && guessId === current.targetId
    const score = correct ? 100 : 0

    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guessId, correct, score } : r)),
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
    startRound(rounds.length)
  }

  function playAgain() {
    clearTimers()
    setRounds([])
    setDots([])
    setStage('highlight')
    setPhase('intro')
  }

  const statusLabel =
    phase === 'playing'
      ? stage === 'highlight'
        ? 'Watch the highlighted dot'
        : stage === 'moving'
          ? 'Tracking…'
          : 'Click the dot you were tracking'
      : null

  return (
    <GameShell eyebrow="Perception" title="Crowd">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            One dot flashes, then the crowd scatters. Track it and click it once
            they stop. {ROUNDS} rounds, the crowd grows each time.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          <RoundProgress index={currentIndex} total={ROUNDS} />
          {statusLabel && (
            <div
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-dim)',
                marginBottom: 10,
                minHeight: 16,
              }}
            >
              {statusLabel}
            </div>
          )}
          <div
            onClick={handleBoardClick}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor:
                phase === 'playing' && stage === 'guessing' ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {dots.map((d) => {
              let color = 'var(--text-dim)'
              let ring = false

              if (phase === 'playing' && stage === 'highlight' && d.id === current.targetId) {
                color = 'var(--accent)'
                ring = true
              } else if (phase === 'roundResult') {
                if (d.id === current.targetId) {
                  color = 'var(--success)'
                  ring = true
                } else if (d.id === current.guessId) {
                  color = 'var(--danger)'
                } else {
                  color = 'var(--text-faint)'
                }
              }

              return <Dot key={d.id} xPct={d.x} yPct={d.y} color={color} ring={ring} />
            })}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.correct
                  ? 'Correct!'
                  : current.guessId === null
                    ? "You didn't select a dot"
                    : 'Not quite'}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                {current.score.toFixed(0)}
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
                <span>{r.count} dots</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {r.correct ? 'Hit' : 'Miss'} · {r.score.toFixed(0)}
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
  ring,
}: {
  xPct: number
  yPct: number
  color: string
  ring?: boolean
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: 14,
        height: 14,
        marginLeft: -7,
        marginTop: -7,
        borderRadius: '50%',
        background: color,
        boxShadow: ring
          ? `0 0 0 3px var(--bg-card), 0 0 0 6px ${color}`
          : '0 0 0 3px var(--bg-card)',
        transition: 'background 0.15s ease, box-shadow 0.15s ease',
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
