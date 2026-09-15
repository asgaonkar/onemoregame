import { useState, type ReactNode } from 'react'
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

  const modes = Object.keys(MODE_INFO) as GameMode[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {modes.map((mode, i) => (
        <ModeRow
          key={mode}
          onClick={() => pick(mode)}
          showDivider={i < modes.length - 1}
          label={MODE_INFO[mode].label}
          description={MODE_INFO[mode].description}
          tag={
            mode === 'daily' && dailyStatus ? (
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
            ) : null
          }
        />
      ))}
    </div>
  )
}

function ModeRow({
  label,
  description,
  tag,
  showDivider,
  onClick,
}: {
  label: string
  description: string
  tag?: ReactNode
  showDivider: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        textAlign: 'left',
        padding: '18px 2px',
        border: 'none',
        borderBottom: showDivider ? '1px solid var(--border)' : 'none',
        background: 'transparent',
        color: 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        width: '100%',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 4,
            color: hovered ? 'var(--accent)' : 'var(--text)',
            transition: 'color 0.15s ease',
          }}
        >
          {label}
          {tag}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          {description}
        </div>
      </div>
      <span
        aria-hidden="true"
        style={{
          fontSize: 18,
          color: hovered ? 'var(--accent)' : 'var(--text-faint)',
          flexShrink: 0,
          transform: hovered ? 'translateX(3px)' : 'translateX(0)',
          transition: 'transform 0.15s ease, color 0.15s ease',
        }}
      >
        →
      </span>
    </button>
  )
}
