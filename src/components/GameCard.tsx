import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { BestOn, GameComplexity, GameMeta } from '../data/games'
import { usePointerKind } from '../lib/device'

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  easy: 'Easy to pick up',
  medium: 'Some rules to learn',
  hard: 'Takes a moment to grok',
}

const COMPLEXITY_LEVEL: Record<GameComplexity, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
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
        <TouchIcon />
      ) : bestOn === 'mouse' ? (
        <MouseIcon />
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <MouseIcon />
          <TouchIcon />
        </span>
      )}
    </span>
  )
}

function ComplexityBadge({ complexity }: { complexity: GameComplexity }) {
  const level = COMPLEXITY_LEVEL[complexity]
  return (
    <span
      title={COMPLEXITY_LABEL[complexity]}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        width: 20,
        height: 20,
        justifyContent: 'center',
      }}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 4 + i * 3,
            borderRadius: 1,
            background: i <= level ? 'var(--text-dim)' : 'var(--border)',
          }}
        />
      ))}
    </span>
  )
}

function MouseIcon() {
  return (
    <svg width="11" height="14" viewBox="0 0 16 20" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="14" height="18" rx="7" stroke="currentColor" strokeWidth="1.4" />
      <line x1="8" y1="1" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

// A fingertip tapping down with a couple of ripple arcs — deliberately not a
// radiating-lines glyph, since that would read as the theme toggle's sun icon.
function TouchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7 12.5V5.2a1.4 1.4 0 0 1 2.8 0v4.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12.5 6.5a6.5 6.5 0 0 1 0 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M15 4a10 10 0 0 1 0 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
      />
      <circle cx="7" cy="13.3" r="1.3" fill="currentColor" />
    </svg>
  )
}
