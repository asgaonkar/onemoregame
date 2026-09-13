import { useEffect, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'count'
const ROUNDS = 5

// Dot positions are generated in percentage-space (0-100) up front, so the
// board never needs to be measured to lay a round out — only the flash
// duration and count depend on the round index. Real pixels only matter for
// rendering, which the browser handles via percentage CSS.
type Point = { x: number; y: number }

type Round = {
  count: number
  dots: Point[]
  guess: number | null
  score: number
}

const ROUND_CONFIG: { min: number; max: number; duration: number }[] = [
  { min: 8, max: 12, duration: 1200 },
  { min: 12, max: 17, duration: 1000 },
  { min: 17, max: 23, duration: 850 },
  { min: 21, max: 28, duration: 650 },
  { min: 25, max: 35, duration: 500 },
]

function randomCount(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

// Rejection-sample dot positions so denser rounds still read as distinct
// dots rather than an overlapping blob; falls back to an unchecked
// placement if a spot can't be found within a reasonable number of tries.
function generateDots(count: number): Point[] {
  const dots: Point[] = []
  const minDist = Math.max(5, 26 - count * 0.55)
  const maxAttempts = 200

  for (let i = 0; i < count; i++) {
    let placed = false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = 8 + Math.random() * 84
      const y = 8 + Math.random() * 84
      if (dots.every((d) => Math.hypot(d.x - x, d.y - y) >= minDist)) {
        dots.push({ x, y })
        placed = true
        break
      }
    }
    if (!placed) {
      dots.push({ x: 8 + Math.random() * 84, y: 8 + Math.random() * 84 })
    }
  }
  return dots
}

function emptyRound(roundIndex: number): Round {
  const config = ROUND_CONFIG[roundIndex] ?? ROUND_CONFIG[ROUND_CONFIG.length - 1]
  const count = randomCount(config.min, config.max)
  return { count, dots: generateDots(count), guess: null, score: 0 }
}

export function CountGame() {
  const [phase, setPhase] = useState<
    'intro' | 'showing' | 'guessing' | 'roundResult' | 'done'
  >('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [guessDraft, setGuessDraft] = useState(10)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  // Flash the dots, then blank the board after this round's duration.
  useEffect(() => {
    if (phase !== 'showing') return
    const config = ROUND_CONFIG[currentIndex] ?? ROUND_CONFIG[ROUND_CONFIG.length - 1]
    const timer = window.setTimeout(() => setPhase('guessing'), config.duration)
    return () => window.clearTimeout(timer)
  }, [phase, currentIndex])

  function startGame() {
    setGuessDraft(10)
    setRounds([emptyRound(0)])
    setPhase('showing')
  }

  function submitGuess() {
    if (!current || phase !== 'guessing') return
    const guess = Math.max(0, Math.round(guessDraft))
    const diff = Math.abs(guess - current.count)
    const score = Math.max(0, Math.min(100, 100 * (1 - diff / current.count)))
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guess, score } : r)),
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
    setGuessDraft(10)
    setRounds((rs) => [...rs, emptyRound(rs.length)])
    setPhase('showing')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Perception" title="Count">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Dots flash on screen for a moment. Count them before they vanish.{' '}
            {ROUNDS} rounds, each faster and busier than the last.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'showing' || phase === 'guessing' || phase === 'roundResult') &&
        current && (
          <div>
            <RoundProgress index={currentIndex} total={ROUNDS} />

            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
              }}
            >
              {(phase === 'showing' || phase === 'roundResult') &&
                current.dots.map((d, i) => (
                  <Dot key={i} xPct={d.x} yPct={d.y} />
                ))}

              {phase === 'guessing' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-faint)',
                    fontSize: 14,
                  }}
                >
                  How many were there?
                </div>
              )}

              {phase === 'roundResult' && (
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    color: 'var(--text-faint)',
                    textTransform: 'uppercase',
                  }}
                >
                  {current.count} actual
                </div>
              )}
            </div>

            {phase === 'showing' && (
              <div
                style={{
                  textAlign: 'center',
                  marginTop: 16,
                  color: 'var(--text-faint)',
                  fontSize: 13,
                }}
              >
                Watch closely…
              </div>
            )}

            {phase === 'guessing' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Stepper value={guessDraft} onChange={setGuessDraft} />
                <div style={{ marginTop: 20 }}>
                  <PlayButton onClick={submitGuess} label="Lock in guess" />
                </div>
              </div>
            )}

            {phase === 'roundResult' && current.guess !== null && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  You guessed {current.guess} · actual was {current.count}
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                  {current.score.toFixed(1)}
                  <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>
                    /100
                  </span>
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
                <span>
                  {r.guess ?? '–'} guessed · {r.count} actual
                </span>
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

function Dot({ xPct, yPct }: { xPct: number; yPct: number }) {
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
        background: 'var(--accent)',
      }}
    />
  )
}

function Stepper({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <StepButton label="−" onClick={() => onChange(Math.max(0, value - 1))} />
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) ? 0 : Math.max(0, n))
        }}
        style={{
          width: 90,
          textAlign: 'center',
          fontSize: 28,
          fontWeight: 700,
          padding: '10px 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text)',
        }}
      />
      <StepButton label="+" onClick={() => onChange(value + 1)} />
    </div>
  )
}

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text)',
        fontSize: 20,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
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
