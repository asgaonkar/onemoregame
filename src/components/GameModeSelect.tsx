import { useState } from 'react'
import { createRunConfig, getDailyStatus, type GameMode, type RunConfig } from '../lib/modes'
import { trackEvent } from '../lib/analytics'

const MODE_INFO: Record<GameMode, { label: string; description: string }> = {
  daily: {
    label: 'Daily',
    description: 'The same challenge for everyone today. One attempt.',
  },
  endless: {
    label: 'Endless',
    description: 'Keep going until you run out of lives. Gets harder as you go.',
  },
  practice: {
    label: 'Practice',
    description: 'Easier, unlimited retries. Not saved to your best runs.',
  },
  vs: {
    label: 'VS',
    description: 'Pass the device around. Same challenge, ranked at the end.',
  },
}

export function GameModeSelect({
  gameId,
  onStart,
}: {
  gameId: string
  onStart: (config: RunConfig) => void
}) {
  const [pickingPlayers, setPickingPlayers] = useState(false)
  const dailyStatus = getDailyStatus(gameId)

  function pick(mode: GameMode) {
    if (mode === 'vs') {
      setPickingPlayers(true)
      return
    }
    trackEvent('game_start', { game: gameId, mode })
    onStart(createRunConfig(mode, gameId))
  }

  if (pickingPlayers) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}
        >
          How many players?
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {[2, 3, 4].map((count) => (
            <button
              key={count}
              onClick={() => {
                trackEvent('game_start', { game: gameId, mode: 'vs', players: count })
                onStart(createRunConfig('vs', gameId, { playerIndex: 0, playerCount: count }))
              }}
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                fontSize: 18,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {count}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPickingPlayers(false)}
          style={{
            marginTop: 20,
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ← Back to modes
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
      }}
    >
      {(Object.keys(MODE_INFO) as GameMode[]).map((mode) => (
        <button
          key={mode}
          onClick={() => pick(mode)}
          style={{
            textAlign: 'left',
            padding: 16,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            {MODE_INFO[mode].label}
            {mode === 'daily' && dailyStatus && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--success)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                Played · {dailyStatus.score.toFixed(0)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            {MODE_INFO[mode].description}
          </div>
        </button>
      ))}
    </div>
  )
}
