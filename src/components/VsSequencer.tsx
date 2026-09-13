import { useState, type ReactNode } from 'react'
import type { RunConfig } from '../lib/modes'

// Generic local pass-and-play orchestrator: same seed for every player (so
// the challenge is identical/fair), one player at a time with a handoff
// screen in between, then a ranked results screen. Any game can plug in by
// passing a `renderRun` that plays one seeded session and calls back with
// that player's final score.
export function VsSequencer({
  playerCount,
  seed,
  renderRun,
  onExit,
}: {
  playerCount: number
  seed: string
  renderRun: (config: RunConfig, onFinish: (score: number) => void) => ReactNode
  onExit: () => void
}) {
  const [playerIndex, setPlayerIndex] = useState(0)
  const [scores, setScores] = useState<number[]>([])
  const [waiting, setWaiting] = useState(true)

  if (playerIndex >= playerCount) {
    return <VsResults scores={scores} onExit={onExit} />
  }

  if (waiting) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Pass the device
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
          Player {playerIndex + 1}'s turn
        </div>
        <button
          onClick={() => setWaiting(false)}
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
          Ready
        </button>
      </div>
    )
  }

  return (
    <>
      {renderRun({ mode: 'vs', seed, vs: { playerIndex, playerCount } }, (score) => {
        setScores((s) => [...s, score])
        setPlayerIndex((i) => i + 1)
        setWaiting(true)
      })}
    </>
  )
}

function VsResults({ scores, onExit }: { scores: number[]; onExit: () => void }) {
  const ranked = scores
    .map((score, i) => ({ player: i + 1, score }))
    .sort((a, b) => b.score - a.score)

  return (
    <div>
      <div
        style={{
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
          marginBottom: 16,
        }}
      >
        Results
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {ranked.map((r, i) => (
          <div
            key={r.player}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 18px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--border)'}`,
              background: 'var(--bg-card)',
            }}
          >
            <span style={{ fontWeight: i === 0 ? 700 : 500 }}>
              <span style={{ color: 'var(--text-faint)', marginRight: 8 }}>#{i + 1}</span>
              Player {r.player}
            </span>
            <span style={{ fontWeight: 600 }}>{r.score.toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={onExit}
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
          Done
        </button>
      </div>
    </div>
  )
}
