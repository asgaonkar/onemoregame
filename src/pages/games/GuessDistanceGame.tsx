import { useEffect, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'guess-distance'
const ROUNDS = 5
const FLASH_MS = 1500

// Points live in percentage-space (0-100), same trick as CenterGame: nothing
// that needs the board's real pixel size exists on the intro screen, so we
// generate layouts as percentages and only convert to px inside the click
// handler, where the board already exists and getBoundingClientRect works.
type Point = { x: number; y: number }

type Round = {
  anchor: Point
  target: Point
  guess: Point | null
  actualDistance: number
  guessedDistance: number
  score: number
}

function randomPoint(): Point {
  return { x: 8 + Math.random() * 84, y: 8 + Math.random() * 84 }
}

function pctDist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function randomPair(): [Point, Point] {
  const a = randomPoint()
  let b = randomPoint()
  let attempts = 0
  while (pctDist(a, b) < 30 && attempts < 20) {
    b = randomPoint()
    attempts++
  }
  return [a, b]
}

function emptyRound(): Round {
  const [anchor, target] = randomPair()
  return { anchor, target, guess: null, actualDistance: 0, guessedDistance: 0, score: 0 }
}

function toPx(p: Point, rectW: number, rectH: number) {
  return { x: (p.x / 100) * rectW, y: (p.y / 100) * rectH }
}

function scoreFor(round: Round, guess: Point, rectW: number, rectH: number) {
  const diagonal = Math.hypot(rectW, rectH)
  const anchorPx = toPx(round.anchor, rectW, rectH)
  const targetPx = toPx(round.target, rectW, rectH)
  const guessPx = toPx(guess, rectW, rectH)
  const actualDistance = Math.hypot(targetPx.x - anchorPx.x, targetPx.y - anchorPx.y)
  const guessedDistance = Math.hypot(guessPx.x - anchorPx.x, guessPx.y - anchorPx.y)
  const diff = Math.abs(guessedDistance - actualDistance)
  const score = Math.max(0, 100 * (1 - diff / diagonal))
  return { actualDistance, guessedDistance, score }
}

type Phase = 'intro' | 'showing' | 'guessing' | 'roundResult' | 'done'

export function GuessDistanceGame() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  useEffect(() => {
    if (phase !== 'showing') return
    const timer = setTimeout(() => setPhase('guessing'), FLASH_MS)
    return () => clearTimeout(timer)
  }, [phase, currentIndex])

  function startGame() {
    setRounds([emptyRound()])
    setPhase('showing')
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'guessing' || !current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const guess: Point = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
    const { actualDistance, guessedDistance, score } = scoreFor(
      current,
      guess,
      rect.width,
      rect.height,
    )
    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, guess, actualDistance, guessedDistance, score } : r,
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
    setPhase('showing')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Memory" title="Guess Distance">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 440, margin: '0 auto 28px' }}>
            Two dots flash briefly. One reappears as an anchor — click where
            the other one was, relative to it. {ROUNDS} rounds, scored by how
            close your guessed distance is to the real one.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'showing' || phase === 'guessing' || phase === 'roundResult') &&
        current && (
          <div>
            <RoundProgress index={currentIndex} total={ROUNDS} />
            <p
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-faint)',
                minHeight: 18,
                margin: '0 0 10px',
              }}
            >
              {phase === 'showing' && 'Memorize the gap…'}
              {phase === 'guessing' && 'Click where the second dot was'}
              {phase === 'roundResult' && ' '}
            </p>
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
                cursor: phase === 'guessing' ? 'crosshair' : 'default',
                touchAction: 'manipulation',
              }}
            >
              {phase === 'showing' && (
                <>
                  <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
                  <Dot xPct={current.target.x} yPct={current.target.y} color="var(--accent)" />
                </>
              )}

              {phase === 'guessing' && (
                <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
              )}

              {phase === 'roundResult' && current.guess && (
                <>
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  >
                    <line
                      x1={current.anchor.x}
                      y1={current.anchor.y}
                      x2={current.target.x}
                      y2={current.target.y}
                      stroke="var(--accent)"
                      strokeWidth={0.4}
                      strokeDasharray="2,2"
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={current.anchor.x}
                      y1={current.anchor.y}
                      x2={current.guess.x}
                      y2={current.guess.y}
                      stroke={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                      strokeWidth={0.4}
                      strokeDasharray="2,2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
                  <Dot xPct={current.target.x} yPct={current.target.y} color="var(--accent)" />
                  <Dot
                    xPct={current.guess.x}
                    yPct={current.guess.y}
                    color={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                  />
                </>
              )}
            </div>

            {phase === 'roundResult' && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 20,
                    fontSize: 13,
                    color: 'var(--text-dim)',
                    marginBottom: 8,
                  }}
                >
                  <span>Actual: {current.actualDistance.toFixed(0)}px</span>
                  <span>Guessed: {current.guessedDistance.toFixed(0)}px</span>
                </div>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  {Math.abs(current.guessedDistance - current.actualDistance).toFixed(0)}px off
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
                <span>{Math.abs(r.guessedDistance - r.actualDistance).toFixed(0)}px off</span>
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
