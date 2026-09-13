import { useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'center'
const ROUNDS = 5

// Box position/size are percentages of the stage (0-100), so no DOM
// measurement is needed to generate a round — only the click handler
// needs the stage's real pixel rect, and the stage always exists by then.
type Box = { x: number; y: number; w: number; h: number }

type Round = {
  box: Box
  guess: { xPct: number; yPct: number } | null
  distance: number
  score: number
}

function randomBox(): Box {
  const w = 35 + Math.random() * 30
  const h = 30 + Math.random() * 30
  const x = (100 - w) * (0.1 + Math.random() * 0.8)
  const y = (100 - h) * (0.1 + Math.random() * 0.8)
  return { x, y, w, h }
}

function emptyRound(): Round {
  return { box: randomBox(), guess: null, distance: 0, score: 0 }
}

function scoreFor(
  box: Box,
  guess: { xPct: number; yPct: number },
  rectW: number,
  rectH: number,
) {
  const cxPx = ((box.x + box.w / 2) / 100) * rectW
  const cyPx = ((box.y + box.h / 2) / 100) * rectH
  const gxPx = (guess.xPct / 100) * rectW
  const gyPx = (guess.yPct / 100) * rectH
  const distance = Math.hypot(gxPx - cxPx, gyPx - cyPx)
  const maxDist = Math.hypot((box.w / 100) * rectW, (box.h / 100) * rectH) / 2
  const score = Math.max(0, 100 * (1 - distance / maxDist))
  return { distance, score }
}

export function CenterGame() {
  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [runs, setRuns] = useState(() => getRuns(GAME_ID))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function startGame() {
    setRounds([emptyRound()])
    setPhase('playing')
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing' || !current || current.guess) return
    const rect = e.currentTarget.getBoundingClientRect()
    const guess = {
      xPct: ((e.clientX - rect.left) / rect.width) * 100,
      yPct: ((e.clientY - rect.top) / rect.height) * 100,
    }
    const { distance, score } = scoreFor(current.box, guess, rect.width, rect.height)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guess, distance, score } : r)),
    )
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
    setRounds((rs) => [...rs, emptyRound()])
    setPhase('playing')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Precision" title="Center">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            A box appears. Click its exact center. {ROUNDS} rounds, scored by
            how close you land.
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
              cursor: phase === 'playing' ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: `${current.box.x}%`,
                top: `${current.box.y}%`,
                width: `${current.box.w}%`,
                height: `${current.box.h}%`,
                border: '2px solid var(--accent)',
                borderRadius: 8,
                opacity: 0.85,
              }}
            />
            {current.guess && (
              <>
                <Dot
                  xPct={current.box.x + current.box.w / 2}
                  yPct={current.box.y + current.box.h / 2}
                  color="var(--accent)"
                />
                <Dot
                  xPct={current.guess.xPct}
                  yPct={current.guess.yPct}
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
