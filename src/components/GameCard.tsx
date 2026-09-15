import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { BestOn, GameComplexity, GameMeta } from '../data/games'
import { usePointerKind } from '../lib/device'

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
}

const COMPLEXITY_TITLE: Record<GameComplexity, string> = {
  easy: 'Easy to pick up',
  medium: 'Some rules to learn',
  hard: 'Takes a moment to grok',
}

export function GameCard({ game }: { game: GameMeta }) {
  const locked = game.status === 'soon'

  const content = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: locked ? 'var(--text-faint)' : 'var(--text)',
          }}
        >
          {game.name}
        </div>
        {!locked && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 3 }}>
            <DeviceBadge bestOn={game.bestOn} />
            <ComplexityBadge complexity={game.complexity} />
          </div>
        )}
      </div>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--text-dim)',
          minHeight: 42,
        }}
      >
        {game.tagline}
      </p>
      <div
        style={{
          marginTop: 18,
          fontSize: 13,
          fontWeight: 500,
          color: locked ? 'var(--text-faint)' : 'var(--accent)',
        }}
      >
        {locked ? 'Coming soon' : 'Play now →'}
      </div>
    </>
  )

  const style: CSSProperties = {
    display: 'block',
    padding: 20,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    textDecoration: 'none',
    height: '100%',
  }

  if (locked) {
    return (
      <div style={{ ...style, opacity: 0.6, cursor: 'default' }}>{content}</div>
    )
  }

  return (
    <Link to={`/${game.id}`} style={style}>
      {content}
    </Link>
  )
}

function DeviceBadge({ bestOn }: { bestOn: BestOn }) {
  const pointerKind = usePointerKind()
  const matchesDevice =
    bestOn === 'both' || (bestOn === 'touch' && pointerKind === 'coarse') ||
    (bestOn === 'mouse' && pointerKind === 'fine')

  const title =
    bestOn === 'both'
      ? 'Plays well on touch or mouse'
      : bestOn === 'touch'
        ? 'Best on a touchscreen'
        : 'Best with a mouse or trackpad'

  return (
    <span
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 20,
        color: matchesDevice ? 'var(--text-dim)' : 'var(--text-faint)',
        opacity: matchesDevice ? 1 : 0.6,
      }}
    >
      {bestOn === 'touch' ? (
        <PhoneIcon />
      ) : bestOn === 'mouse' ? (
        <MouseIcon />
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <MouseIcon />
          <PhoneIcon />
        </span>
      )}
    </span>
  )
}

function ComplexityBadge({ complexity }: { complexity: GameComplexity }) {
  return (
    <span
      title={COMPLEXITY_TITLE[complexity]}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: 'var(--text-faint)',
        whiteSpace: 'nowrap',
      }}
    >
      {COMPLEXITY_LABEL[complexity]}
    </span>
  )
}

export function MouseIcon() {
  return (
    <svg width="11" height="14" viewBox="0 0 16 20" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="14" height="18" rx="7" stroke="currentColor" strokeWidth="1.4" />
      <line x1="8" y1="1" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

export function PhoneIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 16 20" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="14" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="1" y1="15.5" x2="15" y2="15.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="17.3" r="0.9" fill="currentColor" />
    </svg>
  )
}
