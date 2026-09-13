import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { GameMeta } from '../data/games'

export function GameCard({ game }: { game: GameMeta }) {
  const locked = game.status === 'soon'

  const content = (
    <>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: locked ? 'var(--text-faint)' : 'var(--text)',
        }}
      >
        {game.name}
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
