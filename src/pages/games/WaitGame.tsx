import { useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'wait'
const ROUNDS = 5

// Target durations (ms), one per round — a bit of progression, not a strict
// difficulty curve.
const TARGETS_MS = [3000, 5000, 4200, 6500, 2800]

type Round = {
  targetMs: number
  elapsedMs: number
  diffMs: number
  score: number
}

function emptyRound(targetMs: number): Round {
  return { targetMs, elapsedMs: 0, diffMs: 0, score: 0 }
}

function scoreFor(diffMs: number) {
  return Math.max(0, Math.min(100, 100 * (1 - diffMs / 500)))
}

function formatSeconds(ms: number) {
  return (ms / 1000).toFixed(3) + 's'
}

export function WaitGame() {
  const [phase, setPhase] = useState<
    'intro' | 'ready' | 'running' | 'roundResult' | 'done'
  >('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))
  const startRef = useRef<number>(0)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function startGame() {
    setRounds([emptyRound(TARGETS_MS[0])])
    setPhase('ready')
  }

  function startTimer() {
    startRef.current = performance.now()
    setPhase('running')
  }

  function stopTimer() {
    if (phase !== 'running' || !current) return
    const elapsedMs = performance.now() - startRef.current
    const diffMs = Math.abs(elapsedMs - current.targetMs)
    const score = scoreFor(diffMs)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, elapsedMs, diffMs, score } : r)),
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
    setRounds((rs) => [...rs, emptyRound(TARGETS_MS[rs.length])])
    setPhase('ready')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Timing" title="Wait">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Stop the timer on the exact target. {ROUNDS} rounds, scored by how
            close you land.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'ready' || phase === 'running' || phase === 'roundResult') &&
        current && (
          <div>
            <RoundProgress index={currentIndex} total={ROUNDS} />

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>TARGET</div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0 24px' }}>
                {formatSeconds(current.targetMs)}
              </div>
            </div>

            <div
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {phase === 'ready' && <Ring pulsing={false} />}
              {phase === 'running' && <Ring pulsing={true} />}
              {phase === 'roundResult' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
                    YOUR TIME
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 8px' }}>
                    {formatSeconds(current.elapsedMs)}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                    {current.diffMs.toFixed(0)}ms off
                  </div>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', marginTop: 24 }}>
              {phase === 'ready' && <PlayButton onClick={startTimer} label="Go" />}
              {phase === 'running' && (
                <PlayButton onClick={stopTimer} label="Stop" />
              )}
              {phase === 'roundResult' && (
                <>
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
                </>
              )}
            </div>
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
                <span>{formatSeconds(r.targetMs)} target</span>
                <span>{r.diffMs.toFixed(0)}ms off</span>
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

function Ring({ pulsing }: { pulsing: boolean }) {
  return (
    <div
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: 'var(--accent)',
        opacity: pulsing ? undefined : 0.35,
        animation: pulsing ? 'wait-pulse 1.1s ease-in-out infinite' : 'none',
      }}
    >
      <style>{`
        @keyframes wait-pulse {
          0%, 100% { transform: scale(0.85); opacity: 0.35; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }
      `}</style>
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
